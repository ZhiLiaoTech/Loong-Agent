import type { ChatActivityStep } from "@dashboard/app/run/types.js";
import styles from "./AssistantActivityPanel.module.css";

export function AssistantActivityPanel({
  steps,
  expanded,
  collapsedSummary,
  expandLabel,
  collapseLabel,
  onToggleExpanded,
  onStepClick,
}: {
  steps: readonly ChatActivityStep[];
  expanded: boolean;
  collapsedSummary: string;
  expandLabel: string;
  collapseLabel: string;
  onToggleExpanded: () => void;
  onStepClick?: (step: ChatActivityStep) => void;
}) {
  if (!steps.length) {
    return null;
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className={styles.collapsed}
        onClick={onToggleExpanded}
        aria-expanded="false"
        title={expandLabel}
      >
        <span className={styles.collapsedDot} aria-hidden />
        {collapsedSummary}
      </button>
    );
  }

  return (
    <div className={styles.panel} aria-live="polite">
      <button
        type="button"
        className={styles.collapseBtn}
        onClick={onToggleExpanded}
        aria-expanded="true"
        title={collapseLabel}
      >
        {collapseLabel}
      </button>
      <ol className={styles.list}>
        {steps.map(step => (
          <li key={step.id} className={styles.item}>
            <button
              type="button"
              className={styles.step}
              data-status={step.status}
              onClick={onStepClick ? () => onStepClick(step) : undefined}
              disabled={!onStepClick || step.sequence === undefined}
              title={step.detail}
            >
              <span className={styles.stepIcon} aria-hidden>
                {step.status === "running" ? (
                  <span className={styles.spinner} />
                ) : step.status === "done" ? (
                  "✓"
                ) : step.status === "error" ? (
                  "!"
                ) : step.status === "skipped" ? (
                  "–"
                ) : (
                  "·"
                )}
              </span>
              <span className={styles.stepBody}>
                <span className={styles.stepLabel}>{step.label}</span>
                {step.detail ? (
                  <span className={styles.stepDetail}>{step.detail}</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
