import type { AgentProfile } from "../types.js";
import styles from "./AgentProfilesTable.module.css";

export interface AgentProfilesTableProps {
  profiles: readonly AgentProfile[];
  defaultProfileId?: string;
  configPath?: string;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export function AgentProfilesTable({
  profiles,
  defaultProfileId,
  configPath,
  onEdit,
  onRemove,
}: AgentProfilesTableProps) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Profiles ({profiles.length})</h3>
        {configPath ? <span className={styles.path}>{configPath}</span> : null}
      </div>
      {!profiles.length ? (
        <p className={styles.empty}>No agent profiles configured.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Model</th>
                <th>Workspace</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {profiles.map(profile => {
                const meta = [
                  defaultProfileId === profile.id ? "default" : "",
                  profile.thinking ? `thinking: ${profile.thinking}` : "",
                  profile.memoryEnabled === false ? "memory off" : "",
                  profile.toolsEnabled === false ? "tools off" : "",
                  profile.description ?? "",
                ].filter(Boolean).join(" · ");

                return (
                  <tr key={profile.id}>
                    <td>
                      <strong>{profile.name || profile.id}</strong>
                      <code className={styles.code}>{profile.id}</code>
                      {meta ? <div className={styles.meta}>{meta}</div> : null}
                    </td>
                    <td>{profile.defaultModel || "—"}</td>
                    <td>{profile.workspace || "—"}</td>
                    <td className={styles.actions}>
                      <button type="button" className={styles.secondary} onClick={() => onEdit(profile.id)}>
                        Edit
                      </button>
                      <button type="button" className={styles.danger} onClick={() => onRemove(profile.id)}>
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
