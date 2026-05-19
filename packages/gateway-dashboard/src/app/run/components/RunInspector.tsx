import type { AgentRunResult } from "../types.js";
import styles from "./RunInspector.module.css";

export interface RunInspectorProps {
  activeRunId: string;
  lastResult: AgentRunResult | null;
  cancelError: string | null;
  showRaw: boolean;
  onToggleRaw: () => void;
  onCancel: () => void;
}

export function RunInspector({
  activeRunId,
  lastResult,
  cancelError,
  showRaw,
  onToggleRaw,
  onCancel,
}: RunInspectorProps) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Run inspector</h3>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onToggleRaw}>
            {showRaw ? "Hide JSON" : "Raw JSON"}
          </button>
          <button
            type="button"
            className={styles.danger}
            onClick={() => void onCancel()}
            disabled={!activeRunId}
          >
            Cancel
          </button>
        </div>
      </div>
      <dl className={styles.kv}>
        <dt>Run ID</dt>
        <dd>{activeRunId || lastResult?.runId || "—"}</dd>
        <dt>Status</dt>
        <dd>{lastResult?.status || "—"}</dd>
      </dl>
      {cancelError ? <p className={styles.error}>{cancelError}</p> : null}
      {showRaw ? (
        <pre className={styles.pre}>
          {lastResult ? JSON.stringify(lastResult, null, 2) : "No result yet."}
        </pre>
      ) : null}
    </section>
  );
}
