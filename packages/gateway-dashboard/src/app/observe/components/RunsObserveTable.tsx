import { shortId } from "../../shared/format.js";
import type { GatewayRunRecord } from "../types.js";
import styles from "./RunsObserveTable.module.css";

export function RunsObserveTable({
  runs,
  loading,
  onRefresh,
  onCancel,
  title = "Runs",
  refreshLabel = "Refresh",
  emptyLabel = "No runs yet.",
  cancelLabel = "Cancel",
}: {
  runs: readonly GatewayRunRecord[];
  loading: boolean;
  onRefresh: () => void;
  onCancel: (runId: string) => void;
  title?: string;
  refreshLabel?: string;
  emptyLabel?: string;
  cancelLabel?: string;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>{title} ({runs.length})</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          {refreshLabel}
        </button>
      </div>
      {!runs.length ? (
        <p className={styles.empty}>{emptyLabel}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>State</th>
                <th>Run</th>
                <th>Preview</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map(run => {
                const canCancel = run.state === "running" || run.state === "cancelling";
                return (
                  <tr key={run.runId}>
                    <td>
                      <span className={`${styles.state} ${styles[`state-${run.state}`] ?? ""}`}>
                        {run.state}
                      </span>
                    </td>
                    <td>
                      <code className={styles.code}>{shortId(run.runId)}</code>
                      {run.sessionId ? <span className={styles.subtle}>{run.sessionId}</span> : null}
                    </td>
                    <td className={styles.preview}>
                      {run.result?.assistantPreview || run.messagePreview || run.error || ""}
                    </td>
                    <td>
                      {canCancel ? (
                        <button
                          type="button"
                          className={styles.danger}
                          onClick={() => void onCancel(run.runId)}
                        >
                          {cancelLabel}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
