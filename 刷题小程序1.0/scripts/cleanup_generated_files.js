const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const keepArg = process.argv.find(arg => arg.startsWith('--keep-ocr='));
const KEEP_OCR_JOBS = Math.max(2, Number(keepArg?.split('=')[1]) || 4);

function assertInsideProject(target) {
  const resolved = path.resolve(target);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean outside project: ${resolved}`);
  }
  return resolved;
}

function directoryBytes(root) {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(fullPath);
      else {
        try { total += fs.statSync(fullPath).size; } catch (_) { /* file changed during scan */ }
      }
    }
  }
  return total;
}

function removeDirectory(target, label, report) {
  const resolved = assertInsideProject(target);
  if (!fs.existsSync(resolved)) return;
  const bytes = directoryBytes(resolved);
  if (!DRY_RUN) {
    if (process.platform === 'win32') {
      const escaped = resolved.replace(/'/g, "''");
      const result = spawnSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference='Stop'; Remove-Item -LiteralPath '${escaped}' -Recurse -Force`,
      ], { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `Failed to remove ${resolved}`);
      }
    } else {
      fs.rmSync(resolved, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 150,
      });
    }
  }
  report.push({ label, path: path.relative(PROJECT_ROOT, resolved), bytes });
}

function readStatus(jobDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(jobDir, 'status.json'), 'utf8'));
  } catch (_) {
    return {};
  }
}

function cleanupOcrJobs(report) {
  const root = assertInsideProject(path.join(PROJECT_ROOT, 'admin-output', 'ocr-jobs'));
  if (!fs.existsSync(root)) return;

  const jobs = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^ocr_[a-zA-Z0-9_-]+$/.test(entry.name))
    .map(entry => {
      const fullPath = path.join(root, entry.name);
      const status = readStatus(fullPath);
      return {
        name: entry.name,
        fullPath,
        modified: fs.statSync(fullPath).mtimeMs,
        active: ['running', 'queued', 'processing'].includes(String(status.status || '').toLowerCase()),
      };
    })
    .sort((a, b) => b.modified - a.modified);

  const protectedNames = new Set([
    ...jobs.filter(job => job.active).map(job => job.name),
    ...jobs.slice(0, KEEP_OCR_JOBS).map(job => job.name),
  ]);

  for (const job of jobs) {
    if (!protectedNames.has(job.name)) {
      removeDirectory(job.fullPath, `Historical OCR job ${job.name}`, report);
    }
  }
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function main() {
  const report = [];
  cleanupOcrJobs(report);
  removeDirectory(path.join(PROJECT_ROOT, 'output'), 'MinerU temporary output', report);
  removeDirectory(path.join(PROJECT_ROOT, '.swc'), 'SWC cache', report);
  removeDirectory(path.join(PROJECT_ROOT, '.tmp'), 'Local temporary cache', report);
  removeDirectory(path.join(PROJECT_ROOT, 'admin', 'sdk-bundle', 'node_modules'), 'SDK build dependencies', report);

  const total = report.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`${DRY_RUN ? 'Would reclaim' : 'Reclaimed'}: ${formatBytes(total)}`);
  console.log(`Kept latest ${KEEP_OCR_JOBS} OCR jobs; active jobs are always kept.`);
  for (const item of report) {
    console.log(`- ${item.label}: ${formatBytes(item.bytes)} (${item.path})`);
  }
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}
