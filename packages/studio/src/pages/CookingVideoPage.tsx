import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoongClient } from "../context/LoongClientContext.js";
import { useI18n } from "../i18n/I18nContext.js";
import { useLoongEvents } from "@dashboard/app/events/EventsContext.js";
import styles from "./CookingVideoPage.module.css";

type Verdict = "pending" | "approved" | "changes_requested" | "rejected";
type EventName = string;

interface JobSummary { jobId: string; status: string; updatedAt: string }
interface Source { cameraId: string; role?: string; durationMs: number }
interface Segment {
  id: string; cameraId: string; sourceStartMs: number; sourceEndMs: number;
  timelineStartMs: number; event: EventName; caption?: string; transition: "cut" | "fade" | "slide";
  crop: { mode: "cover"; focusX: number; focusY: number };
}
interface Decision {
  schemaVersion: "1.0"; jobId: string; templateId: string; fps: number; aspectRatio: "9:16" | "16:9" | "1:1";
  durationTargetMs: number; segments: Segment[];
  audio: { retainSourceAudio: boolean; sourceGainDb: number; musicGainDb: number };
  endCard: { durationMs: number; headline: string };
}
interface Workspace {
  job: { jobId: string; dish?: { name?: string } };
  state: JobSummary;
  review: { revision: number; verdict: Verdict; updatedAt: string; history: Array<{ id: string; verdict: Verdict; note?: string; reviewer?: string; createdAt: string }> };
  manifest: { sources: Source[]; warnings: string[] };
  sync?: { method: string; confidence: number; referenceCameraId: string; cameras: Record<string, { offsetMs: number }> };
  timeline?: { source: string; events: Array<{ occurrenceId: string; cameraId: string; startMs: number; endMs: number; event: string; confidence: number }> };
  decision: Decision;
  quality?: { status: string };
  previewPath?: string;
}
interface QueueItem { queueId: string; jobId: string; status: string; position: number; stage?: string; error?: string }
interface MetricsSummary {
  model: { calls: number; succeeded: number; failed: number; timedOut: number; cancelled: number; estimatedCostUsd: number; averageDurationMs: number; p95DurationMs: number };
  pipeline: { stageAttempts: number; failedStages: number; totalDurationMs: number };
}
interface FeedbackSummary {
  editSessions: number; comparableSegments: number; cameraChanges: number; cameraChangeRate: number; timingChanges: number; captionChanges: number;
  reviewOutcomes: { approved: number; changes_requested: number; rejected: number };
  failureModes: Record<string, number>;
}

const TEXT = {
  "zh-CN": {
    title: "宣传视频审核", lead: "确认多机位同步，调整时间线并完成审核与重渲染。", root: "作业目录", load: "加载作业",
    jobs: "作业", noJobs: "该目录暂无可审核作业。", selectJob: "选择一个作业开始审核。", sync: "同步确认", events: "事件浏览",
    preview: "成片预览", loadPreview: "加载成片", noPreview: "当前作业还没有可预览成片。", timeline: "时间线", save: "保存修改",
    camera: "机位", start: "入点 ms", end: "出点 ms", caption: "字幕", remove: "删除", review: "审核", reviewer: "审核人",
    note: "审核意见", approve: "批准", changes: "要求返修", reject: "驳回", rerender: "再次渲染", pending: "待审核", approved: "已批准",
    changes_requested: "待返修", rejected: "已驳回", saving: "处理中", revision: "修订", confidence: "置信度", reference: "参考机位",
    queue: "渲染队列", cancel: "取消任务", connected: "进度已连接", metrics: "运行指标", calls: "模型调用", cost: "估算费用",
    average: "平均耗时", failures: "失败 / 超时", pipeline: "流水线耗时",
    feedback: "人工修改", switchRate: "换机位率", editSessions: "编辑次数", timing: "边界调整", topFailure: "主要返修原因", noFailure: "暂无返修数据",
  },
  en: {
    title: "Promo video review", lead: "Confirm camera sync, refine the timeline, and approve a new render.", root: "Jobs directory", load: "Load jobs",
    jobs: "Jobs", noJobs: "No reviewable jobs were found in this directory.", selectJob: "Select a job to begin review.", sync: "Sync confirmation", events: "Event browser",
    preview: "Rendered preview", loadPreview: "Load video", noPreview: "This job has no rendered video yet.", timeline: "Timeline", save: "Save edit",
    camera: "Camera", start: "In ms", end: "Out ms", caption: "Caption", remove: "Delete", review: "Review", reviewer: "Reviewer",
    note: "Review note", approve: "Approve", changes: "Request changes", reject: "Reject", rerender: "Render again", pending: "Pending", approved: "Approved",
    changes_requested: "Changes requested", rejected: "Rejected", saving: "Working", revision: "Revision", confidence: "Confidence", reference: "Reference camera",
    queue: "Render queue", cancel: "Cancel job", connected: "Progress connected", metrics: "Runtime metrics", calls: "Model calls", cost: "Estimated cost",
    average: "Average latency", failures: "Failed / timed out", pipeline: "Pipeline time",
    feedback: "Human feedback", switchRate: "Camera switch rate", editSessions: "Edit sessions", timing: "Timing edits", topFailure: "Top failure mode", noFailure: "No revision data",
  },
} as const;

function formatMs(value: number): string { return `${(value / 1000).toFixed(2)}s`; }

function normalizeTimeline(decision: Decision): Decision {
  let cursor = 0;
  const segments = decision.segments.map(segment => {
    const next = { ...segment, timelineStartMs: cursor };
    cursor += Math.max(0, segment.sourceEndMs - segment.sourceStartMs);
    return next;
  });
  return { ...decision, segments, durationTargetMs: cursor + decision.endCard.durationMs };
}

export function CookingVideoPage() {
  const { client } = useLoongClient();
  const { locale } = useI18n();
  const { events, sseStatus } = useLoongEvents();
  const copy = TEXT[locale];
  const [jobsRoot, setJobsRoot] = useState(() => localStorage.getItem("loong.cookingVideo.jobsRoot") ?? "data/jobs");
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [workspace, setWorkspace] = useState<Workspace>();
  const [draft, setDraft] = useState<Decision>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [reviewer, setReviewer] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [queueItem, setQueueItem] = useState<QueueItem>();
  const [metrics, setMetrics] = useState<MetricsSummary>();
  const [feedback, setFeedback] = useState<FeedbackSummary>();

  const loadWorkspace = useCallback(async (jobId: string) => {
    setBusy("workspace"); setError(""); setPreviewUrl(undefined);
    try {
      const [result, queue] = await Promise.all([
        client.gateway.rpc<Workspace>("cooking.video.workspace.get", { jobsRoot, jobId }),
        client.gateway.rpc<{ items: QueueItem[] }>("cooking.video.queue.list", { jobsRoot }),
      ]);
      setWorkspace(result); setDraft(result.decision); setSelectedJobId(jobId);
      setQueueItem(queue.items.find(item => item.jobId === jobId && ["queued", "running", "cancelling"].includes(item.status)));
      const [metricResult, feedbackResult] = await Promise.all([
        client.gateway.rpc<MetricsSummary>("cooking.video.metrics.get", { jobsRoot, jobId }).catch(() => undefined),
        client.gateway.rpc<FeedbackSummary>("cooking.video.feedback.summary", { jobsRoot, jobId }).catch(() => undefined),
      ]);
      setMetrics(metricResult); setFeedback(feedbackResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  }, [client, jobsRoot]);

  const loadJobs = useCallback(async () => {
    setBusy("jobs"); setError("");
    try {
      localStorage.setItem("loong.cookingVideo.jobsRoot", jobsRoot);
      const result = await client.gateway.rpc<{ jobs: JobSummary[] }>("cooking.video.jobs.list", { jobsRoot });
      setJobs(result.jobs);
      const firstJob = result.jobs[0];
      if (firstJob) await loadWorkspace(firstJob.jobId);
      else { setWorkspace(undefined); setDraft(undefined); setMetrics(undefined); setFeedback(undefined); setSelectedJobId(""); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  }, [client, jobsRoot, loadWorkspace]);

  useEffect(() => { void loadJobs(); }, []);

  useEffect(() => {
    const envelope = events.find(item => item.event.type === "cooking_video" && item.event.jobId === selectedJobId);
    if (!envelope || envelope.event.type !== "cooking_video") return;
    const payload = envelope.event.payload as { item?: QueueItem };
    if (!payload.item) return;
    setQueueItem(payload.item);
    if (["completed", "failed", "cancelled"].includes(payload.item.status)) void loadWorkspace(payload.item.jobId);
  }, [events, loadWorkspace, selectedJobId]);

  const updateSegment = (id: string, patch: Partial<Segment>) => setDraft(current => current ? normalizeTimeline({
    ...current, segments: current.segments.map(segment => segment.id === id ? { ...segment, ...patch } : segment),
  }) : current);
  const deleteSegment = (id: string) => setDraft(current => current ? normalizeTimeline({ ...current, segments: current.segments.filter(segment => segment.id !== id) }) : current);

  const save = async () => {
    if (!workspace || !draft) return;
    setBusy("save"); setError("");
    try {
      const result = await client.gateway.rpc<Workspace>("cooking.video.edit.save", { jobsRoot, jobId: workspace.job.jobId, revision: workspace.review.revision, decision: draft });
      setWorkspace(result); setDraft(result.decision);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const review = async (verdict: Exclude<Verdict, "pending">) => {
    if (!workspace) return;
    setBusy(verdict); setError("");
    try {
      await client.gateway.rpc("cooking.video.review.submit", { jobsRoot, jobId: workspace.job.jobId, revision: workspace.review.revision, verdict, note, reviewer });
      await loadWorkspace(workspace.job.jobId); setNote("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const rerender = async () => {
    if (!workspace) return;
    setBusy("render"); setError("");
    try {
      const queued = await client.gateway.rpc<QueueItem>("cooking.video.rerender", { jobsRoot, jobId: workspace.job.jobId, draft: true });
      setQueueItem(queued);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const cancelQueued = async () => {
    if (!queueItem) return;
    setBusy("cancel"); setError("");
    try {
      const cancelled = await client.gateway.rpc<QueueItem>("cooking.video.queue.cancel", { queueId: queueItem.queueId });
      setQueueItem(cancelled);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const loadPreview = async () => {
    if (!workspace) return;
    setBusy("preview"); setError("");
    try {
      const result = await client.gateway.rpc<{ dataUrl?: string }>("cooking.video.preview.read", { jobsRoot, jobId: workspace.job.jobId });
      setPreviewUrl(result.dataUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const eventCount = workspace?.timeline?.events.length ?? 0;
  const totalContentMs = useMemo(() => draft?.segments.reduce((sum, segment) => sum + segment.sourceEndMs - segment.sourceStartMs, 0) ?? 0, [draft]);
  const editIsDirty = Boolean(workspace && draft && JSON.stringify(workspace.decision) !== JSON.stringify(draft));
  const topFailureMode = feedback ? Object.entries(feedback.failureModes).sort((left, right) => right[1] - left[1]).find(([, count]) => count > 0)?.[0] : undefined;
  const focusEvent = (event: { event: string; cameraId: string }) => {
    const segment = draft?.segments.find(item => item.event === event.event && item.cameraId === event.cameraId)
      ?? draft?.segments.find(item => item.event === event.event);
    if (segment) document.getElementById(`segment-${segment.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><h1>{copy.title}</h1><p>{copy.lead}</p></div>
      {workspace ? <div className={styles.headerMeta}><span>{copy.revision} {workspace.review.revision}</span><strong data-verdict={workspace.review.verdict}>{copy[workspace.review.verdict]}</strong></div> : null}
    </header>

    <section className={styles.rootBar} aria-label={copy.root}>
      <label><span>{copy.root}</span><input value={jobsRoot} onChange={event => setJobsRoot(event.target.value)} /></label>
      <button type="button" onClick={() => void loadJobs()} disabled={Boolean(busy)}>{busy === "jobs" ? copy.saving : copy.load}</button>
    </section>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {queueItem ? <section className={styles.queueBar} aria-live="polite">
      <div><strong>{copy.queue}</strong><span>{queueItem.status}{queueItem.stage ? ` / ${queueItem.stage}` : ""}{queueItem.position > 0 ? ` / #${queueItem.position}` : ""}</span></div>
      <span>{sseStatus === "live" ? copy.connected : sseStatus}</span>
      {["queued", "running", "cancelling"].includes(queueItem.status) ? <button type="button" onClick={() => void cancelQueued()} disabled={Boolean(busy) || queueItem.status === "cancelling"}>{copy.cancel}</button> : null}
    </section> : null}

    <div className={styles.workspace}>
      <aside className={styles.jobRail}>
        <h2>{copy.jobs}</h2>
        {busy === "jobs" ? <div className={styles.skeleton} /> : jobs.length === 0 ? <p className={styles.empty}>{copy.noJobs}</p> : jobs.map(job => <button key={job.jobId} type="button" className={job.jobId === selectedJobId ? styles.jobActive : styles.job} onClick={() => void loadWorkspace(job.jobId)}>
          <strong>{job.jobId}</strong><span>{job.status}</span><time>{new Date(job.updatedAt).toLocaleString(locale)}</time>
        </button>)}
      </aside>

      <main className={styles.reviewPane}>
        {!workspace || !draft ? <div className={styles.blank}>{busy === "workspace" ? <div className={styles.skeletonLarge} /> : copy.selectJob}</div> : <>
          {metrics ? <section className={styles.metricsPanel} aria-label={copy.metrics}>
            <div><span>{copy.metrics}</span><strong>{metrics.model.succeeded}/{metrics.model.calls}</strong></div>
            <dl><div><dt>{copy.calls}</dt><dd>{metrics.model.calls}</dd></div><div><dt>{copy.cost}</dt><dd>${metrics.model.estimatedCostUsd.toFixed(4)}</dd></div><div><dt>{copy.average}</dt><dd>{metrics.model.averageDurationMs} ms</dd></div><div><dt>{copy.failures}</dt><dd>{metrics.model.failed} / {metrics.model.timedOut}</dd></div><div><dt>{copy.pipeline}</dt><dd>{formatMs(metrics.pipeline.totalDurationMs)}</dd></div></dl>
          </section> : null}
          {feedback ? <section className={styles.feedbackPanel} aria-label={copy.feedback}>
            <strong>{copy.feedback}</strong><span>{copy.switchRate} <b>{Math.round(feedback.cameraChangeRate * 100)}%</b></span><span>{copy.editSessions} <b>{feedback.editSessions}</b></span><span>{copy.timing} <b>{feedback.timingChanges}</b></span><span>{copy.topFailure} <b>{topFailureMode ?? copy.noFailure}</b></span>
          </section> : null}
          <div className={styles.overviewGrid}>
            <section className={styles.panel}><h2>{copy.sync}</h2>{workspace.sync ? <>
              <dl className={styles.facts}><div><dt>{copy.reference}</dt><dd>{workspace.sync.referenceCameraId}</dd></div><div><dt>{copy.confidence}</dt><dd>{Math.round(workspace.sync.confidence * 100)}%</dd></div><div><dt>Method</dt><dd>{workspace.sync.method}</dd></div></dl>
              <div className={styles.offsets}>{Object.entries(workspace.sync.cameras).map(([camera, value]) => <span key={camera}><b>{camera}</b>{value.offsetMs} ms</span>)}</div>
            </> : <p className={styles.empty}>No sync map</p>}</section>
            <section className={styles.panel}><h2>{copy.events} <span>{eventCount}</span></h2><div className={styles.eventList}>{workspace.timeline?.events.slice(0, 12).map(event => <button type="button" key={event.occurrenceId} onClick={() => focusEvent(event)}>
              <b>{event.event}</b><span>{event.cameraId}</span><time>{formatMs(event.startMs)}</time><em>{Math.round(event.confidence * 100)}%</em>
            </button>) ?? <p className={styles.empty}>No detected events</p>}</div></section>
            <section className={styles.preview}><div className={styles.panelHead}><h2>{copy.preview}</h2><span>{workspace.previewPath ?? copy.noPreview}</span></div>
              {previewUrl ? <video controls preload="metadata" src={previewUrl} /> : <button type="button" className={styles.previewLoad} onClick={() => void loadPreview()} disabled={!workspace.previewPath || Boolean(busy)}>{busy === "preview" ? copy.saving : copy.loadPreview}</button>}
            </section>
          </div>

          <section className={styles.timelinePanel}>
            <div className={styles.panelHead}><div><h2>{copy.timeline}</h2><span>{draft.segments.length} clips, {formatMs(totalContentMs)}</span></div><button type="button" onClick={() => void save()} disabled={Boolean(busy) || draft.segments.length === 0}>{busy === "save" ? copy.saving : copy.save}</button></div>
            <div className={styles.timelineStrip}>{draft.segments.map(segment => <span key={segment.id} style={{ flexGrow: segment.sourceEndMs - segment.sourceStartMs }}>{segment.cameraId}<small>{formatMs(segment.sourceEndMs - segment.sourceStartMs)}</small></span>)}</div>
            <div className={styles.segmentList}>{draft.segments.map(segment => <article id={`segment-${segment.id}`} key={segment.id} className={styles.segment}>
              <div className={styles.segmentIdentity}><strong>{segment.event}</strong><span>{formatMs(segment.timelineStartMs)}</span></div>
              <label><span>{copy.camera}</span><select value={segment.cameraId} onChange={event => updateSegment(segment.id, { cameraId: event.target.value })}>{workspace.manifest.sources.map(source => <option key={source.cameraId}>{source.cameraId}</option>)}</select></label>
              <label><span>{copy.start}</span><input type="number" min={0} value={segment.sourceStartMs} onChange={event => updateSegment(segment.id, { sourceStartMs: Number(event.target.value) })} /></label>
              <label><span>{copy.end}</span><input type="number" min={1} value={segment.sourceEndMs} onChange={event => updateSegment(segment.id, { sourceEndMs: Number(event.target.value) })} /></label>
              <label className={styles.captionField}><span>{copy.caption}</span><input maxLength={40} value={segment.caption ?? ""} onChange={event => updateSegment(segment.id, { caption: event.target.value })} /></label>
              <button type="button" className={styles.deleteButton} onClick={() => deleteSegment(segment.id)}>{copy.remove}</button>
            </article>)}</div>
          </section>

          <section className={styles.reviewPanel}>
            <div><h2>{copy.review}</h2><div className={styles.reviewFields}><label><span>{copy.reviewer}</span><input value={reviewer} onChange={event => setReviewer(event.target.value)} /></label><label><span>{copy.note}</span><textarea value={note} onChange={event => setNote(event.target.value)} rows={2} /></label></div></div>
            <div className={styles.reviewActions}><button type="button" onClick={() => void review("approved")} disabled={Boolean(busy) || editIsDirty}>{copy.approve}</button><button type="button" onClick={() => void review("changes_requested")} disabled={Boolean(busy) || editIsDirty}>{copy.changes}</button><button type="button" className={styles.dangerButton} onClick={() => void review("rejected")} disabled={Boolean(busy) || editIsDirty}>{copy.reject}</button><button type="button" className={styles.primaryButton} onClick={() => void rerender()} disabled={Boolean(busy) || editIsDirty || workspace.review.verdict !== "approved"}>{busy === "render" ? copy.saving : copy.rerender}</button></div>
          </section>
        </>}
      </main>
    </div>
  </div>;
}
