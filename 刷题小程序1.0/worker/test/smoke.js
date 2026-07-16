'use strict';

// 离线冒烟：无需 GPU / 云。直接喂手写 raw_questions.json 给 structure_questions.py
// （确定性结构化阶段，保证 answer=null），再走 draft_builder + local 存储后端，
// 校验：包结构、缺答案严格为 null、图片引用改写、artifacts 产出。

const fs = require('fs');
const path = require('path');
const os = require('os');

const projectRoot = path.resolve(__dirname, '..', '..');
const scriptsDir = path.join(projectRoot, 'scripts');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-worker-smoke-'));

// 必须在 require config 之前设置环境变量
process.env.WORKER_STORAGE_BACKEND = 'local';
process.env.WORKER_SCRIPTS_DIR = scriptsDir;
process.env.WORKER_PROJECT_ROOT = projectRoot;
process.env.CLOUD_MIRROR_DIR = path.join(temp, 'mirror');
process.env.WORKER_TASK_DIR = path.join(temp, 'tasks');
process.env.WORKER_GATEWAY_URL = 'http://127.0.0.1:9/disabled';
process.env.ADMIN_URL = 'http://127.0.0.1:9/disabled';
process.env.WORKER_SECRET = 'x'.repeat(32);
process.env.ADMIN_SECRET = 'x'.repeat(32);

const { runPythonStep } = require('../src/kg_worker/pipeline');
const { buildAndUpload } = require('../src/kg_worker/draft_builder');
const { createStorage } = require('../src/kg_worker/storage');

const outputDir = path.join(temp, 'output');
fs.mkdirSync(outputDir, { recursive: true });

const rawMarkdown = [
  '# 2024 行测（冒烟样例）',
  '## 言语理解与表达',
  '',
  '1. 下列词语中，没有错别字的一项是？',
  'A. 再接再厉',
  'B. 走头无路',
  'C. 默守成规',
  'D. 变本加利',
  '',
  '2. 根据下图，计算结果约为？',
  '![题干图](q2_img.png)',
  'A. 10',
  'B. 20',
  'C. 30',
  'D. 40',
  '',
].join('\n');
fs.writeFileSync(path.join(outputDir, 'input.md'), rawMarkdown);

const rawQuestions = [
  {
    raw_text: '下列词语中，没有错别字的一项是？\nA. 再接再厉\nB. 走头无路\nC. 默守成规\nD. 变本加利',
    module: '言语理解与表达',
    question_no: 1,
    option_count: 4,
    page: 1,
    images: [],
  },
  {
    raw_text: '根据下图，计算结果约为？\n![题干图](q2_img.png)\nA. 10\nB. 20\nC. 30\nD. 40',
    module: '言语理解与表达',
    question_no: 2,
    option_count: 4,
    page: 2,
    images: ['q2_img.png'],
  },
];
fs.writeFileSync(path.join(outputDir, 'raw_questions.json'), JSON.stringify({ questions: rawQuestions }, null, 2));

// 1x1 透明 PNG，供 draft_builder 上传改写
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(path.join(outputDir, 'q2_img.png'), png);

const draftsPath = path.join(outputDir, 'question_drafts.json');

let failures = 0;
function assert(cond, label) {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${label}`);
  }
}

async function main() {
  // 1) 确定性结构化
  await runPythonStep('structure_questions', 'structure_questions.py', [
    '--input', path.join(outputDir, 'raw_questions.json'),
    '--output', draftsPath,
    '--paper-id', 'P_SMOKEN',
    '--task-id', 'T_SMOKEN',
  ]);

  const pkg = JSON.parse(fs.readFileSync(draftsPath, 'utf8'));
  pkg._rawMarkdown = rawMarkdown;

  // 2) 校验包结构 + 缺答案
  assert(pkg.schema_version === 2, '最终包 schema_version === 2');
  assert(Array.isArray(pkg.questions) && pkg.questions.length === 2, `识别到 2 题（实际 ${pkg.questions && pkg.questions.length}）`);
  assert(pkg.questions.every(q => q.answer === null), '所有题目 answer 严格为 null（缺答案不默认 A）');
  assert(pkg.questions.every(q => q.answer_verified === false), 'answer_verified 均为 false');
  assert(pkg.questions.every(q => Array.isArray(q.options_v2) && q.options_v2.length === 4), '每题 4 个选项');
  assert(pkg.questions.every(q => typeof q._id === 'string' && q._id.length > 0), '每题有稳定 _id');
  assert(Boolean(pkg.paper && pkg.paper._id), '存在 paper 元数据');

  // 3) 上传资源 + 改写引用（local 后端）
  const storage = createStorage();
  const { package: finalPkg, artifacts } = await buildAndUpload({
    pkg, storage, outputDir, taskId: 'T_SMOKEN', paperId: 'P_SMOKEN',
  });

  const imgMedia = finalPkg.media.find(m => /q2_img/.test(m.path) || /q2_img/.test(m.source_path || ''));
  assert(Boolean(imgMedia), '存在题目图片 media 条目');
  assert(imgMedia && /^cloud:\/\//.test(imgMedia.path) && imgMedia.requires_upload === false, '图片引用已改写为 cloud:// 且 requires_upload=false');
  const q2 = finalPkg.questions.find(q => q.question_no === 2);
  assert(q2 && Array.isArray(q2.stem_images) && q2.stem_images.some(s => /^cloud:\/\//.test(s)), '题干图片引用已改写');
  assert(artifacts.some(a => a.type === 'markdown'), 'artifacts 含 markdown 产物');

  // 4) draft.create 所需形态
  delete finalPkg._rawMarkdown;
  assert(finalPkg.schema_version === 2 && Boolean(finalPkg.paper) && Array.isArray(finalPkg.questions), 'draft.create 所需 payload 形态正确');

  // eslint-disable-next-line no-console
  console.log(failures === 0 ? '\n冒烟测试通过 ✅' : `\n冒烟测试失败 ❌（${failures} 项）`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('冒烟测试异常：', err);
  process.exit(1);
});
