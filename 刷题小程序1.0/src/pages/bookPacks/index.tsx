// pages/bookPacks/index.tsx - 图书礼包（PDF / Word 下载）
import React, { useEffect, useState } from 'react';
import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { callCloudFunction } from '../../api/base';
import { showToast } from '../../store';
import './index.scss';

interface BookPack {
  _id: string;
  title: string;
  description?: string;
  category?: string;
  file_type: 'pdf' | 'word';
  file_id: string;
  file_name?: string;
  file_size?: number;
  cover_url?: string;
}

type DocumentFileType = 'pdf' | 'doc' | 'docx';

const ENV_ID = 'cloud1-d0gsr2l1ye6344917';

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getOpenFileType(pack: BookPack): DocumentFileType {
  const extension = String(pack.file_name || '').split('.').pop()?.toLowerCase();
  if (extension === 'doc') return 'doc';
  if (extension === 'docx') return 'docx';
  return pack.file_type === 'word' ? 'docx' : 'pdf';
}

function getCloudApi(): any {
  return (Taro as any).cloud || (globalThis as any).wx?.cloud || null;
}

function ensureCloudInit(): any {
  const cloud = getCloudApi();
  if (!cloud) return null;
  try {
    if (!cloud.inited && ENV_ID) {
      cloud.init({ env: ENV_ID, traceUser: true });
    }
  } catch {
    // The app-level initializer may already have initialized CloudBase.
  }
  return cloud;
}

function downloadCloudFile(cloud: any, fileId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    cloud.downloadFile({
      fileID: fileId,
      success: resolve,
      fail: reject,
    });
  });
}

function getTempFileUrl(cloud: any, fileId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cloud.getTempFileURL({
      fileList: [fileId],
      success: (response: any) => {
        const fileList = response?.fileList
          || response?.result?.fileList
          || response?.data?.fileList
          || [];
        const file = fileList[0];
        if (file?.tempFileURL) {
          resolve(file.tempFileURL);
          return;
        }
        reject(new Error(file?.status || '获取下载链接失败'));
      },
      fail: reject,
    });
  });
}

function downloadByUrl(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    Taro.downloadFile({
      url,
      success: resolve,
      fail: reject,
    });
  });
}

function openDocument(filePath: string, fileType: DocumentFileType): Promise<void> {
  return new Promise((resolve, reject) => {
    Taro.openDocument({
      filePath,
      fileType,
      showMenu: true,
      success: () => resolve(),
      fail: reject,
    });
  });
}

export default function BookPacksPage() {
  const [packs, setPacks] = useState<BookPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        ensureCloudInit();
        const data = await callCloudFunction('bookPacks', { action: 'get_packs' });
        if (cancelled) return;
        if (data && Array.isArray(data.list)) {
          setPacks(data.list);
        } else if (Array.isArray(data)) {
          setPacks(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleOpen = async (pack: BookPack) => {
    if (downloadingId) return;
    if (!pack.file_id) {
      showToast('该资料暂无可下载文件');
      return;
    }

    setDownloadingId(pack._id);
    Taro.showLoading({ title: '正在打开...' });
    try {
      const cloud = ensureCloudInit();
      if (!cloud) throw new Error('云开发尚未初始化');

      let downloadResult: any;
      try {
        downloadResult = await downloadCloudFile(cloud, pack.file_id);
      } catch (directDownloadError) {
        console.warn('[bookPacks] 云存储直传下载失败，改用临时链接:', directDownloadError);
        const tempFileUrl = await getTempFileUrl(cloud, pack.file_id);
        downloadResult = await downloadByUrl(tempFileUrl);
      }

      if (!downloadResult?.tempFilePath) {
        throw new Error('文件下载完成，但未返回本地文件路径');
      }
      if (downloadResult.statusCode && downloadResult.statusCode !== 200) {
        throw new Error(`文件下载失败（HTTP ${downloadResult.statusCode}）`);
      }

      await openDocument(downloadResult.tempFilePath, getOpenFileType(pack));
    } catch (error: any) {
      const message = error?.errMsg || error?.message || String(error);
      console.error('[bookPacks] 打开失败:', {
        message,
        fileId: pack.file_id,
        fileName: pack.file_name,
      });
      showToast(message.includes('does not exist') ? '文件不存在，请联系管理员重新上传' : '文件打开失败，请稍后重试');
    } finally {
      Taro.hideLoading();
      setDownloadingId(null);
    }
  };

  return (
    <View className='bookpack-page'>
      <View className='bookpack-header'>
        <Text className='bookpack-title'>图书礼包</Text>
        <Text className='bookpack-sub'>精选备考资料，点击即可下载并查看</Text>
      </View>

      {loading ? (
        <View className='bookpack-loading'>
          <Text>资料加载中...</Text>
        </View>
      ) : packs.length === 0 ? (
        <View className='bookpack-empty'>
          <Text className='empty-icon'>PDF</Text>
          <Text className='empty-text'>暂无可下载的图书资料</Text>
          <Text className='empty-hint'>后台上传后将在这里显示</Text>
        </View>
      ) : (
        <View className='bookpack-list'>
          {packs.map((pack) => (
            <View key={pack._id} className='bookpack-card'>
              <View className='bookpack-card-icon'>
                <Text>{pack.file_type === 'word' ? 'DOC' : 'PDF'}</Text>
              </View>
              <View className='bookpack-card-body'>
                <View className='bookpack-card-title-row'>
                  <Text className='bookpack-card-title'>{pack.title}</Text>
                  <Text className={`bookpack-type-badge ${pack.file_type}`}>
                    {pack.file_type === 'word' ? 'WORD' : 'PDF'}
                  </Text>
                </View>
                {pack.description ? (
                  <Text className='bookpack-card-desc'>{pack.description}</Text>
                ) : null}
                <View className='bookpack-card-meta'>
                  {pack.category ? <Text className='bookpack-cat'>{pack.category}</Text> : null}
                  {pack.file_size ? <Text className='bookpack-size'>{formatSize(pack.file_size)}</Text> : null}
                </View>
              </View>
              <View
                className={`bookpack-download-btn ${downloadingId === pack._id ? 'is-loading' : ''}`}
                onTap={() => handleOpen(pack)}
              >
                <Text>{downloadingId === pack._id ? '打开中' : '下载'}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
