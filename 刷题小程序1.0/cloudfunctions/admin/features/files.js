'use strict';

const { ValidationError } = require('../lib/errors');

// 文件解析：将 cloud:// 文件 ID 解析为可在浏览器直接访问的临时 HTTPS 地址。
// 管理台运行在浏览器中，无法直接使用 cloud:// 协议，必须经云端换取临时 URL。
module.exports = function createFileFeature({ cloud, ok }) {
  async function getTempUrl(event) {
    const fileList = Array.isArray(event.file_list) ? event.file_list : [];
    const urls = {};
    const cloudIds = [];
    for (const item of fileList) {
      const id = String(item || '').trim();
      if (!id) continue;
      // 已经是 http(s) 或本地路径的，原样返回，无需解析。
      if (/^(?:https?:\/\/|data:)/i.test(id)) {
        urls[id] = id;
      } else if (/^cloud:\/\//i.test(id)) {
        cloudIds.push(id);
      } else {
        urls[id] = id;
      }
    }

    if (cloudIds.length) {
      try {
        const res = await cloud.getTempFileURL({ fileList: cloudIds });
        const list = (res && res.fileList) || [];
        for (const file of list) {
          if (file && file.fileID) {
            urls[file.fileID] = file.tempFileURL || file.download_url || '';
          }
        }
      } catch (err) {
        // 解析失败不阻断审核流程；前端会显示占位并允许重试。
        console.error('getTempFileURL failed', err);
      }
    }
    return ok({ urls }, `已解析 ${Object.keys(urls).length} 个文件`);
  }

  async function deleteImportTemp(event) {
    const requested = Array.isArray(event.file_list) ? event.file_list.slice(0, 10) : [];
    const fileList = requested.map(item => String(item || '').trim()).filter(Boolean);
    if (!fileList.length) return ok({ deleted: 0, file_list: [] }, '没有需要清理的临时文件');
    const invalid = fileList.filter(id => (
      !/^cloud:\/\/[^/]+\/import-tasks\/[\w./-]+\.pdf$/i.test(id)
      || id.includes('..')
    ));
    if (invalid.length) {
      throw new ValidationError('临时文件路径不合法', invalid.map((id, index) => ({
        path: `file_list.${index}`,
        message: `只允许删除 import-tasks 目录下的临时 PDF：${id.slice(0, 120)}`,
      })));
    }
    await cloud.deleteFile({ fileList });
    return ok({ deleted: fileList.length, file_list: fileList }, `已清理 ${fileList.length} 个临时文件`);
  }

  return { getTempUrl, deleteImportTemp };
};
