import Taro from '@tarojs/taro';

export const PRIVACY_AGREED_KEY = 'privacy_agreed';
export const PRIVACY_AGREED_AT_KEY = 'privacy_agreed_at';
export const CLOUD_SYNC_ENABLED_KEY = 'cloud_sync_enabled';
export const PRIVACY_PREFERENCES_EVENT = 'privacy-preferences-changed';

export interface PrivacyPreferences {
  agreed: boolean;
  cloudSyncEnabled: boolean;
}

export function hasPrivacyConsent(): boolean {
  try {
    return Taro.getStorageSync(PRIVACY_AGREED_KEY) === true;
  } catch {
    return false;
  }
}

export function isCloudSyncEnabled(): boolean {
  try {
    return hasPrivacyConsent() && Taro.getStorageSync(CLOUD_SYNC_ENABLED_KEY) === true;
  } catch {
    return false;
  }
}

export function getPrivacyPreferences(): PrivacyPreferences {
  return {
    agreed: hasPrivacyConsent(),
    cloudSyncEnabled: isCloudSyncEnabled(),
  };
}

function notifyPreferencesChanged(): void {
  Taro.eventCenter.trigger(PRIVACY_PREFERENCES_EVENT, getPrivacyPreferences());
}

export function setPrivacyConsent(agreed: boolean): void {
  Taro.setStorageSync(PRIVACY_AGREED_KEY, agreed);
  if (agreed) {
    Taro.setStorageSync(PRIVACY_AGREED_AT_KEY, Date.now());
  } else {
    Taro.removeStorageSync(PRIVACY_AGREED_AT_KEY);
    Taro.setStorageSync(CLOUD_SYNC_ENABLED_KEY, false);
  }
  notifyPreferencesChanged();
}

export function setCloudSyncEnabled(enabled: boolean): boolean {
  if (enabled && !hasPrivacyConsent()) return false;
  Taro.setStorageSync(CLOUD_SYNC_ENABLED_KEY, enabled);
  notifyPreferencesChanged();
  return true;
}

export function canUsePersonalCloudData(): boolean {
  return isCloudSyncEnabled();
}
