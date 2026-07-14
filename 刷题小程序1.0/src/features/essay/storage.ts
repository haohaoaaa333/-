import Taro from '@tarojs/taro';
import type { EssayPaperDetail } from './types';

const DETAIL_PREFIX = 'essay_paper_detail_';
const DRAFT_PREFIX = 'essay_answer_draft_';

export function cacheEssayDetail(detail: EssayPaperDetail) {
  try { Taro.setStorageSync(`${DETAIL_PREFIX}${detail.paper._id}`, detail); } catch (_) { /* storage quota */ }
}

export function getCachedEssayDetail(paperId: string): EssayPaperDetail | null {
  try { return Taro.getStorageSync(`${DETAIL_PREFIX}${paperId}`) || null; } catch (_) { return null; }
}

export function saveEssayDraft(questionId: string, content: string) {
  try {
    Taro.setStorageSync(`${DRAFT_PREFIX}${questionId}`, { content, updated_at: Date.now() });
  } catch (_) { /* storage quota */ }
}

export function getEssayDraft(questionId: string): { content: string; updated_at: number } | null {
  try { return Taro.getStorageSync(`${DRAFT_PREFIX}${questionId}`) || null; } catch (_) { return null; }
}
