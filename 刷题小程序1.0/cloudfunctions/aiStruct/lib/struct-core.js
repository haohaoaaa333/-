'use strict';

// aiStruct 纯逻辑层（不依赖云端 SDK，可离线单测）。
// 负责：从 V2 question 子文档抽取上下文、构造 hy3 提示词、解析模型 JSON、归一化为 V2 字段、确定性兜底。

const LETTERS = ['A', 'B', 'C', 'D'];

// module_id -> 中文模块名（提示词更友好，也用于兜底知识点）
const MODULE_NAMES = {
  mod_common_sense: '常识判断',
  mod_language: '言语理解与表达',
  mod_quantity: '数量关系',
  mod_logic: '判断推理',
  mod_data: '资料分析',
};

const MODEL = 'hy3';

function text(value, max) {
  const t = typeof value === 'string' ? value.trim() : '';
  return max ? t.slice(0, max) : t;
}

function blocksToText(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map(block => {
    if (!block || typeof block !== 'object') return '';
    if (block.type === 'image') return `[图片:${text(block.asset_id || block.src) || '未命名'}]`;
    if (block.type === 'formula') return text(block.latex || block.text) || '[公式]';
    return text(block.text || block.content);
  }).filter(Boolean).join('\n');
}

// 从 V2 question 子文档构造 AI 上下文
function readContext(question, moduleName) {
  const q = question || {};
  const optionsV2 = Array.isArray(q.options_v2) ? q.options_v2 : [];
  const options = {};
  optionsV2.slice(0, 4).forEach((opt, i) => {
    const L = LETTERS[i];
    if (!L) return;
    let t = '';
    if (opt && typeof opt === 'object') {
      t = String(opt.text || (opt.content_blocks ? blocksToText(opt.content_blocks) : '') || '');
    } else if (typeof opt === 'string') {
      t = opt;
    }
    options[L] = text(t);
  });
  return {
    stem: text(q.content || q.stem || (q.stem_blocks ? blocksToText(q.stem_blocks) : '')),
    options,
    module: String(moduleName || q.module_id || ''),
    knowledge_points: Array.isArray(q.knowledge_points) ? q.knowledge_points.slice(0, 4) : [],
    difficulty: q.difficulty || 'medium',
  };
}

// 构造 hy3 提示词 messages。要求只输出 JSON，避免 markdown 包裹。
function buildMessages(ctx) {
  const system = [
    '你是中国公务员考试（行测）题库的结构化助手。',
    '根据题干预干、四个选项与模块信息，判断正确答案、提炼 1-4 个知识点、评估难度，并给出解题思路。',
    '必须只输出一个 JSON 对象，不要任何额外文字，不要使用 markdown 代码块。',
  ].join('');
  const payload = {
    stem: ctx.stem || '',
    options: ctx.options || {},
    module: ctx.module || '',
    existing_knowledge_points: ctx.knowledge_points || [],
  };
  const schemaHint = '请仅输出 JSON：{"answer_index":0,"answer_letter":"A","knowledge_points":["..."],"difficulty":"easy|medium|hard","analysis":"...","confidence":0.0}';
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload) + '\n' + schemaHint },
  ];
}

// 从模型文本中稳健抽取第一个 JSON 对象
function extractJson(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  const slice = rawText.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

// 将模型 JSON 归一化为 V2 字段
function normalizeStructured(parsed, ctx) {
  const result = {};
  let idx = Number(parsed.answer_index);
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) {
    const letter = String(parsed.answer_letter || parsed.answer || '').toUpperCase();
    idx = LETTERS.indexOf(letter);
  }
  if (idx >= 0 && idx <= 3) {
    result.answer_index = idx;
    result.answer = LETTERS[idx];
  } else {
    result.answer_index = null;
    result.answer = null;
  }

  const kps = Array.isArray(parsed.knowledge_points)
    ? parsed.knowledge_points.map(String).map(s => s.trim()).filter(Boolean).slice(0, 4)
    : [];
  result.knowledge_points = kps.length
    ? kps
    : (Array.isArray(ctx.knowledge_points) && ctx.knowledge_points.length
      ? ctx.knowledge_points.slice(0, 4)
      : [ctx.module].filter(Boolean));

  const diff = String(parsed.difficulty || '').toLowerCase();
  result.difficulty = ['easy', 'medium', 'hard'].includes(diff) ? diff : (ctx.difficulty || 'medium');

  result.ai_analysis = String(parsed.analysis || '').trim();

  let conf = Number(parsed.confidence);
  result.confidence = Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5;

  return result;
}

// 确定性兜底：无法调用 AI 时，保留人工确认要求，不臆造答案
function deterministicStructure(ctx) {
  const kps = (Array.isArray(ctx.knowledge_points) && ctx.knowledge_points.length)
    ? ctx.knowledge_points.slice(0, 4)
    : [ctx.module].filter(Boolean);
  return {
    answer_index: null,
    answer: null,
    knowledge_points: kps,
    difficulty: ctx.difficulty || 'medium',
    ai_analysis: '',
    confidence: 0.3,
  };
}

module.exports = {
  LETTERS,
  MODEL,
  MODULE_NAMES,
  text,
  blocksToText,
  readContext,
  buildMessages,
  extractJson,
  normalizeStructured,
  deterministicStructure,
};
