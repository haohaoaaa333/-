import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, Textarea, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { getEssayAnswer, getEssayPaper } from '../../../features/essay/api';
import { cacheEssayDetail, getCachedEssayDetail, getEssayDraft, saveEssayDraft } from '../../../features/essay/storage';
import type { EssayAnswer, EssayPaperDetail } from '../../../features/essay/types';
import '../../styles.scss';
import './index.scss';

const typeLabels: Record<string, string> = {
  summary: '归纳概括', analysis: '综合分析', countermeasure: '提出对策', practical_writing: '贯彻执行', essay: '文章写作',
};

export default function EssayAnswerPage() {
  const router = useRouter();
  const paperId = decodeURIComponent(router.params.paperId || '');
  const initialSequence = Math.max(1, Number(router.params.q || 1));
  const [detail, setDetail] = useState<EssayPaperDetail | null>(() => getCachedEssayDetail(paperId));
  const [questionIndex, setQuestionIndex] = useState(initialSequence - 1);
  const [draft, setDraft] = useState('');
  const [reference, setReference] = useState<EssayAnswer | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const draftRef = useRef('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const question = detail?.questions[questionIndex] || null;

  useEffect(() => {
    if (detail || !paperId) return;
    getEssayPaper(paperId).then((data) => {
      if (data) { setDetail(data); cacheEssayDetail(data); }
      else setFailed(true);
    });
  }, [detail, paperId]);

  useEffect(() => {
    if (detail?.questions.length && questionIndex >= detail.questions.length) setQuestionIndex(0);
  }, [detail, questionIndex]);

  useEffect(() => {
    if (!question) return;
    const saved = getEssayDraft(question._id)?.content || '';
    setDraft(saved);
    draftRef.current = saved;
    setReference(null);
  }, [question?._id]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (question?._id) saveEssayDraft(question._id, draftRef.current);
  }, [question?._id]);

  const wordCount = useMemo(() => draft.replace(/\s/g, '').length, [draft]);
  const maxWords = question?.requirements?.max_words || 0;
  const overLimit = maxWords > 0 && wordCount > maxWords;

  const handleInput = (value: string) => {
    setDraft(value);
    draftRef.current = value;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (question) saveTimer.current = setTimeout(() => saveEssayDraft(question._id, value), 500);
  };

  const changeQuestion = (nextIndex: number) => {
    if (!detail || nextIndex < 0 || nextIndex >= detail.questions.length) return;
    if (question) saveEssayDraft(question._id, draftRef.current);
    setQuestionIndex(nextIndex);
    Taro.pageScrollTo({ scrollTop: 0, duration: 200 });
  };

  const revealAnswer = useCallback(async () => {
    if (!question || answerLoading) return;
    if (!draft.trim()) {
      const modal = await Taro.showModal({ title: '还没有写答案', content: '建议先独立作答，再查看参考答案。仍要继续吗？', confirmText: '继续查看', confirmColor: '#8b3027' });
      if (!modal.confirm) return;
    }
    setAnswerLoading(true);
    const answer = await getEssayAnswer(paperId, question._id);
    setReference(answer);
    setAnswerLoading(false);
    if (!answer) Taro.showToast({ title: '参考答案暂时无法加载', icon: 'none' });
  }, [answerLoading, draft, paperId, question]);

  const openMaterial = () => {
    if (!question || !detail) return;
    const firstMaterialId = question.material_ids?.[0];
    const index = Math.max(0, detail.materials.findIndex((item) => item._id === firstMaterialId));
    Taro.navigateTo({ url: `/packageEssay/pages/reader/index?paperId=${encodeURIComponent(paperId)}&material=${index + 1}` });
  };

  if (!detail || !question) return <View className='essay-page'><View className='essay-status'><View className='essay-status-mark'>{failed ? '缺' : '备'}</View><Text className='essay-status-title'>{failed ? '题目暂时无法加载' : '正在准备答题纸'}</Text><Text className='essay-status-copy'>{failed ? '请返回试卷列表后重试。' : '正在恢复你的本地草稿…'}</Text></View></View>;

  return (
    <View className='essay-page answer-page'>
      <View className='answer-topbar'>
        <ScrollView className='question-tabs' scrollX enhanced showScrollbar={false}>
          <View className='question-tab-track'>
            {detail.questions.map((item, index) => (
              <View key={item._id} className={`question-tab ${index === questionIndex ? 'question-tab-active' : ''}`} onClick={() => changeQuestion(index)}>
                <Text>{item.sequence}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
        <Text className='question-total'>共 {detail.questions.length} 题</Text>
      </View>

      <View className='question-sheet'>
        <View className='question-heading'>
          <Text className='question-kicker'>第 {question.sequence} 题 · {typeLabels[question.primary_type] || '申论题'}</Text>
          <Text className='question-score'>{question.score} 分</Text>
        </View>
        <Text className='question-prompt essay-serif' userSelect>{question.prompt}</Text>
        <View className='requirement-list'>
          {(question.requirements?.items || []).map((item, index) => <Text key={`${index}-${item}`}>（{index + 1}）{item}</Text>)}
          {maxWords ? <Text>字数要求：{question.requirements.min_words ? `${question.requirements.min_words}—` : '不超过'}{maxWords}字</Text> : null}
        </View>
        <View className='material-link' onClick={openMaterial}><Text>返回查看关联材料</Text><Text>↗</Text></View>
      </View>

      <View className='writing-sheet'>
        <View className='writing-head'><Text className='writing-title essay-kaiti'>答题纸</Text><Text className={`word-count ${overLimit ? 'word-count-over' : ''}`}>{wordCount}{maxWords ? ` / ${maxWords}` : ''} 字</Text></View>
        <Textarea
          className='answer-textarea essay-serif'
          value={draft}
          maxlength={-1}
          autoHeight={false}
          cursorSpacing={120}
          placeholder='在这里组织你的答案。内容会自动保存在本机…'
          onInput={(event) => handleInput(event.detail.value)}
          onBlur={() => saveEssayDraft(question._id, draftRef.current)}
        />
        <Text className='autosave-note'>本地自动保存 · 不上传个人作答</Text>
      </View>

      <View className='reference-wrap'>
        {!reference ? (
          <View className={`reveal-answer ${answerLoading ? 'reveal-loading' : ''}`} onClick={revealAnswer}>
            <Text>{answerLoading ? '正在取回答案…' : '完成作答后，查看参考答案'}</Text><Text>展开 ↓</Text>
          </View>
        ) : (
          <View className='reference-sheet'>
            <View className='reference-heading'><View className='reference-seal'><Text>参</Text></View><View><Text className='reference-title essay-serif'>参考答案</Text><Text className='reference-note'>公开资料整理，仅供复盘</Text></View></View>
            {reference.answer_outline?.length ? <View className='outline-box'><Text className='outline-title'>答题结构</Text>{reference.answer_outline.map((item, index) => <Text key={`${index}-${item}`}>{index + 1}. {item}</Text>)}</View> : null}
            <Text className='reference-content essay-serif' userSelect>{reference.reference_answer}</Text>
          </View>
        )}
      </View>

      <View className='answer-footer'>
        <View className={`answer-nav ${questionIndex === 0 ? 'answer-nav-disabled' : ''}`} onClick={() => changeQuestion(questionIndex - 1)}><Text>← 上一题</Text></View>
        <Text className='answer-position'>{question.sequence} / {detail.questions.length}</Text>
        <View className={`answer-nav answer-nav-next ${questionIndex === detail.questions.length - 1 ? 'answer-nav-disabled' : ''}`} onClick={() => changeQuestion(questionIndex + 1)}><Text>下一题 →</Text></View>
      </View>
    </View>
  );
}
