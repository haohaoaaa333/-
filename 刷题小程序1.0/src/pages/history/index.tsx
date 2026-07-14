import React, { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppState, showToast, loadModuleQuestions } from '../../store';
import './index.scss';

const ENV_ID = 'cloud1-d0gsr2l1ye6344917';

interface ModuleInfo {
  id: string;
  name: string;
  count: number;
  icon: string;
  desc: string;
}

const MODULES: ModuleInfo[] = [
  { id: 'mod_language',      name: '言语理解与表达', count: 0, icon: '💬', desc: '逻辑填空、阅读理解、语句表达' },
  { id: 'mod_common_sense',  name: '常识判断',       count: 0, icon: '📚', desc: '政治、经济、法律、历史、文化、地理、科技' },
  { id: 'mod_quantity',      name: '数量关系',       count: 0, icon: '🧮', desc: '数字推理、数学运算' },
  { id: 'mod_logic',         name: '判断推理',       count: 0, icon: '🧩', desc: '图形推理、定义判断、类比推理、逻辑判断' },
  { id: 'mod_data',          name: '资料分析',       count: 0, icon: '📊', desc: '图表分析、文字分析、综合计算' },
];

interface CountResult {
  counts: Record<string, number>;
  error?: string;
}

function ensureCloudInit(): void {
  try {
    const cloud = (Taro as any).cloud || (globalThis as any).wx?.cloud || null;
    if (cloud && !cloud.inited && ENV_ID) {
      cloud.init({ env: ENV_ID, traceUser: true });
    }
  } catch {
    // ignore
  }
}

async function fetchModuleCounts(): Promise<CountResult> {
  try {
    ensureCloudInit();
    // @ts-ignore
    const res = await Taro.cloud.callFunction({
      name: 'questions',
      data: { action: 'get_module_counts' },
    });
    const result = res.result as any;
    if (result && result.code === 0 && result.data) {
      return { counts: result.data.counts || {} };
    }
    const msg = result?.message || '云函数返回异常';
    console.error('[history] get_module_counts 返回:', result);
    return { counts: {}, error: msg };
  } catch (err: any) {
    const msg = err?.errMsg || err?.message || String(err);
    console.error('[history] 加载模块计数失败:', msg);
    return { counts: {}, error: msg };
  }
}

export default function HistoryPage() {
  const { setQuestions, isLightTheme } = useAppState();
  const [modules, setModules] = useState<ModuleInfo[]>(MODULES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const loadCounts = async () => {
    setLoading(true);
    setError(null);
    const result = await fetchModuleCounts();
    setModules(MODULES.map(m => ({ ...m, count: result.counts[m.id] || 0 })));
    if (result.error) setError(result.error);
    setLoading(false);
  };

  useEffect(() => {
    loadCounts();
  }, []);

  const handleModuleClick = async (m: ModuleInfo) => {
    setLoadingId(m.id);
    const ok = await loadModuleQuestions(m.id, setQuestions, 50);
    setLoadingId(null);
    if (ok) {
      Taro.navigateTo({ url: '/pages/practice/index' });
    }
  };

  const questionsAll = modules.reduce((sum, m) => sum + m.count, 0);

  return (
    <View className={`history-page ${isLightTheme ? 'theme-light' : ''}`}>
      <View className='history-header'>
        <Text className='history-title'>历年真题</Text>
        <Text className='history-subtitle'>
          {loading ? '加载中...' : `共 ${questionsAll} 道真题 · 5 大模块`}
        </Text>
      </View>

      {error && (
        <View className='history-error'>
          <Text className='error-text'>加载失败：{error}</Text>
          <Text className='retry-btn' onClick={loadCounts}>点击重试</Text>
        </View>
      )}
      {loading ? (
        <View className='history-loading'><Text className='loading-text'>正在加载模块数据...</Text></View>
      ) : (
        <View className='module-list'>
          {modules.map(m => (
            <View
              key={m.id}
              className={`module-card ${loadingId === m.id ? 'module-card-loading' : ''}`}
              onClick={() => handleModuleClick(m)}
            >
              <View className='module-icon-wrap'>
                <Text className='module-icon'>{m.icon}</Text>
              </View>
              <View className='module-info'>
                <Text className='module-name'>{m.name}</Text>
                <Text className='module-desc'>{m.desc}</Text>
                <View className='module-bottom'>
                  <Text className='module-count'>{m.count} 道真题</Text>
                  <Text className='module-arrow'>开始刷题 →</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
