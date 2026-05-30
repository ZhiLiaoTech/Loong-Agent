import {
  DEFAULT_CHAT_ACTIVITY_PREFERENCES,
  type ChatActivityPreferences,
} from "./types.js";

const STORAGE_KEY = "loong.chat.activityPrefs.v1";

export function loadChatActivityPreferences(): ChatActivityPreferences {
  if (typeof globalThis.localStorage === "undefined") {
    return { ...DEFAULT_CHAT_ACTIVITY_PREFERENCES };
  }
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_CHAT_ACTIVITY_PREFERENCES };
    }
    const parsed = JSON.parse(raw) as Partial<ChatActivityPreferences>;
    return {
      showActivities: parsed.showActivities ?? DEFAULT_CHAT_ACTIVITY_PREFERENCES.showActivities,
      granularity: parsed.granularity === "detailed" ? "detailed" : "standard",
      autoCollapseMs: typeof parsed.autoCollapseMs === "number" && parsed.autoCollapseMs >= 0
        ? parsed.autoCollapseMs
        : DEFAULT_CHAT_ACTIVITY_PREFERENCES.autoCollapseMs,
    };
  } catch {
    return { ...DEFAULT_CHAT_ACTIVITY_PREFERENCES };
  }
}

export function saveChatActivityPreferences(prefs: ChatActivityPreferences): void {
  if (typeof globalThis.localStorage === "undefined") {
    return;
  }
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota errors.
  }
}
