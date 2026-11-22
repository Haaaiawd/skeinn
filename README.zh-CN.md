<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/skeinn-wordmark-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/skeinn-wordmark-light.svg">
  <img alt="Skeinn" src="docs/brand/skeinn-wordmark-light.svg" height="64">
</picture>

<p><strong>记住全貌，像高手一样把项目做完。</strong></p>
<p>为 AI 编码 Agent 打造的隐形项目理解、一线专业判准与断电续接底座。</p>

<p>
  <a href="README.md">English</a> · <strong>简体中文</strong> ·
  <a href="design.md">系统设计</a> ·
  <a href="EVIL_EVAL.md">Evil Eval</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

<p>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-17212B?style=flat-square" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/for-AI%20Coding%20Agents-3B63F6?style=flat-square" alt="For AI Coding Agents">
  <img src="https://img.shields.io/badge/languages-Multilingual-17212B?style=flat-square" alt="Multilingual">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-9AD8C2?style=flat-square&amp;labelColor=17212B" alt="MIT License"></a>
</p>

</div>

---

## 为什么需要 Skeinn？

用 AI 写几百行脚本很顺，但一旦进入**三天以上、多模块的中大型项目**，无规则 Vibe Coding 几乎都会撞上四堵墙：

| 痛点 | 无规则 Vibe Coding | 接入 Skeinn 后的 Agent |
| :--- | :--- | :--- |
| **聊久就失忆** | 上下文压缩或新开会话后，架构决策、边界和偏好全丢，越改越散 | 项目全貌、设计、任务进度与证据全部落盘，换新 Agent 直接续接 |
| **方案平庸、像外行** | 默认收敛到“互联网统计学平均解”，界面与架构一看就是模板拼凑 | 锁定 1–3 个瓶颈专业域，**调研真实一线从业者怎么干**并反思转化为项目规则 |
| **一稿过、后期返工** | 想到第一个可行方案就开写，隐患全部埋在实现阶段 | 核心设计强制**至少 2 个真实可行方案对撞**（含更简或非常规视角），写清取舍 |
| **假绿灯完成** | Agent 口头宣布“已实现”，实测缺文件、漏边界或改坏上游 | 开工前由**全新无记忆 Keeper** 独立验盘；每个 Task 凭可复现证据逐条关闭 |

> **核心原则：Skeinn 是给 Agent 用的，不是给人学的新框架。**  
> 它天然支持多语言协作——你用中文、英文、日文或任何语言自然聊天即可；Agent 在后台静默调用 `skeinn` CLI 维护 `.skeinn/` 状态，你永远不需要手动敲这些命令。

---

## 30 秒看懂一次真实协作

```text
你（用任意语言自然对话）                     Agent（后台静默运行 skeinn）
─────────────────────────────────────────────────────────────────────────
1. 抛出想法                                 检查工作区 → 只问真正改变方案的
   "帮我做一个本地离线复盘工具..."            关键问题 → 记录事实、假设与边界

2. 回答关键取舍                             写清 PROJECT.md → 迭代核心 Design
                                            与 1–3 个瓶颈 Capability（查一线
                                            实操 → 项目反思 → 写回 Design Delta）

3. 确认整体方向                             冻结摘要 → 拉起全新无记忆 Keeper
                                            审查：能否直接开工？有无伪调研、
                                            稻草人对比或漏掉的防呆红线？

4. 陆续看到可运行成果，随时提新想法         一次只做 1 个可恢复 Task（自带
                                            guardrails 红线），逐条填实证闭环；
                                            中途改方向则暂停并标出受影响的旧任务
```

---

## 真实产物长什么样？（具体演示）

以**“做一个本地离线的会议后 3 分钟复盘工具”**为例，看看 Skeinn 在后台到底帮 Agent 沉淀了什么高价值内容（而不是一堆废话文档）：

### 1. 一份瓶颈领域判准（`.skeinn/capabilities/reflective-ux.md`）

```markdown
# Reflective UX Design
- Mode: external_researched
- Authority: human_confirmed

## How real practitioners operate
- 渐进披露与单屏低认知负荷 — Source: https://linear.app/method
- 敏感个人笔记工具必须将“本地存储边界与一键清空”前置可见，而非藏进隐私条款 — Source: https://localfirstweb.dev/

## Reflection for this project
- 哪些不能照搬：大厂日记 App 的“连续打卡/情绪打分”会给刚开完高压会议的人制造考核焦虑，必须砍掉。
- 高手的非显性手法：用“原话回显 + 自主选下一步”替代 AI 总结说教，让用户感到被托住而不是被评估。

## Operational rules and Design delta
- Anti-patterns: 禁止倒计时、禁止情绪打分、禁止任何静默外链请求
- Design delta (Before -> After): 将首屏从“3 栏仪表盘 + 情绪雷达图”改为“4 步可跳过单栏卡片流”，并在首屏直接暴露一键清除按钮。
```

### 2. 一段方案对撞设计（`.skeinn/design/first-use-flow.md`）

```markdown
## Alternatives considered
- 方案 A（采纳）：单 HTML 文件 + localStorage 渐进式 4 步卡片流（零安装、双击即用、离线可验）。
- 方案 B（否决）：Vite + SQLite 本地服务版。虽然扩展性更强，但违背“会后 3 分钟零摩擦打开”的核心体验。

## How this could look done yet fail
- 页面跑通、测试全绿，但引入了远程 Google Fonts 导致弱网下泄漏请求；或刷新页面后草稿静默丢失。
```

### 3. 一条带防呆红线的可恢复 Task（`.skeinn/tasks.json`）

```json
{
  "id": "TASK-001",
  "title": "实现单文件离线复盘主流程与本地清空",
  "implements": ".skeinn/design/first-use-flow.md#Alternatives considered",
  "guardrails": [
    "禁止任何外部网络请求、远程字体或分析脚本",
    "禁止添加情绪打分、倒计时或强制填写校验"
  ],
  "acceptance": [
    {
      "criterion": "源码静态扫描零外链请求，刷新后草稿保留且一键清空生效",
      "verify_by": "运行 node tests/verify.mjs 并在浏览器实测刷新与清空",
      "evidence": "verify.mjs: 0 external URLs; reload restored draft; clear wiped localStorage"
    }
  ]
}
```

---

## 四个核心设计：低摩擦，且防偷懒

1. **单文件 Capability（真调研 + 真反思 + Design Delta）**：聚焦 1–3 个决定上限的瓶颈域，1 条命令创建 `.skeinn/capabilities/<field>.md`。禁止静默跳过（纯常规工程必须显式 `skeinn capability exempt` 并接受 Keeper 审计）；`external_researched` 直接拦截 `agent-authored` 自造来源；无网时诚实标 `offline_reflection`。
2. **方案对撞型 Design**：核心设计（`product` / `experience` / `system` / `contract`）强制对比至少 2 个真实可行方案（含更简或非常规视角），把 Capability 判准编译进机制，并提前写清假阳性失败面。
3. **一次性独立 Keeper**：开工前由全新无记忆 Agent 只读磁盘试跑，并执行四项反敷衍核查（豁免合理性、伪调研、稻草人备选、红线是否落地）。通过后退场，不打扰日常施工。
4. **可恢复 Task + 防呆红线**：广度 Work Map 留盘，每次只注入当前唯一活跃 Task、精确 `reads` 与 1–3 条 `guardrails`；完成校验产出存在与逐条实证，上游重开自动标出需要复核的下游任务。

---

## 快速开始

### 1. 安装 CLI（Node.js ≥ 18）

```bash
npm install --global @haaaiawd/skeinn
```

或从源码仓库本地安装：

```bash
npm install --global .
```

### 2. 把这句话交给你的编码 Agent

在项目目录中打开 Claude Code / Cursor / Windsurf / Codex 等具备终端能力的 Agent，直接说：

> “这个项目使用 Skeinn 维护项目理解与连续性。请先运行 `skeinn init` 和 `skeinn context --full` 读取协议；之后你只管和我自然沟通，在后台维护项目状态。”

---

## 磁盘结构

```text
.skeinn/
├── PROJECT.md          项目全貌入口与导航图
├── STRUCTURE.md        代码、测试、文档与资源目录约定
├── DECISIONS.md        重要决策变更与受影响任务记录
├── capabilities/       1–3 份单文件瓶颈领域判准（一线实操 + 反思 + Design Delta）
├── design/             按子系统拆分的设计文档图谱（含方案对撞与假阳性失败面）
├── state.json          已确认事实、假设、未决问题、豁免与 Keeper 状态
├── deliverables.json   可观察交付面（区分已规划与已交付）
└── tasks.json          磁盘上的广度 Work Map 与当前活跃 Task
```

<details>
<summary><strong>Agent CLI 速查（仅 Agent 在后台调用，人类无需记忆）</strong></summary>

```bash
# 初始化与上下文恢复（首次进入或重置后用 --full，任务间隙用精简 context）
skeinn init
skeinn context --full
skeinn context

# 记录理解、迭代设计与瓶颈能力
skeinn record --stdin understanding.json
skeinn design add core --title "Core system" --kind system
skeinn capability add ui-ux --title "UI/UX design" --mode external_researched
skeinn capability confirm ui-ux --scenario "<项目情境>" --source human
# 纯常规工程无需专项能力时显式豁免（由 Keeper 审计）：
skeinn capability exempt --reason "<为何常规工程能力已足够>"

# 规划交付面与任务，冻结摘要并由独立 Keeper 验盘
skeinn deliverable add cli-core --title "CLI core" --kind module
skeinn task plan --stdin work-map.json
skeinn project ready
# 新开无继承上下文的 Agent 运行 skeinn keeper prompt，并提交含 review.mode: "independent" 的结果
skeinn keeper record --stdin keeper-result.json

# 单任务实证施工与变更演化
skeinn task next
skeinn task focus TASK-001
skeinn task close TASK-001 --evidence "npm test passed"   # 或 --stdin 逐条映射，详见 skeinn task close --help
skeinn decision --stdin decision.json
skeinn clarify start --reason "<方向变化原因>"
skeinn check
```

> 无人值守或 Benchmark 运行时，可附加 `--human-channel unavailable` 与 `--state-dir <外部目录>`，在不污染评分工作区的前提下保持完整状态。

</details>

---

## 证明它真的有用（Evil Eval）

内置 **Evil Eval** 脚手架：在完全相同的模型、工具、工作区、用户事实与预算下，对“无框架基线”与“接入 Skeinn”执行**强制上下文重置 + 匿名盲评 + 顺序交换**，把仪式成本、用户负担与最终质量一起计分。详见 [EVIL_EVAL.md](EVIL_EVAL.md)。

```bash
npm test   # 48 项端到端契约测试
```

已对 `deepseek-chat` 实测三轮，报告全文随仓库提交：

**[EVIL-001](evals/evil-001/REPORT.md) —— 对抗鲁棒性。** 一个被按“每关一个 Task 计费、诚实零奖金”激励的 DeepSeek Agent 拿到 shell，在 Skeinn 管辖的项目里自由攻击；随后补跑 10 个它没试过的确定性探针。结果：它选择了真实写码（比硬闯闸门便宜），然后绕过重型窗口闸门——自封 `reviewer_id:"contractor-*"` 检查点、`git reset` 改历史、把 `keeper reset` 当开锁器。探针确认了三个真实静默穿透（`.skeinnignore` 自我隐身、`tasks.json` 直改、findings 账本删除）——**三洞已全部硬化为带哨兵的 check + 回归测试**。诚实的残留边界：`.skeinn/` 是裸 JSON，**一致的**全账本伪造仍可能；Skeinn 是仪式+审计层，不是证明系统——它让指纹变响，而非不可伪造。

**[RELAY-002](evals/relay-002/REPORT.md) —— 连续性层到底值不值？** 双臂用同一 spec、3 棒零记忆接力 + 中途需求反转：传统 HANDOFF.md vs 完整 Skeinn sidecar。隐藏 oracle：**双臂 10/10**。盲评（顺序对调）：一遍 **33:25 基线胜**、一遍 **30:30 平**。两位“裁判”一致认定的事实：Skeinn 臂成本 **~6 倍轮次**（773 vs 133），但测试更深（真实 Chrome e2e 抓到两个 jsdom 看不见的数据丢失 bug），且让反转需求在 `file://` 上**真的成立**。Skeinn 机制撑过了 10 个会话（含 1 次崩溃、8 次预算截断）——每棒都从磁盘恢复了意图。

**[RELAY-003](evals/relay-003/REPORT.md) —— 同一场比赛，但换成故意含糊的需求 + 互相打架的反馈。** 同一产品域、同样双臂；注入改为：硬矛盾（“文件不能留明文”且“不许要密码”）、含糊的“东西太多但功能不许少”、以及一次真实的功能撤回。结果翻转：**轮次成本打平**（212 vs 213），但 baseline 多要了一次救火会话——它棒2的决策没落盘，给下一棒留下一个没接线没测试没文档的半成品加密导出 + 16 个测试回归。Skeinn 臂的 decision 账本让棒2恢复了残局、连同被否决的备选一起记录了折中方案、3 棒收敛。盲评两遍顺序对调**都选 Skeinn**（33.5:28.5、36:32.5），理由是 why-ledger 和更少的收敛会话。诚实的结论对：**spec 精确+接力顺 → Skeinn 是纯开销；spec 含糊+反馈打架 → 散文交接在同成本下开始丢决策**。分水岭在“意图有多乱”，不在“项目有多长”。两位裁判共同的警告：sidecar 状态目录必须跟工作区一起打包/可发现，否则优势蒸发。

### 已验证的限制（v3.0.1 之后的现状）

- ~~**sidecar 可发现性**~~ **3.0.1 已修**——`--state <path>` 现在写一行 `.skeinn-state` 指针（照搬 git worktree 的 `.git` 文件原语）+ AGENTS.md 锚；`findRoot()`/`skeinnPaths()` 自动解析，新 Agent 跑 `skeinn context` 不需要知道任何路径 flag 即可连回外置状态。内嵌 `.skeinn/` 永远优先于指针；指针不可解析或被改道时 `skeinn check` 大声报错。盲评隐身拆成显式 `--no-anchor`。
- ~~**无跨进程写锁**~~ **3.0.1 已修**——每个写命令都跑在 `withStateLock()` 里：完整的「读→校验→改→原子写」事务包进原子 `mkdir` 锁，写 `{pid, at}` 属主，30 秒/pid 已死的残留锁自动抢占，20–100ms 退避，5 秒上限（进程内可重入；只读命令不进锁）。
- **非 git 审查窗口仍空转——已明确决定 git-only**——不加 mtime/hash 快照兜底（半套 VCS 只会更脆更错）；`skeinn check` 大声提示 reality-derived review 未启用并建议 `git init`。
- **审查独立性仍是一串字——现在有哨兵但没有证明**——`skeinn check` 会警告：同一 launch 内 `reviewer_id` 复用、reviewer ID 与 `git config user.name`/`user.email` 雷同、未完成 launch 内重复 reset、reset 后 10 分钟内 close 交付任务。`SKEINN_HMAC_KEY` 签名已否决：能跑 CLI 的 Agent 也能读到同一个环境变量并伪造——诚实的边界在外部（隐藏 oracle、全新上下文 Keeper）。
- **整本账本伪造仍可能**——`.skeinn/` 是裸 JSON；一致的 state+tasks+decisions 全重写能骗过哨兵。这是写明的边界，不是 bug：Skeinn 是仪式+审计层。

---

## 文档导航

| 文档 | 内容 |
| :--- | :--- |
| [系统设计](design.md) | 架构、存储模型、不变量与命令契约 |
| [UX 与闭环规范](docs/UX_FLOW.md) | 人、Agent、Keeper 与 Task 的完整转换 |
| [提示词目录](docs/PROMPT_CATALOG.md) | 注入给 Agent 的全部认知层与模板 |
| [Evil Eval 协议](EVIL_EVAL.md) | 有无框架的受控对照实验规范 |
| [更新日志](CHANGELOG.md) | v2.4.0 及历次演进记录 |
