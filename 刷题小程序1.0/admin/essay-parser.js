(function initEssayParser(globalScope) {
  'use strict';

  const CHINESE_NUMBERS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const PRIMARY_TYPES = new Set(['summary', 'analysis', 'countermeasure', 'practical_writing', 'essay']);

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function cleanSourceText(value) {
    return normalizeText(value)
      .split('\n')
      .filter(line => !/【认准淘宝店铺[\s\S]*?持续更新/.test(line))
      .filter(line => !/^第\s*\d+\s*\/\s*\d+\s*页\s*$/.test(line.trim()))
      .filter(line => !/^!\[[^\]]*]\([^)]*\)\s*$/.test(line.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function stableHash(value) {
    const text = String(value || '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function findAllSections(text, pattern) {
    const matches = Array.from(text.matchAll(pattern));
    return matches.map((match, index) => ({
      match,
      start: match.index,
      end: index + 1 < matches.length ? matches[index + 1].index : text.length,
    }));
  }

  function extractTitle(text, fallbackName) {
    const beforeMaterial = text.split(/^材料\s*1\s*$/m)[0] || '';
    const title = beforeMaterial.replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
    const fallback = String(fallbackName || '申论试卷').replace(/\.md$/i, '').trim();
    return title || fallback;
  }

  function inferPaperMeta(title) {
    const year = Number((title.match(/(20\d{2}|19\d{2})/) || [])[1]) || new Date().getFullYear();
    const isNational = /国家公考|国考|国家公务员/.test(title);
    let paperLevel = 'general';
    let levelLabel = '通用';
    if (/地市级/.test(title)) { paperLevel = 'city'; levelLabel = '地市级'; }
    else if (/副省级/.test(title)) { paperLevel = 'sub_provincial'; levelLabel = '副省级'; }
    else if (/行政执法/.test(title)) { paperLevel = 'law_enforcement'; levelLabel = '行政执法类'; }
    const examType = isNational ? 'national' : 'provincial';
    const examLabel = isNational ? '国家公务员考试' : '公务员考试';
    return {
      year,
      exam_type: examType,
      paper_level: paperLevel,
      source_kind: /回忆版/.test(title) ? 'memory_version' : 'unknown',
      canonical_title: `${year}年${examLabel}申论（${levelLabel}）`,
      paper_id: `sl_${year}_${examType}_${paperLevel}`,
    };
  }

  function parseMaterials(materialText, paperId) {
    return findAllSections(materialText, /^材料\s*(\d+)\s*$/gm).map(section => {
      const sequence = Number(section.match[1]);
      const content = normalizeText(materialText.slice(section.match.index + section.match[0].length, section.end));
      return {
        _id: `${paperId}_m${sequence}`,
        paper_id: paperId,
        sequence,
        title: `给定资料${sequence}`,
        content,
        images: [],
        topic_tags: [],
        status: 'draft',
      };
    });
  }

  function splitPromptAndRequirements(raw) {
    const normalized = normalizeText(raw);
    const marker = normalized.search(/(?:^|\n)要求[：:]?/m);
    if (marker >= 0) {
      const markerText = normalized.slice(marker).match(/^\n?要求[：:]?/)?.[0] || '';
      return {
        prompt: normalizeText(normalized.slice(0, marker)),
        requirementText: normalizeText(normalized.slice(marker + markerText.length)),
      };
    }

    const inline = normalized.match(/^(.*?[。；）)])\s*要求[：:]\s*([\s\S]+)$/);
    if (inline) return { prompt: normalizeText(inline[1]), requirementText: normalizeText(inline[2]) };
    return { prompt: normalized, requirementText: '' };
  }

  function inferQuestionType(prompt) {
    const text = normalizeText(prompt);
    if (/写一篇文章|自拟题目|自选角度/.test(text)) {
      return { primary_type: 'essay', subtype: /关系|互补|相互/.test(text) ? 'relation_essay' : 'topic_essay', tested_elements: ['argument', 'evidence', 'structure'] };
    }
    if (/提案|讲话稿|发言稿|宣传稿|倡议书|公开信|汇报|报告|评论|工作方案|材料提纲|经验交流.*提纲/.test(text)) {
      let genre = 'other';
      if (/提案/.test(text)) genre = 'proposal';
      else if (/讲话稿|发言稿/.test(text)) genre = 'speech';
      else if (/宣传稿/.test(text)) genre = 'publicity';
      else if (/倡议书/.test(text)) genre = 'initiative';
      else if (/公开信/.test(text)) genre = 'letter';
      else if (/汇报/.test(text)) genre = 'brief';
      else if (/报告/.test(text)) genre = 'report';
      else if (/评论/.test(text)) genre = 'commentary';
      else if (/方案/.test(text)) genre = 'work_plan';
      else if (/提纲/.test(text)) genre = 'outline';
      return { primary_type: 'practical_writing', subtype: genre, document_genre: genre, tested_elements: ['background', 'reason', 'countermeasure'] };
    }
    if (/建议|对策|措施|如何解决|提出.*办法|深化改革/.test(text)) {
      const compound = /成效|成绩|成果/.test(text);
      return {
        primary_type: 'countermeasure',
        subtype: compound ? 'achievement_and_suggestion' : 'direct_suggestion',
        tested_elements: compound ? ['achievement', 'problem', 'countermeasure'] : ['problem', 'countermeasure'],
      };
    }
    if (/理解|解释|分析|认识|看法|评价|评析|关系|机制|互动|为何|为什么/.test(text)) {
      let subtype = 'phenomenon_analysis';
      if (/关系|机制|互动|如何通过/.test(text)) subtype = 'mechanism_analysis';
      else if (/含义|理解|解释/.test(text)) subtype = 'phrase_explanation';
      else if (/观点|看法|评价|评析/.test(text)) subtype = 'view_analysis';
      return { primary_type: 'analysis', subtype, tested_elements: ['manifestation', 'cause', 'effect'] };
    }
    let subtype = 'manifestation';
    if (/问题|不足|困境/.test(text)) subtype = 'problem';
    else if (/原因/.test(text)) subtype = 'cause';
    else if (/影响|意义|作用/.test(text)) subtype = 'effect';
    else if (/做法|如何做|经验/.test(text)) subtype = 'practice';
    else if (/成效|成果/.test(text)) subtype = 'achievement';
    else if (/特点|特征|体现/.test(text)) subtype = 'feature';
    return { primary_type: 'summary', subtype, tested_elements: [subtype] };
  }

  function parseRequirements(prompt, requirementText) {
    const combined = `${prompt}\n${requirementText}`;
    const score = Number((combined.match(/[（(]\s*(\d+)\s*分\s*[）)]/) || [])[1]) || 0;
    const range = combined.match(/(?:字数)?\s*(\d+)\s*[-—至]\s*(\d+)\s*字/);
    const maxOnly = combined.match(/不超过\s*(\d+)\s*字/);
    const items = normalizeText(requirementText)
      .replace(/^[：:]\s*/, '')
      .split(/\n|(?=（\d+）)/)
      .map(item => item.replace(/^（\d+）\s*/, '').replace(/[；;。]\s*$/, '').trim())
      .filter(Boolean)
      .filter(item => !/^(?:不超过\s*\d+\s*字|字数\s*\d+\s*[-—至]\s*\d+\s*字)$/.test(item));
    return {
      score,
      requirements: {
        min_words: range ? Number(range[1]) : 0,
        max_words: range ? Number(range[2]) : (maxOnly ? Number(maxOnly[1]) : 0),
        items,
      },
    };
  }

  function parseMaterialRefs(prompt, materials) {
    const refs = Array.from(prompt.matchAll(/(?:给定资料|资料|材料)\s*[“"']?(\d+)[”"']?/g))
      .map(match => Number(match[1]))
      .filter(Number.isFinite);
    const unique = Array.from(new Set(refs));
    if (unique.length) return unique.map(sequence => materials.find(item => item.sequence === sequence)?._id).filter(Boolean);
    return /给定资料|全部资料|联系实际/.test(prompt) ? materials.map(item => item._id) : [];
  }

  function parseQuestions(questionText, paperId, materials) {
    const sections = findAllSections(questionText, /^第([一二三四五六七八九十])题\s*$/gm);
    return sections.map(section => {
      const sequence = CHINESE_NUMBERS[section.match[1]];
      const raw = normalizeText(questionText.slice(section.match.index + section.match[0].length, section.end));
      const { prompt, requirementText } = splitPromptAndRequirements(raw);
      const type = inferQuestionType(prompt);
      const meta = parseRequirements(prompt, requirementText);
      const cleanedPrompt = prompt.replace(/[（(]\s*\d+\s*分\s*[）)]/g, '').trim();
      const requiredSections = [];
      if (/案由/.test(cleanedPrompt)) requiredSections.push('案由');
      if (/建议/.test(cleanedPrompt)) requiredSections.push('建议');
      return {
        _id: `${paperId}_q${sequence}`,
        paper_id: paperId,
        sequence,
        primary_type: type.primary_type,
        subtype: type.subtype,
        tested_elements: type.tested_elements,
        document_genre: type.document_genre || '',
        required_sections: requiredSections,
        material_ids: parseMaterialRefs(cleanedPrompt, materials),
        prompt: cleanedPrompt,
        score: meta.score,
        requirements: meta.requirements,
        difficulty: '中等',
        topic_tags: [],
        knowledge_refs: [],
        status: 'draft',
      };
    });
  }

  function extractAnswerOutline(answerText, isEssay) {
    if (isEssay) return [];
    return normalizeText(answerText)
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^(?:[一二三四五六七八九十]+、|\d+[.、])/.test(line))
      .map(line => line.replace(/^(?:[一二三四五六七八九十]+、|\d+[.、])\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 30);
  }

  function parseAnswers(answerText, paperId, questions) {
    const sections = findAllSections(answerText, /^问题([一二三四五六七八九十])\s*$/gm);
    return sections.map(section => {
      const sequence = CHINESE_NUMBERS[section.match[1]];
      const question = questions.find(item => item.sequence === sequence);
      const raw = normalizeText(answerText.slice(section.match.index + section.match[0].length, section.end))
        .replace(/^参考答案[：:]\s*/i, '')
        .trim();
      const isEssay = question?.primary_type === 'essay';
      const firstBreak = raw.indexOf('\n');
      return {
        _id: `${paperId}_q${sequence}_answer`,
        paper_id: paperId,
        question_id: `${paperId}_q${sequence}`,
        answer_type: 'third_party_reference',
        reference_answer: raw,
        answer_outline: extractAnswerOutline(raw, isEssay),
        scoring_points: [],
        essay_title: isEssay ? (firstBreak >= 0 ? raw.slice(0, firstBreak).trim() : raw) : '',
        status: 'draft',
      };
    });
  }

  function validatePackage(data) {
    const errors = [];
    const paper = data?.paper || {};
    const materials = Array.isArray(data?.materials) ? data.materials : [];
    const questions = Array.isArray(data?.questions) ? data.questions : [];
    const answers = Array.isArray(data?.answers) ? data.answers : [];
    if (!paper._id) errors.push({ path: 'paper._id', message: '试卷ID缺失' });
    if (!paper.title) errors.push({ path: 'paper.title', message: '试卷标题缺失' });
    if (!materials.length) errors.push({ path: 'materials', message: '未识别到给定资料' });
    if (!questions.length) errors.push({ path: 'questions', message: '未识别到申论题目' });
    if (answers.length !== questions.length) errors.push({ path: 'answers', message: `答案数量 ${answers.length} 与题目数量 ${questions.length} 不一致` });
    const materialIds = new Set(materials.map(item => item._id));
    const questionIds = new Set(questions.map(item => item._id));
    materials.forEach((item, index) => {
      if (!item.content) errors.push({ path: `materials.${index}.content`, message: '材料正文为空' });
    });
    questions.forEach((item, index) => {
      if (!item.prompt) errors.push({ path: `questions.${index}.prompt`, message: '题干为空' });
      if (!PRIMARY_TYPES.has(item.primary_type)) errors.push({ path: `questions.${index}.primary_type`, message: '一级题型无效' });
      item.material_ids.forEach(id => {
        if (!materialIds.has(id)) errors.push({ path: `questions.${index}.material_ids`, message: `引用了不存在的材料 ${id}` });
      });
    });
    answers.forEach((item, index) => {
      if (!questionIds.has(item.question_id)) errors.push({ path: `answers.${index}.question_id`, message: '答案未匹配到题目' });
      if (!item.reference_answer) errors.push({ path: `answers.${index}.reference_answer`, message: '参考答案为空' });
    });
    return errors;
  }

  function parseEssayPaperMarkdown(source, options) {
    const opts = options || {};
    const cleanText = cleanSourceText(source);
    const title = extractTitle(cleanText, opts.filename);
    const meta = inferPaperMeta(title);
    const requirementMarker = cleanText.search(/^作答要求\s*$/m);
    if (requirementMarker < 0) throw new Error('未找到“作答要求”，无法识别申论题目');
    const answerHeading = cleanText.search(/^.*申论.*参考答案\s*$/m);
    if (answerHeading < 0) throw new Error('未找到申论参考答案标题');

    const materialText = cleanText.slice(0, requirementMarker);
    const questionText = cleanText.slice(requirementMarker + cleanText.slice(requirementMarker).match(/^作答要求\s*$/m)[0].length, answerHeading);
    const answerStart = cleanText.indexOf('\n', answerHeading);
    const answerText = cleanText.slice(answerStart >= 0 ? answerStart + 1 : answerHeading);
    const materials = parseMaterials(materialText, meta.paper_id);
    const questions = parseQuestions(questionText, meta.paper_id, materials);
    const answers = parseAnswers(answerText, meta.paper_id, questions);
    const totalScore = questions.reduce((sum, item) => sum + item.score, 0);
    const contentHash = stableHash(cleanText);
    const data = {
      paper: {
        _id: meta.paper_id,
        title: meta.canonical_title,
        original_title: title,
        year: meta.year,
        exam_type: meta.exam_type,
        paper_level: meta.paper_level,
        source_kind: meta.source_kind,
        source_filename: opts.filename || '',
        content_hash: contentHash,
        total_score: totalScore,
        question_count: questions.length,
        material_count: materials.length,
        status: 'draft',
      },
      materials,
      questions,
      answers,
      import_meta: {
        import_id: `essay_import_${contentHash}`,
        content_hash: contentHash,
        parser_version: 1,
        removed_watermarks: (String(source).match(/【认准淘宝店铺/g) || []).length,
        removed_page_markers: (String(source).match(/第\s*\d+\s*\/\s*\d+\s*页/g) || []).length,
      },
    };
    data.validation_errors = validatePackage(data);
    return data;
  }

  const api = { cleanSourceText, inferQuestionType, parseEssayPaperMarkdown, stableHash, validatePackage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.EssayParser = api;
}(typeof window !== 'undefined' ? window : globalThis));
