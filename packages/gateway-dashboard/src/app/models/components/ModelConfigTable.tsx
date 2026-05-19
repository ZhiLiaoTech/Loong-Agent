import type { ModelProviderConfig } from "../types.js";
import styles from "./ModelConfigTable.module.css";

export interface ModelConfigTableProps {
  providers: readonly ModelProviderConfig[];
  configPath?: string;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export function ModelConfigTable({ providers, configPath, onEdit, onRemove }: ModelConfigTableProps) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Configured ({providers.length})</h3>
        {configPath ? <span className={styles.path}>{configPath}</span> : null}
      </div>
      {!providers.length ? (
        <p className={styles.empty}>No model providers configured.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Type</th>
                <th>Model</th>
                <th>Key</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {providers.map(provider => {
                const meta = [
                  provider.enabled === false ? "disabled" : "enabled",
                  provider.displayName ?? "",
                  provider.baseUrl ?? "",
                ].filter(Boolean).join(" · ");
                const keyStatus = provider.apiKeyConfigured || provider.apiKey ? "configured" : "missing";

                return (
                  <tr key={provider.id}>
                    <td>
                      <strong>{provider.id}</strong>
                      {meta ? <div className={styles.meta}>{meta}</div> : null}
                    </td>
                    <td>{provider.type}</td>
                    <td>{provider.defaultModel || "—"}</td>
                    <td>{keyStatus}</td>
                    <td className={styles.actions}>
                      <button type="button" className={styles.secondary} onClick={() => onEdit(provider.id)}>
                        Edit
                      </button>
                      <button type="button" className={styles.danger} onClick={() => onRemove(provider.id)}>
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
    </section>
  );
}
