export type ActivityGranularity = "standard" | "detailed";

export type ActivityStepStatus = "pending" | "running" | "done" | "error" | "skipped";

export type ActivityCategory = "context" | "tool" | "permission" | "model" | "lifecycle";

export interface ChatActivityStep {
  id: string;
  status: ActivityStepStatus;
  label: string;
  detail?: string;
  category: ActivityCategory;
  sequence?: number;
}

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
