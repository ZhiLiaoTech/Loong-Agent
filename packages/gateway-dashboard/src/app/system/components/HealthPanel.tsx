import { formatMs } from "../../shared/format.js";
import type { HealthState } from "../types.js";
import styles from "./HealthPanel.module.css";

export function HealthPanel({
  health,
  loading,
  onRefresh,
}: {
  health: HealthState;
  loading: boolean;
  onRefresh: () => void;
}) {
  const online = health.status === "online";

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Gateway</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </div>
      <p className={online ? styles.online : styles.offline}>
        {health.status === "loading" ? "Checking…" : online ? "Online" : "Offline"}
      </p>
      {health.status === "online" ? (
        <dl className={styles.kv}>
          <dt>Name</dt>
          <dd>{health.payload.name}</dd>
          <dt>Address</dt>
          <dd>
            {typeof health.payload.address === "object" && health.payload.address !== null
              ? (health.payload.address.url ?? window.location.origin)
              : (health.payload.address ?? window.location.origin)}
          </dd>
          <dt>Uptime</dt>
          <dd>{formatMs(health.payload.uptimeMs ?? 0)}</dd>
          <dt>Providers</dt>
          <dd>{health.payload.providerCount ?? 0}</dd>
          <dt>Plugins</dt>
          <dd>{health.payload.pluginCount ?? 0}</dd>
        </dl>
      ) : health.status === "offline" ? (
        <p className={styles.error}>{health.error}</p>
      ) : null}
    </section>
  );
}
