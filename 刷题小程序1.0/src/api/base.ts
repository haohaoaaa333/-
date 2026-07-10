// api/base.ts — 云函数调用封装
// 安全地访问 cloud 实例，避免 Webpack 编译时解析报错

import Taro from '@tarojs/taro';

/** 安全获取 cloud 实例（与 services/cloudbase.ts 保持一致的 fallback 逻辑） */
function getCloud(): any {
  const taroCloud = (Taro as any).cloud;
  if (taroCloud && typeof taroCloud.callFunction === 'function') return taroCloud;
  // @ts-ignore
  if (typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.callFunction === 'function') return wx.cloud;
  return null;
}

/**
 * 通用云函数调用
 * @param name 云函数名称
 * @param data 传入参数
 * @returns 成功返回 result.data，失败返回 null
 */
export async function callCloudFunction(name: string, data: Record<string, any> = {}): Promise<any | null> {
  const cloud = getCloud();
  if (!cloud) {
    // 游客模式下 cloud 不可用是预期行为，用 debug 级别避免控制台噪音
    console.debug(`[API] 云开发不可用，跳过云函数 ${name}`);
    return null;
  }
  try {
    const res = await cloud.callFunction({ name, data });
    const result = res.result as any;
    if (result && result.code === 0) return result.data;
    if (result === undefined || result === null) return null;
    // 部分云函数不遵循 {code, data} 格式，直接返回结果
    if (typeof result === 'object' && !('code' in result)) return result;
    console.warn(`[API] ${name} 返回异常:`, result?.message || result);
    return null;
  } catch (err: any) {
    // 游客模式下云函数调用失败是预期行为，用 debug 级别避免控制台红色噪音
    // 如果真机上也持续失败，检查云函数是否已部署
    const msg = err?.errMsg || err?.message || String(err);
    console.debug(`[API] ${name}: ${msg}`);
    return null;
  }
}

/**
 * 快捷调用（无参数或简单参数场景）
 */
export async function quickCall(name: string): Promise<any | null> {
  return callCloudFunction(name, {});
}
