import type { MemoryIdentity } from "@loong/core";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema } from "@loong/tools";
import { isMemoryIdentity } from "../memory-store-v2.js";
import { MemoryToolError } from "../memory-tool-error.js";
import { safelyInvokeMemoryTool } from "../memory-tool-invoke.js";
import { clampPositiveInteger } from "../memory-util.js";
import {
  createOntologyResolver,
  ontologyAssertionFactKey,
  type OntologyPromoteResult,
  type OntologyResolver,
} from "./ontology-resolver.js";
import type { OntologyStore } from "./ontology-store.js";
import type {
  OntologyAssertion,
  OntologyAssertionStatus,
  OntologyEntity,
} from "./ontology-types.js";
import { isOntologyAssertionStatus } from "./ontology-types.js";

/**
 * Phase 2 FR-05: review tooling over structured ontology candidates, modeled
 * on `memory-candidate-tools.ts`. Promote goes through the resolver (FR-06
 * dedup + FR-07 conflict handling), reject records a reason, and "don't ask
 * again" stores a review marker that suppresses future identical candidates.
 *
 * Permission posture mirrors the existing candidate flow: listing is
 * `allow`, promote/reject are `ask` (用户明确提出"记住"时仍需遵循现有权限策略).
 * Identity is mandatory on every invocation; by default it is read from
 * `invocation.metadata.identity` (hosts such as the gateway thread the turn
 * identity into tool metadata) and can be overridden via `resolveIdentity`.
 */

export interface OntologyCandidateToolsOptions {
  store: OntologyStore;
  resolver?: OntologyResolver;
  /** Defaults to reading a validated identity from `invocation.metadata.identity`. */
  resolveIdentity?: (invocation: ToolInvocation) => MemoryIdentity | undefined;
  /** Audit operator recorded for review writes. */
  operator?: string;
}

export interface OntologyCandidateListInput {
  status?: OntologyAssertionStatus | "all";
  limit?: number;
}

export interface OntologyReviewedAssertion {
  assertion: OntologyAssertion;
  subject: OntologyEntity | undefined;
  objectEntity: OntologyEntity | undefined;
}

export interface OntologyCandidateListOutput {
  candidates: OntologyReviewedAssertion[];
  truncated: boolean;
}

export interface OntologyCandidatePromoteInput {
  id: string;
}

export type OntologyCandidatePromoteOutput = OntologyPromoteResult;

export interface OntologyCandidateRejectInput {
  id: string;
  reason?: string;
  dontAskAgain?: boolean;
}

export interface OntologyCandidateRejectOutput {
  assertion: OntologyAssertion;
  dontAskAgain: boolean;
}

const DEFAULT_ONTOLOGY_CANDIDATE_LIST_LIMIT = 20;
const ABSOLUTE_ONTOLOGY_CANDIDATE_LIST_LIMIT = 100;

const ontologyCandidateListSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["candidate", "active", "disputed", "superseded", "retracted", "all"],
    },
    limit: { type: "number" },
  },
  additionalProperties: false,
};

const ontologyCandidatePromoteSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
  },
  required: ["id"],
  additionalProperties: false,
};

const ontologyCandidateRejectSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    reason: { type: "string" },
    dontAskAgain: { type: "boolean" },
  },
  required: ["id"],
  additionalProperties: false,
};

export function createOntologyCandidateTools(options: OntologyCandidateToolsOptions): ToolDefinition[] {
  return [
    createOntologyCandidateListTool(options),
    createOntologyCandidatePromoteTool(options),
    createOntologyCandidateRejectTool(options),
  ];
}

export function createOntologyCandidateListTool(
  options: OntologyCandidateToolsOptions,
): ToolDefinition<OntologyCandidateListInput, OntologyCandidateListOutput> {
  return {
    name: "ontology_candidates_list",
    description: "List structured ontology memory candidates (and other assertions) for review without promoting them.",
    inputSchema: ontologyCandidateListSchema,
    capabilities: ["read", "memory"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const identity = requireToolIdentity(options, invocation);
        const input = parseListInput(invocation.input);
        const status = input.status ?? "candidate";
        const limit = clampPositiveInteger(input.limit, DEFAULT_ONTOLOGY_CANDIDATE_LIST_LIMIT, ABSOLUTE_ONTOLOGY_CANDIDATE_LIST_LIMIT);
        const assertions = await options.store.findAssertions(identity, {
          ...(status === "all" ? {} : { status }),
          limit: limit + 1,
        });
        const page = assertions.slice(0, limit);
        const candidates: OntologyReviewedAssertion[] = [];
        for (const assertion of page) {
          candidates.push({
            assertion,
            subject: await options.store.getEntity(identity, assertion.subjectId),
            objectEntity: assertion.objectEntityId !== undefined
              ? await options.store.getEntity(identity, assertion.objectEntityId)
              : undefined,
          });
        }
        return { candidates, truncated: assertions.length > limit };
      });
    },
  };
}

export function createOntologyCandidatePromoteTool(
  options: OntologyCandidateToolsOptions,
): ToolDefinition<OntologyCandidatePromoteInput, OntologyCandidatePromoteOutput> {
  return {
    name: "ontology_candidate_promote",
    description: "Promote one ontology candidate to an active assertion after user review (dedup/conflict handling applies).",
    inputSchema: ontologyCandidatePromoteSchema,
    capabilities: ["write", "memory"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const identity = requireToolIdentity(options, invocation);
        const input = parseIdInput(invocation.input, "ontology_candidate_promote");
        const resolver = options.resolver ?? createOntologyResolver({ store: options.store });
        return await resolver.promoteAssertion(identity, input.id, {
          operator: options.operator ?? "ontology_candidate_promote",
          source: "ontology_candidate_promote",
          detail: { transition: "candidate->active" },
        });
      });
    },
  };
}

export function createOntologyCandidateRejectTool(
  options: OntologyCandidateToolsOptions,
): ToolDefinition<OntologyCandidateRejectInput, OntologyCandidateRejectOutput> {
  return {
    name: "ontology_candidate_reject",
    description: "Reject one ontology candidate with a reason; optionally suppress similar future candidates.",
    inputSchema: ontologyCandidateRejectSchema,
    capabilities: ["write", "memory"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const identity = requireToolIdentity(options, invocation);
        const input = parseRejectInput(invocation.input);
        const assertion = await options.store.getAssertion(identity, input.id);
        if (assertion === undefined) {
          throw new MemoryToolError(`Ontology candidate not found: ${input.id}`);
        }
        if (assertion.status !== "candidate" && assertion.status !== "disputed") {
          throw new MemoryToolError(`Ontology assertion is already ${assertion.status}; only candidate or disputed assertions can be rejected.`);
        }
        const rejected = await options.store.updateAssertion(identity, assertion.id, { status: "retracted" }, {
          operator: options.operator ?? "ontology_candidate_reject",
          source: "ontology_candidate_reject",
          detail: {
            transition: `${assertion.status}->retracted`,
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
          },
        });
        let dontAskAgain = false;
        if (input.dontAskAgain === true) {
          await options.store.putCandidateReview(identity, {
            key: await ontologyAssertionFactKey(options.store, identity, assertion),
            decision: "dont_ask",
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
          }, {
            operator: options.operator ?? "ontology_candidate_reject",
            source: "ontology_candidate_reject",
          });
          dontAskAgain = true;
        }
        return { assertion: rejected, dontAskAgain };
      });
    },
  };
}

function requireToolIdentity(
  options: OntologyCandidateToolsOptions,
  invocation: ToolInvocation,
): MemoryIdentity {
  const identity = options.resolveIdentity !== undefined
    ? options.resolveIdentity(invocation)
    : defaultResolveIdentity(invocation);
  if (!isMemoryIdentity(identity)) {
    throw new MemoryToolError(
      "Ontology review tools require a trustworthy identity (tenantId and userId); refusing to touch user ontology data without one.",
    );
  }
  return identity;
}

function defaultResolveIdentity(invocation: ToolInvocation): MemoryIdentity | undefined {
  const candidate = invocation.metadata?.identity;
  return isMemoryIdentity(candidate) ? candidate : undefined;
}

function parseListInput(input: unknown): OntologyCandidateListInput {
  if (input === undefined || input === null) {
    return { status: "candidate" };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new MemoryToolError("ontology_candidates_list input must be an object.");
  }
  const value = input as Record<string, unknown>;
  const parsed: OntologyCandidateListInput = { status: "candidate" };
  if (value.status !== undefined) {
    if (value.status !== "all" && !isOntologyAssertionStatus(value.status)) {
      throw new MemoryToolError("ontology_candidates_list status is invalid.");
    }
    parsed.status = value.status;
  }
  if (typeof value.limit === "number") {
    parsed.limit = Math.max(1, Math.floor(value.limit));
  }
  return parsed;
}

function parseIdInput(input: unknown, tool: string): { id: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MemoryToolError(`${tool} input must be an object.`);
  }
  const id = (input as Record<string, unknown>).id;
  if (typeof id !== "string" || !id.trim()) {
    throw new MemoryToolError(`${tool} requires a candidate id.`);
  }
  return { id: id.trim() };
}

function parseRejectInput(input: unknown): OntologyCandidateRejectInput {
  const parsed = parseIdInput(input, "ontology_candidate_reject");
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MemoryToolError("ontology_candidate_reject input must be an object.");
  }
  const value = input as Record<string, unknown>;
  const result: OntologyCandidateRejectInput = { id: parsed.id };
  if (value.reason !== undefined) {
    if (typeof value.reason !== "string" || !value.reason.trim()) {
      throw new MemoryToolError("ontology_candidate_reject reason must be a non-empty string when provided.");
    }
    result.reason = value.reason.trim().slice(0, 500);
  }
  if (value.dontAskAgain !== undefined) {
    if (typeof value.dontAskAgain !== "boolean") {
      throw new MemoryToolError("ontology_candidate_reject dontAskAgain must be a boolean when provided.");
    }
    result.dontAskAgain = value.dontAskAgain;
  }
  return result;
}
