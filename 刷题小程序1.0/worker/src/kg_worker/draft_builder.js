'use strict';

// 草稿构造：把 MinerU 局部产物上传到云存储，并把包内所有本地图片引用改写为
// cloud:// fileID，最后产出供 admin 云函数 draft.create/append 使用的 payload，
// 以及供管理台“产物”标签页展示的 artifacts 清单。

const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { sha256File } = require('./storage');

function walkFiles(rootDir, predicate) {
  const out = [];
  (function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (predicate(e.name, fp)) out.push(fp);
    }
  })(rootDir);
  return out;
}

function isRemote(ref) {
  return /^https?:\/\//i.test(ref) || /^cloud:\/\//i.test(ref);
}

function localRefToPath(outputDir, ref) {
  if (!ref || isRemote(ref)) return null;
  const base = path.basename(String(ref).replace(/\\/g, '/'));
  return walkFiles(outputDir, n => n === base)[0] || null;
}

function collectStringRefs(pkg) {
  const refs = [];
  for (const m of pkg.media || []) {
    if (m && m.path) refs.push(m.path);
  }
  for (const q of pkg.questions || []) {
    if (Array.isArray(q.stem_images)) refs.push(...q.stem_images);
    for (const o of q.options_v2 || []) if (Array.isArray(o.images)) refs.push(...o.images);
    if (q.source_evidence && Array.isArray(q.source_evidence.images)) refs.push(...q.source_evidence.images);
  }
  for (const g of pkg.groups || []) if (Array.isArray(g.material_images)) refs.push(...g.material_images);
  return [...new Set(refs.filter(Boolean))];
}

async function buildAndUpload({ pkg, storage, outputDir, taskId, paperId, answerMarkdownFile }) {
  const prefix = `import-tasks/${taskId || paperId || 'task'}`;
  const refMap = new Map();

  async function resolveRef(ref) {
    const key = String(ref);
    if (refMap.has(key)) return refMap.get(key);
    let result = key;
    if (!isRemote(key)) {
      const localPath = localRefToPath(outputDir, key);
      if (localPath) {
        try {
          result = await storage.uploadFile(localPath, `${prefix}/${path.basename(localPath)}`);
        } catch (err) {
          result = key; // 上传失败则保留原引用，交由发布门禁拦截
        }
      }
    }
    refMap.set(key, result);
    return result;
  }

  // 1) 先解析所有引用（建立 basename -> fileID 映射）
  const allRefs = collectStringRefs(pkg);
  for (const ref of allRefs) {
    // eslint-disable-next-line no-await-in-loop
    await resolveRef(ref);
  }

  // 2) 改写 media
  for (const m of pkg.media || []) {
    const f = refMap.get(String(m.path)) || m.path;
    m.path = f;
    m.source_path = f;
    m.requires_upload = !isRemote(f);
  }

  // 3) 改写题目/选项/材料图片引用
  const rewriteArr = async (arr) => (Array.isArray(arr) ? Promise.all(arr.map(resolveRef)) : arr);
  for (const q of pkg.questions || []) {
    q.stem_images = await rewriteArr(q.stem_images);
    for (const o of q.options_v2 || []) o.images = await rewriteArr(o.images);
    if (q.source_evidence && Array.isArray(q.source_evidence.images)) {
      q.source_evidence.images = await rewriteArr(q.source_evidence.images);
    }
  }
  for (const g of pkg.groups || []) g.material_images = await rewriteArr(g.material_images);

  // 4) 改写原始 Markdown 中的本地图片链接（仅展示用）
  let rawMarkdown = pkg._rawMarkdown || '';
  if (rawMarkdown) {
    rawMarkdown = rawMarkdown.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (full, inner) => {
      const resolved = refMap.get(String(inner).trim());
      return resolved ? full.replace(inner, resolved) : full;
    });
  }

  // 5) 构造 artifacts 清单（markdown / layout / 已上传图片）
  const artifacts = [];
  if (rawMarkdown) {
    const mdPath = path.join(outputDir, 'raw_markdown_upload.md');
    fs.writeFileSync(mdPath, rawMarkdown, 'utf8');
    try {
      const fileID = await storage.uploadFile(mdPath, `${prefix}/raw_markdown.md`);
      artifacts.push({ type: 'markdown', name: 'raw_markdown.md', file_id: fileID, sha256: sha256File(mdPath) });
    } catch (_) { /* 可选产物，失败忽略 */ }
  }
  const contentList = walkFiles(outputDir, n => /content_list/i.test(n))[0];
  if (contentList) {
    try {
      const fileID = await storage.uploadFile(contentList, `${prefix}/${path.basename(contentList)}`);
      artifacts.push({ type: 'layout', name: path.basename(contentList), file_id: fileID, sha256: sha256File(contentList) });
    } catch (_) { /* 可选产物 */ }
  }
  // 答案解析卷 Markdown（重新切题时用于重配对答案）
  if (answerMarkdownFile && fs.existsSync(answerMarkdownFile)) {
    try {
      const fileID = await storage.uploadFile(answerMarkdownFile, `${prefix}/raw_markdown_answer.md`);
      artifacts.push({ type: 'markdown', name: 'raw_markdown_answer.md', file_id: fileID, sha256: sha256File(answerMarkdownFile) });
    } catch (_) { /* 可选产物 */ }
  }
  for (const m of pkg.media || []) {
    if (m && m.path && isRemote(m.path) && artifacts.length < 120) {
      artifacts.push({ type: 'image', name: path.basename(m.path.split('?')[0]), file_id: m.path });
    }
  }

  return { package: pkg, rawMarkdown, artifacts };
}

module.exports = { buildAndUpload, collectStringRefs, localRefToPath };
