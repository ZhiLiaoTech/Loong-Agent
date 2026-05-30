import type { GatewayEventEnvelope, SseConnectionStatus } from "../../../api/index.js";
import { formatTime, shortId } from "../../shared/format.js";
import {
  cssClassForGatewayEvent,
  detailForGatewayEvent,
  labelForGatewayEvent,
} from "../../events/formatGatewayEvent.js";
import styles from "./EventsFeed.module.css";

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
            const detail = detailForGatewayEvent(event);
            const eventClass = cssClassForGatewayEvent(event);
            return (
              <li
                key={envelope.sequence}
                className={`${styles.item} ${eventClass ? styles[eventClass] : ""} ${event.type ? styles[`type-${event.type}`] : ""}`}
              >
                <div className={styles.line}>
                  <strong>{labelForGatewayEvent(event)}</strong>
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
