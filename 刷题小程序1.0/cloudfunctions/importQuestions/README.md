# importQuestions 云函数（V2 通用导入器）

## 背景

旧版有 `importQuestions1` ~ `importQuestions12` 共 12 份**几乎完全相同**的函数，
每份硬编码一份 `batch_NN.json` 静态题库（约 500 题/份，合计 ~9.7MB）。
拆成 12 个是因为云函数包体有 ~1.2MB 上限，把全部数据塞进一个函数会部署失败。

但这 12 份拷贝的**重复逻辑是最大维护风险**——文档作者指出"不能靠编号扩展"：
未来 2025 国考、省考、教资、考研都会继续增加批次，靠 `importQuestions13/14...`
是不可持续的。

## V2 设计：单一函数 + 数据外置

```
旧:  importQuestions1(batch_01.json)  ┐
    importQuestions2(batch_02.json)  │  12 份拷贝
    ...                             ├──────────────►  维护噩梦
    importQuestions12(batch_12.json) ┘

新:  importQuestions (通用)
        │
        ├─ action: import / repair   ── 按 batchId 从 question_batches 读取
        ├─ action: import_all        ── 遍历 question_batches 全部批次
        ├─ action: import_inline     ── 直接导入传入的题目数组(OCR/小批量)
        ├─ action: list_batches      ── 列出可用批次
        ├─ action: stats / clear     ── 统计 / 清空
```

- 批次数据存放在数据库集合 **`question_batches`**（每个 doc 一个批次，含 `questions` 数组）。
- 未来新增试卷 = 往 `question_batches` 加一条记录，**无需新增函数**。
- 包体不再是问题：函数代码仅 ~8KB，数据在数据库里。

## 数据归档位置

原 12 份 JSON 已归档到项目根目录 `seed-data/batches/batch_01.json ... batch_12.json`，
**数据不丢**，仅从云函数包中移出。

## 迁移步骤（让通用导入器可用）

1. CloudBase 控制台创建集合 `question_batches`（权限：所有用户可读 / 管理端可写）。
2. 安装 SDK：`npm i @cloudbase/node-sdk`（或已安装到工作区）。
3. 运行迁移脚本：
   ```bash
   # 方式 1: 命令行直接传密钥
   node scripts/migrate_batches_to_db.js --env cloud1-d0gsr2l1ye6344917 --secretId <SecretId> --secretKey <SecretKey>

   # 方式 2: 创建 admin/config.json（推荐，避免密钥进命令历史）
   # 文件内容:
   # {
   #   "env": "cloud1-d0gsr2l1ye6344917",
   #   "secretId": "你的SecretId",
   #   "secretKey": "你的SecretKey"
   # }
   node scripts/migrate_batches_to_db.js
   ```
4. 如果脚本报错 `signature calculated is different from client signature`，说明 API 密钥没有 CloudBase 访问权限，或环境 ID 与密钥不匹配。请检查：
   - 该密钥是否拥有 `QcloudTCBFullAccess` 策略；
   - CloudBase 控制台里的环境 ID 是否确实是 `cloud1-d0gsr2l1ye6344917`；
   - 该密钥是否为主账号/有权限的子账号。
5. 若脚本因权限无法跑通，可用**兜底方案**：CloudBase 控制台数据库导入。
   - 已生成 `seed-data/question_batches_import.jsonl`（9MB，12 行，每行一个 batch 文档）。
   - 操作：CloudBase 控制台 → 数据库 → 导入 → 选择 `question_batches_import.jsonl` → 目标集合 `question_batches`。
   - 导入成功后，可在云函数测试面板验证 `list_batches`/`import_all`。
6. 在云函数测试面板验证：
   ```json
   { "action": "list_batches" }
   { "action": "import_all" }
   ```

## 前端 / 调用方变更

- 旧调用 `importQuestions7` + `{action:'repair'}` 应改为
  `importQuestions` + `{action:'repair', batchId:'batch_07'}`。
- 全量导入：旧 `import_all` 返回 12 步计划 -> 新 `import_all` **直接执行**并汇总结果。
- OCR 录题链路可直接用 `{action:'import_inline', questions:[...]}` 写入草稿或正式库。
