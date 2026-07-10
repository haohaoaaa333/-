// 云函数: vip
// VIP 订阅方案查询
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action } = event;

  try {
    switch (action) {
      case 'get_plans':
        return await getPlans(openid);
      default:
        return { code: 400, message: `未知 action: ${action}` };
    }
  } catch (err) {
    return { code: 500, message: err.message };
  }
};

// 获取 VIP 订阅方案（含用户当前订阅状态）
async function getPlans(openid) {
  // 获取订阅方案
  const plansRes = await db.collection('vip_plans')
    .orderBy('sort', 'asc')
    .get();

  // 获取用户 VIP 状态
  const userRes = await db.collection('users')
    .where({ _openid: openid })
    .field({ vip_type: true, vip_expire_at: true })
    .get();

  let userVip = { vip_type: 0, vip_expire_at: null };
  if (userRes.data.length > 0) {
    userVip = userRes.data[0];
  }

  // 判断 VIP 是否过期
  const now = new Date();
  const isVipActive = userVip.vip_type > 0
    && userVip.vip_expire_at
    && new Date(userVip.vip_expire_at) > now;

  const plans = plansRes.data.map(p => ({
    plan_id: p._id,
    name: p.name,
    duration_days: p.duration_days,
    price: p.price,
    original_price: p.original_price,
    features: p.features,
    tag: p.tag,
    sort: p.sort,
  }));

  return {
    code: 0,
    data: {
      plans,
      current_vip: {
        type: isVipActive ? userVip.vip_type : 0,
        expire_at: userVip.vip_expire_at,
        is_active: isVipActive,
      },
    },
    message: 'ok',
  };
}
