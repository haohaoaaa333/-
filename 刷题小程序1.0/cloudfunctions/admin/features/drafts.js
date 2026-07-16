// 云函数特性: question_drafts (AI/OCR 中间层 — 草稿箱)
//
// 设计动机 (来自 V2 架构评审第②条, 最关键的一条):
//   AI/OCR 识别结果绝不能直进正式题库。必须经历
//      草稿(drafts) -> 人工审核(逐题通过/驳回/修正) -> 发布(publish)
//   这一道闸口, 才能写入 questions / xingce_* 正式集合。
//
// 本模块只负责「草稿的存储与审核状态」, 发布动作复用 xingceFeature.importXingcePackage,
// 避免重复实现 V2 包写入逻辑。这样草稿层是一个纯闸口, 不重写发布路径。
//
// 外部调用约定:
//   admin 云函数 switch 中 `case 'draft'` 转派到本模块的 router(event),
//   子动作由 event.draft_action 决定:
//     create   { source, paper_name, paper_id, raw_markdown, package }
//     append   { draft_id, questions }                    // 追加题目（解决大包体问题）
//     list     { status?, page?, page_size? }
//     get      { draft_id }
//     update   { draft_id, review?, edits?, comments? }
//     approve  { draft_id, question_ids? }     // 空=全部
//     reject   { draft_id, question_ids?, reason? }
//     ai_review { draft_id, question_id }       // 只生成 AI 建议，不自动通过
//     publish  { draft_id }                    // 已通过的题目 -> import_xingce_package
//     delete   { draft_id }
//     stats    {}
//
// 数据模型 (question_drafts 集合, 单 doc 一整套来源试卷):
//   {
//     _id, source, paper_name, paper_id, status: pending|published|archived,
//     raw_markdown, package: {papers,groups,questions,solutions,media...},
//     review: { [questionId]: { status, edited, comment, updated_at } },
//     edits: { [questionId]: { answer?, analysis? } },   // 人工修正覆盖
//     counts: { total, approved, rejected, pending },
//     created_at, updated_at, published_at?
//   }

const COLLECTION = 'question_drafts';
const hy3Review = require('./hy3-review');

function buildModule({ db, ok, fail }) {
  // 复用 xingce 的发布逻辑 (校验 + 写入 questions/xingce_*)
  const xingceFeature = require('./xingce')({ db, ok, fail });

  const array = v => (Array.isArray(v) ? v : []);
  const text = v => (typeof v === 'string' ? v.trim() : '');
  const LETTERS = ['A', 'B', 'C', 'D'];

  function mergeById(existing, incoming, key) {
    const result = array(existing).slice();
    const positions = new Map(result.map((item, index) => [text(item && item[key]), index]));
    for (const item of array(incoming)) {
      const id = text(item && item[key]);
      if (!id) continue;
      if (positions.has(id)) result[positions.get(id)] = item;
      else {
        positions.set(id, result.length);
        result.push(item);
      }
    }
    return result;
  }

  function sanitizeEditPatch(patch) {
    const result = {};
    if (!patch || typeof patch !== 'object') return result;
    if (typeof patch.stem === 'string') result.stem = patch.stem.trim();
    if (Array.isArray(patch.options)) result.options = patch.options.slice(0, 4).map(value => text(value));
    if (typeof patch.answer === 'string') result.answer = text(patch.answer).toUpperCase();
    if (typeof patch.analysis === 'string') result.analysis = patch.analysis.trim();
    if (typeof patch.material === 'string') result.material = patch.material.trim();
    if (typeof patch.module_id === 'string') result.module_id = text(patch.module_id);
    if (typeof patch.review_confirmed === 'boolean') result.review_confirmed = patch.review_confirmed;
    return result;
  }

  async function ensureCollection() {
    try {
      await db.createCollection(COLLECTION);
    } catch (e) {
      // 已存在则忽略
      if (!/already\s+exist/i.test(String(e.message || e))) {
        // 非"已存在"错误也忽略, 让后续写入暴露真实问题
      }
    }
  }

  function genDraftId() {
    return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function computeCounts(pkg, review) {
    const questions = array(pkg && pkg.questions);
    const reviewMap = review || {};
    let approved = 0, rejected = 0, pending = 0;
    for (const q of questions) {
      const st = (reviewMap[q._id] && reviewMap[q._id].status) || 'pending';
      if (st === 'approved') approved += 1;
      else if (st === 'rejected') rejected += 1;
      else pending += 1;
    }
    return { total: questions.length, approved, rejected, pending };
  }

  // ── CREATE ─────────────────────────────────────────────
  async function createDraft(event) {
    const pkg = event.package || {};
    const questions = array(pkg.questions);
    if (questions.length === 0) return fail(422, '草稿包没有可审核的题目');
    if (Number(pkg.schema_version) !== 2 || !pkg.paper) return fail(422, '草稿包必须是新版 V2 整卷结构');

    const draftId = genDraftId();
    const review = {};
    for (const q of questions) {
      review[q._id] = { status: 'pending', edited: false, comment: '', updated_at: db.serverDate() };
    }
    const doc = {
      _id: draftId,
      source: text(event.source) || 'manual',
      paper_name: text(event.paper_name) || text(pkg.paper_title) || text(pkg.paper && pkg.paper._id) || '未命名试卷',
      paper_id: text(event.paper_id) || text(pkg.paper_id) || text(pkg.paper && pkg.paper._id) || '',
      status: 'pending',
      raw_markdown: text(event.raw_markdown),
      raw_markdown_truncated: event.raw_markdown_truncated === true,
      source_task_id: text(event.source_task_id),
      package: pkg,
      review,
      edits: {},
      counts: computeCounts(pkg, review),
      created_at: db.serverDate(),
      updated_at: db.serverDate(),
    };
    await ensureCollection();
    await db.collection(COLLECTION).add({ data: doc });
    return ok({ draft_id: draftId, counts: doc.counts }, '草稿已创建，等待审核');
  }

  // ── APPEND ─────────────────────────────────────────────
  // 分批追加题目，避免单请求 payload 超过 CloudBase 100KB 限制
  async function appendDraft(event) {
    const draftId = text(event.draft_id);
    if (!draftId) return fail(400, '缺少 draft_id');
    const newQuestions = array(event.questions);
    if (newQuestions.length === 0) return fail(422, '没有可追加的题目');

    const res = await db.collection(COLLECTION).doc(draftId).get();
    if (!res.data) return fail(404, '草稿不存在');
    const draft = res.data;
    if (draft.status === 'published') return fail(409, '已发布草稿不能追加题目');

    const pkg = draft.package || {};
    const questions = array(pkg.questions);
    const review = draft.review || {};
    for (const q of newQuestions) {
      if (!q || !q._id) continue;
      const existingIndex = questions.findIndex(item => text(item && item._id) === text(q._id));
      if (existingIndex >= 0) questions[existingIndex] = q;
      else questions.push(q);
      review[q._id] = { status: 'pending', edited: false, comment: '', updated_at: db.serverDate() };
    }
    pkg.questions = questions;
    pkg.solutions = mergeById(pkg.solutions, event.solutions, 'question_id');
    pkg.groups = mergeById(pkg.groups, event.groups, '_id');
    pkg.media = mergeById(pkg.media, event.media, 'asset_id');
    const counts = computeCounts(pkg, review);
    await db.collection(COLLECTION).doc(draftId).update({
      data: { package: pkg, review, counts, updated_at: db.serverDate() },
    });
    return ok({ draft_id: draftId, counts }, `已追加 ${newQuestions.length} 道题`);
  }

  // ── LIST ──────────────────────────────────────────────
  async function listDrafts(event) {
    const status = text(event.status);
    const page = Math.max(1, Number(event.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(event.page_size) || 20));
    let query = db.collection(COLLECTION);
    if (status) query = query.where({ status });
    const countRes = await query.count();
    const listRes = await query
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .field({ raw_markdown: false, package: false, review: false, edits: false })
      .get();
    const drafts = (listRes.data || []).map(d => ({
      draft_id: d._id,
      source: d.source,
      paper_name: d.paper_name,
      paper_id: d.paper_id,
      status: d.status,
      counts: d.counts,
      created_at: d.created_at,
      updated_at: d.updated_at,
    }));
    return ok({ total: countRes.total, page, page_size: pageSize, drafts }, 'ok');
  }

  // ── GET ───────────────────────────────────────────────
  async function getDraft(event) {
    const draftId = text(event.draft_id);
    if (!draftId) return fail(400, '缺少 draft_id');
    const res = await db.collection(COLLECTION).doc(draftId).get();
    if (!res.data) return fail(404, '草稿不存在');
    return ok(res.data, 'ok');
  }

  // ── UPDATE (edits + review decisions + comments) ──────
  async function updateDraft(event) {
    const draftId = text(event.draft_id);
    if (!draftId) return fail(400, '缺少 draft_id');
    const res = await db.collection(COLLECTION).doc(draftId).get();
    if (!res.data) return fail(404, '草稿不存在');
    const draft = res.data;
    const review = draft.review || {};
    const edits = draft.edits || {};

    // 审核决策
    const decisions = event.review || {};
    for (const [qid, st] of Object.entries(decisions)) {
      if (!['approved', 'rejected', 'pending'].includes(st)) continue;
      review[qid] = { ...(review[qid] || { status: 'pending', edited: false, comment: '' }), status: st, updated_at: db.serverDate() };
    }
    // 人工修正覆盖 (answer / analysis)
    const editMap = event.edits || {};
    for (const [qid, patch] of Object.entries(editMap)) {
      if (!patch || typeof patch !== 'object') continue;
      edits[qid] = { ...(edits[qid] || {}), ...sanitizeEditPatch(patch) };
      review[qid] = {
        ...(review[qid] || { status: 'pending', edited: false, comment: '' }),
        status: 'pending',
        edited: true,
        updated_at: db.serverDate(),
      };
    }
    // 备注
    const comments = event.comments || {};
    for (const [qid, c] of Object.entries(comments)) {
      review[qid] = { ...(review[qid] || { status: 'pending', edited: false, comment: '' }), comment: text(c), updated_at: db.serverDate() };
    }

    const counts = computeCounts(draft.package, review);
    await db.collection(COLLECTION).doc(draftId).update({ data: { review, edits, counts, updated_at: db.serverDate() } });
    return ok({ draft_id: draftId, counts }, '草稿已更新');
  }

  // ── APPROVE / REJECT (set status) ─────────────────────
  async function setStatus(event, status) {
    const draftId = text(event.draft_id);
    if (!draftId) return fail(400, '缺少 draft_id');
    const res = await db.collection(COLLECTION).doc(draftId).get();
    if (!res.data) return fail(404, '草稿不存在');
    const draft = res.data;
    const review = draft.review || {};
    const ids = array(event.question_ids);
    const target = ids.length ? ids : array(draft.package.questions).map(q => q._id);
    if (!ids.length && status === 'approved') {
      return fail(422, '为避免整卷误发布，已取消无条件“全部通过”；请逐题确认，或只提交明确的 question_ids');
    }
    for (const qid of target) {
      review[qid] = { ...(review[qid] || { status: 'pending', edited: false, comment: '' }), status, updated_at: db.serverDate() };
    }
    const counts = computeCounts(draft.package, review);
    await db.collection(COLLECTION).doc(draftId).update({ data: { review, counts, updated_at: db.serverDate() } });
    return ok({ draft_id: draftId, counts }, status === 'approved' ? '已通过' : '已驳回');
  }

  // ── AI REVIEW (single question) ───────────────────────
  // 批量审核由管理台逐题调用，避免云函数单次执行超时。
  async function reviewWithAI(event) {
    const draftId = text(event.draft_id);
    const questionId = text(event.question_id);
    if (!draftId) return fail(400, '缺少 draft_id');
    if (!questionId) return fail(400, '缺少 question_id');

    const res = await db.collection(COLLECTION).doc(draftId).get();
    if (!res.data) return fail(404, '草稿不存在');
    const draft = res.data;
    if (draft.status === 'published') return fail(409, '已发布草稿不能重新进行 AI 审核');
    if (!array(draft.package && draft.package.questions).some(q => text(q && q._id) === questionId)) {
      return fail(404, '题目不存在');
    }

    let aiReview;
    try {
      aiReview = await hy3Review.reviewQuestion(draft, questionId);
    } catch (error) {
      const message = String(error && error.message || 'AI 审核失败');
      const code = error && error.code === 'AI_NOT_CONFIGURED' ? 503 : 502;
      return fail(code, message);
    }

    const review = draft.review || {};
    review[questionId] = {
      ...(review[questionId] || { status: 'pending', edited: false, comment: '' }),
      ai_review: { ...aiReview, reviewed_at: new Date().toISOString() },
      updated_at: db.serverDate(),
    };
    await db.collection(COLLECTION).doc(draftId).update({
      data: { review, updated_at: db.serverDate() },
    });
    return ok({ draft_id: draftId, question_id: questionId, ai_review: review[questionId].ai_review }, 'AI 审核完成');
  }

  // ── PUBLISH (approved -> import_xingce_package) ───────
  async function publishDraft(event) {
    const draftId = text(event.draft_id);
    if (!draftId) return fail(400, '缺少 draft_id');
    const res = await db.collection(COLLECTION).doc(draftId).get();
    if (!res.data) return fail(404, '草稿不存在');
    const draft = res.data;
    if (draft.status === 'published') return fail(409, '该草稿已发布');

    const counts = computeCounts(draft.package, draft.review);
    if (counts.total === 0) return fail(422, '草稿没有题目');
    if (counts.pending > 0 || counts.rejected > 0 || counts.approved !== counts.total) {
      return fail(422, `整卷发布要求全部题目通过：通过 ${counts.approved}，待审 ${counts.pending}，驳回 ${counts.rejected}`);
    }

    const approvedIds = new Set(
      Object.entries(draft.review || {})
        .filter(([, r]) => r && r.status === 'approved')
        .map(([id]) => id)
    );
    if (approvedIds.size !== counts.total) return fail(422, '审核状态与题目数量不一致，请刷新草稿后重试');

    const edits = draft.edits || {};
    const pkg = draft.package || {};
    const questions = array(pkg.questions)
      .map(q => {
        const e = edits[q._id];
        if (!e) return q;
        const nq = { ...q };
        if (e.stem !== undefined) {
          nq.content = e.stem;
          nq.stem = e.stem;
          const imageBlocks = array(nq.stem_blocks).filter(block => block && block.type === 'image');
          nq.stem_blocks = [...(e.stem ? [{ type: 'text', text: e.stem }] : []), ...imageBlocks];
        }
        if (Array.isArray(e.options) && e.options.length === 4) {
          nq.options_v2 = LETTERS.map((key, index) => {
            const original = array(nq.options_v2)[index] || {};
            const imageBlocks = array(original.content_blocks).filter(block => block && block.type === 'image');
            return {
              ...original,
              key,
              text: text(e.options[index]),
              content_blocks: [...(text(e.options[index]) ? [{ type: 'text', text: text(e.options[index]) }] : []), ...imageBlocks],
            };
          });
          nq.options = e.options.map(text);
        }
        if (e.answer) {
          const idx = LETTERS.indexOf(String(e.answer).toUpperCase());
          if (idx >= 0) {
            nq.answer = idx;
            nq.answer_index = idx;
            nq.answer_verified = true;
          }
        }
        if (e.module_id) nq.module_id = e.module_id;
        if (typeof e.review_confirmed === 'boolean') nq.review_confirmed = e.review_confirmed;
        return nq;
      });
    const solutions = array(pkg.solutions)
      .map(s => {
        const e = edits[s.question_id];
        if (!e) return s;
        const next = { ...s };
        if (e.analysis !== undefined) {
          next.explanation = e.analysis;
          const imageBlocks = array(next.explanation_blocks).filter(block => block && block.type === 'image');
          next.explanation_blocks = [...(e.analysis ? [{ type: 'text', text: e.analysis }] : []), ...imageBlocks];
        }
        if (e.answer) {
          const idx = LETTERS.indexOf(String(e.answer).toUpperCase());
          if (idx >= 0) {
            next.answer = idx;
            next.answer_verified = true;
          }
        }
        return next;
      });
    const groups = array(pkg.groups)
      .map(g => {
        const materialEdit = questions
          .map(question => ({ question, edit: edits[question._id] }))
          .find(item => item.question.group_id === g._id && item.edit && item.edit.material !== undefined);
        if (!materialEdit) return g;
        const material = materialEdit.edit.material;
        const imageBlocks = array(g.material_blocks).filter(block => block && block.type === 'image');
        return {
          ...g,
          material_text: material,
          material_blocks: [...(material ? [{ type: 'text', text: material }] : []), ...imageBlocks],
        };
      });
    const media = array(pkg.media);

    const pendingMedia = media.filter(item => item && (item.requires_upload === true || !/^(?:cloud:\/\/|https?:\/\/)/i.test(text(item.path))));
    if (pendingMedia.length) {
      return fail(422, `还有 ${pendingMedia.length} 张 OCR 图片未上传云存储，不能发布`);
    }

    const publishPkg = { ...pkg, questions, solutions, groups, media, validation_errors: [], validation_warnings: [] };

    // 复用 xingce 的校验 + 写入 (失败会把错误回传, 草稿保持 pending)
    const result = await xingceFeature.importXingcePackage({ package: publishPkg });
    if (result.code !== 0) return fail(result.code || 422, result.message || '发布校验失败', result.data);

    await db.collection(COLLECTION).doc(draftId).update({
      data: { status: 'published', published_at: db.serverDate(), updated_at: db.serverDate(), counts: computeCounts(pkg, draft.review) },
    });
    return ok({ draft_id: draftId, import: result.data }, '草稿已发布到正式题库');
  }

  // ── DELETE ────────────────────────────────────────────
  async function deleteDraft(event) {
    const draftId = text(event.draft_id);
    if (!draftId) return fail(400, '缺少 draft_id');
    await db.collection(COLLECTION).doc(draftId).remove();
    return ok({ draft_id: draftId }, '草稿已删除');
  }

  // ── STATS ─────────────────────────────────────────────
  async function draftStats() {
    const res = await db.collection(COLLECTION).limit(1000).field({ status: true }).get();
    const counts = { pending: 0, published: 0, archived: 0, total: 0 };
    for (const d of res.data || []) {
      counts[d.status] = (counts[d.status] || 0) + 1;
      counts.total += 1;
    }
    return ok(counts, 'ok');
  }

  async function router(event) {
    const action = event.draft_action;
    switch (action) {
      case 'create': return await createDraft(event);
      case 'append': return await appendDraft(event);
      case 'list': return await listDrafts(event);
      case 'get': return await getDraft(event);
      case 'update': return await updateDraft(event);
      case 'approve': return await setStatus(event, 'approved');
      case 'reject': return await setStatus(event, 'rejected');
      case 'ai_review': return await reviewWithAI(event);
      case 'publish': return await publishDraft(event);
      case 'delete': return await deleteDraft(event);
      case 'stats': return await draftStats(event);
      default: return fail(400, `未知 draft_action: ${action}`);
    }
  }

  return { router, createDraft, appendDraft, listDrafts, getDraft, updateDraft, reviewWithAI, approveDraft: e => setStatus(e, 'approved'), rejectDraft: e => setStatus(e, 'rejected'), publishDraft, deleteDraft, draftStats };
}

module.exports = buildModule;
