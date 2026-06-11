import type { LoongThinkingLevel, LoongTurnInput } from "./types.js";

export type LoongTierName = "fast" | "standard" | "deep";

/** Per-tier override. All fields optional; runtime only applies what's set. */
export interface ModelTierSpec {
  /** model ref the tier routes to (e.g. "openai:deepseek-chat") */
  model?: string;
  /** model fallback chain specific to this tier */
  modelFallbacks?: string[];
  /** override input.thinking for this tier */
  thinking?: LoongThinkingLevel;
  /** override runtime maxContextChars (hard cap on injected context) */
  maxContextChars?: number;
  /** override input.toolsEnabled */
  toolsEnabled?: boolean;
  /**
   * When set, only these tool names are exposed to the model on this tier
   * (others stay registered/executable but are not advertised in the request).
   * Lets a tier ship a slim tool surface — e.g. fast → core file/search only —
   * trimming ~1-2K tokens of tool schemas per call. Empty array = no tools.
   */
  toolAllowlist?: readonly string[];
  /** When set, these tool names are hidden from the model on this tier. Applied
   * after toolAllowlist. */
  toolDenylist?: readonly string[];
  /** override input.memoryEnabled (skips memory_recall context provider) */
  memoryEnabled?: boolean;
  /** appended to runtime system prompt as a tier-specific addendum */
  systemPromptAddendum?: string;
}

export type LoongTierClassifierMode = "heuristic" | "fixed";

export interface LoongTierKeywordHint {
  tier: LoongTierName;
  /** matched case-insensitively as substrings against the user message */
  words: readonly string[];
}

export interface ModelTierConfig {
  /** When false, tier resolution is skipped entirely (legacy behavior). */
  enabled: boolean;
  tiers: {
    fast?: ModelTierSpec;
    standard?: ModelTierSpec;
    deep?: ModelTierSpec;
  };
  classifier: {
    mode: LoongTierClassifierMode;
    /** Used when mode === "fixed". */
    fixedTier?: LoongTierName;
    /** User-supplied keyword nudges (additive to built-in keyword list). */
    keywordHints?: readonly LoongTierKeywordHint[];
  };
}

export interface ClassifierSignals {
  hasSkillLoaded?: boolean;
  memoryRecallCount?: number;
  delegationDepth?: number;
  /** When the caller already classified an outer turn, pass it so subtasks
   * inherit the parent tier instead of being reclassified per child. */
  inheritedTier?: LoongTierName;
}

export interface TierDecision {
  tier: LoongTierName;
  reason: string;
  score: number;
  source: "fixed" | "inherited" | "explicit-input" | "heuristic";
}

const FAST_KEYWORDS_DEFAULT = [
  // English
  "translate", "summarize", "one line", "tldr", "format ", "list ", "json only", "yes or no",
  // Chinese
  "翻译", "总结一句", "一句话", "格式化", "列出", "罗列", "是或否",
];

const DEEP_KEYWORDS_DEFAULT = [
  // English
  "analyze deeply", "step by step", "step-by-step", "think carefully", "think hard",
  "design a", "architect", "plan the", "deep dive", "compare and contrast",
  "review the entire",
  // Chinese
  "深入分析", "深度分析", "逐步", "一步步", "仔细思考", "全面分析", "深度思考",
  "架构", "规划", "深入研究", "对比分析", "复杂", "整体设计",
];

/** Hard caps so a future malformed config can't make tiers larger than the
 * runtime's absolute envelope. Mirrors LoongRuntime defaults. */
const ABSOLUTE_MAX_CONTEXT_CHARS = 200_000;

/**
 * Pure heuristic — no LLM call. Looks at message length, attachments, loaded
 * skills, memory hits, delegation depth, and keyword hints. Returns a tier and
 * a human-readable reason string suitable for surfacing in lifecycle metadata.
 */
export function classifyTierHeuristic(
  input: LoongTurnInput,
  signals: ClassifierSignals,
  hints: readonly LoongTierKeywordHint[] = [],
): TierDecision {
  if (signals.inheritedTier !== undefined) {
    return {
      tier: signals.inheritedTier,
      source: "inherited",
      score: 0,
      reason: `inherited from parent delegation (depth=${signals.delegationDepth ?? "?"})`,
    };
  }

  let score = 0;
  const reasons: string[] = [];

  const message = input.message ?? "";
  const len = message.length;
  if (len > 2000) {
    score += 2;
    reasons.push(`msgLen=${len}>2000 (+2)`);
  } else if (len > 500) {
    score += 1;
    reasons.push(`msgLen=${len}>500 (+1)`);
  }

  const attachments = input.attachments ?? [];
  if (attachments.length > 2) {
    score += 2;
    reasons.push(`attach=${attachments.length}>2 (+2)`);
  } else if (attachments.length > 0) {
    score += 1;
    reasons.push(`attach=${attachments.length} (+1)`);
  }
  const heavyDoc = attachments.find(att => att.kind === "document"
    && (att.mimeType === "application/pdf"
      || att.mimeType.includes("presentationml")
      || att.mimeType.includes("spreadsheetml")));
  if (heavyDoc !== undefined) {
    score += 1;
    reasons.push(`heavyDoc=${heavyDoc.mimeType} (+1)`);
  }

  if (signals.hasSkillLoaded === true) {
    score += 2;
    reasons.push("skillLoaded (+2)");
  }
  if (signals.memoryRecallCount !== undefined && signals.memoryRecallCount > 3) {
    score += 1;
    reasons.push(`memoryRecall=${signals.memoryRecallCount}>3 (+1)`);
  }
  if (input.toolsEnabled !== false && input.workspace !== undefined) {
    score += 1;
    reasons.push("agentMode (+1)");
  }

  const lower = message.toLowerCase();
  const fastHits: string[] = [];
  const deepHits: string[] = [];
  for (const word of FAST_KEYWORDS_DEFAULT) {
    if (lower.includes(word.toLowerCase())) fastHits.push(word);
  }
  for (const word of DEEP_KEYWORDS_DEFAULT) {
    if (lower.includes(word.toLowerCase())) deepHits.push(word);
  }
  for (const hint of hints) {
    for (const word of hint.words) {
      if (lower.includes(word.toLowerCase())) {
        if (hint.tier === "fast") fastHits.push(`*${word}`);
        else if (hint.tier === "deep") deepHits.push(`*${word}`);
        // standard hints currently no-op the score (it's the default bucket)
      }
    }
  }
  if (deepHits.length > 0) {
    score += 3;
    reasons.push(`deepKeyword=${JSON.stringify(deepHits.slice(0, 3))} (+3)`);
  }
  if (fastHits.length > 0) {
    score -= 2;
    reasons.push(`fastKeyword=${JSON.stringify(fastHits.slice(0, 3))} (-2)`);
  }

  let tier: LoongTierName;
  if (score >= 5) tier = "deep";
  else if (score >= 2) tier = "standard";
  else tier = "fast";

  return {
    tier,
    source: "heuristic",
    score,
    reason: reasons.length > 0 ? reasons.join("; ") : "no signals (score=0)",
  };
}

export function decideTier(
  config: ModelTierConfig | undefined,
  input: LoongTurnInput,
  signals: ClassifierSignals,
): TierDecision | undefined {
  if (!config?.enabled) {
    return undefined;
  }
  // Explicit tier on input always wins (CLI --tier / RPC params.tier)
  const explicit = (input as { tier?: LoongTierName }).tier;
  if (explicit === "fast" || explicit === "standard" || explicit === "deep") {
    return { tier: explicit, source: "explicit-input", score: 0, reason: `explicit tier=${explicit}` };
  }
  if (config.classifier.mode === "fixed" && config.classifier.fixedTier !== undefined) {
    return {
      tier: config.classifier.fixedTier,
      source: "fixed",
      score: 0,
      reason: `classifier.mode=fixed → ${config.classifier.fixedTier}`,
    };
  }
  return classifyTierHeuristic(input, signals, config.classifier.keywordHints ?? []);
}

/**
 * Builds a derived input that applies tier overrides. The caller's explicit
 * model (when set) always wins; the tier only fills the gap. Other tier
 * overrides (thinking, toolsEnabled, memoryEnabled) win unless the caller
 * already set them explicitly.
 */
export function applyTierToInput(
  input: LoongTurnInput,
  decision: TierDecision,
  spec: ModelTierSpec | undefined,
): { input: LoongTurnInput; maxContextChars?: number; appliedSystemPromptAddendum?: string } {
  if (!spec) {
    return { input };
  }
  const next: LoongTurnInput = { ...input };
  // Model: only fill if caller did not specify
  if (next.model === undefined && spec.model !== undefined) {
    next.model = spec.model;
  }
  if (next.modelFallbacks === undefined && spec.modelFallbacks !== undefined && spec.modelFallbacks.length > 0) {
    next.modelFallbacks = [...spec.modelFallbacks];
  }
  if (next.thinking === undefined && spec.thinking !== undefined) {
    next.thinking = spec.thinking;
  }
  if (next.toolsEnabled === undefined && spec.toolsEnabled !== undefined) {
    next.toolsEnabled = spec.toolsEnabled;
  }
  if (next.memoryEnabled === undefined && spec.memoryEnabled !== undefined) {
    next.memoryEnabled = spec.memoryEnabled;
  }
  let appliedSystemPromptAddendum: string | undefined;
  if (spec.systemPromptAddendum !== undefined && spec.systemPromptAddendum.trim().length > 0) {
    const existing = next.systemPrompt?.trim();
    next.systemPrompt = existing
      ? `${existing}\n\n${spec.systemPromptAddendum.trim()}`
      : spec.systemPromptAddendum.trim();
    appliedSystemPromptAddendum = spec.systemPromptAddendum.trim();
  }
  const maxContextChars = typeof spec.maxContextChars === "number" && spec.maxContextChars > 0
    ? Math.min(spec.maxContextChars, ABSOLUTE_MAX_CONTEXT_CHARS)
    : undefined;
  const result: { input: LoongTurnInput; maxContextChars?: number; appliedSystemPromptAddendum?: string } = { input: next };
  if (maxContextChars !== undefined) result.maxContextChars = maxContextChars;
  if (appliedSystemPromptAddendum !== undefined) result.appliedSystemPromptAddendum = appliedSystemPromptAddendum;
  return result;
}

/**
 * Shipped product default — adaptive routing is ON out of the box so the
 * heuristic classifier (no LLM cost) trims context + thinking on trivial turns
 * without any operator configuration. The default specs are deliberately
 * **capability-preserving**: the fast tier only lowers thinking and the injected
 * context budget; it does NOT disable tools or memory, so a short agent
 * instruction (which classifies "fast") can still use the full tool set. An
 * operator who wants aggressive fast-tier gating can add
 * `toolsEnabled:false` / `memoryEnabled:false` to fast in their own tiers.json.
 */
export const TIER_DEFAULTS: ModelTierConfig = {
  enabled: true,
  tiers: {
    fast: {
      thinking: "none",
      maxContextChars: 6000,
    },
    standard: {
      thinking: "low",
      maxContextChars: 24000,
    },
    deep: {
      thinking: "high",
      maxContextChars: 64000,
    },
  },
  classifier: {
    mode: "heuristic",
  },
};

export function normalizeTierConfig(raw: unknown): ModelTierConfig {
  const out: ModelTierConfig = {
    enabled: false,
    tiers: {},
    classifier: { mode: "heuristic" },
  };
  if (!raw || typeof raw !== "object") return out;
  const value = raw as Record<string, unknown>;
  if (typeof value.enabled === "boolean") out.enabled = value.enabled;
  if (value.tiers && typeof value.tiers === "object") {
    const tiers = value.tiers as Record<string, unknown>;
    for (const name of ["fast", "standard", "deep"] as const) {
      const spec = normalizeTierSpec(tiers[name]);
      if (spec !== undefined) out.tiers[name] = spec;
    }
  }
  if (value.classifier && typeof value.classifier === "object") {
    const cls = value.classifier as Record<string, unknown>;
    if (cls.mode === "heuristic" || cls.mode === "fixed") {
      out.classifier.mode = cls.mode;
    }
    if (cls.fixedTier === "fast" || cls.fixedTier === "standard" || cls.fixedTier === "deep") {
      out.classifier.fixedTier = cls.fixedTier;
    }
    if (Array.isArray(cls.keywordHints)) {
      const hints: LoongTierKeywordHint[] = [];
      for (const item of cls.keywordHints) {
        if (!item || typeof item !== "object") continue;
        const ih = item as Record<string, unknown>;
        if ((ih.tier !== "fast" && ih.tier !== "standard" && ih.tier !== "deep") || !Array.isArray(ih.words)) continue;
        const words = ih.words.filter((w): w is string => typeof w === "string" && w.trim().length > 0);
        if (words.length === 0) continue;
        hints.push({ tier: ih.tier, words });
      }
      if (hints.length > 0) out.classifier.keywordHints = hints;
    }
  }
  return out;
}

function normalizeTierSpec(raw: unknown): ModelTierSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const spec: ModelTierSpec = {};
  if (typeof value.model === "string" && value.model.trim()) spec.model = value.model.trim();
  if (Array.isArray(value.modelFallbacks)) {
    const fb = value.modelFallbacks.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
    if (fb.length > 0) spec.modelFallbacks = fb;
  }
  if (value.thinking === "none" || value.thinking === "low" || value.thinking === "medium" || value.thinking === "high") {
    spec.thinking = value.thinking;
  }
  if (typeof value.maxContextChars === "number" && value.maxContextChars > 0) {
    spec.maxContextChars = Math.floor(value.maxContextChars);
  }
  if (typeof value.toolsEnabled === "boolean") spec.toolsEnabled = value.toolsEnabled;
  if (Array.isArray(value.toolAllowlist)) {
    spec.toolAllowlist = value.toolAllowlist.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map(t => t.trim());
  }
  if (Array.isArray(value.toolDenylist)) {
    const deny = value.toolDenylist.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map(t => t.trim());
    if (deny.length > 0) spec.toolDenylist = deny;
  }
  if (typeof value.memoryEnabled === "boolean") spec.memoryEnabled = value.memoryEnabled;
  if (typeof value.systemPromptAddendum === "string" && value.systemPromptAddendum.trim()) {
    spec.systemPromptAddendum = value.systemPromptAddendum.trim();
  }
  return Object.keys(spec).length > 0 ? spec : undefined;
}
