'use strict';

const crypto = require('crypto');
const { config } = require('./config');

// workerGateway 云函数 HTTP 客户端。所有请求带 Worker 身份与 HMAC 签名，
// 与 cloudfunctions/workerGateway/index.js 的 authenticate() 严格对应。

function signature(secret, timestamp, nonce, rawBody) {
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n${bodyHash}`).digest('hex');
}

class GatewayError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(action, payload = {}, timeoutMs = 30000) {
  if (!config.gatewayUrl) throw new GatewayError('WORKER_GATEWAY_URL 未配置', 'CONFIG', 500);
  const body = JSON.stringify({ action, ...payload });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = signature(config.workerSecret, timestamp, nonce, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(config.gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-id': config.workerId,
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-signature': sig,
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new GatewayError(`网关请求超时：${action}`, 'TIMEOUT', 504);
    throw new GatewayError(`网关请求失败：${err.message}`, 'NETWORK', 502);
  } finally {
    clearTimeout(timer);
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new GatewayError(`网关返回非 JSON：${res.status}`, 'BAD_RESPONSE', 502);
  }
  if (!res.ok || json.code !== 0) {
    throw new GatewayError(json.message || `网关错误 ${res.status}`, json.error_code || 'GATEWAY', res.status || 500);
  }
  return json.data;
}

const gateway = {
  claim() {
    return request('claim', {}, config.claimTimeoutMs);
  },
  heartbeat({ taskId, leaseToken, stage, percent, message, processedPages, totalPages }) {
    return request('heartbeat', {
      task_id: taskId,
      lease_token: leaseToken,
      stage,
      percent: percent == null ? undefined : percent,
      message,
      processed_pages: processedPages,
      total_pages: totalPages,
    });
  },
  complete({ taskId, leaseToken, result }) {
    return request('complete', { task_id: taskId, lease_token: leaseToken, result }, 30000);
  },
  fail({ taskId, leaseToken, error }) {
    return request('fail', { task_id: taskId, lease_token: leaseToken, error }, 30000);
  },
  cancel({ taskId, leaseToken }) {
    return request('cancel', { task_id: taskId, lease_token: leaseToken }, 30000);
  },
  log({ taskId, leaseToken, level, stage, message, details, requestId }) {
    return request('log', {
      task_id: taskId,
      lease_token: leaseToken,
      level,
      stage,
      message,
      details,
      request_id: requestId,
    }, 15000);
  },
};

module.exports = { gateway, GatewayError, signature };
