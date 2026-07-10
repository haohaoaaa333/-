// 云函数: paymentCallback
// 微信支付异步回调 — CloudBase 自动调用此函数通知支付结果
// 注意：此函数由 CloudBase 托管平台在支付成功后自动触发，非客户端直接调用

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// VIP 方案配置
const VIP_PLANS = {
  plan_monthly:  { days: 30,  price: 9.9  },
  plan_quarterly:{ days: 90,  price: 19.9 },
  plan_yearly:   { days: 365, price: 59.9 },
};

exports.main = async (event, context) => {
  const { outTradeNo, transactionId, resultCode } = event;

  console.log(`[paymentCallback] 收到回调: outTradeNo=${outTradeNo}, transactionId=${transactionId}, resultCode=${resultCode}`);

  if (resultCode !== 'SUCCESS') {
    console.warn(`[paymentCallback] 支付未成功: ${resultCode}`);
    return { code: 1, message: 'payment not success' };
  }

  try {
    // 查找订单
    const orderRes = await db.collection('payments')
      .where({ order_no: outTradeNo })
      .get();

    if (orderRes.data.length === 0) {
      console.error(`[paymentCallback] 订单不存在: ${outTradeNo}`);
      return { code: 404, message: 'order not found' };
    }

    const order = orderRes.data[0];

    // 防重复处理
    if (order.status === 'paid') {
      console.log(`[paymentCallback] 订单已处理: ${outTradeNo}`);
      return { code: 0, message: 'already processed' };
    }

    // 更新订单状态
    await db.collection('payments')
      .where({ order_no: outTradeNo })
      .update({
        data: {
          status: 'paid',
          transaction_id: transactionId || '',
          paid_at: new Date(),
        },
      });

    // 更新用户 VIP
    const plan = VIP_PLANS[order.plan_id];
    if (plan) {
      const now = new Date();
      const expireAt = new Date(now.getTime() + plan.days * 24 * 3600 * 1000);

      await db.collection('users')
        .where({ _openid: order._openid })
        .update({
          data: {
            vip_type: 1,
            vip_start_at: now,
            vip_expire_at: expireAt,
          },
        });

      console.log(`[paymentCallback] VIP已开通: openid=${order._openid}, plan=${order.plan_id}, expire=${expireAt.toISOString()}`);
    }

    return { code: 0, message: 'ok' };
  } catch (err) {
    console.error(`[paymentCallback] 处理失败:`, err);
    return { code: 500, message: err.message };
  }
};
