# 草稿箱 Gemini 审核配置

草稿箱的“Gemini 审核本题 / Gemini 审核整套”由 `admin` 云函数调用 Gemini API。密钥只配置在云函数环境变量中，不要写入 `admin/app.js` 或浏览器本地存储。

## 必填环境变量

```text
GEMINI_API_KEY=你的 Google AI Studio API Key
```

## 可选环境变量

```text
GEMINI_MODEL=gemini-2.5-flash
```

未配置 `GEMINI_MODEL` 时默认使用 `gemini-2.5-flash`。

## 部署步骤

1. 在 CloudBase 的 `admin` 云函数配置中新增上述环境变量。
2. 将云函数超时时间设置为不少于 90 秒。
3. 重新上传并部署 `admin` 云函数（云端安装依赖）。
4. 打开管理台草稿箱，进入一份草稿，先用“Gemini 审核本题”测试。

## 安全与审核规则

- Gemini 结果保存到 `question_drafts.review[question_id].ai_review`。
- Gemini 不会自动把题目标为“通过”，也不会自动发布。
- 含图片的题目当前只会把图片占位信息发给云端模型，因此一律标为需要人工复核。
- “填入 Gemini 建议”只填入编辑框，仍需人工确认并点击“保存修正”。
