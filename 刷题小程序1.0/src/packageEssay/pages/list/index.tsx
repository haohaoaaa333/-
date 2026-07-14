import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { listEssayPapers } from '../../../features/essay/api';
import type { EssayPaper } from '../../../features/essay/types';
import '../../styles.scss';
import './index.scss';

const levelLabels: Record<string, string> = {
  city: '地市级',
  sub_provincial: '副省级',
  law_enforcement: '行政执法类',
  general: '通用卷',
};

export default function EssayPaperListPage() {
  const [papers, setPapers] = useState<EssayPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const data = await listEssayPapers();
    setPapers(data);
    setFailed(data.length === 0);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openPaper = (paper: EssayPaper) => {
    Taro.navigateTo({ url: `/packageEssay/pages/reader/index?paperId=${encodeURIComponent(paper._id)}` });
  };

  return (
    <View className='essay-page essay-list-page'>
      <View className='list-masthead'>
        <Text className='masthead-overline'>SHEN LUN · PAST PAPERS</Text>
        <Text className='masthead-title essay-serif'>申论真题卷库</Text>
        <Text className='masthead-copy'>先读材料，再落笔。每一套完整练习，都是一次思维校准。</Text>
        <View className='masthead-rule'><View /><Text>卷</Text><View /></View>
      </View>

      {loading ? (
        <View className='essay-status'><View className='essay-status-mark'>阅</View><Text className='essay-status-title'>正在整理试卷</Text><Text className='essay-status-copy'>从云端取回已发布的申论真题…</Text></View>
      ) : failed ? (
        <View className='essay-status'><View className='essay-status-mark'>候</View><Text className='essay-status-title'>暂时没有可用试卷</Text><Text className='essay-status-copy'>请确认试卷已在后台发布，或检查 essay 云函数是否已部署。</Text><View className='essay-retry' onClick={load}>重新加载</View></View>
      ) : (
        <View className='paper-shelf'>
          <View className='shelf-heading'><Text>已收录 {papers.length} 套</Text><Text>按年份排列</Text></View>
          {papers.map((paper, index) => (
            <View className='paper-row' key={paper._id} onClick={() => openPaper(paper)}>
              <View className='paper-sequence'><Text>{String(index + 1).padStart(2, '0')}</Text></View>
              <View className='paper-copy'>
                <View className='paper-labels'><Text>{paper.year}</Text><Text>{levelLabels[paper.paper_level] || paper.paper_level}</Text></View>
                <Text className='paper-title essay-serif'>{paper.title}</Text>
                <View className='paper-meta'><Text>{paper.material_count} 份材料</Text><Text>·</Text><Text>{paper.question_count} 道题</Text><Text>·</Text><Text>{paper.total_score} 分</Text></View>
              </View>
              <View className='paper-open'><Text>启</Text></View>
            </View>
          ))}
          <Text className='list-footnote'>参考答案来自公开资料，仅供学习复盘，不作为官方评分标准。</Text>
        </View>
      )}
    </View>
  );
}
