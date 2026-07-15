// 云函数: importQuestions (V2 通用导入器)
//
// 设计动机:
//   旧版有 importQuestions1~12 共 12 份几乎完全相同的函数，每份硬编码一份
//   batch_NN.json 静态题库。当初拆 12 个是因为云函数包体 ~1.2MB 上限，把
//   ~10MB 数据全塞进一个函数会部署失败。但 12 份拷贝的重复逻辑是最大维护风险。
//
// V2 方案:
//   单一函数 + 数据外置。batch 数据存放在数据库集合 `question_batches`
//   (每个 doc 一个批次，含 questions 数组)，函数按 batchId 参数读取后导入
//   `questions` 集合。不再有编号函数，未来新试卷(2025国考/省考/教资...)只需
//   往 question_batches 加一条记录即可，无需新增函数。
//
// 用法 (event):
//   { action: "stats" }                                  查询 questions 统计
//   { action: "list_batches" }                           列出 question_batches 中可用批次
//   { action: "import",       batchId: "batch_07" }      导入指定批次(跳过已存在)
//   { action: "import_all" }                             导入 question_batches 全部批次
//   { action: "repair",       batchId: "batch_07" }      仅补该批次缺失题目
//   { action: "repair_all" }                            全部批次补缺
//   { action: "import_inline", questions: [...] }        直接导入传入的题目数组(小批量/OCR)
//   { action: "clear", confirm: true }                  清空 questions 集合(危险)
//
// 数据来源优先级:
//   1. event.questions (inline，用于 OCR/小批量)
//   2. question_batches 集合里 batchId 对应的 doc.questions
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const BATCH_COLLECTION = 'question_batches';
const TARGET_COLLECTION = 'questions';
const BATCH_SIZE = 100;

exports.main = async (event, context) => {
  const { action } = event || {};
  try {
    switch (action) {
      case 'stats':
        return await getStats();
      case 'list_batches':
        return await listBatches();
      case 'import':
        return await importBatch(event.batchId, false);
      case 'import_all':
        return await importAllBatches(false);
      case 'repair':
        return await importBatch(event.batchId, true);
      case 'repair_all':
        return await importAllBatches(true);
      case 'import_inline':
        return await importQuestions(event.questions || [], false);
      case 'clear':
        return await clearCollection(event.confirm);
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
  if (!batchId) {
    throw new Error('缺少 batchId 参数');
  }
  const res = await db.collection(BATCH_COLLECTION).doc(batchId).get();
  const doc = res.data;
  if (!doc) {
    throw new Error(`批次不存在: ${batchId} (请在 question_batches 集合中创建该记录)`);
  }
  const questions = doc.questions || [];
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`批次 ${batchId} 的 questions 为空`);
  }
  return questions;
}

/**
 * 导入单个批次
 * @param {boolean} repairOnly  true=仅补缺失, false=全量(仍跳过已存在避免重复)
 */
async function importBatch(batchId, repairOnly) {
  const questions = await loadBatchQuestions(batchId);
  const result = await importQuestions(questions, repairOnly);
  return {
    code: 0,
    data: { batchId, ...result },
    message: `批次 ${batchId} 处理完成: 导入 ${result.imported}, 跳过 ${result.skipped}, 失败 ${result.errors}`,
  };
}

/**
 * 导入全部批次
 */
async function importAllBatches(repairOnly) {
  const listRes = await db.collection(BATCH_COLLECTION).limit(100).get();
  const batches = listRes.data || [];
  const summary = [];
  let totalImported = 0;
  let totalErrors = 0;

  for (const b of batches) {
    try {
      const questions = b.questions || [];
      const r = await importQuestions(questions, repairOnly);
      summary.push({ batchId: b._id, imported: r.imported, skipped: r.skipped, errors: r.errors });
      totalImported += r.imported;
      totalErrors += r.errors;
    } catch (err) {
      summary.push({ batchId: b._id, error: err.message });
      totalErrors += 1;
    }
  }

  return {
    code: 0,
    data: { totalImported, totalErrors, batches: summary },
    message: `全部批次处理完成: 导入 ${totalImported}, 失败 ${totalErrors}`,
  };
}

/**
 * 核心导入逻辑: 分批写入 questions 集合
 * @param {Array}  questions  题目数组
 * @param {boolean} repairOnly true=仅写入数据库中不存在(_id缺失)的题目
 */
async function importQuestions(questions, repairOnly) {
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const chunk = questions.slice(i, i + BATCH_SIZE);

    // repair 模式: 先查已存在的 _id, 只写缺失的
    let toWrite = chunk;
    if (repairOnly) {
      const ids = chunk.map(q => q._id).filter(Boolean);
      const existing = new Set();
      for (let j = 0; j < ids.length; j += 500) {
        const idChunk = ids.slice(j, j + 500);
        const res = await db.collection(TARGET_COLLECTION)
          .where({ _id: _.in(idChunk) })
          .field({ _id: true })
          .limit(500)
          .get();
        res.data.forEach(d => existing.add(d._id));
      }
      toWrite = chunk.filter(q => !q._id || !existing.has(q._id));
      skipped += chunk.length - toWrite.length;
    } else {
      // 全量模式也跳过已存在, 避免重复导入报错
      const ids = chunk.map(q => q._id).filter(Boolean);
      if (ids.length > 0) {
        const existing = new Set();
        for (let j = 0; j < ids.length; j += 500) {
          const idChunk = ids.slice(j, j + 500);
          const res = await db.collection(TARGET_COLLECTION)
            .where({ _id: _.in(idChunk) })
            .field({ _id: true })
            .limit(500)
            .get();
          res.data.forEach(d => existing.add(d._id));
        }
        const before = toWrite.length;
        toWrite = chunk.filter(q => !q._id || !existing.has(q._id));
        skipped += before - toWrite.length;
      }
    }

    if (toWrite.length === 0) continue;

    try {
      await db.collection(TARGET_COLLECTION).add({ data: toWrite });
      imported += toWrite.length;
    } catch (err) {
      console.error('Chunk failed:', err.message);
      errors += toWrite.length;
    }
  }

  return { imported, skipped, errors, total: questions.length };
}

/**
 * 列出 question_batches 中可用批次
 */
async function listBatches() {
  const res = await db.collection(BATCH_COLLECTION).limit(100).get();
  const list = (res.data || []).map(b => ({
    batchId: b._id,
    count: Array.isArray(b.questions) ? b.questions.length : 0,
    year: b.year || null,
    label: b.label || null,
  }));
  return { code: 0, data: { batches: list, total: list.length }, message: 'ok' };
}

/**
 * 查看导入统计
 */
async function getStats() {
  const countRes = await db.collection(TARGET_COLLECTION).count();
  const modulesRes = await db.collection(TARGET_COLLECTION)
    .aggregate()
    .group({ _id: '$module_id', count: { $sum: 1 } })
    .end();
  const yearsRes = await db.collection(TARGET_COLLECTION)
    .aggregate()
    .group({ _id: '$year', count: { $sum: 1 } })
    .sort({ _id: 1 })
    .end();

  return {
    code: 0,
    data: {
      total: countRes.total,
      by_module: modulesRes.list,
      by_year: yearsRes.list,
    },
    message: 'ok',
  };
}

/**
 * 清空 questions 集合(需要 confirm: true)
 */
async function clearCollection(confirm) {
  if (confirm !== true) {
    return {
      code: 400,
      message: '危险操作！请传入 { "action": "clear", "confirm": true } 以确认清空 questions 集合',
    };
  }
  let deleted = 0;
  let rounds = 0;
  const MAX_ROUNDS = 100;
  while (rounds < MAX_ROUNDS) {
    const res = await db.collection(TARGET_COLLECTION).limit(100).get();
    if (!res.data || res.data.length === 0) break;
    const ids = res.data.map(d => d._id);
    await db.collection(TARGET_COLLECTION).where({ _id: _.in(ids) }).remove();
    deleted += ids.length;
    rounds++;
  }
  return { code: 0, data: { deleted, rounds }, message: `已清空 questions 集合，共删除 ${deleted} 条记录` };
}
