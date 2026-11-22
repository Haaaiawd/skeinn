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
| **False-green completion** | Claims "done" while missing files, skipping edge cases, or breaking upstream work | A **fresh independent Keeper** audits build-readiness once; every Task closes with reproducible evidence |

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
                                            Keeper audits startability, fake
                                            research, strawmen, and guardrails

4. See working slices, steer anytime        Execute one restartable Task at a
                                            time with guardrails & exact proof;
                                            direction shifts flag stale work
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
skeinn record --stdin understanding.json
skeinn design add core --title "Core system" --kind system
skeinn capability add ui-ux --title "UI/UX design" --mode external_researched
skeinn capability confirm ui-ux --scenario "<project scenario>" --source human
skeinn capability exempt --reason "<why standard engineering suffices>"
skeinn deliverable add cli-core --title "CLI core" --kind module
skeinn task plan --stdin work-map.json
skeinn project ready
skeinn keeper record --stdin keeper-result.json
skeinn task next && skeinn task focus TASK-001
skeinn task close TASK-001 --evidence "npm test passed"
skeinn check
```

</details>

---

## Verify it actually helps

Run `npm test` (48 end-to-end contract tests), or use `skeinn eval scaffold` to run controlled **Evil Eval** comparisons (equal model, tools, workspace, user facts, forced resets, and blind order-swapped judging). See [EVIL_EVAL.md](EVIL_EVAL.md).

Three evals have been run end-to-end against `deepseek-chat`, with full reports committed:

**[EVIL-001](evals/evil-001/REPORT.md) — adversarial robustness.** A live DeepSeek agent, incentivized to maximize closed Tasks per dollar with zero honesty bonus, was given shell access inside a Skeinn-governed project, followed by 10 deterministic attacks it didn't try. Result: it built real code (cheaper than fighting the gates), then routed *around* the heavy-window gate through self-certified ceremony — fabricated `reviewer_id:"contractor-*"` checkpoint identities, `git reset` history surgery, and `keeper reset` as a lockpick. Probes confirmed three real silent penetrations (`.skeinnignore` self-hiding, direct `tasks.json` forgery, findings-ledger deletion) — **all three are now hardened with loud `check` sentinels + regression tests**. Honest residual: `.skeinn/` is plain JSON; a *consistent* full-ledger forge remains possible. Skeinn is a ceremony + audit layer, not a proof system — it makes fingerprints loud, not impossible.

**[RELAY-002](evals/relay-002/REPORT.md) — does the continuity layer pay for itself?** Two arms built the same product over 3 zero-memory batons with a mid-flight pivot: conventional HANDOFF.md vs full Skeinn sidecar state. Hidden oracle: **10/10 both arms**. Blind judging (order-swapped): **33:25 baseline** on one pass, **30:30 tie** on the other. Facts both judges agreed on: the Skeinn arm cost **~6× the turns** (773 vs 133) but shipped deeper verification (real-Chrome e2e that caught two data-loss bugs invisible to the baseline's jsdom tests) and made the pivot *actually work* on `file://`. Skeinn's machinery survived 10 sessions incl. a crash and 8 budget-cap amputations — every baton recovered intent from disk.

**[RELAY-003](evals/relay-003/REPORT.md) — the same race, but with a deliberately vague brief and contradictory feedback.** Same product domain, same arms; injections were a hard contradiction ("no plaintext AND no password"), a vague declutter complaint with a no-features-cut fence, and a real feature retraction. Result flipped: **equal turn cost** (212 vs 213), but baseline needed a **4th rescue session** — its baton-2 decision never hit disk, leaving an unwired half-built export + 16 test regressions for the next agent to reverse-engineer. The Skeinn arm's decision ledger let baton 2 recover the mess, record the resolution with rejected alternatives, and converge in 3 sessions. Blind judge picked Skeinn **on both order-swapped passes** (33.5:28.5, 36:32.5), citing the why-ledger and fewer sessions-to-green. Honest takeaway pair: **crisp spec + clean relay → Skeinn is overhead; vague spec + contradictory feedback → prose handoffs start losing decisions at exactly the same cost.** The crossover is in intent messiness, not project length. Caveat flagged by both judges: the sidecar state dir must be packaged with the workspace or the advantage evaporates.

### Known limitations (verified, fix list in progress)

- **Sidecar discoverability** — in `--state-dir` mode nothing inside the workspace points at the state dir (verified: `installAgentAnchor` only runs for in-repo `.skeinn`). A next agent who doesn't know the flag loses the whole state layer. *Fix planned: workspace pointer file + `check` sentinel.*
- **No cross-process write lock** — `state.json`/`tasks.json` writes are atomic (tmp+rename) but not serialized; two parallel lanes closing tasks simultaneously can lose an update. *Fix planned: mkdir-based lock with stale detection.*
- **Non-git review window is inert** — `analyzeReviewWindow` returns `files:[]` outside git, so the heavy gate effectively never fires on non-git projects (honestly reported as `anchor_status:"non_git"`). *Fix planned: mtime+hash snapshot fallback, or explicitly document git-only.*
- **Reviewer independence is a string** — `reviewer_id` only checks length ≥6; self-attestation is allowed and unlimited reuse is not warned about. *Fix planned: reuse/self-match heuristics + optional `SKEINN_HMAC_KEY` signing.*
- **Full-ledger forge remains possible** — `.skeinn/` is plain JSON; a consistent rewrite of state+tasks+decisions defeats sentinels. Documented boundary, not a bug: Skeinn is a ceremony + audit layer.
