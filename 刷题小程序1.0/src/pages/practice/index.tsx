import React, { useState, useCallback } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppState, showToast } from '../../store';
import { Question } from '../../types';
import './index.scss';

const LETTERS = ['A', 'B', 'C', 'D'];

function QuestionImages({ images }: { images?: string[] }) {
  if (!images || images.length === 0) return null;
  return (
    <View className="q-images">
      {images.map((src, idx) => (
        <Image key={`${src}-${idx}`} className="q-image" src={src} mode="widthFix" />
      ))}
    </View>
  );
}

/** 模块 ID → 名称 */
const MODULE_LABELS: Record<string, string> = {
  mod_common_sense: '常识判断',
  mod_language: '言语理解与表达',
  mod_quantity: '数量关系',
  mod_logic: '判断推理',
  mod_data: '资料分析',
  mod_sl_summary: '概括归纳',
  mod_sl_analysis: '综合分析',
  mod_sl_proposal: '提出对策',
  mod_sl_essay: '大作文',
  mod_iv_structured: '结构化面试',
  mod_iv_noleader: '无领导小组',
};

export default function PracticePage() {
  const { userStats, setUserStats, questions, setQuestions, isLightTheme, activeSubject } = useAppState();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSheet, setShowSheet] = useState(false);

  if (questions.length === 0) {
    return (
      <View className={`practice-empty ${isLightTheme ? 'theme-light' : ''}`}>
        <Text className="empty-icon">📂</Text>
        <Text className="empty-title">暂无相关练习题目</Text>
        <Text className="empty-desc">从首页或学习页面选择练习开始刷题。</Text>
        <View className="empty-btn" onTap={() => Taro.switchTab({ url: '/pages/study/index' })}>
          <Text>去选择科目</Text>
        </View>
      </View>
    );
  }

  const cur: Question = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;
  const progress = Math.round(((currentIdx + 1) / questions.length) * 100);

  const handleSelect = (idx: number) => {
    if (cur.isSubmitted) return;
    const updated = [...questions];
    updated[currentIdx].userAnswer = idx;
    setQuestions(updated);
  };

  const handleSubmit = () => {
    if (cur.userAnswer === undefined) {
      showToast('请先选择一个选项后再提交！');
      return;
    }
    const updated = [...questions];
    const q = updated[currentIdx];
    q.isSubmitted = true;
    const isCorrect = q.userAnswer === q.correctOption;
    if (!isCorrect) q.isWrongBook = true;
    setQuestions(updated);

    const totalCorrect = updated.filter(q => q.isSubmitted && q.userAnswer === q.correctOption).length;
    const totalSubmitted = updated.filter(q => q.isSubmitted).length;
    const acc = Math.round((totalCorrect / totalSubmitted) * 100);
    const newDone = userStats.todayDone + 1;
    const newStats = {
      ...userStats,
      todayDone: newDone > userStats.todayGoal ? userStats.todayGoal : newDone,
      totalDone: userStats.totalDone + 1,
      accuracyRate: acc,
    };
    setUserStats(newStats);
    setShowAnalysis(true);

    showToast(isCorrect ? '回答正确！🎉' : '回答错误，已自动录入错题本。');
  };

  const handleNext = () => {
    setShowAnalysis(false);
    if (isLast) {
      Taro.switchTab({ url: '/pages/study/index' });
    } else {
      setCurrentIdx(currentIdx + 1);
    }
  };

  const handleToggleFav = (id: number | string) => {
    const updated = questions.map(q => q.id === id ? { ...q, isFavorite: !q.isFavorite } : q);
    setQuestions(updated);
    const fav = updated.find(q => q.id === id);
    showToast(fav?.isFavorite ? '已添加至收藏夹 ⭐' : '已从收藏夹移除');
  };

  const handleToggleWrong = (id: number | string) => {
    const updated = questions.map(q => q.id === id ? { ...q, isWrongBook: !q.isWrongBook } : q);
    setQuestions(updated);
    const wb = updated.find(q => q.id === id);
    showToast(wb?.isWrongBook ? '已加入错题本 📂' : '已移出错题本');
  };

  return (
    <View className={`practice-page ${isLightTheme ? 'theme-light' : ''}`}>
      {/* Progress */}
      <View className="practice-progress">
        <View className="progress-header">
          <Text className="progress-num">第 {currentIdx + 1} / {questions.length} 题</Text>
          <View className="progress-right">
            <View className="sheet-btn" onTap={() => setShowSheet(true)}>
              <Text className="sheet-btn-text">📋 答题卡</Text>
            </View>
            <Text className="progress-pct">{progress}%</Text>
          </View>
        </View>
        <View className="progress-bar">
          <View className="progress-fill" style={{ width: `${progress}%` }} />
        </View>
      </View>

      {/* Question Card */}
      <View className="question-card">
        <View className="question-meta">
          <Text className="q-type">{MODULE_LABELS[cur.category] || cur.category || '单选题'}</Text>
          {cur.year ? <Text className="q-type"> · {cur.year}年</Text> : null}
          <Text className="q-points"> · {cur.difficulty}</Text>
        </View>
        {cur.material ? (
          <View className="q-material">
            <Text className="q-material-title">📊 材料</Text>
            <Text className="q-material-text">{cur.material}</Text>
            <QuestionImages images={cur.materialImages} />
          </View>
        ) : null}
        <Text className="q-stem">{cur.stem}</Text>
        <QuestionImages images={cur.stemImages} />

        <View className="options-list">
          {cur.optionTexts.map((text, idx) => {
            const sel = cur.userAnswer === idx;
            const sub = cur.isSubmitted;
            const correct = cur.correctOption === idx;
            const wrong = sel && !correct;

            let cc = 'option-item', lc = 'option-letter', lt: string = LETTERS[idx];
            if (sel && !sub) { cc += ' option-selected'; lc += ' letter-selected'; }
            if (sub && correct) { cc += ' option-correct'; lc += ' letter-correct'; lt = '✓'; }
            if (sub && wrong) { cc += ' option-wrong'; lc += ' letter-wrong'; lt = '✗'; }
            if (sub && !correct && !wrong) { cc += ' option-disabled'; }

            return (
              <View key={idx} className={cc} onTap={() => handleSelect(idx)}>
                <View className={lc}><Text>{lt}</Text></View>
                <View className="option-body">
                  {text ? <Text className="option-text">{text}</Text> : null}
                  <QuestionImages images={cur.optionImages?.[idx]} />
                </View>
              </View>
            );
          })}
        </View>

        {showAnalysis && cur.isSubmitted && (
          <View className="analysis-section">
            <View className="analysis-result">
              <View className={`analysis-icon ${cur.userAnswer === cur.correctOption ? 'analysis-correct' : 'analysis-wrong'}`}>
                <Text>{cur.userAnswer === cur.correctOption ? '✓' : '✗'}</Text>
              </View>
              <View>
                <Text className="analysis-result-label">{cur.userAnswer === cur.correctOption ? '回答正确' : '回答错误'}</Text>
                <Text className="analysis-result-answer">正确答案：选项 {LETTERS[cur.correctOption]}</Text>
              </View>
            </View>
            <View className="analysis-details">
              <View className="analysis-block">
                <Text className="analysis-label">📖 原题解析</Text>
                <Text className="analysis-text">{cur.analysis}</Text>
                <QuestionImages images={cur.analysisImages} />
              </View>
              {cur.commonErrors && (
                <View className="analysis-block">
                  <Text className="analysis-label error-label">⚠️ 常见错误</Text>
                  <Text className="analysis-text">{cur.commonErrors}</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>

      {/* Controls */}
      <View className="practice-controls">
        <View className={`ctrl-btn ${cur.isSubmitted ? '' : 'ctrl-btn-disabled'}`}
          onTap={() => { if (cur.isSubmitted) setShowAnalysis(!showAnalysis); }}>
          <Text>{showAnalysis ? '收起解析' : '查看解析'}</Text>
        </View>
        {!cur.isSubmitted ? (
          <View className="submit-btn" onTap={handleSubmit}><Text>提交答案</Text></View>
        ) : (
          <View className="submit-btn" onTap={handleNext}>
            <Text>{isLast ? '返回科目列表' : '下一题'}</Text>
          </View>
        )}
      </View>

      {/* Bottom Bar */}
      <View className="bottom-bar">
        <View className="bottom-left">
          <View className="bottom-action" onTap={() => handleToggleWrong(cur.id)}>
            <Text className={`action-icon ${cur.isWrongBook ? 'action-active-error' : ''}`}>
              {cur.isWrongBook ? '📌' : '📋'}
            </Text>
            <Text className="action-label">{cur.isWrongBook ? '已入错题本' : '加入错题本'}</Text>
          </View>
          <View className="bottom-action" onTap={() => handleToggleFav(cur.id)}>
            <Text className={`action-icon ${cur.isFavorite ? 'action-active-fav' : ''}`}>
              {cur.isFavorite ? '⭐' : '☆'}
            </Text>
            <Text className="action-label">{cur.isFavorite ? '已收藏' : '收藏'}</Text>
          </View>
        </View>
        <View className="bottom-right">
          <View className={`nav-btn ${currentIdx === 0 ? 'nav-btn-disabled' : ''}`}
            onTap={() => currentIdx > 0 && setCurrentIdx(currentIdx - 1)}><Text>◀</Text></View>
          <View className={`nav-btn ${isLast ? 'nav-btn-disabled' : ''}`}
            onTap={() => !isLast && setCurrentIdx(currentIdx + 1)}><Text>▶</Text></View>
        </View>
      </View>

      {/* Answer Sheet Modal */}
      {showSheet ? (
        <View className="modal-overlay" onTap={() => setShowSheet(false)}>
          <View className="modal-content" onTap={e => e.stopPropagation()}>
            <View className="modal-header">
              <View>
                <Text className="modal-title">📋 练习答题卡</Text>
                <Text className="modal-sub">
                  已回答: {questions.filter(q => q.isSubmitted).length}/{questions.length} | 正确: {questions.filter(q => q.isSubmitted && q.userAnswer === q.correctOption).length}
                </Text>
              </View>
              <Text className="modal-close" onTap={() => setShowSheet(false)}>✕</Text>
            </View>
            <View className="answer-grid">
              {questions.map((q, idx) => {
                const isCur = idx === currentIdx;
                const correct = q.isSubmitted && q.userAnswer === q.correctOption;
                const wrong = q.isSubmitted && q.userAnswer !== q.correctOption;
                let cls = 'answer-cell';
                if (isCur) cls += ' cell-current';
                else if (correct) cls += ' cell-correct';
                else if (wrong) cls += ' cell-wrong';
                else if (q.userAnswer !== undefined && !q.isSubmitted) cls += ' cell-draft';
                return (
                  <View key={q.id} className={cls} onTap={() => { setCurrentIdx(idx); setShowSheet(false); }}>
                    <Text>{idx + 1}</Text>
                  </View>
                );
              })}
            </View>
            <View className="answer-legend">
              <View className="legend-item"><View className="legend-dot dot-correct" /><Text>正确</Text></View>
              <View className="legend-item"><View className="legend-dot dot-wrong" /><Text>错误</Text></View>
              <View className="legend-item"><View className="legend-dot dot-current" /><Text>当前</Text></View>
              <View className="legend-item"><View className="legend-dot dot-unanswered" /><Text>未答</Text></View>
            </View>
            <View className="modal-close-btn" onTap={() => setShowSheet(false)}><Text>继续练习</Text></View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
