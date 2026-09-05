import { CookingVideoError } from "./errors.js";
import type { CookingEvent, CookingVideoJob, EditDecision } from "./types.js";

const FORBIDDEN_CLAIMS = [
  /(?:行业|全球|全国)?(?:第一|领先)/,
  /(?:最高|最低|最佳|唯一|绝对)/,
  /(?:100%|百分之百|零故障|永不)/i,
  /(?:节省|降低|提升|增加)\s*\d+(?:\.\d+)?\s*%/,
  /(?:治愈|治疗|预防疾病|保健功效)/,
];

const EVIDENCE_RULES: Array<{ pattern: RegExp; events: readonly CookingEvent[] }> = [
  { pattern: /(?:一键|自动).*启动|启动.*自动/, events: ["cooking_started", "operator_interaction"] },
  { pattern: /自动投料|按.*投料/, events: ["ingredient_added", "seasoning_added"] },
  { pattern: /自动翻炒|稳定翻炒/, events: ["stir_fry"] },
  { pattern: /成品|出锅|完成/, events: ["dish_completed", "plating", "finished_dish"] },
];

export function hasDirectVisualSupport(text: string, events: readonly CookingEvent[]): boolean {
  return EVIDENCE_RULES.some(rule => rule.pattern.test(text) && events.some(event => rule.events.includes(event)));
}

export function assertPromotionalText(text: string, events: readonly CookingEvent[], maxCharacters = 24): void {
  if ([...text].length > maxCharacters) throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `Promotional text exceeds ${maxCharacters} characters: ${text}`);
  if (FORBIDDEN_CLAIMS.some(pattern => pattern.test(text))) {
    throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `Promotional text contains a prohibited or unsubstantiated claim: ${text}`);
  }
  for (const rule of EVIDENCE_RULES) {
    if (rule.pattern.test(text) && !events.some(event => rule.events.includes(event))) {
      throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `Promotional text is not supported by its source event: ${text}`);
    }
  }
}

export function validatePromotionalCopy(job: CookingVideoJob, decision: EditDecision): void {
  const lines = [...decision.segments.map(segment => ({ text: segment.caption ?? "", events: [segment.event] })), { text: decision.endCard.headline, events: decision.segments.map(segment => segment.event) }];
  for (const { text, events } of lines) {
    assertPromotionalText(text, events);
  }
  for (const sellingPoint of job.brief.sellingPoints ?? []) {
    if (FORBIDDEN_CLAIMS.some(pattern => pattern.test(sellingPoint))) {
      throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `Configured selling point is prohibited or requires evidence: ${sellingPoint}`);
    }
  }
}
