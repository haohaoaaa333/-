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
    case 'mark_mastery':
      return await markMastery(openid, event);
    case 'get_report':
      return await getReport(openid, event);
    case 'analyze':
      return await analyze(openid, event);
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
  await db.collection('practice_records').add({ data: answerData });

  // P0-B-2: 答错时写入/累加错题本 wrong_questions(收藏与掌握状态保留)
  if (!isCorrect) {
    const wRes = await db.collection('wrong_questions')
      .where({ user_id: openid, question_id })
      .limit(1)
      .get();
    if (wRes.data && wRes.data.length) {
      await db.collection('wrong_questions').doc(wRes.data[0]._id).update({
        data: {
          wrong_count: _.inc(1),
          last_wrong_at: db.serverDate(),
          updated_at: db.serverDate(),
        },
      });
    } else {
      await db.collection('wrong_questions').add({
        data: {
          _openid: openid,
          user_id: openid,
          question_id,
          module_id: module_id || qRes.data.module_id,
          wrong_count: 1,
          mastered: false,
          first_wrong_at: db.serverDate(),
          last_wrong_at: db.serverDate(),
          created_at: db.serverDate(),
          updated_at: db.serverDate(),
        },
      });
    }
  }

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

// 标记错题掌握状态(复习掌握后调用，更新 wrong_questions.mastered)
async function markMastery(openid, event) {
  const { question_id, mastered } = event;
  if (!question_id) return { code: 400, message: '缺少 question_id' };
  const wRes = await db.collection('wrong_questions').where({ user_id: openid, question_id }).limit(1).get();
  if (!wRes.data || !wRes.data.length) return { code: 404, message: '错题记录不存在' };
  await db.collection('wrong_questions').doc(wRes.data[0]._id).update({
    data: { mastered: mastered === true, updated_at: db.serverDate() },
  });
  return { code: 0, message: 'ok' };
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

  const answersRes = await db.collection('practice_records')
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

// ============ P2 AI 学习分析：错题归因 / 知识点薄弱度 ============
// 基于 practice_records(单题级) + questions.knowledge_points 聚合，
// 输出：模块正确率、知识点薄弱度排序、题型/难度归因、反复错题、复习计划。
// 计算为确定性聚合（不调用 LLM，省 AI 成本；决策 #3 AI 走本机流水线）。

// 分页拉全量（CloudBase get 默认 20/上限 100，靠 skip 翻页；按 _id 去重防止排序不稳导致重复）
async function fetchAll(collectionName, where, max = 5000, batch = 100) {
  const out = [];
  const seen = new Set();
  let skip = 0;
  while (out.length < max) {
    const res = await db.collection(collectionName).where(where).limit(batch).skip(skip).get();
    const list = res.data || [];
    for (const item of list) {
      if (item && item._id && !seen.has(item._id)) {
        seen.add(item._id);
        out.push(item);
      }
    }
    if (list.length < batch) break;
    skip += batch;
  }
  return out;
}

// 批量拉题目投影（knowledge_points / module_id / type / difficulty / content 兼容）
async function fetchQuestionsMap(qIds) {
  const map = {};
  const uniq = [...new Set(qIds)].filter(Boolean);
  const B = 100;
  for (let i = 0; i < uniq.length; i += B) {
    const chunk = uniq.slice(i, i + B);
    const res = await db.collection('questions')
      .where({ _id: _.in(chunk) })
      .field({ knowledge_points: true, module_id: true, type: true, difficulty: true, content: true })
      .get();
    (res.data || []).forEach(q => { map[q._id] = q; });
  }
  return map;
}

function bump(map, key, isCorrect) {
  if (!map[key]) map[key] = { attempts: 0, correct: 0 };
  map[key].attempts += 1;
  if (isCorrect) map[key].correct += 1;
}

function emptyAnalysis() {
  return {
    total_practiced: 0,
    overall_accuracy: 0,
    module_stats: [],
    type_stats: [],
    difficulty_stats: [],
    weak_knowledge_points: [],
    repeated_wrong: [],
    review_plan: { knowledge_points: [], question_ids: [] },
  };
}

// 学习分析主逻辑
async function analyze(openid, event) {
  const { module_id } = event;
  const where = { _openid: openid };
  if (module_id) where.module_id = module_id;

  const records = await fetchAll('practice_records', where);
  if (!records.length) {
    return { code: 0, data: emptyAnalysis(), message: 'no_records' };
  }

  const qIds = records.map(r => r.question_id);
  const qMap = await fetchQuestionsMap(qIds);

  const moduleStats = {};
  const kpStats = {};
  const typeStats = {};
  const diffStats = {};

  let correctCount = 0;
  for (const r of records) {
    const isCorrect = !!r.is_correct;
    if (isCorrect) correctCount += 1;
    const q = qMap[r.question_id] || {};
    const mod = r.module_id || q.module_id || 'unknown';
    const type = q.type || 'unknown';
    const diff = q.difficulty || 'unknown';
    const kps = Array.isArray(q.knowledge_points) ? q.knowledge_points : [];

    bump(moduleStats, mod, isCorrect);
    bump(typeStats, type, isCorrect);
    bump(diffStats, diff, isCorrect);
    for (const kp of kps) {
      const name = typeof kp === 'string' ? kp.trim() : '';
      if (!name) continue;
      if (!kpStats[name]) kpStats[name] = { name, attempts: 0, correct: 0, question_ids: new Set() };
      kpStats[name].attempts += 1;
      if (isCorrect) kpStats[name].correct += 1;
      kpStats[name].question_ids.add(r.question_id);
    }
  }

  // 错题归因：反复错题 = wrong_questions 中未掌握且 wrong_count>=2（高频易错）
  const wrongAll = await fetchAll('wrong_questions', { _openid: openid });
  const repeatedWrong = wrongAll
    .filter(w => !w.mastered && (w.wrong_count || 0) >= 2)
    .sort((a, b) => (b.wrong_count || 0) - (a.wrong_count || 0))
    .slice(0, 20)
    .map(w => {
      const q = qMap[w.question_id] || {};
      const content = typeof q.content === 'string' ? q.content : '';
      return {
        question_id: w.question_id,
        wrong_count: w.wrong_count || 0,
        mastered: !!w.mastered,
        content_preview: content.slice(0, 60),
      };
    });

  // 知识点薄弱度排序：weakness = (1 - 正确率) * 100，弱优先；同分按尝试次数多优先
  const weakKp = Object.values(kpStats).map(s => {
    const accuracy = s.attempts ? s.correct / s.attempts : 1;
    return {
      name: s.name,
      attempts: s.attempts,
      correct: s.correct,
      accuracy: Math.round(accuracy * 100),
      weakness: Math.round((1 - accuracy) * 100),
      sample_question_ids: [...s.question_ids].slice(0, 5),
    };
  }).sort((a, b) => (b.weakness - a.weakness) || (b.attempts - a.attempts)).slice(0, 15);

  const toArr = (obj) => Object.keys(obj).map(k => {
    const v = obj[k];
    return {
      key: k,
      attempts: v.attempts,
      correct: v.correct,
      accuracy: v.attempts ? Math.round((v.correct / v.attempts) * 100) : 0,
    };
  });

  const moduleArr = toArr(moduleStats).sort((a, b) => b.attempts - a.attempts);
  const typeArr = toArr(typeStats);
  const diffArr = toArr(diffStats);

  const total = records.length;
  const overallAccuracy = total ? Math.round((correctCount / total) * 100) : 0;

  // 复习计划：薄弱知识点(weakness>=30 取前8) + 反复错题 + 薄弱点样本题，去重截断 30
  const reviewKp = weakKp.filter(k => k.weakness >= 30).slice(0, 8).map(k => k.name);
  const reviewQuestions = [...new Set([
    ...repeatedWrong.map(w => w.question_id),
    ...weakKp.flatMap(k => k.sample_question_ids),
  ])].slice(0, 30);

  return {
    code: 0,
    data: {
      total_practiced: total,
      overall_accuracy: overallAccuracy,
      module_stats: moduleArr,
      type_stats: typeArr,
      difficulty_stats: diffArr,
      weak_knowledge_points: weakKp,
      repeated_wrong: repeatedWrong,
      review_plan: {
        knowledge_points: reviewKp,
        question_ids: reviewQuestions,
      },
    },
    message: 'ok',
  };
}
