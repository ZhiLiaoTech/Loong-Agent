import type { TierConfigState, TierName } from "../../types.js";
import { useWorkbenchT } from "../../../i18n/WorkbenchI18nContext.js";
import styles from "../TierConfigPanel.module.css";
import { TIER_ORDER, tierNameKey } from "./labels.js";

interface Props {
  classifier: TierConfigState["classifier"];
  enabled: boolean;
  loading: boolean;
  onClassifierChange: (patch: Partial<TierConfigState["classifier"]>) => void;
}

export function TierRoutingPolicy({ classifier, enabled, loading, onClassifierChange }: Props) {
  const t = useWorkbenchT();
  const disabled = !enabled || loading;

  return (
    <section className={styles.routingSection} aria-label={t("models.tier.routingTitle")}>
      <div className={styles.segmented} role="group" aria-label={t("models.tier.routingTitle")}>
        <button
          type="button"
          className={
            classifier.mode === "heuristic"
              ? `${styles.segment} ${styles.segmentActive}`
              : styles.segment
          }
          disabled={disabled}
          aria-pressed={classifier.mode === "heuristic"}
          onClick={() => onClassifierChange({ mode: "heuristic" })}
        >
          {t("models.tier.modeHeuristic")}
        </button>
        <button
          type="button"
          className={
            classifier.mode === "fixed" ? `${styles.segment} ${styles.segmentActive}` : styles.segment
          }
          disabled={disabled}
          aria-pressed={classifier.mode === "fixed"}
          onClick={() => onClassifierChange({ mode: "fixed", fixedTier: classifier.fixedTier ?? "standard" })}
        >
          {t("models.tier.modeFixed")}
        </button>
      </div>

      {classifier.mode === "heuristic" ? (
        <p className={styles.sectionHint}>{t("models.tier.heuristicHint")}</p>
      ) : (
        <div className={styles.chipRow}>
          <span className={styles.chipLabel}>{t("models.tier.fixedTo")}</span>
          {TIER_ORDER.map(name => (
            <button
              key={name}
              type="button"
              className={
                (classifier.fixedTier ?? "standard") === name
                  ? `${styles.tierChip} ${styles.tierChipActive} ${styles[`tierChip_${name}`]}`
                  : `${styles.tierChip} ${styles[`tierChip_${name}`]}`
              }
              disabled={disabled}
              aria-pressed={(classifier.fixedTier ?? "standard") === name}
              onClick={() => onClassifierChange({ fixedTier: name as TierName })}
            >
              {t(tierNameKey(name))}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
