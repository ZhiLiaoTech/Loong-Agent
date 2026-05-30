import type { ModelProviderFormState, ModelProviderType } from "../types.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import styles from "../ModelsWorkspace.module.css";

export interface ModelProviderFieldsProps {
  form: ModelProviderFormState;
  idLocked?: boolean;
  onChange: (patch: Partial<ModelProviderFormState>) => void;
}

export function ModelProviderFields({ form, idLocked = false, onChange }: ModelProviderFieldsProps) {
  const t = useWorkbenchT();

  const providerTypes: { value: ModelProviderType; label: string }[] = [
    { value: "openai-compatible", label: t("models.providerOpenaiCompatible") },
    { value: "anthropic", label: t("models.providerAnthropic") },
  ];

  return (
    <>
      <label className={wb.fieldFull}>
        <span>{t("models.displayName")}</span>
        <input
          value={form.displayName}
          onChange={event => onChange({ displayName: event.target.value })}
          placeholder={t("models.displayNamePlaceholder")}
          autoComplete="off"
        />
      </label>

      <label className={wb.fieldFull}>
        <span>{t("models.apiKey")}</span>
        <input
          type="password"
          value={form.apiKey}
          onChange={event => onChange({ apiKey: event.target.value })}
          placeholder={t("models.apiKeyPlaceholder")}
          autoComplete="off"
        />
      </label>

      <div className={wb.formGrid}>
        <label className={wb.field}>
          <span>{t("models.type")}</span>
          <select
            value={form.type}
            onChange={event => onChange({ type: event.target.value as ModelProviderType })}
          >
            {providerTypes.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={wb.field}>
          <span>{t("models.defaultModel")}</span>
          <input
            value={form.defaultModel}
            onChange={event => onChange({ defaultModel: event.target.value })}
            placeholder={t("models.defaultModelPlaceholder")}
            autoComplete="off"
          />
        </label>
      </div>

      <label className={wb.check}>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={event => onChange({ enabled: event.target.checked })}
        />
        {t("models.useThisService")}
      </label>

      <details className={styles.advancedDetails}>
        <summary className={styles.advancedSummary}>{t("models.advancedSettings")}</summary>
        <div className={styles.advancedBody}>
          <p className={styles.advancedHint}>{t("models.advancedSettingsHint")}</p>
          <label className={wb.check}>
            <input
              type="checkbox"
              checked={form.supportsToolCalling}
              onChange={event => onChange({ supportsToolCalling: event.target.checked })}
            />
            {t("models.toolCalling")}
          </label>
          <label className={wb.fieldFull}>
            <span>{t("models.providerId")}</span>
            <input
              value={form.id}
              onChange={event => onChange({ id: event.target.value })}
              placeholder={t("models.providerIdPlaceholder")}
              autoComplete="off"
              disabled={idLocked}
            />
          </label>
          <label className={wb.fieldFull}>
            <span>{t("models.baseUrl")}</span>
            <input
              value={form.baseUrl}
              onChange={event => onChange({ baseUrl: event.target.value })}
              placeholder={t("models.baseUrlPlaceholder")}
              autoComplete="off"
            />
          </label>
        </div>
      </details>
    </>
  );
}
