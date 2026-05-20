import type { EmployeeFormState } from "../types.js";
import styles from "./EmployeeForm.module.css";

export function EmployeeForm({
  form,
  profileIds,
  policyIds,
  onChange,
  onUpsert,
  onClear,
}: {
  form: EmployeeFormState;
  profileIds: readonly string[];
  policyIds: readonly string[];
  onChange: (patch: Partial<EmployeeFormState>) => void;
  onUpsert: () => void;
  onClear: () => void;
}) {
  const canSubmit = Boolean(form.id.trim() && form.displayName.trim() && form.toolPolicyId.trim());

  return (
    <section className={styles.card}>
      <h3 className={styles.title}>添加 / 编辑数字员工</h3>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>员工 ID</span>
          <input value={form.id} onChange={e => onChange({ id: e.target.value })} autoComplete="off" />
        </label>
        <label className={styles.field}>
          <span>显示名</span>
          <input value={form.displayName} onChange={e => onChange({ displayName: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span>Profile</span>
          <input value={form.profileId} onChange={e => onChange({ profileId: e.target.value })} list="org-profile-ids" />
          <datalist id="org-profile-ids">
            {profileIds.map(id => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          <span>岗位 ID</span>
          <input value={form.positionId} onChange={e => onChange({ positionId: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span>部门 ID</span>
          <input value={form.unitId} onChange={e => onChange({ unitId: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span>工具策略</span>
          <input value={form.toolPolicyId} onChange={e => onChange({ toolPolicyId: e.target.value })} list="org-policy-ids" />
          <datalist id="org-policy-ids">
            {policyIds.map(id => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          <span>状态</span>
          <select value={form.status} onChange={e => onChange({ status: e.target.value as EmployeeFormState["status"] })}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>上级 ID</span>
          <input value={form.managerId} onChange={e => onChange({ managerId: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span>KPI 模板</span>
          <input value={form.kpiTemplateId} onChange={e => onChange({ kpiTemplateId: e.target.value })} />
        </label>
        <label className={`${styles.field} ${styles.check}`}>
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={e => onChange({ isDefault: e.target.checked })}
          />
          <span>设为默认员工</span>
        </label>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onClear}>
          清空
        </button>
        <button type="button" className={styles.primary} disabled={!canSubmit} onClick={onUpsert}>
          加入草稿
        </button>
      </div>
    </section>
  );
}
