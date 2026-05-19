import type { GatewayEventEnvelope, SseConnectionStatus } from "../../../api/types.js";
import { formatTime, shortId } from "../../shared/format.js";
import styles from "./EventsFeed.module.css";

function labelForEvent(event: GatewayEventEnvelope["event"]): string {
  if (event.type === "lifecycle") {
    return `${event.type}:${event.phase ?? ""}`;
  }
  return event.type || "event";
}

function detailForEvent(event: GatewayEventEnvelope["event"]): string {
  return String(event.text || event.message || event.toolName || "");
}

export function EventsFeed({
  events,
  sseStatus,
  onReconnect,
}: {
  events: readonly GatewayEventEnvelope[];
  sseStatus: SseConnectionStatus;
  onReconnect: () => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Events ({events.length})</h3>
        <div className={styles.actions}>
          <span className={`${styles.status} ${styles[`status-${sseStatus}`] ?? ""}`}>{sseStatus}</span>
          <button type="button" className={styles.refresh} onClick={onReconnect}>
            Reconnect
          </button>
        </div>
      </div>
      {!events.length ? (
        <p className={styles.empty}>No events yet.</p>
      ) : (
        <ul className={styles.list}>
          {events.map(envelope => {
            const event = envelope.event;
            const detail = detailForEvent(event);
            return (
              <li
                key={envelope.sequence}
                className={`${styles.item} ${event.type ? styles[`type-${event.type}`] : ""}`}
              >
                <div className={styles.line}>
                  <strong>{labelForEvent(event)}</strong>
                  <span className={styles.time}>{formatTime(envelope.timestamp)}</span>
                </div>
                <div className={styles.meta}>
                  {shortId(event.runId ?? "")}
                  {envelope.sessionId ? ` / ${envelope.sessionId}` : ""}
                </div>
                {detail ? <pre className={styles.detail}>{detail}</pre> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
