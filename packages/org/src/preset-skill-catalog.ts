export interface PresetSkillCatalogEntry {
  name: string;
  description: string;
  category: string;
  source: string;
  preset: true;
}

export const PRESET_SKILL_CATALOG: readonly PresetSkillCatalogEntry[] = [
  {
    name: "pptx",
    description: "创建、编辑、解析 PowerPoint 演示文稿（.pptx），含模板、版式与幻灯片设计指引（Anthropic 文档技能）。",
    category: "office",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "docx",
    description: "创建与编辑 Word 文档（.docx），支持目录、修订、批注与专业排版（Anthropic 文档技能）。",
    category: "office",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "xlsx",
    description: "创建与分析 Excel 表格（.xlsx），支持公式、格式与数据可视化（Anthropic 文档技能）。",
    category: "office",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "pdf",
    description: "读取、合并、拆分、填写与生成 PDF 文件（Anthropic 文档技能）。",
    category: "office",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "canvas-design",
    description: "创作海报、视觉设计等静态图像（.png / .pdf），强调美学与排版（Anthropic 官方技能）。",
    category: "image",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "algorithmic-art",
    description: "使用 p5.js 生成算法艺术、粒子与流场等可交互视觉作品（Anthropic 官方技能）。",
    category: "image",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "slack-gif-creator",
    description: "制作适配 Slack 的动图 GIF，含尺寸、帧率与动画技巧（Anthropic 官方技能）。",
    category: "image",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "remotion-best-practices",
    description: "使用 Remotion + React 程序化制作视频，含动画、字幕、音视频与渲染最佳实践（Remotion 官方）。",
    category: "video",
    source: "remotion-dev/skills",
    preset: true,
  },
  {
    name: "frontend-design",
    description: "创建高质量、有辨识度的前端界面，避免千篇一律的 AI 审美（Anthropic 官方技能）。",
    category: "design",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "vercel-react-best-practices",
    description: "React / Next.js 性能优化与架构最佳实践，含 70+ 条规则（Vercel Engineering）。",
    category: "engineering",
    source: "vercel-labs/agent-skills",
    preset: true,
  },
  {
    name: "web-design-guidelines",
    description: "按 Web Interface Guidelines 审查 UI 代码的可访问性与体验（Vercel）。",
    category: "design",
    source: "vercel-labs/agent-skills",
    preset: true,
  },
  {
    name: "webapp-testing",
    description: "使用 Playwright 测试本地 Web 应用、截图与调试 UI（Anthropic 官方技能）。",
    category: "engineering",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "mcp-builder",
    description: "构建高质量 MCP 服务器，对接外部 API 与服务（Anthropic 官方技能）。",
    category: "engineering",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "doc-coauthoring",
    description: "结构化文档协作流程：收集上下文、分节撰写、读者测试（Anthropic 官方技能）。",
    category: "writing",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "internal-comms",
    description: "撰写内部沟通：周报、项目通报、FAQ、事故报告等（Anthropic 官方技能）。",
    category: "writing",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "skill-creator",
    description: "创建、验证与优化 Agent Skills（SKILL.md）的工作流（Anthropic 官方技能）。",
    category: "meta",
    source: "anthropics/skills",
    preset: true,
  },
  {
    name: "code-review",
    description: "按团队规范进行代码评审，关注正确性、边界条件与测试覆盖。",
    category: "engineering",
    source: "loong",
    preset: true,
  },
  {
    name: "bug-triage",
    description: "收集复现步骤与日志，定位根因并给出修复建议。",
    category: "engineering",
    source: "loong",
    preset: true,
  },
  {
    name: "prd-draft",
    description: "整理产品需求、用户故事与验收标准，输出结构化 PRD。",
    category: "product",
    source: "loong",
    preset: true,
  },
  {
    name: "task-breakdown",
    description: "将目标拆解为可执行任务，标注优先级、依赖与风险。",
    category: "management",
    source: "loong",
    preset: true,
  },
  {
    name: "meeting-notes",
    description: "整理会议要点、决策、待办与负责人。",
    category: "management",
    source: "loong",
    preset: true,
  },
] as const;

export const OFFICE_PRESET_SKILL_NAMES = ["pptx", "docx", "xlsx", "pdf"] as const;

export const MEDIA_PRESET_SKILL_NAMES = [
  "canvas-design",
  "algorithmic-art",
  "slack-gif-creator",
  "remotion-best-practices",
] as const;

export const MANDATORY_PRESET_SKILL_NAMES = [
  ...OFFICE_PRESET_SKILL_NAMES,
  ...MEDIA_PRESET_SKILL_NAMES,
] as const;

export function listPresetSkillCatalog(): PresetSkillCatalogEntry[] {
  return PRESET_SKILL_CATALOG.map(entry => ({ ...entry }));
}
