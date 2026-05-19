import type { AgentProfileFormState, ThinkingLevel } from "../types.js";
import styles from "./AgentProfileForm.module.css";

const THINKING_OPTIONS: { value: ThinkingLevel; label: string }[] = [
  { value: "", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export interface AgentProfileFormProps {
  form: AgentProfileFormState;
  modelSuggestions: readonly string[];
  onChange: (patch: Partial<AgentProfileFormState>) => void;
  onUpsert: () => void;
  onClear: () => void;
}

export function AgentProfileForm({
  form,
  modelSuggestions,
  onChange,
  onUpsert,
  onClear,
}: AgentProfileFormProps) {
  const canSubmit = Boolean(form.id.trim() && form.name.trim());

  return (
    <section className={styles.card}>
      <h3 className={styles.title}>Add / update profile</h3>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Profile ID</span>
          <input
            value={form.id}
            onChange={event => onChange({ id: event.target.value })}
            placeholder="default"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Name</span>
          <input
            value={form.name}
            onChange={event => onChange({ name: event.target.value })}
            placeholder="Default Agent"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Default model</span>
          <input
            value={form.defaultModel}
            onChange={event => onChange({ defaultModel: event.target.value })}
            list="agent-model-suggestions"
            placeholder="optional"
            autoComplete="off"
          />
          <datalist id="agent-model-suggestions">
            {modelSuggestions.map(model => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          <span>Workspace</span>
          <input
            value={form.workspace}
            onChange={event => onChange({ workspace: event.target.value })}
            placeholder="optional"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Thinking</span>
          <select
            value={form.thinking}
            onChange={event => onChange({ thinking: event.target.value as ThinkingLevel })}
          >
            {THINKING_OPTIONS.map(option => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Default profile</span>
          <label className={styles.inlineCheck}>
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={event => onChange({ isDefault: event.target.checked })}
            />
            Use as default
          </label>
        </label>
      </div>
      <label className={`${styles.field} ${styles.full}`}>
        <span>Description</span>
        <input
          value={form.description}
          onChange={event => onChange({ description: event.target.value })}
          placeholder="optional"
          autoComplete="off"
        />
      </label>
      <label className={`${styles.field} ${styles.full}`}>
        <span>Instructions</span>
        <textarea
          className={styles.textarea}
          value={form.systemPrompt}
          onChange={event => onChange({ systemPrompt: event.target.value })}
          rows={4}
        />
      </label>
      <div className={styles.checkRow}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={form.memoryEnabled}
            onChange={event => onChange({ memoryEnabled: event.target.checked })}
          />
          Memory
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={form.toolsEnabled}
            onChange={event => onChange({ toolsEnabled: event.target.checked })}
          />
          Tools
        </label>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onUpsert} disabled={!canSubmit}>
          Add / update
        </button>
        <button type="button" className={styles.secondary} onClick={onClear}>
          Clear
        </button>
      </div>
    </section>
  );
}
