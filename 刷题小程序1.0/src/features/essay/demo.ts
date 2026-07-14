import type { EssayAnswer, EssayPaperDetail } from './types';

const paperId = 'sl_2022_national_law_enforcement';

export const demoEssayDetail: EssayPaperDetail = {
  paper: {
    _id: paperId,
    title: '2022年国家公务员考试申论（行政执法类）',
    year: 2022,
    exam_type: 'national',
    paper_level: 'law_enforcement',
    source_kind: 'memory_version',
    total_score: 100,
    question_count: 5,
    material_count: 5,
  },
  materials: [
    { _id: `${paperId}_m1`, paper_id: paperId, sequence: 1, title: '给定资料1', content: 'N市积极落实惠企政策，通过优化办理流程、主动上门服务和部门协同，为市场主体纾困解难。\n\n工作人员从企业实际需求出发，把政策条文转化为清晰的办事指引，并建立问题跟踪台账，推动服务由“企业找政策”转向“政策找企业”。' },
    { _id: `${paperId}_m2`, paper_id: paperId, sequence: 2, title: '给定资料2', content: '基层执法既要有力度，也要有温度。材料中的“眼中的柜台”和“心中的柜台”，体现了规则尺度与群众感受之间的统一。\n\n只有把依法办事、换位思考和主动服务结合起来，才能真正解决群众的急难愁盼。' },
    { _id: `${paperId}_m3`, paper_id: paperId, sequence: 3, title: '给定资料3', content: '某市税务局持续优化办税服务，推行线上办理、跨部门协同和分类辅导，办事效率明显提升。\n\n与此同时，部分窗口仍存在政策解释不到位、信息共享不充分等问题，需要进一步完善长效机制。' },
    { _id: `${paperId}_m4`, paper_id: paperId, sequence: 4, title: '给定资料4', content: '有关部门围绕“严格执法、优质服务、促进发展”召开经验交流会。各地代表分享了规范执法流程、开展普法宣传、服务市场主体的具体做法。' },
    { _id: `${paperId}_m5`, paper_id: paperId, sequence: 5, title: '给定资料5', content: '新修订制度实施后，市场监管部门通过公开回应社会关切、加强释法说理，引导经营主体依法合规经营，共同营造公平有序的法治化营商环境。' },
  ],
  questions: [
    { _id: `${paperId}_q1`, paper_id: paperId, sequence: 1, primary_type: 'summary', subtype: 'practice', material_ids: [`${paperId}_m1`], prompt: '“给定资料1”反映了N市积极落实惠企政策的有关情况，请简述其主要做法及成效。', score: 15, requirements: { max_words: 250, items: ['全面、准确、有条理'] } },
    { _id: `${paperId}_q2`, paper_id: paperId, sequence: 2, primary_type: 'analysis', subtype: 'phrase_explanation', material_ids: [`${paperId}_m2`], prompt: '根据给定资料2，谈谈对“现在撤掉的是眼中的柜台，但我们更要在撤掉心中的柜台”这句话的理解。', score: 15, requirements: { max_words: 300, items: ['理解准确，分析透彻'] } },
    { _id: `${paperId}_q3`, paper_id: paperId, sequence: 3, primary_type: 'countermeasure', subtype: 'achievement_and_suggestion', material_ids: [`${paperId}_m3`], prompt: '请根据给定资料3，就该市税务局如何进一步强化举措、巩固成果，形成一份工作建议。', score: 20, requirements: { max_words: 500, items: ['内容全面，建议具体可行'] } },
    { _id: `${paperId}_q4`, paper_id: paperId, sequence: 4, primary_type: 'practical_writing', subtype: 'outline', document_genre: 'outline', material_ids: [`${paperId}_m4`], prompt: '有关部门拟召开经验交流会，请根据给定资料4，撰写一份关于工作经验的材料提纲。', score: 20, requirements: { max_words: 500, items: ['内容具体，层次清楚'] } },
    { _id: `${paperId}_q5`, paper_id: paperId, sequence: 5, primary_type: 'practical_writing', subtype: 'letter', document_genre: 'letter', material_ids: [`${paperId}_m5`], prompt: '请根据材料5，以市场监管局的名义写一封公开信，回应社会关切，正确引领舆论。', score: 30, requirements: { min_words: 800, max_words: 1000, items: ['主题明确，格式规范，语言得体'] } },
  ],
};

export const demoEssayAnswers: Record<string, EssayAnswer> = Object.fromEntries(
  demoEssayDetail.questions.map((question) => [question._id, {
    question_id: question._id,
    answer_type: 'third_party_reference',
    reference_answer: question.sequence === 1
      ? '主要做法：一是主动送政策上门，精准对接企业需求；二是优化办理流程，明确办事指引；三是强化部门协同，建立问题跟踪台账。主要成效：政策落地更精准，企业办事成本降低，服务满意度和获得感得到提升。'
      : '参考答案将在这里按结构呈现。作答时应紧扣给定资料，先提炼核心观点，再分层展开要点，做到观点明确、逻辑清晰、表述规范。',
    answer_outline: ['紧扣材料提炼核心观点', '按照逻辑层次组织要点', '使用规范、简洁的申论表达'],
  }]),
);
