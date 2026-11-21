#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDeliverable,
  blockTask,
  checkProject,
  checkDeliverableCoverage,
  clarifyStatus,
  closeClarify,
  compileContext,
  completeTask,
  confirmCapability,
  configureRuntime,
  createCapability,
  createDesign,
  exemptCapabilities,
  recordDecision,
  getCapability,
  getCapabilityStatus,
  getDesign,
  getKeeperPrompt,
  getTask,
  importTasks,
  initProject,
  listCapabilities,
  listDeliverables,
  listDesigns,
  loadProject,
  markReady,
  recordKeeper,
  recordUnderstanding,
  reopenTask,
  researchCapability,
  resolveClarify,
  scaffoldEval,
  synthesizeCapability,
  skipKeeper,
  startClarify,
  startTask,
  taskSummary,
  updateTask,
} from '../src/store.js';
import { promptCatalog } from '../src/protocol.js';

const argv = process.argv.slice(2);
const [command, subcommand, ...rest] = argv;

function output(value) {
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function option(name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function jsonFile() {
  const path = option('--json-file');
  if (!path) throw new Error('This command requires --json-file <path>');
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON file ${path}: ${error.message}`);
  }
}

function help() {
  return `skeinn — continuity infrastructure for Agents

The human talks naturally to the Agent. The Agent uses these commands silently.

Typical flow (first pass):
  1. skeinn init                          — create .skeinn/ skeleton
  2. skeinn record                        — confirm facts, assumptions, open questions
  3. skeinn design add                    — one document per consequential decision surface,
                                        comparing at least two viable alternatives; skipping
                                        this makes PROJECT.md an unresumable monolith
  4. skeinn capability add                — 1–3 single-file bottleneck domain specs (real
                                        practitioner research + project reflection + Design
                                        delta); skipping without skeinn capability exempt fails
                                        ready and produces generic output
  5. skeinn deliverable add               — decompose the delivery surface
  6. skeinn task plan                     — write Tasks with guardrails and acceptance criteria
  7. skeinn project ready                 — freeze a digest for Keeper review
  8. skeinn keeper prompt → record        — fresh Agent runs integrity & anti-laziness audit
  9. skeinn task start → done             — execute one Task at a time, fill acceptance evidence
  10. skeinn check                        — verify health, coverage, stale dependents, and drift

Steps 3–6 iterate together: Design surfaces hard decisions; Capability researches how real
practitioners solve them and feeds operational rules + Design delta back into Design. Run
\`skeinn help <concept>\` for purpose and quality bar: shaping, design, capability, task, deliverable.

When a new idea changes an existing decision:
  skeinn decision --json-file <decision.json>   — record what changed and affected tasks
  then update the design document directly; skeinn check warns which done tasks need reopening.

When the human changes direction, requests a redesign, or contradicts project truth:
  skeinn clarify start --reason <what changed> — pause work, open an inquiry round
  ask ONE batch of material questions in conversation, then:
  skeinn clarify resolve --json-file <round.json> — record answers/decisions/new questions
  skeinn clarify close                       — close once every round question is resolved
  or skipped, then cascade the answers into design documents and Tasks.

Start and resume
  skeinn init
  skeinn context [--task TASK-001] [--keeper] [--full] [--human-channel available|unavailable]
                                        (default returns state + Task context; --full restores the complete protocol)
  skeinn check
  skeinn prompts

Preserve understanding
  skeinn record --json-file <update.json>
  skeinn decision --json-file <decision.json>
  skeinn project ready
  skeinn design add <slug> --title <text> --kind <product|experience|system|contract|verification|operations|research>
  skeinn design list|get <slug>
  skeinn capability add <slug> --title <professional-field> [--mode external_researched|codebase_grounded|offline_reflection]
  skeinn capability list|get|status <slug>
  skeinn capability confirm <slug> --scenario <text> --source human|agent
                                        — optional authority upgrade (human_confirmed vs agent_provisional)
  skeinn capability exempt --reason <text>
                                        — explicit exemption when standard engineering suffices (audited by Keeper)

Map the delivery surface
  skeinn deliverable add <slug> --title <text> --kind <module|feature|behavior|interface|artifact|operational|verification|other>
  skeinn deliverable list
  skeinn deliverable coverage

Maintain the work map
  skeinn task plan --json-file <tasks.json>
  skeinn task status|next|get <id>
  skeinn task start <id>
  skeinn task update <id> --json-file <patch.json>
  skeinn task block <id> --json-file <block.json>
  skeinn task reopen <id> [--reason <reason>]
  skeinn task done <id> --json-file <evidence.json>

Each Task should produce one verifiable unit of real work. Use acceptance[] with criterion,
verify_by, and evidence fields, plus guardrails[] for key specialist red lines. Task completion
fills in each acceptance condition's evidence with the actual result (for acceptance tasks) or
quotes each done_when criterion (for legacy tasks).

One-time independent handoff
  skeinn review [--help]                 — Keeper handoff and stage-review guide
  skeinn keeper --help                  — read-only guide in any project state
  skeinn keeper prompt
  skeinn keeper record --json-file <result.json>
  skeinn keeper skip --reason <reason>

Evaluate Skeinn itself
  skeinn eval scaffold --json-file <scenario.json>

Use \`--state-dir <outside-workspace-dir>\` on every command to keep Skeinn state in an isolated sidecar
(for example, a benchmark runner's per-run state directory). Sidecar initialization never edits AGENTS.md.

Use \`skeinn <command> --help\` or \`skeinn help <topic>\` for canonical JSON payloads. Topics:
  record, decision, task-plan, task-update, task-block, task-done, keeper-record, eval-scaffold
Conceptual guidance topics: shaping, design, capability, task, deliverable, clarify

Use JSON files for structured writes so long content and shell quoting remain auditable.
Task completion JSON includes evidence plus either acceptance_results[] (one per acceptance criterion,
each with concrete evidence) or checks[] (one per done_when criterion, for legacy tasks).`;
}

const STRUCTURED_HELP = {
  record: {
    usage: 'skeinn record --json-file <update.json>',
    example: {
      confirmed: ['A fact confirmed by the human or workspace.'],
      assumptions: [{ text: 'A bounded, reversible Agent assumption.', source: 'agent' }],
      unresolved: [{ question: 'A consequential question still open?', impact: 'high' }],
      resolved: [{ id: 'Q-001', status: 'resolved' }],
      retire_assumptions: ['A-001'],
      decisions: [{ title: 'Decision title', decision: 'Current decision.', rationale: 'Why it follows.', supersedes: [], affects: ['.skeinn/PROJECT.md'] }],
    },
  },
  decision: {
    usage: 'skeinn decision --json-file <decision.json>',
    example: { summary: 'What changed and why.', changes: ['.skeinn/design/system.md', 'src/system.js'], affected_tasks: ['TASK-001'] },
  },
  'task-plan': {
    usage: 'skeinn task plan --json-file <tasks.json>',
    example: { tasks: [{ title: 'Create one verifiable result', outcome: 'A concrete artifact behaves as specified.', acceptance: [{ criterion: 'Observable condition', verify_by: 'Exact command or review method', evidence: '' }], boundaries: ['Does not change unrelated behavior'], guardrails: ['Concrete specialist red line inherited from capability/design'], depends_on: [], reads: ['.skeinn/PROJECT.md', '.skeinn/design/system.md'], touches: ['src/result.js'], implements: '.skeinn/design/system.md#Responsibility', covers: ['DLV-001'] }] },
  },
  'task-update': {
    usage: 'skeinn task update <id> --json-file <patch.json>',
    example: { progress: { completed: ['Finished checkpoint'], current: 'Verifying behavior', next: 'Run the named acceptance check' } },
  },
  'task-block': {
    usage: 'skeinn task block <id> --json-file <block.json>',
    example: { reason: 'A concrete dependency or authority is unavailable.', recovery_conditions: ['Observable condition that permits resuming'], evidence: ['Inspection or command output showing the block'] },
  },
  'task-done': {
    usage: 'skeinn task done <id> --json-file <evidence.json>',
    example: { evidence: ['Overall reproducible verification result'], acceptance_results: [{ criterion: 'Exact acceptance criterion from the Task', evidence: 'Concrete command, artifact, or observation' }] },
  },
  'keeper-record': {
    usage: 'skeinn keeper record --json-file <result.json>',
    example: { run_id: 'fresh-agent-run-001', prepared_digest: '<digest from skeinn project ready>', verdict: 'passed', review: { mode: 'independent', reviewer_id: 'fresh-agent-001', evidence: 'Host opened a separate Agent without the shaping conversation.' }, summary: 'Build-readiness judgment.', gaps: [], evidence: ['Files and observations supporting the verdict'] },
  },
  'eval-scaffold': {
    usage: 'skeinn eval scaffold --json-file <scenario.json>',
    example: { id: 'EVAL-001', title: 'Offline tool 3-baton relay', mode: 'relay', budget_cny: 20, brief: 'Identical brief for both conditions.', pivot: 'Mid-flight requirement change injected at Baton 2.', hidden_user_facts: ['Fact revealed by the same answer script'], hidden_checks: ['Zero external network calls', 'Reload restores state'], human_channel: 'unavailable', success_criteria: ['Fresh Agent finishes Baton 2 and Baton 3 without regressions'], repetitions: 1 },
  },
  'clarify-resolve': {
    usage: 'skeinn clarify resolve --json-file <round.json>',
    example: { answers: [{ id: 'Q-001', resolution: 'User confirmed the new direction' }, { question: 'Inline question', resolution: 'Answer recorded as a confirmed fact' }], confirmed: ['New confirmed fact'], retire_assumptions: ['A-001'], decisions: [{ title: 'Decision title', decision: 'Current decision.', rationale: 'Why it follows.', supersedes: [], affects: ['.skeinn/design/x.md'] }], new_questions: [{ question: 'Still open?', recommendation: 'Your recommended answer', impact: 'high' }] },
  },
};

const CONCEPT_HELP = {
  shaping: `skeinn shaping — the iterative loop that makes a project resumable and strong

record → iterate Design & 1–3 bottleneck Capabilities → deliverable → task plan → project ready.
Design surfaces the hard decisions; Capabilities research how real practitioners solve them and feed
operational rules + Before -> After Design delta back into Design. No silent Capability skips: add
1–3 bottleneck domains or explicitly record skeinn capability exempt --reason.
Per-layer details: skeinn help capability | design | deliverable | task`,

  design: `skeinn design — one document per consequential decision surface

Owns the decisions a fresh Agent must verify independently; skipping it makes PROJECT.md an
unresumable monolith, and template text fails skeinn project ready. Core design docs (product,
experience, system, contract) compare at least two genuinely viable alternatives (no strawmen),
compile applied capability rules into mechanisms, and name how the work could look done yet fail.
skeinn design add <slug> --title <text> --kind <product|experience|system|contract|verification|operations|research>
Tasks link to it via implements or a concrete design_exemption.`,

  capability: `skeinn capability — real practitioner research + project reflection, in one file

One single .md file per recognizable field (focus on the 1–3 bottleneck domains that truly raise the
project's ceiling). Three sections:
1. How real practitioners operate (verifiable external sources; never agent-authored filler)
2. Reflection for this project (what fits, what to adapt/refuse, where ordinary AI feels amateur)
3. Operational rules and Design delta (quality bar, tradeoffs & flip conditions, anti-patterns,
   verification probes, and Before -> After Design delta)
Commands: skeinn capability add <slug> --title <field> [--mode external_researched|codebase_grounded|offline_reflection]
Optional authority upgrade: skeinn capability confirm <slug> --scenario <text> --source human|agent
Explicit skip when standard engineering suffices: skeinn capability exempt --reason <text>`,

  task: `skeinn task — one verifiable unit of real work

Required: outcome + acceptance[criterion/verify_by/evidence] + boundaries + exact reads/touches +
implements|design_exemption + covers + depends_on. Recommended: guardrails[] (1–3 specialist red
lines carried forward from capability/design). Canonical payload: skeinn task plan --help.
Completion needs one acceptance_results entry per criterion; start/done refuse unclassified Tasks
and missing declared outputs.`,

  deliverable: `skeinn deliverable — the delivery surface, decomposed

One deliverable is one observable thing the project must produce. Tasks claim coverage
via covers; skeinn deliverable coverage separates planned from delivered.
Commands: skeinn deliverable add|list|coverage.`,

  clarify: `skeinn clarify — frontier inquiry for direction changes

Open when the human changes direction, requests a redesign, or contradicts project
truth. Pause material work, ask the current frontier in one batch (each question with
a recommended answer; look facts up, don't ask them), then skeinn clarify resolve
records it and skeinn clarify close refuses while any round question stays open.
Payload: skeinn clarify resolve --help. Small feedback needs no round — fix directly.`,
};

function conceptHelp(topic) {
  const entry = CONCEPT_HELP[topic];
  if (!entry) return null;
  return entry;
}

function structuredHelp(topic) {
  if (['keeper', 'review', 'keeper-prompt'].includes(topic)) return reviewHelp();
  if (topic === 'keeper-record') return `${STRUCTURED_HELP[topic].usage}\n\nCanonical JSON payload:\n${JSON.stringify(STRUCTURED_HELP[topic].example, null, 2)}\n\nFor a revised pass, add closure_results: [{"gap":"<exact prior gap text>","evidence":"<observed closure proof>"}] for every prior gap. Minor gaps require fresh verification too.`;
  const entry = STRUCTURED_HELP[topic];
  if (!entry) {
    const concept = conceptHelp(topic);
    if (concept) return concept;
    throw new Error(`Unknown help topic: ${topic}. Payload topics: ${Object.keys(STRUCTURED_HELP).join(', ')}. Concept topics: ${Object.keys(CONCEPT_HELP).join(', ')}`);
  }
  return `${entry.usage}\n\nCanonical JSON payload:\n${JSON.stringify(entry.example, null, 2)}`;
}

function reviewHelp() {
  return `Skeinn review guide

Keeper is the first build-readiness handoff. Stage reviews use ordinary Tasks.
This guide is read-only and available before initialization or project readiness.

Keeper handoff:
1. The shaping Agent runs skeinn project ready after preparing project truth.
2. The host opens a fresh Agent without inherited conversation. Give it the workspace
   path, the CLI location (absolute path in source checkouts), and this instruction:
   Run skeinn keeper prompt, then skeinn context --keeper, and inspect the referenced files.
3. The fresh Agent records its verdict with skeinn keeper record --json-file <result.json>.
   See skeinn keeper record --help for the payload and independent review provenance.
4. The parent waits for the result, then runs skeinn context. On needs_revision or blocked,
   repair the named sources, prepare again, and obtain a fresh review, including minor gaps.
5. On passed, resume with skeinn task next and skeinn task start <id>.
If isolation is unavailable, explicitly record skeinn keeper skip --reason <limitation>.
The CLI prints instructions and records state; it does not launch Agents itself.

Stage review:
Use skeinn task plan --help to create a review Task naming the implementation, design,
and verification artifacts in reads. Record each finding as a repair Task with concrete
acceptance criteria and evidence. Block the review Task with skeinn task block until repairs
are ready; reopen it and re-run verification before skeinn task done. A completed repair
alone is not a completed review. No findings: close the review Task with inspection evidence.
Do not rerun first-time Keeper just to review every implementation Task.`;
}

function activeStructuredHelpTopic() {
  if (command === 'record' || command === 'decision') return command;
  if (command === 'clarify' && subcommand === 'resolve') return 'clarify-resolve';
  if (command === 'task' && ['plan', 'update', 'block', 'done'].includes(subcommand)) return `task-${subcommand}`;
  if (command === 'keeper' && subcommand === 'record') return 'keeper-record';
  if (command === 'eval' && subcommand === 'scaffold') return 'eval-scaffold';
  return '';
}

try {
  configureRuntime({ stateDir: option('--state-dir') });
  const humanChannel = option('--human-channel');
  if (humanChannel && !['available', 'unavailable'].includes(humanChannel)) throw new Error('--human-channel must be available or unavailable');
  switch (command) {
    case '--version':
    case '-v': {
      const here = dirname(fileURLToPath(import.meta.url));
      const pkg = JSON.parse(readFileSync(resolve(here, '..', '..', 'package.json'), 'utf8'));
      output(`skeinn ${pkg.version}`);
      break;
    }
    case '--help':
    case '-h':
    case undefined:
      output(help());
      break;
    case 'help':
      output(subcommand ? structuredHelp(subcommand) : help());
      break;
    case 'init':
      output(initProject());
      break;
    case 'context':
    case 'resume':
      output(compileContext({ taskId: option('--task'), keeper: argv.includes('--keeper'), full: argv.includes('--full'), humanChannel: humanChannel || 'available' }));
      break;
    case 'prompts':
      output(promptCatalog());
      break;
    case 'record':
      output(subcommand === '--help' ? structuredHelp('record') : recordUnderstanding(jsonFile()));
      break;
    case 'clarify': {
      if (argv.includes('--help') && subcommand === 'resolve') output(structuredHelp('clarify-resolve'));
      else if (subcommand === '--help' || (argv.includes('--help') && !subcommand)) output(conceptHelp('clarify'));
      else if (subcommand === 'start') output(startClarify({ reason: option('--reason') }));
      else if (subcommand === 'resolve') output(resolveClarify(jsonFile()));
      else if (subcommand === 'close') output(closeClarify());
      else if (!subcommand || subcommand === 'status') output(clarifyStatus());
      else throw new Error('Usage: skeinn clarify start|resolve|close|status');
      break;
    }
    case 'decision':
      output(subcommand === '--help' ? structuredHelp('decision') : recordDecision(jsonFile()));
      break;
    case 'check': {
      const result = checkProject();
      output(result);
      if (!result.healthy) process.exitCode = 1;
      break;
    }
    case 'project':
      if (subcommand !== 'ready') throw new Error('Usage: skeinn project ready');
      output(markReady());
      break;
    case 'design': {
      if (argv.includes('--help')) output(conceptHelp('design'));
      else if (subcommand === 'add') {
        const slug = rest[0];
        const title = option('--title');
        const kind = option('--kind');
        if (!slug) throw new Error('Usage: skeinn design add <slug> --title <text> --kind <kind>');
        output(createDesign(slug, { title, kind }));
      } else if (subcommand === 'list') output(listDesigns());
      else if (subcommand === 'get') {
        if (!rest[0]) throw new Error('Usage: skeinn design get <slug>');
        output(getDesign(rest[0]));
      } else if (!subcommand) output(conceptHelp('design'));
      else throw new Error('Usage: skeinn design add|list|get');
      break;
    }
    case 'capability': {
      if (argv.includes('--help')) output(conceptHelp('capability'));
      else if (subcommand === 'add') {
        const slug = rest[0];
        const title = option('--title');
        const mode = option('--mode');
        if (!slug) throw new Error('Usage: skeinn capability add <slug> --title <text> [--mode external_researched|codebase_grounded|offline_reflection]');
        output(createCapability(slug, { title, mode }));
      } else if (subcommand === 'exempt') {
        output(exemptCapabilities(option('--reason')));
      } else if (subcommand === 'list') output(listCapabilities());
      else if (subcommand === 'get') {
        if (!rest[0]) throw new Error('Usage: skeinn capability get <slug>');
        output(getCapability(rest[0]));
      } else if (subcommand === 'research') {
        if (!rest[0]) throw new Error('Usage: skeinn capability research <slug> --field <text>');
        output(researchCapability(rest[0], { field: option('--field') }));
      } else if (subcommand === 'synthesize') {
        if (!rest[0]) throw new Error('Usage: skeinn capability synthesize <slug>');
        output(synthesizeCapability(rest[0]));
      } else if (subcommand === 'confirm') {
        if (!rest[0]) throw new Error('Usage: skeinn capability confirm <slug> --scenario <text> --source human|agent');
        output(confirmCapability(rest[0], { scenario: option('--scenario'), source: option('--source') }));
      } else if (subcommand === 'status') {
        if (!rest[0]) throw new Error('Usage: skeinn capability status <slug>');
        output(getCapabilityStatus(rest[0]));
      } else if (!subcommand) output(conceptHelp('capability'));
      else throw new Error('Usage: skeinn capability add|exempt|list|get|status|confirm');
      break;
    }
    case 'deliverable': {
      if (argv.includes('--help')) output(conceptHelp('deliverable'));
      else if (subcommand === 'add') {
        const slug = rest[0];
        const title = option('--title');
        const kind = option('--kind');
        if (!slug) throw new Error('Usage: skeinn deliverable add <slug> --title <text> --kind <module|feature|behavior|interface|artifact|operational|verification|other>');
        output(addDeliverable(slug, { title, kind, notes: option('--notes') }));
      } else if (subcommand === 'list') output(listDeliverables());
      else if (subcommand === 'coverage') output(checkDeliverableCoverage());
      else if (!subcommand) output(conceptHelp('deliverable'));
      else throw new Error('Usage: skeinn deliverable add|list|coverage');
      break;
    }
    case 'task': {
      if (argv.includes('--help') && ['plan', 'update', 'block', 'done'].includes(subcommand)) output(structuredHelp(`task-${subcommand}`));
      else if (subcommand === 'plan') output(importTasks(jsonFile()));
      else if (subcommand === 'status') output(taskSummary(loadProject().taskStore.tasks));
      else if (subcommand === 'next') output(getTask());
      else if (subcommand === 'get') {
        if (!rest[0]) throw new Error('Usage: skeinn task get <id>');
        output(getTask(rest[0]));
      } else if (subcommand === 'start') {
        if (!rest[0]) throw new Error('Usage: skeinn task start <id>');
        output(startTask(rest[0]));
      } else if (subcommand === 'update') {
        if (!rest[0]) throw new Error('Usage: skeinn task update <id> --json-file <patch.json>');
        output(updateTask(rest[0], jsonFile()));
      } else if (subcommand === 'block') {
        if (!rest[0]) throw new Error('Usage: skeinn task block <id> --json-file <block.json>');
        output(blockTask(rest[0], jsonFile()));
      } else if (subcommand === 'reopen') {
        if (!rest[0]) throw new Error('Usage: skeinn task reopen <id>');
        output(reopenTask(rest[0], { reason: option('--reason') }));
      } else if (subcommand === 'done') {
        if (!rest[0]) throw new Error('Usage: skeinn task done <id> --json-file <evidence.json>');
        output(completeTask(rest[0], jsonFile()));
      } else if (!subcommand || argv.includes('--help')) output(conceptHelp('task'));
      else throw new Error('Usage: skeinn task plan|status|next|get|start|update|block|reopen|done');
      break;
    }
    case 'review':
      if (subcommand && subcommand !== '--help') throw new Error('Usage: skeinn review [--help]');
      output(reviewHelp());
      break;
    case 'keeper': {
      if (argv.includes('--help') && subcommand === 'record') output(structuredHelp('keeper-record'));
      else if (!subcommand || argv.includes('--help')) output(reviewHelp());
      else if (subcommand === 'prompt') output(getKeeperPrompt());
      else if (subcommand === 'record') output(recordKeeper(jsonFile()));
      else if (subcommand === 'skip') output(skipKeeper(option('--reason')));
      else throw new Error('Usage: skeinn keeper prompt|record|skip');
      break;
    }
    case 'eval':
      if (argv.includes('--help') && subcommand === 'scaffold') output(structuredHelp('eval-scaffold'));
      else {
        if (subcommand !== 'scaffold') throw new Error('Usage: skeinn eval scaffold --json-file <scenario.json>');
        output(scaffoldEval(jsonFile()));
      }
      break;
    default:
      throw new Error(`Unknown command: ${command}\n\n${help()}`);
  }
} catch (error) {
  const topic = activeStructuredHelpTopic();
  const pointer = topic && !argv.includes('--help') ? `\nRun ${STRUCTURED_HELP[topic].usage.replace(/ --json-file .+$/, ' --help').replace(/ <id>/, '')} for a canonical payload.` : '';
  fail(`${error.message}${pointer}`);
}
