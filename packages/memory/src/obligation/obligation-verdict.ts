import { MemoryToolError } from "../memory-tool-error.js";
import type { ObligationEvidenceLink } from "./obligation-store.js";
import type { ObligationItem, ObligationVerdict } from "./obligation-types.js";

/**
 * Phase 3.1 (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §6): validator engine +
 * three-way verdict aggregation. PURE LOGIC — this module never touches the
 * store, never spawns processes, and never copies evidence excerpts into
 * reasons/audit details (§9: pointers and metadata only).
 *
 * 验证器不扩权（§9）：`test_command` does not spawn here; execution is
 * delegated to an injected `ObligationCommandRunner` (sandbox policy lives
 * with the caller). `model_review` is delegated to an injected
 * `ObligationModelReviewer` and can NEVER be the sole basis for fulfilled
 * (§6.1: 模型评审不可单独定论).
 */

// ---------------------------------------------------------------------------
// Validator configs (shape of ObligationItem.validatorConfig per validator)
// ---------------------------------------------------------------------------

export interface ObligationSchemaValidatorConfig {
  /** dot-path into the execution subject; omitted = the subject itself. */
  subjectPath?: string;
  /** schema-lite: type / properties / required / items / enum / const / pattern (recursive). */
  schema: Record<string, unknown>;
}

export type ObligationAssertionOp =
  | "exists"
  | "equals"
  | "notEquals"
  | "matches"
  | "in"
  | "contains"
  | "gte"
  | "lte";

export const OBLIGATION_ASSERTION_OPS: readonly ObligationAssertionOp[] = [
  "exists",
  "equals",
  "notEquals",
  "matches",
  "in",
  "contains",
  "gte",
  "lte",
];

export interface ObligationToolAssertion {
  /** dot-path into the (possibly subjectPath-shifted) subject; "" = the subject itself. */
  path: string;
  op: ObligationAssertionOp;
  /** Not used by `exists`. */
  value?: unknown;
}

export interface ObligationToolAssertionConfig {
  subjectPath?: string;
  assertions: ObligationToolAssertion[];
}

export const DEFAULT_TEST_COMMAND_TIMEOUT_MS = 5000;
export const MAX_TEST_COMMAND_TIMEOUT_MS = 60_000;
export const DEFAULT_MODEL_REVIEW_PASS_THRESHOLD = 0.7;

export interface ObligationTestCommandConfig {
  command: string;
  /** Default 5000ms, clamped to [1, 60000]. */
  timeoutMs?: number;
  /** Default true: non-zero exit is a recoverable block (§6.2 可重试错误). */
  recoverableOnNonZeroExit?: boolean;
}

export interface ObligationHumanConfirmConfig {
  prompt?: string;
}

export interface ObligationModelReviewConfig {
  rubric?: string;
  /** Default 0.7. */
  passThreshold?: number;
}

// ---------------------------------------------------------------------------
// Executors (injected — this module stays pure)
// ---------------------------------------------------------------------------

export interface ObligationCommandResult {
  exitCode: number;
  timedOut?: boolean;
}

/** Sandbox-aware command execution lives with the caller (验证器不扩权, §9). */
export type ObligationCommandRunner = (
  command: string,
  options: { timeoutMs: number },
) => Promise<ObligationCommandResult>;

export interface ObligationModelReviewResult {
  score: number;
  rationale?: string;
}

export type ObligationModelReviewer = (input: {
  rubric?: string;
  subject: unknown;
}) => Promise<ObligationModelReviewResult>;

export interface ObligationValidatorContext {
  /** Resolved execution subject (e.g. step result payload); may be undefined. */
  subject?: unknown;
  commandRunner?: ObligationCommandRunner;
  modelReviewer?: ObligationModelReviewer;
}

// ---------------------------------------------------------------------------
// Per-item validator execution
// ---------------------------------------------------------------------------

export interface ObligationValidatorResult {
  /** false for human_confirm — machine validation never decides human items. */
  executed: boolean;
  verdict?: ObligationVerdict;
  reason?: string;
}

/**
 * Execute ONE machine validator for an item. `human_confirm` items return
 * `{ executed: false }` — their verdicts arrive via submitHumanVerdict only.
 * Malformed validatorConfig throws MemoryToolError (contract authoring error,
 * fail loud); a missing commandRunner/modelReviewer also throws (fail-closed —
 * an un-runnable validator means "unverified", never "passed").
 */
export async function executeValidator(
  item: ObligationItem,
  context: ObligationValidatorContext,
): Promise<ObligationValidatorResult> {
  switch (item.validator) {
    case "human_confirm":
      return { executed: false };
    case "schema":
      return executeSchemaValidator(item, context);
    case "tool_assertion":
      return executeToolAssertionValidator(item, context);
    case "test_command":
      return await executeTestCommandValidator(item, context);
    case "model_review":
      return await executeModelReviewValidator(item, context);
  }
}

function executeSchemaValidator(item: ObligationItem, context: ObligationValidatorContext): ObligationValidatorResult {
  const config = parseSchemaValidatorConfig(item.validatorConfig);
  const subject = resolveValidatorSubject(context.subject, config);
  if (subject === undefined) {
    return { executed: true, verdict: "recoverable_block", reason: "validation subject unavailable (evidence missing)" };
  }
  const violations = checkSchemaLite(config.schema, subject);
  if (violations.length === 0) {
    return { executed: true, verdict: "pass" };
  }
  return {
    executed: true,
    verdict: "hard_block",
    reason: `schema validation failed: ${violations.join("; ")}`,
  };
}

function executeToolAssertionValidator(item: ObligationItem, context: ObligationValidatorContext): ObligationValidatorResult {
  const config = parseToolAssertionConfig(item.validatorConfig);
  const subject = resolveValidatorSubject(context.subject, config);
  if (subject === undefined) {
    return { executed: true, verdict: "recoverable_block", reason: "validation subject unavailable (evidence missing)" };
  }
  const failures = config.assertions
    .map(assertion => evaluateAssertion(assertion, subject))
    .filter((failure): failure is string => failure !== undefined);
  if (failures.length === 0) {
    return { executed: true, verdict: "pass" };
  }
  return {
    executed: true,
    verdict: "hard_block",
    reason: `tool assertion failed: ${failures.slice(0, 8).join("; ")}`,
  };
}

async function executeTestCommandValidator(
  item: ObligationItem,
  context: ObligationValidatorContext,
): Promise<ObligationValidatorResult> {
  const config = parseTestCommandConfig(item.validatorConfig);
  if (context.commandRunner === undefined) {
    throw new MemoryToolError(
      "Obligation test_command validator requires a commandRunner (fail-closed; sandbox policy lives with the caller).",
    );
  }
  const result = await context.commandRunner(config.command, { timeoutMs: config.timeoutMs });
  if (result.timedOut === true) {
    return { executed: true, verdict: "recoverable_block", reason: `test command timed out after ${config.timeoutMs}ms` };
  }
  if (result.exitCode === 0) {
    return { executed: true, verdict: "pass" };
  }
  return config.recoverableOnNonZeroExit
    ? { executed: true, verdict: "recoverable_block", reason: `test command exited with code ${result.exitCode}` }
    : { executed: true, verdict: "hard_block", reason: `test command exited with code ${result.exitCode} (non-recoverable)` };
}

async function executeModelReviewValidator(
  item: ObligationItem,
  context: ObligationValidatorContext,
): Promise<ObligationValidatorResult> {
  const config = parseModelReviewConfig(item.validatorConfig);
  if (context.modelReviewer === undefined) {
    throw new MemoryToolError(
      "Obligation model_review validator requires a modelReviewer (fail-closed; 模型评审只作佐证).",
    );
  }
  const subject = resolveValidatorSubject(context.subject, config);
  if (subject === undefined) {
    return { executed: true, verdict: "recoverable_block", reason: "validation subject unavailable (evidence missing)" };
  }
  const review = await context.modelReviewer({ ...(config.rubric !== undefined ? { rubric: config.rubric } : {}), subject });
  if (!Number.isFinite(review.score)) {
    throw new MemoryToolError("Obligation model reviewer returned a non-finite score.");
  }
  if (review.score >= config.passThreshold) {
    return { executed: true, verdict: "pass", reason: `model review score ${review.score} >= ${config.passThreshold}` };
  }
  // 模型评审失败同样只作佐证（R5：阈值随模型版本漂移）——不单独造成 hard_block。
  return {
    executed: true,
    verdict: "recoverable_block",
    reason: `model review score ${review.score} < ${config.passThreshold}${review.rationale ? `: ${review.rationale.slice(0, 200)}` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Three-way verdict aggregation (§6.2)
// ---------------------------------------------------------------------------

export type ObligationAggregateOutcome =
  | { kind: "fulfilled"; reason: string }
  | { kind: "blocked_recoverable"; reason: string }
  | { kind: "blocked_hard"; reason: string }
  /** Unverified required items remain (e.g. awaiting human confirm) — stay validating. */
  | { kind: "awaiting"; reason: string };

export interface ObligationAggregateInput {
  items: readonly ObligationItem[];
  /** When provided, the fulfilled path additionally requires §10 证据完备. */
  evidenceLinks?: readonly ObligationEvidenceLink[];
  retryBudget: number;
}

/**
 * Contract-level verdict over current item verdicts (§6.2 + §10):
 * - any required hard_block → blocked_hard;
 * - unverified required items → awaiting (stay validating, e.g. human_confirm);
 * - any required recoverable_block → blocked_recoverable while retry_budget
 *   remains, otherwise escalates to blocked_hard (错误放大防护);
 * - all required pass → fulfilled ONLY when at least one required item passed
 *   on a non-model_review validator (§6.1 模型评审不可单独定论; human_confirm
 *   counts as non-model) AND every required item carries ≥1 item-level
 *   evidence link (§10 证据完备, when links are provided).
 */
export function aggregateObligationVerdict(input: ObligationAggregateInput): ObligationAggregateOutcome {
  const requiredItems = input.items.filter(item => item.required);
  if (requiredItems.length === 0) {
    return {
      kind: "blocked_hard",
      reason: "contract has no required acceptance items; fulfilled is unreachable (fail-closed)",
    };
  }
  const hardBlocked = requiredItems.find(item => item.verdict === "hard_block");
  if (hardBlocked !== undefined) {
    return {
      kind: "blocked_hard",
      reason: `required item ${hardBlocked.id} hard_block: ${hardBlocked.verdictReason ?? hardBlocked.acceptance.slice(0, 120)}`,
    };
  }
  const unverified = requiredItems.filter(item => item.verdict === undefined);
  if (unverified.length > 0) {
    const pendingHuman = unverified.filter(item => item.validator === "human_confirm").map(item => item.id);
    return {
      kind: "awaiting",
      reason: pendingHuman.length > 0
        ? `awaiting human confirmation on required items: ${pendingHuman.join(", ")}`
        : `${unverified.length} required item(s) still unverified: ${unverified.map(item => item.id).join(", ")}`,
    };
  }
  const recoverable = requiredItems.find(item => item.verdict === "recoverable_block");
  if (recoverable !== undefined) {
    const base = `required item ${recoverable.id} recoverable_block: ${recoverable.verdictReason ?? recoverable.acceptance.slice(0, 120)}`;
    return input.retryBudget > 0
      ? { kind: "blocked_recoverable", reason: base }
      : { kind: "blocked_hard", reason: `${base}; retry budget exhausted, escalated to hard_block` };
  }
  const hasNonModelPass = requiredItems.some(item => item.verdict === "pass" && item.validator !== "model_review");
  if (!hasNonModelPass) {
    return {
      kind: "blocked_hard",
      reason:
        "all required items passed on model_review alone; model review cannot be the sole verdict basis" +
        " (§6.1: 模型评审不可单独定论 — pair at least one deterministic or human validator)",
    };
  }
  if (input.evidenceLinks !== undefined) {
    const links = input.evidenceLinks;
    const uncovered = requiredItems.filter(item => !links.some(link => link.itemId === item.id));
    if (uncovered.length > 0) {
      const base = `required items lack item-level evidence links (§10 证据完备): ${uncovered.map(item => item.id).join(", ")}`;
      return input.retryBudget > 0
        ? { kind: "blocked_recoverable", reason: base }
        : { kind: "blocked_hard", reason: `${base}; retry budget exhausted, escalated to hard_block` };
    }
  }
  return { kind: "fulfilled", reason: "all required items passed (incl. >=1 deterministic/human validator) with evidence coverage" };
}

// ---------------------------------------------------------------------------
// Subject resolution & deterministic checkers
// ---------------------------------------------------------------------------

/** Resolve the validation subject: config.subjectPath shifts into the context subject. */
export function resolveValidatorSubject(subject: unknown, config: { subjectPath?: unknown }): unknown {
  const subjectPath = typeof config.subjectPath === "string" ? config.subjectPath.trim() : "";
  return subjectPath ? getPathValue(subject, subjectPath) : subject;
}

/** dot-path lookup (numeric segments index into arrays); missing → undefined. */
export function getPathValue(subject: unknown, path: string): unknown {
  const segments = path.split(".").map(segment => segment.trim()).filter(segment => segment.length > 0);
  let current: unknown = subject;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    } else if (typeof current === "object") {
      if (!(segment in current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

const MAX_SCHEMA_VIOLATIONS = 8;
const MAX_SCHEMA_DEPTH = 12;

/**
 * schema-lite structural checker (memory must not depend on @loong/suite):
 * supports type / properties / required / items / enum / const / pattern,
 * recursively, and returns at most 8 violation descriptions.
 */
export function checkSchemaLite(schema: Record<string, unknown>, value: unknown): string[] {
  const violations: string[] = [];
  collectSchemaViolations(schema, value, "$", violations, 0);
  return violations;
}

function collectSchemaViolations(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  violations: string[],
  depth: number,
): void {
  if (violations.length >= MAX_SCHEMA_VIOLATIONS || depth > MAX_SCHEMA_DEPTH) {
    return;
  }
  if ("const" in schema && !jsonEquals(schema.const, value)) {
    violations.push(`${path}: const mismatch`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(entry => jsonEquals(entry, value))) {
    violations.push(`${path}: not in enum`);
  }
  const type = typeof schema.type === "string" ? schema.type : undefined;
  if (type !== undefined && !matchesJsonType(type, value)) {
    violations.push(`${path}: expected type ${type}`);
    return;
  }
  if ((type === undefined || type === "object") && isRecord(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !(key in value)) {
          violations.push(`${path}.${key}: required property missing`);
        }
      }
    }
    if (isRecord(schema.properties)) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in value && isRecord(subSchema)) {
          collectSchemaViolations(subSchema, value[key], `${path}.${key}`, violations, depth + 1);
        }
      }
    }
  }
  if ((type === undefined || type === "array") && Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((entry, index) => {
      collectSchemaViolations(schema.items as Record<string, unknown>, entry, `${path}[${index}]`, violations, depth + 1);
    });
  }
  if (typeof schema.pattern === "string" && typeof value === "string") {
    let regex: RegExp | undefined;
    try {
      regex = new RegExp(schema.pattern);
    } catch {
      violations.push(`${path}: invalid schema pattern`);
    }
    if (regex !== undefined && !regex.test(value)) {
      violations.push(`${path}: pattern mismatch`);
    }
  }
}

function matchesJsonType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

/** Evaluate one assertion against the subject; returns a failure description or undefined. */
export function evaluateAssertion(assertion: ObligationToolAssertion, subject: unknown): string | undefined {
  const value = getPathValue(subject, assertion.path);
  switch (assertion.op) {
    case "exists":
      return value === undefined ? `${assertion.path}: expected to exist` : undefined;
    case "equals":
      return jsonEquals(value, assertion.value) ? undefined : `${assertion.path}: equals mismatch`;
    case "notEquals":
      return jsonEquals(value, assertion.value) ? `${assertion.path}: notEquals violated` : undefined;
    case "matches": {
      if (typeof value !== "string" || typeof assertion.value !== "string") {
        return `${assertion.path}: matches requires a string subject and a string pattern`;
      }
      let regex: RegExp;
      try {
        regex = new RegExp(assertion.value);
      } catch {
        return `${assertion.path}: invalid matches pattern`;
      }
      return regex.test(value) ? undefined : `${assertion.path}: matches mismatch`;
    }
    case "in": {
      if (!Array.isArray(assertion.value)) {
        return `${assertion.path}: in requires an array value`;
      }
      return assertion.value.some(entry => jsonEquals(entry, value)) ? undefined : `${assertion.path}: not in allowed set`;
    }
    case "contains": {
      if (typeof value === "string" && typeof assertion.value === "string") {
        return value.includes(assertion.value) ? undefined : `${assertion.path}: substring not found`;
      }
      if (Array.isArray(value)) {
        return value.some(entry => jsonEquals(entry, assertion.value)) ? undefined : `${assertion.path}: element not found`;
      }
      return `${assertion.path}: contains requires a string or array subject`;
    }
    case "gte":
      return compareNumbers(assertion, value, (left, right) => left >= right);
    case "lte":
      return compareNumbers(assertion, value, (left, right) => left <= right);
  }
}

function compareNumbers(
  assertion: ObligationToolAssertion,
  value: unknown,
  compare: (left: number, right: number) => boolean,
): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || typeof assertion.value !== "number" || !Number.isFinite(assertion.value)) {
    return `${assertion.path}: ${assertion.op} requires finite numbers on both sides`;
  }
  return compare(value, assertion.value) ? undefined : `${assertion.path}: ${assertion.op} comparison failed`;
}

function jsonEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(entry => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Config parsers (malformed config = contract authoring error, fail loud)
// ---------------------------------------------------------------------------

export function parseSchemaValidatorConfig(config: Record<string, unknown>): { subjectPath?: string; schema: Record<string, unknown> } {
  const result: { subjectPath?: string; schema: Record<string, unknown> } = {
    schema: parseConfigRecord(config.schema, "schema validator config.schema"),
  };
  const subjectPath = parseConfigSubjectPath(config);
  if (subjectPath !== undefined) {
    result.subjectPath = subjectPath;
  }
  return result;
}

export function parseToolAssertionConfig(config: Record<string, unknown>): ObligationToolAssertionConfig {
  if (!Array.isArray(config.assertions) || config.assertions.length === 0) {
    throw new MemoryToolError("Obligation tool_assertion validator config requires a non-empty assertions array.");
  }
  const assertions = config.assertions.map((entry, index) => parseToolAssertion(entry, index));
  const result: ObligationToolAssertionConfig = { assertions };
  const subjectPath = parseConfigSubjectPath(config);
  if (subjectPath !== undefined) {
    result.subjectPath = subjectPath;
  }
  return result;
}

export function parseTestCommandConfig(config: Record<string, unknown>): { command: string; timeoutMs: number; recoverableOnNonZeroExit: boolean } {
  if (typeof config.command !== "string" || !config.command.trim()) {
    throw new MemoryToolError("Obligation test_command validator config requires a non-empty command.");
  }
  if (config.command.trim().length > 2000) {
    throw new MemoryToolError("Obligation test_command validator command is too long.");
  }
  let timeoutMs = DEFAULT_TEST_COMMAND_TIMEOUT_MS;
  if (config.timeoutMs !== undefined) {
    if (typeof config.timeoutMs !== "number" || !Number.isFinite(config.timeoutMs)) {
      throw new MemoryToolError("Obligation test_command validator timeoutMs must be a finite number.");
    }
    timeoutMs = Math.min(Math.max(1, Math.floor(config.timeoutMs)), MAX_TEST_COMMAND_TIMEOUT_MS);
  }
  if (config.recoverableOnNonZeroExit !== undefined && typeof config.recoverableOnNonZeroExit !== "boolean") {
    throw new MemoryToolError("Obligation test_command validator recoverableOnNonZeroExit must be a boolean.");
  }
  return {
    command: config.command.trim(),
    timeoutMs,
    recoverableOnNonZeroExit: config.recoverableOnNonZeroExit ?? true,
  };
}

export function parseModelReviewConfig(config: Record<string, unknown>): { rubric?: string; passThreshold: number; subjectPath?: string } {
  const result: { rubric?: string; passThreshold: number; subjectPath?: string } = { passThreshold: DEFAULT_MODEL_REVIEW_PASS_THRESHOLD };
  if (config.rubric !== undefined) {
    if (typeof config.rubric !== "string" || !config.rubric.trim() || config.rubric.trim().length > 4000) {
      throw new MemoryToolError("Obligation model_review validator rubric must be a non-empty bounded string.");
    }
    result.rubric = config.rubric.trim();
  }
  if (config.passThreshold !== undefined) {
    if (typeof config.passThreshold !== "number" || !Number.isFinite(config.passThreshold) || config.passThreshold < 0 || config.passThreshold > 1) {
      throw new MemoryToolError("Obligation model_review validator passThreshold must be a number in [0, 1].");
    }
    result.passThreshold = config.passThreshold;
  }
  const subjectPath = parseConfigSubjectPath(config);
  if (subjectPath !== undefined) {
    result.subjectPath = subjectPath;
  }
  return result;
}

function parseToolAssertion(entry: unknown, index: number): ObligationToolAssertion {
  if (!isRecord(entry)) {
    throw new MemoryToolError(`Obligation tool_assertion assertions[${index}] must be an object.`);
  }
  if (typeof entry.path !== "string" || entry.path.trim().length > 500) {
    throw new MemoryToolError(`Obligation tool_assertion assertions[${index}].path must be a bounded string.`);
  }
  if (typeof entry.op !== "string" || !(OBLIGATION_ASSERTION_OPS as readonly string[]).includes(entry.op)) {
    throw new MemoryToolError(`Obligation tool_assertion assertions[${index}].op is invalid.`);
  }
  const assertion: ObligationToolAssertion = { path: entry.path.trim(), op: entry.op as ObligationAssertionOp };
  if ("value" in entry) {
    assertion.value = entry.value;
  }
  return assertion;
}

function parseConfigRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new MemoryToolError(`Obligation ${field} must be an object.`);
  }
  return value;
}

function parseConfigSubjectPath(config: Record<string, unknown>): string | undefined {
  if (config.subjectPath === undefined) {
    return undefined;
  }
  if (typeof config.subjectPath !== "string" || !config.subjectPath.trim() || config.subjectPath.trim().length > 500) {
    throw new MemoryToolError("Obligation validator config.subjectPath must be a non-empty bounded string.");
  }
  return config.subjectPath.trim();
}
