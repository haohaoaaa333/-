'use strict';

// 确定性切题管线。完全复用 scripts/ 下既有的 Python 脚本（与管理台 local-server.js
// 同一套 CLI），不再重写切题逻辑：
//   split_questions.py        markdown + content_list → raw_questions.json
//   structure_questions.py    raw_questions.json → question_drafts.json（V2 整卷包）
//   extract_answer_solutions.py / merge_question_answer_packages.py  答案解析配对（可选）
// 脚本产出的 question_drafts.json 中 answer 为 None，自动满足“缺失答案存 null”。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { config } = require('./config');
const { findPython } = require('./mineru');

function walkFiles(rootDir, predicate) {
  const out = [];
  (function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (predicate(e.name, fp)) out.push(fp);
    }
  })(rootDir);
  return out;
}

// 定位 MinerU 产物：markdown（优先 auto/ 子目录）与 content_list.json。
function findMinerUOutputs(outputDir) {
  if (!fs.existsSync(outputDir)) return { mdFile: null, contentListFile: null };
  const mdFiles = walkFiles(outputDir, name => /\.md$/i.test(name));
  mdFiles.sort((a, b) => {
    const ra = /(^|\/)auto\//.test(a) ? 0 : 1;
    const rb = /(^|\/)auto\//.test(b) ? 0 : 1;
    return ra - rb;
  });
  const clFiles = walkFiles(outputDir, name => /content_list/i.test(name));
  return {
    mdFile: mdFiles[0] || null,
    contentListFile: clFiles[0] || null,
  };
}

function runPythonStep(label, scriptRel, args) {
  return new Promise((resolve, reject) => {
    const python = findPython();
    const scriptPath = path.join(config.scriptsDir, scriptRel);
    if (!fs.existsSync(scriptPath)) return reject(new Error(`切题脚本不存在：${scriptPath}`));
    const child = spawn(python, [scriptPath, ...args], {
      cwd: config.projectRoot,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let out = '';
    let err = '';
    child.stdout && child.stdout.on('data', c => { out += c; });
    child.stderr && child.stderr.on('data', c => { err += c; });
    child.on('error', e => reject(new Error(`${label} 启动失败：${e.message}`)));
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`${label} 失败（exit ${code}）\n${err.slice(-2000) || out.slice(-2000)}`));
      resolve(out);
    });
  });
}

async function runPipeline({ outputDir, paperId, taskId, answerMdFile }) {
  const { mdFile, contentListFile } = findMinerUOutputs(outputDir);
  if (!mdFile) throw new Error('MinerU 识别完成但未发现 Markdown 输出文件');

  const rawQuestionsPath = path.join(outputDir, 'raw_questions.json');
  const draftsPath = path.join(outputDir, 'question_drafts.json');

  const splitArgs = [mdFile, '--output', rawQuestionsPath];
  if (contentListFile && fs.existsSync(contentListFile)) splitArgs.unshift('--content-list', contentListFile);
  // split_questions.py 期望 --markdown 在前
  splitArgs.unshift('--markdown');
  await runPythonStep('split_questions', 'split_questions.py', splitArgs);

  const structureArgs = [
    '--input', rawQuestionsPath,
    '--output', draftsPath,
    '--paper-id', paperId,
    '--task-id', taskId,
  ];
  await runPythonStep('structure_questions', 'structure_questions.py', structureArgs);

  if (answerMdFile && fs.existsSync(answerMdFile)) {
    const extractedAnswersPath = path.join(outputDir, 'answer_solutions.json');
    await runPythonStep('extract_answer_solutions', 'extract_answer_solutions.py', ['--markdown', answerMdFile, '--output', extractedAnswersPath]);
    await runPythonStep('merge_question_answer_packages', 'merge_question_answer_packages.py', [
      '--package', draftsPath,
      '--answers', extractedAnswersPath,
      '--output', draftsPath,
    ]);
  }

  const pkg = JSON.parse(fs.readFileSync(draftsPath, 'utf8'));
  return { pkg, rawMarkdown: fs.readFileSync(mdFile, 'utf8'), draftsPath };
}

module.exports = { findMinerUOutputs, runPipeline, runPythonStep };
