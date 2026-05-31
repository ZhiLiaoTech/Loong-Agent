import styles from "./CronTasksTab.module.css";
import type { EmployeeCronJob } from "../useEmployeeCronJobs.js";

export interface CronTasksTabProps {
  jobs: EmployeeCronJob[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  onToggle: (job: EmployeeCronJob) => void;
  onRefresh: () => void;
}

function formatNextRun(value?: string): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function CronTasksTab(props: CronTasksTabProps) {
  const { jobs, loading, error, busyId, onToggle, onRefresh } = props;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>定时任务</h2>
          <p className={styles.lead}>展示该数字员工的定时任务，使用开关启用或停用。</p>
        </div>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {!loading && jobs.length === 0 ? (
        <p className={styles.empty}>暂无定时任务。</p>
      ) : (
        <ul className={styles.list}>
          {jobs.map(job => (
            <li key={job.id} className={styles.item}>
              <div className={styles.info}>
                <span className={styles.message}>{job.message || job.id}</span>
                <span className={styles.meta}>
                  <code className={styles.schedule}>{job.schedule}</code>
                  <span className={styles.next}>下次：{formatNextRun(job.nextRunAt)}</span>
                  <span className={job.enabled ? styles.on : styles.off}>
                    {job.enabled ? "已启用" : "已停用"}
                  </span>
                </span>
              </div>
              <label className={styles.switch} aria-label={`切换 ${job.message || job.id}`}>
                <input
                  type="checkbox"
                  checked={job.enabled}
                  disabled={busyId === job.id}
                  onChange={() => onToggle(job)}
                />
                <span className={styles.switchTrack} aria-hidden />
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
