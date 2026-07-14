const COLLECTIONS = {
  papers: 'essay_papers',
  materials: 'essay_materials',
  questions: 'essay_questions',
  answers: 'essay_answers',
  imports: 'essay_import_jobs',
};

const PRIMARY_TYPES = ['summary', 'analysis', 'countermeasure', 'practical_writing', 'essay'];

function text(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(item => text(String(item))).filter(Boolean) : [];
}

function numberValue(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function statusValue(value, fallback = 'draft') {
  return ['draft', 'enabled', 'disabled'].includes(value) ? value : fallback;
}

function normalizePackage(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const rawPaper = raw.paper && typeof raw.paper === 'object' ? raw.paper : {};
  const paper = {
    _id: text(rawPaper._id),
    title: text(rawPaper.title),
    original_title: text(rawPaper.original_title),
    year: numberValue(rawPaper.year, new Date().getFullYear()),
    exam_type: text(rawPaper.exam_type) || 'unknown',
    paper_level: text(rawPaper.paper_level) || 'general',
    source_kind: text(rawPaper.source_kind) || 'unknown',
    source_filename: text(rawPaper.source_filename),
    content_hash: text(rawPaper.content_hash || raw.import_meta?.content_hash),
    total_score: numberValue(rawPaper.total_score),
    question_count: numberValue(rawPaper.question_count),
    material_count: numberValue(rawPaper.material_count),
    status: statusValue(rawPaper.status),
  };

  const materials = (Array.isArray(raw.materials) ? raw.materials : []).map((item, index) => ({
    _id: text(item._id),
    paper_id: text(item.paper_id) || paper._id,
    sequence: numberValue(item.sequence, index + 1),
    title: text(item.title) || `给定资料${index + 1}`,
    content: text(item.content),
    images: stringArray(item.images),
    topic_tags: stringArray(item.topic_tags),
    status: statusValue(item.status),
  }));

  const questions = (Array.isArray(raw.questions) ? raw.questions : []).map((item, index) => ({
    _id: text(item._id),
    paper_id: text(item.paper_id) || paper._id,
    sequence: numberValue(item.sequence, index + 1),
    primary_type: text(item.primary_type),
    subtype: text(item.subtype),
    tested_elements: stringArray(item.tested_elements),
    document_genre: text(item.document_genre),
    required_sections: stringArray(item.required_sections),
    material_ids: stringArray(item.material_ids),
    prompt: text(item.prompt),
    score: numberValue(item.score),
    requirements: {
      min_words: numberValue(item.requirements?.min_words),
      max_words: numberValue(item.requirements?.max_words),
      items: stringArray(item.requirements?.items),
    },
    difficulty: ['简单', '中等', '困难'].includes(item.difficulty) ? item.difficulty : '中等',
    topic_tags: stringArray(item.topic_tags),
    knowledge_refs: stringArray(item.knowledge_refs),
    status: statusValue(item.status),
  }));

  const answers = (Array.isArray(raw.answers) ? raw.answers : []).map(item => ({
    _id: text(item._id),
    paper_id: text(item.paper_id) || paper._id,
    question_id: text(item.question_id),
    answer_type: text(item.answer_type) || 'third_party_reference',
    reference_answer: text(item.reference_answer),
    answer_outline: stringArray(item.answer_outline),
    scoring_points: Array.isArray(item.scoring_points) ? item.scoring_points : [],
    essay_title: text(item.essay_title),
    status: statusValue(item.status),
  }));

  return {
    paper: {
      ...paper,
      question_count: questions.length,
      material_count: materials.length,
      total_score: questions.reduce((sum, item) => sum + item.score, 0),
    },
    materials,
    questions,
    answers,
    import_meta: {
      import_id: text(raw.import_meta?.import_id) || `essay_import_${paper.content_hash || paper._id}`,
      content_hash: text(raw.import_meta?.content_hash) || paper.content_hash,
      parser_version: numberValue(raw.import_meta?.parser_version, 1),
      removed_watermarks: numberValue(raw.import_meta?.removed_watermarks),
      removed_page_markers: numberValue(raw.import_meta?.removed_page_markers),
    },
  };
}

function validatePackage(data) {
  const errors = [];
  const { paper, materials, questions, answers } = data;
  if (!paper._id) errors.push({ path: 'paper._id', message: '试卷ID缺失' });
  if (!paper.title) errors.push({ path: 'paper.title', message: '试卷标题缺失' });
  if (!paper.content_hash) errors.push({ path: 'paper.content_hash', message: '内容哈希缺失，无法保证幂等导入' });
  if (!materials.length) errors.push({ path: 'materials', message: '至少需要一份给定资料' });
  if (!questions.length) errors.push({ path: 'questions', message: '至少需要一道申论题' });
  if (answers.length !== questions.length) errors.push({ path: 'answers', message: '答案数量必须与题目数量一致' });

  const ids = new Set();
  const materialIds = new Set(materials.map(item => item._id));
  const questionIds = new Set(questions.map(item => item._id));
  [...materials, ...questions, ...answers].forEach((item, index) => {
    if (!item._id) errors.push({ path: `records.${index}._id`, message: '记录ID缺失' });
    if (ids.has(item._id)) errors.push({ path: `records.${index}._id`, message: `记录ID重复：${item._id}` });
    ids.add(item._id);
    if (item.paper_id !== paper._id) errors.push({ path: `records.${index}.paper_id`, message: 'paper_id与试卷ID不一致' });
  });
  materials.forEach((item, index) => {
    if (!item.content) errors.push({ path: `materials.${index}.content`, message: '材料正文为空' });
  });
  questions.forEach((item, index) => {
    if (!item.prompt) errors.push({ path: `questions.${index}.prompt`, message: '题干为空' });
    if (!PRIMARY_TYPES.includes(item.primary_type)) errors.push({ path: `questions.${index}.primary_type`, message: '一级题型无效' });
    if (item.score <= 0) errors.push({ path: `questions.${index}.score`, message: '题目分值必须大于0' });
    item.material_ids.forEach(materialId => {
      if (!materialIds.has(materialId)) errors.push({ path: `questions.${index}.material_ids`, message: `材料不存在：${materialId}` });
    });
  });
  answers.forEach((item, index) => {
    if (!questionIds.has(item.question_id)) errors.push({ path: `answers.${index}.question_id`, message: '答案未匹配到题目' });
    if (!item.reference_answer) errors.push({ path: `answers.${index}.reference_answer`, message: '参考答案为空' });
  });
  return errors;
}

module.exports = function createEssayFeature({ db, ok, fail }) {
  function alreadyExists(err) {
    const message = String(err?.message || err?.errMsg || '');
    return /already\s+exist|collection.*exist|DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS|Table\s+exist/i.test(message)
      || /DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS/i.test(String(err?.errCode || ''));
  }

  async function ensureCollections() {
    for (const name of Object.values(COLLECTIONS)) {
      try {
        await db.createCollection(name);
      } catch (err) {
        if (!alreadyExists(err)) throw err;
      }
    }
  }

  async function upsert(collectionName, record) {
    const id = record._id;
    const data = { ...record, updated_at: db.serverDate() };
    delete data._id;
    try {
      await db.collection(collectionName).doc(id).get();
      await db.collection(collectionName).doc(id).update({ data });
      return 'updated';
    } catch (err) {
      await db.collection(collectionName).add({ data: { _id: id, ...data, created_at: db.serverDate() } });
      return 'created';
    }
  }

  async function previewEssayPackage(event) {
    const data = normalizePackage(event.package || event.data);
    const errors = validatePackage(data);
    return ok({
      valid: errors.length === 0,
      errors,
      summary: {
        paper_id: data.paper._id,
        title: data.paper.title,
        materials: data.materials.length,
        questions: data.questions.length,
        answers: data.answers.length,
        total_score: data.paper.total_score,
        types: data.questions.map(item => ({ sequence: item.sequence, primary_type: item.primary_type, subtype: item.subtype })),
      },
      package: data,
    });
  }

  async function importEssayPackage(event) {
    const data = normalizePackage(event.package || event.data);
    const errors = validatePackage(data);
    if (errors.length) return fail(422, '申论试卷包校验失败', errors);
    await ensureCollections();

    const job = {
      _id: data.import_meta.import_id,
      paper_id: data.paper._id,
      content_hash: data.import_meta.content_hash,
      source_filename: data.paper.source_filename,
      parser_version: data.import_meta.parser_version,
      status: 'running',
      summary: { created: 0, updated: 0 },
    };
    await upsert(COLLECTIONS.imports, job);

    const summary = { created: 0, updated: 0, papers: 0, materials: 0, questions: 0, answers: 0 };
    const save = async (collection, record, counter) => {
      const result = await upsert(collection, { ...record, import_job_id: job._id });
      summary[result] += 1;
      summary[counter] += 1;
    };

    try {
      await save(COLLECTIONS.papers, data.paper, 'papers');
      for (const material of data.materials) await save(COLLECTIONS.materials, material, 'materials');
      for (const question of data.questions) await save(COLLECTIONS.questions, question, 'questions');
      for (const answer of data.answers) await save(COLLECTIONS.answers, answer, 'answers');
      await upsert(COLLECTIONS.imports, { ...job, status: 'completed', summary, completed_at: db.serverDate() });
      return ok({ import_id: job._id, paper_id: data.paper._id, ...summary }, '申论试卷导入完成');
    } catch (err) {
      try {
        await upsert(COLLECTIONS.imports, { ...job, status: 'failed', summary, error_message: String(err.message || err) });
      } catch (jobErr) {
        console.error('[essay] failed to update import job', jobErr);
      }
      throw err;
    }
  }

  async function listEssayPapers(event) {
    const page = Math.max(1, numberValue(event.page, 1));
    const pageSize = Math.min(100, Math.max(1, numberValue(event.page_size, 30)));
    try {
      const [listRes, countRes] = await Promise.all([
        db.collection(COLLECTIONS.papers).skip((page - 1) * pageSize).limit(pageSize).get(),
        db.collection(COLLECTIONS.papers).count(),
      ]);
      const list = listRes.data.sort((a, b) => numberValue(b.year) - numberValue(a.year));
      return ok({ list, total: countRes.total, page, page_size: pageSize });
    } catch (err) {
      return ok({ list: [], total: 0, page, page_size: pageSize });
    }
  }

  async function getEssayPaper(event) {
    const paperId = text(event.paper_id || event._id);
    if (!paperId) return fail(400, 'paper_id is required');
    try {
      const [paperRes, materialRes, questionRes, answerRes] = await Promise.all([
        db.collection(COLLECTIONS.papers).doc(paperId).get(),
        db.collection(COLLECTIONS.materials).where({ paper_id: paperId }).limit(100).get(),
        db.collection(COLLECTIONS.questions).where({ paper_id: paperId }).limit(100).get(),
        db.collection(COLLECTIONS.answers).where({ paper_id: paperId }).limit(100).get(),
      ]);
      const bySequence = (a, b) => numberValue(a.sequence) - numberValue(b.sequence);
      const questionSequence = new Map(questionRes.data.map(item => [item._id, numberValue(item.sequence)]));
      return ok({
        paper: paperRes.data,
        materials: materialRes.data.sort(bySequence),
        questions: questionRes.data.sort(bySequence),
        answers: answerRes.data.sort((a, b) => numberValue(questionSequence.get(a.question_id)) - numberValue(questionSequence.get(b.question_id))),
      });
    } catch (err) {
      return fail(404, '申论试卷不存在');
    }
  }

  async function setEssayPaperStatus(event) {
    const paperId = text(event.paper_id || event._id);
    const status = text(event.status);
    if (!paperId) return fail(400, 'paper_id is required');
    if (!['draft', 'enabled', 'disabled'].includes(status)) return fail(400, 'status is invalid');
    try {
      await db.collection(COLLECTIONS.papers).doc(paperId).get();
      const [materialRes, questionRes, answerRes] = await Promise.all([
        db.collection(COLLECTIONS.materials).where({ paper_id: paperId }).limit(100).get(),
        db.collection(COLLECTIONS.questions).where({ paper_id: paperId }).limit(100).get(),
        db.collection(COLLECTIONS.answers).where({ paper_id: paperId }).limit(100).get(),
      ]);
      const updateStatus = async (collection, records) => {
        for (const record of records) {
          await db.collection(collection).doc(record._id).update({ data: { status, updated_at: db.serverDate() } });
        }
      };
      await updateStatus(COLLECTIONS.materials, materialRes.data);
      await updateStatus(COLLECTIONS.questions, questionRes.data);
      await updateStatus(COLLECTIONS.answers, answerRes.data);
      await db.collection(COLLECTIONS.papers).doc(paperId).update({ data: { status, updated_at: db.serverDate() } });
      return ok({
        paper_id: paperId,
        status,
        materials: materialRes.data.length,
        questions: questionRes.data.length,
        answers: answerRes.data.length,
      }, status === 'enabled' ? '申论试卷已发布' : '申论试卷状态已更新');
    } catch (err) {
      return fail(404, '申论试卷不存在');
    }
  }

  return { previewEssayPackage, importEssayPackage, listEssayPapers, getEssayPaper, setEssayPaperStatus };
};
