'use strict';

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

  return { getTempUrl };
};
