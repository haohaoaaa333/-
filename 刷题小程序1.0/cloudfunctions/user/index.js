// 云函数: user
// 合并用户相关接口: profile / statistics / dailyGoal / checkIn
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
      case 'profile':
        return await getProfile(openid);
      case 'statistics':
        return await getStatistics(openid);
      case 'daily_goal':
        return await getDailyGoal(openid);
      case 'check_in':
        return await checkIn(openid);
      case 'get_wrong':
        return await getWrong(openid, event);
      case 'get_favorites':
        return await getFavorites(openid, event);
      case 'toggle_favorite':
        return await toggleFavorite(openid, event);
      default:
        return { code: 400, message: `未知 action: ${action}` };
    }
  } catch (err) {
    return { code: 500, message: err.message };
  }
};

// 获取用户基础信息
async function getProfile(openid) {
  const res = await db.collection('users').where({ _openid: openid }).get();
  if (res.data.length === 0) {
    const newUser = createDefaultUser(openid);
    await db.collection('users').add({ data: newUser });
    return { code: 0, data: sanitizeUser(newUser), message: 'created' };
  }
  return { code: 0, data: sanitizeUser(res.data[0]), message: 'ok' };
}

// 获取学习统计
async function getStatistics(openid) {
  const res = await db.collection('users').where({ _openid: openid }).field({
    total_done: true, accuracy_rate: true, streak_days: true,
    focus_minutes: true, focus_rate: true, focus_tags: true,
    weekly_trend: true, level: true, exp: true, today_done: true,
    today_correct: true,
  }).get();

  if (res.data.length === 0) {
    return { code: 0, data: getDefaultStatistics(), message: 'ok' };
  }

  const u = res.data[0];
  const yesterdayDone = Math.max(0, u.today_done - (Math.random() * 20 | 0));
  return {
    code: 0,
    data: {
      total_questions: u.total_done || 0,
      daily_increase: u.today_done - yesterdayDone,
      avg_accuracy: u.accuracy_rate || 0,
      beat_percentage: Math.min(99, 50 + (u.accuracy_rate || 0) / 2 | 0),
      study_hours: ((u.focus_minutes || 0) / 60).toFixed(1),
      focus_rate: u.focus_rate || 85,
      focus_tags: u.focus_tags || ['常识判断', '言语理解'],
      weekly_trend: u.weekly_trend || [0, 0, 0, 0, 0, 0, 0],
    },
    message: 'ok',
  };
}

// 获取今日目标
async function getDailyGoal(openid) {
  const res = await db.collection('users').where({ _openid: openid }).field({
    today_done: true, today_goal: true, today_correct: true,
    focus_minutes: true, accuracy_rate: true,
  }).get();

  if (res.data.length === 0) {
    return { code: 0, data: { questions_done: 0, questions_goal: 100, correct_count: 0, focus_minutes: 0, accuracy: 0 } };
  }

  const u = res.data[0];
  return {
    code: 0,
    data: {
      questions_done: u.today_done || 0,
      questions_goal: u.today_goal || 100,
      correct_count: u.today_correct || 0,
      focus_minutes: u.focus_minutes || 0,
      accuracy: u.accuracy_rate || 0,
    },
  };
}

// 每日签到
async function checkIn(openid) {
  const today = new Date().toISOString().split('T')[0];
  const res = await db.collection('users').where({ _openid: openid }).get();

  if (res.data.length === 0) return { code: 404, message: '用户不存在' };

  const user = res.data[0];
  if (user.last_check_in_date === today) {
    return { code: 1, message: '今日已签到', streak_days: user.streak_days || 0 };
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const streakDays = (user.last_check_in_date === yesterday ? (user.streak_days || 0) + 1 : 1);

  await db.collection('users').doc(user._id).update({
    data: {
      is_checked_in_today: true,
      last_check_in_date: today,
      streak_days: streakDays,
      updated_at: db.serverDate(),
    },
  });

  return { code: 0, message: '签到成功', streak_days: streakDays };
}

function createDefaultUser(openid) {
  return {
    _openid: openid,
    nickname: '考公学子',
    avatar_url: '',
    vip_type: 0,
    vip_expire_at: null,
    level: 1,
    exp: 0,
    today_done: 0,
    today_goal: 100,
    today_correct: 0,
    accuracy_rate: 0,
    streak_days: 0,
    total_done: 0,
    total_correct: 0,
    focus_minutes: 0,
    focus_rate: 85,
    focus_tags: ['常识判断', '言语理解'],
    is_checked_in_today: false,
    last_check_in_date: null,
    weekly_trend: [0, 0, 0, 0, 0, 0, 0],
    created_at: db.serverDate(),
    updated_at: db.serverDate(),
  };
}

function sanitizeUser(u) {
  return {
    user_id: u._id,
    openid: u._openid,
    nickname: u.nickname,
    avatar_url: u.avatar_url,
    vip_type: u.vip_type,
    vip_expire_at: u.vip_expire_at,
    level: u.level,
    exp: u.exp,
    is_checked_in_today: u.is_checked_in_today,
  };
}

function getDefaultStatistics() {
  return {
    total_questions: 0,
    daily_increase: 0,
    avg_accuracy: 0,
    beat_percentage: 50,
    study_hours: '0',
    focus_rate: 85,
    focus_tags: ['常识判断', '言语理解'],
    weekly_trend: [0, 0, 0, 0, 0, 0, 0],
  };
}

// ============ P1-2: 错题本 / 收藏 ============

// 获取我的错题本（关联题目摘要，支持按模块/仅未掌握过滤）
async function getWrong(openid, event) {
  const { module_id, only_unmastered, page = 1, page_size = 20 } = event;
  const where = { _openid: openid };
  if (module_id) where.module_id = module_id;
  if (only_unmastered) where.mastered = false;
  const skip = (page - 1) * page_size;
  const wRes = await db.collection('wrong_questions')
    .where(where).orderBy('last_wrong_at', 'desc').skip(skip).limit(page_size).get();
  const totalRes = await db.collection('wrong_questions').where(where).count();
  const qIds = wRes.data.map(w => w.question_id);
  const qMap = {};
  if (qIds.length) {
    const qRes = await db.collection('questions')
      .where({ _id: _.in(qIds) })
      .field({ content: true, module_id: true, type: true, answer: true, difficulty: true, paper_id: true })
      .get();
    qRes.data.forEach(q => { qMap[q._id] = q; });
  }
  const list = wRes.data.map(w => {
    const q = qMap[w.question_id] || {};
    const content = typeof q.content === 'string' ? q.content : '';
    return {
      question_id: w.question_id,
      wrong_count: w.wrong_count || 0,
      mastered: !!w.mastered,
      module_id: w.module_id || q.module_id,
      type: q.type,
      difficulty: q.difficulty,
      content_preview: content.slice(0, 60),
      last_wrong_at: w.last_wrong_at,
    };
  });
  return { code: 0, data: { list, total: totalRes.total, page, page_size: page_size }, message: 'ok' };
}

// 获取我的收藏列表（关联题目摘要）
async function getFavorites(openid, event) {
  const { page = 1, page_size = 20 } = event;
  const skip = (page - 1) * page_size;
  const fRes = await db.collection('favorites')
    .where({ _openid: openid }).orderBy('created_at', 'desc').skip(skip).limit(page_size).get();
  const totalRes = await db.collection('favorites').where({ _openid: openid }).count();
  const qIds = fRes.data.map(f => f.question_id);
  const qMap = {};
  if (qIds.length) {
    const qRes = await db.collection('questions')
      .where({ _id: _.in(qIds) })
      .field({ content: true, module_id: true, type: true, answer: true, difficulty: true })
      .get();
    qRes.data.forEach(q => { qMap[q._id] = q; });
  }
  const list = fRes.data.map(f => {
    const q = qMap[f.question_id] || {};
    const content = typeof q.content === 'string' ? q.content : '';
    return {
      question_id: f.question_id,
      module_id: q.module_id,
      type: q.type,
      difficulty: q.difficulty,
      content_preview: content.slice(0, 60),
      created_at: f.created_at,
    };
  });
  return { code: 0, data: { list, total: totalRes.total, page, page_size: page_size }, message: 'ok' };
}

// 收藏/取消收藏切换（幂等）
async function toggleFavorite(openid, event) {
  const { question_id } = event;
  if (!question_id) return { code: 400, message: '缺少 question_id' };
  const exist = await db.collection('favorites').where({ _openid: openid, question_id }).limit(1).get();
  if (exist.data && exist.data.length) {
    await db.collection('favorites').doc(exist.data[0]._id).remove();
    return { code: 0, data: { favorited: false }, message: '已取消收藏' };
  }
  await db.collection('favorites').add({
    data: {
      _openid: openid,
      user_id: openid,
      question_id,
      created_at: db.serverDate(),
    },
  });
  return { code: 0, data: { favorited: true }, message: '已收藏' };
}
