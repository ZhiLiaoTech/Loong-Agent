import { useCallback, useEffect, useRef, useState } from "react";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { useDragonEvents } from "../events/EventsContext.js";
import type { GatewayRunRecord } from "../run/types.js";
import type { SidebarNavCounts } from "./Sidebar.js";

const POLL_MS = 8000;

const EMPTY_COUNTS: SidebarNavCounts = {
  run: 0,
  models: 0,
  agents: 0,
  observe: 0,
};

export function useNavCounts(): SidebarNavCounts {
  const client = useGatewayClient();
  const { events } = useDragonEvents();
  const eventsLengthRef = useRef(events.length);
  eventsLengthRef.current = events.length;

  const [counts, setCounts] = useState<SidebarNavCounts>(EMPTY_COUNTS);

  const refresh = useCallback(async () => {
    const [runsResult, modelResult, agentResult, healthResult] = await Promise.all([
      client.rpc<{ runs: GatewayRunRecord[] }>("runs.list", { limit: 20 }).catch(() => ({ runs: [] })),
      client.rpc<{ providers: unknown[] }>("model.config.get").catch(() => ({ providers: [] })),
      client.rpc<{ profiles: unknown[] }>("agent.config.get").catch(() => ({ profiles: [] })),
      client.fetchHealth().catch(() => ({ ok: false as const, error: "offline", status: 0 })),
    ]);

    const runs = runsResult.runs ?? [];
    const runActive = runs.filter(
      run => run.state === "running" || run.state === "cancelling",
    ).length;

    const next: SidebarNavCounts = {
      run: runs.length,
      models: modelResult.providers?.length ?? 0,
      agents: agentResult.profiles?.length ?? 0,
      observe: eventsLengthRef.current,
    };

    if (runActive > 0) {
      next.runActive = runActive;
    }

    if ("ok" in healthResult && healthResult.ok === true) {
      next.systemOnline = true;
    } else if ("ok" in healthResult && healthResult.ok === false) {
      next.systemOnline = false;
    }

    setCounts(next);
  }, [client]);

  useEffect(() => {
    setCounts(current => ({ ...current, observe: events.length }));
  }, [events.length]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return counts;
}
