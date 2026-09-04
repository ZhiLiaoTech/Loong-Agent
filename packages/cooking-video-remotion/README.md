# Cooking Video Remotion Renderer

固定使用 Remotion 4.0.520，提供 `CookingPromo15` 和 `CookingPromo30` 两个 1080×1920、30fps Composition。

输入 props 包含已校验的片段绝对路径、裁切焦点、字幕、卖点、品牌主题、Logo 和已获许可的背景音乐。源视频声音和背景音乐分别控制音量；最终响度标准化仍由媒体管线的 FFmpeg 输出阶段执行。

```powershell
corepack pnpm --filter @loong/cooking-video-remotion studio
corepack pnpm --filter @loong/cooking-video-remotion render:15 -- --props D:\jobs\job-001\edit\remotion-props.json D:\jobs\job-001\output\promo.mp4
```
