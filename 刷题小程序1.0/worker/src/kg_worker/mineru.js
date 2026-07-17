'use strict';

// MinerU 运行器。复用管理台 local-server.js 的探测与调用方式，但：
//  - 进程以 detached 方式启动，便于在收到取消请求时整树终止；
//  - 暴露 cancel() 终止整个子进程树并以前端能识别的 CancelledError 结束。
// 取消闭环：管理台置 cancel_requested → Worker 心跳读到 → 调用 controller.cancel()
// → 终止 MinerU 进程树 → 回调 workerGateway.cancel。

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { config } = require('./config');

class CancelledError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CancelledError';
  }
}

function commandAvailable(command) {
  if (!command) return false;
  if (path.isAbsolute(command) && fs.existsSync(command)) return true;
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { windowsHide: true, encoding: 'utf8', timeout: 3000 });
    return r.status === 0 && Boolean(String(r.stdout || '').trim());
  } catch (_) {
    return false;
  }
}

function findPython() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const localCandidates = process.platform === 'win32'
    ? [
        path.join(home, 'miniconda3', 'envs', 'mineru', 'python.exe'),
        path.join(home, 'anaconda3', 'envs', 'mineru', 'python.exe'),
        path.join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
        'py',
        'python',
        'python3',
      ]
    : ['python3', 'python'];
  const candidates = [config.python, config.mineruPython, ...localCandidates].filter(Boolean);
  for (const c of candidates) {
    if (path.isAbsolute(c) ? fs.existsSync(c) : commandAvailable(c)) return c;
  }
  throw new Error('未找到可用 Python。请在 worker/.env 配置 PYTHON，或安装 python3/python/py。');
}

function detectMinerU() {
  if (config.mineruPython && fs.existsSync(config.mineruPython)) {
    return { ok: true, runner: config.mineruPython, mode: 'python-module' };
  }
  if (commandAvailable(config.mineruCommand)) {
    return { ok: true, runner: config.mineruCommand, mode: 'command' };
  }
  const home = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\hao';
  const candidates = [
    path.join(home, 'miniconda3', 'envs', 'mineru', 'python.exe'),
    path.join(home, 'miniconda3', 'envs', 'mineru', 'Scripts', 'mineru.exe'),
    path.join(home, 'anaconda3', 'envs', 'mineru', 'python.exe'),
    path.join(home, 'anaconda3', 'envs', 'mineru', 'Scripts', 'mineru.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const isPython = /\\python\.exe$/i.test(c);
      return { ok: true, runner: c, mode: isPython ? 'python-module' : 'command' };
    }
  }
  return { ok: false, reason: '未找到 MinerU。请在安装 MinerU 的终端执行 mineru --help，或设置 MINERU_COMMAND / MINERU_PYTHON。' };
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
    } catch (_) { /* best-effort */ }
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (_) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* ignore */ } }
  }
}

function buildMinerUProcessEnv(baseEnv = process.env) {
  const childEnv = { ...baseEnv, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  for (const [name, value] of Object.entries(childEnv)) {
    if (/proxy$/i.test(name) && /^socks(?:4|5)?h?:\/\//i.test(String(value || '').trim())) {
      delete childEnv[name];
    }
  }
  return childEnv;
}

// 启动 MinerU，返回 { child, promise, cancel }。
function runMinerU({ inputPdf, outputDir, onProgress }) {
  const env = detectMinerU();
  if (!env.ok) throw new Error(env.reason);

  let runner = env.runner;
  let args;
  if (env.mode === 'python-module') {
    args = ['-m', 'mineru.cli.client', '-p', inputPdf, '-o', outputDir, '-b', config.mineruBackend];
  } else {
    args = ['-p', inputPdf, '-o', outputDir, '-b', config.mineruBackend];
  }

  const child = spawn(runner, args, {
    cwd: config.projectRoot,
    windowsHide: true,
    detached: process.platform !== 'win32',
    env: buildMinerUProcessEnv(),
  });

  let stdout = '';
  let stderr = '';
  let killed = false;
  let settled = false;
  let resolveFn;
  let rejectFn;

  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    fn(value);
  };

  child.on('error', (err) => finish(rejectFn, err));
  child.on('exit', (code, signal) => {
    if (settled) return;
    if (killed) return finish(rejectFn, new CancelledError('MinerU 已被取消'));
    if (code === 0) return finish(resolveFn, { code });
    finish(rejectFn, new Error(`MinerU 异常退出（code=${code}, signal=${signal}）\n${stdout.slice(-1500)}\n${stderr.slice(-1500)}`));
  });

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const matches = stdout.match(/(\d{1,3})\s*%/g) || [];
      const last = matches.length ? Number(matches[matches.length - 1].replace(/\D/g, '')) : null;
      if (last != null && typeof onProgress === 'function') onProgress(Math.min(99, last), 'mineru_processing');
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => { stderr += chunk; });
  }

  const controller = {
    child,
    promise,
    cancel() {
      if (settled) return;
      killed = true;
      killProcessTree(child.pid);
      // 兜底：若进程树未能及时退出，1.5s 后强制以取消结束。
      setTimeout(() => finish(rejectFn, new CancelledError('MinerU 已被取消')), 1500);
    },
  };
  return controller;
}

module.exports = { findPython, detectMinerU, runMinerU, buildMinerUProcessEnv, CancelledError };
