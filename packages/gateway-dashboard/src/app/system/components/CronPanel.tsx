import { formatDateTime, formatTime } from "../../shared/format.js";
import type { CronJob, CronJobFormState } from "../types.js";
import styles from "./CronPanel.module.css";

export function CronPanel({
  jobs,
  form,
  result,
  saving,
  loading,
  onChange,
  onSave,
  onClear,
  onEdit,
  onRemove,
  onTick,
  onRefresh,
}: {
  jobs: readonly CronJob[];
  form: CronJobFormState;
  result: string | null;
  saving: boolean;
  loading: boolean;
  onChange: (patch: Partial<CronJobFormState>) => void;
  onSave: () => void;
  onClear: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onTick: () => void;
  onRefresh: () => void;
}) {
  const canSave = Boolean(
    form.id.trim() && form.schedule.trim() && form.sessionId.trim() && form.message.trim(),
  );

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Cron</h3>
        <div className={styles.headActions}>
          <button type="button" className={styles.secondary} onClick={onTick} disabled={loading}>
            Tick
          </button>
          <button type="button" className={styles.secondary} onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Job ID</span>
          <input
            value={form.id}
            onChange={event => onChange({ id: event.target.value })}
            placeholder="daily-review"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Schedule</span>
          <input
            value={form.schedule}
            onChange={event => onChange({ schedule: event.target.value })}
            placeholder="0 9 * * *"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Session</span>
          <input
            value={form.sessionId}
            onChange={event => onChange({ sessionId: event.target.value })}
            autoComplete="off"
          />
        </label>
      </div>
      <label className={`${styles.field} ${styles.full}`}>
        <span>Message</span>
        <input
          value={form.message}
          onChange={event => onChange({ message: event.target.value })}
          placeholder="Run scheduled task"
          autoComplete="off"
        />
      </label>
      <div className={styles.checkRow}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={event => onChange({ enabled: event.target.checked })}
          />
          Enabled
        </label>
        <button type="button" className={styles.primary} onClick={onSave} disabled={!canSave || saving}>
          {saving ? "Saving…" : "Save job"}
        </button>
        <button type="button" className={styles.secondary} onClick={onClear}>
          Clear
        </button>
      </div>

      {!jobs.length ? (
        <p className={styles.empty}>No cron jobs configured.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Job</th>
                <th>Schedule</th>
                <th>Next</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => {
                const status = job.enabled === false ? "disabled" : (job.lastStatus || "ready");
                const meta = [
                  job.sessionId ?? "",
                  job.lastDeliveredAt ? `last ${formatTime(job.lastDeliveredAt)}` : "",
                  job.lastError ?? "",
                ].filter(Boolean).join(" / ");

                return (
                  <tr key={job.id}>
                    <td>
                      <strong>{job.id}</strong>
                      <span className={`${styles.status} ${styles[`status-${status}`] ?? ""}`}>
                        {status}
                      </span>
                      {meta ? <span className={styles.meta}>{meta}</span> : null}
                    </td>
                    <td>
                      <code>{job.schedule}</code>
                    </td>
                    <td>{job.nextRunAt ? formatDateTime(job.nextRunAt) : ""}</td>
                    <td className={styles.actions}>
                      <button type="button" className={styles.secondary} onClick={() => onEdit(job.id)}>
                        Edit
                      </button>
                      <button type="button" className={styles.danger} onClick={() => void onRemove(job.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result ? <pre className={styles.result}>{result}</pre> : null}
    </section>
  );
}
