// 云函数: importQuestions (V2 通用导入器)
//
// ⚠️ V2 迁移说明 (P0-A2):
//   旧版 importQuestions 直接把题目 add 进 `questions` 正式题库，绕过了
//   "question_drafts → 审核 → questions" 的闭环，与《考公宝 V2.0 数据库设计》
//   第 4 节"旧数据迁移"要求冲突。
//
//   新版改为: 所有来源(question_batches / import_inline / OCR)先转换成 V2 草稿
//   格式，写入 `draft_papers` + `question_drafts`；题目 review_status=pending、
//   answer.verified 由原始选项字母决定。之后由管理后台的草稿审核 → publish
//   流程正式落库到 `questions`。这保证了所有题库来源统一走审核闭环。
//
//   注意: 写入的 question_drafts 文档 _id 必须严格使用 itemId(draftId, questionId)，
//   与 admin/features/drafts-v2.js 的算法保持一致，否则审核/发布按 question_id
//   反查会失败。(若以后 drafts-v2 抽出共享模块，应改为引用之。)
//
// 用法 (event):
//   { action: "stats" }                                  查看草稿/正式库统计
//   { action: "list_batches" }                           列出 question_batches 中可用批次
//   { action: "import",       batchId: "batch_07" }      导入指定批次 → 写 question_drafts
//   { action: "import_all" }                             导入 question_batches 全部批次
//   { action: "repair",       batchId: "batch_07" }      仅补该批次缺失草稿
//   { action: "repair_all" }                            全部批次补缺
//   { action: "import_inline", questions: [...] }        直接导入传入的题目数组(小批量/OCR)
//   { action: "clear", confirm: true }                  清空 published questions + 草稿集合(危险)
//
// 数据来源优先级:
//   1. event.questions (inline，用于 OCR/小批量)
//   2. question_batches 集合里 batchId 对应的 doc.questions
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const BATCH_COLLECTION = 'question_batches';
const DRAFT_PAPER_COLLECTION = 'draft_papers';
const DRAFT_QUESTION_COLLECTION = 'question_drafts';
const DRAFT_ASSET_COLLECTION = 'draft_assets'; // P0-B-1: 原始证据链(由本机 AI 结构化流水线填充)
const PUBLISHED_COLLECTION = 'questions'; // 仅 clear 时引用，正常导入不再直写
const SOURCE = 'batch_import';
const BATCH_SIZE = 100;
const LETTERS = ['A', 'B', 'C', 'D'];

// 必须与 admin/features/drafts-v2.js 的 itemId 保持一致
function itemId(draftId, questionId) {
  const hash = crypto.createHash('sha1').update(String(questionId)).digest('hex').slice(0, 16);
  return `qd_${draftId.replace(/^draft_/, '').slice(0, 42)}_${hash}`;
}

const txt = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : (v == null ? '' : String(v)));
const arr = (v) => (Array.isArray(v) ? v : []);

function mapType(t) {
  const s = txt(t);
  if (s.startsWith('multi')) return 'multiple_choice';
  return 'single_choice';
}

/**
 * 平铺题目(来自 question_batches / OCR) → V2 草稿子对象
 * 返回 { qid, question, solution, isModData, material, assetSource }
 *
 * assetSource: 来自本机 AI 结构化流水线(structure_questions.py)的 source_evidence，
 * 或 OCR 产物的 source_page/source_markdown 等；批种子题通常为空，仅保留题目关联。
 */
function convertQuestion(q) {
  const qid = txt(q._id);
  const opts = arr(q.options);
  const answerLetter = txt(q.answer).toUpperCase();
  const answerIndex = LETTERS.indexOf(answerLetter);
  const isModData = txt(q.module_id) === 'mod_data';
  const stem = txt(q.content);
  const material = txt(q.material);
  const ev = q.source_evidence || {};

  const question = {
    _id: qid,
    question_number: Number(q.question_number || 0),
    module_id: txt(q.module_id) || null,
    type: mapType(q.type),
    content: stem,
    stem: stem,
    stem_blocks: stem ? [{ type: 'text', text: stem }] : [],
    material,
    material_blocks: material ? [{ type: 'text', text: material }] : [],
    options: opts.slice(0, 4).map((o) => (typeof o === 'string' ? o : txt(o && (o.text || o.content)))),
    options_v2: opts.slice(0, 4).map((o, i) => {
      const t = typeof o === 'string' ? o : txt(o && (o.text || o.content));
      return { key: LETTERS[i], text: t, content_blocks: t ? [{ type: 'text', text: t }] : [] };
    }),
    answer: answerIndex,
    answer_index: answerIndex,
    answer_verified: answerIndex >= 0,
    review_confirmed: answerIndex >= 0,
    difficulty: txt(q.difficulty) || 'medium',
    knowledge_points: arr(q.knowledge_points),
    tags: arr(q.tags),
    source: txt(q.source),
    year: Number(q.year) || null,
    province: txt(q.province),
    position: txt(q.position),
  };
  const solution = {
    question_id: qid,
    explanation: txt(q.explanation),
    explanation_blocks: txt(q.explanation) ? [{ type: 'text', text: txt(q.explanation) }] : [],
  };

  // P0-B-1: 抽取证据链，供 draft_assets 写入(无则留空，仅保持题目关联)
  const assetSource = {
    task_id: txt(q.source_task_id) || txt(ev.task_id) || null,
    pdf_page: Number(q.source_page != null ? q.source_page : ev.page) || null,
    pdf_image: txt(ev.pdf_image) || txt(q.source_pdf_image) || null,
    question_image: txt(ev.question_image) || txt(q.source_question_image) || null,
    mineru_markdown: txt(ev.raw_text) || txt(q.source_markdown) || null,
    layout_json: q.source_layout || ev.layout_json || null,
    bbox: Array.isArray(q.bbox) ? q.bbox : (Array.isArray(ev.bbox) ? ev.bbox : []),
  };

  return { qid, question, solution, isModData, material, assetSource };
}

// 同一次导入内复用 draft_paper，避免重复建卷
const draftIdByPaperId = {};

async function ensureCollections() {
  for (const name of [DRAFT_PAPER_COLLECTION, DRAFT_QUESTION_COLLECTION, DRAFT_ASSET_COLLECTION]) {
    try { await db.createCollection(name); } catch (_) { /* 已存在 */ }
  }
}

async function getOrCreateDraftPaper(paperId, paperName, sample) {
  if (draftIdByPaperId[paperId]) return draftIdByPaperId[paperId];
  const existing = await db.collection(DRAFT_PAPER_COLLECTION)
    .where({ paper_id: paperId, source: SOURCE })
    .limit(1)
    .get();
  if (existing.data && existing.data.length) {
    draftIdByPaperId[paperId] = existing.data[0]._id;
    return existing.data[0]._id;
  }
  const draftId = `draft_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const doc = {
    _id: draftId,
    doc_type: 'draft_paper_v2',
    schema_version: '2.0',
    task_id: null,
    source: SOURCE,
    paper_name: paperName || paperId,
    paper_id: paperId,
    status: 'pending',
    raw_markdown: '',
    raw_markdown_truncated: false,
    package_meta: {
      schema_version: 2,
      paper: {
        _id: paperId,
        title: paperName || paperId,
        subject: txt(sample && sample.subject) || '公务员',
        category: txt(sample && sample.category) || '国考',
        year: Number(sample && sample.year) || new Date().getFullYear(),
        source: txt(sample && sample.source) || 'official',
      },
      groups: [],
      media: [],
      validation_errors: [],
      validation_warnings: [],
    },
    counts: { total: 0, approved: 0, rejected: 0, pending: 0, needs_fix: 0 },
    version: 1,
    created_by: null,
    created_at: db.serverDate(),
    updated_at: db.serverDate(),
  };
  await db.collection(DRAFT_PAPER_COLLECTION).add({ data: doc });
  draftIdByPaperId[paperId] = draftId;
  return draftId;
}

async function upsertDraftQuestion(draftId, paperId, qid, question, solution, repairOnly) {
  const id = itemId(draftId, qid);
  try {
    const r = await db.collection(DRAFT_QUESTION_COLLECTION).doc(id).get();
    if (r && r.data) {
      if (repairOnly) return 'skipped';
      await db.collection(DRAFT_QUESTION_COLLECTION).doc(id).update({
        data: {
          question,
          solution: solution || null,
          question_no: Number(question.question_number || 0),
          module_id: question.module_id,
          group_id: question.group_id || null,
          version: Number(r.data.version || 1) + 1,
          updated_at: db.serverDate(),
        },
      });
      return 'updated';
    }
  } catch (e) {
    if (!/not\s+exist|not\s+found|DATABASE_DOCUMENT_NOT_EXIST/i.test(String((e && e.message) || e))) throw e;
  }
  await db.collection(DRAFT_QUESTION_COLLECTION).add({
    data: {
      _id: id,
      doc_type: 'question_draft_v2',
      schema_version: '2.0',
      draft_id: draftId,
      paper_id: paperId,
      question_id: qid,
      question_no: Number(question.question_number || 0),
      module_id: question.module_id,
      group_id: question.group_id || null,
      question,
      solution: solution || null,
      edit: {},
      review_status: 'pending',
      review_note: '',
      edited: false,
      ai_review: null,
      version: 1,
      created_at: db.serverDate(),
      updated_at: db.serverDate(),
    },
  });
  return 'created';
}

// P0-B-1: 每个草稿题对应一条原始证据(draft_assets)，保存 PDF 页/图/markdown/layout/bbox。
async function upsertDraftAsset(draftId, paperId, qid, assetSource) {
  const id = `asset_${crypto.createHash('sha1').update(String(qid)).digest('hex').slice(0, 16)}`;
  const data = {
    draft_id: draftId,
    paper_id: paperId,
    question_id: qid,
    task_id: assetSource.task_id,
    pdf_page: assetSource.pdf_page,
    pdf_image: assetSource.pdf_image,
    question_image: assetSource.question_image,
    mineru_markdown: assetSource.mineru_markdown,
    layout_json: assetSource.layout_json,
    bbox: assetSource.bbox,
    updated_at: db.serverDate(),
  };
  try {
    const r = await db.collection(DRAFT_ASSET_COLLECTION).doc(id).get();
    if (r && r.data) {
      await db.collection(DRAFT_ASSET_COLLECTION).doc(id).update({ data });
      return 'updated';
    }
  } catch (e) {
    if (!/not\s+exist|not\s+found|DATABASE_DOCUMENT_NOT_EXIST/i.test(String((e && e.message) || e))) throw e;
  }
  await db.collection(DRAFT_ASSET_COLLECTION).add({ data: { _id: id, ...data, created_at: db.serverDate() } });
  return 'created';
}

/**
 * 根据草稿里所有 mod_data 题的 material 重建资料分析组。
 * 用 material 的 sha1 作为稳定 group_id，保证多次导入幂等、跨批次可累积。
 */
async function rebuildDraftGroups(draftId) {
  const items = [];
  for (let off = 0; ; off += 100) {
    const page = await db.collection(DRAFT_QUESTION_COLLECTION)
      .where({ draft_id: draftId })
      .field({ question_id: true, module_id: true, question: true, group_id: true })
      .skip(off)
      .limit(100)
      .get();
    if (!page.data || !page.data.length) break;
    items.push(...page.data);
  }
  const map = new Map();
  const updates = [];
  for (const it of items) {
    const q = it.question || {};
    if (txt(q.module_id) !== 'mod_data') continue;
    const mat = txt(q.material);
    if (!mat) continue;
    const gid = `grp_${crypto.createHash('sha1').update(mat).digest('hex').slice(0, 16)}`;
    if (!map.has(gid)) {
      map.set(gid, {
        _id: gid,
        module_id: 'mod_data',
        material_text: mat,
        material_blocks: [{ type: 'text', text: mat }],
        question_ids: [],
        status: 'enabled',
      });
    }
    if (!map.get(gid).question_ids.includes(it.question_id)) map.get(gid).question_ids.push(it.question_id);
    if (it.group_id !== gid) updates.push({ id: it._id, group_id: gid });
  }
  for (const u of updates) {
    await db.collection(DRAFT_QUESTION_COLLECTION).doc(u.id).update({ data: { group_id: u.group_id, updated_at: db.serverDate() } });
  }
  const groupArr = [...map.values()];
  await db.collection(DRAFT_PAPER_COLLECTION).doc(draftId).update({
    data: { 'package_meta.groups': groupArr, updated_at: db.serverDate() },
  });
  return groupArr;
}

async function refreshDraftCounts(draftId) {
  const items = await db.collection(DRAFT_QUESTION_COLLECTION)
    .where({ draft_id: draftId })
    .limit(1000)
    .field({ review_status: true })
    .get();
  const counts = { total: 0, approved: 0, rejected: 0, pending: 0, needs_fix: 0 };
  for (const it of (items.data || [])) {
    const s = it.review_status || 'pending';
    counts[s] = (counts[s] || 0) + 1;
    counts.total += 1;
  }
  await db.collection(DRAFT_PAPER_COLLECTION).doc(draftId).update({ data: { counts, updated_at: db.serverDate() } });
  return counts;
}

/**
 * 核心: 把一批平铺题目写入 question_drafts (按 paper_id 分卷)。
 */
async function importQuestionsList(questions, repairOnly) {
  const byPaper = new Map();
  for (const q of questions) {
    const pid = txt(q.paper_id) || 'unknown';
    if (!byPaper.has(pid)) byPaper.set(pid, []);
    byPaper.get(pid).push(q);
  }
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const drafts = [];
  for (const [pid, qs] of byPaper) {
    const paperName = txt(qs[0].paper_name) || pid;
    const draftId = await getOrCreateDraftPaper(pid, paperName, qs[0]);
    const converted = qs.map(convertQuestion);
    for (const c of converted) {
      try {
        const res = await upsertDraftQuestion(draftId, pid, c.qid, c.question, c.solution, repairOnly);
        if (res === 'created') imported += 1;
        else if (res === 'skipped') skipped += 1;
        else if (!repairOnly) skipped += 1; // updated
        // P0-B-1: 同步写入原始证据链(无论 batch/OCR 路径)
        await upsertDraftAsset(draftId, pid, c.qid, c.assetSource);
      } catch (e) {
        errors += 1;
        console.error('[importQuestions] draft item failed', c.qid, e.message);
      }
    }
    await rebuildDraftGroups(draftId);
    const counts = await refreshDraftCounts(draftId);
    drafts.push({ paper_id: pid, draft_id: draftId, counts });
  }
  return { imported, skipped, errors, drafts };
}

exports.main = async (event, context) => {
  const { action } = event || {};
  try {
    switch (action) {
      case 'stats':
        return await getStats();
      case 'list_batches':
        return await listBatches();
      case 'import':
        await ensureCollections();
        return await importBatch(event.batchId, false);
      case 'import_all':
        await ensureCollections();
        return await importAllBatches(false);
      case 'repair':
        await ensureCollections();
        return await importBatch(event.batchId, true);
      case 'repair_all':
        await ensureCollections();
        return await importAllBatches(true);
      case 'import_inline':
        await ensureCollections();
        return await importInline(event.questions || [], event);
      case 'clear':
        return await clearAll(event.confirm);
      default:
        return {
          code: 400,
          message: `未知 action: ${action}。可用: stats, list_batches, import, import_all, repair, repair_all, import_inline, clear`,
        };
    }
  } catch (err) {
    console.error('[importQuestions]', err);
    return { code: 500, message: err.message };
  }
};

/**
 * 读取某批次的题目数组(来自 question_batches 集合)
 */
async function loadBatchQuestions(batchId) {
  if (!batchId) throw new Error('缺少 batchId 参数');
  const res = await db.collection(BATCH_COLLECTION).doc(batchId).get();
  const doc = res.data;
  if (!doc) throw new Error(`批次不存在: ${batchId} (请在 question_batches 集合中创建该记录)`);
  const questions = doc.questions || [];
  if (!Array.isArray(questions) || questions.length === 0) throw new Error(`批次 ${batchId} 的 questions 为空`);
  return questions;
}

async function importBatch(batchId, repairOnly) {
  const questions = await loadBatchQuestions(batchId);
  const result = await importQuestionsList(questions, repairOnly);
  return {
    code: 0,
    data: { batchId, ...result },
    message: `[V2] 批次 ${batchId} 已写入 question_drafts: 新增 ${result.imported}, 跳过 ${result.skipped}, 失败 ${result.errors}`,
  };
}

async function importAllBatches(repairOnly) {
  const listRes = await db.collection(BATCH_COLLECTION).limit(100).get();
  const batches = listRes.data || [];
  const summary = [];
  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  for (const b of batches) {
    try {
      const questions = b.questions || [];
      const r = await importQuestionsList(questions, repairOnly);
      summary.push({ batchId: b._id, imported: r.imported, skipped: r.skipped, errors: r.errors });
      totalImported += r.imported;
      totalSkipped += r.skipped;
      totalErrors += r.errors;
    } catch (err) {
      summary.push({ batchId: b._id, error: err.message });
      totalErrors += 1;
    }
  }
  return {
    code: 0,
    data: { totalImported, totalSkipped, totalErrors, batches: summary },
    message: `[V2] 全部批次已写入 question_drafts: 新增 ${totalImported}, 跳过 ${totalSkipped}, 失败 ${totalErrors}`,
  };
}

async function importInline(questions, event) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { code: 400, message: 'import_inline 需要非空 questions 数组' };
  }
  const paperId = txt(event.paper_id) || txt(questions[0].paper_id) || `inline_${Date.now()}`;
  const paperName = txt(event.paper_name) || txt(questions[0].paper_name) || '内联导入卷';
  const result = await importQuestionsList(questions, false);
  return {
    code: 0,
    data: { paper_id: paperId, ...result },
    message: `[V2] 内联题目已写入 question_drafts (${paperName}): 新增 ${result.imported}, 跳过 ${result.skipped}, 失败 ${result.errors}`,
  };
}

async function listBatches() {
  const res = await db.collection(BATCH_COLLECTION).limit(100).get();
  const list = (res.data || []).map((b) => ({
    batchId: b._id,
    count: Array.isArray(b.questions) ? b.questions.length : 0,
    year: b.year || null,
    label: b.label || null,
  }));
  return { code: 0, data: { batches: list, total: list.length }, message: 'ok' };
}

async function getStats() {
  const draftPapers = await db.collection(DRAFT_PAPER_COLLECTION).count();
  const draftQuestions = await db.collection(DRAFT_QUESTION_COLLECTION).count();
  const draftAssets = await db.collection(DRAFT_ASSET_COLLECTION).count();
  const published = await db.collection(PUBLISHED_COLLECTION).count();
  const modRes = await db.collection(DRAFT_QUESTION_COLLECTION)
    .aggregate()
    .group({ _id: '$module_id', count: { $sum: 1 } })
    .end();
  return {
    code: 0,
    data: {
      draft_papers: draftPapers.total,
      question_drafts: draftQuestions.total,
      draft_assets: draftAssets.total,
      published_questions: published.total,
      question_drafts_by_module: modRes.list,
      note: 'V2: 导入先落 question_drafts，经草稿审核(publish)才进入 questions',
    },
    message: 'ok',
  };
}

/**
 * 危险操作: 清空 published questions + 草稿集合。
 * 开发期数据可清空，用此做全量重置。需要 confirm: true。
 */
async function clearCollectionByName(name, confirm) {
  if (confirm !== true) return { skipped: true };
  let deleted = 0;
  let rounds = 0;
  const MAX_ROUNDS = 200;
  while (rounds < MAX_ROUNDS) {
    const res = await db.collection(name).limit(100).get();
    if (!res.data || res.data.length === 0) break;
    const ids = res.data.map((d) => d._id);
    await db.collection(name).where({ _id: _.in(ids) }).remove();
    deleted += ids.length;
    rounds += 1;
  }
  return { deleted, rounds };
}

async function clearAll(confirm) {
  if (confirm !== true) {
    return { code: 400, message: '危险操作！请传入 { "action": "clear", "confirm": true } 以确认清空(草稿 + 正式库)' };
  }
  const drafts = await clearCollectionByName(DRAFT_QUESTION_COLLECTION, true);
  const papers = await clearCollectionByName(DRAFT_PAPER_COLLECTION, true);
  const assets = await clearCollectionByName(DRAFT_ASSET_COLLECTION, true);
  const published = await clearCollectionByName(PUBLISHED_COLLECTION, true);
  return {
    code: 0,
    data: { question_drafts: drafts, draft_papers: papers, draft_assets: assets, questions: published },
    message: `已清空草稿与正式库: question_drafts=${drafts.deleted}, draft_papers=${papers.deleted}, draft_assets=${assets.deleted}, questions=${published.deleted}`,
  };
}
