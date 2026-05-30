import type { SkillOption } from "./skillTypes.js";

const PRESET_SKILLS: readonly SkillOption[] = [
  { name: "pptx", description: "创建、编辑、解析 PowerPoint 演示文稿（.pptx）。", category: "office", preset: true },
  { name: "docx", description: "创建与编辑 Word 文档（.docx）。", category: "office", preset: true },
  { name: "xlsx", description: "创建与分析 Excel 表格（.xlsx）。", category: "office", preset: true },
  { name: "pdf", description: "读取、合并、拆分、填写与生成 PDF。", category: "office", preset: true },
  { name: "canvas-design", description: "创作海报、视觉设计等静态图像（.png / .pdf）。", category: "image", preset: true },
  { name: "algorithmic-art", description: "使用 p5.js 生成算法艺术与可交互视觉作品。", category: "image", preset: true },
  { name: "slack-gif-creator", description: "制作适配 Slack 的动图 GIF。", category: "image", preset: true },
  {
    name: "remotion-best-practices",
    description: "使用 Remotion + React 程序化制作视频。",
    category: "video",
    preset: true,
  },
  { name: "frontend-design", description: "创建高质量、有辨识度的前端界面。", category: "design", preset: true },
  {
    name: "vercel-react-best-practices",
    description: "React / Next.js 性能与架构最佳实践。",
    category: "engineering",
    preset: true,
  },
  { name: "web-design-guidelines", description: "Web 界面可访问性与体验审查。", category: "design", preset: true },
  { name: "webapp-testing", description: "使用 Playwright 测试本地 Web 应用。", category: "engineering", preset: true },
  { name: "mcp-builder", description: "构建高质量 MCP 服务器。", category: "engineering", preset: true },
  { name: "doc-coauthoring", description: "结构化文档协作撰写流程。", category: "writing", preset: true },
  { name: "internal-comms", description: "撰写内部沟通文档与通报。", category: "writing", preset: true },
  { name: "skill-creator", description: "创建与优化 Agent Skills。", category: "meta", preset: true },
  { name: "code-review", description: "按团队规范进行代码评审。", category: "engineering", preset: true },
  { name: "bug-triage", description: "收集复现信息并定位 Bug 根因。", category: "engineering", preset: true },
  { name: "prd-draft", description: "整理产品需求与用户故事。", category: "product", preset: true },
  { name: "task-breakdown", description: "将目标拆解为可执行任务。", category: "management", preset: true },
  { name: "meeting-notes", description: "整理会议要点与待办。", category: "management", preset: true },
];

export function listPresetSkillOptions(): SkillOption[] {
  return PRESET_SKILLS.map(skill => ({ ...skill }));
}

export function mergeSkillOptionLists(
  primary: readonly SkillOption[],
  fallback: readonly SkillOption[],
): SkillOption[] {
  const merged = new Map<string, SkillOption>();
  for (const skill of fallback) {
    merged.set(skill.name, { ...skill });
  }
  for (const skill of primary) {
    const existing = merged.get(skill.name);
    const entry: SkillOption = {
      name: skill.name,
      description: skill.description || existing?.description || "",
      preset: existing?.preset ?? skill.preset ?? false,
    };
    const category = skill.category ?? existing?.category;
    if (category) {
      entry.category = category;
    }
    merged.set(skill.name, entry);
  }
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}
