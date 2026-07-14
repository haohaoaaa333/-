# 考公宝后台管理台

这个目录是一个不依赖构建工具的管理台。推荐用本地服务打开，避免浏览器拦截 `file://` 页面跨域请求。

## 能做什么

- 查看题库、用户、答题记录等核心集合的统计入口。
- 通过 `admin` 云函数查询、编辑、逻辑删除和导入新版行测 V2 整卷。
- 将一套或多套整卷 Markdown 批量转换为 `bank.json + images`，保留图文顺序、资料分析共享材料及其 5 个小题关联。
- 配置 CloudBase HTTP 触发地址后，可直接调用云函数。

## 云函数鉴权

`cloudfunctions/admin` 支持两种方式：

- `ADMIN_OPENIDS=o1,o2`：小程序云调用场景，当前用户 OpenID 命中白名单即可。
- `ADMIN_SECRET=your-secret`：HTTP 管理台场景，管理台请求会带 `admin_secret`。

不要把正式密钥提交到仓库。部署后在微信云开发控制台配置环境变量。

## 使用步骤

1. 上传并部署 `cloudfunctions/admin`。
2. 在云函数环境变量配置 `ADMIN_SECRET` 或 `ADMIN_OPENIDS`。
3. 如需网页直连，在云开发控制台给 `admin` 云函数开启 HTTP 访问路径。
4. 在 `admin` 目录运行 `node local-server.js`。
5. 打开 `http://127.0.0.1:8787`，HTTP 地址填 `/api/admin`，密钥填 `ADMIN_SECRET`。

## 新版行测导入步骤

1. 在“行测题库”下载并填写 V2 Markdown 整卷模板；一份 Markdown 代表一套试卷。
2. 填写 Markdown 所在目录，点击“生成新版 V2 试卷包”。
3. 在转换结果点击“载入这套试卷”；重新上传时只接受 `schema_version: 2` 的 `bank.json`。
4. 有图片时选择同套试卷目录内的 `images` 文件夹。
5. 检查并逐题复核，通过后点击“导入这套 V2 试卷”。

模板转换和本地检查不需要连接云函数；上传图片及导入云端需要完成第 1-5 项连接配置。
