import { formatTime, shortId } from "../../shared/format.js";
import type { OrgTicketView } from "../types.js";
import styles from "./TicketsPanel.module.css";

export function TicketsPanel({
  tickets,
  loading,
  onRefresh,
}: {
  tickets: readonly OrgTicketView[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const open = tickets.filter(ticket => ticket.status === "open" || ticket.status === "in_progress");

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>工单 ({open.length} open / {tickets.length} total)</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          刷新
        </button>
      </div>
      {!tickets.length ? (
        <p className={styles.empty}>暂无工单。</p>
      ) : (
        <ul className={styles.list}>
          {tickets.slice(0, 20).map(ticket => (
            <li key={ticket.id} className={styles.item}>
              <strong>{ticket.title}</strong>
              <span className={styles.meta}>
                {ticket.status} · {ticket.assigneeEmployeeId ?? "—"}
                {ticket.runId ? ` · run ${shortId(ticket.runId)}` : ""}
                {ticket.createdAt ? ` · ${formatTime(ticket.createdAt)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
