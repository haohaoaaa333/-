// api/course.ts — 课程 / 分类 API

import { callCloudFunction } from './base';

/** 获取全部课程分类（含子模块） */
export async function getCategories() {
  return callCloudFunction('course', { action: 'categories' });
}

/** 获取指定分类下的模块列表 */
export async function getModules(categoryId: string) {
  return callCloudFunction('course', { action: 'modules', categoryId });
}
