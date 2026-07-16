# 考公宝 V2.0 · MinerU Worker

本 Worker 是管理台「导入任务」链路的**执行端**：持续领取 `import_tasks`，在本地（带 GPU 的机器，如 RTX 5070 8GB）运行 MinerU 识别，调用既有的确定性切题脚本生成 **Draft V2** 草稿，并把产物上报回管理台。

> 设计原则：**复用，不重写**。MinerU 调用沿用 `admin/local-server.js` 的探测逻辑；切题/结构化直接调用 `scripts/split_questions.py` → `structure_questions.py`（与管理台 `ocrToBank` 同一套 CLI）。答案缺失时 `structure_questions.py` 产出 `answer: null`，天然满足「缺答案存 null，绝不默认 A」。

## 端到端链路

```
管理台上传 PDF → 云存储 file_id → import_task.create（waiting）
        ↓
Worker.claim（事务领取 + 租约）
        ↓
下载题目 PDF（可选答案 PDF）
        ↓
MinerU（心跳轮询 cancel_requested；收到即整树终止）
        ↓
split_questions.py → structure_questions.py（确定性切题 + 结构化）
        ↓
上传图片/Markdown 到云存储，改写引用为 cloud://
        ↓
admin draft.create / draft.append（一题一档，幂等去重）
        ↓
workerGateway.complete（draft_ready，带回 draft_paper_id）
        ↓
管理台「草稿箱」三栏审核 → 发布门禁 → release
```

## 运行

```bash
cd worker
cp .env.example .env      # 填写 WORKER_SECRET / ADMIN_SECRET / 两个 URL / TCB 凭证；启动时会自动读取
npm install               # 安装 @cloudbase/node-sdk（tcb 后端需要）
npm run check             # 语法与启动文件检查
npm start                 # 启动主循环
```

离线冒烟（无需 GPU / 云）：

```bash
npm run smoke
```

`smoke` 会用手写 `raw_questions.json` 跑 `structure_questions.py`，校验 `answer: null`、草稿包结构，并用 `local` 存储后端验证图片引用改写与 artifacts 产出。

## 关键约定

- **并发固定为 1**：单 GPU 机器只跑一个 MinerU 进程；通过锁文件 `run/worker.lock` 防止本机重复启动。
- **取消闭环**：管理台 `import_task.cancel` 仅置 `cancel_requested` + `cancelling`；Worker 下一次心跳读到后调用 `controller.cancel()` 终止整个 MinerU 子进程树，再回调 `workerGateway.cancel` → `cancelled`。「强制结束」仅收口管理状态，不保证本机进程已终止。
- **租约回收**：Worker 崩溃后不再心跳，租约过期（`claim` 或 `import_task.recover`）会把活动态任务重置回 `waiting`，可被重新领取。
- **状态流转白名单**：`workerGateway` 内置 `TRANSITIONS`，禁止非法跳转（如 `splitting` 直接跳 `draft_ready`）。
- **草稿幂等**：重试同一任务时复用既有 `draft_paper_id`（通过 `admin.getImportTask` 读取），`draft.append` 用 `itemId(draftId, questionId)` 去重，不会产生重复题档。
- **日志来源隔离**：Worker 日志走 `workerGateway.log`（带签名，source=worker）；管理端 `import_task.log` 只允许 source=admin，杜绝浏览器伪造 Worker 日志。

## 环境变量

见 `.env.example`。核心必须项：`WORKER_SECRET`、`ADMIN_SECRET`、`WORKER_GATEWAY_URL`、`ADMIN_URL`，以及（tcb 后端）`TCB_ENV_ID/TCB_SECRET_ID/TCB_SECRET_KEY`。

## 目录

```
worker/
├─ package.json
├─ .env.example
├─ README.md
├─ src/kg_worker/
│  ├─ index.js          # 主循环：claim → 处理 → complete/fail，单并发 + 取消处理
│  ├─ config.js         # 环境变量配置
│  ├─ gateway.js        # workerGateway HTTP 客户端（HMAC 签名）
│  ├─ admin.js          # admin 云函数客户端（draft.create/append、import_task.get）
│  ├─ storage.js        # 云存储适配器（tcb / local）
│  ├─ mineru.js         # MinerU 运行 + 进程树终止 + 进度解析
│  ├─ pipeline.js       # 定位 MinerU 产物 + 调用切题脚本
│  └─ draft_builder.js  # 上传资源、改写引用、构造草稿 payload + artifacts
└─ test/smoke.js        # 离线冒烟测试
```
