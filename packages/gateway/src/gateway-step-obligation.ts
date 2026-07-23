import {
  obligationEmployeeUserId,
  type ObligationService,
} from "@loong/memory";
import type { GatewayStepObligationRecorder } from "./gateway-step-execute.js";

/**
 * Phase 3.0 (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §7/§12 R4): binds the
 * obligation recording service to the step execution hook.
 *
 * Step executions carry `{ tenantId, employeeId }` but no channel user; the
 * recorder therefore looks obligations up under the `employee:{employeeId}`
 * user namespace (the same convention the design reserves for system /
 * orchestration obligations). Human-channel obligations live under the real
 * userId and are attached via the explicit obligation.attachEvidence RPC —
 * the two paths never cross identity boundaries (§9).
 */
export function createGatewayStepObligationRecorder(service: ObligationService): GatewayStepObligationRecorder {
  return {
    async attachStepResult(input) {
      return await service.attachStepResult(
        { tenantId: input.tenantId, userId: obligationEmployeeUserId(input.employeeId) },
        input.idempotencyKey,
        input.runId !== undefined ? { runId: input.runId } : {},
        { operator: "step-execution", source: "step.execute" },
      );
    },
  };
}
