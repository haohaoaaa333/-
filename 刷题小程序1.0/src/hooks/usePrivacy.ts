import { useState, useEffect, useCallback } from 'react';
import Taro from '@tarojs/taro';
import {
  getPrivacyPreferences,
  PRIVACY_PREFERENCES_EVENT,
  setCloudSyncEnabled,
  setPrivacyConsent,
} from '../utils/privacy';

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
      setAgreed(getPrivacyPreferences().agreed);
    } catch {
      setAgreed(false);
    }
    setReady(true);
  }, []);

  const agreePrivacy = useCallback(() => {
    setPrivacyConsent(true);
    setAgreed(true);
  }, []);

  return [ready && !agreed, agreePrivacy];
}

export function usePrivacyPreferences() {
  const [preferences, setPreferences] = useState(getPrivacyPreferences);

  useEffect(() => {
    const update = () => setPreferences(getPrivacyPreferences());
    Taro.eventCenter.on(PRIVACY_PREFERENCES_EVENT, update);
    return () => {
      Taro.eventCenter.off(PRIVACY_PREFERENCES_EVENT, update);
    };
  }, []);

  const toggleCloudSync = useCallback(() => {
    const next = !getPrivacyPreferences().cloudSyncEnabled;
    const changed = setCloudSyncEnabled(next);
    if (changed) setPreferences(getPrivacyPreferences());
    return changed;
  }, []);

  return { ...preferences, toggleCloudSync };
}
