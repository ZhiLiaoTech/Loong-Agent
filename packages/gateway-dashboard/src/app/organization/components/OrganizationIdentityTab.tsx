import type {
  OrgEmployeeFormState,
  OrgPeerEmployee,
  OrgPolicyOption,
  OrgPositionOption,
  OrgUnitOption,
} from "../types.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import modelStyles from "../../models/ModelsWorkspace.module.css";
import styles from "../OrganizationWorkspace.module.css";

interface OrganizationIdentityTabProps {
  form: OrgEmployeeFormState;
  units: readonly OrgUnitOption[];
  positions: readonly OrgPositionOption[];
  policies: readonly OrgPolicyOption[];
  peers: readonly OrgPeerEmployee[];
  policy?: OrgPolicyOption;
  managerName?: string;
  saving: boolean;
  onChange: (patch: Partial<OrgEmployeeFormState>) => void;
  onSave: () => void;
}

export function OrganizationIdentityTab({
  form,
  units,
  positions,
  policies,
  peers,
  policy,
  managerName,
  saving,
  onChange,
  onSave,
}: OrganizationIdentityTabProps) {
  const t = useWorkbenchT();
  const filteredPositions = positions.filter(position => !form.unitId || position.unitId === form.unitId);
  const otherPeers = peers.filter(peer => peer.id !== form.employeeId);
  const directReports = peers.filter(
    peer => peer.id !== form.employeeId && peer.id !== form.managerId,
  );

  return (
    <div className={styles.formStack}>
      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>{t("org.identity.basicTitle")}</h3>
        <label className={wb.fieldFull}>
          <span>{t("org.identity.displayName")}</span>
          <input
            value={form.displayName}
            onChange={event => onChange({ displayName: event.target.value })}
            placeholder={t("org.identity.displayNamePlaceholder")}
            autoComplete="off"
          />
        </label>
        <div className={wb.formGrid}>
          <label className={wb.field}>
            <span>{t("org.identity.unit")}</span>
            <select
              value={form.unitId}
              onChange={event => {
                const unitId = event.target.value;
                const nextPositions = positions.filter(position => position.unitId === unitId);
                onChange({
                  unitId,
                  positionId: nextPositions.some(position => position.id === form.positionId)
                    ? form.positionId
                    : (nextPositions[0]?.id ?? ""),
                });
              }}
            >
              <option value="">{t("org.identity.unitPlaceholder")}</option>
              {units.map(unit => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className={wb.field}>
            <span>{t("org.identity.position")}</span>
            <select
              value={form.positionId}
              onChange={event => onChange({ positionId: event.target.value })}
              disabled={!filteredPositions.length}
            >
              <option value="">{t("org.identity.positionPlaceholder")}</option>
              {filteredPositions.map(position => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>{t("org.identity.scopeTitle")}</h3>
        <label className={wb.fieldFull}>
          <span>{t("org.identity.workspace")}</span>
          <input
            value={form.workspace}
            onChange={event => onChange({ workspace: event.target.value })}
            placeholder={t("org.identity.workspacePlaceholder")}
            autoComplete="off"
          />
        </label>
        <label className={wb.fieldFull}>
          <span>{t("org.identity.workScope")}</span>
          <input
            value={form.workScope}
            onChange={event => onChange({ workScope: event.target.value })}
            placeholder={t("org.identity.workScopePlaceholder")}
            autoComplete="off"
          />
        </label>
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>{t("org.identity.permissionTitle")}</h3>
        <label className={wb.fieldFull}>
          <span>{t("org.identity.toolPolicy")}</span>
          <select
            value={form.toolPolicyId}
            onChange={event => onChange({ toolPolicyId: event.target.value })}
          >
            <option value="">{t("org.identity.toolPolicyPlaceholder")}</option>
            {policies.map(entry => (
              <option key={entry.id} value={entry.id}>
                {entry.description?.trim() || entry.id}
              </option>
            ))}
          </select>
        </label>
        {policy ? (
          <p className={styles.policySummary}>
            {t("org.identity.policySummary")
              .replace("{name}", policy.description?.trim() || policy.id)
              .replace("{count}", String(policy.ruleCount))}
          </p>
        ) : null}
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>{t("org.identity.reportingTitle")}</h3>
        <label className={wb.fieldFull}>
          <span>{t("org.identity.manager")}</span>
          <select
            value={form.managerId}
            onChange={event => onChange({ managerId: event.target.value })}
          >
            <option value="">{t("org.identity.managerNone")}</option>
            {otherPeers.map(peer => (
              <option key={peer.id} value={peer.id}>
                {peer.displayName}
              </option>
            ))}
          </select>
        </label>
        {form.managerId && managerName ? (
          <p className={styles.identitySummary}>
            {t("org.identity.managerSummary").replace("{name}", managerName)}
          </p>
        ) : null}
        {directReports.length ? (
          <div>
            <p className={styles.sectionHint}>{t("org.identity.teamHint")}</p>
            <ul className={styles.readOnlyList}>
              {directReports.map(peer => (
                <li key={peer.id}>{peer.displayName}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <details className={modelStyles.advancedDetails}>
        <summary className={modelStyles.advancedSummary}>{t("org.identity.advancedSettings")}</summary>
        <div className={modelStyles.advancedBody}>
          <p className={modelStyles.advancedHint}>{t("org.identity.advancedHint")}</p>
          <label className={wb.field}>
            <span>{t("org.identity.status")}</span>
            <select
              value={form.status}
              onChange={event =>
                onChange({ status: event.target.value as OrgEmployeeFormState["status"] })
              }
            >
              <option value="active">{t("org.identity.statusActive")}</option>
              <option value="inactive">{t("org.identity.statusInactive")}</option>
            </select>
          </label>
          <label className={wb.fieldFull}>
            <span>{t("org.identity.internalId")}</span>
            <input value={form.employeeId} readOnly aria-readonly />
          </label>
        </div>
      </details>

      <div className={styles.footerActions}>
        <button
          type="button"
          className={wb.btnPrimary}
          onClick={onSave}
          disabled={saving || !form.displayName.trim()}
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
