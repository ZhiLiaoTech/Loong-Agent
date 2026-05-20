import { formatTime, shortId } from "../../shared/format.js";
import type { ApprovalInboxItem } from "../types.js";
import styles from "./ApprovalInboxPanel.module.css";

export function ApprovalInboxPanel({
  approvals,
  result,
  loading,
  mineOnly,
  approverEmployeeId,
  employeeOptions,
  onMineOnlyChange,
  onApproverChange,
  onRefresh,
  onApprove,
  onReject,
}: {
  approvals: readonly ApprovalInboxItem[];
  result: string | null;
  loading: boolean;
  mineOnly: boolean;
  approverEmployeeId: string;
  employeeOptions: readonly { id: string; displayName: string }[];
  onMineOnlyChange: (value: boolean) => void;
  onApproverChange: (employeeId: string) => void;
  onRefresh: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>审批收件箱 ({approvals.length})</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          刷新
        </button>
      </div>
      <div className={styles.filters}>
        <label className={styles.filterCheck}>
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={event => onMineOnlyChange(event.target.checked)}
          />
          <span>我的待办</span>
        </label>
        <label className={styles.filterSelect}>
          <span>审批人</span>
          <select
            value={approverEmployeeId}
            disabled={!mineOnly}
            onChange={event => onApproverChange(event.target.value)}
          >
            {!employeeOptions.length ? <option value="">无员工</option> : null}
            {employeeOptions.map(option => (
              <option key={option.id} value={option.id}>
                {option.displayName} ({option.id})
              </option>
            ))}
          </select>
        </label>
      </div>
      {!approvals.length ? (
        <p className={styles.empty}>暂无待审批工具调用。</p>
      ) : (
        <ul className={styles.list}>
          {approvals.map(item => {
            const meta = [
              item.employeeDisplayName || item.employeeId || "",
              item.assignedApproverDisplayName
                ? `审批人 ${item.assignedApproverDisplayName}`
                : item.assignedApproverId
                  ? `审批人 ${item.assignedApproverId}`
                  : "",
              item.chainName || (item.chainId ? `链 ${item.chainId}` : ""),
              item.createdAt ? formatTime(item.createdAt) : "",
              `run ${shortId(item.runId)}`,
            ].filter(Boolean).join(" · ");

            return (
              <li key={item.id} className={styles.item}>
                <strong className={styles.tool}>{item.toolName}</strong>
                {meta ? <p className={styles.meta}>{meta}</p> : null}
                {item.reason ? <p className={styles.reason}>{item.reason}</p> : null}
                {item.inputSummary ? <pre className={styles.input}>{item.inputSummary}</pre> : null}
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} onClick={() => void onApprove(item.id)}>
                    批准
                  </button>
                  <button type="button" className={styles.danger} onClick={() => void onReject(item.id)}>
                    拒绝
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {result ? <p className={styles.result}>{result}</p> : null}
    </section>
  );
}
