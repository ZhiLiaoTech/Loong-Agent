import { useCallback, useEffect, useState } from "react";
import { useGatewayClient } from "@dashboard/app/auth/useGatewayClient.js";
import { useI18n } from "../../i18n/I18nContext.js";
import styles from "./DirectoryBrowserDialog.module.css";

export interface DirectoryBrowseEntry {
  name: string;
  path: string;
}

export interface DirectoryBrowseResult {
  path: string;
  label: string;
  parent?: string;
  entries: DirectoryBrowseEntry[];
}

export function DirectoryBrowserDialog({
  open,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const { t } = useI18n();
  const client = useGatewayClient();
  const [browse, setBrowse] = useState<DirectoryBrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.rpc<DirectoryBrowseResult>("fs.directory.browse", {
        ...(path ? { path } : {}),
      });
      setBrowse(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("chat.scopeBrowseError");
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [client, t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadDirectory(initialPath?.trim() || undefined);
  }, [initialPath, loadDirectory, open]);

  if (!open) {
    return null;
  }

  const canSelect = Boolean(browse?.path);

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t("chat.scopePickDirectory")}
        onClick={event => event.stopPropagation()}
      >
        <h3 className={styles.dialogTitle}>{t("chat.scopePickDirectory")}</h3>
        <p className={styles.dialogHint}>{t("chat.scopePickDirectoryHint")}</p>

        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.upBtn}
            disabled={loading || browse?.parent === undefined}
            onClick={() => {
              if (browse?.parent === undefined) {
                return;
              }
              void loadDirectory(browse.parent || undefined);
            }}
          >
            {t("chat.scopeBrowseUp")}
          </button>
          <div className={styles.currentPath} title={browse?.path || browse?.label}>
            {browse?.label || t("chat.scopeBrowseLoading")}
          </div>
        </div>

        <div className={styles.list} aria-busy={loading}>
          {loading ? <p className={styles.status}>{t("chat.scopeBrowseLoading")}</p> : null}
          {!loading && error ? <p className={styles.error}>{error}</p> : null}
          {!loading && !error && browse?.entries.length === 0 ? (
            <p className={styles.status}>{t("chat.scopeBrowseEmpty")}</p>
          ) : null}
          {!loading && !error
            ? browse?.entries.map(entry => (
                <button
                  key={entry.path}
                  type="button"
                  className={styles.folderBtn}
                  onClick={() => void loadDirectory(entry.path)}
                >
                  <span className={styles.folderIcon} aria-hidden="true">📁</span>
                  <span className={styles.folderName}>{entry.name}</span>
                </button>
              ))
            : null}
        </div>

        <div className={styles.dialogActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            disabled={!canSelect || loading}
            onClick={() => {
              if (!browse?.path) {
                return;
              }
              onSelect(browse.path);
            }}
          >
            {t("chat.scopeBrowseSelect")}
          </button>
        </div>
      </div>
    </div>
  );
}
