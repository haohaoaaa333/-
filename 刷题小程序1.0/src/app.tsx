import { PropsWithChildren, useEffect, useState, useCallback } from 'react';
import Taro from '@tarojs/taro';
import PrivacyPopup from './components/PrivacyPopup';
import { usePrivacyAgreed } from './hooks/usePrivacy';
import { hasPrivacyConsent } from './utils/privacy';
import './app.scss';

// 云开发环境 ID —— 与 project.config.json / 云开发控制台一致
const ENV_ID = 'cloud1-d0gsr2l1ye6344917';

// 在应用启动时立即初始化云开发（模块顶层执行，保证在页面渲染前完成）
try {
  const cloud = (Taro as any).cloud || (globalThis as any).wx?.cloud || null;
  if (cloud && ENV_ID) {
    cloud.init({ env: ENV_ID, traceUser: true });
    console.log('[App] 云开发已初始化');
  } else {
    console.warn('[App] 未找到 cloud 实例或 ENV_ID 未配置');
  }
} catch (err) {
  console.error('[App] 云开发初始化失败:', err);
}

function App({ children }: PropsWithChildren<object>) {
  const [showPopup, agreePrivacy] = usePrivacyAgreed();
  const [forceShow, setForceShow] = useState(false);
  const [officialResolve, setOfficialResolve] = useState<((result: {
    event: 'agree' | 'disagree';
    buttonId?: string;
  }) => void) | null>(null);

  // 接入微信官方隐私接口：当小程序调用隐私相关 API（如登录、获取手机号等）
  // 且用户尚未同意时，弹出隐私授权；同意后再放行原接口调用。
  useEffect(() => {
    const w = (globalThis as any).wx || null;
    if (!w || typeof w.onNeedPrivacyAuthorize !== 'function') return;
    w.onNeedPrivacyAuthorize((resolve: (result: { event: 'agree' | 'disagree'; buttonId?: string }) => void) => {
      if (hasPrivacyConsent()) {
        resolve({ event: 'agree', buttonId: 'privacy-agree' });
        return;
      }
      setOfficialResolve(() => resolve);
      setForceShow(true);
    });
  }, []);

  const handleAgree = useCallback(() => {
    agreePrivacy();
    setForceShow(false);
    if (officialResolve) {
      officialResolve({ event: 'agree', buttonId: 'privacy-agree' });
      setOfficialResolve(null);
    }
  }, [agreePrivacy, officialResolve]);

  const handleDisagree = useCallback(() => {
    Taro.showToast({ title: '已进入本地模式，云同步保持关闭', icon: 'none' });
    setForceShow(false);
    if (officialResolve) {
      officialResolve({ event: 'disagree' });
      setOfficialResolve(null);
    }
  }, [officialResolve]);

  const popupVisible = process.env.TARO_ENV !== 'h5' && (forceShow || showPopup);

  return (
    <>
      {children}
      {popupVisible && (
        <PrivacyPopup onAgree={handleAgree} onDisagree={handleDisagree} />
      )}
    </>
  );
}

export default App;
