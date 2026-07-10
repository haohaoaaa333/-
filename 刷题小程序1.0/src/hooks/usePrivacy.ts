import { useState, useEffect, useCallback } from 'react';
import Taro from '@tarojs/taro';

/**
 * 隐私政策同意状态 hook
 * @returns [showPopup, agreePrivacy]
 * - showPopup: boolean，是否还需要显示隐私弹窗
 * - agreePrivacy: () => void，用户点击同意时调用
 */
export function usePrivacyAgreed(): [boolean, () => void] {
  const [agreed, setAgreed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = Taro.getStorageSync('privacy_agreed');
      setAgreed(stored === true);
    } catch {
      setAgreed(false);
    }
    setReady(true);
  }, []);

  const agreePrivacy = useCallback(() => {
    Taro.setStorageSync('privacy_agreed', true);
    Taro.setStorageSync('privacy_agreed_at', Date.now());
    setAgreed(true);
  }, []);

  return [ready && !agreed, agreePrivacy];
}
