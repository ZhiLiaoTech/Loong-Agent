import type { ToolCatalogEntry } from "../types.js";
import styles from "./ToolsPanel.module.css";

export function ToolsPanel({
  tools,
  workspace,
  result,
  loading,
  onWorkspaceChange,
  onRefresh,
  onInvoke,
}: {
  tools: readonly ToolCatalogEntry[];
  workspace: string;
  result: string | null;
  loading: boolean;
  onWorkspaceChange: (value: string) => void;
  onRefresh: () => void;
  onInvoke: (toolName: string) => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Tools ({tools.length})</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </div>
      <label className={styles.workspaceField}>
        <span>Workspace (optional, for tool.invoke)</span>
        <input
          value={workspace}
          onChange={event => onWorkspaceChange(event.target.value)}
          placeholder="optional"
          autoComplete="off"
        />
      </label>
      {!tools.length ? (
        <p className={styles.empty}>No tools available.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Access</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tools.map(tool => {
                const access = [
                  tool.permission ? `permission: ${tool.permission}` : "",
                  tool.capabilities?.length ? `capabilities: ${tool.capabilities.join(", ")}` : "",
                  tool.directInvokeAllowed ? "direct: yes" : "direct: no",
                ].filter(Boolean).join("\n");

                return (
                  <tr key={tool.name}>
                    <td>
                      <strong>{tool.name}</strong>
                      {tool.description ? (
                        <span className={styles.description}>{tool.description}</span>
                      ) : null}
                    </td>
                    <td>
                      <pre className={styles.access}>{access || "—"}</pre>
                    </td>
                    <td>
                      {tool.directInvokeAllowed ? (
                        <button
                          type="button"
                          className={styles.secondary}
                          onClick={() => void onInvoke(tool.name)}
                        >
                          Run
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
      {result ? <pre className={styles.result}>{result}</pre> : null}
    </section>
  );
}
