import { useMemo, useState } from "react";
import { GatewayApiError } from "../../../api/index.js";
import { useGatewayClient } from "../../auth/useGatewayClient.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import styles from "../OrganizationWorkspace.module.css";
import { SuiteDirectoryPickerDialog } from "./SuiteDirectoryPickerDialog.js";

interface SuitePackageSummary {
  id?: string;
  name?: string;
  version?: string;
  warnings?: unknown[];
  skills?: unknown[];
}

interface SuiteInstallResult {
  suite?: SuitePackageSummary;
  releaseDir?: string;
  releaseWorkspaceDir?: string;
  recordPath?: string;
  profileId?: string;
  orgEmployeeId?: string;
  toolPolicyId?: string;
  skillsCopied?: unknown[];
  cronsImported?: number;
}

function readSuiteLabel(result: SuiteInstallResult | null): string {
  if (!result?.suite) {
    return "";
  }
  const name = result.suite.name || result.suite.id || "Suite";
  const version = result.suite.version ? ` v${result.suite.version}` : "";
  return `${name}${version}`;
}

interface SuiteImportTabProps {
  onImported?: (result: SuiteInstallResult) => void | Promise<void>;
}

export function SuiteImportTab({ onImported }: SuiteImportTabProps) {
  const client = useGatewayClient();
  const t = useWorkbenchT();
  const [sourceDir, setSourceDir] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuiteInstallResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const suiteLabel = useMemo(() => readSuiteLabel(result), [result]);

  async function handleImport() {
    const trimmed = sourceDir.trim();
    if (!trimmed) {
      setError(t("org.suite.pathRequired"));
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload = await client.rpc<SuiteInstallResult>("suite.install", {
        sourceDir: trimmed,
        overwrite,
        installedAt: new Date().toISOString(),
      });
      setResult(payload);
      await onImported?.(payload);
    } catch (caught) {
      setError(caught instanceof GatewayApiError ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.formStack}>
      <section className={styles.sectionCard}>
        <div className={styles.sectionHeadRow}>
          <div>
            <h3 className={styles.sectionTitle}>{t("org.suite.importTitle")}</h3>
            <p className={styles.sectionHint}>
              {t("org.suite.importHint")}
            </p>
          </div>
        </div>

        <div className={wb.fieldFull}>
          <span>{t("org.suite.pathLabel")}</span>
          <div className={styles.pathPickerRow}>
            <input
              value={sourceDir}
              readOnly
              placeholder={t("org.suite.pathPlaceholder")}
              disabled={busy}
              aria-readonly="true"
            />
            <button
              type="button"
              className={wb.btnSecondary}
              onClick={() => setPickerOpen(true)}
              disabled={busy}
            >
              {t("org.suite.browse")}
            </button>
          </div>
        </div>

        <label className={styles.inlineCheck}>
          <input
            type="checkbox"
            checked={overwrite}
            disabled={busy}
            onChange={event => setOverwrite(event.target.checked)}
          />
          {t("org.suite.overwrite")}
        </label>

        <div className={styles.footerActions}>
          <button
            type="button"
            className={wb.btnPrimary}
            onClick={() => void handleImport()}
            disabled={busy}
          >
            {busy ? t("org.suite.importing") : t("org.suite.importAction")}
          </button>
        </div>
      </section>

      <SuiteDirectoryPickerDialog
        open={pickerOpen}
        initialPath={sourceDir}
        onClose={() => setPickerOpen(false)}
        onSelect={path => {
          setSourceDir(path);
          setPickerOpen(false);
          setError(null);
        }}
      />

      {error ? <p className={wb.bannerError}>{error}</p> : null}

      {result ? (
        <section className={styles.sectionCard} aria-live="polite">
          <h3 className={styles.sectionTitle}>{t("org.suite.importComplete")}</h3>
          <p className={styles.policySummary}>
            {suiteLabel || "Suite"} · {t("org.suite.skillsCopied")}: {result.skillsCopied?.length ?? result.suite?.skills?.length ?? 0}
            {" · "}
            {t("org.suite.cronsImported")}: {result.cronsImported ?? 0}
            {" · "}
            {t("org.suite.warnings")}: {result.suite?.warnings?.length ?? 0}
          </p>
          <ul className={styles.readOnlyList}>
            {result.profileId ? <li>Profile: {result.profileId}</li> : null}
            {result.orgEmployeeId ? <li>Employee: {result.orgEmployeeId}</li> : null}
            {result.toolPolicyId ? <li>Policy: {result.toolPolicyId}</li> : null}
            {result.releaseDir ? <li>Release: {result.releaseDir}</li> : null}
            {result.releaseWorkspaceDir ? <li>Workspace: {result.releaseWorkspaceDir}</li> : null}
            {result.recordPath ? <li>Record: {result.recordPath}</li> : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
