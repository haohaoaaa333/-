// api/payment.ts — 支付流程 API
// 统一下单 → 调起微信支付 → 确认支付 → 查询订单

import Taro from '@tarojs/taro';
import { callCloudFunction } from './base';

export interface CreateOrderResult {
  order_no: string;
  plan_name: string;
  amount: number;
  payment: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: string;
    paySign: string;
  };
}

export interface ConfirmPaymentResult {
  paid: boolean;
  order_no: string;
  vip_expire_at?: string;
  trade_state?: string;
}

/**
 * 创建支付订单
 * @param planId - VIP 方案 ID (plan_monthly / plan_quarterly / plan_yearly)
 */
export async function createPaymentOrder(planId: string): Promise<CreateOrderResult | null> {
  return callCloudFunction('payment', { action: 'create_order', plan_id: planId });
}

/**
 * 调起微信支付（封装 wx.requestPayment 为 Promise）
 */
export async function requestWechatPayment(payment: CreateOrderResult['payment']): Promise<boolean> {
  return new Promise((resolve) => {
    Taro.requestPayment({
      timeStamp: payment.timeStamp,
      nonceStr: payment.nonceStr,
      package: payment.package,
      signType: payment.signType as 'RSA' | 'MD5',
      paySign: payment.paySign,
      success: () => {
        resolve(true);
      },
      fail: (err) => {
        if (err.errMsg?.includes('cancel')) {
          console.log('[支付] 用户取消支付');
        } else {
          console.warn('[支付] 支付失败:', err.errMsg);
        }
        resolve(false);
      },
    });
  });
}

/**
 * 确认支付结果（客户端支付成功后调服务端验证）
 * @param orderNo - 订单号
 */
export async function confirmPayment(orderNo: string): Promise<ConfirmPaymentResult | null> {
  return callCloudFunction('payment', { action: 'confirm_payment', order_no: orderNo });
}

/**
 * 查询订单状态
 * @param orderNo - 订单号
 */
export async function queryPaymentOrder(orderNo: string): Promise<any> {
  return callCloudFunction('payment', { action: 'query_order', order_no: orderNo });
}

/**
 * 完整支付流程：下单 → 支付 → 确认
 * @param planId - VIP 方案 ID
 * @returns { success, message }
 */
export async function payForVip(planId: string): Promise<{ success: boolean; message: string }> {
  // Step 1: 创建订单
  const order = await createPaymentOrder(planId);
  if (!order) {
    return { success: false, message: '创建订单失败，请稍后重试' };
  }

  // Step 2: 调起微信支付
  const paid = await requestWechatPayment(order.payment);
  if (!paid) {
    return { success: false, message: '支付未完成' };
  }

  // Step 3: 确认支付结果
  const confirmed = await confirmPayment(order.order_no);
  if (confirmed && confirmed.paid) {
    return {
      success: true,
      message: `恭喜！成功开通 ${order.plan_name}`,
    };
  }

  // 确认失败了但微信支付已扣款 — 告知用户稍后自动同步
  return {
    success: true,
    message: '支付成功！VIP 权限稍后自动开通，刷新页面即可',
  };
}
