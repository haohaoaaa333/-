// api/questions.ts — 题目 API

import { callCloudFunction } from './base';

/** 获取单个题目详情 */
export async function getQuestionDetail(questionId: string) {
  return callCloudFunction('questions', { action: 'get_detail', questionId });
}

/** 按模块获取题目列表 */
export async function getQuestionsByModule(moduleId: string, page = 1, pageSize = 20) {
  return callCloudFunction('questions', { action: 'get_by_module', moduleId, page, pageSize });
}

/** 按条件搜索题目 */
export async function searchQuestions(keyword: string, page = 1, pageSize = 20) {
  return callCloudFunction('questions', { action: 'search', keyword, page, pageSize });
}

/**
 * 获取练习用题目（按 module_id + 可选 year 筛选）
 * @param moduleId 模块 ID，如 mod_language，不传则查询全部模块
 * @param year 可选年份，如 2023
 * @param limit 最多返回题数，默认 20
 */
export async function getQuestionsForPractice(moduleId?: string, year?: number, limit = 20) {
  return callCloudFunction('questions', {
    action: 'get_for_practice',
    module_id: moduleId || null,
    year: year || 0,
    limit,
  });
}

/**
 * 获取各模块题目数量（按年份筛选）
 * @param year 可选年份，不传则返回全部
 */
export async function getModuleCounts(year?: number) {
  return callCloudFunction('questions', { action: 'get_module_counts', year: year || 0 });
}
export interface CloudQuestion {
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
}

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

export function cloudQuestionToPage(q: CloudQuestion) {
  const options = Array.isArray(q.options) ? q.options : [];
  return {
    id: q.question_id,
    type: 'single' as const,
    points: 1,
    stem: q.content,
    material: q.material || '',
    materialImages: Array.isArray(q.material_images) ? q.material_images : [],
    stemImages: Array.isArray(q.stem_images) ? q.stem_images : [],
    options,
    optionTexts: options,
    optionImages: Array.isArray(q.option_images) ? q.option_images : [],
    correctOption: normalizeAnswerIndex(q.answer),
    analysis: q.explanation,
    analysisImages: Array.isArray(q.explanation_images) ? q.explanation_images : [],
    commonErrors: '',
    category: q.module_id,
    difficulty: (q.difficulty === '简单' ? '简单' : q.difficulty === '困难' ? '困难' : '中等') as '简单' | '中等' | '困难',
    year: q.year,
    userAnswer: undefined,
    isSubmitted: false,
    isFavorite: false,
    isWrongBook: false,
  };
}
