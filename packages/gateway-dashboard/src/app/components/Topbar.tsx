import { useSecret } from "../secret/SecretContext.js";
import styles from "./Topbar.module.css";

export interface TopbarProps {
  healthLabel: string;
  healthOk: boolean;
  healthChecking: boolean;
  sseStatus: string;
  onThemeClick: () => void;
  themeLabel: string;
  onMenuClick?: () => void;
}

export function Topbar({
  healthLabel,
  healthOk,
  healthChecking,
  sseStatus,
  onThemeClick,
  themeLabel,
  onMenuClick,
}: TopbarProps) {
  const { secret, setSecret } = useSecret();

  const healthClass = healthChecking
    ? styles.dotChecking
    : healthOk
      ? styles.dotOk
      : styles.dotWarn;

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <button type="button" className={styles.menuBtn} aria-label="Menu" onClick={onMenuClick}>
          ☰
        </button>
        <div className={styles.pill}>
          <span className={`${styles.dot} ${healthClass}`} aria-hidden />
          <span>{healthChecking ? "checking" : healthLabel}</span>
        </div>
        <span className={styles.pill}>{sseStatus}</span>
      </div>
      <div className={styles.right}>
        <button type="button" className={styles.secondaryBtn} onClick={onThemeClick}>
          {themeLabel}
        </button>
        <label className={styles.secretWrap}>
          <span className={styles.secretLabel}>Shared Secret</span>
          <input
            className={styles.secretInput}
            type="password"
            value={secret}
            onChange={event => setSecret(event.target.value)}
            placeholder="optional"
            autoComplete="off"
          />
        </label>
      </div>
    </header>
  );
}
