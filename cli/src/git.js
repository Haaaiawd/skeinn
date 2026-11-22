import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  'rev-parse',
  'diff',
  'status',
  'log',
  'cat-file',
  'merge-base',
  'ls-files',
  'config',
]);

const DEFAULT_IGNORE_DIRS = [
  '.skeinn/',
  '.git/',
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  'coverage/',
];

const DEFAULT_IGNORE_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  '.skeinn-state',
]);

const DEFAULT_IGNORE_PREFIXES = [
  'keeper-result',
  'checkpoint-result',
];

const DEFAULT_IGNORE_SUFFIXES = [
  '.snap',
  '.min.js',
  '.min.css',
  '.map',
  '.tmp',
];

/**
 * Single read-only Git execution gateway for the entire Skeinn codebase.
 * Skeinn NEVER runs write-mutating git commands (commit, add, checkout, reset, etc.).
 */
export function gitIn(repoRoot, args) {
  if (!Array.isArray(args) || !args.length) {
    throw new Error('gitIn requires a non-empty argument array');
  }
  const subcommand = args[0];
  if (subcommand === 'config' && args[1] !== '--get') {
    throw new Error('Disallowed git config operation: Skeinn only allows read-only "git config --get"');
  }
  if (!ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`Disallowed git subcommand "${subcommand}": Skeinn only executes read-only git commands`);
  }
  const res = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: res.status === 0 && !res.error,
    status: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

export function normalizeGitPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export function loadIgnorePatterns(repoRoot) {
  const ignorePath = join(repoRoot, '.skeinnignore');
  if (!existsSync(ignorePath)) return [];
  return readFileSync(ignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export function shouldIgnorePath(relPath, extraPatterns = []) {
  const normalized = normalizeGitPath(relPath);
  if (!normalized) return true;
  // The review-shaping config can never hide itself: a broadened .skeinnignore
  // (e.g. `*`) must remain visible in the Review Window it is shrinking.
  if (normalized === '.skeinnignore') return false;
  if (normalized === '.skeinn-state') return false;
  const base = basename(normalized);

  // Check explicit negation in .skeinnignore first
  for (const raw of extraPatterns) {
    if (raw.startsWith('!')) {
      const target = normalizeGitPath(raw.slice(1));
      if (matchPattern(normalized, base, target)) return false;
    }
  }

  for (const dir of DEFAULT_IGNORE_DIRS) {
    if (normalized.startsWith(dir) || normalized.includes(`/${dir}`)) return true;
  }
  if (DEFAULT_IGNORE_FILES.has(base)) return true;
  if (base.endsWith('.json') && DEFAULT_IGNORE_PREFIXES.some((p) => base.startsWith(p))) return true;
  for (const suffix of DEFAULT_IGNORE_SUFFIXES) {
    if (normalized.endsWith(suffix)) return true;
  }

  for (const raw of extraPatterns) {
    if (raw.startsWith('!')) continue;
    if (matchPattern(normalized, base, normalizeGitPath(raw))) return true;
  }
  return false;
}

function matchPattern(normalized, base, pattern) {
  if (!pattern) return false;
  if (pattern.endsWith('/')) {
    return normalized.startsWith(pattern) || normalized.includes(`/${pattern}`);
  }
  if (pattern.startsWith('*.')) {
    return normalized.endsWith(pattern.slice(1));
  }
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(normalized);
  }
  return normalized === pattern || base === pattern || normalized.startsWith(`${pattern}/`);
}

export function inspectGitRepo(cwd = process.cwd()) {
  const absolute = resolve(cwd);
  const inside = gitIn(absolute, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return {
      isGit: false,
      topLevel: absolute,
      mainWorktree: absolute,
      isLinkedWorktree: false,
      branch: null,
      lane: basename(absolute) || 'default',
      head: null,
    };
  }
  const topRes = gitIn(absolute, ['rev-parse', '--show-toplevel']);
  const topLevel = topRes.ok ? resolve(topRes.stdout.trim()) : absolute;

  const gitDirRes = gitIn(topLevel, ['rev-parse', '--git-dir']);
  const commonDirRes = gitIn(topLevel, ['rev-parse', '--git-common-dir']);
  const gitDir = gitDirRes.ok ? resolve(topLevel, gitDirRes.stdout.trim()) : join(topLevel, '.git');
  const commonDir = commonDirRes.ok ? resolve(topLevel, commonDirRes.stdout.trim()) : gitDir;
  const isLinkedWorktree = gitDir !== commonDir;
  const mainWorktree = basename(commonDir) === '.git' ? dirname(commonDir) : topLevel;

  const branchRes = gitIn(topLevel, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const rawBranch = branchRes.ok ? branchRes.stdout.trim() : '';
  const branch = rawBranch && rawBranch !== 'HEAD' ? rawBranch : null;
  const lane = branch || basename(topLevel) || 'default';

  const headRes = gitIn(topLevel, ['rev-parse', 'HEAD']);
  const head = headRes.ok ? headRes.stdout.trim() : null;

  return {
    isGit: true,
    topLevel,
    mainWorktree,
    isLinkedWorktree,
    branch,
    lane,
    head,
  };
}

export function gitHead(repoRoot) {
  const res = gitIn(repoRoot, ['rev-parse', 'HEAD']);
  return res.ok ? res.stdout.trim() : null;
}

export function isCommitReachable(repoRoot, sha) {
  if (!sha) return false;
  const exists = gitIn(repoRoot, ['cat-file', '-e', `${sha}^{commit}`]);
  if (!exists.ok) return false;
  const head = gitHead(repoRoot);
  if (!head) return true;
  const mb = gitIn(repoRoot, ['merge-base', sha, head]);
  return mb.ok && mb.stdout.trim().length > 0;
}

export function getDirtyWorktreeFiles(repoRoot, extraPatterns = loadIgnorePatterns(repoRoot)) {
  const res = gitIn(repoRoot, ['status', '--porcelain=v1', '-uall']);
  if (!res.ok) return [];
  const files = new Set();
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line || line.length < 4) continue;
    let filePart = line.slice(3).trim();
    if (filePart.includes(' -> ')) filePart = filePart.split(' -> ').at(-1).trim();
    if (filePart.startsWith('"') && filePart.endsWith('"')) filePart = filePart.slice(1, -1);
    const normalized = normalizeGitPath(filePart);
    if (!shouldIgnorePath(normalized, extraPatterns)) files.add(normalized);
  }
  return [...files].sort();
}

export function hashWorktreeFiles(repoRoot, files) {
  const map = {};
  for (const rel of files) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      map[rel] = '__DELETED__';
    } else {
      try {
        map[rel] = createHash('sha256').update(readFileSync(abs)).digest('hex');
      } catch {
        map[rel] = '__UNREADABLE__';
      }
    }
  }
  return map;
}

function parseNumstat(stdout, extraPatterns) {
  const files = new Set();
  let linesChanged = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0] === '-' ? 0 : Number.parseInt(parts[0], 10) || 0;
    const deleted = parts[1] === '-' ? 0 : Number.parseInt(parts[1], 10) || 0;
    const filePath = normalizeGitPath(parts.slice(2).join('\t'));
    if (shouldIgnorePath(filePath, extraPatterns)) continue;
    files.add(filePath);
    linesChanged += added + deleted;
  }
  return { files, linesChanged };
}

export function computeSharedSurface(repoRoot, tasks = [], extraPatterns = loadIgnorePatterns(repoRoot)) {
  const shared = new Set();

  // 1. Historical task touches (>= 2 completed tasks)
  const taskCounts = new Map();
  for (const task of tasks) {
    if (task.status !== 'done') continue;
    const touched = Array.isArray(task.actual_touches) && task.actual_touches.length
      ? task.actual_touches
      : (Array.isArray(task.touches) ? task.touches : []);
    for (const raw of new Set(touched.map(normalizeGitPath))) {
      if (shouldIgnorePath(raw, extraPatterns)) continue;
      const next = (taskCounts.get(raw) || 0) + 1;
      taskCounts.set(raw, next);
      if (next >= 2) shared.add(raw);
    }
  }

  // 2. Cold-start Git churn seed (last 100 commits, >= 5 touches)
  const logRes = gitIn(repoRoot, ['log', '-n', '100', '--name-only', '--pretty=format:']);
  if (logRes.ok) {
    const commitCounts = new Map();
    for (const rawLine of logRes.stdout.split(/\r?\n/)) {
      const file = normalizeGitPath(rawLine);
      if (!file || shouldIgnorePath(file, extraPatterns)) continue;
      const next = (commitCounts.get(file) || 0) + 1;
      commitCounts.set(file, next);
      if (next >= 5) shared.add(file);
    }
  }

  return shared;
}

/**
 * Review Window (Security / Triage Window):
 * ALWAYS anchored at keeper.last_reviewed_commit (+ reviewed worktree digest map).
 * NEVER reset by task focus, close, or splitting tasks.
 */
export function analyzeReviewWindow(repoRoot, keeperState = {}, tasks = [], { dirtyDesignDocs = [], thresholds = {} } = {}) {
  const maxFiles = Number.isFinite(thresholds.max_files) && thresholds.max_files > 0 ? thresholds.max_files : 8;
  const maxLines = Number.isFinite(thresholds.max_lines) && thresholds.max_lines > 0 ? thresholds.max_lines : 400;
  const maxDirs = Number.isFinite(thresholds.max_dirs) && thresholds.max_dirs > 0 ? thresholds.max_dirs : 3;
  const info = inspectGitRepo(repoRoot);
  if (!info.isGit) {
    return {
      git: false,
      head: null,
      anchor: keeperState.last_reviewed_commit || null,
      anchor_status: 'non_git',
      level: dirtyDesignDocs.length ? 'heavy' : 'light',
      reasons: dirtyDesignDocs.length ? [`design modified: ${dirtyDesignDocs.join(', ')}`] : [],
      files: [],
      lines_changed: 0,
      shared_hits: [],
      design_hits: dirtyDesignDocs,
      top_dirs: [],
    };
  }

  const extraPatterns = loadIgnorePatterns(info.topLevel);
  const sharedSurface = computeSharedSurface(info.topLevel, tasks, extraPatterns);
  const anchor = keeperState.last_reviewed_commit || null;
  const reviewedWorktree = keeperState.last_reviewed_worktree || {};
  const head = info.head;

  const dirtyFiles = getDirtyWorktreeFiles(info.topLevel, extraPatterns);
  const currentDirtyDigests = hashWorktreeFiles(info.topLevel, dirtyFiles);
  const unreviewedDirty = dirtyFiles.filter((file) => reviewedWorktree[file] !== currentDirtyDigests[file]);

  if (anchor && !isCommitReachable(info.topLevel, anchor)) {
    return {
      git: true,
      head,
      anchor,
      anchor_status: 'lost',
      level: 'heavy',
      reasons: [`review anchor lost (${anchor.slice(0, 7)} unreachable after history rewrite) — run skeinn keeper prompt --checkpoint`],
      files: unreviewedDirty,
      lines_changed: 0,
      shared_hits: unreviewedDirty.filter((f) => sharedSurface.has(f)),
      design_hits: dirtyDesignDocs,
      top_dirs: collectTopDirs(unreviewedDirty),
    };
  }

  const windowFileSet = new Set(unreviewedDirty);
  let linesChanged = 0;

  if (anchor && head && anchor !== head) {
    const committed = gitIn(info.topLevel, ['diff', '--numstat', `${anchor}..${head}`]);
    if (committed.ok) {
      const parsed = parseNumstat(committed.stdout, extraPatterns);
      for (const f of parsed.files) windowFileSet.add(f);
      linesChanged += parsed.linesChanged;
    }
  }

  if (head) {
    const wtDiff = gitIn(info.topLevel, ['diff', '--numstat', 'HEAD']);
    if (wtDiff.ok) {
      const parsed = parseNumstat(wtDiff.stdout, extraPatterns);
      for (const f of parsed.files) {
        if (unreviewedDirty.includes(f)) linesChanged += parsed.linesChanged;
      }
    }
  }

  // Count lines of new untracked unreviewed files
  for (const f of unreviewedDirty) {
    const tracked = gitIn(info.topLevel, ['ls-files', '--error-unmatch', f]);
    if (!tracked.ok) {
      const abs = join(info.topLevel, f);
      if (existsSync(abs)) {
        try {
          const text = readFileSync(abs, 'utf8');
          linesChanged += text ? text.split(/\r?\n/).length : 0;
        } catch {
          // ignore binary/unreadable
        }
      }
    }
  }

  const files = [...windowFileSet].sort();
  const sharedHits = files.filter((f) => sharedSurface.has(f));
  const topDirs = collectTopDirs(files);
  const reasons = [];

  if (files.includes('.skeinnignore')) reasons.push('review-shaping ignore config modified: .skeinnignore');
  if (files.includes('.skeinn-state')) reasons.push('review-shaping state pointer modified: .skeinn-state');
  if (files.length >= maxFiles) reasons.push(`review window touched ${files.length} files (>= ${maxFiles})`);
  if (linesChanged >= maxLines) reasons.push(`review window changed ${linesChanged} lines (>= ${maxLines})`);
  if (sharedHits.length) reasons.push(`shared surface touched: ${sharedHits.join(', ')}`);
  if (topDirs.length >= maxDirs) reasons.push(`cross-directory spread across ${topDirs.length} top-level areas (${topDirs.join(', ')})`);
  if (dirtyDesignDocs.length) reasons.push(`design surface modified: ${dirtyDesignDocs.join(', ')}`);

  return {
    git: true,
    head,
    anchor,
    anchor_status: anchor ? 'ok' : 'unanchored',
    level: reasons.length ? 'heavy' : 'light',
    reasons,
    files,
    lines_changed: linesChanged,
    shared_hits: sharedHits,
    design_hits: dirtyDesignDocs,
    top_dirs: topDirs,
  };
}

function collectTopDirs(files) {
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split('/');
    if (parts.length > 1 && parts[0] !== '.') dirs.add(parts[0]);
  }
  return [...dirs].sort();
}

export function getGitUserIdentity(repoRoot) {
  const nameRes = gitIn(repoRoot, ['config', '--get', 'user.name']);
  const emailRes = gitIn(repoRoot, ['config', '--get', 'user.email']);
  return {
    name: nameRes.ok ? nameRes.stdout.trim() : '',
    email: emailRes.ok ? emailRes.stdout.trim() : '',
  };
}

/**
 * Attribution Window (Per-Task Touch Recording):
 * Anchored at task.focused_at_commit (if focused) + working tree dirty files.
 * Explicitly approximate in single-lane sequential work; NEVER affects Review Window.
 */
export function deriveTaskActualTouches(repoRoot, task = {}) {
  const info = inspectGitRepo(repoRoot);
  if (!info.isGit) return { git: false, files: [] };

  const extraPatterns = loadIgnorePatterns(info.topLevel);
  const files = new Set(getDirtyWorktreeFiles(info.topLevel, extraPatterns));

  const focusCommit = task.focused_at_commit || null;
  if (focusCommit && info.head && focusCommit !== info.head && isCommitReachable(info.topLevel, focusCommit)) {
    const diffRes = gitIn(info.topLevel, ['diff', '--name-only', `${focusCommit}..${info.head}`]);
    if (diffRes.ok) {
      for (const raw of diffRes.stdout.split(/\r?\n/)) {
        const f = normalizeGitPath(raw);
        if (f && !shouldIgnorePath(f, extraPatterns)) files.add(f);
      }
    }
  } else if (!files.size && info.head) {
    // Direct close on a clean tree after committing: capture latest commit's files
    const latestRes = gitIn(info.topLevel, ['diff', '--name-only', `${info.head}~1..${info.head}`]);
    if (latestRes.ok) {
      for (const raw of latestRes.stdout.split(/\r?\n/)) {
        const f = normalizeGitPath(raw);
        if (f && !shouldIgnorePath(f, extraPatterns)) files.add(f);
      }
    }
  }

  return { git: true, files: [...files].sort() };
}

export function snapshotReviewAnchor(repoRoot) {
  const info = inspectGitRepo(repoRoot);
  if (!info.isGit) return { commit: null, worktree: {} };
  const extraPatterns = loadIgnorePatterns(info.topLevel);
  const dirty = getDirtyWorktreeFiles(info.topLevel, extraPatterns);
  return {
    commit: info.head,
    worktree: hashWorktreeFiles(info.topLevel, dirty),
  };
}
