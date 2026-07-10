import React, { useState, useEffect } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import './index.scss';

interface Props {
  onAgree: () => void;
  onDisagree: () => void;
}

const PrivacyPopup: React.FC<Props> = ({ onAgree, onDisagree }) => {
  const [visible, setVisible] = useState(true);

  const handleAgree = () => {
    Taro.setStorageSync('privacy_agreed', true);
    Taro.setStorageSync('privacy_agreed_at', Date.now());
    setVisible(false);
    onAgree();
  };

  const handleDisagree = () => {
    setVisible(false);
    onDisagree();
  };

  const goToPrivacy = () => {
    Taro.navigateTo({ url: '/pages/privacy/index' });
  };

  const goToTerms = () => {
    Taro.navigateTo({ url: '/pages/terms/index' });
  };

  if (!visible) return null;

  return (
    <View className="privacy-overlay">
      <View className="privacy-dialog">
        <View className="privacy-dialog-title">欢迎使用 考公宝</View>

        <View className="privacy-dialog-body">
          <Text className="privacy-dialog-text">
            感谢您信任并使用考公宝。我们深知个人信息对您的重要性，并会严格遵守法律法规，保护您的信息安全。
          </Text>
          <Text className="privacy-dialog-text">
            请您仔细阅读并充分理解
            <Text className="privacy-link" onTap={goToPrivacy}>《隐私政策》</Text>
            和
            <Text className="privacy-link" onTap={goToTerms}>《用户协议》</Text>
            的全部内容。如您同意，请点击"同意并继续"开始使用我们的服务。
          </Text>
        </View>

        <View className="privacy-dialog-footer">
          <Button className="privacy-btn privacy-btn-cancel" onClick={handleDisagree}>
            不同意
          </Button>
          <Button className="privacy-btn privacy-btn-confirm" onClick={handleAgree}>
            同意并继续
          </Button>
        </View>
      </View>
    </View>
  );
};

export default PrivacyPopup;
