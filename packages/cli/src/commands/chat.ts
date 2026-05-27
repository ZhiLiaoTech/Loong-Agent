import path from "node:path";
import {
  findAgentProfile,
  mergeAgentProfileIntoTurnInput,
  runTurnWithQueryLoop,
  type DragonAgentProfile,
  type DragonTurnInput,
} from "@dragon/core";
import type { GatewayAgentProfileConfig } from "@dragon/gateway";
import {
  loadGatewaySettingsFile,
  parseModelTimeoutMsFromEnv,
  resolveModelTimeoutMs,
} from "../gateway-settings.js";
import { readAttachmentFromDisk } from "../attachments.js";
import { parseChatArgs } from "../chat-args.js";
import {
  configuredAgentConfigPath,
  configuredSkillRoots,
  configuredTierConfigPath,
  createBuiltinProviders,
  loadPersistedAgentConfig,
  loadPersistedTierConfig,
  parseSkillsSlashCommand,
  runSkillsSlashCommand,
} from "../cli-impl.js";
import { createRuntime, deactivateLoadedPlugins } from "../runtime-factory.js";
import { createCliPermissionHandler, formatMetadata, renderEvent } from "../cli-ui.js";
import { applyModelCatalogToParams } from "@dragon/model-catalog";

export async function runChat(mode: "chat" | "agent", args: string[]): Promise<void> {
  const parsed = parseChatArgs(mode, args);
  const skillSlashCommand = mode === "agent" ? parseSkillsSlashCommand(parsed.message) : undefined;
  if (skillSlashCommand) {
    await runSkillsSlashCommand(parsed.skillRoots ?? configuredSkillRoots(), skillSlashCommand);
    return;
  }

  const builtinProviders = await createBuiltinProviders();
  const permissionHandler = mode === "agent" ? createCliPermissionHandler() : undefined;
  const tierConfig = await loadPersistedTierConfig(configuredTierConfigPath());
  const fileSettings = await loadGatewaySettingsFile();
  const envModelTimeoutMs = parseModelTimeoutMsFromEnv();
  const modelTimeoutMs = resolveModelTimeoutMs({
    ...(envModelTimeoutMs !== undefined ? { envMs: envModelTimeoutMs } : {}),
    ...(fileSettings.modelTimeoutMs !== undefined ? { fileMs: fileSettings.modelTimeoutMs } : {}),
  });
  const runtimeBundle = await createRuntime({
    mode,
    allowWrite: parsed.allowWrite,
    ...(parsed.failOnAsk ? { failOnPermissionDeny: true } : {}),
    sessionDir: parsed.sessionDir,
    memoryDir: parsed.memoryDir,
    ...(parsed.memoryBackendId !== undefined ? { memoryBackendId: parsed.memoryBackendId } : {}),
    noSession: parsed.noSession,
    skillRoots: mode === "agent" ? parsed.skillRoots ?? [] : [],
    pluginRoots: parsed.pluginRoots,
    providers: builtinProviders.providers,
    ...(builtinProviders.defaultProviderId ? { defaultProviderId: builtinProviders.defaultProviderId } : {}),
    ...(permissionHandler ? { permissionHandler } : {}),
    tierConfig,
    modelTimeoutMs,
  });
  const runtime = runtimeBundle.runtime;

  try {
    let lastErrorMetadata: Record<string, unknown> | undefined;
    runtime.subscribe(event => {
      if (event.type === "lifecycle" && event.phase === "error") {
        lastErrorMetadata = event.metadata;
      }
      renderEvent(event);
    });

    const attachments = parsed.attachments
      ? await Promise.all(parsed.attachments.map(spec => readAttachmentFromDisk(spec.filePath)))
      : undefined;
    const modelParams = applyModelCatalogToParams(
      { ...(parsed.model !== undefined ? { model: parsed.model } : {}) },
      runtimeBundle.modelCatalog,
    );
    let turnInput: DragonTurnInput = {
      sessionId: parsed.sessionId,
      source: "cli",
      message: parsed.message,
      ...(modelParams.model !== undefined ? { model: modelParams.model } : {}),
      ...(parsed.modelFallbacks !== undefined ? { modelFallbacks: parsed.modelFallbacks } : {}),
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      ...(parsed.tier !== undefined ? { tier: parsed.tier } : {}),
      metadata: {
        mode,
        agentAlias: mode === "agent",
        ...(parsed.forceQueryLoop ? { forceQueryLoop: true } : {}),
      },
    };
    if (mode === "agent") {
      const agentConfig = await loadPersistedAgentConfig(configuredAgentConfigPath());
      const profile = findAgentProfile(
        { profiles: agentConfig.profiles.map(toDragonAgentProfile), ...(agentConfig.defaultProfileId ? { defaultProfileId: agentConfig.defaultProfileId } : {}) },
        parsed.profileId,
      );
      if (parsed.profileId && !profile) {
        throw new Error(`Unknown agent profile "${parsed.profileId}". Check .dragon/config/agents.json.`);
      }
      turnInput = mergeAgentProfileIntoTurnInput(turnInput, profile);
    }
    const agentTurnInput = mode === "agent"
      ? { ...turnInput, workspace: process.cwd() }
      : turnInput;
    const loopResult = parsed.queryLoop && mode === "agent"
      ? await runTurnWithQueryLoop(runtime, agentTurnInput, {
          queryLoop: true,
          ...(parsed.queryLoopMaxTurns !== undefined ? { queryLoopMaxTurns: parsed.queryLoopMaxTurns } : {}),
          ...(parsed.forceQueryLoop ? { forceQueryLoop: true } : {}),
        })
      : { result: await runtime.runTurn(agentTurnInput), turnCount: 1 };
    const result = loopResult.result;

    if (result.status !== "ok") {
      if (lastErrorMetadata) {
        console.error(formatMetadata(lastErrorMetadata));
      }
      throw new Error(result.error ?? `Dragon turn failed with status ${result.status}.`);
    }

    const assistant = result.messages.find(item => item.role === "assistant");
    if (assistant?.content) {
      process.stdout.write(`${assistant.content}\n`);
    }
  } finally {
    await deactivateLoadedPlugins(runtimeBundle.plugins);
  }
}

function toDragonAgentProfile(profile: GatewayAgentProfileConfig): DragonAgentProfile {
  return {
    id: profile.id,
    name: profile.name,
    ...(profile.description !== undefined ? { description: profile.description } : {}),
    ...(profile.defaultModel !== undefined ? { defaultModel: profile.defaultModel } : {}),
    ...(profile.workspace !== undefined ? { workspace: profile.workspace } : {}),
    ...(profile.thinking !== undefined ? { thinking: profile.thinking } : {}),
    ...(profile.systemPrompt !== undefined ? { systemPrompt: profile.systemPrompt } : {}),
    ...(profile.toolsEnabled !== undefined ? { toolsEnabled: profile.toolsEnabled } : {}),
    ...(profile.memoryEnabled !== undefined ? { memoryEnabled: profile.memoryEnabled } : {}),
    ...(profile.sessionCompaction !== undefined ? { sessionCompaction: profile.sessionCompaction } : {}),
  };
}
