// data/seed.ts — CloudBase 数据库种子数据
// 在云开发控制台 → 数据库 → 对应集合中逐条导入

// ==================== VIP 方案 ====================
// 集合: vip_plans
export const vipPlans = [
  {
    _id: 'plan_monthly',
    name: '月度会员',
    duration_days: 30,
    price: 9.9,
    original_price: 19.9,
    features: ['全题库解锁', '详细解析', '错题本', '知识点标签'],
    tag: '热门',
    sort: 1,
  },
  {
    _id: 'plan_quarterly',
    name: '季度会员',
    duration_days: 90,
    price: 19.9,
    original_price: 39.9,
    features: ['全题库解锁', '详细解析', '错题本', '知识点标签', '申论范文', '模考报告'],
    tag: '推荐',
    sort: 2,
  },
  {
    _id: 'plan_yearly',
    name: '年度会员',
    duration_days: 365,
    price: 59.9,
    original_price: 119.9,
    features: ['全题库解锁', '详细解析', '错题本', '知识点标签', '申论范文', '模考报告', 'VIP专属题库', '智能组卷'],
    tag: '最划算',
    sort: 3,
  },
];

// ==================== 题目分类 ====================
// 集合: categories
export const categories = [
  {
    _id: 'cat_xingce',
    name: '行测',
    icon: '📝',
    sort: 1,
    modules: [
      { module_id: 'mod_common_sense', name: '常识判断', description: '政治、经济、法律、历史、文化、地理、科技等', total_questions: 0 },
      { module_id: 'mod_language', name: '言语理解与表达', description: '逻辑填空、阅读理解、语句表达', total_questions: 0 },
      { module_id: 'mod_quantity', name: '数量关系', description: '数字推理、数学运算', total_questions: 0 },
      { module_id: 'mod_logic', name: '判断推理', description: '图形推理、定义判断、类比推理、逻辑判断', total_questions: 0 },
      { module_id: 'mod_data', name: '资料分析', description: '图表分析、文字分析、综合计算', total_questions: 0 },
    ],
  },
  {
    _id: 'cat_shenlun',
    name: '申论',
    icon: '📄',
    sort: 2,
    modules: [
      { module_id: 'mod_sl_summary', name: '概括归纳', description: '材料概括、要点提炼', total_questions: 0 },
      { module_id: 'mod_sl_analysis', name: '综合分析', description: '词句理解、观点分析', total_questions: 0 },
      { module_id: 'mod_sl_proposal', name: '提出对策', description: '问题对策、建议方案', total_questions: 0 },
      { module_id: 'mod_sl_essay', name: '大作文', description: '议论文写作、命题作文', total_questions: 0 },
    ],
  },
  {
    _id: 'cat_interview',
    name: '面试',
    icon: '💬',
    sort: 3,
    modules: [
      { module_id: 'mod_iv_structured', name: '结构化面试', description: '综合分析、组织管理、应急应变', total_questions: 0 },
      { module_id: 'mod_iv_noleader', name: '无领导小组', description: '讨论技巧、角色定位', total_questions: 0 },
    ],
  },
];

// ==================== 轮播图 ====================
// 集合: banners
export const banners = [
  {
    _id: 'banner_1',
    badge: '🔥 新功能',
    title: '智能组卷上线',
    desc: 'AI 根据你的薄弱点自动生成专属试卷',
    color: '#1a56db',
    sort: 1,
  },
  {
    _id: 'banner_2',
    badge: '📅 打卡',
    title: '连续打卡赢好礼',
    desc: '坚持每天刷题，累积打卡天数兑换 VIP',
    color: '#7c3aed',
    sort: 2,
  },
  {
    _id: 'banner_3',
    badge: '📊 数据',
    title: '学习报告升级',
    desc: '多维度分析你的学习数据，精准提分',
    color: '#059669',
    sort: 3,
  },
];

// ==================== 示例题目（可批量导入） ====================
// 集合: questions
// 注意：使用云开发控制台的「导入」功能批量导入 JSON/CSV 更高效
// 以下为示例，实际题目应从题库后台批量导入
export const sampleQuestions = [
  {
    module_id: 'mod_common_sense',
    type: 'single',
    difficulty: '简单',
    content: '我国现行宪法是哪一年通过的？',
    options: ['1954年', '1975年', '1978年', '1982年'],
    answer: 'D',
    explanation: '我国现行宪法是1982年12月4日由第五届全国人民代表大会第五次会议通过的，此后历经五次修正。',
    tags: ['法律', '宪法'],
  },
  {
    module_id: 'mod_language',
    type: 'single',
    difficulty: '中等',
    content: '填入划横线部分最恰当的一项是：他在商界的_____使他积累了丰富的管理经验。',
    options: ['摸爬滚打', '一帆风顺', '无往不利', '步步为营'],
    answer: 'A',
    explanation: '"摸爬滚打"意指经历各种艰难险阻，符合"积累经验"的语境。其他选项与"积累经验"的磨砺意味不符。',
    tags: ['成语', '逻辑填空'],
  },
];

// 以下函数供开发者本地执行使用，不在小程序中调用
// 实际使用时请在云开发控制台操作

console.log('[Seed] 种子数据已导出，请到云开发控制台 → 数据库 手动导入。');
console.log('导入顺序: vip_plans → categories → banners → questions');
