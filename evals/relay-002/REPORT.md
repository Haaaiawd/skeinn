# RELAY-002 — Skeinn v3.0 vs conventional handoff docs (DeepSeek, dual-wave)

**Date:** 2026-11-22 · **Model under test:** `deepseek-chat` via Anthropic-compatible endpoint · **Harness:** ad-hoc bash-tool loop (Anthropic tool-use protocol), 80-call cap per session · **Judge:** same model, two passes with arm order swapped to control positional bias.

**Scenario:** `evals/relay-002/scenario.json` — identical to RELAY-001's shape: a zero-dependency offline single-file meeting-retro tool, built over 3 zero-memory batons, with a **mid-flight pivot injected at baton 2** (local encrypted JSON export/import). Hidden oracle checked the delivered artifact against 10 structural + behavioral assertions, including running each arm's own test suites.

**Two arms, same model, same brief text except the continuity clause:**
- **Baseline arm** — "use conventional docs; hand off via HANDOFF.md"
- **Skeinn arm** — "Skeinn CLI available; recover from `--state-dir` sidecar before work; close tasks with evidence"

Both workspaces were disposable (`/tmp/relay2/*-ws`). No agent saw the other arm.

---

## Headline result

| | Baseline | Skeinn |
|---|---|---|
| Baton sessions | **3** (all clean finish) | **10** (1 harness crash, 8 hit 80-call cap, 1 clean finish) |
| Assistant turns / tool calls | 133 / ~134 | 773 / ~806 |
| Product delivered | 626-line single HTML file; jsdom tests, 48/48 | 2161-line `src/` + build → 2523-line `index.html`; unit + real-Chrome-CDP e2e, 54/54 |
| Hidden oracle | **10/10** | **10/10** |
| Blind judge (2 passes, order-swapped) | **33 : 25** (X-first) | **30 : 30 tie** (Y-first) |

**Oracle disclosure:** one check ("draft restore on load") was initially a false-negative against baseline — its `boot()`-style init didn't match the name-dependent regex. Fixed to a behavior check (`getItem` at init); both arms pass. Documented rather than hidden because an oracle bug is eval data too.

## What actually happened (the part numbers flatten)

**Baseline arm** behaved like a competent contractor: baton 1 built the slice + 17 jsdom tests, caught and fixed a real undo bug (snapshot nulled before restore). Baton 2 absorbed the pivot additively, hit jsdom's `file://`/WebCrypto limits honestly — export **refuses** when `crypto.subtle` is absent rather than silently writing plaintext — 35/35. Baton 3 hardened: found a stale-import-prompt data-resurrection bug and a failed-write-reported-as-success bug, wrote 13 edge tests, **mutation-verified its own tests** (pre-fix file makes exactly the new tests fail) — 48/48.

**Skeinn arm** was the same model doing more expensive things: it shaped the project first (PROJECT.md, 3 design docs, 2 capability docs, 5 tasks), then baton 1 spent 80 calls building a **custom mini-DOM + real-Chrome CDP test harness** and never converged. Baton 2 recovered from disk, built a **hand-written pure-JS AES-256-GCM + PBKDF2 fallback** (validated against test vectors) so crypto works on `file://` — and measured its own PBKDF2 at ~46s/250k iterations, documenting the cost instead of hiding it. Baton 3's e2e caught **two real data-loss bugs invisible to jsdom** (Clear never persisted → reload resurrected cleared text; IndexedDB→memory fallback wrote nowhere), fixed both, honestly marked the clipboard test flaky, closed all 5 tasks through a forced independent checkpoint — but only after 8 cap-outs across the relay.

## The honest verdict (ours, not the model's)

**Skeinn's continuity machinery worked exactly as designed under the worst conditions.** Ten sessions, one crash, eight budget-cap amputations — and every next baton reconstructed intent from disk: tasks, design docs, decisions, findings. Baton 3's close was *forced* through `keeper prompt/record --checkpoint` by the heavy-window gate, and it produced per-criterion evidence including criteria it refused to mark met. The pivot was absorbed; the audit trail is real.

**And it cost ~6× the turns.** Some of that is Skeinn's price of admission (shaping, checkpoint ceremonies). Most of it is the arm's own choices: the CDP harness and hand-rolled crypto are maximalist bets no protocol demanded. The model spent its surplus on test depth, not on convergence.

**The blind judge split on values, not facts.** Both passes agreed: baseline is cheaper and its handoff is tighter; skeinn shipped deeper verification and made the pivot *actually work* on the spec's target surface (`file://` denies `crypto.subtle`; baseline's export just refuses there). The tie-breaker was which matters more. For a multi-week project we'd take **baseline's handoff discipline + skeinn's test depth** — which is literally what Skeinn is supposed to encode.

## What this eval changes about Skeinn

Nothing here is a Skeinn code bug — but it sharpens the honest sales pitch:

- Skeinn's value shows **when memory actually dies** (crash, cap, week-long gap). A 3-baton clean relay understates it; the baseline arm never hit conditions where prose handoff fails.
- The shaping+checkpoint overhead is real money at small scale. Skeinn amortizes over longer horizons — this eval's N=1 says nothing about week 6.
- The arm that wrote its own test harness burned 5× the turns on infrastructure. A `skeinn eval` note worth keeping: **continuity doesn't make agents cheaper; it makes their disasters recoverable.**

## Artifacts

- Transcripts: `/tmp/relay2/*.jsonl` (13 sessions, bash-tool loop; not shipped — contain no secrets but are 1600+ messages)
- Workspaces: `/tmp/relay2/baseline-ws`, `/tmp/relay2/skeinn-ws`, sidecar `/tmp/relay2/skeinn-state`
- Hidden oracle: `evals/relay-002/hidden-oracle.mjs` (with the disclosed regex fix)
- Judge packets + both verdicts: `evals/relay-002/judge-{packet,verdict}-{XY,YX}.txt`
- Scenario: `evals/relay-002/scenario.json`

**Reproduce:** `skeinn eval scaffold <scenario.json>` generates the baton briefs; any agent harness with a bash tool can drive them. The oracle is model-independent: `node hidden-oracle.mjs <workspace>`.
