const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { inferQuestionType, parseEssayPaperMarkdown, validatePackage } = require('../admin/essay-parser');

const input = process.argv[2];
if (!input) {
  throw new Error('用法: node scripts/test_essay_parser.js <申论真题.md>');
}

const source = fs.readFileSync(input, 'utf8');
const result = parseEssayPaperMarkdown(source, { filename: path.basename(input) });

assert.strictEqual(result.materials.length, 4, '应识别到4份材料');
assert.strictEqual(result.questions.length, 5, '应识别到5道题');
assert.strictEqual(result.answers.length, 5, '应识别到5份答案');
assert.strictEqual(result.paper.total_score, 100, '试卷总分应为100');
assert.strictEqual(result.questions[0].primary_type, 'summary');
assert.strictEqual(result.questions[1].primary_type, 'analysis');
assert.strictEqual(result.questions[2].subtype, 'achievement_and_suggestion');
assert.strictEqual(result.questions[3].document_genre, 'proposal');
assert.strictEqual(result.questions[4].primary_type, 'essay');
assert.strictEqual(result.questions[4].requirements.min_words, 1000);
assert.strictEqual(result.questions[4].requirements.max_words, 1200);
assert.deepStrictEqual(validatePackage(result), []);
assert.strictEqual(inferQuestionType('撰写一份工作经验交流材料提纲').primary_type, 'practical_writing');
assert.strictEqual(inferQuestionType('撰写一份工作经验交流材料提纲').document_genre, 'outline');

console.log(JSON.stringify({
  paper: result.paper,
  stats: {
    materials: result.materials.length,
    questions: result.questions.length,
    answers: result.answers.length,
    removed_watermarks: result.import_meta.removed_watermarks,
    removed_page_markers: result.import_meta.removed_page_markers,
  },
  types: result.questions.map(item => ({
    sequence: item.sequence,
    primary_type: item.primary_type,
    subtype: item.subtype,
    score: item.score,
    words: [item.requirements.min_words, item.requirements.max_words],
  })),
}, null, 2));
