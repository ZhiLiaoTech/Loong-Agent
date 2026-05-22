import { useEffect, useRef } from "react";
import type { ChatTurn } from "../types.js";
import styles from "./ChatTranscript.module.css";

function chatRolePrefix(role: ChatTurn["role"]): string {
  return role === "assistant" ? "🤖" : "我";
}

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
                : `${styles.bubble} ${styles.assistant}${turn.streaming ? ` ${styles.streaming}` : ""}${turn.outcome ? ` ${styles[turn.outcome]}` : ""}`
            }
          >
            <div className={styles.contentLine}>
              <span className={styles.meta}>{chatRolePrefix(turn.role)}：</span>
              {turn.text ? <span className={styles.text}>{turn.text}</span> : null}
            </div>
            {turn.errorDetail ? (
              <p className={styles.errorDetail} role="alert">
                {turn.errorDetail}
              </p>
            ) : null}
          </article>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
