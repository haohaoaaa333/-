'use strict';

const crypto = require('crypto');
const { normalizeError } = require('./errors');

function createRequestId(event = {}) {
  const headers = event.headers || {};
  const supplied = headers['x-request-id'] || headers['X-Request-Id'] || event.request_id;
  if (typeof supplied === 'string' && /^[\w.-]{8,96}$/.test(supplied)) return supplied;
  return `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function attachRequestId(body, requestId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { code: 0, data: body, message: 'ok', request_id: requestId };
  }
  return { ...body, request_id: body.request_id || requestId };
}

function errorBody(error, requestId) {
  const normalized = normalizeError(error);
  return {
    code: normalized.statusCode,
    error_code: normalized.errorCode,
    message: normalized.statusCode >= 500 && normalized.errorCode === 'INTERNAL_ERROR'
      ? '服务内部错误'
      : normalized.message,
    ...(normalized.details !== undefined ? { details: normalized.details } : {}),
    request_id: requestId,
  };
}

module.exports = { createRequestId, attachRequestId, errorBody };
