'use strict';

const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const TASKS = 'import_tasks';
const NONCES = 'worker_nonces';
const ACTIVE_STATES = new Set(['claimed', 'mineru_processing', 'splitting', 'cancelling']);

// 状态流转白名单：禁止非法跳转。Worker 只能沿 claimed → mineru_processing → splitting
// 推进，并在任意活动态失败（failed）或终止（cancelled）。draft_ready / ai_reviewing /
// human_review / ready_to_publish / publishing 由后续阶段（管理台/发布门禁）驱动，不在此处。
const TRANSITIONS = {
  claimed: ['claimed', 'mineru_processing', 'splitting', 'failed', 'cancelled'],
  mineru_processing: ['mineru_processing', 'splitting', 'failed', 'cancelled'],
  splitting: ['splitting', 'draft_ready', 'failed', 'cancelled'],
  cancelling: ['cancelling', 'cancelled'],
};

function canTransition(from, to) {
  if (from === to) return true;
  const allowed = TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

class GatewayError extends Error {
  constructor(message, errorCode, statusCode, details) {
    super(message);
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function requestId(event = {}) {
  const headers = normalizeHeaders(event.headers);
  const supplied = headers['x-request-id'] || event.request_id;
  return supplied && /^[\w.-]{8,96}$/.test(supplied)
    ? supplied
    : `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeHeaders(headers) {
  return Object.entries(headers || {}).reduce((result, [key, value]) => {
    result[String(key).toLowerCase()] = String(value);
    return result;
  }, {});
}

function parseEvent(rawEvent = {}) {
  if (!rawEvent.body) return { event: rawEvent, rawBody: JSON.stringify(rawEvent) };
  if (typeof rawEvent.body === 'object') {
    return { event: { ...rawEvent, ...rawEvent.body }, rawBody: JSON.stringify(rawEvent.body) };
  }
  try {
    return { event: { ...rawEvent, ...JSON.parse(rawEvent.body) }, rawBody: rawEvent.body };
  } catch (error) {
    throw new GatewayError('请求体不是有效 JSON', 'INVALID_REQUEST', 400);
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signature(secret, timestamp, nonce, rawBody) {
  const bodyHash = digest(rawBody);
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n${bodyHash}`).digest('hex');
}

function text(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function percent(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function isHttpEvent(event) {
  return Boolean(event && (event.httpMethod || event.headers || event.requestContext || typeof event.body === 'string'));
}

function response(rawEvent, statusCode, body) {
  if (!isHttpEvent(rawEvent)) return body;
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function log(level, message, fields) {
  const record = JSON.stringify({ level, message, time: new Date().toISOString(), ...fields });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(record);
}

async function ensureCollections() {
  for (const collection of [TASKS, NONCES]) {
    try {
      await db.createCollection(collection);
    } catch (error) {
      if (!/already\s+exist|collection.*exist|DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS|Table\s+exist/i
        .test(String(error.message || error.errMsg || error.errCode || error))) throw error;
    }
  }
}

// 回收过期租约：Worker 崩溃/断网后不再心跳，lease_expires_at 已过期的活动态任务
// 需要被重置回 waiting，否则 claim 永远看不到它们。扫描范围覆盖所有活动态与 cancelling。
const RECOVERABLE = ['claimed', 'mineru_processing', 'splitting', 'cancelling'];
async function recoverExpiredLeases() {
  const now = new Date();
  try {
    const expired = await db.collection(TASKS)
      .where({
        status: db.command.in(RECOVERABLE),
        lease_expires_at: db.command.lte(now),
      })
      .limit(20)
      .get();
    let recovered = 0;
    for (const task of expired.data || []) {
      try {
        await db.collection(TASKS).doc(task._id).update({ data: {
          status: 'waiting',
          worker_id: null,
          lease_token: null,
          lease_expires_at: null,
          heartbeat_at: null,
          cancel_requested: false,
          progress: { stage: 'waiting', percent: 0, message: 'Worker 失联，租约已回收并重新进入等待队列' },
          task_version: Number(task.task_version || 0) + 1,
          updated_at: db.serverDate(),
        } });
        recovered += 1;
      } catch (err) {
        log('warn', 'lease.recover.failed', { task_id: task._id, error: err.message });
      }
    }
    return recovered;
  } catch (err) {
    log('error', 'lease.recover.error', { error: err.message });
    return 0;
  }
}

async function authenticate(rawEvent, event, rawBody) {
  const secret = process.env.WORKER_SECRET;
  if (!secret || secret.length < 24) {
    throw new GatewayError('Worker 网关尚未配置安全密钥', 'WORKER_CONFIG_INVALID', 503);
  }

  const headers = normalizeHeaders(rawEvent.headers);
  const workerId = text(headers['x-worker-id'] || event.worker_id, 100);
  if (!workerId) throw new GatewayError('缺少 worker_id', 'UNAUTHORIZED', 401);

  if (process.env.WORKER_ALLOW_PLAIN_SECRET === 'true' && event.worker_secret && safeEqual(event.worker_secret, secret)) {
    return { workerId, mode: 'plain_secret_dev' };
  }

  const timestamp = text(headers['x-timestamp'], 20);
  const nonce = text(headers['x-nonce'], 128);
  const provided = text(headers['x-signature'], 256).toLowerCase();
  if (!timestamp || !nonce || !provided) throw new GatewayError('缺少 Worker 签名', 'UNAUTHORIZED', 401);

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    throw new GatewayError('Worker 签名已过期', 'SIGNATURE_EXPIRED', 401);
  }
  const expected = signature(secret, timestamp, nonce, rawBody);
  if (!safeEqual(provided, expected)) throw new GatewayError('Worker 签名无效', 'UNAUTHORIZED', 401);

  const nonceId = `nonce_${digest(`${workerId}:${nonce}`)}`;
  try {
    await db.collection(NONCES).add({ data: {
      _id: nonceId,
      worker_id: workerId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      created_at: db.serverDate(),
    } });
  } catch (error) {
    throw new GatewayError('Worker 请求已被使用', 'SIGNATURE_REPLAYED', 409);
  }
  return { workerId, mode: 'hmac' };
}

async function getTask(taskId) {
  try {
    const result = await db.collection(TASKS).doc(taskId).get();
    if (result && result.data) return result.data;
  } catch (error) {
    if (!/not\s+exist|not\s+found|DATABASE_DOCUMENT_NOT_EXIST/i.test(String(error.message || error))) throw error;
  }
  throw new GatewayError(`导入任务不存在：${taskId}`, 'RESOURCE_NOT_FOUND', 404);
}

function assertLease(task, identity, event) {
  const leaseToken = text(event.lease_token, 200);
  if (!leaseToken || !safeEqual(task.lease_token, leaseToken) || task.worker_id !== identity.workerId) {
    throw new GatewayError('任务租约无效', 'LEASE_INVALID', 409);
  }
  if (task.lease_expires_at && new Date(task.lease_expires_at).getTime() < Date.now()) {
    throw new GatewayError('任务租约已过期', 'LEASE_EXPIRED', 409);
  }
}

function leaseSeconds() {
  const configured = Number(process.env.WORKER_LEASE_SECONDS || 300);
  return Number.isFinite(configured) ? Math.max(60, Math.min(1800, Math.round(configured))) : 300;
}

async function claim(identity) {
  // 先回收过期租约，让崩溃 Worker 的任务重新可被领取。
  await recoverExpiredLeases();
  const candidates = await db.collection(TASKS)
    .where({ status: 'waiting' })
    .orderBy('created_at', 'asc')
    .limit(1)
    .get();
  if (!candidates.data || !candidates.data.length) return { task: null };

  const candidateId = candidates.data[0]._id;
  const leaseToken = `lease_${crypto.randomBytes(16).toString('hex')}`;
  const expiresAt = new Date(Date.now() + leaseSeconds() * 1000);

  const claimed = await db.runTransaction(async transaction => {
    const result = await transaction.collection(TASKS).doc(candidateId).get();
    const current = result && result.data;
    if (!current || current.status !== 'waiting') return null;
    await transaction.collection(TASKS).doc(candidateId).update({ data: {
      status: 'claimed',
      worker_id: identity.workerId,
      lease_token: leaseToken,
      lease_expires_at: expiresAt,
      heartbeat_at: db.serverDate(),
      progress: { stage: 'claimed', percent: 0, message: `已由 ${identity.workerId} 领取` },
      task_version: Number(current.task_version || 0) + 1,
      updated_at: db.serverDate(),
    } });
    return { ...current, status: 'claimed' };
  });

  if (!claimed) throw new GatewayError('任务刚刚被其他 Worker 领取，请重试', 'TASK_ALREADY_CLAIMED', 409);
  return {
    task: {
      task_id: candidateId,
      mode: claimed.mode || 'pdf',
      paper_name: claimed.paper_name,
      paper_type: claimed.paper_type,
      question_pdf_file_id: claimed.question_pdf_file_id,
      answer_pdf_file_id: claimed.answer_pdf_file_id || null,
      question_pdf_name: claimed.question_pdf_name || null,
      answer_pdf_name: claimed.answer_pdf_name || null,
      question_pdf_size: claimed.question_pdf_size || null,
      answer_pdf_size: claimed.answer_pdf_size || null,
      question_pdf_sha256: claimed.question_pdf_sha256 || null,
      answer_pdf_sha256: claimed.answer_pdf_sha256 || null,
      source_draft_id: claimed.source_draft_id || null,
      source_markdown_file_id: claimed.source_markdown_file_id || null,
      source_answer_markdown_file_id: claimed.source_answer_markdown_file_id || null,
      lease_token: leaseToken,
      lease_expires_at: expiresAt,
    },
  };
}

async function heartbeat(identity, event) {
  const taskId = text(event.task_id, 100);
  if (!taskId) throw new GatewayError('缺少 task_id', 'INVALID_REQUEST', 400);
  const task = await getTask(taskId);
  assertLease(task, identity, event);
  if (!ACTIVE_STATES.has(task.status)) throw new GatewayError(`任务状态 ${task.status} 不接受心跳`, 'TASK_STATE_CONFLICT', 409);

  const stage = text(event.stage, 50) || task.status;
  const nextStatus = task.status === 'cancelling'
    ? 'cancelling'
    : (['mineru_processing', 'splitting'].includes(stage) ? stage : task.status);
  // 禁止非法状态跳转（如 splitting 直接跳 draft_ready，或回退 mineru_processing）。
  if (nextStatus !== task.status && !canTransition(task.status, nextStatus)) {
    throw new GatewayError(`非法状态跳转：${task.status} → ${nextStatus}`, 'TASK_STATE_CONFLICT', 409);
  }
  const expiresAt = new Date(Date.now() + leaseSeconds() * 1000);
  await db.collection(TASKS).doc(taskId).update({ data: {
    status: nextStatus,
    progress: {
      stage,
      percent: percent(event.percent, task.progress && task.progress.percent),
      message: text(event.message, 500),
      processed_pages: Number(event.processed_pages || 0),
      total_pages: Number(event.total_pages || 0),
    },
    lease_expires_at: expiresAt,
    heartbeat_at: db.serverDate(),
    updated_at: db.serverDate(),
  } });
  return { task_id: taskId, status: nextStatus, lease_expires_at: expiresAt, cancel_requested: Boolean(task.cancel_requested) };
}

async function complete(identity, event) {
  const taskId = text(event.task_id, 100);
  if (!taskId) throw new GatewayError('缺少 task_id', 'INVALID_REQUEST', 400);
  const task = await getTask(taskId);
  assertLease(task, identity, event);
  if (!ACTIVE_STATES.has(task.status)) throw new GatewayError(`任务状态 ${task.status} 不能完成`, 'TASK_STATE_CONFLICT', 409);
  if (!canTransition(task.status, 'draft_ready')) throw new GatewayError(`非法状态跳转：${task.status} → draft_ready`, 'TASK_STATE_CONFLICT', 409);

  const result = event.result && typeof event.result === 'object' ? event.result : {};
  const safeArtifacts = Array.isArray(result.artifacts)
    ? result.artifacts.slice(0, 200).map(item => ({
      type: text(item && item.type, 50),
      name: text(item && item.name, 200),
      file_id: text(item && item.file_id, 4096),
      sha256: text(item && item.sha256, 128),
    }))
    : [];
  const safeResult = {
    draft_paper_id: text(result.draft_paper_id, 100) || null,
    question_count: Math.max(0, Number(result.question_count || 0)),
    answer_count: Math.max(0, Number(result.answer_count || 0)),
    analysis_count: Math.max(0, Number(result.analysis_count || 0)),
    asset_bundle_id: text(result.asset_bundle_id, 100) || null,
    artifacts: safeArtifacts,
  };
  await db.collection(TASKS).doc(taskId).update({ data: {
    status: 'draft_ready',
    progress: { stage: 'draft_ready', percent: 100, message: 'MinerU 识别和切题已完成' },
    result: safeResult,
    lease_token: null,
    lease_expires_at: null,
    completed_at: db.serverDate(),
    updated_at: db.serverDate(),
  } });
  return { task_id: taskId, status: 'draft_ready', result: safeResult };
}

async function fail(identity, event) {
  const taskId = text(event.task_id, 100);
  if (!taskId) throw new GatewayError('缺少 task_id', 'INVALID_REQUEST', 400);
  const task = await getTask(taskId);
  assertLease(task, identity, event);
  if (!canTransition(task.status, 'failed')) throw new GatewayError(`非法状态跳转：${task.status} → failed`, 'TASK_STATE_CONFLICT', 409);
  const error = event.error && typeof event.error === 'object' ? event.error : {};
  const safeError = {
    stage: text(error.stage || event.stage, 50) || task.status,
    code: text(error.code, 100) || 'WORKER_FAILED',
    message: text(error.message || event.message, 1000) || '本机 MinerU 处理失败',
    retryable: error.retryable !== false,
  };
  await db.collection(TASKS).doc(taskId).update({ data: {
    status: 'failed',
    progress: { stage: 'failed', percent: percent(task.progress && task.progress.percent), message: safeError.message },
    error: safeError,
    lease_token: null,
    lease_expires_at: null,
    failed_at: db.serverDate(),
    updated_at: db.serverDate(),
  } });
  return { task_id: taskId, status: 'failed', error: safeError };
}

async function workerCancel(identity, event) {
  const taskId = text(event.task_id, 100);
  if (!taskId) throw new GatewayError('缺少 task_id', 'INVALID_REQUEST', 400);
  const task = await getTask(taskId);
  assertLease(task, identity, event);
  if (!ACTIVE_STATES.has(task.status) && task.status !== 'cancelling') {
    throw new GatewayError(`任务状态 ${task.status} 不能取消`, 'TASK_STATE_CONFLICT', 409);
  }
  if (!canTransition(task.status, 'cancelled')) throw new GatewayError(`非法状态跳转：${task.status} → cancelled`, 'TASK_STATE_CONFLICT', 409);
  await db.collection(TASKS).doc(taskId).update({ data: {
    status: 'cancelled',
    cancel_requested: false,
    progress: { stage: 'cancelled', percent: percent(task.progress && task.progress.percent), message: 'Worker 已终止处理并取消任务' },
    lease_token: null,
    lease_expires_at: null,
    cancelled_at: db.serverDate(),
    updated_at: db.serverDate(),
  } });
  return { task_id: taskId, status: 'cancelled' };
}

// Worker 通过签名鉴权上报阶段日志（source 固定为 worker，禁止伪造为 admin）。
const WORKER_LOG_CAP = 200;
async function workerLog(identity, event) {
  const taskId = text(event.task_id, 100);
  if (!taskId) throw new GatewayError('缺少 task_id', 'INVALID_REQUEST', 400);
  const task = await getTask(taskId);
  assertLease(task, identity, event);
  const level = /^(info|warn|error|debug)$/.test(String(event.level)) ? event.level : 'info';
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    stage: text(event.stage, 50) || task.status,
    source: 'worker',
    worker_id: identity.workerId,
    message: text(event.message, 2000),
    request_id: text(event.request_id, 96) || undefined,
    details: event.details && typeof event.details === 'object' ? event.details : undefined,
  };
  const tail = Array.isArray(task.logs_tail) ? task.logs_tail.slice(-(WORKER_LOG_CAP - 1)) : [];
  tail.push(entry);
  await db.collection(TASKS).doc(taskId).update({ data: { logs_tail: tail, updated_at: db.serverDate() } });
  return { task_id: taskId, log: entry };
}

exports.main = async (rawEvent = {}) => {
  const reqId = requestId(rawEvent);
  const startedAt = Date.now();
  try {
    const { event, rawBody } = parseEvent(rawEvent);
    if (event.action === 'health') {
      return response(rawEvent, 200, { code: 0, message: 'ok', data: { status: 'ok' }, request_id: reqId });
    }
    await ensureCollections();
    const identity = await authenticate(rawEvent, event, rawBody);
    let data;
    switch (event.action) {
      case 'claim': data = await claim(identity, event); break;
      case 'heartbeat': data = await heartbeat(identity, event); break;
      case 'complete': data = await complete(identity, event); break;
      case 'fail': data = await fail(identity, event); break;
      case 'cancel': data = await workerCancel(identity, event); break;
      case 'log': data = await workerLog(identity, event); break;
      default: throw new GatewayError(`未知 action：${event.action || ''}`, 'INVALID_REQUEST', 400);
    }
    log('info', 'worker.request', {
      request_id: reqId,
      action: event.action,
      worker_id: identity.workerId,
      duration_ms: Date.now() - startedAt,
    });
    return response(rawEvent, 200, { code: 0, message: 'ok', data, request_id: reqId });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    log('error', 'worker.error', {
      request_id: reqId,
      error_code: error.errorCode || 'INTERNAL_ERROR',
      status_code: statusCode,
      duration_ms: Date.now() - startedAt,
      error_message: error.message,
    });
    return response(rawEvent, statusCode, {
      code: statusCode,
      error_code: error.errorCode || 'INTERNAL_ERROR',
      message: statusCode >= 500 && !error.errorCode ? '服务内部错误' : error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
      request_id: reqId,
    });
  }
};

module.exports._test = { signature, safeEqual, parseEvent, percent };
