const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distRoot = path.join(root, 'dist');
const projectConfigPath = path.resolve(root, '..', 'project.config.json');
const maxMainPackageBytes = 1.5 * 1024 * 1024;
const maxMediaBytes = 200 * 1024;
const mediaExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.mp3', '.wav', '.aac', '.m4a', '.ogg',
]);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const errors = [];
if (!fs.existsSync(distRoot)) {
  errors.push('dist/ does not exist. Run npm run build:weapp first.');
} else {
  const files = walk(distRoot);
  const totalBytes = files.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
  if (totalBytes >= maxMainPackageBytes) {
    errors.push(`Main package is ${(totalBytes / 1024 / 1024).toFixed(2)} MB; expected less than 1.50 MB.`);
  }

  const oversizedMedia = files.filter((filePath) => {
    return mediaExtensions.has(path.extname(filePath).toLowerCase())
      && fs.statSync(filePath).size > maxMediaBytes;
  });
  if (oversizedMedia.length) {
    errors.push(`${oversizedMedia.length} media file(s) exceed 200 KB:\n${oversizedMedia.join('\n')}`);
  }

  const appConfig = readJson(path.join(distRoot, 'app.json'));
  if (appConfig.lazyCodeLoading !== 'requiredComponents') {
    errors.push('app.json must set lazyCodeLoading to requiredComponents.');
  }

  if (files.some((filePath) => filePath.endsWith('.map'))) {
    errors.push('Production package contains source map files.');
  }

  console.log(`Package size: ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`Media files: ${files.filter((filePath) => mediaExtensions.has(path.extname(filePath).toLowerCase())).length}`);
}

if (!fs.existsSync(projectConfigPath)) {
  errors.push('project.config.json does not exist.');
} else {
  const projectConfig = readJson(projectConfigPath);
  if (projectConfig.setting?.minified !== true) {
    errors.push('project.config.json setting.minified must be true.');
  }
  if (projectConfig.setting?.minifyWXML !== true || projectConfig.setting?.minifyWXSS !== true) {
    errors.push('project.config.json must enable WXML and WXSS minification.');
  }
}

if (errors.length) {
  console.error('\nQuality check failed:\n- ' + errors.join('\n- '));
  process.exit(1);
}

console.log('Quality check passed.');
