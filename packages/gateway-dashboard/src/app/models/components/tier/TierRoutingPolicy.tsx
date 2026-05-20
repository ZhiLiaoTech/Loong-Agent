import type { TierConfigState, TierName } from "../../types.js";
import styles from "../TierConfigPanel.module.css";
import { TIER_LABELS, TIER_ORDER } from "./labels.js";

interface Props {
  classifier: TierConfigState["classifier"];
  enabled: boolean;
  loading: boolean;
  onClassifierChange: (patch: Partial<TierConfigState["classifier"]>) => void;
}

export function TierRoutingPolicy({ classifier, enabled, loading, onClassifierChange }: Props) {
  const disabled = !enabled || loading;

  return (
    <section className={styles.section} aria-labelledby="tier-routing-heading">
      <h3 id="tier-routing-heading" className={styles.sectionTitle}>
        路由策略
      </h3>

      <div className={styles.segmented} role="group" aria-label="分类模式">
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
          启发式
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
          固定档位
        </button>
      </div>

      {classifier.mode === "heuristic" ? (
        <p className={styles.sectionHint}>
          根据提示长度、工具、附件与关键词等信号自动选择档位，无需每次手动指定。
        </p>
      ) : (
        <div className={styles.chipRow}>
          <span className={styles.chipLabel}>固定为</span>
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
              {TIER_LABELS[name]}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
