// Gemini 题目审核服务。
// 仅返回审核建议，不直接改变人工审核状态，也不自动发布题目。

const https = require('https');

const DEFAULT_MODEL = 'gemini-2.5-flash';
const VERDICTS = new Set(['pass', 'needs_review', 'incorrect']);
const ANSWERS = new Set(['', 'A', 'B', 'C', 'D']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function blocksToText(blocks) {
  return array(blocks).map(block => {
    if (!block || typeof block !== 'object') return '';
    if (block.type === 'image') return `[图片:${text(block.asset_id || block.src) || '未命名'}]`;
    if (block.type === 'formula') return text(block.latex || block.text) || '[公式]';
    return text(block.text);
  }).filter(Boolean).join('\n');
}

function optionToText(option) {
  if (typeof option === 'string') return option;
  if (!option || typeof option !== 'object') return '';
  return text(option.text) || blocksToText(option.content_blocks) || blocksToText(option);
}

function answerLetter(question, edit) {
  const edited = text(edit && edit.answer).toUpperCase();
  if (ANSWERS.has(edited) && edited) return edited;
  const direct = text(question && question.answer).toUpperCase();
  if (ANSWERS.has(direct) && direct) return direct;
  const index = Number(question && question.answer_index);
  return Number.isInteger(index) && index >= 0 && index <= 3 ? 'ABCD'[index] : '';
}

function hasImage(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(hasImage);
  if (typeof value !== 'object') return false;
  if (value.type === 'image' || text(value.asset_id) || text(value.src)) return true;
  return Object.values(value).some(hasImage);
}

function buildQuestionPayload(draft, questionId) {
  const pkg = draft.package || {};
  const question = array(pkg.questions).find(item => text(item && item._id) === questionId);
  if (!question) throw new Error('题目不存在');

  const solution = array(pkg.solutions).find(item => text(item && item.question_id) === questionId) || {};
  const group = array(pkg.groups).find(item => text(item && item._id) === text(question.group_id)) || {};
  const edit = (draft.edits && draft.edits[questionId]) || {};
  const optionValues = Array.isArray(edit.options) && edit.options.length === 4
    ? edit.options
    : array(question.options_v2).map(optionToText);
  const options = optionValues.map((option, index) => ({
    key: 'ABCD'[index] || String(index + 1),
    content: text(option),
  }));
  const originalAnalysis = text(solution.explanation) || blocksToText(solution.explanation_blocks) || text(question.explanation);
  const material = Object.prototype.hasOwnProperty.call(edit, 'material')
    ? text(edit.material)
    : text(group.material_text || group.material || group.content) || blocksToText(group.material_blocks || group.content_blocks);
  const evidence = question.source_evidence || {};
  const containsImage = hasImage(question.stem_blocks) || hasImage(question.options_v2) ||
    hasImage(solution.explanation_blocks) || hasImage(group.material_blocks || group.content_blocks) || array(evidence.images).length > 0;

  return {
    question_id: questionId,
    paper_name: text(draft.paper_name),
    module: text(edit.module_id || question.module_id || group.module_id),
    material,
    stem: Object.prototype.hasOwnProperty.call(edit, 'stem')
      ? text(edit.stem)
      : text(question.content || question.stem) || blocksToText(question.stem_blocks),
    options,
    current_answer: answerLetter(question, edit),
    current_analysis: Object.prototype.hasOwnProperty.call(edit, 'analysis') ? text(edit.analysis) : originalAnalysis,
    source_page: evidence.page || question.source_page || null,
    raw_ocr_text: text(evidence.raw_text),
    source_images: array(evidence.images).map(text).filter(Boolean),
    parser_confidence: Number(question.parser_confidence ?? evidence.parser_confidence) || 0,
    contains_image: containsImage,
    image_note: containsImage
      ? '当前调用只提供了图片占位符，没有把本机图片二进制传给 Gemini；涉及图形、图表或图片文字的结论必须人工看原图确认。'
      : '',
  };
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: {
      type: 'string',
      enum: ['pass', 'needs_review', 'incorrect'],
      description: 'pass=文本信息完整且答案解析一致；needs_review=信息不足或必须人工确认；incorrect=发现明确错误。',
    },
    summary: { type: 'string', description: '一句话审核结论。' },
    risk_points: { type: 'array', items: { type: 'string' }, description: '具体问题或风险点。' },
    suggested_answer: { type: 'string', enum: ['', 'A', 'B', 'C', 'D'], description: '建议答案；不能可靠判断时返回空字符串。' },
    suggested_analysis: { type: 'string', description: '建议修正后的解析；无需修改或不能判断时返回空字符串。' },
    requires_human_review: { type: 'boolean', description: '是否必须由人工继续复核。' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: '对本次审核结论的置信度。' },
  },
  required: ['verdict', 'summary', 'risk_points', 'suggested_answer', 'suggested_analysis', 'requires_human_review', 'confidence'],
};

function buildPrompt(payload) {
  return [
    '你是中国公务员考试行测题库的严谨审核员。',
    '请核对题干、四个选项、当前答案与当前解析是否互相一致，检查 OCR 漏字、选项缺失、答案错误、解析答非所问和材料题关联问题。',
    '不得臆造题目中不存在的信息；不能确定时必须选择 needs_review。',
    '如果 contains_image=true，且正确答案依赖图片、图表或图形推理，必须 requires_human_review=true，不能假装看到了原图。',
    'pass 仅表示可以交给人工快速确认，不代表自动发布。',
    '',
    JSON.stringify(payload),
  ].join('\n');
}

function postJson(url, apiKey, body, timeoutMs = 70000) {
  return new Promise((resolve, reject) => {
    const rawBody = JSON.stringify(body);
    const target = new URL(url);
    const req = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(rawBody),
        'x-goog-api-key': apiKey,
      },
      timeout: timeoutMs,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (_) {
          const error = new Error(`Gemini 返回了无法解析的响应（HTTP ${response.statusCode || 0}）`);
          error.statusCode = response.statusCode || 0;
          error.retryable = (response.statusCode || 0) >= 500;
          return reject(error);
        }
        if ((response.statusCode || 500) >= 400) {
          const message = parsed.error && parsed.error.message;
          const error = new Error(message || `Gemini 请求失败（HTTP ${response.statusCode || 0}）`);
          error.statusCode = response.statusCode || 0;
          error.retryable = error.statusCode === 429 || error.statusCode >= 500;
          return reject(error);
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => {
      const error = new Error('Gemini 审核超时，请稍后重试');
      error.retryable = true;
      req.destroy(error);
    });
    req.on('error', reject);
    req.end(rawBody);
  });
}

async function postJsonWithRetry(url, apiKey, body, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await postJson(url, apiKey, body);
    } catch (error) {
      lastError = error;
      if (!error?.retryable || attempt >= maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 700 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

function extractResponseText(response) {
  const candidate = array(response && response.candidates)[0];
  const parts = array(candidate && candidate.content && candidate.content.parts);
  return parts.map(part => text(part && part.text)).filter(Boolean).join('\n');
}

function validateReview(value, containsImage, model) {
  if (!value || typeof value !== 'object') throw new Error('Gemini 审核结果格式无效');
  const verdict = VERDICTS.has(value.verdict) ? value.verdict : 'needs_review';
  const suggestedAnswer = text(value.suggested_answer).toUpperCase();
  const result = {
    provider: 'gemini',
    model,
    verdict,
    summary: text(value.summary) || 'Gemini 未提供审核摘要',
    risk_points: array(value.risk_points).map(text).filter(Boolean).slice(0, 12),
    suggested_answer: ANSWERS.has(suggestedAnswer) ? suggestedAnswer : '',
    suggested_analysis: text(value.suggested_analysis),
    requires_human_review: Boolean(value.requires_human_review) || containsImage,
    confidence: clamp(value.confidence, 0, 1),
  };
  if (containsImage && !result.risk_points.some(item => /图片|图表|图形|原图/.test(item))) {
    result.risk_points.unshift('题目含图片内容，当前云端文本审核无法核对原图，必须人工确认。');
  }
  if (containsImage && result.verdict === 'pass') result.verdict = 'needs_review';
  return result;
}

async function reviewQuestion(draft, questionId) {
  const apiKey = text(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    const error = new Error('尚未配置 GEMINI_API_KEY，请在 admin 云函数环境变量中配置后重新部署');
    error.code = 'GEMINI_NOT_CONFIGURED';
    throw error;
  }
  const model = text(process.env.GEMINI_MODEL) || DEFAULT_MODEL;
  const payload = buildQuestionPayload(draft, questionId);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await postJsonWithRetry(endpoint, apiKey, {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(payload) }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: REVIEW_SCHEMA,
    },
  });
  const rawText = extractResponseText(response);
  if (!rawText) throw new Error('Gemini 未返回审核内容');
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (_) {
    throw new Error('Gemini 返回内容不是有效 JSON');
  }
  return validateReview(parsed, payload.contains_image, model);
}

module.exports = {
  reviewQuestion,
  buildQuestionPayload,
  validateReview,
};
