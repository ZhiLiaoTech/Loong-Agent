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

      <div className={styles.statsRow}>
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

      <section className={styles.section}>
        <div className={styles.sectionHead}>
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
        />
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <h2 className={wb.sectionTitle}>{t("observe.eventsSection")}</h2>
          </div>
          <EventsFeed events={events} sseStatus={sseStatus} onReconnect={reconnect} />
        </section>
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <h2 className={wb.sectionTitle}>{t("observe.memorySection")}</h2>
          </div>
          <MemoryCandidatesPanel
            candidates={page.memoryCandidates}
            review={page.memoryReview}
            result={page.memoryResult}
            loading={page.loading}
            onRefresh={() => void page.refreshMemory()}
            onPromote={id => void page.promoteMemory(id)}
            onReject={id => void page.rejectMemory(id)}
          />
        </section>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={wb.sectionTitle}>{t("observe.runsSection")}</h2>
        </div>
        <RunsObserveTable
          runs={page.runs}
          loading={page.loading}
          onRefresh={() => void page.refreshRuns()}
          onCancel={runId => void page.cancelRun(runId)}
        />
      </section>
    </div>
  );
}
