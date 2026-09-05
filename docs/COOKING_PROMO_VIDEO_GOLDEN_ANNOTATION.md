# 自动炒菜机宣传视频黄金样本标注规范

版本：1.0  
适用范围：多机位普通网络摄像头/NVR 录像与用户投递录像  
机器格式：`packages/suite/presets/cooking-promo-video/schemas/golden-annotation.schema.json`

## 1. 目的

黄金样本用于衡量事件召回率、候选片段可用率、最佳机位 Top-1/Top-2 命中率和人工换机位率。标注描述事实与剪辑判断，不填写模型置信度，不根据当前模型输出反向修改事实。

每个样本使用一个 JSON 文件。所有时间统一使用同步后时间轴的整数毫秒；机位名称必须与作业 `cameraId` 完全一致。

## 2. 角色与流程

1. 标注员独立观看所有机位，建立事件和禁用区间，状态保存为 `draft`。
2. 标注员为每个事件列出各机位候选片段，判断是否可用并选择主镜头和备选镜头。
3. 复核员检查事件边界、候选可用性和最佳镜头，不得与标注员为同一人。
4. 无分歧时填写批准信息并把状态改为 `reviewed`。
5. 有分歧时填写 `changes_required` 和标准问题码；修改后重新复核。需要第三人裁决时，最终状态为 `adjudicated`。

标注文件只使用人员代号，不写姓名、联系方式、顾客信息或画面文字抄录。

## 3. 事件标注

事件类型必须从以下集合选择：

- `machine_intro`：设备整体或核心结构清晰展示。
- `cooking_started`：设备开始执行烹饪动作。
- `ingredient_added`：主料或辅料进入锅体。
- `seasoning_added`：调味料加入。
- `stir_fry`：锅体、搅拌机构或食材呈现明确翻炒动作。
- `steam_or_flame`：蒸汽或火焰形成有表现力但安全的画面。
- `sauce_coating`：酱汁覆盖、混合或色泽变化清晰可见。
- `dish_completed`：机器烹饪流程完成。
- `plating`：菜品从设备转移至餐具。
- `finished_dish`：成品菜完整、清晰展示。
- `operator_interaction`：操作员启动、选择程序或执行必要交互。

边界规则：`startMs` 是动作首次可确认的时刻，`endMs` 是动作最后仍可确认的时刻；不要包含纯等待画面。持续动作允许一个长事件，不按每次机械往复拆分。不同语义事件允许重叠。

`required=true` 表示该事件应进入当前评测的关键视觉事件集合，因此不能标为 `hidden`。完全不可见但由其他证据确认存在的事件可标为 `hidden`，同时必须设置 `required=false`，且不应凭机器日志推测具体视觉边界。

## 4. 候选片段与最佳机位

每个候选片段只绑定一个事件和一个机位：

- 入点应保留动作前约 200～500 ms 的视觉准备，出点保留动作后的自然收尾。
- 片段必须位于对应源视频时长内，建议不少于 500 ms。
- `usable=true` 时 `exclusionReasons` 必须为空。
- 不可用原因只能选择：`blur`、`shake`、`occlusion`、`exposure`、`dirty_lens`、`unsafe_crop`、`duplicate`、`irrelevant`、`other`。
- 与 `severity=exclude` 禁用区间重叠的候选不得标为可用。

最佳镜头按以下顺序判断：事件动作明确、主体无遮挡、食物观感、设备露出、构图与目标画幅适配、稳定与清晰、与相邻镜头的连续性。`primaryCandidateId` 只能有一个；备选镜头按优先级排列，且必须属于同一事件并标为可用。

状态为 `reviewed` 或 `adjudicated` 时，每个必标事件都必须有最佳镜头。

## 5. 禁用画面

禁用区间独立于事件和候选片段标注：

- `exclude`：任何自动成片不得使用，例如隐私信息、不安全操作、严重遮挡、损坏画面或明显不合格菜品。
- `warn`：允许人工判断使用，例如轻微污渍、次优构图或短暂曝光波动。

原因集合为 `privacy`、`safety`、`brand`、`food_quality`、`obstruction`、`technical`、`irrelevant`、`other`。同一时间段存在多个原因时写入同一个区间的 `reasons`。

## 6. 复核问题码

建议使用以下稳定问题码：

- `EVENT_MISSING`、`EVENT_TYPE_WRONG`、`EVENT_BOUNDARY_WRONG`
- `CANDIDATE_MISSING`、`CANDIDATE_BOUNDARY_WRONG`、`USABILITY_WRONG`
- `BEST_CAMERA_WRONG`、`ALTERNATE_ORDER_WRONG`
- `FORBIDDEN_RANGE_MISSING`、`FORBIDDEN_REASON_WRONG`
- `SOURCE_METADATA_WRONG`、`PRIVACY_REVIEW_REQUIRED`

问题码只能描述问题类型，不在标注文件中附带自由文本或敏感信息。

## 7. 一致性与抽检

- 首批 20 组样本全部双人复核；后续每批至少抽检 20%，且每种菜品、机位配置和异常场景至少抽检一组。
- 边界差异不超过 500 ms 可由复核员直接统一；事件类型、可用性或最佳机位分歧必须重新观看全部机位。
- 修改事件定义、标签集合或边界规则时升级 schema 版本，不原地改变既有黄金结论。
- 每次模型、规则、Prompt 或模板升级前固定同一版本黄金集运行回归。

## 8. 校验与目录建议

```text
golden-set/
├── dataset.json
└── samples/
    ├── sample-001.annotation.json
    └── sample-002.annotation.json
```

提交前执行：

```powershell
loong cooking-video validate-gold `
  --annotation-file golden-set/samples/sample-001.annotation.json `
  --job cook-001
```

通过条件包括：结构合法、ID 唯一、引用存在、时间不越界、不可用原因一致、可用镜头不与排除区间重叠，以及已复核必标事件具有唯一最佳镜头。

## 9. 后续评测口径

- 事件召回：同类型预测与黄金事件交并比达到 0.5，或双方中心点差不超过 500 ms 时记为命中；同一预测只能匹配一个黄金事件。
- 候选可用率：自动选中片段与任一黄金可用候选重叠达到 0.5，且不触碰排除区间。
- Top-1：自动首选候选与 `primaryCandidateId` 的机位一致。
- Top-2：自动前两名包含主镜头或任一备选镜头。
- 人工换机位率：人工保存时发生机位变化的可比较片段数除以可比较片段总数。

真实阈值将在客户样本、目标平台和硬件确定后冻结。
