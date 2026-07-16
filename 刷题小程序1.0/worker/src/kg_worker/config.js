'use strict';

// Worker 运行配置（全部来自环境变量，便于容器/本地部署）。
// 读取顺序：进程环境变量 > .env（若使用 dotenv）。这里不直接依赖 dotenv，
// 调用方可自行在启动前 source .env，或在部署平台注入环境变量。

const os = require('os');
const path = require('path');
const fs = require('fs');

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function resolveDir(name, fallback) {
  const value = env(name);
  if (value) return path.resolve(value);
  return path.resolve(__dirname, '..', '..', fallback);
}

const WORKER_ROOT = path.resolve(__dirname, '..', '..');

const config = {
  // 身份
  workerId: env('WORKER_ID', `worker-${os.hostname()}-${process.pid}`),
  workerSecret: env('WORKER_SECRET', ''),
  adminSecret: env('ADMIN_SECRET', ''),

  // 云函数端点
  gatewayUrl: env('WORKER_GATEWAY_URL', env('GATEWAY_URL', '')).replace(/\/+$/, ''),
  adminUrl: env('ADMIN_URL', env('WORKER_ADMIN_URL', '')).replace(/\/+$/, ''),

  // 节奏（毫秒）
  pollIntervalMs: Number(env('WORKER_POLL_INTERVAL_MS', '5000')),
  heartbeatIntervalMs: Number(env('WORKER_HEARTBEAT_INTERVAL_MS', '15000')),
  leaseBufferMs: Number(env('WORKER_LEASE_BUFFER_MS', '30000')),
  claimTimeoutMs: Number(env('WORKER_CLAIM_TIMEOUT_MS', '20000')),
  mineruStageIntervalMs: Number(env('WORKER_MINERU_POLL_MS', '4000')),

  // 并发：单 GPU 固定为 1
  concurrency: Math.max(1, Math.min(1, Number(env('WORKER_CONCURRENCY', '1')))),
  singleProcessLock: env('WORKER_SINGLE_PROCESS_LOCK', 'true') !== 'false',

  // 工作目录（每个任务独立子目录，仅由 task_id 派生）
  taskRoot: resolveDir('WORKER_TASK_DIR', path.join('run', 'tasks')),
  lockFile: resolveDir('WORKER_LOCK_FILE', path.join('run', 'worker.lock')),

  // MinerU / Python
  python: env('PYTHON', ''),
  mineruCommand: env('MINERU_COMMAND', 'mineru'),
  mineruPython: env('MINERU_PYTHON', ''),
  mineruBackend: env('MINERU_BACKEND', 'pipeline'),
  scriptsDir: resolveDir('WORKER_SCRIPTS_DIR', path.join(WORKER_ROOT, '..', 'scripts')),
  projectRoot: resolveDir('WORKER_PROJECT_ROOT', path.join(WORKER_ROOT, '..')),

  // 存储后端：tcb（腾讯云 CloudBase node-sdk）或 local（离线镜像，便于测试）
  storageBackend: env('WORKER_STORAGE_BACKEND', 'tcb'),
  cloudMirrorDir: resolveDir('CLOUD_MIRROR_DIR', path.join('run', 'cloud-mirror')),

  // TCB 凭证（tcb 后端使用）
  tcbEnv: env('TCB_ENV_ID', env('TCB_ENV', '')),
  tcbSecretId: env('TCB_SECRET_ID', ''),
  tcbSecretKey: env('TCB_SECRET_KEY', ''),
  tcbEnvType: env('TCB_ENV_TYPE', 'non-shared'),

  // 调试
  dryRun: env('WORKER_DRY_RUN', 'false') === 'true',
};

config.requireStorageUpload = config.storageBackend === 'tcb';

function validate() {
  const errors = [];
  if (!config.workerSecret) errors.push('WORKER_SECRET 未配置（与 workerGateway 云函数环境变量一致）');
  if (!config.adminSecret) errors.push('ADMIN_SECRET 未配置（与管理 admin 云函数 ADMIN_SECRET 一致）');
  if (!config.gatewayUrl) errors.push('WORKER_GATEWAY_URL 未配置');
  if (!config.adminUrl) errors.push('ADMIN_URL 未配置');
  if (!fs.existsSync(config.scriptsDir)) errors.push(`scripts 目录不存在：${config.scriptsDir}`);
  if (config.storageBackend === 'tcb' && (!config.tcbEnv || !config.tcbSecretId || !config.tcbSecretKey)) {
    errors.push('存储后端为 tcb，但缺少 TCB_ENV_ID / TCB_SECRET_ID / TCB_SECRET_KEY');
  }
  return errors;
}

module.exports = { config, validate, env };
