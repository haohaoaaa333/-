'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalAction,
  allowedRolesForAction,
  hasAllowedRole,
  safeEqual,
} = require('../lib/auth');
const { createRequestId, attachRequestId, errorBody } = require('../lib/response');
const { ValidationError } = require('../lib/errors');
const draftHelpers = require('../features/drafts-v2')._test;

test('旧 draft action 会转换为权限判断使用的标准 action', () => {
  assert.equal(canonicalAction({ action: 'draft', draft_action: 'publish' }), 'draft.publish');
  assert.equal(canonicalAction({ action: 'import_task', import_task_action: 'create' }), 'import_task.create');
});

test('发布只能由 publisher 或 super_admin 执行', () => {
  const allowed = allowedRolesForAction('draft.publish');
  assert.equal(hasAllowedRole({ roles: ['editor'] }, allowed), false);
  assert.equal(hasAllowedRole({ roles: ['publisher'] }, allowed), true);
  assert.equal(hasAllowedRole({ roles: ['super_admin'] }, allowed), true);
});

test('密钥比较不会接受长度不同或内容不同的值', () => {
  assert.equal(safeEqual('same-secret', 'same-secret'), true);
  assert.equal(safeEqual('same-secret', 'other-secret'), false);
  assert.equal(safeEqual('short', 'much-longer'), false);
});

test('响应始终附带 request_id', () => {
  const id = createRequestId({ request_id: 'request-12345678' });
  assert.equal(id, 'request-12345678');
  assert.equal(attachRequestId({ code: 0, data: {} }, id).request_id, id);
});

test('业务异常转换为稳定错误结构', () => {
  const body = errorBody(new ValidationError('字段错误', [{ path: 'paper_name', message: '不能为空' }]), 'req_test');
  assert.equal(body.code, 400);
  assert.equal(body.error_code, 'INVALID_REQUEST');
  assert.equal(body.details[0].path, 'paper_name');
  assert.equal(body.request_id, 'req_test');
});

test('一题一档 ID 对同一道题稳定且不同题不冲突', () => {
  const first = draftHelpers.itemId('draft_demo', 'q_001');
  assert.equal(first, draftHelpers.itemId('draft_demo', 'q_001'));
  assert.notEqual(first, draftHelpers.itemId('draft_demo', 'q_002'));
});

test('答案或解析缺失时不允许人工通过', () => {
  const base = {
    question: {
      _id: 'q_001',
      content: '题干',
      options_v2: ['A', 'B', 'C', 'D'].map((key) => ({ key, text: key })),
      answer: 0,
      answer_verified: true,
    },
    solution: { question_id: 'q_001', explanation: '' },
    edit: {},
  };
  assert.equal(draftHelpers.validateForApproval(base).some(item => item.path === 'analysis'), true);
  assert.equal(draftHelpers.validateForApproval({
    ...base,
    solution: { question_id: 'q_001', explanation: '完整解析' },
  }).length, 0);
  assert.equal(draftHelpers.validateForApproval({
    ...base,
    question: { ...base.question, answer_verified: false },
    solution: { question_id: 'q_001', explanation: '完整解析' },
  }).some(item => item.path === 'answer'), true);
});
