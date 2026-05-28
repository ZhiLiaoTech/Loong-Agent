import { useCallback, useEffect, useState } from "react";
import { GatewayApiError, type GatewayHealthPayload } from "../../api/index.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { defaultToolInput } from "./defaultToolInput.js";
import {
  EMPTY_CRON_FORM,
  type CronJob,
  type CronJobFormState,
  type HealthState,
  type PluginSummary,
  type ToolCatalogEntry,
} from "./types.js";

const HEALTH_POLL_MS = 5000;

export function useSystemPage() {
  const client = useGatewayClient();
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [cronJobs, setCronJobs] = useState<readonly CronJob[]>([]);
  const [plugins, setPlugins] = useState<readonly PluginSummary[]>([]);
  const [tools, setTools] = useState<readonly ToolCatalogEntry[]>([]);
  const [cronForm, setCronForm] = useState<CronJobFormState>(EMPTY_CRON_FORM);
  const [cronResult, setCronResult] = useState<string | null>(null);
  const [toolResult, setToolResult] = useState<string | null>(null);
  const [toolWorkspace, setToolWorkspace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cronSaving, setCronSaving] = useState(false);

  const refreshHealth = useCallback(async () => {
    const result = await client.fetchHealth();
    if ("ok" in result && result.ok === false) {
      setHealth({ status: "offline", error: result.error });
      return;
    }
    setHealth({ status: "online", payload: result });
  }, [client]);

  const refreshCronJobs = useCallback(async () => {
    const payload = await client.rpc<{ jobs: CronJob[] }>("cron.jobs.list");
    setCronJobs(payload.jobs ?? []);
  }, [client]);

  const refreshPlugins = useCallback(async () => {
    const payload = await client.rpc<{ plugins: PluginSummary[] }>("plugins.list");
    setPlugins(payload.plugins ?? []);
  }, [client]);

  const refreshTools = useCallback(async () => {
    const payload = await client.rpc<{ tools: ToolCatalogEntry[] }>("tools.catalog");
    setTools(payload.tools ?? []);
  }, [client]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        refreshHealth(),
        refreshCronJobs(),
        refreshPlugins(),
        refreshTools(),
      ]);
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
      await refreshHealth().catch(() => setHealth({ status: "offline", error: message }));
      setCronJobs([]);
      setPlugins([]);
      setTools([]);
    } finally {
      setLoading(false);
    }
  }, [refreshCronJobs, refreshHealth, refreshPlugins, refreshTools]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshHealth();
    }, HEALTH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshHealth]);

  const clearCronForm = useCallback(() => {
    setCronForm(EMPTY_CRON_FORM);
  }, []);

  const editCronJob = useCallback((id: string) => {
    const job = cronJobs.find(entry => entry.id === id);
    if (!job) {
      return;
    }
    setCronForm({
      editingId: job.id,
      id: job.id,
      schedule: job.schedule,
      sessionId: job.sessionId ?? "cron",
      message: job.message ?? "",
      enabled: job.enabled !== false,
    });
  }, [cronJobs]);

  const saveCronJob = useCallback(async () => {
    const id = cronForm.id.trim();
    const schedule = cronForm.schedule.trim();
    const sessionId = cronForm.sessionId.trim();
    const message = cronForm.message.trim();
    if (!id || !schedule || !sessionId || !message) {
      return;
    }

    setCronSaving(true);
    setCronResult("Saving…");
    try {
      const payload = await client.rpc<{ job: CronJob }>("cron.job.upsert", {
        id,
        schedule,
        sessionId,
        message,
        enabled: cronForm.enabled,
        metadata: { source: "dashboard" },
      });
      setCronResult(JSON.stringify(payload.job, null, 2));
      clearCronForm();
      await refreshCronJobs();
    } catch (caught) {
      const msg = caught instanceof GatewayApiError ? caught.message : String(caught);
      setCronResult(msg);
    } finally {
      setCronSaving(false);
    }
  }, [clearCronForm, client, cronForm, refreshCronJobs]);

  const removeCronJob = useCallback(async (id: string) => {
    setCronResult("Removing…");
    try {
      const payload = await client.rpc("cron.job.remove", { id });
      setCronResult(JSON.stringify(payload, null, 2));
      if (cronForm.editingId === id) {
        clearCronForm();
      }
      await refreshCronJobs();
    } catch (caught) {
      const msg = caught instanceof GatewayApiError ? caught.message : String(caught);
      setCronResult(msg);
    }
  }, [clearCronForm, client, cronForm.editingId, refreshCronJobs]);

  const tickCron = useCallback(async () => {
    setCronResult("Ticking…");
    try {
      const payload = await client.rpc("cron.tick");
      setCronResult(JSON.stringify(payload, null, 2));
      await refreshCronJobs();
    } catch (caught) {
      const msg = caught instanceof GatewayApiError ? caught.message : String(caught);
      setCronResult(msg);
    }
  }, [client, refreshCronJobs]);

  const invokeTool = useCallback(async (toolName: string) => {
    const tool = tools.find(entry => entry.name === toolName);
    if (!tool?.directInvokeAllowed) {
      return;
    }

    const params: Record<string, unknown> = {
      toolName,
      input: defaultToolInput(toolName),
      sessionId: "dashboard",
    };
    const workspace = toolWorkspace.trim();
    if (workspace) {
      params.workspace = workspace;
    }

    setToolResult(`Running ${toolName}…`);
    try {
      const payload = await client.rpc("tool.invoke", params);
      setToolResult(JSON.stringify(payload, null, 2));
    } catch (caught) {
      const msg = caught instanceof GatewayApiError ? caught.message : String(caught);
      setToolResult(msg);
    }
  }, [client, toolWorkspace, tools]);

  return {
    health,
    cronJobs,
    plugins,
    tools,
    cronForm,
    setCronForm,
    cronResult,
    toolResult,
    toolWorkspace,
    setToolWorkspace,
    error,
    loading,
    cronSaving,
    refreshAll,
    refreshHealth,
    refreshCronJobs,
    refreshPlugins,
    refreshTools,
    saveCronJob,
    removeCronJob,
    tickCron,
    clearCronForm,
    editCronJob,
    invokeTool,
  };
}
