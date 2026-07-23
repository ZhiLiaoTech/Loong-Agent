export { createFileMemoryStore, FileMemoryStore } from "./file-memory-store.js";
export { createSqliteMemoryStore, SqliteMemoryStore } from "./sqlite-memory-store.js";
export {
  assertMemoryIdentity,
  assertMemoryWriteIdentity,
  isMemoryIdentity,
  sanitizeMemoryIdentitySegment,
  LOCAL_COMPAT_MEMORY_IDENTITY,
  LOCAL_COMPAT_TENANT_ID,
  LOCAL_COMPAT_USER_ID,
} from "./memory-store-v2.js";
export type {
  MemoryDraft,
  MemorySearchContext,
  MemoryStoreV2,
} from "./memory-store-v2.js";
export { createFileMemoryStoreV2, FileMemoryStoreV2 } from "./file-memory-store-v2.js";
export type { FileMemoryStoreV2Options } from "./file-memory-store-v2.js";
export { createSqliteMemoryStoreV2, SqliteMemoryStoreV2 } from "./sqlite-memory-store-v2.js";
export type { SqliteMemoryStoreV2Options } from "./sqlite-memory-store-v2.js";
export { createLegacyMemoryStoreV2, LegacyMemoryStoreV2 } from "./legacy-memory-store-v2.js";
export type { LegacyMemoryStoreV2Options } from "./legacy-memory-store-v2.js";
export {
  createMemoryId,
  parseMemoryRememberInput,
  parseMemorySearchInput,
  scoreMemoryRecord,
  summarizeMemoryResults,
  validateMemoryDraft,
} from "./memory-record-helpers.js";
export type {
  FileMemoryStoreOptions,
  MemoryRecord,
  MemoryRememberInput,
  MemoryRememberOutput,
  MemorySearchInput,
  MemorySearchOutput,
  MemorySearchResult,
  MemoryStore,
  SqliteMemoryStoreOptions,
} from "./memory-record-types.js";
export { ABSOLUTE_MAX_MEMORY_RECORD_BYTES, isMemoryScope } from "./memory-record-types.js";
export type {
  MemoryCandidateLifecycleHookOptions,
  MemoryCandidateListInput,
  MemoryCandidateListOutput,
  MemoryCandidatePromoteInput,
  MemoryCandidatePromoteOutput,
  MemoryCandidateRecord,
  MemoryCandidateRejectInput,
  MemoryCandidateRejectOutput,
  MemoryCandidateStatus,
  MemoryCandidateToolsOptions,
} from "./memory-candidate-types.js";
export {
  createMemoryCandidateLifecycleHook,
  createMemoryCandidateListTool,
  createMemoryCandidatePromoteTool,
  createMemoryCandidateRejectTool,
  createMemoryCandidateTools,
} from "./memory-candidate-tools.js";
export { withMemoryFileLock } from "./memory-file-lock.js";
export type {
  FileTrajectoryStoreOptions,
  TrajectoryGetInput,
  TrajectoryGetOutput,
  TrajectoryListFilter,
  TrajectoryListInput,
  TrajectoryListOutput,
  TrajectoryListResult,
  TrajectoryRecordSummary,
  TrajectoryStore,
} from "./trajectory-types.js";
export { createFileTrajectoryStore, FileTrajectoryStore } from "./file-trajectory-store.js";
export { createTrajectoryTools, createTrajectoryGetTool, createTrajectoryListTool } from "./trajectory-tools.js";
export { MemoryToolError, sanitizeMemoryToolError } from "./memory-tool-error.js";
export { safelyInvokeMemoryTool } from "./memory-tool-invoke.js";
export {
  fitText,
  isIsoDate,
  normalizeOptionalText,
  normalizeRunId,
  shiftDate,
  summarizeText,
  tokenize,
} from "./memory-text.js";
export { assertCanAppendFile, assertCanAppendRegularFile } from "./memory-file-io.js";
export type {
  FileSessionStoreOptions,
  SessionMessage,
  SessionSource,
  SessionStore,
  SessionTurnRecord,
  SessionUsage,
} from "./memory-types.js";
export {
  createFileSessionStore,
  FileSessionStore,
  isLoongSource,
  isTurnStatus,
  parseTurnRecord,
  sessionPath,
} from "./file-session-store.js";
export type { MemoryContextProviderOptions } from "./memory-context-provider.js";
export { createMemoryContextProvider } from "./memory-context-provider.js";
export type { MarkdownMemoryContextProviderOptions } from "./markdown-memory-context.js";
export { createMarkdownMemoryContextProvider } from "./markdown-memory-context.js";
export type { SessionCompactionContextProviderOptions } from "./session-compaction.js";
export { createSessionCompactionContextProvider } from "./session-compaction.js";
export {
  createMemoryRememberTool,
  createMemorySearchTool,
  createMemoryTools,
} from "./memory-tools.js";
export type {
  AssertionSourceType,
  OntologyAssertion,
  OntologyAssertionStatus,
  OntologyCandidateDraft,
  OntologyCandidateExtractor,
  OntologyEntity,
  OntologyEntityRef,
  OntologyEntityStatus,
  OntologyEpisode,
  OntologyEvidence,
  OntologySensitivity,
  OntologySupersession,
  UserProfileSnapshot,
} from "./ontology/ontology-types.js";
export {
  isAssertionSourceType,
  isOntologyAssertionStatus,
  isOntologyEntityStatus,
  isOntologySensitivity,
} from "./ontology/ontology-types.js";
export type { OntologyEntityType, OntologyPredicate } from "./ontology/ontology-vocabulary.js";
export {
  assertOntologyEntityType,
  assertOntologyPredicate,
  isOntologyEntityType,
  isOntologyPredicate,
  ONTOLOGY_ENTITY_TYPES,
  ONTOLOGY_PREDICATES,
} from "./ontology/ontology-vocabulary.js";
export type { AssertionWriteValidationContext } from "./ontology/ontology-validator.js";
export {
  validateAssertionSensitivity,
  validateOntologyAssertionWrite,
  validateOntologyEntityWrite,
} from "./ontology/ontology-validator.js";
export type {
  OntologyAssertionFilter,
  OntologyAssertionPatch,
  OntologyAssertionWrite,
  OntologyAuditAction,
  OntologyAuditEntryWrite,
  OntologyAuditFilter,
  OntologyAuditRecord,
  OntologyAuditRecordKind,
  OntologyCandidateReview,
  OntologyEntityFilter,
  OntologyEntityWrite,
  OntologyEpisodeWrite,
  OntologyEvidenceWrite,
  OntologyStore,
  OntologyWriteMeta,
} from "./ontology/ontology-store.js";
export type { SqliteOntologyStoreOptions } from "./ontology/sqlite-ontology-store.js";
export {
  ABSOLUTE_ONTOLOGY_LIST_LIMIT,
  createSqliteOntologyStore,
  DEFAULT_ONTOLOGY_LIST_LIMIT,
  SqliteOntologyStore,
} from "./ontology/sqlite-ontology-store.js";
export type {
  OntologyIngestContext,
  OntologyIngestResult,
  OntologyPromoteResult,
  OntologyResolver,
  OntologyResolverOptions,
} from "./ontology/ontology-resolver.js";
export {
  createOntologyResolver,
  ontologyAssertionFactKey,
  ontologyCandidateFactKey,
} from "./ontology/ontology-resolver.js";
export type { OntologyCandidateHookOptions } from "./ontology/ontology-candidate-hook.js";
export {
  ABSOLUTE_ONTOLOGY_CANDIDATES_PER_TURN,
  createHeuristicOntologyExtractor,
  createOntologyCandidateLifecycleHook,
  DEFAULT_ONTOLOGY_CANDIDATES_PER_TURN,
  ONTOLOGY_SELF_ENTITY_NAME,
} from "./ontology/ontology-candidate-hook.js";
export type {
  OntologyCandidateListInput,
  OntologyCandidateListOutput,
  OntologyCandidatePromoteInput,
  OntologyCandidatePromoteOutput,
  OntologyCandidateRejectInput,
  OntologyCandidateRejectOutput,
  OntologyCandidateToolsOptions,
  OntologyReviewedAssertion,
} from "./ontology/ontology-candidate-tools.js";
export {
  createOntologyCandidateListTool,
  createOntologyCandidatePromoteTool,
  createOntologyCandidateRejectTool,
  createOntologyCandidateTools,
} from "./ontology/ontology-candidate-tools.js";
export type {
  OntologySnapshotProjection,
  OntologySnapshotRebuildVerification,
  OntologySnapshotSelection,
  OntologySnapshotter,
  OntologySnapshotterOptions,
} from "./ontology/ontology-snapshot.js";
export {
  createOntologySnapshotter,
  DEFAULT_SNAPSHOT_MAX_LINES,
  DEFAULT_SNAPSHOT_MIN_CONFIDENCE,
  DEFAULT_SNAPSHOT_MIN_INFERRED_CONFIDENCE,
  estimateSnapshotTokens,
  generateProfileSnapshot,
  ONTOLOGY_SNAPSHOT_FORMAT_VERSION,
  verifySnapshotRebuild,
} from "./ontology/ontology-snapshot.js";
export type {
  OntologyConsolidateOptions,
  OntologyConsolidationReport,
  OntologyConsolidationStats,
  OntologyConsolidationTriggers,
  OntologyConsolidator,
  OntologyConsolidatorOptions,
  OntologyEntityMergeRecord,
} from "./ontology/ontology-consolidator.js";
export {
  anyConsolidationTriggerFired,
  createOntologyConsolidator,
  DEFAULT_CONSOLIDATOR_ASSERTION_THRESHOLD,
  DEFAULT_CONSOLIDATOR_CANDIDATES_PER_PREDICATE,
  DEFAULT_CONSOLIDATOR_EPISODE_THRESHOLD,
  DEFAULT_CONSOLIDATOR_OPERATOR,
} from "./ontology/ontology-consolidator.js";
export type {
  OntologyDrillDownAssertion,
  OntologyDrillDownQuery,
  OntologyDrillDownResult,
  OntologyRecallExclusions,
  OntologyRecallHop,
  OntologyRecallOptions,
  OntologyRecallRankingWeights,
  OntologyRecallResult,
  OntologyRecallTier1,
  OntologyRecalledAssertion,
  OntologyRetriever,
  OntologyRetrieverOptions,
} from "./ontology/ontology-retriever.js";
export {
  ABSOLUTE_ONTOLOGY_DRILL_DOWN_LIMIT,
  ABSOLUTE_ONTOLOGY_RECALL_MAX_HOPS,
  createOntologyRetriever,
  DEFAULT_ONTOLOGY_DRILL_DOWN_EXCERPT_CHARS,
  DEFAULT_ONTOLOGY_DRILL_DOWN_LIMIT,
  DEFAULT_ONTOLOGY_RECALL_FTS_LIMIT,
  DEFAULT_ONTOLOGY_RECALL_MAX_HOPS,
  DEFAULT_ONTOLOGY_RECALL_MIN_CONFIDENCE,
  DEFAULT_ONTOLOGY_RECALL_MIN_INFERRED_CONFIDENCE,
  DEFAULT_ONTOLOGY_RECALL_RANKING_WEIGHTS,
  DEFAULT_ONTOLOGY_RECALL_TIER1_TOKEN_BUDGET,
  DEFAULT_ONTOLOGY_RECALL_TIER2_TOKEN_BUDGET,
  MAX_ONTOLOGY_RECALL_TIER1_TOKEN_BUDGET,
  MAX_ONTOLOGY_RECALL_TIER2_TOKEN_BUDGET,
  MIN_ONTOLOGY_RECALL_TIER1_TOKEN_BUDGET,
  MIN_ONTOLOGY_RECALL_TIER2_TOKEN_BUDGET,
  renderOntologyAssertionLine,
  renderOntologyTransitionLine,
  scoreOntologyAssertion,
} from "./ontology/ontology-retriever.js";
export type { OntologyContextProviderOptions } from "./ontology/ontology-context-provider.js";
export {
  createOntologyContextProvider,
  DEFAULT_ONTOLOGY_RECALL_CONTEXT_PRIORITY,
  ONTOLOGY_RECALL_CONTEXT_PROVIDER_NAME,
  ONTOLOGY_RECALL_DIFFERENTIAL_CACHE_LIMIT,
} from "./ontology/ontology-context-provider.js";
export type {
  OntologyAssertionExplanation,
  OntologyConflictItem,
  OntologyCorrectionInput,
  OntologyCorrectionResult,
  OntologyDeleteAllResult,
  OntologyDeleteCategoryFilter,
  OntologyDeleteCategoryResult,
  OntologyDeleteEntityResult,
  OntologyDeleteEvidenceResult,
  OntologyExportEpisode,
  OntologyExportEvidence,
  OntologyExportOptions,
  OntologyExportPayload,
  OntologyImportReport,
  OntologyKnowledgeExplanation,
  OntologyKnowledgeFact,
  OntologyKnowledgeGroup,
  OntologySnapshotRegenerationResult,
  OntologyUnmergeResult,
  OntologyUserControlService,
  OntologyUserControlServiceOptions,
} from "./ontology/ontology-user-control.js";
export {
  createOntologyUserControlService,
  ONTOLOGY_EXPORT_FORMAT_VERSION,
  parseOntologyExportPayload,
} from "./ontology/ontology-user-control.js";
// ---------------------------------------------------------------------------
// Phase 3.0/3.1: Obligation（任务契约）+ 执行证据链 —— 3.0 先记录不裁定，
// 3.1 三态裁定生效 (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §3/§5/§6/§11).
// ---------------------------------------------------------------------------
export type {
  Obligation,
  ObligationBudget,
  ObligationEvidenceRef,
  ObligationEvidenceRefKind,
  ObligationItem,
  ObligationStatus,
  ObligationValidatorKind,
  ObligationVerdict,
} from "./obligation/obligation-types.js";
export {
  isObligationEvidenceRefKind,
  isObligationStatus,
  isObligationTransitionAllowed,
  isObligationTransitionAllowedInPhase30,
  isObligationValidatorKind,
  OBLIGATION_ALLOWED_TRANSITIONS,
  OBLIGATION_EVIDENCE_REF_KINDS,
  OBLIGATION_PHASE30_ALLOWED_TRANSITIONS,
  OBLIGATION_STATUSES,
  OBLIGATION_VALIDATOR_KINDS,
  obligationEmployeeUserId,
} from "./obligation/obligation-types.js";
export type {
  ObligationAuditAction,
  ObligationAuditFilter,
  ObligationAuditRecord,
  ObligationAuditRecordKind,
  ObligationCarrier,
  ObligationCarrierPatch,
  ObligationDanglingKind,
  ObligationDanglingQuery,
  ObligationDanglingRecord,
  ObligationEvidenceAttachResult,
  ObligationEvidenceLink,
  ObligationEvidenceLinkWrite,
  ObligationFilter,
  ObligationItemVerdictWrite,
  ObligationItemWrite,
  ObligationRecord,
  ObligationStore,
  ObligationSweptRecord,
  ObligationWrite,
  ObligationWriteMeta,
} from "./obligation/obligation-store.js";
export type { SqliteObligationStoreOptions } from "./obligation/sqlite-obligation-store.js";
export {
  ABSOLUTE_OBLIGATION_LIST_LIMIT,
  canonicalizeObligationEvidenceRef,
  createSqliteObligationStore,
  DEFAULT_OBLIGATION_LIST_LIMIT,
  hashObligationEvidenceRef,
  SqliteObligationStore,
} from "./obligation/sqlite-obligation-store.js";
export type {
  ObligationAggregateInput,
  ObligationAggregateOutcome,
  ObligationCommandResult,
  ObligationCommandRunner,
  ObligationHumanConfirmConfig,
  ObligationModelReviewConfig,
  ObligationModelReviewResult,
  ObligationModelReviewer,
  ObligationSchemaValidatorConfig,
  ObligationTestCommandConfig,
  ObligationToolAssertion,
  ObligationToolAssertionConfig,
  ObligationAssertionOp,
  ObligationValidatorContext,
  ObligationValidatorResult,
} from "./obligation/obligation-verdict.js";
export {
  aggregateObligationVerdict,
  checkSchemaLite,
  DEFAULT_MODEL_REVIEW_PASS_THRESHOLD,
  DEFAULT_TEST_COMMAND_TIMEOUT_MS,
  evaluateAssertion,
  executeValidator,
  getPathValue,
  MAX_TEST_COMMAND_TIMEOUT_MS,
  OBLIGATION_ASSERTION_OPS,
  parseModelReviewConfig,
  parseSchemaValidatorConfig,
  parseTestCommandConfig,
  parseToolAssertionConfig,
  resolveValidatorSubject,
} from "./obligation/obligation-verdict.js";
export type {
  ObligationTerminalNotice,
  ObligationSedimenter,
  OntologyObligationSedimenterOptions,
} from "./obligation/obligation-sediment.js";
export {
  buildObligationSedimentSummary,
  buildObligationVerdictReport,
  createOntologyObligationSedimenter,
  MAX_SEDIMENT_REPORT_CHARS,
  MAX_SEDIMENT_SUMMARY_CHARS,
  OBLIGATION_SEDIMENT_EVIDENCE_SOURCE,
  obligationSedimentEpisodeId,
  obligationSedimentEvidenceId,
} from "./obligation/obligation-sediment.js";
export type {
  ObligationStoppingRule,
  ObligationUsageAggregate,
} from "./obligation/obligation-loop.js";
export {
  evaluateObligationStoppingRule,
  isObligationBudgetExceeded,
  isObligationTerminalStatus,
  OBLIGATION_TERMINAL_STATUSES,
} from "./obligation/obligation-loop.js";
export type {
  ObligationEvidenceResolution,
  ObligationExplainedEvidence,
  ObligationExplanation,
  ObligationFinalVerdict,
  ObligationFourIdentities,
  ObligationItemExplanation,
  ObligationRetryEvent,
  ObligationSedimentationView,
  ObligationTimelineEntry,
  ObligationTimelineKind,
} from "./obligation/obligation-explain.js";
export {
  extractObligationFinalVerdict,
  extractObligationRetryHistory,
  foldObligationAuditTimeline,
} from "./obligation/obligation-explain.js";
export type {
  ObligationAttachEvidenceInput,
  ObligationAttachEvidenceResult,
  ObligationAwaitVerdictOptions,
  ObligationAwaitVerdictResult,
  ObligationCreateInput,
  ObligationCreateItemInput,
  ObligationDanglingQueryInput,
  ObligationHumanVerdictInput,
  ObligationService,
  ObligationServiceOptions,
  ObligationStatusReport,
  ObligationStepResultAttach,
  ObligationValidationItemResult,
  ObligationValidationReport,
  ObligationVerdictState,
  ObligationVerdictSummary,
} from "./obligation/obligation-service.js";
export {
  createObligationService,
  obligationVerdictStateOf,
  requiredCoverageComplete,
  summarizeObligationRecord,
} from "./obligation/obligation-service.js";
