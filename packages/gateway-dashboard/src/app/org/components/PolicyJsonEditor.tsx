import styles from "./PolicyJsonEditor.module.css";

export interface PolicyJsonEditorLabels {
  title: string;
  hint: string;
  reload: string;
  save: string;
  saving: string;
}

const DEFAULT_LABELS: PolicyJsonEditorLabels = {
  title: "工具策略 JSON",
  hint: "编辑 `policies` 数组后保存，将写入 Gateway 组织目录下的 `policies/tool-policies.json`。",
  reload: "重新加载",
  save: "保存策略",
  saving: "保存中…",
};

export function PolicyJsonEditor({
  jsonText,
  loading,
  saving,
  onChange,
  onReload,
  onSave,
  labels = DEFAULT_LABELS,
  textareaClassName,
}: {
  jsonText: string;
  loading: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onReload: () => void;
  onSave: () => void;
  labels?: Partial<PolicyJsonEditorLabels>;
  textareaClassName?: string;
}) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>{copy.title}</h3>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onReload} disabled={loading}>
            {copy.reload}
          </button>
          <button type="button" className={styles.primary} onClick={onSave} disabled={saving || loading}>
            {saving ? copy.saving : copy.save}
          </button>
        </div>
      </div>
      <p className={styles.hint}>{copy.hint}</p>
      <textarea
        className={textareaClassName ? `${styles.textarea} ${textareaClassName}` : styles.textarea}
        value={jsonText}
        onChange={event => onChange(event.target.value)}
        spellCheck={false}
      />
    </section>
  );
}
