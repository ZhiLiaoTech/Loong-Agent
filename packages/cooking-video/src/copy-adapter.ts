import { assertPromotionalText, hasDirectVisualSupport } from "./copy-validation.js";
import { CookingVideoError } from "./errors.js";
import { COOKING_EVENTS, type CookingEvent } from "./types.js";

export interface CopyGenerationRequest {
  schemaVersion: "1.0";
  jobId: string;
  language: string;
  dishName?: string;
  objective?: string;
  verifiedSellingPoints: string[];
  evidenceEvents: CookingEvent[];
}

export interface GeneratedCopy {
  schemaVersion: "1.0";
  jobId: string;
  title: string;
  captions: Array<{ event: CookingEvent; text: string }>;
  cta: string;
}

export type CopyModelClient = (request: CopyGenerationRequest, context: { signal: AbortSignal; attempt: number }) => Promise<unknown>;

export interface CopyAdapterOptions {
  allowModelCall: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  maxInputCharacters?: number;
  maxOutputCharacters?: number;
  signal?: AbortSignal;
}

function parse(raw: unknown): GeneratedCopy {
  if (typeof raw !== "string") return raw as GeneratedCopy;
  try { return JSON.parse(raw) as GeneratedCopy; }
  catch { throw new CookingVideoError("MODEL_CALL_FAILED", "Copy model returned non-JSON output."); }
}

export function validateGeneratedCopy(request: CopyGenerationRequest, value: GeneratedCopy, maxOutputCharacters = 1000): GeneratedCopy {
  if (!request || request.schemaVersion !== "1.0" || typeof request.jobId !== "string" || !Array.isArray(request.verifiedSellingPoints)
    || !Array.isArray(request.evidenceEvents) || request.evidenceEvents.some(event => !COOKING_EVENTS.includes(event))) {
    throw new CookingVideoError("JOB_INVALID", "Copy generation request is invalid.");
  }
  if (!value || typeof value !== "object" || Object.keys(value).some(key => !["schemaVersion", "jobId", "title", "captions", "cta"].includes(key))
    || value.schemaVersion !== "1.0" || value.jobId !== request.jobId || typeof value.title !== "string" || typeof value.cta !== "string" || !Array.isArray(value.captions)) {
    throw new CookingVideoError("MODEL_CALL_FAILED", "Generated copy has an invalid structure or jobId.");
  }
  const serializedLength = JSON.stringify(value).length;
  if (serializedLength > maxOutputCharacters) throw new CookingVideoError("MODEL_BUDGET_EXCEEDED", `Generated copy exceeds ${maxOutputCharacters} characters.`);
  const assertVerified = (text: string, events: readonly CookingEvent[], max: number): void => {
    assertPromotionalText(text, events, max);
    const containsClaim = /节能|省电|省时|高效|效率|营养|卫生|安全|收益|成本|减少|提升|降低|稳定|标准化|自动|智能/.test(text);
    const verified = request.verifiedSellingPoints.some(point => point.length > 0 && text.includes(point));
    if (containsClaim && !verified && !hasDirectVisualSupport(text, events)) {
      throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `Generated claim is neither verified nor directly supported by visual evidence: ${text}`);
    }
  };
  assertVerified(value.title, request.evidenceEvents, 30);
  assertVerified(value.cta, request.evidenceEvents, 20);
  if (value.captions.length === 0 || value.captions.length > 20) throw new CookingVideoError("MODEL_CALL_FAILED", "Generated captions must contain between 1 and 20 items.");
  const captions = value.captions.map((caption, index) => {
    if (!caption || typeof caption !== "object" || Object.keys(caption).some(key => !["event", "text"].includes(key))
      || !COOKING_EVENTS.includes(caption.event) || !request.evidenceEvents.includes(caption.event) || typeof caption.text !== "string") {
      throw new CookingVideoError("MODEL_CALL_FAILED", `Generated caption ${index} has no matching evidence event.`);
    }
    assertVerified(caption.text, [caption.event], 24);
    return { event: caption.event, text: caption.text };
  });
  return { schemaVersion: "1.0", jobId: request.jobId, title: value.title, captions, cta: value.cta };
}

export async function runCopyAdapter(request: CopyGenerationRequest, client: CopyModelClient, options: CopyAdapterOptions): Promise<{ copy: GeneratedCopy; attempts: number }> {
  if (!options.allowModelCall) throw new CookingVideoError("MODEL_CALL_FAILED", "Text model use requires explicit authorization.");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 2;
  const maxInputCharacters = options.maxInputCharacters ?? 4000;
  const maxOutputCharacters = options.maxOutputCharacters ?? 1000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300_000 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new CookingVideoError("JOB_INVALID", "Copy model timeout or attempt limit is invalid.");
  }
  if (!Number.isInteger(maxInputCharacters) || maxInputCharacters < 100 || !Number.isInteger(maxOutputCharacters) || maxOutputCharacters < 100) {
    throw new CookingVideoError("JOB_INVALID", "Copy model character budgets must be integers of at least 100.");
  }
  if (JSON.stringify(request).length > maxInputCharacters) throw new CookingVideoError("MODEL_BUDGET_EXCEEDED", `Copy request exceeds ${maxInputCharacters} characters.`);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new CookingVideoError("MODEL_TIMEOUT", `Copy model call exceeded ${timeoutMs}ms.`)), timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    try {
      if (signal.aborted) throw signal.reason;
      const raw = await Promise.race([
        client(request, { signal, attempt }),
        new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
      ]);
      return { copy: validateGeneratedCopy(request, parse(raw), maxOutputCharacters), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw new CookingVideoError("JOB_CANCELLED", "Copy model call was cancelled.");
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof CookingVideoError) throw lastError;
  throw new CookingVideoError("MODEL_CALL_FAILED", `Copy model failed after ${maxAttempts} attempt(s).`, { cause: lastError instanceof Error ? lastError.message : String(lastError) });
}
