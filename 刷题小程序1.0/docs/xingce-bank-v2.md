# 行测题库 V2 导入规范

## 推荐交付物

整套真题使用一个题库目录（归档时可压缩为 ZIP）：

```text
xingce-2023-law-enforcement/
├─ manifest.json
├─ bank.json
└─ images/
```

后台选择 `bank.json`，并在“V2 图片目录”选择同包的 `images` 文件夹。后台会先把图片上传到云存储、改写资源地址，再导入数据库。Word/PDF 只作为转换源，不直接进入数据库。

## 主数据关系

- `xingce_papers`：试卷元数据。
- `xingce_question_groups`：共享材料题组；资料分析通常一组材料关联 5 道题。
- `questions`：题目。保留 `group_id`、`stem_blocks`、`options_v2`，同时生成旧版平铺字段供现有小程序读取。
- `xingce_solutions`：独立解析，使用 `explanation_blocks` 保留文字和图片顺序。
- `question_media`：按 SHA-256 去重的图片资源登记表。
- `xingce_import_jobs`：幂等导入任务与统计。

## 图文块

题干、材料、选项和解析都使用有序块，渲染端按数组顺序输出：

```json
[
  { "type": "text", "text": "根据下图回答问题" },
  { "type": "image", "asset_id": "asset_xxx", "src": "/assets/question-images/xingce-v2/paper/chart.png" },
  { "type": "text", "text": "其中2022年……" }
]
```

图形推理的四张选项图分别进入 `options_v2[0..3].content_blocks`；合成大图可作为题干图片，选项文字允许为空。资料分析只在题组保存一次材料，五道小题通过 `group_id` 引用。

## 导入流程

1. 使用 `scripts/convert_xingce_word_pair_v2.py` 配对转换“真题.docx”和“真题（解析）.docx”。
2. 检查 `manifest.json` 的 `validation_errors` 必须为空。
3. 后台“行测题库”选择 `bank.json`，再选择同目录下的 `images` 文件夹。
4. 点击“校验清洗”，确认题数、材料组、解析和图片引用无误。
5. 点击“导入云端”。图片先进入云存储；后台随后写入规范化集合，并同步生成现有刷题页可直接使用的兼容投影。

同一试卷再次导入按固定 `_id` 更新，不会重复生成题目。
