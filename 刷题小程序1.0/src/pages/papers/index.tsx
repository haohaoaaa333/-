import React, { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppState, fetchPapers, loadYearQuestions, PaperItem } from '../../store';
import './index.scss';

export default function PapersPage() {
  const { setQuestions, isLightTheme } = useAppState();
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePaper, setActivePaper] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchPapers();
      if (!cancelled) {
        setPapers(list);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePaperClick = async (paper: PaperItem) => {
    setActivePaper(paper.paper_id);
    const ok = await loadYearQuestions(paper.year, setQuestions);
    setActivePaper(null);
    if (ok) {
      Taro.navigateTo({ url: '/pages/practice/index' });
    }
  };

  return (
    <View className={`papers-page ${isLightTheme ? 'theme-light' : ''}`}>
      <View className='papers-header'>
        <Text className='papers-title'>全部试卷</Text>
        <Text className='papers-subtitle'>
          {loading ? '加载中...' : `共 ${papers.length} 套试卷`}
        </Text>
      </View>

      {loading ? (
        <View className='papers-loading'>
          <Text className='loading-text'>正在加载试卷列表...</Text>
        </View>
      ) : papers.length === 0 ? (
        <View className='papers-empty'>
          <Text className='empty-icon'>📭</Text>
          <Text className='empty-text'>暂无试卷数据</Text>
          <Text className='empty-hint'>请先在云数据库中导入题目</Text>
        </View>
      ) : (
        <View className='papers-list'>
          {papers.map((paper) => {
            const isLoading = activePaper === paper.paper_id;
            return (
              <View
                key={paper.paper_id}
                className={`paper-card ${isLoading ? 'paper-card-loading' : ''}`}
                onClick={() => handlePaperClick(paper)}
              >
                <View className='paper-main'>
                  <Text className='paper-name'>{paper.paper_name}</Text>
                  <Text className='paper-meta'>
                    {paper.province || '国家'} · {paper.question_count} 题
                    {paper.paper_date ? ` · ${paper.paper_date}` : ''}
                  </Text>
                </View>
                <View className='paper-year-badge'>
                  <Text className='paper-year-text'>{paper.year}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
