// api/vip.ts — VIP 订阅方案 API

import { callCloudFunction } from './base';

/** 获取 VIP 订阅方案列表 */
export async function getVipPlans() {
  return callCloudFunction('vip', { action: 'get_plans' });
}

/** 查询当前用户 VIP 状态 */
export async function getVipStatus() {
  return callCloudFunction('vip', { action: 'get_status' });
}
