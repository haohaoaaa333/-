import React from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import './index.scss';

export default function PrivacyPage() {
  return (
    <View className="privacy-page">
      <ScrollView className="privacy-scroll" scrollY enhanced showScrollbar={false}>
        <View className="privacy-content">
          <Text className="privacy-title">隐私政策</Text>
          <Text className="privacy-update">更新日期：2026年7月3日</Text>
          <Text className="privacy-update">生效日期：2026年7月3日</Text>

          <Text className="privacy-heading">一、引言</Text>
          <Text className="privacy-text">
            考公宝（以下简称"我们"）深知个人信息对您的重要性，并会尽全力保护您的个人信息安全。我们致力于维持您对我们的信任，恪守以下原则：权责一致原则、目的明确原则、选择同意原则、最少够用原则、确保安全原则、主体参与原则、公开透明原则等。同时，我们承诺将按业界成熟的安全标准，采取相应的安全保护措施来保护您的个人信息。
          </Text>

          <Text className="privacy-heading">二、我们如何收集和使用您的信息</Text>
          <Text className="privacy-text">
            2.1 在您使用考公宝服务的过程中，我们会按照如下方式收集您在使用服务时主动提供的或因为使用服务而产生的信息，用以向您提供服务、优化我们的服务以及保障您的账号安全：
          </Text>
          <Text className="privacy-text">
            2.2 当您使用考公宝小程序时，我们会在本地存储中保存您的学习进度、答题记录、错题本、收藏题目等学习数据。这些数据仅存储在您的设备本地，不会上传到我们的服务器，除非您主动开启云端同步功能。
          </Text>
          <Text className="privacy-text">
            2.3 若您使用云同步功能，我们将通过微信云开发（CloudBase）将您的学习数据同步至云端。您有权随时关闭云同步功能，关闭后相关数据仅保留在本地。
          </Text>

          <Text className="privacy-heading">三、信息的存储</Text>
          <Text className="privacy-text">
            3.1 信息存储的地点：您的学习数据默认仅存储在您的设备本地。开启云同步后，数据将存储于腾讯云 CloudBase 云数据库，存储地点为中国大陆。
          </Text>
          <Text className="privacy-text">
            3.2 信息存储的期限：您在本地存储的学习数据将一直保留，直至您主动清除缓存或卸载小程序。云端同步的数据将保留至您停止使用服务后或主动删除。
          </Text>

          <Text className="privacy-heading">四、信息安全</Text>
          <Text className="privacy-text">
            我们努力为用户的信息安全提供保障，以防止信息的丢失、不当使用、未经授权访问或披露。我们将在合理的安全水平内使用各种安全保护措施以保障信息的安全。
          </Text>

          <Text className="privacy-heading">五、您的权利</Text>
          <Text className="privacy-text">
            5.1 您可以通过点击"我的"页面中的"重置全部数据"按钮，一键清除所有本地存储的学习数据。
          </Text>
          <Text className="privacy-text">
            5.2 您可以随时在微信的"发现-小程序"中长按考公宝图标，选择删除，以移除所有本地数据。
          </Text>

          <Text className="privacy-heading">六、未成年人保护</Text>
          <Text className="privacy-text">
            我们非常重视对未成年人个人信息的保护。若您是18周岁以下的未成年人，在使用我们的服务前，应事先取得您监护人的同意。
          </Text>

          <Text className="privacy-heading">七、隐私政策的更新</Text>
          <Text className="privacy-text">
            我们可能会适时对本隐私政策进行修订。当隐私政策的条款发生变更时，我们会在版本更新时以适当的方式向您提示变更后的隐私政策。请您仔细阅读变更后的隐私政策内容，您继续使用考公宝表示您同意我们按照更新后的隐私政策处理您的个人信息。
          </Text>

          <Text className="privacy-heading">八、联系我们</Text>
          <Text className="privacy-text">
            如果您对本隐私政策有任何疑问、意见或建议，可以通过以下方式与我们联系：发送邮件至 exampreppro@example.com，我们将在15个工作日内回复。
          </Text>

          <View className="privacy-footer-space" />
        </View>
      </ScrollView>
    </View>
  );
}
