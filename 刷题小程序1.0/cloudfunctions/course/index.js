// 云函数: course
// 课程分类和模块查询
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action, category_id } = event;

  try {
    switch (action) {
      case 'categories':
        return await getCategories(openid);
      case 'modules':
        return await getModules(openid, category_id);
      default:
        return { code: 400, message: `未知 action: ${action}` };
    }
  } catch (err) {
    return { code: 500, message: err.message };
  }
};

// 获取所有分类（含子模块列表）
async function getCategories(openid) {
  const catsRes = await db.collection('categories')
    .orderBy('sort', 'asc')
    .get();

  if (catsRes.data.length === 0) {
    return { code: 0, data: getDefaultCategories(), message: 'default' };
  }

  // 获取用户进度
  const progressRes = await db.collection('user_progress')
    .where({ _openid: openid })
    .get();

  const progressMap = {};
  progressRes.data.forEach(p => {
    progressMap[p.module_id] = p;
  });

  const categories = catsRes.data.map(cat => ({
    category_id: cat._id,
    name: cat.name,
    icon: cat.icon,
    sort: cat.sort,
    modules: (cat.modules || []).map(m => {
      const prog = progressMap[m.module_id] || {};
      return {
        module_id: m.module_id,
        name: m.name,
        total_questions: m.total_questions || 0,
        done_count: prog.done_count || 0,
        correct_count: prog.correct_count || 0,
        accuracy: prog.done_count > 0
          ? Math.round((prog.correct_count / prog.done_count) * 100)
          : 0,
      };
    }),
  }));

  return { code: 0, data: categories, message: 'ok' };
}

// 获取分类下的模块列表
async function getModules(openid, categoryId) {
  const catsRes = await db.collection('categories')
    .doc(categoryId)
    .get();

  if (!catsRes.data) {
    return { code: 404, message: '分类不存在' };
  }

  const progressRes = await db.collection('user_progress')
    .where({ _openid: openid })
    .get();

  const progressMap = {};
  progressRes.data.forEach(p => {
    progressMap[p.module_id] = p;
  });

  const cat = catsRes.data;
  const modules = (cat.modules || []).map(m => {
    const prog = progressMap[m.module_id] || {};
    return {
      module_id: m.module_id,
      name: m.name,
      description: m.description,
      total_questions: m.total_questions || 0,
      done_count: prog.done_count || 0,
      correct_count: prog.correct_count || 0,
      accuracy: prog.done_count > 0
        ? Math.round((prog.correct_count / prog.done_count) * 100)
        : 0,
    };
  });

  return { code: 0, data: { category: cat.name, modules }, message: 'ok' };
}

function getDefaultCategories() {
  return [
    {
      category_id: 'default_1',
      name: '行测',
      icon: '📝',
      sort: 1,
      modules: [
        { module_id: 'shenlun', name: '申论', total_questions: 0, done_count: 0, correct_count: 0, accuracy: 0 },
        { module_id: 'xingce', name: '行测', total_questions: 0, done_count: 0, correct_count: 0, accuracy: 0 },
      ],
    },
  ];
}
