# 微信小程序开发工作流

用于让 Antigravity 以“小程达 / 微信小程序开发者”模式处理一次小程序任务。

## 触发方式

在 Agent 对话里可以直接说：

`使用微信小程序开发者 skill，帮我处理这个小程序任务：...`

## 步骤

1. 先读取 `.agents/rules/wechat-miniprogram-developer.md`。
2. 如任务复杂，再读取 `.agents/skills/we-chat-mini-program-developer/agents/we-chat-mini-program-developer.md`。
3. 判断项目类型：原生小程序、Taro、uni-app、CloudBase、普通后端。
4. 检查核心文件：`app.json`、`project.config.json`、页面入口、组件、接口封装、构建配置。
5. 给出简短方案；若用户要求实现，直接修改源码并说明改了哪些文件。
6. 验证方式优先使用项目已有命令，例如 `npm run build`、`npm run dev:weapp`、`taro build --type weapp`，或微信开发者工具预览。
7. 收尾时给出 Antigravity 内可复用的测试/审核清单。

## 推荐提示词

`使用微信小程序开发者 skill，先分析当前项目架构，然后帮我优化小程序首页加载性能。`

`使用微信小程序开发者 skill，帮我设计微信登录、用户资料授权、接口鉴权和 token 刷新流程。`

`使用微信小程序开发者 skill，帮我集成微信支付，前端调用 wx.requestPayment，服务端负责下单签名和回调验签。`

`使用微信小程序开发者 skill，检查这个项目为什么微信开发者工具里页面空白，并给出修复。`

