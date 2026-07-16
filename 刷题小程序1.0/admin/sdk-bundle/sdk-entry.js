import cloudbase from '@cloudbase/js-sdk';
import { registerAuth } from '@cloudbase/js-sdk/auth';
import { registerStorage } from '@cloudbase/js-sdk/storage';

const ENV_ID = 'cloud1-d0gsr2l1ye6344917';

function createApp(env) {
  const instance = cloudbase.init({ env: env || ENV_ID });
  if (typeof instance.auth !== 'function') registerAuth(instance);
  if (typeof instance.uploadFile !== 'function' && typeof instance.storage !== 'function') registerStorage(instance);
  return instance;
}

const app = createApp(ENV_ID);

if (typeof window !== 'undefined') {
  window.cloudbase = cloudbase;
  window.__cloudbaseApp = app;
  window.__createCloudbaseApp = createApp;

  let check = {
    cloudbaseDefined: typeof cloudbase !== 'undefined',
    initType: typeof cloudbase.init,
    appAuthType: typeof app.auth,
    appStorageType: typeof app.storage,
    appUploadFileType: typeof app.uploadFile,
    appGetTempFileURLType: typeof app.getTempFileURL,
    appDownloadFileType: typeof app.downloadFile,
  };
  try {
    const storageInstance = typeof app.storage === 'function' ? app.storage() : app.storage;
    check = Object.assign(check, {
      storageInstanceType: typeof storageInstance,
      storageUploadFileType: typeof storageInstance.uploadFile,
    });
  } catch (e) {
    check.storageProbeError = e.message;
  }
  window.__cloudbaseSdkCheck = check;
  console.log('[CloudBase SDK check]', check);
}
