# question_drafts — AI/OCR 中间层设计

> 对应 V2 架构评审第②条（最关键的改动）：**AI/OCR 识别结果绝不能直进正式题库，必须经
> `草稿(drafts) → 人工审核 → 发布(publish)` 一道闸口。**

---

## 1. 为什么需要这一层

旧链路：OCR → `convert_markdown_papers_v2.py` 出 V2 包 → `import_xingce_package` → 直接写入
`questions` / `xingce_*` 正式集合。MinerU / AI 的识别结果（题号错位、选项吞字、答案误判、解析缺失）
会**毫无阻拦地污染题库**，且一旦写入难以追溯来源。

新链路在「生成 V2 包」与「写入正式库」之间插入 **草稿箱**：

```
OCR/AI 识别
   │
   ▼
prepareOcrMarkdownForV2  →  convert_markdown_papers_v2.py  →  V2 包
   │
   ▼
draft_create   ──►  question_drafts (status=pending)   ← 新增闸口
   │
   ▼  (后台「草稿箱」视图)
逐题审核：通过 / 驳回 / 修正(答案·解析)
   │
   ▼  (审核员点击「发布已通过」)
draft_publish  ──►  复用 importXingcePackage  ──►  正式库 (status=published)
```

---

## 2. 数据模型（集合 `question_drafts`）

每个 doc 对应**一整套来源试卷**（如一次 OCR 出来的整份真题）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | `draft_<时间戳>_<随机>` |
| `source` | string | `ocr` / `ai` / `manual` |
| `paper_name` | string | 试卷名（取 `package.paper._id` 或 OCR 标题推断） |
| `paper_id` | string | 来源 V2 包 `paper._id` |
| `status` | string | `pending` / `published` / `archived` |
| `raw_markdown` | string | OCR 原始/结构化 markdown，供追溯 |
| `package` | object | **完整 V2 包**（`papers/groups/questions/solutions/media`） |
| `review` | object | 逐题审核状态：`{ [questionId]: { status, edited, comment, updated_at } }` |
| `edits` | object | 人工修正覆盖：`{ [questionId]: { answer?, analysis? } }` |
| `counts` | object | `{ total, approved, rejected, pending }`（冗余，便于列表展示） |
| `created_at` / `updated_at` / `published_at` | date | 时间戳 |

---

## 3. 云函数接口（`admin` 云函数，`action: "draft"`）

子动作由 `draft_action` 决定，全部走现有 `/api/admin` 代理（`local-server.js` 已支持）：

| draft_action | 入参 | 说明 |
|---|---|---|
| `create` | `source, paper_name, raw_markdown, package` | 写入草稿，`review` 全初始化为 `pending` |
| `list` | `status?, page?, page_size?` | 列表（排除 `raw_markdown/package/review/edits` 重字段） |
| `get` | `draft_id` | 取完整草稿（含 package + review + edits） |
| `update` | `draft_id, review?, edits?, comments?` | 保存逐题修正与备注 |
| `approve` | `draft_id, question_ids?` | 标记通过（空=全部） |
| `reject` | `draft_id, question_ids?` | 标记驳回（空=全部） |
| `publish` | `draft_id` | 仅把 `approved` 题目重建 V2 包 → 复用 `importXingcePackage`；成功后置 `published` |
| `delete` | `draft_id` | 删除草稿（不影响已发布的正式库） |
| `stats` | — | 按 `status` 统计数量 |

**实现位置**：`cloudfunctions/admin/features/drafts.js`；`cloudfunctions/admin/index.js` 增加
`case 'draft'` 转派；`COLLECTIONS` 增加 `question_drafts`。

> 设计要点：草稿模块**只管存储与审核状态**，发布逻辑直接复用 `xingceFeature.importXingcePackage`，
> 不重写 V2 写入路径，降低出错面。

---

## 4. 发布时的题目重建（publishDraft）

仅挑选 `review.status === 'approved'` 的题目，并套用 `edits` 修正：

- `questions`：过滤 approved；若 `edits[qid].answer` 存在则覆盖 `answer`/`answer_index`/`answer_verified`；
  若 `edits[qid].analysis` 存在则覆盖 `explanation`。
- `solutions`：过滤 approved；套用 `edits[question_id].analysis` 到 `explanation`。
- `groups`：仅保留仍含 approved 题目的题组，并裁剪 `question_ids`。
- 调 `importXingcePackage` 复用既有校验；失败则把错误回传，草稿保持 `pending`，由审核员修正。

---

## 5. 前端（admin 后台）

- 顶部导航新增「**草稿箱**」。
- OCR 行测流程：原「导入云端」按钮改为「**存入草稿箱**」→ 调 `draft_create`；成功后提示并跳转草稿箱。
  （申论 OCR 暂仍走原 `import_essay_package` 直传，后续可纳入同层。）
- 草稿箱视图：
  - 列表：试卷名、来源标签、通过/驳回/待审计数、状态、[审核]/[删除]。
  - 详情：逐题卡片展示题干、选项、答案下拉、解析文本框；[通过]/[驳回]/[保存修正]；
    顶部 [全部通过]/[发布已通过]/[删除草稿]/[返回列表]。
- 手动「行测题库」模板导入（`importV2PackageToCloud`）**未改动**——那是人工精心编排的输入，
  维持直传；闸口仅作用于 AI/OCR 自动化来源。

---

## 6. 部署与验证

1. 微信开发者工具 / CLI 上传 `admin` 云函数（含 `features/drafts.js`）。
2. 控制台建集合 `question_drafts`（权限：管理端可读写，客户端不可直接访问）。
3. 走一遍：OCR 识别一套真题 → 存入草稿箱 → 草稿箱逐题审核 → 发布 → 题库出现对应题目。
4. 若发布被 `importXingcePackage` 校验拦截（如资料分析题组不足 5 题），错误会回传草稿箱，
   审核员可逐题修正后重试。

> 注：本机此前 `migrate_batches_to_db.js` 因 API 密钥签名问题未能直连，草稿箱走云函数 HTTP
> 通道，与该脚本无关；上线只需正常部署 `admin` 云函数并在控制台建集合即可。
