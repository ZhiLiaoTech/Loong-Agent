import { useEffect, useState } from "react";
import { Drawer } from "../../../components/Drawer.js";
import type { TierName, TierSpec } from "../../types.js";
import type { ConfiguredModelOption } from "../../buildConfiguredModelOptions.js";
import { useWorkbenchT } from "../../../i18n/WorkbenchI18nContext.js";
import wb from "../../../workbench.module.css";
import styles from "../../ModelsWorkspace.module.css";
import tierStyles from "../TierConfigPanel.module.css";
import { tierNameKey } from "./labels.js";

interface TierLaneDrawerProps {
  open: boolean;
  name: TierName;
  spec: TierSpec;
  modelOptions: readonly ConfiguredModelOption[];
  disabled: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: Partial<TierSpec>) => void;
}

export function TierLaneDrawer({
  open,
  name,
  spec,
  modelOptions,
  disabled,
  saving,
  onClose,
  onSave,
}: TierLaneDrawerProps) {
  const t = useWorkbenchT();
  const [draft, setDraft] = useState<TierSpec>(spec);

  useEffect(() => {
    if (open) {
      setDraft(spec);
    }
  }, [open, spec]);

  const currentModel = draft.model ?? "";
  const modelMissing = Boolean(currentModel && !modelOptions.some(option => option.value === currentModel));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("models.tier.configureLaneTitle").replace("{tier}", t(tierNameKey(name)))}
      subtitle={t("models.tier.modelSelectHint")}
    >
      <div className={styles.drawerForm}>
        <label className={tierStyles.field}>
          <span>{t("models.tier.modelField")}</span>
          <select
            value={currentModel}
            onChange={event => {
              const value = event.target.value;
              setDraft(current => {
                const next = { ...current };
                if (value) {
                  next.model = value;
                } else {
                  delete next.model;
                }
                return next;
              });
            }}
            disabled={disabled || !modelOptions.length}
          >
            <option value="">{t("models.tier.modelNotSet")}</option>
            {modelMissing ? (
              <option value={currentModel}>{t("models.tier.modelNeedsUpdate")}</option>
            ) : null}
            {modelOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className={tierStyles.pillRow}>
          <label
            className={
              draft.toolsEnabled !== false ? `${tierStyles.pill} ${tierStyles.pillOn}` : tierStyles.pill
            }
          >
            <input
              type="checkbox"
              checked={draft.toolsEnabled !== false}
              onChange={event =>
                setDraft(current => ({
                  ...current,
                  toolsEnabled: event.target.checked,
                }))
              }
              disabled={disabled}
            />
            {t("models.tier.allowTools")}
          </label>
          <label
            className={
              draft.memoryEnabled !== false ? `${tierStyles.pill} ${tierStyles.pillOn}` : tierStyles.pill
            }
          >
            <input
              type="checkbox"
              checked={draft.memoryEnabled !== false}
              onChange={event =>
                setDraft(current => ({
                  ...current,
                  memoryEnabled: event.target.checked,
                }))
              }
              disabled={disabled}
            />
            {t("models.tier.injectMemory")}
          </label>
        </div>

        <details className={styles.advancedDetails}>
          <summary className={styles.advancedSummary}>{t("models.advancedSettings")}</summary>
          <div className={styles.advancedBody}>
            <div className={tierStyles.fieldPair}>
              <label className={tierStyles.field}>
                <span>{t("models.tier.thinkingField")}</span>
                <select
                  value={draft.thinking ?? "none"}
                  onChange={event => {
                    const raw = event.target.value;
                    setDraft(current => {
                      const next = { ...current };
                      if (raw === "none" || raw === "low" || raw === "medium" || raw === "high") {
                        next.thinking = raw;
                      }
                      return next;
                    });
                  }}
                  disabled={disabled}
                >
                  <option value="none">{t("agents.thinkingNone")}</option>
                  <option value="low">{t("agents.thinkingLow")}</option>
                  <option value="medium">{t("agents.thinkingMedium")}</option>
                  <option value="high">{t("agents.thinkingHigh")}</option>
                </select>
              </label>
              <label className={tierStyles.field}>
                <span>{t("models.tier.contextLimit")}</span>
                <input
                  type="number"
                  min={500}
                  max={200_000}
                  step={500}
                  value={draft.maxContextChars ?? ""}
                  onChange={event => {
                    const raw = event.target.value;
                    setDraft(current => {
                      const next = { ...current };
                      if (raw) {
                        next.maxContextChars = Number(raw);
                      } else {
                        delete next.maxContextChars;
                      }
                      return next;
                    });
                  }}
                  disabled={disabled}
                />
              </label>
            </div>
          </div>
        </details>

        <div className={styles.drawerFooter}>
          <button type="button" className={wb.btnSecondary} onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={wb.btnPrimary}
            onClick={() => onSave(draft)}
            disabled={disabled || saving}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
