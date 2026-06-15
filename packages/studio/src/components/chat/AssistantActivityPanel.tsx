import type { ActivityStepKind, ChatActivityStep, ChatTimelineItem } from "@dashboard/app/run/types.js";
import { resolveActivityStepKind } from "@dashboard/app/run/activity/activityStepKind.js";
import styles from "./AssistantActivityPanel.module.css";

function StepIcon({ kind, running }: { kind: ActivityStepKind; running: boolean }) {
  if (running) {
    return <span className={styles.spinner} aria-hidden />;
  }

  if (kind === "thinking") {
    return (
      <svg className={styles.iconSvg} viewBox="0 0 16 16" aria-hidden>
        <path d="M8 1.5a4.5 4.5 0 0 0-2.3 8.37V12a.75.75 0 0 0 1.5 0v-1.5h1.5a.75.75 0 0 0 0-1.5H7.2A3 3 0 1 1 11 5.5a.75.75 0 0 0 1.5 0A4.5 4.5 0 0 0 8 1.5Z" fill="currentColor" />
        <path d="M6.25 13.25h3.5v1.5h-3.5v-1.5Z" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "read_file" || kind === "write_file" || kind === "search_file") {
    return (
      <svg className={styles.iconSvg} viewBox="0 0 16 16" aria-hidden>
        <path d="M3 2.75A1.75 1.75 0 0 1 4.75 1h4.3l3.95 3.45v9.05A1.75 1.75 0 0 1 11.25 15h-6.5A1.75 1.75 0 0 1 3 13.25V2.75Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M9 1.5v3.25H12.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }

  if (kind === "skill" || kind === "command") {
    return (
      <svg className={styles.iconSvg} viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4.5 6.5h5M4.5 9h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg className={styles.iconSvg} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v3.5l2 1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function renderStep(
  step: ChatActivityStep,
  onStepClick?: (step: ChatActivityStep) => void,
) {
  const kind = resolveActivityStepKind(step);
  const running = step.status === "running";
  const clickable = Boolean(onStepClick && step.sequence !== undefined);

  return (
    <li key={step.id} className={styles.item}>
      <button
        type="button"
        className={`${styles.step}${running ? ` ${styles.stepRunning}` : ""}`}
        data-status={step.status}
        data-kind={kind}
        onClick={clickable && onStepClick ? () => onStepClick(step) : undefined}
        disabled={!clickable}
        title={step.detail}
      >
        <span className={styles.stepRail} aria-hidden />
        <span className={styles.stepIcon} aria-hidden>
          <StepIcon kind={kind} running={running} />
        </span>
        <span className={styles.stepBody}>
          <span className={styles.stepLabel}>{step.label}</span>
          {step.detail ? (
            <span className={styles.stepDetail}>{step.detail}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function AssistantActivityPanel({
  steps,
  timeline,
  expanded,
  collapsedSummary,
  expandLabel,
  collapseLabel,
  onToggleExpanded,
  onStepClick,
}: {
  steps: readonly ChatActivityStep[];
  timeline?: readonly ChatTimelineItem[];
  expanded: boolean;
  collapsedSummary: string;
  expandLabel: string;
  collapseLabel: string;
  onToggleExpanded: () => void;
  onStepClick?: (step: ChatActivityStep) => void;
}) {
  const stepById = new Map(steps.map(step => [step.id, step]));
  const timelineItems = timeline?.length
    ? timeline
    : steps.map(step => ({ type: "step", stepId: step.id }) as const);

  if (!timelineItems.length) {
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
        {timelineItems.map(item => {
          if (item.type === "text") {
            return (
              <li key={item.id} className={styles.textItem}>
                <span className={styles.textRail} aria-hidden />
                <p className={styles.textSegment}>{item.text}</p>
              </li>
            );
          }
          const step = stepById.get(item.stepId);
          if (!step) {
            return null;
          }
          return renderStep(step, onStepClick);
        })}
      </ol>
    </div>
  );
}
