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
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
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
      send(res, 400, JSON.stringify({ code: 400, message: '请填写题库包文件夹或 zip 路径' }), 'application/json; charset=utf-8');
      return;
    }
    const resolvedInput = path.resolve(inputPath);
    if (!fs.existsSync(resolvedInput)) {
      send(res, 404, JSON.stringify({ code: 404, message: `路径不存在：${resolvedInput}` }), 'application/json; charset=utf-8');
      return;
    }

    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'convert_question_bank_package.py');
    const python = findPython();
    const outputDir = path.join(PROJECT_ROOT, 'admin-output');
    const assetsDir = path.join(PROJECT_ROOT, 'assets', 'question-images', 'package-bank');
    const args = [
      scriptPath,
      '--input', resolvedInput,
      '--output-dir', outputDir,
      '--assets-dir', assetsDir,
      '--public-prefix', '/assets/question-images/package-bank',
    ];
    const child = spawn(python, args, { cwd: PROJECT_ROOT, windowsHide: true });
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
        send(res, 200, stdout, 'application/json; charset=utf-8');
      } catch (parseErr) {
        send(res, 500, JSON.stringify({ code: 500, message: parseErr.message, stdout, stderr }), 'application/json; charset=utf-8');
      }
    });
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
  serveStatic(req, res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Admin console: http://127.0.0.1:${PORT}`);
  console.log(`Proxy target: ${ADMIN_ENDPOINT}`);
});
