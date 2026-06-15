import { useCallback, useEffect, useState } from "react";
import { GatewayApiError } from "../../../api/index.js";
import { useGatewayClient } from "../../auth/useGatewayClient.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import styles from "../OrganizationWorkspace.module.css";

interface DirectoryBrowseEntry {
  name: string;
  path: string;
}

interface DirectoryBrowseResult {
  path: string;
  label: string;
  parent?: string;
  entries: DirectoryBrowseEntry[];
}

export function SuiteDirectoryPickerDialog({
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
  const client = useGatewayClient();
  const t = useWorkbenchT();
  const [browse, setBrowse] = useState<DirectoryBrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await client.rpc<DirectoryBrowseResult>("fs.directory.browse", {
        ...(path ? { path } : {}),
      });
      setBrowse(payload);
    } catch (caught) {
      const message = caught instanceof GatewayApiError || caught instanceof Error
        ? caught.message
        : t("org.suite.browseError");
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
    <div className={styles.directoryBackdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.directoryDialog}
        role="dialog"
        aria-modal="true"
        aria-label={t("org.suite.browseTitle")}
        onClick={event => event.stopPropagation()}
      >
        <h3 className={styles.directoryTitle}>{t("org.suite.browseTitle")}</h3>
        <p className={styles.directoryHint}>{t("org.suite.browseHint")}</p>

        <div className={styles.directoryToolbar}>
          <button
            type="button"
            className={wb.btnSecondary}
            disabled={loading || browse?.parent === undefined}
            onClick={() => {
              if (browse?.parent === undefined) {
                return;
              }
              void loadDirectory(browse.parent || undefined);
            }}
          >
            {t("org.suite.browseUp")}
          </button>
          <div className={styles.directoryCurrentPath} title={browse?.path || browse?.label}>
            {browse?.label || t("org.suite.browseLoading")}
          </div>
        </div>

        <div className={styles.directoryList} aria-busy={loading}>
          {loading ? <p className={styles.directoryStatus}>{t("org.suite.browseLoading")}</p> : null}
          {!loading && error ? <p className={styles.directoryError}>{error}</p> : null}
          {!loading && !error && browse?.entries.length === 0 ? (
            <p className={styles.directoryStatus}>{t("org.suite.browseEmpty")}</p>
          ) : null}
          {!loading && !error
            ? browse?.entries.map(entry => (
                <button
                  key={entry.path}
                  type="button"
                  className={styles.directoryRow}
                  onClick={() => void loadDirectory(entry.path)}
                >
                  <span className={styles.directoryIcon} aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className={styles.directoryName}>{entry.name}</span>
                </button>
              ))
            : null}
        </div>

        <div className={styles.directoryActions}>
          <button type="button" className={wb.btnSecondary} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={wb.btnPrimary}
            disabled={!canSelect || loading}
            onClick={() => {
              if (!browse?.path) {
                return;
              }
              onSelect(browse.path);
            }}
          >
            {t("org.suite.browseSelect")}
          </button>
        </div>
      </div>
    </div>
  );
}
