// api/user.ts — 用户信息 & 学习统计 API

import { callCloudFunction } from './base';

/** 获取用户个人信息 */
export async function getProfile() {
  return callCloudFunction('user', { action: 'profile' });
}

/** 获取学习统计数据 */
export async function getStatistics() {
  return callCloudFunction('user', { action: 'statistics' });
}

/** 获取每日目标 */
export async function getDailyGoal() {
  return callCloudFunction('user', { action: 'daily_goal' });
}

/** 每日签到 */
export async function checkIn() {
  return callCloudFunction('user', { action: 'check_in' });
}

/** 更新用户昵称 */
export async function updateProfile(data: { nickName?: string; avatarUrl?: string }) {
  return callCloudFunction('user', { action: 'update_profile', ...data });
}
