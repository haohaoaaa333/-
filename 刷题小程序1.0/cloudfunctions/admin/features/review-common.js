// 题目审核公共逻辑（与具体模型无关）。
// 负责把草稿题目拼成模型可读的 payload、定义结构化输出 schema、
// 以及把模型返回的 JSON 校验成统一结果结构。
// hy3 等不同模型实现都复用本文件，保证审核结果结构一致。

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
      ? '当前调用只提供了图片占位符，没有把本机图片二进制传给模型；涉及图形、图表或图片文字的结论必须人工看原图确认。'
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
    '',
    '请只返回一个 JSON 对象，字段严格为：',
    'verdict(枚举 pass|needs_review|incorrect)、summary(字符串)、',
    'risk_points(字符串数组)、suggested_answer(空串或 A/B/C/D)、',
    'suggested_analysis(字符串)、requires_human_review(布尔)、confidence(0-1 数字)。',
    '不要输出任何解释文字或代码块标记，只输出合规的 JSON。',
  ].join('\n');
}

function validateReview(value, containsImage, model) {
  if (!value || typeof value !== 'object') throw new Error('审核结果格式无效');
  const verdict = VERDICTS.has(value.verdict) ? value.verdict : 'needs_review';
  const suggestedAnswer = text(value.suggested_answer).toUpperCase();
  const result = {
    provider: 'hy3',
    model: model || 'hy3',
    verdict,
    summary: text(value.summary) || '模型未提供审核摘要',
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

module.exports = {
  buildQuestionPayload,
  buildPrompt,
  validateReview,
  REVIEW_SCHEMA,
};
