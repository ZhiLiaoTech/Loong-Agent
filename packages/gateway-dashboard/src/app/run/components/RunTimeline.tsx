import type { GatewayEventEnvelope } from "../../../api/index.js";
import styles from "./RunTimeline.module.css";

function labelForEvent(event: GatewayEventEnvelope["event"]): string {
  if (event.type === "lifecycle") {
    return `lifecycle:${event.phase ?? ""}`;
  }
  return event.type || "event";
}

function detailForEvent(event: GatewayEventEnvelope["event"]): string {
  return String(event.text || event.message || event.toolName || "");
}

export function RunTimeline({
  activeRunId,
  events,
}: {
  activeRunId: string;
  events: readonly GatewayEventEnvelope[];
}) {
  const filtered = activeRunId
    ? events.filter(envelope => envelope.event?.runId === activeRunId)
    : [];

  return (
    <section className={styles.card}>
      <h3 className={styles.title}>Run timeline</h3>
      {!activeRunId ? (
        <p className={styles.muted}>Start a run to see lifecycle and tool events.</p>
      ) : !filtered.length ? (
        <p className={styles.muted}>Waiting for events for this run…</p>
      ) : (
        <ul className={styles.list}>
          {filtered.slice(0, 24).map(envelope => (
            <li key={envelope.sequence} className={`${styles.item} ${styles[`type-${envelope.event.type}`] ?? ""}`}>
              <span className={styles.label}>{labelForEvent(envelope.event)}</span>
              {detailForEvent(envelope.event) ? (
                <span className={styles.detail}>{detailForEvent(envelope.event)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
