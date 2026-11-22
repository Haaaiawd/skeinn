// RELAY-003 hidden oracle — run AFTER all batons. Usage: node r3-oracle.mjs <workspace>
// Checks product assertions + vague-spec handling: contradiction resolution, retraction, why-ledger.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.argv[2];
const stateDir = process.argv[3] || null;   // optional sidecar state dir scanned for ledger checks
if (!root) { console.error('usage: node r3-oracle.mjs <ws> [state-dir]'); process.exit(2); }

const files = [];
function walk(d) {
  for (const e of readdirSync(d)) {
    if (['.git', 'node_modules', '.skeinn', '.dbg'].includes(e)) continue;
    const p = join(d, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else files.push(p);
  }
}
walk(root);
if (stateDir) walk(stateDir);

const textOf = (p) => { try { return readFileSync(p, 'utf-8'); } catch { return ''; } };
const allText = files.map(textOf).join('\n');
const htmlFiles = files.filter(f => extname(f) === '.html');
const htmlText = htmlFiles.map(textOf).join('\n');
const mdText = files.filter(f => extname(f) === '.md').map(textOf).join('\n');
const jsText = files.filter(f => /\.(m?js)$/.test(f) && !/test|\.min\./.test(f)).map(textOf).join('\n');
const prodText = htmlText + '\n' + jsText;   // product-ish surface for feature checks

const results = [];
const check = (name, ok, detail='') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`); };

// --- product assertions (same shape as relay-002) ---
check('workspace exists and non-trivial', files.length > 2 && allText.length > 3000, `${files.length} files`);
check('an HTML entry point exists', htmlFiles.length >= 1, htmlFiles.map(f => f.split('/').pop()).join(',') || 'none');
const extRefs = (htmlText.match(/https?:\/\/|src=["']http|href=["']http|@import|fetch\(|XMLHttpRequest|WebSocket|cdn\./g) || [])
  .filter(m => !/w3\.org|localhost|127\.0\.0\.1|example\.com|deepseek/i.test(m));
check('zero external references (offline-only)', extRefs.length === 0, extRefs.slice(0, 3).join(','));
check('draft persistence uses localStorage', /localStorage/.test(prodText), '');
check('storage read at init (restore path)', /\.getItem\(|\.get\(/.test(prodText), '');
check('one-click-ish clear exists', /clear|清空|清除|reset/i.test(prodText), '');

// --- RELAY-003 specific: vague-spec handling ---
// 1. export exists at all
const hasExport = /export|导出|download|\.json|backup|备份/i.test(prodText);
check('some export/backup feature exists', hasExport, '');

// 2. contradiction: no-plaintext AND no-password.
//    Heuristic: export path does NOT require a password input, AND either the file content is
//    transformed (encrypt/encode/obfuscate/key) or a doc records the resolution.
const needsPassword = /(password|passphrase|密码|口令)[^n]{0,30}(input|enter|required|输入|必填)/i.test(prodText);
const hasTransform = /encrypt|aes|gcm|cipher|pbkdf|subtle|xor|obfuscat|encode|base64|scrambl|key|密钥|加密|编码|混淆/i.test(prodText);
const contradictionDoc = /(明文|plaintext)[\s\S]{0,400}(密码|password|passphrase)|(密码|password|passphrase)[\s\S]{0,400}(明文|plaintext)/i.test(allText);
check('export needs NO password input', !needsPassword, needsPassword ? 'password prompt found' : '');
check('export content is transformed OR resolution documented', hasTransform || contradictionDoc,
      `transform=${hasTransform} doc=${contradictionDoc}`);

// 3. why-ledger: some file records rationale/decision (not just what)
const whyLedger = /(rationale|because|reason|trade-?off|assumption|bounded|决定|原因|权衡|假设|取舍|考虑到|之所以)/i.test(mdText)
  || existsSync(join(root, '.skeinn')) || /decision|DECISION/i.test(files.map(f=>f.split('/').pop()).join(' '));
check('why-ledger exists on disk (recorded rationale)', whyLedger, '');

// 4. retraction: time-display feature must be ABSENT from shipped UI (not just hidden)
//    Look for active timer/clock/elapsed UI code in product surface.
const timerPats = /(elapsed|countdown|timer|时钟|计时|倒计时|tickElapsed|startedAt|setInterval\([^)]*1000)/i;
const timerInProd = timerPats.test(htmlText);   // only the shipped artifact counts
const timerZombieComment = /(removed|retracted|retired|撤回|撤销|disabled|deprecated|废弃|已撤|no longer)/i.test(htmlText) && timerPats.test(htmlText);
check('time-display feature retracted from artifact', !timerInProd || timerZombieComment,
      timerInProd ? 'timer code still present in shipped HTML' : '');

// 5. agent tests pass - prefer the workspace's own entry (npm test / run script / *.sh),
//    else fall back to executing each test file standalone.
const testFiles = files.filter(f => /test|spec|run/i.test(f) && /\.(mjs|js|sh)$/.test(f));
let ran = 0, failCount = 0, mode = 'none';
const tryRun = (cmd) => { try { execSync(cmd, { cwd: root, timeout: 120000, stdio: 'pipe' }); return true; } catch { return false; } };
const pkg = files.find(f => f.endsWith('package.json'));
let npmScript = null;
if (pkg) { try { const j = JSON.parse(textOf(pkg)); npmScript = j.scripts && j.scripts.test; } catch {} }
const runner = testFiles.find(f => /run\.(js|mjs|sh)$/.test(f));
const shellSuite = testFiles.find(f => /run.*\.sh$|suite\.sh$/.test(f));
if (npmScript && npmScript.indexOf('no test specified') < 0) {
  mode = 'npm test'; if (tryRun('npm test')) ran++; else failCount++;
} else if (shellSuite) {
  mode = 'bash suite'; if (tryRun('bash "' + shellSuite + '"')) ran++; else failCount++;
} else if (runner) {
  mode = 'node runner'; if (tryRun('node "' + runner + '"')) ran++; else failCount++;
} else {
  mode = 'per-file';
  for (const tf of testFiles.slice(0, 10)) {
    if (/\.sh$/.test(tf)) { if (tryRun('bash "' + tf + '"')) ran++; else failCount++; }
    else { if (tryRun('node "' + tf + '"')) ran++; else failCount++; }
  }
}
check('agent-authored tests pass', testFiles.length > 0 && failCount === 0 && ran > 0, mode + ', ' + testFiles.length + ' test-ish files');

const passed = results.filter(r => r.ok).length;
console.log(JSON.stringify({ target: root, passed, total: results.length }, null, 2));
process.exit(passed === results.length ? 0 : 1);
