import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { getEssayPaper } from '../../../features/essay/api';
import { cacheEssayDetail, getCachedEssayDetail } from '../../../features/essay/storage';
import type { EssayPaperDetail } from '../../../features/essay/types';
import '../../styles.scss';
import './index.scss';

const questionTypeLabels: Record<string, string> = {
  summary: '归纳概括', analysis: '综合分析', countermeasure: '提出对策', practical_writing: '贯彻执行', essay: '文章写作',
};

export default function EssayReaderPage() {
  const router = useRouter();
  const paperId = decodeURIComponent(router.params.paperId || '');
  const initialMaterial = Math.max(0, Number(router.params.material || 1) - 1);
  const [detail, setDetail] = useState<EssayPaperDetail | null>(() => getCachedEssayDetail(paperId));
  const [activeMaterial, setActiveMaterial] = useState(initialMaterial);
  const [loading, setLoading] = useState(!detail);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!paperId) { setFailed(true); setLoading(false); return; }
    setLoading(true);
    setFailed(false);
    const data = await getEssayPaper(paperId);
    if (data) { setDetail(data); cacheEssayDetail(data); }
    else setFailed(true);
    setLoading(false);
  }, [paperId]);

  useEffect(() => { if (!detail) load(); }, [detail, load]);

  const material = detail?.materials[activeMaterial] || null;
  const relatedQuestions = useMemo(() => {
    if (!detail || !material) return [];
    return detail.questions.filter((q) => !q.material_ids?.length || q.material_ids.includes(material._id));
  }, [detail, material]);

  const startAnswer = (sequence = 1) => {
    if (!detail) return;
    cacheEssayDetail(detail);
    Taro.navigateTo({ url: `/packageEssay/pages/answer/index?paperId=${encodeURIComponent(paperId)}&q=${sequence}` });
  };

  if (loading && !detail) return <View className='essay-page'><View className='essay-status'><View className='essay-status-mark'>读</View><Text className='essay-status-title'>正在展开试卷</Text><Text className='essay-status-copy'>材料较长，请稍候片刻…</Text></View></View>;
  if (failed || !detail || !material) return <View className='essay-page'><View className='essay-status'><View className='essay-status-mark'>缺</View><Text className='essay-status-title'>这套试卷暂时打不开</Text><Text className='essay-status-copy'>请检查网络，或确认试卷仍处于发布状态。</Text><View className='essay-retry' onClick={load}>重新加载</View></View></View>;

  return (
    <View className='essay-page reader-page'>
      <View className='reader-head'>
        <Text className='reader-eyebrow'>{detail.paper.year} · {detail.paper.total_score}分</Text>
        <Text className='reader-title essay-serif'>{detail.paper.title}</Text>
        <View className='reader-progress'><View style={{ width: `${((activeMaterial + 1) / detail.materials.length) * 100}%` }} /></View>
      </View>

      <ScrollView className='material-tabs' scrollX enhanced showScrollbar={false}>
        <View className='material-tab-track'>
          {detail.materials.map((item, index) => (
            <View key={item._id} className={`material-tab ${index === activeMaterial ? 'material-tab-active' : ''}`} onClick={() => setActiveMaterial(index)}>
              <Text>资料 {item.sequence}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View className='paper-sheet'>
        <View className='sheet-number'><Text>{String(material.sequence).padStart(2, '0')}</Text></View>
        <Text className='sheet-heading essay-serif'>{material.title}</Text>
        <View className='sheet-divider'><View /><Text>◆</Text><View /></View>
        <Text className='material-body essay-serif' userSelect>{material.content}</Text>

        <View className='related-section'>
          <Text className='related-kicker'>关联作答要求</Text>
          {relatedQuestions.length ? relatedQuestions.map((question) => (
            <View className='related-question' key={question._id} onClick={() => startAnswer(question.sequence)}>
              <View className='related-number'><Text>{question.sequence}</Text></View>
              <View className='related-copy'>
                <Text className='related-type'>{questionTypeLabels[question.primary_type] || '申论题'} · {question.score}分</Text>
                <Text className='related-prompt'>{question.prompt}</Text>
              </View>
              <Text className='related-arrow'>→</Text>
            </View>
          )) : <Text className='related-empty'>本则材料为全卷综合作答资料。</Text>}
        </View>
      </View>

      <View className='reader-footer'>
        <Text className='reader-page-count'>{activeMaterial + 1} / {detail.materials.length}</Text>
        <View className='reader-action' onClick={() => startAnswer(1)}><Text>进入作答</Text><Text>→</Text></View>
      </View>
    </View>
  );
}
