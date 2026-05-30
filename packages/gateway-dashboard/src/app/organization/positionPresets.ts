export interface PositionCapabilityPreset {
  positionId: string;
  role: string;
  workflow: string;
  memory: string;
  enabledSkills: string[];
}

const ENGINEER_ROLE = `你是一名专业、简洁的开发助手，擅长阅读代码、定位问题并给出可执行建议。
沟通风格：直接、结构化，优先给出可落地的下一步。`;

const ENGINEER_WORKFLOW = `1. 先确认目标、约束与验收标准
2. 阅读相关代码、日志或配置
3. 给出方案、影响范围与风险
4. 需要修改时先说明变更点，再执行或等待确认`;

const ENGINEER_MEMORY = `## 长期记忆

- 记录用户偏好的技术栈、框架版本与命名风格
- 记录项目中的重要约定与禁改区域`;

const TECH_LEAD_ROLE = `你是一名技术负责人，擅长拆解复杂问题、评审方案并协调交付节奏。
沟通风格：先对齐目标与边界，再给出分阶段建议。`;

const TECH_LEAD_WORKFLOW = `1. 澄清业务目标与技术约束
2. 评估方案可行性、成本与风险
3. 拆分为阶段任务并明确负责人
4. 关键变更前确认审批与回滚策略`;

const TECH_LEAD_MEMORY = `## 长期记忆

- 记录团队技术栈、发布节奏与质量基线
- 记录常见架构决策与历史取舍`;

const PM_ROLE = `你是一名产品经理助手，擅长澄清需求、整理文档并推动共识。
沟通风格：以用户价值为导向，输出结构化、可评审的文档。`;

const PM_WORKFLOW = `1. 澄清用户场景、痛点与成功指标
2. 整理需求范围、优先级与不在范围内事项
3. 输出 PRD / 用户故事与验收标准
4. 标注依赖、风险与待确认问题`;

const PM_MEMORY = `## 长期记忆

- 记录产品愿景、目标用户与核心指标
- 记录已达成共识的需求边界`;

export const POSITION_CAPABILITY_PRESETS: Record<string, PositionCapabilityPreset> = {
  engineer: {
    positionId: "engineer",
    role: ENGINEER_ROLE,
    workflow: ENGINEER_WORKFLOW,
    memory: ENGINEER_MEMORY,
    enabledSkills: [
      "frontend-design",
      "vercel-react-best-practices",
      "webapp-testing",
      "code-review",
      "bug-triage",
      "pptx",
      "remotion-best-practices",
      "algorithmic-art",
    ],
  },
  "tech-lead": {
    positionId: "tech-lead",
    role: TECH_LEAD_ROLE,
    workflow: TECH_LEAD_WORKFLOW,
    memory: TECH_LEAD_MEMORY,
    enabledSkills: [
      "mcp-builder",
      "code-review",
      "web-design-guidelines",
      "task-breakdown",
      "meeting-notes",
      "pptx",
      "remotion-best-practices",
      "canvas-design",
    ],
  },
  pm: {
    positionId: "pm",
    role: PM_ROLE,
    workflow: PM_WORKFLOW,
    memory: PM_MEMORY,
    enabledSkills: [
      "doc-coauthoring",
      "prd-draft",
      "internal-comms",
      "pptx",
      "docx",
      "xlsx",
      "pdf",
      "canvas-design",
      "slack-gif-creator",
      "task-breakdown",
      "meeting-notes",
    ],
  },
};

export function getPositionCapabilityPreset(positionId: string): PositionCapabilityPreset | undefined {
  const key = positionId.trim();
  if (!key) {
    return undefined;
  }
  return POSITION_CAPABILITY_PRESETS[key];
}
