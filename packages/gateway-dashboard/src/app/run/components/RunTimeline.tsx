import type { GatewayEventEnvelope } from "../../../api/index.js";
import {
  cssClassForGatewayEvent,
  detailForGatewayEvent,
  labelForGatewayEvent,
} from "../../events/formatGatewayEvent.js";
import styles from "./RunTimeline.module.css";

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
          {filtered.slice(0, 24).map(envelope => {
            const event = envelope.event;
            const detail = detailForGatewayEvent(event);
            const eventClass = cssClassForGatewayEvent(event);
            return (
              <li
                key={envelope.sequence}
                className={`${styles.item} ${eventClass ? styles[eventClass] : ""}`}
              >
                <span className={styles.label}>{labelForGatewayEvent(event)}</span>
                {detail ? <span className={styles.detail}>{detail}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
