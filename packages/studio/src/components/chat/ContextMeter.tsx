import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextUsageSnapshot } from "@dashboard/app/run/contextUsage.js";
import {
  contextUsageBarWidth,
  contextUsagePercent,
  contextUsageTone,
  formatCompactCount,
} from "@dashboard/app/run/contextUsage.js";
import { useI18n } from "../../i18n/I18nContext.js";
import styles from "./ContextMeter.module.css";

export function ContextMeter({
  usage,
  running,
}: {
  usage: ContextUsageSnapshot;
  running: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const limitChars = usage.limitChars;
  const usedChars = usage.usedChars;
  const percent = contextUsagePercent(usedChars, limitChars);
  const barWidth = contextUsageBarWidth(percent);
  const tone = contextUsageTone(percent);

  const usedLabel = running && usedChars === undefined
    ? t("chat.context.estimating")
    : usedChars !== undefined
      ? formatCompactCount(usedChars)
      : "—";
  const limitLabel = limitChars !== undefined ? formatCompactCount(limitChars) : "—";
  const percentLabel = percent !== undefined ? `${percent}%` : running ? "…" : "—";
  const tierLabel = usage.tier ?? "";

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const toggle = useCallback(() => {
    setOpen(current => !current);
  }, []);

  const hasDetails = (
    usedChars !== undefined
    || usage.truncatedToolResults
    || usage.truncatedAssistant
    || usage.estimatedCharsBefore !== undefined
    || usage.modelContextWindow !== undefined
    || usage.injectedContextLimitChars !== undefined
  );

  return (
    <div
      ref={rootRef}
      className={`${styles.meter}${running ? ` ${styles.meterRunning}` : ""}`}
    >
      <button
        type="button"
        className={styles.row}
        onClick={hasDetails ? toggle : undefined}
        disabled={!hasDetails}
        aria-expanded={open}
        aria-label={t("chat.context.label")}
      >
        <span className={styles.label}>{t("chat.context.label")}</span>
        <span className={styles.numbers}>
          {usedLabel}
          {" / "}
          {limitLabel}
        </span>
        <span className={styles.track} aria-hidden>
          <span
            className={`${styles.fill} ${styles[`fill-${tone}`]}`}
            style={{ width: `${barWidth}%` }}
          />
        </span>
        <span className={styles.percent}>{percentLabel}</span>
        {tierLabel ? <span className={styles.tier}>{tierLabel}</span> : null}
      </button>

      {open && hasDetails ? (
        <div className={styles.popover} role="dialog" aria-label={t("chat.context.detailsTitle")}>
          <p className={styles.popoverTitle}>{t("chat.context.detailsTitle")}</p>
          {usedChars !== undefined && limitChars !== undefined ? (
            <p className={styles.popoverLine}>
              {t("chat.context.used")
                .replace("{used}", formatCompactCount(usedChars))
                .replace("{limit}", formatCompactCount(limitChars))
                .replace("{percent}", String(percent ?? 0))}
            </p>
          ) : null}
          {usage.injectedContextLimitChars !== undefined ? (
            <p className={styles.popoverLine}>
              {t("chat.context.injectedLimit")
                .replace("{count}", formatCompactCount(usage.injectedContextLimitChars))}
            </p>
          ) : null}
          {usage.tier ? (
            <p className={styles.popoverLine}>
              {t("chat.context.tier").replace("{tier}", usage.tier)}
            </p>
          ) : null}
          {usage.modelContextWindow !== undefined ? (
            <p className={styles.popoverLine}>
              {t("chat.context.modelWindow").replace("{count}", formatCompactCount(usage.modelContextWindow))}
            </p>
          ) : null}
          {(usage.truncatedToolResults || usage.truncatedAssistant || usage.estimatedCharsBefore !== undefined) ? (
            <div className={styles.popoverSection}>
              <p className={styles.popoverSectionTitle}>{t("chat.context.compaction")}</p>
              {usage.truncatedToolResults ? (
                <p className={styles.popoverLine}>
                  {t("chat.context.truncatedTools").replace("{count}", String(usage.truncatedToolResults))}
                </p>
              ) : null}
              {usage.truncatedAssistant ? (
                <p className={styles.popoverLine}>
                  {t("chat.context.truncatedAssistant").replace("{count}", String(usage.truncatedAssistant))}
                </p>
              ) : null}
              {usage.estimatedCharsBefore !== undefined && usedChars !== undefined ? (
                <p className={styles.popoverLine}>
                  {t("chat.context.compactionRange")
                    .replace("{before}", formatCompactCount(usage.estimatedCharsBefore))
                    .replace("{after}", formatCompactCount(usedChars))}
                </p>
              ) : null}
            </div>
          ) : null}
          {percent !== undefined && percent >= 85 ? (
            <p className={styles.popoverWarn}>{t("chat.context.nearLimit")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
