<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/skeinn-wordmark-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/skeinn-wordmark-light.svg">
  <img alt="Skeinn" src="docs/brand/skeinn-wordmark-light.svg" height="64">
</picture>

<p><strong>Remember the whole. Build like a practitioner.</strong></p>
<p>Invisible continuity, firsthand practitioner judgment, and proof infrastructure for AI coding agents.</p>

<p>
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a> ·
  <a href="design.md">System Design</a> ·
  <a href="EVIL_EVAL.md">Evil Eval</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-17212B?style=flat-square" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/for-AI%20Coding%20Agents-3B63F6?style=flat-square" alt="For AI Coding Agents">
  <img src="https://img.shields.io/badge/languages-Multilingual-17212B?style=flat-square" alt="Multilingual">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-9AD8C2?style=flat-square&amp;labelColor=17212B" alt="MIT License"></a>
</p>

</div>

---

## Why Skeinn?

AI coding feels effortless on small scripts, yet multi-day, multi-module projects under unstructured Vibe Coding reliably hit four walls:

| Failure mode | Unstructured Vibe Coding | Agent backed by Skeinn |
| :--- | :--- | :--- |
| **Context amnesia** | Compaction or a new session wipes out architecture, boundaries, and earlier corrections | Project truth, decisions, progress, and proof live on disk; a fresh Agent resumes directly |
| **Generic average output** | Models default to safe statistical averages that look templated and amateur | Targets 1–3 bottleneck domains, **researches how real practitioners operate**, and reflects on project constraints |
| **First-draft lock-in** | Codes the first plausible idea immediately, hiding expensive rework | Core designs force **at least 2 genuinely viable alternatives** (including a simpler or unconventional angle) |
| **False-green completion** | Claims "done" while missing files, skipping edge cases, or breaking upstream work | A **fresh independent Keeper** gates launch on the active horizon — minors pass as advisories pinned to their Task/doc and surface at `task start` — while per-artifact digests drive delta re-checks and in-flight drift checkpoints; every Task closes with reproducible evidence |

> **Core rule: Skeinn is for the Agent, not the human.**  
> Multilingual by default — talk naturally in English, Chinese, Japanese, or any language you prefer. The Agent operates the `skeinn` CLI silently in the background.

---

## How a real project flows

```text
You (natural chat in any language)          Agent (silent skeinn CLI on disk)
─────────────────────────────────────────────────────────────────────────
1. Share an early idea                      Inspect workspace → ask one dense
   "Build an offline reflection tool..."    batch of consequential questions

2. Settle key tradeoffs                     Anchor PROJECT.md → iterate core
                                            Design docs & 1–3 bottleneck
                                            Capabilities (practitioner research
                                            → reflection → Design delta)

3. Confirm the whole                        Freeze digest → fresh zero-memory
                                            Keeper gates launch on the active
                                            horizon; minors pin to scope

4. See working slices, steer anytime        Execute one restartable Task at a
                                            time with guardrails & exact proof;
                                            drift checkpoints & stale-work flags
```

---

## What real Skeinn artifacts look like

Example: building a **3-minute offline post-meeting reflection tool**.

### 1. Bottleneck capability (`.skeinn/capabilities/reflective-ux.md`)

```markdown
# Reflective UX Design
- Mode: external_researched
- Authority: human_confirmed

## How real practitioners operate
- Progressive disclosure with low-cognitive-load single-column flows — Source: https://linear.app/method
- Local-first tools surface storage boundaries and instant deletion upfront — Source: https://localfirstweb.dev/

## Reflection for this project
- What to refuse: streaks, mood scores, and timers create assessment anxiety right after a tense meeting.
- Non-obvious craft move: mirror the user's own phrasing and let them pick one small next step instead of AI lecturing.

## Operational rules and Design delta
- Anti-patterns: countdown timers, emotion ratings, silent network requests
- Design delta (Before -> After): Replaced 3-pane dashboard with a skippable 4-step single-column flow + upfront clear control.
```

### 2. Decision-collision design (`.skeinn/design/first-use-flow.md`)

```markdown
## Alternatives considered
- Option A (chosen): Single self-contained HTML file + localStorage (zero install, instant open, provably offline).
- Option B (rejected): Vite + local SQLite server. More extensible, but breaks zero-friction 3-minute use.

## How this could look done yet fail
- Tests pass, yet a remote Google Font leaks network traffic or page reload silently drops an in-progress draft.
```

### 3. Restartable Task with guardrails (`.skeinn/tasks.json`)

```json
{
  "id": "TASK-001",
  "title": "Build offline reflection flow and instant local wipe",
  "implements": ".skeinn/design/first-use-flow.md#Alternatives considered",
  "guardrails": [
    "Zero external network requests, remote fonts, or analytics scripts",
    "No emotion scoring, timers, or mandatory completion locks"
  ],
  "acceptance": [
    {
      "criterion": "Static scan finds zero external URLs; reload restores draft; clear wipes storage",
      "verify_by": "Run node tests/verify.mjs and verify reload/clear in browser",
      "evidence": "verify.mjs: 0 external URLs; reload restored draft; clear wiped localStorage"
    }
  ]
}
```

---

## Quick start

```bash
npm install --global @haaaiawd/skeinn
```

Open your coding Agent (Claude Code, Cursor, Windsurf, Codex, etc.) in your project directory and say:

> "This project uses Skeinn for continuity and design quality. Run `skeinn init` and `skeinn context --full` to load the protocol; talk to me naturally and maintain state silently in the background."

<details>
<summary><strong>Agent CLI quick reference (for Agents, not humans)</strong></summary>

```bash
skeinn init
skeinn context --full                         # first entry or after context reset
skeinn context                                # lean resume between Tasks
skeinn record --json-file understanding.json
skeinn design add core --title "Core system" --kind system
skeinn capability add ui-ux --title "UI/UX design" --mode external_researched
skeinn capability confirm ui-ux --scenario "<project scenario>" --source human
skeinn capability exempt --reason "<why standard engineering suffices>"
skeinn deliverable add cli-core --title "CLI core" --kind module
skeinn task plan --json-file work-map.json
skeinn project ready
skeinn keeper record --json-file keeper-result.json
skeinn keeper resolve FND-001 --evidence "<closure proof>"   # close a pinned finding
skeinn keeper checkpoint prompt --milestone M1               # in-flight drift audit
skeinn keeper checkpoint record --json-file checkpoint-result.json
skeinn context --checkpoint                                  # checkpoint-scoped slice
# kind: "spike" tasks may start during shaping for empirical unknowns
skeinn task next && skeinn task start TASK-001
skeinn task done TASK-001 --json-file evidence.json
skeinn check
```

</details>

---

## Verify it actually helps

Run `npm test` (38 end-to-end contract tests), or use `skeinn eval scaffold` to run controlled **Evil Eval** comparisons (equal model, tools, workspace, user facts, forced resets, and blind order-swapped judging). See [EVIL_EVAL.md](EVIL_EVAL.md).

### A real measured run

We ran the full L2 relay on **DeepSeek-V4.1-Flash** — a cheap model where framework gains should be most visible. Same harness (opencode), same workspace rules, same brief: build the single-file offline 3-minute retro tool above, across **3 batons with hard memory resets**, with a mid-project pivot to encrypted export/import. Then a hidden oracle, and two independent blind judges scoring sealed X/Y packets in swapped order.

```text
Hidden oracle (8 objective checks)   baseline 8/8   skeinn 8/8   ← parity

Total cost              baseline  ¥0.42 █████      skeinn  ¥0.82 ██████████
Wall time               baseline   35 m █████      skeinn   60 m █████████
Tokens (in+out+reason)  baseline  330 k ████       skeinn  741 k █████████
Tests shipped           baseline   43   ██████████ skeinn    44  ██████████
                        (pytest + Playwright)      (zero-dep `node --test`,
                                                   real headless Chrome)
```

| Dimension (forced choice) | Judge pass 1 | Judge pass 2 |
| :--- | :--- | :--- |
| Intent fidelity & pivot survival | **Skeinn** | Tie |
| Specialist capability & craft | **Skeinn** | **Skeinn** |
| Cold-handoff continuity | Tie | Tie |
| Oracle & proof honesty | Tie | Tie |
| User burden & ceremony | **Skeinn** | **Skeinn** |
| Net value per RMB | **Baseline** | **Baseline** |
| **Overall** | **Skeinn** | **Skeinn** |

*Caveats we keep honest: single run, single scenario, n=2 judges. The evidence judges cited, baseline's cost-efficiency win, and one packet-metadata leak we found and fixed-forward are in the full log: [docs/eval/RELAY-001.md](docs/eval/RELAY-001.md).*
