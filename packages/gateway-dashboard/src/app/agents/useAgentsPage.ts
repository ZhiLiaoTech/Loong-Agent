import { useCallback, useEffect, useMemo, useState } from "react";
import { GatewayApiError } from "../../api/index.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { useWorkbenchT } from "../i18n/WorkbenchI18nContext.js";
import { buildConfiguredModelOptions } from "../models/buildConfiguredModelOptions.js";
import type { ModelProviderConfig } from "../models/types.js";
import type { AgentProfile } from "../run/types.js";
import { agentIdFromName } from "./agentIdFromName.js";
import {
  EMPTY_AGENT_PROFILE_FORM,
  type AgentProfileFormState,
  type AgentsConfigState,
} from "./types.js";

function sortProfiles(profiles: readonly AgentProfile[]): AgentProfile[] {
  return [...profiles].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export function useAgentsPage() {
  const client = useGatewayClient();
  const t = useWorkbenchT();
  const [agentConfig, setAgentConfig] = useState<AgentsConfigState>({ profiles: [] });
  const [modelProviders, setModelProviders] = useState<readonly ModelProviderConfig[]>([]);
  const [form, setForm] = useState<AgentProfileFormState>(EMPTY_AGENT_PROFILE_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const modelOptions = useMemo(
    () => buildConfiguredModelOptions(modelProviders),
    [modelProviders],
  );

  const reloadConfig = useCallback(async () => {
    const [configPayload, modelPayload] = await Promise.all([
      client.rpc<AgentsConfigState>("agent.config.get"),
      client.rpc<{ providers?: readonly ModelProviderConfig[] }>("model.config.get").catch(() => ({
        providers: [] as readonly ModelProviderConfig[],
      })),
    ]);
    setAgentConfig({
      profiles: configPayload.profiles ?? [],
      ...(configPayload.defaultProfileId
        ? { defaultProfileId: configPayload.defaultProfileId }
        : {}),
      ...(configPayload.configPath ? { configPath: configPayload.configPath } : {}),
    });
    setModelProviders(modelPayload.providers ?? []);
  }, [client]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await reloadConfig();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [reloadConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistProfiles = useCallback(
    async (config: AgentsConfigState) => {
      setSaving(true);
      setStatus(null);
      setError(null);
      try {
        const payload = await client.rpc<AgentsConfigState>("agent.config.save", {
          profiles: config.profiles,
          ...(config.defaultProfileId ? { defaultProfileId: config.defaultProfileId } : {}),
        });
        setAgentConfig({
          profiles: payload.profiles ?? [],
          ...(payload.defaultProfileId ? { defaultProfileId: payload.defaultProfileId } : {}),
          ...(payload.configPath ? { configPath: payload.configPath } : {}),
        });
        await reloadConfig();
        setStatus(t("agents.statusSaved"));
      } catch (caught) {
        const message = caught instanceof GatewayApiError ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setSaving(false);
      }
    },
    [client, reloadConfig, t],
  );

  const clearForm = useCallback(() => {
    setForm(EMPTY_AGENT_PROFILE_FORM);
  }, []);

  const editProfile = useCallback(
    (id: string) => {
      const profile = agentConfig.profiles.find(entry => entry.id === id);
      if (!profile) {
        return;
      }
      setForm({
        editingId: profile.id,
        id: profile.id,
        name: profile.name,
        description: profile.description ?? "",
        defaultModel: profile.defaultModel ?? "",
        workspace: profile.workspace ?? "",
        thinking: profile.thinking ?? "",
        systemPrompt: profile.systemPrompt ?? "",
        memoryEnabled: profile.memoryEnabled !== false,
        toolsEnabled: profile.toolsEnabled !== false,
        isDefault: agentConfig.defaultProfileId === profile.id,
      });
    },
    [agentConfig.defaultProfileId, agentConfig.profiles],
  );

  const removeProfile = useCallback(
    async (id: string) => {
      const nextProfiles = agentConfig.profiles.filter(entry => entry.id !== id);
      let defaultProfileId = agentConfig.defaultProfileId;
      if (defaultProfileId === id) {
        defaultProfileId = nextProfiles[0]?.id;
      }
      const nextConfig: AgentsConfigState = {
        profiles: nextProfiles,
        ...(agentConfig.configPath ? { configPath: agentConfig.configPath } : {}),
        ...(defaultProfileId ? { defaultProfileId } : {}),
      };
      setAgentConfig(nextConfig);
      setForm(current => (current.editingId === id ? EMPTY_AGENT_PROFILE_FORM : current));
      await persistProfiles(nextConfig);
    },
    [agentConfig.configPath, agentConfig.defaultProfileId, agentConfig.profiles, persistProfiles],
  );

  const upsertDraft = useCallback(async () => {
    const name = form.name.trim();
    if (!name) {
      setError(t("agents.nameRequired"));
      return;
    }

    if (modelOptions.length > 0 && !form.defaultModel.trim()) {
      setError(t("agents.modelRequired"));
      return;
    }

    const id = form.id.trim() || agentIdFromName(name);
    setError(null);

    const profile: AgentProfile = {
      id,
      name,
      memoryEnabled: form.memoryEnabled,
      toolsEnabled: form.toolsEnabled,
    };

    const description = form.description.trim();
    const defaultModel = form.defaultModel.trim();
    const workspace = form.workspace.trim();
    const systemPrompt = form.systemPrompt.trim();
    if (description) {
      profile.description = description;
    }
    if (defaultModel) {
      profile.defaultModel = defaultModel;
    }
    if (workspace) {
      profile.workspace = workspace;
    }
    if (form.thinking) {
      profile.thinking = form.thinking;
    }
    if (systemPrompt) {
      profile.systemPrompt = systemPrompt;
    }

    const next = agentConfig.profiles.filter(
      entry => entry.id !== id && entry.id !== form.editingId,
    );
    next.push(profile);

    const sorted = sortProfiles(next);
    const isFirstProfile = sorted.length === 1 && sorted[0]?.id === id;
    let defaultProfileId = agentConfig.defaultProfileId;
    if (form.isDefault || isFirstProfile) {
      defaultProfileId = id;
    } else if (defaultProfileId === id && !form.isDefault) {
      defaultProfileId = sorted.find(entry => entry.id !== id)?.id;
    }
    if (defaultProfileId && !sorted.some(entry => entry.id === defaultProfileId)) {
      defaultProfileId = sorted[0]?.id;
    }

    const nextConfig: AgentsConfigState = {
      profiles: sorted,
      ...(agentConfig.configPath ? { configPath: agentConfig.configPath } : {}),
      ...(defaultProfileId ? { defaultProfileId } : {}),
    };
    setAgentConfig(nextConfig);
    clearForm();
    await persistProfiles(nextConfig);
  }, [agentConfig, clearForm, form, modelOptions.length, persistProfiles, t]);

  return {
    agentConfig,
    form,
    setForm,
    modelOptions,
    status,
    error,
    loading,
    saving,
    load,
    upsertDraft,
    clearForm,
    editProfile,
    removeProfile,
  };
}
