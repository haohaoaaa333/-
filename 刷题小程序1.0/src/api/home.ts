// api/home.ts — 首页数据 API
// 聚合 banners + 学习概览 + 分类

import { callCloudFunction } from './base';

export interface HomeBanner {
  id: string;
  badge: string;
  title: string;
  desc: string;
  color: string;
}

export interface HomeStats {
  today_done: number;
  today_goal: number;
  accuracy_rate: number;
  streak_days: number;
  total_done: number;
  focus_minutes: number;
}

export interface HomeCategory {
  category_id: string;
  name: string;
  icon: string;
  sort: number;
  module_count: number;
  total_questions: number;
}

export interface HomeData {
  banners: HomeBanner[];
  stats: HomeStats;
  categories: HomeCategory[];
}

/** 获取首页聚合数据 */
export async function getHomeData(): Promise<HomeData | null> {
  return callCloudFunction('home', {});
}
