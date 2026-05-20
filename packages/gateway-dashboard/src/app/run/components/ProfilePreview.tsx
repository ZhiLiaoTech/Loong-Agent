import type { AgentProfile, RunSettings } from "../types.js";
import styles from "./ProfilePreview.module.css";

export function ProfilePreview({
  profile,
  settings,
}: {
  profile: AgentProfile | undefined;
  settings: RunSettings;
}) {
  if (!profile) {
    return (
      <section className={styles.card}>
        <h3 className={styles.title}>Profile preview</h3>
        <p className={styles.muted}>Select a profile to see defaults applied to this run.</p>
      </section>
    );
  }

  const model = settings.model.trim() || profile.defaultModel || "—";
  const workspace = settings.workspace.trim() || profile.workspace || "—";
  const thinking = settings.thinking || profile.thinking || "default";
  const employee = settings.employeeId.trim() || "—";

  return (
    <section className={styles.card}>
      <h3 className={styles.title}>{profile.name || profile.id}</h3>
      {profile.description ? <p className={styles.muted}>{profile.description}</p> : null}
      <dl className={styles.kv}>
        <dt>Employee</dt>
        <dd>{employee}</dd>
        <dt>Model</dt>
        <dd>{model}</dd>
        <dt>Workspace</dt>
        <dd>{workspace}</dd>
        <dt>Thinking</dt>
        <dd>{thinking}</dd>
        <dt>Tools</dt>
        <dd>{profile.toolsEnabled === false ? "off" : "on"}</dd>
        <dt>Memory</dt>
        <dd>{profile.memoryEnabled === false ? "off" : "on"}</dd>
      </dl>
      {profile.systemPrompt ? (
        <details className={styles.details}>
          <summary>Instructions</summary>
          <pre className={styles.pre}>{profile.systemPrompt}</pre>
        </details>
      ) : null}
    </section>
  );
}
