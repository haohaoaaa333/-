const COLLECTIONS = {
  papers: 'papers',
  groups: 'paper_groups',
  solutions: 'question_solutions',
  media: 'question_media',
  imports: 'import_jobs',
  questions: 'questions',
  knowledge_points: 'knowledge_points',
};

const LETTERS = ['A', 'B', 'C', 'D'];

function text(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function blockHasContent(block) {
  if (!block || typeof block !== 'object') return false;
  if (block.type === 'image') return Boolean(text(block.asset_id) || text(block.src));
  if (block.type === 'formula') return Boolean(text(block.latex) || text(block.text));
  return Boolean(text(block.text));
}

function optionHasContent(option) {
  return Boolean(text(option?.text)
    || array(option?.images).length
    || array(option?.content_blocks).some(blockHasContent));
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
    if (!text(question.content) && !array(question.stem_blocks).some(blockHasContent)) {
      pushError(`questions.${index}.stem_blocks`, '题干文字和图片均为空');
    }
    const options = array(question.options_v2);
    if (options.length !== 4) {
      pushError(`questions.${index}.options_v2`, '单选题必须有4个选项');
    } else {
      options.forEach((option, optionIndex) => {
        if (!optionHasContent(option)) pushError(`questions.${index}.options_v2.${optionIndex}`, `选项 ${'ABCD'[optionIndex]} 为空`);
      });
    }
    if (question.composite_options_in_stem && question.review_confirmed !== true) {
      pushError(`questions.${index}.review_confirmed`, '题干合成图中的A-D选项尚未人工确认');
    }
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
    if (!hasSourceValidationErrors && !text(solution.explanation) && !array(solution.explanation_blocks).some(blockHasContent)) {
      pushError(`solutions.${index}.explanation_blocks`, '解析文字和图片均为空');
    }
  });
  const scanBlocks = (blocks, path) => array(blocks).forEach((block, index) => {
    if (block?.type === 'image' && !mediaIds.has(text(block.asset_id))) {
      pushError(`${path}.${index}`, `图片资源不存在：${block.asset_id || ''}`);
    }
  });
  groups.forEach((group, index) => {
    scanBlocks(group.material_blocks, `groups.${index}.material_blocks`);
    if (group.module_id === 'mod_data') {
      // P0-A2: 真实批次按 material 分组的题数不固定(6~60)，放宽“恰好5题”为“至少1题”。
      // 现有 5 题组仍满足 >=1，不受影响。
      if (array(group.question_ids).length < 1) pushError(`groups.${index}.question_ids`, '资料分析题组必须关联至少1道小题');
      if (!text(group.material_text) && !array(group.material_blocks).some(blockHasContent)) {
        pushError(`groups.${index}.material_blocks`, '资料分析材料为空');
      }
    }
  });
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
  function missingDocument(err) {
    return /not\s+exist|not\s+found|DATABASE_DOCUMENT_NOT_EXIST/i.test(String(err?.message || err?.errMsg || err?.errCode || ''));
  }
  function slugify(value) {
    return text(value).replace(/[^\w一-鿿-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'unknown';
  }

  // P0-B-3: 发布时把题目里的 knowledge_points 去重归集到 knowledge_points 集合。
  // 同一 paper 重复发布不会重复累加（paper_ids 用 addToSet 语义）。
  async function accumulateKnowledgePoints(questions, paperId) {
    const map = new Map();
    for (const q of array(questions)) {
      const kps = array(q.knowledge_points);
      const mod = text(q.module_id);
      for (const kp of kps) {
        const name = text(kp);
        if (!name) continue;
        const slug = slugify(name);
        if (!map.has(slug)) map.set(slug, { slug, name, module_id: mod, count: 0 });
        map.get(slug).count += 1;
      }
    }
    for (const { slug, name, module_id, count } of map.values()) {
      const id = `kp_${slug}`;
      try {
        const r = await db.collection(COLLECTIONS.knowledge_points).doc(id).get();
        const data = r.data || {};
        const paperIds = array(data.paper_ids);
        if (!paperIds.includes(paperId)) paperIds.push(paperId);
        await db.collection(COLLECTIONS.knowledge_points).doc(id).update({
          data: {
            name: data.name || name,
            module_id: module_id || data.module_id || null,
            paper_ids: paperIds,
            question_count: (data.question_count || 0) + count,
            updated_at: db.serverDate(),
          },
        });
      } catch (err) {
        if (!missingDocument(err)) throw err;
        await db.collection(COLLECTIONS.knowledge_points).add({
          data: {
            _id: id,
            name,
            module_id: module_id || null,
            paper_ids: [paperId],
            question_count: count,
            created_at: db.serverDate(),
            updated_at: db.serverDate(),
          },
        });
      }
    }
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
      const paperRecord = {
        _id: text(pkg.paper._id),
        name: text(pkg.paper.title),
        subject: text(pkg.paper.subject) || '公务员',
        category: text(pkg.paper.category) || '国考',
        year: Number(pkg.paper.year) || new Date().getFullYear(),
        total_questions: array(pkg.questions).length,
        source: text(pkg.paper.source) || 'official',
        status: 'published',
        schema_version: '2.0',
        created_at: db.serverDate(),
      };
      await save(COLLECTIONS.papers, paperRecord, 'papers');
      await saveMany(COLLECTIONS.media, array(pkg.media).map(media => ({ ...media, _id: media.asset_id })), 'media');
      await saveMany(COLLECTIONS.groups, array(pkg.groups).map(group => ({ ...group, status: 'enabled' })), 'groups');
      const groupMap = new Map(array(pkg.groups).map(group => [group._id, group]));
      const solutionMap = new Map(array(pkg.solutions).map(solution => [solution.question_id, solution]));
      // P0-C: 发布 questions 统一为 V2 规范 schema(设计 §8 正式题库)。
      // 规范字段: stem_blocks / options[{key,content}] / answer / analysis / knowledge_points / paper_id / question_no
      // answer 保留 0-3 索引(兼容 practice 判分)，并补 answer_letter 满足 V2 字母要求。
      const clientQuestions = array(pkg.questions).map(question => {
        const group = groupMap.get(question.group_id);
        const solution = solutionMap.get(question._id);
        const stemText = text(question.content)
          || array(question.stem_blocks).find(b => b && b.type === 'text' && text(b.text))?.text
          || '';
        const v2Options = array(question.options_v2).map(o => ({
          key: text(o?.key),
          content: text(o?.text) || text(o?.content)
            || array(o?.content_blocks).find(b => b && b.type === 'text' && text(b.text))?.text || '',
        }));
        const legacyOptions = array(question.options).map(o => (typeof o === 'string' ? o : (text(o?.text) || text(o?.content))));
        const answerIndex = Number.isInteger(question.answer)
          ? question.answer
          : LETTERS.indexOf(text(question.answer).toUpperCase());
        const explanation = solution?.explanation || question.explanation || '';
        const stemImages = array(question.stem_blocks).filter(b => b && b.type === 'image').map(b => b.src || b.asset_id);
        const explanationImages = array(solution?.explanation_blocks || question.explanation_blocks)
          .filter(b => b && b.type === 'image').map(b => b.src || b.asset_id);
        return {
          _id: question._id,
          paper_id: paperId,
          question_no: Number(question.question_number || 0),
          module_id: text(question.module_id) || null,
          type: text(question.type) || 'single_choice',
          // ---- V2 规范字段 ----
          stem_blocks: array(question.stem_blocks).length
            ? question.stem_blocks
            : (stemText ? [{ type: 'text', text: stemText }] : []),
          options: v2Options, // V2: [{key, content}]
          answer: answerIndex, // 保留索引(0-3)以兼容 practice 判分
          answer_letter: LETTERS[answerIndex] || null, // V2 字母答案(供外部 API)
          analysis: explanation, // V2 解析
          knowledge_points: array(question.knowledge_points),
          difficulty: text(question.difficulty) || 'medium',
          status: 1, // V2 numeric status
          // ---- 兼容字段(questions/formatQuestion 与既有直读仍可用) ----
          content: stemText,
          material: group?.material_text || '',
          material_images: group?.material_images || [],
          options_text: legacyOptions,
          explanation,
          answer_index: answerIndex,
          stem_images: stemImages,
          option_images: [],
          explanation_images: explanationImages,
          tags: array(question.tags),
          year: Number(question.year) || null,
          source: text(question.source) || null,
          paper_name: text(pkg.paper.title),
          province: text(pkg.paper.province) || '国家',
          position: text(pkg.paper.position) || '',
          paper_date: text(pkg.paper.paper_date) || '',
          created_at: db.serverDate(),
        };
      });
      await saveMany(COLLECTIONS.questions, clientQuestions, 'questions');
      await accumulateKnowledgePoints(clientQuestions, paperId);
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
