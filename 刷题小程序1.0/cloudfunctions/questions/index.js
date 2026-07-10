// 云函数: questions
// 题目查询 - 获取题目详情 / 按条件获取题目列表 / 用于练习 / 试卷列表
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action, question_id, module_id, year, paper_id, page = 1, page_size = 20, limit } = event;

  try {
    switch (action) {
      case 'get_detail':
        return await getDetail(openid, question_id);
      case 'get_by_module':
        return await getByModule(openid, module_id, page, page_size);
      case 'get_for_practice':
        return await getForPractice(openid, module_id, year, limit, event);
      case 'get_by_year':
        return await getByYear(openid, year);
      case 'get_by_paper':
        return await getByPaper(openid, paper_id, year);
      case 'get_papers':
        return await getPapers(openid);
      case 'get_module_counts':
        return await getModuleCounts(year);
      default:
        return { code: 400, message: `未知 action: ${action}` };
    }
  } catch (err) {
    return { code: 500, message: err.message };
  }
};

/**
 * 清理选项：部分旧数据把下一道题文本拼到了最后一个选项里，按换行截断
 */
function cleanOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map(opt => {
    if (typeof opt !== 'string') return String(opt);
    const idx = opt.search(/\n\s*[（(][一二三四五六七八九十]+[）)]/);
    return idx > 0 ? opt.slice(0, idx).trim() : opt.trim();
  }).filter(opt => opt.length > 0);
}

/**
 * 判断一段内容是否更像题干而非材料
 */
function looksLikeQuestion(content) {
  if (!content) return false;
  return /[？\?]/.test(content) || /^\d+[、.．]/.test(content.trim());
}

function isEnabled(q) {
  return q.status !== 'disabled';
}

/**
 * 统一格式化题目输出，包含纸卷扩展字段
 */
function formatQuestion(q, materialMap = {}) {
  // 纸卷字段：现有数据若缺失则用默认值
  const paperId = q.paper_id || `${q.year}`;
  const content = (q.content || '').trim();
  // 资料分析题材料：优先用 DB 中的 material 字段，其次 materialMap，再尝试 content 自包含
  const material = q.module_id === 'mod_data'
    ? (q.material || materialMap[q._id] || (content.length > 80 && !looksLikeQuestion(content) ? content : ''))
    : '';
  return {
    question_id: q._id,
    module_id: q.module_id,
    type: q.type || 'single',
    difficulty: q.difficulty || '中等',
    content: content,
    material: material,
    material_images: Array.isArray(q.material_images) ? q.material_images : [],
    stem_images: Array.isArray(q.stem_images) ? q.stem_images : [],
    options: cleanOptions(q.options),
    option_images: Array.isArray(q.option_images) ? q.option_images : [],
    answer: q.answer != null ? q.answer : 0,
    explanation: q.explanation || '',
    explanation_images: Array.isArray(q.explanation_images) ? q.explanation_images : [],
    tags: q.tags || [],
    year: q.year,
    // 纸卷扩展字段（v2）
    paper_id: paperId,
    paper_name: q.paper_name || paperId,
    province: q.province || '国家',
    position: q.position || '',
    paper_date: q.paper_date || '',
  };
}

/**
 * 为资料分析题附加共享材料
 * 策略：按 (source, year) 分组，组内 content 最长且不包含问号的条目视为材料
 */
async function attachMaterialForDataAnalysis(questions) {
  if (!questions || questions.length === 0) return {};
  // 只处理资料分析模块里 content 较短或没有材料的题
  const needMaterial = questions.filter(q => q.module_id === 'mod_data' && (q.content || '').trim().length < 120);
  if (needMaterial.length === 0) return {};

  const groups = {};
  needMaterial.forEach(q => {
    const key = `${q.source || ''}|${q.year || 0}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(q);
  });

  const materialMap = {};
  for (const key of Object.keys(groups)) {
    const [source, year] = key.split('|');
    const qs = groups[key];
    try {
      const where = { module_id: 'mod_data', year: Number(year) || 0 };
      if (source) where.source = source;
      const res = await db.collection('questions')
        .where(where)
        .field({ _id: true, content: true })
        .limit(100)
        .get();
      const candidates = res.data.filter(d => (d.content || '').trim().length > 80);
      if (candidates.length === 0) continue;
      // 优先选不包含问号且最长的 content 作为材料
      const material = candidates
        .sort((a, b) => {
          const aQ = looksLikeQuestion(a.content) ? 1 : 0;
          const bQ = looksLikeQuestion(b.content) ? 1 : 0;
          if (aQ !== bQ) return aQ - bQ; // 不含问号的排前面
          return b.content.length - a.content.length; // 长的排前面
        })[0];
      if (material && material.content && material.content.trim().length > 0) {
        qs.forEach(q => { materialMap[q._id] = material.content.trim(); });
      }
    } catch (err) {
      console.log('[questions] attachMaterial error:', err.message);
    }
  }
  return materialMap;
}

// 获取题目详情
async function getDetail(openid, questionId) {
  if (!questionId) return { code: 400, message: '缺少 question_id' };
  const res = await db.collection('questions').doc(questionId).get();
  if (!res.data) return { code: 404, message: '题目不存在' };
  const materialMap = await attachMaterialForDataAnalysis([res.data]);
  return { code: 0, data: formatQuestion(res.data, materialMap), message: 'ok' };
}

// 按模块获取题目列表（分页，不含答案）
async function getByModule(openid, moduleId, page, pageSize) {
  if (!moduleId) return { code: 400, message: '缺少 module_id' };
  const skip = (page - 1) * pageSize;
  const res = await db.collection('questions')
    .where({ module_id: moduleId })
    .field({ module_id: true, type: true, difficulty: true, content: true, material_images: true, stem_images: true, options: true, option_images: true, tags: true, status: true })
    .skip(skip).limit(pageSize).get();
  const totalRes = await db.collection('questions').where({ module_id: moduleId }).count();
  const answeredRes = await db.collection('user_answers')
    .where({ _openid: openid, module_id: moduleId }).field({ question_id: true, is_correct: true }).get();
  const answeredMap = {};
  answeredRes.data.forEach(a => { answeredMap[a.question_id] = a.is_correct; });
  return {
    code: 0,
    data: {
      list: res.data.filter(isEnabled).map(q => ({
        question_id: q._id, type: q.type, difficulty: q.difficulty,
        content: q.content, material_images: q.material_images || [], stem_images: q.stem_images || [], options: q.options, option_images: q.option_images || [], tags: q.tags,
        answered: answeredMap.hasOwnProperty(q._id), is_correct: answeredMap[q._id],
      })),
      total: totalRes.total, page, page_size: pageSize,
    },
    message: 'ok',
  };
}

/**
 * 获取练习用题目（按 module_id / year 筛选，返回完整数据含答案）
 * module_id 可选：不传查询全部模块
 */
async function getForPractice(openid, moduleId, year, limit = 20, event) {
  const where = {};
  if (moduleId) where.module_id = moduleId;
  if (year && year > 0) where.year = year;

  const countRes = await db.collection('questions').where(where).count();
  const total = countRes.total;
  if (total === 0) {
    const label = moduleId ? `模块 ${moduleId}` : '全部模块';
    return { code: 0, data: { list: [], total: 0, has_more: false }, message: `${label}${year ? ' 年份 ' + year : ''} 暂无题目` };
  }

  const fetchLimit = Math.min(limit, total);
  const randomSkip = total > fetchLimit ? Math.floor(Math.random() * (total - fetchLimit)) : 0;

  const res = await db.collection('questions')
    .where(where)
    .field({ _id: true, module_id: true, type: true, difficulty: true, content: true, material: true, material_images: true, stem_images: true, options: true, option_images: true, answer: true, explanation: true, explanation_images: true, tags: true, year: true, source: true, paper_id: true, paper_name: true, province: true, position: true, paper_date: true, status: true })
    .skip(randomSkip).limit(fetchLimit).get();

  // 为资料分析题补全共享材料
  const enabled = res.data.filter(isEnabled);
  const materialMap = await attachMaterialForDataAnalysis(enabled);

  return {
    code: 0,
    data: { list: enabled.map(q => formatQuestion(q, materialMap)), total, has_more: total > fetchLimit },
    message: 'ok',
  };
}

/**
 * 按年份获取全部题目（用于历年真题试卷）
 */
async function getByYear(openid, year) {
  if (!year || year <= 0) return { code: 400, message: '缺少 year 参数' };
  const where = { year };
  const countRes = await db.collection('questions').where(where).count();
  const total = countRes.total;
  if (total === 0) return { code: 0, data: { list: [], total: 0, year }, message: `${year}年暂无题目` };
  const res = await db.collection('questions')
    .where(where)
    .field({ _id: true, module_id: true, type: true, difficulty: true, content: true, material: true, material_images: true, stem_images: true, options: true, option_images: true, answer: true, explanation: true, explanation_images: true, tags: true, year: true, source: true, paper_id: true, paper_name: true, province: true, position: true, paper_date: true, status: true })
    .orderBy('module_id', 'asc').orderBy('_id', 'asc').limit(1000).get();

  const enabled = res.data.filter(isEnabled);
  const materialMap = await attachMaterialForDataAnalysis(enabled);

  return {
    code: 0,
    data: { list: enabled.map(q => formatQuestion(q, materialMap)), total: enabled.length, year, has_more: total > res.data.length },
    message: 'ok',
  };
}

/**
 * 按 paper_id 获取该纸卷全部题目（v2：支持精确纸卷）
 */
async function getByPaper(openid, paperId, year) {
  if (!paperId) return { code: 400, message: '缺少 paper_id' };
  const where = { paper_id: paperId };
  if (year && year > 0) where.year = year;
  const res = await db.collection('questions')
    .where(where)
    .field({ _id: true, module_id: true, type: true, difficulty: true, content: true, material: true, material_images: true, stem_images: true, options: true, option_images: true, answer: true, explanation: true, explanation_images: true, tags: true, year: true, source: true, paper_id: true, paper_name: true, province: true, position: true, paper_date: true, status: true })
    .orderBy('module_id', 'asc').limit(1000).get();

  const enabled = res.data.filter(isEnabled);
  const materialMap = await attachMaterialForDataAnalysis(enabled);

  return {
    code: 0,
    data: { list: enabled.map(q => formatQuestion(q, materialMap)), total: enabled.length, paper_id: paperId },
    message: 'ok',
  };
}

/**
 * 获取试卷列表（按年份分组，每年作为一个纸卷）
 * 当数据有 paper_id 时优先按 paper_id 分组；否则按年份分组
 */
async function getPapers(openid) {
  let groups = [];

  // 优先尝试 aggregate 分组（性能最好）
  try {
    const aggRes = await db.collection('questions')
      .aggregate()
      .group({
        _id: '$year',
        count: $.sum(1),
        paper_id: $.first('$paper_id'),
        paper_name: $.first('$paper_name'),
        province: $.first('$province'),
        paper_date: $.first('$paper_date'),
      })
      .sort({ _id: -1 })
      .end();

    if (aggRes && aggRes.list && aggRes.list.length > 0) {
      groups = aggRes.list.map(g => ({
        year: g._id,
        count: g.count,
        paper_id: g.paper_id || `${g._id}`,
        paper_name: g.paper_name || `${g._id}年国家公务员考试行测真题`,
        province: g.province || '国家',
        paper_date: g.paper_date || '',
      }));
    }
  } catch (aggErr) {
    console.log('[questions] aggregate 分组失败，回退到逐year count:', aggErr.message);
  }

  // aggregate 失败或无结果，回退到逐 year count
  if (groups.length === 0) {
    const startYear = 2000;
    const endYear = new Date().getFullYear();
    for (let y = endYear; y >= startYear; y--) {
      const countRes = await db.collection('questions').where({ year: y }).count();
      if (countRes.total > 0) {
        const sampleRes = await db.collection('questions')
          .where({ year: y })
          .field({ paper_id: true, paper_name: true, province: true, paper_date: true, year: true })
          .limit(1).get();
        const s = sampleRes.data[0] || {};
        groups.push({
          year: y,
          count: countRes.total,
          paper_id: s.paper_id || `${y}`,
          paper_name: s.paper_name || `${y}年国家公务员考试行测真题`,
          province: s.province || '国家',
          paper_date: s.paper_date || '',
        });
      }
    }
  }

  if (groups.length === 0) {
    return { code: 0, data: { papers: [], total: 0 }, message: '暂无试卷' };
  }

  const papers = groups.map(g => ({
    paper_id: g.paper_id,
    paper_name: g.paper_name,
    year: g.year,
    province: g.province,
    paper_date: g.paper_date,
    question_count: g.count,
  }));

  return { code: 0, data: { papers, total: papers.length }, message: 'ok' };
}

/**
 * 获取各模块题目数量（按年份筛选）
 */
async function getModuleCounts(year) {
  const modules = ['mod_common_sense', 'mod_language', 'mod_quantity', 'mod_logic', 'mod_data'];
  const results = await Promise.allSettled(
    modules.map(async mid => {
      const where = year && year > 0 ? { module_id: mid, year } : { module_id: mid };
      const res = await db.collection('questions').where(where).count();
      return { module_id: mid, total: res.total };
    })
  );
  const countMap = {};
  results.forEach(r => { if (r.status === 'fulfilled') countMap[r.value.module_id] = r.value.total; });
  return { code: 0, data: { counts: countMap }, message: 'ok' };
}
