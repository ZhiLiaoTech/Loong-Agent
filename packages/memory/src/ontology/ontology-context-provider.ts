import type { LoongContextProvider, LoongContextRequest } from "@loong/core";
import type { MemoryStoreV2 } from "../memory-store-v2.js";
import {
  renderOntologyAssertionLine,
  type OntologyRecallOptions,
  type OntologyRecallResult,
  type OntologyRetriever,
} from "./ontology-retriever.js";

/**
 * Phase 4 (FR-09, FR-11): ontology context provider.
 *
 * Projects the retriever's bounded recall result into the FR-11 injection
 * format:
 *
 * ```text
 * Relevant user knowledge:
 * - 用户通常使用 TypeScript 开发 Loong。
 * - 用户过去使用 VS Code，目前已改用 Cursor。
 * ```
 *
 * Default exclusions (FR-11): raw Evidence text, superseded facts (surfaced
 * only as transition context), low-confidence inference, task-irrelevant
 * profile facts, and sensitive attributes are never injected. Evidence stays
 * reachable through `drillDownHints` metadata and `OntologyRetriever.drillDown`
 * (FR-11 必须返回可供下钻的 Evidence 引用).
 *
 * FR-11 差量上下文: within one session, when the recalled facts are identical
 * to the previous turn, the provider renders a compact single-line summary
 * ("更短的稳定摘要") instead of re-expanding the full bullet list. The compact
 * form still enumerates the facts themselves — only transition lines and
 * per-fact bullets are collapsed — so the model keeps a correct understanding
 * of the references. The cache is per provider instance (LRU-capped), keyed by
 * `tenantId:userId:sessionId`.
 */

export const ONTOLOGY_RECALL_CONTEXT_PROVIDER_NAME = "ontology_recall";
/** Above markdown_memory (20) and memory_recall (10): most compressed/stable first. */
export const DEFAULT_ONTOLOGY_RECALL_CONTEXT_PRIORITY = 25;
export const ONTOLOGY_RECALL_DIFFERENTIAL_CACHE_LIMIT = 100;

export interface OntologyContextProviderOptions {
  retriever: OntologyRetriever;
  /** Optional FTS supplement store forwarded to every recall (FR-09 FTS 补充). */
  ftsStore?: MemoryStoreV2;
  /** Context item priority (default 25). */
  priority?: number;
  /** Recall tuning forwarded to the retriever (budgets, hops, fts limit). */
  recall?: Omit<OntologyRecallOptions, "ftsStore">;
  /** Render transition lines for facts that superseded an older one (default true). */
  renderTransitions?: boolean;
  /** FR-11 differential context within a session (default true). */
  differential?: boolean;
  /** Context item title (default "Relevant user knowledge"). */
  title?: string;
}

interface DifferentialEntry {
  hash: string;
}

export function createOntologyContextProvider(options: OntologyContextProviderOptions): LoongContextProvider {
  const priority = options.priority !== undefined && Number.isFinite(options.priority)
    ? Math.floor(options.priority)
    : DEFAULT_ONTOLOGY_RECALL_CONTEXT_PRIORITY;
  const renderTransitions = options.renderTransitions !== false;
  const differential = options.differential !== false;
  const title = options.title?.trim() ? options.title.trim() : "Relevant user knowledge";
  // Per-instance differential cache with LRU eviction.
  const differentialCache = new Map<string, DifferentialEntry>();

  function rememberHash(key: string, hash: string): void {
    differentialCache.delete(key);
    differentialCache.set(key, { hash });
    while (differentialCache.size > ONTOLOGY_RECALL_DIFFERENTIAL_CACHE_LIMIT) {
      const oldest = differentialCache.keys().next();
      if (oldest.done) {
        break;
      }
      differentialCache.delete(oldest.value);
    }
  }

  return {
    name: ONTOLOGY_RECALL_CONTEXT_PROVIDER_NAME,
    async buildContext(request: LoongContextRequest) {
      const identity = request.identity;
      if (identity === undefined) {
        // §4.1: no trustworthy identity → no user-knowledge recall at all.
        return [];
      }
      const result = await options.retriever.recall(identity, request.input.message, {
        ...(options.recall ?? {}),
        ...(options.ftsStore !== undefined ? { ftsStore: options.ftsStore } : {}),
      });
      const lines = renderFactLines(result, renderTransitions);
      if (lines.length === 0) {
        return [];
      }
      const fullContent = `${title}:\n${lines.join("\n")}`;

      let content = fullContent;
      let mode: "full" | "compact" = "full";
      if (differential) {
        const key = `${identity.tenantId}:${identity.userId}:${request.input.sessionId}`;
        const hash = fnv1a(differentialPayload(result));
        const previous = differentialCache.get(key);
        if (previous !== undefined && previous.hash === hash) {
          // FR-11 差量上下文: unchanged stable facts → compact summary, never a
          // bare reference (the per-turn system prompt is the model's only
          // view of these facts, so the facts themselves must stay visible).
          const facts = flattenFacts(result);
          content = `${title}:\n- （本会话用户知识未变化，压缩重述）${facts.join("；")}。`;
          mode = "compact";
        }
        rememberHash(key, hash);
      }

      return [{
        title,
        content,
        priority,
        metadata: {
          mode,
          matchedEntityCount: result.matchedEntities.length,
          tier1: {
            source: result.tier1.source,
            estimatedTokens: result.tier1.estimatedTokens,
            trimmed: result.tier1.trimmed,
          },
          tier2Count: result.tier2.length,
          tier2DroppedCount: result.tier2DroppedCount,
          tier2EstimatedTokens: result.tier2EstimatedTokens,
          ftsCount: result.ftsSupplement.length,
          totalEstimatedTokens: result.totalEstimatedTokens,
          trimmed: result.trimmed,
          exclusions: result.exclusions,
          drillDownHints: result.drillDownHints,
        },
      }];
    },
  };
}

/** Full FR-11 bullet list: snapshot lines, then tier-2 facts (+ transitions), then FTS lines. */
function renderFactLines(result: OntologyRecallResult, renderTransitions: boolean): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (line: string): void => {
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  };
  const tier1Lines = result.tier1.content.split("\n").filter(line => line.trim().length > 0);
  for (const line of tier1Lines) {
    push(line);
  }
  for (const candidate of result.tier2) {
    // A fact already carried by the tier-1 snapshot is not repeated.
    push(`- ${renderOntologyAssertionLine(candidate.assertion, candidate.subject, candidate.objectEntity)}`);
    if (renderTransitions && candidate.transition !== undefined) {
      push(`- ${candidate.transition.line}`);
    }
  }
  for (const line of result.ftsSupplement) {
    push(line);
  }
  return lines;
}

/** Compact re-statement of every recalled fact for the differential short form. */
function flattenFacts(result: OntologyRecallResult): string[] {
  const facts: string[] = [];
  const seen = new Set<string>();
  const push = (fact: string): void => {
    if (fact.length > 0 && !seen.has(fact)) {
      seen.add(fact);
      facts.push(fact);
    }
  };
  for (const line of result.tier1.content.split("\n")) {
    push(line.trim().replace(/^- /, "").replace(/。$/, ""));
  }
  for (const candidate of result.tier2) {
    push(renderOntologyAssertionLine(candidate.assertion, candidate.subject, candidate.objectEntity).replace(/。$/, ""));
  }
  return facts;
}

/** Stable payload for the differential hash: what the model would see. */
function differentialPayload(result: OntologyRecallResult): string {
  const tier2 = result.tier2
    .map(candidate => `${candidate.assertion.id}@${candidate.assertion.updatedAt}`)
    .join(",");
  return `${result.tier1.content}\n${tier2}\n${result.ftsSupplement.join("\n")}`;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
