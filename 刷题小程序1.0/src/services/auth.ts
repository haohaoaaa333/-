// services/auth.ts — 微信登录 & 用户会话管理
// 注意：不引入 src/api/base.ts，避免 Webpack 编译时 resolve cloud 引用的兼容问题

import Taro from '@tarojs/taro';
import { canUsePersonalCloudData } from '../utils/privacy';

const STORAGE_KEY = 'examprep_user';

/** 安全获取 cloud 实例 */
function getCloud(): any {
  const taroCloud = (Taro as any).cloud;
  if (taroCloud && typeof taroCloud.callFunction === 'function') return taroCloud;
  // @ts-ignore
  if (typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.callFunction === 'function') return wx.cloud;
  return null;
}

async function safeCallFunction(name: string, data: Record<string, any> = {}): Promise<any | null> {
  if (!canUsePersonalCloudData()) return null;
  const cloud = getCloud();
  if (!cloud) return null;
  try {
    const res = await cloud.callFunction({ name, data });
    const result = res.result as any;
    if (result && result.code === 0) return result.data;
    if (typeof result === 'object' && !('code' in result)) return result;
    return null;
  } catch (err) {
    console.debug(`[Auth] 云函数 ${name}: ${(err as any)?.errMsg || err}`);
    return null;
  }
}

export interface UserProfile {
  user_id: string;
  openid: string;
  nickname: string;
  avatar_url: string;
  vip_type: number;
  vip_expire_at: string | null;
  level: number;
  exp: number;
  is_checked_in_today: boolean;
}

/** 从本地缓存读取用户信息 */
export function getCachedUser(): UserProfile | null {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY);
    return raw || null;
  } catch {
    return null;
  }
}

function setCachedUser(user: UserProfile): void {
  Taro.setStorageSync(STORAGE_KEY, user);
}

export function clearUserCache(): void {
  try { Taro.removeStorageSync(STORAGE_KEY); } catch { /* ignore */ }
}

export function isLoggedIn(): boolean {
  return !!(getCachedUser()?.openid);
}

/** 登录：调 user 云函数，CloudBase 自动从上下文获取 openid */
export async function login(): Promise<UserProfile | null> {
  const profile = await safeCallFunction('user', { action: 'profile' });
  if (profile) {
    setCachedUser(profile);
    console.log('[Auth] 登录成功');
    return profile;
  }
  console.debug('[Auth] 登录未成功（可能游客模式或云环境未就绪）');
  return null;
}

/** 刷新用户信息 */
export async function refreshProfile(): Promise<UserProfile | null> {
  const profile = await safeCallFunction('user', { action: 'profile' });
  if (profile) { setCachedUser(profile); return profile; }
  return getCachedUser();
}

/** 每日签到 */
export async function dailyCheckIn(): Promise<number | null> {
  const result = await safeCallFunction('user', { action: 'check_in' });
  return result?.streak_days ?? null;
}
