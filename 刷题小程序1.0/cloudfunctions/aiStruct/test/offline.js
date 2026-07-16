'use strict';

// 离线单测：验证 aiStruct 的纯逻辑层（无需云端 / 无需 hy3 token）。
const assert = require('assert');
const core = require('../lib/struct-core');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ok -', name);
}

// 1) extractJson：兼容 markdown 包裹与多余文字
check('extractJson 从 ```json 包裹中抽取', () => {
  const raw = '好的，结果如下：\n```json\n{"answer_index":2,"answer_letter":"C","knowledge_points":["成语","语义"],"difficulty":"medium","analysis":"根据语境选C","confidence":0.92}\n```\n以上。';
  const p = core.extractJson(raw);
  assert.ok(p, '应解析出对象');
  assert.strictEqual(p.answer_index, 2);
  assert.strictEqual(p.answer_letter, 'C');
  assert.strictEqual(p.confidence, 0.92);
});

check('extractJson 对纯文本返回 null', () => {
  assert.strictEqual(core.extractJson('无法判断'), null);
});

// 2) normalizeStructured：answer_index 优先，越界回退到 letter
check('normalizeStructured answer_index 正常', () => {
  const ctx = { knowledge_points: ['言语理解与表达'], module: '言语理解与表达', difficulty: 'medium' };
  const r = core.normalizeStructured({ answer_index: 0, answer_letter: 'A', knowledge_points: ['词语辨析'], difficulty: 'easy', analysis: 'x', confidence: 0.8 }, ctx);
  assert.strictEqual(r.answer_index, 0);
  assert.strictEqual(r.answer, 'A');
  assert.strictEqual(r.difficulty, 'easy');
  assert.strictEqual(r.confidence, 0.8);
});

check('normalizeStructured 越界 answer_index 用 letter 修正', () => {
  const ctx = { knowledge_points: [], module: '数量关系', difficulty: 'hard' };
  const r = core.normalizeStructured({ answer_index: 9, answer_letter: 'D', knowledge_points: [], difficulty: 'hard', analysis: '', confidence: 0.5 }, ctx);
  assert.strictEqual(r.answer_index, 3);
  assert.strictEqual(r.answer, 'D');
});

check('normalizeStructured 非法 difficulty 回退到 ctx', () => {
  const ctx = { knowledge_points: [], module: '判断推理', difficulty: 'medium' };
  const r = core.normalizeStructured({ answer_index: 1, answer_letter: 'B', knowledge_points: ['图形推理'], difficulty: 'xxx', analysis: '', confidence: 0.4 }, ctx);
  assert.strictEqual(r.difficulty, 'medium');
});

check('normalizeStructured 空知识点回退到 ctx.knowledge_points', () => {
  const ctx = { knowledge_points: ['判断推理'], module: '判断推理', difficulty: 'medium' };
  const r = core.normalizeStructured({ answer_index: 1, answer_letter: 'B', knowledge_points: [], difficulty: 'medium', analysis: '', confidence: 0.4 }, ctx);
  assert.deepStrictEqual(r.knowledge_points, ['判断推理']);
});

check('normalizeStructured confidence 越界被夹取', () => {
  const ctx = { knowledge_points: [], module: 'm', difficulty: 'easy' };
  const r = core.normalizeStructured({ answer_index: 0, answer_letter: 'A', knowledge_points: ['k'], difficulty: 'easy', analysis: '', confidence: 5 }, ctx);
  assert.strictEqual(r.confidence, 1);
  const r2 = core.normalizeStructured({ answer_index: 0, answer_letter: 'A', knowledge_points: ['k'], difficulty: 'easy', analysis: '', confidence: -1 }, ctx);
  assert.strictEqual(r2.confidence, 0);
});

// 3) readContext：从 V2 question 子文档抽取
check('readContext 正确提取 stem / options / module', () => {
  const question = {
    content: '下列成语使用恰当的是？',
    module_id: 'mod_language',
    options_v2: [
      { key: 'A', text: '他蔚然成风' },
      { key: 'B', text: '大家津津乐道' },
      { key: 'C', text: '问题渊远流长' },
      { key: 'D', text: '成绩差强人意' },
    ],
    knowledge_points: ['成语'],
    difficulty: 'medium',
  };
  const ctx = core.readContext(question, core.MODULE_NAMES['mod_language']);
  assert.strictEqual(ctx.stem, '下列成语使用恰当的是？');
  assert.strictEqual(ctx.options.A, '他蔚然成风');
  assert.strictEqual(ctx.options.D, '成绩差强人意');
  assert.strictEqual(ctx.module, '言语理解与表达');
  assert.deepStrictEqual(ctx.knowledge_points, ['成语']);
});

check('readContext stem_blocks 兜底', () => {
  const question = {
    stem_blocks: [{ type: 'text', text: '题干来自块' }],
    module_id: 'mod_logic',
    options_v2: [],
    difficulty: 'hard',
  };
  const ctx = core.readContext(question, core.MODULE_NAMES['mod_logic']);
  assert.strictEqual(ctx.stem, '题干来自块');
});

// 4) buildMessages 结构
check('buildMessages 返回 system+user', () => {
  const ctx = { stem: 's', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, module: '言语理解与表达', knowledge_points: ['k'], difficulty: 'easy' };
  const msgs = core.buildMessages(ctx);
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, 'system');
  assert.strictEqual(msgs[1].role, 'user');
  const payload = JSON.parse(msgs[1].content.split('\n')[0]);
  assert.strictEqual(payload.stem, 's');
  assert.strictEqual(payload.options.A, 'a');
});

// 5) deterministicStructure 不臆造答案
check('deterministicStructure answer 为 null 且保留知识点', () => {
  const ctx = { knowledge_points: ['数量关系'], module: '数量关系', difficulty: 'hard' };
  const r = core.deterministicStructure(ctx);
  assert.strictEqual(r.answer_index, null);
  assert.strictEqual(r.answer, null);
  assert.deepStrictEqual(r.knowledge_points, ['数量关系']);
  assert.strictEqual(r.confidence, 0.3);
});

console.log(`\n全部通过：${passed} 项`);
