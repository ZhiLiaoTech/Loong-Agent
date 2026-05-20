import styles from "./KpiSnapshotPanel.module.css";

export interface KpiMetricView {
  id: string;
  name: string;
  value: number;
}

export function KpiSnapshotPanel({
  templateName,
  employeeId,
  metrics,
  loading,
  onRefresh,
}: {
  templateName: string;
  employeeId: string;
  metrics: readonly KpiMetricView[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>KPI 快照</h3>
          <p className={styles.subtitle}>
            {templateName || "未配置模板"}
            {employeeId ? ` · ${employeeId}` : ""}
          </p>
        </div>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading || !templateName}>
          刷新
        </button>
      </div>
      {!templateName ? (
        <p className={styles.empty}>当前员工未绑定 KPI 模板。</p>
      ) : (
        <ul className={styles.metrics}>
          {metrics.map(metric => (
            <li key={metric.id} className={styles.metric}>
              <span>{metric.name}</span>
              <strong>{metric.value}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
