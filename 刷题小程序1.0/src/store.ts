import { useState, useCallback } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { UserStats, Question } from './types';
import {
  INITIAL_USER_STATS, MOCK_QUESTIONS,
  getStorageStats, setStorageStats,
  getStorageQuestions, setStorageQuestions,
  getStorageTheme, setStorageTheme,
  getStorageActiveSubject, setStorageActiveSubject,
} from './data';
import { canUsePersonalCloudData } from './utils/privacy';

// ----------------------------------------------------------------
// 内联云函数调用（避免 webpack chunk 拆分导致的模块加载错误）
// ----------------------------------------------------------------

const ENV_ID = 'cloud1-d0gsr2l1ye6344917';

function ensureCloudInit(): void {
  try {
    const cloud = (Taro as any).cloud || (globalThis as any).wx?.cloud || null;
    if (cloud && ENV_ID) {
      cloud.init({ env: ENV_ID, traceUser: true });
    }
  } catch {
    // ignore
  }
}

async function pushUserStats(stats: Partial<UserStats>): Promise<boolean> {
  if (!canUsePersonalCloudData()) return false;
  ensureCloudInit();
  try {
    // @ts-ignore
    const res = await Taro.cloud.callFunction({ name: 'syncUserData', data: { stats } });
    const result = res.result as any;
    return result && result.code === 0;
  } catch (err) {
    console.error('[store] 同步用户数据失败:', err);
    return false;
  }
}

/** 云函数返回的题目结构 */
interface CloudQuestion {
  question_id: string;
  module_id: string;
  type: string;
  difficulty: string;
  content: string;
  material?: string;
  material_images?: string[];
  stem_images?: string[];
  options: string[];
  option_images?: string[][];
  answer: number | string;
  explanation: string;
  explanation_images?: string[];
  tags: string[];
  year: number;
  // 纸卷扩展字段
  paper_id?: string;
  paper_name?: string;
  province?: string;
  position?: string;
  paper_date?: string;
}

/** 通用调用 questions 云函数 */
async function callQuestions(action: string, data: Record<string, any> = {}): Promise<any | null> {
  try {
    ensureCloudInit();
    // @ts-ignore
    const res = await Taro.cloud.callFunction({
      name: 'questions',
      data: { action, ...data },
    });
    const result = res.result as any;
    if (result && result.code === 0) return result.data;
    console.warn('[store] questions 云函数返回异常:', result?.message);
    return null;
  } catch (err: any) {
    const msg = err?.errMsg || err?.message || String(err);
    console.debug('[store] 云函数调用失败:', msg);
    return null;
  }
}

/** 将云函数返回的题目转为页面 Question 类型 */
function normalizeAnswerIndex(answer: number | string | undefined): number {
  if (typeof answer === 'number' && Number.isInteger(answer)) return answer;
  if (typeof answer === 'string') {
    const trimmed = answer.trim().toUpperCase();
    if (/^[A-D]$/.test(trimmed)) return trimmed.charCodeAt(0) - 65;
    const numeric = Number(trimmed);
    if (Number.isInteger(numeric)) return numeric;
  }
  return 0;
}

function cloudToQuestion(q: CloudQuestion): Question {
  const options = Array.isArray(q.options) ? q.options : [];
  return {
    id: q.question_id,
    type: q.type === 'multiple' ? 'multiple' : 'single',
    points: 1,
    stem: q.content,
    material: q.material || '',
    materialImages: Array.isArray(q.material_images) ? q.material_images : [],
    stemImages: Array.isArray(q.stem_images) ? q.stem_images : [],
    options,
    optionTexts: options,
    optionImages: Array.isArray(q.option_images) ? q.option_images : [],
    correctOption: normalizeAnswerIndex(q.answer),
    analysis: q.explanation || '',
    analysisImages: Array.isArray(q.explanation_images) ? q.explanation_images : [],
    commonErrors: '',
    category: q.module_id,
    difficulty: (q.difficulty === '简单' ? '简单' : q.difficulty === '困难' ? '困难' : '中等') as Question['difficulty'],
    year: q.year,
  };
}

/** 调云函数 get_for_practice，拉取题目 */
async function fetchPracticeQuestions(moduleId?: string, year?: number, limit = 20): Promise<any | null> {
  return callQuestions('get_for_practice', {
    module_id: moduleId || null,
    year: year || 0,
    limit,
  });
}

// 全局 Toast
export const showToast = (msg: string) => {
  Taro.showToast({ title: msg, icon: 'none', duration: 2500 });
};

// 云端同步 — 静默执行，不影响本地操作
function syncToCloud(stats: UserStats): void {
  if (!canUsePersonalCloudData()) return;
  pushUserStats(stats).catch(() => {}); // 静默失败，不打扰用户
}

// 应用主题（背景色、导航栏颜色）
function applyTheme(isLight: boolean): void {
  Taro.setBackgroundColor({
    backgroundColor: isLight ? '#ffffff' : '#020617',
    backgroundColorBottom: isLight ? '#ffffff' : '#020617',
    backgroundColorTop: isLight ? '#ffffff' : '#020617',
  }).catch(() => {});
  Taro.setNavigationBarColor({
    frontColor: isLight ? '#000000' : '#ffffff',
    backgroundColor: isLight ? '#ffffff' : '#020617',
  }).catch(() => {});
  Taro.setTabBarStyle({
    color: isLight ? '#64748b' : '#94a3b8',
    selectedColor: '#1a56db',
    backgroundColor: isLight ? '#ffffff' : '#0f172a',
    borderStyle: isLight ? 'white' : 'black',
  }).catch(() => {}); // 非 tabBar 页（如练习页）会报错，静默忽略
}

// 应用全局状态 —— 每个 tab 页面调用此 hook
export function useAppState() {
  const [userStats, _setUserStats] = useState<UserStats>(() => getStorageStats());
  const [questions, _setQuestions] = useState<Question[]>(() => getStorageQuestions());
  const [isLightTheme, _setIsLightTheme] = useState<boolean>(() => getStorageTheme());
  const [activeSubject, _setActiveSubject] = useState<string | null>(() => getStorageActiveSubject());

  // Tab 切换时从 storage 重新同步
  useDidShow(() => {
    _setUserStats(getStorageStats());
    _setQuestions(getStorageQuestions());
    _setIsLightTheme(getStorageTheme());
    _setActiveSubject(getStorageActiveSubject());
    applyTheme(getStorageTheme());
  });

  const setUserStats = useCallback((stats: UserStats) => {
    setStorageStats(stats);
    _setUserStats(stats);
    syncToCloud(stats);
  }, []);

  const setQuestions = useCallback((qs: Question[]) => {
    setStorageQuestions(qs);
    _setQuestions(qs);
  }, []);

  const setActiveSubject = useCallback((id: string | null) => {
    setStorageActiveSubject(id);
    _setActiveSubject(id);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = !isLightTheme;
    setStorageTheme(next);
    _setIsLightTheme(next);
    applyTheme(next);
    showToast(next ? '已切换至高对比度亮色无障碍模式' : '已切换至暗黑舒适模式');
  }, [isLightTheme]);

  return {
    userStats, setUserStats,
    questions, setQuestions,
    isLightTheme, toggleTheme,
    activeSubject, setActiveSubject,
  };
}

// 重置全部数据（需要传入 setters）
export function createResetAll(setUserStats: (s: UserStats) => void, setQuestions: (q: Question[]) => void) {
  return () => {
    Taro.removeStorageSync('examprep_user_stats');
    Taro.removeStorageSync('examprep_questions_db');
    setUserStats({ ...INITIAL_USER_STATS });
    setQuestions([...MOCK_QUESTIONS]);
    showToast('所有答题进度、错题本、打卡天数及 VIP 状态已完成重置。');
  };
}

// 启动练习：生成题集
// 历年真题从云端拉取，其余类型使用本地 Mock 数据
export function createStartPractice(setQuestions: (q: Question[]) => void) {
  return async (type: 'daily' | 'history' | 'mock' | 'wrong' | 'favorite' | 'essay'): Promise<boolean> => {
    if (type === 'essay') {
      showToast('【申论范文与写作模版】包含 25 个历年真题结构模版，属于 VIP 高级资源。');
      return false;
    }
    const baseDb = getStorageQuestions();
    let filtered: Question[] = [];

    if (type === 'daily') {
      filtered = [...baseDb].sort(() => 0.5 - Math.random()).slice(0, 5);
      showToast('载入每日练题（5 题）');
    } else if (type === 'history') {
      showToast('正在加载历年真题...');
      try {
        const data = await fetchPracticeQuestions(undefined, undefined, 20);
        if (data && data.list && data.list.length > 0) {
          let cloudQuestions = data.list.map(cloudToQuestion);
          cloudQuestions = cloudQuestions.sort(() => 0.5 - Math.random());
          const reset = cloudQuestions.map(q => ({ ...q, userAnswer: undefined, isSubmitted: false }));
          setQuestions(reset);
          Taro.showToast({ title: `已加载 ${reset.length} 道历年真题 📝`, icon: 'none', duration: 2000 });
          return true;
        }
        showToast('云端暂无可用的历年真题，请稍后重试');
        return false;
      } catch (err) {
        console.error('[store] 加载历年真题失败:', err);
        showToast('加载历年真题失败，请检查网络或稍后重试');
        return false;
      }
    } else if (type === 'mock') {
      filtered = baseDb.filter(q => q.category === '言语理解与表达' || q.id === 4);
      showToast('正在部署全真模考环境，限时 30 分钟');
    } else if (type === 'wrong') {
      filtered = baseDb.filter(q => q.isWrongBook);
      if (filtered.length === 0) { showToast('错题本为空！'); return false; }
      showToast(`载入错题本练习，共 ${filtered.length} 道`);
    } else if (type === 'favorite') {
      filtered = baseDb.filter(q => q.isFavorite);
      if (filtered.length === 0) { showToast('收藏夹为空！'); return false; }
      showToast(`载入收藏练习，共 ${filtered.length} 道`);
    }
    const reset = filtered.map(q => ({ ...q, userAnswer: undefined, isSubmitted: false }));
    setQuestions(reset);
    return true;
  };
}

/**
 * 按模块从云端加载题目，并写入 questions state
 * @param moduleId 模块 ID，如 mod_language
 * @param setQuestions 设置题目数组
 * @param limit 拉取题数，默认 20
 */
export async function loadModuleQuestions(moduleId: string, setQuestions: (q: Question[]) => void, limit = 20): Promise<boolean> {
  showToast('正在加载题目...');
  try {
    const data = await fetchPracticeQuestions(moduleId, undefined, limit);
    if (data && data.list && data.list.length > 0) {
      const cloudQuestions = data.list.map(cloudToQuestion);
      const reset = cloudQuestions.map(q => ({ ...q, userAnswer: undefined, isSubmitted: false }));
      setQuestions(reset);
      Taro.showToast({ title: `已加载 ${reset.length} 道题`, icon: 'none', duration: 2000 });
      return true;
    }
    showToast('该模块暂无题目，请稍后重试');
    return false;
  } catch (err) {
    console.error('[store] 加载模块题目失败:', err);
    showToast('加载题目失败，请检查网络或稍后重试');
    return false;
  }
}

/** 试卷项结构 */
export interface PaperItem {
  paper_id: string;
  paper_name: string;
  year: number;
  province: string;
  paper_date: string;
  question_count: number;
}

/** 获取试卷列表 */
export async function fetchPapers(): Promise<PaperItem[]> {
  try {
    const data = await callQuestions('get_papers');
    if (data && data.papers) return data.papers;
    showToast('获取试卷列表失败，请检查云函数是否已部署');
    return [];
  } catch (err) {
    console.error('[store] 获取试卷列表失败:', err);
    showToast('获取试卷列表失败');
    return [];
  }
}

/**
 * 按年份从云端加载全部题目，并写入 questions state
 */
export async function loadYearQuestions(year: number, setQuestions: (q: Question[]) => void): Promise<boolean> {
  showToast(`正在加载 ${year} 年试卷...`);
  try {
    const data = await callQuestions('get_by_year', { year });
    if (data && data.list && data.list.length > 0) {
      const cloudQuestions = data.list.map(cloudToQuestion);
      const reset = cloudQuestions.map(q => ({ ...q, userAnswer: undefined, isSubmitted: false }));
      setQuestions(reset);
      Taro.showToast({ title: `已加载 ${year} 年试卷，共 ${reset.length} 道`, icon: 'none', duration: 2000 });
      return true;
    }
    showToast(`${year} 年暂无试卷，请稍后重试`);
    return false;
  } catch (err) {
    console.error('[store] 加载年份试卷失败:', err);
    showToast('加载试卷失败，请检查网络或稍后重试');
    return false;
  }
}

/**
 * 按 paper_id 加载该纸卷全部题目
 */
export async function loadPaperQuestions(paperId: string, year: number, setQuestions: (q: Question[]) => void): Promise<boolean> {
  showToast('正在加载试卷...');
  try {
    const data = await callQuestions('get_by_paper', { paper_id: paperId, year });
    if (data && data.list && data.list.length > 0) {
      const cloudQuestions = data.list.map(cloudToQuestion);
      const reset = cloudQuestions.map(q => ({ ...q, userAnswer: undefined, isSubmitted: false }));
      setQuestions(reset);
      Taro.showToast({ title: `已加载 "${data.paper_id || paperId}" 试卷，共 ${reset.length} 道`, icon: 'none', duration: 2000 });
      return true;
    }
    showToast('该试卷暂无题目');
    return false;
  } catch (err) {
    console.error('[store] 加载试卷失败:', err);
    showToast('加载试卷失败');
    return false;
  }
}
