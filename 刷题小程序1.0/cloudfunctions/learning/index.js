// 云函数: learning
// 学习仪表盘 / 最近学习记录
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action } = event;

  try {
    switch (action) {
      case 'dashboard':
        return await getDashboard(openid);
      case 'recent':
        return await getRecent(openid);
      default:
        return { code: 400, message: `未知 action: ${action}` };
    }
  } catch (err) {
    return { code: 500, message: err.message };
  }
};

// 获取学习仪表盘数据
async function getDashboard(openid) {
  const userRes = await db.collection('users')
    .where({ _openid: openid })
    .field({
      total_done: true, accuracy_rate: true, streak_days: true,
      focus_minutes: true, weekly_trend: true, today_done: true,
      today_correct: true,
    })
    .get();

  const user = userRes.data[0] || {};

  // 最近7天刷题趋势
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const recordsRes = await db.collection('practice_sessions')
    .where({
      _openid: openid,
      created_at: _.gte(sevenDaysAgo),
    })
    .field({ created_at: true, count: true })
    .get();

  // 按日期聚合
  const dailyMap = {};
  recordsRes.data.forEach(r => {
    const date = new Date(r.created_at).toISOString().split('T')[0];
    dailyMap[date] = (dailyMap[date] || 0) + (r.count || 0);
  });

  const weeklyTrend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().split('T')[0];
    weeklyTrend.push(dailyMap[d] || 0);
  }

  return {
    code: 0,
    data: {
      total_questions: user.total_done || 0,
      accuracy_rate: user.accuracy_rate || 0,
      streak_days: user.streak_days || 0,
      focus_minutes: user.focus_minutes || 0,
      today_done: user.today_done || 0,
      today_correct: user.today_correct || 0,
      weekly_trend: weeklyTrend.length > 0 ? weeklyTrend : (user.weekly_trend || [0, 0, 0, 0, 0, 0, 0]),
    },
    message: 'ok',
  };
}

// 获取最近学习记录
async function getRecent(openid) {
  const recordsRes = await db.collection('practice_sessions')
    .where({ _openid: openid })
    .orderBy('created_at', 'desc')
    .limit(30)
    .get();

  return {
    code: 0,
    data: recordsRes.data.map(r => ({
      record_id: r._id,
      module_id: r.module_id,
      module_name: r.module_name,
      question_count: r.count,
      correct_count: r.correct_count,
      accuracy: r.count > 0 ? Math.round((r.correct_count / r.count) * 100) : 0,
      duration_seconds: r.duration_seconds,
      created_at: r.created_at,
    })),
    message: 'ok',
  };
}
