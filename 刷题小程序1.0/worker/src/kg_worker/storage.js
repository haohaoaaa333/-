'use strict';

// 云存储适配器。Worker 通过它下载任务 PDF、上传 MinerU 产物（图片 / markdown / layout）。
// 两种后端：
//   tcb   —— 腾讯云 CloudBase Node SDK（@cloudbase/node-sdk），需 TCB_* 凭证。生产环境。
//   local —— 本地镜像目录，把 cloud:// 文件映射到本地路径。离线测试 / 无云环境使用。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function basenameOf(fileID) {
  const cleaned = String(fileID).split('?')[0];
  return path.basename(cleaned.replace(/\\/g, '/'));
}

// ── local 后端 ───────────────────────────────────────────────
const localBackend = {
  name: 'local',
  async downloadFile(fileID, destLocalPath) {
    let source;
    const raw = String(fileID).trim();
    if (/^(?:file:\/\/|\/|[A-Za-z]:\\)/i.test(raw) && !raw.startsWith('cloud://')) {
      source = raw.replace(/^file:\/\//i, '');
    } else {
      const base = basenameOf(raw);
      const candidates = [
        path.join(config.cloudMirrorDir, base),
        path.join(config.cloudMirrorDir, sha256File ? `${crypto.createHash('sha256').update(raw).digest('hex')}.bin` : base),
      ];
      source = candidates.find(c => fs.existsSync(c));
    }
    if (!source || !fs.existsSync(source)) {
      throw new Error(`local 存储后端找不到文件：${fileID}（请把它放到 ${config.cloudMirrorDir}）`);
    }
    fs.mkdirSync(path.dirname(destLocalPath), { recursive: true });
    fs.copyFileSync(source, destLocalPath);
    return destLocalPath;
  },
  async uploadFile(localPath, cloudPath) {
    fs.mkdirSync(config.cloudMirrorDir, { recursive: true });
    const name = cloudPath ? basenameOf(cloudPath) : path.basename(localPath);
    const dest = path.join(config.cloudMirrorDir, name);
    fs.copyFileSync(localPath, dest);
    return `cloud://mirror/${name}`;
  },
  async uploadDir(localDir, { prefix = 'assets' } = {}) {
    const map = {};
    if (!fs.existsSync(localDir)) return map;
    for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = path.join(localDir, entry.name);
      const fileID = await this.uploadFile(full, `${prefix}/${entry.name}`);
      map[entry.name] = fileID;
    }
    return map;
  },
};

// ── tcb 后端（懒加载，避免无凭证时启动报错） ────────────────
function createTcbBackend() {
  let app;
  function getApp() {
    if (app) return app;
    let tcb;
    try {
      // eslint-disable-next-line global-require
      tcb = require('@cloudbase/node-sdk');
    } catch (err) {
      throw new Error('未安装 @cloudbase/node-sdk，请先 `npm i @cloudbase/node-sdk` 或把 WORKER_STORAGE_BACKEND 设为 local');
    }
    app = tcb.init({
      secretId: config.tcbSecretId,
      secretKey: config.tcbSecretKey,
      env: config.tcbEnv,
      envType: config.tcbEnvType,
      timeout: 60000,
    });
    return app;
  }
  function storage() {
    return getApp().storage();
  }
  return {
    name: 'tcb',
    async downloadFile(fileID, destLocalPath) {
      fs.mkdirSync(path.dirname(destLocalPath), { recursive: true });
      const res = await storage().downloadFile({ fileID, tempFilePath: destLocalPath });
      if (res && res.fileContent && !fs.existsSync(destLocalPath)) {
        fs.writeFileSync(destLocalPath, res.fileContent);
      }
      if (!fs.existsSync(destLocalPath)) throw new Error(`TCB 下载失败：${fileID}`);
      return destLocalPath;
    },
    async uploadFile(localPath, cloudPath) {
      const ext = path.extname(localPath).toLowerCase().replace(/^\./, '') || 'bin';
      const base = cloudPath || `import-tasks/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const content = fs.readFileSync(localPath);
      const res = await storage().uploadFile({ cloudPath: base, fileContent: content });
      return res.fileID;
    },
    async uploadDir(localDir, { prefix = 'assets' } = {}) {
      const map = {};
      if (!fs.existsSync(localDir)) return map;
      for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const full = path.join(localDir, entry.name);
        const fileID = await this.uploadFile(full, `${prefix}/${entry.name}`);
        map[entry.name] = fileID;
      }
      return map;
    },
  };
}

function createStorage() {
  if (config.storageBackend === 'local') {
    fs.mkdirSync(config.cloudMirrorDir, { recursive: true });
    return localBackend;
  }
  return createTcbBackend();
}

module.exports = { createStorage, sha256File, basenameOf, localBackend };
