import { callCloudFunction } from '../../api/base';
import type { EssayAnswer, EssayPaper, EssayPaperDetail } from './types';
import { demoEssayAnswers, demoEssayDetail } from './demo';

const isH5Preview = process.env.TARO_ENV === 'h5';

export async function listEssayPapers(): Promise<EssayPaper[]> {
  const data = await callCloudFunction('essay', { action: 'list' });
  if (Array.isArray(data?.papers)) return data.papers;
  return isH5Preview ? [demoEssayDetail.paper] : [];
}

export async function getEssayPaper(paperId: string): Promise<EssayPaperDetail | null> {
  if (!paperId) return null;
  const data = await callCloudFunction('essay', { action: 'detail', paper_id: paperId });
  if (!data?.paper || !Array.isArray(data.materials) || !Array.isArray(data.questions)) {
    return isH5Preview && paperId === demoEssayDetail.paper._id ? demoEssayDetail : null;
  }
  return data as EssayPaperDetail;
}

export async function getEssayAnswer(paperId: string, questionId: string): Promise<EssayAnswer | null> {
  if (!paperId || !questionId) return null;
  const data = await callCloudFunction('essay', {
    action: 'answer',
    paper_id: paperId,
    question_id: questionId,
  });
  return data?.answer || (isH5Preview ? demoEssayAnswers[questionId] || null : null);
}
