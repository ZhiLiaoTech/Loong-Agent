import type { DragonLifecycleHook, DragonLifecycleHookRequest } from "@dragon/core";
import { readEmployeeId } from "./policy.js";
import type { OrgTicket, TicketStore } from "./types.js";

export interface TicketLifecycleHookOptions {
  ticketStore: TicketStore;
}

export function createTicketLifecycleHook(options: TicketLifecycleHookOptions): DragonLifecycleHook {
  return {
    name: "org-ticket-lifecycle",
    async onLifecycle(request) {
      if (request.phase !== "end" && request.phase !== "error") {
        return;
      }
      const employeeId = readEmployeeId(request.metadata);
      if (!employeeId) {
        return;
      }
      const status = request.phase === "end" ? "done" : "blocked";
      const title = request.phase === "end"
        ? `Run completed (${request.runId.slice(0, 8)})`
        : `Run failed (${request.runId.slice(0, 8)})`;
      await appendTicket(options.ticketStore, {
        request,
        employeeId,
        status,
        title,
      });
    },
  };
}

async function appendTicket(
  store: TicketStore,
  input: {
    request: DragonLifecycleHookRequest;
    employeeId: string;
    status: OrgTicket["status"];
    title: string;
  },
): Promise<void> {
  const registry = await store.load();
  const now = new Date().toISOString();
  const description = input.request.error?.trim() || input.request.userMessage?.trim();
  const ticket: OrgTicket = {
    id: crypto.randomUUID(),
    title: input.title,
    status: input.status,
    createdAt: now,
    updatedAt: now,
    assigneeEmployeeId: input.employeeId,
    createdByEmployeeId: input.employeeId,
    runId: input.request.runId,
    tags: ["lifecycle", input.request.phase],
    ...(description ? { description } : {}),
  };
  await store.save({ tickets: [...registry.tickets, ticket] });
}
