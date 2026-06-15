import { useEffect, useRef } from "react";
import type { ChatActivityStep, ChatTurn } from "@dashboard/app/run/types.js";
import { visibleAssistantReplyText } from "@dashboard/app/run/activity/timelineState.js";
import { AssistantActivityPanel } from "./AssistantActivityPanel.js";
import styles from "./ChatThread.module.css";

export function ChatThread({
  turns,
  busy,
  assistantName,
  thinkingLabel,
  emptyLead,
  userLabel = "You",
  showActivities = true,
  activityCollapsedSummary,
  activityExpandLabel,
  activityCollapseLabel,
  onToggleTurnActivities,
  onActivityStepClick,
}: {
  turns: readonly ChatTurn[];
  busy: boolean;
  assistantName: string;
  thinkingLabel: string;
  emptyLead: string;
  userLabel?: string;
  showActivities?: boolean;
  activityCollapsedSummary?: (count: number) => string;
  activityExpandLabel?: string;
  activityCollapseLabel?: string;
  onToggleTurnActivities?: (turnIndex: number) => void;
  onActivityStepClick?: (step: ChatActivityStep) => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  if (!turns.length) {
    return (
      <div className={styles.thread}>
        <div className={styles.empty}>
          <p className={styles.emptyLead}>{emptyLead}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.thread}>
      <div className={styles.list}>
        {turns.map((turn, index) => {
          const isUser = turn.role === "user";
          const isLast = index === turns.length - 1;
          const showThinking = busy && isLast && !isUser && !turn.text.trim();
          const activities = turn.activities ?? [];
          const timeline = turn.timeline ?? [];
          const hasActivities = showActivities && !isUser && (activities.length > 0 || timeline.length > 0);
          const expanded = turn.activitiesExpanded !== false;
          const replyText = visibleAssistantReplyText(turn.text, timeline);
          return (
            <div
              key={`${turn.role}-${index}-${turn.streaming ? "s" : "d"}`}
              className={isUser ? styles.rowUser : styles.rowAssistant}
            >
              {isUser ? null : (
                <span className={styles.senderRow}>
                  <span className={styles.sender}>{assistantName}</span>
                  {showThinking ? (
                    <span className={styles.thinking} aria-live="polite">
                      {thinkingLabel}
                    </span>
                  ) : null}
                </span>
              )}
              <div className={isUser ? styles.userContent : styles.assistantContent}>
                {hasActivities ? (
                  <AssistantActivityPanel
                    steps={activities}
                    timeline={timeline}
                    expanded={expanded}
                    collapsedSummary={
                      activityCollapsedSummary
                        ? activityCollapsedSummary(activities.length)
                        : `${activities.length}`
                    }
                    expandLabel={activityExpandLabel ?? "Expand"}
                    collapseLabel={activityCollapseLabel ?? "Collapse"}
                    onToggleExpanded={() => onToggleTurnActivities?.(index)}
                    {...(onActivityStepClick ? { onStepClick: onActivityStepClick } : {})}
                  />
                ) : null}
                {replyText || turn.errorDetail ? (
                  <span
                    className={
                      isUser
                        ? styles.messageUser
                        : `${styles.messageAssistant}${turn.streaming ? ` ${styles.streaming}` : ""}`
                    }
                  >
                    {replyText}
                    {turn.errorDetail ? (
                      <span className={styles.errorDetail} role="alert">
                        {turn.errorDetail}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {isUser ? <span className={styles.senderUser}>{userLabel}</span> : null}
            </div>
          );
        })}
        <div ref={endRef} className={styles.sentinel} />
      </div>
    </div>
  );
}
