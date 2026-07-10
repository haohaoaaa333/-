// cloudfunctions/bookPacks/index.js
// 图书礼包 - 小程序端读取接口
// 提供：get_packs（列出已上架礼包）、get_pack_detail（单条详情）
// 下载链路由小程序侧完成：file_id → wx.cloud.getTempFileURL → wx.downloadFile → wx.openDocument

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const COLLECTION = 'book_packs';

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION);
  } catch (err) {
    // 集合已存在则忽略
    const msg = String((err && err.message) || '');
    if (/collection\s+already\s+exists|DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS|Db\s+or\s+Table\s+already\s+exist|Table\s+exist/i.test(msg)) {
      return;
    }
    if (err && err.errCode && /DATABASE_COLLECTION_ALREADY?_EXIST|DATABASE_COLLECTION_EXISTS/i.test(err.errCode)) return;
    throw err;
  }
}

// 返回给小程序的安全字段（不含内部管理字段）
const PUBLIC_FIELDS = {
  _id: true,
  title: true,
  description: true,
  category: true,
  file_type: true,
  file_id: true,
  file_name: true,
  file_size: true,
  sort: true,
  cover_url: true,
  updated_at: true,
};

function ok(data, message = 'ok') {
  return { code: 0, data, message };
}

function fail(code, message, extra) {
  return { code, message, ...(extra ? { extra } : {}) };
}

async function getPacks() {
  await ensureCollection();
  const res = await db
    .collection(COLLECTION)
    .where({ status: 'enabled' })
    .field(PUBLIC_FIELDS)
    .orderBy('sort', 'asc')
    .orderBy('updated_at', 'desc')
    .limit(100)
    .get();
  return ok({ list: res.data, total: res.data.length });
}

async function getPackDetail(event) {
  await ensureCollection();
  const id = event.pack_id || event._id;
  if (!id) return fail(400, 'pack_id is required');
  const res = await db.collection(COLLECTION).doc(id).get();
  if (!res.data) return fail(404, 'book pack not found');
  return ok({ pack: res.data });
}

exports.main = async (event = {}) => {
  const action = event.action || 'get_packs';
  try {
    switch (action) {
      case 'get_packs':
        return ok((await getPacks()).data);
      case 'get_pack_detail':
        return await getPackDetail(event);
      default:
        return fail(400, `unknown action: ${action}`);
    }
  } catch (err) {
    return fail(500, err.message);
  }
};
