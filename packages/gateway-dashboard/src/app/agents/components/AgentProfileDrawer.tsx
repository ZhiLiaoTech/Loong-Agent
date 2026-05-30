import { Drawer } from "../../components/Drawer.js";
import type { ConfiguredModelOption } from "../../models/buildConfiguredModelOptions.js";
import type { AgentProfileFormState } from "../types.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import styles from "../AgentsWorkspace.module.css";
import { AgentProfileFields } from "./AgentProfileFields.js";

export interface AgentProfileDrawerProps {
  open: boolean;
  mode: "add" | "edit";
  form: AgentProfileFormState;
  modelOptions: readonly ConfiguredModelOption[];
  saving?: boolean;
  onChange: (patch: Partial<AgentProfileFormState>) => void;
  onClose: () => void;
  onSave: () => void;
}

export function AgentProfileDrawer({
  open,
  mode,
  form,
  modelOptions,
  saving = false,
  onChange,
  onClose,
  onSave,
}: AgentProfileDrawerProps) {
  const t = useWorkbenchT();
  const title =
    mode === "add"
      ? t("agents.addAgent")
      : t("agents.editAgent").replace("{name}", form.name.trim() || form.id || form.editingId);

  const canSave =
    Boolean(form.name.trim()) &&
    (modelOptions.length === 0 || Boolean(form.defaultModel.trim()));

  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle={t("agents.formHint")}>
      <div className={styles.drawerForm}>
        <AgentProfileFields
          form={form}
          modelOptions={modelOptions}
          idLocked={mode === "edit"}
          onChange={onChange}
        />
        <div className={styles.drawerFooter}>
          <button type="button" className={wb.btnSecondary} onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={wb.btnPrimary}
            onClick={onSave}
            disabled={!canSave || saving}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
