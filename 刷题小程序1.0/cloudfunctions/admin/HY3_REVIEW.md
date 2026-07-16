# 草稿箱 AI 审核配置（免费 hy3 / HunYuan）

草稿箱的"AI 审核本题 / AI 审核整套"由 `admin` 云函数调用环境内免费的 HunYuan（hy3）生文模型完成。模型调用走云函数所在 env 的 AI 网关（小程序成长计划免费额度），**密钥只在云端，不配置任何 API Key，也不写入前端**。

## 可选环境变量

```text
AI_PROVIDER=hunyuan-v3   # 默认。cloudbase 需先在控制台「AI → 生文模型」开启 hy3 开关
AI_MODEL=hy3             # 默认。可选 hy3-preview
```

未配置时默认使用 `hunyuan-v3` + `hy3`，无需任何额外开关即可使用免费额度。

## 部署步骤

1. `admin` 云函数已依赖 `@cloudbase/node-sdk` / `@cloudbase/ai` / `ws`（见 package.json）。
2. 在 CloudBase 的 `admin` 云函数配置中按需新增 `AI_PROVIDER` / `AI_MODEL`（可留空用默认）。
3. 将云函数超时时间设置为不少于 90 秒。
4. 重新上传并部署 `admin` 云函数（云端安装依赖）。
5. 打开管理台草稿箱，进入一份草稿，先用"AI 审核本题"测试。

## 安全与审核规则

- 审核结果保存到 `question_drafts.review[question_id].ai_review`（v2）或 `question_drafts.review[question_id].ai_review`（v1）。
- AI 不会自动把题目标为"通过"，也不会自动发布。
- 含图片的题目当前只会把图片占位信息发给云端模型，因此一律标为需要人工复核。
- "填入 AI 建议"只填入编辑框，仍需人工确认并点击"保存修正"。

## 与旧版 Gemini 实现的区别

旧版 `gemini-review` 调用 Google Gemini API，需要自备 `GEMINI_API_KEY` 且境内云环境网络不通。现统一改为 `hy3-review`，复用 `review-common` 的 payload 构造与结果校验，审核结果结构保持一致，零额外成本、无网络依赖。
