// api/learning.ts — 学习仪表盘 API

import { callCloudFunction } from './base';

/** 获取学习仪表盘概览数据 */
export async function getDashboard() {
  return callCloudFunction('learning', { action: 'dashboard' });
}

/** 获取最近学习记录 */
export async function getRecentRecords(limit = 7) {
  return callCloudFunction('learning', { action: 'recent', limit });
}
