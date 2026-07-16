'use strict';

// admin 云函数 HTTP 客户端（受信服务端身份）。复用管理台 callAdmin 的请求形态：
// 请求体带 admin_secret，云函数 authenticateAdmin 以 legacy_secret 模式鉴权为 super_admin。
// 仅暴露 Worker 需要的最小动作：拉取任务详情、创建/追加草稿、回收过期租约。

const { config } = require('./config');

class AdminError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(action, payload = {}, timeoutMs = 60000) {
  if (!config.adminUrl) throw new AdminError('ADMIN_URL 未配置', 'CONFIG', 500);
  const body = JSON.stringify({ action, admin_secret: config.adminSecret, ...payload });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(config.adminUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new AdminError(`admin 请求超时：${action}`, 'TIMEOUT', 504);
    throw new AdminError(`admin 请求失败：${err.message}`, 'NETWORK', 502);
  } finally {
    clearTimeout(timer);
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new AdminError(`admin 返回非 JSON：${res.status}`, 'BAD_RESPONSE', 502);
  }
  if (!res.ok || json.code !== 0) {
    throw new AdminError(json.message || `admin 错误 ${res.status}`, json.error_code || 'ADMIN', res.status || 500);
  }
  return json.data;
}

const admin = {
  getImportTask(taskId) {
    return request('import_task.get', { task_id: taskId }, 20000);
  },
  createDraft({ pkg, sourceTaskId, paperName, rawMarkdown }) {
    return request('draft', {
      draft_action: 'create',
      package: pkg,
      source_task_id: sourceTaskId,
      paper_name: paperName,
      raw_markdown: rawMarkdown,
    }, 90000);
  },
  appendDraft({ draftId, questions, groups, media, solutions }) {
    return request('draft', {
      draft_action: 'append',
      draft_id: draftId,
      questions,
      groups,
      media,
      solutions,
    }, 90000);
  },
  recoverLeases() {
    return request('import_task.recover', {}, 30000);
  },
};

module.exports = { admin, AdminError };
