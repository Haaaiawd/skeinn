import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  analyzeReviewWindow,
  deriveTaskActualTouches,
  inspectGitRepo,
  normalizeGitPath,
  snapshotReviewAnchor,
} from './git.js';
import {
  agentProtocol,
  AGENT_ANCHOR,
  EXECUTION_PROTOCOL,
  CAPABILITY_MODES,
  CAPABILITY_TEMPLATE,
  CORE_DESIGN_KINDS,
  DESIGN_KINDS,
  PROJECT_TEMPLATE,
  RESEARCH_GUIDE,
  STRUCTURE_TEMPLATE,
  designTemplate,
  evalConditionPrompt,
  evalJudgePrompt,
  evalProbeChecklist,
  checkpointProtocol,
  evalRelayBatonPrompt,
  keeperProtocol,
  shapingContext,
} from './protocol.js';

const SCHEMA_VERSION = 2;
const VALID_PROJECT_STATUS = new Set(['shaping', 'ready_for_keeper', 'build_ready', 'building', 'complete']);
const VALID_TASK_STATUS = new Set(['open', 'active', 'blocked', 'done']);
let runtimePaths = null;

function now() {
  return new Date().toISOString();
}

function readJson(path, label = basename(path)) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} cannot be read: ${error.message}`);
  }
}

function atomicJson(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

function nextId(items, prefix) {
  const max = items.reduce((highest, item) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(item.id || '');
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function asObjects(values, key) {
  if (!values) return [];
  if (!Array.isArray(values)) throw new Error(`${key} must be an array`);
  return values.map((value) => typeof value === 'string' ? { [key]: value } : value);
}

export function findRoot(from = process.cwd()) {
  if (runtimePaths && existsSync(runtimePaths.state)) return runtimePaths.root;
  let cursor = resolve(from);
  while (true) {
    if (existsSync(join(cursor, '.skeinn', 'state.json'))) return cursor;
    if (existsSync(join(cursor, '.loom', 'state.json'))) {
      throw new Error('Found a legacy .loom/ project. Rename .loom/ to .skeinn/, update any .loom/ paths in tasks.json and AGENTS.md, then run skeinn check.');
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const gitInfo = inspectGitRepo(from);
  if (gitInfo.isGit && gitInfo.isLinkedWorktree && existsSync(join(gitInfo.mainWorktree, '.skeinn', 'state.json'))) {
    return gitInfo.topLevel;
  }
  throw new Error('Skeinn is not initialized. Run skeinn init in the project root.');
}

export function skeinnPaths(root = findRoot()) {
  const absolute = resolve(root);
  if (runtimePaths?.root === absolute) return runtimePaths;
  const localSkeinn = join(absolute, '.skeinn');
  if (existsSync(join(localSkeinn, 'state.json'))) {
    return skeinnPathsShape(absolute, localSkeinn, 'local');
  }
  const gitInfo = inspectGitRepo(absolute);
  if (gitInfo.isGit && gitInfo.isLinkedWorktree) {
    const sharedSkeinn = join(gitInfo.mainWorktree, '.skeinn');
    if (existsSync(join(sharedSkeinn, 'state.json'))) {
      return skeinnPathsShape(absolute, sharedSkeinn, 'shared_worktree');
    }
  }
  return skeinnPathsShape(absolute, localSkeinn, 'local');
}

export function configureRuntime({ stateDir, state, enforceOutside = false } = {}) {
  const target = state || stateDir || process.env.SKEINN_STATE;
  if (!target) {
    runtimePaths = null;
    return null;
  }
  const root = resolve(process.cwd());
  const skeinn = resolve(target);
  if (enforceOutside) {
    const fromWorkspace = relative(root, skeinn);
    if (!fromWorkspace || (!fromWorkspace.startsWith('..') && !isAbsolute(fromWorkspace))) {
      throw new Error('--state-dir must be outside the scored workspace');
    }
  }
  runtimePaths = skeinnPathsShape(root, skeinn, 'explicit');
  return { workspace: root, state_dir: skeinn };
}

export function initProject(root = process.cwd(), options = {}) {
  const paths = skeinnPathsForInit(root);
  if (existsSync(paths.state)) {
    if (options.refreshAgents) {
      installAgentAnchor(paths.root, { refresh: true });
      return { initialized: false, refreshed_agents: true, root: paths.root, file: 'AGENTS.md' };
    }
    return { initialized: false, root: paths.root, reason: 'already_initialized' };
  }
  if (paths.skeinn === join(paths.root, '.skeinn') && existsSync(join(paths.root, '.loom', 'state.json'))) {
    throw new Error('Found a legacy .loom/ project. Rename .loom/ to .skeinn/, update any .loom/ paths in tasks.json and AGENTS.md, then run skeinn check.');
  }
  if (existsSync(join(paths.skeinn, 'current')) || existsSync(join(paths.skeinn, 'v1'))) {
    throw new Error('A legacy Skeinn project was found. Back it up and migrate deliberately; v3 will not overwrite it.');
  }
  mkdirSync(paths.design, { recursive: true });
  mkdirSync(paths.capabilities, { recursive: true });
  mkdirSync(paths.eval, { recursive: true });
  const state = {
    schema_version: SCHEMA_VERSION,
    project: { name: basename(paths.root), status: 'shaping', created_at: now(), updated_at: now() },
    understanding: { confirmed: [], assumptions: [], unresolved: [] },
    keeper: { status: 'not_run', attempts: [], findings: [], checkpoints: [], reviewed_digests: {}, launch_completed: false, last_reviewed_commit: null, last_reviewed_worktree: {}, last_reviewed_at: null },
    decision_events: [],
  };
  atomicJson(paths.state, state);
  atomicJson(paths.tasks, { schema_version: SCHEMA_VERSION, tasks: [] });
  atomicJson(paths.deliverables, { schema_version: SCHEMA_VERSION, deliverables: [] });
  writeFileSync(paths.project, PROJECT_TEMPLATE, 'utf8');
  writeFileSync(paths.structure, STRUCTURE_TEMPLATE, 'utf8');
  writeFileSync(paths.decisions, '# Decision History\n\nCurrent truth belongs in PROJECT.md and linked design documents. This file preserves consequential superseding decisions.\n', 'utf8');
  const anchored = paths.skeinn === join(paths.root, '.skeinn');
  if (anchored) installAgentAnchor(paths.root, { refresh: Boolean(options.refreshAgents) });
  return {
    initialized: true,
    root: paths.root,
    files: ['.skeinn/PROJECT.md', '.skeinn/STRUCTURE.md', '.skeinn/DECISIONS.md', '.skeinn/state.json', '.skeinn/tasks.json', '.skeinn/deliverables.json', '.skeinn/design/', '.skeinn/capabilities/', ...(anchored ? ['AGENTS.md'] : [])],
    next: 'Replace the template text in .skeinn/PROJECT.md and .skeinn/STRUCTURE.md with this project\u2019s truth, then shape the whole: skeinn record \u2192 iterate core Design surfaces (skeinn design add) and 1\u20133 bottleneck Capabilities (skeinn capability add, or skeinn capability exempt --reason) \u2192 skeinn deliverable add \u2192 skeinn task plan. Run `skeinn help shaping` for what each layer buys you.',
  };
}

function skeinnPathsForInit(root) {
  const absolute = resolve(root);
  const skeinn = runtimePaths?.root === absolute ? runtimePaths.skeinn : join(absolute, '.skeinn');
  return skeinnPathsShape(absolute, skeinn, runtimePaths?.root === absolute ? 'explicit' : 'local');
}

function skeinnPathsShape(root, skeinn, stateMode = 'local') {
  return {
    root,
    skeinn,
    state_mode: stateMode,
    state: join(skeinn, 'state.json'),
    tasks: join(skeinn, 'tasks.json'),
    deliverables: join(skeinn, 'deliverables.json'),
    project: join(skeinn, 'PROJECT.md'),
    structure: join(skeinn, 'STRUCTURE.md'),
    decisions: join(skeinn, 'DECISIONS.md'),
    design: join(skeinn, 'design'),
    capabilities: join(skeinn, 'capabilities'),
    eval: join(skeinn, 'eval'),
  };
}

function installAgentAnchor(root, { refresh = false } = {}) {
  const path = join(root, 'AGENTS.md');
  const v3Marker = '<!-- skeinn:v3 -->';
  const v2Marker = '<!-- skeinn:v2 -->';
  if (!existsSync(path)) {
    writeFileSync(path, `${AGENT_ANCHOR}\n`, 'utf8');
    return;
  }
  const existing = readFileSync(path, 'utf8');
  if (refresh) {
    const startIdx = existing.includes(v3Marker) ? existing.indexOf(v3Marker) : existing.indexOf(v2Marker);
    if (startIdx !== -1) {
      const endMarker = '<!-- /skeinn -->';
      const endIdx = existing.indexOf(endMarker, startIdx);
      const before = existing.slice(0, startIdx).trimEnd();
      const after = endIdx !== -1 ? existing.slice(endIdx + endMarker.length).trimStart() : '';
      const updated = [before, AGENT_ANCHOR, after].filter(Boolean).join('\n\n') + '\n';
      writeFileSync(path, updated, 'utf8');
      return;
    }
  }
  if (!existing.includes(v3Marker)) appendFileSync(path, `\n${AGENT_ANCHOR}\n`, 'utf8');
}

export function loadProject(root = findRoot()) {
  const paths = skeinnPaths(root);
  mkdirSync(paths.design, { recursive: true });
  mkdirSync(paths.capabilities, { recursive: true });
  mkdirSync(paths.eval, { recursive: true });
  const state = readJson(paths.state, 'state.json');
  const taskStore = readJson(paths.tasks, 'tasks.json');
  const deliverableStore = existsSync(paths.deliverables) ? readJson(paths.deliverables, 'deliverables.json') : { schema_version: SCHEMA_VERSION, deliverables: [] };
  validateState(state);
  validateTasks(taskStore.tasks);
  ensureClarify(state);
  ensureKeeperState(state);
  return { paths, state, taskStore, deliverableStore };
}


function ensureKeeperState(state) {
  if (!state.keeper || typeof state.keeper !== 'object') state.keeper = { status: 'not_run', attempts: [] };
  if (!Array.isArray(state.keeper.attempts)) state.keeper.attempts = [];
  if (!Array.isArray(state.keeper.findings)) state.keeper.findings = [];
  if (!Array.isArray(state.keeper.checkpoints)) state.keeper.checkpoints = [];
  if (!state.keeper.reviewed_digests || typeof state.keeper.reviewed_digests !== 'object') state.keeper.reviewed_digests = {};
  if (typeof state.keeper.launch_completed !== 'boolean') state.keeper.launch_completed = ['passed', 'passed_with_advisories', 'skipped'].includes(state.keeper.status);
  if (state.keeper.last_reviewed_commit === undefined) state.keeper.last_reviewed_commit = null;
  if (!state.keeper.last_reviewed_worktree || typeof state.keeper.last_reviewed_worktree !== 'object') state.keeper.last_reviewed_worktree = {};
  if (state.keeper.last_reviewed_at === undefined) state.keeper.last_reviewed_at = null;
  if (!Array.isArray(state.decision_events)) state.decision_events = [];
  return state.keeper;
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function artifactDigests(paths, tasks, state = null) {
  const map = {};
  map['.skeinn/PROJECT.md'] = sha256Text(readFileSync(paths.project, 'utf8'));
  if (existsSync(paths.structure)) map['.skeinn/STRUCTURE.md'] = sha256Text(readFileSync(paths.structure, 'utf8'));
  map['.skeinn/DECISIONS.md'] = sha256Text(readFileSync(paths.decisions, 'utf8'));
  if (state?.capability_exemption) map['state:capability_exemption'] = sha256Text(JSON.stringify(state.capability_exemption));
  for (const name of readdirSync(paths.design).filter((file) => file.endsWith('.md')).sort()) {
    map[`.skeinn/design/${name}`] = sha256Text(readFileSync(join(paths.design, name), 'utf8'));
  }
  for (const name of listCapabilities(paths.root)) {
    const capFile = capabilityPath(paths, name);
    const ref = normalizeRef(paths, capFile);
    const statusPath = join(paths.capabilities, name, 'status.json');
    const combined = readFileSync(capFile, 'utf8') + (existsSync(statusPath) ? readFileSync(statusPath, 'utf8') : '');
    map[ref] = sha256Text(combined);
  }
  for (const task of tasks) {
    const { progress, evidence, status, updated_at, completed_at, reopened_at, block, ...definition } = task;
    map[`task:${task.id}`] = sha256Text(JSON.stringify(definition));
  }
  return map;
}

function overallDigest(digestMap) {
  const hash = createHash('sha256');
  for (const key of Object.keys(digestMap).sort()) hash.update(`${key}:${digestMap[key]}
`);
  return hash.digest('hex');
}

export function activeHorizon(tasks, paths, depth = 2) {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const selected = new Set();
  let frontier = tasks
    .filter((t) => t.status === 'active' || (t.status === 'open' && t.depends_on.every((d) => done.has(d))))
    .map((t) => t.id);
  for (const id of frontier) selected.add(id);
  for (let hop = 0; hop < depth; hop += 1) {
    const nextLayer = [];
    for (const t of tasks) {
      if (selected.has(t.id) || t.status !== 'open') continue;
      if (t.depends_on.some((d) => selected.has(d)) && t.depends_on.every((d) => done.has(d) || selected.has(d))) {
        nextLayer.push(t.id);
      }
    }
    if (!nextLayer.length) break;
    for (const id of nextLayer) selected.add(id);
  }
  const artifacts = new Set(['.skeinn/PROJECT.md', '.skeinn/DECISIONS.md']);
  if (existsSync(paths.structure)) artifacts.add('.skeinn/STRUCTURE.md');
  let sawCapability = false;
  for (const id of selected) {
    const t = byId.get(id);
    if (!t) continue;
    artifacts.add(`task:${t.id}`);
    for (const ref of t.reads || []) {
      const norm = ref.replaceAll('\\', '/');
      if (norm.startsWith('.skeinn/')) artifacts.add(norm);
      if (norm.startsWith('.skeinn/capabilities/')) sawCapability = true;
    }
    if (t.implements?.trim()) {
      const ref = t.implements.trim().split('#')[0].replaceAll('\\', '/');
      if (ref.startsWith('.skeinn/')) artifacts.add(ref);
    }
  }
  // Ensure capability files (or exemption) are always audited in the horizon
  if (!sawCapability) {
    for (const name of listCapabilities(paths.root)) artifacts.add(normalizeRef(paths, capabilityPath(paths, name)));
  }
  return { taskIds: [...selected], artifacts: [...artifacts].sort() };
}

function computeDirtyArtifacts(currentMap, baselineMap, scopeKeys = null) {
  const keys = scopeKeys ? scopeKeys.filter((k) => k in currentMap) : Object.keys(currentMap);
  return keys.filter((k) => currentMap[k] !== baselineMap?.[k]).sort();
}

function normalizeFindingKey(scope, text) {
  return `${(scope || 'project').trim().toLowerCase()}::${String(text || '').trim().toLowerCase()}`;
}

// Reviewers write freeform scopes: "task:TASK-003", "TASK-003", compound "task:X / .skeinn/doc.md".
// Canonical parts: split on ' / ' or ',' (never bare '/' — that's inside real paths), strip the task: prefix.
function scopeParts(scope) {
  return String(scope || 'project')
    .split(/\s+\/\s+|\s*,\s*/)
    .map((part) => {
      const clean = part.trim().replaceAll('\\', '/');
      const taskRef = clean.match(/^task:(.+)$/i);
      return taskRef ? taskRef[1].trim().toUpperCase() : clean;
    })
    .filter(Boolean);
}

function canonicalScope(scope) {
  const parts = scopeParts(scope);
  return parts.length ? parts.join(' / ') : 'project';
}

// Horizon artifacts are digest keys ("task:TASK-001", ".skeinn/design/x.md"); a finding's scope parts
// can be bare ids, so membership tests both spellings.
function scopeTouchesHorizon(scope, horizonSet) {
  return scopeParts(scope).some((part) => horizonSet.has(part) || horizonSet.has(`task:${part}`));
}

function upsertFindings(state, rawItems, { sourceRunId, defaultSeverity = 'blocking' } = {}) {
  const keeper = ensureKeeperState(state);
  const touched = [];
  for (const raw of rawItems || []) {
    const text = typeof raw === 'string' ? raw.trim() : (raw?.gap || raw?.text || '').trim();
    if (!text) continue;
    const scope = (typeof raw === 'object' && raw?.scope ? canonicalScope(raw.scope) : '') || 'project';
    const severity = (typeof raw === 'object' && ['blocking', 'minor'].includes(raw?.severity)) ? raw.severity : defaultSeverity;
    const key = normalizeFindingKey(scope, text);
    const existing = keeper.findings.find((f) => f.status === 'open' && normalizeFindingKey(f.scope, f.text) === key);
    if (existing) {
      if (severity === 'blocking') existing.severity = 'blocking';
      existing.updated_at = now();
      touched.push(existing);
    } else {
      const entry = {
        id: nextId(keeper.findings, 'FND'),
        scope,
        text,
        severity,
        status: 'open',
        source_run_id: sourceRunId || '',
        closure_evidence: '',
        at: now(),
      };
      keeper.findings.push(entry);
      touched.push(entry);
    }
  }
  return touched;
}

function findingsForTask(state, task) {
  const keeper = ensureKeeperState(state);
  const scopes = new Set([task.id]);
  for (const ref of task.reads || []) scopes.add(ref.replaceAll('\\', '/'));
  if (task.implements?.trim()) scopes.add(task.implements.trim().split('#')[0].replaceAll('\\', '/'));
  return keeper.findings.filter((f) => f.status === 'open' && scopeParts(f.scope).some((part) => scopes.has(part)));
}

function ensureClarify(state) {
  if (!state.clarify || typeof state.clarify !== 'object') state.clarify = { active: false, reason: '', started_at: '', closed_at: '', rounds: [] };
  if (!Array.isArray(state.clarify.rounds)) state.clarify.rounds = [];
  return state.clarify;
}

function validateState(state) {
  if (state.schema_version !== SCHEMA_VERSION) throw new Error(`Unsupported schema_version ${state.schema_version}`);
  if (!VALID_PROJECT_STATUS.has(state.project?.status)) throw new Error('Invalid project status');
  for (const key of ['confirmed', 'assumptions', 'unresolved']) {
    if (!Array.isArray(state.understanding?.[key])) throw new Error(`understanding.${key} must be an array`);
  }
}

function validateTasks(tasks) {
  if (!Array.isArray(tasks)) throw new Error('tasks.json tasks must be an array');
  const ids = new Set();
  const activeByLane = new Map();
  for (const task of tasks) {
    if (!task.id || ids.has(task.id)) throw new Error(`Task id is missing or duplicated: ${task.id || '<missing>'}`);
    ids.add(task.id);
    if (!task.title || !task.outcome) throw new Error(`${task.id} requires title and outcome`);
    if (task.outcome.length < 20) throw new Error(`${task.id} outcome must be at least 20 characters describing the observable difference`);
    if (!VALID_TASK_STATUS.has(task.status)) throw new Error(`${task.id} has invalid status ${task.status}`);
    if (!Array.isArray(task.depends_on) || !Array.isArray(task.reads)) throw new Error(`${task.id} dependencies and reads must be arrays`);
    if (!task.reads.length) throw new Error(`${task.id} reads must list at least one specific file or artifact`);
    if (task.touches !== undefined && !Array.isArray(task.touches)) throw new Error(`${task.id} touches must be an array if provided`);
    if (task.locks !== undefined) {
      if (!Array.isArray(task.locks)) throw new Error(`${task.id} locks must be an array of paths/prefixes`);
      for (const lock of task.locks) if (typeof lock !== 'string' || !lock.trim()) throw new Error(`${task.id} locks entries must be non-empty strings`);
    }
    if (!Array.isArray(task.boundaries) || !task.boundaries.length) throw new Error(`${task.id} boundaries must list at least one thing this Task does NOT do`);
    const hasAcceptance = Array.isArray(task.acceptance) && task.acceptance.length > 0;
    const hasDoneWhen = Array.isArray(task.done_when) && task.done_when.length > 0;
    if (!hasAcceptance && !hasDoneWhen) throw new Error(`${task.id} requires acceptance[] (preferred) or done_when[]`);
    if (hasAcceptance) {
      for (const acc of task.acceptance) {
        if (!acc || typeof acc !== 'object') throw new Error(`${task.id} acceptance entries must be objects`);
        if (!acc.criterion || typeof acc.criterion !== 'string') throw new Error(`${task.id} acceptance entry missing criterion (what must be true for this condition to pass)`);
        if (!acc.verify_by || typeof acc.verify_by !== 'string') throw new Error(`${task.id} acceptance entry missing verify_by (how to check)`);
        if (acc.evidence !== undefined && typeof acc.evidence !== 'string') throw new Error(`${task.id} acceptance evidence must be a string`);
      }
    }
    if (task.implements !== undefined && typeof task.implements !== 'string') throw new Error(`${task.id} implements must be a string referencing a design decision`);
    if (task.design_exemption !== undefined && (typeof task.design_exemption !== 'string' || (task.design_exemption && task.design_exemption.length < 10))) throw new Error(`${task.id} design_exemption must be a concrete reason`);
    if (task.capability_exemption !== undefined && (typeof task.capability_exemption !== 'string' || (task.capability_exemption && task.capability_exemption.length < 10))) throw new Error(`${task.id} capability_exemption must be a concrete reason`);
    if (task.kind !== undefined && !['delivery', 'spike'].includes(task.kind)) throw new Error(`${task.id} kind must be delivery or spike`);
    if (task.guardrails !== undefined) {
      if (!Array.isArray(task.guardrails)) throw new Error(`${task.id} guardrails must be an array of strings`);
      for (const rule of task.guardrails) if (typeof rule !== 'string' || !rule.trim()) throw new Error(`${task.id} guardrails entries must be non-empty strings`);
    }
    if (task.integrity_version !== undefined && task.integrity_version !== 1) throw new Error(`${task.id} integrity_version is unsupported`);
    if (task.capability_hooks !== undefined) {
      if (!Array.isArray(task.capability_hooks)) throw new Error(`${task.id} capability_hooks must be an array`);
      for (const hook of task.capability_hooks) {
        if (!hook || typeof hook !== 'object' || typeof hook.node !== 'string' || !hook.node.includes('#')) throw new Error(`${task.id} capability_hooks entry must have a node field like "capability-slug#C1"`);
        if (hook.at !== undefined && typeof hook.at !== 'string') throw new Error(`${task.id} capability_hooks at must be a string`);
        if (hook.must_produce !== undefined && typeof hook.must_produce !== 'string') throw new Error(`${task.id} capability_hooks must_produce must be a string`);
      }
    }
    if (task.covers !== undefined) {
      if (!Array.isArray(task.covers)) throw new Error(`${task.id} covers must be an array of deliverable IDs`);
      for (const dlvId of task.covers) if (typeof dlvId !== 'string') throw new Error(`${task.id} covers entries must be deliverable ID strings`);
    }
    if (task.status === 'active') {
      const lane = task.lane || 'default';
      if (activeByLane.has(lane)) {
        throw new Error(`Only one Task may be active per lane (lane "${lane}" already has ${activeByLane.get(lane)})`);
      }
      activeByLane.set(lane, task.id);
    }
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) throw new Error(`${task.id} depends on missing Task ${dep}`);
      if ((task.kind || 'delivery') === 'delivery' && byId.get(dep)?.kind === 'spike') {
        throw new Error(`Delivery Task ${task.id} cannot depend on exploratory spike ${dep}; absorb spike findings into Design/Decisions instead`);
      }
    }
  }
  detectCycles(tasks);
}

function detectCycles(tasks) {
  const map = new Map(tasks.map((task) => [task.id, task.depends_on]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Task dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of map.get(id) || []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of map.keys()) visit(id);
}

export function recordUnderstanding(payload, root = findRoot()) {
  const { paths, state } = loadProject(root);
  for (const item of asObjects(payload.confirmed, 'text')) {
    if (!item.text) throw new Error('Confirmed fact requires text');
    state.understanding.confirmed.push({ id: nextId(state.understanding.confirmed, 'F'), text: item.text, source: item.source || 'conversation', at: now() });
  }
  for (const item of asObjects(payload.assumptions, 'text')) {
    if (!item.text) throw new Error('Assumption requires text');
    state.understanding.assumptions.push({ id: nextId(state.understanding.assumptions, 'A'), text: item.text, status: 'active', source: item.source || 'agent', at: now() });
  }
  for (const item of asObjects(payload.unresolved, 'question')) {
    if (!item.question) throw new Error('Unresolved item requires question');
    state.understanding.unresolved.push({ id: nextId(state.understanding.unresolved, 'Q'), question: item.question, impact: item.impact || 'medium', status: 'open', at: now() });
  }
  for (const item of payload.resolved || []) {
    const target = state.understanding.unresolved.find((candidate) => candidate.id === item.id);
    if (!target) throw new Error(`Unknown unresolved id ${item.id}`);
    target.status = item.status === 'skipped' ? 'skipped' : 'resolved';
    target.resolution = item.resolution || '';
    target.resolved_at = now();
  }
  for (const id of payload.retire_assumptions || []) {
    const target = state.understanding.assumptions.find((candidate) => candidate.id === id);
    if (!target) throw new Error(`Unknown assumption id ${id}`);
    target.status = 'retired';
  }
  if (payload.project_status) throw new Error('Project status is controlled by ready, Keeper, and Task commands');
  for (const decision of payload.decisions || []) appendDecision(paths.decisions, decision, state);
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  return { ...state.understanding, next: 'Keep shaping: iterate core Design surfaces (skeinn design add) and 1–3 bottleneck Capabilities (skeinn capability add <slug> --title <field>, or skeinn capability exempt --reason), then skeinn deliverable add and skeinn task plan. skeinn context names the current frontier.' };
}

function appendDecision(path, decision, state) {
  if (!decision.title || !decision.decision || !decision.rationale) throw new Error('Decision requires title, decision, and rationale');
  const prior = state.decision_ids || [];
  const id = nextId(prior.map((value) => ({ id: value })), 'D');
  state.decision_ids = [...prior, id];
  const supersedes = decision.supersedes?.length ? decision.supersedes.join(', ') : 'none';
  appendFileSync(path, `\n## ${id}: ${decision.title}\n\n- Current decision: ${decision.decision}\n- Rationale: ${decision.rationale}\n- Source: ${decision.source || 'conversation'}\n- Supersedes: ${supersedes}\n- Affects: ${(decision.affects || []).join(', ') || 'project-wide or not yet classified'}\n- Recorded: ${now()}\n`, 'utf8');
}

export function createDesign(slug, options = {}, root = findRoot()) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('Design slug must use lowercase letters, numbers, and hyphens');
  if (!options.title) throw new Error('Design document requires --title');
  if (!DESIGN_KINDS.includes(options.kind)) throw new Error(`Design kind must be one of: ${DESIGN_KINDS.join(', ')}`);
  const { paths } = loadProject(root);
  const path = join(paths.design, `${slug}.md`);
  if (existsSync(path)) throw new Error(`Design document already exists: ${slug}`);
  writeFileSync(path, designTemplate({ title: options.title, kind: options.kind }), 'utf8');
  return {
    slug,
    kind: options.kind,
    path: relative(paths.root, path).replaceAll('\\', '/'),
    next: `Fill every section of .skeinn/design/${slug}.md with project-specific decisions — template text fails skeinn project ready. Compare at least two genuinely viable alternatives and compile applied capability rules into concrete mechanisms, then skeinn deliverable add → skeinn task plan.`,
  };
}

export function listDesigns(root = findRoot()) {
  const { paths } = loadProject(root);
  return readdirSync(paths.design).filter((name) => name.endsWith('.md')).sort();
}

export function getDesign(slug, root = findRoot()) {
  const { paths } = loadProject(root);
  const name = slug.endsWith('.md') ? slug : `${slug}.md`;
  if (basename(name) !== name) throw new Error('Invalid design document name');
  const path = join(paths.design, name);
  if (!existsSync(path)) throw new Error(`Design document not found: ${slug}`);
  return readFileSync(path, 'utf8');
}

function capabilitySlug(name) {
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

function isLegacyDirectoryCapability(paths, name) {
  const slug = capabilitySlug(name);
  return existsSync(join(paths.capabilities, slug, 'capability.md'));
}

function parseSingleFileCapabilityMeta(content) {
  const modeMatch = content.match(/^-\s*Mode:\s*([^\n]+)/m);
  const authorityMatch = content.match(/^-\s*Authority:\s*([^\n]+)/m);
  const scenarioMatch = content.match(/^-\s*Scenario:\s*([^\n]+)/m);
  return {
    mode: modeMatch ? modeMatch[1].trim() : 'external_researched',
    authority: authorityMatch ? authorityMatch[1].trim() : 'agent_provisional',
    scenario: scenarioMatch ? scenarioMatch[1].trim() : '',
  };
}

export function createCapability(slug, options = {}, root = findRoot()) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('Capability slug must use lowercase letters, numbers, and hyphens');
  if (!options.title) throw new Error('Capability requires --title');
  const mode = options.mode || 'external_researched';
  if (!CAPABILITY_MODES.includes(mode)) throw new Error(`Capability --mode must be one of: ${CAPABILITY_MODES.join(', ')}`);
  const { paths, state } = loadProject(root);
  const filePath = join(paths.capabilities, `${slug}.md`);
  const legacyDirPath = join(paths.capabilities, slug);
  if (existsSync(filePath) || existsSync(legacyDirPath)) throw new Error(`Capability already exists: ${slug}`);
  writeFileSync(filePath, CAPABILITY_TEMPLATE({ title: options.title, mode }), 'utf8');
  if (state.capability_exemption) {
    delete state.capability_exemption;
    state.project.updated_at = now();
    atomicJson(paths.state, state);
  }
  return {
    slug,
    mode,
    path: relative(paths.root, filePath).replaceAll('\\', '/'),
    next: `Research how real practitioners operate in this field, reflect on this project's constraints, and fill .skeinn/capabilities/${slug}.md (including concrete operational rules and Before -> After Design delta). If external search is unavailable, set Mode: offline_reflection honestly rather than citing agent-authored sources. Run skeinn help capability for the quality bar.`,
  };
}

export function exemptCapabilities(reason, root = findRoot()) {
  if (!reason || reason.trim().length < 15) throw new Error('Capability exemption requires a concrete --reason (at least 15 characters explaining why standard engineering suffices without specialist domain research)');
  const { paths, state } = loadProject(root);
  const existing = listCapabilities(root);
  if (existing.length) throw new Error(`Cannot exempt capabilities while capability files already exist: ${existing.join(', ')}`);
  state.capability_exemption = { reason: reason.trim(), at: now() };
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  return {
    exempted: true,
    reason: state.capability_exemption.reason,
    next: 'Exemption recorded. Keeper will audit whether standard engineering genuinely suffices for this project. Continue shaping Design and Tasks, then run skeinn project ready.',
  };
}

export function listCapabilities(root = findRoot()) {
  const { paths } = loadProject(root);
  const entries = readdirSync(paths.capabilities, { withFileTypes: true });
  const names = entries
    .filter((entry) => (entry.isDirectory() && existsSync(join(paths.capabilities, entry.name, 'capability.md'))) || (entry.isFile() && entry.name.endsWith('.md')))
    .map((entry) => (entry.isDirectory() ? entry.name : entry.name.slice(0, -3)))
    .sort();
  return names;
}

export function getCapability(slug, root = findRoot()) {
  const { paths } = loadProject(root);
  const cleanSlug = capabilitySlug(slug);
  if (basename(cleanSlug) !== cleanSlug) throw new Error('Invalid capability name');
  const filePath = join(paths.capabilities, `${cleanSlug}.md`);
  if (existsSync(filePath)) return readFileSync(filePath, 'utf8');
  const dirCapability = join(paths.capabilities, cleanSlug, 'capability.md');
  if (existsSync(dirCapability)) return readFileSync(dirCapability, 'utf8');
  throw new Error(`Capability not found: ${slug}`);
}

export function researchCapability(slug, options = {}, root = findRoot()) {
  const { paths } = loadProject(root);
  const cleanSlug = capabilitySlug(slug);
  const singleFile = join(paths.capabilities, `${cleanSlug}.md`);
  if (existsSync(singleFile)) {
    return {
      slug: cleanSlug,
      mode: parseSingleFileCapabilityMeta(readFileSync(singleFile, 'utf8')).mode,
      path: relative(paths.root, singleFile).replaceAll('\\', '/'),
      next: `Skeinn 2.4+ uses single-file capabilities. Write real practitioner findings and verifiable sources directly into .skeinn/capabilities/${cleanSlug}.md under "## How real practitioners operate".`,
    };
  }
  if (!options.field) throw new Error('Research requires --field <professional-field>');
  const dir = join(paths.capabilities, cleanSlug);
  if (!existsSync(dir)) throw new Error(`Capability not found: ${slug}. Run skeinn capability add ${cleanSlug} --title <text> first.`);
  const statusPath = join(dir, 'status.json');
  if (!existsSync(statusPath)) throw new Error(`Capability ${slug} is not a research-directory dossier`);
  const status = readJson(statusPath, 'status.json');
  if (status.status === 'confirmed') {
    status.reopened_at = now();
    status.reopen_reason = options.reopen_reason || 'new evidence requires updating the capability';
  }
  status.field = options.field;
  status.status = 'researching';
  status.updated_at = now();
  atomicJson(statusPath, status);
  const researchDir = join(dir, 'research');
  mkdirSync(researchDir, { recursive: true });
  const guidePath = join(researchDir, '_guide.md');
  if (!existsSync(guidePath)) writeFileSync(guidePath, RESEARCH_GUIDE, 'utf8');
  return {
    slug: cleanSlug,
    field: options.field,
    research_dir: relative(paths.root, researchDir).replaceAll('\\', '/'),
    status: 'researching',
    next: `Add .md files to research/ then run skeinn capability synthesize ${cleanSlug}.`,
  };
}

export function synthesizeCapability(slug, root = findRoot()) {
  const { paths } = loadProject(root);
  const cleanSlug = capabilitySlug(slug);
  const singleFile = join(paths.capabilities, `${cleanSlug}.md`);
  if (existsSync(singleFile)) {
    const content = readFileSync(singleFile, 'utf8');
    const issues = validateSingleFileCapability(cleanSlug, content);
    if (issues.length) throw new Error(`Capability ${cleanSlug} is not ready:\n- ${issues.join('\n- ')}`);
    const meta = parseSingleFileCapabilityMeta(content);
    return { slug: cleanSlug, mode: meta.mode, authority: meta.authority, valid: true, next: `Apply ${cleanSlug}'s operational rules and Design delta into your Design documents, or upgrade authority with skeinn capability confirm ${cleanSlug} --scenario "<text>" --source human.` };
  }
  const dir = join(paths.capabilities, cleanSlug);
  if (!existsSync(dir)) throw new Error(`Capability not found: ${slug}`);
  const statusPath = join(dir, 'status.json');
  if (!existsSync(statusPath)) throw new Error(`Capability ${slug} is not a research-directory dossier`);
  const status = readJson(statusPath, 'status.json');
  if (status.status === 'confirmed') throw new Error(`Capability ${slug} is confirmed; run skeinn capability research ${slug} --field <text> to reopen it with new evidence`);
  const researchDir = join(dir, 'research');
  const materials = readdirSync(researchDir).filter((f) => f.endsWith('.md') && f !== '_guide.md').sort();
  if (!materials.length) throw new Error(`No research materials found in ${slug}/research/.`);
  const capPath = join(dir, 'capability.md');
  const content = readFileSync(capPath, 'utf8');
  const nodePattern = /### (C\d+):/g;
  const nodes = [...content.matchAll(nodePattern)].map((m) => m[1]);
  if (!nodes.length) throw new Error('Capability has no decision tree nodes (### C1, C2, ...). Add nodes before synthesizing.');
  const missingSources = [];
  const missingCounterexamples = [];
  const danglingSources = [];
  const materialNames = materials.flatMap((f) => [f, f.slice(0, -3)]);
  for (const node of nodes) {
    const nodeSection = content.split(`### ${node}:`)[1]?.split('### ')[0] || '';
    if (!nodeSection.includes('source:')) missingSources.push(node);
    else {
      const sourceMatch = nodeSection.match(/source:\s*(.+)(?:\n|$)/);
      const cited = sourceMatch ? sourceMatch[1].trim() : '';
      if (cited && !materialNames.some((name) => cited.includes(name))) danglingSources.push(node);
    }
    if (!nodeSection.includes('counterexample:')) missingCounterexamples.push(node);
  }
  if (missingSources.length) throw new Error(`Decision tree nodes missing source citations: ${missingSources.join(', ')}. Every node must reference a research material.`);
  if (danglingSources.length) throw new Error(`Decision tree nodes cite sources not found in research/: ${danglingSources.join(', ')}. The source field should reference one of the research files.`);
  if (missingCounterexamples.length) throw new Error(`Decision tree nodes missing counterexamples: ${missingCounterexamples.join(', ')}. Every node must have a counterexample (a situation where an expert would NOT walk this path).`);
  status.status = 'synthesized';
  status.updated_at = now();
  atomicJson(statusPath, status);
  return { slug: cleanSlug, status: 'synthesized', nodes: nodes.length, materials: materials.length, next: `Run skeinn capability confirm ${cleanSlug} --scenario <text> --source human|agent.` };
}

export function confirmCapability(slug, options = {}, root = findRoot()) {
  if (!options.scenario || options.scenario.length < 20) throw new Error('Confirm requires --scenario <text> (at least 20 characters describing the project situation this expertise applies to)');
  if (!['human', 'agent'].includes(options.source)) throw new Error('Capability confirmation requires explicit provenance: --source human|agent');
  const { paths } = loadProject(root);
  const cleanSlug = capabilitySlug(slug);
  const singleFile = join(paths.capabilities, `${cleanSlug}.md`);
  if (existsSync(singleFile)) {
    let content = readFileSync(singleFile, 'utf8');
    const authority = options.source === 'human' ? 'human_confirmed' : 'agent_provisional';
    if (/^-\s*Authority:.*$/m.test(content)) content = content.replace(/^-\s*Authority:.*$/m, `- Authority: ${authority}`);
    else content = content.replace(/^(# .+\n)/, `$1\n- Authority: ${authority}\n`);
    if (/^-\s*Scenario:.*$/m.test(content)) content = content.replace(/^-\s*Scenario:.*$/m, `- Scenario: ${options.scenario}`);
    else content = content.replace(/^(-\s*Authority:.*\n)/m, `$1- Scenario: ${options.scenario}\n`);
    writeFileSync(singleFile, content, 'utf8');
    const meta = parseSingleFileCapabilityMeta(content);
    return {
      slug: cleanSlug,
      mode: meta.mode,
      authority,
      status: options.source === 'human' ? 'confirmed' : 'provisional',
      scenario: options.scenario,
      source: options.source,
      next: `Compile ${cleanSlug}'s operational rules and Design delta into your Design documents (skeinn design add), then carry key red lines into Task guardrails and acceptance criteria.${options.source === 'agent' ? ' Authority stays agent_provisional until a human confirms.' : ''}`,
    };
  }
  const dir = join(paths.capabilities, cleanSlug);
  if (!existsSync(dir)) throw new Error(`Capability not found: ${slug}`);
  const statusPath = join(dir, 'status.json');
  if (!existsSync(statusPath)) throw new Error(`Capability ${slug} is not a research-directory dossier`);
  const status = readJson(statusPath, 'status.json');
  if (!['synthesized', 'provisional'].includes(status.status)) throw new Error(`Capability ${slug} must be synthesized before confirmation. Run skeinn capability synthesize ${slug} first.`);
  status.scenario = options.scenario;
  status.source = options.source;
  status.status = options.source === 'human' ? 'confirmed' : 'provisional';
  status.selected_at = now();
  status.confirmed_at = options.source === 'human' ? now() : '';
  status.updated_at = now();
  atomicJson(statusPath, status);
  const capPath = join(dir, 'capability.md');
  const content = readFileSync(capPath, 'utf8');
  const scenarioMatch = content.match(/(## Project scenario\n)([\s\S]*?)(\n## )/);
  if (scenarioMatch) {
    const prefix = scenarioMatch[1];
    const suffix = scenarioMatch[3];
    const blockquote = scenarioMatch[2].match(/(> [^\n]+\n)+/);
    const blockquoteText = blockquote ? blockquote[0] : '';
    const updated = content.replace(/## Project scenario\n[\s\S]*?\n## /, `${prefix}${blockquoteText}\n${options.scenario}\n${suffix}`);
    writeFileSync(capPath, updated, 'utf8');
  }
  return {
    slug: cleanSlug,
    status: status.status,
    scenario: options.scenario,
    source: options.source,
    next: `Write design documents informed by this capability, then carry key red lines into Tasks.${status.status === 'provisional' ? ' Status stays provisional until a human confirms.' : ''}`,
  };
}

export function getCapabilityStatus(slug, root = findRoot()) {
  const { paths } = loadProject(root);
  const cleanSlug = capabilitySlug(slug);
  const singleFile = join(paths.capabilities, `${cleanSlug}.md`);
  if (existsSync(singleFile)) {
    const content = readFileSync(singleFile, 'utf8');
    const meta = parseSingleFileCapabilityMeta(content);
    const issues = validateSingleFileCapability(cleanSlug, content);
    return {
      slug: cleanSlug,
      format: 'single-file',
      mode: meta.mode,
      authority: meta.authority,
      scenario: meta.scenario,
      ready: issues.length === 0,
      issues,
    };
  }
  const dir = join(paths.capabilities, cleanSlug);
  const statusPath = join(dir, 'status.json');
  if (!existsSync(statusPath)) throw new Error(`Capability not found: ${slug}`);
  return { ...readJson(statusPath, 'status.json'), slug: cleanSlug, format: 'legacy-directory' };
}

export function addDeliverable(slug, options = {}, root = findRoot()) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('Deliverable slug must use lowercase letters, numbers, and hyphens');
  if (!options.title) throw new Error('Deliverable requires --title');
  if (!options.kind) throw new Error('Deliverable requires --kind (module, feature, behavior, interface, artifact, operational, verification, or other)');
  const { paths, deliverableStore } = loadProject(root);
  if (deliverableStore.deliverables.some((item) => item.slug === slug)) throw new Error(`Deliverable already exists: ${slug}`);
  const id = nextId(deliverableStore.deliverables, 'DLV');
  deliverableStore.deliverables.push({ id, slug, title: options.title, kind: options.kind, notes: options.notes || '', covered_by: [], created_at: now() });
  atomicJson(paths.deliverables, deliverableStore);
  return { id, slug, title: options.title, kind: options.kind };
}

export function listDeliverables(root = findRoot()) {
  const { deliverableStore } = loadProject(root);
  return deliverableStore.deliverables.map((item) => ({ id: item.id, slug: item.slug, title: item.title, kind: item.kind, covered: item.covered_by.length > 0 }));
}

export function checkDeliverableCoverage(root = findRoot()) {
  const { paths, taskStore, deliverableStore } = loadProject(root);
  const taskCovers = new Map();
  for (const task of taskStore.tasks) {
    for (const dlvId of task.covers || []) {
      if (!taskCovers.has(dlvId)) taskCovers.set(dlvId, []);
      taskCovers.get(dlvId).push(task.id);
    }
  }
  const uncovered = [];
  const covered = [];
  for (const dlv of deliverableStore.deliverables) {
    const tasks = taskCovers.get(dlv.id) || [];
    if (tasks.length === 0) uncovered.push({ id: dlv.id, slug: dlv.slug, title: dlv.title });
    else covered.push({ id: dlv.id, slug: dlv.slug, tasks });
  }
  let changed = false;
  for (const dlv of deliverableStore.deliverables) {
    const tasks = taskCovers.get(dlv.id) || [];
    const sorted = [...tasks].sort();
    const current = JSON.stringify(dlv.covered_by);
    const newVal = JSON.stringify(sorted);
    if (current !== newVal) { dlv.covered_by = sorted; changed = true; }
  }
  if (changed) atomicJson(paths.deliverables, deliverableStore);
  const taskById = new Map(taskStore.tasks.map((task) => [task.id, task]));
  const delivered = covered.filter((item) => item.tasks.some((id) => taskById.get(id)?.status === 'done'));
  return { total: deliverableStore.deliverables.length, covered: covered.length, delivered: delivered.length, uncovered: uncovered.length, uncovered_items: uncovered, covered_items: covered };
}

function capabilityPath(paths, name) {
  const slug = capabilitySlug(name);
  const singleFile = join(paths.capabilities, `${slug}.md`);
  if (existsSync(singleFile)) return singleFile;
  const dirCapability = join(paths.capabilities, slug, 'capability.md');
  if (existsSync(dirCapability)) return dirCapability;
  return singleFile;
}

function capabilityTemplateResidue(content) {
  return content.includes('Name the established field, what expertise it contributes')
    || content.includes('Name the established field, what judgment it contributes')
    || content.includes('<node name>')
    || content.includes('<which research material or expert narrative supports this node>')
    || content.includes('<what a top practitioner actually does')
    || content.includes('<what concrete Design decision changed because of this research and reflection>');
}

function designTemplateResidue(content) {
  return content.includes('Describe the project-specific decision, mechanism, boundary, or evidence owned by this section.')
    || content.includes('Compare at least two genuinely viable alternatives (no strawmen).')
    || content.includes('List the specific capability rules, anti-patterns, or verification probes from `.skeinn/capabilities/`')
    || content.includes('Name the concrete false-positive outcomes where the build appears complete');
}

function extractSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^##\\s+|$(?!\\n))`, 'mi'));
  return match ? match[1].trim() : '';
}

const FAKE_SOURCE_PATTERNS = [
  /\bagent-authored\b/i,
  /\bself-authored\b/i,
  /\binternal agent analysis\b/i,
  /\bwritten by agent\b/i,
];

function hasVerifiableSource(sectionText) {
  return /(https?:\/\/\S+|github\.com\/\S+|\[[^\]]+\]\([^)]+\)|Source:\s*\S{4,}|RFC\s*\d+|doi:|ISBN|postmortem|case study|benchmark|repo:)/i.test(sectionText);
}

function validateSingleFileCapability(slug, content) {
  const issues = [];
  if (capabilityTemplateResidue(content)) {
    issues.push(`Capability ${slug} still contains template instructions`);
    return issues;
  }
  const meta = parseSingleFileCapabilityMeta(content);
  if (!CAPABILITY_MODES.includes(meta.mode)) {
    issues.push(`Capability ${slug} has invalid Mode "${meta.mode}" (must be ${CAPABILITY_MODES.join(', ')})`);
  }
  const practices = extractSection(content, 'How real practitioners operate');
  const reflection = extractSection(content, 'Reflection for this project');
  const rules = extractSection(content, 'Operational rules and Design delta');
  if (!practices) issues.push(`Capability ${slug} is missing "## How real practitioners operate"`);
  if (!reflection) issues.push(`Capability ${slug} is missing "## Reflection for this project"`);
  if (!rules) issues.push(`Capability ${slug} is missing "## Operational rules and Design delta"`);
  if (meta.mode === 'external_researched') {
    if (FAKE_SOURCE_PATTERNS.some((pattern) => pattern.test(practices))) {
      issues.push(`Capability ${slug} cites agent-authored/self-authored notes under Mode: external_researched — cite real external practitioner sources or switch honestly to Mode: offline_reflection`);
    } else if (practices && !hasVerifiableSource(practices)) {
      issues.push(`Capability ${slug} declares Mode: external_researched but "## How real practitioners operate" has no verifiable external source (URL, repo, article/book, or Source: reference)`);
    }
  }
  if (rules && !/design delta/i.test(rules)) {
    issues.push(`Capability ${slug} must record a concrete "Design delta" (what Design decision changed because of this research and reflection)`);
  }
  return issues;
}

function extractCapabilityNode(paths, nodeRef) {
  const parts = nodeRef.split('#');
  if (parts.length !== 2) return null;
  const [slug, nodeId] = parts;
  const capPath = capabilityPath(paths, slug);
  if (!existsSync(capPath)) return null;
  const content = readFileSync(capPath, 'utf8');
  const header = `### ${nodeId}:`;
  const headerIndex = content.indexOf(header);
  if (headerIndex === -1) return null;
  const afterHeader = content.slice(headerIndex + header.length);
  const nextNode = afterHeader.search(/### C\d+:/);
  const nextSection = afterHeader.search(/\n## /);
  let endIdx = afterHeader.length;
  if (nextNode !== -1) endIdx = Math.min(endIdx, nextNode);
  if (nextSection !== -1) endIdx = Math.min(endIdx, nextSection);
  return `${header}${afterHeader.slice(0, endIdx)}`;
}

export function importTasks(payload, root = findRoot()) {
  const { paths, taskStore } = loadProject(root);
  const incoming = Array.isArray(payload) ? payload : payload.tasks;
  if (!Array.isArray(incoming) || !incoming.length) throw new Error('Task plan requires a non-empty tasks array');
  for (const raw of incoming) {
    if (raw.status && raw.status !== 'open') throw new Error('New Work Map Tasks must start open; completion requires Task evidence');
    const id = raw.id || nextId(taskStore.tasks, 'TASK');
    if (taskStore.tasks.some((task) => task.id === id)) throw new Error(`Task already exists: ${id}`);
    taskStore.tasks.push({
      id,
      title: raw.title,
      outcome: raw.outcome,
      acceptance: raw.acceptance || [],
      done_when: raw.done_when || [],
      kind: raw.kind || 'delivery',
      boundaries: raw.boundaries || [],
      guardrails: raw.guardrails || [],
      depends_on: raw.depends_on || [],
      reads: raw.reads || ['.skeinn/PROJECT.md'],
      touches: raw.touches || [],
      locks: raw.locks || [],
      implements: raw.implements || '',
      design_exemption: raw.design_exemption || '',
      capability_hooks: raw.capability_hooks || [],
      capability_exemption: raw.capability_exemption || '',
      integrity_version: 1,
      covers: raw.covers || [],
      status: 'open',
      progress: raw.progress || { completed: [], current: '', next: '' },
      evidence: raw.evidence || [],
      created_at: now(),
      updated_at: now(),
    });
  }
  validateTasks(taskStore.tasks);
  atomicJson(paths.tasks, taskStore);
  const { state } = loadProject(root);
  if (state.project.status === 'complete') {
    state.project.status = 'building';
    state.project.updated_at = now();
    atomicJson(paths.state, state);
  }
  return { ...taskSummary(taskStore.tasks), next: 'When PROJECT.md, design documents, capability files (or exemption), and the Work Map are stable, run skeinn project ready to freeze a digest for the one-time Keeper handoff. skeinn context names anything still unfinished.' };
}

export function taskSummary(tasks) {
  const activeTasks = tasks.filter((task) => task.status === 'active');
  const activeByLane = {};
  for (const t of activeTasks) activeByLane[t.lane || 'default'] = t.id;
  return {
    total: tasks.length,
    open: tasks.filter((task) => task.status === 'open').length,
    active: activeTasks[0]?.id || null,
    active_by_lane: activeByLane,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    done: tasks.filter((task) => task.status === 'done').length,
  };
}

export function listTasks(options = {}, root = findRoot()) {
  const { taskStore } = loadProject(root);
  const items = options.status
    ? taskStore.tasks.filter((t) => t.status === options.status)
    : taskStore.tasks;
  return items.map((t) => ({
    id: t.id,
    status: t.status,
    kind: t.kind || 'delivery',
    ...(t.lane ? { lane: t.lane } : {}),
    title: t.title,
    depends_on: t.depends_on || [],
  }));
}

export function getTask(id, root = findRoot()) {
  const { taskStore } = loadProject(root);
  const task = id ? taskStore.tasks.find((item) => item.id === id) : nextTask(taskStore.tasks);
  if (!task) throw new Error(id ? `Task not found: ${id}` : 'No executable Task is available');
  return task;
}

function nextTask(tasks) {
  const active = tasks.find((task) => task.status === 'active');
  if (active) return active;
  const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id));
  return tasks.find((task) => task.status === 'open' && task.depends_on.every((id) => done.has(id))) || null;
}

function sectionHeadingExists(content, anchor) {
  const needle = anchor.toLowerCase();
  return content.split(/\r?\n/).some((line) => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s*/, '').toLowerCase().includes(needle));
}

function taskIntegrityFindings(task, designs, capabilities, paths) {
  if (task.integrity_version !== 1) return [];
  const findings = [];
  if (task.kind !== 'spike' && designs.length && !task.implements?.trim() && !task.design_exemption?.trim()) findings.push('is missing implements or design_exemption');
  if (!paths) return findings;
  if (task.implements?.trim()) {
    const raw = task.implements.trim();
    const [ref, anchor] = raw.split('#');
    let target = null;
    try {
      target = declaredArtifactPath(paths, ref);
    } catch {
      findings.push(`implements uses an unsafe path: ${raw}`);
    }
    if (target && existsSync(target)) {
      if (anchor?.trim() && !sectionHeadingExists(readFileSync(target, 'utf8'), anchor.trim())) findings.push(`implements references a missing design section: ${anchor.trim()}`);
    } else if (target && (ref.includes('/') || ref.includes('\\') || ref.includes('.'))) {
      findings.push(`implements references a missing design document: ${ref}`);
    } else if (target) {
      const corpus = [paths.decisions, ...designs.map((name) => join(paths.design, name)), ...capabilities.map((name) => capabilityPath(paths, name))]
        .filter((path) => existsSync(path))
        .map((path) => readFileSync(path, 'utf8'))
        .join('\n');
      if (!corpus.includes(raw)) findings.push(`implements references a decision not found in project truth: ${raw}`);
    }
  }
  for (const hook of task.capability_hooks || []) {
    const [slug, node] = (hook.node || '').split('#');
    if (!capabilities.includes(slug)) {
      findings.push(`capability_hooks references a missing dossier: ${slug}`);
      continue;
    }
    if (node && !sectionHeadingExists(readFileSync(capabilityPath(paths, slug), 'utf8'), node)) findings.push(`capability_hooks references a missing capability node: ${hook.node}`);
  }
  return findings;
}

function assertTaskIntegrityClassification(task, root) {
  const { paths } = loadProject(root);
  const findings = taskIntegrityFindings(task, listDesigns(root), listCapabilities(root), paths);
  if (findings.length) throw new Error(`${task.id} has unresolved integrity classification:\n- ${findings.join('\n- ')}\nRepair the reference or add a concrete exemption before execution.`);
}

function declaredArtifactPath(paths, ref) {
  const normalized = ref.replaceAll('\\', '/');
  if (isAbsolute(normalized) || normalized.startsWith('/') || normalized.includes('..')) throw new Error(`Unsafe declared artifact path: ${ref}`);
  const fromSkeinn = normalized === '.skeinn' || normalized.startsWith('.skeinn/');
  const base = fromSkeinn ? paths.skeinn : paths.root;
  const relativeRef = fromSkeinn ? normalized.slice('.skeinn'.length).replace(/^\//, '') : normalized;
  const absolute = resolve(base, relativeRef);
  const prefix = `${base}${process.platform === 'win32' ? '\\' : '/'}`;
  if (!absolute.startsWith(prefix) && absolute !== base) throw new Error(`Unsafe declared artifact path: ${ref}`);
  return absolute;
}

function missingTaskOutputs(task, paths) {
  if (task.integrity_version !== 1) return [];
  return task.touches.filter((ref) => !existsSync(declaredArtifactPath(paths, ref)));
}

export function updateTask(id, patch, root = findRoot()) {
  const { paths, taskStore } = loadProject(root);
  const task = taskStore.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.status === 'done') throw new Error(`${id} is done; reopen it first (skeinn task reopen ${id} --reason <why the completion is being revisited>) before changing its record`);
  const allowed = ['title', 'kind', 'outcome', 'acceptance', 'done_when', 'boundaries', 'guardrails', 'depends_on', 'reads', 'touches', 'implements', 'design_exemption', 'capability_hooks', 'capability_exemption', 'covers', 'progress', 'evidence'];
  for (const key of Object.keys(patch)) if (!allowed.includes(key)) throw new Error(`Task field cannot be updated: ${key}`);
  Object.assign(task, patch, { updated_at: now() });
  validateTasks(taskStore.tasks);
  atomicJson(paths.tasks, taskStore);
  return task;
}

export function blockTask(id, payload, root = findRoot()) {
  const task = getTask(id, root);
  if (task.status !== 'active') throw new Error(`${id} is not active`);
  if (!payload.reason || payload.reason.length < 10) throw new Error('Blocking a Task requires a concrete reason');
  if (!Array.isArray(payload.recovery_conditions) || !payload.recovery_conditions.length) throw new Error('Blocking a Task requires recovery_conditions');
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  const { paths, taskStore } = loadProject(root);
  const target = taskStore.tasks.find((item) => item.id === id);
  target.status = 'blocked';
  target.block = { reason: payload.reason, recovery_conditions: payload.recovery_conditions, at: now() };
  target.progress = { ...target.progress, current: `blocked: ${payload.reason}`, next: payload.recovery_conditions.join('; ') };
  target.evidence = [...target.evidence, ...evidence];
  target.updated_at = now();
  validateTasks(taskStore.tasks);
  atomicJson(paths.tasks, taskStore);
  return target;
}

export function reopenTask(id, options = {}, root = findRoot()) {
  const { paths, taskStore } = loadProject(root);
  if (taskStore.tasks.some((task) => task.status === 'active')) throw new Error('Another Task is already active');
  const task = taskStore.tasks.find((item) => item.id === id);
  if (!task || !['blocked', 'done'].includes(task.status)) throw new Error(`${id} is neither blocked nor done`);
  if (!options.reason || options.reason.length < 10) throw new Error(`Reopening ${id} requires a concrete --reason — for blocked Tasks state how the recovery conditions were met, for done Tasks why the completion is disproved`);
  const priorStatus = task.status;
  task.status = 'open';
  if (priorStatus === 'done') {
    task.evidence.push({ type: 'completion_reopened', reason: options.reason, at: now() });
    task.progress = { ...task.progress, current: `completion reopened: ${options.reason}`, next: 'Re-run the Task and close every done condition with evidence.' };
  } else {
    task.evidence.push({ type: 'block_reopened', reason: options.reason, at: now() });
    task.progress = { ...task.progress, current: `block reopened: ${options.reason}`, next: 'Address the recorded recovery conditions and re-verify before completing.' };
  }
  task.reopened_at = now();
  task.updated_at = now();
  validateTasks(taskStore.tasks);
  atomicJson(paths.tasks, taskStore);
  const { state } = loadProject(root);
  if (state.project.status === 'complete') {
    state.project.status = 'building';
    state.project.updated_at = now();
    atomicJson(paths.state, state);
  }
  return task;
}

function dirtyDesignDocsInHorizon(paths, state, tasks) {
  const currentDigests = artifactDigests(paths, tasks, state);
  const horizon = activeHorizon(tasks, paths, 2);
  return computeDirtyArtifacts(currentDigests, state.keeper.reviewed_digests, horizon.artifacts)
    .filter((k) => k.startsWith('.skeinn/design/'));
}

function completedDeliveryTasksSinceLastReview(state, tasks) {
  const lastAt = state.keeper.last_reviewed_at || state.keeper.checkpoints.filter((c) => c.verdict === 'clean').at(-1)?.at || '';
  return tasks.filter((t) => t.status === 'done' && (t.kind || 'delivery') === 'delivery' && (!lastAt || (t.completed_at || '') > lastAt));
}

function hasCoveringDecisionForWindow(state, taskId) {
  const lastAt = state.keeper.last_reviewed_at || '';
  const events = state.decision_events || [];
  return events.some((ev) => {
    if (lastAt && ev.at <= lastAt) return false;
    if (!ev.affected_tasks || !ev.affected_tasks.length) return true;
    return ev.affected_tasks.includes(taskId);
  });
}

function checkLockViolations(actualTouches, locks) {
  if (!Array.isArray(locks) || !locks.length || !Array.isArray(actualTouches) || !actualTouches.length) return [];
  const normalizedLocks = locks.map(normalizeGitPath).filter(Boolean);
  return actualTouches.filter((file) => {
    const f = normalizeGitPath(file);
    return !normalizedLocks.some((lock) => (lock.endsWith('/') ? f.startsWith(lock) : f === lock || f.startsWith(`${lock}/`)));
  });
}

export function focusTask(id, options = {}, root = findRoot()) {
  const { paths, state, taskStore } = loadProject(root);
  const gitInfo = inspectGitRepo(paths.root);
  const lane = options.lane || gitInfo.lane || 'default';
  const existingOnLane = taskStore.tasks.find((task) => task.status === 'active' && (task.lane || 'default') === lane);
  if (existingOnLane && existingOnLane.id !== id) {
    throw new Error(`Lane "${lane}" already has an active Task (${existingOnLane.id}). Close or block it before focusing another Task on this lane.`);
  }
  const task = taskStore.tasks.find((item) => item.id === id);
  if (!task || !['open', 'active'].includes(task.status)) throw new Error(`${id} is not open`);
  assertTaskIntegrityClassification(task, root);
  const pinned = findingsForTask(state, task);
  const blockingPinned = pinned.filter((f) => f.severity === 'blocking');
  if (blockingPinned.length) {
    throw new Error(`${id} has open blocking findings pinned to its scope:\n- ${blockingPinned.map((f) => `${f.id} [${f.scope}]: ${f.text}`).join('\n- ')}\nResolve each with skeinn keeper resolve <id> --evidence "<proof>" before focusing.`);
  }
  const done = new Set(taskStore.tasks.filter((item) => item.status === 'done').map((item) => item.id));
  const missing = task.depends_on.filter((dep) => !done.has(dep));
  if (missing.length) throw new Error(`${id} has incomplete dependencies: ${missing.join(', ')}`);
  for (const ref of task.reads) readContextDocument(paths, ref);
  task.status = 'active';
  task.lane = lane;
  if (!task.focused_at_commit && gitInfo.head) task.focused_at_commit = gitInfo.head;
  if (!task.focused_at) task.focused_at = now();
  task.updated_at = now();
  validateTasks(taskStore.tasks);
  atomicJson(paths.tasks, taskStore);
  if (task.kind !== 'spike' && state.project.status === 'build_ready') {
    state.project.status = 'building';
    state.project.updated_at = now();
    atomicJson(paths.state, state);
  }
  const advisories = pinned.filter((f) => f.severity === 'minor').map((f) => `${f.id} [${f.scope}]: ${f.text}`);
  return {
    ...task,
    ...(advisories.length ? { pinned_advisories: advisories } : {}),
    next: advisories.length
      ? `This Task has ${advisories.length} pinned advisory item(s) — address them during implementation and close via skeinn keeper resolve <id> --evidence "<proof>". Run skeinn context before editing.`
      : 'Run skeinn context to load the Task, guardrails, and reads before editing.',
  };
}

export function closeTask(id, payload, root = findRoot()) {
  const { paths, state, taskStore } = loadProject(root);
  const task = taskStore.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (!['open', 'active'].includes(task.status)) throw new Error(`${id} must be open or active to close (current: ${task.status})`);
  const done = new Set(taskStore.tasks.filter((item) => item.status === 'done').map((item) => item.id));
  const missingDeps = task.depends_on.filter((dep) => !done.has(dep));
  if (missingDeps.length) throw new Error(`${id} has incomplete dependencies: ${missingDeps.join(', ')}`);

  assertTaskIntegrityClassification(task, root);

  const pinned = findingsForTask(state, task);
  const blockingPinned = pinned.filter((f) => f.severity === 'blocking');
  if (blockingPinned.length) {
    throw new Error(`${id} has open blocking findings pinned to its scope:\n- ${blockingPinned.map((f) => `${f.id} [${f.scope}]: ${f.text}`).join('\n- ')}\nResolve each with skeinn keeper resolve <id> --evidence "<proof>" before closing.`);
  }

  // Exact Heavy Window Gate Predicate:
  // Refuse close iff windowHeavy && no clean checkpoint since anchor && no covering decision since anchor
  const dirtyDesigns = dirtyDesignDocsInHorizon(paths, state, taskStore.tasks);
  const reviewWindow = analyzeReviewWindow(paths.root, state.keeper, taskStore.tasks, { dirtyDesignDocs: dirtyDesigns });
  const isSpike = task.kind === 'spike';
  const windowHeavy = reviewWindow.level === 'heavy';
  const hasCleanSinceAnchor = false;
  const hasCoveringDecision = hasCoveringDecisionForWindow(state, task.id);
  if (!isSpike && state.keeper.launch_completed && windowHeavy && !hasCleanSinceAnchor && !hasCoveringDecision) {
    throw new Error(`Cannot close ${id}: review window is heavy (${reviewWindow.reasons.join('; ')}). Run an independent checkpoint (skeinn keeper prompt --checkpoint -> skeinn keeper record --checkpoint) or record an explicit covering decision (skeinn decision) first.`);
  }

  // Support single-line --evidence shortcut (auto-maps to all acceptance criteria)
  let normalizedPayload = payload || {};
  if (typeof normalizedPayload.evidence_line === 'string' && normalizedPayload.evidence_line.trim()) {
    const line = normalizedPayload.evidence_line.trim();
    if (line.length < 5) throw new Error('--evidence requires concrete proof (at least 5 characters)');
    normalizedPayload = {
      evidence: [line],
      acceptance_results: (task.acceptance || []).map((acc) => ({ criterion: acc.criterion, evidence: line })),
      checks: (task.done_when || []).map((criterion) => ({ criterion, evidence: [line] })),
    };
  }

  if (!Array.isArray(normalizedPayload.evidence) || !normalizedPayload.evidence.length) {
    throw new Error('Closing a Task requires concrete evidence (--evidence "<proof>" or --stdin)');
  }

  const hasAcceptance = Array.isArray(task.acceptance) && task.acceptance.length > 0;
  if (hasAcceptance) {
    if (!Array.isArray(normalizedPayload.acceptance_results)) throw new Error('Closing a Task with acceptance[] requires acceptance_results[] (or --evidence "<proof>")');
    const criteria = new Set(task.acceptance.map((acc) => acc.criterion));
    const seen = new Set();
    for (const result of normalizedPayload.acceptance_results) {
      if (!result || !criteria.has(result.criterion)) throw new Error('acceptance_results criterion must match an exact acceptance criterion');
      if (seen.has(result.criterion)) throw new Error(`Duplicate acceptance result: ${result.criterion}`);
      if (!result.evidence || typeof result.evidence !== 'string' || result.evidence.length < 5) throw new Error(`acceptance result requires concrete evidence: ${result.criterion}`);
      seen.add(result.criterion);
    }
    const missingResults = task.acceptance.filter((acc) => !seen.has(acc.criterion));
    if (missingResults.length) throw new Error(`Task close is missing acceptance results:\n- ${missingResults.map((acc) => acc.criterion).join('\n- ')}`);
    for (const result of normalizedPayload.acceptance_results) {
      const acc = task.acceptance.find((acc) => acc.criterion === result.criterion);
      acc.evidence = result.evidence;
    }
    task.evidence = [...task.evidence, ...normalizedPayload.evidence, { type: 'acceptance_results', results: normalizedPayload.acceptance_results, at: now() }];
  } else {
    if (!Array.isArray(normalizedPayload.checks)) throw new Error('Closing a Task with done_when[] requires checks for every done_when criterion');
    const criteria = new Set(task.done_when);
    const seen = new Set();
    for (const check of normalizedPayload.checks) {
      if (!check || !criteria.has(check.criterion)) throw new Error('Task close check must quote an exact done_when criterion');
      if (seen.has(check.criterion)) throw new Error(`Duplicate Task close check: ${check.criterion}`);
      if (!Array.isArray(check.evidence) || !check.evidence.length) throw new Error(`Task close check requires evidence: ${check.criterion}`);
      seen.add(check.criterion);
    }
    const missingChecks = task.done_when.filter((criterion) => !seen.has(criterion));
    if (missingChecks.length) throw new Error(`Task close is missing done_when checks:\n- ${missingChecks.join('\n- ')}`);
    task.evidence = [...task.evidence, ...normalizedPayload.evidence, { type: 'done_when_checks', checks: normalizedPayload.checks, at: now() }];
  }

  // Auto-derive actual_touches from Git Attribution Window (fallback to declared touches in non-git repos)
  const derived = deriveTaskActualTouches(paths.root, task);
  task.actual_touches = derived.git ? derived.files : (task.touches || []);
  const lockViolations = checkLockViolations(task.actual_touches, task.locks);
  if (lockViolations.length) task.lock_violations = lockViolations;
  else delete task.lock_violations;

  task.status = 'done';
  task.progress = { ...task.progress, current: 'complete', next: '' };
  task.completed_at = now();
  task.updated_at = now();
  validateTasks(taskStore.tasks);
  atomicJson(paths.tasks, taskStore);
  if (taskStore.tasks.length && taskStore.tasks.every((item) => item.status === 'done')) {
    state.project.status = 'complete';
    state.project.updated_at = now();
    atomicJson(paths.state, state);
  } else if (state.project.status === 'build_ready') {
    state.project.status = 'building';
    state.project.updated_at = now();
    atomicJson(paths.state, state);
  }
  return {
    ...task,
    review_window: { level: reviewWindow.level, files: reviewWindow.files.length, lines_changed: reviewWindow.lines_changed, anchor_status: reviewWindow.anchor_status },
    ...(lockViolations.length ? { warning: `actual_touches exceeded declared locks: ${lockViolations.join(', ')}` } : {}),
  };
}

export function markReady(root = findRoot(), options = {}) {
  const { paths, state, taskStore } = loadProject(root);
  const project = readFileSync(paths.project, 'utf8');
  const designs = listDesigns(root);
  const capabilities = listCapabilities(root);
  const highOpen = state.understanding.unresolved.filter((item) => item.status === 'open' && item.impact === 'high');
  const errors = [];
  if (project.includes('> This is the concise entry point') || project.length < 400) errors.push('PROJECT.md still looks like a template');
  if (!designs.length) errors.push('No design document exists; PROJECT.md is an index, not the entire project design');
  const unfinishedDesigns = designs.filter((name) => designTemplateResidue(readFileSync(join(paths.design, name), 'utf8')));
  if (unfinishedDesigns.length) errors.push(`Design documents still contain template instructions: ${unfinishedDesigns.join(', ')}`);
  if (!capabilities.length && !state.capability_exemption?.reason) {
    errors.push('No capability file exists and no capability exemption is recorded. Add 1–3 bottleneck capabilities with skeinn capability add <slug> --title <field>, or record skeinn capability exempt --reason <why standard engineering suffices>');
  }
  for (const name of capabilities) {
    const content = readFileSync(capabilityPath(paths, name), 'utf8');
    if (isLegacyDirectoryCapability(paths, name)) {
      if (capabilityTemplateResidue(content)) errors.push(`Capability dossier still contains template instructions: ${name}`);
    } else {
      errors.push(...validateSingleFileCapability(name, content));
    }
  }
  if (!taskStore.tasks.length) errors.push('The initial work map is empty');
  const integrityErrors = [];
  for (const task of taskStore.tasks) {
    for (const finding of taskIntegrityFindings(task, designs, capabilities, paths)) integrityErrors.push(`${task.id} ${finding}`);
  }
  if (integrityErrors.length) errors.push(`Task integrity classification is unresolved:\n  - ${integrityErrors.join('\n  - ')}`);
  if (highOpen.length) errors.push(`High-impact questions remain open: ${highOpen.map((item) => item.id).join(', ')}`);
  const currentDigests = artifactDigests(paths, taskStore.tasks, state);
  const horizon = activeHorizon(taskStore.tasks, paths, 2);
  const preparedScope = {};
  for (const key of horizon.artifacts) {
    if (key in currentDigests) preparedScope[key] = currentDigests[key];
  }
  if ('state:capability_exemption' in currentDigests) preparedScope['state:capability_exemption'] = currentDigests['state:capability_exemption'];
  const digest = overallDigest(preparedScope);
  const latestKeeper = state.keeper.attempts.at(-1);
  if (['needs_revision', 'blocked'].includes(state.keeper.status) && latestKeeper?.prepared_digest === digest) {
    errors.push('Keeper requested revision, but active-horizon project truth and Task definitions have not changed');
  }
  // Convergence guard: if last two failed attempts did not strictly reduce blocking count (>=), pause blind looping
  const failedAttempts = state.keeper.attempts.filter((a) => ['needs_revision', 'blocked'].includes(a.verdict));
  if (failedAttempts.length >= 2 && !options.forceRound) {
    const prev = failedAttempts.at(-2);
    const curr = failedAttempts.at(-1);
    const prevCount = typeof prev.blocking_count === 'number' ? prev.blocking_count : (prev.gaps || []).length;
    const currCount = typeof curr.blocking_count === 'number' ? curr.blocking_count : (curr.gaps || []).length;
    if (currCount > 0 && currCount >= prevCount) {
      errors.push(`Non-convergent Keeper loop detected: blocking findings did not decrease across the last two rounds (${prevCount} -> ${currCount}). Narrow the active horizon, record a bounded assumption (skeinn record), or pass --force-round --reason "<why another round will converge>"`);
    }
  }
  if (options.forceRound && (!options.reason || options.reason.trim().length < 10)) {
    errors.push('--force-round requires a concrete --reason (at least 10 characters)');
  }
  if (errors.length) throw new Error(`Project is not ready for Keeper:\n- ${errors.join('\n- ')}`);
  const priorBaseline = latestKeeper?.artifact_digests || state.keeper.reviewed_digests || {};
  const dirty = computeDirtyArtifacts(currentDigests, priorBaseline, horizon.artifacts);
  delete state.keeper.auto_passed;
  state.project.status = 'ready_for_keeper';
  state.project.updated_at = now();
  state.keeper.prepared_digest = digest;
  state.keeper.prepared_scope = preparedScope;
  state.keeper.prepared_artifact_digests = currentDigests;
  state.keeper.prepared_horizon_tasks = horizon.taskIds;
  state.keeper.prepared_horizon_artifacts = horizon.artifacts;
  state.keeper.prepared_dirty_artifacts = dirty;
  state.keeper.prepared_attempt = state.keeper.attempts.length + 1;
  atomicJson(paths.state, state);
  return {
    ready_for_keeper: true,
    digest: state.keeper.prepared_digest,
    attempt: state.keeper.prepared_attempt,
    delta_mode: state.keeper.prepared_attempt >= 2,
    horizon_tasks: horizon.taskIds,
    dirty_artifacts: dirty,
    next: 'Open a fresh Agent and run skeinn keeper prompt',
  };
}

function projectDigest(paths, tasks, state = null) {
  return overallDigest(artifactDigests(paths, tasks, state));
}

export function getKeeperPrompt(root = findRoot()) {
  const { state } = loadProject(root);
  if (state.project.status !== 'ready_for_keeper') throw new Error('Run skeinn project ready before Keeper handoff');
  const attempt = state.keeper.prepared_attempt || 1;
  return keeperProtocol({
    attemptNumber: attempt,
    preparedDigest: state.keeper.prepared_digest,
    deltaMode: attempt >= 2,
    dirtyArtifacts: state.keeper.prepared_dirty_artifacts || [],
    horizonTaskIds: state.keeper.prepared_horizon_tasks || [],
  });
}

export function recordKeeper(payload, root = findRoot()) {
  const { paths, state, taskStore } = loadProject(root);
  if (state.project.status !== 'ready_for_keeper') throw new Error('Keeper result cannot be recorded before skeinn project ready');
  if (!['passed', 'passed_with_advisories', 'needs_revision', 'blocked'].includes(payload.verdict)) {
    throw new Error('Keeper verdict must be passed, passed_with_advisories, needs_revision, or blocked');
  }
  if (!payload.summary || !Array.isArray(payload.evidence) || !payload.evidence.length) throw new Error('Keeper result requires summary and evidence');
  const isPass = ['passed', 'passed_with_advisories'].includes(payload.verdict);
  if (payload.evidence.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('Keeper evidence entries must be non-empty strings');
  if (payload.gaps !== undefined && !Array.isArray(payload.gaps)) throw new Error('Keeper gaps must be an array');
  if (payload.advisories !== undefined && !Array.isArray(payload.advisories)) throw new Error('Keeper advisories must be an array');
  for (const gap of payload.gaps || []) {
    if (typeof gap === 'string' && gap.trim()) continue;
    if (gap && typeof gap === 'object' && typeof gap.gap === 'string' && gap.gap.trim()) continue;
    throw new Error('Each Keeper gap must be a non-empty string or an object with a gap field');
  }
  if (isPass) {
    if (payload.verdict === 'passed' && payload.gaps?.length) throw new Error('Keeper pass cannot contain unresolved gaps; use passed_with_advisories for minor-only items');
    if (payload.verdict === 'passed_with_advisories') {
      const blockingInPass = (payload.gaps || []).filter((g) => typeof g === 'string' || g.severity !== 'minor');
      if (blockingInPass.length) throw new Error('passed_with_advisories cannot include blocking gaps; use needs_revision for blocking gaps');
    }
    if (!payload.review || payload.review.mode !== 'independent') throw new Error('Keeper pass requires an independent review; use review.mode="independent" from a fresh Agent, or skeinn keeper skip with a concrete reason');
    if (!payload.review.reviewer_id || payload.review.reviewer_id.length < 6 || !payload.review.evidence || payload.review.evidence.length < 10) throw new Error('Independent Keeper review requires reviewer_id and concrete review evidence');
  }

  if (!payload.run_id || payload.run_id.length < 6) throw new Error('Keeper result requires a unique fresh-thread run_id');
  if (state.keeper.attempts.some((attempt) => attempt.run_id === payload.run_id)) throw new Error(`Keeper run_id was already used: ${payload.run_id}`);
  if (!payload.prepared_digest || payload.prepared_digest !== state.keeper.prepared_digest) throw new Error('Keeper result prepared_digest does not match the current ready state');
  const currentDigests = artifactDigests(paths, taskStore.tasks, state);
  const scopeEntries = Object.entries(state.keeper.prepared_scope || {});
  if (scopeEntries.length) {
    for (const [key, expected] of scopeEntries) {
      if (currentDigests[key] !== expected) {
        throw new Error(`Active-horizon artifact changed after skeinn project ready (${key}); prepare a new Keeper attempt`);
      }
    }
  } else {
    const currentDigest = overallDigest(currentDigests);
    if (currentDigest !== state.keeper.prepared_digest) throw new Error('Project truth changed after skeinn project ready; prepare a new Keeper attempt');
  }
  if (isPass) {
    const openFindings = new Map();
    for (const attempt of state.keeper.attempts) {
      for (const closure of attempt.closure_results || []) openFindings.delete(closure.gap);
      for (const finding of attempt.gaps || []) {
        const gap = typeof finding === 'string' ? finding : finding?.gap;
        if (gap) openFindings.set(gap, true);
      }
    }
    for (const gap of openFindings.keys()) {
      const closure = payload.closure_results?.find((item) => item.gap === gap);
      if (!closure || typeof closure.evidence !== 'string' || !closure.evidence.trim()) {
        throw new Error(`Keeper pass requires closure_results evidence for: ${gap}`);
      }
    }
  }
  const horizonSet = new Set([...(state.keeper.prepared_horizon_tasks || []), ...(state.keeper.prepared_horizon_artifacts || []), 'project']);
  const blockingCount = (payload.gaps || []).filter((g) => {
    if (typeof g === 'string') return true;
    const sev = g.severity || 'blocking';
    if (sev !== 'blocking') return false;
    // Out-of-horizon blocking observations auto-downgrade to minor advisory
    if (g.scope && !scopeTouchesHorizon(g.scope, horizonSet)) return false;
    return true;
  }).length;
  const attempt = {
    run_id: payload.run_id,
    prepared_digest: payload.prepared_digest,
    artifact_digests: currentDigests,
    verdict: payload.verdict,
    blocking_count: blockingCount,
    summary: payload.summary,
    evidence: payload.evidence,
    gaps: payload.gaps || [],
    advisories: payload.advisories || [],
    review: payload.review || { mode: 'unverified', reviewer_id: '', evidence: '' },
    can_auto_pass: false,
    closure_results: payload.closure_results || [],
    at: now(),
  };
  state.keeper.attempts.push(attempt);
  // Apply closures to unified findings ledger
  for (const closure of payload.closure_results || []) {
    for (const f of state.keeper.findings) {
      if (f.status === 'open' && (f.text === closure.gap || f.id === closure.id)) {
        f.status = 'closed';
        f.closure_evidence = closure.evidence;
        f.closed_at = now();
      }
    }
  }
  // Upsert findings/advisories into unified ledger (with horizon-relative severity)
  if (isPass) {
    const minorItems = [
      ...(payload.gaps || []).map((g) => (typeof g === 'string' ? { gap: g, severity: 'minor' } : { ...g, severity: 'minor' })),
      ...(payload.advisories || []).map((a) => (typeof a === 'string' ? { gap: a, severity: 'minor' } : { ...a, severity: 'minor' })),
    ];
    upsertFindings(state, minorItems, { sourceRunId: payload.run_id, defaultSeverity: 'minor' });
    // Commit reviewed horizon artifacts into reviewed_digests (birth certificate)
    const reviewedScope = state.keeper.prepared_horizon_artifacts?.length
      ? state.keeper.prepared_horizon_artifacts
      : Object.keys(currentDigests);
    for (const key of reviewedScope) {
      if (key in currentDigests) state.keeper.reviewed_digests[key] = currentDigests[key];
    }
    state.keeper.launch_completed = true;
    const anchorSnap = snapshotReviewAnchor(paths.root);
    state.keeper.last_reviewed_commit = anchorSnap.commit;
    state.keeper.last_reviewed_worktree = anchorSnap.worktree;
    state.keeper.last_reviewed_at = now();
    state.project.status = 'build_ready';
  } else {
    const normalizedGaps = (payload.gaps || []).map((g) => {
      if (typeof g === 'string') return { gap: g, scope: 'project', severity: 'blocking' };
      const scope = g.scope || 'project';
      const sev = g.severity === 'minor' || (scope !== 'project' && !scopeTouchesHorizon(scope, horizonSet)) ? 'minor' : 'blocking';
      return { ...g, scope, severity: sev };
    });
    upsertFindings(state, normalizedGaps, { sourceRunId: payload.run_id, defaultSeverity: 'blocking' });
    state.project.status = 'shaping';
  }
  state.keeper.status = payload.verdict;
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  return state.keeper;
}

export function resolveFinding(id, options = {}, root = findRoot()) {
  if (!options.evidence || options.evidence.trim().length < 10) {
    throw new Error('Resolving a finding requires concrete --evidence (at least 10 characters)');
  }
  const { paths, state } = loadProject(root);
  const finding = state.keeper.findings.find((f) => f.id === id);
  if (!finding) throw new Error(`Finding not found: ${id}`);
  if (finding.status === 'closed') return finding;
  finding.status = 'closed';
  finding.closure_evidence = options.evidence.trim();
  finding.closed_at = now();
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  return finding;
}

export function resetKeeper(reason, root = findRoot()) {
  if (!reason || reason.trim().length < 10) throw new Error('Resetting Keeper requires a concrete --reason (at least 10 characters)');
  const { paths, state } = loadProject(root);
  state.keeper.reviewed_digests = {};
  state.keeper.launch_completed = false;
  state.keeper.status = 'not_run';
  state.project.status = 'shaping';
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  recordDecision({ summary: `Keeper relaunch reset: ${reason.trim()}`, changes: ['.skeinn/state.json'] }, root);
  return { reset: true, reason: reason.trim(), next: 'Shape the revised direction, then run skeinn project ready for a fresh Launch Keeper review.' };
}

export function getCheckpointPrompt(options = {}, root = findRoot()) {
  const { paths, state, taskStore } = loadProject(root);
  const currentDigests = artifactDigests(paths, taskStore.tasks, state);
  const horizon = activeHorizon(taskStore.tasks, paths, 2);
  const dirty = computeDirtyArtifacts(currentDigests, state.keeper.reviewed_digests, horizon.artifacts);
  const openFindings = state.keeper.findings.filter((f) => f.status === 'open');
  return checkpointProtocol({
    milestone: options.milestone || 'in-flight',
    dirtyArtifacts: dirty,
    openFindings,
    preparedDigest: overallDigest(currentDigests),
  });
}

export function recordCheckpoint(payload, root = findRoot()) {
  const { paths, state, taskStore } = loadProject(root);
  if (!['clean', 'drift_detected', 'blocked'].includes(payload.verdict)) {
    throw new Error('Checkpoint verdict must be clean, drift_detected, or blocked');
  }
  if (!payload.run_id || payload.run_id.length < 6) throw new Error('Checkpoint requires a unique run_id');
  if (state.keeper.checkpoints.some((c) => c.run_id === payload.run_id)) throw new Error(`Checkpoint run_id already used: ${payload.run_id}`);
  if (!payload.summary || !Array.isArray(payload.evidence) || !payload.evidence.length) throw new Error('Checkpoint requires summary and evidence');
  if (!payload.review || payload.review.mode !== 'independent' || !payload.review.reviewer_id || payload.review.reviewer_id.length < 6) {
    throw new Error('Checkpoint requires independent review provenance (review.mode="independent" and reviewer_id)');
  }
  const currentDigests = artifactDigests(paths, taskStore.tasks, state);
  const horizon = activeHorizon(taskStore.tasks, paths, 2);
  const dirty = computeDirtyArtifacts(currentDigests, state.keeper.reviewed_digests, horizon.artifacts);
  for (const closure of payload.closure_results || []) {
    if (!closure.evidence || closure.evidence.trim().length < 5) throw new Error(`Closure for ${closure.id || closure.gap} requires concrete evidence`);
    for (const f of state.keeper.findings) {
      if (f.status === 'open' && (f.id === closure.id || f.text === closure.gap)) {
        f.status = 'closed';
        f.closure_evidence = closure.evidence.trim();
        f.closed_at = now();
      }
    }
  }
  if (payload.findings?.length) {
    upsertFindings(state, payload.findings, { sourceRunId: payload.run_id, defaultSeverity: payload.verdict === 'clean' ? 'minor' : 'blocking' });
  }
  if (payload.verdict === 'clean') {
    for (const key of horizon.artifacts) {
      if (key in currentDigests) state.keeper.reviewed_digests[key] = currentDigests[key];
    }
    const anchorSnap = snapshotReviewAnchor(paths.root);
    state.keeper.last_reviewed_commit = anchorSnap.commit;
    state.keeper.last_reviewed_worktree = anchorSnap.worktree;
    state.keeper.last_reviewed_at = now();
  }
  const record = {
    id: nextId(state.keeper.checkpoints, 'CHK'),
    run_id: payload.run_id,
    milestone: payload.milestone || 'in-flight',
    verdict: payload.verdict,
    summary: payload.summary,
    dirty_artifacts: dirty,
    findings_added: (payload.findings || []).length,
    closures: (payload.closure_results || []).length,
    review: payload.review,
    evidence: payload.evidence,
    snapshot_digest: overallDigest(currentDigests),
    at: now(),
  };
  state.keeper.checkpoints.push(record);
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  return record;
}

export function skipKeeper(reason, root = findRoot()) {
  if (!reason || reason.length < 10) throw new Error('Skipping Keeper requires a concrete reason');
  const { paths, state, taskStore } = loadProject(root);
  if (state.project.status !== 'ready_for_keeper') throw new Error('Keeper can only be skipped after skeinn project ready');
  const currentDigests = artifactDigests(paths, taskStore.tasks, state);
  const reviewedScope = state.keeper.prepared_horizon_artifacts?.length
    ? state.keeper.prepared_horizon_artifacts
    : Object.keys(currentDigests);
  for (const key of reviewedScope) {
    if (key in currentDigests) state.keeper.reviewed_digests[key] = currentDigests[key];
  }
  state.keeper.status = 'skipped';
  state.keeper.launch_completed = true;
  state.keeper.skip_reason = reason;
  const anchorSnap = snapshotReviewAnchor(paths.root);
  state.keeper.last_reviewed_commit = anchorSnap.commit;
  state.keeper.last_reviewed_worktree = anchorSnap.worktree;
  state.keeper.last_reviewed_at = now();
  state.project.status = 'build_ready';
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  return state.keeper;
}

export function startClarify(options = {}, root = findRoot()) {
  if (!options.reason || options.reason.length < 10) throw new Error('Opening a clarification round requires a concrete --reason (what changed or what is now unclear)');
  const { paths, state } = loadProject(root);
  const clarify = ensureClarify(state);
  if (clarify.active) throw new Error(`A clarification round is already open: ${clarify.reason}`);
  clarify.active = true;
  clarify.reason = options.reason;
  clarify.started_at = now();
  clarify.closed_at = '';
  clarify.rounds = [];
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  return { active: true, reason: clarify.reason, next: 'Pause material work and ask the human ONE batch of only material questions — answers that could change the result, boundary, design, or proof (typically two to seven). Then record the batch with skeinn clarify resolve --json-file <round.json>.' };
}

export function resolveClarify(payload, root = findRoot()) {
  const { paths, state } = loadProject(root);
  const clarify = ensureClarify(state);
  if (!clarify.active) throw new Error('No clarification round is open. Start one with skeinn clarify start --reason <what changed>.');
  const answered = [];
  for (const item of payload.answers || []) {
    if (item.id) {
      const target = state.understanding.unresolved.find((q) => q.id === item.id);
      if (!target) throw new Error(`Unknown unresolved id ${item.id}`);
      if (!item.resolution && item.status !== 'skipped') throw new Error(`Answer for ${item.id} requires a resolution or skipped status`);
      target.status = item.status === 'skipped' ? 'skipped' : 'resolved';
      target.resolution = item.resolution || '';
      target.resolved_at = now();
      answered.push(item.id);
    } else if (item.question && item.resolution) {
      state.understanding.confirmed.push({ id: nextId(state.understanding.confirmed, 'F'), text: `${item.question} → ${item.resolution}`, source: 'clarification', at: now() });
      answered.push(item.question);
    } else {
      throw new Error('Each answer needs {id, resolution|skipped} for a recorded question or {question, resolution} to record the answer as a fact');
    }
  }
  for (const item of asObjects(payload.confirmed, 'text')) {
    if (!item.text) throw new Error('Confirmed fact requires text');
    state.understanding.confirmed.push({ id: nextId(state.understanding.confirmed, 'F'), text: item.text, source: item.source || 'clarification', at: now() });
  }
  for (const id of payload.retire_assumptions || []) {
    const target = state.understanding.assumptions.find((a) => a.id === id);
    if (!target) throw new Error(`Unknown assumption id ${id}`);
    target.status = 'retired';
  }
  for (const decision of payload.decisions || []) appendDecision(paths.decisions, decision, state);
  const roundNo = clarify.rounds.length + 1;
  const newOpenIds = [];
  for (const item of asObjects(payload.new_questions, 'question')) {
    if (!item.question) throw new Error('New question requires question text');
    const id = nextId(state.understanding.unresolved, 'Q');
    state.understanding.unresolved.push({ id, question: item.question, recommendation: item.recommendation || '', impact: item.impact || 'medium', status: 'open', at: now(), clarify_round: roundNo });
    newOpenIds.push(id);
  }
  clarify.rounds.push({ round: roundNo, answered, confirmed: (payload.confirmed || []).length, decisions: (payload.decisions || []).length, new_open: newOpenIds, at: now() });
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  const openRoundQs = state.understanding.unresolved.filter((q) => q.status === 'open' && q.clarify_round);
  return {
    round: roundNo,
    rounds_recorded: clarify.rounds.length,
    open_round_questions: openRoundQs.map((q) => `${q.id}: ${q.question}`),
    next: openRoundQs.length
      ? 'Material questions remain open — ask them in the next batch, then skeinn clarify resolve again.'
      : 'Round recorded. If the direction materially changed, run skeinn decision for consequential changes, update the affected design documents and Tasks, then skeinn clarify close.',
  };
}

export function closeClarify(root = findRoot()) {
  const { paths, state } = loadProject(root);
  const clarify = ensureClarify(state);
  if (!clarify.active) throw new Error('No clarification round is open.');
  if (!clarify.rounds.length) throw new Error('Closing requires at least one recorded round — run skeinn clarify resolve with real answers. Closing empty would silently drop the trigger.');
  const openQs = state.understanding.unresolved.filter((q) => q.status === 'open' && q.clarify_round);
  if (openQs.length) throw new Error(`Round questions still open: ${openQs.map((q) => `${q.id}: ${q.question}`).join(' | ')}. Resolve them or explicitly mark them skipped via skeinn clarify resolve.`);
  clarify.active = false;
  clarify.closed_at = now();
  state.project.updated_at = now();
  atomicJson(paths.state, state);
  return { closed: true, rounds: clarify.rounds.length, next: 'Cascade the answers downward: update PROJECT.md, design documents, and Tasks to match the clarified direction; record skeinn decision for consequential changes (skeinn check flags affected done Tasks); then resume from skeinn context.' };
}

export function clarifyStatus(root = findRoot()) {
  const { state } = loadProject(root);
  const clarify = ensureClarify(state);
  return { ...clarify, open_round_questions: state.understanding.unresolved.filter((q) => q.status === 'open' && q.clarify_round).map((q) => ({ id: q.id, question: q.question, recommendation: q.recommendation || '', impact: q.impact })) };
}

export function recordDecision(payload, root = findRoot()) {
  if (!payload || !payload.summary || payload.summary.length < 10) throw new Error('Decision requires summary (at least 10 characters)');
  if (!payload.changes || !Array.isArray(payload.changes) || !payload.changes.length) throw new Error('Decision requires changes (array of affected files or decisions)');
  const { paths, state } = loadProject(root);
  const timestamp = now();
  const id = `D-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).slice(-4)}`;
  const entry = `## ${id}: ${payload.summary}\n\n- Changed: ${payload.changes.join(', ')}\n${payload.affected_tasks ? `- Affected tasks: ${payload.affected_tasks.join(', ')}\n` : ''}- At: ${timestamp}\n`;
  const existing = readFileSync(paths.decisions, 'utf8');
  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(paths.decisions, existing + separator + entry, 'utf8');
  state.decision_events.push({
    id,
    at: timestamp,
    summary: payload.summary,
    changes: payload.changes,
    affected_tasks: payload.affected_tasks || [],
  });
  state.project.updated_at = timestamp;
  atomicJson(paths.state, state);
  return { id, summary: payload.summary, changes: payload.changes, affected_tasks: payload.affected_tasks || [] };
}

function describeCapabilityState(paths, name) {
  if (isLegacyDirectoryCapability(paths, name)) {
    const statusPath = join(paths.capabilities, name, 'status.json');
    return existsSync(statusPath) ? `${name} (${readJson(statusPath, 'status.json').status || 'legacy'})` : `${name} (legacy)`;
  }
  const content = readFileSync(capabilityPath(paths, name), 'utf8');
  const meta = parseSingleFileCapabilityMeta(content);
  const flag = meta.mode === 'offline_reflection' ? 'offline_reflection — unverified externally' : meta.mode;
  return `${name} (${flag}, ${meta.authority})`;
}

export function compileContext(options = {}, root = findRoot()) {
  const { paths, state, taskStore } = loadProject(root);
  const designs = listDesigns(root);
  const capabilities = listCapabilities(root);
  const summary = taskSummary(taskStore.tasks);
  const gitInfo = inspectGitRepo(paths.root);
  const lane = gitInfo.lane || 'default';
  const task = options.taskId
    ? getTask(options.taskId, root)
    : (taskStore.tasks.find((item) => item.status === 'active' && (item.lane || 'default') === lane)
      || taskStore.tasks.find((item) => item.status === 'active'));
  const next = nextTask(taskStore.tasks);
  const blockedTasks = taskStore.tasks.filter((item) => item.status === 'blocked');
  const blockedLine = blockedTasks.length
    ? `- Blocked: ${blockedTasks.map((item) => `${item.id} — ${item.block?.reason || 'no reason recorded'} (recover: ${(item.block?.recovery_conditions || []).join('; ') || 'not recorded'})`).join(' | ')}\n`
    : '';
  const clarify = state.clarify || { active: false };
  const openRoundQs = state.understanding.unresolved.filter((q) => q.status === 'open' && q.clarify_round);
  const frontierBlock = openRoundQs.length
    ? `\n  - Current frontier (ask now, each with your recommended answer):\n${openRoundQs.map((q) => `    - ${q.id}: ${q.question}${q.recommendation ? ` — recommended: ${q.recommendation}` : ''}`).join('\n')}`
    : '';
  const recommendation = clarify.active
    ? `Clarification round OPEN: ${clarify.reason} (rounds recorded: ${clarify.rounds.length}). Pause material work — do not edit code or Tasks until the round closes. Look up every fact discoverable from the workspace yourself; ask the human only the decision questions in the current frontier, each carrying your recommended answer. Record the batch with \`skeinn clarify resolve --json-file\`, then \`skeinn clarify close\`.${frontierBlock}`
    : state.project.status === 'ready_for_keeper'
    ? 'Keeper handoff pending. The host must open a fresh Agent without inherited conversation, provide the workspace and CLI paths, and ask it to run `skeinn keeper prompt`. Wait for `skeinn keeper record`, then resume `skeinn context`. See `skeinn keeper --help`.'
    : ['needs_revision', 'blocked'].includes(state.keeper.status)
      ? 'Resolve the Keeper findings in the source documents and Tasks, run `skeinn project ready`, and obtain a fresh independent review. See `skeinn keeper --help`.'
    : task
    ? `You have a focused Task on lane "${lane}": ${task.id}. Read the Task, its guardrails, pinned findings, and reads below. Close it with \`skeinn task close ${task.id} --evidence "<proof>"\` (or \`--stdin\` for per-criterion mapping).`
    : next
      ? `No focused Task on lane "${lane}". The next executable Task is ${next.id}. Focus it with \`skeinn task focus ${next.id}\` (or close directly with \`skeinn task close ${next.id}\`).`
      : state.project.status === 'complete'
        ? 'All Tasks are done. Run \`skeinn check\` to verify health. If new work arises, record the decision and update the Work Map.'
        : state.project.status === 'shaping'
          ? shapingFrontier({ paths, state, taskStore, designs, capabilities })
          : blockedTasks.length
            ? 'No executable Task. Review the blocked Tasks listed above; reopen one when its recovery conditions are met with `skeinn task reopen <id> --reason <how they were met>`, or extend the Work Map.'
            : 'No executable Task. Create or update Tasks so the Work Map matches the project goal.';
  const capabilityStates = capabilities.map((name) => describeCapabilityState(paths, name));
  const capStatusLine = capabilityStates.length
    ? capabilityStates.join(', ')
    : state.capability_exemption?.reason
      ? `exempted (${state.capability_exemption.reason})`
      : 'none';
  const dirtyDesigns = dirtyDesignDocsInHorizon(paths, state, taskStore.tasks);
  const reviewWindow = analyzeReviewWindow(paths.root, state.keeper, taskStore.tasks, { dirtyDesignDocs: dirtyDesigns });
  const recentDone = completedDeliveryTasksSinceLastReview(state, taskStore.tasks);
  const sentinelReasons = [];
  if (state.keeper.launch_completed && recentDone.length >= 5) sentinelReasons.push(`${recentDone.length} delivery tasks closed since last clean review`);
  if (reviewWindow.level === 'heavy') sentinelReasons.push(...reviewWindow.reasons);
  const anchorShort = reviewWindow.anchor ? reviewWindow.anchor.slice(0, 7) : 'unanchored';
  const reviewWindowLine = reviewWindow.git
    ? `- Review window: ${reviewWindow.files.length} files / ${reviewWindow.lines_changed} lines since ${anchorShort} (${reviewWindow.level}, anchor: ${reviewWindow.anchor_status})`
    : `- Review window: non-git workspace (${reviewWindow.level})`;
  const sentinelLine = sentinelReasons.length
    ? `- Sentinel: CHECKPOINT RECOMMENDED (${sentinelReasons.join('; ')}) — run \`skeinn keeper prompt --checkpoint\` `
    : '- Sentinel: ok';
  const activeDisplay = Object.keys(summary.active_by_lane || {}).length
    ? Object.entries(summary.active_by_lane).map(([l, tid]) => `${tid} (lane: ${l})`).join(', ')
    : 'none';
  const statusBlock = `## Current Skeinn state and recommended action\n\n- State source: ${paths.skeinn} (${paths.state_mode}) | Repo: ${paths.root} (lane: ${lane})\n- Project status: ${state.project.status}\n- Focused task(s): ${activeDisplay}\n- Work map: ${summary.total} total, ${summary.open} open, ${summary.done} done, ${summary.blocked} blocked\n${blockedLine}- Design documents: ${designs.length}\n- Capability files: ${capStatusLine}\n- Keeper status: ${state.keeper.status}\n${reviewWindowLine}\n${sentinelLine}\n- Clarification round: ${clarify.active ? `OPEN — ${clarify.reason} (${clarify.rounds.length} recorded)` : 'none'}\n\n**Recommended next action:** ${recommendation}\n\nThis is a recommendation, not a script. Use your judgment; if you choose differently, record the reason in \`.skeinn/DECISIONS.md\` or Task evidence.${options.keeper || options.full ? '' : '\n\nNeed the full runtime protocol (first entry or after a context reset)? Run skeinn context --full.'}`;
  const blocks = [statusBlock];
  if (options.full || options.keeper) blocks.push(agentProtocol({ humanChannel: options.humanChannel || 'available' }));
  blocks.push(shapingContext({ state, taskSummary: summary, capabilityNames: capabilityStates, designNames: designs, forKeeper: Boolean(options.keeper) }));
  if (['passed', 'passed_with_advisories'].includes(state.keeper.status) && state.keeper.attempts.at(-1)?.review?.mode !== 'independent') {
    blocks.splice(1, 0, 'WARNING: The recorded Keeper pass has no independent review provenance. Obtain a fresh handoff before relying on it; see `skeinn keeper --help`.');
  }
  const injectWholeDocs = options.full || options.keeper || options.checkpoint || state.project.status === 'shaping' || !task;
  if (injectWholeDocs) {
    blocks.push(`## Project whole (${normalizeRef(paths, paths.project)})\n\n${readFileSync(paths.project, 'utf8')}`);
    if (existsSync(paths.structure)) blocks.push(`## Project structure (${normalizeRef(paths, paths.structure)})\n\n${readFileSync(paths.structure, 'utf8')}`);
  } else {
    blocks.push(`## Project reference pointers (omitted in lean mode; pass --full to expand)\n\n- Project whole: .skeinn/PROJECT.md\n- Project structure: .skeinn/STRUCTURE.md`);
  }
  if (options.checkpoint) {
    const currentDigests = artifactDigests(paths, taskStore.tasks, state);
    const horizon = activeHorizon(taskStore.tasks, paths, 2);
    const dirty = computeDirtyArtifacts(currentDigests, state.keeper.reviewed_digests, horizon.artifacts);
    const openFindings = state.keeper.findings.filter((f) => f.status === 'open');
    blocks.unshift(checkpointProtocol({ milestone: 'in-flight', dirtyArtifacts: dirty, openFindings, preparedDigest: overallDigest(currentDigests) }));
    blocks.push(`## Decision history (${normalizeRef(paths, paths.decisions)})\n\n${readFileSync(paths.decisions, 'utf8')}`);
    blocks.push(`## Unreviewed Git Review Window (Reality Plane)\n\n- Anchor: ${reviewWindow.anchor || 'none'} (status: ${reviewWindow.anchor_status})\n- Triage level: ${reviewWindow.level}${reviewWindow.reasons.length ? ` (${reviewWindow.reasons.join('; ')})` : ''}\n- Lines changed: ${reviewWindow.lines_changed}\n- Shared surface hits: ${reviewWindow.shared_hits.length ? reviewWindow.shared_hits.join(', ') : 'none'}\n- Changed files (${reviewWindow.files.length}):\n${reviewWindow.files.length ? reviewWindow.files.map((f) => `  - ${f}`).join('\n') : '  - none'}`);
    if (recentDone.length) {
      blocks.push(`## Recently closed delivery Tasks since last clean review (${recentDone.length})\n\n${recentDone.map((t) => `- ${t.id}: ${t.title} (actual_touches: ${(t.actual_touches || []).join(', ') || 'none'})`).join('\n')}`);
    }
    blocks.push(`## Dirty / newly-entering horizon artifacts (${dirty.length})\n\n${dirty.length ? dirty.map((k) => `- ${k}`).join('\n') : '- none'}`);
    for (const key of dirty) {
      if (key.startsWith('.skeinn/design/')) blocks.push(`## Design document (dirty): ${basename(key)}\n\n${getDesign(basename(key), root)}`);
      else if (key.startsWith('.skeinn/capabilities/')) blocks.push(`## Capability file (dirty): ${basename(key)}\n\n${getCapability(basename(key), root)}`);
      else if (key.startsWith('task:')) {
        const t = taskStore.tasks.find((item) => item.id === key.slice(5));
        if (t) blocks.push(`## Horizon Task (dirty): ${t.id}\n\n${JSON.stringify(t, null, 2)}`);
      }
    }
  } else if (options.keeper) {
    const attempt = state.keeper.prepared_attempt || 1;
    const isDelta = attempt >= 2 && !options.full;
    const dirty = state.keeper.prepared_dirty_artifacts || [];
    const dirtySet = new Set(dirty);
    blocks.unshift(keeperProtocol({
      attemptNumber: attempt,
      preparedDigest: state.keeper.prepared_digest,
      deltaMode: attempt >= 2,
      dirtyArtifacts: dirty,
      horizonTaskIds: state.keeper.prepared_horizon_tasks || [],
    }));
    blocks.push(`## Decision history (${normalizeRef(paths, paths.decisions)})\n\n${readFileSync(paths.decisions, 'utf8')}`);
    blocks.push(`## Work map summary\n\n${JSON.stringify(summary, null, 2)}\n\nActive horizon Tasks: ${(state.keeper.prepared_horizon_tasks || []).join(', ') || 'none'}\n\nFirst executable Task:\n\n${JSON.stringify(nextTask(taskStore.tasks), null, 2)}`);
    for (const name of designs) {
      const ref = `.skeinn/design/${name}`;
      if (!isDelta || dirtySet.has(ref)) blocks.push(`## Design document: ${name}\n\n${getDesign(name, root)}`);
    }
    if (capabilities.length) {
      for (const name of capabilities) {
        const ref = normalizeRef(paths, capabilityPath(paths, name));
        if (!isDelta || dirtySet.has(ref)) blocks.push(`## Capability file: ${name}\n\n${getCapability(name, root)}`);
      }
    } else if (state.capability_exemption?.reason) {
      blocks.push(`## Capability exemption (audit whether standard engineering genuinely suffices)\n\n- Reason: ${state.capability_exemption.reason}\n- Recorded at: ${state.capability_exemption.at}`);
    }
  } else if (task) {
    if (options.full) blocks.push(EXECUTION_PROTOCOL);
    blocks.push(`## Active Task\n\n${JSON.stringify(task, null, 2)}`);
    if (task.guardrails && task.guardrails.length) {
      blocks.push(`## Task guardrails (specialist red lines)\n\n${task.guardrails.map((rule) => `- ${rule}`).join('\n')}`);
    }
    const taskFindings = findingsForTask(state, task);
    if (taskFindings.length) {
      blocks.push(`## Pinned Keeper findings for ${task.id}\n\n${taskFindings.map((f) => `- ${f.id} [${f.severity}, scope: ${f.scope}]: ${f.text}`).join('\n')}\n\nClose each with \`skeinn keeper resolve <id> --evidence "<proof>"\`.`);
    }
    for (const ref of task.reads) {
      const content = readContextDocument(paths, ref);
      if (content && ref.replaceAll('\\', '/') !== normalizeRef(paths, paths.project)) blocks.push(`## Task context: ${ref}\n\n${content}`);
    }
    if (task.capability_hooks && task.capability_hooks.length) {
      const hookBlocks = [];
      for (const hook of task.capability_hooks) {
        const nodeContent = extractCapabilityNode(paths, hook.node);
        if (nodeContent) {
          const atLine = hook.at ? `\n\n**Activate at:** ${hook.at}` : '';
          const produceLine = hook.must_produce ? `\n\n**Must produce:** ${hook.must_produce}` : '';
          hookBlocks.push(`### Capability hook: ${hook.node}${atLine}${produceLine}\n\n${nodeContent}`);
        }
      }
      if (hookBlocks.length) blocks.push(`## Capability decision points\n\n${hookBlocks.join('\n\n')}`);
    }
  } else {
    blocks.push(`## On-demand project context\n\n- Decision history: .skeinn/DECISIONS.md (read when correction or lineage matters)\n${capabilities.length ? capabilities.map((name) => `- Professional capability: ${normalizeRef(paths, capabilityPath(paths, name))}`).join('\n') : state.capability_exemption?.reason ? `- Capability exemption: ${state.capability_exemption.reason}` : '- No capability files yet; add 1–3 bottleneck domains with skeinn capability add <slug> --title <field>, or record skeinn capability exempt --reason.'}\n${designs.length ? designs.map((name) => `- Design: .skeinn/design/${name}`).join('\n') : '- No design documents yet; split the whole according to consequential systems and decisions.'}
- Guidance: skeinn help shaping | design | capability | task`);
  }
  return blocks.filter(Boolean).join('\n\n---\n\n');
}

function shapingFrontier({ paths, state, taskStore, designs, capabilities }) {
  const gaps = [];
  const project = readFileSync(paths.project, 'utf8');
  if (project.includes('> This is the concise entry point') || project.length < 400) gaps.push('PROJECT.md is still a template — write the real intended result, boundaries, and document map');
  if (!designs.length) gaps.push('no design documents — split the consequential decision surfaces with skeinn design add (skeinn help design explains what one owns)');
  const unfinishedDesigns = designs.filter((name) => designTemplateResidue(readFileSync(join(paths.design, name), 'utf8')));
  if (unfinishedDesigns.length) gaps.push(`design documents still contain template text: ${unfinishedDesigns.join(', ')}`);
  if (!capabilities.length && !state.capability_exemption?.reason) {
    gaps.push('no capability files or exemption — research 1–3 bottleneck domains with skeinn capability add <slug> --title <field>, or explicitly record skeinn capability exempt --reason <why standard engineering suffices>');
  } else {
    const capIssues = [];
    for (const name of capabilities) {
      const content = readFileSync(capabilityPath(paths, name), 'utf8');
      if (isLegacyDirectoryCapability(paths, name)) {
        const statusPath = join(paths.capabilities, name, 'status.json');
        const st = existsSync(statusPath) ? readJson(statusPath, 'status.json').status : 'legacy';
        if (st !== 'confirmed') capIssues.push(`${name} (${st})`);
      } else {
        const issues = validateSingleFileCapability(name, content);
        if (issues.length) capIssues.push(`${name} (${issues[0]})`);
      }
    }
    if (capIssues.length) gaps.push(`capability files incomplete — finish practitioner research, reflection, and Design delta for: ${capIssues.join('; ')}`);
  }
  const highOpen = state.understanding.unresolved.filter((item) => item.status === 'open' && item.impact === 'high');
  if (highOpen.length) gaps.push(`high-impact questions still open: ${highOpen.map((item) => item.id).join(', ')}`);
  if (!taskStore.tasks.length) gaps.push('the Work Map is empty — decompose the delivery surface (skeinn deliverable add) and plan Tasks (skeinn task plan --help)');
  if (!gaps.length) return 'Shaping layers are present. If material uncertainty remains, keep clarifying; otherwise run skeinn project ready to freeze a digest for the one-time Keeper handoff.';
  return `Project is still shaping. Unfinished frontier:\n${gaps.map((gap) => `  - ${gap}`).join('\n')}\nIterate Design and bottleneck Capabilities together, then run skeinn project ready.`;
}

function normalizeRef(paths, absolute) {
  const skeinnPrefix = `${paths.skeinn}${process.platform === 'win32' ? '\\' : '/'}`;
  if (absolute === paths.skeinn || absolute.startsWith(skeinnPrefix)) return `.skeinn/${relative(paths.skeinn, absolute).replaceAll('\\', '/')}`.replace(/\/$/, '');
  return relative(paths.root, absolute).replaceAll('\\', '/');
}

function readContextDocument(paths, ref) {
  const normalized = ref.replaceAll('\\', '/');
  if (isAbsolute(normalized) || normalized.startsWith('/') || normalized.includes('..')) throw new Error(`Unsafe context reference: ${ref}`);
  const fromSkeinn = normalized === '.skeinn' || normalized.startsWith('.skeinn/');
  const base = fromSkeinn ? paths.skeinn : paths.root;
  const relativeRef = fromSkeinn ? normalized.slice('.skeinn'.length).replace(/^\//, '') : normalized;
  const absolute = resolve(base, relativeRef);
  const prefix = `${base}${process.platform === 'win32' ? '\\' : '/'}`;
  if (!absolute.startsWith(prefix) && absolute !== base) throw new Error(`Unsafe context reference: ${ref}`);
  if (!existsSync(absolute)) throw new Error(`Task context file does not exist: ${ref}`);
  if (!statSync(absolute).isFile()) throw new Error(`Task context must name a file, not a directory: ${ref}`);
  return readFileSync(absolute, 'utf8');
}

export function checkProject(root = findRoot()) {
  const { paths, state, taskStore } = loadProject(root);
  const designs = listDesigns(root);
  const capabilities = listCapabilities(root);
  const errors = [];
  const warnings = [];
  const taskById = new Map(taskStore.tasks.map((task) => [task.id, task]));
  for (const task of taskStore.tasks) {
    for (const ref of task.reads) {
      try { readContextDocument(paths, ref); } catch (error) { errors.push(`${task.id}: ${error.message}`); }
    }
    if (task.capability_hooks) {
      for (const hook of task.capability_hooks) {
        const nodeContent = extractCapabilityNode(paths, hook.node);
        if (nodeContent === null) warnings.push(`${task.id} references missing capability node: ${hook.node}`);
      }
    }
    if (task.integrity_version === 1) {
      const classificationFindings = taskIntegrityFindings(task, designs, capabilities, paths);
      const target = ['active', 'done'].includes(task.status) ? errors : warnings;
      target.push(...classificationFindings.map((finding) => `${task.id} ${finding}`));
      if (task.status === 'done') {
        if (Array.isArray(task.lock_violations) && task.lock_violations.length) {
          warnings.push(`${task.id} actual_touches exceeded declared locks: ${task.lock_violations.join(', ')}`);
        }
        const staleDeps = task.depends_on.filter((depId) => taskById.get(depId)?.status !== 'done');
        if (staleDeps.length) {
          warnings.push(`${task.id} is done but upstream dependency (${staleDeps.join(', ')}) is no longer done — needs_recheck (reopen if prior evidence is invalidated)`);
        }
      }
    }
    const hasAcceptance = Array.isArray(task.acceptance) && task.acceptance.length > 0;
    const hasDoneWhen = Array.isArray(task.done_when) && task.done_when.length > 0;
    if (!hasAcceptance && hasDoneWhen) warnings.push(`${task.id} uses done_when[] without acceptance[] — consider migrating to structured acceptance for clearer verification`);
  }
  if (state.project.status === 'build_ready' && !['passed', 'passed_with_advisories', 'skipped'].includes(state.keeper.status)) errors.push('Project is build_ready without Keeper pass or explicit skip');
  if (state.understanding.unresolved.some((item) => item.status === 'open' && item.impact === 'high')) warnings.push('High-impact uncertainty remains open');
  const decisionsContent = readFileSync(paths.decisions, 'utf8');
  for (const block of decisionsContent.split(/\n(?=## )/)) {
    const affectedMatch = block.match(/- Affected tasks: (.+)/);
    if (!affectedMatch) continue;
    const decisionAt = block.match(/- At: (\S+)/)?.[1] || '';
    for (const taskId of affectedMatch[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const task = taskStore.tasks.find((item) => item.id === taskId);
      if (!task || task.status !== 'done') continue;
      const completedAt = task.completed_at || task.updated_at || '';
      if (decisionAt && completedAt && completedAt > decisionAt) continue;
      warnings.push(`${taskId} is done but was marked affected by a decision; reopen and re-complete it to close this warning (skeinn task reopen ${taskId} --reason <how the decision was reviewed>)`);
    }
  }
  if (!capabilities.length && !state.capability_exemption?.reason) warnings.push('No capability file exists and no capability exemption is recorded; add 1–3 bottleneck capabilities or run skeinn capability exempt --reason');
  if (!designs.length) warnings.push('No design document exists; PROJECT.md should remain a concise map of the whole');
  if (!existsSync(paths.structure)) warnings.push('No STRUCTURE.md exists; declare where files go so the Agent does not guess');
  else if (readFileSync(paths.structure, 'utf8').includes('Where implementation files go. Example:')) warnings.push('STRUCTURE.md still contains template instructions; customize it for this project');
  for (const name of designs) {
    const content = readFileSync(join(paths.design, name), 'utf8');
    if (designTemplateResidue(content)) warnings.push(`Design document still contains template instructions: ${name}`);
    const kindMatch = content.match(/^-\s*Kind:\s*([^\n]+)/m);
    const kind = kindMatch ? kindMatch[1].trim() : '';
    if (CORE_DESIGN_KINDS.includes(kind) && !extractSection(content, 'Alternatives considered')) {
      warnings.push(`Core design document ${name} (${kind}) has no "## Alternatives considered" section — compare at least two viable options to avoid first-draft convergence`);
    }
  }
  for (const name of capabilities) {
    const content = readFileSync(capabilityPath(paths, name), 'utf8');
    if (isLegacyDirectoryCapability(paths, name)) {
      if (capabilityTemplateResidue(content)) warnings.push(`Capability dossier still contains template instructions: ${name}`);
      if (content.includes('### C') && !content.includes('source:')) warnings.push(`Capability dossier has decision tree nodes without source citations: ${name}`);
      const statusPath = join(paths.capabilities, name, 'status.json');
      if (existsSync(statusPath)) {
        const capStatus = readJson(statusPath, 'status.json');
        if (capStatus.status && capStatus.status !== 'confirmed') warnings.push(`Capability ${name} is ${capStatus.status}, not confirmed; tasks referencing it proceed provisionally`);
      }
    } else {
      const issues = validateSingleFileCapability(name, content);
      warnings.push(...issues);
      const meta = parseSingleFileCapabilityMeta(content);
      if (meta.mode === 'offline_reflection') warnings.push(`Capability ${name} is offline_reflection (unverified externally)`);
    }
  }
  const latestKeeper = state.keeper.attempts.at(-1);
  if (['passed', 'passed_with_advisories'].includes(state.keeper.status) && latestKeeper && latestKeeper.review?.mode !== 'independent') errors.push('Keeper pass has no independently attested review provenance; obtain a fresh review (skeinn keeper --help) or record skeinn keeper skip --reason <limitation>');
  const latestCheckpoint = state.keeper.checkpoints.at(-1);
  if (latestCheckpoint && latestCheckpoint.verdict === 'drift_detected') {
    warnings.push(`Latest in-flight checkpoint (${latestCheckpoint.id}) detected drift: ${latestCheckpoint.summary}`);
  }

  // AGENTS.md v2 -> v3 migration check
  const agentsPath = join(paths.root, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const agentsContent = readFileSync(agentsPath, 'utf8');
    if (agentsContent.includes('<!-- skeinn:v2 -->') && !agentsContent.includes('<!-- skeinn:v3 -->')) {
      warnings.push('AGENTS.md anchor is v2; run skeinn init --refresh-agents to update to v3.0 commands');
    }
  }

  // Orthogonal 3-Sentinel Checks (silent-drift count + physical review window + stale active task)
  const dirtyDesigns = dirtyDesignDocsInHorizon(paths, state, taskStore.tasks);
  const reviewWindow = analyzeReviewWindow(paths.root, state.keeper, taskStore.tasks, { dirtyDesignDocs: dirtyDesigns });
  const recentDone = completedDeliveryTasksSinceLastReview(state, taskStore.tasks);
  const sentinels = [];

  if (state.keeper.launch_completed && recentDone.length >= 5) {
    const msg = `Silent-drift sentinel: ${recentDone.length} delivery task(s) closed since last clean review — run skeinn keeper prompt --checkpoint`;
    warnings.push(msg);
    sentinels.push(msg);
  }
  if (reviewWindow.anchor_status === 'lost') {
    const msg = `Review anchor lost (${reviewWindow.anchor?.slice(0, 7) || 'unknown'} unreachable) — run skeinn keeper prompt --checkpoint`;
    warnings.push(msg);
    sentinels.push(msg);
  } else if (state.keeper.launch_completed && reviewWindow.level === 'heavy') {
    const msg = `Physical review window is heavy (${reviewWindow.reasons.join('; ')}) — run skeinn keeper prompt --checkpoint`;
    warnings.push(msg);
    sentinels.push(msg);
  }
  const staleCutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  for (const activeTask of taskStore.tasks.filter((t) => t.status === 'active')) {
    const updatedMs = Date.parse(activeTask.updated_at || '');
    if (updatedMs && updatedMs < staleCutoffMs && reviewWindow.files.length > 0) {
      const msg = `Stale active Task ${activeTask.id} (lane: ${activeTask.lane || 'default'}) has unreviewed worktree drift (${reviewWindow.files.length} files)`;
      warnings.push(msg);
      sentinels.push(msg);
    }
  }
  if (state.keeper.launch_completed && state.project.status === 'building') {
    const currentDigests = artifactDigests(paths, taskStore.tasks, state);
    const horizon = activeHorizon(taskStore.tasks, paths, 2);
    const dirty = computeDirtyArtifacts(currentDigests, state.keeper.reviewed_digests, horizon.artifacts);
    if (dirty.length) warnings.push(`In-flight horizon has ${dirty.length} unreviewed/changed artifact(s): ${dirty.join(', ')} — consider skeinn keeper prompt --checkpoint`);
  }

  // Ledger-integrity sentinels: the .skeinn/ ledger is plain JSON and can be edited directly.
  // These checks cannot prevent ledger forgery, but they make the common fingerprints loud.
  for (const task of taskStore.tasks) {
    if (task.status === 'done' && !task.completed_at) {
      const msg = `${task.id} is marked done without close metadata (no completed_at) — possible direct ledger edit; audit .skeinn/tasks.json or skeinn task reopen`;
      warnings.push(msg);
      sentinels.push(msg);
    }
  }
  const fndNums = state.keeper.findings
    .map((f) => /^FND-(\d+)$/.exec(f.id || '')?.[1])
    .filter(Boolean)
    .map(Number);
  const recordedFindings = state.keeper.checkpoints.reduce((sum, c) => sum + (c.findings_added || 0), 0);
  if (fndNums.length && Math.max(...fndNums) > fndNums.length) {
    const msg = `Findings ledger has sequence gaps (max FND-${String(Math.max(...fndNums)).padStart(3, '0')}, ${fndNums.length} entries) — possible direct ledger edit`;
    warnings.push(msg);
    sentinels.push(msg);
  } else if (!fndNums.length && recordedFindings > 0) {
    const msg = `Findings ledger is empty but ${recordedFindings} finding(s) were recorded in checkpoints — possible direct ledger edit`;
    warnings.push(msg);
    sentinels.push(msg);
  }
  const lastResetAt = (state.decision_events || [])
    .filter((e) => (e.summary || '').includes('Keeper relaunch reset'))
    .map((e) => e.at || '')
    .sort()
    .at(-1) || '';
  if (lastResetAt && !state.keeper.launch_completed) {
    const closedDuringDisarm = taskStore.tasks.filter(
      (t) => t.status === 'done' && (t.completed_at || '') > lastResetAt,
    );
    if (closedDuringDisarm.length) {
      const msg = `${closedDuringDisarm.length} task(s) closed while the heavy-review gate was disarmed after a keeper reset (${closedDuringDisarm.map((t) => t.id).join(', ')}) — Launch has not been re-run`;
      warnings.push(msg);
      sentinels.push(msg);
    }
  }

  const coverage = checkDeliverableCoverage(root);
  if (coverage.uncovered > 0) warnings.push(`Uncovered deliverables: ${coverage.uncovered_items.map((item) => item.slug).join(', ')}`);
  if (coverage.covered > coverage.delivered) warnings.push(`${coverage.covered - coverage.delivered} deliverable(s) are covered only by Tasks not yet done`);
  return {
    healthy: errors.length === 0,
    errors,
    warnings,
    summary: taskSummary(taskStore.tasks),
    review_window: reviewWindow,
    sentinels,
    deliverable_coverage: { total: coverage.total, planned: coverage.covered, delivered: coverage.delivered, uncovered: coverage.uncovered },
  };
}

export function scaffoldEval(payload, root = findRoot()) {
  if (!payload.id || !payload.title || !payload.brief) throw new Error('Eval scenario requires id, title, and brief');
  const { paths } = loadProject(root);
  const slug = payload.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const dir = join(paths.eval, slug);
  if (existsSync(dir)) throw new Error(`Eval scenario already exists: ${payload.id}`);
  mkdirSync(dir, { recursive: true });
  const humanChannel = payload.human_channel || 'available';
  if (!['available', 'unavailable'].includes(humanChannel)) throw new Error('human_channel must be available or unavailable');
  const mode = payload.mode || 'relay';
  if (!['probe', 'relay', 'full'].includes(mode)) throw new Error('Eval mode must be probe, relay, or full');
  const budgetCny = typeof payload.budget_cny === 'number' ? payload.budget_cny : (mode === 'probe' ? 5 : mode === 'relay' ? 20 : 60);
  const defaultReps = mode === 'full' ? 3 : 1;
  const manifest = {
    schema_version: 2,
    id: payload.id,
    title: payload.title,
    mode,
    budget_cny: budgetCny,
    brief: payload.brief,
    pivot: payload.pivot || '',
    primary_comparison: 'same capable Agent without Skeinn vs with Skeinn',
    hidden_user_facts: payload.hidden_user_facts || [],
    hidden_checks: payload.hidden_checks || [],
    success_criteria: payload.success_criteria || [],
    scoring_mode: 'pairwise_forced_choice + hidden_oracle + real_telemetry',
    conditions: [
      { id: 'baseline', framework: 'none', instruction: 'Work normally with all ordinary Agent capabilities and tools.' },
      { id: 'skeinn', framework: 'skeinn-v2', instruction: 'Use Skeinn as invisible Agent continuity infrastructure.' },
    ],
    controls: {
      same_model_tools_workspace_and_budget: true,
      human_channel: humanChannel,
      minimum_repetitions_per_condition: payload.repetitions || defaultReps,
      scripted_user_answers: true,
      context_reset_points: payload.context_reset_points || (mode === 'relay' ? ['after-baton-1', 'after-baton-2'] : ['after-shaping', 'mid-task']),
      blind_pairwise_order_swap: true,
      anonymization_preserves_relative_layout: true,
      judge_packet_preflight_required: true,
      condition_output_digest_manifest: true,
      telemetry_required: true,
    },
    measures: ['intent_fidelity_and_pivot_survival', 'specialist_craft_depth', 'cold_handoff_continuity', 'hidden_oracle_credibility', 'user_burden_and_ceremony', 'net_value_per_rmb'],
  };
  atomicJson(join(dir, 'manifest.json'), manifest);
  atomicJson(join(dir, 'telemetry-template.json'), {
    scenario_id: payload.id,
    mode,
    model: '<e.g. deepseek-v4.1-flash>',
    budget_cny_cap: budgetCny,
    arms: {
      baseline: { input_tokens: 0, output_tokens: 0, cost_cny: 0, wall_seconds: 0, tool_calls: 0, batons_completed: 0, hidden_oracle_passed: 0, hidden_oracle_total: 0 },
      skeinn: { input_tokens: 0, output_tokens: 0, cost_cny: 0, wall_seconds: 0, tool_calls: 0, cli_retries: 0, batons_completed: 0, hidden_oracle_passed: 0, hidden_oracle_total: 0 },
    },
  });
  const oracleScript = `#!/usr/bin/env node
// Hidden Oracle assertions for ${payload.id} — NEVER show this file to the tested Agents.
// Run against each anonymized arm directory: node hidden-oracle.mjs <arm-workspace-dir>
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] || '.');
const checks = [
  // Add objective Pass/Fail checks here (files, contracts, static scans, smoke runs):
  { name: 'workspace exists', fn: () => existsSync(target) },
];

let passed = 0;
for (const check of checks) {
  try {
    if (!check.fn()) throw new Error('returned false');
    passed += 1;
    console.log(\`PASS: \${check.name}\`);
  } catch (err) {
    console.error(\`FAIL: \${check.name} — \${err.message}\`);
    process.exitCode = 1;
  }
}
console.log(JSON.stringify({ target, passed, total: checks.length }, null, 2));
`;
  writeFileSync(join(dir, 'hidden-oracle.mjs'), oracleScript, 'utf8');
  writeFileSync(join(dir, 'baseline-prompt.md'), `${evalConditionPrompt({ brief: payload.brief, skeinn: false, humanChannel })}\n`, 'utf8');
  writeFileSync(join(dir, 'skeinn-prompt.md'), `${evalConditionPrompt({ brief: payload.brief, skeinn: true, humanChannel })}\n`, 'utf8');
  writeFileSync(join(dir, 'judge-prompt.md'), `${evalJudgePrompt()}\n`, 'utf8');
  if (mode === 'relay') {
    const batonsDir = join(dir, 'batons');
    mkdirSync(batonsDir, { recursive: true });
    for (const baton of [1, 2, 3]) {
      writeFileSync(join(batonsDir, `baseline-baton-${baton}.md`), `${evalRelayBatonPrompt({ brief: payload.brief, pivot: payload.pivot, batonNumber: baton, skeinn: false, humanChannel })}\n`, 'utf8');
      writeFileSync(join(batonsDir, `skeinn-baton-${baton}.md`), `${evalRelayBatonPrompt({ brief: payload.brief, pivot: payload.pivot, batonNumber: baton, skeinn: true, humanChannel })}\n`, 'utf8');
    }
  }
  if (mode === 'probe') {
    writeFileSync(join(dir, 'probe-checklist.md'), evalProbeChecklist({ id: payload.id, title: payload.title }), 'utf8');
  }
  return { scenario: payload.id, mode, budget_cny: budgetCny, path: normalizeRef(paths, dir), controls: manifest.controls };
}
