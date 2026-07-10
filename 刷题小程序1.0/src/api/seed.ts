// api/seed.ts — 种子数据初始化 API（调用 seed 云函数）

import { callCloudFunction } from './base';

/** 一键导入全部种子数据（VIP方案 + 分类 + Banner + 题目） */
export async function seedAll() {
  return callCloudFunction('seed', { action: 'all' });
}

/** 仅导入 VIP 方案 */
export async function seedVipPlans() {
  return callCloudFunction('seed', { action: 'vip_plans' });
}

/** 仅导入分类数据 */
export async function seedCategories() {
  return callCloudFunction('seed', { action: 'categories' });
}

/** 仅导入 Banner */
export async function seedBanners() {
  return callCloudFunction('seed', { action: 'banners' });
}

/** 仅导入题目 */
export async function seedQuestions() {
  return callCloudFunction('seed', { action: 'questions' });
}
