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
  closeTask,
  compileContext,
  confirmCapability,
  configureRuntime,
  createCapability,
  createDesign,
  exemptCapabilities,
  focusTask,
  recordCheckpoint,
  recordDecision,
  resetKeeper,
  resolveFinding,
  getCapability,
  getCapabilityStatus,
  getDesign,
  getCheckpointPrompt,
  getKeeperPrompt,
  getTask,
  importTasks,
  initProject,
  listCapabilities,
  listDeliverables,
  listDesigns,
  listTasks,
  loadProject,
  markReady,
  recordKeeper,
  recordUnderstanding,
  reopenTask,
  resolveClarify,
  scaffoldEval,
  skipKeeper,
  startClarify,
  taskSummary,
  updateTask,
} from '../src/store.js';
import { promptCatalog } from '../src/protocol.js';

const argv = process.argv.slice(2);

// Extract global options without shifting positional command routing
function option(name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function stripGlobalFlags(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (['--state', '--state-dir', '--human-channel'].includes(args[i])) {
      i += 1;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

const positional = stripGlobalFlags(argv);
const [command, subcommand, ...rest] = positional;

function output(value) {
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function signpost(removedCmd, replacement) {
  throw new Error(`"${removedCmd}" was removed in Skeinn v3.0 -> use: ${replacement}`);
}

function readJsonInput() {
  if (argv.includes('--stdin')) {
    const raw = readFileSync(0, 'utf8').trim();
    if (!raw) throw new Error('--stdin received empty input');
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid JSON on stdin: ${error.message}`);
    }
  }
  const inline = option('--json');
  if (inline !== undefined) {
    try {
      return JSON.parse(inline);
    } catch (error) {
      throw new Error(`Invalid JSON in --json: ${error.message}`);
    }
  }
  const path = option('--json-file');
  if (path) {
    try {
      return JSON.parse(readFileSync(resolve(path), 'utf8'));
    } catch (error) {
      throw new Error(`Cannot read JSON file ${path}: ${error.message}`);
    }
  }
  throw new Error('This command requires JSON input via --stdin, --json \'<json>\', or --json-file <path>');
}

function help() {
  return `skeinn v3 — intent-only, reality-derived continuity infrastructure for Agents

The human talks naturally to the Agent. The Agent uses these commands silently.

Typical flow:
  1. skeinn init                          — create .skeinn/ skeleton + AGENTS.md (v3 anchor)
  2. skeinn record --stdin                — confirm facts, assumptions, open questions
  3. skeinn design add                    — one document per consequential decision surface
  4. skeinn capability add                — 1–3 single-file bottleneck domain specs (or exempt)
  5. skeinn deliverable add               — decompose the delivery surface
  6. skeinn task plan --stdin             — write Tasks (outcome, acceptance, boundaries, optional locks)
  7. skeinn project ready                 — freeze horizon-scoped prepared_scope for Launch Keeper
  8. skeinn keeper prompt -> record       — fresh Agent audits Launch; seeds Git Review Window anchor
  9. skeinn task focus -> close           — focus (zero gate, surfaces advisories) & close (--evidence or --stdin)
  10. skeinn check                        — verify health, 3 sentinels, review window, and drift

Start and resume
  skeinn init [--refresh-agents]
  skeinn context [--task TASK-001] [--keeper] [--checkpoint] [--full] [--human-channel available|unavailable]
  skeinn check

Preserve understanding
  skeinn record --stdin | --json <json> | --json-file <path>
  skeinn decision --stdin | --json <json> | --json-file <path>
  skeinn clarify start --reason <text> | resolve --stdin | close | status
  skeinn project ready [--force-round --reason <text>]
  skeinn design add <slug> --title <text> --kind <product|experience|system|contract|verification|operations|research>
  skeinn design list | get <slug>
  skeinn capability add <slug> --title <field> [--mode external_researched|codebase_grounded|offline_reflection]
  skeinn capability list | get <slug> | status <slug> | confirm <slug> --scenario <text> --source human|agent
  skeinn capability exempt --reason <text>

Map the delivery surface
  skeinn deliverable add <slug> --title <text> --kind <module|feature|behavior|interface|artifact|operational|verification|other>
  skeinn deliverable list | coverage

Maintain the work map
  skeinn task plan --stdin | --json <json> | --json-file <path>
  skeinn task list [--status open|active|blocked|done]
  skeinn task status | next | get <id>
  skeinn task focus <id> [--lane <name>]
  skeinn task close <id> --evidence "<proof>" | --stdin | --json <json> | --json-file <path>
  skeinn task update <id> --stdin | --json <json> | --json-file <path>
  skeinn task block <id> --stdin | --json <json> | --json-file <path>
  skeinn task reopen <id> [--reason <reason>]

Independent Keeper (Launch & In-Flight Checkpoint)
  skeinn keeper --help
  skeinn keeper prompt [--checkpoint] [--milestone <name>]
  skeinn keeper record [--checkpoint] --stdin | --json <json> | --json-file <path>
  skeinn keeper resolve <FND-ID> --evidence "<proof>"
  skeinn keeper skip --reason <reason>
  skeinn keeper reset --reason <reason>

Evaluate Skeinn itself
  skeinn eval scaffold --stdin | --json <json> | --json-file <path>

Parallel worktrees & sidecar state
  Linked git worktrees automatically share the main worktree's .skeinn/ while sensing git diff in
  their own worktree. Override explicitly with --state <path> or SKEINN_STATE=<path>.
  (For benchmark sidecars outside a scored workspace, --state-dir <path> remains supported.)

Help topics:
  skeinn help <record|decision|task-plan|task-update|task-block|task-close|keeper-record|eval-scaffold|clarify-resolve|prompts>
  skeinn help <shaping|design|capability|task|deliverable|clarify>`;
}

const STRUCTURED_HELP = {
  record: {
    usage: 'skeinn record --stdin',
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
    usage: 'skeinn decision --stdin',
    example: { summary: 'What changed and why.', changes: ['.skeinn/design/system.md', 'src/system.js'], affected_tasks: ['TASK-001'] },
  },
  'task-plan': {
    usage: 'skeinn task plan --stdin',
    example: {
      tasks: [{
        title: 'Create one verifiable result',
        outcome: 'A concrete artifact behaves as specified.',
        acceptance: [{ criterion: 'Observable condition', verify_by: 'Exact command or review method', evidence: '' }],
        boundaries: ['Does not change unrelated behavior'],
        locks: ['src/result.js'],
        guardrails: ['Concrete specialist red line inherited from capability/design'],
        depends_on: [],
        reads: ['.skeinn/PROJECT.md', '.skeinn/design/system.md'],
        implements: '.skeinn/design/system.md#Responsibility',
        covers: ['DLV-001'],
      }],
    },
  },
  'task-update': {
    usage: 'skeinn task update <id> --stdin',
    example: { progress: { completed: ['Finished checkpoint'], current: 'Verifying behavior', next: 'Run the named acceptance check' } },
  },
  'task-block': {
    usage: 'skeinn task block <id> --stdin',
    example: { reason: 'A concrete dependency or authority is unavailable.', recovery_conditions: ['Observable condition that permits resuming'], evidence: ['Inspection or command output showing the block'] },
  },
  'task-close': {
    usage: 'skeinn task close <id> --evidence "<proof>"  # or --stdin for per-criterion mapping',
    example: { evidence: ['Overall reproducible verification result'], acceptance_results: [{ criterion: 'Exact acceptance criterion from the Task', evidence: 'Concrete command, artifact, or observation' }] },
  },
  'keeper-record': {
    usage: 'skeinn keeper record [--checkpoint] --stdin',
    example: {
      run_id: 'fresh-agent-run-001',
      prepared_digest: '<digest from skeinn project ready>',
      verdict: 'passed',
      review: { mode: 'independent', reviewer_id: 'fresh-agent-001', evidence: 'Host opened a separate Agent without the shaping conversation.' },
      summary: 'Build-readiness judgment.',
      gaps: [],
      evidence: ['Files and observations supporting the verdict'],
    },
  },
  'eval-scaffold': {
    usage: 'skeinn eval scaffold --stdin',
    example: { id: 'EVAL-001', title: 'Offline tool 3-baton relay', mode: 'relay', budget_cny: 20, brief: 'Identical brief for both conditions.', pivot: 'Mid-flight requirement change injected at Baton 2.', hidden_user_facts: ['Fact revealed by the same answer script'], hidden_checks: ['Zero external network calls', 'Reload restores state'], human_channel: 'unavailable', success_criteria: ['Fresh Agent finishes Baton 2 and Baton 3 without regressions'], repetitions: 1 },
  },
  'clarify-resolve': {
    usage: 'skeinn clarify resolve --stdin',
    example: { answers: [{ id: 'Q-001', resolution: 'User confirmed the new direction' }], confirmed: ['New confirmed fact'], retire_assumptions: ['A-001'], decisions: [{ title: 'Decision title', decision: 'Current decision.', rationale: 'Why it follows.', supersedes: [], affects: ['.skeinn/design/x.md'] }], new_questions: [{ question: 'Still open?', recommendation: 'Your recommended answer', impact: 'high' }] },
  },
};

const CONCEPT_HELP = {
  shaping: `skeinn shaping — the iterative loop that makes a project resumable and strong

record -> iterate Design & 1–3 bottleneck Capabilities -> deliverable -> task plan -> project ready.
Design surfaces hard decisions; Capabilities research how real practitioners solve them and feed
operational rules + Before -> After Design delta back into Design. No silent Capability skips: add
1–3 bottleneck domains or explicitly record skeinn capability exempt --reason.`,

  design: `skeinn design — one document per consequential decision surface

Core design docs (product, experience, system, contract) compare at least two genuinely viable
alternatives (no strawmen), compile applied capability rules into mechanisms, and name how the work
could look done yet fail.
skeinn design add <slug> --title <text> --kind <product|experience|system|contract|verification|operations|research>`,

  capability: `skeinn capability — real practitioner research + project reflection, in one file

One single .md file per recognizable field (1–3 bottleneck domains). Three sections:
1. How real practitioners operate (verifiable external sources; never agent-authored filler)
2. Reflection for this project (what fits, what to adapt/refuse, where ordinary AI feels amateur)
3. Operational rules and Design delta (quality bar, tradeoffs, anti-patterns, probes, Before -> After delta)
Commands: skeinn capability add <slug> --title <field> [--mode external_researched|codebase_grounded|offline_reflection]
Explicit skip: skeinn capability exempt --reason <text>`,

  task: `skeinn task — one verifiable unit of real work

Required: outcome + acceptance[criterion/verify_by/evidence] + boundaries + reads + implements|design_exemption + covers + depends_on.
Optional: locks[] (machine-checked path prefixes), guardrails[] (1–3 specialist red lines), kind (delivery|spike).
Git automatically derives actual_touches on close; no manual touches checklist required.
Commands: skeinn task plan | list | status | next | get | focus | close | update | block | reopen`,

  deliverable: `skeinn deliverable — the delivery surface, decomposed

One deliverable is one observable thing the project must produce. Tasks claim coverage via covers.
Commands: skeinn deliverable add | list | coverage.`,

  clarify: `skeinn clarify — frontier inquiry for direction changes

Open when the human changes direction, requests a redesign, or contradicts project truth.
Commands: skeinn clarify start --reason <text> | resolve --stdin | close | status.`,
};

function keeperHelp() {
  return `Skeinn Keeper v3 guide (Launch + In-Flight Checkpoint)

1. Launch (one-time pre-build birth certificate):
   - Shaping Agent runs \`skeinn project ready\` (freezes horizon-scoped \`prepared_scope\` map).
   - Host opens a fresh Agent without shaping chat: run \`skeinn keeper prompt\`, then
     \`skeinn context --keeper\`, inspect referenced files, and record with
     \`skeinn keeper record --stdin\`.
   - Zero blocking gaps in the active horizon passes Launch (\`passed\` or \`passed_with_advisories\`),
     pinning minor advisories to their \`scope\` and seeding the Git Review Window anchor.
   - Round 2+ runs in Delta Re-check Mode (prior blocking closures + repair diff zone only).

2. In-Flight Checkpoint (reality-derived audit):
   - Triggered when the Sentinel fires (~5 closed delivery tasks) or the Review Window turns heavy
     (>= 8 files, >= 400 lines, >= 3 top-level dirs, shared surface hit, modified design doc, or
     lost anchor).
   - Fresh Agent runs \`skeinn keeper prompt --checkpoint\`, then \`skeinn context --checkpoint\`,
     audits real Git diff vs Design intent, and records \`skeinn keeper record --checkpoint --stdin\`.
   - A \`clean\` checkpoint advances the Review Window anchor (\`last_reviewed_commit\` + worktree map).
   - Pin resolution: \`skeinn keeper resolve <FND-ID> --evidence "<proof>"\`.
   - Emergency relaunch: \`skeinn keeper reset --reason "<why>"\`.`;
}

function structuredHelp(topic) {
  if (topic === 'prompts') return promptCatalog();
  if (['keeper', 'keeper-prompt'].includes(topic)) return keeperHelp();
  if (topic === 'keeper-record') {
    return `${STRUCTURED_HELP[topic].usage}\n\nCanonical JSON payload:\n${JSON.stringify(STRUCTURED_HELP[topic].example, null, 2)}\n\nFor a revised pass, add closure_results: [{"gap":"<exact prior gap text>","evidence":"<observed closure proof>"}].`;
  }
  const entry = STRUCTURED_HELP[topic];
  if (!entry) {
    const concept = CONCEPT_HELP[topic];
    if (concept) return concept;
    throw new Error(`Unknown help topic: ${topic}. Payload topics: ${Object.keys(STRUCTURED_HELP).join(', ')}, prompts. Concept topics: ${Object.keys(CONCEPT_HELP).join(', ')}`);
  }
  return `${entry.usage}\n\nCanonical JSON payload:\n${JSON.stringify(entry.example, null, 2)}`;
}

function activeStructuredHelpTopic() {
  if (command === 'record' || command === 'decision') return command;
  if (command === 'clarify' && subcommand === 'resolve') return 'clarify-resolve';
  if (command === 'task' && ['plan', 'update', 'block', 'close'].includes(subcommand)) return `task-${subcommand}`;
  if (command === 'keeper' && subcommand === 'record') return 'keeper-record';
  if (command === 'eval' && subcommand === 'scaffold') return 'eval-scaffold';
  return '';
}

try {
  const explicitState = option('--state');
  const sidecarDir = option('--state-dir');
  configureRuntime({ state: explicitState, stateDir: sidecarDir, enforceOutside: Boolean(sidecarDir && !explicitState) });
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
      output(initProject(undefined, { refreshAgents: argv.includes('--refresh-agents') }));
      break;
    case 'context':
      output(compileContext({
        taskId: option('--task'),
        keeper: argv.includes('--keeper'),
        checkpoint: argv.includes('--checkpoint'),
        full: argv.includes('--full'),
        humanChannel: humanChannel || 'available',
      }));
      break;
    case 'resume':
      signpost('skeinn resume', 'skeinn context');
      break;
    case 'review':
      signpost('skeinn review', 'skeinn keeper --help');
      break;
    case 'prompts':
      signpost('skeinn prompts', 'skeinn help prompts');
      break;
    case 'record':
      output(subcommand === '--help' ? structuredHelp('record') : recordUnderstanding(readJsonInput()));
      break;
    case 'clarify': {
      if (argv.includes('--help') && subcommand === 'resolve') output(structuredHelp('clarify-resolve'));
      else if (subcommand === '--help' || (argv.includes('--help') && !subcommand)) output(CONCEPT_HELP.clarify);
      else if (subcommand === 'start') output(startClarify({ reason: option('--reason') }));
      else if (subcommand === 'resolve') output(resolveClarify(readJsonInput()));
      else if (subcommand === 'close') output(closeClarify());
      else if (!subcommand || subcommand === 'status') output(clarifyStatus());
      else throw new Error('Usage: skeinn clarify start|resolve|close|status');
      break;
    }
    case 'decision':
      output(subcommand === '--help' ? structuredHelp('decision') : recordDecision(readJsonInput()));
      break;
    case 'check': {
      const result = checkProject();
      output(result);
      if (!result.healthy) process.exitCode = 1;
      break;
    }
    case 'project':
      if (subcommand !== 'ready') throw new Error('Usage: skeinn project ready [--force-round --reason <text>]');
      output(markReady(undefined, { forceRound: argv.includes('--force-round'), reason: option('--reason') }));
      break;
    case 'design': {
      if (argv.includes('--help')) output(CONCEPT_HELP.design);
      else if (subcommand === 'add') {
        const slug = rest[0];
        if (!slug) throw new Error('Usage: skeinn design add <slug> --title <text> --kind <kind>');
        output(createDesign(slug, { title: option('--title'), kind: option('--kind') }));
      } else if (subcommand === 'list') output(listDesigns());
      else if (subcommand === 'get') {
        if (!rest[0]) throw new Error('Usage: skeinn design get <slug>');
        output(getDesign(rest[0]));
      } else if (!subcommand) output(CONCEPT_HELP.design);
      else throw new Error('Usage: skeinn design add|list|get');
      break;
    }
    case 'capability': {
      if (argv.includes('--help')) output(CONCEPT_HELP.capability);
      else if (subcommand === 'add') {
        const slug = rest[0];
        if (!slug) throw new Error('Usage: skeinn capability add <slug> --title <text> [--mode external_researched|codebase_grounded|offline_reflection]');
        output(createCapability(slug, { title: option('--title'), mode: option('--mode') }));
      } else if (subcommand === 'exempt') {
        output(exemptCapabilities(option('--reason')));
      } else if (subcommand === 'list') output(listCapabilities());
      else if (subcommand === 'get') {
        if (!rest[0]) throw new Error('Usage: skeinn capability get <slug>');
        output(getCapability(rest[0]));
      } else if (subcommand === 'confirm') {
        if (!rest[0]) throw new Error('Usage: skeinn capability confirm <slug> --scenario <text> --source human|agent');
        output(confirmCapability(rest[0], { scenario: option('--scenario'), source: option('--source') }));
      } else if (subcommand === 'status') {
        if (!rest[0]) throw new Error('Usage: skeinn capability status <slug>');
        output(getCapabilityStatus(rest[0]));
      } else if (subcommand === 'research') {
        signpost('skeinn capability research', 'skeinn capability add <slug> --title "<field>"');
      } else if (subcommand === 'synthesize') {
        signpost('skeinn capability synthesize', 'skeinn capability add <slug> --title "<field>"');
      } else if (!subcommand) output(CONCEPT_HELP.capability);
      else throw new Error('Usage: skeinn capability add|exempt|list|get|status|confirm');
      break;
    }
    case 'deliverable': {
      if (argv.includes('--help')) output(CONCEPT_HELP.deliverable);
      else if (subcommand === 'add') {
        const slug = rest[0];
        if (!slug) throw new Error('Usage: skeinn deliverable add <slug> --title <text> --kind <kind>');
        output(addDeliverable(slug, { title: option('--title'), kind: option('--kind'), notes: option('--notes') }));
      } else if (subcommand === 'list') output(listDeliverables());
      else if (subcommand === 'coverage') output(checkDeliverableCoverage());
      else if (!subcommand) output(CONCEPT_HELP.deliverable);
      else throw new Error('Usage: skeinn deliverable add|list|coverage');
      break;
    }
    case 'task': {
      if (argv.includes('--help') && ['plan', 'update', 'block', 'close'].includes(subcommand)) output(structuredHelp(`task-${subcommand}`));
      else if (subcommand === 'plan') output(importTasks(readJsonInput()));
      else if (subcommand === 'list') output(listTasks({ status: option('--status') }));
      else if (subcommand === 'status') output(taskSummary(loadProject().taskStore.tasks));
      else if (subcommand === 'next') output(getTask());
      else if (subcommand === 'get') {
        if (!rest[0]) throw new Error('Usage: skeinn task get <id>');
        output(getTask(rest[0]));
      } else if (subcommand === 'focus') {
        if (!rest[0]) throw new Error('Usage: skeinn task focus <id> [--lane <name>]');
        output(focusTask(rest[0], { lane: option('--lane') }));
      } else if (subcommand === 'close') {
        if (!rest[0]) throw new Error('Usage: skeinn task close <id> --evidence "<proof>" | --stdin | --json-file <path>');
        const evidenceLine = option('--evidence');
        const payload = evidenceLine !== undefined ? { evidence_line: evidenceLine } : readJsonInput();
        output(closeTask(rest[0], payload));
      } else if (subcommand === 'start') {
        signpost('skeinn task start', 'skeinn task focus <id>');
      } else if (subcommand === 'done') {
        signpost('skeinn task done', 'skeinn task close <id> --evidence "<proof>" (or --stdin)');
      } else if (subcommand === 'update') {
        if (!rest[0]) throw new Error('Usage: skeinn task update <id> --stdin | --json-file <patch.json>');
        output(updateTask(rest[0], readJsonInput()));
      } else if (subcommand === 'block') {
        if (!rest[0]) throw new Error('Usage: skeinn task block <id> --stdin | --json-file <block.json>');
        output(blockTask(rest[0], readJsonInput()));
      } else if (subcommand === 'reopen') {
        if (!rest[0]) throw new Error('Usage: skeinn task reopen <id> [--reason <reason>]');
        output(reopenTask(rest[0], { reason: option('--reason') }));
      } else if (!subcommand || argv.includes('--help')) output(CONCEPT_HELP.task);
      else throw new Error('Usage: skeinn task plan|list|status|next|get|focus|close|update|block|reopen');
      break;
    }
    case 'keeper': {
      if (argv.includes('--help') && subcommand === 'record') output(structuredHelp('keeper-record'));
      else if (!subcommand || argv.includes('--help')) output(keeperHelp());
      else if (subcommand === 'prompt') {
        output(argv.includes('--checkpoint') ? getCheckpointPrompt({ milestone: option('--milestone') }) : getKeeperPrompt());
      } else if (subcommand === 'record') {
        output(argv.includes('--checkpoint') ? recordCheckpoint(readJsonInput()) : recordKeeper(readJsonInput()));
      } else if (subcommand === 'skip') output(skipKeeper(option('--reason')));
      else if (subcommand === 'resolve') {
        if (!rest[0]) throw new Error('Usage: skeinn keeper resolve <FND-ID> --evidence "<proof>"');
        output(resolveFinding(rest[0], { evidence: option('--evidence') }));
      } else if (subcommand === 'reset') {
        output(resetKeeper(option('--reason')));
      } else if (subcommand === 'checkpoint') {
        signpost('skeinn keeper checkpoint', 'skeinn keeper prompt --checkpoint | skeinn keeper record --checkpoint --stdin');
      } else throw new Error('Usage: skeinn keeper prompt|record|resolve|skip|reset');
      break;
    }
    case 'eval':
      if (argv.includes('--help') && subcommand === 'scaffold') output(structuredHelp('eval-scaffold'));
      else {
        if (subcommand !== 'scaffold') throw new Error('Usage: skeinn eval scaffold --stdin | --json-file <scenario.json>');
        output(scaffoldEval(readJsonInput()));
      }
      break;
    default:
      throw new Error(`Unknown command: ${command}\n\n${help()}`);
  }
} catch (error) {
  const topic = activeStructuredHelpTopic();
  const pointer = topic && !argv.includes('--help') ? `\nRun skeinn help ${topic} for a canonical payload.` : '';
  fail(`${error.message}${pointer}`);
}
