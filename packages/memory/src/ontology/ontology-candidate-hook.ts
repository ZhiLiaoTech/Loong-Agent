import type { LoongLifecycleHook, LoongLifecycleHookRequest } from "@loong/core";
import { isMemoryIdentity } from "../memory-store-v2.js";
import { summarizeText } from "../memory-text.js";
import { clampPositiveInteger } from "../memory-util.js";
import { createOntologyResolver, type OntologyResolver } from "./ontology-resolver.js";
import type { OntologyStore } from "./ontology-store.js";
import type {
  AssertionSourceType,
  OntologyCandidateDraft,
  OntologyCandidateExtractor,
} from "./ontology-types.js";
import type { OntologyEntityType, OntologyPredicate } from "./ontology-vocabulary.js";

/**
 * Phase 2 FR-04: ontology candidate extraction lifecycle hook.
 *
 * On a successful turn end with a trustworthy identity, the configured
 * extractor produces structured candidates (entity mentions, predicate,
 * object, source type, evidence excerpt + session/run refs). Each candidate
 * is stored through the resolver as a `candidate` assertion plus raw Evidence
 * rows — never directly as `active` (§4.3 普通推断不得静默进入 active 状态).
 *
 * Extraction is pluggable; the default is a deterministic heuristic extractor
 * over the user message text. Sensitive facts are NOT extracted by default
 * (§10 敏感事实默认不提取). Without a trustworthy identity the hook skips
 * silently (§4.1: session memory may continue, user-level ontology may not).
 */

export const ONTOLOGY_SELF_ENTITY_NAME = "self";
export const DEFAULT_ONTOLOGY_CANDIDATES_PER_TURN = 8;
export const ABSOLUTE_ONTOLOGY_CANDIDATES_PER_TURN = 50;

export interface OntologyCandidateHookOptions {
  store: OntologyStore;
  /** Pluggable extractor; defaults to `createHeuristicOntologyExtractor()`. */
  extractor?: OntologyCandidateExtractor;
  /** §10: sensitive facts are not extracted unless explicitly enabled. */
  includeSensitiveCandidates?: boolean;
  maxCandidatesPerTurn?: number;
  /** Injected resolver (mainly for tests); defaults to one over `store`. */
  resolver?: OntologyResolver;
}

export function createOntologyCandidateLifecycleHook(options: OntologyCandidateHookOptions): LoongLifecycleHook {
  const extractor = options.extractor ?? createHeuristicOntologyExtractor();
  const includeSensitive = options.includeSensitiveCandidates === true;
  const maxCandidates = clampPositiveInteger(
    options.maxCandidatesPerTurn,
    DEFAULT_ONTOLOGY_CANDIDATES_PER_TURN,
    ABSOLUTE_ONTOLOGY_CANDIDATES_PER_TURN,
  );
  const resolver = options.resolver ?? createOntologyResolver({ store: options.store });

  return {
    name: "ontology_candidate_capture",
    async onLifecycle(request) {
      if (request.phase !== "end" || request.status !== "ok") {
        return;
      }
      // §4.1 身份先于本体: without a trustworthy identity there is no user-level
      // ontology write — skip silently instead of falling back to shared data.
      if (!isMemoryIdentity(request.identity)) {
        return;
      }
      const identity = request.identity;
      const drafts = extractor(request)
        .filter(draft => includeSensitive || draft.sensitivity !== "sensitive")
        .slice(0, maxCandidates);
      if (drafts.length === 0) {
        return;
      }

      let stored = 0;
      for (const draft of drafts) {
        const result = await resolver.ingestCandidate(identity, draft, {
          sessionId: request.sessionId,
          runId: request.runId,
          operator: "ontology_candidate_capture",
          source: "ontology_candidate_capture",
        });
        if (result.kind === "stored") {
          stored += 1;
        }
      }

      // §4.2: keep the raw interaction record for later drill-down. Episodes
      // are only written when the turn actually produced candidates.
      if (stored > 0) {
        await options.store.insertEpisode(identity, {
          sessionId: request.sessionId,
          runId: request.runId,
          ...(request.userMessage !== undefined
            ? { summary: summarizeText(request.userMessage.replace(/\s+/g, " ").trim(), 200) }
            : {}),
          ...(request.completedAt !== undefined ? { capturedAt: request.completedAt } : {}),
        }, { operator: "ontology_candidate_capture", source: "ontology_candidate_capture" });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Default deterministic heuristic extractor
// ---------------------------------------------------------------------------

interface HeuristicRule {
  predicate: OntologyPredicate;
  sourceType: AssertionSourceType;
  /** When set, the object is an entity of this type; otherwise a literal value. */
  objectType?: OntologyEntityType;
  pattern: RegExp;
  /** Optional post-match acceptance filter on the captured object text. */
  accept?: (objectText: string) => boolean;
}

const ROLE_KEYWORDS = /工程师|开发者|程序员|设计师|经理|产品经理|测试|运维|架构师|学生|顾问|engineer|developer|designer|manager|programmer|student|consultant|architect|admin/i;

/** §10: facts touching these tokens are never extracted by the default extractor. */
const SENSITIVE_DENYLIST = /身份证|护照|密码|口令|银行卡|信用卡|社保卡|医保|手机号|电话号码|住址|\bpasswd\b|\bpassword\b|\bssn\b|social security|credit card/i;

const REMEMBER_PREFIX = /^\s*(?:please\s+)?(?:remember(?:\s+that)?|note\s+that|keep\s+in\s+mind(?:\s+that)?|save\s+this)\s*[:：-]?\s*/i;
const REMEMBER_PREFIX_ZH = /^\s*(?:请)?(?:帮我)?记住\s*[:：-]?\s*|^\s*记下来\s*[:：-]?\s*/u;

const HEURISTIC_RULES: HeuristicRule[] = [
  // --- explicit first-person statements (中文) ---
  { predicate: "prefers", sourceType: "explicit", pattern: /我(?:更|最)?喜欢(?:用|使用)?([^。！？!?\n，,；;]{1,80})/ },
  { predicate: "prefers", sourceType: "explicit", pattern: /我(?:更)?偏好([^。！？!?\n，,；;]{1,80})/ },
  { predicate: "prefers", sourceType: "explicit", pattern: /我爱用?([^。！？!?\n，,；;]{1,80})/ },
  { predicate: "avoids", sourceType: "explicit", pattern: /我讨厌([^。！？!?\n，,；;]{1,80})/ },
  { predicate: "avoids", sourceType: "explicit", pattern: /我不喜欢([^。！？!?\n，,；;]{1,80})/ },
  { predicate: "avoids", sourceType: "explicit", pattern: /我避免(?:用|使用)?([^。！？!?\n，,；;]{1,80})/ },
  { predicate: "usesTool", sourceType: "explicit", objectType: "Tool", pattern: /我(?:一般|通常|现在|目前)?(?:用|使用)([^。！？!?\n，,；;]{1,40})/ },
  { predicate: "worksOn", sourceType: "explicit", objectType: "Project", pattern: /我在(?:做|开发|负责)([^。！？!?\n，,；;]{1,60})/ },
  { predicate: "hasRole", sourceType: "explicit", objectType: "Role", pattern: /我是(?:一名|一个|一位)?([^。！？!?\n，,；;]{1,30})/, accept: text => ROLE_KEYWORDS.test(text) },
  { predicate: "madeDecision", sourceType: "explicit", objectType: "Decision", pattern: /我决定([^。！？!?\n，,；;]{1,80})/ },
  { predicate: "hasGoal", sourceType: "explicit", objectType: "Goal", pattern: /我的目标是([^。！？!?\n，,；;]{1,80})/ },
  { predicate: "hasGoal", sourceType: "explicit", objectType: "Goal", pattern: /我想(?:要)?(?:实现|达成)([^。！？!?\n，,；;]{1,80})/ },
  // --- hedged statements are model inference, never auto-active (§4.3) ---
  { predicate: "prefers", sourceType: "inferred", pattern: /我可能(?:更)?喜欢([^。！？!?\n，,；;]{1,80})/ },
  { predicate: "prefers", sourceType: "inferred", pattern: /我觉得(?:自己)?(?:可能)?(?:更)?喜欢([^。！？!?\n，,；;]{1,80})/ },
  // --- explicit first-person statements (English) ---
  { predicate: "prefers", sourceType: "explicit", pattern: /\bI prefer ([^.,!?\n;]{1,80})/i },
  { predicate: "prefers", sourceType: "explicit", pattern: /\bI (?:really )?like ([^.,!?\n;]{1,80})/i },
  { predicate: "avoids", sourceType: "explicit", pattern: /\bI hate ([^.,!?\n;]{1,80})/i },
  { predicate: "avoids", sourceType: "explicit", pattern: /\bI avoid ([^.,!?\n;]{1,80})/i },
  { predicate: "avoids", sourceType: "explicit", pattern: /\bI don't like ([^.,!?\n;]{1,80})/i },
  { predicate: "usesTool", sourceType: "explicit", objectType: "Tool", pattern: /\bI(?:'m| am)? (?:currently |usually )?us(?:e|ing) ([^.,!?\n;]{1,60})/i },
  { predicate: "worksOn", sourceType: "explicit", objectType: "Project", pattern: /\bI(?:'m| am) working on ([^.,!?\n;]{1,60})/i },
  { predicate: "hasRole", sourceType: "explicit", objectType: "Role", pattern: /\bI(?:'m| am) (?:a|an) ([^.,!?\n;]{1,40})/i, accept: text => ROLE_KEYWORDS.test(text) },
  { predicate: "madeDecision", sourceType: "explicit", objectType: "Decision", pattern: /\bI(?:'ve| have) decided (?:to )?([^.,!?\n;]{1,80})/i },
  { predicate: "hasGoal", sourceType: "explicit", objectType: "Goal", pattern: /\bmy goal is (?:to )?([^.,!?\n;]{1,80})/i },
  { predicate: "prefers", sourceType: "inferred", pattern: /\bI think I (?:might |may )?prefer ([^.,!?\n;]{1,80})/i },
];

/**
 * Deterministic default extractor (FR-04): simple first-person statement
 * rules over the user message text ("我喜欢/我用/我决定…", remember-requests).
 * Remember-prefixes are stripped first so "记住我喜欢深色主题" still extracts
 * the structured fact. It never emits `sensitive` candidates and skips facts
 * touching the sensitive denylist (§10 敏感事实默认不提取).
 */
export function createHeuristicOntologyExtractor(): OntologyCandidateExtractor {
  return turn => {
    const rawMessage = turn.userMessage;
    if (typeof rawMessage !== "string" || !rawMessage.trim()) {
      return [];
    }
    const message = rawMessage
      .replace(REMEMBER_PREFIX, "")
      .replace(REMEMBER_PREFIX_ZH, "")
      .trim();
    const drafts: OntologyCandidateDraft[] = [];
    const seen = new Set<string>();
    for (const rule of HEURISTIC_RULES) {
      const match = rule.pattern.exec(message);
      const objectText = match?.[1]?.trim();
      if (match === null || objectText === undefined || objectText.length === 0) {
        continue;
      }
      const normalizedObject = normalizeObjectText(objectText);
      if (normalizedObject.length === 0 || normalizedObject.length > 80) {
        continue;
      }
      if (rule.accept !== undefined && !rule.accept(normalizedObject)) {
        continue;
      }
      // §10: sensitive facts default to NOT extracted.
      if (SENSITIVE_DENYLIST.test(normalizedObject) || SENSITIVE_DENYLIST.test(match[0])) {
        continue;
      }
      const dedupeKey = `${rule.predicate}|${rule.objectType ?? "value"}|${normalizedObject.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      const draft: OntologyCandidateDraft = {
        subject: { type: "Person", name: ONTOLOGY_SELF_ENTITY_NAME, aliases: ["我", "user", "me"] },
        predicate: rule.predicate,
        ...(rule.objectType !== undefined
          ? { objectEntity: { type: rule.objectType, name: normalizedObject } }
          : { objectValue: normalizedObject }),
        sourceType: rule.sourceType,
        excerpt: summarizeText(match[0].trim(), 500),
        reason: `Heuristic extraction matched "${rule.predicate}" pattern on the user message.`,
      };
      drafts.push(draft);
    }
    return drafts;
  };
}

/**
 * Trim trailing context words from a captured object: "Cursor 写代码" →
 * "Cursor", "VS Code for work" → "VS Code". Deterministic by construction.
 */
function normalizeObjectText(value: string): string {
  return value
    .replace(/\s+[\u4e00-\u9fff].*$/, "")
    .replace(/\s+(?:for|to|when|because|at|in)\b.*$/i, "")
    .replace(/[，,；;。！？!?].*$/, "")
    .trim();
}
