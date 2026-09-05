import type { MessageTree } from "../types.js";



export const zhCN: MessageTree = {

  nav: {

    chat: "对话",

    models: "模型",

    org: "组织",

    connections: "连接",

    observe: "观测",
    cookingVideo: "视频审核",

    agents: "助手",

    settings: "设置",

    about: "关于",

  },

  observe: {
    title: "观测",
    lead: "查看运行状态、实时事件、工具审批与记忆候选。",
    session: "会话 ID",
    statsRuns: "运行",
    statsActive: "进行中",
    statsPending: "待审批",
    statsEvents: "事件缓冲",
    approvalsSection: "工具审批",
    approvalsLead: "Agent 请求执行敏感工具时会出现在这里。",
    eventsSection: "实时事件",
    memorySection: "记忆候选",
    runsSection: "最近运行",
    eventsEmpty: "暂无实时事件。",
    memoryEmpty: "暂无待处理记忆候选。",
    memoryPromote: "采纳",
    memoryReject: "驳回",
    runsEmpty: "暂无运行记录。",
    runCancel: "取消",
  },

  sidebar: {

    collapse: "收起侧栏",

    expand: "展开侧栏",

  },

  settings: {

    title: "设置",

    lead: "管理 Studio 外观、Gateway 连接与高级选项。",

    sectionGeneral: "常规",

    sectionGeneralLead: "界面语言与主题偏好。",

    sectionConnection: "连接与认证",

    sectionConnectionLead: "当前 Gateway 地址与访问凭证。",

    sectionAdvanced: "高级",

    sectionAdvancedLead: "Gateway 就绪状态检查。",

    sectionAbout: "关于",

    appearance: "外观",

    language: "语言",

    languageZh: "简体中文",

    languageEn: "English",

    theme: "主题",

    themeDark: "深色模式",

    themeLight: "浅色模式",

    gatewayUrl: "Gateway 地址",

    authentication: "认证",

    sharedSecret: "共享密钥 (Bearer)",

    secretHint: "保存在当前标签页的 sessionStorage（loong.gateway.secret）。",

    configOnDisk: "磁盘配置",

    modelProviders: "模型提供商",

    agentProfiles: "助手配置",

    configUnavailable: "（不可用 — Gateway 是否在运行？）",

    refreshPaths: "刷新路径",

    gatewayReadiness: "Gateway 就绪检查",

    gatewayReadinessHint:

      "保存模型配置后，Studio 会等待 Gateway 热重载（浏览器模式不会替你启动进程）。",

    checkReadiness: "检查 Gateway 就绪",

    gatewayReady: "Gateway 已就绪。",

    gatewayNotReady: "Gateway 未就绪。",

  },

  chat: {

    session: "会话",

    conversation: "对话",

    newConversation: "新对话",

    defaultConversation: "默认对话",

    assistant: "助手",

    identity: "数字员工",

    noAssistant: "未配置数字员工",

    orgSetupHint: "请先在「组织」页完成数字员工配置。",

    selectAssistant: "选择助手",

    connected: "已连接",

    connecting: "连接中…",

    disconnected: "未连接",

    thinking: "思考中…",

    inputPlaceholder: "输入消息…",

    send: "发送",

    composerHint: "Enter 发送 · Shift+Enter 换行 · 支持拖拽与粘贴附件",

    scopeGlobal: "全局",

    scopeGlobalHint: "允许在任意路径读写文件并访问网络",

    scopeWorkspace: "工作区",

    scopeWorkspaceMissing: "未配置 Agent 工作区路径",

    scopePickDirectory: "选择其他目录…",

    scopePickDirectoryHint: "浏览 Gateway 所在机器上的本地目录并选择",

    scopeBrowseLoading: "正在加载…",

    scopeBrowseError: "无法读取该目录",

    scopeBrowseEmpty: "此目录下没有子文件夹",

    scopeBrowseUp: "上一级",

    scopeBrowseSelect: "选择此文件夹",

    workspaceScope: "工作区范围",

    voiceInput: "语音输入",

    voiceUnsupported: "当前浏览器不支持语音",

    attach: "添加图片或附件",

    recording: "正在聆听… 再次点击麦克风结束",

    emptyLead: "开始和 {name} 对话吧",

    userLabel: "你",

    gatewayError: "无法连接 Gateway，请确认服务已启动（默认 http://127.0.0.1:17357）。",

    settings: "设置",

    modelAuto: "自动",

    modelAutoHint: "依据任务复杂度多模型动态调度",

    modelSelect: "选择模型",

    warRoom: "作战室",

    warRoomOpen: "打开作战室",

    warRoomClose: "关闭作战室",

    warRoomEmpty: "发送消息后，这里会显示本轮运行的实时事件。",

    warRoomWaiting: "等待本轮运行事件…",

    activity: {
      toggle: "显示处理过程",
      expand: "展开处理步骤",
      collapse: "收起",
      collapsedSummary: "{count} 个步骤",
      tierSelected: "选择模型档位",
      thinking: "思考过程",
      loadingSkill: "加载技能",
      improvingSkill: "优化技能",
      readingFile: "阅读文件",
      searchingFile: "搜索文件",
      patchingFile: "修改文件",
      runningCommand: "执行命令",
      openingPage: "打开网页",
      submittingForm: "提交表单",
      callingMcp: "调用 MCP",
      toolCall: "调用 {name}",
      parallelProgress: "{done}/{total} 完成",
      awaitingApproval: "等待批准…",
      approvalGranted: "已批准",
      approvalDenied: "已拒绝",
    },

    approval: {
      title: "需要工具审批",
      approve: "批准",
      reject: "拒绝",
      inbox: "打开收件箱",
      resolving: "处理中…",
      notificationTitle: "Loong 工具审批",
    },

    context: {
      label: "上下文",
      estimating: "估算中…",
      detailsTitle: "上下文用量",
      used: "消息列表 {used} / {limit} chars（{percent}%）",
      injectedLimit: "注入上下文上限 {count} chars",
      tier: "Tier {tier}",
      modelWindow: "模型窗口 {count} tokens",
      compaction: "本轮压缩",
      truncatedTools: "工具输出截断 {count} 条",
      truncatedAssistant: "Assistant 截断 {count} 条",
      compactionRange: "压缩前 → 后  {before} → {after} chars",
      nearLimit: "接近上限，较早的对话可能被压缩。",
    },

  },

  events: {

    lifecycle: "生命周期",

    tool: "工具",

    permission: "权限",

    assistantDelta: "回复流",

    assistantReplace: "回复更新",

    unknown: "事件",

    aiSummarizationSkipped: "AI 摘要已跳过（轮数不足或未启用）",

    aiSummarizationFailed: "AI 摘要失败：{error}",

    aiSummarizationTurns: "摘要 {count} 轮",

    aiSummarizationChars: "{count} 字",

    aiSummarizationDuration: "{ms} ms",

    aiSummarizationDone: "AI 摘要完成",

    compactedTools: "压缩 {count} 条 tool",

    keptTurns: "保留最近 {count} 轮",

    truncatedTools: "截断 {count} 条 tool",

    truncatedAssistant: "截断 {count} 条 assistant",

    chars: "字符",

    context: {

      ai_summarization: "AI 摘要",

      session_message_compaction: "轮次压缩",

      session_history_prep: "历史预处理",

      turn_prep: "上下文预算",

      tool_iteration_limit: "工具迭代上限",

      memory: "记忆",

      session_compaction: "会话压缩",

    },

  },

  gateway: {

    offlineTitle: "Gateway 未连接",

    offlineLead: "Loong Studio 需要正在运行的 Loong Gateway：",

    stepRun: "在仓库根目录的终端中运行：",

    stepWait: "等待出现 “Loong gateway listening on …”。",

    stepRetry: "点击下方重试（或刷新页面）。",

    retry: "重试连接",

  },

  common: {

    refresh: "刷新",

    save: "保存",

    saving: "保存中…",

    cancel: "取消",

    clear: "清空",

    edit: "编辑",

    remove: "删除",

    optional: "可选",

    enabled: "已启用",

    disabled: "已禁用",

    configured: "已配置",

    missing: "未配置",

    yes: "是",

    no: "否",

    default: "默认",

    addUpdate: "添加 / 更新",

  },

  auth: {

    banner: "需要认证。请在设置中填写 Gateway 共享密钥（仅保存在当前浏览器标签页）。",

  },

  about: {

    title: "Loong Studio",

    lead: "Loong 智能体平台的统一浏览器工作台，可连接本地或线上 Gateway。",

    surface: "运行环境",

    gatewayLifecycle: "由宿主管理 Gateway 生命周期",

    gatewayLifecycleNo: "否（请手动运行 loong gateway）",

    testConnect: "测试 Gateway 连接",

    connectedCapabilities: "已连接。能力数：",

  },

  agents: {

    title: "助手",

    lead: "创建不同风格的 AI 助手，在对话中随时切换。",

    listTitle: "我的助手",

    addAgent: "创建助手",

    editAgent: "编辑 {name}",

    addFirstAgent: "创建第一个助手",

    removeConfirm: "确定删除「{name}」吗？",

    statusSaved: "已保存，可在对话中选用。",

    formHint: "填写名称和模型后即可使用。",

    name: "助手名称",

    namePlaceholder: "例如：通用助手、写作助手",

    nameRequired: "请填写助手名称。",

    modelRequired: "请选择要使用的模型。",

    defaultModel: "使用模型",

    modelNotSet: "未选择",

    modelNeedsUpdate: "需重新选择",

    noModelsHint: "请先在「模型」页添加模型服务并选择常用模型。",

    workspace: "文件工作目录",

    workspacePlaceholder: "仅在使用本地文件功能时需要",

    thinking: "思考深度",

    useAsDefault: "设为默认助手",

    description: "一句话介绍",

    descriptionPlaceholder: "例如：适合日常问答与轻量任务",

    instructions: "角色设定",

    instructionsPlaceholder: "例如：你是一个简洁、友好的助手，回答时优先给出可执行的建议。",

    memory: "记住对话上下文",

    tools: "允许使用工具",

    listEmpty: "还没有助手。创建一个，即可在对话里选用。",

    advancedSettings: "更多选项",

    advancedSettingsHint: "多数情况下无需修改。",

    profileId: "内部名称",

    profileIdPlaceholder: "可留空，将根据助手名称自动生成",

    thinkingDefault: "跟随模型默认",

    thinkingNone: "关闭",

    thinkingLow: "较快",

    thinkingMedium: "标准",

    thinkingHigh: "更深入",

  },

  org: {

    title: "组织",

    lead: "配置本数字员工的能力与组织身份。",

    defaultName: "我的数字员工",

    tabCapability: "能力",

    tabIdentity: "组织身份",

    tabPolicies: "工具策略",

    statusSaved: "已保存，对话将使用最新配置。",

    nameRequired: "请填写姓名。",

    orgFieldsRequired: "请选择部门、岗位和权限方案。",

    bootstrapExample: "从示例创建",

    bootstrapping: "创建中…",

    bootstrapSuccess: "示例组织已创建，请继续完善配置。",

    bootstrapSkipped: "组织已存在，未重复创建。",

    policyEditor: {

      lead: "编辑工具权限规则（allow / ask / deny / approval）。保存后写入 Gateway 组织目录；在「组织身份」Tab 为员工选择对应的权限方案。",

      title: "工具策略 JSON",

      hint: "编辑 policies 数组后保存。典型规则按 toolName（如 shell_run）或 capability（如 execute、write）匹配。deny 优先于 allow。",

      reload: "重新加载",

      save: "保存策略",

      saving: "保存中…",

      saved: "工具策略已保存。",

      reloaded: "策略 JSON 已重新加载。",

      invalidJson: "JSON 必须包含 policies 数组。",

      syntaxError: "JSON 格式无效，请检查语法。",

      discardConfirm: "工具策略有未保存的修改，放弃并继续？",

      unsavedHint: "有未保存的修改。",

      missingAssignedPolicy: "当前员工绑定的权限方案已不存在，请在「组织身份」中重新选择。",

    },

    suite: {

      importTitle: "导入 Suite",

      importHint: "将本地 suite 工作区导入 Gateway，并注册对应的 profile、数字员工、权限、技能和定时任务。",

      pathLabel: "Suite 目录",

      pathPlaceholder: "请选择包含 suite.json 的目录",

      browse: "浏览目录",

      browseTitle: "选择 Suite 目录",

      browseHint: "浏览 Gateway 所在机器的本地目录，选择包含 suite.json 的文件夹。",

      browseUp: "上一级",

      browseLoading: "正在读取目录...",

      browseEmpty: "此目录没有子目录",

      browseError: "无法读取此目录",

      browseSelect: "选择此目录",

      pathRequired: "请输入包含 suite.json 的本地目录。",

      overwrite: "覆盖已存在的同版本 release",

      importing: "导入中...",

      importAction: "导入 Suite",

      importComplete: "导入完成",

      skillsCopied: "技能",

      cronsImported: "定时任务",

      warnings: "警告",

    },

    capability: {

      roleTitle: "角色",

    roleHint: "对应工作区中的 role.md。",

    rolePlaceholder: "例如：你是一名简洁、专业的开发助手…",

    workflowTitle: "工作流",

    workflowHint: "对应工作区中的 workflow.md。",

    workflowPlaceholder: "例如：先理解需求，再给出方案，最后列出风险…",

    skillsTitle: "技能",

    skillsSectionHint: "以下为可用技能列表，每项右侧开关可单独启用或关闭。",

    skillPreset: "预置",

    applyPositionPreset: "应用「{position}」模板",

    positionPresetApplied: "已应用岗位模板，记得保存。",

    skillsLocalFallback: "未能同步 Gateway 技能目录，已显示本地预置技能列表。",

    skillsUnavailable: "当前无法加载技能目录，仍显示预置技能列表。",

    skillsEmpty: "未发现可用技能。可在技能目录中添加 SKILL.md。",

    memoryTitle: "记忆",

    memoryHint: "长期记忆写入 memory.md；对话上下文由下方开关控制。",

    memoryEnabled: "记住对话上下文",

    memoryDoc: "长期记忆（memory.md）",

    memoryPlaceholder: "## 长期记忆\n\n- 用户偏好…",

    memoryCandidates: "待审核的记忆条目",

    memoryCandidatesEmpty: "暂无待审核记忆。",

    contextTitle: "上下文压缩",

    contextHint: "长对话仅在上下文用量达到 100% 时自动压缩；AI 摘要默认关闭，失败会回退到硬截断。如需每轮都压缩，在配置中设置 compactionPolicy: \"always\"。",

    aiSummarizationEnabled: "AI 摘要旧对话",

    aiSummarizationHint: "将较早轮次压缩为摘要后再发送给模型，保留最近几轮原文。",

    },

    identity: {

      basicTitle: "基本信息",

      displayName: "姓名",

      displayNamePlaceholder: "例如：开发-小龙",

      unit: "部门",

      unitPlaceholder: "请选择部门",

      position: "岗位",

      positionPlaceholder: "请选择岗位",

      scopeTitle: "工作范围",

      workspace: "工作目录",

      workspacePlaceholder: "仅在使用本地文件时需要",

      workScope: "职责范围",

      workScopePlaceholder: "例如：后端开发、代码评审",

      permissionTitle: "权限",

      toolPolicy: "权限方案",

      toolPolicyPlaceholder: "请选择权限方案",

      policySummary: "{name} · {count} 条规则",

      reportingTitle: "汇报与审批",

      manager: "直属上级",

      managerNone: "无",

      managerSummary: "汇报给：{name}",

      teamHint: "团队中的其他数字员工",

      advancedSettings: "更多选项",

      advancedHint: "通常无需修改。",

      status: "状态",

      statusActive: "在职",

      statusInactive: "停用",

      internalId: "内部标识",

    },

  },

  connections: {

    title: "连接",

    lead: "将数字员工接入常用即时通讯工具，在聊天软件中直接对话与协作。",

    gridLabel: "可接入的即时通讯平台",

    statusAvailable: "已支持",

    statusComingSoon: "即将推出",

    availableHint: "可通过 Gateway 渠道接入",

    comingSoonHint: "接入能力开发中",

    channels: {

      wechat: {

        name: "微信",

        description: "通过微信公众号或服务号与用户对话。",

      },

      wecom: {

        name: "企业微信",

        description: "在企业微信中与员工和外部联系人协作。",

      },

      feishu: {

        name: "飞书",

        description: "在飞书群聊与私聊中接收任务并回复。",

      },

      dingtalk: {

        name: "钉钉",

        description: "接入钉钉机器人，支持工作通知与群聊。",

      },

      whatsapp: {

        name: "WhatsApp",

        description: "通过 WhatsApp Business 与客户沟通。",

      },

      telegram: {

        name: "Telegram",

        description: "通过 Telegram Bot 接收与回复消息。",

      },

      slack: {

        name: "Slack",

        description: "在 Slack 工作区频道与线程中协作。",

      },

      discord: {

        name: "Discord",

        description: "在 Discord 服务器频道中提供助手服务。",

      },

      line: {

        name: "LINE",

        description: "通过 LINE Official Account 与用户互动。",

      },

    },

  },

  models: {

    title: "模型",

    lead: "连接 AI 服务，并设置对话时如何自动选择合适的模型。",

    tabProviders: "模型服务",

    tabTiers: "智能调度",

    addProvider: "添加模型服务",

    editProvider: "编辑 {name}",

    addFirstProvider: "添加第一个模型服务",

    removeConfirm: "确定删除「{name}」吗？",

    statusPaused: "已暂停",

    keyMissingBadge: "请填写 API 密钥",

    cardDefaultModel: "常用模型：{model}",

    noDefaultModel: "尚未选择常用模型",

    advancedSettings: "更多选项",

    advancedSettingsHint: "仅在需要自定义接口或内部名称时修改。",

    displayNamePlaceholder: "例如：DeepSeek、通义千问",

    defaultModelPlaceholder: "在服务商文档中查看模型名称",

    providerIdPlaceholder: "可留空，将根据名称自动生成",

    baseUrlPlaceholder: "留空则使用官方地址",

    useThisService: "启用此服务",

    configTableTitle: "已连接的模型",

    configTableEmpty: "还没有添加模型服务。添加后即可在对话中使用。",

    providerFormHint: "填写名称和密钥后保存即可。",

    type: "接口类型",

    providerId: "内部名称",

    displayName: "显示名称",

    apiKey: "API 密钥",

    apiKeyPlaceholder: "编辑时留空表示不修改",

    baseUrl: "自定义服务地址",

    defaultModel: "常用模型",

    toolCalling: "允许使用工具与插件",

    providerOpenaiCompatible: "主流云服务（OpenAI 接口）",

    providerAnthropic: "Anthropic Claude",

    statusSavedNextTurn: "已保存，新的对话将使用最新设置。",

    statusSavedRestart: "已保存，请刷新页面后生效。",

    tier: {

      title: "智能调度",

      unsupportedLead: "当前环境暂不支持智能调度，请升级后再试。",

      lead: "根据对话内容自动在快速、标准、深度三档模型间切换。",

      enableRouting: "启用智能调度",

      enableRoutingHint: "关闭后，所有对话都会使用「标准」档模型。",

      tryRouting: "试一试",

      statusSaved: "已保存，新的对话将按最新规则选择模型。",

      lanesTitle: "三档模型",

      routingTitle: "选择方式",

      modeHeuristic: "自动判断",

      modeFixed: "固定使用",

      heuristicHint: "根据问题长短、是否带附件等因素，自动挑选最合适的模型档位。",

      fixedTo: "始终使用",

      names: {

        fast: "快速",

        standard: "标准",

        deep: "深度",

      },

      hints: {

        fast: "适合简短问答与轻量任务，响应更快。",

        standard: "日常对话的默认选择，兼顾速度与效果。",

        deep: "适合复杂分析、长文档与多步骤任务。",

      },

      modelField: "使用模型",

      modelSelectHint: "从已连接的模型服务中选择。",

      modelNotSet: "未选择",

      modelNeedsUpdate: "需重新选择",

      configureLane: "设置",

      configureLaneTitle: "设置 · {tier}",

      noProvidersHint: "请先在「模型服务」页添加至少一个模型，并选择常用模型。",

      thinkingField: "思考深度",

      contextLimit: "上下文长度（字数）",

      allowTools: "允许使用工具",

      injectMemory: "允许使用记忆",

      drawerTitle: "试一试",

      drawerSubtitle: "输入一句话，预览会选用哪档模型（不会真正发送请求）。",

      samplePrompt: "输入示例",

      samplePlaceholder: "例如：帮我翻译这段话；或：设计一个活动方案",

      startClassify: "查看结果",

      previewResult: "建议使用：{tier}",

      previewModel: "对应模型：{model}",

      drawerEmpty: "输入内容后点击「查看结果」。",

    },

  },

  status: {

    gatewayOnline: "网关在线",

    gatewayConnecting: "网关连接中",

    gatewayOffline: "网关异常",

    gatewayAuthRequired: "网关需认证",

  },

};

