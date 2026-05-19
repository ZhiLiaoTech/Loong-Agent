import type { AgentProfile, RunSettings, ThinkingLevel } from "../types.js";
import styles from "./RunSettingsPanel.module.css";

const THINKING_OPTIONS: { value: ThinkingLevel; label: string }[] = [
  { value: "", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export interface RunSettingsPanelProps {
  settings: RunSettings;
  profiles: readonly AgentProfile[];
  modelSuggestions: readonly string[];
  onChange: (patch: Partial<RunSettings>) => void;
  onProfileChange: (profileId: string) => void;
}

export function RunSettingsPanel({
  settings,
  profiles,
  modelSuggestions,
  onChange,
  onProfileChange,
}: RunSettingsPanelProps) {
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>Advanced settings</summary>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Profile</span>
          <select
            value={settings.profileId}
            onChange={event => onProfileChange(event.target.value)}
          >
            <option value="">Default</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.name || profile.id}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Session</span>
          <input
            value={settings.sessionId}
            onChange={event => onChange({ sessionId: event.target.value })}
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Model</span>
          <input
            value={settings.model}
            onChange={event => onChange({ model: event.target.value })}
            list="run-model-suggestions"
            placeholder="optional"
            autoComplete="off"
          />
          <datalist id="run-model-suggestions">
            {modelSuggestions.map(model => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          <span>Thinking</span>
          <select
            value={settings.thinking}
            onChange={event => onChange({ thinking: event.target.value as ThinkingLevel })}
          >
            {THINKING_OPTIONS.map(option => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.full}`}>
          <span>Workspace</span>
          <input
            value={settings.workspace}
            onChange={event => onChange({ workspace: event.target.value })}
            placeholder="optional"
            autoComplete="off"
          />
        </label>
      </div>
    </details>
  );
}
