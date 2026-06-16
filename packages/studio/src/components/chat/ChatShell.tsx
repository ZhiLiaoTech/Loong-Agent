import { useCallback, useEffect, useMemo, useState } from "react";

import { notifyApprovalRequired } from "@loong/host";

import { PendingApprovalPanel } from "@dashboard/app/run/components/PendingApprovalPanel.js";

import { useRunCatalog } from "@dashboard/app/run/useRunCatalog.js";

import { buildModelSuggestions } from "@dashboard/app/agents/buildModelSuggestions.js";

import { useRunChat } from "@dashboard/app/run/useRunChat.js";

import type { RunSettings, ThinkingLevel } from "@dashboard/app/run/types.js";

import { useGatewayReadiness } from "../../hooks/useGatewayReadiness.js";

import { useChatSessions } from "../../hooks/useChatSessions.js";

import { useI18n } from "../../i18n/I18nContext.js";

import { ChatComposer } from "./ChatComposer.js";
import { ContextMeter } from "./ContextMeter.js";
import type { WorkspaceScopeSelection } from "@dashboard/app/run/workspaceScope.js";
import { resolveModelContextWindow, computeTurnMessageBudgetChars } from "@dashboard/app/run/contextUsage.js";
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

  const chatSessions = useChatSessions();

  const [settings, setSettings] = useState<RunSettings>(() => ({

    ...DEFAULT_SETTINGS,

    sessionId: chatSessions.activeSessionId,

  }));

  const [workspaceScope, setWorkspaceScope] = useState<WorkspaceScopeSelection>(() => loadWorkspaceScopeSelection());

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
    onApprovalQueued: item => {
      void notifyApprovalRequired({
        approvalId: item.id,
        toolName: item.toolName,
        reason: item.reason,
        navigatePath: `/observe?approval=${encodeURIComponent(item.id)}`,
      });
    },
  });

  const busy = chat.sending || chat.expectingRun;



  const modelOptions = useMemo(

    () => buildModelSuggestions(catalog.providers),

    [catalog.providers],

  );

  const contextUsage = useMemo(() => {
    const base = chat.contextUsage;
    const injectedContextLimitChars = base?.injectedContextLimitChars ?? chat.lastTier?.maxContextChars;
    const limitChars = base?.limitChars ?? (
      injectedContextLimitChars !== undefined
        ? computeTurnMessageBudgetChars(injectedContextLimitChars)
        : undefined
    );
    const tier = base?.tier ?? chat.lastTier?.tier;
    const modelContextWindow = resolveModelContextWindow(settings.model, catalog.providers);
    if (
      !base
      && limitChars === undefined
      && tier === undefined
      && modelContextWindow === undefined
    ) {
      return null;
    }
    return {
      ...(base ?? {}),
      ...(limitChars !== undefined ? { limitChars } : {}),
      ...(injectedContextLimitChars !== undefined ? { injectedContextLimitChars } : {}),
      ...(tier !== undefined ? { tier } : {}),
      ...(modelContextWindow !== undefined ? { modelContextWindow } : {}),
    };
  }, [catalog.providers, chat.contextUsage, chat.lastTier, settings.model]);



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

  const showConnectionPill = connectionState !== "online";



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

          {showConnectionPill ? (
            <div className={styles.statusPill} title={statusLabel}>
              <span className={statusDotClass} aria-hidden />
              <span className={styles.statusText}>{statusText}</span>
            </div>
          ) : null}

          <button

            type="button"

            className={`${styles.settingsBtn} loong-icon-tooltip${chat.activityPreferences.showActivities ? ` ${styles.settingsBtnActive}` : ""}`}

            onClick={() => chat.updateActivityPreferences({

              showActivities: !chat.activityPreferences.showActivities,

            })}

            aria-label={t("chat.activity.toggle")}

            data-tooltip={t("chat.activity.toggle")}

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

        </div>

      </header>



      <div className={styles.bodyRow}>

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
          />

        </div>



        <div className={styles.composerDock}>

          <PendingApprovalPanel
            approvals={chat.pendingApprovals}
            title={t("chat.approval.title")}
            approveLabel={t("chat.approval.approve")}
            rejectLabel={t("chat.approval.reject")}
            inboxLabel={t("chat.approval.inbox")}
            resolvingLabel={t("chat.approval.resolving")}
            onApprove={chat.approveApproval}
            onReject={chat.rejectApproval}
          />

          <ContextMeter
            usage={contextUsage ?? {}}
            running={chat.contextUsageRunning}
          />

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

      </div>

    </div>

  );

}

