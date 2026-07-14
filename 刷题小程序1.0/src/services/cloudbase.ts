// services/cloudbase.ts — CloudBase 云开发服务层
// 封装 wx.cloud 初始化和数据库直连操作
// 云函数调用请使用 src/api/ 下的各模块

import Taro from '@tarojs/taro';
import { canUsePersonalCloudData } from '../utils/privacy';

/** CloudBase 环境 ID —— 复制自微信云开发控制台「设置-环境ID」 */
let ENV_ID = 'cloud1-d0gsr2l1ye6344917';

/** 是否已初始化 */
let initialized = false;

/** 安全获取底层 cloud 对象 */
function getCloudInstance(): any {
  const taroCloud = (Taro as any).cloud;
  if (taroCloud) return taroCloud;
  // @ts-ignore
  if (typeof wx !== 'undefined' && wx.cloud) return wx.cloud;
  return null;
}

/**
 * 在小程序启动时调用一次，初始化云开发环境
 */
export function initCloud(): void {
  if (initialized) return;
  if (!ENV_ID || ENV_ID === 'your-cloudbase-env-id') return;
  const cloud = getCloudInstance();
  if (!cloud) return;
  try {
    cloud.init({ env: ENV_ID, traceUser: true });
    initialized = true;
    console.log('[CloudBase] 云开发已初始化');
  } catch {
    // 游客模式下 init 可能失败，静默跳过
  }
}

/** 检查云开发是否可用 */
export function isCloudReady(): boolean {
  return initialized;
}

/** 获取数据库引用 */
export function getDB(): any | null {
  if (!isCloudReady()) return null;
  const cloud = getCloudInstance();
  return cloud ? cloud.database() : null;
}

// ==================== 用户统计同步（兼容旧接口） ====================

export interface CloudUserStats {
  _id?: string;
  _openid?: string;
  todayDone: number;
  todayGoal: number;
  accuracyRate: number;
  streakDays: number;
  totalDone: number;
  avgAccuracy: number;
  userName: string;
  vipStatus: string;
}

/**
 * 从云端拉取用户统计（通过 getUserStats 云函数）
 */
export async function fetchUserStats(): Promise<CloudUserStats | null> {
  if (!canUsePersonalCloudData()) return null;
  if (!isCloudReady()) return null;
  try {
    const cloud = getCloudInstance();
    if (!cloud) return null;
    const res = await cloud.callFunction({ name: 'getUserStats' });
    const result = res.result as any;
    if (result.code === 0) return result.data;
    console.warn('[CloudBase] getUserStats 返回异常:', result.message);
    return null;
  } catch (err) {
    console.error('[CloudBase] 拉取用户数据失败:', err);
    return null;
  }
}

/**
 * 推送用户统计到云端（通过 syncUserData 云函数）
 */
export async function pushUserStats(stats: Partial<CloudUserStats>): Promise<boolean> {
  if (!canUsePersonalCloudData()) return false;
  if (!isCloudReady()) return false;
  try {
    const cloud = getCloudInstance();
    if (!cloud) return false;
    const res = await cloud.callFunction({ name: 'syncUserData', data: { stats } });
    const result = res.result as any;
    return result.code === 0;
  } catch (err) {
    console.error('[CloudBase] 同步用户数据失败:', err);
    return false;
  }
}

// ==================== 答题记录 ====================

export interface PracticeRecord {
  _id?: string;
  subjectId: string;
  subjectName: string;
  totalQuestions: number;
  correctCount: number;
  accuracy: number;
  duration: number;
  completedAt: Date;
}

/**
 * 保存单次练习记录到云端
 */
export async function savePracticeRecord(record: PracticeRecord): Promise<boolean> {
  if (!canUsePersonalCloudData()) return false;
  if (!isCloudReady()) return false;
  const db = getDB();
  if (!db) return false;
  try {
    await db.collection('practice_records').add({ data: record });
    return true;
  } catch (err) {
    console.error('[CloudBase] 保存练习记录失败:', err);
    return false;
  }
}
