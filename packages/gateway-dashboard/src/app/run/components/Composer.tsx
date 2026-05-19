import { useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./Composer.module.css";

export interface ComposerProps {
  disabled: boolean;
  onSend: (message: string) => void;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [message, setMessage] = useState("");

  function submit() {
    const value = message.trim();
    if (!value || disabled) {
      return;
    }
    onSend(value);
    setMessage("");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      <textarea
        className={styles.input}
        value={message}
        onChange={event => setMessage(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask Dragon…"
        rows={3}
        disabled={disabled}
      />
      <div className={styles.actions}>
        <span className={styles.hint}>Enter to send · Shift+Enter for newline</span>
        <button type="submit" className={styles.sendBtn} disabled={disabled || !message.trim()}>
          Send
        </button>
      </div>
    </form>
  );
}
