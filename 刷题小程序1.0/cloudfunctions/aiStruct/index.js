'use strict';

// 云函数：aiStruct
// 使用免费 HunYuan(hy3) 对 question_drafts 做结构化：
//   答案(索引+字母) / 知识点 / 难度 / 解析。
// 免费 token 仅在云函数（服务端）可用，故 AI 必须跑在云端。
// 当云端 AI 不可用（SDK 未开放 / 未开通 AI+ / 调用失败）时，回退确定性解析，
// 绝不臆造答案，且保持 answer_verified=false 由人工确认。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const AI_PROVIDER = process.env.AI_PROVIDER || 'hunyuan-v3'; // "cloudbase" 需先在控制台开启 hy3 模型开关
const AI_MODEL = process.env.AI_MODEL || 'hy3';               // hy3 / hy3-preview

const core = require('./lib/struct-core');
const { LETTERS, MODEL, MODULE_NAMES, readContext, buildMessages, extractJson, normalizeStructured, deterministicStructure } = core;

// ---------------------------------------------------------------------------
// AI 客户端构建（分层回退）
//  1) cloud.ai()  —— 微信云开发 AI+ 运行时直接提供，免费 token 自动走 env 凭证
//  2) @cloudbase/ai createAI —— 用全局 fetch + env 访问令牌自构造（兜底路径）
//  3) 返回 null   —— 交由确定性解析兜底
// ---------------------------------------------------------------------------
function getAccessTokenShim() {
  // 1) 微信云函数运行时注入的 WX_CONTEXT JSON 中可能含 access_token
  try {
    const ctx = process.env.WX_CONTEXT && JSON.parse(process.env.WX_CONTEXT);
    if (ctx && ctx.access_token) return Promise.resolve({ accessToken: String(ctx.access_token) });
  } catch (_) { /* ignore */ }
  // 2) 常见环境变量
  const envToken =
    process.env.TCB_ACCESS_TOKEN ||
    process.env.CLOUDBASE_ACCESS_TOKEN ||
    process.env.ACCESS_TOKEN ||
    '';
  if (envToken) return Promise.resolve({ accessToken: envToken });
  // 3) wx-server-sdk 可能提供
  if (typeof cloud.getAccessToken === 'function') {
    return Promise.resolve(cloud.getAccessToken())
      .then(t => ({ accessToken: (t && (t.accessToken || t.access_token)) || '' }))
      .catch(() => ({ accessToken: '' }));
  }
  return Promise.resolve({ accessToken: '' });
}

// 云端真实 env id 字符串（cloud.DYNAMIC_CURRENT_ENV 是 Symbol，不能直接拼 URL）
function resolveEnvId() {
  return process.env.TCB_ENV || process.env.CLOUDBASE_ENV_ID || 'cloud1-d0gsr2l1ye6344917';
}

function nodeFetch(options) {
  const { method = 'POST', headers = {}, body, url, timeout } = options;
  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
  return fetch(url, {
    method,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body || {}),
    signal: controller.signal,
  }).then(res => {
    return res.text().then(textData => {
      let data;
      try { data = textData ? JSON.parse(textData) : {}; } catch (_) { data = { raw: textData }; }
      const header = {};
      if (res.headers && typeof res.headers.forEach === 'function') {
        res.headers.forEach((v, k) => { header[k] = v; });
      }
      return { data, header };
    });
  }).finally(() => { if (timer) clearTimeout(timer); });
}

// 给 @cloudbase/ai 的 AI 实例兜底补 i18n，避免 handleResponseData 因
// this.i18n.t(...) 崩溃。直接 patch 原型方法（幂等），比给实例赋值可靠。
function patchI18nOnDemo(aiObj) {
  const proto = (aiObj && Object.getPrototypeOf(aiObj)) || null;
  if (proto && typeof proto.handleResponseData === 'function') {
    const orig = proto.handleResponseData;
    proto.handleResponseData = function (responseData, header) {
      if (!this.i18n || typeof this.i18n.t !== 'function') {
        this.i18n = { t: (k) => k, LANG_HEADER_KEY: 'X-Tc-Lang', lang: 'zh-CN' };
      }
      return orig.call(this, responseData, header);
    };
  }
  try {
    aiObj.i18n = aiObj.i18n || { t: (k) => k, LANG_HEADER_KEY: 'X-Tc-Lang', lang: 'zh-CN' };
  } catch (_) { /* ignore */ }
}

function buildAiClient() {
  // 路径 1：AI+ 运行时直接提供 cloud.ai()
  if (typeof cloud.ai === 'function') {
    try {
      const ai = cloud.ai();
      return { kind: 'cloud-ai', model: ai.createModel(AI_PROVIDER) };
    } catch (err) {
      console.warn('[aiStruct] cloud.ai() 可用但初始化失败：', err && err.message);
    }
  }

  // 路径 2（主路径）：@cloudbase/node-sdk 在云函数运行时内自动用临时凭证
  //   （TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN）鉴权，调用 env 的 AI+
  //   （小程序成长计划免费 hy3 Token 包）网关。无需任何 API Key。
  //   官方文档：https://docs.cloudbase.net/ai/model/nodejs-access
  //   关键：createModel 的 provider 必须是 "cloudbase"，而不是 "hunyuan"；
  //        真正的模型名在 generateText({ model: "hy3" }) 中指定。
  try {
    const tcb = require('@cloudbase/node-sdk');
    const app = tcb.init({
      env: resolveEnvId(),
      timeout: 60000, // AI 生成可能耗时较长，官方建议 60s
    });
    if (typeof app.ai === 'function') {
      const ai = app.ai();
      // @cloudbase/ai 的 AI 实例在 i18n 未注入时，handleResponseData 会
      // 因 this.i18n.t(...) 崩溃（"Cannot read properties of undefined
      // (reading 't')"）。node-sdk 内部构造的 AI 实例 i18n 默认为 undefined，
      // 且直接给实例赋值不可靠（闭包引用的实例与返回值未必同一对象）。
      // 故直接 patch 原型方法，在调用前兜底补一个最小 i18n 桩（仅用于拼
      // 接报错文案，不影响鉴权——鉴权由 node-sdk 内部完成）。
      try {
        patchI18nOnDemo(ai);
      } catch (_) { /* ignore */ }
      return { kind: 'tcb-node', model: ai.createModel(AI_PROVIDER) };
    }
  } catch (err) {
    console.warn('[aiStruct] @cloudbase/node-sdk ai 初始化失败：', err && err.message);
  }

  // 路径 3：@cloudbase/ai createAI + 自构造 fetch / 访问令牌（极端兜底）
  if (typeof fetch === 'undefined') {
    console.warn('[aiStruct] 运行时缺少全局 fetch，无法走 @cloudbase/ai 兜底路径');
    return null;
  }
  let createAI = null;
  try {
    ({ createAI } = require('@cloudbase/ai'));
  } catch (_) {
    createAI = null;
  }
  if (!createAI) {
    console.warn('[aiStruct] 未安装 @cloudbase/ai，无法走网关路径');
    return null;
  }
  try {
    const env = resolveEnvId();
    const baseUrl = process.env.AI_GATEWAY_BASE_URL || `https://${env}.api.tcloudbasegateway.com/v1`;
    const ai = createAI({
      req: { fetch: nodeFetch },
      getAccessToken: getAccessTokenShim,
      baseUrl,
    });
    return { kind: 'create-ai', model: ai.createModel(AI_PROVIDER) };
  } catch (err) {
    console.warn('[aiStruct] createAI 初始化失败：', err && err.message);
    return null;
  }
}

async function callModel(model, messages) {
  const res = await model.generateText({
    model: AI_MODEL,
    messages,
    maxSteps: 1,
    topP: 0.9,
    temperature: 0.2,
    max_tokens: 1024,
  });
  return (res && res.text) ? res.text : '';
}

// ---------------------------------------------------------------------------
// DB 读写
// ---------------------------------------------------------------------------
async function fetchItem(draftId, questionId) {
  const res = await db.collection('question_drafts')
    .where({ draft_id: draftId, question_id: questionId })
    .limit(1)
    .get();
  if (!res.data || !res.data.length) {
    const err = new Error(`question_draft 不存在: ${draftId}/${questionId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  return res.data[0];
}

// 结构化单题并写回 question 子文档
async function structureOne(draftId, questionId) {
  const item = await fetchItem(draftId, questionId);
  const question = item.question || {};
  const ctx = readContext(question, MODULE_NAMES[question.module_id] || question.module_id);

  const client = buildAiClient();
  const aiConfigured = Boolean(client);
  let structured = null;
  let provider = 'deterministic';

  if (client) {
    try {
      const raw = await callModel(client.model, buildMessages(ctx));
      const parsed = extractJson(raw);
      if (parsed && typeof parsed === 'object') {
        structured = normalizeStructured(parsed, ctx);
        provider = 'hy3';
      } else {
        console.warn('[aiStruct] 模型未返回可解析 JSON，走确定性兜底');
      }
    } catch (err) {
      console.warn('[aiStruct] 模型调用失败，走确定性兜底：', err && err.message);
    }
  }

  if (!structured) structured = deterministicStructure(ctx);

  const now = db.serverDate();
  // 已配置 AI 却失败 -> 不再自动重试；未配置 -> 保留标记待开通后重试
  const needsRetry = !aiConfigured;

  // AI 结果只作为建议，绝不写入正式 answer 字段（必须由人工接受后才进 answer）。
  // 仅当该题尚未人工确认答案时，才用 AI 建议覆盖（仍保持 answer_verified=false）；
  // 若已人工确认，保留原 answer 不变，AI 建议仅存于 ai.suggested_answer 供前端展示。
  const humanVerified = question.answer_verified === true;
  const ai = {
    ...(question.ai && typeof question.ai === 'object' ? question.ai : {}),
    suggested_answer_index: structured.answer_index,
    suggested_answer: structured.answer,
    confidence: structured.confidence,
    provider: provider === 'hy3' ? MODEL : null,
    structured_at: provider === 'hy3' ? now : (question.ai && question.ai.structured_at) || null,
  };
  const updatedQuestion = {
    ...question,
    answer_index: humanVerified ? question.answer_index : structured.answer_index,
    answer: humanVerified ? question.answer : structured.answer,
    ai,
    knowledge_points: structured.knowledge_points,
    difficulty: structured.difficulty,
    parser_confidence: provider === 'hy3'
      ? Math.max(Number(question.parser_confidence) || 0, structured.confidence)
      : (Number(question.parser_confidence) || 0),
    ai_structured: provider === 'hy3',
    ai_model: provider === 'hy3' ? MODEL : (question.ai_model || null),
    ai_structured_at: provider === 'hy3' ? now : (question.ai_structured_at || null),
    ai_analysis: structured.ai_analysis || (question.ai_analysis || ''),
    ai_fallback: provider === 'hy3' ? null : 'deterministic',
    needs_ai_structure: needsRetry,
    answer_verified: humanVerified ? true : false,
  };

  await db.collection('question_drafts').doc(item._id).update({
    data: { question: updatedQuestion, updated_at: now },
  });

  return {
    draft_id: draftId,
    question_id: questionId,
    provider,
    answer_index: structured.answer_index,
    answer: structured.answer,
    knowledge_points: structured.knowledge_points,
    difficulty: structured.difficulty,
    confidence: structured.confidence,
  };
}

// 批量结构化待处理草稿题
async function structurePending(limit) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 10));
  const items = await db.collection('question_drafts')
    .where({
      'question.needs_ai_structure': true,
      'question.ai_structured': _.neq(true),
    })
    .limit(lim)
    .get();
  const list = (items.data || []).slice();
  let processed = 0;
  let fallback = 0;
  let errors = 0;
  for (const item of list) {
    try {
      const r = await structureOne(item.draft_id, item.question_id);
      if (r.provider === 'hy3') processed += 1; else fallback += 1;
    } catch (err) {
      errors += 1;
      console.warn('[aiStruct] structureOne 失败：', item._id, err && err.message);
    }
  }
  return { total: list.length, processed_hy3: processed, fallback_deterministic: fallback, errors };
}

// 直接结构化原始文本（不落库，便于测试/前端预览）
async function structureRaw(ctx) {
  const client = buildAiClient();
  if (!client) {
    return { provider: 'deterministic', ai_configured: false, structured: deterministicStructure(ctx) };
  }
  try {
    const raw = await callModel(client.model, buildMessages(ctx));
    const parsed = extractJson(raw);
    if (parsed && typeof parsed === 'object') {
      return { provider: 'hy3', ai_configured: true, structured: normalizeStructured(parsed, ctx), raw };
    }
  } catch (err) {
    console.warn('[aiStruct] raw 模型调用失败：', err && err.message);
  }
  return { provider: 'deterministic', ai_configured: true, structured: deterministicStructure(ctx) };
}

// 诊断：db 可达性 + 当前 provider/model 试调，输出环境信息以便排查
async function diagnose() {
  const envVarNames = Object.keys(process.env).map(k => `${k}(len=${(process.env[k] || '').length})`);
  const has = (m) => { try { require.resolve(m); return true; } catch (_) { return false; } };
  // db 可达性：确认 env/凭证正常（wx-server-sdk 的 db）
  let dbTest = 'skipped';
  try {
    const r = await db.collection('question_drafts').limit(1).get();
    dbTest = { ok: true, count: (r.data || []).length };
  } catch (e) { dbTest = { ok: false, message: e && e.message }; }
  let probe = null;
  try {
    const tcb = require('@cloudbase/node-sdk');
    const app = tcb.init({ env: resolveEnvId(), timeout: 60000 });
    const ai = app.ai();
    const aiBaseUrl = ai.aiBaseUrl || 'undefined';
    try {
      const proto = Object.getPrototypeOf(ai);
      const orig = proto.handleResponseData;
      proto.handleResponseData = function (rd, hdr) {
        if (!this.i18n || typeof this.i18n.t !== 'function') this.i18n = { t: (k) => k, LANG_HEADER_KEY: 'X-Tc-Lang', lang: 'zh-CN' };
        return orig.call(this, rd, hdr);
      };
    } catch (_) { /* ignore */ }
    try {
      const model = ai.createModel(AI_PROVIDER);
      probe = await model.generateText({
        model: AI_MODEL,
        messages: [{ role: 'user', content: '回复一个字：好' }],
        maxSteps: 1,
      }).then(r => ({ ok: true, text: (r && r.text || '').slice(0, 60) }))
        .catch(e => ({ ok: false, status: e && e.status, message: e && e.message }));
    } catch (e) { probe = { ok: false, initError: e && e.message }; }
    return {
      typeofCloudAi: typeof cloud.ai,
      envVarNames,
      hasCloudbaseNodeSdk: has('@cloudbase/node-sdk'),
      hasCloudbaseAi: has('@cloudbase/ai'),
      aiProvider: AI_PROVIDER,
      aiModel: AI_MODEL,
      aiBaseUrl,
      nodeFetchAvailable: typeof fetch !== 'undefined',
      dbTest,
      probe,
    };
  } catch (err) {
    return { error: err && err.message, dbTest, aiProvider: AI_PROVIDER, aiModel: AI_MODEL };
  }
}

function rawContextFromEvent(e) {
  const opts = e.options || [];
  const options = {};
  if (Array.isArray(opts)) {
    LETTERS.forEach((L, i) => { options[L] = String(opts[i] == null ? '' : opts[i]); });
  } else if (opts && typeof opts === 'object') {
    LETTERS.forEach(L => { options[L] = String(opts[L] == null ? '' : opts[L]); });
  }
  return {
    stem: String(e.stem || ''),
    options,
    module: String(e.module || ''),
    knowledge_points: Array.isArray(e.knowledge_points) ? e.knowledge_points : [],
    difficulty: e.difficulty || 'medium',
  };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
exports.main = async (event) => {
  const e = event || {};
  const { action } = e;
  try {
    switch (action) {
      case 'structure_one':
        if (!e.draft_id || !e.question_id) return { code: 400, message: '缺少 draft_id / question_id' };
        return { code: 0, data: await structureOne(e.draft_id, e.question_id) };
      case 'structure_pending':
        return { code: 0, data: await structurePending(e.limit) };
      case 'structure_raw':
        return { code: 0, data: await structureRaw(rawContextFromEvent(e)) };
      case 'diagnose':
        return { code: 0, data: await diagnose() };
      default:
        return { code: 400, message: `未知 action: ${action || '(空)'}` };
    }
  } catch (err) {
    return { code: 500, message: (err && err.message) ? err.message : String(err) };
  }
};
