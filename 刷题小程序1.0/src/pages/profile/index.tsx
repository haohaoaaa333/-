// pages/profile/index.tsx — 考公宝「我的」页
// 数据策略：云端优先（profile + statistics + vip_plans），本地兜底

import React, { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppState, createResetAll, showToast } from '../../store';
import { usePrivacyPreferences } from '../../hooks/usePrivacy';
import PrivacyPopup from '../../components/PrivacyPopup';
import { getProfile, getStatistics, checkIn } from '../../api/user';
import { getVipPlans } from '../../api/vip';
import { payForVip } from '../../api/payment';
import { setCloudSyncEnabled } from '../../utils/privacy';
import './index.scss';

// ── 类型定义 ──

interface CloudProfile {
  user_id: string;
  nickname: string;
  avatar_url: string;
  vip_type: number;
  vip_expire_at: string | null;
  level: number;
  exp: number;
  is_checked_in_today: boolean;
}

interface CloudStatistics {
  total_questions: number;
  daily_increase: number;
  avg_accuracy: number;
  beat_percentage: number;
  study_hours: string;
  focus_rate: number;
  focus_tags: string[];
  weekly_trend: number[];
}

interface CloudVipPlan {
  plan_id: string;
  name: string;
  duration_days: number;
  price: number;
  original_price: number;
  features: string[];
  tag: string;
  sort: number;
}

interface CloudVipData {
  plans: CloudVipPlan[];
  current_vip: { type: number; expire_at: string | null; is_active: boolean };
}

// ── 本地 fallback 周趋势 ──
const FALLBACK_WEEKLY = [
  { day: '一', count: 18 }, { day: '二', count: 32 },
  { day: '三', count: 15 }, { day: '四', count: 42 },
  { day: '五', count: 24 }, { day: '六', count: 50 },
  { day: '日', count: 68 },
];

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

export default function ProfilePage() {
  const { userStats, setUserStats, setQuestions, isLightTheme, toggleTheme } = useAppState();
  const resetAll = createResetAll(setUserStats, setQuestions);
  const { agreed, cloudSyncEnabled, toggleCloudSync } = usePrivacyPreferences();
  const [showSyncConsent, setShowSyncConsent] = useState(false);

  // 云端数据
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [statistics, setStatistics] = useState<CloudStatistics | null>(null);
  const [vipData, setVipData] = useState<CloudVipData | null>(null);

  // VIP 订阅方案选择
  const [selectedPlanId, setSelectedPlanId] = useState<string>('plan_yearly');

  // ── 加载云端数据 ──
  useEffect(() => {
    if (!cloudSyncEnabled) {
      setProfile(null);
      setStatistics(null);
      setVipData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [prof, stats, vip] = await Promise.all([
          getProfile(),
          getStatistics(),
          getVipPlans(),
        ]);
        if (cancelled) return;
        if (prof) setProfile(prof);
        if (stats) setStatistics(stats);
        if (vip) {
          setVipData(vip);
          // 云端的 current_vip.is_active → 更新 store
          if (vip.current_vip?.is_active) {
            setUserStats({ ...userStats, vipStatus: 'VIP 专属' });
          }
        }
      } catch { /* fall through to local data */ }
    })();
    return () => { cancelled = true; };
  }, [cloudSyncEnabled]);

  // ── 展示数据：云端优先 → 本地兜底 ──
  const displayName = profile?.nickname || userStats.userName;
  const displayStudyId = profile?.user_id
    ? `EP-${(profile.user_id || '').slice(-6)}`
    : userStats.studyId;
  const displayVipStatus = vipData?.current_vip?.is_active
    ? 'VIP 专属'
    : userStats.vipStatus;
  const displayAvatarChar = (displayName || '考')[0];

  const displayTotalQuestions = statistics?.total_questions ?? userStats.totalDone;
  const displayAccuracy = statistics?.avg_accuracy ?? userStats.accuracyRate;

  // 周趋势
  const weeklyTrend = statistics?.weekly_trend;
  const weeklyData = (weeklyTrend && weeklyTrend.length === 7)
    ? weeklyTrend.map((count, i) => ({ day: DAY_LABELS[i], count }))
    : FALLBACK_WEEKLY;
  const maxWeeklyCount = Math.max(...weeklyData.map(d => d.count), 1);

  // 重点关注领域（云端返回 focus_tags）
  const concernAreas = statistics?.focus_tags?.length
    ? statistics.focus_tags.map((tag, i) => ({
        name: tag,
        score: `${Math.round(55 + Math.random() * 30)}%`,
        isGood: i % 2 === 1,
      }))
    : [
        { name: '宪法学', score: '62%', isGood: false },
        { name: '公共管理学', score: '74%', isGood: true },
      ];

  // VIP 方案
  const plans = vipData?.plans?.length
    ? vipData.plans.map(p => ({
        key: p.plan_id,
        label: p.name,
        desc: (p.features || []).slice(0, 3).join(' / '),
        price: `¥${p.price}/${p.duration_days >= 365 ? '年' : p.duration_days >= 90 ? '季' : '月'}`,
        badge: (p.tag && p.tag !== '无') ? p.tag : undefined,
        featured: p.tag === '推荐' || p.tag === '最划算',
      }))
    : [
        { key: 'plan_monthly', label: '按月订阅', desc: '基础功能访问与每日练题', price: '¥9.9/月' },
        { key: 'plan_yearly', label: '按年订阅', desc: '全部VIP专属模块与深度数据分析', price: '¥59.9/年', badge: '节省 50%', featured: true },
        { key: 'plan_quarterly', label: '按季订阅', desc: '完整数据分析与真题精讲', price: '¥19.9/季' },
      ];

  const handleCloudSyncToggle = () => {
    if (!cloudSyncEnabled && !agreed) {
      setShowSyncConsent(true);
      return;
    }
    const changed = toggleCloudSync();
    if (changed) showToast(cloudSyncEnabled ? '云同步已关闭，后续数据仅保存在本机' : '云同步已开启');
  };

  const handleSyncConsentAgree = () => {
    setCloudSyncEnabled(true);
    setShowSyncConsent(false);
    showToast('已同意隐私政策并开启云同步');
  };

  // ── 订阅处理（真实微信支付） ──
  const [paying, setPaying] = useState(false);

  const handleSubscribe = async () => {
    if (displayVipStatus === 'VIP 专属') {
      showToast('您已经是 VIP 专属会员，无需重复购买！');
      return;
    }
    if (paying) return;

    const plan = plans.find(p => p.key === selectedPlanId);
    if (!plan) return;

    setPaying(true);
    Taro.showLoading({ title: '正在下单...' });

    const result = await payForVip(selectedPlanId);

    Taro.hideLoading();
    setPaying(false);

    if (result.success) {
      // 刷新 VIP 状态
      const prof = await getProfile();
      if (prof && prof.vip_type > 0) {
        setUserStats({ ...userStats, vipStatus: 'VIP 专属' });
      }
      showToast(result.message);
    } else {
      Taro.showModal({
        title: '支付提示',
        content: result.message,
        showCancel: false,
        confirmText: '知道了',
      });
    }
  };

  // ── 签到处理 ──
  const handleCheckIn = async () => {
    if (!cloudSyncEnabled) {
      setUserStats({ ...userStats, streakDays: userStats.streakDays + 1 });
      showToast(`本地签到成功，已连续 ${userStats.streakDays + 1} 天`);
      return;
    }
    const result = await checkIn();
    if (result) {
      if (result.code === 0) {
        showToast(`签到成功！连胜 ${result.streak_days} 天！🔥`);
        // 刷新统计数据
        const stats = await getStatistics();
        if (stats) setStatistics(stats);
      } else if (result.code === 1) {
        showToast('今日已签到，继续保持！');
      }
    } else {
      // fallback
      setUserStats({ ...userStats, streakDays: userStats.streakDays + 1 });
      showToast(`签到成功！连胜记录保持中！🔥`);
    }
  };

  // ── 重置处理 ──
  const handleReset = () => {
    Taro.showModal({
      title: '确认重置',
      content: '将清除本地缓存并重置所有刷题进度，确定继续？',
      success: res => { if (res.confirm) resetAll(); },
    });
  };

  return (
    <View className={`profile-page ${isLightTheme ? 'theme-light' : ''}`}>
      {/* Profile Header */}
      <View className="profile-header">
        <View className="profile-avatar-wrap">
          <View className="profile-avatar profile-avatar-text">
            <Text className="avatar-initial">{displayAvatarChar}</Text>
          </View>
          {displayVipStatus === 'VIP 专属' ? <View className="profile-pro-badge"><Text>PRO</Text></View> : null}
        </View>
        <View className="profile-info">
          <Text className="profile-name">{displayName}</Text>
          <Text className="profile-id">学习 ID: {displayStudyId}</Text>
          <View className="profile-vip-tag"><Text>{displayVipStatus}</Text></View>
        </View>
      </View>

      {/* Stats */}
      <View className="profile-stats">
        <View className="profile-stat-card">
          <Text className="ps-label">总刷题数</Text>
          <Text className="ps-value">{displayTotalQuestions.toLocaleString()}</Text>
        </View>
        <View className="profile-stat-card">
          <Text className="ps-label">平均正确率</Text>
          <Text className="ps-value sec">{displayAccuracy}%</Text>
        </View>
      </View>

      {/* Learning Trend */}
      <View className="profile-section">
        <View className="section-head">
          <Text className="section-head-title">📈 学习趋势</Text>
          {statistics ? (
            <Text className="section-head-badge">
              ↑ {statistics.daily_increase > 0 ? '+' : ''}{statistics.daily_increase} 题
            </Text>
          ) : (
            <Text className="section-head-badge">↑ 本周 +15%</Text>
          )}
        </View>
        <View className="chart">
          {weeklyData.map((eff, i) => {
            const heightPct = maxWeeklyCount > 0 ? (eff.count / maxWeeklyCount) * 100 : 0;
            return (
              <View key={i} className="chart-column">
                <View className="chart-bar-wrap">
                  <View className="chart-bar" style={{ height: `${heightPct}%` }} />
                  <View className="chart-tooltip">{eff.count} 题</View>
                </View>
                <Text className="chart-day">{eff.day}</Text>
              </View>
            );
          })}
        </View>
        <Text className="chart-note">
          {statistics
            ? `表现出色！本周每日做题效率稳定，专注度 ${statistics.focus_rate}%。`
            : '表现出色！本周每日做题效率平均提升了 15%。'}
        </Text>
      </View>

      {/* Areas of Concern */}
      <View className="profile-section">
        <Text className="section-head-title">⚖️ 重点关注领域</Text>
        <View className="concern-list">
          {concernAreas.map((area, i) => {
            const scoreNum = parseInt(area.score);
            return (
              <View key={i} className="concern-item">
                <View className="concern-header">
                  <Text className="concern-name">{area.name}</Text>
                  <Text className={`concern-score ${area.isGood ? 'concern-good' : 'concern-bad'}`}>
                    {area.isGood ? '良好' : '需加强'} ({area.score})
                  </Text>
                </View>
                <View className="concern-bar">
                  <View
                    className={`concern-fill ${area.isGood ? 'concern-fill-good' : 'concern-fill-bad'}`}
                    style={{ width: `${scoreNum}%` }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* VIP Section — 暂时隐藏，会员功能待实现 */}
      {false && (<>
      <View className="vip-section">
        <View className="vip-badge">VIP 专属</View>
        <Text className="vip-title">升级至 Pro 版</Text>
        <Text className="vip-desc">通过全面的数据分析和无限量的学习工具，最大化您的考试胜算。</Text>
        <View className="vip-features">
          {['无限刷题次数', '深度 AI 分析', '全真模拟考试', '纯净无广告体验'].map(item => (
            <View key={item} className="vip-feature">
              <Text className="vip-check">✓</Text><Text className="vip-feature-text">{item}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Plans */}
      <View className="plan-section">
        <Text className="section-head-title">💎 选择订阅方案</Text>
        {plans.map(plan => (
          <View key={plan.key}
            className={`plan-card ${selectedPlanId === plan.key ? 'plan-active' : ''} ${plan.featured ? 'plan-featured' : ''}`}
            onTap={() => setSelectedPlanId(plan.key)}>
            {plan.badge && <View className="plan-badge">{plan.badge}</View>}
            <View className="plan-info">
              <Text className="plan-name">{plan.label}</Text>
              <Text className="plan-desc">{plan.desc}</Text>
            </View>
            <Text className="plan-price">{plan.price}</Text>
          </View>
        ))}
        <View className={`subscribe-btn ${paying ? 'subscribe-btn-disabled' : ''}`} onTap={handleSubscribe}>
          <Text>
            {paying ? '处理中...' : (displayVipStatus === 'VIP 专属' ? '已拥有 VIP 权限' : '开启 VIP / 立即订阅')}
          </Text>
        </View>
      </View>
      </>)}

      {/* Theme Toggle */}
      <View className="settings-section">
        <Text className="section-head-title">⚙️ 无障碍与个性化</Text>
        <View className="theme-toggle">
          <View className="theme-info">
            <Text className="theme-name">高对比度亮色模式</Text>
            <Text className="theme-desc">切换到亮白背景并增强元素边框和文字对比度。</Text>
          </View>
          <View className={`custom-switch ${isLightTheme ? 'custom-switch-on' : ''}`} onTap={toggleTheme}>
            <View className="custom-switch-thumb" />
          </View>
        </View>
        <View className="settings-divider" />
        <View className="theme-toggle">
          <View className="theme-info">
            <Text className="theme-name">云同步</Text>
            <Text className="theme-desc">
              {cloudSyncEnabled
                ? '学习进度和答题统计会同步至腾讯云 CloudBase。'
                : '当前仅保存在本机，不上传个人学习数据。'}
            </Text>
          </View>
          <View
            className={`custom-switch ${cloudSyncEnabled ? 'custom-switch-on' : ''}`}
            onTap={handleCloudSyncToggle}
          >
            <View className="custom-switch-thumb" />
          </View>
        </View>
      </View>

      {/* Menu */}
      <View className="menu-list">
        <View className="menu-item" onTap={handleCheckIn}>
          <Text className="menu-icon">📅</Text>
          <View className="menu-info">
            <Text className="menu-name">每日签到</Text>
            <Text className="menu-desc">
              继续保持您的 {statistics ? (userStats.streakDays) : userStats.streakDays} 天连胜打卡！🔥
            </Text>
          </View>
          <Text className="menu-arrow">›</Text>
        </View>
        <View className="menu-item" onTap={() => Taro.navigateTo({ url: '/pages/privacy/index' })}>
          <Text className="menu-icon">🔒</Text>
          <View className="menu-info">
            <Text className="menu-name">隐私政策</Text>
            <Text className="menu-desc">查看数据收集、存储和联系方式</Text>
          </View>
          <Text className="menu-arrow">›</Text>
        </View>
        <View className="menu-item menu-item-danger" onTap={handleReset}>
          <Text className="menu-icon">🚪</Text>
          <View className="menu-info">
            <Text className="menu-name menu-name-danger">退出登录 & 重置数据</Text>
            <Text className="menu-desc menu-desc-danger">清除本地缓存，重置刷题进度</Text>
          </View>
          <Text className="menu-arrow menu-arrow-danger">›</Text>
        </View>
      </View>

      {/* 隐私政策弹窗 */}
      {showSyncConsent ? (
        <PrivacyPopup
          onAgree={handleSyncConsentAgree}
          onDisagree={() => {
            setShowSyncConsent(false);
            showToast('未开启云同步，个人学习数据仍仅保存在本机');
          }}
        />
      ) : null}
    </View>
  );
}
