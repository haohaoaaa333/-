// 云函数: seed — 批量导入种子数据（从 data.json 读取）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 从同目录 data.json 读取种子数据
const seed = require('./data.json');

/**
 * 批量 upsert：forceUpdate=true 时总是更新已存在记录，否则只插入新记录
 */
async function batchUpsert(collection, records, forceUpdate) {
  if (!records || records.length === 0) return { created: 0, updated: 0 };

  const ids = records.map(r => r._id);

  // 一次性查出所有已存在的 _id
  let existingIds = new Set();
  try {
    const res = await db.collection(collection)
      .where({ _id: _.in(ids) })
      .field({ _id: true })
      .limit(1000)
      .get();
    existingIds = new Set(res.data.map(d => d._id));
  } catch (e) { /* 集合可能为空 */ }

  // 筛选：新增 / 需更新的
  const newRecords = records.filter(r => !existingIds.has(r._id));
  const updateRecords = forceUpdate ? records.filter(r => existingIds.has(r._id)) : [];

  // 并行操作
  const tasks = [
    ...newRecords.map(r => db.collection(collection).add({ data: r }).then(() => 'created')),
    ...updateRecords.map(r => db.collection(collection).doc(r._id).set({ data: r }).then(() => 'updated')),
  ];

  const results = await Promise.allSettled(tasks);
  const created = results.filter(r => r.status === 'fulfilled' && r.value === 'created').length;
  const updated = results.filter(r => r.status === 'fulfilled' && r.value === 'updated').length;

  return { created, updated };
}

exports.main = async (event) => {
  const { action } = event;
  const result = {};
  const errors = [];

  const run = async (name, data, forceUpdate) => {
    try {
      const { created, updated } = await batchUpsert(name, data, forceUpdate);
      result[name] = updated !== undefined ? { created, updated } : { created };
    } catch (e) {
      errors.push({ collection: name, error: e.message });
    }
  };

  // VIP 方案
  if (!action || action === 'vip_plans' || action === 'all') {
    await run('vip_plans', seed.vip_plans, true);
  }

  // 分类（forceUpdate 确保 total_questions 被刷新）
  if (!action || action === 'categories' || action === 'all') {
    await run('categories', seed.categories, true);
  }

  // Banner
  if (!action || action === 'banners' || action === 'all') {
    await run('banners', seed.banners, true);
  }

  // 题目
  if (action === 'questions' || action === 'all') {
    await run('questions', seed.questions);
  }

  return {
    code: 0,
    data: result,
    errors: errors.length > 0 ? errors : undefined,
    message: '种子数据导入完成',
  };
};
