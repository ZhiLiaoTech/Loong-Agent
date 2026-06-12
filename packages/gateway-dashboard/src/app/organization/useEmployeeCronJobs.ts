import { useCallback, useEffect, useState } from "react";
import { useGatewayClient } from "../auth/useGatewayClient.js";

/** Subset of LoongCronJobRecord the cron tab needs. */
export interface EmployeeCronJob {
  id: string;
  sessionId: string;
  message: string;
  schedule: string;
  enabled: boolean;
  nextRunAt?: string;
  profileId?: string;
  workspace?: string;
  model?: string;
  thinking?: string;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UseEmployeeCronJobs {
  jobs: EmployeeCronJob[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  refresh: () => Promise<void>;
  toggle: (job: EmployeeCronJob) => Promise<void>;
}

/**
 * Load and manage the cron jobs that belong to a digital employee, identified
 * by its profile id. Suite-installed jobs carry `profileId === <suiteId>` and
 * `metadata.suiteId === <suiteId>`, so we match on either.
 */
export function useEmployeeCronJobs(profileId: string | undefined): UseEmployeeCronJobs {
  const client = useGatewayClient();
  const [jobs, setJobs] = useState<EmployeeCronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await client.rpc<{ jobs: EmployeeCronJob[] }>("cron.jobs.list");
      const all = payload.jobs ?? [];
      const filtered = profileId
        ? all.filter(
            (job: EmployeeCronJob) =>
              job.profileId === profileId || job.metadata?.["suiteId"] === profileId,
          )
        : all;
      setJobs(filtered);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [client, profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (job: EmployeeCronJob) => {
      setBusyId(job.id);
      setError(null);
      const next = !job.enabled;
      // optimistic update
      setJobs(prev => prev.map(item => (item.id === job.id ? { ...item, enabled: next } : item)));
      try {
        await client.rpc("cron.job.upsert", { ...job, enabled: next });
        await refresh();
      } catch (caught) {
        // revert on failure
        setJobs(prev => prev.map(item => (item.id === job.id ? { ...item, enabled: job.enabled } : item)));
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusyId(null);
      }
    },
    [client, refresh],
  );

  return { jobs, loading, error, busyId, refresh, toggle };
}
