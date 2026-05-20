import { EmployeeForm } from "./components/EmployeeForm.js";
import { EmployeesTable } from "./components/EmployeesTable.js";
import { PolicyJsonEditor } from "./components/PolicyJsonEditor.js";
import styles from "./OrgWorkspace.module.css";
import { useOrgPage } from "./useOrgPage.js";

export function OrgWorkspace() {
  const page = useOrgPage();
  const { state } = page;

  const employeeName = (id: string) =>
    state.employees.find(entry => entry.id === id)?.displayName
    ?? page.draftEmployees.find(entry => entry.id === id)?.displayName
    ?? id;

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>组织</h2>
          <p className={styles.lead}>管理部门结构，并编辑数字员工与工具策略。</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.save}
            onClick={() => void page.saveEmployees()}
            disabled={page.savingEmployees || page.loading}
          >
            {page.savingEmployees ? "保存中…" : "保存员工"}
          </button>
          <button type="button" className={styles.refresh} onClick={() => void page.reload()} disabled={page.loading}>
            刷新
          </button>
        </div>
      </header>

      {page.error ? <p className={styles.error}>{page.error}</p> : null}
      {page.status ? <p className={styles.status}>{page.status}</p> : null}

      <section className={styles.editor}>
        <EmployeeForm
          form={page.employeeForm}
          profileIds={page.profileIds}
          policyIds={page.policyIds}
          onChange={page.patchForm}
          onUpsert={page.upsertDraft}
          onClear={page.clearForm}
        />
        <EmployeesTable
          employees={page.draftEmployees}
          defaultEmployeeId={page.draftDefaultEmployeeId}
          onEdit={page.editDraft}
          onRemove={page.removeDraft}
        />
        <PolicyJsonEditor
          jsonText={page.policyJsonText}
          loading={page.loading}
          saving={page.savingPolicies}
          onChange={page.setPolicyJsonText}
          onReload={() => void page.reloadPolicies()}
          onSave={() => void page.savePolicies()}
        />
      </section>

      <h3 className={styles.sectionTitle}>组织概览（只读）</h3>
      <div className={styles.grid}>
        <section className={styles.card}>
          <h3>部门 ({state.units.length})</h3>
          <ul className={styles.list}>
            {state.units.map(unit => (
              <li key={unit.id}>
                <strong>{unit.name}</strong>
                <span className={styles.muted}>{unit.id}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.card}>
          <h3>岗位 ({state.positions.length})</h3>
          <ul className={styles.list}>
            {state.positions.map(position => (
              <li key={position.id}>
                <strong>{position.name}</strong>
                <span className={styles.muted}>
                  {position.id} · {position.unitId}
                  {position.level ? ` · ${position.level}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.card}>
          <h3>在职员工 ({state.employees.length})</h3>
          {state.defaultEmployeeId ? (
            <p className={styles.note}>默认员工：{employeeName(state.defaultEmployeeId)}</p>
          ) : null}
          <ul className={styles.list}>
            {state.employees.map(employee => (
              <li key={employee.id}>
                <strong>{employee.displayName}</strong>
                <span className={styles.muted}>
                  {employee.id} · profile {employee.profileId} · {employee.unitId}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.card}>
          <h3>审批链 ({state.approvalChains.length})</h3>
          <ul className={styles.list}>
            {state.approvalChains.map(chain => (
              <li key={chain.id}>
                <strong>{chain.name}</strong>
                <span className={styles.muted}>{chain.id} · {chain.steps.length} 步</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.card}>
          <h3>工具策略 ({state.toolPolicies.length})</h3>
          <ul className={styles.list}>
            {state.toolPolicies.map(policy => (
              <li key={policy.id}>
                <strong>{policy.id}</strong>
                <span className={styles.muted}>
                  {policy.description ?? "—"} · {policy.ruleCount} 条规则
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${styles.card} ${styles.full}`}>
          <h3>员工自动路由 ({state.employeeRouting.length})</h3>
          <p className={styles.note}>Run 未指定员工时，Gateway 按关键词匹配规则并回退到 defaultEmployeeId。</p>
          <ul className={styles.list}>
            {state.employeeRouting.map(rule => (
              <li key={rule.id ?? `${rule.employeeId}-${rule.match.keywords?.join(",")}`}>
                <strong>{employeeName(rule.employeeId)}</strong>
                <span className={styles.muted}>
                  {rule.id ? `${rule.id} · ` : ""}
                  {rule.match.profileId ? `profile ${rule.match.profileId} · ` : ""}
                  keywords: {(rule.match.keywords ?? []).join(", ") || "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
