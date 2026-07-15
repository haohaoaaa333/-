const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSION_RE = /^(png|jpe?g|gif|webp|svg|bmp)$/i;

function isInsideMarkdownDestination(text, index) {
  const source = String(text || '');
  const open = source.lastIndexOf('](', index);
  if (open < 0) return false;
  const close = source.lastIndexOf(')', index);
  return open > close;
}

function splitImageName(filename) {
  const name = path.basename(String(filename || '').replace(/\\/g, '/'));
  const extension = path.extname(name).slice(1);
  if (IMAGE_EXTENSION_RE.test(extension)) {
    return { stem: name.slice(0, -(extension.length + 1)), extension: extension.toLowerCase() };
  }

  const suffix = name.match(/(png|jpe?g|gif|webp|svg|bmp)$/i);
  if (!suffix) return null;
  return { stem: name.slice(0, -suffix[1].length), extension: suffix[1].toLowerCase() };
}

function collectImages(rootDir) {
  const result = [];
  const root = path.resolve(rootDir);
  const walk = current => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (IMAGE_EXTENSION_RE.test(path.extname(entry.name).slice(1))) result.push(fullPath);
    }
  };
  walk(root);
  return result;
}

/**
 * MinerU image names are hashes. An old OCR formatter could mistake the last
 * 1-3 numeric hash characters (for example `...f101.jpg`) for a question
 * number and remove them. Recover only when exactly one image in this OCR job
 * matches, so a damaged reference can never select an arbitrary asset.
 */
function recoverOcrImageFile(rootDir, requestedPath) {
  const requested = splitImageName(requestedPath);
  if (!requested || !requested.stem) return null;

  const matches = collectImages(rootDir).filter(filePath => {
    const actual = splitImageName(filePath);
    if (!actual || actual.extension !== requested.extension) return false;
    return actual.stem.replace(/\d{1,3}$/, '') === requested.stem;
  });
  return matches.length === 1 ? matches[0] : null;
}

module.exports = {
  isInsideMarkdownDestination,
  recoverOcrImageFile,
  splitImageName,
};
