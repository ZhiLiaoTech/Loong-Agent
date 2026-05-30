import type { GatewayEventEnvelope } from "../../../api/index.js";
import { formatTime, shortId } from "../../shared/format.js";
import {
  cssClassForGatewayEvent,
  detailForGatewayEvent,
  labelForGatewayEvent,
  type TranslateFn,
} from "../../events/formatGatewayEvent.js";
import styles from "./WarRoomPanel.module.css";

export function WarRoomPanel({
  title,
  emptyHint,
  waitingHint,
  activeRunId,
  events,
  translate,
  highlightSequence,
}: {
  title: string;
  emptyHint: string;
  waitingHint: string;
  activeRunId: string;
  events: readonly GatewayEventEnvelope[];
  translate: TranslateFn;
  highlightSequence?: number;
}) {
  const filtered = activeRunId
    ? events.filter(envelope => envelope.event?.runId === activeRunId)
    : [];

  return (
    <section className={styles.panel} aria-label={title}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.count}>{filtered.length}</span>
      </header>
      {!activeRunId ? (
        <p className={styles.muted}>{emptyHint}</p>
      ) : !filtered.length ? (
        <p className={styles.muted}>{waitingHint}</p>
      ) : (
        <ul className={styles.list}>
          {filtered.map(envelope => {
            const event = envelope.event;
            const detail = detailForGatewayEvent(event, translate);
            const eventClass = cssClassForGatewayEvent(event);
            return (
              <li
                key={envelope.sequence}
                className={`${styles.item} ${eventClass ? styles[eventClass] : ""}${highlightSequence === envelope.sequence ? ` ${styles.itemHighlighted}` : ""}`}
              >
                <div className={styles.line}>
                  <span className={styles.label}>{labelForGatewayEvent(event, translate)}</span>
                  <time className={styles.time}>{formatTime(envelope.timestamp)}</time>
                </div>
                <div className={styles.meta}>{shortId(event.runId ?? "")}</div>
                {detail ? <pre className={styles.detail}>{detail}</pre> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
