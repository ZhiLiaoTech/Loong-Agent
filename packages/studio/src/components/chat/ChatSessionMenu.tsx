import { useEffect, useRef, useState } from "react";
import type { ChatSessionMeta } from "../../hooks/useChatSessions.js";
import styles from "./ChatSessionMenu.module.css";

export interface ChatSessionMenuProps {
  sessions: readonly ChatSessionMeta[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  labels: {
    session: string;
    conversation: string;
    newConversation: string;
  };
}

export function ChatSessionMenu({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  labels,
}: ChatSessionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const active = sessions.find(entry => entry.id === activeSessionId);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={styles.label}>{labels.session}</span>
        <span className={styles.title}>{active?.title ?? labels.conversation}</span>
        <span className={styles.chevron} aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div className={styles.menu} role="listbox">
          <button
            type="button"
            className={styles.newBtn}
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
          >
            + {labels.newConversation}
          </button>
          <div className={styles.list}>
            {sessions.map(session => (
              <button
                key={session.id}
                type="button"
                role="option"
                aria-selected={session.id === activeSessionId}
                className={
                  session.id === activeSessionId
                    ? `${styles.item} ${styles.itemActive}`
                    : styles.item
                }
                onClick={() => {
                  onSelect(session.id);
                  setOpen(false);
                }}
              >
                <span className={styles.itemTitle}>{session.title}</span>
                <span className={styles.itemMeta}>
                  {new Date(session.updatedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
