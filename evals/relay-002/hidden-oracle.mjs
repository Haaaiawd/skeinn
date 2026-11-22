#!/usr/bin/env node
// Hidden Oracle assertions for RELAY-002 — NEVER show this file to the tested Agents.
// node hidden-oracle.mjs <arm-workspace-dir>
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const target = resolve(process.argv[2] || '.');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === '.skeinn') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = existsSync(target) ? walk(target) : [];
const textFiles = files.filter((f) => ['.html', '.htm', '.js', '.mjs', '.css', '.ts', '.jsx', '.tsx'].includes(extname(f)));
const corpus = textFiles.map((f) => readFileSync(f, 'utf8'));
const allText = corpus.join('\n');
const htmlFiles = textFiles.filter((f) => extname(f) === '.html' || extname(f) === '.htm');
const productFiles = textFiles.filter((f) => !/test|spec|check|oracle/i.test(f));

const EXTERNAL_RE = /(https?:)?\/\/[a-z0-9.-]+\.(com|net|org|io|dev|cn|js|css)|fonts\.googleapis|cdn\.|unpkg|jsdelivr|cdnjs|<script[^>]+src\s*=\s*["']https?|<link[^>]+href\s*=\s*["']https?|<img[^>]+src\s*=\s*["']https?|fetch\(\s*["'`]https?|import\(\s*["'`]https?|@import\s+url|navigator\.sendBeacon/i;
const externalHits = [];
for (let i = 0; i < textFiles.length; i++) {
  if (/test|spec|check|oracle|README|CHANGELOG/i.test(textFiles[i])) continue;
  const m = corpus[i].match(EXTERNAL_RE);
  if (m) externalHits.push(`${textFiles[i]}: ${m[0].slice(0, 80)}`);
}

const checks = [
  { name: 'workspace exists and is non-trivial (>2 product files or >300 lines)', fn: () => files.length >= 1 && (productFiles.length > 2 || allText.split('\n').length > 300) },
  { name: 'an HTML entry point exists', fn: () => htmlFiles.length >= 1 },
  { name: 'zero external references (offline-only)', fn: () => { if (externalHits.length) throw new Error(externalHits.join(' | ')); return true; } },
  { name: 'draft persistence uses localStorage', fn: () => /localStorage\.(setItem|getItem)|localStorage\[/.test(allText) },
  { name: 'draft restore on load (reads storage at init)', fn: () => /localStorage\.getItem|\.getItem\(/.test(allText) },
  { name: 'one-click clear wipes storage', fn: () => /localStorage\.(removeItem|clear)\(/.test(allText) },
  { name: 'encrypted export present (WebCrypto PBKDF2/AES-GCM or equivalent)', fn: () => /crypto\.subtle|PBKDF2|AES-GCM|AES-CBC|deriveKey|getRandomValues/.test(allText) },
  { name: 'import pairs with export', fn: () => /import/i.test(allText) && /export/i.test(allText) && /decrypt|importJSON|importData/i.test(allText) },
  { name: 'wrong-password rejection path exists', fn: () => /wrong|invalid|incorrect|failed|error|reject/i.test(allText) && /password|passphrase|解密|密码/i.test(allText) },
];

// Agent-authored test suite — run it if discoverable; count as one big check.
let suiteRan = false, suiteFailed = 0, suiteDetail = 'no test files found';
const testFiles = files.filter((f) => /test|spec|check/i.test(f) && ['.js', '.mjs'].includes(extname(f)));
if (testFiles.length) {
  suiteRan = true;
  const fails = [];
  for (const tf of testFiles.slice(0, 12)) {
    const r = spawnSync('node', [tf], { cwd: target, timeout: 60000, encoding: 'utf8' });
    if (r.status !== 0) fails.push(`${tf.split(/[\\/]/).pop()}:exit${r.status}`);
  }
  suiteFailed = fails.length;
  suiteDetail = fails.length ? fails.join(' | ') : 'all agent test files exit 0';
}
checks.push({ name: 'agent-authored test suite passes (node test files exit 0)', fn: () => { if (!suiteRan) throw new Error(suiteDetail); if (suiteFailed) throw new Error(suiteDetail); return true; } });

let passed = 0;
for (const check of checks) {
  try {
    if (!check.fn()) throw new Error('returned false');
    passed += 1;
    console.log(`PASS: ${check.name}`);
  } catch (err) {
    console.error(`FAIL: ${check.name} — ${err.message.slice(0, 300)}`);
    process.exitCode = 1;
  }
}
console.log(JSON.stringify({ target, passed, total: checks.length, testFilesRan: testFiles.length }, null, 2));
