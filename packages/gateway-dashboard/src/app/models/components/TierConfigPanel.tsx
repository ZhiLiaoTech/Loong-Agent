import { useCallback, useState } from "react";
import type { TierConfigState, TierName, TierSpec } from "../types.js";
import type { useTiersPage } from "../useTiersPage.js";
import styles from "./TierConfigPanel.module.css";
import { TierClassifyDrawer } from "./tier/TierClassifyDrawer.js";
import { TIER_ORDER } from "./tier/labels.js";
import { TierLane } from "./tier/TierLane.js";
import { TierRoutingPolicy } from "./tier/TierRoutingPolicy.js";

interface Props {
  page: ReturnType<typeof useTiersPage>;
}

export function TierConfigPanel({ page }: Props) {
  const { config, setConfig, supported, loading, saving, save, status, error } = page;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const disabled = !config.enabled || loading;

  const updateTier = useCallback(
    (name: TierName, patch: Partial<TierSpec>) => {
      setConfig(current => ({
        ...current,
        tiers: {
          ...current.tiers,
          [name]: { ...(current.tiers[name] ?? {}), ...patch },
        },
      }));
    },
    [setConfig],
  );

  const updateClassifier = useCallback(
    (patch: Partial<TierConfigState["classifier"]>) => {
      setConfig(current => ({
        ...current,
        classifier: { ...current.classifier, ...patch },
      }));
    },
    [setConfig],
  );

  if (supported === false) {
    return (
      <section className={styles.panel}>
        <header className={styles.hero}>
          <div>
            <h3 className={styles.heroTitle}>分层调度</h3>
            <p className={styles.heroLead}>
              当前 Gateway 未提供分层调度能力，请升级 Dragon 以启用多模型档位路由。
            </p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <>
      <section
        className={config.enabled ? styles.panel : `${styles.panel} ${styles.panelDisabled}`}
        aria-busy={loading}
      >
        <header className={styles.hero}>
          <div className={styles.heroText}>
            <h3 className={styles.heroTitle}>分层调度</h3>
            <p className={styles.heroLead}>
              按启发式或固定策略，将每轮对话路由到快速 / 标准 / 深度档位。保存后对下一轮生效。
            </p>
          </div>
          <div className={styles.heroActions}>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={event => setConfig(current => ({ ...current, enabled: event.target.checked }))}
                disabled={loading}
              />
              <span className={styles.switchTrack} aria-hidden />
              <span className={styles.switchLabel}>启用分层路由</span>
            </label>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setDrawerOpen(true)}
              disabled={loading}
            >
              试路由
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void save()}
              disabled={saving || loading}
            >
              {saving ? "保存中…" : "保存配置"}
            </button>
          </div>
        </header>

        {error ? <p className={styles.bannerError}>{error}</p> : null}
        {status ? <p className={styles.bannerOk}>{status}</p> : null}
        {config.configPath ? (
          <p className={styles.configPath}>配置文件：{config.configPath}</p>
        ) : null}

        <TierRoutingPolicy
          classifier={config.classifier}
          enabled={config.enabled}
          loading={loading}
          onClassifierChange={updateClassifier}
        />

        <section className={styles.section} aria-labelledby="tier-lanes-heading">
          <h3 id="tier-lanes-heading" className={styles.sectionTitle}>
            档位配置
          </h3>
          <div className={styles.laneGrid}>
            {TIER_ORDER.map(name => (
              <TierLane
                key={name}
                name={name}
                spec={config.tiers[name] ?? {}}
                disabled={disabled}
                isDefault={name === "standard"}
                onUpdate={patch => updateTier(name, patch)}
              />
            ))}
          </div>
        </section>
      </section>

      <TierClassifyDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} page={page} />
    </>
  );
}
