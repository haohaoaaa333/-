// 云函数: practice
// 刷题 - 提交答案 / 获取练习报告
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
      case 'submit_answer':
        return await submitAnswer(openid, event);
      case 'get_report':
        return await getReport(openid, event);
      default:
        return { code: 400, message: `未知 action: ${action}` };
    }
  } catch (err) {
    return { code: 500, message: err.message };
  }
};

// 提交单题答案
async function submitAnswer(openid, event) {
  const { question_id, selected_option, module_id, duration_seconds } = event;

  if (!question_id || !selected_option) {
    return { code: 400, message: '缺少必填参数' };
  }

  // 获取正确答案
  const qRes = await db.collection('questions').doc(question_id).get();
  if (!qRes.data) return { code: 404, message: '题目不存在' };

  const isCorrect = qRes.data.answer === selected_option;

  // 写入答题记录
  const answerData = {
    _openid: openid,
    question_id,
    module_id: module_id || qRes.data.module_id,
    selected_option,
    is_correct: isCorrect,
    duration_seconds: duration_seconds || 0,
    created_at: db.serverDate(),
  };
  await db.collection('user_answers').add({ data: answerData });

  // 更新用户进度
  const progressRes = await db.collection('user_progress')
    .where({ _openid: openid, module_id: module_id || qRes.data.module_id })
    .get();

  if (progressRes.data.length > 0) {
    await db.collection('user_progress').doc(progressRes.data[0]._id).update({
      data: {
        done_count: _.inc(1),
        correct_count: isCorrect ? _.inc(1) : _.inc(0),
        updated_at: db.serverDate(),
      },
    });
  } else {
    await db.collection('user_progress').add({
      data: {
        _openid: openid,
        module_id: module_id || qRes.data.module_id,
        done_count: 1,
        correct_count: isCorrect ? 1 : 0,
        created_at: db.serverDate(),
        updated_at: db.serverDate(),
      },
    });
  }

  // 更新用户总统计
  const userRes = await db.collection('users').where({ _openid: openid }).get();
  if (userRes.data.length > 0) {
    await db.collection('users').doc(userRes.data[0]._id).update({
      data: {
        today_done: _.inc(1),
        today_correct: isCorrect ? _.inc(1) : _.inc(0),
        total_done: _.inc(1),
        total_correct: isCorrect ? _.inc(1) : _.inc(0),
        updated_at: db.serverDate(),
      },
    });
  }

  return {
    code: 0,
    data: {
      is_correct: isCorrect,
      correct_answer: qRes.data.answer,
      explanation: qRes.data.explanation,
    },
    message: 'ok',
  };
}

// 获取练习报告
async function getReport(openid, event) {
  const { module_id, date } = event;

  const query = { _openid: openid };
  if (module_id) query.module_id = module_id;

  if (date) {
    const startOfDay = new Date(date + 'T00:00:00+08:00');
    const endOfDay = new Date(date + 'T23:59:59+08:00');
    query.created_at = _.gte(startOfDay).and(_.lte(endOfDay));
  }

  const answersRes = await db.collection('user_answers')
    .where(query)
    .orderBy('created_at', 'desc')
    .get();

  const total = answersRes.data.length;
  const correct = answersRes.data.filter(a => a.is_correct).length;

  // 按难度统计
  const difficultyStats = {};
  answersRes.data.forEach(a => {
    // 从 question_id 中提取（此处简化，实际可查 questions 表）
  });

  // 按标签统计
  const tagStats = {};

  return {
    code: 0,
    data: {
      total,
      correct,
      wrong: total - correct,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      avg_duration: total > 0
        ? Math.round(answersRes.data.reduce((s, a) => s + (a.duration_seconds || 0), 0) / total)
        : 0,
      difficulty_stats: difficultyStats,
      tag_stats: tagStats,
      records: answersRes.data.map(a => ({
        question_id: a.question_id,
        selected_option: a.selected_option,
        is_correct: a.is_correct,
        duration_seconds: a.duration_seconds,
        created_at: a.created_at,
      })),
    },
    message: 'ok',
  };
}
