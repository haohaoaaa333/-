'use strict';

class AppError extends Error {
  constructor(message, errorCode = 'INTERNAL_ERROR', statusCode = 500, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = '参数校验失败', details) {
    super(message, 'INVALID_REQUEST', 400, details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = '缺少有效的管理端身份') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = '没有执行该操作的权限') {
    super(message, 'FORBIDDEN', 403);
  }
}

class NotFoundError extends AppError {
  constructor(resource, id) {
    super(`${resource}不存在：${id}`, 'RESOURCE_NOT_FOUND', 404);
  }
}

class ConflictError extends AppError {
  constructor(message, errorCode = 'VERSION_CONFLICT', details) {
    super(message, errorCode, 409, details);
  }
}

function normalizeError(error) {
  if (error instanceof AppError) return error;
  const message = error && error.message ? String(error.message) : '服务内部错误';
  return new AppError(message, 'INTERNAL_ERROR', 500);
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  normalizeError,
};
