import { PolicyJsonEditor } from "../../org/components/PolicyJsonEditor.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import styles from "../OrganizationWorkspace.module.css";

interface ToolPolicyTabProps {
  jsonText: string;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onReload: () => void;
  onSave: () => void;
}

export function ToolPolicyTab({
  jsonText,
  dirty,
  loading,
  saving,
  onChange,
  onReload,
  onSave,
}: ToolPolicyTabProps) {
  const t = useWorkbenchT();

  return (
    <div className={styles.formStack}>
      <p className={styles.sectionHint}>{t("org.policyEditor.lead")}</p>
      {dirty ? <p className={styles.policyDirtyHint}>{t("org.policyEditor.unsavedHint")}</p> : null}
      <PolicyJsonEditor
        jsonText={jsonText}
        loading={loading}
        saving={saving}
        onChange={onChange}
        onReload={onReload}
        onSave={onSave}
        labels={{
          title: t("org.policyEditor.title"),
          hint: t("org.policyEditor.hint"),
          reload: t("org.policyEditor.reload"),
          save: t("org.policyEditor.save"),
          saving: t("org.policyEditor.saving"),
        }}
        {...(styles.policyEditorTextarea
          ? { textareaClassName: styles.policyEditorTextarea }
          : {})}
      />
    </div>
  );
}
