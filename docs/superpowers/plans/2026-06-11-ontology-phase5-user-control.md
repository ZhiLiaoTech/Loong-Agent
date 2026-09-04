# Ontology Memory Phase 5 — User Control Plane (FR-12/13/14, §10/§11)

## Status — COMPLETE

- [x] Store extension (audit actions, delete/list methods, repoint assertionIds detail)
- [x] Service layer `packages/memory/src/ontology/ontology-user-control.ts` + tests (15 pass)
- [x] Gateway RPC params/types/handler/parse (4 files; parse was nearly missed)
- [x] `packages/gateway/src/index.ts` wiring (ontologyStore option, 16 handlers, write probe)
- [x] CLI wiring (bootstrap registers ontology candidate tools; runtime-factory creates
      SqliteOntologyStore + permission rules; gateway command passes ontologyStore;
      gateway package.json + @loong/memory dep w/ manual junction)
- [x] Gateway RPC test `testGatewayOntologyUserControlRpc` (read-only gating, write allow,
      cross-user isolation, missing userId 400)
- [x] Dashboard `OntologyPanel.tsx` + useObservePage + ObserveWorkspace mount
      (tsc + vite build verified; dist removed to keep baseline state)
- [x] Regression: 120 registry tests in-process + 16 core subprocesses, all pass.
      3 known baselines untouched: dashboard memory review smoke / sandbox exec tool /
      ai summarization pipeline.
- [x] Wrappers/logs cleaned up. No git commit.

## Current edits to gateway/src/index.ts

1. Import `GATEWAY_DEFAULT_TENANT_ID` (runtime) + `MemoryIdentity` (type) + new param types (both import & export blocks).
2. Import `createOntologyUserControlService` + `OntologyUserControlService` from @loong/memory (add dep to gateway package.json).
3. `HttpLoongGatewayOptions.ontologyStore?` + `#ontology` field + constructor init.
4. capabilities: 13 service-backed names + candidate trio tool-gated.
5. `#rpcDeps()`: 16 dispatch methods.
6. Private methods (near `#memoryCandidateReviewPermissions`):
   - `#requireOntologyService()`, `#requireOntologyIdentity(params)` → MemoryIdentity
   - `#assertOntologyWriteAllowed(op)` / `#ontologyControlPermissions()` via synthetic `ontology_user_control_write` probe
   - `#invokeOntologyCandidateTool(name, input, identity)` (identity via invocation.metadata)
   - 16 handlers; read group ungated except export w/ includeSensitiveEvidence; knowledge.list payload + `permissions:{canWrite}`; candidates.list payload + `review:{canPromote,canReject}`.

## Remaining

- CLI: `bootstrap-agent-tool-registry.ts` (push ontology candidate tools), `runtime-factory.ts` (create SqliteOntologyStore, permission rules allow read / gate write, expose ontologyStore), `commands/gateway.ts` (pass to createHttpGateway).
- Gateway tests in `gateway.tests.ts` (mirror testGatewayMemoryCandidateRpc).
- Dashboard `OntologyPanel.tsx` (mirror MemoryCandidatesPanel) + useObservePage refresh + ObserveWorkspace mount.
- Regression wrappers: service, gateway-only, full in-process + core subprocess. 3 known-failing baselines: dashboard memory review smoke / sandbox exec tool / ai summarization pipeline.
- Cleanup run-*.mjs wrappers; final report.
