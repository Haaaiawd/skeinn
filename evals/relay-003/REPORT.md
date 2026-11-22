# RELAY-003 — Vague-brief relay: contradiction, retraction, and why-recovery

**Date:** 2026-11-22 · **Model:** `deepseek-chat` (Anthropic-compatible) · **Harness:** bash-tool loop, 80-call cap, per-line timestamps · **Judge:** same model, two order-swapped passes.

**The single changed variable vs RELAY-002:** spec precision. Same product domain (offline meeting wrap-up tool), same 3-baton zero-memory relay, same arm split (conventional docs vs Skeinn sidecar state). This time the brief was deliberately vague and the injections were *contradictory*, not additive.

## Scenario

Brief (verbatim): *"给小组开完会收个尾做个小工具，就一个页面双击能开。写的东西别丢——刷新关掉都得在。最好能看着点时间。能顺手导出来个备份更好。"*

Injections between batons:
- **Baton 2:** *"导出的文件里别留明文……但也别弄什么密码——没人记得住。"* — a hard contradiction (no-plaintext ∧ no-password).
- **Baton 3:** *"页面上东西太多了，但功能一个都不能少"* + *"那个看时间的功能先撤了"* — a vague complaint with a hard fence, plus a real retraction of a feature baton 1 had built.

## Headline result — the table flipped

| | Baseline | Skeinn |
|---|---|---|
| Sessions / turns / tool calls | **4** / 213 / ~224 | **3** / 212 / ~216 |
| Wall-clock compute | ~580s | ~780s |
| Baton finishes | 2 finished + 2 capped, **needed a 4th resume session** | 2 finished + 1 capped, converged in 3 |
| Hidden oracle | **12/12** | **12/12** |
| Blind judge (X-first / Y-first) | 28.5 / 32.5 | **33.5 / 36.0 — won both passes** |

Compare RELAY-002 (crisp spec): baseline won on cost 133 vs 773 turns. Here the turns are **equal** — and baseline spent an extra session.

## What actually happened

Both arms resolved the no-plaintext-no-password contradiction with essentially the same design — an embedded-constant keyed stream honestly labeled a "skin, not encryption," with an explicit threat model and legacy-import tolerance. Engineering judgment converged; **what differed was where the reasoning lived.**

**Baseline** baton 2 was capped mid-implementation: `sealBackup`/`openSealed` sat **unwired in `src/core.js` with zero tests and zero docs** — the decision existed only in the dead transcript. Baton 3 inherited that plus 16 test regressions, capped again without handling the retraction, and a 4th resume session was needed to converge (37/37). Its final HANDOFF is honestly excellent — but it's a post-hoc account written by the *rescue* session.

**Skeinn** baton 1 capped while debugging its own test harness (suite RED 45/1). Baton 2 recovered from the state dir, *fixed the inherited bug*, resolved the contradiction **with a recorded decision** (`DECISIONS.md` entry + `blurred-export.md` listing rejected alternatives), closed all tasks 55/55. Baton 3 executed the retraction for real (code+tests deleted, regression fences added) and the no-features-cut declutter (12 capability ids verified on screen) — 59/59, converged in 3 sessions.

## Judge findings (both passes, no positional flip)

- **Y wins evidence/why-recovery decisively** (9.0–9.3 vs 6.0–7.5): a timestamped decision ledger with rejected alternatives beats prose that gets overwritten each baton. Judge noted baseline's `DESIGN.md` §6 was *literally truncated mid-sentence* after three batons.
- **Y wins continuity under stress**: inherited messes were closed *within* their batons; baseline's required an extra session.
- **Artifact quality near-tied** (9.0–9.2): both real, tested, honest products.
- **Cost: roughly even by the metric that matters** — X cheaper on raw compute (580s vs 780s), Y cheaper on sessions-to-converge (3 vs 4). Both judges weighted sessions for a multi-week horizon.
- **Flagged caveat for Y (both judges):** the sidecar state dir lives *outside* the workspace — if it isn't packed/found by the next agent, the whole advantage evaporates. The oracle itself needed a `--state` arg to see it. Real packaging footgun; worth a `skeinn doctor`-style check or a README-visible pointer inside the workspace.

## What this eval actually demonstrates

- **RELAY-002 said:** on a crisp spec with no real memory death, Skeinn is pure overhead (~6× turns).
- **RELAY-003 says:** the moment the spec is vague and mid-flight feedback *contradicts itself*, prose handoffs start losing decisions (unrecorded crypto → zombie half-implementation → rescue session) while the ledger keeps them — at **equal turn cost**. The overhead didn't shrink; the *conditions where it pays* appeared.
- The crossover is plausibly somewhere in "how messy is the intent," not "how long is the project." A crisp spec + long horizon is still untested (that's L3).

## Oracle fixes (disclosed, same policy as RELAY-002)

1. `--state <dir>` arg — sidecar rationale lives outside the workspace by design.
2. `retracted/retired` added to zombie-comment vocabulary.
3. Test check made workspace-entry-point aware (`npm test`/runner first) — the skeinn arm's custom `suite()` files aren't standalone-runnable, which is a legitimate test architecture, not a failure.

## Artifacts

`scenario.json`, `hidden-oracle.mjs` (with all disclosed fixes), `judge-packet-{XY,YX}.txt`, `judge-verdict-{XY,YX}.txt`. Transcripts (`/tmp/relay3/*.jsonl`, timestamped) not shipped — available on request, ~1.5MB.
