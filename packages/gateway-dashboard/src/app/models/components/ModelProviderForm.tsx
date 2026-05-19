import type { ModelProviderFormState, ModelProviderType } from "../types.js";
import styles from "./ModelProviderForm.module.css";

const PROVIDER_TYPES: { value: ModelProviderType; label: string }[] = [
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "anthropic", label: "Anthropic" },
];

export interface ModelProviderFormProps {
  form: ModelProviderFormState;
  onChange: (patch: Partial<ModelProviderFormState>) => void;
  onUpsert: () => void;
  onClear: () => void;
}

export function ModelProviderForm({ form, onChange, onUpsert, onClear }: ModelProviderFormProps) {
  return (
    <section className={styles.card}>
      <h3 className={styles.title}>Add / update provider</h3>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Type</span>
          <select
            value={form.type}
            onChange={event => onChange({ type: event.target.value as ModelProviderType })}
          >
            {PROVIDER_TYPES.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Provider ID</span>
          <input
            value={form.id}
            onChange={event => onChange({ id: event.target.value })}
            placeholder="openai"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Display name</span>
          <input
            value={form.displayName}
            onChange={event => onChange({ displayName: event.target.value })}
            placeholder="OpenAI"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>API key</span>
          <input
            type="password"
            value={form.apiKey}
            onChange={event => onChange({ apiKey: event.target.value })}
            placeholder="leave blank to keep"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Base URL</span>
          <input
            value={form.baseUrl}
            onChange={event => onChange({ baseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Default model</span>
          <input
            value={form.defaultModel}
            onChange={event => onChange({ defaultModel: event.target.value })}
            placeholder="gpt-4.1-mini"
            autoComplete="off"
          />
        </label>
      </div>
      <div className={styles.checkRow}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={event => onChange({ enabled: event.target.checked })}
          />
          Enabled
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={form.supportsToolCalling}
            onChange={event => onChange({ supportsToolCalling: event.target.checked })}
          />
          Tool calling
        </label>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onUpsert} disabled={!form.id.trim()}>
          Add / update
        </button>
        <button type="button" className={styles.secondary} onClick={onClear}>
          Clear
        </button>
      </div>
    </section>
  );
}
