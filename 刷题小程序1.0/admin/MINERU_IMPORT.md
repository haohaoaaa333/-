# PDF 智能录题（MinerU）

后台的“智能 OCR 导入”现在按下面的链路工作：

```text
选择题目 PDF + 同套答案解析 PDF
  → 本机 MinerU 分别识别（默认 pipeline、串行队列）
  → 两份 Markdown + images
  → 按题号合并题干、A-D、答案、解析文字和解析图片
  → 新版 V2 bank.json
  → 云端草稿箱
  → 原始 OCR / V2 / AI 三栏逐题复核
  → 整套校验
  → 发布到正式题库
```

## 本机准备

在安装 MinerU 的同一个终端确认：

```powershell
mineru --help
```

后台服务启动后会自动检测 `mineru` 命令。若 MinerU 不在 PATH，可在启动后台前设置：

```powershell
$env:MINERU_COMMAND = 'C:\path\to\mineru.exe'
$env:MINERU_BACKEND = 'pipeline'
node admin/local-server.js
```

也支持直接指定 MinerU 所在 Python：

```powershell
$env:MINERU_PYTHON = 'C:\path\to\venv\Scripts\python.exe'
node admin/local-server.js
```

8GB 显存默认使用 `pipeline`，需要切换后端时再设置 `MINERU_BACKEND`。

## 后台操作

1. 打开 `http://127.0.0.1:8787`，进入“智能 OCR”。
2. 左侧选择题目卷，右侧选择同年份、同卷型的答案解析卷。申论或已经合并答案的文件可以只选左侧。
3. 点击“识别并配对生成 V2”。本机一次只运行一个 OCR 任务，系统会先识别题目卷，再识别答案解析卷。
4. 系统先整理题目卷，再从答案卷提取明确写出的 A-D 答案和逐题解析，最后按题号合并；不会根据解析内容猜答案。
5. 点击“存入云端草稿箱”，图片会先上传到草稿目录，题目和解析再按批次写入草稿。
6. 进入“草稿箱”，按待审、已通过、已驳回或 AI 风险题筛选。每页显示 10 题。
7. 左栏核对原始 OCR 文字与图片，中栏修改模块、题干、A-D、材料、答案和解析，右栏查看 AI 审核建议。
8. 点击“保存修正”后再决定通过或驳回。图形题包含合成选项图时，必须勾选“已查看合成图并确认 A-D 顺序”。
9. 可逐题调用 AI 审核，也可审核整套；含图题会强制保留人工复核，AI 不会自动替代看图确认。
10. 只有整套题全部人工通过，且 V2 校验无错误时，才允许“校验并发布整套”。不支持半套发布。

图形推理的合成图片、资料分析共享材料和图片路径都会继续使用 V2 规则；不确定的题目会保留为待复核，不会静默丢弃或自动填充答案。

题目卷和答案卷题号不一致时，生成结果会显示已匹配、明确答案、解析和未匹配题数。未匹配题不会串到相邻题目，仍保留在草稿箱等待人工处理。

## AI 审核配置（免费 hy3）

草稿箱 AI 审核使用云函数所在 env 的免费 HunYuan（hy3）生文模型，密钥只在云端，不配置任何 API Key，也不写入浏览器、本地存储、源码或题库文件。可选环境变量（留空即用默认）：

```text
AI_PROVIDER=hunyuan-v3
AI_MODEL=hy3
ADMIN_ALLOWED_ORIGINS=http://127.0.0.1:8787,http://localhost:8787
```

修改 `cloudfunctions/admin` 后，需要重新上传并部署 `admin` 云函数；仅重启本地管理台不会更新云端审核和发布逻辑。
