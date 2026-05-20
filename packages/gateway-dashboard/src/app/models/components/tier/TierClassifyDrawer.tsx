import { Drawer } from "../../../components/Drawer.js";
import type { TierClassifyResult } from "../../types.js";
import type { useTiersPage } from "../../useTiersPage.js";
import styles from "../TierConfigPanel.module.css";
import { TIER_LABELS } from "./labels.js";

interface Props {
  open: boolean;
  onClose: () => void;
  page: ReturnType<typeof useTiersPage>;
}

export function TierClassifyDrawer({ open, onClose, page }: Props) {
  const { classifyMessage, setClassifyMessage, classifyResult, classify } = page;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="试路由"
      subtitle="粘贴示例提示，预览启发式分类结果，不会调用模型。"
    >
      <label className={styles.drawerField}>
        <span>示例提示</span>
        <textarea
          value={classifyMessage}
          onChange={event => setClassifyMessage(event.target.value)}
          placeholder="例如：翻译这句话；或：设计一个多租户限流方案"
          rows={6}
        />
      </label>
      <button type="button" className={styles.btnPrimary} onClick={() => void classify()}>
        开始分类
      </button>

      {classifyResult ? (
        <article className={styles.decisionCard} aria-live="polite">
          <header className={styles.decisionHeader}>
            <span
              className={`${styles.resultBadge} ${styles[`resultBadge_${classifyResult.tier}`]}`}
            >
              {TIER_LABELS[classifyResult.tier]}
            </span>
            <span className={styles.decisionMeta}>
              分数 {classifyResult.score} · {sourceLabel(classifyResult.source)}
            </span>
          </header>
          <dl className={styles.decisionGrid}>
            <div className={styles.decisionRow}>
              <dt>原因</dt>
              <dd>
                <code>{classifyResult.reason}</code>
              </dd>
            </div>
            {classifyResult.resolvedModel ? (
              <div className={styles.decisionRow}>
                <dt>解析模型</dt>
                <dd>
                  <code>{classifyResult.resolvedModel}</code>
                </dd>
              </div>
            ) : null}
            {classifyResult.resolvedMaxContextChars !== undefined ? (
              <div className={styles.decisionRow}>
                <dt>上下文上限</dt>
                <dd>{classifyResult.resolvedMaxContextChars.toLocaleString()} 字符</dd>
              </div>
            ) : null}
          </dl>
        </article>
      ) : (
        <p className={styles.drawerEmpty}>输入提示并点击「开始分类」查看结果。</p>
      )}
    </Drawer>
  );
}

function sourceLabel(source: TierClassifyResult["source"]): string {
  switch (source) {
    case "heuristic":
      return "启发式";
    case "fixed":
      return "固定档位";
    case "inherited":
      return "继承";
    case "explicit-input":
      return "显式指定";
    default:
      return source;
  }
}
