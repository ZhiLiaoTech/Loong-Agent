import { useCallback, useEffect, useMemo, useState } from "react";
import { GatewayApiError } from "../../api/errors.js";
import type { GatewayProviderSummary } from "../../api/types.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import type { AgentProfile } from "../run/types.js";
import { buildModelSuggestions } from "./buildModelSuggestions.js";
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
  const [agentConfig, setAgentConfig] = useState<AgentsConfigState>({ profiles: [] });
  const [providers, setProviders] = useState<readonly GatewayProviderSummary[]>([]);
  const [form, setForm] = useState<AgentProfileFormState>(EMPTY_AGENT_PROFILE_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const modelSuggestions = useMemo(() => buildModelSuggestions(providers), [providers]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configPayload, providerList] = await Promise.all([
        client.rpc<AgentsConfigState>("agent.config.get"),
        client.listProviders().catch(() => [] as readonly GatewayProviderSummary[]),
      ]);
      setAgentConfig({
        profiles: configPayload.profiles ?? [],
        ...(configPayload.defaultProfileId
          ? { defaultProfileId: configPayload.defaultProfileId }
          : {}),
        ...(configPayload.configPath ? { configPath: configPayload.configPath } : {}),
      });
      setProviders(providerList);
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
      setProviders(await client.listProviders().catch(() => []));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearForm = useCallback(() => {
    setForm(EMPTY_AGENT_PROFILE_FORM);
  }, []);

  const editProfile = useCallback((id: string) => {
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
  }, [agentConfig.defaultProfileId, agentConfig.profiles]);

  const removeProfile = useCallback((id: string) => {
    setAgentConfig(current => {
      const next: AgentsConfigState = {
        profiles: current.profiles.filter(entry => entry.id !== id),
        ...(current.configPath ? { configPath: current.configPath } : {}),
      };
      if (current.defaultProfileId && current.defaultProfileId !== id) {
        next.defaultProfileId = current.defaultProfileId;
      }
      return next;
    });
    setForm(current => (current.editingId === id ? EMPTY_AGENT_PROFILE_FORM : current));
    setStatus(null);
  }, []);

  const upsertDraft = useCallback(() => {
    const id = form.id.trim();
    const name = form.name.trim();
    if (!id || !name) {
      return;
    }

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

    let defaultProfileId = agentConfig.defaultProfileId;
    if (form.isDefault) {
      defaultProfileId = id;
    } else if (defaultProfileId === id && !form.isDefault) {
      defaultProfileId = undefined;
    }
    if (defaultProfileId && !next.some(entry => entry.id === defaultProfileId)) {
      defaultProfileId = undefined;
    }

    setAgentConfig(current => ({
      ...current,
      profiles: sortProfiles(next),
      ...(defaultProfileId ? { defaultProfileId } : {}),
    }));
    clearForm();
    setStatus("Draft updated locally. Click Save to persist.");
  }, [agentConfig.defaultProfileId, agentConfig.profiles, clearForm, form]);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const payload = await client.rpc<AgentsConfigState>("agent.config.save", {
        profiles: agentConfig.profiles,
        ...(agentConfig.defaultProfileId
          ? { defaultProfileId: agentConfig.defaultProfileId }
          : {}),
      });
      setAgentConfig({
        profiles: payload.profiles ?? [],
        ...(payload.defaultProfileId ? { defaultProfileId: payload.defaultProfileId } : {}),
        ...(payload.configPath ? { configPath: payload.configPath } : {}),
      });
      setStatus("Saved.");
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [agentConfig.defaultProfileId, agentConfig.profiles, client]);

  return {
    agentConfig,
    form,
    setForm,
    modelSuggestions,
    status,
    error,
    loading,
    saving,
    load,
    saveConfig,
    upsertDraft,
    clearForm,
    editProfile,
    removeProfile,
  };
}
