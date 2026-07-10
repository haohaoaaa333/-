// api/index.ts — 统一导出

export { callCloudFunction, quickCall } from './base';
export {
  getProfile,
  getStatistics,
  getDailyGoal,
  checkIn,
  updateProfile,
} from './user';
export { getVipPlans, getVipStatus } from './vip';
export { getCategories, getModules } from './course';
export { getDashboard, getRecentRecords } from './learning';
export {
  getQuestionDetail,
  getQuestionsByModule,
  searchQuestions,
} from './questions';
export {
  submitAnswer,
  submitPracticeResult,
  getPracticeReport,
} from './practice';
export { seedAll, seedVipPlans, seedCategories, seedBanners, seedQuestions } from './seed';
export { getHomeData } from './home';
export type { HomeBanner, HomeStats, HomeCategory, HomeData } from './home';
export {
  createPaymentOrder,
  requestWechatPayment,
  confirmPayment,
  queryPaymentOrder,
  payForVip,
} from './payment';
export type { CreateOrderResult, ConfirmPaymentResult } from './payment';
