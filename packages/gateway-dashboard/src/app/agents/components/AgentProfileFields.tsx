import type { ConfiguredModelOption } from "../../models/buildConfiguredModelOptions.js";
import type { AgentProfileFormState, ThinkingLevel } from "../types.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import styles from "../AgentsWorkspace.module.css";

export interface AgentProfileFieldsProps {
  form: AgentProfileFormState;
  modelOptions: readonly ConfiguredModelOption[];
  idLocked?: boolean;
  onChange: (patch: Partial<AgentProfileFormState>) => void;
}

export function AgentProfileFields({
  form,
  modelOptions,
  idLocked = false,
  onChange,
}: AgentProfileFieldsProps) {
  const t = useWorkbenchT();
  const hasModels = modelOptions.length > 0;
  const modelMissing = Boolean(
    form.defaultModel.trim() && !modelOptions.some(option => option.value === form.defaultModel.trim()),
  );

  const thinkingOptions: { value: ThinkingLevel; label: string }[] = [
    { value: "", label: t("agents.thinkingDefault") },
    { value: "none", label: t("agents.thinkingNone") },
    { value: "low", label: t("agents.thinkingLow") },
    { value: "medium", label: t("agents.thinkingMedium") },
    { value: "high", label: t("agents.thinkingHigh") },
  ];

  return (
    <>
      {!hasModels ? <p className={styles.notice}>{t("agents.noModelsHint")}</p> : null}

      <label className={wb.fieldFull}>
        <span>{t("agents.name")}</span>
        <input
          value={form.name}
          onChange={event => onChange({ name: event.target.value })}
          placeholder={t("agents.namePlaceholder")}
          autoComplete="off"
        />
      </label>

      <label className={wb.fieldFull}>
        <span>{t("agents.defaultModel")}</span>
        <select
          value={form.defaultModel}
          onChange={event => onChange({ defaultModel: event.target.value })}
          disabled={!hasModels}
        >
          <option value="">{t("agents.modelNotSet")}</option>
          {modelMissing ? (
            <option value={form.defaultModel}>{t("agents.modelNeedsUpdate")}</option>
          ) : null}
          {modelOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className={wb.fieldFull}>
        <span>{t("agents.description")}</span>
        <input
          value={form.description}
          onChange={event => onChange({ description: event.target.value })}
          placeholder={t("agents.descriptionPlaceholder")}
          autoComplete="off"
        />
      </label>

      <label className={wb.check}>
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={event => onChange({ isDefault: event.target.checked })}
        />
        {t("agents.useAsDefault")}
      </label>

      <div>
        <h3 className={styles.drawerSectionTitle}>{t("agents.instructions")}</h3>
        <label className={wb.fieldFull}>
          <textarea
            className={wb.textarea}
            value={form.systemPrompt}
            onChange={event => onChange({ systemPrompt: event.target.value })}
            placeholder={t("agents.instructionsPlaceholder")}
            rows={5}
            aria-label={t("agents.instructions")}
          />
        </label>
      </div>

      <details className={styles.advancedDetails}>
        <summary className={styles.advancedSummary}>{t("agents.advancedSettings")}</summary>
        <div className={styles.advancedBody}>
          <p className={styles.advancedHint}>{t("agents.advancedSettingsHint")}</p>

          <label className={wb.fieldFull}>
            <span>{t("agents.thinking")}</span>
            <select
              value={form.thinking}
              onChange={event => onChange({ thinking: event.target.value as ThinkingLevel })}
            >
              {thinkingOptions.map(option => (
                <option key={option.value || "default"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className={wb.checkRow}>
            <label className={wb.check}>
              <input
                type="checkbox"
                checked={form.memoryEnabled}
                onChange={event => onChange({ memoryEnabled: event.target.checked })}
              />
              {t("agents.memory")}
            </label>
            <label className={wb.check}>
              <input
                type="checkbox"
                checked={form.toolsEnabled}
                onChange={event => onChange({ toolsEnabled: event.target.checked })}
              />
              {t("agents.tools")}
            </label>
          </div>

          <label className={wb.fieldFull}>
            <span>{t("agents.workspace")}</span>
            <input
              value={form.workspace}
              onChange={event => onChange({ workspace: event.target.value })}
              placeholder={t("agents.workspacePlaceholder")}
              autoComplete="off"
            />
          </label>

          <label className={wb.fieldFull}>
            <span>{t("agents.profileId")}</span>
            <input
              value={form.id}
              onChange={event => onChange({ id: event.target.value })}
              placeholder={t("agents.profileIdPlaceholder")}
              autoComplete="off"
              disabled={idLocked}
            />
          </label>
        </div>
      </details>
    </>
  );
}
