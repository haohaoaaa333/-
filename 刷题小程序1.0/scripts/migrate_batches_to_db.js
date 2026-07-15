// 迁移脚本: 将 seed-data/batches/batch_*.json 推送到 CloudBase 集合 question_batches
//
// 用途:
//   原 importQuestions1~12 各自硬编码一份 batch_NN.json。V2 改为单一通用
//   importQuestions 函数, 数据从 question_batches 集合按 batchId 读取。
//   本脚本把归档的 12 份 JSON 一次性写入 question_batches, 使通用导入器可用。
//
// 运行方式 (三选一):
//   A. 参数方式:
//      node scripts/migrate_batches_to_db.js --env cloud1-d0gsr2l1ye6344917 --secretId <SecretId> --secretKey <SecretKey>
//
//   B. 配置文件方式 (推荐):
//      创建 admin/config.json (已填好 env, 你只需填 secretId/secretKey):
//      {
//        "env": "cloud1-d0gsr2l1ye6344917",
//        "secretId": "你的SecretId",
//        "secretKey": "你的SecretKey"
//      }
//      node scripts/migrate_batches_to_db.js
//
//   C. 环境变量方式:
//      CLOUDBASE_ENV=cloud1-d0gsr2l1ye6344917 CLOUDBASE_SECRET_ID=... CLOUDBASE_SECRET_KEY=... node scripts/migrate_batches_to_db.js
//
// 前置:
//   1. 安装 SDK: npm i @cloudbase/node-sdk
//   2. 在 CloudBase 控制台创建集合 question_batches (权限: 所有用户可读/管理端可写)
//   3. 每个 doc 结构: { _id: "batch_07", label: "...", count: 500, questions: [...] }
//
// 注意:
//   - 每个批次 questions 数组较大, 写入时按 doc 粒度 upsert(一个批次一条 doc)。
//   - 若集合已有同名 batchId, 默认覆盖更新。
//   - 若报 signature 错误, 通常是密钥无 CloudBase 权限或环境 ID 不匹配,
//     可改用 CloudBase 控制台导入 seed-data/question_batches_import.jsonl。
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      args[key] = val;
      if (val !== true) i++;
    }
  }
  return args;
}

function loadConfig() {
  const configPath = path.resolve(__dirname, '..', 'admin', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.warn('读取 admin/config.json 失败:', e.message);
    }
  }
  return {};
}

async function main() {
  const args = parseArgs(process.argv);
  const fileConfig = loadConfig();

  const env = args.env || process.env.CLOUDBASE_ENV || fileConfig.env;
  const secretId = args.secretId || process.env.CLOUDBASE_SECRET_ID || fileConfig.secretId;
  const secretKey = args.secretKey || process.env.CLOUDBASE_SECRET_KEY || fileConfig.secretKey;
  const region = args.region || process.env.CLOUDBASE_REGION || fileConfig.region || 'ap-shanghai';

  if (!env) {
    console.error('\n缺少 CloudBase 环境 ID。请用以下任一方式提供:\n');
    console.error('  1. 命令行: --env cloud1-d0gsr2l1ye6344917');
    console.error('  2. 环境变量: CLOUDBASE_ENV');
    console.error('  3. 配置文件: admin/config.json 中填写 "env"');
    console.error('\n示例: node scripts/migrate_batches_to_db.js --env cloud1-d0gsr2l1ye6344917 --secretId xxx --secretKey xxx\n');
    process.exit(1);
  }

  if (!secretId || !secretKey) {
    console.error('\n缺少腾讯云 API 密钥 (SecretId/SecretKey)。本地写库需要密钥。\n');
    console.error('提供方式 (三选一):\n');
    console.error('  1. 命令行参数: --secretId <id> --secretKey <key>');
    console.error('  2. 环境变量: CLOUDBASE_SECRET_ID / CLOUDBASE_SECRET_KEY');
    console.error('  3. 配置文件: 创建 admin/config.json，内容如下:\n');
    console.error(JSON.stringify({ env, secretId: '你的SecretId', secretKey: '你的SecretKey' }, null, 2));
    console.error('\n密钥获取地址: https://console.cloud.tencent.com/cam/capi\n');
    process.exit(1);
  }

  let tcb;
  try {
    tcb = require('@cloudbase/node-sdk');
  } catch (e) {
    console.error('未找到 @cloudbase/node-sdk，请先执行: npm i @cloudbase/node-sdk');
    console.error('(也可以直接安装到本项目: cd 刷题小程序1.0 && npm i @cloudbase/node-sdk)');
    process.exit(1);
  }

  const initOptions = { env, secretId, secretKey, region };
  const app = tcb.init(initOptions);
  const db = app.database();

  const batchesDir = path.resolve(__dirname, '..', 'seed-data', 'batches');
  if (!fs.existsSync(batchesDir)) {
    console.error('未找到归档目录:', batchesDir);
    process.exit(1);
  }

  const files = fs.readdirSync(batchesDir)
    .filter(f => /^batch_\d+\.json$/.test(f))
    .sort();

  console.log(`\n发现 ${files.length} 个批次文件，开始迁移到 question_batches (env=${env})\n`);

  let success = 0;
  let fail = 0;
  for (const f of files) {
    const batchId = f.replace(/\.json$/, ''); // batch_07
    const full = path.join(batchesDir, f);
    const questions = JSON.parse(fs.readFileSync(full, 'utf-8'));
    const yearMatch = batchId.match(/batch_(\d+)/);
    const seq = yearMatch ? parseInt(yearMatch[1], 10) : null;

    const doc = {
      _id: batchId,
      label: `批次 ${String(seq).padStart(2, '0')}`,
      count: questions.length,
      questions,
      migratedAt: new Date().toISOString(),
    };

    try {
      // upsert: 覆盖或新增。注意 _id 是文档标识，set 数据里不能再带 _id
      const { _id, ...docData } = doc;
      await db.collection('question_batches').doc(batchId).set(docData);
      console.log(`  ✓ ${batchId}  (${questions.length} 题)`);
      success += 1;
    } catch (err) {
      console.error(`  ✗ ${batchId} 失败:`, err.message);
      fail += 1;
    }
  }

  console.log(`\n迁移完成：成功 ${success}/${files.length}，失败 ${fail}`);
  console.log('\n验证命令 (云函数测试面板):');
  console.log('  { "action": "list_batches" }');
  console.log('  { "action": "import_all" }');
}

main().catch(e => {
  console.error('迁移脚本异常:', e);
  process.exit(1);
});
