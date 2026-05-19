import type { GatewayHealthPayload } from "../../api/types.js";

export interface CronJob {
  id: string;
  schedule: string;
  sessionId?: string;
  message?: string;
  enabled?: boolean;
  lastStatus?: string;
  lastDeliveredAt?: string;
  lastError?: string;
  nextRunAt?: string;
}

export interface CronJobFormState {
  editingId: string;
  id: string;
  schedule: string;
  sessionId: string;
  message: string;
  enabled: boolean;
}

export const EMPTY_CRON_FORM: CronJobFormState = {
  editingId: "",
  id: "",
  schedule: "",
  sessionId: "cron",
  message: "",
  enabled: true,
};

export interface PluginSummary {
  name: string;
  version?: string;
  description?: string;
  tools?: readonly { name: string; permission?: string }[];
  providers?: readonly { id: string; displayName?: string }[];
  memoryBackends?: readonly { id: string; displayName?: string }[];
  lifecycleHooks?: readonly string[];
}

export interface ToolCatalogEntry {
  name: string;
  description?: string;
  permission?: string;
  capabilities?: readonly string[];
  directInvokeAllowed?: boolean;
}

export type HealthState =
  | { status: "loading" }
  | { status: "online"; payload: GatewayHealthPayload }
  | { status: "offline"; error: string };

export type { GatewayHealthPayload };
