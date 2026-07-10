import React from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import './index.scss';

export default function TermsPage() {
  return (
    <View className="terms-page">
      <ScrollView className="terms-scroll" scrollY enhanced showScrollbar={false}>
        <View className="terms-content">
          <Text className="terms-title">用户协议</Text>
          <Text className="terms-update">更新日期：2026年7月3日</Text>
          <Text className="terms-update">生效日期：2026年7月3日</Text>

          <Text className="terms-heading">一、总则</Text>
          <Text className="terms-text">
            1.1 欢迎使用考公宝小程序（以下简称"本服务"）。本协议是您与考公宝之间关于使用本服务所订立的协议。
          </Text>
          <Text className="terms-text">
            1.2 请您在使用本服务前仔细阅读并充分理解本协议的全部内容。您通过勾选"同意"或使用本服务，即表示您已阅读、理解并同意接受本协议的全部条款。
          </Text>

          <Text className="terms-heading">二、服务内容</Text>
          <Text className="terms-text">
            2.1 考公宝为您提供公务员考试相关的在线学习服务，包括但不限于：题库练习、错题本、模拟考试、学习进度跟踪等功能。
          </Text>
          <Text className="terms-text">
            2.2 部分高级功能（如VIP专属题库、申论范文等）可能需要付费订阅后使用。具体收费标准以产品内展示为准。
          </Text>

          <Text className="terms-heading">三、用户行为规范</Text>
          <Text className="terms-text">
            3.1 您承诺在使用本服务过程中遵守中华人民共和国法律法规，不得利用本服务从事违法违规行为。
          </Text>
          <Text className="terms-text">
            3.2 您不得对本服务的任何部分进行反向工程、反向编译或试图获取源代码。
          </Text>
          <Text className="terms-text">
            3.3 您不得以任何方式干扰或破坏本服务的正常运行。
          </Text>

          <Text className="terms-heading">四、知识产权</Text>
          <Text className="terms-text">
            4.1 本服务中包含的所有内容（包括但不限于文字、图片、音频、视频、图表、界面设计、程序代码等）均受著作权法、商标法等相关法律法规的保护。
          </Text>
          <Text className="terms-text">
            4.2 未经我们书面许可，您不得以任何形式复制、转载、传播或用于商业用途。
          </Text>

          <Text className="terms-heading">五、免责声明</Text>
          <Text className="terms-text">
            5.1 本服务提供的学习内容仅供学习参考，不构成任何考试承诺或保证。实际考试内容以官方公布为准。
          </Text>
          <Text className="terms-text">
            5.2 由于网络、设备等原因可能导致服务中断或数据延迟，我们会尽力保障服务稳定，但不对不可抗力造成的服务中断承担责任。
          </Text>

          <Text className="terms-heading">六、协议修改</Text>
          <Text className="terms-text">
            6.1 我们可能根据法律法规或业务需要随时修改本协议。修改后的协议将在本页面发布，您继续使用本服务即视为同意修改后的协议。
          </Text>

          <Text className="terms-heading">七、其他</Text>
          <Text className="terms-text">
            7.1 本协议的订立、执行和解释及争议的解决均适用中华人民共和国法律。
          </Text>
          <Text className="terms-text">
            7.2 如本协议中的任何条款无论因何种原因完全或部分无效或不具有执行力，本协议的其余条款仍应有效并且有约束力。
          </Text>

          <View className="terms-footer-space" />
        </View>
      </ScrollView>
    </View>
  );
}
