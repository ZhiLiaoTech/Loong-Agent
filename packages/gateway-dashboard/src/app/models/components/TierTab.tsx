import { useMemo, useState } from "react";
import type { TierName, TierSpec } from "../types.js";
import type { useTiersPage } from "../useTiersPage.js";
import { buildConfiguredModelOptions } from "../buildConfiguredModelOptions.js";
import type { ModelProviderConfig } from "../types.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import styles from "../ModelsWorkspace.module.css";
import tierStyles from "./TierConfigPanel.module.css";
import { TierClassifyDrawer } from "./tier/TierClassifyDrawer.js";
import { TierLaneDrawer } from "./tier/TierLaneDrawer.js";
import { TierRoutingPolicy } from "./tier/TierRoutingPolicy.js";
import { TIER_ORDER, tierHintKey, tierNameKey } from "./tier/labels.js";

interface TierTabProps {
  page: ReturnType<typeof useTiersPage>;
  providers: readonly ModelProviderConfig[];
}

function friendlyModelLabel(model: string | undefined, t: (key: string) => string): string {
  if (!model?.trim()) {
    return t("models.tier.modelNotSet");
  }
  const parts = model.split(":");
  return parts.length > 1 ? (parts.at(-1) ?? model) : model;
}

export function TierTab({ page, providers }: TierTabProps) {
  const t = useWorkbenchT();
  const { config, setConfig, supported, loading, saving, persistConfig, status, error } = page;
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [laneDrawer, setLaneDrawer] = useState<TierName | null>(null);

  const modelOptions = useMemo(() => buildConfiguredModelOptions(providers), [providers]);
  const optionValues = useMemo(() => new Set(modelOptions.map(option => option.value)), [modelOptions]);
  const hasProviders = modelOptions.length > 0;
  const disabled = !config.enabled || loading || saving;

  const handleEnabledChange = (enabled: boolean) => {
    const next = { ...config, enabled };
    setConfig(next);
    void persistConfig(next);
  };

  const handleClassifierChange = (patch: Partial<typeof config.classifier>) => {
    const next = {
      ...config,
      classifier: { ...config.classifier, ...patch },
    };
    setConfig(next);
    void persistConfig(next);
  };

  const handleLaneSave = async (name: TierName, patch: Partial<TierSpec>) => {
    const next = {
      ...config,
      tiers: {
        ...config.tiers,
        [name]: { ...(config.tiers[name] ?? {}), ...patch },
      },
    };
    setConfig(next);
    await persistConfig(next);
    setLaneDrawer(null);
  };

  if (supported === false) {
    return <p className={wb.tableEmpty}>{t("models.tier.unsupportedLead")}</p>;
  }

  return (
    <>
      {error || status ? (
        <div className={tierStyles.banners}>
          {error ? <p className={wb.bannerError}>{error}</p> : null}
          {status ? <p className={wb.bannerOk}>{status}</p> : null}
        </div>
      ) : null}

      {!hasProviders ? (
        <p className={styles.tierNotice}>{t("models.tier.noProvidersHint")}</p>
      ) : null}

      <div className={styles.tierSection}>
        <div className={styles.tierSwitchCard}>
          <div className={styles.tierSwitchCopy}>
            <h3 className={styles.tierSwitchTitle}>{t("models.tier.enableRouting")}</h3>
            <p className={styles.tierSwitchHint}>{t("models.tier.enableRoutingHint")}</p>
          </div>
          <label className={tierStyles.switch}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={event => handleEnabledChange(event.target.checked)}
              disabled={loading || saving}
            />
            <span className={tierStyles.switchTrack} aria-hidden />
          </label>
        </div>

        <div className={styles.tierPolicyCard}>
          <div className={styles.tierPolicyHead}>
            <h3 className={styles.panelToolbarTitle}>{t("models.tier.routingTitle")}</h3>
            <button
              type="button"
              className={wb.btnSecondary}
              onClick={() => setClassifyOpen(true)}
              disabled={loading || saving}
            >
              {t("models.tier.tryRouting")}
            </button>
          </div>
          <TierRoutingPolicy
            classifier={config.classifier}
            enabled={config.enabled}
            loading={loading || saving}
            onClassifierChange={handleClassifierChange}
          />
        </div>

        <div>
          <div className={styles.panelToolbar}>
            <div className={styles.panelToolbarCopy}>
              <h3 className={styles.panelToolbarTitle}>{t("models.tier.lanesTitle")}</h3>
            </div>
          </div>
          <div className={styles.tierLaneGrid}>
            {TIER_ORDER.map(name => {
              const spec = config.tiers[name] ?? {};
              const model = spec.model?.trim();
              const modelMissing = Boolean(model && !optionValues.has(model));
              const modelLabel = modelMissing
                ? t("models.tier.modelNeedsUpdate")
                : friendlyModelLabel(model, t);

              return (
                <article
                  key={name}
                  className={`${styles.tierLaneCard} ${styles[`tierLaneCard_${name}`]}`}
                >
                  <div className={styles.tierLaneCardHead}>
                    <h4 className={styles.tierLaneCardTitle}>{t(tierNameKey(name))}</h4>
                    {name === "standard" ? (
                      <span className={tierStyles.laneBadge}>{t("common.default")}</span>
                    ) : null}
                  </div>
                  <p
                    className={
                      modelMissing
                        ? `${styles.tierLaneCardModel} ${styles.tierLaneCardModelWarn}`
                        : styles.tierLaneCardModel
                    }
                  >
                    {modelLabel}
                  </p>
                  <p className={styles.tierLaneCardHint}>{t(tierHintKey(name))}</p>
                  <div className={styles.tierLaneCardActions}>
                    <button
                      type="button"
                      className={wb.btnSecondary}
                      onClick={() => setLaneDrawer(name)}
                      disabled={disabled || !hasProviders}
                    >
                      {t("models.tier.configureLane")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <TierClassifyDrawer open={classifyOpen} onClose={() => setClassifyOpen(false)} page={page} />

      {laneDrawer ? (
        <TierLaneDrawer
          open
          name={laneDrawer}
          spec={config.tiers[laneDrawer] ?? {}}
          modelOptions={modelOptions}
          disabled={disabled}
          saving={saving}
          onClose={() => setLaneDrawer(null)}
          onSave={patch => handleLaneSave(laneDrawer, patch)}
        />
      ) : null}
    </>
  );
}
