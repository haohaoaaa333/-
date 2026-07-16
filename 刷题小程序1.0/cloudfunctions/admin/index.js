const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const { createAuth } = require('./lib/auth');
const { createRequestId, attachRequestId, errorBody } = require('./lib/response');
const logger = require('./lib/logger');

const COLLECTIONS = [
  'questions',
  'users',
  'practice_records',
  'practice_sessions',
  'user_progress',
  'categories',
  'banners',
  'vip_plans',
  'orders',
  'book_packs',
  'book_upload_chunks',
  'essay_papers',
  'essay_materials',
  'essay_questions',
  'essay_answers',
  'essay_import_jobs',
  'papers',
  'paper_groups',
  'question_solutions',
  'question_media',
  'import_jobs',
  'question_drafts',
  'admin_users',
  'import_tasks',
  'draft_papers',
  'review_events',
  'draft_assets',
  'wrong_questions',
  'knowledge_points',
  'favorites',
];

const MODULES = [
  'mod_common_sense',
  'mod_language',
  'mod_quantity',
  'mod_logic',
  'mod_data',
];

function ok(data, message = 'ok') {
  return { code: 0, data, message };
}

function fail(code, message, extra) {
  return { code, message, ...(extra ? { extra } : {}) };
}

const essayFeature = require('./features/essay')({ db, ok, fail });
const xingceFeature = require('./features/xingce')({ db, ok, fail });
const draftsFeature = require('./features/drafts-v2')({ db, ok, fail, xingceFeature });
const importTasksFeature = require('./features/import-tasks')({ db, ok, fail });
const fileFeature = require('./features/files')({ cloud, ok, fail });
const adminAuth = createAuth({ cloud, db });

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

function isHttpEvent(event) {
  return Boolean(event && (event.httpMethod || event.headers || event.requestContext || typeof event.body === 'string'));
}

function requestOrigin(event) {
  const headers = event?.headers || {};
  return headers.origin || headers.Origin || '';
}

function corsHeaders(event) {
  const configured = String(process.env.ADMIN_ALLOWED_ORIGINS || 'http://127.0.0.1:8787,http://localhost:8787')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const origin = requestOrigin(event);
  return {
    ...CORS_HEADERS,
    ...(origin && configured.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  };
}

function httpResponse(statusCode, body, event) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(event),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function respond(rawEvent, body, statusCode, requestId) {
  const payload = attachRequestId(body, requestId);
  if (!isHttpEvent(rawEvent)) return payload;
  return httpResponse(statusCode || (payload && payload.code >= 400 ? payload.code : 200), payload, rawEvent);
}

function isOptionsRequest(event) {
  const method = event && (event.httpMethod || event.method || event.requestContext?.httpMethod);
  return String(method || '').toUpperCase() === 'OPTIONS';
}

function parseEvent(event) {
  if (!event || !event.body) return event || {};
  if (typeof event.body === 'object') return { ...event, ...event.body };
  try {
    return { ...event, ...JSON.parse(event.body) };
  } catch (err) {
    return event;
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map(item => normalizeText(String(item))).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|;|；/)
      .map(item => normalizeText(item))
      .filter(Boolean);
  }
  return [];
}

function normalizeImageArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => normalizeText(String(item))).filter(Boolean);
}

function normalizeOptionImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map(group => normalizeImageArray(group));
}

function normalizeAnswer(value, type) {
  if (type === 'multiple') {
    if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
    if (typeof value === 'string') {
      return value.split(',').map(item => Number(item.trim())).filter(Number.isFinite);
    }
    if (Number.isFinite(Number(value))) return [Number(value)];
    return [];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (/^[A-D]$/.test(trimmed)) return trimmed.charCodeAt(0) - 65;
  }
  if (Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function normalizeQuestion(raw) {
  const type = raw.type === 'multiple' ? 'multiple' : 'single';
  const now = db.serverDate();
  const question = {
    _id: normalizeText(raw._id || raw.id || raw.question_id),
    module_id: normalizeText(raw.module_id || raw.category || 'mod_language'),
    type,
    difficulty: normalizeText(raw.difficulty || '中等'),
    source: normalizeText(raw.source || '真题'),
    year: Number(raw.year) || new Date().getFullYear(),
    content: normalizeText(raw.content || raw.stem || raw.title),
    material: normalizeText(raw.material),
    material_images: normalizeImageArray(raw.material_images || raw.materialImages),
    stem_images: normalizeImageArray(raw.stem_images || raw.stemImages),
    options: normalizeArray(raw.options || raw.optionTexts),
    option_images: normalizeOptionImages(raw.option_images || raw.optionImages),
    answer: normalizeAnswer(raw.answer ?? raw.correctOption, type),
    explanation: normalizeText(raw.explanation || raw.analysis),
    explanation_images: normalizeImageArray(raw.explanation_images || raw.analysisImages),
    commonErrors: normalizeText(raw.commonErrors || raw.common_errors),
    tags: normalizeArray(raw.tags),
    points: Number(raw.points) || 1,
    paper_id: normalizeText(raw.paper_id),
    paper_name: normalizeText(raw.paper_name),
    province: normalizeText(raw.province || '国家'),
    position: normalizeText(raw.position),
    paper_date: normalizeText(raw.paper_date),
    status: raw.status === 'disabled' ? 'disabled' : 'enabled',
    updated_at: now,
  };

  if (!question._id) {
    question._id = `q_${question.module_id}_${question.year}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  if (!MODULES.includes(question.module_id)) {
    question.module_id = 'mod_language';
  }

  if (!['简单', '中等', '困难'].includes(question.difficulty)) {
    question.difficulty = '中等';
  }

  return question;
}

function isPlaceholderOptionSet(options) {
  return Array.isArray(options) && options.length === 4 && options.every((opt, index) => opt === `选项${'ABCD'[index]}`);
}

function isQuestionLikeContent(content) {
  const text = String(content || '').trim();
  return /[？?：:]$/.test(text) || /多少|比例|比重|正确|可以|能够|约为|是：|为：/.test(text);
}

function optionSignalCount(question) {
  const textCount = Array.isArray(question.options)
    ? question.options.filter(option => normalizeText(option)).length
    : 0;
  const imageCount = Array.isArray(question.option_images)
    ? question.option_images.filter(group => Array.isArray(group) && group.length > 0).length
    : 0;
  return Math.max(textCount, imageCount);
}

function splitOptionTrailingMaterial(option) {
  const text = String(option || '');
  const marker = text.search(/\n\s*[（(][一二三四五六七八九十]+[）)]/);
  if (marker < 0) return { option: text.trim(), material: '' };
  return {
    option: text.slice(0, marker).trim(),
    material: text.slice(marker).trim(),
  };
}

function repairDataMaterialsInList(list) {
  const repaired = [];
  const skipped = [];
  let pendingMaterial = '';
  let activeMaterial = '';
  let activeRemaining = 0;

  list.forEach(question => {
    const q = { ...question, options: [...(question.options || [])] };
    let trailingMaterial = '';
    q.options = q.options.map(option => {
      const split = splitOptionTrailingMaterial(option);
      if (split.material) trailingMaterial += `\n${split.material}`;
      return split.option;
    }).filter(Boolean);

    const isData = q.module_id === 'mod_data';
    const isFragment = isData && isPlaceholderOptionSet(q.options) && !isQuestionLikeContent(q.content);

    if (isFragment) {
      pendingMaterial = `${pendingMaterial}\n${q.content}`.trim();
      skipped.push(q._id);
      return;
    }

    if (isData) {
      if (pendingMaterial) {
        activeMaterial = pendingMaterial;
        activeRemaining = 5;
        pendingMaterial = '';
      }
      if (!q.material && activeMaterial && activeRemaining > 0) {
        q.material = activeMaterial;
      }
      if (activeRemaining > 0) activeRemaining -= 1;
      if (trailingMaterial) {
        pendingMaterial = trailingMaterial.trim();
      }
    }

    repaired.push(q);
  });

  return { repaired, skipped };
}

function validateQuestion(question) {
  const errors = [];
  if (!question._id) errors.push('_id is required');
  if (!question.content) errors.push('content is required');
  if (optionSignalCount(question) < 2) errors.push('options must contain at least 2 items');
  if (!MODULES.includes(question.module_id)) errors.push('module_id is invalid');
  if (question.type === 'single' && !Number.isInteger(question.answer)) errors.push('answer must be a number for single choice');
  if (question.type === 'multiple' && !Array.isArray(question.answer)) errors.push('answer must be an array for multiple choice');
  return errors;
}

function buildQuestionWhere(event) {
  const where = {};
  if (event.module_id) where.module_id = event.module_id;
  if (event.year && Number(event.year) > 0) where.year = Number(event.year);
  if (event.difficulty) where.difficulty = event.difficulty;
  if (event.status) where.status = event.status;
  if (event.keyword) {
    const keyword = String(event.keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    where.content = db.RegExp({ regexp: keyword, options: 'i' });
  }
  return where;
}

async function countCollection(collection) {
  try {
    const res = await db.collection(collection).count();
    return res.total;
  } catch (err) {
    return 0;
  }
}

async function ensureBookPacksCollection() {
  try {
    await db.createCollection('book_packs');
  } catch (err) {
    const msg = String((err && err.message) || '');
    if (/collection\s+already\s+exists|DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS|Db\s+or\s+Table\s+already\s+exist|Table\s+exist/i.test(msg)) {
      return;
    }
    if (err && err.errCode && /DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS/i.test(err.errCode)) return;
    throw err;
  }
}

async function dashboard() {
  const totals = {};
  await Promise.all(COLLECTIONS.map(async name => {
    totals[name] = await countCollection(name);
  }));

  const moduleCounts = {};
  await Promise.all(MODULES.map(async moduleId => {
    const res = await db.collection('questions').where({ module_id: moduleId }).count();
    moduleCounts[moduleId] = res.total;
  }));

  let recentQuestions = [];
  try {
    const res = await db.collection('questions')
      .field({ _id: true, module_id: true, year: true, difficulty: true, content: true, updated_at: true })
      .orderBy('updated_at', 'desc')
      .limit(8)
      .get();
    recentQuestions = res.data;
  } catch (err) {
    recentQuestions = [];
  }

  return ok({ totals, module_counts: moduleCounts, recent_questions: recentQuestions });
}

async function listQuestions(event) {
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(event.page_size || event.pageSize) || 20));
  const where = buildQuestionWhere(event);
  const collection = db.collection('questions').where(where);
  const [listRes, totalRes] = await Promise.all([
    collection
      .field({
        _id: true,
        module_id: true,
        type: true,
        difficulty: true,
        source: true,
        year: true,
        content: true,
        options: true,
        answer: true,
        explanation: true,
        tags: true,
        status: true,
        updated_at: true,
      })
      .orderBy('year', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get(),
    collection.count(),
  ]);

  return ok({
    list: listRes.data,
    total: totalRes.total,
    page,
    page_size: pageSize,
    has_more: page * pageSize < totalRes.total,
  });
}

async function upsertQuestion(event) {
  const question = normalizeQuestion(event.question || event.data || event);
  const errors = validateQuestion(question);
  if (errors.length > 0) return fail(422, 'question validation failed', errors);

  const docId = question._id;
  const data = { ...question };
  delete data._id;

  try {
    await db.collection('questions').doc(docId).update({ data });
    return ok({ _id: docId, updated: 1, created: 0 });
  } catch (err) {
    await db.collection('questions').add({
      data: { _id: docId, ...data, created_at: db.serverDate() },
    });
    return ok({ _id: docId, updated: 0, created: 1 });
  }
}

async function deleteQuestion(event) {
  const questionId = event.question_id || event._id;
  if (!questionId) return fail(400, 'question_id is required');
  await db.collection('questions').doc(questionId).update({
    data: { status: 'disabled', updated_at: db.serverDate() },
  });
  return ok({ _id: questionId, status: 'disabled' });
}

async function clearQuestions(event) {
  if (event.confirm_text !== '清空题库') {
    return fail(400, 'confirm_text must be 清空题库');
  }

  const pageSize = Math.min(20, Math.max(1, Number(event.page_size) || 20));
  const res = await db.collection('questions')
    .field({ _id: true })
    .limit(pageSize)
    .get();
  const ids = res.data.map(item => item._id).filter(Boolean);
  await Promise.all(ids.map(id => db.collection('questions').doc(id).remove()));

  const remaining = await db.collection('questions').count();
  return ok({
    collection: 'questions',
    deleted: ids.length,
    remaining: remaining.total,
    has_more: remaining.total > 0,
  });
}

async function batchImportQuestions(event) {
  const records = Array.isArray(event.questions) ? event.questions : [];
  const forceUpdate = Boolean(event.force_update);
  const dryRun = Boolean(event.dry_run);
  const limit = Math.min(5, records.length);
  const normalizedRaw = records.slice(0, limit).map(normalizeQuestion);
  const { repaired: normalized, skipped } = repairDataMaterialsInList(normalizedRaw);
  const invalid = normalized
    .map((question, index) => ({ index, _id: question._id, errors: validateQuestion(question) }))
    .filter(item => item.errors.length > 0);

  if (invalid.length > 0 || dryRun) {
    return ok({
      accepted: normalized.length - invalid.length,
      invalid,
      skipped_fragments: skipped,
      dry_run: dryRun,
      preview: normalized.slice(0, 5),
    });
  }

  let created = 0;
  let updated = 0;
  const errors = [];

  for (const question of normalized) {
    const docId = question._id;
    const data = { ...question };
    delete data._id;
    try {
      await db.collection('questions').doc(docId).get();
      if (forceUpdate) {
        await db.collection('questions').doc(docId).update({ data });
        updated += 1;
      }
    } catch (err) {
      try {
        await db.collection('questions').add({ data: { _id: docId, ...data, created_at: db.serverDate() } });
        created += 1;
      } catch (addErr) {
        errors.push({ _id: docId, message: addErr.message });
      }
    }
  }

  return ok({ received: records.length, processed: normalized.length, created, updated, skipped: normalized.length - created - updated - errors.length, skipped_fragments: skipped, errors });
}

async function repairDataMaterials(event) {
  const max = Math.min(5000, Math.max(1, Number(event.limit) || 5000));
  const pageSize = 1000;
  const all = [];
  for (let skip = 0; skip < max; skip += pageSize) {
    const res = await db.collection('questions')
      .where({ module_id: 'mod_data' })
      .field({ _id: true, module_id: true, content: true, material: true, options: true, answer: true, status: true, year: true })
      .orderBy('year', 'asc')
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(pageSize)
      .get();
    all.push(...res.data);
    if (res.data.length < pageSize) break;
  }

  const { repaired, skipped } = repairDataMaterialsInList(all);
  let updated = 0;
  let disabled = 0;

  for (const question of repaired) {
    if (!question.material) continue;
    await db.collection('questions').doc(question._id).update({
      data: {
        material: question.material,
        options: question.options,
        updated_at: db.serverDate(),
      },
    });
    updated += 1;
  }

  for (const id of skipped) {
    await db.collection('questions').doc(id).update({
      data: {
        status: 'disabled',
        updated_at: db.serverDate(),
      },
    });
    disabled += 1;
  }

  return ok({ scanned: all.length, updated, disabled, has_more: all.length >= max });
}

async function exportQuestions(event) {
  const where = buildQuestionWhere(event);
  const limit = Math.min(1000, Math.max(1, Number(event.limit) || 500));
  const res = await db.collection('questions').where(where).limit(limit).get();
  return ok({ list: res.data, count: res.data.length, limit });
}

async function listUsers(event) {
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(event.page_size || event.pageSize) || 20));
  const [listRes, totalRes] = await Promise.all([
    db.collection('users')
      .field({
        _id: true,
        _openid: true,
        user_name: true,
        avatar_url: true,
        today_done: true,
        total_done: true,
        total_correct: true,
        vip_status: true,
        updated_at: true,
      })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get(),
    db.collection('users').count(),
  ]);
  return ok({ list: listRes.data, total: totalRes.total, page, page_size: pageSize });
}

// ───────────────────────── 图书礼包（book_packs） ─────────────────────────

const BOOK_PACK_MAX_BYTES = 25 * 1024 * 1024; // 单文件 25MB 保护上限
const BOOK_UPLOAD_CHUNK_COLLECTION = 'book_upload_chunks';

function detectFileType(fileType, fileName) {
  const t = String(fileType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  if (/word|doc|wps/i.test(t) || name.endsWith('.doc') || name.endsWith('.docx')) return 'word';
  return 'pdf';
}

async function getBookUploadUrl(event) {
  await ensureBookPacksCollection();
  const cloudPath = normalizeText(event.cloud_path);
  if (!cloudPath) return fail(400, 'cloud_path is required');

  let meta;
  try {
    const res = await cloud.getUploadMetadata({ cloudPath });
    meta = res.data;
  } catch (err) {
    return fail(500, `get upload metadata failed: ${err.message}`);
  }

  return ok({
    cloud_path: cloudPath,
    url: meta.url,
    authorization: meta.authorization,
    token: meta.token,
    cos_file_id: meta.cosFileId,
    file_id: meta.fileId,
    download_url: meta.download_url,
  });
}

async function ensureBookUploadChunksCollection() {
  try {
    await db.createCollection(BOOK_UPLOAD_CHUNK_COLLECTION);
  } catch (err) {
    const msg = String((err && err.message) || '');
    if (/collection\s+already\s+exists|DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS|Db\s+or\s+Table\s+already\s+exist|Table\s+exist/i.test(msg)) {
      return;
    }
    if (err && err.errCode && /DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS/i.test(err.errCode)) return;
    throw err;
  }
}

function safeDocId(value) {
  return String(value || '').replace(/[^\w-]/g, '_').slice(0, 80);
}

async function cleanupBookUploadChunks(uploadId, total) {
  const tasks = [];
  for (let index = 0; index < total; index += 1) {
    tasks.push(db.collection(BOOK_UPLOAD_CHUNK_COLLECTION).doc(`${uploadId}_${String(index).padStart(5, '0')}`).remove().catch(() => null));
  }
  await Promise.all(tasks);
}

async function uploadBookFileChunk(event) {
  await ensureBookPacksCollection();
  await ensureBookUploadChunksCollection();

  const uploadId = safeDocId(event.upload_id);
  const fileName = normalizeText(event.file_name);
  const fileType = detectFileType(event.file_type, fileName);
  const uploadPurpose = normalizeText(event.upload_purpose) || 'book_pack';
  const requestedCloudPath = normalizeText(event.cloud_path).replace(/\\/g, '/');
  const originalFileType = normalizeText(event.original_file_type || event.file_type);
  const chunkBase64 = event.chunk_base64;
  const chunkIndex = Number(event.chunk_index);
  const chunkTotal = Number(event.chunk_total);

  if (!uploadId) return fail(400, 'upload_id is required');
  if (!fileName) return fail(400, 'file_name is required');
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return fail(400, 'chunk_index is invalid');
  if (!Number.isInteger(chunkTotal) || chunkTotal < 1 || chunkTotal > 240) return fail(400, 'chunk_total is invalid');
  if (!chunkBase64 || typeof chunkBase64 !== 'string') return fail(400, 'chunk_base64 is required');

  let chunkSize = 0;
  try {
    chunkSize = Buffer.from(chunkBase64, 'base64').length;
  } catch (err) {
    return fail(400, 'invalid chunk_base64');
  }
  if (!chunkSize) return fail(400, 'empty chunk');
  if (chunkSize > 512 * 1024) return fail(413, 'chunk too large');

  const docId = `${uploadId}_${String(chunkIndex).padStart(5, '0')}`;
  await db.collection(BOOK_UPLOAD_CHUNK_COLLECTION).doc(docId).set({
    data: {
      upload_id: uploadId,
      chunk_index: chunkIndex,
      chunk_total: chunkTotal,
      file_name: fileName,
      file_type: fileType,
      original_file_type: originalFileType,
      upload_purpose: uploadPurpose,
      cloud_path: requestedCloudPath,
      chunk_base64: chunkBase64,
      chunk_size: chunkSize,
      created_at: db.serverDate(),
    },
  });

  const shouldFinish = event.finish === true || chunkIndex === chunkTotal - 1;
  if (!shouldFinish) {
    return ok({ upload_id: uploadId, received: chunkIndex + 1, completed: false });
  }

  const chunks = [];
  for (let offset = 0; offset < chunkTotal; offset += 100) {
    const chunkRes = await db.collection(BOOK_UPLOAD_CHUNK_COLLECTION)
      .where({ upload_id: uploadId })
      .orderBy('chunk_index', 'asc')
      .skip(offset)
      .limit(Math.min(100, chunkTotal - offset))
      .get();
    chunks.push(...(chunkRes.data || []));
  }
  if (chunks.length < chunkTotal) {
    return ok({ upload_id: uploadId, received: chunks.length, completed: false });
  }

  const buffers = [];
  let totalBytes = 0;
  for (let index = 0; index < chunkTotal; index += 1) {
    const chunk = chunks.find(item => Number(item.chunk_index) === index);
    if (!chunk) return fail(409, `missing chunk ${index}`);
    const buffer = Buffer.from(chunk.chunk_base64, 'base64');
    totalBytes += buffer.length;
    if (totalBytes > BOOK_PACK_MAX_BYTES) {
      await cleanupBookUploadChunks(uploadId, chunkTotal);
      return fail(413, `文件过大 (${(totalBytes / 1024 / 1024).toFixed(1)}MB)，上限 25MB，请压缩后重试`);
    }
    buffers.push(buffer);
  }

  const safeName = fileName.replace(/[^\w.\-一-龥]/g, '_');
  const ext = (safeName.split('.').pop() || 'pdf').toLowerCase();
  const isDraftAsset = uploadPurpose === 'draft_asset';
  const safeDraftPath = /^question-images\/ocr-drafts\/[\w./-]+$/i.test(requestedCloudPath)
    && !requestedCloudPath.includes('..');
  if (isDraftAsset && !safeDraftPath) {
    await cleanupBookUploadChunks(uploadId, chunkTotal);
    return fail(400, 'OCR 草稿图片 cloud_path 非法');
  }
  const cloudPath = isDraftAsset
    ? requestedCloudPath
    : `book_packs/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  let uploadRes;
  try {
    uploadRes = await cloud.uploadFile({ cloudPath, fileContent: Buffer.concat(buffers) });
  } catch (err) {
    return fail(500, `upload failed: ${err.message}`);
  } finally {
    await cleanupBookUploadChunks(uploadId, chunkTotal);
  }

  return ok({
    completed: true,
    file_id: uploadRes.fileID,
    file_size: totalBytes,
    file_name: fileName,
    file_type: fileType,
    original_file_type: originalFileType,
    upload_purpose: uploadPurpose,
    cloud_path: cloudPath,
  });
}

async function uploadBookFile(event) {
  await ensureBookPacksCollection();
  const fileName = normalizeText(event.file_name);
  const base64 = event.file_base64;
  if (!fileName) return fail(400, 'file_name is required');
  if (!base64 || typeof base64 !== 'string') return fail(400, 'file_base64 is required');

  // 支持纯 base64 与 data URI 两种形态
  let raw = base64;
  const commaIdx = base64.indexOf(',');
  if (commaIdx >= 0 && /base64/i.test(base64.slice(0, commaIdx))) {
    raw = base64.slice(commaIdx + 1);
  }

  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch (err) {
    return fail(400, 'invalid base64 content');
  }
  if (buffer.length === 0) return fail(400, 'empty file');
  if (buffer.length > BOOK_PACK_MAX_BYTES) {
    return fail(413, `文件过大 (${(buffer.length / 1024 / 1024).toFixed(1)}MB)，上限 25MB，请压缩后重试`);
  }

  const safeName = fileName.replace(/[^\w.\-一-龥]/g, '_');
  const ext = (safeName.split('.').pop() || 'pdf').toLowerCase();
  const cloudPath = `book_packs/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  let uploadRes;
  try {
    uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  } catch (err) {
    return fail(500, `upload failed: ${err.message}`);
  }

  return ok({
    file_id: uploadRes.fileID,
    file_size: buffer.length,
    file_name: fileName,
    file_type: detectFileType(event.file_type, fileName),
    cloud_path: cloudPath,
  });
}

async function upsertBookPack(event) {
  await ensureBookPacksCollection();
  const raw = event.pack || event.data || event;
  const now = db.serverDate();
  const pack = {
    _id: normalizeText(raw._id || raw.id),
    title: normalizeText(raw.title),
    description: normalizeText(raw.description || raw.desc || ''),
    category: normalizeText(raw.category || '通用'),
    file_type: detectFileType(raw.file_type, raw.file_name),
    file_id: normalizeText(raw.file_id),
    file_name: normalizeText(raw.file_name || ''),
    file_size: Number(raw.file_size) || 0,
    sort: Number(raw.sort) || 0,
    cover_url: normalizeText(raw.cover_url || ''),
    status: raw.status === 'disabled' ? 'disabled' : 'enabled',
    updated_at: now,
  };
  if (!pack.title) return fail(422, 'title is required');
  if (!pack.file_id) return fail(422, 'file_id is required');

  const docId = pack._id;
  const data = { ...pack };
  delete data._id;

  try {
    if (docId) {
      await db.collection('book_packs').doc(docId).update({ data });
      return ok({ _id: docId, updated: 1, created: 0 });
    }
    const addRes = await db.collection('book_packs').add({ data: { ...data, created_at: now } });
    return ok({ _id: addRes._id, updated: 0, created: 1 });
  } catch (err) {
    return fail(500, err.message);
  }
}

async function listBookPacks(event) {
  await ensureBookPacksCollection();
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(event.page_size || event.pageSize) || 50));
  const where = {};
  if (event.status) where.status = event.status;
  if (event.keyword) {
    const kw = String(event.keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    where.title = db.RegExp({ regexp: kw, options: 'i' });
  }
  const collection = db.collection('book_packs').where(where);
  const [listRes, totalRes] = await Promise.all([
    collection.orderBy('updated_at', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
    collection.count(),
  ]);
  return ok({ list: listRes.data, total: totalRes.total, page, page_size: pageSize });
}

async function deleteBookPack(event) {
  const id = event.pack_id || event._id;
  if (!id) return fail(400, 'pack_id is required');
  const res = await db.collection('book_packs').doc(id).get();
  if (!res.data) return fail(404, 'book pack not found');
  const pack = res.data;
  if (pack.file_id) {
    try { await cloud.deleteFile({ fileList: [pack.file_id] }); } catch (e) { /* 忽略存储删除失败 */ }
  }
  await db.collection('book_packs').doc(id).remove();
  return ok({ _id: id, deleted: true });
}

exports.main = async (rawEvent = {}) => {
  if (isOptionsRequest(rawEvent)) {
    return {
      statusCode: 204,
      headers: corsHeaders(rawEvent),
      body: '',
    };
  }

  const event = parseEvent(rawEvent);
  const requestId = createRequestId(rawEvent);
  const startedAt = Date.now();
  try {
    const identity = await adminAuth.authenticateAdmin(event);
    const canonicalAction = adminAuth.authorize(identity, event);
    event.__identity = identity;
    logger.info('admin.request', {
      request_id: requestId,
      action: canonicalAction,
      auth_mode: identity.mode,
      openid: identity.openid || null,
    });

    let result;
    switch (event.action) {
      case 'dashboard':
        result = await dashboard(event);
        break;
      case 'list_questions':
        result = await listQuestions(event);
        break;
      case 'upsert_question':
        result = await upsertQuestion(event);
        break;
      case 'delete_question':
        result = await deleteQuestion(event);
        break;
      case 'clear_questions':
        result = await clearQuestions(event);
        break;
      case 'batch_import_questions':
        result = await batchImportQuestions(event);
        break;
      case 'preview_xingce_package':
        result = await xingceFeature.previewXingcePackage(event);
        break;
      case 'import_xingce_package':
        result = await xingceFeature.importXingcePackage(event);
        break;
      case 'preview_essay_package':
        result = await essayFeature.previewEssayPackage(event);
        break;
      case 'import_essay_package':
        result = await essayFeature.importEssayPackage(event);
        break;
      case 'draft':
        // AI/OCR 中间层: 草稿箱. 子动作见 event.draft_action
        result = await draftsFeature.router(event);
        break;
      case 'draft_paper.list':
      case 'draft_paper.get':
      case 'question_draft.list':
      case 'question_draft.get':
      case 'question_draft.update':
      case 'question_draft.approve':
      case 'question_draft.reject':
        result = await draftsFeature.router(event);
        break;
      case 'import_task':
      case 'import_task.create':
      case 'import_task.list':
      case 'import_task.get':
      case 'import_task.cancel':
      case 'import_task.retry':
      case 'import_task.log':
      case 'import_task.logs':
      case 'import_task.recover':
        result = await importTasksFeature.router(event);
        break;
      case 'list_essay_papers':
        result = await essayFeature.listEssayPapers(event);
        break;
      case 'get_essay_paper':
        result = await essayFeature.getEssayPaper(event);
        break;
      case 'set_essay_paper_status':
        result = await essayFeature.setEssayPaperStatus(event);
        break;
      case 'repair_data_materials':
        result = await repairDataMaterials(event);
        break;
      case 'export_questions':
        result = await exportQuestions(event);
        break;
      case 'list_users':
        result = await listUsers(event);
        break;
      case 'list_book_packs':
        result = await listBookPacks(event);
        break;
      case 'upsert_book_pack':
        result = await upsertBookPack(event);
        break;
      case 'delete_book_pack':
        result = await deleteBookPack(event);
        break;
      case 'get_book_upload_url':
        result = await getBookUploadUrl(event);
        break;
      case 'upload_book_file':
        result = await uploadBookFile(event);
        break;
      case 'upload_book_file_chunk':
        result = await uploadBookFileChunk(event);
        break;
      case 'file.get_temp_url':
        result = await fileFeature.getTempUrl(event);
        break;
      default:
        result = fail(400, `unknown action: ${event.action || ''}`);
    }
    logger.info('admin.response', {
      request_id: requestId,
      action: canonicalAction,
      code: result && result.code,
      duration_ms: Date.now() - startedAt,
    });
    return respond(rawEvent, result, undefined, requestId);
  } catch (err) {
    const body = errorBody(err, requestId);
    logger.error('admin.error', {
      request_id: requestId,
      action: event.action || null,
      error_code: body.error_code,
      status_code: body.code,
      duration_ms: Date.now() - startedAt,
      error_message: err && err.message,
    });
    return respond(rawEvent, body, body.code, requestId);
  }
};
