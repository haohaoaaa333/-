# workerGateway 云函数

本函数供本机 MinerU Worker 使用，与管理后台 `ADMIN_SECRET` 完全隔离。

## 环境变量

```text
WORKER_SECRET=至少24位随机字符串
WORKER_LEASE_SECONDS=300
WORKER_ALLOW_PLAIN_SECRET=false
```

生产环境必须保持 `WORKER_ALLOW_PLAIN_SECRET=false`。

## Action

- `health`：健康检查，不要求签名；
- `claim`：领取一条 `waiting` 导入任务；
- `heartbeat`：上报 `mineru_processing` / `splitting` 进度并续租；
- `complete`：完成本地识别，任务进入 `draft_ready`；
- `fail`：记录失败阶段和可重试信息。

## HTTP 签名

```text
X-Worker-Id: pc-5070-01
X-Timestamp: Unix秒
X-Nonce: 每次请求随机字符串
X-Signature: HMAC_SHA256(WORKER_SECRET, timestamp + "\n" + nonce + "\n" + SHA256(rawBody))
```

签名有效期 5 分钟，nonce 只能使用一次。

## 部署

1. 在微信开发者工具中选择 `cloudfunctions/workerGateway`。
2. 上传并部署，选择“云端安装依赖”。
3. 在云函数配置中填写环境变量。
4. 创建 HTTP 访问路径，并只交给本机 Worker 使用。
5. 先调用 `health`，再用签名请求测试 `claim`。

`wx-server-sdk` 无需提交到仓库；部署时由云端根据 `package.json` 安装。
