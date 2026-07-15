const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isInsideMarkdownDestination,
  recoverOcrImageFile,
  splitImageName,
} = require('../lib/ocr-media');

test('recognizes positions inside Markdown image destinations', () => {
  const markdown = '101. ![](images/hash101.jpg) next';
  assert.equal(isInsideMarkdownDestination(markdown, markdown.indexOf('101.')), false);
  assert.equal(isInsideMarkdownDestination(markdown, markdown.lastIndexOf('101.')), true);
});

test('recovers a hash suffix removed as a false question number', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-media-'));
  const images = path.join(root, 'output', 'input', 'auto', 'images');
  fs.mkdirSync(images, { recursive: true });
  const actual = path.join(images, 'fa5780b5f101.jpg');
  fs.writeFileSync(actual, 'image');

  assert.equal(recoverOcrImageFile(root, 'images/fa5780b5f.jpg'), actual);
  assert.equal(recoverOcrImageFile(root, 'images/fa5780b5fjpg'), actual);
  fs.rmSync(root, { recursive: true, force: true });
});

test('does not guess when more than one recovered image is possible', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-media-'));
  fs.writeFileSync(path.join(root, 'hash1.jpg'), 'one');
  fs.writeFileSync(path.join(root, 'hash2.jpg'), 'two');
  assert.equal(recoverOcrImageFile(root, 'hash.jpg'), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('parses both normal and damaged image extensions', () => {
  assert.deepEqual(splitImageName('images/hash101.jpg'), { stem: 'hash101', extension: 'jpg' });
  assert.deepEqual(splitImageName('images/hashjpg'), { stem: 'hash', extension: 'jpg' });
});
