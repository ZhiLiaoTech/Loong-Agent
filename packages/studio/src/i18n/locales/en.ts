import type { MessageTree } from "../types.js";



export const en: MessageTree = {

  nav: {

    chat: "Chat",

    models: "Models",

    org: "Organization",

    connections: "Connections",

    observe: "Observe",
    cookingVideo: "Video review",

    agents: "Agents",

    settings: "Settings",

    about: "About",

  },

  observe: {
    title: "Observe",
    lead: "Monitor runs, live events, tool approvals, and memory candidates.",
    session: "Session ID",
    statsRuns: "Runs",
    statsActive: "Active",
    statsPending: "Pending",
    statsEvents: "Buffered",
    approvalsSection: "Tool approvals",
    approvalsLead: "Sensitive tool calls from the agent appear here for review.",
    eventsSection: "Live events",
    memorySection: "Memory candidates",
    runsSection: "Recent runs",
    eventsEmpty: "No live events yet.",
    memoryEmpty: "No pending memory candidates.",
    memoryPromote: "Promote",
    memoryReject: "Reject",
    runsEmpty: "No runs yet.",
    runCancel: "Cancel",
  },

  sidebar: {

    collapse: "Collapse sidebar",

    expand: "Expand sidebar",

  },

  settings: {

    title: "Settings",

    lead: "Manage Studio appearance, Gateway connection, and advanced options.",

    sectionGeneral: "General",

    sectionGeneralLead: "Interface language and theme preferences.",

    sectionConnection: "Connection & auth",

    sectionConnectionLead: "Gateway endpoint and access credentials for this tab.",

    sectionAdvanced: "Advanced",

    sectionAdvancedLead: "Gateway readiness checks.",

    sectionAbout: "About",

    appearance: "Appearance",

    language: "Language",

    languageZh: "简体中文",

    languageEn: "English",

    theme: "Theme",

    themeDark: "Dark",

    themeLight: "Light",

    gatewayUrl: "Gateway URL",

    authentication: "Authentication",

    sharedSecret: "Shared secret (Bearer)",

    secretHint: "Stored in sessionStorage for this tab (loong.gateway.secret).",

    configOnDisk: "Config on disk",

    modelProviders: "Model providers",

    agentProfiles: "Agent profiles",

    configUnavailable: "(unavailable — is Gateway running?)",

    refreshPaths: "Refresh paths",

    gatewayReadiness: "Gateway readiness",

    gatewayReadinessHint:

      "After saving model config, Studio waits for Gateway hot reload (browser mode does not start the process for you).",

    checkReadiness: "Check Gateway readiness",

    gatewayReady: "Gateway ready.",

    gatewayNotReady: "Gateway not ready.",

  },

  chat: {

    session: "Session",

    conversation: "Conversation",

    newConversation: "New chat",

    defaultConversation: "Default chat",

    assistant: "Assistant",

    identity: "Digital employee",

    noAssistant: "No digital employee configured",

    orgSetupHint: "Complete your setup on the Organization page first.",

    selectAssistant: "Select assistant",

    connected: "Connected",

    connecting: "Connecting…",

    disconnected: "Disconnected",

    thinking: "Thinking…",

    inputPlaceholder: "Type a message…",

    send: "Send",

    composerHint: "Enter to send · Shift+Enter for newline · drag or paste attachments",

    scopeGlobal: "Global",

    scopeGlobalHint: "Read/write files and access the network anywhere",

    scopeWorkspace: "Workspace",

    scopeWorkspaceMissing: "No agent workspace path configured",

    scopePickDirectory: "Choose another folder…",

    scopePickDirectoryHint: "Browse local directories on the Gateway machine and pick one",

    scopeBrowseLoading: "Loading…",

    scopeBrowseError: "Could not read this folder",

    scopeBrowseEmpty: "No subfolders in this directory",

    scopeBrowseUp: "Up",

    scopeBrowseSelect: "Select this folder",

    workspaceScope: "Workspace scope",

    voiceInput: "Voice input",

    voiceUnsupported: "Voice not supported in this browser",

    attach: "Add image or attachment",

    recording: "Listening… click mic again to stop",

    emptyLead: "Start a conversation with {name}",

    userLabel: "You",

    gatewayError: "Cannot reach Gateway. Ensure it is running (default http://127.0.0.1:17357).",

    settings: "Settings",

    modelAuto: "Auto",

    modelAutoHint: "Dynamic multi-model routing based on task complexity",

    modelSelect: "Select model",

    warRoom: "War room",

    warRoomOpen: "Open war room",

    warRoomClose: "Close war room",

    warRoomEmpty: "Send a message to stream live events for the active run here.",

    warRoomWaiting: "Waiting for events for this run…",

    activity: {
      toggle: "Show processing steps",
      expand: "Expand steps",
      collapse: "Collapse",
      collapsedSummary: "{count} steps",
      tierSelected: "Model tier selected",
      thinking: "Thinking",
      loadingSkill: "Loading skill",
      improvingSkill: "Improving skill",
      readingFile: "Reading file",
      searchingFile: "Searching files",
      patchingFile: "Editing file",
      runningCommand: "Running command",
      openingPage: "Opening page",
      submittingForm: "Submitting form",
      callingMcp: "Calling MCP",
      toolCall: "Calling {name}",
      parallelProgress: "{done}/{total} done",
      awaitingApproval: "Awaiting approval…",
      approvalGranted: "Approved",
      approvalDenied: "Denied",
    },

    approval: {
      title: "Tool approval required",
      approve: "Approve",
      reject: "Reject",
      inbox: "Open inbox",
      resolving: "Working…",
      notificationTitle: "Loong tool approval",
    },

    context: {
      label: "Context",
      estimating: "Estimating…",
      detailsTitle: "Context usage",
      used: "Messages {used} / {limit} chars ({percent}%)",
      injectedLimit: "Injected context cap {count} chars",
      tier: "Tier {tier}",
      modelWindow: "Model window {count} tokens",
      compaction: "This turn",
      truncatedTools: "Truncated {count} tool outputs",
      truncatedAssistant: "Truncated {count} assistant messages",
      compactionRange: "Before → after  {before} → {after} chars",
      nearLimit: "Near the limit — older turns may be compacted.",
    },

  },

  events: {

    lifecycle: "lifecycle",

    tool: "tool",

    permission: "permission",

    assistantDelta: "assistant stream",

    assistantReplace: "assistant update",

    unknown: "event",

    aiSummarizationSkipped: "AI summarization skipped (not enough turns or disabled)",

    aiSummarizationFailed: "AI summarization failed: {error}",

    aiSummarizationTurns: "summarized {count} turns",

    aiSummarizationChars: "{count} chars",

    aiSummarizationDuration: "{ms} ms",

    aiSummarizationDone: "AI summarization complete",

    compactedTools: "compacted {count} tool messages",

    keptTurns: "kept {count} recent turns",

    truncatedTools: "truncated {count} tool messages",

    truncatedAssistant: "truncated {count} assistant messages",

    chars: "chars",

    context: {

      ai_summarization: "AI summary",

      session_message_compaction: "turn compaction",

      session_history_prep: "history prep",

      turn_prep: "context budget",

      tool_iteration_limit: "tool iteration limit",

      memory: "memory",

      session_compaction: "session compaction",

    },

  },

  gateway: {

    offlineTitle: "Gateway is offline",

    offlineLead: "Loong Studio needs a running Loong Gateway at",

    stepRun: "In a terminal at the repo root, run:",

    stepWait: 'Wait until you see "Loong gateway listening on …".',

    stepRetry: "Click Retry below (or refresh this page).",

    retry: "Retry connection",

  },

  common: {

    refresh: "Refresh",

    save: "Save",

    saving: "Saving…",

    cancel: "Cancel",

    clear: "Clear",

    edit: "Edit",

    remove: "Remove",

    optional: "optional",

    enabled: "enabled",

    disabled: "disabled",

    configured: "configured",

    missing: "missing",

    yes: "yes",

    no: "no",

    default: "default",

    addUpdate: "Add / update",

  },

  auth: {

    banner:

      "Authentication required. Set the Gateway shared secret in Settings (saved for this browser tab).",

  },

  about: {

    title: "Loong Studio",

    lead: "Unified browser workbench for the Loong agent platform, connected to a local or hosted Gateway.",

    surface: "Surface",

    gatewayLifecycle: "Gateway lifecycle managed by host",

    gatewayLifecycleNo: "no (start loong gateway)",

    testConnect: "Test Gateway connect",

    connectedCapabilities: "Connected. Capabilities: ",

  },

  agents: {

    title: "Agents",

    lead: "Create assistants with different styles and switch between them in chat.",

    listTitle: "My assistants",

    addAgent: "Create assistant",

    editAgent: "Edit {name}",

    addFirstAgent: "Create your first assistant",

    removeConfirm: "Remove \"{name}\"?",

    statusSaved: "Saved. You can select this assistant in chat.",

    formHint: "Enter a name and model to get started.",

    name: "Assistant name",

    namePlaceholder: "e.g. General assistant, Writing helper",

    nameRequired: "Please enter an assistant name.",

    modelRequired: "Please select a model.",

    defaultModel: "Model",

    modelNotSet: "Not selected",

    modelNeedsUpdate: "Needs re-selection",

    noModelsHint: "Add a model service on the Models page and pick a model first.",

    workspace: "Files directory",

    workspacePlaceholder: "Only needed when using local file features",

    thinking: "Thinking depth",

    useAsDefault: "Set as default assistant",

    description: "Short description",

    descriptionPlaceholder: "e.g. Good for everyday Q&A and light tasks",

    instructions: "Persona",

    instructionsPlaceholder:

      "e.g. You are a concise, friendly assistant. Prefer actionable suggestions in your answers.",

    memory: "Remember conversation context",

    tools: "Allow tools",

    listEmpty: "No assistants yet. Create one to use it in chat.",

    advancedSettings: "More options",

    advancedSettingsHint: "You usually do not need to change these.",

    profileId: "Internal name",

    profileIdPlaceholder: "Leave blank to auto-generate from the assistant name",

    thinkingDefault: "Use model default",

    thinkingNone: "Off",

    thinkingLow: "Light",

    thinkingMedium: "Balanced",

    thinkingHigh: "Deep",

  },

  org: {

    title: "Organization",

    lead: "Configure this digital employee's capabilities and organizational identity.",

    defaultName: "My digital employee",

    tabCapability: "Capabilities",

    tabIdentity: "Organization",

    tabPolicies: "Tool policies",

    statusSaved: "Saved. Chat will use the latest configuration.",

    nameRequired: "Please enter a name.",

    orgFieldsRequired: "Please select department, position, and permission policy.",

    bootstrapExample: "Create from example",

    bootstrapping: "Creating…",

    bootstrapSuccess: "Example organization created. You can refine the setup now.",

    bootstrapSkipped: "Organization already exists; nothing was changed.",

    policyEditor: {

      lead: "Edit tool permission rules (allow / ask / deny / approval). Changes are saved to the Gateway org store; assign a policy to each employee on the Organization tab.",

      title: "Tool policy JSON",

      hint: "Edit the policies array and save. Rules typically match toolName (e.g. shell_run) or capability (e.g. execute, write). deny wins over allow.",

      reload: "Reload",

      save: "Save policies",

      saving: "Saving…",

      saved: "Tool policies saved.",

      reloaded: "Policy JSON reloaded.",

      invalidJson: "JSON must include a policies array.",

      syntaxError: "Invalid JSON syntax. Check the document and try again.",

      discardConfirm: "Tool policy has unsaved changes. Discard them and continue?",

      unsavedHint: "Unsaved changes.",

      missingAssignedPolicy: "The assigned permission policy no longer exists. Choose a new one on the Organization tab.",

    },

    suite: {

      importTitle: "Import Suite",

      importHint: "Import a local suite workspace into Gateway and register its profile, employee, permissions, skills, and cron jobs.",

      pathLabel: "Suite directory",

      pathPlaceholder: "Choose a directory that contains suite.json",

      browse: "Browse...",

      browseTitle: "Choose Suite directory",

      browseHint: "Browse local directories on the Gateway machine and choose the folder that contains suite.json.",

      browseUp: "Up",

      browseLoading: "Loading directories...",

      browseEmpty: "No subfolders in this directory",

      browseError: "Could not read this folder",

      browseSelect: "Select this folder",

      pathRequired: "Enter a local directory that contains suite.json.",

      overwrite: "Overwrite an existing release with the same version",

      importing: "Importing...",

      importAction: "Import Suite",

      importComplete: "Import complete",

      skillsCopied: "Skills",

      cronsImported: "Cron jobs",

      warnings: "Warnings",

    },

    capability: {

      roleTitle: "Role",

      roleHint: "Stored in role.md in the employee workspace.",

      rolePlaceholder: "e.g. You are a concise, professional engineering assistant…",

      workflowTitle: "Workflow",

      workflowHint: "Stored in workflow.md in the employee workspace.",

      workflowPlaceholder: "e.g. Understand the request, propose a plan, then list risks…",

      skillsTitle: "Skills",

      skillsSectionHint: "All available skills are listed below. Use the toggle on each row to enable or disable it.",

      skillPreset: "Built-in",

      applyPositionPreset: "Apply “{position}” template",

      positionPresetApplied: "Position template applied. Remember to save.",

      skillsLocalFallback: "Could not sync the Gateway skill catalog; showing the built-in skill list.",

      skillsUnavailable: "Could not load the skill catalog; built-in skills are still listed.",

      skillsEmpty: "No skills found. Add SKILL.md files to your skill roots.",

      memoryTitle: "Memory",

      memoryHint: "Long-term notes go in memory.md; conversation memory uses the toggle below.",

      memoryEnabled: "Remember conversation context",

      memoryDoc: "Long-term memory (memory.md)",

      memoryPlaceholder: "## Long-term memory\n\n- User preferences…",

      memoryCandidates: "Pending memory entries",

      memoryCandidatesEmpty: "No pending memory entries.",

      contextTitle: "Context compression",

      contextHint: "Long chats are compacted only when context usage hits 100%. AI summarization stays off by default. Set compactionPolicy: \"always\" in config to compact every turn.",

      aiSummarizationEnabled: "AI-summarize older turns",

      aiSummarizationHint: "Collapse older turns into a summary while keeping recent turns verbatim.",

    },

    identity: {

      basicTitle: "Basics",

      displayName: "Name",

      displayNamePlaceholder: "e.g. Alex the Engineer",

      unit: "Department",

      unitPlaceholder: "Select department",

      position: "Position",

      positionPlaceholder: "Select position",

      scopeTitle: "Work scope",

      workspace: "Working directory",

      workspacePlaceholder: "Only needed for local file features",

      workScope: "Responsibilities",

      workScopePlaceholder: "e.g. backend development, code review",

      permissionTitle: "Permissions",

      toolPolicy: "Permission policy",

      toolPolicyPlaceholder: "Select a policy",

      policySummary: "{name} · {count} rules",

      reportingTitle: "Reporting & approvals",

      manager: "Manager",

      managerNone: "None",

      managerSummary: "Reports to: {name}",

      teamHint: "Other digital employees in the team",

      advancedSettings: "More options",

      advancedHint: "You usually do not need to change these.",

      status: "Status",

      statusActive: "Active",

      statusInactive: "Inactive",

      internalId: "Internal ID",

    },

  },

  connections: {

    title: "Connections",

    lead: "Connect your digital employee to popular messaging apps for chat and collaboration.",

    gridLabel: "Supported messaging platforms",

    statusAvailable: "Available",

    statusComingSoon: "Coming soon",

    availableHint: "Can be connected via Gateway channels",

    comingSoonHint: "Integration in development",

    channels: {

      wechat: {

        name: "WeChat",

        description: "Chat with users through WeChat Official or Service accounts.",

      },

      wecom: {

        name: "WeCom",

        description: "Collaborate with employees and external contacts in WeCom.",

      },

      feishu: {

        name: "Feishu",

        description: "Receive tasks and reply in Feishu groups and direct messages.",

      },

      dingtalk: {

        name: "DingTalk",

        description: "Connect DingTalk bots for work notifications and group chat.",

      },

      whatsapp: {

        name: "WhatsApp",

        description: "Reach customers through WhatsApp Business.",

      },

      telegram: {

        name: "Telegram",

        description: "Receive and reply to messages via Telegram Bot.",

      },

      slack: {

        name: "Slack",

        description: "Collaborate in Slack workspace channels and threads.",

      },

      discord: {

        name: "Discord",

        description: "Provide assistant services in Discord server channels.",

      },

      line: {

        name: "LINE",

        description: "Engage users through LINE Official Account.",

      },

    },

  },

  models: {

    title: "Models",

    lead: "Connect AI services and choose how conversations pick the right model.",

    tabProviders: "Services",

    tabTiers: "Smart routing",

    addProvider: "Add service",

    editProvider: "Edit {name}",

    addFirstProvider: "Add your first service",

    removeConfirm: "Remove \"{name}\"?",

    statusPaused: "Paused",

    keyMissingBadge: "API key required",

    cardDefaultModel: "Model: {model}",

    noDefaultModel: "No model selected",

    advancedSettings: "More options",

    advancedSettingsHint: "Only change these if you use a custom endpoint or internal name.",

    displayNamePlaceholder: "e.g. DeepSeek, OpenAI",

    defaultModelPlaceholder: "See your provider's docs for the model name",

    providerIdPlaceholder: "Leave blank to auto-generate from the display name",

    baseUrlPlaceholder: "Leave blank for the official endpoint",

    useThisService: "Enable this service",

    configTableTitle: "Connected models",

    configTableEmpty: "No model services yet. Add one to start chatting.",

    providerFormHint: "Enter a name and API key, then save.",

    type: "API type",

    providerId: "Internal name",

    displayName: "Display name",

    apiKey: "API key",

    apiKeyPlaceholder: "Leave blank when editing to keep the current key",

    baseUrl: "Custom endpoint",

    defaultModel: "Model",

    toolCalling: "Allow tools and plugins",

    providerOpenaiCompatible: "Common cloud APIs (OpenAI format)",

    providerAnthropic: "Anthropic Claude",

    statusSavedNextTurn: "Saved. New conversations will use the latest settings.",

    statusSavedRestart: "Saved. Refresh the page to apply changes.",

    tier: {

      title: "Smart routing",

      unsupportedLead: "Smart routing is not available in this environment yet.",

      lead: "Automatically switch between fast, standard, and deep models based on the conversation.",

      enableRouting: "Enable smart routing",

      enableRoutingHint: "When off, all conversations use the Standard tier.",

      tryRouting: "Try it",

      statusSaved: "Saved. New conversations will follow the latest rules.",

      lanesTitle: "Three tiers",

      routingTitle: "How to choose",

      modeHeuristic: "Auto",

      modeFixed: "Always use",

      heuristicHint: "Picks the best tier from message length, attachments, and similar signals.",

      fixedTo: "Always use",

      names: {

        fast: "Fast",

        standard: "Standard",

        deep: "Deep",

      },

      hints: {

        fast: "Best for quick questions and light tasks.",

        standard: "The default for everyday chat.",

        deep: "Best for complex analysis, long documents, and multi-step work.",

      },

      modelField: "Model",

      modelSelectHint: "Choose from your connected model services.",

      modelNotSet: "Not selected",

      modelNeedsUpdate: "Needs re-selection",

      configureLane: "Set up",

      configureLaneTitle: "Set up · {tier}",

      noProvidersHint: "Add at least one model on the Services tab and pick a model first.",

      thinkingField: "Thinking depth",

      contextLimit: "Context length (characters)",

      allowTools: "Allow tools",

      injectMemory: "Allow memory",

      drawerTitle: "Try it",

      drawerSubtitle: "Type a message to preview which tier would be used (no request is sent).",

      samplePrompt: "Your message",

      samplePlaceholder: "e.g. translate this paragraph; or plan a marketing campaign",

      startClassify: "See result",

      previewResult: "Suggested: {tier}",

      previewModel: "Model: {model}",

      drawerEmpty: 'Enter a message and click "See result".',

    },

  },

  status: {

    gatewayOnline: "Gateway online",

    gatewayConnecting: "Gateway connecting",

    gatewayOffline: "Gateway error",

    gatewayAuthRequired: "Gateway auth required",

  },

};

