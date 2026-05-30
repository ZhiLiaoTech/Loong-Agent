import { Drawer } from "../../components/Drawer.js";
import type { ModelProviderFormState } from "../types.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import styles from "../ModelsWorkspace.module.css";
import { ModelProviderFields } from "./ModelProviderFields.js";

export interface ModelProviderDrawerProps {
  open: boolean;
  mode: "add" | "edit";
  form: ModelProviderFormState;
  saving?: boolean;
  onChange: (patch: Partial<ModelProviderFormState>) => void;
  onClose: () => void;
  onSave: () => void;
}

export function ModelProviderDrawer({
  open,
  mode,
  form,
  saving = false,
  onChange,
  onClose,
  onSave,
}: ModelProviderDrawerProps) {
  const t = useWorkbenchT();
  const title =
    mode === "add"
      ? t("models.addProvider")
      : t("models.editProvider").replace(
          "{name}",
          form.displayName.trim() || form.id || form.editingId,
        );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={t("models.providerFormHint")}
    >
      <div className={styles.drawerForm}>
        <ModelProviderFields
          form={form}
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
            disabled={!form.displayName.trim() || saving}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
