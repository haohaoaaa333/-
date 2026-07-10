// 云函数: importQuestions (编排器 / 统计查询入口)
//
// v3 — 12 子函数（每函数 1 个 batch，确保单函数 < 1.2MB，避免 400 错误）
//
// ┌──────────────────┬──────────┬─────────┐
// │ 子云函数           │ 批次      │ 大小     │
// ├──────────────────┼──────────┼─────────┤
// │ importQuestions1  │ batch_01 │  561 KB  │
// │ importQuestions2  │ batch_02 │  585 KB  │
// │ importQuestions3  │ batch_03 │  705 KB  │
// │ importQuestions4  │ batch_04 │  807 KB  │
// │ importQuestions5  │ batch_05 │  797 KB  │
// │ importQuestions6  │ batch_06 │  849 KB  │
// │ importQuestions7  │ batch_07 │  966 KB  │
// │ importQuestions8  │ batch_08 │  962 KB  │
// │ importQuestions9  │ batch_09 │  753 KB  │
// │ importQuestions10 │ batch_10 │  913 KB  │
// │ importQuestions11 │ batch_11 │ 1138 KB  │
// │ importQuestions12 │ batch_12 │  728 KB  │
// └──────────────────┴──────────┴─────────┘
// 用法:
//   { action: "stats" }                   — 查询数据库统计
//   { action: "import_all" }             — 返回 12 个子函数执行计划（全量导入）
//   { action: "repair_all" }             — 返回 12 个子函数修复计划（增量补缺）
//   { action: "clear", confirm: true }   — 清空 questions 集合（慎用）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action, confirm } = event;

  try {
    switch (action) {
      case 'import_all':
        return planImportAll();
      case 'repair_all':
        return planRepairAll();
      case 'stats':
        return await getStats();
      case 'clear':
        return await clearCollection(confirm);
      default:
        return {
          code: 400,
          message: `未知 action: ${action}。可用: import_all, repair_all, stats, clear`,
        };
    }
  } catch (err) {
    console.error('[importQuestions]', err);
    return { code: 500, message: err.message };
  }
};

/**
 * 返回修复执行计划（增量补缺）
 */
function planRepairAll() {
  return {
    code: 0,
    message: '请按顺序调用以下 12 个子云函数的 repair action（自动跳过已有题目，只补缺失）',
    data: {
      note: '每个子函数会先查数据库已有 ID，然后只导入缺失的题目。全部完成后调用 stats 验证',
      steps: [
        { functionName: 'importQuestions1',  params: { action: 'repair' } },
        { functionName: 'importQuestions2',  params: { action: 'repair' } },
        { functionName: 'importQuestions3',  params: { action: 'repair' } },
        { functionName: 'importQuestions4',  params: { action: 'repair' } },
        { functionName: 'importQuestions5',  params: { action: 'repair' } },
        { functionName: 'importQuestions6',  params: { action: 'repair' } },
        { functionName: 'importQuestions7',  params: { action: 'repair' } },
        { functionName: 'importQuestions8',  params: { action: 'repair' } },
        { functionName: 'importQuestions9',  params: { action: 'repair' } },
        { functionName: 'importQuestions10', params: { action: 'repair' } },
        { functionName: 'importQuestions11', params: { action: 'repair' } },
        { functionName: 'importQuestions12', params: { action: 'repair' } },
      ],
    },
  };
}

/**
 * 返回全量导入的执行计划（不实际调用子函数）
 */
function planImportAll() {
  return {
    code: 0,
    message: '请按顺序调用以下 12 个子云函数（每函数 1 个 batch 文件，~500 题/函数）',
    data: {
      note: '在微信开发者工具云函数测试面板中逐个调用，无需传参',
      totalExpected: 5820,
      steps: [
        { functionName: 'importQuestions1',  batch: 'batch_01', size: '561KB' },
        { functionName: 'importQuestions2',  batch: 'batch_02', size: '585KB' },
        { functionName: 'importQuestions3',  batch: 'batch_03', size: '705KB' },
        { functionName: 'importQuestions4',  batch: 'batch_04', size: '807KB' },
        { functionName: 'importQuestions5',  batch: 'batch_05', size: '797KB' },
        { functionName: 'importQuestions6',  batch: 'batch_06', size: '849KB' },
        { functionName: 'importQuestions7',  batch: 'batch_07', size: '966KB' },
        { functionName: 'importQuestions8',  batch: 'batch_08', size: '962KB' },
        { functionName: 'importQuestions9',  batch: 'batch_09', size: '753KB' },
        { functionName: 'importQuestions10', batch: 'batch_10', size: '913KB' },
        { functionName: 'importQuestions11', batch: 'batch_11', size: '1138KB' },
        { functionName: 'importQuestions12', batch: 'batch_12', size: '728KB' },
      ],
    },
  };
}

/**
 * 查看导入统计
 */
async function getStats() {
  const countRes = await db.collection('questions').count();
  const modulesRes = await db.collection('questions')
    .aggregate()
    .group({ _id: '$module_id', count: { $sum: 1 } })
    .end();

  const yearsRes = await db.collection('questions')
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
 * 清空 questions 集合（需要 confirm: true）
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
    const res = await db.collection('questions')
      .limit(100)
      .get();
    if (!res.data || res.data.length === 0) break;

    const ids = res.data.map(d => d._id);
    await db.collection('questions')
      .where({ _id: _.in(ids) })
      .remove();

    deleted += ids.length;
    rounds++;
  }

  return {
    code: 0,
    data: { deleted, rounds },
    message: `已清空 questions 集合，共删除 ${deleted} 条记录`,
  };
}
