import styles from "./OrgWorkspace.module.css";
import { useOrgPage } from "./useOrgPage.js";

export function OrgWorkspace() {
  const page = useOrgPage();
  const { state } = page;

  const employeeName = (id: string) =>
    state.employees.find(entry => entry.id === id)?.displayName ?? id;

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <h2 className={styles.title}>组织</h2>
        <p className={styles.lead}>查看部门、岗位、审批链、路由规则与数字员工（只读）。</p>
        <button type="button" className={styles.refresh} onClick={() => void page.reload()} disabled={page.loading}>
          刷新
        </button>
      </header>

      {page.error ? <p className={styles.error}>{page.error}</p> : null}

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
          <h3>数字员工 ({state.employees.length})</h3>
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
