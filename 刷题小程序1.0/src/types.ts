export type Tab = 'home' | 'study' | 'practice' | 'profile';

export type Category = 'civil' | 'teacher';

export interface Question {
  id: number | string;
  type: 'single' | 'multiple';
  points: number;
  stem: string;
  material?: string;
  materialImages?: string[];
  stemImages?: string[];
  options: string[];
  optionTexts: string[];
  optionImages?: string[][];
  correctOption: number;
  analysis: string;
  analysisImages?: string[];
  commonErrors: string;
  category: string;
  difficulty: '简单' | '中等' | '困难';
  year?: number;
  userAnswer?: number;
  isSubmitted?: boolean;
  isFavorite?: boolean;
  isWrongBook?: boolean;
}

export interface SubCategory {
  id: string;
  name: string;
  desc: string;
  completed: number;
  total: number;
  percentage: number;
  icon: string;
  category: Category;
  locked?: boolean;
}

export interface CarouselItem {
  id: number;
  badge: string;
  title: string;
  desc: string;
  image: string;
  colorFrom: string;
  colorTo: string;
}

export interface UserStats {
  todayDone: number;
  todayGoal: number;
  accuracyRate: number;
  streakDays: number;
  totalDone: number;
  avgAccuracy: number;
  studyId: string;
  avatarUrl: string;
  userName: string;
  vipStatus: '标准会员' | 'VIP 专属';
}
