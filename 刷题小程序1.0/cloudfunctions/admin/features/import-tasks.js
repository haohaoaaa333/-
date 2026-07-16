'use strict';

const crypto = require('crypto');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
} = require('../lib/errors');

const COLLECTION = 'import_tasks';
const command = db.command;
const ACTIVE_STATES = new Set([
  'waiting',
  'claimed',
  'mineru_processing',
  'splitting',
  'draft_ready',
  'ai_reviewing',
  'human_review',
  'ready_to_publish',
  'publishing',
  'cancelling',
]);
// 正在由 Worker 领取并执行（MinerU 运行中）的阶段：取消时走“请求取消 + Worker 终止”闭环。
const PROCESSING_STATES = ['claimed', 'mineru_processing', 'splitting'];
const CANCELLABLE_STATES = new Set([
  'waiting',
  'failed',
  'draft_ready',
  'ai_reviewing',
  'human_review',
  'ready_to_publish',
]);
// 任务日志环形缓冲上限
const LOG_CAP = 200;

function text(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function positiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function fileId(value) {
  const normalized = text(value, 2048);
  return /^(?:cloud:\/\/|https:\/\/)/i.test(normalized) ? normalized : '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function isoNow() {
  return new Date().toISOString();
}

function makeLog(level, stage, source, message, extra = {}) {
  return {
    timestamp: isoNow(),
    level: /^(info|warn|error|debug)$/.test(level) ? level : 'info',
    stage: String(stage || ''),
    source: String(source || 'system'),
    message: String(message || ''),
    request_id: extra.request_id ? String(extra.request_id) : undefined,
    details: extra.details || undefined,
  };
}

function isAlreadyExists(error) {
  return /already\s+exist|collection.*exist|DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS|Table\s+exist/i
    .test(String(error && (error.message || error.errMsg || error.errCode) || error || ''));
}

module.exports = function createImportTasksFeature({ db, ok }) {
  async function ensureCollection() {
    try {
      await db.createCollection(COLLECTION);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }

  async function findTask(taskId) {
    try {
      const result = await db.collection(COLLECTION).doc(taskId).get();
      if (result && result.data) return result.data;
    } catch (error) {
      if (!/not\s+exist|not\s+found|DATABASE_DOCUMENT_NOT_EXIST/i.test(String(error.message || error))) throw error;
    }
    throw new NotFoundError('导入任务', taskId);
  }

  async function createTask(event) {
    await ensureCollection();
    const input = event.data && typeof event.data === 'object' ? event.data : event;
    const paperName = text(input.paper_name, 200);
    const questionPdfFileId = fileId(input.question_pdf_file_id || input.pdf_file_id);
    const answerPdfFileId = fileId(input.answer_pdf_file_id);
    const questionHash = text(input.question_pdf_sha256 || input.pdf_hash, 128).toLowerCase();
    const answerHash = text(input.answer_pdf_sha256, 128).toLowerCase();

    const errors = [];
    if (!paperName) errors.push({ path: 'paper_name', message: '试卷名称不能为空' });
    if (!questionPdfFileId) errors.push({ path: 'question_pdf_file_id', message: '题目 PDF 必须先上传云存储' });
    if (questionHash && !/^[a-f0-9]{64}$/.test(questionHash)) {
      errors.push({ path: 'question_pdf_sha256', message: 'SHA-256 必须是 64 位十六进制字符串' });
    }
    if (answerHash && !/^[a-f0-9]{64}$/.test(answerHash)) {
      errors.push({ path: 'answer_pdf_sha256', message: 'SHA-256 必须是 64 位十六进制字符串' });
    }
    if (errors.length) throw new ValidationError('导入任务参数不完整', errors);

    const dedupeKey = sha256([
      questionHash || questionPdfFileId,
      answerHash || answerPdfFileId || 'missing-answer-pdf',
      text(input.paper_type, 50) || 'xingce',
    ].join('|'));

    const duplicate = await db.collection(COLLECTION).where({ dedupe_key: dedupeKey }).limit(1).get();
    if (duplicate && duplicate.data && duplicate.data.length) {
      const existing = duplicate.data[0];
      if (ACTIVE_STATES.has(existing.status) || existing.status === 'published') {
        return ok({ task: existing, deduplicated: true }, '相同 PDF 已存在导入任务');
      }
    }

    const taskId = randomId('imp');
    const document = {
      _id: taskId,
      schema_version: '2.0',
      source: 'pdf_pair',
      paper_name: paperName,
      paper_type: text(input.paper_type, 50) || 'xingce',
      question_pdf_file_id: questionPdfFileId,
      answer_pdf_file_id: answerPdfFileId || null,
      question_pdf_sha256: questionHash || null,
      answer_pdf_sha256: answerHash || null,
      dedupe_key: dedupeKey,
      status: 'waiting',
      progress: { stage: 'waiting', percent: 0, message: '等待本机 MinerU 领取' },
      worker_id: null,
      lease_token: null,
      lease_expires_at: null,
      heartbeat_at: null,
      retry_count: 0,
      task_version: 1,
      cancel_requested: false,
      cancel_requested_at: null,
      logs_tail: [makeLog('info', 'waiting', 'admin', '导入任务已创建')],
      error: null,
      created_by: event.__identity && event.__identity.openid || null,
      created_at: db.serverDate(),
      updated_at: db.serverDate(),
    };
    await db.collection(COLLECTION).add({ data: document });
    return ok({ task_id: taskId, status: 'waiting', deduplicated: false }, '导入任务已创建');
  }

  async function listTasks(event) {
    await ensureCollection();
    const input = event.data && typeof event.data === 'object' ? event.data : event;
    const page = positiveInt(input.page, 1, 100000);
    const pageSize = positiveInt(input.page_size, 20, 100);
    const status = text(input.status, 40);
    const where = status ? { status } : {};
    const collection = db.collection(COLLECTION).where(where);
    const [listResult, countResult] = await Promise.all([
      collection.orderBy('updated_at', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
      collection.count(),
    ]);
    return ok({
      list: listResult.data || [],
      total: countResult.total || 0,
      page,
      page_size: pageSize,
    });
  }

  async function getTask(event) {
    const input = event.data && typeof event.data === 'object' ? event.data : event;
    const taskId = text(input.task_id || input._id, 100);
    if (!taskId) throw new ValidationError('缺少 task_id', [{ path: 'task_id', message: '不能为空' }]);
    return ok({ task: await findTask(taskId) });
  }

  async function cancelTask(event) {
    const input = event.data && typeof event.data === 'object' ? event.data : event;
    const taskId = text(input.task_id || input._id, 100);
    if (!taskId) throw new ValidationError('缺少 task_id', [{ path: 'task_id', message: '不能为空' }]);
    const task = await findTask(taskId);
    const cancellable = CANCELLABLE_STATES.has(task.status)
      || PROCESSING_STATES.includes(task.status)
      || task.status === 'cancelling';
    if (!cancellable) {
      throw new ConflictError(`当前状态 ${task.status} 不能取消`, 'TASK_STATE_CONFLICT');
    }
    const taskVersion = Number(task.task_version || 0) + 1;
    const reason = input.reason ? String(input.reason).slice(0, 500) : '';
    const operator = (event.__identity && event.__identity.openid) || input.operator || null;
    const appendCancelLog = async (statusMessage, extra) => {
      const tail = Array.isArray(task.logs_tail) ? task.logs_tail.slice(-(LOG_CAP - 1)) : [];
      const entry = makeLog('warn', 'cancel', 'admin', statusMessage, { details: extra || undefined });
      entry.operator = operator;
      tail.push(entry);
      await db.collection(COLLECTION).doc(taskId).update({ data: { logs_tail: tail, updated_at: db.serverDate() } });
    };
    const finalize = async (forced) => {
      const forcedClose = forced ? {
        operator,
        previous_status: task.status,
        reason,
        forced_at: db.serverDate(),
      } : null;
      await db.collection(COLLECTION).doc(taskId).update({ data: {
        status: 'cancelled',
        cancel_requested: false,
        progress: {
          stage: 'cancelled',
          percent: Number(task.progress && task.progress.percent || 0),
          message: forced ? '任务已强制结束（仅管理状态收口，不保证本机 MinerU 已终止）' : '任务已取消',
        },
        lease_token: null,
        lease_expires_at: null,
        forced_close: forcedClose,
        task_version: taskVersion,
        cancelled_at: db.serverDate(),
        updated_at: db.serverDate(),
      } });
      await appendCancelLog(forced ? '任务已强制结束' : '任务已取消', forced ? { previous_status: task.status, reason } : undefined);
    };
    if (PROCESSING_STATES.includes(task.status) || task.status === 'cancelling') {
      const force = Boolean(input.force);
      if (!force) {
        await db.collection(COLLECTION).doc(taskId).update({ data: {
          cancel_requested: true,
          cancel_requested_at: db.serverDate(),
          status: 'cancelling',
          progress: { stage: 'cancelling', percent: Number(task.progress && task.progress.percent || 0), message: '已请求取消，等待 Worker 终止 MinerU' },
          task_version: taskVersion,
          updated_at: db.serverDate(),
        } });
        await appendCancelLog('管理员请求取消，已进入 cancelling 状态，等待 Worker 终止');
        return ok({ task_id: taskId, status: 'cancelling', cancel_requested: true, force_required: true }, '已发送取消请求，Worker 将在下一次心跳后终止；若没有运行中的 Worker，请使用强制结束');
      }
      await finalize(true);
      return ok({ task_id: taskId, status: 'cancelled' }, '任务已强制结束');
    }
    await finalize(false);
    return ok({ task_id: taskId, status: 'cancelled' }, '任务已取消');
  }

  async function recoverLeases(event) {
    const recoverable = ['claimed', 'mineru_processing', 'splitting', 'cancelling'];
    const now = new Date();
    let expired;
    try {
      expired = await db.collection(COLLECTION)
        .where(command.and([
          command.in('status', recoverable),
          command.lte('lease_expires_at', now),
        ]))
        .limit(50)
        .get();
    } catch (error) {
      throw new ValidationError('回收过期租约失败', [{ path: 'lease', message: error.message }]);
    }
    let recovered = 0;
    const details = [];
    for (const task of expired.data || []) {
      try {
        await db.collection(COLLECTION).doc(task._id).update({ data: {
          status: 'waiting',
          worker_id: null,
          lease_token: null,
          lease_expires_at: null,
          heartbeat_at: null,
          cancel_requested: false,
          progress: { stage: 'waiting', percent: 0, message: '管理台手动回收过期租约，重新进入等待队列' },
          task_version: Number(task.task_version || 0) + 1,
          updated_at: db.serverDate(),
        } });
        recovered += 1;
        details.push({ task_id: task._id, previous_status: task.status });
      } catch (err) {
        details.push({ task_id: task._id, error: err.message });
      }
    }
    return ok({ recovered, details }, `已回收 ${recovered} 个过期租约任务`);
  }

  async function retryTask(event) {
    const input = event.data && typeof event.data === 'object' ? event.data : event;
    const taskId = text(input.task_id || input._id, 100);
    if (!taskId) throw new ValidationError('缺少 task_id', [{ path: 'task_id', message: '不能为空' }]);
    const task = await findTask(taskId);
    if (!['failed', 'cancelled', 'cancelling'].includes(task.status)) {
      throw new ConflictError(`当前状态 ${task.status} 不能重试`, 'TASK_STATE_CONFLICT');
    }
    const tail = Array.isArray(task.logs_tail) ? task.logs_tail.slice(-(LOG_CAP - 1)) : [];
    tail.push(makeLog('info', 'retry', 'admin', `第 ${Number(task.retry_count || 0) + 1} 次重试，重新进入等待队列`));
    await db.collection(COLLECTION).doc(taskId).update({ data: {
      status: 'waiting',
      cancel_requested: false,
      cancel_requested_at: null,
      progress: { stage: 'waiting', percent: 0, message: '等待本机 MinerU 重新领取' },
      worker_id: null,
      lease_token: null,
      lease_expires_at: null,
      heartbeat_at: null,
      error: null,
      retry_count: Number(task.retry_count || 0) + 1,
      task_version: Number(task.task_version || 0) + 1,
      logs_tail: tail,
      updated_at: db.serverDate(),
    } });
    return ok({ task_id: taskId, status: 'waiting' }, '任务已重新进入等待队列');
  }

  async function appendLog(event) {
    const input = event.data && typeof event.data === 'object' ? event.data : event;
    const taskId = text(input.task_id || input._id, 100);
    if (!taskId) throw new ValidationError('缺少 task_id', [{ path: 'task_id', message: '不能为空' }]);
    const task = await findTask(taskId);
    // 安全边界：import_task.log 仅供管理端写人工操作日志，source 强制为 admin，
    // 不允许伪造 source=worker（Worker 日志统一走 workerGateway.log，带独立签名鉴权）。
    const entry = makeLog(
      input.level,
      input.stage || task.status,
      'admin',
      input.message,
      { request_id: input.request_id, details: input.details }
    );
    entry.operator = (event.__identity && event.__identity.openid) || input.operator || null;
    const tail = Array.isArray(task.logs_tail) ? task.logs_tail.slice(-(LOG_CAP - 1)) : [];
    tail.push(entry);
    await db.collection(COLLECTION).doc(taskId).update({ data: { logs_tail: tail, updated_at: db.serverDate() } });
    return ok({ task_id: taskId, log: entry }, '日志已记录');
  }

  async function listLogs(event) {
    const input = event.data && typeof event.data === 'object' ? event.data : event;
    const taskId = text(input.task_id || input._id, 100);
    if (!taskId) throw new ValidationError('缺少 task_id', [{ path: 'task_id', message: '不能为空' }]);
    const task = await findTask(taskId);
    const tail = Array.isArray(task.logs_tail) ? task.logs_tail : [];
    return ok({ task_id: taskId, logs: tail, total: tail.length });
  }

  async function router(event) {
    const action = String(event.action || '') === 'import_task'
      ? String(event.import_task_action || '')
      : String(event.action || '').replace(/^import_task\./, '');
    switch (action) {
      case 'create': return createTask(event);
      case 'list': return listTasks(event);
      case 'get': return getTask(event);
      case 'cancel': return cancelTask(event);
      case 'retry': return retryTask(event);
      case 'log': return appendLog(event);
      case 'logs': return listLogs(event);
      case 'recover': return recoverLeases(event);
      default: throw new ValidationError(`未知 import_task action：${action}`);
    }
  }

  return { router, createTask, listTasks, getTask, cancelTask, retryTask, appendLog, listLogs, recoverLeases };
};
