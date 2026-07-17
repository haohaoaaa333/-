'use strict';

const crypto = require('crypto');
const aiReview = require('./hy3-review');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
} = require('../lib/errors');

const COLLECTIONS = {
  papers: 'draft_papers',
  questions: 'question_drafts',
  events: 'review_events',
};
const LETTERS = ['A', 'B', 'C', 'D'];

const array = value => (Array.isArray(value) ? value : []);
const text = (value, max = 200000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function itemId(draftId, questionId) {
  const hash = crypto.createHash('sha1').update(String(questionId)).digest('hex').slice(0, 16);
  return `qd_${draftId.replace(/^draft_/, '').slice(0, 42)}_${hash}`;
}

function alreadyExists(error) {
  return /already\s+exist|collection.*exist|DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS|Table\s+exist/i
    .test(String(error && (error.message || error.errMsg || error.errCode) || error || ''));
}

function missingDocument(error) {
  return /not\s+exist|not\s+found|DATABASE_DOCUMENT_NOT_EXIST/i.test(String(error && error.message || error || ''));
}

function mergeById(existing, incoming, key) {
  const result = array(existing).slice();
  const positions = new Map(result.map((item, index) => [text(item && item[key], 200), index]));
  for (const item of array(incoming)) {
    const id = text(item && item[key], 200);
    if (!id) continue;
    if (positions.has(id)) result[positions.get(id)] = item;
    else {
      positions.set(id, result.length);
      result.push(item);
    }
  }
  return result;
}

function validateUniqueQuestionIds(questions) {
  const seen = new Set();
  const duplicates = new Set();
  const missing = [];
  array(questions).forEach((question, index) => {
    const id = text(question && question._id, 200);
    if (!id) {
      missing.push(index + 1);
      return;
    }
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  });
  if (missing.length) {
    throw new ValidationError('草稿包存在缺少 _id 的题目', [{
      path: 'package.questions',
      message: `位置：${missing.slice(0, 20).join(', ')}`,
    }]);
  }
  if (duplicates.size) {
    throw new ValidationError('草稿包存在重复题目 ID，已拒绝部分写入', [{
      path: 'package.questions',
      message: `共 ${array(questions).length} 题、${seen.size} 个唯一 ID、${duplicates.size} 组重复`,
    }]);
  }
  return seen.size;
}

function sanitizeEditPatch(patch) {
  const result = {};
  if (!patch || typeof patch !== 'object') return result;
  if (typeof patch.stem === 'string') result.stem = patch.stem.trim();
  if (Array.isArray(patch.options)) result.options = patch.options.slice(0, 4).map(value => text(value));
  if (typeof patch.answer === 'string') result.answer = text(patch.answer, 4).toUpperCase();
  if (typeof patch.analysis === 'string') result.analysis = patch.analysis.trim();
  if (typeof patch.material === 'string') result.material = patch.material.trim();
  if (typeof patch.module_id === 'string') result.module_id = text(patch.module_id, 80);
  if (typeof patch.review_confirmed === 'boolean') result.review_confirmed = patch.review_confirmed;
  return result;
}

function blockHasContent(block) {
  if (!block || typeof block !== 'object') return false;
  if (block.type === 'image') return Boolean(text(block.asset_id || block.src, 2000));
  if (block.type === 'formula') return Boolean(text(block.latex || block.text));
  return Boolean(text(block.text || block.content));
}

function optionHasContent(option) {
  return Boolean(text(option && (option.text || option.content))
    || array(option && option.images).length
    || array(option && option.content_blocks).some(blockHasContent));
}

function effectiveAnswer(item) {
  const edit = item.edit || {};
  if (Object.prototype.hasOwnProperty.call(edit, 'answer')) return LETTERS.indexOf(text(edit.answer, 4).toUpperCase());
  if (!item.question || item.question.answer_verified !== true) return -1;
  const value = Number(item.question && (item.question.answer_index ?? item.question.answer));
  return Number.isInteger(value) && value >= 0 && value <= 3 ? value : -1;
}

function effectiveAnalysis(item) {
  const edit = item.edit || {};
  if (Object.prototype.hasOwnProperty.call(edit, 'analysis')) return text(edit.analysis);
  const solution = item.solution || {};
  return text(solution.explanation) || array(solution.explanation_blocks).some(blockHasContent) ? '__present__' : '';
}

function validateForApproval(item) {
  const question = item.question || {};
  const edit = item.edit || {};
  const stem = Object.prototype.hasOwnProperty.call(edit, 'stem')
    ? text(edit.stem)
    : text(question.content || question.stem) || (array(question.stem_blocks).some(blockHasContent) ? '__present__' : '');
  const options = Array.isArray(edit.options) && edit.options.length === 4
    ? edit.options.map(value => ({ text: value }))
    : array(question.options_v2);
  const errors = [];
  if (!stem) errors.push({ path: 'stem', message: '题干为空' });
  if (options.length !== 4 || options.some(option => !optionHasContent(option))) {
    errors.push({ path: 'options', message: 'A-D 四个选项必须完整' });
  }
  if (effectiveAnswer(item) < 0) errors.push({ path: 'answer', message: '答案未确认' });
  if (!effectiveAnalysis(item)) errors.push({ path: 'analysis', message: '解析为空' });
  const confirmed = Object.prototype.hasOwnProperty.call(edit, 'review_confirmed')
    ? edit.review_confirmed === true
    : question.review_confirmed === true;
  if (question.composite_options_in_stem === true && !confirmed) {
    errors.push({ path: 'review_confirmed', message: '合成图中的 A-D 顺序尚未人工确认' });
  }
  return errors;
}

module.exports = function createDraftsV2Feature({ db, ok, xingceFeature }) {
  const command = db.command;

  async function ensureCollections() {
    for (const name of Object.values(COLLECTIONS)) {
      try { await db.createCollection(name); } catch (error) { if (!alreadyExists(error)) throw error; }
    }
  }

  async function getPaper(draftId, allowLegacyMigration = true) {
    try {
      const result = await db.collection(COLLECTIONS.papers).doc(draftId).get();
      if (result && result.data) return result.data;
    } catch (error) {
      if (!missingDocument(error)) throw error;
    }
    if (allowLegacyMigration) {
      await migrateLegacyBatch({}, 1, draftId);
      return getPaper(draftId, false);
    }
    throw new NotFoundError('草稿试卷', draftId);
  }

  async function getItemByQuestionId(draftId, questionId) {
    try {
      const result = await db.collection(COLLECTIONS.questions).doc(itemId(draftId, questionId)).get();
      if (result && result.data) return result.data;
    } catch (error) {
      if (!missingDocument(error)) throw error;
    }
    throw new NotFoundError('草稿题目', questionId);
  }

  async function listAllItems(draftId, fields) {
    const result = [];
    for (let offset = 0; ; offset += 100) {
      let query = db.collection(COLLECTIONS.questions).where({ draft_id: draftId }).skip(offset).limit(100);
      if (fields) query = query.field(fields);
      const page = await query.get();
      result.push(...(page.data || []));
      if (!page.data || page.data.length < 100) break;
    }
    return result.sort((left, right) => Number(left.question_no || 0) - Number(right.question_no || 0));
  }

  function computeCounts(items) {
    const counts = { total: items.length, approved: 0, rejected: 0, pending: 0, needs_fix: 0 };
    for (const item of items) {
      const status = item.review_status || 'pending';
      if (status === 'approved') counts.approved += 1;
      else if (status === 'rejected') counts.rejected += 1;
      else if (status === 'needs_fix') counts.needs_fix += 1;
      else counts.pending += 1;
    }
    return counts;
  }

  async function refreshCounts(draftId) {
    const items = await listAllItems(draftId, { review_status: true, question_no: true });
    const counts = computeCounts(items);
    await db.collection(COLLECTIONS.papers).doc(draftId).update({ data: { counts, updated_at: db.serverDate() } });
    return counts;
  }

  async function addReviewEvent(event, item, action, before, after, note = '') {
    try {
      await db.collection(COLLECTIONS.events).add({ data: {
        _id: randomId('rev'),
        draft_id: item && item.draft_id || text(event.draft_id, 100),
        paper_id: item && item.paper_id || null,
        question_id: item && item.question_id || null,
        operator: event.__identity && event.__identity.openid || null,
        roles: event.__identity && event.__identity.roles || [],
        action,
        before: before || null,
        after: after || null,
        note: text(note, 1000),
        created_at: db.serverDate(),
      } });
    } catch (_) {
      // 审核主操作已完成时，不因日志写入失败回滚用户修改。
    }
  }

  async function upsertItem(draftId, paperId, question, solution) {
    if (!question || !text(question._id, 200)) return false;
    const questionId = text(question._id, 200);
    const id = itemId(draftId, questionId);
    let existing = null;
    try {
      const result = await db.collection(COLLECTIONS.questions).doc(id).get();
      existing = result && result.data;
    } catch (error) {
      if (!missingDocument(error)) throw error;
    }
    if (existing) {
      const data = {
        question,
        ...(solution ? { solution } : {}),
        question_no: Number(question.question_number || question.question_no || existing.question_no || 0),
        module_id: text(question.module_id, 80) || existing.module_id || null,
        group_id: text(question.group_id, 200) || existing.group_id || null,
        version: Number(existing.version || 1) + 1,
        updated_at: db.serverDate(),
      };
      await db.collection(COLLECTIONS.questions).doc(id).update({ data });
    } else {
      await db.collection(COLLECTIONS.questions).add({ data: {
        _id: id,
        doc_type: 'question_draft_v2',
        schema_version: '2.0',
        draft_id: draftId,
        paper_id: paperId,
        question_id: questionId,
        question_no: Number(question.question_number || question.question_no || 0),
        module_id: text(question.module_id, 80) || null,
        group_id: text(question.group_id, 200) || null,
        question,
        solution: solution || null,
        edit: {},
        review_status: 'pending',
        review_note: '',
        edited: false,
        ai_review: null,
        version: 1,
        created_at: db.serverDate(),
        updated_at: db.serverDate(),
      } });
    }
    return true;
  }

  async function upsertQuestionBatch(draftId, paperId, questions, solutions) {
    const solutionMap = new Map(array(solutions).map(solution => [text(solution && solution.question_id, 200), solution]));
    let written = 0;
    for (let index = 0; index < questions.length; index += 10) {
      const batch = questions.slice(index, index + 10);
      const results = await Promise.all(batch.map(question => upsertItem(
        draftId,
        paperId,
        question,
        solutionMap.get(text(question && question._id, 200))
      )));
      written += results.filter(Boolean).length;
    }
    return written;
  }

  async function findReusablePaper(taskId) {
    if (!taskId) return null;
    const result = await db.collection(COLLECTIONS.papers).where({ task_id: taskId }).limit(20).get();
    const candidates = array(result && result.data).filter(paper => paper && paper.status !== 'published');
    return candidates.sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))[0] || null;
  }

  async function createDraft(event) {
    await ensureCollections();
    const pkg = event.package || {};
    const questions = array(pkg.questions);
    if (!questions.length) throw new ValidationError('草稿包没有可审核的题目');
    if (Number(pkg.schema_version) !== 2 || !pkg.paper) throw new ValidationError('草稿包必须是新版 V2 整卷结构');
    validateUniqueQuestionIds(questions);

    const taskId = text(event.source_task_id, 100) || null;
    const reusablePaper = await findReusablePaper(taskId);
    const draftId = reusablePaper ? reusablePaper._id : randomId('draft');
    const paperId = text(event.paper_id || pkg.paper_id || pkg.paper._id, 200);
    const paperDoc = {
      _id: draftId,
      doc_type: 'draft_paper_v2',
      schema_version: '2.0',
      task_id: taskId,
      source: text(event.source, 50) || 'manual',
      paper_name: text(event.paper_name || pkg.paper_title || pkg.paper.title || pkg.paper._id, 200) || '未命名试卷',
      paper_id: paperId,
      status: 'pending',
      raw_markdown: text(event.raw_markdown, 4096),
      raw_markdown_truncated: event.raw_markdown_truncated === true,
      package_meta: {
        schema_version: 2,
        paper: pkg.paper,
        groups: array(pkg.groups),
        media: array(pkg.media),
        validation_errors: [],
        validation_warnings: [],
      },
      counts: { total: 0, approved: 0, rejected: 0, pending: 0, needs_fix: 0 },
      version: 1,
      created_by: event.__identity && event.__identity.openid || null,
      created_at: db.serverDate(),
      updated_at: db.serverDate(),
    };
    if (reusablePaper) {
      const { _id, created_at, ...patch } = paperDoc;
      patch.version = Number(reusablePaper.version || 1) + 1;
      await db.collection(COLLECTIONS.papers).doc(draftId).update({ data: patch });
    } else {
      await db.collection(COLLECTIONS.papers).add({ data: paperDoc });
    }
    await upsertQuestionBatch(draftId, paperId, questions, pkg.solutions);
    const counts = await refreshCounts(draftId);
    return ok(
      { draft_id: draftId, counts, reused: Boolean(reusablePaper) },
      reusablePaper ? '已续写该任务的既有草稿' : '草稿已按一题一档创建'
    );
  }

  async function appendDraft(event) {
    const draftId = text(event.draft_id, 100);
    if (!draftId) throw new ValidationError('缺少 draft_id');
    const questions = array(event.questions);
    if (!questions.length) throw new ValidationError('没有可追加的题目');
    validateUniqueQuestionIds(questions);
    const paper = await getPaper(draftId);
    if (paper.status === 'published') throw new ConflictError('已发布草稿不能追加题目', 'DRAFT_PUBLISHED');

    const meta = paper.package_meta || {};
    const nextMeta = {
      ...meta,
      groups: mergeById(meta.groups, event.groups, '_id'),
      media: mergeById(meta.media, event.media, 'asset_id'),
    };
    await db.collection(COLLECTIONS.papers).doc(draftId).update({ data: {
      package_meta: nextMeta,
      version: Number(paper.version || 1) + 1,
      updated_at: db.serverDate(),
    } });
    const written = await upsertQuestionBatch(draftId, paper.paper_id, questions, event.solutions);
    const counts = await refreshCounts(draftId);
    return ok({ draft_id: draftId, counts }, `已分批写入 ${written} 道题`);
  }

  // 重新切题：删除该草稿下所有题目，用重切后的整卷包整体替换，并重置审核状态。
  async function replaceQuestions(event) {
    const draftId = text(event.draft_id, 100);
    if (!draftId) throw new ValidationError('缺少 draft_id');
    const pkg = event.package || {};
    const questions = array(pkg.questions);
    if (!questions.length) throw new ValidationError('重切题包没有可审核的题目');
    if (Number(pkg.schema_version) !== 2 || !pkg.paper) throw new ValidationError('重切题包必须是新版 V2 整卷结构');

    const paper = await getPaper(draftId);
    if (paper.status === 'published') throw new ConflictError('已发布草稿不能重新切题', 'DRAFT_PUBLISHED');

    // 防御：重切题包存在缺失 _id 的题目时先中止，避免删除旧题后 upsertItem 静默跳过、
    // 最终草稿被清空（upsertItem 对缺 _id 的题目直接 return false）。
    const missingId = questions.find(q => !text(q && q._id, 200));
    if (missingId) throw new ValidationError('重切题包存在缺失 _id 的题目，已中止以免清空草稿');

    // 删除既有题目（一题一档），分批删除避免单次超限。
    const existing = await listAllItems(draftId, { _id: true });
    for (let i = 0; i < existing.length; i += 20) {
      const batch = existing.slice(i, i + 20);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(batch.map(it => db.collection(COLLECTIONS.questions).doc(it._id).remove()));
    }

    const meta = {
      schema_version: 2,
      paper: pkg.paper,
      groups: array(pkg.groups),
      media: array(pkg.media),
      validation_errors: [],
      validation_warnings: [],
    };
    await db.collection(COLLECTIONS.papers).doc(draftId).update({ data: {
      package_meta: meta,
      version: Number(paper.version || 1) + 1,
      updated_at: db.serverDate(),
    } });
    const written = await upsertQuestionBatch(draftId, paper.paper_id, questions, pkg.solutions);
    const counts = await refreshCounts(draftId);
    return ok({ draft_id: draftId, counts, written }, `已重切 ${written} 道题，审核状态已重置为待审`);
  }

  async function listDrafts(event) {
    await ensureCollections();
    await migrateLegacyBatch(event, 1);
    const status = text(event.status, 40);
    const page = Math.max(1, Number(event.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(event.page_size) || 20));
    let query = db.collection(COLLECTIONS.papers);
    if (status) query = query.where({ status });
    const [countResult, listResult] = await Promise.all([
      query.count(),
      query.orderBy('created_at', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
    ]);
    const drafts = (listResult.data || []).map(paper => ({
      draft_id: paper._id,
      source: paper.source,
      paper_name: paper.paper_name,
      paper_id: paper.paper_id,
      status: paper.status,
      counts: paper.counts,
      version: paper.version,
      created_at: paper.created_at,
      updated_at: paper.updated_at,
    }));
    return ok({ total: countResult.total || 0, page, page_size: pageSize, drafts });
  }

  function assembleDraft(paper, items) {
    const meta = paper.package_meta || {};
    const review = {};
    const edits = {};
    for (const item of items) {
      review[item.question_id] = {
        status: item.review_status || 'pending',
        edited: item.edited === true,
        comment: item.review_note || '',
        ...(item.ai_review ? { ai_review: item.ai_review } : {}),
        updated_at: item.updated_at,
      };
      if (item.edit && Object.keys(item.edit).length) edits[item.question_id] = item.edit;
    }
    return {
      _id: paper._id,
      draft_id: paper._id,
      source: paper.source,
      paper_name: paper.paper_name,
      paper_id: paper.paper_id,
      source_task_id: paper.task_id,
      status: paper.status,
      raw_markdown: paper.raw_markdown,
      raw_markdown_truncated: paper.raw_markdown_truncated,
      package: {
        schema_version: 2,
        paper: meta.paper,
        groups: array(meta.groups),
        questions: items.map(item => item.question),
        solutions: items.map(item => item.solution).filter(Boolean),
        media: array(meta.media),
        validation_errors: array(meta.validation_errors),
        validation_warnings: array(meta.validation_warnings),
      },
      review,
      edits,
      counts: paper.counts || computeCounts(items),
      version: paper.version,
      created_at: paper.created_at,
      updated_at: paper.updated_at,
      published_at: paper.published_at,
    };
  }

  async function getDraft(event) {
    const draftId = text(event.draft_id || event.data && event.data.draft_id, 100);
    if (!draftId) throw new ValidationError('缺少 draft_id');
    const paper = await getPaper(draftId);
    const items = await listAllItems(draftId);
    return ok(assembleDraft(paper, items));
  }

  async function listQuestionDrafts(event) {
    const input = event.data && typeof event.data === 'object' ? event.data : event;
    const draftId = text(input.draft_id || input.paper_id, 100);
    if (!draftId) throw new ValidationError('缺少 draft_id');
    const page = Math.max(1, Number(input.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(input.page_size) || 20));
    const filter = { draft_id: draftId };
    if (text(input.review_status, 40)) filter.review_status = text(input.review_status, 40);
    if (text(input.module_id, 80)) filter.module_id = text(input.module_id, 80);
    const query = db.collection(COLLECTIONS.questions).where(filter);
    const [countResult, listResult] = await Promise.all([
      query.count(),
      query.orderBy('question_no', 'asc').skip((page - 1) * pageSize).limit(pageSize).get(),
    ]);
    return ok({ list: listResult.data || [], total: countResult.total || 0, page, page_size: pageSize });
  }

  async function getQuestionDraft(event) {
    const input = event.data && typeof event.data === 'object' ? event.data : event;
    const draftId = text(input.draft_id, 100);
    const questionId = text(input.question_id, 200);
    if (!draftId || !questionId) throw new ValidationError('缺少 draft_id 或 question_id');
    return ok({ question: await getItemByQuestionId(draftId, questionId) });
  }

  async function updateDraft(event) {
    const draftId = text(event.draft_id || event.data && event.data.draft_id, 100);
    if (!draftId) throw new ValidationError('缺少 draft_id');
    const editMap = event.edits || event.data && event.data.edits || {};
    const decisions = event.review || event.data && event.data.review || {};
    const comments = event.comments || event.data && event.data.comments || {};
    const questionIds = new Set([...Object.keys(editMap), ...Object.keys(decisions), ...Object.keys(comments)]);
    if (!questionIds.size) throw new ValidationError('没有可保存的修改');

    for (const questionId of questionIds) {
      const item = await getItemByQuestionId(draftId, questionId);
      const expectedVersion = event.version ?? (event.data && event.data.version);
      if (expectedVersion !== undefined && Number(expectedVersion) !== Number(item.version || 1)) {
        throw new ConflictError('题目已被其他审核员修改，请刷新后重试', 'VERSION_CONFLICT', {
          question_id: questionId,
          current_version: item.version || 1,
        });
      }
      const before = { edit: item.edit || {}, review_status: item.review_status, review_note: item.review_note };
      const nextEdit = editMap[questionId]
        ? { ...(item.edit || {}), ...sanitizeEditPatch(editMap[questionId]) }
        : item.edit || {};
      const nextStatus = editMap[questionId]
        ? 'pending'
        : ['approved', 'rejected', 'pending', 'needs_fix'].includes(decisions[questionId])
          ? decisions[questionId]
          : item.review_status || 'pending';
      const nextNote = Object.prototype.hasOwnProperty.call(comments, questionId)
        ? text(comments[questionId], 1000)
        : item.review_note || '';
      const data = {
        edit: nextEdit,
        review_status: nextStatus,
        review_note: nextNote,
        edited: item.edited === true || Boolean(editMap[questionId]),
        version: Number(item.version || 1) + 1,
        updated_at: db.serverDate(),
      };
      await db.collection(COLLECTIONS.questions).doc(item._id).update({ data });
      await addReviewEvent(event, item, editMap[questionId] ? 'modify' : 'review_update', before, data, nextNote);
    }
    const counts = await refreshCounts(draftId);
    return ok({ draft_id: draftId, counts }, '草稿已更新');
  }

  async function setStatus(event, status) {
    const draftId = text(event.draft_id || event.data && event.data.draft_id, 100);
    const ids = array(event.question_ids || event.data && event.data.question_ids).map(value => text(value, 200)).filter(Boolean);
    if (!draftId) throw new ValidationError('缺少 draft_id');
    if (!ids.length) throw new ValidationError('必须明确选择题目，不能无条件整卷通过');
    for (const questionId of ids) {
      const item = await getItemByQuestionId(draftId, questionId);
      if (status === 'approved') {
        const errors = validateForApproval(item);
        if (errors.length) throw new ValidationError(`第 ${item.question_no || questionId} 题不能通过`, errors);
      }
      const before = { review_status: item.review_status, review_note: item.review_note };
      const note = text(event.reason || event.data && event.data.reason, 1000);
      const data = {
        review_status: status,
        review_note: note || item.review_note || '',
        version: Number(item.version || 1) + 1,
        reviewed_by: event.__identity && event.__identity.openid || null,
        reviewed_at: db.serverDate(),
        updated_at: db.serverDate(),
      };
      await db.collection(COLLECTIONS.questions).doc(item._id).update({ data });
      await addReviewEvent(event, item, status, before, data, note);
    }
    const counts = await refreshCounts(draftId);
    return ok({ draft_id: draftId, counts }, status === 'approved' ? '已通过' : '已驳回');
  }

  async function reviewWithAI(event) {
    const draftId = text(event.draft_id || event.data && event.data.draft_id, 100);
    const questionId = text(event.question_id || event.data && event.data.question_id, 200);
    if (!draftId || !questionId) throw new ValidationError('缺少 draft_id 或 question_id');
    const paper = await getPaper(draftId);
    if (paper.status === 'published') throw new ConflictError('已发布草稿不能重新进行 AI 审核', 'DRAFT_PUBLISHED');
    const item = await getItemByQuestionId(draftId, questionId);
    const meta = paper.package_meta || {};
    const draftForAi = assembleDraft(paper, [item]);
    draftForAi.package.groups = array(meta.groups).filter(group => !item.group_id || group._id === item.group_id);
    draftForAi.package.media = array(meta.media);
    const result = await aiReview.reviewQuestion(draftForAi, questionId);
    const stored = { ...result, reviewed_at: new Date().toISOString() };
    await db.collection(COLLECTIONS.questions).doc(item._id).update({ data: {
      ai_review: stored,
      version: Number(item.version || 1) + 1,
      updated_at: db.serverDate(),
    } });
    await addReviewEvent(event, item, 'ai_review', null, { verdict: stored.verdict }, stored.summary);
    return ok({ draft_id: draftId, question_id: questionId, ai_review: stored }, 'AI 审核完成');
  }

  function materializePackage(paper, items) {
    const meta = paper.package_meta || {};
    const questions = [];
    const solutions = [];
    for (const item of items) {
      const edit = item.edit || {};
      const original = item.question || {};
      const question = { ...original };
      if (Object.prototype.hasOwnProperty.call(edit, 'stem')) {
        question.content = edit.stem;
        question.stem = edit.stem;
        const images = array(question.stem_blocks).filter(block => block && block.type === 'image');
        question.stem_blocks = [...(edit.stem ? [{ type: 'text', text: edit.stem }] : []), ...images];
      }
      if (Array.isArray(edit.options) && edit.options.length === 4) {
        question.options = edit.options.map(value => text(value));
        question.options_v2 = LETTERS.map((key, index) => {
          const originalOption = array(original.options_v2)[index] || {};
          const images = array(originalOption.content_blocks).filter(block => block && block.type === 'image');
          return {
            ...originalOption,
            key,
            text: text(edit.options[index]),
            content_blocks: [...(text(edit.options[index]) ? [{ type: 'text', text: text(edit.options[index]) }] : []), ...images],
          };
        });
      }
      const answer = effectiveAnswer(item);
      question.answer = answer;
      question.answer_index = answer;
      question.answer_verified = answer >= 0;
      if (edit.module_id) question.module_id = edit.module_id;
      if (typeof edit.review_confirmed === 'boolean') question.review_confirmed = edit.review_confirmed;
      questions.push(question);

      const solution = { ...(item.solution || { question_id: item.question_id }) };
      if (Object.prototype.hasOwnProperty.call(edit, 'analysis')) {
        solution.explanation = edit.analysis;
        const images = array(solution.explanation_blocks).filter(block => block && block.type === 'image');
        solution.explanation_blocks = [...(edit.analysis ? [{ type: 'text', text: edit.analysis }] : []), ...images];
      }
      solution.answer = answer;
      solution.answer_verified = answer >= 0;
      solutions.push(solution);
    }

    const groups = array(meta.groups).map(group => {
      const materialItem = items.find(item => item.group_id === group._id && item.edit && Object.prototype.hasOwnProperty.call(item.edit, 'material'));
      if (!materialItem) return group;
      const material = materialItem.edit.material;
      const images = array(group.material_blocks).filter(block => block && block.type === 'image');
      return { ...group, material_text: material, material_blocks: [...(material ? [{ type: 'text', text: material }] : []), ...images] };
    });
    return {
      schema_version: 2,
      paper: meta.paper,
      groups,
      questions,
      solutions,
      media: array(meta.media),
      validation_errors: [],
      validation_warnings: [],
    };
  }

  // 发布门禁：把“能否发布”的全部校验抽成独立函数，供 publishDraft 与 previewPublish 复用，
  // 保证“预览校验”与“真实发布”走的是同一套门禁——预览通过就不会在发布时被拦。
  async function runPublishChecks(paper, items, counts) {
    const errors = [];
    if (!counts.total || counts.approved !== counts.total) {
      errors.push({ path: 'counts', message: `整卷发布要求全部题目通过：通过 ${counts.approved}，待审 ${counts.pending}，需修正 ${counts.needs_fix}，驳回 ${counts.rejected}` });
    }
    for (const item of items) {
      for (const error of validateForApproval(item)) {
        errors.push({ ...error, question_id: item.question_id, question_no: item.question_number });
      }
    }
    const pkg = materializePackage(paper, items);
    const pendingMedia = array(pkg.media).filter(media => media && (media.requires_upload === true || !/^(?:cloud:\/\/|https?:\/\/)/i.test(text(media.path, 2000))));
    if (pendingMedia.length) errors.push({ path: 'media', message: `还有 ${pendingMedia.length} 张图片未上传云存储` });
    const preview = await xingceFeature.previewXingcePackage({ package: pkg });
    const xingceErrors = (preview && preview.data && array(preview.data.errors)) || [];
    for (const err of xingceErrors) errors.push({ ...err, source: 'xingce' });
    return {
      ok: errors.length === 0,
      errors,
      pkg,
      preview: (preview && preview.data) || null,
      pendingMedia: pendingMedia.length,
      counts,
      warnings: array(paper.package_meta && paper.package_meta.validation_warnings),
    };
  }

  async function publishDraft(event) {
    const draftId = text(event.draft_id || event.data && event.data.draft_id, 100);
    if (!draftId) throw new ValidationError('缺少 draft_id');
    const paper = await getPaper(draftId);
    if (paper.status === 'published') throw new ConflictError('该草稿已发布', 'DRAFT_PUBLISHED');
    const items = await listAllItems(draftId);
    const counts = computeCounts(items);
    const check = await runPublishChecks(paper, items, counts);
    if (!check.ok) throw new ValidationError('草稿仍有未修正问题', check.errors.slice(0, 100));
    const pkg = check.pkg;
    await db.collection(COLLECTIONS.papers).doc(draftId).update({ data: {
      status: 'publishing',
      updated_at: db.serverDate(),
    } });
    let result;
    try {
      result = await xingceFeature.importXingcePackage({ package: pkg });
      if (result.code !== 0) throw new ValidationError(result.message || '正式题库导入失败', result.data || result.extra);
    } catch (err) {
      await db.collection(COLLECTIONS.papers).doc(draftId).update({ data: { status: 'pending', updated_at: db.serverDate() } });
      throw err;
    }
    await db.collection(COLLECTIONS.papers).doc(draftId).update({ data: {
      status: 'published',
      counts,
      published_at: db.serverDate(),
      updated_at: db.serverDate(),
    } });
    await addReviewEvent(event, { draft_id: draftId, paper_id: paper.paper_id }, 'publish', null, { import: result.data });
    return ok({ draft_id: draftId, import: result.data, counts }, '草稿已发布到正式题库');
  }

  // 第五刀：发布前只读预览门禁结果，不写正式库、不记发布事件。
  async function previewPublish(event) {
    const draftId = text(event.draft_id || event.data && event.data.draft_id, 100);
    if (!draftId) throw new ValidationError('缺少 draft_id');
    const paper = await getPaper(draftId);
    const items = await listAllItems(draftId);
    const counts = computeCounts(items);
    const check = await runPublishChecks(paper, items, counts);
    return ok({
      ok: check.ok,
      counts,
      errors: check.errors.slice(0, 200),
      preview: check.preview,
      pending_media: check.pendingMedia,
      warnings: check.warnings,
      already_published: paper.status === 'published',
    }, '校验完成');
  }

  async function deleteDraft(event) {
    const draftId = text(event.draft_id || event.data && event.data.draft_id, 100);
    if (!draftId) throw new ValidationError('缺少 draft_id');
    await getPaper(draftId);
    for (;;) {
      const page = await db.collection(COLLECTIONS.questions).where({ draft_id: draftId }).limit(20).get();
      if (!page.data || !page.data.length) break;
      await Promise.all(page.data.map(item => db.collection(COLLECTIONS.questions).doc(item._id).remove()));
    }
    await db.collection(COLLECTIONS.papers).doc(draftId).remove();
    await addReviewEvent(event, { draft_id: draftId }, 'delete', null, null);
    return ok({ draft_id: draftId }, '草稿已删除');
  }

  async function draftStats() {
    await ensureCollections();
    const result = await db.collection(COLLECTIONS.papers).limit(1000).field({ status: true }).get();
    const counts = { pending: 0, published: 0, archived: 0, total: 0 };
    for (const paper of result.data || []) {
      counts[paper.status] = (counts[paper.status] || 0) + 1;
      counts.total += 1;
    }
    return ok(counts);
  }

  async function migrateLegacyBatch(event, limit = 5, targetDraftId = '') {
    await ensureCollections();
    let legacyResult;
    try {
      if (targetDraftId) {
        const target = await db.collection(COLLECTIONS.questions).doc(targetDraftId).get();
        legacyResult = { data: target && target.data ? [target.data] : [] };
      } else {
        legacyResult = await db.collection(COLLECTIONS.questions)
          .where({ status: command.in(['pending', 'published', 'archived']) })
          .limit(limit)
          .get();
      }
    } catch (_) {
      return { migrated: 0 };
    }
    let migrated = 0;
    for (const legacy of legacyResult.data || []) {
      if (!legacy.package || legacy.doc_type === 'question_draft_v2') continue;
      let existingPaper = null;
      try { existingPaper = (await db.collection(COLLECTIONS.papers).doc(legacy._id).get()).data; } catch (_) { /* not migrated */ }
      if (!existingPaper) {
        const pkg = legacy.package || {};
        await db.collection(COLLECTIONS.papers).add({ data: {
          _id: legacy._id,
          doc_type: 'draft_paper_v2',
          schema_version: '2.0',
          task_id: legacy.source_task_id || null,
          source: legacy.source || 'legacy',
          paper_name: legacy.paper_name || '旧版草稿',
          paper_id: legacy.paper_id || pkg.paper && pkg.paper._id || '',
          status: legacy.status || 'pending',
          raw_markdown: legacy.raw_markdown || '',
          raw_markdown_truncated: legacy.raw_markdown_truncated === true,
          package_meta: {
            schema_version: 2,
            paper: pkg.paper,
            groups: array(pkg.groups),
            media: array(pkg.media),
            validation_errors: array(pkg.validation_errors),
            validation_warnings: array(pkg.validation_warnings),
          },
          counts: legacy.counts || { total: 0, approved: 0, rejected: 0, pending: 0, needs_fix: 0 },
          version: 1,
          migrated_from_legacy: true,
          created_at: legacy.created_at || db.serverDate(),
          updated_at: db.serverDate(),
        } });
        const solutionMap = new Map(array(pkg.solutions).map(solution => [solution.question_id, solution]));
        const legacyQuestions = array(pkg.questions);
        for (let offset = 0; offset < legacyQuestions.length; offset += 10) {
          await Promise.all(legacyQuestions.slice(offset, offset + 10).map(async question => {
            await upsertItem(legacy._id, legacy.paper_id, question, solutionMap.get(question._id));
            const item = await getItemByQuestionId(legacy._id, question._id);
            const legacyReview = legacy.review && legacy.review[question._id] || {};
            const legacyEdit = legacy.edits && legacy.edits[question._id] || {};
            await db.collection(COLLECTIONS.questions).doc(item._id).update({ data: {
              review_status: legacyReview.status || 'pending',
              review_note: legacyReview.comment || '',
              edited: legacyReview.edited === true,
              ai_review: legacyReview.ai_review || null,
              edit: legacyEdit,
              updated_at: db.serverDate(),
            } });
          }));
        }
        await refreshCounts(legacy._id);
      }
      await db.collection(COLLECTIONS.questions).doc(legacy._id).update({ data: {
        status: 'legacy_migrated',
        migrated_to_v2: true,
        migrated_at: db.serverDate(),
      } });
      migrated += 1;
    }
    return { migrated };
  }

  async function router(event) {
    const rawAction = text(event.action, 100);
    const action = rawAction === 'draft'
      ? text(event.draft_action, 100)
      : rawAction;
    switch (action) {
      case 'create': return createDraft(event);
      case 'append': return appendDraft(event);
      case 'replace_questions': return replaceQuestions(event);
      case 'list':
      case 'draft_paper.list': return listDrafts(event);
      case 'get':
      case 'draft_paper.get': return getDraft(event);
      case 'question_draft.list': return listQuestionDrafts(event);
      case 'question_draft.get': return getQuestionDraft(event);
      case 'update':
      case 'question_draft.update': return updateDraft(event);
      case 'approve':
      case 'question_draft.approve': return setStatus(event, 'approved');
      case 'reject':
      case 'question_draft.reject': return setStatus(event, 'rejected');
      case 'ai_review': return reviewWithAI(event);
      case 'publish': return publishDraft(event);
      case 'preview_publish': return previewPublish(event);
      case 'delete': return deleteDraft(event);
      case 'stats': return draftStats(event);
      case 'migrate_legacy': return ok(await migrateLegacyBatch(event, 20), '旧草稿迁移完成');
      default: throw new ValidationError(`未知草稿 action：${action}`);
    }
  }

  return {
    router,
    createDraft,
    appendDraft,
    replaceQuestions,
    listDrafts,
    getDraft,
    listQuestionDrafts,
    getQuestionDraft,
    updateDraft,
    reviewWithAI,
    publishDraft,
    previewPublish,
    deleteDraft,
    draftStats,
    migrateLegacyBatch,
  };
};

module.exports._test = {
  itemId,
  sanitizeEditPatch,
  validateForApproval,
  effectiveAnswer,
  validateUniqueQuestionIds,
};
