import { readFile } from "node:fs/promises";
import type {
  ApprovalRegistry,
  KpiMetricDefinition,
  KpiMetricSource,
  KpiSnapshot,
  KpiSnapshotMetric,
  KpiTemplate,
  KpiTemplateDocument,
  KpiTemplateStore,
  TicketDocument,
} from "../types.js";

const EMPTY: KpiTemplateDocument = { templates: [] };

export function createFileKpiTemplateStore(filePath: string): KpiTemplateStore {
  return {
    async load() {
      const document = await readJsonFile(filePath, EMPTY);
      return normalizeKpiTemplateDocument(document, filePath);
    },
  };
}

export function buildKpiSnapshot(input: {
  template: KpiTemplate;
  tickets: TicketDocument;
  approvals: ApprovalRegistry;
  employeeId?: string;
}): KpiSnapshot {
  const metrics = input.template.metrics.map(metric => ({
    id: metric.id,
    name: metric.name,
    value: resolveMetricValue(metric, input.tickets, input.approvals, input.employeeId),
  }));
  return {
    templateId: input.template.id,
    ...(input.employeeId ? { employeeId: input.employeeId } : {}),
    generatedAt: new Date().toISOString(),
    metrics,
  };
}

function resolveMetricValue(
  metric: KpiMetricDefinition,
  tickets: TicketDocument,
  approvals: ApprovalRegistry,
  employeeId?: string,
): number {
  const scopedTickets = employeeId
    ? tickets.tickets.filter(ticket => ticket.assigneeEmployeeId === employeeId || ticket.createdByEmployeeId === employeeId)
    : tickets.tickets;

  switch (metric.source) {
    case "tickets.open":
      return scopedTickets.filter(ticket => ticket.status === "open" || ticket.status === "in_progress").length;
    case "tickets.done":
      return scopedTickets.filter(ticket => ticket.status === "done").length;
    case "runs.completed":
      return scopedTickets.filter(ticket => ticket.status === "done" && ticket.runId).length;
    case "approvals.pending":
      return approvals.requests.filter(request => request.status === "pending").length;
    default:
      return 0;
  }
}

function normalizeKpiTemplateDocument(value: unknown, configPath: string): KpiTemplateDocument {
  if (!value || typeof value !== "object") {
    return { ...EMPTY, configPath };
  }
  const raw = value as Record<string, unknown>;
  const templates = Array.isArray(raw.templates)
    ? raw.templates
        .map((entry, index) => normalizeTemplate(entry, index))
        .filter((entry): entry is KpiTemplate => entry !== undefined)
    : [];
  return { templates, configPath };
}

function normalizeTemplate(value: unknown, index: number): KpiTemplate | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const metrics = Array.isArray(raw.metrics)
    ? raw.metrics
        .map((entry, metricIndex) => normalizeMetric(entry, index, metricIndex))
        .filter((entry): entry is KpiMetricDefinition => entry !== undefined)
    : [];
  return {
    id: readString(raw.id, `KPI template ${index + 1} id`),
    name: readString(raw.name, `KPI template ${index + 1} name`),
    metrics,
  };
}

function normalizeMetric(value: unknown, templateIndex: number, metricIndex: number): KpiMetricDefinition | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const source = raw.source;
  if (!isMetricSource(source)) {
    return undefined;
  }
  return {
    id: readString(raw.id, `KPI template ${templateIndex + 1} metric ${metricIndex + 1} id`),
    name: readString(raw.name, `KPI template ${templateIndex + 1} metric ${metricIndex + 1} name`),
    source,
  };
}

function isMetricSource(value: unknown): value is KpiMetricSource {
  return (
    value === "tickets.open"
    || value === "tickets.done"
    || value === "runs.completed"
    || value === "approvals.pending"
  );
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}
