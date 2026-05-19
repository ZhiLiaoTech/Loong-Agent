import type { PluginSummary } from "../types.js";
import styles from "./PluginsPanel.module.css";

export function PluginsPanel({
  plugins,
  loading,
  onRefresh,
}: {
  plugins: readonly PluginSummary[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Plugins ({plugins.length})</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </div>
      {!plugins.length ? (
        <p className={styles.empty}>No plugins loaded.</p>
      ) : (
        <ul className={styles.list}>
          {plugins.map(plugin => {
            const tools = (plugin.tools ?? [])
              .map(tool => `${tool.name}${tool.permission ? `:${tool.permission}` : ""}`)
              .join(", ");
            const providers = (plugin.providers ?? [])
              .map(provider =>
                provider.displayName && provider.displayName !== provider.id
                  ? `${provider.id} (${provider.displayName})`
                  : provider.id,
              )
              .join(", ");
            const memoryBackends = (plugin.memoryBackends ?? [])
              .map(backend =>
                backend.displayName && backend.displayName !== backend.id
                  ? `${backend.id} (${backend.displayName})`
                  : backend.id,
              )
              .join(", ");
            const hooks = (plugin.lifecycleHooks ?? []).join(", ");
            const details = [
              plugin.description ?? "",
              tools ? `tools: ${tools}` : "",
              providers ? `providers: ${providers}` : "",
              memoryBackends ? `memory: ${memoryBackends}` : "",
              hooks ? `hooks: ${hooks}` : "",
            ].filter(Boolean);

            const counts = `${(plugin.tools ?? []).length} tools / ${(plugin.providers ?? []).length} providers / ${(plugin.memoryBackends ?? []).length} memory`;

            return (
              <li key={plugin.name} className={styles.item}>
                <div className={styles.itemHead}>
                  <strong>{plugin.name}</strong>
                  {plugin.version ? <span className={styles.version}>{plugin.version}</span> : null}
                </div>
                <p className={styles.counts}>{counts}</p>
                {details.length ? <pre className={styles.details}>{details.join("\n")}</pre> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
