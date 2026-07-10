// 云函数: home
// 首页数据聚合 — banners + 学习概览 + 分类
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 并行获取 banner、用户数据、分类
    const [bannersRes, userRes, catsRes] = await Promise.all([
      db.collection('banners').orderBy('sort', 'asc').get(),
      db.collection('users').where({ _openid: openid }).get(),
      db.collection('categories').orderBy('sort', 'asc').get(),
    ]);

    // ── banners ──
    const banners = bannersRes.data.map(b => ({
      id: b._id,
      badge: b.badge || '',
      title: b.title,
      desc: b.desc,
      color: b.color || '#1a56db',
    }));

    // ── user stats ──
    const user = userRes.data[0] || {};
    const stats = {
      today_done: user.today_done || 0,
      today_goal: user.today_goal || 100,
      accuracy_rate: user.accuracy_rate || 0,
      streak_days: user.streak_days || 0,
      total_done: user.total_done || 0,
      focus_minutes: user.focus_minutes || 0,
    };

    // ── categories ──
    const categories = catsRes.data.map(cat => ({
      category_id: cat._id,
      name: cat.name,
      icon: cat.icon,
      sort: cat.sort,
      module_count: (cat.modules || []).length,
      total_questions: (cat.modules || []).reduce((sum, m) => sum + (m.total_questions || 0), 0),
    }));

    return {
      code: 0,
      data: { banners, stats, categories },
      message: 'ok',
    };
  } catch (err) {
    return { code: 500, message: err.message };
  }
};
