const COLLECTIONS = {
  papers: 'xingce_papers',
  groups: 'xingce_question_groups',
  solutions: 'xingce_solutions',
  media: 'question_media',
  imports: 'xingce_import_jobs',
  questions: 'questions',
};

function text(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function validatePackage(pkg) {
  const errors = [];
  const sourceValidationErrors = array(pkg?.validation_errors);
  const hasSourceValidationErrors = sourceValidationErrors.length > 0;
  const fingerprints = new Set();
  const pushError = (path, message) => {
    const fingerprint = `${path}|${message}`;
    if (fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint);
    errors.push({ path, message });
  };
  sourceValidationErrors.forEach((error, index) => {
    pushError(text(error?.path) || `validation_errors.${index}`, text(error?.message) || '本地转换校验失败');
  });
  const paper = pkg?.paper || {};
  const groups = array(pkg?.groups);
  const questions = array(pkg?.questions);
  const solutions = array(pkg?.solutions);
  const media = array(pkg?.media);
  if (Number(pkg?.schema_version) !== 2) pushError('schema_version', '仅支持行测V2题库包');
  if (!text(paper._id) || !text(paper.title)) pushError('paper', '试卷ID或标题缺失');
  if (!questions.length) pushError('questions', '题目为空');
  if (questions.length !== solutions.length) pushError('solutions', '题目与解析数量不一致');

  const groupIds = new Set(groups.map(item => text(item._id)));
  const questionIds = new Set(questions.map(item => text(item._id)));
  const mediaIds = new Set(media.map(item => text(item.asset_id || item._id)));
  const seen = new Set();
  questions.forEach((question, index) => {
    if (!question._id || seen.has(question._id)) pushError(`questions.${index}._id`, '题目ID缺失或重复');
    seen.add(question._id);
    if (!text(question.content) && !array(question.stem_blocks).some(block => block.type === 'image')) {
      pushError(`questions.${index}.stem_blocks`, '题干文字和图片均为空');
    }
    if (array(question.options_v2).length !== 4) pushError(`questions.${index}.options_v2`, '单选题必须有4个选项');
    if (!hasSourceValidationErrors && question.answer_verified === false) pushError(`questions.${index}.answer`, '答案缺失或不是A-D');
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer > 3) {
      pushError(`questions.${index}.answer`, '答案必须是A-D对应的0-3索引');
    }
    if (question.module_id === 'mod_data' && !groupIds.has(text(question.group_id))) {
      pushError(`questions.${index}.group_id`, '资料分析题未关联有效材料组');
    }
  });
  solutions.forEach((solution, index) => {
    if (!questionIds.has(text(solution.question_id))) pushError(`solutions.${index}.question_id`, '解析未匹配题目');
    if (!hasSourceValidationErrors && !text(solution.explanation) && !array(solution.explanation_blocks).some(block => block?.type === 'image')) {
      pushError(`solutions.${index}.explanation_blocks`, '解析文字和图片均为空');
    }
  });
  const scanBlocks = (blocks, path) => array(blocks).forEach((block, index) => {
    if (block?.type === 'image' && !mediaIds.has(text(block.asset_id))) {
      pushError(`${path}.${index}`, `图片资源不存在：${block.asset_id || ''}`);
    }
  });
  groups.forEach((group, index) => scanBlocks(group.material_blocks, `groups.${index}.material_blocks`));
  questions.forEach((question, index) => {
    scanBlocks(question.stem_blocks, `questions.${index}.stem_blocks`);
    array(question.options_v2).forEach((option, optionIndex) => scanBlocks(option.content_blocks, `questions.${index}.options_v2.${optionIndex}`));
  });
  solutions.forEach((solution, index) => scanBlocks(solution.explanation_blocks, `solutions.${index}.explanation_blocks`));
  return errors;
}

module.exports = function createXingceFeature({ db, ok, fail }) {
  function alreadyExists(err) {
    return /already\s+exist|collection.*exist|DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS|Table\s+exist/i
      .test(String(err?.message || err?.errMsg || err?.errCode || ''));
  }

  async function ensureCollections() {
    for (const name of Object.values(COLLECTIONS)) {
      try { await db.createCollection(name); } catch (err) { if (!alreadyExists(err)) throw err; }
    }
  }

  async function upsert(collectionName, record) {
    const id = text(record._id || record.asset_id);
    const data = { ...record, updated_at: db.serverDate() };
    delete data._id;
    if (record.asset_id && !record._id) delete data.asset_id;
    try {
      await db.collection(collectionName).doc(id).get();
      await db.collection(collectionName).doc(id).update({ data });
      return 'updated';
    } catch (err) {
      await db.collection(collectionName).add({ data: { _id: id, ...data, created_at: db.serverDate() } });
      return 'created';
    }
  }

  function summary(pkg) {
    return {
      paper_id: pkg.paper?._id,
      title: pkg.paper?.title,
      groups: array(pkg.groups).length,
      questions: array(pkg.questions).length,
      solutions: array(pkg.solutions).length,
      media: array(pkg.media).length,
      module_counts: array(pkg.questions).reduce((result, item) => {
        result[item.module_id] = (result[item.module_id] || 0) + 1;
        return result;
      }, {}),
    };
  }

  async function previewXingcePackage(event) {
    const pkg = event.package || event.data || {};
    const errors = validatePackage(pkg);
    return ok({ valid: errors.length === 0, errors, summary: summary(pkg) });
  }

  async function importXingcePackage(event) {
    const pkg = event.package || event.data || {};
    const errors = validatePackage(pkg);
    if (errors.length) return fail(422, '行测试卷包校验失败', errors);
    await ensureCollections();

    const paperId = text(pkg.paper._id);
    const importId = `xingce_import_${paperId}`;
    const counts = { created: 0, updated: 0, papers: 0, groups: 0, questions: 0, solutions: 0, media: 0 };
    const save = async (collection, record, counter) => {
      const result = await upsert(collection, { ...record, import_job_id: importId });
      counts[result] += 1;
      counts[counter] += 1;
    };
    const saveMany = async (collection, records, counter, concurrency = 10) => {
      for (let index = 0; index < records.length; index += concurrency) {
        await Promise.all(records.slice(index, index + concurrency).map(record => save(collection, record, counter)));
      }
    };
    await upsert(COLLECTIONS.imports, { _id: importId, paper_id: paperId, status: 'running', summary: counts });

    try {
      await save(COLLECTIONS.papers, { ...pkg.paper, schema_version: 2, status: 'enabled' }, 'papers');
      await saveMany(COLLECTIONS.media, array(pkg.media).map(media => ({ ...media, _id: media.asset_id })), 'media');
      await saveMany(COLLECTIONS.groups, array(pkg.groups).map(group => ({ ...group, status: 'enabled' })), 'groups');
      const groupMap = new Map(array(pkg.groups).map(group => [group._id, group]));
      const solutionMap = new Map(array(pkg.solutions).map(solution => [solution.question_id, solution]));
      const clientQuestions = array(pkg.questions).map(question => {
        const group = groupMap.get(question.group_id);
        const solution = solutionMap.get(question._id);
        // questions is the current client projection; V2 blocks remain available
        // while legacy flat fields keep the existing practice page working.
        return {
          ...question,
          material: group?.material_text || '',
          material_images: group?.material_images || [],
          explanation: solution?.explanation || question.explanation || '',
          explanation_images: solution?.explanation_images || question.explanation_images || [],
          status: 'enabled',
        };
      });
      await saveMany(COLLECTIONS.questions, clientQuestions, 'questions');
      await saveMany(COLLECTIONS.solutions, array(pkg.solutions).map(solution => ({ ...solution, status: 'enabled' })), 'solutions');
      await upsert(COLLECTIONS.imports, { _id: importId, paper_id: paperId, status: 'completed', summary: counts, completed_at: db.serverDate() });
      return ok({ import_id: importId, paper_id: paperId, ...counts }, '行测试卷导入完成');
    } catch (err) {
      try { await upsert(COLLECTIONS.imports, { _id: importId, paper_id: paperId, status: 'failed', summary: counts, error_message: String(err.message || err) }); } catch (_) { /* noop */ }
      throw err;
    }
  }

  return { previewXingcePackage, importXingcePackage };
};
