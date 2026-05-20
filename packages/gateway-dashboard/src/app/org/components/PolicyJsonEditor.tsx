import styles from "./PolicyJsonEditor.module.css";

export function PolicyJsonEditor({
  jsonText,
  loading,
  saving,
  onChange,
  onReload,
  onSave,
}: {
  jsonText: string;
  loading: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onReload: () => void;
  onSave: () => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>工具策略 JSON</h3>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onReload} disabled={loading}>
            重新加载
          </button>
          <button type="button" className={styles.primary} onClick={onSave} disabled={saving || loading}>
            {saving ? "保存中…" : "保存策略"}
          </button>
        </div>
      </div>
      <p className={styles.hint}>编辑 `policies` 数组后保存，将写入 `.dragon/org/policies/tool-policies.json`。</p>
      <textarea
        className={styles.textarea}
        value={jsonText}
        onChange={event => onChange(event.target.value)}
        spellCheck={false}
      />
    </section>
  );
}
