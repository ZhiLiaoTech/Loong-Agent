import { useState } from "react";
import type { PendingApprovalItem } from "../usePendingApprovals.js";
import styles from "./PendingApprovalPanel.module.css";

export function PendingApprovalPanel({
  approvals,
  title,
  approveLabel,
  rejectLabel,
  inboxLabel,
  resolvingLabel,
  onApprove,
  onReject,
  onOpenInbox,
}: {
  approvals: readonly PendingApprovalItem[];
  title: string;
  approveLabel: string;
  rejectLabel: string;
  inboxLabel: string;
  resolvingLabel: string;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onOpenInbox?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!approvals.length) {
    return null;
  }

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      await onApprove(id);
    } finally {
      setBusyId(current => (current === id ? null : current));
    }
  };

  const handleReject = async (id: string) => {
    setBusyId(id);
    try {
      await onReject(id);
    } finally {
      setBusyId(current => (current === id ? null : current));
    }
  };

  return (
    <section className={styles.panel} aria-live="polite">
      {approvals.map(item => {
        const busy = busyId === item.id;
        return (
          <article key={item.id} className={styles.card}>
            <div className={styles.head}>
              <h3 className={styles.title}>{title}</h3>
              <span className={styles.badge}>{item.toolName}</span>
            </div>
            <p className={styles.toolName}>{item.toolName}</p>
            {item.reason ? <p className={styles.reason}>{item.reason}</p> : null}
            {item.inputSummary ? <pre className={styles.input}>{item.inputSummary}</pre> : null}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.approve}
                disabled={busy}
                onClick={() => void handleApprove(item.id)}
              >
                {busy ? resolvingLabel : approveLabel}
              </button>
              <button
                type="button"
                className={styles.reject}
                disabled={busy}
                onClick={() => void handleReject(item.id)}
              >
                {rejectLabel}
              </button>
              {onOpenInbox ? (
                <button
                  type="button"
                  className={styles.inboxLink}
                  disabled={busy}
                  onClick={onOpenInbox}
                >
                  {inboxLabel}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
