import type { GatewayRunRecord } from "../types.js";
import styles from "./RecentRunsList.module.css";

function shortId(value: string): string {
  return value ? value.slice(0, 8) : "";
}

export function RecentRunsList({
  runs,
  onRefresh,
}: {
  runs: readonly GatewayRunRecord[];
  onRefresh: () => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Recent runs</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {!runs.length ? (
        <p className={styles.muted}>No runs yet.</p>
      ) : (
        <ul className={styles.list}>
          {runs.map(run => (
            <li key={run.runId} className={styles.item}>
              <span className={`${styles.state} ${styles[`state-${run.state}`] ?? ""}`}>{run.state}</span>
              <span className={styles.id}>{shortId(run.runId)}</span>
              <span className={styles.preview}>
                {run.result?.assistantPreview || run.messagePreview || run.error || ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
