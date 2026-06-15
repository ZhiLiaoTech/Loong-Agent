import type { ChatActivityStep, ChatTimelineItem } from "./types.js";

export function createTimelineTextItem(text: string, id: string): ChatTimelineItem {
  return { type: "text", id, text };
}

export function createTimelineStepItem(stepId: string): ChatTimelineItem {
  return { type: "step", stepId };
}

export function appendTimelineTextSegment(
  timeline: readonly ChatTimelineItem[],
  text: string,
  id: string,
): ChatTimelineItem[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [...timeline];
  }
  const last = timeline[timeline.length - 1];
  if (last?.type === "text") {
    const merged = `${last.text}\n\n${trimmed}`.trim();
    return [...timeline.slice(0, -1), { ...last, text: merged }];
  }
  return [...timeline, createTimelineTextItem(trimmed, id)];
}

export function appendTimelineStep(
  timeline: readonly ChatTimelineItem[],
  stepId: string,
): ChatTimelineItem[] {
  if (timeline.some(item => item.type === "step" && item.stepId === stepId)) {
    return [...timeline];
  }
  return [...timeline, createTimelineStepItem(stepId)];
}

export function mergeTimelineOnNewSteps(
  timeline: readonly ChatTimelineItem[],
  previousSteps: readonly ChatActivityStep[],
  nextSteps: readonly ChatActivityStep[],
  pendingText: string,
  textId: string,
): { timeline: ChatTimelineItem[]; pendingText: string } {
  const previousIds = new Set(previousSteps.map(step => step.id));
  let updatedTimeline = [...timeline];
  let remainingPending = pendingText;

  for (const step of nextSteps) {
    if (previousIds.has(step.id)) {
      continue;
    }
    if (remainingPending.trim()) {
      updatedTimeline = appendTimelineTextSegment(updatedTimeline, remainingPending, textId);
      remainingPending = "";
    }
    updatedTimeline = appendTimelineStep(updatedTimeline, step.id);
  }

  return { timeline: updatedTimeline, pendingText: remainingPending };
}

export function timelineTextPrefix(timeline: readonly ChatTimelineItem[]): string {
  return timeline
    .filter((item): item is Extract<ChatTimelineItem, { type: "text" }> => item.type === "text")
    .map(item => item.text)
    .join("\n\n");
}

export function visibleAssistantReplyText(fullText: string, timeline: readonly ChatTimelineItem[]): string {
  if (!fullText.trim()) {
    return fullText;
  }
  const prefix = timelineTextPrefix(timeline);
  if (!prefix) {
    return fullText;
  }
  if (fullText.startsWith(prefix)) {
    const rest = fullText.slice(prefix.length).replace(/^\s+/, "");
    return rest || fullText;
  }
  return fullText;
}
