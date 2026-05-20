import { useDragonEvents } from "../events/EventsContext.js";
import { EventsFeed } from "./components/EventsFeed.js";
import { ApprovalInboxPanel } from "./components/ApprovalInboxPanel.js";
import { KpiSnapshotPanel } from "./components/KpiSnapshotPanel.js";
import { MemoryCandidatesPanel } from "./components/MemoryCandidatesPanel.js";
import { RunsObserveTable } from "./components/RunsObserveTable.js";
import { TicketsPanel } from "./components/TicketsPanel.js";
import { TrajectoriesSection } from "./components/TrajectoriesSection.js";
import styles from "./ObserveWorkspace.module.css";
import { useObservePage } from "./useObservePage.js";

export function ObserveWorkspace() {
  const page = useObservePage();
  const { events, sseStatus, reconnect } = useDragonEvents();

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Observe</h2>
          <p className={styles.lead}>
            Monitor runs, live events, memory candidates, and trajectories.
          </p>
        </div>
        <label className={styles.sessionField}>
          <span>Session</span>
          <input
            value={page.sessionId}
            onChange={event => page.setSessionId(event.target.value)}
            onBlur={() => void page.refreshTrajectories()}
            autoComplete="off"
          />
        </label>
      </header>

      <p className={styles.metrics}>
        {page.runs.length} runs · {page.activeRuns} active · {events.length} buffered events
      </p>

      {page.error ? <p className={styles.error}>{page.error}</p> : null}

      <RunsObserveTable
        runs={page.runs}
        loading={page.loading}
        onRefresh={() => void page.refreshRuns()}
        onCancel={runId => void page.cancelRun(runId)}
      />

      <TicketsPanel
        tickets={page.tickets}
        loading={page.loading}
        onRefresh={() => void page.refreshTickets()}
      />

      <KpiSnapshotPanel
        templateName={page.kpiTemplateName}
        employeeId={page.kpiEmployeeId}
        metrics={page.kpiMetrics}
        loading={page.loading}
        onRefresh={() => void page.refreshKpi()}
      />

      <div className={styles.grid}>
        <EventsFeed events={events} sseStatus={sseStatus} onReconnect={reconnect} />
        <ApprovalInboxPanel
          approvals={page.approvals}
          result={page.approvalResult}
          loading={page.loading}
          onRefresh={() => void page.refreshApprovals()}
          onApprove={id => void page.approveRequest(id)}
          onReject={id => void page.rejectRequest(id)}
        />
        <MemoryCandidatesPanel
          candidates={page.memoryCandidates}
          review={page.memoryReview}
          result={page.memoryResult}
          loading={page.loading}
          onRefresh={() => void page.refreshMemory()}
          onPromote={id => void page.promoteMemory(id)}
          onReject={id => void page.rejectMemory(id)}
        />
      </div>

      <TrajectoriesSection
        trajectories={page.trajectories}
        detail={page.trajectoryDetail}
        loading={page.loading}
        onRefresh={() => void page.refreshTrajectories()}
        onView={runId => void page.loadTrajectory(runId)}
      />
    </div>
  );
}
