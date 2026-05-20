import styles from "./EmployeesTable.module.css";
import type { OrgEmployeeRecord } from "../types.js";

export function EmployeesTable({
  employees,
  defaultEmployeeId,
  onEdit,
  onRemove,
}: {
  employees: readonly OrgEmployeeRecord[];
  defaultEmployeeId?: string;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className={styles.card}>
      <h3 className={styles.title}>员工草稿 ({employees.length})</h3>
      {!employees.length ? (
        <p className={styles.empty}>暂无员工，使用左侧表单添加。</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>Profile</th>
                <th>策略</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employees.map(employee => (
                <tr key={employee.id}>
                  <td>
                    <code>{employee.id}</code>
                    {defaultEmployeeId === employee.id ? (
                      <span className={styles.badge}>默认</span>
                    ) : null}
                  </td>
                  <td>{employee.displayName}</td>
                  <td>{employee.profileId}</td>
                  <td>{employee.toolPolicyId}</td>
                  <td>{employee.status}</td>
                  <td className={styles.actions}>
                    <button type="button" className={styles.link} onClick={() => onEdit(employee.id)}>
                      编辑
                    </button>
                    <button type="button" className={styles.danger} onClick={() => onRemove(employee.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
