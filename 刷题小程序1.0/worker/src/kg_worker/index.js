'use strict';

// Worker 主循环（最小可运行闭环）。
//   claim → 下载 PDF → MinerU（心跳轮询 cancel_requested，收到即整树终止并回调 cancel）
//        → 确定性切题（split/structure 脚本）→ 上传资源 → 创建/追加 Draft V2
//        → complete（带 draft_paper_id）。
// 单进程、单 GPU 并发固定为 1，并通过锁文件避免本机同时启动两个 MinerU。

const fs = require('fs');
const path = require('path');
const { config, validate } = require('./config');
const { gateway, GatewayError } = require('./gateway');
const { admin } = require('./admin');
const { createStorage } = require('./storage');
const mineru = require('./mineru');
const { runPipeline, runPipelineFromMarkdown } = require('./pipeline');
const { buildAndUpload } = require('./draft_builder');

let activeTaskRef = null; // 当前正在处理的任务引用，供 log() 同时上报云端日志

function log(level, message, fields) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level, message, time: new Date().toISOString(), ...(fields || {}) }));
  // 同时把日志上报到 workerGateway（云端任务日志），非阻塞、失败忽略。
  const ref = activeTaskRef;
  if (ref && ref.leaseToken) {
    gateway.log({
      taskId: ref.taskId,
      leaseToken: ref.leaseToken,
      level,
      stage: ref.stage || 'worker',
      message,
      details: fields || null,
    }).catch(() => {});
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function classifyRetryable(err) {
  const msg = String((err && err.message) || err || '');
  // 输入/环境类错误通常不重试；网络/数据库类可重试。
  if (/未找到 MinerU|切题脚本|识别完成但未发现|异常退出|不是有效的 PDF|PDF|ENOENT|签名|401|403/.test(msg)) return false;
  return true;
}

function acquireLock() {
  if (!config.singleProcessLock) return;
  try {
    fs.mkdirSync(path.dirname(config.lockFile), { recursive: true });
    if (fs.existsSync(config.lockFile)) {
      const raw = fs.readFileSync(config.lockFile, 'utf8').trim();
      const pid = Number(raw);
      let alive = false;
      if (Number.isFinite(pid)) {
        if (process.platform === 'win32') {
          try {
            const { spawnSync } = require('child_process');
            const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`], { windowsHide: true, encoding: 'utf8' });
            alive = out.stdout.includes(String(pid));
          } catch (_) { /* 不确定，视为不存活 */ }
        } else {
          try { process.kill(pid, 0); alive = true; } catch (_) { alive = false; }
        }
      }
      if (alive) {
        log('error', `已有 Worker 进程在运行（PID ${pid}），本进程退出以避免重复启动 MinerU。`);
        process.exit(2);
      }
      log('warn', `发现陈旧锁文件（PID ${pid} 已不在运行），覆盖。`);
    }
    fs.writeFileSync(config.lockFile, String(process.pid), 'utf8');
    process.on('exit', () => { try { fs.unlinkSync(config.lockFile); } catch (_) { /* ignore */ } });
  } catch (err) {
    log('warn', `锁文件处理失败：${err.message}`);
  }
}

async function runMinerUStage({ taskId, leaseToken, questionPdf, outputDir }) {
  let lastPct = 0;
  const controller = mineru.runMinerU({
    inputPdf: questionPdf,
    outputDir,
    onProgress: (pct) => { lastPct = pct; },
  });

  let cancelled = false;
  const poll = setInterval(async () => {
    if (cancelled) return;
    try {
      const hb = await gateway.heartbeat({
        taskId, leaseToken, stage: 'mineru_processing', percent: lastPct, message: 'MinerU 识别中',
      });
      if (hb && hb.cancel_requested) {
        cancelled = true;
        clearInterval(poll);
        controller.cancel();
        await gateway.cancel({ taskId, leaseToken }).catch(() => {});
        log('info', `任务 ${taskId} 已收到取消请求，MinerU 进程树已终止。`);
      }
    } catch (err) {
      // 心跳失败不阻断 MinerU，仅记录；租约过期后会被回收。
      log('warn', `MinerU 阶段心跳失败：${err.message}`);
    }
  }, config.mineruStageIntervalMs);

  try {
    await controller.promise;
  } finally {
    clearInterval(poll);
  }
  if (cancelled) throw new mineru.CancelledError('用户取消');
}

function countBy(predicate, list) {
  return (list || []).filter(predicate).length;
}

async function processTask(task, storage) {
  const taskId = task.task_id;
  const leaseToken = task.lease_token;
  activeTaskRef = { taskId, leaseToken, stage: 'claimed' };
  let lastStage = 'claimed';

  const taskDir = path.join(config.taskRoot, taskId);
  const outputDir = path.join(taskDir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  // 重新切题：跳过 MinerU，直接基于已存档 Markdown 重跑确定性切题管线。
  if (task.mode === 'resplit') {
    activeTaskRef.stage = 'splitting';
    return processResplitTask(task, storage, taskDir, outputDir);
  }

  await gateway.heartbeat({ taskId, leaseToken, stage: 'claimed', percent: 0, message: 'Worker 已领取，准备下载 PDF' }).catch(() => {});

  // 1) 下载题目 PDF（及可选答案 PDF）
  const questionPdf = path.join(taskDir, 'question.pdf');
  await storage.downloadFile(task.question_pdf_file_id, questionPdf);
  let answerPdf = null;
  if (task.answer_pdf_file_id) {
    answerPdf = path.join(taskDir, 'answer.pdf');
    await storage.downloadFile(task.answer_pdf_file_id, answerPdf);
  }
  log('info', `任务 ${taskId} PDF 下载完成`);

  // 2) MinerU 识别（带取消轮询）
  lastStage = 'mineru_processing';
  activeTaskRef.stage = 'mineru_processing';
  await runMinerUStage({ taskId, leaseToken, questionPdf, outputDir });

  // 取消可能在 MinerU 结束后的极短窗口被置位，先确认一次。
  const preCheck = await gateway.heartbeat({ taskId, leaseToken, stage: 'splitting', percent: 80, message: '切题中' }).catch(() => null);
  if (preCheck && preCheck.cancel_requested) {
    await gateway.cancel({ taskId, leaseToken }).catch(() => {});
    throw new mineru.CancelledError('用户取消');
  }

  // 3) 确定性切题 + 结构化
  lastStage = 'splitting';
  activeTaskRef.stage = 'splitting';
  let answerMd = null;
  if (answerPdf) {
    // 答案解析卷单独跑一次 MinerU，得到其 markdown
    const answerOutputDir = path.join(taskDir, 'answer-output');
    fs.mkdirSync(answerOutputDir, { recursive: true });
    const ansController = mineru.runMinerU({ inputPdf: answerPdf, outputDir: answerOutputDir });
    // 答案解析卷也轮询取消（简化处理：复用同样的取消信号）
    const ansPoll = setInterval(async () => {
      const hb = await gateway.heartbeat({ taskId, leaseToken, stage: 'splitting', percent: 85, message: '答案解析卷识别中' }).catch(() => null);
      if (hb && hb.cancel_requested) { clearInterval(ansPoll); ansController.cancel(); await gateway.cancel({ taskId, leaseToken }).catch(() => {}); }
    }, config.mineruStageIntervalMs);
    try { await ansController.promise; } finally { clearInterval(ansPoll); }
    const { mdFile: ansMdFile } = require('./pipeline').findMinerUOutputs(answerOutputDir);
    answerMd = ansMdFile;
  }

  const { pkg, rawMarkdown } = await runPipeline({
    outputDir, paperId: taskId, taskId, answerMdFile: answerMd,
  });
  pkg._rawMarkdown = rawMarkdown;
  log('info', `任务 ${taskId} 切题完成，识别 ${pkg.count} 题`);

  // 4) 上传资源 + 构造草稿 payload
  const { package: finalPkg, rawMarkdown: finalMarkdown, artifacts } = await buildAndUpload({
    pkg, storage, outputDir, taskId, paperId: taskId, answerMarkdownFile: answerMd,
  });

  // 5) 创建或追加草稿（重试时复用既有 draft_paper_id，避免重复草稿）
  activeTaskRef.stage = 'draft';
  const existing = await admin.getImportTask(taskId).catch(() => null);
  const priorDraftId = existing && existing.result && existing.result.draft_paper_id;
  let draftId;
  if (priorDraftId) {
    await admin.appendDraft({
      draftId: priorDraftId,
      questions: finalPkg.questions,
      groups: finalPkg.groups,
      media: finalPkg.media,
      solutions: finalPkg.solutions,
    });
    draftId = priorDraftId;
    log('info', `任务 ${taskId} 已追加到既有草稿 ${draftId}`);
  } else {
    const created = await admin.createDraft({
      pkg: finalPkg, sourceTaskId: taskId, paperName: finalPkg.paper_title, rawMarkdown: finalMarkdown,
    });
    draftId = created.draft_id;
    log('info', `任务 ${taskId} 已创建草稿 ${draftId}`);
  }

  // 6) 完成
  activeTaskRef.stage = 'draft_ready';
  const answerCount = countBy(q => q.answer != null, finalPkg.solutions || []);
  const analysisCount = countBy(s => s && s.explanation, finalPkg.solutions || []);
  await gateway.complete({
    taskId, leaseToken,
    result: {
      draft_paper_id: draftId,
      question_count: finalPkg.count || finalPkg.questions.length,
      answer_count: answerCount,
      analysis_count: analysisCount,
      artifacts,
    },
  });
  log('info', `任务 ${taskId} 处理完成 → 草稿 ${draftId}`);
}

// 重新切题专用流程：跳过 MinerU，下载已存档 Markdown → 确定性切题 → 替换草稿题目。
async function processResplitTask(task, storage, taskDir, outputDir) {
  const taskId = task.task_id;
  const leaseToken = task.lease_token;
  const draftId = task.source_draft_id;

  await gateway.heartbeat({ taskId, leaseToken, stage: 'splitting', percent: 10, message: '下载已存档 Markdown' }).catch(() => {});

  const markdownFile = path.join(taskDir, 'raw_markdown.md');
  await storage.downloadFile(task.source_markdown_file_id, markdownFile);
  let answerMarkdownFile = null;
  if (task.source_answer_markdown_file_id) {
    answerMarkdownFile = path.join(taskDir, 'raw_markdown_answer.md');
    try {
      await storage.downloadFile(task.source_answer_markdown_file_id, answerMarkdownFile);
    } catch (err) {
      log('warn', `答案解析卷 Markdown 下载失败，跳过答案重配对：${err.message}`);
      answerMarkdownFile = null;
    }
  }

  const { pkg, rawMarkdown } = await runPipelineFromMarkdown({
    markdownFile, answerMarkdownFile, paperId: draftId, taskId,
  });
  pkg._rawMarkdown = rawMarkdown;
  log('info', `任务 ${taskId} 重新切题完成，识别 ${pkg.count || (pkg.questions && pkg.questions.length)} 题`);

  // 上传资源 + 改写引用
  const { package: finalPkg, rawMarkdown: finalMarkdown, artifacts } = await buildAndUpload({
    pkg, storage, outputDir, taskId, paperId: draftId, answerMarkdownFile,
  });

  // 替换草稿题目（重置审核状态）
  await admin.replaceDraftQuestions({ draftId, pkg: finalPkg });
  log('info', `任务 ${taskId} 已替换草稿 ${draftId} 的题目`);

  const answerCount = countBy(q => q.answer != null, finalPkg.solutions || []);
  const analysisCount = countBy(s => s && s.explanation, finalPkg.solutions || []);
  await gateway.complete({
    taskId, leaseToken,
    result: {
      draft_paper_id: draftId,
      question_count: finalPkg.count || finalPkg.questions.length,
      answer_count: answerCount,
      analysis_count: analysisCount,
      artifacts,
      resplit: true,
    },
  });
  log('info', `任务 ${taskId} 重新切题完成 → 草稿 ${draftId}`);
}

async function main() {
  const errors = validate();
  if (errors.length) {
    log('error', 'Worker 配置不完整：\n' + errors.join('\n'));
    process.exit(1);
  }
  acquireLock();

  let storage;
  try {
    storage = createStorage();
  } catch (err) {
    log('error', `存储后端初始化失败：${err.message}`);
    process.exit(1);
  }

  log('info', `Worker ${config.workerId} 启动`, {
    backend: config.storageBackend,
    gateway: config.gatewayUrl,
    admin: config.adminUrl,
  });

  let shuttingDown = false;
  const onSignal = () => {
    log('warn', '收到退出信号，等待当前任务结束后停止。');
    shuttingDown = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let activeTask = null;
  // eslint-disable-next-line no-constant-condition
  while (!shuttingDown) {
    if (activeTask) { await sleep(config.pollIntervalMs); continue; }

    let task = null;
    try {
      const res = await gateway.claim();
      task = res && res.task;
    } catch (err) {
      log('warn', `claim 失败：${err.message}`);
    }
    if (!task) { await sleep(config.pollIntervalMs); continue; }

    activeTask = task.task_id;
    try {
      await processTask(task, storage);
    } catch (err) {
      if (err && err.name === 'CancelledError') {
        log('info', `任务 ${task.task_id} 已取消。`);
      } else {
        const retryable = classifyRetryable(err);
        const message = String(err && err.message || err || '未知错误').slice(0, 1000);
        log('error', `任务 ${task.task_id} 失败：${message}`, { retryable });
        try {
          await gateway.fail({
            taskId: task.task_id,
            leaseToken: task.lease_token,
            error: { stage: 'mineru_processing', code: 'WORKER_FAILED', message, retryable },
          });
        } catch (_) { /* 失败上报失败则忽略 */ }
      }
    } finally {
      activeTask = null;
      activeTaskRef = null;
      if (!shuttingDown) await sleep(config.pollIntervalMs);
    }
  }
  log('info', 'Worker 已停止。');
}

if (require.main === module) {
  main().catch((err) => {
    log('error', `Worker 主循环异常：${err && err.stack || err}`);
    process.exit(1);
  });
}

module.exports = { main, processTask, classifyRetryable };
