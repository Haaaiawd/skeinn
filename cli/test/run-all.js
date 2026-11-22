import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('cli/bin/skeinn.js');
const roots = [];
let passed = 0;

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'skeinn-v2-'));
  roots.push(root);
  return root;
}

function run(root, args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (result.status !== expected) {
    throw new Error(`Command failed (${result.status}, expected ${expected}): skeinn ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return expected === 0 ? result.stdout.trim() : (result.stderr.trim() || result.stdout.trim());
}

function runWithStdin(root, args, stdinText, expected = 0, envExtra = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, input: stdinText, encoding: 'utf8', env: { ...process.env, ...envExtra } });
  if (result.status !== expected) {
    throw new Error(`Command failed (${result.status}, expected ${expected}): skeinn ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return expected === 0 ? result.stdout.trim() : (result.stderr.trim() || result.stdout.trim());
}

function json(root, name, value) {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

function independentReview(reviewerId) {
  return { mode: 'independent', reviewer_id: reviewerId, evidence: 'Host opened a separate Agent without the shaping conversation.' };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message.replaceAll('\n', '\n    ')}`);
    process.exitCode = 1;
  }
}

console.log('Skeinn v2 minimal loop');

test('init creates one small, human-readable project skeleton', () => {
  const root = workspace();
  const result = JSON.parse(run(root, ['init']));
  assert(result.initialized === true, 'init should initialize');
  for (const file of ['.skeinn/PROJECT.md', '.skeinn/STRUCTURE.md', '.skeinn/DECISIONS.md', '.skeinn/state.json', '.skeinn/tasks.json', '.skeinn/deliverables.json']) {
    assert(existsSync(join(root, file)), `${file} missing`);
  }
  assert(result.files.includes('AGENTS.md'), 'init file list must include the AGENTS.md anchor it creates');
  assert(existsSync(join(root, '.skeinn', 'design')), 'design directory missing');
  assert(existsSync(join(root, '.skeinn', 'capabilities')), 'capability directory missing');
  assert(!existsSync(join(root, '.skeinn', 'v1')), 'v2 must not recreate version ceremony');
  assert(readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('skeinn context'), 'Agent anchor missing');
  assert(readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('after a context reset'), 'Agent recovery trigger missing');
  assert(readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('absolute path'), 'Agent anchor should explain source-checkout CLI recovery');
  assert(JSON.parse(run(root, ['init'])).reason === 'already_initialized', 'repeat init should be safe');
});

test('context teaches adaptive question judgment without a fixed questionnaire', () => {
  const root = workspace();
  run(root, ['init']);
  const context = run(root, ['context', '--full']);
  assert(context.includes('uncertainty frontier'), 'uncertainty frontier missing');
  assert(context.includes('do not follow a fixed questionnaire'), 'adaptive questioning rule missing');
  assert(context.includes('The human talks naturally to you'), 'invisible CLI boundary missing');
  assert(context.includes('one recognizable field') || context.includes('recognizable field'), 'professional field boundary missing');
  assert(context.includes('Do not compress a complex product into PROJECT.md'), 'document graph rule missing');
  assert(!context.includes('# Skeinn active Task execution protocol'), 'execution protocol inflated shaping context');
  const prompts = JSON.parse(run(root, ['help', 'prompts']));
  assert(prompts.layers.stable_core.includes('consequential'), 'stable prompt layer missing');
  assert(prompts.layers.environment_adaptation_unavailable.includes('Do not fabricate a user interaction'), 'unattended environment prompt missing');
  assert(prompts.layers.execution_protocol.includes('Recover before changing anything'), 'execution prompt layer missing');
  assert(prompts.composition.active_task.includes('execution_protocol'), 'execution prompt is not composed into active Tasks');
  assert(Object.keys(prompts.templates.design_documents).length === 7, 'design prompt inventory incomplete');
  assert(prompts.evaluation.blind_judge.includes('anonymized runs'), 'eval prompt inventory incomplete');
  assert(!context.includes('Capability Graph'), 'legacy ceremony leaked into v2 context');
  const lean = run(root, ['context']);
  assert(lean.includes('skeinn context --full'), 'default lean output must point first-entry agents at --full');
  assert(!lean.includes('# Skeinn runtime protocol'), 'default context must omit the static protocol');
  assert(!lean.includes('# Skeinn collaboration core'), 'default context must omit the collaboration core');
  assert(lean.includes('Current Skeinn state'), 'default context must keep the state header');
  assert(lean.includes('Project whole'), 'default context must keep project truth');
});

test('unattended runs use an isolated sidecar without fabricating a human or polluting the workspace', () => {
  const root = workspace();
  const sidecar = workspace();
  run(root, ['init', '--state-dir', sidecar]);
  assert(!existsSync(join(root, '.skeinn')), 'sidecar mode wrote Skeinn state into the scored workspace');
  assert(!existsSync(join(root, 'AGENTS.md')), 'sidecar mode edited the scored workspace anchor');
  assert(existsSync(join(sidecar, 'state.json')), 'sidecar state missing');
  assert(existsSync(join(sidecar, 'PROJECT.md')), 'sidecar project truth missing');
  json(root, 'tasks.json', {
    tasks: [{
      title: 'Read sidecar project truth',
      outcome: 'The Agent can load continuity state without editing the scored workspace.',
      done_when: ['Context loads the project truth from the isolated sidecar.'],
      boundaries: ['Do not write Skeinn state into the scored workspace.'],
      reads: ['.skeinn/PROJECT.md'],
      touches: ['output.txt'],
    }],
  });
  run(root, ['task', 'plan', '--state-dir', sidecar, '--json-file', 'tasks.json']);
  const context = run(root, ['context', '--task', 'TASK-001', '--state-dir', sidecar, '--human-channel', 'unavailable', '--full']);
  assert(context.includes('Human response channel: unavailable'), 'unattended environment was not injected');
  assert(context.includes('Do not fabricate a user interaction'), 'unattended context may invent a user');
  assert(context.includes('never use web research as a substitute for user intent'), 'research boundary missing');
  assert(context.includes('## Project whole (.skeinn/PROJECT.md)'), 'sidecar project truth was not mapped back to its virtual Skeinn reference');
  assert(JSON.parse(run(root, ['check', '--state-dir', sidecar])).healthy === true, 'sidecar task references are not checkable');
  assert(run(root, ['context', '--state-dir', sidecar, '--human-channel', 'unknown'], 1).includes('must be available or unavailable'), 'invalid human channel accepted');
  assert(run(root, ['init', '--state-dir', join(root, 'bad-sidecar')], 1).includes('outside the scored workspace'), 'workspace-local sidecar accepted');
});

test('record preserves facts, assumptions, uncertainty, and superseding decisions', () => {
  const root = workspace();
  run(root, ['init']);
  json(root, 'record.json', {
    confirmed: ['The human speaks naturally to the Agent.'],
    assumptions: [{ text: 'The first release is local-only.', source: 'agent' }],
    unresolved: [{ question: 'May the first release change remote state?', impact: 'high' }],
    decisions: [{ title: 'Agent-only CLI', decision: 'The CLI remains invisible to humans.', rationale: 'Skeinn supports the Agent rather than becoming user workflow.', supersedes: [] }],
  });
  const state = JSON.parse(run(root, ['record', '--json-file', 'record.json']));
  assert(state.confirmed[0].id === 'F-001', 'fact id missing');
  assert(state.assumptions[0].id === 'A-001', 'assumption id missing');
  assert(state.unresolved[0].id === 'Q-001', 'question id missing');
  const decisions = readFileSync(join(root, '.skeinn', 'DECISIONS.md'), 'utf8');
  assert(decisions.includes('D-001: Agent-only CLI'), 'decision history missing');
  assert(decisions.includes('Supersedes: none'), 'superseding record missing');
  assert(!run(root, ['context']).includes('D-001: Agent-only CLI'), 'full decision history should remain on demand');
});

test('design documents scale by system while single-file capabilities keep professional fields separate', () => {
  const root = workspace();
  run(root, ['init']);
  run(root, ['design', 'add', 'first-use-flow', '--title', 'First-use flow', '--kind', 'experience']);
  run(root, ['design', 'add', 'local-state', '--title', 'Local state system', '--kind', 'system']);
  assert(JSON.parse(run(root, ['design', 'list'])).length === 2, 'design document list mismatch');
  const sysDesign = run(root, ['design', 'get', 'local-state']);
  assert(sysDesign.includes('## Data and state'), 'system design template missing');
  assert(sysDesign.includes('## Alternatives considered'), 'core design template must require alternatives comparison');
  assert(sysDesign.includes('## Applied capabilities'), 'design template must bind applied capabilities');
  assert(sysDesign.includes('## How this could look done yet fail'), 'design template must include falsifiable failure surface');
  run(root, ['capability', 'add', 'ui-ux-design', '--title', 'UI/UX design']);
  run(root, ['capability', 'add', 'behavioral-psychology', '--title', 'Behavioral psychology', '--mode', 'offline_reflection']);
  const cap = run(root, ['capability', 'get', 'ui-ux-design']);
  assert(cap.includes('One file covers one recognizable professional field'), 'field boundary missing');
  assert(cap.includes('## How real practitioners operate'), 'practitioner research section missing');
  assert(cap.includes('## Reflection for this project'), 'project reflection section missing');
  assert(cap.includes('## Operational rules and Design delta'), 'operational rules and design delta section missing');
  assert(JSON.parse(run(root, ['capability', 'list'])).length === 2, 'capability list mismatch');
  assert(existsSync(join(root, '.skeinn', 'capabilities', 'ui-ux-design.md')), 'single-file capability.md missing');
  const status = JSON.parse(run(root, ['capability', 'status', 'ui-ux-design']));
  assert(status.format === 'single-file' && status.mode === 'external_researched' && status.ready === false, 'initial single-file capability status mismatch');
  const templateWarnings = JSON.parse(run(root, ['check'])).warnings.join('\n');
  assert(templateWarnings.includes('Design document still contains template instructions'), 'design template residue warning missing');
  assert(templateWarnings.includes('still contains template instructions'), 'capability template residue warning missing');
});

test('single-file capability rejects fake agent-authored sources and missing Design delta', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nVerify that external_researched capabilities cannot pass with agent-authored filler or zero Design delta.\n\n## People and reality\nEngineers building a real app.\n\n## Whole behavior\nCapability research must cite real external sources and change a concrete Design decision.\n\n## Boundaries\nTest only.\n\n## Completion and failure\nFake research is rejected at project ready.\n`, 'utf8');
  run(root, ['design', 'add', 'ui', '--title', 'UI Design', '--kind', 'experience']);
  writeFileSync(join(root, '.skeinn', 'design', 'ui.md'), `# UI Design\n\n- Kind: experience\n- Status: ready\n\n## Applied capabilities\nUses ui-ux-design.\n\n## Alternatives considered\nOption A: single-column calm layout. Option B: multi-pane dashboard (rejected due to cognitive load).\n\n## Experience intent\nCalm single-flow UI.\n`, 'utf8');
  run(root, ['capability', 'add', 'ui-ux-design', '--title', 'UI/UX design']);
  const capPath = join(root, '.skeinn', 'capabilities', 'ui-ux-design.md');
  json(root, 'tasks.json', { tasks: [{ title: 'Build UI', outcome: 'A calm single-flow UI renders cleanly on disk', done_when: ['UI file exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/ui.md'], touches: ['ui.html'], implements: '.skeinn/design/ui.md#Experience intent' }] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);

  // 1. Fake agent-authored citation must be rejected
  writeFileSync(capPath, `# UI/UX design\n\n- Mode: external_researched\n- Authority: agent_provisional\n\n## Field identity and boundary\nUI/UX craft.\n\n## How real practitioners operate\n- Practice 1: Keep flows short — Source: internal synthesis (agent-authored)\n\n## Reflection for this project\nShort flows fit.\n\n## Operational rules and Design delta\n- Quality bar: crisp hierarchy\n- Design delta (Before -> After): Switched from multi-pane to single-column.\n`, 'utf8');
  const fakeErr = run(root, ['project', 'ready'], 1);
  assert(fakeErr.includes('agent-authored'), 'ready must reject agent-authored fake research');

  // 2. Real external source but missing Design delta must be rejected
  writeFileSync(capPath, `# UI/UX design\n\n- Mode: external_researched\n- Authority: agent_provisional\n\n## Field identity and boundary\nUI/UX craft.\n\n## How real practitioners operate\n- Practice 1: Progressive disclosure in Linear — Source: https://linear.app/method\n\n## Reflection for this project\nProgressive disclosure fits our local tool.\n\n## Operational rules and Design delta\n- Quality bar: crisp hierarchy\n`, 'utf8');
  const deltaErr = run(root, ['project', 'ready'], 1);
  assert(deltaErr.includes('Design delta'), 'ready must reject capability with no Design delta');

  // 3. Real external source + Design delta passes ready
  writeFileSync(capPath, `# UI/UX design\n\n- Mode: external_researched\n- Authority: agent_provisional\n\n## Field identity and boundary\nUI/UX craft.\n\n## How real practitioners operate\n- Practice 1: Progressive disclosure in Linear — Source: https://linear.app/method\n\n## Reflection for this project\nProgressive disclosure fits our local tool; we reject multi-pane dashboards.\n\n## Operational rules and Design delta\n- Quality bar: crisp hierarchy\n- Design delta (Before -> After): Replaced 3-panel dashboard with single-column progressive flow in ui.md.\n`, 'utf8');
  const ok = JSON.parse(run(root, ['project', 'ready']));
  assert(ok.ready_for_keeper === true, 'valid external_researched capability should pass ready');
});

test('capability authority provenance and honest offline_reflection degradation stay visible', () => {
  const root = workspace();
  run(root, ['init']);
  run(root, ['capability', 'add', 'game-design', '--title', 'Game design', '--mode', 'offline_reflection']);
  const capPath = join(root, '.skeinn', 'capabilities', 'game-design.md');
  writeFileSync(capPath, `# Game design\n\n- Mode: offline_reflection\n- Authority: agent_provisional\n- Scenario: Calming recovery game.\n\n## Field identity and boundary\nGame design for calming recovery tools.\n\n## How real practitioners operate\nExternal search unavailable in this sandbox; reasoning from core loop pacing and stress-free recovery principles.\n\n## Reflection for this project\nAvoid timers and punitive loss states that trigger performance anxiety.\n\n## Operational rules and Design delta\n- Quality bar: calm pacing\n- Anti-patterns: countdown timers, failure penalties\n- Design delta (Before -> After): Removed score timer from core loop design.\n`, 'utf8');
  assert(run(root, ['capability', 'confirm', 'game-design', '--scenario', 'short', '--source', 'human'], 1).includes('at least 20 characters'), 'confirm should reject short scenarios');
  assert(run(root, ['capability', 'confirm', 'game-design', '--scenario', 'A calming recovery game for stressed professionals needing gentle engagement without time pressure.'], 1).includes('--source human|agent'), 'confirm should require explicit authority provenance');
  const provisionalResult = JSON.parse(run(root, ['capability', 'confirm', 'game-design', '--scenario', 'A calming recovery game for stressed professionals needing gentle engagement without time pressure.', '--source', 'agent']));
  assert(provisionalResult.authority === 'agent_provisional', 'agent-selected scenario should remain agent_provisional');
  const offlineCtx = run(root, ['context', '--human-channel', 'unavailable']);
  assert(offlineCtx.includes('offline_reflection — unverified externally'), 'context must visibly flag offline_reflection');
  assert(offlineCtx.includes('agent_provisional'), 'context must surface provisional authority');
  const checkWarnings = JSON.parse(run(root, ['check'])).warnings.join('\n');
  assert(checkWarnings.includes('offline_reflection (unverified externally)'), 'check must warn on unverified offline_reflection');
  const confirmResult = JSON.parse(run(root, ['capability', 'confirm', 'game-design', '--scenario', 'A calming recovery game for stressed professionals needing gentle engagement without time pressure.', '--source', 'human']));
  assert(confirmResult.authority === 'human_confirmed', 'human confirmation should upgrade authority to human_confirmed');
  assert(JSON.parse(run(root, ['capability', 'status', 'game-design'])).authority === 'human_confirmed', 'status should report human_confirmed');
  assert(run(root, ['capability', 'get', 'game-design']).includes('A calming recovery game for stressed professionals'), 'confirm should write scenario into capability file');
});

test('project ready rejects silent capability omission and audits explicit capability exemption', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA routine cross-platform CLI wrapper where no silent capability skip is permitted and every shaping boundary stays auditable on disk.\n\n## People and reality\nSolo developer running a small cross-platform wrapper script in an isolated project workspace without specialist domain risk.\n\n## Whole behavior\nExplicit capability exemption is recorded in state and audited directly by the independent Keeper during the build-readiness handoff.\n\n## Boundaries\nTest only; no external dependencies or production side effects.\n\n## Completion and failure\nSilent skip fails ready; explicit exemption passes and surfaces in Keeper context.\n`, 'utf8');
  run(root, ['design', 'add', 'cli', '--title', 'CLI Design', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'cli.md'), `# CLI Design\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nWrap one command.\n\n## Alternatives considered\nNode script vs bash wrapper (chose Node for cross-platform safety).\n`, 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Write wrapper', outcome: 'A cross-platform wrapper runs cleanly on disk', done_when: ['Wrapper runs'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/cli.md'], touches: ['wrap.js'], implements: '.skeinn/design/cli.md#Responsibility' }] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const noCapErr = run(root, ['project', 'ready'], 1);
  assert(noCapErr.includes('No capability file exists and no capability exemption is recorded'), 'ready must reject silent capability omission');
  assert(run(root, ['capability', 'exempt', '--reason', 'too short'], 1).includes('at least 15 characters'), 'exempt must reject vague short reasons');
  const exemptRes = JSON.parse(run(root, ['capability', 'exempt', '--reason', 'Routine cross-platform wrapper; standard engineering suffices with no specialist domain bottleneck.']));
  assert(exemptRes.exempted === true, 'exempt should succeed');
  run(root, ['project', 'ready']);
  const keeperCtx = run(root, ['context', '--keeper']);
  assert(keeperCtx.includes('Capability exemption (audit whether standard engineering genuinely suffices)'), 'Keeper context must surface capability exemption for audit');
  assert(keeperCtx.includes('Anti-laziness audit'), 'Keeper prompt must include anti-laziness audit');
});

test('task guardrails inject specialist red lines directly into active task context without capability_hooks tax', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA calming recovery tool with gentle game mechanics.\n\n## People and reality\nA human collaborates naturally while the Agent silently preserves state.\n\n## Whole behavior\nThe Agent clarifies, records, builds a work map, resumes one Task, and proves it done.\n\n## Boundaries\nThe human never has to operate Skeinn. Irreversible work needs authority.\n\n## System shape\nHuman-readable project truth plus structured Task state compiled by a CLI.\n\n## Completion and failure\nA fresh Agent can start without chat memory; document volume alone is failure.\n`, 'utf8');
  run(root, ['design', 'add', 'game-mechanics', '--title', 'Game mechanics system', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'game-mechanics.md'), `# Game mechanics system\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nDefine core game loops for calming engagement.\n\n## Alternatives considered\nSoft reset vs fail-state screen (rejected fail-state because it raises anxiety).\n`, 'utf8');
  run(root, ['capability', 'add', 'game-design', '--title', 'Game design']);
  writeFileSync(join(root, '.skeinn', 'capabilities', 'game-design.md'), `# Game design\n\n- Mode: external_researched\n- Authority: human_confirmed\n\n## Field identity and boundary\nGame design for calming recovery tools.\n\n## How real practitioners operate\n- Practice 1: Cozy games remove punitive timers — Source: https://gdcvault.com/cozy-game-design\n\n## Reflection for this project\nUse soft reset without penalty instead of fail states.\n\n## Operational rules and Design delta\n- Anti-patterns: countdown timers, punitive fail screens\n- Design delta (Before -> After): Replaced fail-state screen with soft reset in game-mechanics.md.\n`, 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Implement game mechanics', outcome: 'Calming game loop with no-loss design', done_when: ['Game loop runs without time pressure'], boundaries: ['No stress mechanics'], guardrails: ['Never add countdown timers or punitive fail states', 'Verify soft reset preserves calm pacing'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/game-mechanics.md'], touches: ['src/game.js'], implements: '.skeinn/design/game-mechanics.md#Responsibility' }] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const readyResult = JSON.parse(run(root, ['project', 'ready']));
  json(root, 'keeper-pass.json', { run_id: 'keeper-activation-001', prepared_digest: readyResult.digest, verdict: 'passed', summary: 'Build-ready.', evidence: ['PROJECT.md and game-design capability verified.'], review: independentReview('fresh-activation-agent') });
  run(root, ['keeper', 'record', '--json-file', 'keeper-pass.json']);
  run(root, ['task', 'focus', 'TASK-001']);
  const context = run(root, ['context']);
  assert(context.includes('## Task guardrails (specialist red lines)'), 'context should inject Task guardrails section');
  assert(context.includes('Never add countdown timers or punitive fail states'), 'context should surface concrete guardrails');
  const checkResult = JSON.parse(run(root, ['check']));
  assert(checkResult.healthy === true, 'Task with guardrails and implements should be healthy without capability_hooks');
});

test('task integrity classification and declared outputs cannot stay false-green', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA small integrity fixture with explicit design and capability links.\n\n## People and reality\nA fresh Agent must not mistake missing links or files for completion.\n\n## Whole behavior\nThe Task declares what it implements, which capability applies, and which output must exist.\n\n## Boundaries\nTest only.\n\n## System shape\nOne design, one capability, one Task.\n\n## Completion and failure\nMissing classification or output is unhealthy.\n`, 'utf8');
  run(root, ['design', 'add', 'integrity', '--title', 'Integrity fixture', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'integrity.md'), '# Integrity fixture\n\n## Responsibility\nRequire honest links.\n', 'utf8');
  run(root, ['capability', 'add', 'quality-assurance', '--title', 'Quality assurance']);
  json(root, 'tasks.json', { tasks: [{ title: 'Produce output', outcome: 'A concrete output file exists with explicit applicability decisions', done_when: ['Output exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md'], touches: ['output.txt'] }] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const openCheck = JSON.parse(run(root, ['check']));
  assert(openCheck.warnings.join('\n').includes('missing implements or design_exemption'), 'open Task should surface missing design applicability');
  json(root, 'classify.json', { implements: '.skeinn/design/integrity.md#Responsibility', capability_exemption: 'Capability research is not required for this file-existence fixture.' });
  run(root, ['task', 'update', 'TASK-001', '--json-file', 'classify.json']);
  const statePath = join(root, '.skeinn', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.keeper.status = 'skipped';
  state.project.status = 'build_ready';
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  run(root, ['task', 'focus', 'TASK-001']);
  json(root, 'done.json', { evidence: ['Claimed output exists'], checks: [{ criterion: 'Output exists', evidence: ['Claimed output exists'] }] });
  // v3.0: touches is optional/historical; actual_touches is git-derived
  writeFileSync(join(root, 'output.txt'), 'done\n', 'utf8');
  run(root, ['task', 'close', 'TASK-001', '--json-file', 'done.json']);
  const healthyCheck = JSON.parse(run(root, ['check']));
  assert(healthyCheck.healthy === true, 'classified completed task should be healthy');
});

test('deliverable coverage check finds uncovered delivery units', () => {
  const root = workspace();
  run(root, ['init']);
  run(root, ['deliverable', 'add', 'game-loop', '--title', 'Core game loop', '--kind', 'module']);
  run(root, ['deliverable', 'add', 'loss-condition', '--title', 'Loss condition design', '--kind', 'behavior']);
  run(root, ['deliverable', 'add', 'playtest-verification', '--title', 'Playtest verification', '--kind', 'verification']);
  const dlvList = JSON.parse(run(root, ['deliverable', 'list']));
  assert(dlvList.length === 3, 'should have 3 deliverables');
  assert(dlvList.every((item) => !item.covered), 'all deliverables should start uncovered');
  const coverage = JSON.parse(run(root, ['deliverable', 'coverage']));
  assert(coverage.uncovered === 3, 'all 3 deliverables should be uncovered');
  const gameLoopId = dlvList.find((item) => item.slug === 'game-loop').id;
  const lossConditionId = dlvList.find((item) => item.slug === 'loss-condition').id;
  json(root, 'tasks.json', { tasks: [
    { title: 'Implement game loop', outcome: 'Core game loop executes without time pressure', done_when: ['Loop executes'], boundaries: ['No scoring system'], reads: ['.skeinn/PROJECT.md'], touches: ['src/loop.js'], covers: [gameLoopId] },
    { title: 'Design loss condition', outcome: 'No-loss design documented for calming gameplay', done_when: ['Loss condition documented'], boundaries: ['No punishment mechanics'], reads: ['.skeinn/PROJECT.md'], touches: ['docs/loss.md'], covers: [lossConditionId] }
  ] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const afterCoverage = JSON.parse(run(root, ['deliverable', 'coverage']));
  assert(afterCoverage.covered === 2, '2 deliverables should be covered');
  assert(afterCoverage.uncovered === 1, '1 deliverable should remain uncovered');
  assert(afterCoverage.uncovered_items[0].slug === 'playtest-verification', 'playtest-verification should be the uncovered one');
  const checkResult = JSON.parse(run(root, ['check']));
  assert(checkResult.warnings.join('\n').includes('Uncovered deliverables: playtest-verification'), 'check should warn about uncovered deliverables');
  assert(checkResult.deliverable_coverage.total === 3, 'check should report deliverable coverage stats');
  assert(checkResult.deliverable_coverage.uncovered === 1, 'check should report uncovered count');
  const updatedDlvList = JSON.parse(run(root, ['deliverable', 'list']));
  assert(updatedDlvList.find((item) => item.slug === 'game-loop').covered === true, 'game-loop should be marked covered');
  assert(updatedDlvList.find((item) => item.slug === 'playtest-verification').covered === false, 'playtest-verification should remain uncovered');
});

test('acceptance structure pairs criterion with verify_by and evidence, and completion fills evidence', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA test project verifying acceptance-based task completion works end to end, from planning through evidence-backed completion. The acceptance structure pairs each criterion with a verification method and an evidence field that gets filled in when the task is done.\n\n## People and reality\nSolo developer using Skeinn for a small CLI project. The developer writes tasks in JSON and completes them through the CLI.\n\n## Whole behavior\nTasks use structured acceptance instead of plain done_when strings. Each acceptance condition has a criterion, a verify_by method, and an evidence field. Completion fills in evidence for every condition.\n\n## Boundaries\nNo external dependencies. Does not modify done_when-based tasks. Does not add CLI authoring.\n\n## System shape\nCLI-driven task management with JSON file input. State persists in .skeinn/ directory.\n\n## Completion and failure\nEvery acceptance condition has concrete evidence. A task with missing evidence is rejected. A task with incomplete acceptance results is rejected.\n`, 'utf8');
  run(root, ['design', 'add', 'test-system', '--title', 'Test system', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'test-system.md'), `# Test system\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nVerify acceptance-based completion.\n\n## Boundary\nTest only.\n\n## Interface\nCLI.\n\n## Verification\nRun tests.\n`, 'utf8');
  json(root, 'tasks.json', { tasks: [{
    title: 'Implement acceptance-based completion',
    outcome: 'Task completion uses acceptance results with concrete evidence per criterion',
    acceptance: [
      { criterion: 'Task with acceptance[] can be imported and started', verify_by: 'Run skeinn task plan and skeinn task start, check no errors', evidence: '' },
      { criterion: 'Completion fills each acceptance evidence with actual result', verify_by: 'Run skeinn task done with acceptance_results, check task.acceptance[].evidence is populated', evidence: '' },
      { criterion: 'Missing acceptance result is rejected', verify_by: 'Run skeinn task done with incomplete acceptance_results, check error', evidence: '' },
    ],
    boundaries: ['Does not modify done_when-based tasks'],
    reads: ['.skeinn/PROJECT.md', '.skeinn/design/test-system.md'],
    touches: ['result.txt'],
    implements: '.skeinn/design/test-system.md#Responsibility',
  }] });
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies acceptance structure; no specialist domain applies.']);
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const readyResult = JSON.parse(run(root, ['project', 'ready']));
  json(root, 'keeper-pass.json', { run_id: 'keeper-acceptance-001', prepared_digest: readyResult.digest, verdict: 'passed', summary: 'Ready.', evidence: ['PROJECT.md is complete.'], review: independentReview('fresh-acceptance-agent') });
  run(root, ['keeper', 'record', '--json-file', 'keeper-pass.json']);
  run(root, ['task', 'focus', 'TASK-001']);
  const ctx = run(root, ['context']);
  assert(ctx.includes('acceptance'), 'context should show acceptance field');
  writeFileSync(join(root, 'result.txt'), 'verified\n', 'utf8');
  assert(ctx.includes('verify_by'), 'context should show verify_by in acceptance');
  json(root, 'done.json', {
    evidence: ['npm test passed', 'manual verification complete'],
    acceptance_results: [
      { criterion: 'Task with acceptance[] can be imported and started', evidence: 'skeinn task plan and skeinn task start both succeeded without errors' },
      { criterion: 'Completion fills each acceptance evidence with actual result', evidence: 'skeinn task done accepted acceptance_results and task.acceptance[].evidence was populated' },
    ],
  });
  const failResult = run(root, ['task', 'close', 'TASK-001', '--json-file', 'done.json'], 1);
  assert(failResult.includes('missing acceptance results'), 'should reject incomplete acceptance results');
  json(root, 'done.json', {
    evidence: ['npm test passed', 'manual verification complete'],
    acceptance_results: [
      { criterion: 'Task with acceptance[] can be imported and started', evidence: 'skeinn task plan and skeinn task start both succeeded without errors' },
      { criterion: 'Completion fills each acceptance evidence with actual result', evidence: 'skeinn task done accepted acceptance_results and task.acceptance[].evidence was populated' },
      { criterion: 'Missing acceptance result is rejected', evidence: 'skeinn task done with 2 of 3 acceptance_results returned error mentioning missing acceptance results' },
    ],
  });
  const result = JSON.parse(run(root, ['task', 'close', 'TASK-001', '--json-file', 'done.json']));
  assert(result.status === 'done', 'task should be done');
  assert(result.acceptance.every((acc) => acc.evidence && acc.evidence.length > 5), 'every acceptance condition should have evidence filled');
  assert(result.acceptance.length === 3, 'should have 3 acceptance conditions');
  const checkResult = JSON.parse(run(root, ['check']));
  assert(!checkResult.warnings.join('\n').includes('TASK-001 uses done_when'), 'acceptance task should not trigger done_when migration warning');
});

test('STRUCTURE.md is injected into context and check warns when it is missing or templated', () => {
  const root = workspace();
  run(root, ['init']);
  const ctx = run(root, ['context']);
  assert(ctx.includes('Project structure'), 'context should inject STRUCTURE.md');
  assert(ctx.includes('Source code'), 'context should include structure sections');
  const checkTemplated = JSON.parse(run(root, ['check']));
  assert(checkTemplated.warnings.join('\n').includes('STRUCTURE.md still contains template instructions'), 'check should warn when STRUCTURE.md is still templated');
  writeFileSync(join(root, '.skeinn', 'STRUCTURE.md'), `# Project structure\n\n## Source code\n- \`src/\` — all implementation\n\n## Tests\n- \`tests/\` — test files\n\n## Documents\n- \`README.md\` — entry point\n`, 'utf8');
  const ctxCustom = run(root, ['context']);
  assert(ctxCustom.includes('all implementation'), 'context should inject customized STRUCTURE.md');
  assert(!ctxCustom.includes('Where implementation files go. Example:'), 'context should not include template text after customization');
  const checkCustom = JSON.parse(run(root, ['check']));
  assert(!checkCustom.warnings.join('\n').includes('STRUCTURE.md'), 'check should not warn about STRUCTURE.md after customization');
  rmSync(join(root, '.skeinn', 'STRUCTURE.md'), { force: true });
  const checkMissing = JSON.parse(run(root, ['check']));
  assert(checkMissing.warnings.join('\n').includes('No STRUCTURE.md exists'), 'check should warn when STRUCTURE.md is missing');
});

test('Keeper minor gaps require fresh verification even after changes', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA test project for Keeper auto-pass with minor gaps only. The system should auto-pass when all gaps are minor and 3 or fewer, without requiring a new Keeper round.\n\n## People and reality\nSolo developer testing the Keeper auto-pass mechanism in an isolated workspace.\n\n## Whole behavior\nKeeper returns minor gaps, developer fixes them, auto-pass without new Keeper round.\n\n## Boundaries\nNo external dependencies. No real implementation. Test only.\n\n## System shape\nCLI-based test harness with Skeinn state files.\n\n## Completion and failure\nAuto-pass works when gaps are minor and few. Failure is when auto-pass triggers incorrectly.\n`, 'utf8');
  run(root, ['design', 'add', 'test-system', '--title', 'Test system', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'test-system.md'), `# Test system\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nTest auto-pass.\n\n## Boundary\nTest only.\n\n## Interface\nCLI.\n\n## Verification\nRun tests.\n`, 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Test task', outcome: 'Verify auto-pass works correctly', done_when: ['Auto-pass triggers'], boundaries: ['No real implementation'], reads: ['.skeinn/PROJECT.md'], touches: ['output.txt'], implements: '.skeinn/design/test-system.md#Responsibility' }] });
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies Keeper review loop; no specialist domain applies.']);
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const ready1 = JSON.parse(run(root, ['project', 'ready']));
  json(root, 'keeper-minor.json', {
    run_id: 'keeper-autopass-001',
    prepared_digest: ready1.digest,
    verdict: 'needs_revision',
    summary: 'Two minor gaps found, no blocking issues.',
    gaps: [
      { gap: 'PROJECT.md could use more detail on completion criteria', severity: 'minor', why_it_blocks_start: 'Slightly less clear but does not block start', evidence_to_close: 'Add a sentence to completion section' },
      { gap: 'Design doc missing explicit verification section header', severity: 'minor', why_it_blocks_start: 'Verification is implied but not labeled', evidence_to_close: 'Add ## Verification header' },
    ],
    evidence: ['Reviewed PROJECT.md and design doc'],
  });
  run(root, ['keeper', 'record', '--json-file', 'keeper-minor.json']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA test project for Keeper auto-pass with minor gaps only, now with detailed completion criteria. The system should auto-pass when all gaps are minor and 3 or fewer, without requiring a new Keeper round.\n\n## People and reality\nSolo developer testing the Keeper auto-pass mechanism in an isolated workspace.\n\n## Whole behavior\nKeeper returns minor gaps, developer fixes them, auto-pass without new Keeper round.\n\n## Boundaries\nNo external dependencies. No real implementation. Test only.\n\n## System shape\nCLI-based test harness with Skeinn state files.\n\n## Completion and failure\nAuto-pass works when gaps are minor and few. Completion means the auto-pass triggered correctly. Failure is when auto-pass triggers incorrectly or blocking gaps slip through.\n`, 'utf8');
  writeFileSync(join(root, '.skeinn', 'design', 'test-system.md'), `# Test system\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nTest auto-pass.\n\n## Boundary\nTest only.\n\n## Interface\nCLI.\n\n## Verification\nRun tests.\n`, 'utf8');
  const ready2 = JSON.parse(run(root, ['project', 'ready']));
  assert(!ready2.auto_passed, 'unattested minor review must never auto-pass');
  assert(ready2.ready_for_keeper === true, 'minor gaps require a new Keeper round');
  assert(run(root, ['context']).includes('Keeper handoff pending'), 'ready state must recommend the host handoff');
  const checkResult = JSON.parse(run(root, ['check']));
  assert(checkResult.healthy === true, 'project should be healthy after auto-pass');
});

test('Keeper does NOT auto-pass when gaps include blocking severity', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA test project for Keeper blocking gap. The system must handle blocking gaps correctly by requiring a new Keeper round when any blocking gap exists.\n\n## People and reality\nSolo developer testing the Keeper blocking gap mechanism in an isolated workspace.\n\n## Whole behavior\nKeeper returns a blocking gap, must require new Keeper round. Auto-pass must not trigger.\n\n## Boundaries\nNo external dependencies. No real implementation. Test only.\n\n## System shape\nCLI-based test harness with Skeinn state files.\n\n## Completion and failure\nBlocking gaps prevent auto-pass. Failure is when auto-pass triggers despite a blocking gap.\n`, 'utf8');
  run(root, ['design', 'add', 'test-system', '--title', 'Test system', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'test-system.md'), `# Test system\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nTest blocking gap.\n\n## Boundary\nTest only.\n\n## Interface\nCLI.\n\n## Verification\nRun tests.\n`, 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Test task', outcome: 'Verify blocking gap prevents auto-pass', done_when: ['Auto-pass does not trigger'], boundaries: ['No real implementation'], reads: ['.skeinn/PROJECT.md'], touches: ['output.txt'], implements: '.skeinn/design/test-system.md#Responsibility' }] });
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies Keeper review loop; no specialist domain applies.']);
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const ready1 = JSON.parse(run(root, ['project', 'ready']));
  json(root, 'keeper-blocking.json', {
    run_id: 'keeper-blocking-001',
    prepared_digest: ready1.digest,
    verdict: 'needs_revision',
    summary: 'One blocking gap found.',
    gaps: [
      { gap: 'Missing entire system design for the core module', severity: 'blocking', why_it_blocks_start: 'A fresh Agent cannot start without knowing the core module design', evidence_to_close: 'Add a design document for the core module' },
    ],
    evidence: ['No design document for core module found'],
  });
  run(root, ['keeper', 'record', '--json-file', 'keeper-blocking.json']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA test project for Keeper blocking gap. Updated to try to pass. The system must handle blocking gaps correctly by requiring a new Keeper round when any blocking gap exists.\n\n## People and reality\nSolo developer testing the Keeper blocking gap mechanism in an isolated workspace.\n\n## Whole behavior\nKeeper returns a blocking gap, must require new Keeper round. Auto-pass must not trigger.\n\n## Boundaries\nNo external dependencies. No real implementation. Test only.\n\n## System shape\nCLI-based test harness with Skeinn state files.\n\n## Completion and failure\nBlocking gaps prevent auto-pass. Failure is when auto-pass triggers despite a blocking gap.\n`, 'utf8');
  const ready2 = JSON.parse(run(root, ['project', 'ready']));
  assert(ready2.auto_passed !== true, 'should NOT auto-pass when there is a blocking gap');
  assert(ready2.ready_for_keeper === true, 'should require a new Keeper round for blocking gaps');
});

test('decision record traces changes and warns about affected done tasks', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA project that evolves mid-flight. New ideas change existing decisions, and those changes are traced in DECISIONS.md while affected tasks are flagged for review.\n\n## People and reality\nSolo developer iterating on a project whose design changes after implementation has started.\n\n## Whole behavior\nDecisions are recorded with affected files and tasks. Done tasks affected by a decision are flagged by skeinn check.\n\n## Boundaries\nNo external dependencies. No real implementation. Test only.\n\n## System shape\nCLI-based test harness with Skeinn state files and design documents.\n\n## Completion and failure\nDecisions traced, affected tasks reopened when needed. Failure is when a decision silently invalidates done work without warning.\n`, 'utf8');
  run(root, ['design', 'add', 'core-system', '--title', 'Core system', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'core-system.md'), `# Core system\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nOriginal design.\n\n## Boundary\nTest only.\n\n## Interface\nCLI.\n\n## Verification\nRun tests.\n`, 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Original task', outcome: 'Implement original design correctly', done_when: ['Original design implemented'], boundaries: ['No scope creep'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/core-system.md'], touches: ['core.txt'], implements: '.skeinn/design/core-system.md#Responsibility' }] });
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies acceptance structure; no specialist domain applies.']);
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const readyResult = JSON.parse(run(root, ['project', 'ready']));
  json(root, 'keeper-pass.json', { run_id: 'keeper-decision-001', prepared_digest: readyResult.digest, verdict: 'passed', summary: 'Ready.', evidence: ['All good.'], review: independentReview('fresh-decision-agent') });
  run(root, ['keeper', 'record', '--json-file', 'keeper-pass.json']);
  run(root, ['task', 'focus', 'TASK-001']);
  writeFileSync(join(root, 'core.txt'), 'implemented\n', 'utf8');
  json(root, 'done.json', { evidence: ['done'], checks: [{ criterion: 'Original design implemented', evidence: ['src/core.js exists'] }] });
  run(root, ['task', 'close', 'TASK-001', '--json-file', 'done.json']);
  json(root, 'decision.json', { summary: 'Changed core system from sync to async architecture', changes: ['.skeinn/design/core-system.md', 'src/core.js'], affected_tasks: ['TASK-001'] });
  const decisionResult = JSON.parse(run(root, ['decision', '--json-file', 'decision.json']));
  assert(decisionResult.id.startsWith('D-'), 'decision should have a D- prefixed id');
  assert(decisionResult.affected_tasks.includes('TASK-001'), 'decision should record affected task');
  const decisionsContent = readFileSync(join(root, '.skeinn', 'DECISIONS.md'), 'utf8');
  assert(decisionsContent.includes('Changed core system from sync to async'), 'DECISIONS.md should contain the decision summary');
  assert(decisionsContent.includes('TASK-001'), 'DECISIONS.md should record affected task');
  const checkResult = JSON.parse(run(root, ['check']));
  assert(checkResult.warnings.join('\n').includes('TASK-001 is done but was marked affected by a decision'), 'check should warn about done task affected by decision');
});

test('a long work map stays on disk while context remains focused', () => {
  const root = workspace();
  run(root, ['init']);
  const tasks = Array.from({ length: 250 }, (_, index) => ({
    title: `Work item ${index + 1}`,
    outcome: `Observable result ${index + 1} exists in the output artifact`,
    done_when: [`Evidence for result ${index + 1}`],
    boundaries: ['Does not touch unrelated modules'],
    depends_on: index === 0 ? [] : [`TASK-${String(index).padStart(3, '0')}`],
    reads: ['.skeinn/PROJECT.md'],
    touches: [`src/item-${index + 1}.js`],
  }));
  json(root, 'tasks.json', { tasks });
  const summary = JSON.parse(run(root, ['task', 'plan', '--json-file', 'tasks.json']));
  assert(summary.total === 250, 'long work map was not imported');
  const context = run(root, ['context']);
  assert(context.includes('work map: 250 tasks'), 'context should summarize work map');
  assert(!context.includes('Work item 250'), 'context must not inject the full work map');
  assert(JSON.parse(run(root, ['task', 'next'])).id === 'TASK-001', 'first executable task mismatch');
});

test('ready gate requires a real whole, initial work map, and closed high-impact uncertainty', () => {
  const root = workspace();
  run(root, ['init']);
  json(root, 'record.json', { unresolved: [{ question: 'Which irreversible action is authorized?', impact: 'high' }] });
  run(root, ['record', '--json-file', 'record.json']);
  const early = run(root, ['project', 'ready'], 1);
  assert(early.includes('PROJECT.md still looks like a template'), 'template gate missing');
  assert(early.includes('No design document exists'), 'design document gate missing');
  assert(early.includes('initial work map is empty'), 'work map gate missing');
  assert(early.includes('Q-001'), 'uncertainty gate missing');
});

test('one-time Keeper handoff gates execution, supports revision, then disappears from Tasks', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `# Project Whole\n\n## Intended result\nA restartable Agent workflow that understands the whole project before building.\n\n## People and reality\nA human collaborates naturally while the Agent silently preserves state.\n\n## Whole behavior\nThe Agent clarifies, records, builds a work map, resumes one Task, and proves it done.\n\n## Boundaries\nThe human never has to operate Skeinn. Irreversible work needs authority.\n\n## System shape\nHuman-readable project truth plus structured Task state compiled by a CLI.\n\n## Completion and failure\nA fresh Agent can start without chat memory; document volume alone is failure.\n`, 'utf8');
  run(root, ['design', 'add', 'resume-context', '--title', 'Resume context system', '--kind', 'system']);
  const designPath = join(root, '.skeinn', 'design', 'resume-context.md');
  writeFileSync(designPath, `# Resume context system\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nCompile only the current whole and active Task after a reset.\n\n## Boundary\nThe human never operates Skeinn.\n\n## Interface\nThe compiler entry point is cli/src/store.js.\n\n## Verification\nRun node cli/test/run-all.js and inspect the forced-reset transcript.\n`, 'utf8');
  run(root, ['capability', 'add', 'human-agent-interaction', '--title', 'Human-Agent Interaction', '--mode', 'codebase_grounded']);
  const capabilityPath = join(root, '.skeinn', 'capabilities', 'human-agent-interaction.md');
  writeFileSync(capabilityPath, `# Human-Agent Interaction\n\n- Mode: codebase_grounded\n- Authority: human_confirmed\n- Scenario: Agent-driven project with natural human conversation and forced context resets.\n\n## Field identity and boundary\nThis field shapes continuity without taking user agency.\n\n## How real practitioners operate\n- Observed Skeinn v1 runtime behavior: injecting full project state after every reset caused context bloat and question fatigue — Source: repo: docs/loom-journey-audit.md\n\n## Reflection for this project\nThe Task is a restartable checkpoint, not an exhaustive plan. We refuse full-state reinjection.\n\n## Operational rules and Design delta\n- Quality bar: fresh Agent resumes without asking the human to repeat prior decisions.\n- Design delta (Before -> After): Switched resume-context.md from full state dump to active-horizon reads.\n`, 'utf8');
  writeFileSync(join(root, 'INPUT.md'), '# Runtime fixture\n\nA forced-reset handoff must preserve the selected Task.\n', 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Implement resume context', outcome: 'A fresh Agent receives only decision-relevant context', done_when: ['Integration transcript proves context survives a reset'], boundaries: ['Do not expose CLI operation to the human'], guardrails: ['Never inject the full Work Map on resume'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/resume-context.md', '.skeinn/capabilities/human-agent-interaction.md', 'INPUT.md'], touches: ['output.txt'], implements: '.skeinn/design/resume-context.md#Responsibility' }] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  json(root, 'keeper-pass.json', { verdict: 'passed', summary: 'The project is build-ready.', evidence: ['PROJECT.md defines the whole and TASK-001 links the only required dossier.'] });
  assert(run(root, ['keeper', 'record', '--json-file', 'keeper-pass.json'], 1).includes('before skeinn project ready'), 'Keeper must not bypass ready state');
  assert(run(root, ['keeper', 'skip', '--reason', 'The host cannot create another isolated Agent'], 1).includes('after skeinn project ready'), 'Keeper skip must not bypass ready state');
  const firstReady = JSON.parse(run(root, ['project', 'ready']));
  assert(JSON.parse(readFileSync(join(root, '.skeinn', 'state.json'), 'utf8')).project.status === 'ready_for_keeper', 'Project is ready_for_keeper before Keeper Launch');
  const firstPrompt = run(root, ['keeper', 'prompt']);
  assert(firstPrompt.includes('fresh Agent'), 'Keeper prompt missing isolation');
  assert(firstPrompt.includes(firstReady.digest), 'Keeper prompt missing prepared digest');
  json(root, 'keeper-needs.json', { run_id: 'keeper-run-001', prepared_digest: firstReady.digest, verdict: 'needs_revision', summary: 'The first action is underspecified.', evidence: ['TASK-001 does not identify the context compiler entry point.'], gaps: [{ gap: 'Name the CLI entry point.', why_it_blocks_start: 'A fresh Agent cannot locate the first edit.', evidence_to_close: 'The design document names the file and test command.' }] });
  run(root, ['keeper', 'record', '--json-file', 'keeper-needs.json']);
  const revisionContext = run(root, ['context']);
  assert(revisionContext.includes('Keeper feedback that must enter the next iteration'), 'Keeper feedback did not return to context');
  assert(revisionContext.includes('Name the CLI entry point.'), 'Keeper gap did not return to context');
  assert(revisionContext.includes('A fresh Agent cannot locate the first edit.'), 'structured Keeper rationale was lost');
  assert(revisionContext.includes('The design document names the file and test command.'), 'structured Keeper closure evidence was lost');
  assert(!revisionContext.includes('[object Object]'), 'structured Keeper gap was corrupted');
  assert(run(root, ['keeper', 'prompt'], 1).includes('project ready'), 'revision must be prepared again');
  assert(run(root, ['project', 'ready'], 1).includes('have not changed'), 'unchanged revision must not be rechecked');
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `${readFileSync(join(root, '.skeinn', 'PROJECT.md'), 'utf8')}\n## First implementation entry\n\nThe first action begins in cli/src/store.js and is verified through the CLI integration test.\n`, 'utf8');
  const secondReady = JSON.parse(run(root, ['project', 'ready']));
  assert(run(root, ['keeper', 'prompt']).includes('could responsibly begin'), 'prepared revision should be checkable');
  const keeperRevisionContext = run(root, ['context', '--keeper']);
  assert(keeperRevisionContext.includes('Prior Keeper feedback this prepared revision claims to close'), 'fresh Keeper did not receive prior gaps as an audit checklist');
  assert(keeperRevisionContext.includes('Do not repair it yourself'), 'Keeper feedback conflicted with independent review role');
  json(root, 'keeper-duplicate.json', { run_id: 'keeper-run-001', prepared_digest: secondReady.digest, verdict: 'passed', summary: 'Duplicate run.', evidence: ['This must be rejected as non-independent.'], review: independentReview('fresh-duplicate-agent') });
  assert(run(root, ['keeper', 'record', '--json-file', 'keeper-duplicate.json'], 1).includes('already used'), 'Keeper run_id must be unique');
  writeFileSync(capabilityPath, `${readFileSync(capabilityPath, 'utf8')}\nFresh evidence discovered after ready.\n`, 'utf8');
  json(root, 'keeper-stale.json', { run_id: 'keeper-run-stale', prepared_digest: secondReady.digest, verdict: 'passed', summary: 'Stale run.', evidence: ['This result used a stale prepared project.'], review: independentReview('fresh-stale-agent') });
  assert(run(root, ['keeper', 'record', '--json-file', 'keeper-stale.json'], 1).includes('changed after'), 'stale prepared state must be rejected');
  const thirdReady = JSON.parse(run(root, ['project', 'ready']));
  json(root, 'keeper-self.json', { run_id: 'keeper-self-002', prepared_digest: thirdReady.digest, verdict: 'passed', summary: 'Self review cannot establish independence.', evidence: ['The shaping Agent reviewed its own work.'], review: { mode: 'self', reviewer_id: 'shaping-agent', evidence: 'Same Agent and inherited context.' } });
  assert(run(root, ['keeper', 'record', '--json-file', 'keeper-self.json'], 1).includes('independent review'), 'self-review should not produce Keeper pass');
  json(root, 'keeper-pass.json', { run_id: 'keeper-run-002', prepared_digest: thirdReady.digest, verdict: 'passed', summary: 'The project is build-ready.', evidence: ['PROJECT.md defines the whole and TASK-001 links the only required dossier.'], review: { mode: 'independent', reviewer_id: 'fresh-agent-002', evidence: 'Host opened a separate Agent with no shaping conversation.' } });
  assert(run(root, ['keeper', 'record', '--json-file', 'keeper-pass.json'], 1).includes('closure_results'), 'revised pass must prove every prior gap closed');
  const revisedPass = JSON.parse(readFileSync(join(root, 'keeper-pass.json'), 'utf8'));
  revisedPass.closure_results = [{ gap: 'Name the CLI entry point.', evidence: 'PROJECT.md now names cli/src/store.js and the CLI integration test.' }];
  json(root, 'keeper-pass.json', revisedPass);
  run(root, ['keeper', 'record', '--json-file', 'keeper-pass.json']);
  const restartableTask = JSON.parse(run(root, ['task', 'get', 'TASK-001']));
  json(root, 'bad-task-reads.json', { reads: [...restartableTask.reads, '.skeinn/design'] });
  run(root, ['task', 'update', 'TASK-001', '--json-file', 'bad-task-reads.json']);
  assert(run(root, ['task', 'focus', 'TASK-001'], 1).includes('must name a file, not a directory'), 'Task start accepted a directory context reference');
  json(root, 'good-task-reads.json', { reads: restartableTask.reads });
  run(root, ['task', 'update', 'TASK-001', '--json-file', 'good-task-reads.json']);
  run(root, ['task', 'focus', 'TASK-001']);
  assert(JSON.parse(readFileSync(join(root, '.skeinn', 'state.json'), 'utf8')).project.status === 'building', 'Task start should enter building state');
  const context = run(root, ['context', '--full']);
  assert(context.includes('## Active Task'), 'active Task missing from context');
  assert(context.includes('# Skeinn active Task execution protocol'), 'active Task execution protocol missing');
  assert(context.includes('Inspect the current workspace and version-control state'), 'workspace recovery rule missing');
  assert(context.includes('do not manufacture a ceremonial unit test'), 'risk-based test rule missing');
  assert(context.includes('A branch, commit, or pull request is a delivery mechanism'), 'PR boundary missing');
  assert(context.includes('Human-Agent Interaction'), 'relevant capability was not compiled');
  assert(context.includes('restartable checkpoint'), 'project-specific stance was not injected');
  assert(context.includes('forced-reset handoff'), 'workspace fixture was not compiled');
  writeFileSync(join(root, 'output.txt'), 'verified\n', 'utf8');
  json(root, 'bypass.json', { status: 'done' });
  assert(run(root, ['task', 'update', 'TASK-001', '--json-file', 'bypass.json'], 1).includes('cannot be updated'), 'generic update must not bypass done evidence');
  json(root, 'block.json', { reason: 'The declared context entry point does not exist yet.', recovery_conditions: ['Create and verify the entry point'], evidence: ['Read-only inspection found no entry point.'] });
  run(root, ['task', 'block', 'TASK-001', '--json-file', 'block.json']);
  assert(JSON.parse(run(root, ['task', 'get', 'TASK-001'])).status === 'blocked', 'Task did not block');
  assert(run(root, ['task', 'reopen', 'TASK-001'], 1).includes('concrete --reason'), 'blocked Task reopened without stating how recovery conditions were met');
  run(root, ['task', 'reopen', 'TASK-001', '--reason', 'The entry point was created and verified, meeting the recovery condition.']);
  run(root, ['task', 'focus', 'TASK-001']);
  json(root, 'progress.json', { progress: { completed: ['Context selector implemented'], current: 'Testing forced reset', next: 'Run integration transcript' } });
  run(root, ['task', 'update', 'TASK-001', '--json-file', 'progress.json']);
  json(root, 'evidence-only.json', { evidence: ['A vague evidence list is not enough.'] });
  assert(run(root, ['task', 'close', 'TASK-001', '--json-file', 'evidence-only.json'], 1).includes('checks for every done_when'), 'Task completion accepted evidence without criterion coverage');
  const completionChecks = JSON.parse(run(root, ['task', 'get', 'TASK-001'])).done_when.map((criterion) => ({ criterion, evidence: ['node cli/test/run-all.js: forced-reset integration passed'] }));
  json(root, 'evidence.json', { evidence: ['node cli/test/run-all.js: forced-reset integration passed'], checks: completionChecks });
  const done = JSON.parse(run(root, ['task', 'close', 'TASK-001', '--json-file', 'evidence.json']));
  assert(done.status === 'done', 'Task did not close');
  assert(JSON.parse(readFileSync(join(root, '.skeinn', 'state.json'), 'utf8')).project.status === 'complete', 'last Task should complete project state');
  assert(run(root, ['task', 'reopen', 'TASK-001'], 1).includes('concrete --reason'), 'done Task reopened without a reason');
  run(root, ['task', 'reopen', 'TASK-001', '--reason', 'The prior completion evidence was disproven by a reset failure.']);
  assert(JSON.parse(run(root, ['task', 'get', 'TASK-001'])).status === 'open', 'done Task did not reopen');
  assert(JSON.parse(readFileSync(join(root, '.skeinn', 'state.json'), 'utf8')).project.status === 'building', 'reopening completion did not restore building state');
  run(root, ['task', 'focus', 'TASK-001']);
  run(root, ['task', 'close', 'TASK-001', '--json-file', 'evidence.json']);
  assert(JSON.parse(run(root, ['check'])).healthy === true, 'project should remain healthy');
});

test('Evil Eval scaffold controls information, budget, resets, repetition, and judge order', () => {
  const root = workspace();
  run(root, ['init']);
  json(root, 'eval.json', {
    id: 'EVAL-001',
    title: 'Ambiguous multidisciplinary build',
    brief: 'Build a calming recovery tool from this existing repository.',
    hidden_user_facts: ['The user must retain manual control.'],
    success_criteria: ['A new Agent can resume after a forced reset.'],
    human_channel: 'unavailable',
    mode: 'full',
  });
  const result = JSON.parse(run(root, ['eval', 'scaffold', '--json-file', 'eval.json']));
  const manifest = JSON.parse(readFileSync(join(root, result.path, 'manifest.json'), 'utf8'));
  assert(manifest.controls.same_model_tools_workspace_and_budget === true, 'equal-condition control missing');
  assert(manifest.controls.human_channel === 'unavailable', 'human-channel control missing');
  assert(manifest.controls.minimum_repetitions_per_condition === 3, 'repeat control missing');
  assert(manifest.controls.context_reset_points.length === 2, 'forced reset control missing');
  assert(manifest.controls.anonymization_preserves_relative_layout === true, 'anonymized layout invariant missing');
  assert(manifest.controls.judge_packet_preflight_required === true, 'judge packet preflight missing');
  assert(manifest.controls.condition_output_digest_manifest === true, 'condition output manifest missing');
  const judge = readFileSync(join(root, result.path, 'judge-prompt.md'), 'utf8');
  assert(judge.includes('randomized order'), 'blind random order missing');
  assert(judge.includes('UNSTABLE') && judge.includes('X_CLEAR_WIN'), 'pairwise forced-choice and order-swap check missing');
  assert(judge.includes('Penalize unnecessary ceremony'), 'ceremony cost is not measured');
  assert(readFileSync(join(root, result.path, 'skeinn-prompt.md'), 'utf8').includes('Do not fabricate a user interaction'), 'unattended Skeinn eval prompt may fabricate a user');
  assert(readFileSync(join(root, result.path, 'baseline-prompt.md'), 'utf8').includes('Do not fabricate a user interaction'), 'baseline did not receive the same unattended environment');
});

test('help and source surface stay minimal', () => {
  const root = workspace();
  for (const args of [['keeper','--help'], ['keeper','prompt','--help'], ['help','keeper']]) {
    assert(run(root,args).includes('In-Flight Checkpoint'), 'keeper v3 discovery must work before init');
  }
  const help = run(root, ['--help']);
  for (const command of ['skeinn context', 'skeinn record', 'skeinn decision', 'skeinn design add', 'skeinn capability add', 'skeinn capability exempt', 'skeinn deliverable add', 'skeinn task plan', 'skeinn task focus', 'skeinn task close', 'skeinn task list', 'skeinn keeper prompt', 'skeinn eval scaffold']) assert(help.includes(command), `${command} missing`);
  for (const legacy of ['Intent Map', 'Capability Graph', 'Atelier', 'Atlas', 'Weaver', 'Forge']) assert(!help.includes(legacy), `${legacy} leaked into minimal help`);
  const helpCases = [
    [['record', '--help'], ['"confirmed"', '"assumptions"', '"unresolved"', '"resolved"', '"retire_assumptions"', '"decisions"']],
    [['decision', '--help'], ['"summary"', '"changes"', '"affected_tasks"']],
    [['task', 'plan', '--help'], ['"acceptance"', '"implements"', '"guardrails"']],
    [['task', 'update', '--help'], ['"progress"', '"current"', '"next"']],
    [['task', 'block', '--help'], ['"reason"', '"recovery_conditions"']],
    [['task', 'close', '--help'], ['"evidence"', '"acceptance_results"']],
    [['keeper', 'record', '--help'], ['"review"', '"mode"', '"reviewer_id"']],
    [['eval', 'scaffold', '--help'], ['"brief"', '"human_channel"', '"repetitions"']],
  ];
  for (const [args, fields] of helpCases) {
    const detail = run(root, args);
    for (const field of fields) assert(detail.includes(field), `skeinn ${args.join(' ')} missing ${field}`);
  }
  assert(run(root, ['help', 'task-close']).includes('acceptance_results'), 'skeinn help <topic> should expose the same canonical payload');
  run(root, ['init']);
  json(root, 'bad-record.json', { confirmed: [{ nope: true }] });
  const badRecord = run(root, ['record', '--json-file', 'bad-record.json'], 1);
  assert(badRecord.includes('Confirmed fact requires text'), 'structured write error lost the concrete validation failure');
  assert(badRecord.includes('skeinn help record'), 'structured write error should point to command-local help');
  const chineseReadme = readFileSync(resolve('README.zh-CN.md'), 'utf8');
  assert(chineseReadme.includes('--source human'), 'Chinese README should teach capability authority provenance');
  assert(chineseReadme.includes('review.mode: "independent"'), 'Chinese README should teach independent Keeper provenance');
  assert(chineseReadme.includes('skeinn task close --help'), 'Chinese README should point structured writes to command-local help');
  assert(run(root, ['--version']) === 'skeinn 3.0.0', 'version mismatch');
});

const PROJ = (text) => `# Project Whole\n\n## Intended result\n${text}\n\n## People and reality\nA human collaborates naturally while the Agent silently preserves state.\n\n## Whole behavior\nThe Agent clarifies, records, builds a work map, resumes one Task, and proves it done.\n\n## Boundaries\nThe human never has to operate Skeinn. Irreversible work needs authority.\n\n## System shape\nHuman-readable project truth plus structured Task state compiled by a CLI.\n\n## Completion and failure\nA fresh Agent can start without chat memory; document volume alone is failure.\n`;

test('blocked Tasks surface their reason and recovery path in context', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A blocked-state visibility fixture proving a post-reset Agent sees why work stopped and how to resume it.'), 'utf8');
  run(root, ['design', 'add', 'blocking', '--title', 'Blocking fixture', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'blocking.md'), '# Blocking fixture\n\n## Responsibility\nSurface blocked work with its recovery path.\n', 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Blocked work', outcome: 'A blocked Task is visible with its recovery path in context', done_when: ['Output exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md'], touches: ['out.txt'], implements: '.skeinn/design/blocking.md#Responsibility' }] });
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies core task/keeper behavior; no specialist domain applies.']);
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  run(root, ['project', 'ready']);
  run(root, ['keeper', 'skip', '--reason', 'No second Agent is available in this fixture.']);
  run(root, ['task', 'focus', 'TASK-001']);
  json(root, 'block.json', { reason: 'The upstream API contract is not published yet.', recovery_conditions: ['The contract file exists at contracts/api.md'], evidence: ['contracts/api.md does not exist'] });
  run(root, ['task', 'block', 'TASK-001', '--json-file', 'block.json']);
  const ctx = run(root, ['context']);
  assert(ctx.includes('TASK-001 — The upstream API contract is not published yet.'), 'context must name the blocked Task and its reason');
  assert(ctx.includes('The contract file exists at contracts/api.md'), 'context must show recovery conditions');
  assert(ctx.includes('skeinn task reopen <id> --reason'), 'context must recommend the reopen path when nothing is executable');
});

test('decision-affected warnings close after re-completion and done Tasks resist silent rewrites', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A decision lifecycle fixture proving affected-Task warnings open and close with evidence rather than persisting forever.'), 'utf8');
  run(root, ['design', 'add', 'evolving', '--title', 'Evolving fixture', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'evolving.md'), '# Evolving fixture\n\n## Responsibility\nChange after implementation.\n', 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Build output', outcome: 'A verified output file exists', done_when: ['Output verified'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md'], touches: ['out.txt'], implements: '.skeinn/design/evolving.md#Responsibility' }] });
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies core task/keeper behavior; no specialist domain applies.']);
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  run(root, ['project', 'ready']);
  run(root, ['keeper', 'skip', '--reason', 'No second Agent is available in this fixture.']);
  run(root, ['task', 'focus', 'TASK-001']);
  writeFileSync(join(root, 'out.txt'), 'v1\n', 'utf8');
  json(root, 'done.json', { evidence: ['out.txt verified'], checks: [{ criterion: 'Output verified', evidence: ['out.txt exists with expected content'] }] });
  run(root, ['task', 'close', 'TASK-001', '--json-file', 'done.json']);
  json(root, 'patch.json', { outcome: 'Silently rewritten outcome that must be rejected' });
  assert(run(root, ['task', 'update', 'TASK-001', '--json-file', 'patch.json'], 1).includes('reopen it first'), 'done Task must not accept silent rewrites');
  json(root, 'decision.json', { summary: 'The output format changed after completion', changes: ['.skeinn/design/evolving.md'], affected_tasks: ['TASK-001'] });
  run(root, ['decision', '--json-file', 'decision.json']);
  const warned = JSON.parse(run(root, ['check']));
  assert(warned.warnings.join('\n').includes('TASK-001 is done but was marked affected'), 'done-before-decision Task must warn');
  run(root, ['task', 'reopen', 'TASK-001', '--reason', 'Reviewed against the format decision; re-verifying output.']);
  run(root, ['task', 'focus', 'TASK-001']);
  writeFileSync(join(root, 'out.txt'), 'v2\n', 'utf8');
  run(root, ['task', 'close', 'TASK-001', '--json-file', 'done.json']);
  const cleared = JSON.parse(run(root, ['check']));
  assert(!cleared.warnings.join('\n').includes('TASK-001 is done but was marked affected'), 're-completion after the decision must close the warning');
});

test('task start requires an attested Keeper pass or a recorded skip', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A Keeper attestation fixture proving an unverified pass cannot silently gate execution.'), 'utf8');
  run(root, ['design', 'add', 'attestation', '--title', 'Attestation fixture', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'attestation.md'), '# Attestation fixture\n\n## Responsibility\nRequire attested readiness.\n', 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Attested work', outcome: 'Execution only follows an attested pass or recorded skip', done_when: ['Output exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md'], touches: ['out.txt'], implements: '.skeinn/design/attestation.md#Responsibility' }] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const statePath = join(root, '.skeinn', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.keeper.status = 'passed';
  state.keeper.attempts = [{ run_id: 'legacy-pass-001', verdict: 'passed', summary: 'Recorded before provenance rules.', evidence: ['Legacy pass'], gaps: [], at: new Date().toISOString() }];
  state.project.status = 'build_ready';
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  assert(run(root, ['check'], 1).includes('independently attested'), 'unattested pass must fail check');
  const unhealthy = JSON.parse(run(root, ['check'], 1));
  assert(unhealthy.errors.join('\n').includes('independently attested'), 'check must report an unattested pass as an error');
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies Keeper attestation; no specialist domain applies.']);
  run(root, ['project', 'ready']);
  run(root, ['keeper', 'skip', '--reason', 'Only one Agent exists in this fixture.']);
  run(root, ['task', 'focus', 'TASK-001']);
  const healthy = JSON.parse(run(root, ['check']));
  assert(healthy.healthy === true, 'a recorded skip is a legitimate build state');
});

test('planning new Tasks on a complete project returns it to building', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A mid-flight extension fixture proving new work can be planned after completion.'), 'utf8');
  run(root, ['design', 'add', 'extend', '--title', 'Extension fixture', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'extend.md'), '# Extension fixture\n\n## Responsibility\nAccept new systems mid-flight.\n', 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'First unit', outcome: 'A verified output file exists on disk', done_when: ['Output exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md'], touches: ['out.txt'], implements: '.skeinn/design/extend.md#Responsibility' }] });
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies core task/keeper behavior; no specialist domain applies.']);
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  run(root, ['project', 'ready']);
  run(root, ['keeper', 'skip', '--reason', 'No second Agent is available in this fixture.']);
  run(root, ['task', 'focus', 'TASK-001']);
  writeFileSync(join(root, 'out.txt'), 'v1\n', 'utf8');
  json(root, 'done.json', { evidence: ['out.txt exists'], checks: [{ criterion: 'Output exists', evidence: ['out.txt on disk'] }] });
  run(root, ['task', 'close', 'TASK-001', '--json-file', 'done.json']);
  assert(JSON.parse(readFileSync(join(root, '.skeinn', 'state.json'), 'utf8')).project.status === 'complete', 'project should be complete after the last Task');
  run(root, ['capability', 'add', 'new-domain', '--title', 'New professional domain']);
  json(root, 'tasks2.json', { tasks: [{ title: 'Second unit', outcome: 'A second verified output file exists on disk', done_when: ['Second output exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md'], touches: ['out2.txt'], implements: '.skeinn/design/extend.md#Responsibility', capability_exemption: 'New dossier is still researching; this Task does not consume its nodes yet.' }] });
  run(root, ['task', 'plan', '--json-file', 'tasks2.json']);
  assert(JSON.parse(readFileSync(join(root, '.skeinn', 'state.json'), 'utf8')).project.status === 'building', 'planning work on a complete project must return it to building');
  const ctx = run(root, ['context']);
  assert(ctx.includes('new-domain (external_researched'), 'context must surface the new capability mode');
  assert(!ctx.includes('All Tasks are done'), 'context must not claim completion while new Tasks are open');
  run(root, ['task', 'focus', 'TASK-002']);
});

test('a Keeper pass must close findings still open across all earlier attempts', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A cumulative findings fixture proving earlier gaps cannot vanish when a later round reports different ones.'), 'utf8');
  run(root, ['design', 'add', 'ledger', '--title', 'Ledger fixture', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'ledger.md'), '# Ledger fixture\n\n## Responsibility\nTrack every open finding.\n', 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Ledger work', outcome: 'Findings persist until closed with evidence', done_when: ['Output exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md'], touches: ['out.txt'], implements: '.skeinn/design/ledger.md#Responsibility' }] });
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies Keeper review loop; no specialist domain applies.']);
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const ready1 = JSON.parse(run(root, ['project', 'ready']));
  json(root, 'k1.json', { run_id: 'keeper-ledger-001', prepared_digest: ready1.digest, verdict: 'needs_revision', summary: 'One finding.', evidence: ['Read the whole.'], gaps: ['Gap A: name the CLI entry point'] });
  run(root, ['keeper', 'record', '--json-file', 'k1.json']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `${PROJ('A cumulative findings fixture proving earlier gaps cannot vanish when a later round reports different ones.')} \nRevised after round one.\n`, 'utf8');
  const ready2 = JSON.parse(run(root, ['project', 'ready']));
  json(root, 'k2.json', { run_id: 'keeper-ledger-002', prepared_digest: ready2.digest, verdict: 'needs_revision', summary: 'A different finding.', evidence: ['Read the whole again.'], gaps: ['Gap B: document the test command'] });
  run(root, ['keeper', 'record', '--json-file', 'k2.json']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), `${PROJ('A cumulative findings fixture proving earlier gaps cannot vanish when a later round reports different ones.')} \nRevised after round two.\n`, 'utf8');
  const ready3 = JSON.parse(run(root, ['project', 'ready', '--force-round', '--reason', 'Explicitly testing cumulative closure across a 3rd round.']));
  json(root, 'k3.json', { run_id: 'keeper-ledger-003', prepared_digest: ready3.digest, verdict: 'passed', summary: 'Looks ready.', evidence: ['Reviewed.'], review: independentReview('fresh-ledger-agent'), closure_results: [{ gap: 'Gap B: document the test command', evidence: 'README now names npm test' }] });
  const rejected = run(root, ['keeper', 'record', '--json-file', 'k3.json'], 1);
  assert(rejected.includes('Gap A: name the CLI entry point'), 'a pass must still close findings from earlier attempts');
  json(root, 'k3.json', { run_id: 'keeper-ledger-003', prepared_digest: ready3.digest, verdict: 'passed', summary: 'Looks ready.', evidence: ['Reviewed.'], review: independentReview('fresh-ledger-agent'), closure_results: [{ gap: 'Gap A: name the CLI entry point', evidence: 'PROJECT.md names cli/bin/skeinn.js' }, { gap: 'Gap B: document the test command', evidence: 'README now names npm test' }] });
  run(root, ['keeper', 'record', '--json-file', 'k3.json']);
});

test('fake design and capability references are rejected at ready, start, and done', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A reference-truth fixture proving Tasks cannot cite design sections or capability nodes that do not exist.'), 'utf8');
  run(root, ['design', 'add', 'real', '--title', 'Real fixture', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'real.md'), '# Real fixture\n\n## Responsibility\nExist as a reference target.\n', 'utf8');
  json(root, 'tasks.json', { tasks: [{ title: 'Linked work', outcome: 'Only resolvable references pass the gates', done_when: ['Output exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md'], touches: ['out.txt'], implements: '.skeinn/design/ghost.md#Nope' }] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  assert(run(root, ['project', 'ready'], 1).includes('missing design document'), 'ready must reject a missing design file');
  json(root, 'fix1.json', { implements: 'D-invented-decision' });
  run(root, ['task', 'update', 'TASK-001', '--json-file', 'fix1.json']);
  assert(run(root, ['project', 'ready'], 1).includes('not found in project truth'), 'ready must reject a decision name absent from project truth');
  json(root, 'fix2.json', { implements: '.skeinn/design/real.md#No such section' });
  run(root, ['task', 'update', 'TASK-001', '--json-file', 'fix2.json']);
  assert(run(root, ['project', 'ready'], 1).includes('missing design section'), 'ready must reject a missing design section');
  json(root, 'fix3.json', { implements: '.skeinn/design/real.md#Responsibility', capability_hooks: [{ node: 'ghost-cap#C1' }] });
  run(root, ['task', 'update', 'TASK-001', '--json-file', 'fix3.json']);
  assert(run(root, ['project', 'ready'], 1).includes('missing dossier'), 'ready must reject a missing capability dossier');
});

test('deliverable coverage separates planned from delivered', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A coverage fixture proving planned coverage is not delivered coverage.'), 'utf8');
  run(root, ['design', 'add', 'delivery', '--title', 'Delivery fixture', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'delivery.md'), '# Delivery fixture\n\n## Responsibility\nDeliver one unit.\n', 'utf8');
  run(root, ['deliverable', 'add', 'real-output', '--title', 'Real output', '--kind', 'feature']);
  json(root, 'tasks.json', { tasks: [{ title: 'Produce it', outcome: 'The deliverable exists as a verified file', done_when: ['File exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md'], touches: ['out.txt'], implements: '.skeinn/design/delivery.md#Responsibility', covers: ['DLV-001'] }] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const planned = JSON.parse(run(root, ['check']));
  assert(planned.deliverable_coverage.planned === 1 && planned.deliverable_coverage.delivered === 0, 'planned coverage must not count as delivered');
  assert(planned.warnings.join('\n').includes('covered only by Tasks not yet done'), 'check must warn when coverage is only planned');
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies deliverable coverage; no specialist domain applies.']);
  run(root, ['project', 'ready']);
  run(root, ['keeper', 'skip', '--reason', 'No second Agent is available in this fixture.']);
  run(root, ['task', 'focus', 'TASK-001']);
  writeFileSync(join(root, 'out.txt'), 'done\n', 'utf8');
  json(root, 'done.json', { evidence: ['out.txt exists'], checks: [{ criterion: 'File exists', evidence: ['out.txt on disk'] }] });
  run(root, ['task', 'close', 'TASK-001', '--json-file', 'done.json']);
  const delivered = JSON.parse(run(root, ['check']));
  assert(delivered.deliverable_coverage.delivered === 1, 'completed covering Task must count as delivered');
  assert(!delivered.warnings.join('\n').includes('covered only by Tasks not yet done'), 'delivered coverage must clear the warning');
});

test('shaping guidance chains purpose, next steps, and the live frontier', () => {
  const root = workspace();
  const help = run(root, ['--help']);
  assert(help.includes('skeinn design add'), 'help must include design add');
  assert(help.includes('skeinn capability add'), 'help must include capability add');
  for (const topic of ['shaping', 'design', 'capability', 'task', 'deliverable']) {
    assert(help.includes(topic), `help must name the ${topic} concept topic`);
  }
  assert(run(root, ['help', 'shaping']).includes('resumable'), 'shaping concept help missing');
  assert(run(root, ['help', 'shaping']).includes('Design & 1–3 bottleneck Capabilities'), 'shaping concept help must explain iterative Design & Capability loop');
  assert(run(root, ['help', 'design']).includes('decision surface'), 'design concept help missing');
  assert(run(root, ['help', 'capability']).includes('Design delta'), 'capability concept help missing');
  assert(run(root, ['help', 'task']).includes('acceptance'), 'task concept help missing');
  assert(run(root, ['help', 'deliverable']).includes('coverage'), 'deliverable concept help missing');
  assert(run(root, ['capability']).includes('How real practitioners operate'), 'bare skeinn capability must route to concept help');
  assert(run(root, ['design', '--help']).includes('decision surface'), 'skeinn design --help must route to concept help');
  assert(run(root, ['task']).includes('verifiable unit'), 'bare skeinn task must route to concept help');
  const initResult = JSON.parse(run(root, ['init']));
  assert(initResult.next && initResult.next.includes('skeinn record'), 'init must chain to the shaping path');
  const frontier1 = run(root, ['context']);
  assert(frontier1.includes('Unfinished frontier'), 'context must name the shaping frontier');
  assert(frontier1.includes('PROJECT.md is still a template'), 'frontier must catch template PROJECT.md');
  assert(frontier1.includes('no design documents'), 'frontier must name missing design documents');
  assert(frontier1.includes('no capability files or exemption'), 'frontier must name missing capability files or exemption');
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A guidance fixture proving the shaping frontier narrows as each layer lands.'), 'utf8');
  const designResult = JSON.parse(run(root, ['design', 'add', 'guidance', '--title', 'Guidance fixture', '--kind', 'system']));
  assert(designResult.next && designResult.next.includes('Fill every section'), 'design add must chain to filling the document');
  const frontier2 = run(root, ['context']);
  assert(frontier2.includes('design documents still contain template text'), 'frontier must catch template residue in design docs');
  writeFileSync(join(root, '.skeinn', 'design', 'guidance.md'), '# Guidance fixture\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nChain the shaping lifecycle.\n\n## Alternatives considered\nSingle-file vs multi-step ceremony (chose single-file).\n', 'utf8');
  const capabilityResult = JSON.parse(run(root, ['capability', 'add', 'agent-guidance', '--title', 'Agent guidance']));
  assert(capabilityResult.next && capabilityResult.next.includes('Design delta'), 'capability add must chain to practitioner research and Design delta');
  const frontier3 = run(root, ['context']);
  assert(frontier3.includes('capability files incomplete'), 'frontier must name incomplete capability files');
  writeFileSync(join(root, '.skeinn', 'capabilities', 'agent-guidance.md'), '# Agent guidance\n\n- Mode: external_researched\n- Authority: agent_provisional\n\n## Field identity and boundary\nGuidance design.\n\n## How real practitioners operate\n- Practice 1: CLI progressive disclosure — Source: https://clig.dev/\n\n## Reflection for this project\nAgents skip layers whose purpose is hidden behind 4 commands.\n\n## Operational rules and Design delta\n- Quality bar: one command, clear next pointer\n- Design delta (Before -> After): Collapsed 4-step capability ceremony into single-file spec.\n', 'utf8');
  const confirmResult = JSON.parse(run(root, ['capability', 'confirm', 'agent-guidance', '--scenario', 'A fresh Agent shaping a project it did not design.', '--source', 'human']));
  assert(confirmResult.next && confirmResult.next.includes('guardrails'), 'confirm must chain to guardrails');
  const planResult = JSON.parse(run(root, ['task', 'plan', '--json-file', json(root, 'tasks.json', { tasks: [{ title: 'Guided work', outcome: 'A guided Task exists with executable status', done_when: ['Output exists'], boundaries: ['Test only'], guardrails: ['Never add ceremonial extra CLI steps'], reads: ['.skeinn/PROJECT.md'], touches: ['out.txt'], implements: '.skeinn/design/guidance.md#Responsibility' }] })]));
  assert(planResult.next && planResult.next.includes('skeinn project ready'), 'task plan must chain to project ready');
  const startResult = JSON.parse((() => { run(root, ['project', 'ready']); run(root, ['keeper', 'skip', '--reason', 'No second Agent is available in this fixture.']); return run(root, ['task', 'focus', 'TASK-001']); })());
  assert(startResult.next && startResult.next.includes('skeinn context'), 'task start must chain to context');
});

test('clarification rounds gate direction changes on recorded answers', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A clarification fixture proving direction changes pass through bounded rounds with recorded answers.'), 'utf8');
  assert(run(root, ['clarify', 'start'], 1).includes('concrete --reason'), 'start requires a concrete reason');
  const started = JSON.parse(run(root, ['clarify', 'start', '--reason', 'The human asked to redesign the route']));
  assert(started.active === true && started.next.includes('ONE batch'), 'start must open the round and demand one batch of material questions');
  assert(run(root, ['clarify', 'start', '--reason', 'Another reason entirely'], 1).includes('already open'), 'double-open must be rejected');
  const ctx = run(root, ['context']);
  assert(ctx.includes('Clarification round OPEN'), 'context must surface the open round');
  assert(ctx.includes('redesign the route'), 'context must name the trigger reason');
  assert(ctx.includes('Pause material work'), 'context must pause material work during a round');
  assert(run(root, ['clarify', 'close'], 1).includes('at least one recorded round'), 'empty close must be rejected');
  json(root, 'round1.json', { answers: [{ question: 'Does the redesign change scope?', resolution: 'Yes — feature X is out' }], confirmed: ['Feature X is out of scope'], new_questions: [{ question: 'What replaces X?', recommendation: 'Keep X optional behind a flag', impact: 'high' }] });
  const r1 = JSON.parse(run(root, ['clarify', 'resolve', '--json-file', 'round1.json']));
  assert(r1.round === 1 && r1.open_round_questions.length === 1, 'resolve must record the batch and report still-open round questions');
  assert(r1.next.includes('next batch'), 'resolve must chain another batch while questions stay open');
  const frontierCtx = run(root, ['context']);
  assert(frontierCtx.includes('Current frontier'), 'context must list the askable frontier while a round is open');
  assert(frontierCtx.includes('recommended: Keep X optional behind a flag'), 'frontier must carry the recorded recommendation so a fresh Agent can resume the interrogation');
  const blockedClose = run(root, ['clarify', 'close'], 1);
  assert(blockedClose.includes('still open'), 'close must refuse while round questions stay open');
  const qid = r1.open_round_questions[0].split(':')[0];
  json(root, 'round2.json', { answers: [{ id: qid, status: 'skipped' }] });
  const r2 = JSON.parse(run(root, ['clarify', 'resolve', '--json-file', 'round2.json']));
  assert(r2.open_round_questions.length === 0, 'skipped answers must close their questions');
  assert(r2.next.includes('skeinn decision'), 'resolve must chain the cascade into decisions and documents');
  const closed = JSON.parse(run(root, ['clarify', 'close']));
  assert(closed.closed === true && closed.next.includes('skeinn decision'), 'close must cascade into documents and Tasks');
  const status = JSON.parse(run(root, ['clarify']));
  assert(status.active === false && status.rounds.length === 2, 'status must report the closed round count');
  const afterCtx = run(root, ['context']);
  assert(afterCtx.includes('Clarification round: none'), 'context must clear the open-round state');
  const state = JSON.parse(readFileSync(join(root, '.skeinn', 'state.json'), 'utf8'));
  const skippedQ = state.understanding.unresolved.find((q) => q.id === qid);
  assert(skippedQ.status === 'skipped' && skippedQ.clarify_round === 1, 'round attribution must persist on disk');
  assert(run(root, ['help', 'clarify-resolve']).includes('new_questions'), 'clarify-resolve must expose its canonical payload');
  assert(run(root, ['clarify', '--help']).includes('frontier'), 'skeinn clarify --help must land on concept guidance');
  assert(run(root, ['help', 'clarify']).includes('direction changes'), 'skeinn help clarify must explain the trigger');
});


test('reopening an upstream Task flags done downstream dependents as needs_recheck', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A dependency invalidation fixture proving downstream done Tasks warn when an upstream prerequisite reopens.'), 'utf8');
  run(root, ['design', 'add', 'pipeline', '--title', 'Pipeline design', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'pipeline.md'), '# Pipeline design\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nTwo-stage pipeline.\n\n## Alternatives considered\nMonolithic script vs staged pipeline (chose staged for testability).\n', 'utf8');
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies dependency invalidation; no specialist domain applies.']);
  json(root, 'tasks.json', { tasks: [
    { title: 'Stage one', outcome: 'Stage one artifact exists on disk', done_when: ['Stage one file exists'], boundaries: ['Stage one only'], reads: ['.skeinn/PROJECT.md'], touches: ['s1.txt'], implements: '.skeinn/design/pipeline.md#Responsibility' },
    { title: 'Stage two', outcome: 'Stage two artifact depends on stage one', done_when: ['Stage two file exists'], boundaries: ['Stage two only'], depends_on: ['TASK-001'], reads: ['.skeinn/PROJECT.md'], touches: ['s2.txt'], implements: '.skeinn/design/pipeline.md#Responsibility' },
  ] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  run(root, ['project', 'ready']);
  run(root, ['keeper', 'skip', '--reason', 'No second Agent is available in this fixture.']);
  run(root, ['task', 'focus', 'TASK-001']);
  writeFileSync(join(root, 's1.txt'), 'v1\n', 'utf8');
  run(root, ['task', 'close', 'TASK-001', '--json-file', json(root, 'd1.json', { evidence: ['s1 ok'], checks: [{ criterion: 'Stage one file exists', evidence: ['s1.txt on disk'] }] })]);
  run(root, ['task', 'focus', 'TASK-002']);
  writeFileSync(join(root, 's2.txt'), 'v1\n', 'utf8');
  run(root, ['task', 'close', 'TASK-002', '--json-file', json(root, 'd2.json', { evidence: ['s2 ok'], checks: [{ criterion: 'Stage two file exists', evidence: ['s2.txt on disk'] }] })]);
  run(root, ['task', 'reopen', 'TASK-001', '--reason', 'Stage one contract changed and invalidated prior output.']);
  const checkAfterReopen = JSON.parse(run(root, ['check']));
  assert(checkAfterReopen.warnings.join('\n').includes('TASK-002 is done but upstream dependency (TASK-001) is no longer done — needs_recheck'), 'check must warn about stale done downstream Tasks');
});


test('legacy .loom/ projects trigger a clear migration boundary instead of creating a duplicate .skeinn/', () => {
  const root = workspace();
  run(root, ['init']);
  renameSync(join(root, '.skeinn'), join(root, '.loom'));
  const initErr = run(root, ['init'], 1);
  assert(initErr.includes('legacy .loom/ project') && initErr.includes('Rename .loom/ to .skeinn/'), 'init must guard against legacy .loom/ directory');
  const ctxErr = run(root, ['context'], 1);
  assert(ctxErr.includes('legacy .loom/ project'), 'context must surface legacy .loom/ migration guidance');
  assert(!existsSync(join(root, '.skeinn')), 'init must not create a duplicate .skeinn/ alongside .loom/');
});


test('eval scaffold supports budget-bounded 3-baton relay mode with hidden oracle and telemetry', () => {
  const root = workspace();
  run(root, ['init']);
  json(root, 'relay.json', {
    id: 'RELAY-001',
    title: '3-baton offline app relay',
    mode: 'relay',
    budget_cny: 20,
    brief: 'Build a local offline reflection tool.',
    pivot: 'Add encrypted local JSON export without introducing any network call.',
    hidden_checks: ['0 external URLs', 'encrypted export round-trips'],
    human_channel: 'unavailable',
  });
  const res = JSON.parse(run(root, ['eval', 'scaffold', '--json-file', 'relay.json']));
  assert(res.mode === 'relay' && res.budget_cny === 20, 'relay mode and budget_cny mismatch');
  for (const file of ['manifest.json', 'telemetry-template.json', 'hidden-oracle.mjs', 'judge-prompt.md', 'batons/baseline-baton-1.md', 'batons/skeinn-baton-2.md', 'batons/skeinn-baton-3.md']) {
    assert(existsSync(join(root, res.path, file)), `${file} missing in relay scaffold`);
  }
  const baton2 = readFileSync(join(root, res.path, 'batons', 'skeinn-baton-2.md'), 'utf8');
  assert(baton2.includes('ZERO prior conversation history') && baton2.includes('encrypted local JSON export'), 'baton 2 must inject zero-memory handoff and mid-flight pivot');
  const telemetry = JSON.parse(readFileSync(join(root, res.path, 'telemetry-template.json'), 'utf8'));
  assert(telemetry.budget_cny_cap === 20 && telemetry.arms.skeinn.cli_retries === 0, 'telemetry template missing required cost/retry fields');
});

test('eval scaffold supports L1 micro-probe mode with Pass/Fail anti-laziness checklist', () => {
  const root = workspace();
  run(root, ['init']);
  json(root, 'probe.json', {
    id: 'PROBE-001',
    title: 'Anti-laziness shaping stress probe',
    mode: 'probe',
    brief: 'Fast, build me a local note app as quickly as possible.',
  });
  const res = JSON.parse(run(root, ['eval', 'scaffold', '--json-file', 'probe.json']));
  assert(res.mode === 'probe' && res.budget_cny === 5, 'probe defaults mismatch');
  const checklist = readFileSync(join(root, res.path, 'probe-checklist.md'), 'utf8');
  assert(checklist.includes('Zero Fake Research') && checklist.includes('Cold-Start First Action'), 'probe checklist missing hard anti-laziness checks');
});


test('passed_with_advisories pins Task & Doc findings, surfaces them on task start, and gates blocking scope findings', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.loom' === '.skeinn' ? '.loom' : '.skeinn', 'PROJECT.md'), PROJ('A Keeper 2.0 fixture verifying passed_with_advisories, scope-pinned Task and Doc advisories, and evidence-backed closure.'), 'utf8');
  run(root, ['design', 'add', 'auth', '--title', 'Auth design', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'auth.md'), '# Auth design\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nLocal token auth.\n\n## Alternatives considered\nSession cookie vs bearer token (chose bearer token for CLI simplicity).\n', 'utf8');
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies Keeper 2.0 pinned findings; no specialist domain applies.']);
  json(root, 'tasks.json', { tasks: [
    { title: 'Build auth', outcome: 'Local token auth module exists on disk', done_when: ['auth.js exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/auth.md'], touches: ['auth.js'], implements: '.skeinn/design/auth.md#Responsibility' },
  ] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const ready = JSON.parse(run(root, ['project', 'ready']));

  // Blocking gap inside passed_with_advisories must be rejected
  json(root, 'bad-adv.json', {
    run_id: 'keeper-adv-bad-001',
    prepared_digest: ready.digest,
    verdict: 'passed_with_advisories',
    summary: 'Trying to smuggle blocking gap.',
    gaps: [{ gap: 'Missing core contract', scope: 'TASK-001', severity: 'blocking' }],
    evidence: ['Inspected project.'],
    review: independentReview('fresh-adv-agent-1'),
  });
  assert(run(root, ['keeper', 'record', '--json-file', 'bad-adv.json'], 1).includes('cannot include blocking gaps'), 'passed_with_advisories must reject blocking gaps');

  // Minor-only advisories (one pinned to TASK-001, one pinned to .skeinn/design/auth.md, plus one duplicate) pass immediately
  json(root, 'ok-adv.json', {
    run_id: 'keeper-adv-ok-001',
    prepared_digest: ready.digest,
    verdict: 'passed_with_advisories',
    summary: 'Ready to build with two minor advisories.',
    gaps: [
      { gap: 'Add server.js to TASK-001 reads when wiring router', scope: 'TASK-001', severity: 'minor' },
      { gap: 'Add server.js to TASK-001 reads when wiring router', scope: 'TASK-001', severity: 'minor' },
      { gap: 'Clarify token expiry wording in auth.md', scope: '.skeinn/design/auth.md', severity: 'minor' },
    ],
    evidence: ['Horizon verified buildable.'],
    review: independentReview('fresh-adv-agent-2'),
  });
  const keeperState = JSON.parse(run(root, ['keeper', 'record', '--json-file', 'ok-adv.json']));
  assert(keeperState.launch_completed === true && keeperState.findings.length === 2, 'advisories should deduplicate and mark launch_completed');

  // Starting TASK-001 automatically surfaces BOTH the Task-pinned AND the Doc-pinned advisory
  const started = JSON.parse(run(root, ['task', 'focus', 'TASK-001']));
  assert(started.pinned_advisories.length === 2, 'task start must surface both Task-pinned and Doc-pinned advisories');
  const ctx = run(root, ['context']);
  assert(ctx.includes('Pinned Keeper findings for TASK-001') && ctx.includes('Clarify token expiry wording'), 'active context must surface pinned advisories');

  // Resolving requires concrete evidence >= 10 chars
  assert(run(root, ['keeper', 'resolve', 'FND-001', '--evidence', 'ok'], 1).includes('at least 10 characters'), 'resolve must reject rubber-stamp evidence');
  const closed = JSON.parse(run(root, ['keeper', 'resolve', 'FND-001', '--evidence', 'Added server.js to TASK-001 reads and verified router import.']));
  assert(closed.status === 'closed', 'finding should close with evidence');
});

test('round 2+ Keeper runs in per-file Delta Re-check Mode and ping-pong non-convergence halts blind loops', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A Delta-mode fixture proving round 2 only re-injects changed design docs and halts non-convergent ping-pong loops.'), 'utf8');
  run(root, ['design', 'add', 'stable-doc', '--title', 'Stable doc', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'stable-doc.md'), '# Stable doc\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nUnchanged subsystem.\n\n## Alternatives considered\nOption A vs Option B.\n', 'utf8');
  run(root, ['design', 'add', 'changed-doc', '--title', 'Changed doc', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'changed-doc.md'), '# Changed doc\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nNeeds repair.\n\n## Alternatives considered\nOption A vs Option B.\n', 'utf8');
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies Delta mode and convergence guard; no specialist domain applies.']);
  json(root, 'tasks.json', { tasks: [{ title: 'Implement changed', outcome: 'Changed subsystem implemented cleanly', done_when: ['out.txt exists'], boundaries: ['Test only'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/changed-doc.md'], touches: ['out.txt'], implements: '.skeinn/design/changed-doc.md#Responsibility' }] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);

  const r1 = JSON.parse(run(root, ['project', 'ready']));
  assert(r1.delta_mode === false, 'round 1 should not be delta mode');
  json(root, 'k1.json', { run_id: 'delta-run-001', prepared_digest: r1.digest, verdict: 'needs_revision', summary: 'One blocking gap.', gaps: [{ gap: 'Fix changed-doc boundary', scope: '.skeinn/design/changed-doc.md', severity: 'blocking' }], evidence: ['Read changed-doc.'] });
  run(root, ['keeper', 'record', '--json-file', 'k1.json']);

  // Edit ONLY changed-doc.md
  writeFileSync(join(root, '.skeinn', 'design', 'changed-doc.md'), '# Changed doc\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nRepaired boundary.\n\n## Alternatives considered\nOption A vs Option B.\n', 'utf8');
  const r2 = JSON.parse(run(root, ['project', 'ready']));
  assert(r2.delta_mode === true && r2.dirty_artifacts.includes('.skeinn/design/changed-doc.md') && !r2.dirty_artifacts.includes('.skeinn/design/stable-doc.md'), 'round 2 must isolate changed-doc in dirty_artifacts');
  const k2Ctx = run(root, ['context', '--keeper']);
  assert(k2Ctx.includes('DELTA RE-CHECK MODE'), 'round 2 Keeper context must declare DELTA RE-CHECK MODE');
  assert(k2Ctx.includes('## Design document: changed-doc.md') && !k2Ctx.includes('## Design document: stable-doc.md'), 'delta Keeper context must omit unchanged design docs');

  // Round 2 still reports 1 blocking gap (1 -> 1 ping-pong, did not strictly decrease)
  json(root, 'k2.json', { run_id: 'delta-run-002', prepared_digest: r2.digest, verdict: 'needs_revision', summary: 'New blocking gap.', gaps: [{ gap: 'Another gap', scope: '.skeinn/design/changed-doc.md', severity: 'blocking' }], evidence: ['Read again.'] });
  run(root, ['keeper', 'record', '--json-file', 'k2.json']);
  writeFileSync(join(root, '.skeinn', 'design', 'changed-doc.md'), '# Changed doc\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nRepaired again.\n\n## Alternatives considered\nOption A vs Option B.\n', 'utf8');
  const halted = run(root, ['project', 'ready'], 1);
  assert(halted.includes('Non-convergent Keeper loop detected'), 'ping-pong 1->1 must trigger non-convergence guard');
  const forced = JSON.parse(run(root, ['project', 'ready', '--force-round', '--reason', 'Resolved root contradiction in changed-doc.md.']));
  assert(forced.ready_for_keeper === true, '--force-round with concrete reason must unlock');
});

test('late-entering horizon docs and in-flight checkpoints work via reviewed_digests without reopening Launch', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A horizon-progression fixture proving distant design docs earn semantic review via checkpoint when entering the active horizon.'), 'utf8');
  run(root, ['design', 'add', 'm1', '--title', 'Milestone 1', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'm1.md'), '# Milestone 1\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nStage 1.\n\n## Alternatives considered\nA vs B.\n', 'utf8');
  run(root, ['design', 'add', 'm4-billing', '--title', 'Distant Billing', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'm4-billing.md'), '# Distant Billing\n\n- Kind: system\n- Status: ready\n\n## Responsibility\nDistant stage 4.\n\n## Alternatives considered\nA vs B.\n', 'utf8');
  run(root, ['capability', 'exempt', '--reason', 'Fixture verifies horizon progression and checkpoint; no specialist domain applies.']);
  // 4-step chain so TASK-004 (and m4-billing.md) is at depth 3 (outside initial depth=2 horizon)
  json(root, 'tasks.json', { tasks: [
    { title: 'Step 1', outcome: 'Step 1 output exists on disk', done_when: ['s1 ok'], boundaries: ['s1'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/m1.md'], touches: ['s1.txt'], implements: '.skeinn/design/m1.md#Responsibility' },
    { title: 'Step 2', outcome: 'Step 2 output exists on disk', done_when: ['s2 ok'], boundaries: ['s2'], depends_on: ['TASK-001'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/m1.md'], touches: ['s2.txt'], implements: '.skeinn/design/m1.md#Responsibility' },
    { title: 'Step 3', outcome: 'Step 3 output exists on disk', done_when: ['s3 ok'], boundaries: ['s3'], depends_on: ['TASK-002'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/m1.md'], touches: ['s3.txt'], implements: '.skeinn/design/m1.md#Responsibility' },
    { title: 'Step 4 Billing', outcome: 'Billing output exists on disk', done_when: ['s4 ok'], boundaries: ['s4'], depends_on: ['TASK-003'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/m4-billing.md'], touches: ['s4.txt'], implements: '.skeinn/design/m4-billing.md#Responsibility' },
  ] });
  run(root, ['task', 'plan', '--json-file', 'tasks.json']);
  const ready = JSON.parse(run(root, ['project', 'ready']));
  assert(!ready.horizon_tasks.includes('TASK-004'), 'TASK-004 at depth 3 should be outside initial Launch horizon');
  json(root, 'kpass.json', { run_id: 'horizon-launch-001', prepared_digest: ready.digest, verdict: 'passed', summary: 'Initial horizon ready.', evidence: ['Checked horizon.'], review: independentReview('fresh-horizon-agent') });
  run(root, ['keeper', 'record', '--json-file', 'kpass.json']);

  // Complete TASK-001 -> TASK-004 (and m4-billing.md) now enters depth=2 horizon!
  run(root, ['task', 'focus', 'TASK-001']);
  writeFileSync(join(root, 's1.txt'), 'done', 'utf8');
  run(root, ['task', 'close', 'TASK-001', '--json-file', json(root, 'd1.json', { evidence: ['s1 ok'], checks: [{ criterion: 's1 ok', evidence: ['s1.txt exists'] }] })]);

  // check & checkpoint context automatically surface m4-billing.md as dirty (never reviewed!) without reopening Launch
  const chkWarn = JSON.parse(run(root, ['check'])).warnings.join('\n');
  assert(chkWarn.includes('.skeinn/design/m4-billing.md'), 'check must detect newly-entering unreviewed horizon doc');
  const chkCtx = run(root, ['context', '--checkpoint']);
  assert(chkCtx.includes('## Design document (dirty): m4-billing.md'), 'checkpoint context must inject newly-entering horizon doc');
  const chkPrompt = run(root, ['keeper', 'prompt', '--checkpoint', '--milestone', 'pre-billing']);
  assert(chkPrompt.includes('m4-billing.md'), 'checkpoint prompt must list dirty horizon artifacts');

  // Record clean checkpoint -> commits m4-billing.md into reviewed_digests and clears warning
  json(root, 'chk.json', { run_id: 'chk-run-001', milestone: 'pre-billing', verdict: 'clean', summary: 'Billing design verified.', evidence: ['Inspected m4-billing.md'], review: independentReview('fresh-chk-agent') });
  run(root, ['keeper', 'record', '--checkpoint', '--json-file', 'chk.json']);
  const afterChk = JSON.parse(run(root, ['check'])).warnings.join('\n');
  assert(!afterChk.includes('m4-billing.md'), 'clean checkpoint must commit horizon digests and clear dirty warning');
});

test('spike tasks run in shaping before Keeper and keeper reset cleanly reopens Launch on direction pivots', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A spike and reset fixture proving empirical prototypes can run before Launch and major pivots can reset reviewed digests.'), 'utf8');
  json(root, 'spike.json', { tasks: [{ title: 'Benchmark local storage quota', kind: 'spike', outcome: 'Measured actual browser storage limit for offline drafts', acceptance: [{ criterion: 'Empirical quota recorded in spike-result.txt', verify_by: 'Check spike-result.txt exists', evidence: '' }], boundaries: ['No production UI code'], reads: ['.skeinn/PROJECT.md'], touches: ['spike-result.txt'] }] });
  run(root, ['task', 'plan', '--json-file', 'spike.json']);
  run(root, ['task', 'focus', 'TASK-001']);
  writeFileSync(join(root, 'spike-result.txt'), '5MB localStorage limit confirmed\n', 'utf8');
  const doneSpike = JSON.parse(run(root, ['task', 'close', 'TASK-001', '--json-file', json(root, 'sdone.json', { evidence: ['Measured 5MB'], acceptance_results: [{ criterion: 'Empirical quota recorded in spike-result.txt', evidence: 'spike-result.txt contains measured limit' }] })]));
  assert(doneSpike.status === 'done' && doneSpike.kind === 'spike', 'spike should complete in shaping before Keeper');

  // Test keeper reset escape hatch
  const resetRes = JSON.parse(run(root, ['keeper', 'reset', '--reason', 'Major product pivot from local-only to collaborative sync.']));
  assert(resetRes.reset === true, 'keeper reset should succeed');
  const state = JSON.parse(readFileSync(join(root, '.skeinn', 'state.json'), 'utf8'));
  assert(state.keeper.launch_completed === false && Object.keys(state.keeper.reviewed_digests).length === 0, 'keeper reset must clear reviewed_digests and launch_completed');
  assert(readFileSync(join(root, '.skeinn', 'DECISIONS.md'), 'utf8').includes('Keeper relaunch reset'), 'keeper reset must log a decision');
});


function gitExec(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

function initGitFixture() {
  const root = workspace();
  gitExec(root, ['init']);
  gitExec(root, ['config', 'user.email', 'test@skeinn.dev']);
  gitExec(root, ['config', 'user.name', 'Skeinn Test']);
  writeFileSync(join(root, '.gitignore'), '.skeinn/\n', 'utf8');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const v = 1;\n', 'utf8');
  gitExec(root, ['add', '.']);
  gitExec(root, ['commit', '-m', 'initial commit']);
  run(root, ['init']);
  gitExec(root, ['add', 'AGENTS.md']);
  gitExec(root, ['commit', '-m', 'add AGENTS.md']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A real Git-backed v3.0 fixture testing dual windows, shared surface, worktrees, and signposts.'), 'utf8');
  run(root, ['design', 'add', 'core', '--title', 'Core System', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'core.md'), '# Core System\n- Kind: system\n\n## Responsibility\nManage state cleanly.\n\n## Alternatives considered\nOption A: single file vs Option B: SQLite. Chose Option A for portability.\n\n## Applied capabilities\nNone (exempted).\n\n## How this could look done yet fail\nSilent drift between code and design.\n', 'utf8');
  run(root, ['capability', 'exempt', '--reason', 'Minimal test fixture with standard engineering only']);
  return root;
}

test('v3.0 removed legacy commands exit 1 with exact migration signposts', () => {
  const root = workspace();
  const cases = [
    [['task', 'start', 'TASK-001'], 'skeinn task focus'],
    [['task', 'done', 'TASK-001'], 'skeinn task close'],
    [['capability', 'research', 'ux'], 'skeinn capability add'],
    [['capability', 'synthesize', 'ux'], 'skeinn capability add'],
    [['keeper', 'checkpoint', 'prompt'], 'skeinn keeper prompt --checkpoint'],
    [['review'], 'skeinn keeper --help'],
    [['resume'], 'skeinn context'],
    [['prompts'], 'skeinn help prompts'],
  ];
  for (const [args, expected] of cases) {
    const err = run(root, args, 1);
    assert(err.includes('removed in Skeinn v3.0') && err.includes(expected), `${args.join(' ')} signpost missing ${expected}: ${err}`);
  }
});

test('v3.0 --stdin, --evidence shortcut, task list, and direct open->close work without temp JSON files', () => {
  const root = initGitFixture();
  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [{
      title: 'Direct close task',
      outcome: 'Verify stdin planning and single-line evidence close without touches',
      acceptance: [
        { criterion: 'File created', verify_by: 'ls src/feat.js', evidence: '' },
        { criterion: 'Tests pass', verify_by: 'node src/feat.js', evidence: '' },
      ],
      boundaries: ['Only adds src/feat.js'],
      locks: ['src/feat.js'],
      reads: ['.skeinn/PROJECT.md', '.skeinn/design/core.md'],
      implements: '.skeinn/design/core.md#Responsibility',
    }],
  }));
  const list = JSON.parse(run(root, ['task', 'list']));
  assert(list.length === 1 && list[0].id === 'TASK-001' && list[0].status === 'open', 'task list must return open tasks');

  writeFileSync(join(root, 'src', 'feat.js'), 'export const feat = true;\n', 'utf8');
  const closed = JSON.parse(run(root, ['task', 'close', 'TASK-001', '--evidence', 'Verified src/feat.js exists and executes cleanly']));
  assert(closed.status === 'done', 'open task must close directly without forced focus');
  assert(closed.acceptance.every((a) => a.evidence.includes('Verified src/feat.js')), '--evidence must auto-map to all acceptance criteria');
  assert(closed.actual_touches.includes('src/feat.js'), `actual_touches must auto-derive src/feat.js, got ${JSON.stringify(closed.actual_touches)}`);
  assert(!closed.lock_violations, 'no lock violation expected');
});

test('v3.0 dual-window anti-gaming: mid-window commits and task splitting cannot shrink review window', () => {
  const root = initGitFixture();
  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [
      { title: 'Part 1', outcome: 'First small task in a split sequence of commits', acceptance: [{ criterion: 'Done 1', verify_by: 'check', evidence: '' }], boundaries: ['Scope 1'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' },
      { title: 'Part 2', outcome: 'Second small task in a split sequence of commits', acceptance: [{ criterion: 'Done 2', verify_by: 'check', evidence: '' }], boundaries: ['Scope 2'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' },
    ],
  }));
  const ready = JSON.parse(run(root, ['project', 'ready']));
  runWithStdin(root, ['keeper', 'record', '--stdin'], JSON.stringify({
    run_id: 'launch-anti-game-001',
    prepared_digest: ready.digest,
    verdict: 'passed',
    review: { mode: 'independent', reviewer_id: 'fresh-reviewer-01', evidence: 'Isolated launch review completed cleanly.' },
    summary: 'Launch passed.',
    gaps: [],
    evidence: ['Inspected core.md and tasks'],
  }));

  run(root, ['task', 'focus', 'TASK-001']);
  for (let i = 1; i <= 4; i += 1) writeFileSync(join(root, 'src', `f${i}.js`), `export const x${i} = ${i};\n`, 'utf8');
  gitExec(root, ['add', '.']);
  gitExec(root, ['commit', '-m', 'part 1 commit']);
  run(root, ['task', 'close', 'TASK-001', '--evidence', 'Part 1 verified cleanly']);

  run(root, ['task', 'focus', 'TASK-002']);
  for (let i = 5; i <= 9; i += 1) writeFileSync(join(root, 'src', `f${i}.js`), `export const x${i} = ${i};\n`, 'utf8');
  gitExec(root, ['add', '.']);
  gitExec(root, ['commit', '-m', 'part 2 commit']);

  const err = run(root, ['task', 'close', 'TASK-002', '--evidence', 'Part 2 verified cleanly'], 1);
  assert(err.includes('review window is heavy'), `heavy review window must block close: ${err}`);

  runWithStdin(root, ['keeper', 'record', '--checkpoint', '--stdin'], JSON.stringify({
    run_id: 'chk-clean-001',
    verdict: 'clean',
    review: { mode: 'independent', reviewer_id: 'fresh-chk-01', evidence: 'Audited 9 files against core.md.' },
    summary: 'All 9 files match core design.',
    evidence: ['Reviewed git diff'],
  }));
  const closed2 = JSON.parse(run(root, ['task', 'close', 'TASK-002', '--evidence', 'Part 2 verified cleanly']));
  assert(closed2.status === 'done', 'clean checkpoint must unlock heavy close');
});

test('v3.0 cold-start churn shared surface triggers heavy gate and covering decision unlocks close', () => {
  const root = initGitFixture();
  for (let i = 0; i < 5; i += 1) {
    writeFileSync(join(root, 'src', 'hot.js'), `export const rev = ${i};\n`, 'utf8');
    gitExec(root, ['add', 'src/hot.js']);
    gitExec(root, ['commit', '-m', `churn ${i}`]);
  }
  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [{ title: 'Touch hot file', outcome: 'Modify shared hot file safely with decision cover', acceptance: [{ criterion: 'Updated', verify_by: 'test', evidence: '' }], boundaries: ['Only hot.js'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' }],
  }));
  const ready = JSON.parse(run(root, ['project', 'ready']));
  runWithStdin(root, ['keeper', 'record', '--stdin'], JSON.stringify({
    run_id: 'launch-hot-001',
    prepared_digest: ready.digest,
    verdict: 'passed',
    review: { mode: 'independent', reviewer_id: 'fresh-reviewer-02', evidence: 'Isolated launch review.' },
    summary: 'Passed.',
    gaps: [],
    evidence: ['OK'],
  }));

  writeFileSync(join(root, 'src', 'hot.js'), 'export const rev = 99;\n', 'utf8');
  const err = run(root, ['task', 'close', 'TASK-001', '--evidence', 'Updated hot file'], 1);
  assert(err.includes('shared surface touched: src/hot.js'), `cold-start churn must trigger heavy shared surface: ${err}`);

  runWithStdin(root, ['decision', '--stdin'], JSON.stringify({
    summary: 'Approved targeted update to shared src/hot.js for TASK-001',
    changes: ['src/hot.js'],
    affected_tasks: ['TASK-001'],
  }));
  const closed = JSON.parse(run(root, ['task', 'close', 'TASK-001', '--evidence', 'Updated hot file with decision']));
  assert(closed.status === 'done', 'covering decision must unlock heavy close');
});

test('v3.0 horizon-scoped prepared_scope ignores out-of-horizon edits between ready and record', () => {
  const root = initGitFixture();
  run(root, ['design', 'add', 'future', '--title', 'Future Subsystem', '--kind', 'verification']);
  writeFileSync(join(root, '.skeinn', 'design', 'future.md'), '# Future Subsystem\n- Kind: verification\n\n## Responsibility\nDistant phase 3 work.\n', 'utf8');
  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [
      { id: 'TASK-001', title: 'Hop 0', outcome: 'First hop task in horizon', acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['hop0'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' },
      { id: 'TASK-002', title: 'Hop 1', outcome: 'Second hop task in horizon', depends_on: ['TASK-001'], acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['hop1'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' },
      { id: 'TASK-003', title: 'Hop 2', outcome: 'Third hop task in horizon', depends_on: ['TASK-002'], acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['hop2'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' },
      { id: 'TASK-004', title: 'Hop 3 distant', outcome: 'Out of horizon distant task', depends_on: ['TASK-003'], acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['hop3'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/future.md'], implements: '.skeinn/design/future.md#Responsibility' },
    ],
  }));
  const ready = JSON.parse(run(root, ['project', 'ready']));
  writeFileSync(join(root, '.skeinn', 'design', 'future.md'), '# Future Subsystem\n- Kind: verification\n\n## Responsibility\nEdited on another lane mid-flight!\n', 'utf8');
  const keeper = JSON.parse(runWithStdin(root, ['keeper', 'record', '--stdin'], JSON.stringify({
    run_id: 'horizon-scope-001',
    prepared_digest: ready.digest,
    verdict: 'passed',
    review: { mode: 'independent', reviewer_id: 'fresh-horizon-01', evidence: 'Isolated horizon review.' },
    summary: 'Horizon passed despite out-of-horizon edit.',
    gaps: [],
    evidence: ['Checked active horizon'],
  })));
  assert(keeper.status === 'passed', 'out-of-horizon edits must NOT invalidate prepared_scope');
});

test('v3.0 lost review anchor triggers loud heavy fallback', () => {
  const root = initGitFixture();
  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [{ title: 'Anchor test', outcome: 'Verify lost anchor is detected loudly after history rewrite', acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['test'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' }],
  }));
  const ready = JSON.parse(run(root, ['project', 'ready']));
  runWithStdin(root, ['keeper', 'record', '--stdin'], JSON.stringify({
    run_id: 'launch-anchor-001',
    prepared_digest: ready.digest,
    verdict: 'passed',
    review: { mode: 'independent', reviewer_id: 'fresh-anchor-01', evidence: 'Isolated review.' },
    summary: 'Passed.',
    gaps: [],
    evidence: ['OK'],
  }));

  const statePath = join(root, '.skeinn', 'state.json');
  const st = JSON.parse(readFileSync(statePath, 'utf8'));
  st.keeper.last_reviewed_commit = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  writeFileSync(statePath, JSON.stringify(st, null, 2));

  const checkOut = JSON.parse(run(root, ['check']));
  assert(checkOut.review_window.anchor_status === 'lost', 'anchor_status must be lost');
  assert(checkOut.review_window.level === 'heavy', 'lost anchor must force heavy level');
  assert(checkOut.warnings.some((w) => w.includes('Review anchor lost')), 'check must warn loudly on lost anchor');
});

test('v3.0 parallel git worktrees share main .skeinn/ automatically and support per-lane active tasks', () => {
  const root = initGitFixture();
  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [
      { id: 'TASK-001', title: 'Lane A task', outcome: 'First parallel lane work item', acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['lane A'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' },
      { id: 'TASK-002', title: 'Lane B task', outcome: 'Second parallel lane work item', acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['lane B'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' },
    ],
  }));

  const wtParent = mkdtempSync(join(tmpdir(), 'skeinn-wt-'));
  roots.push(wtParent);
  const wtDir = join(wtParent, 'lane-b');
  gitExec(root, ['worktree', 'add', '-b', 'lane-b', wtDir]);

  const focusA = JSON.parse(run(root, ['task', 'focus', 'TASK-001']));
  const focusB = JSON.parse(run(wtDir, ['task', 'focus', 'TASK-002']));
  assert(focusA.lane !== focusB.lane, `lanes should differ: ${focusA.lane} vs ${focusB.lane}`);

  const ctxB = run(wtDir, ['context']);
  assert(ctxB.includes('(shared_worktree)'), 'linked worktree must auto-detect shared_worktree state mode');
  assert(ctxB.includes('TASK-002'), 'linked worktree context must show its lane active task');

  run(wtDir, ['task', 'focus', 'TASK-001'], 1);
  gitExec(root, ['worktree', 'remove', '--force', wtDir]);
});

test('v3.0 forbids delivery->spike dependency, flags locks violations, and refreshes v2 AGENTS.md', () => {
  const root = initGitFixture();
  const badPlanErr = runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [
      { id: 'TASK-001', kind: 'spike', title: 'Spike test', outcome: 'Explore caching options quickly', acceptance: [{ criterion: 'notes', verify_by: 'read', evidence: '' }], boundaries: ['spike only'], reads: ['.skeinn/PROJECT.md'], design_exemption: 'Exploratory spike before design lock' },
      { id: 'TASK-002', kind: 'delivery', title: 'Build cache', outcome: 'Deliver production cache layer', depends_on: ['TASK-001'], acceptance: [{ criterion: 'tests', verify_by: 'npm test', evidence: '' }], boundaries: ['cache'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' },
    ],
  }), 1);
  assert(badPlanErr.includes('cannot depend on exploratory spike'), `delivery->spike must fail: ${badPlanErr}`);

  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [{ title: 'Locked task', outcome: 'Stay inside src/only/ directory', acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['only src/only/'], locks: ['src/only/'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md#Responsibility' }],
  }));
  writeFileSync(join(root, 'src', 'outside.js'), 'export const oops = 1;\n', 'utf8');
  const closed = JSON.parse(run(root, ['task', 'close', 'TASK-001', '--evidence', 'Modified file outside locks']));
  assert(closed.lock_violations?.includes('src/outside.js'), 'lock violation must be recorded on close');

  writeFileSync(join(root, 'AGENTS.md'), '# Project\n\n<!-- skeinn:v2 -->\nOld v2 instructions\n', 'utf8');
  const checkV2 = JSON.parse(run(root, ['check']));
  assert(checkV2.warnings.some((w) => w.includes('AGENTS.md anchor is v2')), 'check must warn on v2 AGENTS.md');
  const refreshed = JSON.parse(run(root, ['init', '--refresh-agents']));
  assert(refreshed.refreshed_agents === true, 'init --refresh-agents must refresh AGENTS.md');
  assert(readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('<!-- skeinn:v3 -->'), 'AGENTS.md must now contain v3 marker');
});

test('v3.0 freeform finding scopes (task: prefix, compound) gate focus and surface as advisories', () => {
  const root = workspace();
  run(root, ['init']);
  writeFileSync(join(root, '.skeinn', 'PROJECT.md'), PROJ('A fixture proving freeform finding scopes (task: prefixes and compound " / " scopes) still gate focus and surface.'), 'utf8');
  run(root, ['design', 'add', 'core', '--title', 'Core', '--kind', 'system']);
  writeFileSync(join(root, '.skeinn', 'design', 'core.md'), '# Core\n- Kind: system\n\n## Responsibility\nx.\n\n## Alternatives considered\nA vs B.\n', 'utf8');
  run(root, ['capability', 'exempt', '--reason', 'Scope-matching fixture; standard engineering only.']);
  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [
      { title: 'Blocked one', outcome: 'First task output exists on disk', acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['x'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md' },
      { title: 'Advised one', outcome: 'Second task output exists on disk', acceptance: [{ criterion: 'ok', verify_by: 'test', evidence: '' }], boundaries: ['x'], depends_on: ['TASK-001'], reads: ['.skeinn/PROJECT.md', '.skeinn/design/core.md'], implements: '.skeinn/design/core.md' },
    ],
  }));
  const ready = JSON.parse(run(root, ['project', 'ready']));
  // Reviewer writes freeform scopes: "task:" digest-key prefix and compound "task:X / doc" — both must resolve.
  json(root, 'nr.json', {
    run_id: 'scope-test-r1', prepared_digest: ready.digest, verdict: 'needs_revision',
    summary: 'Blocking gap on TASK-001; minor pinned to TASK-002 + doc.',
    evidence: ['Inspected tasks and design doc.'],
    gaps: [
      { id: 'S-1', severity: 'blocking', scope: 'task:TASK-001', gap: 'TASK-001 has a blocking defect found by freeform scope' },
      { id: 'S-2', severity: 'minor', scope: 'task:TASK-002 / .skeinn/design/core.md', gap: 'compound-scope advisory pinned to TASK-002 and core.md' },
    ],
    review: independentReview('fresh-scope-agent'),
  });
  run(root, ['keeper', 'record', '--json-file', 'nr.json']);
  const focusErr = run(root, ['task', 'focus', 'TASK-001'], 1);
  assert(focusErr.includes('blocking findings'), `task:-prefixed blocking scope must gate focus: ${focusErr}`);
  run(root, ['keeper', 'resolve', 'FND-001', '--evidence', 'Defect repaired in task definition; verified by re-read.']);
  run(root, ['task', 'focus', 'TASK-001']);
  writeFileSync(join(root, 'a.txt'), 'done', 'utf8');
  run(root, ['task', 'close', 'TASK-001', '--evidence', 'a.txt written and verified on disk']);
  const focused2 = JSON.parse(run(root, ['task', 'focus', 'TASK-002']));
  assert((focused2.pinned_advisories || []).some((a) => a.includes('FND-002')), `compound scope must surface advisory at focus, got ${JSON.stringify(focused2.pinned_advisories)}`);
});

test('v3.0 adversarial hardening: .skeinnignore cannot self-hide and ledger tampering is loud', () => {
  const root = initGitFixture();
  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [
      { title: 'Work one', outcome: 'First delivery output exists on disk for real', acceptance: [{ criterion: 'file exists', verify_by: 'ls' }], boundaries: ['no scope creep'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md' },
      { title: 'Work two', outcome: 'Second delivery output exists on disk for real', acceptance: [{ criterion: 'file exists', verify_by: 'ls' }], boundaries: ['no scope creep'], depends_on: ['TASK-001'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md' },
    ],
  }));
  const ready = JSON.parse(run(root, ['project', 'ready']));
  json(root, 'skip-or-launch.json', { run_id: 'adv-launch-1', prepared_digest: ready.digest, verdict: 'passed', summary: 'launch ok', evidence: ['reviewed'], review: independentReview('adv-reviewer') });
  run(root, ['keeper', 'record', '--json-file', 'skip-or-launch.json']);

  // Attack 1: .skeinnignore `*` must not hide itself; modifying it triggers the heavy gate.
  writeFileSync(join(root, '.skeinnignore'), '*\n', 'utf8');
  writeFileSync(join(root, 'src', 'evil.js'), 'forged\n', 'utf8');
  const w = JSON.parse(run(root, ['check']));
  assert(w.review_window.files.includes('.skeinnignore'), `skeinnignore must stay visible in window, got ${JSON.stringify(w.review_window.files)}`);
  assert(w.review_window.level === 'heavy', `broadened ignore config must force heavy window, got ${w.review_window.level}`);
  const closeErr = run(root, ['task', 'close', 'TASK-001', '--evidence', 'did the work'], 1);
  assert(closeErr.includes('review window is heavy'), `close must refuse under poisoned ignore config: ${closeErr}`);

  // Recover: drop the poisoned ignore, checkpoint clean, close legitimately.
  rmSync(join(root, '.skeinnignore'));
  json(root, 'chk.json', { run_id: 'adv-chk-1', verdict: 'clean', summary: 'audited window', evidence: ['re-ran checks'], review: independentReview('adv-reviewer') });
  run(root, ['keeper', 'record', '--checkpoint', '--json-file', 'chk.json']);
  run(root, ['task', 'focus', 'TASK-001']);
  run(root, ['task', 'close', 'TASK-001', '--evidence', 'real work verified']);

  // Attack 2: direct tasks.json status forgery is flagged by the missing-metadata sentinel.
  const tasksPath = join(root, '.skeinn', 'tasks.json');
  const forged = JSON.parse(readFileSync(tasksPath, 'utf8'));
  forged.tasks.find((t) => t.id === 'TASK-002').status = 'done';
  writeFileSync(tasksPath, JSON.stringify(forged, null, 2), 'utf8');
  const w2 = JSON.parse(run(root, ['check']));
  assert(w2.warnings.some((x) => x.includes('TASK-002') && x.includes('ledger edit')), `forged done must be flagged: ${JSON.stringify(w2.warnings)}`);

  // Attack 3: deleting findings leaves sequence-gap evidence.
  const statePath = join(root, '.skeinn', 'state.json');
  const st = JSON.parse(readFileSync(statePath, 'utf8'));
  st.keeper.findings = [
    { id: 'FND-001', text: 'a', status: 'open', severity: 'minor', scope: 'task:TASK-001' },
    { id: 'FND-003', text: 'b', status: 'open', severity: 'minor', scope: 'task:TASK-001' },
  ];
  writeFileSync(statePath, JSON.stringify(st, null, 2), 'utf8');
  const w3 = JSON.parse(run(root, ['check']));
  assert(w3.warnings.some((x) => x.includes('sequence gaps')), `findings gap must be flagged: ${JSON.stringify(w3.warnings)}`);

  // Attack 4: keeper reset disarm + closes before re-launch is flagged.
  run(root, ['keeper', 'reset', '--reason', 'deliberate gate disarm for test']);
  runWithStdin(root, ['task', 'plan', '--stdin'], JSON.stringify({
    tasks: [
      { title: 'Work one', outcome: 'First delivery output exists on disk for real', acceptance: [{ criterion: 'file exists', verify_by: 'ls' }], boundaries: ['no scope creep'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md' },
      { title: 'Work two', outcome: 'Second delivery output exists on disk for real', acceptance: [{ criterion: 'file exists', verify_by: 'ls' }], boundaries: ['no scope creep'], depends_on: ['TASK-001'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md' },
      { title: 'Pivot task', outcome: 'Pivoted delivery output exists on disk for real', acceptance: [{ criterion: 'file exists', verify_by: 'ls' }], boundaries: ['no scope creep'], depends_on: ['TASK-001'], reads: ['.skeinn/PROJECT.md'], implements: '.skeinn/design/core.md' },
    ],
  }));
  run(root, ['task', 'focus', 'TASK-003']);
  run(root, ['task', 'close', 'TASK-003', '--evidence', 'closed during disarm']);
  const w4 = JSON.parse(run(root, ['check']));
  assert(w4.warnings.some((x) => x.includes('gate was disarmed')), `disarmed closes must be flagged: ${JSON.stringify(w4.warnings)}`);
});

for (const root of roots) rmSync(root, { recursive: true, force: true });

if (process.exitCode) {
  console.error(`\nResult: ${passed} passed, failures above`);
} else {
  
console.log(`\nResult: ${passed} passed, 0 failed`);
}
