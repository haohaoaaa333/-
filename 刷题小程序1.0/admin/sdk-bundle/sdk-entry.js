import cloudbase from '@cloudbase/js-sdk';
import { registerAuth } from '@cloudbase/js-sdk/auth';
import { registerStorage } from '@cloudbase/js-sdk/storage';

const ENV_ID = 'cloud1-d0gsr2l1ye6344917';

const app = cloudbase.init({ env: ENV_ID });

registerAuth(app);
registerStorage(app);

if (typeof window !== 'undefined') {
  window.cloudbase = cloudbase;
  window.__cloudbaseApp = app;

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
