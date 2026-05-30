import { useCallback, useState } from "react";
import styles from "./AuthBanner.module.css";

const START_COMMAND =
  "loong gateway --host 127.0.0.1 --port 18787 --secret <your-secret>";

export function AuthBanner({ visible }: { visible: boolean }) {
  const [copied, setCopied] = useState(false);

  const copyCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(START_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className={styles.banner} role="status">
      <p className={styles.text}>
        Authentication required. Enter the gateway shared secret in the top bar to use RPC and
        streaming.
      </p>
      <div className={styles.actions}>
        <code className={styles.code}>{START_COMMAND}</code>
        <button type="button" className={styles.copyBtn} onClick={() => void copyCommand()}>
          {copied ? "Copied" : "Copy start command"}
        </button>
      </div>
    </div>
  );
}
