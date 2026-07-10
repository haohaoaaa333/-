// 云函数: payment
// VIP 订阅支付 — 统一下单 + 确认支付 + 查询订单
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// VIP 方案配置（与 seed 数据保持一致）
const VIP_PLANS = {
  plan_monthly:  { name: '月度会员', days: 30,  price: 9.9  },
  plan_quarterly:{ name: '季度会员', days: 90,  price: 19.9 },
  plan_yearly:   { name: '年度会员', days: 365, price: 59.9 },
};

// 生成订单号: PAID + 时间戳 + 6位随机
function generateOrderNo() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PAY${ts}${rand}`;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action } = event;

  try {
    switch (action) {
      case 'create_order':
        return await createOrder(openid, event.plan_id);
      case 'confirm_payment':
        return await confirmPayment(openid, event.order_no);
      case 'query_order':
        return await queryOrder(openid, event.order_no);
      default:
        return { code: 400, message: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error('[payment]', err);
    return { code: 500, message: err.message || '支付服务异常' };
  }
};

/**
 * 创建支付订单
 */
async function createOrder(openid, planId) {
  const plan = VIP_PLANS[planId];
  if (!plan) return { code: 400, message: '无效的订阅方案' };

  const orderNo = generateOrderNo();
  const totalFee = Math.round(plan.price * 100); // 转为分

  // 保存订单到数据库
  await db.collection('payments').add({
    data: {
      order_no: orderNo,
      _openid: openid,
      plan_id: planId,
      plan_name: plan.name,
      amount: plan.price,
      total_fee: totalFee,
      status: 'pending',
      created_at: new Date(),
    },
  });

  // 调用 CloudBase 统一下单
  const payResult = await cloud.cloudPay.unifiedOrder({
    body: `考公宝VIP${plan.name}`,
    outTradeNo: orderNo,
    totalFee: totalFee,
    envId: cloud.DYNAMIC_CURRENT_ENV,
    functionName: 'paymentCallback',
  });

  return {
    code: 0,
    data: {
      order_no: orderNo,
      plan_name: plan.name,
      amount: plan.price,
      payment: payResult.payment, // 包含 timeStamp, nonceStr, package, signType, paySign
    },
    message: 'ok',
  };
}

/**
 * 确认支付（客户端 wx.requestPayment 成功后调用）
 */
async function confirmPayment(openid, orderNo) {
  if (!orderNo) return { code: 400, message: '缺少订单号' };

  // 查找订单
  const orderRes = await db.collection('payments')
    .where({ order_no: orderNo, _openid: openid })
    .get();
  if (orderRes.data.length === 0) {
    return { code: 404, message: '订单不存在' };
  }

  const order = orderRes.data[0];
  if (order.status === 'paid') {
    // 已经支付过，直接返回当前 VIP 状态
    return {
      code: 0,
      data: { paid: true, order_no: orderNo },
      message: '订单已支付',
    };
  }

  // 尝试查询微信支付订单状态
  try {
    const queryResult = await cloud.cloudPay.queryOrder({
      outTradeNo: orderNo,
    });

    if (queryResult.tradeState === 'SUCCESS') {
      // 支付成功，更新订单状态
      await db.collection('payments')
        .where({ order_no: orderNo })
        .update({
          data: {
            status: 'paid',
            transaction_id: queryResult.transactionId || '',
            paid_at: new Date(),
          },
        });

      // 更新用户 VIP 状态
      const plan = VIP_PLANS[order.plan_id];
      const now = new Date();
      const expireAt = new Date(now.getTime() + plan.days * 24 * 3600 * 1000);

      await db.collection('users')
        .where({ _openid: openid })
        .update({
          data: {
            vip_type: 1,
            vip_start_at: now,
            vip_expire_at: expireAt,
          },
        });

      return {
        code: 0,
        data: {
          paid: true,
          order_no: orderNo,
          vip_expire_at: expireAt.toISOString(),
        },
        message: '支付成功，VIP已开通',
      };
    }

    // 支付未完成
    return {
      code: 1,
      data: { paid: false, order_no: orderNo, trade_state: queryResult.tradeState },
      message: `支付状态: ${queryResult.tradeState}`,
    };
  } catch (queryErr) {
    // 查询支付状态失败，可能是网络问题或订单不存在
    console.warn('[payment] queryOrder failed:', queryErr.message);
    return {
      code: 2,
      data: { paid: false, order_no: orderNo },
      message: '支付状态查询失败，请稍后重试',
    };
  }
}

/**
 * 查询订单状态
 */
async function queryOrder(openid, orderNo) {
  const orderRes = await db.collection('payments')
    .where({ order_no: orderNo, _openid: openid })
    .field({ status: true, amount: true, plan_name: true, created_at: true, paid_at: true })
    .get();

  if (orderRes.data.length === 0) {
    return { code: 404, message: '订单不存在' };
  }

  return {
    code: 0,
    data: orderRes.data[0],
    message: 'ok',
  };
}
