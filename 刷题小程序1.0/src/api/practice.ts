// api/practice.ts — 练习 / 答题 API

import { callCloudFunction } from './base';

export interface AnswerItem {
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  duration: number;
}

/** 提交单题答案 */
export async function submitAnswer(data: AnswerItem) {
  return callCloudFunction('practice', { action: 'submit_answer', ...data });
}

/** 提交整组练习结果并获取报告 */
export async function submitPracticeResult(data: {
  moduleId: string;
  moduleName: string;
  answers: AnswerItem[];
  totalDuration: number;
}) {
  return callCloudFunction('practice', { action: 'submit_batch', ...data });
}

/** 获取练习报告 */
export async function getPracticeReport(reportId: string) {
  return callCloudFunction('practice', { action: 'get_report', reportId });
}
