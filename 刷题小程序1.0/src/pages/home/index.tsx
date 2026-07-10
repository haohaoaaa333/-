import React, { useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Swiper, SwiperItem } from '@tarojs/components';
import { CAROUSEL_ITEMS } from '../../data';
import { useAppState, createStartPractice } from '../../store';
import './index.scss';

export default function HomePage() {
  const { userStats, setUserStats, setQuestions, setActiveSubject } = useAppState();
  const [activeSlide, setActiveSlide] = useState(0);
  const startPractice = createStartPractice(setQuestions);

  const goToStudy = (subject?: string) => {
    if (subject) setActiveSubject(subject);
    Taro.switchTab({ url: '/pages/study/index' });
  };

  const goToProfile = () => {
    Taro.switchTab({ url: '/pages/profile/index' });
  };

  const handleSpecialQuiz = async (type: 'daily' | 'history' | 'mock' | 'wrong' | 'favorite' | 'bookpack') => {
    if (type === 'history') {
      Taro.navigateTo({ url: '/pages/history/index' });
      return;
    }
    if (type === 'bookpack') {
      Taro.navigateTo({ url: '/pages/bookPacks/index' });
      return;
    }
    const ok = await startPractice(type);
    if (ok) Taro.navigateTo({ url: '/pages/practice/index' });
  };

  const handleIncrement = () => {
    const next = { ...userStats, todayDone: userStats.todayDone + 1 };
    setUserStats(next);
  };

  const progress = Math.min(100, (userStats.todayDone / userStats.todayGoal) * 100);

  return (
    <View className='home-page'>
      {/* 1. 轮播图 */}
      <Swiper
        className='swiper carousel'
        autoplay
        interval={5000}
        circular
        indicatorDots={false}
        onChange={(e) => setActiveSlide(e.detail.current)}
      >
        {CAROUSEL_ITEMS.map((item) => (
          <SwiperItem key={item.id}>
            <View
              className='carousel-item'
              style={{ backgroundImage: `url(${item.image})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              <View className='carousel-content'>
                <Text className='carousel-badge'>{item.badge}</Text>
                <Text className='carousel-title'>{item.title}</Text>
                <Text className='carousel-desc'>{item.desc}</Text>
              </View>
            </View>
          </SwiperItem>
        ))}
      </Swiper>

      {/* 2. 主入口 */}
      <View className='category-grid'>
        <View className='category-card' onClick={() => goToStudy('civil')}>
          <View className='category-info'>
            <Text className='category-name'>公务员考试</Text>
            <Text className='category-hint'>行政职业能力测验及申论考点精讲</Text>
            <Text className='category-link'>探索模块</Text>
          </View>
          <View className='category-icon-wrap civil-icon'>
            <Text className='category-icon-text'>🏛️</Text>
          </View>
        </View>

        <View className='category-card' onClick={() => goToStudy('teacher')}>
          <View className='category-info'>
            <Text className='category-name'>教师资格证</Text>
            <Text className='category-hint'>综合素质与教育教学知识深度解析</Text>
            <Text className='category-link teacher-link'>开始学习</Text>
          </View>
          <View className='category-icon-wrap teacher-icon'>
            <Text className='category-icon-text'>🎓</Text>
          </View>
        </View>
      </View>

      {/* 3. 学习工具箱 */}
      <View className='toolbox'>
        <Text className='section-label'>学习工具箱</Text>
        <View className='toolbox-grid'>
          {[
            { id: 'daily', name: '每日练题', icon: '📅' },
            { id: 'history', name: '历年真题', icon: '📜' },
            { id: 'mock', name: '全真模考', icon: '⏱️' },
            { id: 'bookpack', name: '图书礼包', icon: '📚' },
            { id: 'wrong', name: '错题本', icon: '❌' },
            { id: 'favorite', name: '我的收藏', icon: '🔖' },
          ].map((feat) => (
            <View key={feat.id} className='toolbox-item' onClick={() => handleSpecialQuiz(feat.id as any)}>
              <View className='toolbox-icon'>
                <Text>{feat.icon}</Text>
              </View>
              <Text className='toolbox-name'>{feat.name}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 4. 学习进度 */}
      <View className='dashboard'>
        <View className='dashboard-header'>
          <Text className='dashboard-title'>学习进度</Text>
          <Text className='dashboard-link' onClick={goToProfile}>详细报告</Text>
        </View>

        <View className='dashboard-grid'>
          {/* 今日做题数 */}
          <View className='stat-card'>
            <View className='stat-top'>
              <Text className='stat-label'>今日做题数</Text>
              <Text className='stat-value-big'>
                {userStats.todayDone}
                <Text className='stat-unit'> / {userStats.todayGoal}</Text>
              </Text>
              <View className='add-btn' onClick={handleIncrement}>
                <Text>+</Text>
              </View>
            </View>
            <View className='progress-bar'>
              <View className='progress-fill' style={{ width: `${progress}%` }} />
            </View>
          </View>

          {/* 今日正确率 */}
          <View className='stat-card'>
            <Text className='stat-label'>今日正确率</Text>
            <Text className='stat-value-big'>{userStats.accuracyRate}%</Text>
            <View className='accuracy-dots'>
              {Array.from({ length: 5 }).map((_, idx) => {
                const filled = idx < 4;
                return (
                  <View key={idx} className={`dot ${filled ? 'dot-filled' : ''}`}>
                    <Text>{filled ? '✓' : ''}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* 连续打卡 */}
          <View className='stat-card'>
            <Text className='stat-label'>连续打卡</Text>
            <Text className='stat-value-highlight'>
              {userStats.streakDays}
              <Text className='stat-unit'> 天</Text>
            </Text>
            <Text className='stat-streak-msg'>已击败全国 95% 考生</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
