# RELAY-001 Live Run Log — Evil Eval L2 on Skeinn 2.4.0

Model under test: DeepSeek-V4.1-Flash-1017 via AiPing (https://aiping.cn/api/v1)
Harness: opencode-ai 1.19.6 (`opencode run`, fresh session per baton = zero memory)
Human channel: unavailable (question tool denied in opencode.json)
Workspaces: D:\eval-run\baseline-workspace, D:\eval-run\skeinn-workspace
Skeinn state: D:\eval-run\skeinn-state (sidecar, --state-dir outside scored workspace)

## Harness incident (recorded for honesty)

- Skeinn baton-1 first attempt died after 13 tool calls: opencode auto-rejected
  `external_directory` writes to the sidecar state dir. Fixed by granting
  `external_directory: allow` (+ standard tool allows) in BOTH arms' opencode.json,
  wiping skeinn-state + workspace, and re-running baton 1 clean.
- Baseline baton-1 had already completed under default perms; it never touched
  external dirs, so material conditions were unaffected. Recorded as 1 harness
  retry for the skeinn arm.
- WSL/Windows path split: runner passes /mnt/d paths to node fs and D:\ paths to
  the Windows opencode.exe.

## Baton telemetry (from opencode step_finish events)

| arm | baton | wall_s | input | output | reasoning | tool_calls |
|-----|-------|--------|-------|--------|-----------|------------|
| baseline | 1 | 549 | 35,164 | 20,641 | 31,960 | ~46 |
| baseline | 2 | 820 | 61,506 | 27,373 | 39,728 | ~75 |
| baseline | 3 | 705 | 63,502 | 15,181 | 35,283 | ~53 |
| skeinn | 1 | 1,489 | 144,726 | 64,111 | 72,895 | ~114 |
| skeinn | 2 | 1,108 | 154,221 | 60,067 | 58,033 | ~112 |
| skeinn | 3 | 1,031 | 143,321 | 16,035 | 28,293 | ~82 |
| **baseline total** | | **2,074** | **160,172** | **63,195** | **106,971** | **~174** |
| **skeinn total** | | **3,628** | **442,268** | **140,213** | **159,221** | **~308** |

Estimated cost (≈¥0.5/M in, ¥2/M out+reasoning): baseline ~¥0.42, skeinn ~¥0.82.
Both well under the ¥20 budget cap.

## Baton outcomes (from agent self-reports)

- baseline-1: single-file index.html + 14 pytest tests + README.
- baseline-2: absorbed pivot (PBKDF2 200k + AES-256-GCM backup) + added local
  history from README roadmap; 20 tests.
- baseline-3: edge hardening (IME Enter, dedup, timestamps, 320px overflow);
  43 tests; VERIFICATION.md honest notes.
- skeinn-1: full shaping (4 design docs, 2 capability files, 4-task map) then
  meeting-retro.html + 32 tests (16 real headless-Chrome) + README + artifacts.
  Keeper recorded skipped (no fresh-agent harness available for the role).
- skeinn-2: pivot via 3 new tasks; PBKDF2 600k + AAD + 8-char floor, preview-
  confirm-undo import, CSP connect-src 'none'; 43/43 tests; design docs updated.
- skeinn-3: found+fixed a real mid-session storage-failure persistence bug;
  44 tests (23 real browser); Keeper attempt 1 needs_revision (4 doc gaps) →
  fixed → attempt 2 PASSED; 8/8 tasks, check healthy.

## Hidden Oracle (objective assertions, run post-hoc by me)

- baseline: 8/8 PASS
- skeinn: 8/8 PASS

## Blind judging

- Packets sealed to D:\eval-run\X and D:\eval-run\Y via blind.mjs;
  mapping-sealed.json written, unread until verdicts recorded.
- Judge pass 1 (X→Y order): fresh subagent, agent_id e70ac5d6
- Judge pass 2 (Y→X order): fresh subagent, agent_id 57985483

## Verdicts (recorded before unsealing)

Pass 1 — OVERALL_X_CLEAR_WIN
  1. Intent fidelity: X_CLEAR_WIN (timer persists across refresh; preview+undo import)
  2. Craft depth: X_CLEAR_WIN (AAD-bound GCM, 600k PBKDF2, error taxonomy, quarantine)
  3. Cold-handoff: TIE
  4. Oracle/proof credibility: TIE (8/8 both, honest blind spots both)
  5. User burden: X_CLEAR_WIN (zero-dep node --test vs pytest+Playwright install)
  6. Net value/RMB: Y_CLEAR_WIN (¥0.42 vs ¥0.82 for same oracle result)

Pass 2 — OVERALL_X_CLEAR_WIN
  1. Intent fidelity: TIE
  2. Craft depth: X_CLEAR_WIN
  3. Cold-handoff: TIE
  4. Oracle/proof: TIE
  5. User burden: X_CLEAR_WIN
  6. Net value/RMB: Y_CLEAR_WIN

No verdict flipped across orderings — all STABLE. Judge 1 flagged dim-2 as
"borderline but held"; judge 2 independently confirmed it.

## Unsealed mapping (read only after both verdicts recorded)

X = skeinn   Y = baseline   →   FINAL: SKEINN wins the relay, stably, on craft
margins; baseline wins on cost efficiency and shipped more features (history).

## Judge-noted leakage (honesty)

Pass-2 judge noticed oracle.target paths ("skeinn-workspace"/"baseline-workspace")
inside judge-packet.json and ignored them for scoring. The packet should redact
target paths in a future harness revision — recorded as a methodology fix, not a
scoring factor.

## Post-hoc: did the .skeinn docs earn their tokens?

Judges never saw the state files (sidecar was excluded from packets by design),
so doc quality was not blind-scored — only its effects were. Post-hoc read:

- `capabilities/local-crypto-backup.md` (written by baton 2 under the pivot)
  cites OWASP/MDN/W3C primary sources and, in its Reflection section, predicted
  the export-while-running timer bug BEFORE implementation — that became the
  `draftAtTimestamp` pause-on-export code judge 2 called "a sharp edge-semantic
  call". Capability → design delta → shipped line: traceable.
- `capabilities/timeboxed-reflection.md` predicted the generic failure mode
  (canonical went-well/went-badly columns) and its design delta produced the
  non-generic prompt set ("哪里没被说透").
- `design/system.md` lists 8 alternatives including genuinely tempting ones
  (IndexedDB, bundled Argon2id lib, stored password), rejected on real
  constraints; `Applied capabilities` imports rules verbatim from the dossiers.
- Caveat: `external_researched` source URLs cannot be disk-verified as truly
  fetched vs model recall; content matches the real documents.
