import { useEffect, useRef } from "react";
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
  highlightApprovalId,
  onMineOnlyChange,
  onApproverChange,
  onRefresh,
  onApprove,
  onReject,
  onDismiss,
}: {
  approvals: readonly ApprovalInboxItem[];
  result: string | null;
  loading: boolean;
  mineOnly: boolean;
  approverEmployeeId: string;
  employeeOptions: readonly { id: string; displayName: string }[];
  highlightApprovalId?: string;
  onMineOnlyChange: (value: boolean) => void;
  onApproverChange: (employeeId: string) => void;
  onRefresh: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const highlightRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!highlightApprovalId) {
      return;
    }
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlightApprovalId, approvals.length]);

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
            const stale = item.awaitingLiveRun === false;
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
              <li
                key={item.id}
                ref={item.id === highlightApprovalId ? highlightRef : undefined}
                className={`${styles.item}${item.id === highlightApprovalId ? ` ${styles.itemHighlight}` : ""}${stale ? ` ${styles.itemStale}` : ""}`}
              >
                <strong className={styles.tool}>{item.toolName}</strong>
                {meta ? <p className={styles.meta}>{meta}</p> : null}
                {stale ? (
                  <p className={styles.staleNotice}>
                    该审批对应的 Agent 运行已结束或 Gateway 已重启，无法批准或拒绝。
                  </p>
                ) : null}
                {item.reason ? <p className={styles.reason}>{item.reason}</p> : null}
                {item.inputSummary ? <pre className={styles.input}>{item.inputSummary}</pre> : null}
                <div className={styles.actions}>
                  {stale ? (
                    <button type="button" className={styles.secondary} onClick={() => void onDismiss(item.id)}>
                      清除
                    </button>
                  ) : (
                    <>
                      <button type="button" className={styles.primary} onClick={() => void onApprove(item.id)}>
                        批准
                      </button>
                      <button type="button" className={styles.danger} onClick={() => void onReject(item.id)}>
                        拒绝
                      </button>
                    </>
                  )}
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
