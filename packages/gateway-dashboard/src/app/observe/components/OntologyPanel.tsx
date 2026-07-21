import type { OntologyKnowledgeView } from "../types.js";
import styles from "./OntologyPanel.module.css";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  explicit: "明确",
  observed: "观察",
  inferred: "推断",
  imported: "导入",
};

export function OntologyPanel({
  userId,
  knowledge,
  canWrite,
  supported,
  result,
  loading,
  onUserIdChange,
  onRefresh,
  onExplain,
  onCorrect,
  onRetract,
  onDeleteAll,
  onExport,
}: {
  userId: string;
  knowledge: OntologyKnowledgeView | null;
  canWrite: boolean;
  supported: boolean;
  result: string | null;
  loading: boolean;
  onUserIdChange: (value: string) => void;
  onRefresh: () => void;
  onExplain: (assertionId: string) => void;
  onCorrect: (assertionId: string) => void;
  onRetract: (assertionId: string) => void;
  onDeleteAll: () => void;
  onExport: () => void;
}) {
  const writeTitle = canWrite ? undefined : "需要写权限（--allow-write）";
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>本体记忆</h3>
        <div className={styles.headActions}>
          <input
            className={styles.userInput}
            value={userId}
            placeholder="userId"
            onChange={event => onUserIdChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                onRefresh();
              }
            }}
          />
          <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading || !userId.trim()}>
            加载
          </button>
        </div>
      </div>
      {!supported ? (
        <p className={styles.empty}>当前 Gateway 不支持本体记忆 RPC。</p>
      ) : !knowledge ? (
        <p className={styles.empty}>输入 userId 后点击“加载”查看该用户的本体记忆。</p>
      ) : (
        <>
          <p className={styles.summary}>
            活跃 {knowledge.activeCount} · 候选 {knowledge.candidateCount} · 争议 {knowledge.disputedCount}
            · 推断 {knowledge.inferredActiveCount}
            <span className={canWrite ? styles.badgeWrite : styles.badgeRead}>
              {canWrite ? "可写" : "只读"}
            </span>
          </p>
          {knowledge.groups.length === 0 ? (
            <p className={styles.empty}>该用户暂无活跃事实。</p>
          ) : (
            <ul className={styles.list}>
              {knowledge.groups.map(group => (
                <li key={group.predicate} className={styles.group}>
                  <h4 className={styles.groupTitle}>{group.predicate}</h4>
                  <ul className={styles.factList}>
                    {group.facts.map(fact => (
                      <li key={fact.assertionId} className={styles.item}>
                        <strong className={styles.content}>{fact.line}</strong>
                        <p className={styles.meta}>
                          <span className={styles.badgeSource}>
                            {SOURCE_TYPE_LABELS[fact.sourceType] ?? fact.sourceType}
                          </span>
                          {" "}置信度 {Math.round(fact.confidence * 100)}% · 证据 {fact.evidenceCount} 条
                        </p>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.secondary}
                            onClick={() => onExplain(fact.assertionId)}
                          >
                            解释
                          </button>
                          <button
                            type="button"
                            className={styles.secondary}
                            disabled={!canWrite}
                            title={writeTitle}
                            onClick={() => onCorrect(fact.assertionId)}
                          >
                            纠正
                          </button>
                          <button
                            type="button"
                            className={styles.danger}
                            disabled={!canWrite}
                            title={writeTitle}
                            onClick={() => onRetract(fact.assertionId)}
                          >
                            撤回
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.footer}>
            <button type="button" className={styles.secondary} onClick={onExport}>
              导出 JSON
            </button>
            <button
              type="button"
              className={styles.danger}
              disabled={!canWrite}
              title={writeTitle}
              onClick={onDeleteAll}
            >
              全部删除
            </button>
          </div>
        </>
      )}
      {result ? <pre className={styles.result}>{result}</pre> : null}
    </section>
  );
}
