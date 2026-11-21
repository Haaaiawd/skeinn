# Evil Eval v2 — 三层高性价比评测体系

Evil Eval 只回答一个冷酷的问题：**Skeinn 到底有没有在真实项目里显著提升 Agent 的交付质量，还是只是多写了一堆看起来很严谨的文档？**

为了既保证科学对照、又能以 **单次 ~¥20 人民币（适配 DeepSeek 4.1 Flash 等高性价比快模型）** 的成本高频跑起来，Evil Eval 按成本和用途拆成三层：

| 层级 | 命令模式 | 单次参考预算 | 适用时机 | 判定机制 |
| :--- | :--- | :--- | :--- | :--- |
| **L1：微探针（Micro-Probe）** | `mode: "probe"` | **¥2–¥5** | 每次改 `protocol.js` / `store.js` 后 | 5 项硬断言 Pass/Fail（防偷懒、禁伪调研、设计对撞、CLI 零摩擦、冷启动首步） |
| **L2：三棒盲接力赛（Relay Eval，主力推荐）** | `mode: "relay"` | **¥15–¥20** | 每个小版本 / 核心改动验收 | **3 棒零记忆接力 + 中途需求反转 + 隐藏自动化断言（Hidden Oracle）+ 三选一盲评 + 真实遥测** |
| **L3：完整发布评测（Full Eval）** | `mode: "full"` | **¥50–¥60** | 大版本发布前 / 消融实验 | 3 次重复 + 全量盲评 + 消融对照 |

---

## 核心对照组（绝不削弱基线）

每个场景同时跑两条臂（Arm）：
- **Baseline**：同等模型、工具、工作区、用户回答与预算，**无 Skeinn**（允许其自由规划、写文档、用自身记忆）。
- **Skeinn**：完全相同的模型与条件，仅允许后台静默使用 `skeinn` CLI。

---

## 主力推荐：~¥20 人民币的 L2 三棒盲接力赛（`mode: "relay"`）

单轮原型任务很难拉开裸 Agent 与框架的差距。Skeinn 真正的护城河在**跨多次失忆接棒、中途推翻决策与专业域避坑**。一轮完整 L2 Relay 恰好把预算花在刀刃上：

1. **第 1 棒（塑形 + 纵向切片 1）**：两条臂分别拿到同一份原始需求，完成初步设计与第一个可运行切片。
2. **第 2 棒（清空上下文 + 中途方向反转）**：强制开启**零聊天记忆的新 Agent**，只读磁盘恢复项目，并注入一条实质性的中途需求变更（`pivot`），要求不破坏第 1 棒已成立的不变量。
3. **第 3 棒（清空上下文 + 边界加固与收口）**：再次开启**零记忆新 Agent**（可选降级为更轻模型测试交接韧性），补齐边界条件、运行验证并诚实报告盲点。

### ¥20 预算怎么分配（以 Flash 级快模型为例）
- **Baseline 3 棒**：约 ¥4–¥6
- **Skeinn 3 棒（含 1–2 个瓶颈 Capability 与 1 次独立 Keeper）**：约 ¥8–¥10
- **Hidden Oracle 自动化验收（`hidden-oracle.mjs`）**：**¥0**（纯本地 Node 脚本，客观零偏见）
- **双顺序盲评裁判（X→Y 与 Y→X 各一次）**：约 ¥2–¥3
- **合计**：稳定控制在 **¥15–¥20 / 次**，既不因省钱缩水到没参考意义，也不会重到跑不动。

---

## 为什么废除 1–5 分制，改用“隐藏断言 + 三选一盲评 + 真实遥测”？

1. **隐藏断言脚本（`hidden-oracle.mjs`）**：Agent 施工期间完全不可见，收尾后直接跑客观检查（文件/契约存在性、零外链扫描、重启恢复、回归破损率），彻底消灭“嘴上说完成了”。
2. **强制三选一盲评（Pairwise Forced-Choice）**：废除容易打出 4 vs 5 贴脸分的 1–5 分制。裁判对 6 个维度只输出 **`X_CLEAR_WIN` / `TIE` / `Y_CLEAR_WIN`**，并强制交换顺序（X→Y 与 Y→X）复评，凡是翻转的结论一律标 **`UNSTABLE`**。
3. **真实遥测落盘（`telemetry-template.json`）**：强制记录每条臂的真实 `input_tokens`、`output_tokens`、`cost_cny`、`wall_seconds`、`tool_calls`、`cli_retries` 与 `hidden_oracle_passed`，直接计算**每元人民币换来的净质量提升**。

---

## 快速生成一个评测脚手架

准备 `scenario.json`：

```json
{
  "id": "RELAY-001",
  "title": "本地离线复盘工具三棒接力",
  "mode": "relay",
  "budget_cny": 20,
  "brief": "做一个单文件本地离线的会议后 3 分钟复盘工具，刷新保留草稿，支持一键清空。",
  "pivot": "第 2 棒中途新增：用户要求支持本地加密 JSON 导出与导入，但仍必须 100% 离线零外链。",
  "hidden_checks": [
    "静态扫描零外部 HTTP/CDN/字体请求",
    "刷新后草稿完整恢复，一键清空后存储归零",
    "加密导出再导入后数据无损且错误密码被诚实拒绝"
  ],
  "human_channel": "unavailable",
  "success_criteria": ["三棒零记忆接力后全部隐藏断言通过且无回归破损"]
}
```

运行：

```bash
skeinn eval scaffold --json-file scenario.json
```

Skeinn 会在 `.skeinn/eval/<scenario>/` 下自动生成：
- `manifest.json`（控制变量与预算上限）
- `batons/baseline-baton-{1,2,3}.md` 与 `batons/skeinn-baton-{1,2,3}.md`（可直接喂给各棒新会话的提示词）
- `hidden-oracle.mjs`（填入你的客观断言脚本）
- `telemetry-template.json`（成本与重试遥测模板）
- `judge-prompt.md`（双顺序三选一盲评裁判提示词）
- 若 `mode: "probe"`，额外生成 `probe-checklist.md`（5 项 L1 防偷懒硬检查清单）。

> 无人值守运行 Skeinn 臂时，请配合 `--state-dir <工作区外目录>` 与 `--human-channel unavailable`，确保 `.skeinn/` 状态不污染被评测工作区。
