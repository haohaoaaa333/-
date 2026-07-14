const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTIONS = {
  papers: 'essay_papers',
  materials: 'essay_materials',
  questions: 'essay_questions',
  answers: 'essay_answers',
};

function ok(data) { return { code: 0, data, message: 'ok' }; }
function fail(code, message) { return { code, message }; }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{3,80}$/.test(value); }
function bySequence(a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); }

exports.main = async (event = {}) => {
  try {
    if (event.action === 'list') return await listPapers();
    if (event.action === 'detail') return await getPaperDetail(event.paper_id);
    if (event.action === 'answer') return await getReferenceAnswer(event.paper_id, event.question_id);
    return fail(400, `未知 action: ${event.action || ''}`);
  } catch (error) {
    console.error(JSON.stringify({ feature: 'essay', action: event.action, error: error.message }));
    return fail(500, '申论数据加载失败，请稍后重试');
  }
};

async function listPapers() {
  const res = await db.collection(COLLECTIONS.papers).where({ status: 'enabled' }).limit(50).get();
  const papers = res.data
    .sort((a, b) => Number(b.year || 0) - Number(a.year || 0))
    .map(({ _id, title, year, exam_type, paper_level, source_kind, total_score, question_count, material_count }) => ({
      _id, title, year, exam_type, paper_level, source_kind, total_score, question_count, material_count,
    }));
  return ok({ papers });
}

async function getEnabledPaper(paperId) {
  if (!validId(paperId)) return null;
  try {
    const res = await db.collection(COLLECTIONS.papers).doc(paperId).get();
    return res.data?.status === 'enabled' ? res.data : null;
  } catch (_) {
    return null;
  }
}

async function getPaperDetail(paperId) {
  const paper = await getEnabledPaper(paperId);
  if (!paper) return fail(404, '试卷不存在或尚未发布');
  const [materialRes, questionRes] = await Promise.all([
    db.collection(COLLECTIONS.materials).where({ paper_id: paperId, status: 'enabled' }).limit(100).get(),
    db.collection(COLLECTIONS.questions).where({ paper_id: paperId, status: 'enabled' }).limit(50).get(),
  ]);
  const safePaper = {
    _id: paper._id, title: paper.title, year: paper.year, exam_type: paper.exam_type,
    paper_level: paper.paper_level, source_kind: paper.source_kind, total_score: paper.total_score,
    question_count: paper.question_count, material_count: paper.material_count,
  };
  const materials = materialRes.data.sort(bySequence).map((item) => ({
    _id: item._id,
    paper_id: item.paper_id,
    sequence: item.sequence,
    title: item.title,
    content: item.content,
  }));
  const questions = questionRes.data.sort(bySequence).map((item) => ({
    _id: item._id,
    paper_id: item.paper_id,
    sequence: item.sequence,
    primary_type: item.primary_type,
    subtype: item.subtype,
    document_genre: item.document_genre || '',
    material_ids: item.material_ids || [],
    prompt: item.prompt,
    score: item.score,
    requirements: item.requirements || {},
  }));
  return ok({ paper: safePaper, materials, questions });
}

async function getReferenceAnswer(paperId, questionId) {
  if (!validId(questionId)) return fail(400, '题目参数无效');
  const paper = await getEnabledPaper(paperId);
  if (!paper) return fail(404, '试卷不存在或尚未发布');
  let question;
  try { question = (await db.collection(COLLECTIONS.questions).doc(questionId).get()).data; } catch (_) { question = null; }
  if (!question || question.paper_id !== paperId || question.status !== 'enabled') return fail(404, '题目不存在');
  const res = await db.collection(COLLECTIONS.answers).where({ question_id: questionId, status: 'enabled' }).limit(1).get();
  if (!res.data.length) return fail(404, '该题暂无参考答案');
  const answer = res.data[0];
  return ok({ answer: {
    question_id: answer.question_id,
    answer_type: answer.answer_type,
    reference_answer: answer.reference_answer,
    answer_outline: answer.answer_outline || [],
    essay_title: answer.essay_title || '',
  } });
}
