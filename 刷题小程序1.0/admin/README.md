# 考公宝后台管理台

这个目录是一个不依赖构建工具的管理台。推荐用本地服务打开，避免浏览器拦截 `file://` 页面跨域请求。

## 能做什么

- 查看题库、用户、答题记录等核心集合的统计入口。
- 通过 `admin` 云函数查询、编辑、逻辑删除、批量导入题目。
- 离线上传 `parsed_questions.json` / `seed-questions.json`，完成清洗、校验、分批导出。
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

离线处理不需要第 1-3 步，直接打开页面上传 JSON 即可。
