# importQuestions 云函数拆分与优化完成

## 问题 1：上传大小超限

`importQuestions` 云函数包含 12 个 batch JSON 文件（5.8MB），上传时报 `400 input length too long`。

## 解决方案 1：拆分云函数

拆分为 **1 编排器 + 5 子函数**，全部控制在 2MB 以内：

```
cloudfunctions/
├── importQuestions/        ← 13KB 编排器（路由计划 + 统计 + 清空）
├── importQuestions1/       ← 1.2MB（batch 1-3，1500 题）
├── importQuestions2/       ← 1.9MB（batch 4-6，1500 题）
├── importQuestions3/       ← 1.6MB（batch 7-8，1000 题）
├── importQuestions4/       ← 1.1MB（batch 9-10，1000 题）
└── importQuestions5/       ← 693KB（batch 11-12，633 题）
```

## 问题 2：子函数调用超时 3 秒

首次测试子函数时返回 `Invoking task timed out after 3 seconds`。

### 根因
原逻辑对每道题单独做 `count() + update/add()`，一个 500 题批次需要约 1000 次 DB 操作，远超 3 秒同步调用上限。

### 解决方案 2：批量插入
- 默认使用 `batch_insert` 模式，每 100 题批量 add 一次（CloudBase 单次上限 100）
- 一个 500 题批次只需 5 次 DB 操作，可在 1 秒内完成
- 保留 `mode: "upsert"` 用于后续增量更新/重复导入

## 问题 3：编排器调用子函数报 system error

`importQuestions` 通过 `cloud.callFunction` 调用子函数时，在测试面板环境下始终报 `Base resp abnormal, system error`。

### 根因
CloudBase 云函数内部调用其他云函数在当前环境下不稳定（偶发 system error）。

### 解决方案 3：编排器不再嵌套调用
- `importQuestions` 不再实际调用子函数
- `import_all` 改为返回 5 个子函数的执行计划
- `import` 改为返回单批调用参数
- `stats` 继续直接查询数据库
- `clear` 用于清空 `questions` 集合（需 `confirm: true`）

## 问题 4：stats 只返回 3759 条（预期 5633）

### 根因
`importQuestions3` 和 `importQuestions4` 数据量较大，在测试面板 3 秒同步调用超时，导致只导入部分数据。`importQuestions4` 原包含 4 个批次（1633 题），最容易超时。

### 解决方案 4：进一步拆分
- 将 `importQuestions4` 拆为 `importQuestions4`（batch 9-10，1000 题）和 `importQuestions5`（batch 11-12，633 题）
- 现在每个子函数最大 1500 题，更稳定

## 完整导入流程

### 1. 重新部署 6 个云函数

在微信开发者工具中，依次右键以下目录 → **上传并部署：云端安装依赖**：

- `importQuestions`
- `importQuestions1`
- `importQuestions2`
- `importQuestions3`
- `importQuestions4`
- `importQuestions5`

### 2. 清空旧数据

调用 `importQuestions`，传入：

```json
{ "action": "clear", "confirm": true }
```

### 3. 重新导入全部数据

分别调用 5 个子函数：

```json
// importQuestions1
{ "action": "import_all" }

// importQuestions2
{ "action": "import_all" }

// importQuestions3
{ "action": "import_all" }

// importQuestions4
{ "action": "import_all" }

// importQuestions5
{ "action": "import_all" }
```

### 4. 核对总数

调用 `importQuestions`：

```json
{ "action": "stats" }
```

预期返回 `total: 5633`。

## 其他操作

### 查看导入计划

```json
// importQuestions
{ "action": "import_all" }
```

### 单批导入查询

```json
// importQuestions, batch 5 对应 importQuestions2 的 batch 2
{ "action": "import", "batch": 5 }
```

## 当前状态

- 已修复重复 ID，5633 道题全部唯一
- 已拆分 `importQuestions4` 为 `importQuestions4` + `importQuestions5`
- 12 个 batch 文件已更新到 5 个子函数目录
- 用 `importQuestions` → `{ "action": "stats" }` 核对总数
