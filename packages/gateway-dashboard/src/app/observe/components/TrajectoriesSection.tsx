import { formatTime, shortId } from "../../shared/format.js";
import type { TrajectorySummary } from "../types.js";
import styles from "./TrajectoriesSection.module.css";

export function TrajectoriesSection({
  trajectories,
  detail,
  loading,
  onRefresh,
  onView,
}: {
  trajectories: readonly TrajectorySummary[];
  detail: string | null;
  loading: boolean;
  onRefresh: () => void;
  onView: (runId: string) => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Trajectory</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </div>
      {!trajectories.length ? (
        <p className={styles.empty}>No trajectory for this session.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Run</th>
                <th>Prompt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trajectories.map(item => (
                <tr key={item.runId}>
                  <td>
                    <span className={`${styles.state} ${styles[`state-${item.status}`] ?? ""}`}>
                      {item.status || "—"}
                    </span>
                  </td>
                  <td>
                    <code className={styles.code}>{shortId(item.runId)}</code>
                    {item.createdAt ? (
                      <span className={styles.subtle}>{formatTime(item.createdAt)}</span>
                    ) : null}
                  </td>
                  <td className={styles.preview}>{item.userPreview || ""}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => void onView(item.runId)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail ? <pre className={styles.detail}>{detail}</pre> : null}
    </section>
  );
}
