import { View, Text } from '@tarojs/components';
import './index.scss';

export default function DebugPage() {
  return (
    <View className="debug-page">
      <Text className="debug-text">Hello Taro 小程序</Text>
      <Text className="debug-text">如果看到这段文字，说明基础渲染正常</Text>
    </View>
  );
}
