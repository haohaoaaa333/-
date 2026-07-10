import { PropsWithChildren, useEffect, useState, useCallback } from 'react';
import Taro from '@tarojs/taro';
import PrivacyPopup from './components/PrivacyPopup';
import { usePrivacyAgreed } from './hooks/usePrivacy';
import './app.scss';

// 云开发环境 ID —— 与 project.config.json / 云开发控制台一致
const ENV_ID = 'cloud1-d0gsr2l1ye6344917';

// 在应用启动时立即初始化云开发（模块顶层执行，保证在页面渲染前完成）
try {
  const cloud = (Taro as any).cloud || (typeof wx !== 'undefined' ? (wx as any).cloud : null);
  if (cloud && ENV_ID && ENV_ID !== 'your-cloudbase-env-id') {
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
  const [officialResolve, setOfficialResolve] = useState<(() => void) | null>(null);

  // 接入微信官方隐私接口：当小程序调用隐私相关 API（如登录、获取手机号等）
  // 且用户尚未同意时，弹出隐私授权；同意后再放行原接口调用。
  useEffect(() => {
    const w = typeof wx !== 'undefined' ? (wx as any) : null;
    if (!w || typeof w.onNeedPrivacyAuthorize !== 'function') return;
    w.onNeedPrivacyAuthorize((resolve: () => void) => {
      if (Taro.getStorageSync('privacy_agreed') === true) {
        resolve();
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
      officialResolve();
      setOfficialResolve(null);
    }
  }, [agreePrivacy, officialResolve]);

  const handleDisagree = useCallback(() => {
    Taro.showToast({ title: '请先同意隐私政策后使用', icon: 'none' });
    setForceShow(false);
  }, []);

  const popupVisible = forceShow || showPopup;

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
