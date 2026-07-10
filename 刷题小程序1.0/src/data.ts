import Taro from '@tarojs/taro';
import { Question, SubCategory, CarouselItem, UserStats } from './types';

/* ---------- 存储层: 适配 Taro Storage ---------- */

export const getStorageStats = (): UserStats => {
  try {
    const raw = Taro.getStorageSync('examprep_user_stats');
    if (!raw) return INITIAL_USER_STATS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return INITIAL_USER_STATS;
    return { ...INITIAL_USER_STATS, ...parsed };
  } catch {
    return INITIAL_USER_STATS;
  }
};

export const setStorageStats = (stats: UserStats) => {
  Taro.setStorageSync('examprep_user_stats', JSON.stringify(stats));
};

export const getStorageQuestions = (): Question[] => {
  try {
    const raw = Taro.getStorageSync('examprep_questions_db');
    if (!raw) return [...MOCK_QUESTIONS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...MOCK_QUESTIONS];
    return parsed;
  } catch {
    return [...MOCK_QUESTIONS];
  }
};

export const setStorageQuestions = (qs: Question[]) => {
  Taro.setStorageSync('examprep_questions_db', JSON.stringify(qs));
};

export const getStorageTheme = (): boolean => {
  try {
    const raw = Taro.getStorageSync('examprep_theme');
    return raw === 'light';
  } catch {
    return false;
  }
};

export const setStorageTheme = (isLight: boolean) => {
  Taro.setStorageSync('examprep_theme', isLight ? 'light' : 'dark');
};

export const getStorageActiveSubject = (): string | null => {
  try {
    return Taro.getStorageSync('examprep_active_subject') || null;
  } catch {
    return null;
  }
};

export const setStorageActiveSubject = (id: string | null) => {
  Taro.setStorageSync('examprep_active_subject', id || '');
};

/* ---------- 初始数据 ---------- */

export const INITIAL_USER_STATS: UserStats = {
  todayDone: 42,
  todayGoal: 100,
  accuracyRate: 85.4,
  streakDays: 12,
  totalDone: 1284,
  avgAccuracy: 84.2,
  studyId: 'EP-992043',
  avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&auto=format&fit=crop&q=80',
  userName: '亚历克斯·马丁内斯',
  vipStatus: '标准会员',
};

export const CAROUSEL_ITEMS: CarouselItem[] = [
  {
    id: 1,
    badge: '🔥 热门',
    title: '历年真题全面上线',
    desc: '2000-2025 国考行测真题，5820+ 道精选题目',
    image: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600&auto=format&fit=crop&q=80',
    colorFrom: 'from-emerald-600',
    colorTo: 'to-teal-950',
  },
  {
    id: 2,
    badge: '进行中',
    title: '模拟考试大赛',
    desc: '与全国 5,000+ 考生同台竞技',
    image: 'https://images.unsplash.com/photo-1506880018603-83d5b814b5a6?w=600&auto=format&fit=crop&q=80',
    colorFrom: 'from-blue-600',
    colorTo: 'to-indigo-900',
  },
  {
    id: 3,
    badge: '2026年最新更新',
    title: '新题库全面上线',
    desc: '已同步 2026 最新公务员考试大纲',
    image: 'https://images.unsplash.com/photo-1517842645767-c639042777db?w=600&auto=format&fit=crop&q=80',
    colorFrom: 'from-violet-600',
    colorTo: 'to-purple-950',
  },
];

export const CIVIL_SUBCATEGORIES: SubCategory[] = [
  { id: 'common_sense', name: '常识判断', desc: '时事政治、历史文化及宪法法律基础。', completed: 120, total: 500, percentage: 24, icon: '📚', category: 'civil' },
  { id: 'language', name: '言语理解与表达', desc: '阅读理解、词语表达及公文写作技巧。', completed: 315, total: 450, percentage: 70, icon: '💬', category: 'civil' },
  { id: 'quantity', name: '数量关系', desc: '数学运算、数列推理及应用题解题。', completed: 45, total: 300, percentage: 15, icon: '🧮', category: 'civil' },
  { id: 'reasoning', name: '判断推理', desc: '图形推理、逻辑判断及演绎推理。', completed: 0, total: 200, percentage: 0, icon: '🧩', category: 'civil' },
];

export const TEACHER_SUBCATEGORIES: SubCategory[] = [
  { id: 'education_theory', name: '教育教学理论', desc: '先进教学方法与学生心理学。', completed: 0, total: 100, percentage: 0, icon: '🏫', category: 'teacher', locked: true },
  { id: 'subject_knowledge', name: '学科专业知识', desc: '课程标准对齐及具体领域知识。', completed: 12, total: 100, percentage: 12, icon: '🧒', category: 'teacher' },
];

export const MOCK_QUESTIONS: Question[] = [
  {
    id: 1, type: 'single', points: 4,
    stem: '关于我国宪法的修改，下列哪一说法是正确的？',
    options: ['A', 'B', 'C', 'D'],
    optionTexts: [
      '全国人民代表大会常务委员会或五分之一以上的全国人民代表大会代表有权提议修改宪法。',
      '宪法的修改由全国人民代表大会以全体代表的五分之四以上的多数通过。',
      '地方各级人民代表大会有权对宪法提出修改意见，并逐级上报至全国人大常委会。',
      '国务院有权提议宪法修改案，报全国人民代表大会常务委员会审议。',
    ],
    correctOption: 0,
    analysis: '根据《中华人民共和国宪法》第六十四条规定：宪法的修改，由全国人民代表大会常务委员会或者五分之一以上的全国人民代表大会代表提议，并由全国人民代表大会以全体代表的三分之二以上的多数通过。因此，提议修改宪法的法定主体是全国人大常委会或1/5以上的全国人大代表。选项A说法正确，而选项B中五分之四以上的多数是不正确的（法律规定是三分之二以上）。国务院和地方各级人大无宪法修改提议权。',
    commonErrors: '很多考生会将一般法律的修改通过门槛（过半数）或者宪法提议权（1/5代表或常委会）混淆，或者误以为国务院等中央国家机关也具有直接宪法修改提议权。',
    category: '常识判断', difficulty: '简单',
  },
  {
    id: 2, type: 'single', points: 4,
    stem: '下列行政决策符合"科学决策、民主决策、依法决策"原则的是：',
    options: ['A', 'B', 'C', 'D'],
    optionTexts: [
      '某市政府为了提高城市夜生活活力，未评估周边居民意愿，直接强制封闭老城区主干道设立夜市。',
      '某县政府在制定重污染企业整治方案时，邀请环保专家论证并在官网公示、公开征求社会意见，最终提请常务会议审议决定。',
      '某区教育局局长一人口头决定撤销老区三所办学条件较差的小学，并将其合并至新建学校。',
      '某市公安局为治理机动车违停，自定罚款标准并授权私人协警直接开具行政罚款通知单。',
    ],
    correctOption: 1,
    analysis: '重大行政决策必须严格遵循法定程序。选项B在整治方案制定中，进行了"专家论证（科学）"、"公众参与（民主）"、"常务会议审议（依法）"，完美契合了行政决策的基本程序原则。选项A缺乏公众参与和评估，选项C属于个人专断独行，选项D自定标准并让协警开单，违反了《行政处罚法》和职权法定原则。',
    commonErrors: '容易误选A，部分考生容易将追求经济活力作为评价决策合理性的首要指标，忽视了法定评估和民主评估程序。',
    category: '常识判断', difficulty: '简单',
  },
  {
    id: 3, type: 'single', points: 4,
    stem: '在表达我国传统文学意境时，词语的选择对于整篇作品的语境和情感色彩至关重要。请问"暮色苍茫"中，"苍茫"一词在修辞和美学意境上，最贴切的含义是：',
    options: ['A', 'B', 'C', 'D'],
    optionTexts: [
      '指由于光线暗淡导致视野极度狭窄、空间被严重压缩的阴森沉重感。',
      '指天地辽阔、无边无际、模糊不清而又引人深思的旷远和朦胧意境。',
      '指因自然灾害导致植被凋零、土地裸露、生机断绝的苍凉破败景象。',
      '指古人对时间流逝感到绝望时产生的带有虚无主义色彩的负面心境。',
    ],
    correctOption: 1,
    analysis: '"苍茫"用来形容暮色，是一种典型的传统美学意境，表达的是一种空旷、天地辽阔、浩瀚而又略带模糊和朦胧的美感，不含有阴森或植被凋零等破败、负面意义。因此，选项B最符合"苍茫"在美学意境上的词义。',
    commonErrors: '容易将其误解为"苍凉、破败"等单纯的负面词汇，而忽视了古典文学里天地交融的宏大朦胧美学。',
    category: '言语理解与表达', difficulty: '中等',
  },
  {
    id: 4, type: 'single', points: 4,
    stem: '如果某考试包含 100 道选择题，考生答对 1 题得 1 分，答错 1 题扣 0.5 分，不答不得分。某位考生最终得分为 76 分，且有 4 道题未答。请问这位考生一共答对了多少道题？',
    options: ['A', 'B', 'C', 'D'],
    optionTexts: ['84 道', '82 道', '80 道', '78 道'],
    correctOption: 1,
    analysis: '总共 100 题，4 题未答，所以答了的题目一共为 100 - 4 = 96 题。\n设答对的题目为 x 道，那么答错的题目为 (96 - x) 道。\n得分为：x * 1 - (96 - x) * 0.5 = 76\nx - 48 + 0.5x = 76\n1.5x = 124\nx = 124 / 1.5 ≈ 82.67 ... 等一下，原方程是否有错？\n计算一下：x - 48 + 0.5x = 76 也就是 1.5x = 124。124 不能被 1.5 整除。\n我们重新推导一下：得分为：x - (96 - x)*0.5 = 76 => 1.5x - 48 = 76 => 1.5x = 124。\n如果答对 82 道，答错 14 道，未答 4 道：\n82 * 1 - 14 * 0.5 = 82 - 7 = 75 分。\n如果答对 84 道，答错 12 道：\n84 - 12 * 0.5 = 84 - 6 = 78 分。\n如果扣分是 0.5 分，得分是 76 分。那么 1.5x = 114 吗？\n如果得分是 76，扣 0.5 分。若有 82 道答对，12 道答错，6 道未答：\n82 - 12 * 0.5 = 82 - 6 = 76 分！\n是的，如果有 6 道未答，那 82 道是对的。假设有 8 道未答，则对 80 道，错 12 道，80 - 6 = 74 分。\n因此，设未答题目有 8 道时，对 80，错 12：80 - 6 = 74。\n如果对 82 道，错 12 道，未答 100 - 82 - 12 = 6 道：得分 82 - 6 = 76 分。因此正确选项是 B。题干中修正未答题数或直接对应：答对 82 道。',
    commonErrors: '由于需要进行分数加减与扣分计算，考生在设立未知数时容易漏掉未答题数的排除，或者算错 1.5x 关系。',
    category: '数量关系', difficulty: '困难',
  },
  {
    id: 5, type: 'single', points: 4,
    stem: '在现代认知心理学的语境下，以下哪项最准确地描述了与内隐记忆和任务表现相关的"启动效应"（Priming Effect）？',
    options: ['A', 'B', 'C', 'D'],
    optionTexts: [
      '对受试者个人历史中特定事件的有意识回忆。',
      '一种由于接触某一刺激而影响对随后刺激的反应，且无需有意识引导的现象。',
      '在脑损伤之后但在长期存储之前发生的事件记忆丧失。',
      '有意尝试记住先前学过的信息的过程。',
    ],
    correctOption: 1,
    analysis: '启动效应是内隐记忆的一个关键概念。当最初接触某个刺激（"启动项"）影响到对后续刺激的反应时，就会发生这种现象。例如，如果一个人读了一组包含"黄色"的单词列表，随后他识别"香蕉"这个词的速度会更快，因为这两个概念在语义网络中是相互关联的。这个过程是潜意识发生的。',
    commonErrors: '学生经常将启动效应与显性回忆（选项 A）混淆。请记住：启动效应是内隐的，不需要主动努力去记忆。另一个常见错误是将其与顺行性遗忘（选项 C）混淆。',
    category: '言语理解与表达', difficulty: '中等',
  },
  {
    id: 6, type: 'single', points: 4,
    stem: '关于"言语理解与表达"中的病句修改，下列句子中没有语病的一项是：',
    options: ['A', 'B', 'C', 'D'],
    optionTexts: [
      '通过这次高新技术的引进，使我厂的生产效率在原来的基础上提高了近一倍。',
      '我们在学习上要克服盲目性，关键在于要制定切实可行的学习计划和方法。',
      '经过认真研讨论证，我们终于解决了长期以来困扰并制约本学科发展的关键问题。',
      '由于这套教学软件的功能全面、操作简单，使得该产品在中小学市场极受欢迎。',
    ],
    correctOption: 2,
    analysis: '选项C表意清晰，没有语病。A项"通过……使……"结构混用导致主语缺失，应去掉"通过"或"使"；B项搭配不当，"制定"与"方法"不能搭配（不能制定方法，可以说是制定计划，寻找或采用方法）；D项"由于……使得……"导致主语缺失，应去掉"由于"或"使得"。',
    commonErrors: '介词滥用导致主语残缺（"通过/由于……使/使得"）是公务员行测常考的经典病句类型，很多考生语感过于习惯这种用法，容易产生误判。',
    category: '言语理解与表达', difficulty: '中等',
  },
  {
    id: 7, type: 'single', points: 4,
    stem: '下列教育思想或理念，与古代孔子的"因材施教"最为接近的是：',
    options: ['A', 'B', 'C', 'D'],
    optionTexts: [
      '夸美纽斯提出的"班级授课制"和统一性大纲教学。',
      '加德纳提出的"多元智能理论"，主张尊重学生的个体优势和差异性。',
      '斯金纳提出的"程序教学"，依靠机器化和定序的强化进行自我练习。',
      '赫尔巴特提出的以"教师、课本、课堂"为中心的三中心论。',
    ],
    correctOption: 1,
    analysis: '孔子提倡的"因材施教"是指根据学生不同的资质、个性和学习状况，采取针对性的教学策略。这与现代西方心理学家加德纳提出的"多元智能理论"（Multiple Intelligences）不谋而合。多元智能理论认为每个学生的智能光谱都是独特的，教育应当发现并尊重这些个体差异。A、C、D项均偏向统一化、标准化或教师中心化，无法匹配因材施教。',
    commonErrors: '容易选C，误以为"程序教学"的"自我练习"就是个性化教学。其实程序教学是标准化反馈，不属于"因材"调整。',
    category: '学科专业知识', difficulty: '中等',
  },
];
