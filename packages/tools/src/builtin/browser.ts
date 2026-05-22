import { isIP } from "node:net";
import { TextDecoder } from "node:util";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";

export interface BrowserSnapshotInput {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface BrowserFormSubmitInput extends BrowserSnapshotInput {
  formIndex?: number;
  formId?: string;
  formName?: string;
  allowCrossOrigin?: boolean;
  fields?: Record<string, string | number | boolean>;
}

export interface BrowserSnapshotLink {
  href: string;
  text?: string;
}

export interface BrowserSnapshotFormField {
  name?: string;
  type: string;
  label?: string;
  value?: string;
  required: boolean;
  checked?: boolean;
  options?: readonly string[];
}

export interface BrowserSnapshotForm {
  action: string;
  method: string;
  enctype?: string;
  id?: string;
  name?: string;
  fields: readonly BrowserSnapshotFormField[];
}

export interface BrowserSnapshotOutput {
  url: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  title?: string;
  text: string;
  links: BrowserSnapshotLink[];
  forms: BrowserSnapshotForm[];
  truncated: boolean;
}

export interface BrowserSnapshotToolOptions {
  fetchImpl?: typeof fetch;
  /** When false (default), private/link-local addresses are rejected. */
  allowPrivateHosts?: boolean;
}

export interface BrowserFormSubmitOutput {
  submitted: {
    pageUrl: string;
    action: string;
    method: string;
    formIndex: number;
    crossOrigin: boolean;
    fieldNames: string[];
  };
  snapshot: BrowserSnapshotOutput;
}

interface ParsedBrowserSnapshot {
  title?: string;
  text: string;
  links: BrowserSnapshotLink[];
  forms: BrowserSnapshotForm[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_BYTES = 4_000_000;
const MAX_TEXT_CHARS = 12_000;
const MAX_LINKS = 80;
const MAX_FORMS = 20;
const MAX_FORM_FIELDS = 80;
const MAX_FIELD_OPTIONS = 40;

const browserSnapshotSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
    timeoutMs: { type: "number" },
    maxBytes: { type: "number" },
  },
  required: ["url"],
  additionalProperties: false,
};

const browserFormSubmitSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
    timeoutMs: { type: "number" },
    maxBytes: { type: "number" },
    formIndex: { type: "number" },
    formId: { type: "string" },
    formName: { type: "string" },
    allowCrossOrigin: { type: "boolean" },
    fields: {
      type: "object",
      additionalProperties: {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
        ],
      },
    },
  },
  required: ["url"],
  additionalProperties: false,
};

export function createBrowserSnapshotTool(
  options: BrowserSnapshotToolOptions = {},
): ToolDefinition<BrowserSnapshotInput, BrowserSnapshotOutput> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowPrivateHosts = options.allowPrivateHosts ?? false;
  return {
    name: "browser_snapshot",
    description: "Fetch an HTTP(S) page and return a bounded text, link, and form snapshot for lightweight browser-style inspection.",
    inputSchema: browserSnapshotSchema,
    capabilities: ["read", "network"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseBrowserSnapshotInput(invocation.input, allowPrivateHosts);
        return await fetchBrowserSnapshot(fetchImpl, input, { allowPrivateHosts });
      });
    },
  };
}

export function createBrowserFormSubmitTool(
  options: BrowserSnapshotToolOptions = {},
): ToolDefinition<BrowserFormSubmitInput, BrowserFormSubmitOutput> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowPrivateHosts = options.allowPrivateHosts ?? false;
  return {
    name: "browser_form_submit",
    description: "Submit a basic HTTP(S) HTML form using GET or URL-encoded POST and return the resulting bounded page snapshot.",
    inputSchema: browserFormSubmitSchema,
    capabilities: ["read", "network"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseBrowserFormSubmitInput(invocation.input, allowPrivateHosts);
        return await submitBrowserForm(fetchImpl, input, { allowPrivateHosts });
      });
    },
  };
}

interface BrowserFetchOptions {
  allowPrivateHosts: boolean;
}

async function fetchBrowserSnapshot(
  fetchImpl: typeof fetch,
  input: Required<BrowserSnapshotInput>,
  browserOptions: BrowserFetchOptions,
): Promise<BrowserSnapshotOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await safeBrowserFetch(fetchImpl, input.url, {
      signal: controller.signal,
      headers: {
        accept: "text/html, text/plain;q=0.9, */*;q=0.1",
        "user-agent": "Dragon/0.0 browser_snapshot",
      },
    }, browserOptions.allowPrivateHosts);
    const contentType = response.headers.get("content-type") ?? undefined;
    const body = await readBoundedText(response, input.maxBytes);
    const finalUrl = response.url || input.url;
    const snapshot = contentType?.toLowerCase().includes("html")
      ? htmlToSnapshot(body.text, finalUrl)
      : textToSnapshot(body.text);
    return {
      url: input.url,
      finalUrl,
      status: response.status,
      ...(contentType !== undefined ? { contentType } : {}),
      ...(snapshot.title !== undefined ? { title: snapshot.title } : {}),
      text: fitText(snapshot.text, MAX_TEXT_CHARS),
      links: snapshot.links.slice(0, MAX_LINKS),
      forms: snapshot.forms.slice(0, MAX_FORMS),
      truncated: body.truncated
        || snapshot.text.length > MAX_TEXT_CHARS
        || snapshot.links.length > MAX_LINKS
        || snapshot.forms.length > MAX_FORMS,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function submitBrowserForm(
  fetchImpl: typeof fetch,
  input: Required<Pick<BrowserSnapshotInput, "url" | "timeoutMs" | "maxBytes">> & Pick<BrowserFormSubmitInput, "formIndex" | "formId" | "formName" | "fields" | "allowCrossOrigin">,
  browserOptions: BrowserFetchOptions,
): Promise<BrowserFormSubmitOutput> {
  const page = await fetchHtmlPage(fetchImpl, input, browserOptions);
  const forms = extractFormsWithSecrets(page.html, page.finalUrl);
  const selected = selectForm(forms, input);
  const formData = buildSubmissionFields(selected.form, input.fields ?? {});
  const submitted = await submitSelectedForm(fetchImpl, selected.form, formData, {
    pageUrl: page.finalUrl,
    timeoutMs: input.timeoutMs,
    maxBytes: input.maxBytes,
    allowCrossOrigin: input.allowCrossOrigin === true,
    browserOptions,
  });
  return {
    submitted: {
      pageUrl: page.finalUrl,
      action: selected.form.action,
      method: selected.form.method,
      formIndex: selected.index,
      crossOrigin: new URL(selected.form.action).origin !== new URL(page.finalUrl).origin,
      fieldNames: [...formData.keys()].sort(),
    },
    snapshot: submitted,
  };
}

async function fetchHtmlPage(
  fetchImpl: typeof fetch,
  input: Required<Pick<BrowserSnapshotInput, "url" | "timeoutMs" | "maxBytes">>,
  browserOptions: BrowserFetchOptions,
): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await safeBrowserFetch(fetchImpl, input.url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "user-agent": "Dragon/0.0 browser_form_submit",
      },
    }, browserOptions.allowPrivateHosts);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("html")) {
      throw new Error("browser_form_submit requires an HTML page.");
    }
    const body = await readBoundedText(response, input.maxBytes);
    return { html: body.text, finalUrl: response.url || input.url };
  } finally {
    clearTimeout(timeout);
  }
}

async function submitSelectedForm(
  fetchImpl: typeof fetch,
  form: BrowserSnapshotForm,
  fields: URLSearchParams,
  options: { pageUrl: string; timeoutMs: number; maxBytes: number; allowCrossOrigin: boolean; browserOptions: BrowserFetchOptions },
): Promise<BrowserSnapshotOutput> {
  if (form.method === "dialog") {
    throw new Error("browser_form_submit does not support dialog forms.");
  }
  const action = new URL(form.action);
  const page = new URL(options.pageUrl);
  if (!options.allowCrossOrigin && action.origin !== page.origin) {
    throw new Error("browser_form_submit refuses cross-origin form actions unless allowCrossOrigin is true.");
  }
  if (form.method === "post" && form.enctype !== undefined && form.enctype !== "application/x-www-form-urlencoded") {
    throw new Error(`browser_form_submit only supports application/x-www-form-urlencoded forms, got ${form.enctype}.`);
  }
  const init: RequestInit = {
    headers: {
      accept: "text/html, text/plain;q=0.9, */*;q=0.1",
      "user-agent": "Dragon/0.0 browser_form_submit",
    },
  };
  if (form.method === "get") {
    for (const [key, value] of fields) {
      action.searchParams.set(key, value);
    }
    return await fetchBrowserSnapshot(
      fetchImpl,
      { url: action.toString(), timeoutMs: options.timeoutMs, maxBytes: options.maxBytes },
      options.browserOptions,
    );
  }
  init.method = "POST";
  init.headers = {
    ...init.headers,
    "content-type": "application/x-www-form-urlencoded",
  };
  init.body = fields.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await safeBrowserFetch(fetchImpl, action.toString(), { ...init, signal: controller.signal }, options.browserOptions.allowPrivateHosts);
    const contentType = response.headers.get("content-type") ?? undefined;
    const body = await readBoundedText(response, options.maxBytes);
    const finalUrl = response.url || action.toString();
    const snapshot = contentType?.toLowerCase().includes("html")
      ? htmlToSnapshot(body.text, finalUrl)
      : textToSnapshot(body.text);
    return {
      url: action.toString(),
      finalUrl,
      status: response.status,
      ...(contentType !== undefined ? { contentType } : {}),
      ...(snapshot.title !== undefined ? { title: snapshot.title } : {}),
      text: fitText(snapshot.text, MAX_TEXT_CHARS),
      links: snapshot.links.slice(0, MAX_LINKS),
      forms: snapshot.forms.slice(0, MAX_FORMS),
      truncated: body.truncated
        || snapshot.text.length > MAX_TEXT_CHARS
        || snapshot.links.length > MAX_LINKS
        || snapshot.forms.length > MAX_FORMS,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = await response.text();
    return {
      text: fallback.length > maxBytes ? fallback.slice(0, maxBytes) : fallback,
      truncated: fallback.length > maxBytes,
    };
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    const remaining = maxBytes - bytes;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }
    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining));
      bytes += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }

  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(merged),
    truncated,
  };
}

function htmlToSnapshot(html: string, baseUrl: string): ParsedBrowserSnapshot {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  const title = extractTitle(withoutNoise);
  const links = extractLinks(withoutNoise, baseUrl);
  const forms = extractForms(withoutNoise, baseUrl);
  const text = decodeHtmlEntities(withoutNoise
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
  return {
    ...(title !== undefined ? { title } : {}),
    text,
    links,
    forms,
  };
}

function textToSnapshot(text: string): ParsedBrowserSnapshot {
  return {
    text: text.replace(/\s+/g, " ").trim(),
    links: [],
    forms: [],
  };
}

function extractTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = decodeHtmlEntities(match?.[1]?.replace(/\s+/g, " ").trim() ?? "");
  return title || undefined;
}

function extractLinks(html: string, baseUrl: string): BrowserSnapshotLink[] {
  const links: BrowserSnapshotLink[] = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null && links.length < MAX_LINKS + 1) {
    const attrs = match[1] ?? "";
    const href = readAttribute(attrs, "href");
    if (!href || href.startsWith("#") || /^(?:javascript|data|vbscript|file|gopher|ftp):/i.test(href)) {
      continue;
    }
    let resolved: string;
    try {
      const candidate = new URL(href, baseUrl);
      if (candidate.protocol !== "http:" && candidate.protocol !== "https:" && candidate.protocol !== "mailto:" && candidate.protocol !== "tel:") {
        continue;
      }
      resolved = candidate.toString();
    } catch {
      continue;
    }
    const text = decodeHtmlEntities((match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    links.push({
      href: resolved,
      ...(text ? { text: fitText(text, 200) } : {}),
    });
  }
  return links;
}

function extractForms(html: string, baseUrl: string): BrowserSnapshotForm[] {
  return extractFormsWithOptions(html, baseUrl, { includeHiddenValues: false });
}

function extractFormsWithSecrets(html: string, baseUrl: string): BrowserSnapshotForm[] {
  return extractFormsWithOptions(html, baseUrl, { includeHiddenValues: true });
}

function extractFormsWithOptions(
  html: string,
  baseUrl: string,
  options: { includeHiddenValues: boolean },
): BrowserSnapshotForm[] {
  const forms: BrowserSnapshotForm[] = [];
  const pattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null && forms.length < MAX_FORMS + 1) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const rawAction = readAttribute(attrs, "action") ?? baseUrl;
    let action: string;
    try {
      action = new URL(rawAction, baseUrl).toString();
    } catch {
      action = baseUrl;
    }
    const method = normalizeFormMethod(readAttribute(attrs, "method"));
    const enctype = normalizeFormEnctype(readAttribute(attrs, "enctype"));
    const form: BrowserSnapshotForm = {
      action,
      method,
      fields: extractFormFields(body, options).slice(0, MAX_FORM_FIELDS),
      ...(enctype !== undefined ? { enctype } : {}),
      ...(readAttribute(attrs, "id") !== undefined ? { id: fitText(readAttribute(attrs, "id") ?? "", 120) } : {}),
      ...(readAttribute(attrs, "name") !== undefined ? { name: fitText(readAttribute(attrs, "name") ?? "", 120) } : {}),
    };
    forms.push(form);
  }
  return forms;
}

function extractFormFields(
  formHtml: string,
  options: { includeHiddenValues: boolean },
): BrowserSnapshotFormField[] {
  const labels = extractLabels(formHtml);
  const fields: BrowserSnapshotFormField[] = [];
  const pattern = /<input\b([^>]*)\/?>|<textarea\b([^>]*)>([\s\S]*?)<\/textarea>|<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(formHtml)) !== null && fields.length < MAX_FORM_FIELDS + 1) {
    if (match[1] !== undefined) {
      const attrs = match[1];
      const type = (readAttribute(attrs, "type") ?? "text").trim().toLowerCase() || "text";
      const id = readAttribute(attrs, "id");
      const value = readAttribute(attrs, "value");
      fields.push(buildFormField(attrs, type, labels.get(id ?? ""), shouldExposeFieldValue(type, options.includeHiddenValues) ? value : undefined));
      continue;
    }
    if (match[2] !== undefined) {
      const attrs = match[2];
      const id = readAttribute(attrs, "id");
      const value = decodeHtmlEntities((match[3] ?? "").replace(/\s+/g, " ").trim());
      fields.push(buildFormField(attrs, "textarea", labels.get(id ?? ""), value || undefined));
      continue;
    }
    if (match[4] !== undefined) {
      const attrs = match[4];
      const body = match[5] ?? "";
      const id = readAttribute(attrs, "id");
      const options = extractOptions(body);
      const value = extractSelectedOptionValue(body);
      fields.push({
        ...buildFormField(attrs, "select", labels.get(id ?? ""), value),
        ...(options.length > 0 ? { options } : {}),
      });
    }
  }
  return fields;
}

function buildFormField(
  attrs: string,
  type: string,
  label: string | undefined,
  value: string | undefined,
): BrowserSnapshotFormField {
  return {
    type,
    required: hasAttribute(attrs, "required"),
    ...(readAttribute(attrs, "name") !== undefined ? { name: fitText(readAttribute(attrs, "name") ?? "", 120) } : {}),
    ...(label !== undefined ? { label: fitText(label, 200) } : {}),
    ...(value !== undefined ? { value: fitText(value, 500) } : {}),
    ...(hasAttribute(attrs, "checked") ? { checked: true } : {}),
  };
}

function extractLabels(html: string): Map<string, string> {
  const labels = new Map<string, string>();
  const pattern = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const id = readAttribute(match[1] ?? "", "for");
    if (!id) {
      continue;
    }
    const text = decodeHtmlEntities((match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (text) {
      labels.set(id, text);
    }
  }
  return labels;
}

function extractOptions(selectHtml: string): string[] {
  const options: string[] = [];
  const pattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(selectHtml)) !== null && options.length < MAX_FIELD_OPTIONS + 1) {
    const value = readAttribute(match[1] ?? "", "value");
    const text = decodeHtmlEntities((match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    options.push(fitText(value ?? text, 200));
  }
  return options;
}

function extractSelectedOptionValue(selectHtml: string): string | undefined {
  const pattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let first: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(selectHtml)) !== null) {
    const attrs = match[1] ?? "";
    const value = readAttribute(attrs, "value")
      ?? decodeHtmlEntities((match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (first === undefined && value) {
      first = value;
    }
    if (hasAttribute(attrs, "selected") && value) {
      return fitText(value, 500);
    }
  }
  return first !== undefined ? fitText(first, 500) : undefined;
}

function normalizeFormMethod(value: string | undefined): string {
  const method = value?.trim().toLowerCase();
  return method === "post" || method === "dialog" ? method : "get";
}

function normalizeFormEnctype(value: string | undefined): string | undefined {
  const enctype = value?.trim().toLowerCase();
  if (!enctype) {
    return undefined;
  }
  if (enctype.startsWith("multipart/form-data")) {
    return "multipart/form-data";
  }
  if (enctype.startsWith("text/plain")) {
    return "text/plain";
  }
  if (enctype.startsWith("application/x-www-form-urlencoded")) {
    return "application/x-www-form-urlencoded";
  }
  return enctype;
}

function shouldExposeFieldValue(type: string, includeHiddenValues = false): boolean {
  if (type === "password") {
    return false;
  }
  return includeHiddenValues || type !== "hidden";
}

function selectForm(
  forms: readonly BrowserSnapshotForm[],
  input: Pick<BrowserFormSubmitInput, "formIndex" | "formId" | "formName">,
): { form: BrowserSnapshotForm; index: number } {
  if (forms.length === 0) {
    throw new Error("browser_form_submit found no forms on the page.");
  }
  const index = input.formId !== undefined
    ? forms.findIndex(form => form.id === input.formId)
    : input.formName !== undefined
      ? forms.findIndex(form => form.name === input.formName)
      : Math.min(Math.max(0, Math.floor(input.formIndex ?? 0)), forms.length - 1);
  if (index < 0) {
    throw new Error("browser_form_submit could not find the requested form.");
  }
  return { form: forms[index] as BrowserSnapshotForm, index };
}

function buildSubmissionFields(
  form: BrowserSnapshotForm,
  overrides: Record<string, string | number | boolean>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const field of form.fields) {
    if (!field.name || isNonSubmittableField(field.type)) {
      continue;
    }
    if ((field.type === "checkbox" || field.type === "radio") && field.checked !== true && overrides[field.name] === undefined) {
      continue;
    }
    params.set(field.name, field.value ?? "");
  }
  for (const [key, value] of Object.entries(overrides)) {
    const name = key.trim();
    if (!name) {
      continue;
    }
    params.set(name, String(value));
  }
  return params;
}

function isNonSubmittableField(type: string): boolean {
  return type === "button" || type === "submit" || type === "reset" || type === "image" || type === "file";
}

function readAttribute(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`, "i");
  const match = pattern.exec(attrs);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? undefined;
}

function hasAttribute(attrs: string, name: string): boolean {
  const pattern = new RegExp(`(?:^|\\s)${name}(?:\\s|=|$)`, "i");
  return pattern.test(attrs);
}

function parseBrowserSnapshotInput(input: unknown, allowPrivateHosts = false): Required<BrowserSnapshotInput> {
  if (!isRecord(input) || typeof input.url !== "string" || !input.url.trim()) {
    throw new Error("browser_snapshot requires a non-empty url.");
  }
  return {
    url: normalizeBrowserUrl(input.url, allowPrivateHosts),
    timeoutMs: typeof input.timeoutMs === "number"
      ? Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(input.timeoutMs)))
      : DEFAULT_TIMEOUT_MS,
    maxBytes: typeof input.maxBytes === "number"
      ? Math.min(MAX_BYTES, Math.max(1024, Math.floor(input.maxBytes)))
      : DEFAULT_MAX_BYTES,
  };
}

function parseBrowserFormSubmitInput(
  input: unknown,
  allowPrivateHosts = false,
): Required<Pick<BrowserSnapshotInput, "url" | "timeoutMs" | "maxBytes">> & Pick<BrowserFormSubmitInput, "formIndex" | "formId" | "formName" | "fields" | "allowCrossOrigin"> {
  if (!isRecord(input) || typeof input.url !== "string" || !input.url.trim()) {
    throw new Error("browser_form_submit requires a non-empty url.");
  }
  const parsed: Required<Pick<BrowserSnapshotInput, "url" | "timeoutMs" | "maxBytes">> & Pick<BrowserFormSubmitInput, "formIndex" | "formId" | "formName" | "fields" | "allowCrossOrigin"> = {
    url: normalizeBrowserUrl(input.url, allowPrivateHosts),
    timeoutMs: typeof input.timeoutMs === "number"
      ? Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(input.timeoutMs)))
      : DEFAULT_TIMEOUT_MS,
    maxBytes: typeof input.maxBytes === "number"
      ? Math.min(MAX_BYTES, Math.max(1024, Math.floor(input.maxBytes)))
      : DEFAULT_MAX_BYTES,
  };
  if (typeof input.formIndex === "number" && Number.isFinite(input.formIndex)) {
    parsed.formIndex = Math.max(0, Math.floor(input.formIndex));
  }
  if (typeof input.formId === "string" && input.formId.trim()) {
    parsed.formId = input.formId.trim();
  }
  if (typeof input.formName === "string" && input.formName.trim()) {
    parsed.formName = input.formName.trim();
  }
  if (typeof input.allowCrossOrigin === "boolean") {
    parsed.allowCrossOrigin = input.allowCrossOrigin;
  }
  if (input.fields !== undefined) {
    if (!isRecord(input.fields)) {
      throw new Error("browser_form_submit fields must be an object.");
    }
    parsed.fields = readSubmitFields(input.fields);
  }
  return parsed;
}

function readSubmitFields(value: Record<string, unknown>): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key.trim()) {
      continue;
    }
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
      throw new Error("browser_form_submit field values must be strings, numbers, or booleans.");
    }
    fields[key] = item;
  }
  return fields;
}

function normalizeBrowserUrl(value: string, allowPrivateHosts = false): string {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  assertSafeBrowserTarget(url, allowPrivateHosts);
  return url.toString();
}

function assertSafeBrowserTarget(url: URL, allowPrivateHosts: boolean): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`browser tools only support HTTP(S), got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("browser tools URL must not include credentials.");
  }
  if (!allowPrivateHosts) {
    assertPublicBrowserHost(url.hostname);
  }
}

const MAX_BROWSER_REDIRECTS = 5;

// Manual redirect follower so we can (a) cap the number of hops and
// (b) re-validate every intermediate URL against the same host policy as
// the initial target. Standard fetch's redirect: "follow" silently chases
// up to 20 hops without revalidation, which is an SSRF vector for an
// agent-invoked tool.
async function safeBrowserFetch(
  fetchImpl: typeof fetch,
  startUrl: string,
  init: RequestInit,
  allowPrivateHosts: boolean,
): Promise<Response> {
  let currentUrl = new URL(startUrl);
  assertSafeBrowserTarget(currentUrl, allowPrivateHosts);
  let lastResponse: Response | undefined;
  for (let hop = 0; hop <= MAX_BROWSER_REDIRECTS; hop += 1) {
    const response = await fetchImpl(currentUrl.toString(), { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    if (hop === MAX_BROWSER_REDIRECTS) {
      throw new Error(`browser fetch exceeded ${MAX_BROWSER_REDIRECTS} redirects.`);
    }
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new Error(`browser fetch received an invalid redirect Location: ${location}`);
    }
    assertSafeBrowserTarget(nextUrl, allowPrivateHosts);
    try { await response.body?.cancel(); } catch { /* ignore */ }
    currentUrl = nextUrl;
    lastResponse = response;
  }
  return lastResponse ?? await fetchImpl(currentUrl.toString(), { ...init, redirect: "manual" });
}

const BLOCKED_BROWSER_HOSTNAMES = new Set([
  "metadata.google.internal",
]);

/** Validates an HTTP(S) URL for browser tools (SSRF-safe by default). */
export function validateBrowserTargetUrl(value: string, allowPrivateHosts = false): string {
  return normalizeBrowserUrl(value, allowPrivateHosts);
}

function assertPublicBrowserHost(hostname: string): void {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    throw new Error("browser tools require a hostname.");
  }
  if (BLOCKED_BROWSER_HOSTNAMES.has(host)) {
    throw new Error(`browser tools cannot access blocked host: ${host}`);
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("browser tools cannot access localhost.");
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4 && isBlockedIpv4(host)) {
    throw new Error("browser tools cannot access private or link-local IPv4 addresses.");
  }
  if (ipVersion === 6 && isBlockedIpv6(host)) {
    throw new Error("browser tools cannot access private or link-local IPv6 addresses.");
  }
}

function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 0 || a === 127 || a === 10) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("fe80:")) {
    return true;
  }
  return false;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const valueCode = Number(code);
      return Number.isFinite(valueCode) ? String.fromCodePoint(valueCode) : "";
    });
}

function fitText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}... [truncated]` : value;
}

async function safelyInvoke<TOutput>(
  invocation: ToolInvocation,
  fn: () => Promise<TOutput>,
): Promise<ToolResult<TOutput>> {
  try {
    return {
      id: invocation.id,
      ok: true,
      output: await fn(),
    };
  } catch (error) {
    return {
      id: invocation.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
