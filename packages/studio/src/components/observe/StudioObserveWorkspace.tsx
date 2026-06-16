import { useSearchParams } from "react-router-dom";
import { useLoongEvents } from "@dashboard/app/events/EventsContext.js";
import { ApprovalInboxPanel } from "@dashboard/app/observe/components/ApprovalInboxPanel.js";
import { EventsFeed } from "@dashboard/app/observe/components/EventsFeed.js";
import { MemoryCandidatesPanel } from "@dashboard/app/observe/components/MemoryCandidatesPanel.js";
import { RunsObserveTable } from "@dashboard/app/observe/components/RunsObserveTable.js";
import { useObservePage } from "@dashboard/app/observe/useObservePage.js";
import wb from "@dashboard/app/workbench.module.css";
import { useI18n } from "../../i18n/I18nContext.js";
import styles from "./StudioObserveWorkspace.module.css";

export function StudioObserveWorkspace() {
  const { t } = useI18n();
  const page = useObservePage();
  const { events, sseStatus, reconnect } = useLoongEvents();
  const [searchParams] = useSearchParams();
  const highlightApprovalId = searchParams.get("approval")?.trim() || undefined;

  return (
    <div className={wb.page}>
      <header className={wb.pageHeader}>
        <div>
          <h1 className={wb.pageTitle}>{t("observe.title")}</h1>
          <p className={wb.pageLead}>{t("observe.lead")}</p>
        </div>
        <div className={wb.pageHeaderActions}>
          <button
            type="button"
            className={wb.btnSecondary}
            onClick={() => void page.refreshApprovals()}
            disabled={page.loading}
          >
            {t("common.refresh")}
          </button>
        </div>
      </header>

      {page.error ? (
        <div className={wb.pageAlerts}>
          <p className={wb.bannerError}>{page.error}</p>
        </div>
      ) : null}

      <div className={styles.commandBar}>
        <div className={styles.statsGrid}>
          <div className={styles.statChip}>
            <span className={styles.statLabel}>{t("observe.statsRuns")}</span>
            <strong className={styles.statValue}>{page.runs.length}</strong>
          </div>
          <div className={styles.statChip}>
            <span className={styles.statLabel}>{t("observe.statsActive")}</span>
            <strong className={styles.statValue}>{page.activeRuns}</strong>
          </div>
          <div className={styles.statChip}>
            <span className={styles.statLabel}>{t("observe.statsPending")}</span>
            <strong className={styles.statValue}>{page.approvals.length}</strong>
          </div>
          <div className={styles.statChip}>
            <span className={styles.statLabel}>{t("observe.statsEvents")}</span>
            <strong className={styles.statValue}>{events.length}</strong>
          </div>
        </div>

        <div className={styles.commandControls}>
          <span className={`${styles.connectionPill} ${styles[`connection-${sseStatus}`] ?? ""}`}>
            {sseStatus}
          </span>
          <label className={styles.sessionField}>
            <span>{t("observe.session")}</span>
            <input
              value={page.sessionId}
              onChange={event => page.setSessionId(event.target.value)}
              onBlur={() => void page.refreshTrajectories()}
              autoComplete="off"
            />
          </label>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeadCompact}>
          <h2 className={wb.sectionTitle}>{t("observe.approvalsSection")}</h2>
          <p className={wb.sectionLead}>{t("observe.approvalsLead")}</p>
        </div>
        <ApprovalInboxPanel
          approvals={page.approvals}
          result={page.approvalResult}
          loading={page.loading}
          mineOnly={page.approvalMineOnly}
          approverEmployeeId={page.approverEmployeeId}
          employeeOptions={page.employeeOptions}
          {...(highlightApprovalId ? { highlightApprovalId } : {})}
          onMineOnlyChange={page.setApprovalMineOnly}
          onApproverChange={page.setApproverEmployeeId}
          onRefresh={() => void page.refreshApprovals()}
          onApprove={id => void page.approveRequest(id)}
          onReject={id => void page.rejectRequest(id)}
          onDismiss={id => void page.dismissRequest(id)}
        />
      </section>

      <div className={styles.signalGrid}>
        <section className={styles.panelPrimary}>
          <EventsFeed
            events={events}
            sseStatus={sseStatus}
            onReconnect={reconnect}
            title={t("observe.eventsSection")}
            reconnectLabel={t("common.refresh")}
            emptyLabel={t("observe.eventsEmpty")}
          />
        </section>
        <section className={styles.panelSecondary}>
          <MemoryCandidatesPanel
            candidates={page.memoryCandidates}
            review={page.memoryReview}
            result={page.memoryResult}
            loading={page.loading}
            title={t("observe.memorySection")}
            refreshLabel={t("common.refresh")}
            emptyLabel={t("observe.memoryEmpty")}
            promoteLabel={t("observe.memoryPromote")}
            rejectLabel={t("observe.memoryReject")}
            onRefresh={() => void page.refreshMemory()}
            onPromote={id => void page.promoteMemory(id)}
            onReject={id => void page.rejectMemory(id)}
          />
        </section>
      </div>

      <section className={styles.section}>
        <RunsObserveTable
          runs={page.runs}
          loading={page.loading}
          title={t("observe.runsSection")}
          refreshLabel={t("common.refresh")}
          emptyLabel={t("observe.runsEmpty")}
          cancelLabel={t("observe.runCancel")}
          onRefresh={() => void page.refreshRuns()}
          onCancel={runId => void page.cancelRun(runId)}
        />
      </section>
    </div>
  );
}
