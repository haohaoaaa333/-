const fs = require('fs');
const path = require('path');

const MODULES = new Set([
  'mod_common_sense',
  'mod_language',
  'mod_quantity',
  'mod_logic',
  'mod_data',
]);

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(item => normalizeText(String(item))).filter(Boolean);
  if (typeof value === 'string') return value.split(/\n|,|，|;|；/).map(normalizeText).filter(Boolean);
  return [];
}

function normalizeQuestion(raw, index) {
  const type = raw.type === 'multiple' ? 'multiple' : 'single';
  const moduleId = MODULES.has(raw.module_id) ? raw.module_id : 'mod_language';
  const answerValue = raw.answer ?? raw.correctOption ?? 0;

  return {
    _id: normalizeText(raw._id || raw.id || raw.question_id) || `q_import_${Date.now()}_${index}`,
    module_id: moduleId,
    type,
    difficulty: ['简单', '中等', '困难'].includes(raw.difficulty) ? raw.difficulty : '中等',
    source: normalizeText(raw.source || '真题'),
    year: Number(raw.year) || new Date().getFullYear(),
    content: normalizeText(raw.content || raw.stem || raw.title),
    material: normalizeText(raw.material),
    options: normalizeArray(raw.options || raw.optionTexts),
    answer: type === 'multiple'
      ? normalizeArray(answerValue).map(Number).filter(Number.isFinite)
      : (/^[A-D]$/i.test(String(answerValue).trim())
        ? String(answerValue).trim().toUpperCase().charCodeAt(0) - 65
        : Number(answerValue) || 0),
    explanation: normalizeText(raw.explanation || raw.analysis),
    commonErrors: normalizeText(raw.commonErrors || raw.common_errors),
    tags: normalizeArray(raw.tags),
    points: Number(raw.points) || 1,
    paper_id: normalizeText(raw.paper_id),
    paper_name: normalizeText(raw.paper_name),
    province: normalizeText(raw.province || '国家'),
    position: normalizeText(raw.position),
    paper_date: normalizeText(raw.paper_date),
    status: raw.status === 'disabled' ? 'disabled' : 'enabled',
  };
}

function validate(question) {
  const errors = [];
  if (!question.content) errors.push('content is required');
  if (!question.options || question.options.length < 2) errors.push('options must contain at least 2 items');
  if (!MODULES.has(question.module_id)) errors.push('module_id is invalid');
  if (question.type === 'single' && !Number.isInteger(question.answer)) errors.push('single answer must be integer');
  return errors;
}

function chunk(list, size) {
  const batches = [];
  for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
  return batches;
}

function main() {
  const input = process.argv[2] || path.resolve(__dirname, '../../parsed_questions.json');
  const outputDir = process.argv[3] || path.resolve(__dirname, '../admin-output');
  const batchSize = Number(process.argv[4]) || 200;
  const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
  const source = Array.isArray(raw) ? raw : (raw.questions || raw.data || []);
  const cleaned = source.map(normalizeQuestion);
  const invalid = cleaned
    .map((question, index) => ({ index, _id: question._id, errors: validate(question) }))
    .filter(item => item.errors.length > 0);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'questions-clean.json'), JSON.stringify(cleaned, null, 2));
  fs.writeFileSync(path.join(outputDir, 'questions-invalid.json'), JSON.stringify(invalid, null, 2));

  chunk(cleaned, batchSize).forEach((questions, index) => {
    fs.writeFileSync(
      path.join(outputDir, `admin-import-${String(index + 1).padStart(2, '0')}.json`),
      JSON.stringify({ action: 'batch_import_questions', force_update: true, questions }, null, 2)
    );
  });

  console.log(JSON.stringify({
    input,
    outputDir,
    total: cleaned.length,
    invalid: invalid.length,
    batchSize,
    batches: Math.ceil(cleaned.length / batchSize),
  }, null, 2));
}

main();
