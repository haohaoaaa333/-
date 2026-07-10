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
