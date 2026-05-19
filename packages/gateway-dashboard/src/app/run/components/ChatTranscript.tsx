import { useEffect, useRef } from "react";
import type { ChatTurn } from "../types.js";
import styles from "./ChatTranscript.module.css";

export function ChatTranscript({ turns }: { turns: readonly ChatTurn[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  return (
    <div className={styles.transcript} aria-live="polite">
      {!turns.length ? (
        <p className={styles.empty}>Send a message to start a run.</p>
      ) : (
        turns.map((turn, index) => (
          <article
            key={`${turn.role}-${index}-${turn.streaming ? "stream" : "done"}`}
            className={
              turn.role === "user"
                ? `${styles.bubble} ${styles.user}`
                : `${styles.bubble} ${styles.assistant}${turn.streaming ? ` ${styles.streaming}` : ""}`
            }
          >
            <div className={styles.meta}>{turn.role}</div>
            <div className={styles.text}>{turn.text}</div>
          </article>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
