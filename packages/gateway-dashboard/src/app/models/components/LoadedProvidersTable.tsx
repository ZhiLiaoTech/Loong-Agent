import type { GatewayProviderSummary } from "../types.js";
import { formatCompactNumber } from "../formatCompactNumber.js";
import styles from "./LoadedProvidersTable.module.css";

function formatModelLine(provider: GatewayProviderSummary): string {
  return (provider.models ?? [])
    .map(model => {
      const badges = [
        model.default ? "default" : "",
        model.capabilities?.toolCalling ? "tools" : "",
        model.contextWindow ? `${formatCompactNumber(model.contextWindow)} ctx` : "",
      ].filter(Boolean).join(" / ");
      return badges ? `${model.id} (${badges})` : model.id;
    })
    .join("\n");
}

export function LoadedProvidersTable({
  providers,
  loading,
  onRefresh,
}: {
  providers: readonly GatewayProviderSummary[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Loaded providers ({providers.length})</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </div>
      {!providers.length ? (
        <p className={styles.empty}>
          No providers loaded yet. Add a provider above or click Refresh after saving.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Default model</th>
                <th>Models</th>
                <th>Tools</th>
              </tr>
            </thead>
            <tbody>
              {providers.map(provider => (
                <tr key={provider.id}>
                  <td>
                    <strong>{provider.id}</strong>
                    {provider.displayName ? (
                      <div className={styles.subtle}>{provider.displayName}</div>
                    ) : null}
                  </td>
                  <td>{provider.defaultModel || "—"}</td>
                  <td>
                    <pre className={styles.pre}>{formatModelLine(provider) || "—"}</pre>
                  </td>
                  <td>{provider.supportsToolCalling ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
