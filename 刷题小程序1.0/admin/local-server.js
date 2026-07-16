const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { isInsideMarkdownDestination, recoverOcrImageFile } = require('./lib/ocr-media');

const PORT = Number(process.env.PORT || 8787);
const ADMIN_ENDPOINT = process.env.ADMIN_ENDPOINT
  || 'https://cloud1-d0gsr2l1ye6344917-1449878482.ap-shanghai.app.tcloudbase.com/admin';

const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(ROOT, '..');
const XINGCE_OUTPUT_ROOT = path.join(PROJECT_ROOT, 'admin-output', 'xingce-markdown-v2');
const OCR_ROOT = path.join(PROJECT_ROOT, 'admin-output', 'ocr-jobs');
const WORKER_LOCK_FILE = process.env.WORKER_LOCK_FILE
  ? path.resolve(PROJECT_ROOT, process.env.WORKER_LOCK_FILE)
  : path.join(PROJECT_ROOT, 'worker', 'run', 'worker.lock');

// Unlimited-OCR 工具路径（可改为你实际存放位置）
const UNLIMITED_OCR_HOME = process.env.UNLIMITED_OCR_HOME || 'C:/Users/hao/Desktop/ocr/Unlimited-OCR';
const UNLIMITED_OCR_PYTHON = path.join(UNLIMITED_OCR_HOME, 'venv/Scripts/python.exe');
const UNLIMITED_OCR_RUNNER = path.join(UNLIMITED_OCR_HOME, 'ocr_runner.py');
// MinerU is the preferred local PDF parser. It is intentionally run as a
// separate process because model loading can take minutes and must not block
// the admin HTTP process.
const MINERU_COMMAND = process.env.MINERU_COMMAND || 'mineru';
const MINERU_PYTHON = process.env.MINERU_PYTHON || '';
const MINERU_BACKEND = process.env.MINERU_BACKEND || 'pipeline';
// 常驻 mineru-api 服务（避免 CLI 每次拉临时服务不稳定：exited before becoming healthy）
const MINERU_API_HOST = process.env.MINERU_API_HOST || '127.0.0.1';
const MINERU_API_PORT = Number(process.env.MINERU_API_PORT || 8000);
const MINERU_API_AUTOSTART = process.env.MINERU_API_AUTOSTART !== '0';
let mineruApiProcess = null;
let activeOcrJobId = null;
const ocrJobQueue = [];

function refreshOcrQueuePositions() {
  ocrJobQueue.forEach((item, index) => {
    const status = readJobStatus(item.jobId) || {};
    writeJobStatus(item.jobId, { ...status, status: 'queued', step: 'queue', queue_position: index + 1 });
  });
}
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
const MAX_BOOK_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_OCR_UPLOAD_BYTES = 200 * 1024 * 1024;
const BOOK_UPLOAD_CHUNK_BYTES = 128 * 1024;

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function serveWorkerHealth(req, res) {
  if (req.method !== 'GET') {
    send(res, 405, JSON.stringify({ code: 405, message: 'Method not allowed' }), 'application/json; charset=utf-8');
    return;
  }
  let pid = null;
  let lockUpdatedAt = null;
  try {
    pid = Number.parseInt(fs.readFileSync(WORKER_LOCK_FILE, 'utf8').trim(), 10);
    lockUpdatedAt = fs.statSync(WORKER_LOCK_FILE).mtime.toISOString();
  } catch (_) {
    pid = null;
  }
  const running = processIsAlive(pid);
  send(res, 200, JSON.stringify({
    code: 0,
    worker: {
      running,
      pid: running ? pid : null,
      lock_file: WORKER_LOCK_FILE,
      lock_updated_at: lockUpdatedAt,
    },
    mineru_api: {
      running: Boolean(mineruApiProcess && !mineruApiProcess.killed),
      pid: mineruApiProcess && !mineruApiProcess.killed ? mineruApiProcess.pid : null,
    },
  }), 'application/json; charset=utf-8');
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

function requestAdmin(action, payload, onDone, endpointOverride) {
  const body = JSON.stringify({ action, ...payload });
  let base = (endpointOverride || ADMIN_ENDPOINT || '').trim();
  if (!base) {
    onDone(new Error('未配置 ADMIN_ENDPOINT（云函数地址）'));
    return;
  }
  // 容错：相对路径或缺少协议时尝试补全
  if (base.startsWith('/')) {
    base = ADMIN_ENDPOINT || '';
  }
  if (base && !/^https?:\/\//i.test(base)) {
    base = 'https://' + base;
  }
  let target;
  try {
    target = new URL(base);
  } catch (err) {
    onDone(new Error(`云函数地址格式错误: ${base}`));
    return;
  }
  const client = target.protocol === 'http:' ? http : https;
  const proxyReq = client.request({
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

function parseMultipart(req, onDone, maxBytes = MAX_BOOK_UPLOAD_BYTES) {
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
    if (total > maxBytes) {
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

function uploadBookFileChunks({ adminSecret, file, cloudPath = '', purpose = 'book_pack', adminEndpoint = '' }, onDone) {
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
      cloud_path: cloudPath,
      upload_purpose: purpose,
      original_file_type: file.contentType,
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
    }, adminEndpoint);
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

function commandAvailable(command) {
  if (!command) return false;
  if (path.isAbsolute(command) && fs.existsSync(command)) return true;
  try {
    const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 3000,
    });
    return result.status === 0 && Boolean(String(result.stdout || '').trim());
  } catch (err) {
    return false;
  }
}

function detectMineruSync() {
  if (MINERU_PYTHON && fs.existsSync(MINERU_PYTHON)) {
    return { ok: true, runner: MINERU_PYTHON, mode: 'python-module' };
  }
  if (commandAvailable(MINERU_COMMAND)) {
    return { ok: true, runner: MINERU_COMMAND, mode: 'command' };
  }
  // 自动探测常见 conda 环境：miniconda3/anaconda3 下的 mineru 环境
  const home = process.env.USERPROFILE || 'C:\\Users\\hao';
  const candidates = [
    path.join(home, 'miniconda3', 'envs', 'mineru', 'python.exe'),
    path.join(home, 'miniconda3', 'envs', 'mineru', 'Scripts', 'mineru.exe'),
    path.join(home, 'anaconda3', 'envs', 'mineru', 'python.exe'),
    path.join(home, 'anaconda3', 'envs', 'mineru', 'Scripts', 'mineru.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const isPython = /\\python\.exe$/i.test(c);
      return { ok: true, runner: c, mode: isPython ? 'python-module' : 'command' };
    }
  }
  return {
    ok: false,
    reason: '未找到 MinerU。请先在安装 MinerU 的终端执行 mineru --help，或设置 MINERU_COMMAND / MINERU_PYTHON。',
  };
}

// 解析常驻 mineru-api 的启动命令。优先复用与 mineru 同目录的 mineru-api.exe，
// 其次尝试 PATH 中的 mineru-api，最后回退到 python -m mineru.cli.fast_api。
function resolveMineruApiCommand() {
  // 使用 detectMineruSync 自动发现的 runner（支持环境变量/conda 探测）
  const mineru = detectMineruSync();
  if (!mineru.ok) return null;

  let runner = mineru.runner;
  // 环境变量若显式指定了 python，优先用它启动 fast_api
  if (MINERU_PYTHON && fs.existsSync(MINERU_PYTHON)) {
    runner = MINERU_PYTHON;
  }

  if (/mineru\d*\.exe$/i.test(runner)) {
    const apiExe = path.join(path.dirname(runner), 'mineru-api.exe');
    if (fs.existsSync(apiExe)) return { runner: apiExe, args: [] };
  }
  if (commandAvailable('mineru-api')) {
    return { runner: 'mineru-api', args: [] };
  }
  if (fs.existsSync(runner)) {
    return { runner, args: ['-m', 'mineru.cli.fast_api'] };
  }
  return null;
}

function startMineruApiServer() {
  const cmd = resolveMineruApiCommand();
  if (!cmd) {
    console.log('[MinerU] 未找到 mineru-api，OCR 将回退到 CLI 自带临时服务（可能不稳定）。');
    return;
  }
  try {
    const child = spawn(cmd.runner, [...cmd.args, '--host', MINERU_API_HOST, '--port', String(MINERU_API_PORT)], {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', err => console.error(`[MinerU] API 进程启动失败: ${err.message}`));
    child.stdout && child.stdout.on('data', d => process.stdout.write(`[MinerU] ${d}`));
    child.stderr && child.stderr.on('data', d => process.stderr.write(`[MinerU] ${d}`));
    child.on('exit', (code, signal) => {
      if (mineruApiProcess === child) mineruApiProcess = null;
      console.log(`[MinerU] API 进程已退出 (code=${code}, signal=${signal})`);
    });
    mineruApiProcess = child;
    console.log(`[MinerU] 常驻 API 服务已启动: http://${MINERU_API_HOST}:${MINERU_API_PORT}`);
  } catch (err) {
    console.error(`[MinerU] 无法启动常驻 API: ${err.message}`);
  }
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
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
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
// 智能 OCR 导入（MinerU 优先，兼容旧 OCR）
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

// Prefer MinerU and retain Unlimited-OCR only as a compatibility fallback.
function detectOcrEnvironmentSync() {
  const mineru = detectMineruSync();
  if (mineru.ok) return { ...mineru, engine: 'mineru' };
  if (fs.existsSync(UNLIMITED_OCR_PYTHON) && fs.existsSync(UNLIMITED_OCR_RUNNER)) {
    return { ok: true, engine: 'unlimited-ocr', fallback: true, tool_path: UNLIMITED_OCR_HOME };
  }
  return { ok: false, reason: `${mineru.reason} 同时也未找到旧版 Unlimited-OCR。` };
}

function finishOcrJob(jobId) {
  if (activeOcrJobId === jobId) activeOcrJobId = null;
  if (!activeOcrJobId && ocrJobQueue.length) {
    const next = ocrJobQueue.shift();
    refreshOcrQueuePositions();
    activeOcrJobId = next.jobId;
    runOcrJob(next.jobId, next.inputType, next.imageMode);
  }
}

function enqueueOcrJob(jobId, inputType, imageMode) {
  if (activeOcrJobId === jobId || ocrJobQueue.some(item => item.jobId === jobId)) {
    return { status: activeOcrJobId === jobId ? 'running' : 'queued', queue_position: ocrJobQueue.findIndex(item => item.jobId === jobId) + 1 };
  }
  ocrJobQueue.push({ jobId, inputType, imageMode });
  const queuePosition = ocrJobQueue.length;
  const previous = readJobStatus(jobId) || {};
  writeJobStatus(jobId, { ...previous, status: 'queued', step: 'queue', queue_position: queuePosition, progress: 0 });
  if (!activeOcrJobId) finishOcrJob(null);
  else refreshOcrQueuePositions();
  return { status: activeOcrJobId === jobId ? 'running' : 'queued', queue_position: activeOcrJobId === jobId ? 0 : queuePosition };
}

function runOcrJob(jobId, inputType, imageMode) {
  const dir = ocrJobDir(jobId);
  if (!dir) return;
  const inputPath = path.join(dir, inputType === 'pdf' ? 'input.pdf' : 'input');
  const outputPath = path.join(dir, 'output');
  fs.mkdirSync(outputPath, { recursive: true });
  const environment = detectOcrEnvironmentSync();
  if (!environment.ok) {
    writeJobStatus(jobId, { status: 'failed', step: 'ocr', error: environment.reason });
    finishOcrJob(jobId);
    return;
  }

  let runner = environment.runner;
  let args;
  let cwd = PROJECT_ROOT;
  if (environment.engine === 'mineru') {
    if (environment.mode === 'python-module') {
      args = ['-m', 'mineru.cli.client', '-p', inputPath, '-o', outputPath, '-b', MINERU_BACKEND];
    } else {
      args = ['-p', inputPath, '-o', outputPath, '-b', MINERU_BACKEND];
    }
    // 复用常驻 mineru-api，避免 CLI 每次拉临时服务报 "exited before becoming healthy"
    if (mineruApiProcess && !mineruApiProcess.killed) {
      args.push('--api-url', `http://${MINERU_API_HOST}:${MINERU_API_PORT}`);
    }
  } else {
    runner = UNLIMITED_OCR_PYTHON;
    cwd = UNLIMITED_OCR_HOME;
    args = [UNLIMITED_OCR_RUNNER];
    if (inputType === 'pdf') {
      args.push('--pdf', inputPath, '--output_dir', outputPath, '--image_mode', 'base');
    } else {
      args.push('--image_dir', inputPath, '--output_dir', outputPath, '--image_mode', imageMode || 'gundam');
    }
  }

  writeJobStatus(jobId, {
    status: 'running', step: 'ocr', engine: environment.engine,
    started_at: Date.now(), progress: 0, queue_position: 0,
  });
  const child = spawn(runner, args, {
    cwd,
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(runner),
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  let stdout = '';
  let stderr = '';
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    finishOcrJob(jobId);
  };
  child.stdout.on('data', chunk => {
    stdout += chunk;
    const matches = stdout.match(/(\d{1,3})\s*%/g) || [];
    const percent = matches.length ? Number(matches[matches.length - 1].replace(/\D/g, '')) : 0;
    const completed = (stdout.match(/\[瀹屾垚\]/g) || []).length;
    const status = readJobStatus(jobId);
    if (status) {
      status.progress = Math.max(status.progress || 0, percent || Math.min(99, completed * 10));
      status.log = stdout.slice(-1200);
      writeJobStatus(jobId, status);
    }
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
    const status = readJobStatus(jobId);
    if (status) {
      status.log = `${stdout}\n${stderr}`.slice(-1200);
      writeJobStatus(jobId, status);
    }
  });
  child.on('error', err => {
    const status = readJobStatus(jobId) || {};
    writeJobStatus(jobId, { ...status, status: 'failed', error: err.message });
    finalize();
  });
  child.on('close', code => {
    if (finalized) return;
    const status = readJobStatus(jobId) || { status: 'running', step: 'ocr', engine: environment.engine };
    if (code !== 0) {
      writeJobStatus(jobId, { ...status, status: 'failed', error: stderr || stdout || `OCR process exited with ${code}` });
      finalize();
      return;
    }
    const outputFiles = [];
    const walkOutput = (currentDir, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch (err) { return; }
      for (const entry of entries) {
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walkOutput(path.join(currentDir, entry.name), entryRel);
        else if (/\.md$/i.test(entry.name)) outputFiles.push(entryRel);
      }
    };
    walkOutput(outputPath, '');
    // 优先使用 MinerU 的 auto/ 子目录识别文本（多页文档可能同时产生根目录 sample.md 与 auto/sample.md）
    outputFiles.sort((a, b) => {
      const ra = /(^|\/)auto\//.test(a) ? 0 : 1;
      const rb = /(^|\/)auto\//.test(b) ? 0 : 1;
      return ra - rb;
    });
    if (!outputFiles.length) {
      writeJobStatus(jobId, { ...status, status: 'failed', error: '识别完成但未发现 Markdown 输出文件' });
      finalize();
      return;
    }
    writeJobStatus(jobId, {
      ...status, status: 'completed', step: 'preview', progress: 100,
      output_files: outputFiles, log: `${stdout}\n${stderr}`.slice(-1200),
    });
    finalize();
  });
}

function ocrDetect(req, res) {
  const env = detectOcrEnvironmentSync();
  if (!env.ok) {
    send(res, 200, JSON.stringify({ ok: false, message: env.reason }), 'application/json; charset=utf-8');
    return;
  }
  send(res, 200, JSON.stringify({
    ok: true,
    engine: env.engine,
    fallback: Boolean(env.fallback),
    tool_path: env.engine === 'mineru' ? env.runner : UNLIMITED_OCR_HOME,
    model_cached: fs.existsSync(path.join(process.env.USERPROFILE || 'C:/Users/hao', '.cache/huggingface/hub/models--baidu--Unlimited-OCR')),
  }), 'application/json; charset=utf-8');
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
    const safeName = path.basename(file.filename).replace(/[^\w\u4e00-\u9fa5.() -]/g, '_');
    const savePath = path.join(dir, inputType === 'pdf' ? 'input.pdf' : path.join('input', safeName));
    fs.writeFileSync(savePath, file.buffer);
    writeJobStatus(jobId, { status: 'uploaded', step: 'upload', input_type: inputType, filename: safeName, created_at: Date.now() });
    send(res, 200, JSON.stringify({ code: 0, job_id: jobId, input_type: inputType, filename: safeName }), 'application/json; charset=utf-8');
  }, MAX_OCR_UPLOAD_BYTES);
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
    const queued = enqueueOcrJob(jobId, status.input_type, payload.image_mode || 'base');
    send(res, 200, JSON.stringify({ code: 0, job_id: jobId, ...queued }), 'application/json; charset=utf-8');
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

function collectOcrImages(rootDir) {
  const result = [];
  const walk = currentDir => {
    let entries = [];
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch (err) { return; }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(entry.name)) result.push(fullPath);
    }
  };
  walk(rootDir);
  return result;
}

// 把 OCR 原始 markdown 智能结构化为 V2 模板，供前端预览展示（可见的「智能化」）。
function ocrStructure(req, res) {
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
  if (!filePath.startsWith(path.join(dir, 'output') + path.sep) || !fs.existsSync(filePath)) {
    send(res, 404, JSON.stringify({ code: 404, message: 'Markdown 文件不存在' }), 'application/json; charset=utf-8');
    return;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const paperName = fileName ? path.basename(fileName, path.extname(fileName)) : jobId;
    const prepared = prepareOcrMarkdownForV2(raw, paperName);
    send(res, 200, JSON.stringify({
      code: 0,
      filename: fileName,
      raw_markdown: raw,
      markdown: prepared.markdown,
      changed: prepared.changed,
      question_count: prepared.question_count,
      group_count: prepared.group_count,
    }), 'application/json; charset=utf-8');
  } catch (err) {
    send(res, 500, JSON.stringify({ code: 500, message: err.message }), 'application/json; charset=utf-8');
  }
}

function normalizeOcrMarkdownImages(markdown, imageNames) {
  const known = new Set(imageNames);
  return String(markdown || '').replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (all, prefix, rawPath, suffix) => {
    const value = String(rawPath).trim();
    if (/^(?:https?:|data:|cloud:\/\/)/i.test(value)) return all;
    const name = path.basename(value.split(/[?#]/)[0]);
    return known.has(name) ? `${prefix}images/${name}${suffix}` : all;
  });
}

function copyAnswerOcrImages(answerJobId, primaryOutputDir, markdown) {
  const answerDir = ocrJobDir(answerJobId);
  const targetDir = path.join(primaryOutputDir, 'answer-images');
  fs.mkdirSync(targetDir, { recursive: true });
  const byBasename = new Map();
  const usedNames = new Set();
  for (const sourceFile of collectOcrImages(path.join(answerDir, 'output'))) {
    const originalName = path.basename(sourceFile).replace(/[^\w\u4e00-\u9fa5.()-]+/g, '_');
    const extension = path.extname(originalName);
    const stem = path.basename(originalName, extension) || 'image';
    let targetName = `answer_${originalName}`;
    let suffix = 2;
    while (usedNames.has(targetName)) targetName = `answer_${stem}_${suffix++}${extension}`;
    usedNames.add(targetName);
    fs.copyFileSync(sourceFile, path.join(targetDir, targetName));
    if (!byBasename.has(path.basename(sourceFile))) byBasename.set(path.basename(sourceFile), targetName);
  }
  const rewritten = String(markdown || '').replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (all, prefix, rawPath, suffix) => {
    const value = String(rawPath).trim();
    if (/^(?:https?:|data:|cloud:\/\/)/i.test(value)) return all;
    const mapped = byBasename.get(path.basename(value.split(/[?#]/)[0]));
    return mapped ? `${prefix}answer-images/${mapped}${suffix}` : all;
  });
  return { markdown: rewritten, image_count: usedNames.size };
}

const OCR_MODULE_HEADING_RE = new RegExp(
  '^(?:##\\s*)?(?:\\s*(?:第[一二三四五六七八九十0-9]+[部分节章类]|第[一二三四五六七八九十0-9]+|[一二三四五六七八九十0-9]+[.．、]?)\\s*[：:\\s]*)?' +
  '(政治理论|常识判断|言语理解(?:与表达)?|数量关系|数学运算|判断推理|资料分析)' +
  '(?:\\s*[（(][^）)]*[）)])?(?:\\s*[：:].*)?\\s*$', 'i');

function inferOcrModule(markdown) {
  const text = String(markdown || '');
  if (/资料分析/.test(text)) return '资料分析';
  if (/判断推理|图形推理|定义判断|类比推理|逻辑判断/.test(text)) return '判断推理';
  if (/数量关系|数学运算|数字推理/.test(text)) return '数量关系';
  if (/言语理解/.test(text)) return '言语理解与表达';
  if (/政治理论/.test(text)) return '政治理论';
  return '常识判断';
}

/**
 * MinerU preserves reading order and images, but it does not know the V2
 * question-bank headings.  This adapter turns real OCR output (continuous
 * paragraphs, question numbers glued to the previous line, options inline,
 * no answer/explanation) into the strict V2 markdown expected by
 * convert_markdown_papers_v2.py.  It is intentionally conservative: if the
 * source is already V2-compliant, it leaves it alone.
 */
function fixMisplacedQuestionNumbers(text) {
  const paragraphs = text.split('\n\n');
  const fixedParagraphs = [];
  const regex = /([一-鿿a-zA-Z，。？；：”）（])(\d{1,3})([.．、])(?=[一-鿿a-zA-Z①-⑳⑴-⒛㊀-㊉$（(。“”‘’「」『』《〈【\[])/g;
  for (let para of paragraphs) {
    const paraClean = para.trim();
    if (!paraClean) {
      fixedParagraphs.push(para);
      continue;
    }
    regex.lastIndex = 0;
    let match = null;
    let candidate = null;
    while ((candidate = regex.exec(paraClean)) !== null) {
      // Do not treat the numeric tail of a MinerU image hash (for example
      // `...f101.jpg`) as question 101.
      if (!isInsideMarkdownDestination(paraClean, candidate.index)) {
        match = candidate;
        break;
      }
    }
    if (match) {
      if (!/^\s*\d{1,3}\s*[.．、]/.test(paraClean)) {
        const qnum = match[2];
        const dot = match[3];
        const startIdx = match.index + match[1].length;
        const endIdx = startIdx + qnum.length + dot.length;
        let newPara = paraClean.slice(0, startIdx) + paraClean.slice(endIdx);
        newPara = `${qnum}${dot} ${newPara}`;
        fixedParagraphs.push(newPara);
        continue;
      }
    }
    fixedParagraphs.push(para);
  }
  return fixedParagraphs.join('\n\n');
}

function prepareOcrMarkdownForV2(markdown, paperName) {
  let source = String(markdown || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  source = fixMisplacedQuestionNumbers(source);

  // MinerU 有时把模块标题和上一行粘在一起，例如 "D. ...四. 数量关系：..."，先切开
  const moduleSplitRe = /(.{10,})((?:##\s*)?(?:第[一二三四五六七八九十0-9]+[部分节章类]|[一二三四五六七八九十0-9]+[.．、])\s*(政治理论|常识判断|言语理解(?:与表达)?|数量关系|数学运算|判断推理|资料分析)(?:\s*[：:].*)?)/g;
  source = source.replace(moduleSplitRe, '$1\n$2');
  const lines = source.split('\n');

  // 试卷标题
  let paperTitle = paperName || 'OCR行测试卷';
  for (const raw of lines.slice(0, 12)) {
    const t = raw.trim();
    if (!t || /^#{1,6}\s/.test(t)) continue;
    if (/^\d{4}年|国考|省考|联考|市考|事业单位|真题|行测|申论/.test(t) && t.length <= 60) {
      paperTitle = t;
      break;
    }
  }

  function normalizeModuleHeading(line) {
    const m = line.trim().match(OCR_MODULE_HEADING_RE);
    return m ? m[1] : null;
  }

  function repairOcrNumbers(text) {
    // 保护图片扩展名里的数字点，避免 f45.jpg 变成题号
    let body = text.replace(/(\d{1,3})\.(jpg|jpeg|png|gif|webp|bmp)/gi, '$1\u0000$2');
    // 修复 "58.理" 这种数字点后无空格（但保留小数 1.2）
    body = body.replace(/(\d{1,3})\.([^ \n\d])/g, '$1. $2');
    // 修复 "人民求解放1.的" 这种中文后粘连题号
    body = body.replace(/([^ \n])(\d{1,3})\.([^ \n])/g, (m, before, num, after) => {
      if (/\d/.test(before) && /\d/.test(after)) return m;
      return `${before} ${num}. ${after}`;
    });
    body = body.replace(/\u0000/g, '.');
    return body;
  }

  function extractQuestion(num, block) {
    const optRe = /(?<![A-Za-z0-9])([A-D])\s*[.．、:：]\s*/gi;
    const positions = [];
    let match;
    while ((match = optRe.exec(block)) !== null) {
      positions.push({ index: match.index, key: match[1].toUpperCase(), length: match[0].length });
    }

    let stem = block;
    let A = "", B = "", C = "", D = "";

    if (positions.length > 0) {
      stem = block.slice(0, positions[0].index).trim();
      const optMap = { A: "", B: "", C: "", D: "" };
      for (let i = 0; i < positions.length; i++) {
        const current = positions[i];
        const start = current.index + current.length;
        const end = (i + 1 < positions.length) ? positions[i + 1].index : block.length;
        optMap[current.key] = block.slice(start, end).trim();
      }
      A = optMap.A;
      B = optMap.B;
      C = optMap.C;
      D = optMap.D;
    }

    const cleanStemRe = new RegExp(`^\\s*#{0,6}\\s*${num}\\s*[.．、]\\s*`);
    stem = stem.replace(cleanStemRe, '').trim();

    return {
      num,
      stem,
      A: A || '选项A',
      B: B || '选项B',
      C: C || '选项C',
      D: D || '选项D'
    };
  }

  function splitQuestionsFromModule(text) {
    const candidates = [];
    const regex = /(?:^|\n)\s*(\d{1,3})\s*[.．、]\s*(?=[一-鿿A-Za-z0-9（(①-⑳⑴-⒛㊀-㊉$。“”‘’「」『』《〈【\[])/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const num = parseInt(match[1], 10);
      if (num >= 1 && num <= 200) {
        let idx = match.index;
        if (text[idx] === '\n') idx += 1;

        // Protect decimals
        const remaining = text.slice(idx);
        if (/^\d{1,3}\.\d{1,2}(?![.\d])/.test(remaining)) {
          continue;
        }

        // Protect noun prefixes
        const beforeChar = idx > 0 ? text[idx - 1] : "";
        if ("图式例注附第课节章部类项组".includes(beforeChar)) {
          continue;
        }

        candidates.push({ index: idx, num, len: match[0].length - (text[match.index] === '\n' ? 1 : 0) });
      }
    }

    // Monotonic sequence verification
    const validCandidates = [];
    let lastNum = 0;
    for (const c of candidates) {
      if (lastNum === 0) {
        validCandidates.push(c);
        lastNum = c.num;
      } else if (c.num >= lastNum - 2) {
        validCandidates.push(c);
        lastNum = Math.max(lastNum, c.num);
      }
    }

    const questions = [];
    for (let i = 0; i < validCandidates.length; i++) {
      const c = validCandidates[i];
      const start = c.index;
      const end = i + 1 < validCandidates.length ? validCandidates[i + 1].index : text.length;
      const q = extractQuestion(c.num, text.slice(start, end).trim());
      if (q) {
        questions.push(q);
      }
    }
    return questions;
  }

  const output = [];
  output.push(`# ${paperTitle}`);
  output.push('');

  let currentModule = '';
  let currentModuleBuffer = [];
  let groupCount = 0;
  let questionCount = 0;
  let globalQuestionNumber = 1;
  let changed = false;

  function flushModule() {
    if (!currentModule || !currentModuleBuffer.length) return;
    output.push(`## ${currentModule}`);
    output.push(`模块：${currentModule}`);
    output.push('');
    groupCount += 1;
    const questions = splitQuestionsFromModule(currentModuleBuffer.join('\n'));
    for (const q of questions) {
      const num = q.num || globalQuestionNumber;
      output.push(`### ${num}`);
      output.push(`题干：${q.stem}`);
      output.push(`A. ${q.A}`);
      output.push(`B. ${q.B}`);
      output.push(`C. ${q.C}`);
      output.push(`D. ${q.D}`);
      output.push('答案：');
      output.push('解析：');
      output.push('');
      questionCount += 1;
      globalQuestionNumber = num + 1;
    }
    changed = true;
    currentModuleBuffer = [];
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const moduleName = normalizeModuleHeading(line);
    if (moduleName) {
      flushModule();
      currentModule = moduleName;
      continue;
    }
    // 跳过原试卷标题（已单独处理）
    if (/^#\s+/.test(line)) continue;
    currentModuleBuffer.push(line);
  }
  flushModule();

  if (groupCount === 0) {
    output.push('## 综合题');
    output.push(`模块：${inferOcrModule(source)}`);
    output.push('');
    groupCount += 1;
    const questions = splitQuestionsFromModule(currentModuleBuffer.join('\n'));
    for (const q of questions) {
      const num = q.num || globalQuestionNumber;
      output.push(`### ${num}`);
      output.push(`题干：${q.stem}`);
      output.push(`A. ${q.A}`);
      output.push(`B. ${q.B}`);
      output.push(`C. ${q.C}`);
      output.push(`D. ${q.D}`);
      output.push('答案：');
      output.push('解析：');
      output.push('');
      questionCount += 1;
      globalQuestionNumber = num + 1;
    }
    changed = true;
  }

  const result = output.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  return {
    markdown: result,
    changed,
    question_count: questionCount,
    group_count: groupCount,
  };
}

// ── 架构2 管线辅助：在 OCR 产物里定位 MinerU 输出、顺序执行 Python 步骤 ──
function findOcrFile(rootDir, basenames) {
  for (const b of basenames) {
    const p = path.join(rootDir, 'output', b);
    if (fs.existsSync(p)) return p;
  }
  let found = null;
  (function walk(d) {
    if (found) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (!found && basenames.includes(e.name)) found = fp;
    }
  })(rootDir);
  return found;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function repairDraftOcrMediaReferences(drafts, jobDir) {
  const replacements = new Map();
  const recovered = [];
  const missing = [];
  const mimeByExt = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  };

  for (const item of Array.isArray(drafts && drafts.media) ? drafts.media : []) {
    if (!item || item.requires_upload !== true) continue;
    const original = String(item.source_path || item.path || '').trim();
    const requestedName = path.basename(original.replace(/\\/g, '/'));
    const sourceFile = requestedName
      ? (findOcrFile(jobDir, [requestedName]) || recoverOcrImageFile(jobDir, original))
      : null;
    if (!sourceFile || !fs.existsSync(sourceFile)) {
      missing.push({ asset_id: item.asset_id || '', path: original });
      continue;
    }

    const actualName = path.basename(sourceFile);
    const canonicalPath = `images/${actualName}`;
    if (original && original !== canonicalPath) replacements.set(original, canonicalPath);
    if (item.path && item.path !== canonicalPath) replacements.set(String(item.path), canonicalPath);
    if (requestedName !== actualName) {
      recovered.push({ asset_id: item.asset_id || '', from: original, to: canonicalPath });
    }

    const extension = path.extname(actualName).toLowerCase();
    item.path = canonicalPath;
    item.source_path = canonicalPath;
    item.mime = mimeByExt[extension] || 'application/octet-stream';
    item.extension = extension.replace(/^\./, '');
    item.bytes = fs.statSync(sourceFile).size;
    item.sha256 = sha256File(sourceFile);
    if (requestedName !== actualName) {
      item.recovered_source_path = path.relative(path.resolve(jobDir), path.resolve(sourceFile)).replace(/\\/g, '/');
    }
  }

  const rewrite = (value, key = '') => {
    if (typeof value === 'string') return replacements.get(value) || value;
    if (Array.isArray(value)) return value.map(child => rewrite(child, key));
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) {
        // Keep the untouched OCR evidence for comparison in the review screen.
        if (['raw_text', 'source_evidence', 'source_context'].includes(childKey)) continue;
        value[childKey] = rewrite(child, childKey);
      }
    }
    return value;
  };
  if (replacements.size) rewrite(drafts);

  return {
    changed: replacements.size > 0,
    recovered,
    missing,
    checked: (Array.isArray(drafts && drafts.media) ? drafts.media : [])
      .filter(item => item && item.requires_upload === true).length,
  };
}

function serveOcrEvidenceImage(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const jobId = requestUrl.searchParams.get('job_id') || '';
  const requested = requestUrl.searchParams.get('filename') || '';
  const jobDir = ocrJobDir(jobId);
  const filename = path.basename(requested.replace(/\\/g, '/'));
  if (!jobDir || !filename || !/\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(filename)) {
    send(res, 400, JSON.stringify({ code: 400, message: 'OCR 图片参数无效' }), 'application/json; charset=utf-8');
    return;
  }
  const imagePath = findOcrFile(jobDir, [filename]);
  if (!imagePath) {
    send(res, 404, JSON.stringify({ code: 404, message: `没有找到 OCR 图片：${filename}` }), 'application/json; charset=utf-8');
    return;
  }
  const resolvedJobDir = path.resolve(jobDir);
  const resolvedImage = path.resolve(imagePath);
  if (!resolvedImage.startsWith(resolvedJobDir + path.sep)) {
    send(res, 403, JSON.stringify({ code: 403, message: 'OCR 图片越过任务目录' }), 'application/json; charset=utf-8');
    return;
  }
  fs.readFile(resolvedImage, (err, data) => {
    if (err) send(res, 404, JSON.stringify({ code: 404, message: `没有找到 OCR 图片：${filename}` }), 'application/json; charset=utf-8');
    else send(res, 200, data, TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream');
  });
}

function runPythonPipeline(steps, cb) {
  const python = findPython();
  let i = 0;
  (function next() {
    if (i >= steps.length) { cb(null); return; }
    const step = steps[i++];
    const child = spawn(python, step.args, {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let out = '', err = '';
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('close', code => {
      if (code !== 0) { cb(new Error(`${step.label} 失败 (exit ${code})`), err || out); return; }
      next();
    });
  })();
}

function summarizeModules(questions) {
  const map = {};
  for (const q of questions) {
    const m = q.module_id || (q.source_evidence && q.source_evidence.module) || '未分类';
    map[m] = (map[m] || 0) + 1;
  }
  return Object.keys(map).map(m => ({ module: m, count: map[m] }));
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
    const answerJobId = String(payload.answer_job_id || '').trim();
    const status = readJobStatus(jobId);
    if (!status || status.status !== 'completed') {
      send(res, 400, JSON.stringify({ code: 400, message: 'OCR 任务未完成，无法生成试卷' }), 'application/json; charset=utf-8');
      return;
    }
    let answerStatus = null;
    if (answerJobId) {
      answerStatus = readJobStatus(answerJobId);
      if (!answerStatus || answerStatus.status !== 'completed') {
        send(res, 400, JSON.stringify({ code: 400, message: '答案解析 OCR 任务未完成，无法配对生成试卷' }), 'application/json; charset=utf-8');
        return;
      }
      if (answerJobId === jobId) {
        send(res, 400, JSON.stringify({ code: 400, message: '题目卷和答案解析卷不能使用同一个 OCR 任务' }), 'application/json; charset=utf-8');
        return;
      }
      const questionInput = path.join(ocrJobDir(jobId), 'input.pdf');
      const answerInput = path.join(ocrJobDir(answerJobId), 'input.pdf');
      if (fs.existsSync(questionInput) && fs.existsSync(answerInput)) {
        const questionStat = fs.statSync(questionInput);
        const answerStat = fs.statSync(answerInput);
        if (questionStat.size === answerStat.size && sha256File(questionInput) === sha256File(answerInput)) {
          send(res, 422, JSON.stringify({
            code: 422,
            message: '题目卷和答案解析卷是同一个 PDF，无法提取答案。请重新选择真正的答案解析 PDF。',
          }), 'application/json; charset=utf-8');
          return;
        }
      }
    }
    const dir = ocrJobDir(jobId);
    // 1) 定位 MinerU 产物：markdown + content_list.json
    const mdRel = Array.isArray(status.output_files) && status.output_files.find(f => /input\.md$|full\.md$/.test(f));
    const mdFile = mdRel ? path.join(dir, 'output', mdRel) : findOcrFile(dir, ['input.md', 'full.md']);
    if (!mdFile || !fs.existsSync(mdFile)) {
      send(res, 404, JSON.stringify({ code: 404, message: 'Markdown 文件不存在' }), 'application/json; charset=utf-8');
      return;
    }
    const clRel = Array.isArray(status.output_files) && status.output_files.find(f => /content_list/.test(f));
    const contentListFile = clRel ? path.join(dir, 'output', clRel) : findOcrFile(dir, ['input_content_list.json']);

    // 2) 原始 markdown（允许前端直接传 markdown 覆盖）
    const rawMarkdown = (typeof payload.markdown === 'string' && payload.markdown.trim())
      ? payload.markdown
      : fs.readFileSync(mdFile, 'utf8');

    // 3) 确定性切题 + 结构化（架构2：split -> structure -> question_drafts 待复核）
    const scriptsDir = path.join(PROJECT_ROOT, 'scripts');
    const outDir = path.join(dir, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const rawQuestionsPath = path.join(outDir, 'raw_questions.json');
    const draftsPath = path.join(outDir, 'question_drafts.json');
    const extractedAnswersPath = path.join(outDir, 'answer_solutions.json');

    let mdTmp = mdFile;
    if (typeof payload.markdown === 'string' && payload.markdown.trim()) {
      mdTmp = path.join(outDir, 'ocr_input_tmp.md');
      fs.writeFileSync(mdTmp, rawMarkdown, 'utf8');
    }

    const splitArgs = [
      path.join(scriptsDir, 'split_questions.py'),
      '--markdown', mdTmp,
      '--output', rawQuestionsPath,
    ];
    if (contentListFile && fs.existsSync(contentListFile)) {
      splitArgs.push('--content-list', contentListFile);
    }

    const structureArgs = [
      path.join(scriptsDir, 'structure_questions.py'),
      '--input', rawQuestionsPath,
      '--output', draftsPath,
      '--paper-id', jobId,
      '--task-id', jobId,
    ];

    const pipelines = [
      { args: splitArgs, label: 'split_questions' },
      { args: structureArgs, label: 'structure_questions' },
    ];
    let answerImageCount = 0;
    if (answerJobId) {
      const answerDir = ocrJobDir(answerJobId);
      const answerMdRel = Array.isArray(answerStatus.output_files) && answerStatus.output_files.find(f => /input\.md$|full\.md$/.test(f));
      const answerMdFile = answerMdRel ? path.join(answerDir, 'output', answerMdRel) : findOcrFile(answerDir, ['input.md', 'full.md']);
      if (!answerMdFile || !fs.existsSync(answerMdFile)) {
        send(res, 404, JSON.stringify({ code: 404, message: '答案解析 Markdown 文件不存在' }), 'application/json; charset=utf-8');
        return;
      }
      const answerRawMarkdown = (typeof payload.answer_markdown === 'string' && payload.answer_markdown.trim())
        ? payload.answer_markdown
        : fs.readFileSync(answerMdFile, 'utf8');
      const preparedAnswer = copyAnswerOcrImages(answerJobId, outDir, answerRawMarkdown);
      answerImageCount = preparedAnswer.image_count;
      const answerTmp = path.join(outDir, 'answer_input_tmp.md');
      fs.writeFileSync(answerTmp, preparedAnswer.markdown, 'utf8');
      pipelines.push({
        args: [path.join(scriptsDir, 'extract_answer_solutions.py'), '--markdown', answerTmp, '--output', extractedAnswersPath],
        label: 'extract_answer_solutions',
      });
      pipelines.push({
        args: [
          path.join(scriptsDir, 'merge_question_answer_packages.py'),
          '--package', draftsPath,
          '--answers', extractedAnswersPath,
          '--output', draftsPath,
          '--answer-task-id', answerJobId,
        ],
        label: 'merge_question_answer_packages',
      });
    }

    runPythonPipeline(pipelines, (err, detail) => {
      if (err) {
        send(res, 500, JSON.stringify({ code: 500, message: err.message, detail: String(detail || '') }), 'application/json; charset=utf-8');
        return;
      }
      let drafts;
      try {
        drafts = JSON.parse(fs.readFileSync(draftsPath, 'utf8'));
      } catch (e) {
        send(res, 500, JSON.stringify({ code: 500, message: '读取 question_drafts 失败: ' + e.message }), 'application/json; charset=utf-8');
        return;
      }
      const mediaRepair = repairDraftOcrMediaReferences(drafts, dir);
      if (mediaRepair.changed) {
        fs.writeFileSync(draftsPath, JSON.stringify(drafts, null, 2), 'utf8');
      }
      if (answerJobId) {
        let extractedAnswers = null;
        try {
          extractedAnswers = JSON.parse(fs.readFileSync(extractedAnswersPath, 'utf8'));
        } catch (_) { /* 由下面的质量闸口统一报错 */ }
        const answerCount = Number(extractedAnswers && extractedAnswers.answer_count) || 0;
        const explanationCount = Number(extractedAnswers && extractedAnswers.explanation_count) || 0;
        const matchedCount = Number(drafts.pair_merge && drafts.pair_merge.matched_count) || 0;
        if (answerCount === 0 || matchedCount === 0) {
          send(res, 422, JSON.stringify({
            code: 422,
            message: `答案解析卷未提取到可配对的明确答案（答案 ${answerCount}，解析 ${explanationCount}，匹配 ${matchedCount}）。请确认右侧选择的是真正答案解析 PDF，并查看“答案卷 OCR 原文”。`,
            pair_merge: drafts.pair_merge || null,
          }), 'application/json; charset=utf-8');
          return;
        }
      }
      const lowConf = drafts.questions
        .filter(q => Number(q.parser_confidence) <= 0.5)
        .map(q => q.question_no);
      send(res, 200, JSON.stringify({
        code: 0,
        engine: status.engine || 'mineru',
        task_id: drafts.task_id,
        paper_id: drafts.paper_id,
        paper_title: drafts.paper_title,
        question_count: drafts.count,
        modules: summarizeModules(drafts.questions),
        low_confidence: lowConf,
        validation_errors: drafts.validation_errors || [],
        validation_warnings: drafts.validation_warnings || [],
        media_check: mediaRepair,
        paired_import: Boolean(answerJobId),
        answer_job_id: answerJobId || null,
        answer_image_count: answerImageCount,
        pair_merge: drafts.pair_merge || null,
        questions: drafts.questions,
        drafts_path: draftsPath,
        raw_questions_path: rawQuestionsPath,
        message: '确定性切题 + 结构化完成，已生成 question_drafts（待人工/AI 复核）',
      }, null, 2), 'application/json; charset=utf-8');
    });
  });
}

// 将本地 question_drafts.json 分批写入 CloudBase 草稿箱，避免单请求 payload 超过 100KB
function ocrSaveDraft(req, res) {
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
    if (!jobId) {
      send(res, 400, JSON.stringify({ code: 400, message: '缺少 job_id' }), 'application/json; charset=utf-8');
      return;
    }
    const adminSecret = String(payload.admin_secret || '').trim();
    if (!adminSecret) {
      send(res, 403, JSON.stringify({ code: 403, message: 'ADMIN_SECRET 缺失' }), 'application/json; charset=utf-8');
      return;
    }
    const adminEndpoint = String(payload.admin_endpoint || ADMIN_ENDPOINT || '').trim();
    if (!adminEndpoint) {
      send(res, 403, JSON.stringify({ code: 403, message: '未配置云函数地址（admin_endpoint）' }), 'application/json; charset=utf-8');
      return;
    }
    let adminEndpointUrl;
    try {
      adminEndpointUrl = new URL(adminEndpoint);
    } catch (_) {
      send(res, 400, JSON.stringify({ code: 400, message: 'admin_endpoint 格式无效' }), 'application/json; charset=utf-8');
      return;
    }
    if (!/^https?:$/.test(adminEndpointUrl.protocol)
      || !/(?:\.tcloudbase\.com|\.qcloud\.com|^localhost$|^127\.0\.0\.1$)/i.test(adminEndpointUrl.hostname)) {
      send(res, 403, JSON.stringify({ code: 403, message: 'admin_endpoint 只允许腾讯云或本机地址' }), 'application/json; charset=utf-8');
      return;
    }
    const jobOutputDir = path.resolve(ocrJobDir(jobId), 'output');
    const expectedDraftsPath = path.join(jobOutputDir, 'question_drafts.json');
    const draftsPath = path.resolve(payload.drafts_path ? String(payload.drafts_path).trim() : expectedDraftsPath);
    if (draftsPath !== expectedDraftsPath || !draftsPath.startsWith(jobOutputDir + path.sep)) {
      send(res, 403, JSON.stringify({ code: 403, message: 'drafts_path 必须是当前 OCR 任务生成的 question_drafts.json' }), 'application/json; charset=utf-8');
      return;
    }
    if (!fs.existsSync(draftsPath)) {
      send(res, 404, JSON.stringify({ code: 404, message: 'question_drafts.json 不存在，请先生成试卷' }), 'application/json; charset=utf-8');
      return;
    }
    let drafts;
    try {
      drafts = JSON.parse(fs.readFileSync(draftsPath, 'utf8'));
    } catch (e) {
      send(res, 500, JSON.stringify({ code: 500, message: '读取 question_drafts.json 失败: ' + e.message }), 'application/json; charset=utf-8');
      return;
    }
    const mediaRepair = repairDraftOcrMediaReferences(drafts, ocrJobDir(jobId));
    if (mediaRepair.changed) {
      fs.writeFileSync(draftsPath, JSON.stringify(drafts, null, 2), 'utf8');
    }
    if (mediaRepair.missing.length) {
      send(res, 422, JSON.stringify({
        code: 422,
        message: `仍有 ${mediaRepair.missing.length} 张 OCR 图片确实缺失，请重新识别对应 PDF`,
        missing_images: mediaRepair.missing,
      }), 'application/json; charset=utf-8');
      return;
    }
    if (Number(drafts.schema_version) !== 2 || !drafts.paper || !Array.isArray(drafts.solutions)) {
      send(res, 422, JSON.stringify({ code: 422, message: '本地草稿不是新版 V2 结构，请重新点击“生成行测试卷”' }), 'application/json; charset=utf-8');
      return;
    }
    const questions = drafts.questions || [];
    if (questions.length === 0) {
      send(res, 422, JSON.stringify({ code: 422, message: '草稿包没有可审核的题目' }), 'application/json; charset=utf-8');
      return;
    }

    // CloudBase HTTP 触发器对请求体大小有限制。不能再按“每批几题”
    // 粗略切分，因为一道带表格/长材料的题可能比十道普通题还大。
    // 下面统一按最终 JSON 的 UTF-8 字节数动态分批，并留足网关余量。
    const MAX_DRAFT_REQUEST_BYTES = 44 * 1024;
    const RAW_MARKDOWN_PREVIEW_BYTES = 4 * 1024;

    const paperName = drafts.paper_title || drafts.paper_id || 'OCR行测试卷';
    const paperId = drafts.paper_id || '';
    const solutionMap = new Map((drafts.solutions || []).map(item => [item.question_id, item]));
    const rawMarkdownFile = path.join(jobOutputDir, 'ocr_input_tmp.md');
    let sourceMarkdown = fs.existsSync(rawMarkdownFile)
      ? fs.readFileSync(rawMarkdownFile, 'utf8')
      : '';
    if (!sourceMarkdown) {
      const status = readJobStatus(jobId) || {};
      const mdRel = Array.isArray(status.output_files) && status.output_files.find(file => /input\.md$|full\.md$/.test(file));
      const sourceFile = mdRel ? path.join(jobOutputDir, mdRel) : findOcrFile(ocrJobDir(jobId), ['input.md', 'full.md']);
      if (sourceFile && fs.existsSync(sourceFile)) sourceMarkdown = fs.readFileSync(sourceFile, 'utf8');
    }

    function utf8Prefix(value, maxBytes) {
      const input = String(value || '');
      if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input;
      let low = 0;
      let high = input.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(input.slice(0, mid), 'utf8') <= maxBytes) low = mid;
        else high = mid - 1;
      }
      return input.slice(0, low);
    }

    function requestBytes(payloadValue) {
      return Buffer.byteLength(JSON.stringify({ action: 'draft', ...payloadValue }), 'utf8');
    }

    function packageForBatch(batch, includePaper = false) {
      const ids = new Set(batch.map(item => item && item._id).filter(Boolean));
      return {
        schema_version: 2,
        paper: includePaper ? drafts.paper : undefined,
        groups: [],
        questions: batch,
        solutions: Array.from(ids).map(id => solutionMap.get(id)).filter(Boolean),
        media: [],
        // 草稿复核和发布时会从题目/解析重新校验，无需重复传整套提示列表。
        validation_errors: [],
        validation_warnings: [],
      };
    }

    function buildQuestionBatches(basePayload) {
      const result = [];
      let current = [];
      for (const question of questions) {
        const candidate = [...current, question];
        const candidatePayload = {
          ...basePayload,
          package: packageForBatch(candidate, result.length === 0),
        };
        if (current.length && requestBytes(candidatePayload) > MAX_DRAFT_REQUEST_BYTES) {
          result.push(current);
          current = [question];
        } else {
          current = candidate;
        }
        const singlePayload = {
          ...basePayload,
          package: packageForBatch(current, result.length === 0),
        };
        if (requestBytes(singlePayload) > MAX_DRAFT_REQUEST_BYTES) {
          const qid = question && question._id ? question._id : 'unknown';
          throw new Error(`题目 ${qid} 单题数据超过上传上限，请先在逐题复核中删除误并入的大段材料后重试`);
        }
      }
      if (current.length) result.push(current);
      return result;
    }

    function buildMetadataBatches(carrierQuestion, adminSecretValue, draftIdValue) {
      const items = [
        ...(drafts.groups || []).map(value => ({ type: 'group', value })),
        ...(drafts.media || []).map(value => ({ type: 'media', value })),
      ];
      const result = [];
      let current = { groups: [], media: [] };
      const makePayload = value => ({
        draft_action: 'append',
        admin_secret: adminSecretValue,
        draft_id: draftIdValue,
        questions: [carrierQuestion],
        solutions: [],
        groups: value.groups,
        media: value.media,
      });
      for (const item of items) {
        const candidate = {
          groups: item.type === 'group' ? [...current.groups, item.value] : current.groups,
          media: item.type === 'media' ? [...current.media, item.value] : current.media,
        };
        if ((current.groups.length || current.media.length)
          && requestBytes(makePayload(candidate)) > MAX_DRAFT_REQUEST_BYTES) {
          result.push(current);
          current = {
            groups: item.type === 'group' ? [item.value] : [],
            media: item.type === 'media' ? [item.value] : [],
          };
        } else {
          current = candidate;
        }
        if (requestBytes(makePayload(current)) > MAX_DRAFT_REQUEST_BYTES) {
          const label = item.type === 'group'
            ? `共享材料 ${item.value && item.value._id || ''}`
            : `图片元数据 ${item.value && item.value.asset_id || ''}`;
          throw new Error(`${label} 单项数据超过上传上限，请先复核材料是否误拼接`);
        }
      }
      if (current.groups.length || current.media.length) result.push(current);
      return result;
    }

    function uploadPendingMedia() {
      const pending = (drafts.media || []).filter(item => item && item.requires_upload === true);
      const replacements = new Map();
      const safePaper = String(paperId || jobId).replace(/[^\w-]+/g, '_').slice(0, 80) || 'paper';
      const mimeByExt = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
      };

      const uploadOne = item => new Promise((resolve, reject) => {
        const original = String(item.source_path || item.path || '').trim();
        const basename = path.basename(original.replace(/\\/g, '/'));
        const jobDir = ocrJobDir(jobId);
        const sourceFile = basename
          ? (findOcrFile(jobDir, [basename]) || recoverOcrImageFile(jobDir, original))
          : null;
        if (!sourceFile || !fs.existsSync(sourceFile)) {
          reject(new Error(`OCR 图片不存在：${original || item.asset_id}`));
          return;
        }
        const resolvedJobDir = path.resolve(jobDir);
        const resolvedFile = path.resolve(sourceFile);
        if (!resolvedFile.startsWith(resolvedJobDir + path.sep)) {
          reject(new Error(`OCR 图片越过任务目录：${basename}`));
          return;
        }
        const resolvedBasename = path.basename(resolvedFile);
        const extension = path.extname(resolvedBasename).toLowerCase() || '.png';
        const cloudName = `${String(item.sha256 || item.asset_id || Date.now()).replace(/[^\w-]+/g, '_').slice(0, 40)}${extension}`;
        const cloudPath = `question-images/ocr-drafts/${safePaper}/${cloudName}`;
        const file = {
          filename: resolvedBasename || cloudName,
          contentType: mimeByExt[extension] || 'application/octet-stream',
          buffer: fs.readFileSync(resolvedFile),
        };
        uploadBookFileChunks({
          adminSecret,
          adminEndpoint,
          file,
          cloudPath,
          purpose: 'draft_asset',
        }, (uploadErr, result) => {
          if (uploadErr) return reject(uploadErr);
          const fileId = result && result.file_id;
          if (!fileId) return reject(new Error(`OCR 图片上传未返回 fileID：${basename}`));
          replacements.set(String(item.path || original), fileId);
          item.path = fileId;
          item.cloud_path = result.cloud_path || cloudPath;
          item.mime = file.contentType;
          item.bytes = file.buffer.length;
          item.requires_upload = false;
          if (resolvedBasename !== basename) {
            item.recovered_source_path = path.relative(resolvedJobDir, resolvedFile).replace(/\\/g, '/');
          }
          resolve();
        });
      });

      const rewrite = (value, insideEvidence = false) => {
        if (typeof value === 'string') return insideEvidence ? value : (replacements.get(value) || value);
        if (Array.isArray(value)) return value.map(item => rewrite(item, insideEvidence));
        if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) {
            if (key === 'source_evidence' || key === 'source_path' || key === 'source_context') continue;
            value[key] = rewrite(child, insideEvidence);
          }
        }
        return value;
      };

      return pending.reduce((promise, item) => promise.then(() => uploadOne(item)), Promise.resolve())
        .then(() => rewrite(drafts));
    }

    const uploadStatePath = path.join(jobOutputDir, 'draft_upload_state.json');
    const rawMarkdownPreview = utf8Prefix(sourceMarkdown, RAW_MARKDOWN_PREVIEW_BYTES);
    const createBasePayload = {
      draft_action: 'create',
      admin_secret: adminSecret,
      source: 'ocr',
      paper_name: paperName,
      paper_id: paperId,
      raw_markdown: rawMarkdownPreview,
      raw_markdown_truncated: Buffer.byteLength(sourceMarkdown, 'utf8') > Buffer.byteLength(rawMarkdownPreview, 'utf8'),
      source_task_id: jobId,
    };

    function readUploadState() {
      try {
        return fs.existsSync(uploadStatePath)
          ? JSON.parse(fs.readFileSync(uploadStatePath, 'utf8'))
          : null;
      } catch (_) {
        return null;
      }
    }

    function writeUploadState(value) {
      fs.writeFileSync(uploadStatePath, JSON.stringify(value, null, 2), 'utf8');
    }

    function createDraft(batch) {
      return new Promise((resolve, reject) => {
        requestAdmin('draft', {
          ...createBasePayload,
          package: packageForBatch(batch, true),
        }, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        }, adminEndpoint);
      });
    }

    function appendBatch(draftId, batch, metadata = null, includeSolutions = true) {
      return new Promise((resolve, reject) => {
        const batchPackage = packageForBatch(batch, false);
        requestAdmin('draft', {
          draft_action: 'append',
          admin_secret: adminSecret,
          draft_id: draftId,
          questions: batchPackage.questions,
          solutions: includeSolutions ? batchPackage.solutions : [],
          groups: metadata ? metadata.groups : [],
          media: metadata ? metadata.media : [],
        }, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        }, adminEndpoint);
      });
    }

    (async () => {
      let draftId;
      let counts;
      let questionBatches = [];
      let metadataBatches = [];
      try {
        const previousState = readUploadState();
        if (previousState && previousState.completed === true && previousState.draft_id) {
          send(res, 200, JSON.stringify({
            code: 0,
            draft_id: previousState.draft_id,
            counts: previousState.counts || { total: questions.length, approved: 0, rejected: 0, pending: questions.length },
            batch_count: previousState.batch_count || 0,
            resumed: true,
            message: '该 OCR 任务已经存入草稿箱',
          }, null, 2), 'application/json; charset=utf-8');
          return;
        }

        await uploadPendingMedia();
        questionBatches = buildQuestionBatches(createBasePayload);
        if (!questionBatches.length) throw new Error('没有可上传的题目批次');

        const resumableState = readUploadState();
        if (resumableState && resumableState.draft_id) {
          draftId = resumableState.draft_id;
          counts = resumableState.counts;
        } else {
          const createRes = await createDraft(questionBatches[0]);
          draftId = createRes.draft_id;
          counts = createRes.counts;
          writeUploadState({ draft_id: draftId, counts, completed: false, phase: 'questions', batch_index: 0 });
        }

        const startQuestionBatch = resumableState && resumableState.draft_id ? 0 : 1;
        for (let i = startQuestionBatch; i < questionBatches.length; i += 1) {
          const appendRes = await appendBatch(draftId, questionBatches[i]);
          counts = appendRes.counts;
          writeUploadState({ draft_id: draftId, counts, completed: false, phase: 'questions', batch_index: i });
        }

        // Existing cloud code requires at least one question on every append.
        // Re-use the smallest question as an idempotent carrier while groups and
        // media metadata are merged by their own IDs.
        const carrierQuestion = questions
          .slice()
          .sort((a, b) => Buffer.byteLength(JSON.stringify(a), 'utf8') - Buffer.byteLength(JSON.stringify(b), 'utf8'))[0];
        metadataBatches = buildMetadataBatches(carrierQuestion, adminSecret, draftId);
        for (let i = 0; i < metadataBatches.length; i += 1) {
          const appendRes = await appendBatch(draftId, [carrierQuestion], metadataBatches[i], false);
          counts = appendRes.counts;
          writeUploadState({ draft_id: draftId, counts, completed: false, phase: 'metadata', batch_index: i });
        }
        writeUploadState({
          draft_id: draftId,
          counts,
          completed: true,
          batch_count: questionBatches.length + metadataBatches.length,
        });
      } catch (e) {
        const partial = readUploadState();
        const suffix = partial && partial.draft_id
          ? `（已保留草稿 ${partial.draft_id} 的进度，直接重试即可续传）`
          : '';
        send(res, 500, JSON.stringify({
          code: 500,
          draft_id: partial && partial.draft_id || null,
          message: '写入草稿箱失败: ' + e.message + suffix,
        }), 'application/json; charset=utf-8');
        return;
      }
      send(res, 200, JSON.stringify({
        code: 0,
        draft_id: draftId,
        counts: counts || { total: questions.length, approved: 0, rejected: 0, pending: questions.length },
        batch_count: questionBatches.length + metadataBatches.length,
        message: '草稿已创建，请到草稿箱审核',
      }, null, 2), 'application/json; charset=utf-8');
    })();
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
      const markdown = typeof payload.markdown === 'string' && payload.markdown.trim()
        ? payload.markdown
        : fs.readFileSync(mdFile, 'utf8');
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
  if (req.url.startsWith('/api/worker-health')) {
    serveWorkerHealth(req, res);
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
  if (req.url.startsWith('/api/ocr-evidence-image')) {
    serveOcrEvidenceImage(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-structure')) {
    ocrStructure(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-to-bank')) {
    ocrToBank(req, res);
    return;
  }
  if (req.url.startsWith('/api/ocr-save-draft')) {
    ocrSaveDraft(req, res);
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
  console.log(`MinerU: ${MINERU_COMMAND} (backend: ${MINERU_BACKEND})`);
  console.log(`OCR tool: ${UNLIMITED_OCR_HOME}`);
  // 启动常驻 mineru-api，供 OCR 任务复用（避免 CLI 临时服务不稳定）
  if (MINERU_API_AUTOSTART) startMineruApiServer();
  else console.log('[MinerU] 已按 MINERU_API_AUTOSTART=0 跳过常驻 API 启动。');
});

function shutdownMineruApi() {
  if (mineruApiProcess && !mineruApiProcess.killed) {
    try { mineruApiProcess.kill('SIGTERM'); } catch (e) { /* ignore */ }
    mineruApiProcess = null;
  }
}
process.on('SIGINT', () => { shutdownMineruApi(); process.exit(0); });
process.on('SIGTERM', () => { shutdownMineruApi(); process.exit(0); });
