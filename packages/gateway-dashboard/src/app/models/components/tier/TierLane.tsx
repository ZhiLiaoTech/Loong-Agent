import type { TierName, TierSpec } from "../../types.js";
import styles from "../TierConfigPanel.module.css";
import { TIER_HINTS, TIER_LABELS } from "./labels.js";

interface Props {
  name: TierName;
  spec: TierSpec;
  disabled: boolean;
  isDefault?: boolean;
  onUpdate: (patch: Partial<TierSpec>) => void;
}

export function TierLane({ name, spec, disabled, isDefault, onUpdate }: Props) {
  return (
    <details className={`${styles.lane} ${styles[`lane_${name}`]}`} open={name === "standard"}>
      <summary className={styles.laneSummary}>
        <span className={styles.laneBar} aria-hidden />
        <span className={styles.laneHeading}>
          <span className={styles.laneTitleRow}>
            <span className={styles.laneTitle}>{TIER_LABELS[name]}</span>
            {isDefault ? <span className={styles.laneBadge}>默认</span> : null}
          </span>
          <span className={styles.laneHint}>{TIER_HINTS[name]}</span>
        </span>
      </summary>

      <div className={styles.laneBody}>
        <label className={styles.field}>
          <span>模型 (provider:model)</span>
          <input
            type="text"
            placeholder="例如 deepseek:deepseek-chat"
            value={spec.model ?? ""}
            onChange={event => onUpdate({ model: event.target.value })}
            disabled={disabled}
            autoComplete="off"
          />
        </label>

        <div className={styles.fieldPair}>
          <label className={styles.field}>
            <span>推理强度</span>
            <select
              value={spec.thinking ?? "none"}
              onChange={event => {
                const raw = event.target.value;
                const next =
                  raw === "none" || raw === "low" || raw === "medium" || raw === "high" ? raw : undefined;
                onUpdate(next !== undefined ? { thinking: next } : {});
              }}
              disabled={disabled}
            >
              <option value="none">无</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>上下文上限 (字符)</span>
            <input
              type="number"
              min={500}
              max={200_000}
              step={500}
              value={spec.maxContextChars ?? ""}
              onChange={event => {
                const raw = event.target.value;
                onUpdate(raw ? { maxContextChars: Number(raw) } : {});
              }}
              disabled={disabled}
            />
          </label>
        </div>

        <div className={styles.pillRow}>
          <label
            className={
              spec.toolsEnabled !== false ? `${styles.pill} ${styles.pillOn}` : styles.pill
            }
          >
            <input
              type="checkbox"
              checked={spec.toolsEnabled !== false}
              onChange={event => onUpdate({ toolsEnabled: event.target.checked })}
              disabled={disabled}
            />
            允许工具
          </label>
          <label
            className={
              spec.memoryEnabled !== false ? `${styles.pill} ${styles.pillOn}` : styles.pill
            }
          >
            <input
              type="checkbox"
              checked={spec.memoryEnabled !== false}
              onChange={event => onUpdate({ memoryEnabled: event.target.checked })}
              disabled={disabled}
            />
            注入记忆
          </label>
        </div>
      </div>
    </details>
  );
}
