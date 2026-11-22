# Changelog

## 3.0.0 — Intent-Only, Reality-Derived Continuity

### Structural Architecture Upgrades
- **Read-Only Git Sensing Gateway (`cli/src/git.js`)**: All VCS queries flow through a single whitelisted read-only `gitIn(repoRoot, args)` helper. Skeinn never mutates Git or auto-commits.
- **Worktree & State Decoupling**: Linked `git worktree`s automatically detect and share the main worktree's `.skeinn/` via `--git-common-dir` while computing Git diffs in their own worktree. Explicit override via `--state <path>` or `SKEINN_STATE`.
- **Dual-Window Separation (Anti-Gaming)**:
  - **Review Window** is permanently anchored at `last_reviewed_commit` + `last_reviewed_worktree` SHA-256 digest map (seeded only on Launch pass/skip and `clean` Checkpoints). Task splitting, `focus`, and `close` never reset it.
  - **Attribution Window** is anchored at `task.focused_at_commit` solely to derive per-task `actual_touches`.
- **Per-Lane Active Invariant**: Tasks carry a `lane` field (derived from worktree branch/directory or `--lane`), allowing parallel worktrees to each focus one active Task simultaneously without colliding.
- **Exact Heavy Gate Predicate**: `skeinn task close` refuses iff `windowHeavy && !cleanCheckpointSinceAnchor && !coveringDecisionSinceAnchor`, where heavy is triggered by >= 8 files, >= 400 lines, >= 3 top-level directories, shared-surface hit (seeded from task history + 100-commit git churn), modified horizon design doc, or lost review anchor (`anchor_status: "lost"`).
- **Horizon-Scoped `prepared_scope` Map**: `skeinn project ready` freezes a per-artifact digest map scoped strictly to `activeHorizon`; out-of-horizon edits on parallel lanes never invalidate an in-flight Keeper run.
- **Orthogonal 3-Sentinel `skeinn check`**: Detects silent drift (>= 5 closed delivery tasks since last clean review), heavy/lost-anchor physical windows, stale active tasks with worktree drift, `locks` violations, and outdated `AGENTS.md` v2 anchors.
- **Structural Guardrail**: Delivery tasks cannot `depends_on` exploratory `spike` tasks.
- **Freeform finding scopes**: Finding `scope` fields tolerate real reviewer output — `task:` digest-key prefixes, bare Task ids, and compound `" / "` / comma-joined scopes are canonicalized at write and matched per-part at `task focus`/`close` gating and horizon checks.

### Adversarial Hardening (EVIL-001)

Field-tested against a live `deepseek-chat` adversary (shell access, paid-per-task brief) plus 10 deterministic probes — see `evals/evil-001/REPORT.md`. Three silent penetrations found and closed:

- **`.skeinnignore` self-hiding**: ignore config can never be ignored (even by `*`), and modifying it is now a heavy-window trigger (`cli/src/git.js`).
- **Ledger-integrity sentinels in `skeinn check`** (`cli/src/store.js`): forged `done` Tasks lacking `completed_at`, FND sequence gaps / recorded-but-empty findings ledger, and Tasks closed inside a post-`keeper reset` disarm window while `launch_completed` is still false.
- Regression coverage: `v3.0 adversarial hardening` suite in `cli/test/run-all.js` (48/48).

Residual boundary documented, not fixed: `.skeinn/` is plain JSON — a fully consistent ledger forge remains possible. Skeinn is a ceremony + audit layer; it makes fingerprints loud, not impossible.

### Continuity Benchmark (RELAY-002)

Dual-arm, 3-baton zero-memory relay vs conventional handoff docs on `deepseek-chat` — see `evals/relay-002/REPORT.md`. Hidden oracle 10/10 both arms; order-swapped blind judging split (33:25 baseline / 30:30 tie). Skeinn arm recovered intent from disk across 10 sessions incl. a crash and 8 budget-cap amputations, shipped real-browser e2e that caught two data-loss bugs the baseline's jsdom suite could not see — at ~6× the turn cost.

### Continuity Benchmark (RELAY-003) — vague spec variant

Same race, deliberately vague brief + contradictory injections (no-plaintext ∧ no-password; vague declutter + feature retraction) — see `evals/relay-003/REPORT.md`. Result flipped: equal turn cost (212 vs 213), baseline needed a 4th rescue session after an unrecorded decision left a half-built export + 16 test regressions. Skeinn arm converged in 3 via the decision ledger; blind judge picked Skeinn on both order-swapped passes.

### Clean v3.0 CLI & Context Injection
- **Zero-Ceremony Input**: All JSON commands accept `--stdin`, `--json '<json>'`, or `--json-file <path>`; `skeinn task close <id> --evidence "<proof>"` maps single-line proof across all acceptance criteria.
- **Clean Vocabulary + Signposts**: Replaced `task start/done` -> `task focus/close`, added `task list`, unified `keeper prompt/record [--checkpoint]`, added `init --refresh-agents` (`<!-- skeinn:v3 -->`). Removed legacy aliases (`task start`, `task done`, `capability research/synthesize`, `keeper checkpoint`, `review`, `resume`, `prompts`) now exit 1 with exact migration signposts.
- **Lean Context Injection**: Daily `skeinn context` displays State source, lane, Review Window, and Sentinel banner while omitting full `PROJECT.md`/`STRUCTURE.md` unless `--full`/`--keeper`/`--checkpoint`/shaping; `--checkpoint` injects the real Git Review Window and recently closed delivery tasks.

## 2.5.0

- Redesigned Keeper around **two minimal primitives** (`reviewed_digests` per-artifact hash map + unified `scope`-pinned `findings` ledger) and exact topological horizon calculation (`activeHorizon(depth=2)`):
  - **`passed_with_advisories`**: Minor-only items no longer force another full Keeper round; they pass Launch immediately and pin to their `TASK-ID` or `.skeinn/design/<doc>.md` scope.
  - **Automatic `task start` surfacing & gating**: Starting any Task automatically surfaces all open findings pinned to that Task OR its `reads`/`implements` docs (blocking severity gates start until resolved via `skeinn keeper resolve <FND-ID> --evidence "<proof>"`; minor severity surfaces as an active advisory).
  - **Scope-bounded Delta Re-check (Round 2+)**: Follow-up Keeper rounds automatically inject only `dirty` modified artifacts and open blocking findings rather than the full corpus, eliminating fresh-eyes nitpicking spirals.
  - **Non-convergence (`>=`) ping-pong guard**: If blocking findings fail to strictly decrease across two consecutive rounds, `skeinn project ready` halts blind looping without dumping internal chores on the human (unlockable via `--force-round --reason`).
  - **In-Flight Checkpoints & Late-Entering Horizon Review**: Launch pass is a one-time birth certificate (`launch_completed`); distant design docs entering the horizon or designs updated mid-flight via `decision` automatically appear as `dirty` for lightweight `skeinn keeper checkpoint prompt|record` and `skeinn context --checkpoint`.
  - **Empirical Spike tasks (`kind: "spike"`)**: Can start in `shaping` before Launch without `implements` to resolve physical/empirical unknowns with real evidence.
  - **Relaunch escape hatch**: `skeinn keeper reset --reason <text>` clears `reviewed_digests` and logs a decision for genuine full-direction pivots.

## 2.4.0

- Upgraded Evil Eval (`skeinn eval scaffold`) to a 3-tier budget-aware pyramid (`probe` ¥2–5, default 3-baton zero-memory `relay` ~¥20, and `full`), adding per-baton prompts, `hidden-oracle.mjs`, `telemetry-template.json`, and Pairwise Forced-Choice (`X_CLEAR_WIN | TIE | Y_CLEAR_WIN`) blind judging.
- Renamed project, CLI binary, and state directory from LOOM/`.loom/` to Skeinn (`@haaaiawd/skeinn`, `skeinn`, `.skeinn/`), with a legacy `.loom/` migration guard and minimalist 3-element SVG brand assets.
- Redesigned Capability into a low-friction, high-substance single-file workflow (`.skeinn/capabilities/<slug>.md`): replaced the 4-command decision-tree ceremony (`add → research → synthesize → confirm` + `research/` folder) with one command (`skeinn capability add <slug> --title <field> [--mode external_researched|codebase_grounded|offline_reflection]`) and a natural three-part flow: **How real practitioners operate** (with verifiable external sources), **Reflection for this project**, and **Operational rules and Design delta** (Before → After).
- Closed anti-laziness loopholes at `skeinn project ready` and `skeinn check`: silent Capability omission is now rejected (projects must add 1–3 bottleneck capabilities or explicitly record `skeinn capability exempt --reason <text>`, which Keeper audits); `external_researched` capabilities reject `agent-authored` / self-authored filler and missing `Design delta`; offline runs must declare `Mode: offline_reflection` honestly and stay visibly marked.
- Upgraded core Design templates (`product`, `experience`, `system`, `contract`) with **Applied capabilities**, **Alternatives considered** (requiring at least two genuinely viable options, no strawmen), and **How this could look done yet fail**.
- Removed the mandatory per-Task `capability_hooks` ceremony tax and added lightweight `guardrails[]` injected directly into active Task context (legacy `capability_hooks` remain supported).
- Added **Anti-laziness audit** to the independent Keeper prompt (auditing unjustified exemptions, fake research, zero-delta capabilities, strawman Design options, and dropped guardrails).
- Fixed a latent bug in `startTask` dependency checking (`item.status === 'done'`) and added stale-downstream `needs_recheck` warnings in `skeinn check` when an upstream Task is reopened.
- Included `STRUCTURE.md` and `capability_exemption` in `projectDigest`.

## 2.3.0

- Clarification rounds: `skeinn clarify start --reason` pauses material work when the human changes direction; answers and new frontier questions (each carrying a persisted recommendation) record through `skeinn clarify resolve --json-file`, and `skeinn clarify close` refuses until every question is resolved or deliberately skipped — then cascades into `skeinn decision`, document updates, and Task impact warnings.
- Clarification guidance is wired into `skeinn --help`, `skeinn help clarify`, `skeinn clarify --help`, the runtime and execution protocols, the AGENTS.md anchor, and context recommendations; an open round becomes the top recommendation and lists current frontier questions with their recommendations.
- `skeinn context` is lean by default: it returns the state header, shaping state, PROJECT.md, STRUCTURE.md, and active Task context without re-injecting the ~190-line static protocol (~1.4k tokens saved per repeat call). `skeinn context --full` restores the complete protocol; lean output points first-entry and post-reset Agents at it, and `--keeper` always stays full.
- The capability quality bar (nodes need a source citation and a counterexample) is visible in the lean state block, not only in the full protocol.

## 2.2.0

- Shaping-path guidance: `skeinn --help` now states what each shaping step buys and what skipping costs, and names conceptual help topics.
- `skeinn help <concept>` (`shaping`, `design`, `capability`, `task`, `deliverable`) gives each artifact a short purpose-plus-pointer; bare subcommands like `skeinn capability` and `skeinn design --help` land on the same pointers instead of a usage error.
- Shaping commands return an additive `next` field chaining the lifecycle: init → record → capability add/research/synthesize/confirm → design add → deliverable → task plan → project ready; `skeinn task start` points back at `skeinn context`.
- `skeinn context` during shaping names the actual unfinished frontier — template PROJECT.md, missing or templated design documents, capability lifecycle states, open high-impact questions, empty Work Map — instead of a generic keep-shaping sentence.
- Capabilities now precede design in every guided path: dossier decision trees produce the design decisions, so design documents are written informed by confirmed dossiers.
- `skeinn init` output lists the `AGENTS.md` anchor it installs (omitted correctly in sidecar mode).

## 2.1.3

- Removed Keeper auto-pass: every still-open finding must be closed with evidence in a later independently attested pass. A changed project digest proves a change, not that findings were resolved.
- `skeinn task start` now requires an independently attested Keeper pass (`review.mode: "independent"`) or a recorded `skeinn keeper skip`; `skeinn check` reports an unattested legacy pass as an error instead of a quiet warning.
- Keeper findings are cumulative across attempts: a passing record must carry `closure_results` for every gap still open from earlier rounds.
- Task references are verified, not just non-empty: `implements` must resolve to an existing design file and section (or a decision name present in project truth), and `capability_hooks` must resolve to an existing dossier and node. `skeinn project ready` runs this integrity check.
- `skeinn context` lists each blocked Task with its reason and recovery conditions, and recommends `skeinn task reopen <id> --reason` when nothing is executable.
- Done Tasks resist silent rewrites: `skeinn task update` on a done Task is rejected with a reopen pointer, and reopening a blocked Task requires a concrete reason describing how the recovery conditions were met.
- Decision-affected done Tasks warn only until re-verified: reopening and re-completing the Task after the decision clears the warning.
- Deliverable coverage now distinguishes planned from delivered: units covered only by open or blocked Tasks no longer count as delivered.
- `skeinn record --help` documents `resolved` and `retire_assumptions` so Agents can close questions and assumptions they opened.
- Planning new Tasks on a completed project returns status to `building`; `skeinn context` no longer claims "all done" while new Tasks are open.

## 2.1.2

- Added environment-aware clarification through `skeinn context --human-channel available|unavailable`. Unattended Agents inspect first, research only permitted objective facts, and then use bounded assumptions or blocks rather than fabricating users or substituting web search for intent.
- Added `--state-dir <outside-workspace-dir>` sidecars for isolated benchmark and sandbox runs. Sidecars preserve virtual `.skeinn/` Task references without mutating the scored workspace or its `AGENTS.md`.
- Added equal human-channel controls and unattended condition prompts to Evil Eval scaffolding.
- Added explicit capability authority provenance: human selections become confirmed, while Agent selections remain visibly provisional until human confirmation.
- Required independent Keeper review provenance for a passing handoff; known self-review can no longer be recorded as an independent pass.
- Added Task integrity enforcement for design links, capability hooks or explicit exemptions, plus declared output existence checks before completion.
- Added command-specific canonical JSON help and recovery pointers for every structured-write command.
- Updated generated Agent guidance and both public READMEs so installed and source-checkout invocation paths are unambiguous.

## 2.1.1

- Re-published 2.1.0 content with corrected CHANGELOG line endings.

## 2.1.0

- Added a current-state and recommended-action header to `skeinn context` output. Agents entering a project or resuming after compression now see project status, active task, work-map counts, and a recommended next action before the full protocol. The recommendation is advisory, not a script.
- Rewrote `AGENTS.md` with explicit Skeinn trigger conditions (project entry, context reset, before substantial work, between Tasks) and a standard work rhythm that keeps Agent judgment while making the next step obvious.
- Integrated Crux integrity-chain review into the Keeper handoff. The Keeper now checks that responsible intent, project promises, design and capability decisions, Work Map, executable behavior, and human feedback loop form an intact chain, and looks for omission, substitution, drift, unsupported leaps, blindness, and ownerless gaps.
- Added staged visibility and review guidance to the project template and active-Task execution protocol. Tasks should prefer human-visible acceptance evidence, the Agent should show real working things at milestones, run `skeinn check` and project tests together before declaring a batch done, and prioritize reaching an exciting surface early to sustain the human's momentum.
- Strengthened capability source validation: `skeinn capability synthesize` now requires each decision-tree node's `source:` citation to reference a real `.md` file in the dossier's `research/` directory.
- Added `research/_guide.md` generation in `skeinn capability research` so Agents know what good research material looks like, what to avoid, and how to cite sources.
- Added `.skeinn/STRUCTURE.md` as a fifth project-truth layer declaring where source code, tests, docs, assets, and configuration files live. `skeinn check` warns when it is missing or still templated.
- Added `skeinn decision --json-file` for recording consequential superseding decisions with affected files and tasks. `skeinn check` warns when a done Task is marked affected by a later decision.
- Added `acceptance[]` as the primary Task completion structure, pairing `criterion`, `verify_by`, and `evidence`. Legacy `done_when[]` remains supported.
- Added Keeper auto-pass: when all Keeper gaps are minor and 3 or fewer, fixing them and running `skeinn project ready` auto-passes without another Keeper round. (removed in 2.1.3)
- Added deliverable coverage tracking through `skeinn deliverable add` and Task `covers` field. `skeinn check` reports uncovered delivery units.
- Added `skeinn capability research → synthesize → confirm` lifecycle with status tracking per dossier.
- Updated help text with a typical first-pass flow and capability lifecycle sequence.

## 2.0.1

- Added an active-Task execution protocol that restores workspace-aware coding guidance, risk-based testing, restartable progress, criterion-level proof, and conditional commit/PR boundaries after context resets.
- Strengthened the generated `AGENTS.md` anchor so Agents reload Skeinn at project entry, after context loss, and before resumed editing without invoking it before every tool call.

## 2.0.0

- Rebuilt Skeinn as invisible Agent infrastructure around project understanding, a scalable design-document graph, separate professional-field dossiers, a broad Work Map, and one active Task.
- Replaced fixed roles and stages with an adaptive clarification protocol and explicit convergence conditions.
- Added human-editable project truth, structured continuity state, and superseding decision history.
- Added context selection that keeps very large Task maps on disk and injects only the active horizon.
- Added seven adaptable design-document templates and `skeinn prompts` as a complete live prompt inventory.
- Reduced Keeper to one independent build-readiness handoff with revision, changed-digest, fresh-run, and stale-state enforcement.
- Added controlled Evil Eval scaffolding for equal-condition, repeated, reset-heavy blind comparison.
- Added bilingual English/Chinese release documentation and a flat, minimal visual system with editable loop diagrams.
- Deliberately stopped automatic mutation of legacy `.skeinn/v1` projects.
