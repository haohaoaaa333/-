const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 8787);
const ADMIN_ENDPOINT = process.env.ADMIN_ENDPOINT
  || 'https://cloud1-d0gsr2l1ye6344917-1449878482.ap-shanghai.app.tcloudbase.com/admin';

const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(ROOT, '..');
const XINGCE_OUTPUT_ROOT = path.join(PROJECT_ROOT, 'admin-output', 'xingce-markdown-v2');
const OCR_ROOT = path.join(PROJECT_ROOT, 'admin-output', 'ocr-jobs');

// Unlimited-OCR 工具路径（可改为你实际存放位置）
const UNLIMITED_OCR_HOME = process.env.UNLIMITED_OCR_HOME || 'C:/Users/hao/Desktop/ocr/Unlimited-OCR';
const UNLIMITED_OCR_PYTHON = path.join(UNLIMITED_OCR_HOME, 'venv/Scripts/python.exe');
const UNLIMITED_OCR_RUNNER = path.join(UNLIMITED_OCR_HOME, 'ocr_runner.py');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const MAX_BOOK_UPLOAD_BYTES = 30 * 1024 * 1024;
const BOOK_UPLOAD_CHUNK_BYTES = 32 * 1024;

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

function proxyAdmin(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const target = new URL(ADMIN_ENDPOINT);
    const proxyReq = https.request({
      method: 'POST',
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, proxyRes => {
      let data = '';
      proxyRes.on('data', chunk => { data += chunk; });
      proxyRes.on('end', () => {
        send(res, proxyRes.statusCode || 200, data, proxyRes.headers['content-type'] || 'application/json; charset=utf-8');
      });
    });

    proxyReq.on('error', err => {
      send(res, 502, JSON.stringify({ code: 502, message: err.message }), 'application/json; charset=utf-8');
    });
    proxyReq.write(body);
    proxyReq.end();
  });
}

function requestAdmin(action, payload, onDone) {
  const body = JSON.stringify({ action, ...payload });
  const target = new URL(ADMIN_ENDPOINT);
  const proxyReq = https.request({
    method: 'POST',
    hostname: target.hostname,
    path: `${target.pathname}${target.search}`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, proxyRes => {
    let data = '';
    proxyRes.on('data', chunk => { data += chunk; });
    proxyRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if ((proxyRes.statusCode || 200) >= 400 || parsed.code !== 0) {
          onDone(new Error(parsed.message || `admin request failed: ${proxyRes.statusCode}`));
          return;
        }
        onDone(null, parsed.data);
      } catch (err) {
        onDone(err);
      }
    });
  });
  proxyReq.on('error', onDone);
  proxyReq.write(body);
  proxyReq.end();
}

function parseMultipart(req, onDone) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    onDone(new Error('missing multipart boundary'));
    return;
  }
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const chunks = [];
  let total = 0;
  req.on('data', chunk => {
    total += chunk.length;
    if (total > MAX_BOOK_UPLOAD_BYTES) {
      req.destroy(new Error('file too large'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', onDone);
  req.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const fields = {};
    let file = null;
    let offset = 0;

    while (offset < buffer.length) {
      const boundaryStart = buffer.indexOf(boundary, offset);
      if (boundaryStart < 0) break;
      let partStart = boundaryStart + boundary.length;
      if (buffer.slice(partStart, partStart + 2).toString() === '--') break;
      if (buffer.slice(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
      const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), partStart);
      if (headerEnd < 0) break;
      const headerText = buffer.slice(partStart, headerEnd).toString('utf8');
      const nextBoundary = buffer.indexOf(boundary, headerEnd + 4);
      if (nextBoundary < 0) break;
      let contentEnd = nextBoundary;
      if (buffer.slice(contentEnd - 2, contentEnd).toString() === '\r\n') contentEnd -= 2;
      const content = buffer.slice(headerEnd + 4, contentEnd);
      const nameMatch = headerText.match(/name="([^"]+)"/i);
      const filenameMatch = headerText.match(/filename="([^"]*)"/i);
      if (nameMatch) {
        const name = nameMatch[1];
        if (filenameMatch) {
          file = {
            field: name,
            filename: filenameMatch[1],
            contentType: (headerText.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream',
            buffer: content,
          };
        } else {
          fields[name] = content.toString('utf8');
        }
      }
      offset = nextBoundary;
    }
    onDone(null, { fields, file });
  });
}

function postCosFile(meta, file, onDone) {
  const boundary = `----kg-admin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fields = {
    key: meta.cloud_path,
    signature: meta.authorization,
    'x-cos-meta-fileid': meta.cos_file_id,
    success_action_status: '201',
    'x-cos-security-token': meta.token,
  };
  const chunks = [];
  Object.entries(fields).forEach(([key, value]) => {
    if (!value) return;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  });
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodeURIComponent(file.filename)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
  chunks.push(file.buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  const target = new URL(meta.url);
  const req = https.request({
    method: 'POST',
    hostname: target.hostname,
    path: `${target.pathname}${target.search}`,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  }, cosRes => {
    let data = '';
    cosRes.on('data', chunk => { data += chunk; });
    cosRes.on('end', () => {
      if (cosRes.statusCode !== 201) {
        onDone(new Error(`COS upload failed: ${cosRes.statusCode} ${data}`));
        return;
      }
      onDone(null, data);
    });
  });
  req.on('error', onDone);
  req.write(body);
  req.end();
}

function detectBookFileType(fileType, fileName) {
  const t = String(fileType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  return /word|doc|wps/.test(t) || /\.docx?$/.test(name) ? 'word' : 'pdf';
}

function uploadBookFileChunks({ adminSecret, file }, onDone) {
  const uploadId = `book_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const total = Math.max(1, Math.ceil(file.buffer.length / BOOK_UPLOAD_CHUNK_BYTES));
  let lastResult = null;

  function sendChunk(index) {
    const start = index * BOOK_UPLOAD_CHUNK_BYTES;
    const end = Math.min(file.buffer.length, start + BOOK_UPLOAD_CHUNK_BYTES);
    const chunk = file.buffer.slice(start, end);
    requestAdmin('upload_book_file_chunk', {
      admin_secret: adminSecret,
      upload_id: uploadId,
      file_name: file.filename,
      file_type: file.contentType,
      chunk_index: index,
      chunk_total: total,
      chunk_base64: chunk.toString('base64'),
      finish: index === total - 1,
    }, (err, result) => {
      if (err) {
        onDone(err);
        return;
      }
      lastResult = result;
      if (index + 1 < total) {
        sendChunk(index + 1);
        return;
      }
      if (!lastResult || !lastResult.completed) {
        onDone(new Error(`文件分块已发送，但云端尚未合并完成：${JSON.stringify(lastResult || {})}`));
        return;
      }
      onDone(null, lastResult);
    });
  }

  sendChunk(0);
}

function uploadBookFile(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, JSON.stringify({ code: 405, message: 'Method not allowed' }), 'application/json; charset=utf-8');
    return;
  }
  parseMultipart(req, (err, form) => {
    if (err) {
      send(res, 400, JSON.stringify({ code: 400, message: err.message }), 'application/json; charset=utf-8');
      return;
    }
    const file = form.file;
    const fields = form.fields || {};
    const adminSecret = String(fields.admin_secret || '').trim();
    const cloudPath = String(fields.cloud_path || '').trim();
    if (!adminSecret) {
      send(res, 403, JSON.stringify({ code: 403, message: 'ADMIN_SECRET 缺失' }), 'application/json; charset=utf-8');
      return;
    }
    if (!cloudPath) {
      send(res, 400, JSON.stringify({ code: 400, message: 'cloud_path 缺失' }), 'application/json; charset=utf-8');
      return;
    }
    if (!file || !file.buffer || !file.buffer.length) {
      send(res, 400, JSON.stringify({ code: 400, message: '请选择文件' }), 'application/json; charset=utf-8');
      return;
    }

    uploadBookFileChunks({ adminSecret, file, cloudPath }, (uploadErr, result) => {
      if (uploadErr) {
        send(res, 500, JSON.stringify({ code: 500, message: uploadErr.message }), 'application/json; charset=utf-8');
        return;
      }
      send(res, 200, JSON.stringify({
        fileID: result.file_id,
        file_id: result.file_id,
        cloud_path: result.cloud_path,
        file_name: result.file_name || file.filename,
        file_size: result.file_size || file.buffer.length,
        file_type: result.file_type || detectBookFileType(file.contentType, file.filename),
      }), 'application/json; charset=utf-8');
    });
  });
}

function readJsonBody(req, onDone) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) req.destroy();
  });
  req.on('end', () => {
    try {
      onDone(null, body ? JSON.parse(body) : {});
    } catch (err) {
      onDone(err);
    }
  });
}

function findPython() {
  const candidates = [
    process.env.PYTHON,
    path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
    'python',
    'py',
  ].filter(Boolean);
  return candidates.find(candidate => candidate === 'python' || candidate === 'py' || fs.existsSync(candidate)) || 'python';
}

function isV2MarkdownInput(inputPath) {
  if (inputPath.toLowerCase().endsWith('.md')) return true;
  if (!fs.statSync(inputPath).isDirectory()) return false;
  return fs.readdirSync(inputPath, { withFileTypes: true })
    .some(item => item.isFile() && item.name.toLowerCase().endsWith('.md') && item.name.toLowerCase() !== 'questions.md');
}

function convertPackage(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, JSON.stringify({ code: 405, message: 'Method not allowed' }), 'application/json; charset=utf-8');
    return;
  }

  readJsonBody(req, (err, payload = {}) => {
    if (err) {
      send(res, 400, JSON.stringify({ code: 400, message: '请求 JSON 格式不正确' }), 'application/json; charset=utf-8');
      return;
    }

    const inputPath = String(payload.path || '').trim();
    if (!inputPath) {
      send(res, 400, JSON.stringify({ code: 400, message: '请填写新版 V2 Markdown 文件或试卷目录' }), 'application/json; charset=utf-8');
      return;
    }
    const resolvedInput = path.resolve(inputPath);
    if (!fs.existsSync(resolvedInput)) {
      send(res, 404, JSON.stringify({ code: 404, message: `路径不存在：${resolvedInput}` }), 'application/json; charset=utf-8');
      return;
    }

    if (!isV2MarkdownInput(resolvedInput)) {
      send(res, 400, JSON.stringify({
        code: 400,
        message: '这里只转换新版 V2 整卷 Markdown。请选择一个 .md 文件，或选择包含整卷 .md 的目录；旧版 questions.md 题库包已停用。',
      }), 'application/json; charset=utf-8');
      return;
    }

    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'convert_markdown_papers_v2.py');
    const python = findPython();
    const outputDir = path.join(PROJECT_ROOT, 'admin-output', 'xingce-markdown-v2');
    const args = [
      scriptPath,
      '--input', resolvedInput,
      '--output-dir', outputDir,
      '--public-prefix', '/assets/question-images/xingce-v2',
    ];
    const child = spawn(python, args, {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', spawnErr => {
      send(res, 500, JSON.stringify({ code: 500, message: spawnErr.message }), 'application/json; charset=utf-8');
    });
    child.on('close', code => {
      if (code !== 0) {
        send(res, 500, JSON.stringify({ code, message: stderr || stdout || '题库包转换失败' }), 'application/json; charset=utf-8');
        return;
      }
      try {
        const result = JSON.parse(stdout);
        send(res, 200, JSON.stringify({
          mode: 'xingce_v2_complete_papers',
          ...result,
        }), 'application/json; charset=utf-8');
      } catch (parseErr) {
        send(res, 500, JSON.stringify({ code: 500, message: parseErr.message, stdout, stderr }), 'application/json; charset=utf-8');
      }
    });
  });
}

function generatedPaperDir(paperId) {
  if (!/^[\w-]+$/.test(paperId || '')) return null;
  const paperDir = path.resolve(XINGCE_OUTPUT_ROOT, paperId);
  return paperDir.startsWith(`${path.resolve(XINGCE_OUTPUT_ROOT)}${path.sep}`) ? paperDir : null;
}

function serveGeneratedCatalog(req, res) {
  const catalogPath = path.join(XINGCE_OUTPUT_ROOT, 'catalog.json');
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const papers = (catalog.papers || []).map(item => ({
      paper_id: item.paper_id,
      title: item.title,
      groups: item.groups,
      questions: item.questions,
      media: item.media,
      valid: item.valid,
      error_count: Array.isArray(item.errors) ? item.errors.length : 0,
      warning_count: Number(item.warning_count) || 0,
    }));
    send(res, 200, JSON.stringify({ ...catalog.summary, papers }), 'application/json; charset=utf-8');
  } catch (err) {
    send(res, 404, JSON.stringify({ code: 404, message: '还没有转换结果，请先批量转换整套试卷。' }), 'application/json; charset=utf-8');
  }
}

function serveGeneratedPackage(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const paperDir = generatedPaperDir(requestUrl.searchParams.get('paper_id'));
  if (!paperDir) {
    send(res, 400, JSON.stringify({ code: 400, message: '试卷ID无效' }), 'application/json; charset=utf-8');
    return;
  }
  const bankPath = path.join(paperDir, 'bank.json');
  fs.readFile(bankPath, (err, data) => {
    if (err) send(res, 404, JSON.stringify({ code: 404, message: '没有找到该试卷的 bank.json' }), 'application/json; charset=utf-8');
    else send(res, 200, data, 'application/json; charset=utf-8');
  });
}

function serveGeneratedImage(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const paperDir = generatedPaperDir(requestUrl.searchParams.get('paper_id'));
  const filename = requestUrl.searchParams.get('filename') || '';
  if (!paperDir || path.basename(filename) !== filename || !/^[a-f0-9]{24}\.(?:png|jpe?g|gif|webp|svg)$/i.test(filename)) {
    send(res, 400, JSON.stringify({ code: 400, message: '图片参数无效' }), 'application/json; charset=utf-8');
    return;
  }
  const imagePath = path.join(paperDir, 'images', filename);
  fs.readFile(imagePath, (err, data) => {
    if (err) send(res, 404, JSON.stringify({ code: 404, message: `没有找到图片：${filename}` }), 'application/json; charset=utf-8');
    else send(res, 200, data, TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream');
  });
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(req.url.split('?')[0]);
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, 'Not found');
      return;
    }
    send(res, 200, data, TYPES[path.extname(filePath)] || 'application/octet-stream');
  });
}

// ─────────────────────────────────────────────
// 智能 OCR 导入（基于 Unlimited-OCR）
// ─────────────────────────────────────────────

function ocrJobDir(jobId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId || '')) return null;
  const dir = path.resolve(OCR_ROOT, jobId);
  return dir.startsWith(path.resolve(OCR_ROOT) + path.sep) ? dir : null;
}

function readJobStatus(jobId) {
  const dir = ocrJobDir(jobId);
  if (!dir) return null;
  const file = path.join(dir, 'status.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function writeJobStatus(jobId, status) {
  const dir = ocrJobDir(jobId);
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
}

function detectOcrEnvironmentSync() {
  if (!fs.existsSync(UNLIMITED_OCR_PYTHON)) return { ok: false, reason: '未找到 Unlimited-OCR Python 解释器' };
  if (!fs.existsSync(UNLIMITED_OCR_RUNNER)) return { ok: false, reason: '未找到 Unlimited-OCR 入口脚本' };
  return { ok: true };
}

function runOcrJob(jobId, inputType, imageMode) {
  const dir = ocrJobDir(jobId);
  if (!dir) return;
  const inputPath = path.join(dir, inputType === 'pdf' ? 'input.pdf' : 'input');
  const outputPath = path.join(dir, 'output');
  fs.mkdirSync(outputPath, { recursive: true });

  const args = [UNLIMITED_OCR_RUNNER];
  if (inputType === 'pdf') {
    args.push('--pdf', inputPath, '--output_dir', outputPath, '--image_mode', 'base');
  } else {
    args.push('--image_dir', inputPath, '--output_dir', outputPath, '--image_mode', imageMode || 'gundam');
  }

  writeJobStatus(jobId, { status: 'running', step: 'ocr', started_at: Date.now(), progress: 0 });

  const child = spawn(UNLIMITED_OCR_PYTHON, args, {
    cwd: UNLIMITED_OCR_HOME,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
    // 简单进度解析：每张图输出 [完成] ...
    const completed = (stdout.match(/\[完成\]/g) || []).length;
    const status = readJobStatus(jobId);
    if (status) {
      status.progress = completed;
      status.log = stdout.slice(-800);
      writeJobStatus(jobId, status);
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk; });

  child.on('close', code => {
    const status = readJobStatus(jobId) || { status: 'running', step: 'ocr' };
    if (code !== 0) {
      status.status = 'failed';
      status.error = stderr || stdout || `OCR 进程退出码 ${code}`;
      writeJobStatus(jobId, status);
      return;
    }
    // 收集输出文件（模型会把结果写到 output/<基名>/result.md 子目录）
    const outputFiles = [];
    const walkOutput = (currentDir, rel) => {
      let entries = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (err) {
        return;
      }
      for (const entry of entries) {
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walkOutput(path.join(currentDir, entry.name), entryRel);
        } else if (entry.name.toLowerCase().endsWith('.md')) {
          outputFiles.push(entryRel);
        }
      }
    };
    walkOutput(outputPath, '');
    if (!outputFiles.length) {
      status.status = 'failed';
      status.error = 'OCR 已完成但未发现 Markdown 输出文件';
      writeJobStatus(jobId, status);
      return;
    }
    status.status = 'completed';
    status.step = 'preview';
    status.progress = 100;
    status.output_files = outputFiles;
    status.log = stdout.slice(-400);
    writeJobStatus(jobId, status);
  });
}

function ocrDetect(req, res) {
  const env = detectOcrEnvironmentSync();
  if (!env.ok) {
    send(res, 200, JSON.stringify({ ok: false, message: env.reason }), 'application/json; charset=utf-8');
    return;
  }
  send(res, 200, JSON.stringify({ ok: true, tool_path: UNLIMITED_OCR_HOME, model_cached: fs.existsSync(path.join(process.env.USERPROFILE || 'C:/Users/hao', '.cache/huggingface/hub/models--baidu--Unlimited-OCR')) }), 'application/json; charset=utf-8');
}

function ocrUpload(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, JSON.stringify({ code: 405, message: 'Method not allowed' }), 'application/json; charset=utf-8');
    return;
  }
  const jobId = `ocr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const dir = ocrJobDir(jobId);
  if (!dir) {
    send(res, 400, JSON.stringify({ code: 400, message: 'job_id 无效' }), 'application/json; charset=utf-8');
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'input'), { recursive: true });

  parseMultipart(req, (err, form) => {
    if (err) {
      send(res, 400, JSON.stringify({ code: 400, message: err.message }), 'application/json; charset=utf-8');
      return;
    }
    const file = form.file;
    if (!file || !file.buffer || !file.buffer.length) {
      send(res, 400, JSON.stringify({ code: 400, message: '请上传文件' }), 'application/json; charset=utf-8');
      return;
    }
    const isPdf = file.filename.toLowerCase().endsWith('.pdf') || (file.contentType || '').includes('pdf');
    const inputType = isPdf ? 'pdf' : 'image';
    const savePath = path.join(dir, inputType === 'pdf' ? 'input.pdf' : path.join('input', file.filename));
    fs.writeFileSync(savePath, file.buffer);
    writeJobStatus(jobId, { status: 'uploaded', step: 'upload', input_type: inputType, filename: file.filename, created_at: Date.now() });
    send(res, 200, JSON.stringify({ code: 0, job_id: jobId, input_type: inputType, filename: file.filename }), 'application/json; charset=utf-8');
  });
}

function ocrStart(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, JSON.stringify({ code: 405, message: 'Method not allowed' }), 'application/json; charset=utf-8');
    return;
  }
  readJsonBody(req, (err, payload = {}) => {
    if (err) {
      send(res, 400, JSON.stringify({ code: 400, message: '请求格式错误' }), 'application/json; charset=utf-8');
      return;
    }
    const jobId = String(payload.job_id || '').trim();
    const status = readJobStatus(jobId);
    if (!status) {
      send(res, 404, JSON.stringify({ code: 404, message: '未找到该任务，请先上传文件' }), 'application/json; charset=utf-8');
      return;
    }
    if (status.status !== 'uploaded' && status.status !== 'failed') {
      send(res, 400, JSON.stringify({ code: 400, message: `任务状态为 ${status.status}，不能重复启动` }), 'application/json; charset=utf-8');
      return;
    }
    const env = detectOcrEnvironmentSync();
    if (!env.ok) {
      send(res, 500, JSON.stringify({ code: 500, message: env.reason }), 'application/json; charset=utf-8');
      return;
    }
    runOcrJob(jobId, status.input_type, payload.image_mode || 'base');
    send(res, 200, JSON.stringify({ code: 0, job_id: jobId, status: 'running' }), 'application/json; charset=utf-8');
  });
}

function ocrStatus(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const jobId = String(url.searchParams.get('job_id') || '').trim();
  const status = readJobStatus(jobId);
  if (!status) {
    send(res, 404, JSON.stringify({ code: 404, message: '未找到任务' }), 'application/json; charset=utf-8');
    return;
  }
  send(res, 200, JSON.stringify({ code: 0, ...status }), 'application/json; charset=utf-8');
}

function ocrResult(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const jobId = String(url.searchParams.get('job_id') || '').trim();
  const status = readJobStatus(jobId);
  if (!status) {
    send(res, 404, JSON.stringify({ code: 404, message: '未找到任务' }), 'application/json; charset=utf-8');
    return;
  }
  if (!Array.isArray(status.output_files) || !status.output_files.length) {
    send(res, 400, JSON.stringify({ code: 400, message: 'OCR 尚未完成或无输出文件' }), 'application/json; charset=utf-8');
    return;
  }
  const dir = ocrJobDir(jobId);
  const fileName = url.searchParams.get('filename') || status.output_files[0];
  const filePath = path.join(dir, 'output', fileName);
  if (!filePath.startsWith(path.join(dir, 'output') + path.sep)) {
    send(res, 400, JSON.stringify({ code: 400, message: '文件名无效' }), 'application/json; charset=utf-8');
    return;
  }
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    send(res, 200, JSON.stringify({ code: 0, filename: fileName, markdown: text }), 'application/json; charset=utf-8');
  } catch (err) {
    send(res, 500, JSON.stringify({ code: 500, message: err.message }), 'application/json; charset=utf-8');
  }
}

function ocrToBank(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, JSON.stringify({ code: 405, message: 'Method not allowed' }), 'application/json; charset=utf-8');
    return;
  }
  readJsonBody(req, (err, payload = {}) => {
    if (err) {
      send(res, 400, JSON.stringify({ code: 400, message: '请求格式错误' }), 'application/json; charset=utf-8');
      return;
    }
    const jobId = String(payload.job_id || '').trim();
    const status = readJobStatus(jobId);
    if (!status || status.status !== 'completed') {
      send(res, 400, JSON.stringify({ code: 400, message: 'OCR 任务未完成，无法生成试卷' }), 'application/json; charset=utf-8');
      return;
    }
    const dir = ocrJobDir(jobId);
    const mdFile = status.output_files?.[0] ? path.join(dir, 'output', status.output_files[0]) : null;
    if (!mdFile || !fs.existsSync(mdFile)) {
      send(res, 404, JSON.stringify({ code: 404, message: 'Markdown 文件不存在' }), 'application/json; charset=utf-8');
      return;
    }
    // 复制 OCR 结果到 xingce-markdown-v2 输入区，按试卷名创建目录
    const paperName = status.filename ? path.basename(status.filename, path.extname(status.filename)) : jobId;
    const safePaperName = paperName.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 60) || jobId;
    const paperInputDir = path.join(XINGCE_OUTPUT_ROOT, 'ocr_input', safePaperName);
    fs.mkdirSync(paperInputDir, { recursive: true });
    const targetMd = path.join(paperInputDir, `${safePaperName}.md`);
    fs.copyFileSync(mdFile, targetMd);
    // 复制图片到同目录 images（模型可能把图片放在 Markdown 同级目录或 images/ 子目录）
    const ocrOutputDir = path.join(dir, 'output');
    const mdDir = path.dirname(mdFile);
    const imageSourceDirs = [path.join(mdDir, 'images'), mdDir];
    const targetImages = path.join(paperInputDir, 'images');
    fs.mkdirSync(targetImages, { recursive: true });
    const copiedImages = new Set();
    for (const srcDir of imageSourceDirs) {
      if (!fs.existsSync(srcDir)) continue;
      for (const name of fs.readdirSync(srcDir)) {
        if (copiedImages.has(name)) continue;
        if (!/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name)) continue;
        const src = path.join(srcDir, name);
        if (!fs.statSync(src).isFile()) continue;
        fs.copyFileSync(src, path.join(targetImages, name));
        fs.copyFileSync(src, path.join(paperInputDir, name));
        copiedImages.add(name);
      }
    }
    // 调用转换脚本
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'convert_markdown_papers_v2.py');
    const python = findPython();
    const child = spawn(python, [scriptPath, '--input', targetMd, '--output-dir', XINGCE_OUTPUT_ROOT, '--public-prefix', '/assets/question-images/xingce-v2'], {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => {
      if (code !== 0) {
        send(res, 500, JSON.stringify({ code: code || 500, message: stderr || stdout || '转换失败' }), 'application/json; charset=utf-8');
        return;
      }
      try {
        const result = JSON.parse(stdout);
        send(res, 200, JSON.stringify({ code: 0, ...result, paper_dir: paperInputDir }), 'application/json; charset=utf-8');
      } catch (parseErr) {
        send(res, 500, JSON.stringify({ code: 500, message: parseErr.message, stdout, stderr }), 'application/json; charset=utf-8');
      }
    });
  });
}

function ocrToEssay(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, JSON.stringify({ code: 405, message: 'Method not allowed' }), 'application/json; charset=utf-8');
    return;
  }
  readJsonBody(req, (err, payload = {}) => {
    if (err) {
      send(res, 400, JSON.stringify({ code: 400, message: '请求格式错误' }), 'application/json; charset=utf-8');
      return;
    }
    const jobId = String(payload.job_id || '').trim();
    const status = readJobStatus(jobId);
    if (!status || status.status !== 'completed') {
      send(res, 400, JSON.stringify({ code: 400, message: 'OCR 任务未完成，无法生成试卷' }), 'application/json; charset=utf-8');
      return;
    }
    const dir = ocrJobDir(jobId);
    const fileName = payload.filename || status.output_files?.[0];
    const mdFile = fileName ? path.join(dir, 'output', fileName) : null;
    if (!mdFile || !fs.existsSync(mdFile)) {
      send(res, 404, JSON.stringify({ code: 404, message: 'Markdown 文件不存在' }), 'application/json; charset=utf-8');
      return;
    }
    try {
      const markdown = fs.readFileSync(mdFile, 'utf8');
      send(res, 200, JSON.stringify({ code: 0, markdown, filename: fileName, job_id: jobId }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 500, JSON.stringify({ code: 500, message: err.message }), 'application/json; charset=utf-8');
    }
  });
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }
  if (req.url.startsWith('/api/admin')) {
    proxyAdmin(req, res);
    return;
  }
  if (req.url.startsWith('/api/upload-book-file')) {
    uploadBookFile(req, res);
    return;
  }
  if (req.url.startsWith('/api/convert-package')) {
    convertPackage(req, res);
    return;
  }
  if (req.url.startsWith('/api/generated-xingce-catalog')) {
    serveGeneratedCatalog(req, res);
    return;
  }
  if (req.url.startsWith('/api/generated-xingce-package')) {
    serveGeneratedPackage(req, res);
    return;
  }
  if (req.url.startsWith('/api/generated-xingce-image')) {
    serveGeneratedImage(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-detect')) {
    ocrDetect(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-upload')) {
    ocrUpload(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-start')) {
    ocrStart(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-status')) {
    ocrStatus(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-result')) {
    ocrResult(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-to-bank')) {
    ocrToBank(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-to-essay')) {
    ocrToEssay(req, res);
    return;
  }
  serveStatic(req, res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Admin console: http://127.0.0.1:${PORT}`);
  console.log(`Proxy target: ${ADMIN_ENDPOINT}`);
  console.log(`OCR tool: ${UNLIMITED_OCR_HOME}`);
});
