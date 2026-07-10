// importQuestions11 — 导入 batch_11
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const allQuestions = require('./batch_11.json');

exports.main = async (event, context) => {
  const { action } = event || {};

  switch (action) {
    case 'count':
      return { code: 0, data: { total: allQuestions.length, batch: 'batch_11' } };
    case 'repair':
      return await repairImport();
    default:
      return await importAll();
  }
};

async function importAll() {
  const BATCH_SIZE = 100;
  let imported = 0;
  let errors = 0;

  for (let i = 0; i < allQuestions.length; i += BATCH_SIZE) {
    const chunk = allQuestions.slice(i, i + BATCH_SIZE);
    try {
      await db.collection('questions').add({ data: chunk });
      imported += chunk.length;
    } catch (err) {
      console.error('Chunk ' + Math.floor(i / BATCH_SIZE) + ' failed:', err.message);
      errors += chunk.length;
    }
  }

  return {
    code: 0,
    data: { imported, errors, total: allQuestions.length },
    message: '导入完成: ' + imported + '/' + allQuestions.length + ', 失败: ' + errors,
  };
}

async function repairImport() {
  const batchIds = allQuestions.map(q => q._id);
  const existingIds = new Set();

  // Query existing IDs in batches of 500 (CloudBase _.in limit)
  for (let i = 0; i < batchIds.length; i += 500) {
    const idChunk = batchIds.slice(i, i + 500);
    const res = await db.collection('questions')
      .where({ _id: _.in(idChunk) })
      .field({ _id: true })
      .limit(500)
      .get();
    res.data.forEach(d => existingIds.add(d._id));
  }

  const missing = allQuestions.filter(q => !existingIds.has(q._id));

  if (missing.length === 0) {
    return {
      code: 0,
      data: { existing: existingIds.size, missing: 0, imported: 0 },
      message: '无需修复: 全部 ' + existingIds.size + ' 题已存在'
    };
  }

  const BATCH_SIZE = 100;
  let imported = 0;
  let errors = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const chunk = missing.slice(i, i + BATCH_SIZE);
    try {
      await db.collection('questions').add({ data: chunk });
      imported += chunk.length;
    } catch (err) {
      console.error('Repair chunk failed:', err.message);
      errors += chunk.length;
    }
  }

  return {
    code: 0,
    data: { existing: existingIds.size, missing: missing.length, imported, errors },
    message: '修复完成: 已存在 ' + existingIds.size + ', 缺失 ' + missing.length + ', 导入 ' + imported + ', 失败 ' + errors
  };
}