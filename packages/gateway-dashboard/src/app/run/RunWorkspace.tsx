import { useCallback, useEffect, useMemo, useState } from "react";
import { useDragonEvents } from "../events/EventsContext.js";
import { ChatTranscript } from "./components/ChatTranscript.js";
import { Composer, type ComposerAttachment } from "./components/Composer.js";
import { ProfilePreview } from "./components/ProfilePreview.js";
import { RecentRunsList } from "./components/RecentRunsList.js";
import { RunInspector } from "./components/RunInspector.js";
import { RunSettingsPanel } from "./components/RunSettingsPanel.js";
import { RunTimeline } from "./components/RunTimeline.js";
import type { RunSettings, ThinkingLevel } from "./types.js";
import { useRunCatalog } from "./useRunCatalog.js";
import { useRunChat } from "./useRunChat.js";
import styles from "./RunWorkspace.module.css";

const DEFAULT_SETTINGS: RunSettings = {
  profileId: "",
  employeeId: "",
  sessionId: "dashboard",
  model: "",
  thinking: "",
  workspace: "",
};

export function RunWorkspace() {
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_SETTINGS);
  const catalog = useRunCatalog(settings.sessionId);
  const { events } = useDragonEvents();

  const selectedProfile = useMemo(
    () => catalog.agentConfig.profiles.find(profile => profile.id === settings.profileId),
    [catalog.agentConfig.profiles, settings.profileId],
  );

  const chat = useRunChat(settings, selectedProfile);

  useEffect(() => {
    const defaultId = catalog.employeeCatalog.defaultEmployeeId;
    if (!defaultId || settings.employeeId) {
      return;
    }
    const employee = catalog.employeeCatalog.employees.find(entry => entry.id === defaultId);
    if (!employee) {
      return;
    }
    setSettings(current => ({
      ...current,
      employeeId: employee.id,
      profileId: current.profileId || employee.profileId,
    }));
  }, [catalog.employeeCatalog, settings.employeeId]);

  const handleProfileChange = useCallback(
    (profileId: string) => {
      const profile = catalog.agentConfig.profiles.find(entry => entry.id === profileId);
      setSettings(current => ({
        ...current,
        profileId,
        model: profile?.defaultModel ?? (profileId ? "" : current.model),
        workspace: profile?.workspace ?? (profileId ? "" : current.workspace),
        thinking: (profile?.thinking as ThinkingLevel | undefined) ?? (profileId ? "" : current.thinking),
      }));
    },
    [catalog.agentConfig.profiles],
  );

  const handleEmployeeChange = useCallback(
    (employeeId: string) => {
      const employee = catalog.employeeCatalog.employees.find(entry => entry.id === employeeId);
      setSettings(current => ({
        ...current,
        employeeId,
        profileId: employee?.profileId ?? (employeeId ? "" : current.profileId),
      }));
    },
    [catalog.employeeCatalog.employees],
  );

  const handleSend = useCallback(
    (message: string, attachments: ComposerAttachment[]) => {
      void chat.sendMessage(message, attachments).then(() => {
        void catalog.refreshRuns();
      });
    },
    [catalog.refreshRuns, chat.sendMessage],
  );

  const busy = chat.sending || chat.expectingRun;

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <h2 className={styles.title}>Run</h2>
        <p className={styles.lead}>Chat with the agent and inspect the active run.</p>
      </header>

      {catalog.error ? <p className={styles.error}>{catalog.error}</p> : null}

      <div className={styles.layout}>
        <main className={styles.main}>
          <ChatTranscript turns={chat.chatTurns} />
          <Composer disabled={busy} onSend={handleSend} />
          <RunSettingsPanel
            settings={settings}
            profiles={catalog.agentConfig.profiles}
            employees={catalog.employeeCatalog.employees}
            modelSuggestions={catalog.modelSuggestions}
            onChange={patch => setSettings(current => ({ ...current, ...patch }))}
            onProfileChange={handleProfileChange}
            onEmployeeChange={handleEmployeeChange}
          />
        </main>

        <aside className={styles.aside}>
          <ProfilePreview profile={selectedProfile} settings={settings} />
          <RunInspector
            activeRunId={chat.activeRunId}
            lastResult={chat.lastResult}
            lastTier={chat.lastTier}
            cancelError={chat.cancelError}
            showRaw={chat.showRaw}
            onToggleRaw={() => chat.setShowRaw(value => !value)}
            onCancel={chat.cancelActiveRun}
          />
          <RunTimeline activeRunId={chat.activeRunId} events={events} />
          <RecentRunsList runs={catalog.runs} onRefresh={() => void catalog.refreshRuns()} />
        </aside>
      </div>
    </div>
  );
}
