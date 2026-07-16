// 题目审核服务（hy3 / 免费 HunYuan）。
// 仅返回审核建议，不直接改变人工审核状态，也不自动发布题目。
//
// 与旧版 gemini-review 的区别：不再调用 Google Gemini API（需自备 Key、
// 且境内云环境网络不通），改为复用 admin 云函数内的免费 hy3（HunYuan）
// 生文 Token，走 @cloudbase/node-sdk 的 AI 网关。审核结果结构与之前一致。

const cloud = require('wx-server-sdk');

const AI_PROVIDER = process.env.AI_PROVIDER || 'hunyuan-v3'; // "cloudbase" 需先在控制台开启 hy3 模型开关
const AI_MODEL = process.env.AI_MODEL || 'hy3';              // hy3 / hy3-preview

const common = require('./review-common');
const { buildQuestionPayload, buildPrompt, validateReview } = common;

// 云端真实 env id 字符串（cloud.DYNAMIC_CURRENT_ENV 是 Symbol，不能直接拼 URL）
function resolveEnvId() {
  return process.env.TCB_ENV || process.env.CLOUDBASE_ENV_ID || 'cloud1-d0gsr2l1ye6344917';
}

// 给 @cloudbase/ai 的 AI 实例兜底补 i18n，避免 handleResponseData 因
// this.i18n.t(...) 崩溃（与 aiStruct 同样的 patch，幂等）。
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
      console.warn('[hy3-review] cloud.ai() 可用但初始化失败：', err && err.message);
    }
  }

  // 路径 2（主路径）：@cloudbase/node-sdk 在云函数运行时内自动用临时凭证
  //   （TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN）鉴权，调用 env 的 AI+
  //   （小程序成长计划免费 hy3 Token 包）网关。无需任何 API Key。
  try {
    const tcb = require('@cloudbase/node-sdk');
    const app = tcb.init({
      env: resolveEnvId(),
      timeout: 60000, // AI 生成可能耗时较长，官方建议 60s
    });
    if (typeof app.ai === 'function') {
      const ai = app.ai();
      try {
        patchI18nOnDemo(ai);
      } catch (_) { /* ignore */ }
      return { kind: 'tcb-node', model: ai.createModel(AI_PROVIDER) };
    }
  } catch (err) {
    console.warn('[hy3-review] @cloudbase/node-sdk ai 初始化失败：', err && err.message);
  }

  return null;
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

function extractJson(rawText) {
  if (!rawText) return null;
  let text = rawText.trim();
  // 去掉可能的代码块标记
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // 截取第一个 { 到最后一个 } 之间的内容
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function reviewQuestion(draft, questionId) {
  const payload = buildQuestionPayload(draft, questionId);
  const client = buildAiClient();
  if (!client) {
    const error = new Error('云端 AI 客户端初始化失败，请确认 admin 云函数已安装 @cloudbase/node-sdk 并开通 AI 网关');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }

  const messages = [
    {
      role: 'system',
      content: '你是中国公务员考试行测题库的严谨审核员，只输出合规 JSON。',
    },
    {
      role: 'user',
      content: buildPrompt(payload),
    },
  ];

  let rawText;
  try {
    rawText = await callModel(client.model, messages);
  } catch (err) {
    const error = new Error(`hy3 调用失败：${err && err.message}`);
    error.code = 'AI_INVOKE_FAILED';
    throw error;
  }
  if (!rawText) throw new Error('hy3 未返回审核内容');

  const parsed = extractJson(rawText);
  if (!parsed || typeof parsed !== 'object') throw new Error('hy3 返回内容不是有效 JSON');

  return validateReview(parsed, payload.contains_image, AI_MODEL);
}

module.exports = {
  reviewQuestion,
  buildQuestionPayload,
  validateReview,
};
