import { useCallback, useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import { useLoongEvents } from "@dashboard/app/events/EventsContext.js";

import { WarRoomPanel } from "@dashboard/app/observe/components/WarRoomPanel.js";

import { useRunCatalog } from "@dashboard/app/run/useRunCatalog.js";

import { buildModelSuggestions } from "@dashboard/app/agents/buildModelSuggestions.js";

import { useRunChat } from "@dashboard/app/run/useRunChat.js";

import type { RunSettings, ThinkingLevel } from "@dashboard/app/run/types.js";

import { useGatewayReadiness } from "../../hooks/useGatewayReadiness.js";

import { useChatSessions } from "../../hooks/useChatSessions.js";

import { useI18n } from "../../i18n/I18nContext.js";

import { ChatComposer } from "./ChatComposer.js";
import type { WorkspaceScopeSelection } from "@dashboard/app/run/workspaceScope.js";
import {
  loadWorkspaceScopeSelection,
  resolveEffectiveWorkspace,
  saveWorkspaceScopeSelection,
} from "@dashboard/app/run/workspaceScope.js";

import { ChatSessionMenu } from "./ChatSessionMenu.js";

import { ChatThread } from "./ChatThread.js";

import styles from "./ChatShell.module.css";



const DEFAULT_SETTINGS: RunSettings = {

  profileId: "",

  employeeId: "",

  sessionId: "studio",

  model: "",

  thinking: "",

  workspace: "",

  queryLoop: false,

  finishTask: false,

  queryLoopMaxTurns: 3,

};



function formatCatalogError(error: string, gatewayMessage: string): string {

  if (/failed to fetch/i.test(error)) {

    return gatewayMessage;

  }

  return error;

}



export function ChatShell() {

  const { t } = useI18n();

  const navigate = useNavigate();

  const { events } = useLoongEvents();

  const chatSessions = useChatSessions();

  const [settings, setSettings] = useState<RunSettings>(() => ({

    ...DEFAULT_SETTINGS,

    sessionId: chatSessions.activeSessionId,

  }));

  const [workspaceScope, setWorkspaceScope] = useState<WorkspaceScopeSelection>(() => loadWorkspaceScopeSelection());

  const [warRoomOpen, setWarRoomOpen] = useState(false);
  const [warRoomHighlightSequence, setWarRoomHighlightSequence] = useState<number | undefined>();

  const { connectionState, statusLabel } = useGatewayReadiness();

  const catalog = useRunCatalog(settings.sessionId);



  const selectedProfile = useMemo(

    () => catalog.agentConfig.profiles.find(profile => profile.id === settings.profileId),

    [catalog.agentConfig.profiles, settings.profileId],

  );



  const chat = useRunChat(settings, selectedProfile, {
    gatewayOnline: connectionState === "online",
    translate: t,
    workspaceScope,
    ...(selectedProfile?.workspace ? { profileWorkspace: selectedProfile.workspace } : {}),
  });

  const busy = chat.sending || chat.expectingRun;



  const modelOptions = useMemo(

    () => buildModelSuggestions(catalog.providers),

    [catalog.providers],

  );



  useEffect(() => {

    setSettings(current =>

      current.sessionId === chatSessions.activeSessionId

        ? current

        : { ...current, sessionId: chatSessions.activeSessionId },

    );

  }, [chatSessions.activeSessionId]);



  useEffect(() => {

    const identity = catalog.employeeIdentity;

    const profiles = catalog.agentConfig.profiles;

    const profileId =

      identity?.profileId

      ?? catalog.agentConfig.defaultProfileId

      ?? (profiles.length === 1 ? profiles[0]?.id : undefined);

    const profile = profileId ? profiles.find(entry => entry.id === profileId) : undefined;



    if (!profileId && !identity?.employeeId) {

      return;

    }



    setSettings(current => {

      if (

        current.profileId === (profileId ?? "")

        && current.employeeId === (identity?.employeeId ?? "")

      ) {

        return current;

      }

      return {

        ...current,

        profileId: profileId ?? current.profileId,

        employeeId: identity?.employeeId ?? current.employeeId,

        workspace: current.workspace || profile?.workspace || "",

        thinking: current.thinking || (profile?.thinking as ThinkingLevel) || "",

      };

    });

  }, [catalog.agentConfig, catalog.employeeIdentity]);



  const handleWorkspaceScopeChange = useCallback(

    (next: WorkspaceScopeSelection) => {

      setWorkspaceScope(next);

      saveWorkspaceScopeSelection(next);

      const scoped = resolveEffectiveWorkspace(next, selectedProfile?.workspace);

      setSettings(current => ({

        ...current,

        workspace: scoped.workspace ?? "",

      }));

    },

    [selectedProfile?.workspace],

  );



  const handleModelChange = useCallback((model: string) => {

    setSettings(current => ({ ...current, model }));

  }, []);



  const handleSend = useCallback(

    (message: string, attachments: Parameters<typeof chat.sendMessage>[1]) => {

      chatSessions.renameFromFirstMessage(settings.sessionId, message);

      chatSessions.touchSession(settings.sessionId);

      void chat.sendMessage(message, attachments ?? []).then(() => {

        void catalog.refreshRuns();

      });

    },

    [catalog.refreshRuns, chat.sendMessage, chatSessions, settings.sessionId],

  );



  const assistantName =

    catalog.employeeIdentity?.displayName

    || selectedProfile?.name

    || catalog.agentConfig.profiles[0]?.name

    || t("chat.noAssistant");



  const identityLabel = catalog.employeeIdentity?.subtitle

    ? `${catalog.employeeIdentity.displayName} · ${catalog.employeeIdentity.subtitle}`

    : assistantName;



  const statusDotClass =

    connectionState === "online"

      ? `${styles.dot} ${styles.dotLive}`

      : connectionState === "checking"

        ? `${styles.dot} ${styles.dotBusy}`

        : styles.dot;



  const statusText =

    connectionState === "online"

      ? t("chat.connected")

      : connectionState === "checking"

        ? t("chat.connecting")

        : t("chat.disconnected");



  return (

    <div className={styles.shell}>

      <header className={styles.topBar}>

        <ChatSessionMenu

          sessions={chatSessions.sessions}

          activeSessionId={chatSessions.activeSessionId}

          onSelect={chatSessions.selectSession}

          onCreate={() => chatSessions.createSession()}

          labels={{

            session: t("chat.session"),

            conversation: t("chat.conversation"),

            newConversation: t("chat.newConversation"),

          }}

        />



        <div className={styles.topBarCenter}>

          <div className={styles.identityBar}>

            <span className={styles.agentLabel}>{t("chat.identity")}：</span>

            <span className={styles.identityName}>{identityLabel}</span>

          </div>

        </div>



        <div className={styles.topBarRight}>

          <div className={styles.statusPill} title={statusLabel}>

            <span className={statusDotClass} aria-hidden />

            <span className={styles.statusText}>{statusText}</span>

          </div>

          <button

            type="button"

            className={`${styles.settingsBtn}${chat.activityPreferences.showActivities ? ` ${styles.settingsBtnActive}` : ""}`}

            onClick={() => chat.updateActivityPreferences({

              showActivities: !chat.activityPreferences.showActivities,

            })}

            aria-label={t("chat.activity.toggle")}

            title={t("chat.activity.toggle")}

          >

            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>

              <path

                d="M4 7h16M4 12h10M4 17h14"

                stroke="currentColor"

                strokeWidth="1.75"

                strokeLinecap="round"

              />

            </svg>

          </button>

          <button

            type="button"

            className={`${styles.settingsBtn}${warRoomOpen ? ` ${styles.settingsBtnActive}` : ""}`}

            onClick={() => setWarRoomOpen(open => !open)}

            aria-label={warRoomOpen ? t("chat.warRoomClose") : t("chat.warRoomOpen")}

            title={warRoomOpen ? t("chat.warRoomClose") : t("chat.warRoomOpen")}

          >

            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>

              <path

                d="M4 6h16M4 12h10M4 18h16"

                stroke="currentColor"

                strokeWidth="1.75"

                strokeLinecap="round"

              />

            </svg>

          </button>

          <button

            type="button"

            className={styles.settingsBtn}

            onClick={() => navigate("/org")}

            aria-label={t("nav.org")}

            title={t("nav.org")}

          >

            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>

              <path

                d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"

                stroke="currentColor"

                strokeWidth="1.75"

                strokeLinecap="round"

                strokeLinejoin="round"

              />

            </svg>

          </button>

          <button

            type="button"

            className={styles.settingsBtn}

            onClick={() => navigate("/settings")}

            aria-label={t("chat.settings")}

            title={t("chat.settings")}

          >

            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>

              <path

                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"

                stroke="currentColor"

                strokeWidth="1.75"

              />

              <path

                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"

                stroke="currentColor"

                strokeWidth="1.75"

                strokeLinecap="round"

                strokeLinejoin="round"

              />

            </svg>

          </button>

        </div>

      </header>



      <div className={`${styles.bodyRow}${warRoomOpen ? ` ${styles.bodyRowWithWarRoom}` : ""}`}>

      <div className={styles.chatMain}>

        <div className={styles.chatScroll}>

          {catalog.error ? (

            <p className={styles.errorBanner}>

              {formatCatalogError(catalog.error, t("chat.gatewayError"))}

            </p>

          ) : null}

          {!catalog.employeeIdentity ? (

            <p className={styles.errorBanner}>{t("chat.orgSetupHint")}</p>

          ) : null}

          <ChatThread
            turns={chat.chatTurns}
            busy={busy}
            assistantName={assistantName}
            thinkingLabel={t("chat.thinking")}
            emptyLead={t("chat.emptyLead").replace("{name}", assistantName)}
            userLabel={t("chat.userLabel")}
            showActivities={chat.activityPreferences.showActivities}
            activityCollapsedSummary={count => t("chat.activity.collapsedSummary").replace("{count}", String(count))}
            activityExpandLabel={t("chat.activity.expand")}
            activityCollapseLabel={t("chat.activity.collapse")}
            onToggleTurnActivities={chat.toggleTurnActivitiesExpanded}
            onActivityStepClick={step => {
              if (step.sequence === undefined) {
                return;
              }
              setWarRoomOpen(true);
              setWarRoomHighlightSequence(step.sequence);
            }}
          />

        </div>



        <div className={styles.composerDock}>

          <ChatComposer

            disabled={busy || connectionState !== "online"}

            workspaceScope={workspaceScope}

            {...(selectedProfile?.workspace ? { profileWorkspace: selectedProfile.workspace } : {})}

            onWorkspaceScopeChange={handleWorkspaceScopeChange}

            model={settings.model}

            models={modelOptions}

            onModelChange={handleModelChange}

            onSend={handleSend}

          />

          <p className={styles.hint}>{t("chat.composerHint")}</p>

        </div>

      </div>

      {warRoomOpen ? (
        <aside className={styles.warRoomAside}>
          <WarRoomPanel
            title={t("chat.warRoom")}
            emptyHint={t("chat.warRoomEmpty")}
            waitingHint={t("chat.warRoomWaiting")}
            activeRunId={chat.activeRunId || chat.timelineRunId}
            events={events}
            translate={t}
            {...(warRoomHighlightSequence !== undefined ? { highlightSequence: warRoomHighlightSequence } : {})}
          />
        </aside>
      ) : null}

      </div>

    </div>

  );

}

