// pages/study/index.tsx — 考公宝学习页

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { CIVIL_SUBCATEGORIES, TEACHER_SUBCATEGORIES } from '../../data';
import { useAppState, showToast, loadModuleQuestions } from '../../store';
import { usePrivacyAgreed } from '../../hooks/usePrivacy';
import PrivacyPopup from '../../components/PrivacyPopup';
import { getCategories } from '../../api/course';
import { Category } from '../../types';
import './index.scss';

interface CloudModule { module_id: string; name: string; total_questions: number; done_count: number; correct_count: number; accuracy: number; }
interface PageModule { id: string; name: string; desc: string; completed: number; total: number; percentage: number; icon: string; category: 'civil' | 'teacher'; locked: boolean; }

// 即将上线、暂未开放的模块（点击提示"开发中"，不跳转）
const COMING_SOON_MODULES = new Set(['资料分析', '结构化面试', '无领导小组']);

function mapCloudToPage(cats: any[]): PageModule[] {
  const iconMap: Record<string, string> = { '常识判断': '📚', '言语理解与表达': '💬', '数量关系': '🧮', '判断推理': '🧩', '资料分析': '📊', '概括归纳': '📝', '综合分析': '🔍', '提出对策': '💡', '大作文': '✍️', '结构化面试': '🗣️', '无领导小组': '👥' };
  const descMap: Record<string, string> = { '常识判断': '时事政治、历史文化及宪法法律基础。', '言语理解与表达': '阅读理解、词语表达及公文写作技巧。', '数量关系': '数学运算、数列推理及应用题解题。', '判断推理': '图形推理、逻辑判断及演绎推理。', '资料分析': '图表解读、统计表分析及复杂数据处理。', '概括归纳': '材料概括、要点提炼。', '综合分析': '词句理解、观点分析。', '提出对策': '问题对策、建议方案。', '大作文': '议论文写作、命题作文。', '结构化面试': '综合分析、组织管理、应急应变。', '无领导小组': '讨论技巧、角色定位。' };
  const ms: PageModule[] = [];
  cats.forEach(cat => {
    const isC = cat.name === '行测' || cat.name === '申论' || cat.name === '面试';
    (cat.modules || []).forEach((m: CloudModule) => { ms.push({ id: m.module_id, name: m.name, desc: descMap[m.name] || '', completed: m.done_count || 0, total: m.total_questions || 0, percentage: m.total_questions > 0 ? Math.round((m.done_count || 0) / m.total_questions * 100) : 0, icon: iconMap[m.name] || '📖', category: isC ? 'civil' : 'teacher', locked: false }); });
  });
  return ms;
}

export default function StudyPage() {
  const { userStats, setQuestions: setAppQuestions, activeSubject, setActiveSubject, isLightTheme } = useAppState();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category>('civil');
  const [showPrivacy, agreePrivacy] = usePrivacyAgreed();
  const [cloudModules, setCloudModules] = useState<PageModule[] | null>(null);
  const [moduleLoading, setModuleLoading] = useState(true);

  useEffect(() => {
    let c = false;
    (async () => { const d = await getCategories(); if (!c && d && Array.isArray(d) && d.length > 0) setCloudModules(mapCloudToPage(d)); if (!c) setModuleLoading(false); })();
    return () => { c = true; };
  }, []);

  const allSubcats = cloudModules || [
    ...CIVIL_SUBCATEGORIES.map(s => ({ ...s, locked: s.locked || false })),
    ...TEACHER_SUBCATEGORIES.map(s => ({ ...s, locked: s.locked || false })),
  ];
  const filtered = allSubcats.filter(sub => {
    if (searchQuery) return sub.name.includes(searchQuery) || sub.desc.includes(searchQuery);
    return sub.category === selectedCategory;
  });

  const goPractice = () => { Taro.navigateTo({ url: '/pages/practice/index' }); };

  const handleStartQuiz = useCallback(async (sc: PageModule) => {
    if (COMING_SOON_MODULES.has(sc.name)) { showToast(`「${sc.name}」正在开发中，敬请期待！`); return; }
    if (sc.locked && userStats.vipStatus !== 'VIP 专属') { showToast(`《${sc.name}》是 VIP 专属板块，请升级后继续。`); return; }
    setActiveSubject(sc.id);
    const ok = await loadModuleQuestions(sc.id, setAppQuestions, 20);
    if (ok) goPractice();
  }, [userStats, setAppQuestions, setActiveSubject]);

  return (
    <View className={`study-page ${isLightTheme ? 'theme-light' : ''}`}>
      <View className="search-bar">
        <Input className="search-input" placeholder="搜索考试类别、科目..." value={searchQuery} onInput={e => setSearchQuery(e.detail.value)} confirmType="search" />
        {searchQuery ? <Text className="search-clear" onTap={() => setSearchQuery('')}>清除</Text> : null}
      </View>

      {!searchQuery ? (
        <View className="cat-tabs">
          <View className={`cat-tab ${selectedCategory === 'civil' ? 'cat-tab-active' : ''}`} onTap={() => setSelectedCategory('civil')}><Text>公务员考试</Text></View>
          <View className={`cat-tab ${selectedCategory === 'teacher' ? 'cat-tab-active' : ''}`} onTap={() => setSelectedCategory('teacher')}><Text>教师资格证</Text></View>
        </View>
      ) : null}

      <View className="section-header">
        <Text className="section-title">{searchQuery ? `搜索结果 (${filtered.length})` : (selectedCategory === 'civil' ? '行政职业能力测验' : '教育教学基础')}</Text>
        {!searchQuery ? <Text className="section-desc">{selectedCategory === 'civil' ? '掌握公共行政管理的核心能力。' : '教育学、伦理学及课堂管理。'}</Text> : null}
        {moduleLoading && !cloudModules ? <Text className="section-loading">数据加载中...</Text> : null}
      </View>

      <View className="subjects-grid">
        {filtered.length === 0 && !moduleLoading ? <View className="empty-state"><Text className="empty-icon">📭</Text><Text className="empty-text">暂无匹配的科目</Text>{searchQuery ? <Text className="empty-hint">试试其他关键词</Text> : null}</View> : null}
        {filtered.map(sub => {
          const locked = sub.locked && userStats.vipStatus !== 'VIP 专属';
          const comingSoon = COMING_SOON_MODULES.has(sub.name);
          return (
            <View key={sub.id} className={`subject-card ${locked ? 'subject-card-locked' : ''} ${comingSoon ? 'subject-card-coming' : ''} ${activeSubject === sub.id ? 'subject-card-selected' : ''}`} onTap={() => handleStartQuiz(sub)}>
              <View className="subject-top"><View className={`subject-icon ${locked ? 'subject-icon-locked' : ''} ${comingSoon ? 'subject-icon-coming' : ''}`}><Text>{sub.icon}</Text></View>{comingSoon ? <Text className="subject-soon-tag">即将上线</Text> : locked ? <Text className="subject-lock-icon">🔒</Text> : <Text className="subject-arrow">→</Text>}</View>
              <View className="subject-name-wrap"><Text className="subject-name">{sub.name}</Text>{comingSoon ? <Text className="soon-badge">开发中</Text> : sub.locked ? <Text className="vip-tag">VIP</Text> : null}</View>
              <Text className="subject-desc">{sub.desc}</Text>
              {comingSoon ? <View className="subject-coming-msg"><Text>功能开发中，敬请期待</Text></View> :
                locked ? <View className="subject-locked-msg"><Text>专业版解锁可用</Text></View> :
                <View className="subject-progress"><View className="progress-info"><Text className="progress-text">已完成 {sub.completed}/{sub.total}</Text><Text className="progress-pct">{sub.percentage}%</Text></View><View className="progress-bar"><View className="progress-fill" style={{ width: `${sub.percentage}%` }} /></View></View>}
            </View>
          );
        })}
      </View>

      {showPrivacy ? <PrivacyPopup onAgree={agreePrivacy} onDisagree={() => { Taro.showModal({ title: '温馨提示', content: '需同意隐私政策和用户协议才能使用考公宝。', showCancel: false, confirmText: '知道了', success: () => { try { Taro.exitMiniProgram(); } catch { /* */ } } }); }} /> : null}
    </View>
  );
}
