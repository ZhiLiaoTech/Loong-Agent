export type ActivityGranularity = "standard" | "detailed";

export type ActivityStepStatus = "pending" | "running" | "done" | "error" | "skipped";

export type ActivityCategory = "context" | "tool" | "permission" | "model" | "lifecycle";

export type ActivityStepKind =
  | "thinking"
  | "command"
  | "read_file"
  | "write_file"
  | "search_file"
  | "browser"
  | "skill"
  | "permission"
  | "context"
  | "generic";

export interface ChatActivityStep {
  id: string;
  status: ActivityStepStatus;
  label: string;
  detail?: string;
  category: ActivityCategory;
  kind: ActivityStepKind;
  sequence?: number;
}

export interface ChatTimelineTextItem {
  type: "text";
  id: string;
  text: string;
}

export interface ChatTimelineStepItem {
  type: "step";
  stepId: string;
}

export type ChatTimelineItem = ChatTimelineTextItem | ChatTimelineStepItem;

export interface ChatActivityPreferences {
  showActivities: boolean;
  granularity: ActivityGranularity;
  autoCollapseMs: number;
}

export const DEFAULT_CHAT_ACTIVITY_PREFERENCES: ChatActivityPreferences = {
  showActivities: true,
  granularity: "standard",
  autoCollapseMs: 3000,
};
