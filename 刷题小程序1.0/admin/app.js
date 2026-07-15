const MODULE_LABELS = {
  mod_common_sense: '常识判断',
  mod_language: '言语理解',
  mod_quantity: '数量关系',
  mod_logic: '判断推理',
  mod_data: '资料分析',
};

const ESSAY_TYPE_LABELS = {
  summary: '归纳概括',
  analysis: '综合分析',
  countermeasure: '提出对策',
  practical_writing: '贯彻执行',
  essay: '申发论述',
};

const ESSAY_SUBTYPE_LABELS = {
  feature: '特点/体现',
  mechanism_analysis: '关系机制分析',
  achievement_and_suggestion: '成效+建议',
  proposal: '提案',
  relation_essay: '关系型作文',
};

const state = {
  endpoint: localStorage.getItem('kg_admin_endpoint') || '',
  // 管理密钥只在当前浏览器会话保存，避免长期落盘。
  secret: sessionStorage.getItem('kg_admin_secret') || localStorage.getItem('kg_admin_secret') || '',
  envId: localStorage.getItem('kg_admin_env_id') || 'cloud1-d0gsr2l1ye6344917',
  view: 'dashboard',
  dashboard: null,
  questions: [],
  books: [],
  importSource: [],
  importClean: [],
  xingcePackage: null,
  xingceImageFiles: new Map(),
  generatedXingcePapers: [],
  essayPackage: null,
  essayPapers: [],
};

const TEMPLATE_MARKDOWN = `# 2025年国家公务员考试《行测》地市级（V2整卷模板）

> 新版规则：一份 Markdown 文件就是一整套试卷，文件名和一级标题必须包含年份与试卷类型。
> 图片统一放在 Markdown 同级的 images 文件夹，正文中使用 images/文件名.png。
> 资料分析必须按“一个材料题组 + 连续5个小题”填写；题组ID只负责关联材料和小题，不会生成多套试卷。
> 图形推理若题干和A-D选项合在一张图里，只放一张“题干及选项合成图”，A-D统一填写“如上图所示”；即使省略A-D，转换器也会自动补齐。

## 题组：资料分析 116-120
题组ID：data-116-120
模块：资料分析
年份：2025
试卷：2025年国家公务员考试《行测》地市级
来源：国考真题
难度：中等

### 材料
这里填写资料分析大段文字材料。

![材料图1](images/data-116-120-01.png)
![材料图2](images/data-116-120-02.png)

### 116
题干：2019年，中国IC先进封装市场规模约为多少亿元？

A. 296
B. 279
C. 252
D. 235

答案：D
解析：根据材料图表计算，选择D。

### 117
题干：这里填写第117题题干。

A. 选项A
B. 选项B
C. 选项C
D. 选项D

答案：B
解析：这里填写解析。

### 118
题干：这里填写第118题题干。

A. 选项A
B. 选项B
C. 选项C
D. 选项D

答案：A
解析：这里填写解析。

### 119
题干：这里填写第119题题干。

A. 选项A
B. 选项B
C. 选项C
D. 选项D

答案：C
解析：这里填写解析。

### 120
题干：这里填写第120题题干。

A. 选项A
B. 选项B
C. 选项C
D. 选项D

答案：D
解析：这里填写解析。

## 题组：图形推理 61
题组ID：logic-061
模块：判断推理
年份：2025
试卷：2025年国家公务员考试《行测》地市级
来源：国考真题
难度：中等

### 61
题干：请选择最合适的一项。

![题干及选项合成图](images/logic-061-composite.png)

A. 如上图所示
B. 如上图所示
C. 如上图所示
D. 如上图所示

答案：C
解析：观察图形规律，选择C。
![解析图](images/logic-061-analysis.png)
`;

const TEMPLATE_JSON = {
  schema_version: 2,
  paper: {
    _id: 'xingce_2025_national_city_template',
    title: '2025年国家公务员考试《行测》地市级（V2结构样例）',
    year: 2025,
    exam_type: 'national',
    paper_level: 'city',
    position: '地市级',
    status: 'draft',
    question_count: 1,
    group_count: 1,
  },
  groups: [{
    _id: 'group_xingce_2025_national_city_template_01',
    paper_id: 'xingce_2025_national_city_template',
    module_id: 'mod_language',
    sequence: 1,
    title: '言语理解示例',
    question_ids: ['q_xingce_2025_national_city_template_001'],
    material_blocks: [],
    material_text: '',
    material_images: [],
    status: 'draft',
    schema_version: 2,
  }],
  questions: [{
    _id: 'q_xingce_2025_national_city_template_001',
    paper_id: 'xingce_2025_national_city_template',
    group_id: 'group_xingce_2025_national_city_template_01',
    module_id: 'mod_language',
    question_number: 1,
    sequence: 1,
    type: 'single',
    content: '这里填写题干。',
    stem_blocks: [{ type: 'text', text: '这里填写题干。' }],
    stem_images: [],
    options_v2: 'ABCD'.split('').map((key, index) => ({
      key,
      content_blocks: [{ type: 'text', text: `选项${key}` }],
      text: `选项${key}`,
      images: [],
    })),
    options: ['选项A', '选项B', '选项C', '选项D'],
    option_images: [[], [], [], []],
    answer: 0,
    answer_verified: true,
    status: 'draft',
    schema_version: 2,
  }],
  solutions: [{
    _id: 'solution_q_xingce_2025_national_city_template_001',
    question_id: 'q_xingce_2025_national_city_template_001',
    paper_id: 'xingce_2025_national_city_template',
    answer: 0,
    explanation: '这里填写解析。',
    explanation_blocks: [{ type: 'text', text: '这里填写解析。' }],
    explanation_images: [],
    status: 'draft',
    schema_version: 2,
  }],
  media: [],
  validation_errors: [],
  validation_warnings: [],
};

const TEMPLATE_WORD_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>考公宝题库上传模板</title></head>
<body>
<h1>考公宝题库上传模板</h1>
<p>一份 Markdown 文件代表一整套试卷。请按固定标题填写；Word 写完后，复制或另存为 Markdown 再导入后台。</p>
<h2>题组：2022国考副省级 资料分析 116-120</h2>
<p>试卷ID：xingce_2022_national_sub_provincial</p>
<p>题组ID：2022-fu-data-116-120</p>
<p>模块：资料分析</p>
<p>年份：2022</p>
<p>试卷：2022年国家公务员考试行测真题副省级</p>
<p>来源：国考真题</p>
<p>难度：中等</p>
<h3>材料</h3>
<p>这里填写资料分析大段文字材料。</p>
<p>![材料图1](/assets/question-images/md-bank/2022-data-116-120.png)</p>
<h3>116</h3>
<p>题干：2019年，中国IC先进封装市场规模约为多少亿元？</p>
<p>A. 296</p><p>B. 279</p><p>C. 252</p><p>D. 235</p>
<p>答案：D</p>
<p>解析：根据材料图表计算，选择D。</p>
<h2>题组：2022国考副省级 图形推理 61</h2>
<p>试卷ID：xingce_2022_national_sub_provincial</p>
<p>题组ID：2022-fu-logic-061</p>
<p>模块：判断推理</p>
<h3>61</h3>
<p>题干：请选择最合适的一项。</p>
<p>![题干图](/assets/question-images/md-bank/2022-logic-061-stem.png)</p>
<p>A. ![A](/assets/question-images/md-bank/2022-logic-061-a.png)</p>
<p>B. ![B](/assets/question-images/md-bank/2022-logic-061-b.png)</p>
<p>C. ![C](/assets/question-images/md-bank/2022-logic-061-c.png)</p>
<p>D. ![D](/assets/question-images/md-bank/2022-logic-061-d.png)</p>
<p>答案：C</p>
<p>解析：观察图形规律，选择C。</p>
</body>
</html>`;

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function logImport(value) {
  $('#importLog').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function logEssay(value) {
  $('#essayImportLog').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function runEssayAction(action) {
  return Promise.resolve()
    .then(action)
    .catch(err => {
      $('#essayImportStatus').textContent = '操作失败';
      logEssay({ error: err.message });
      alert(err.message);
    });
}

function isOnlineMode() {
  return Boolean(state.endpoint && state.secret);
}

function updateConnection() {
  $('#endpointInput').value = state.endpoint;
  $('#secretInput').value = state.secret;
  $('#envIdInput').value = state.envId;
  $('#connectionDot').classList.toggle('online', isOnlineMode());
  setText('#connectionText', isOnlineMode() ? '云端管理模式' : '离线处理模式');
  let endpointLabel = '未配置云函数地址';
  if (isOnlineMode()) {
    if (state.endpoint.startsWith('/')) {
      endpointLabel = `${location.host || '本地代理'}${state.endpoint}`;
    } else {
      try {
        endpointLabel = new URL(state.endpoint).host;
      } catch (err) {
        endpointLabel = '地址格式待确认';
      }
    }
  }
  setText('#connectionMeta', endpointLabel);
}

let cloudbaseApp = null;

function getCloudbaseApp() {
  if (window.__cloudbaseApp) return window.__cloudbaseApp;
  if (typeof cloudbase === 'undefined') {
    throw new Error('CloudBase JS SDK 未加载，请检查网络或刷新页面');
  }
  if (typeof cloudbase.init !== 'function') {
    throw new Error('CloudBase SDK 版本不正确：检测到旧版 SDK（无 cloudbase.init）。请按 Ctrl+F5 强制刷新页面。');
  }
  if (!cloudbaseApp) {
    cloudbaseApp = cloudbase.init({ env: state.envId || 'cloud1-d0gsr2l1ye6344917' });
  }
  return cloudbaseApp;
}

async function ensureAnonymousAuth() {
  const app = getCloudbaseApp();
  if (typeof app.auth !== 'function') {
    throw new Error('CloudBase SDK 初始化异常：app.auth 不是函数，可能加载了旧版 SDK。请按 Ctrl+F5 强制刷新页面。');
  }
  const auth = app.auth();
  try {
    const loginState = await auth.getLoginState();
    if (loginState && loginState.isAnonymousAuth) return;
  } catch (e) {
    // 忽略，继续尝试登录
  }
  await auth.signInAnonymously();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

async function uploadBookFileToStorage(file, cloudPath) {
  const app = getCloudbaseApp();
  if (typeof app.uploadFile !== 'function') {
    throw new Error('CloudBase Web SDK 未正确加载：app.uploadFile 不可用。请确认 cloudbase-sdk-web.js 已更新并 Ctrl+F5 强刷。');
  }
  const res = await app.uploadFile({ cloudPath, filePath: file });
  return res;
}

async function uploadXingceMedia(pkg) {
  const media = Array.isArray(pkg?.media) ? pkg.media : [];
  const pending = media.filter(item => !/^(?:cloud:\/\/|https?:\/\/)/i.test(String(item.path || '')));
  if (!pending.length) return { uploaded: 0, package: pkg };
  if (!state.xingceImageFiles.size) {
    throw new Error('题库包包含本地图片路径。请在“V2图片目录”选择转换结果中的 images 文件夹。');
  }
  await ensureAnonymousAuth();
  const replacements = new Map();
  const paperId = String(pkg.paper?._id || 'paper').replace(/[^\w-]+/g, '_');
  let uploaded = 0;
  const uploadOne = async item => {
    const filename = String(item.path || '').split('/').pop();
    const file = state.xingceImageFiles.get(filename);
    if (!file) throw new Error(`图片目录中缺少：${filename}`);
    const result = await uploadBookFileToStorage(file, `question-images/xingce-v2/${paperId}/${filename}`);
    const fileId = result.fileID || result.fileId;
    if (!fileId) throw new Error(`图片上传未返回 fileID：${filename}`);
    replacements.set(item.path, fileId);
    uploaded += 1;
    $('#importStatus').textContent = `正在上传题库图片 ${uploaded}/${pending.length}`;
  };
  for (let index = 0; index < pending.length; index += 5) {
    await Promise.all(pending.slice(index, index + 5).map(uploadOne));
  }
  const rewrite = value => {
    if (typeof value === 'string') return replacements.get(value) || value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(key => { value[key] = rewrite(value[key]); });
    }
    return value;
  };
  rewrite(pkg);
  return { uploaded, package: pkg };
}

async function uploadBookFileByCloudFunction(file) {
  const fileBase64 = await fileToBase64(file);
  return callAdmin('upload_book_file', {
    file_name: file.name,
    file_type: file.type,
    file_base64: fileBase64,
  }, 180000);
}

async function uploadBookFileByLocalServer(file, cloudPath) {
  const uploadUrl = location.protocol === 'file:'
    ? 'http://127.0.0.1:8787/api/upload-book-file'
    : '/api/upload-book-file';
  const form = new FormData();
  form.append('admin_secret', state.secret);
  form.append('cloud_path', cloudPath);
  form.append('file', file, file.name);
  const response = await fetch(uploadUrl, { method: 'POST', body: form });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    result = { message: text || err.message };
  }
  if (!response.ok || result.code) {
    throw new Error(result.message || '本地服务上传失败');
  }
  return result;
}

function buildFetchErrorMessage(err) {
  if (location.protocol === 'file:' && /^https:\/\/.+\.tcloudbase\.com\//.test(state.endpoint)) {
    return [
      '请求被浏览器 CORS 拦截。',
      '当前页面是 file:// 打开的，建议双击 admin/start-admin.bat 后访问 http://127.0.0.1:8787。',
      '在连接设置里把 HTTP 地址改成 /api/admin，密钥保持 ADMIN_SECRET 不变。',
      '如果坚持直连 CloudBase，请先重新部署 admin 云函数，让新的 CORS 配置生效。',
    ].join('\n');
  }
  return err.message || '请求失败';
}

async function callAdmin(action, payload = {}, timeoutMs = 90000) {
  if (!isOnlineMode()) {
    throw new Error('请先在连接设置中配置云函数 HTTP 地址和 ADMIN_SECRET');
  }

  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(state.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, admin_secret: state.secret, ...payload }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('本批导入等待超时。请刷新页面后重试，系统已改为小批量导入。');
    }
    throw new Error(buildFetchErrorMessage(err));
  } finally {
    clearTimeout(timer);
  }

  const result = await response.json();
  if (!response.ok || result.code !== 0) {
    throw new Error(result.message || `请求失败：${response.status}`);
  }
  return result.data;
}

function switchView(view) {
  state.view = view;
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $$('.view').forEach(item => item.classList.remove('active'));
  $(`#${view}View`).classList.add('active');

  const copy = {
    dashboard: ['总览', '查看核心数据规模和题库分布。'],
    questions: ['题库', '筛选、编辑和逻辑下线题目。'],
    bookpacks: ['图书礼包', '上传 PDF/Word 备考资料，用户在小程序内点击即可下载。'],
    ocr: ['智能 OCR', '上传扫描版真题，自动识别并生成行测/申论试卷。'],
    drafts: ['草稿箱', 'AI/OCR 识别结果经逐题审核后发布到正式题库。'],
    import: ['行测题库', '按模板生成、复核并导入新版 V2 整卷。'],
    essay: ['申论题库', '解析申论真题，预览题型并按试卷结构导入云端。'],
    settings: ['连接设置', '配置管理云函数 HTTP 地址和密钥。'],
  };
  setText('#viewTitle', copy[view][0]);
  setText('#viewDesc', copy[view][1]);

  if (view === 'bookpacks' && isOnlineMode()) {
    loadBookPacks().catch(err => console.error('加载图书礼包失败', err));
  }
  if (view === 'ocr') {
    detectOcrEnvironment().catch(err => console.error('检测 OCR 环境失败', err));
  }
  if (view === 'essay' && isOnlineMode()) {
    loadEssayPapers().catch(err => console.error('加载申论试卷失败', err));
  }
}

function renderDashboard(data) {
  const totals = data?.totals || {};
  const metrics = [
    ['题目', totals.questions || state.importClean.length || 0],
    ['用户', totals.users || 0],
    ['答题记录', totals.user_answers || 0],
    ['会员订单', totals.orders || 0],
  ];

  $('#metrics').innerHTML = metrics.map(([label, value]) => `
    <article class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join('');

  const moduleCounts = data?.module_counts || countModules(state.importClean);
  const max = Math.max(1, ...Object.values(moduleCounts));
  $('#moduleBars').innerHTML = Object.entries(MODULE_LABELS).map(([key, label]) => {
    const value = moduleCounts[key] || 0;
    return `
      <div class="bar">
        <div class="bar-label"><span>${label}</span><strong>${value}</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((value / max) * 100)}%"></div></div>
      </div>
    `;
  }).join('');

  const recent = data?.recent_questions || state.importClean.slice(0, 8);
  $('#recentList').innerHTML = recent.length ? recent.map(item => `
    <article class="recent-item">
      <strong>${item._id || item.question_id || '未命名题目'}</strong>
      <p>${item.content || ''}</p>
    </article>
  `).join('') : '<p class="hint">暂无数据。</p>';
}

function renderEssayPackage(data = state.essayPackage) {
  const metrics = $('#essayMetrics');
  const table = $('#essayQuestionTable');
  if (!data) {
    metrics.innerHTML = '';
    table.innerHTML = '<tr><td colspan="7">请先选择申论真题 Markdown。</td></tr>';
    setText('#essayQuestionCount', '0 题');
    return;
  }

  const errors = Array.isArray(data.validation_errors) ? data.validation_errors : [];
  const values = [
    ['试卷', data.paper?.title || '未识别'],
    ['材料', `${data.materials?.length || 0} 份`],
    ['题目', `${data.questions?.length || 0} 道`],
    ['答案', `${data.answers?.length || 0} 份`],
    ['总分', `${data.paper?.total_score || 0} 分`],
  ];
  metrics.innerHTML = values.map(([label, value]) => `
    <article class="essay-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>
  `).join('');
  setText('#essayQuestionCount', `${data.questions?.length || 0} 题`);
  table.innerHTML = data.questions?.length ? data.questions.map(item => {
    const min = item.requirements?.min_words || 0;
    const max = item.requirements?.max_words || 0;
    const words = min && max ? `${min}-${max}` : (max ? `≤${max}` : '—');
    const materialRefs = (item.material_ids || []).map(id => id.match(/_m(\d+)$/)?.[1]).filter(Boolean).join('、') || '全部/未限定';
    return `
      <tr>
        <td>${item.sequence}</td>
        <td>${escapeHtml(ESSAY_TYPE_LABELS[item.primary_type] || item.primary_type)}</td>
        <td>${escapeHtml(ESSAY_SUBTYPE_LABELS[item.subtype] || item.subtype)}</td>
        <td>${escapeHtml(materialRefs)}</td>
        <td>${item.score}</td>
        <td>${escapeHtml(words)}</td>
        <td class="essay-question-prompt">${escapeHtml(item.prompt)}</td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="7">没有识别到题目。</td></tr>';

  $('#essayImportStatus').textContent = errors.length ? `发现 ${errors.length} 项异常` : '解析校验通过';
  logEssay({
    paper: data.paper,
    import_meta: data.import_meta,
    validation_errors: errors,
    answers: (data.answers || []).map(item => ({ question_id: item.question_id, answer_type: item.answer_type, outline_points: item.answer_outline?.length || 0 })),
  });
}

function renderEssayPapers(list = state.essayPapers) {
  setText('#essayPaperCount', `${list.length} 套`);
  $('#essayPaperList').innerHTML = list.length ? list.map(item => `
    <article class="essay-paper-item">
      <div>
        <h3>${escapeHtml(item.title || item._id)}</h3>
        <p>${escapeHtml(item.year || '')} · ${escapeHtml(item.paper_level || '通用')} · ${item.material_count || 0}份材料 · ${item.question_count || 0}题 · ${item.total_score || 0}分</p>
      </div>
      <div class="import-actions">
        <span class="status-pill">${item.status === 'enabled' ? '已发布' : (item.status === 'disabled' ? '已下线' : '草稿')}</span>
        <button class="button ${item.status === 'enabled' ? 'secondary' : ''} small" data-essay-status="${escapeHtml(item._id)}" data-target-status="${item.status === 'enabled' ? 'draft' : 'enabled'}">
          ${item.status === 'enabled' ? '转为草稿' : '审核并发布'}
        </button>
      </div>
    </article>
  `).join('') : '<p class="hint">云端暂无申论试卷。</p>';
}

async function loadEssayPapers() {
  if (!isOnlineMode()) {
    renderEssayPapers([]);
    return;
  }
  const result = await callAdmin('list_essay_papers', { page: 1, page_size: 100 });
  state.essayPapers = result.list || [];
  renderEssayPapers();
}

async function handleEssayFile(file) {
  if (!file) return;
  if (!window.EssayParser?.parseEssayPaperMarkdown) {
    throw new Error('申论解析器未加载，请刷新后台页面后重试。');
  }
  $('#essayImportStatus').textContent = '正在解析';
  const source = await file.text();
  state.essayPackage = window.EssayParser.parseEssayPaperMarkdown(source, { filename: file.name });
  renderEssayPackage();
}

function renderQuestions(list = state.questions) {
  $('#questionTable').innerHTML = list.length ? list.map(item => `
    <tr>
      <td>${item._id}</td>
      <td>${MODULE_LABELS[item.module_id] || item.module_id}</td>
      <td>${item.year || ''}</td>
      <td>${item.difficulty || ''}</td>
      <td><span class="cell-text">${item.content || ''}</span></td>
      <td>
        <button class="text-button" data-edit="${item._id}">编辑</button>
        <button class="text-button" data-delete="${item._id}">下线</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="6">暂无题目。可先在“行测题库”生成并导入新版 V2 整卷。</td></tr>';
}

function countModules(list) {
  return list.reduce((acc, item) => {
    acc[item.module_id] = (acc[item.module_id] || 0) + 1;
    return acc;
  }, {});
}

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(item => normalizeText(String(item))).filter(Boolean);
  if (typeof value === 'string') return value.split(/\n|,|，|;|；/).map(normalizeText).filter(Boolean);
  return [];
}

function normalizeImageArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => normalizeText(String(item))).filter(Boolean);
}

function normalizeOptionImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map(group => normalizeImageArray(group));
}

function normalizeQuestion(raw, index = 0) {
  const type = raw.type === 'multiple' ? 'multiple' : 'single';
  const moduleId = MODULE_LABELS[raw.module_id] ? raw.module_id : 'mod_language';
  const answerValue = raw.answer ?? raw.correctOption ?? 0;

  return {
    _id: normalizeText(raw._id || raw.id || raw.question_id) || `q_import_${Date.now()}_${index}`,
    module_id: moduleId,
    type,
    difficulty: ['简单', '中等', '困难'].includes(raw.difficulty) ? raw.difficulty : '中等',
    source: normalizeText(raw.source || '真题'),
    year: Number(raw.year) || new Date().getFullYear(),
    content: normalizeText(raw.content || raw.stem || raw.title),
    material: normalizeText(raw.material),
    material_images: normalizeImageArray(raw.material_images || raw.materialImages),
    stem_images: normalizeImageArray(raw.stem_images || raw.stemImages),
    options: normalizeArray(raw.options || raw.optionTexts),
    option_images: normalizeOptionImages(raw.option_images || raw.optionImages),
    answer: type === 'multiple'
      ? normalizeArray(answerValue).map(Number).filter(Number.isFinite)
      : (/^[A-D]$/i.test(String(answerValue).trim())
        ? String(answerValue).trim().toUpperCase().charCodeAt(0) - 65
        : Number(answerValue) || 0),
    explanation: normalizeText(raw.explanation || raw.analysis),
    explanation_images: normalizeImageArray(raw.explanation_images || raw.analysisImages),
    commonErrors: normalizeText(raw.commonErrors || raw.common_errors),
    tags: normalizeArray(raw.tags),
    points: Number(raw.points) || 1,
    paper_id: normalizeText(raw.paper_id),
    paper_name: normalizeText(raw.paper_name),
    group_id: normalizeText(raw.group_id),
    question_number: Number(raw.question_number) || index + 1,
    sequence: Number(raw.sequence) || Number(raw.question_number) || index + 1,
    province: normalizeText(raw.province || '国家'),
    position: normalizeText(raw.position),
    paper_date: normalizeText(raw.paper_date),
    status: raw.status === 'disabled' ? 'disabled' : 'enabled',
  };
}

function optionSignalCount(question) {
  const textCount = Array.isArray(question.options)
    ? question.options.filter(option => normalizeText(option)).length
    : 0;
  const imageCount = Array.isArray(question.option_images)
    ? question.option_images.filter(group => Array.isArray(group) && group.length > 0).length
    : 0;
  return Math.max(textCount, imageCount);
}

function isPlaceholderOptionSet(options) {
  return Array.isArray(options) && options.length === 4 && options.every((opt, index) => opt === `选项${'ABCD'[index]}`);
}

function isQuestionLikeContent(content) {
  const text = String(content || '').trim();
  return /[？?：:]$/.test(text) || /多少|比例|比重|正确|可以|能够|约为|是：|为：/.test(text);
}

function splitOptionTrailingMaterial(option) {
  const text = String(option || '');
  const marker = text.search(/\n\s*[（(][一二三四五六七八九十]+[）)]/);
  if (marker < 0) return { option: text.trim(), material: '' };
  return {
    option: text.slice(0, marker).trim(),
    material: text.slice(marker).trim(),
  };
}

function repairDataMaterials(list) {
  const repaired = [];
  let pendingMaterial = '';
  let activeMaterial = '';
  let activeRemaining = 0;

  list.forEach(question => {
    const q = { ...question, options: [...(question.options || [])] };
    let trailingMaterial = '';
    q.options = q.options.map(option => {
      const split = splitOptionTrailingMaterial(option);
      if (split.material) trailingMaterial += `\n${split.material}`;
      return split.option;
    }).filter(Boolean);

    const isData = q.module_id === 'mod_data';
    const isFragment = isData && isPlaceholderOptionSet(q.options) && !isQuestionLikeContent(q.content);

    if (isFragment) {
      pendingMaterial = `${pendingMaterial}\n${q.content}`.trim();
      return;
    }

    if (isData) {
      if (pendingMaterial) {
        activeMaterial = pendingMaterial;
        activeRemaining = 5;
        pendingMaterial = '';
      }
      if (!q.material && activeMaterial && activeRemaining > 0) {
        q.material = activeMaterial;
      }
      if (activeRemaining > 0) activeRemaining -= 1;
      if (trailingMaterial) {
        pendingMaterial = trailingMaterial.trim();
      }
    }

    repaired.push(q);
  });

  return repaired;
}

function validateQuestion(question) {
  const errors = [];
  if (!question._id) errors.push('_id 缺失');
  if (!question.content) errors.push('题干缺失');
  if (optionSignalCount(question) < 2) errors.push('选项少于 2 个');
  if (!MODULE_LABELS[question.module_id]) errors.push('模块无效');
  if (question.type === 'single' && !Number.isInteger(question.answer)) errors.push('单选答案必须是数字索引');
  return errors;
}

function moduleIdFromText(value) {
  const text = String(value || '');
  if (/资料分析/.test(text)) return 'mod_data';
  if (/判断推理|图形推理|逻辑判断|定义判断|类比推理/.test(text)) return 'mod_logic';
  if (/数量关系|数学运算|数字推理/.test(text)) return 'mod_quantity';
  if (/言语理解/.test(text)) return 'mod_language';
  if (/常识判断|常识/.test(text)) return 'mod_common_sense';
  return 'mod_language';
}

function answerIndexFromText(value) {
  const text = String(value || '').trim().toUpperCase();
  if (/^[A-D]$/.test(text)) return text.charCodeAt(0) - 65;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function extractImages(markdown) {
  return Array.from(String(markdown || '').matchAll(/!\[[^\]]*]\(([^)]+)\)/g))
    .map(match => match[1].trim())
    .filter(Boolean);
}

function looksLikeImagePath(value) {
  return /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(String(value || '').trim());
}

function extractLineImages(line) {
  const result = extractImages(line);
  const [key, value] = parseMetaValue(line);
  if (/^(?:题干图|材料图|图片路径|解析图|图\d*)$/.test(key) && looksLikeImagePath(value)) result.push(value.trim());
  return [...new Set(result)];
}

function stripImages(markdown) {
  return String(markdown || '').replace(/!\[[^\]]*]\([^)]+\)/g, '').trim();
}

function cleanMdValue(value) {
  return stripImages(value).replace(/^\s*[:：]\s*/, '').trim();
}

function parseMetaValue(line) {
  const match = String(line || '').match(/^([^：:]+)[：:]\s*(.*)$/);
  return match ? [match[1].trim(), match[2].trim()] : ['', ''];
}

function parseMarkdownQuestion(section, group, sequence) {
  const lines = section.body.split('\n');
  const options = ['', '', '', ''];
  const optionImages = [[], [], [], []];
  const stemParts = [];
  const stemImages = [];
  const explanationParts = [];
  const explanationImages = [];
  let answer = 0;
  let mode = 'stem';

  lines.forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return;

    const optionMatch = line.match(/^([A-D])\s*[.、：:]\s*(.*)$/i);
    if (optionMatch) {
      const idx = optionMatch[1].toUpperCase().charCodeAt(0) - 65;
      const value = optionMatch[2] || '';
      const plainImage = !extractImages(value).length && looksLikeImagePath(value) ? value.trim() : '';
      options[idx] = plainImage ? optionMatch[1].toUpperCase() : (cleanMdValue(value) || optionMatch[1].toUpperCase());
      optionImages[idx].push(...extractImages(value), ...(plainImage ? [plainImage] : []));
      mode = 'options';
      return;
    }

    const [key, value] = parseMetaValue(line);
    if (key === '题干') {
      stemParts.push(cleanMdValue(value));
      stemImages.push(...extractImages(value));
      mode = 'stem';
      return;
    }
    if (key === '答案') {
      answer = answerIndexFromText(value);
      mode = 'answer';
      return;
    }
    if (key === '解析') {
      explanationParts.push(cleanMdValue(value));
      explanationImages.push(...extractImages(value));
      mode = 'explanation';
      return;
    }

    if (/^(?:题干图|材料图|图片路径|解析图|图\d*)$/.test(key) && looksLikeImagePath(value)) {
      if (key === '解析图' || mode === 'explanation') explanationImages.push(value.trim());
      else stemImages.push(value.trim());
      return;
    }

    if (extractLineImages(line).length && mode === 'stem') {
      stemImages.push(...extractLineImages(line));
      return;
    }
    if (extractLineImages(line).length && mode === 'explanation') {
      explanationImages.push(...extractLineImages(line));
      return;
    }
    if (mode === 'explanation') {
      explanationParts.push(cleanMdValue(line));
    } else if (mode !== 'answer' && mode !== 'options') {
      stemParts.push(cleanMdValue(line));
      stemImages.push(...extractImages(line));
    }
  });

  const questionNumber = Number(section.number) || sequence + 1;
  const safePaper = String(group.paper_name || 'paper').replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40);
  const paperId = group.paper_id || `md_${group.year || new Date().getFullYear()}_${safePaper}`;
  return normalizeQuestion({
    _id: `${paperId}_${String(questionNumber).padStart(3, '0')}`,
    module_id: group.module_id,
    type: 'single',
    difficulty: group.difficulty || '中等',
    source: group.source || '自建题库',
    year: group.year || new Date().getFullYear(),
    paper_id: paperId,
    paper_name: group.paper_name || '',
    group_id: group.group_id || '',
    question_number: questionNumber,
    sequence: sequence + 1,
    content: stemParts.filter(Boolean).join('\n'),
    material: group.material || '',
    material_images: group.material_images || [],
    stem_images: stemImages,
    options,
    option_images: optionImages,
    answer,
    explanation: explanationParts.filter(Boolean).join('\n'),
    explanation_images: explanationImages,
    tags: group.tags || [],
    status: 'enabled',
  }, sequence);
}

function parseMarkdownBank(markdown) {
  const text = String(markdown || '').replace(/\r\n/g, '\n');
  const groups = text.split(/^##\s+/m).map(item => item.trim()).filter(Boolean);
  const questions = [];

  groups.forEach((groupText, groupIndex) => {
    const lines = groupText.split('\n');
    const title = lines.shift() || `题组${groupIndex + 1}`;
    const body = lines.join('\n');
    const yearMatch = title.match(/(20\d{2}|19\d{2})/);
    const group = {
      module_id: moduleIdFromText(title),
      year: yearMatch ? Number(yearMatch[1]) : new Date().getFullYear(),
      paper_name: title.replace(/^题组[：:]\s*/, '').trim(),
      source: '自建题库',
      difficulty: '中等',
      tags: [],
      material: '',
      material_images: [],
      paper_id: '',
      group_id: '',
    };

    const beforeFirstQuestion = body.split(/^###\s*\d+/m)[0] || '';
    beforeFirstQuestion.split('\n').forEach(line => {
      const [key, value] = parseMetaValue(line.trim());
      if (key === '模块') group.module_id = moduleIdFromText(value);
      if (key === '年份') group.year = Number(value) || group.year;
      if (key === '试卷') group.paper_name = value;
      if (key === '来源') group.source = value;
      if (key === '难度') group.difficulty = value;
      if (key === '试卷ID') group.paper_id = value;
      if (key === '题组ID') group.group_id = value;
    });

    if (!group.paper_id) {
      const safePaper = String(group.paper_name || title).replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 60);
      group.paper_id = `md_${group.year}_${safePaper}`;
    }
    if (!group.group_id) group.group_id = `${group.paper_id}_group_${groupIndex + 1}`;

    const materialMatch = body.match(/^###\s*材料\s*\n([\s\S]*?)(?=^###\s*\d+|(?![\s\S]))/m);
    if (materialMatch) {
      const materialLines = materialMatch[1].split('\n');
      group.material = stripImages(materialLines.filter(line => {
        const [key] = parseMetaValue(line.trim());
        return !/^(?:题干图|材料图|图片路径|解析图|图\d*)$/.test(key);
      }).join('\n')).split('\n').map(item => item.trim()).filter(Boolean).join('\n');
      group.material_images = [...new Set(materialLines.flatMap(extractLineImages))];
    }

    const questionMatches = Array.from(body.matchAll(/^###\s*(\d+)\s*\n([\s\S]*?)(?=^###\s*\d+|(?![\s\S]))/gm));
    questionMatches.forEach((match, index) => {
      questions.push(parseMarkdownQuestion({ number: match[1], body: match[2] }, group, questions.length + index));
    });
  });

  return questions;
}

function runOfflineClean() {
  if (!state.xingcePackage) {
    $('#importStatus').textContent = '请先载入新版 V2 试卷';
    logImport({ status: 'waiting_v2_package', message: '请从转换结果载入试卷，或选择新版 bank.json。' });
    alert('请先从转换结果载入一套试卷，或选择新版 V2 bank.json。');
    return;
  }
  revalidateCurrentV2Package();
  const errors = Array.isArray(state.xingcePackage.validation_errors) ? state.xingcePackage.validation_errors : [];
  const warnings = Array.isArray(state.xingcePackage.validation_warnings) ? state.xingcePackage.validation_warnings : [];
  const summary = {
    schema_version: state.xingcePackage.schema_version,
    paper: state.xingcePackage.paper,
    groups: state.xingcePackage.groups?.length || 0,
    questions: state.xingcePackage.questions?.length || 0,
    solutions: state.xingcePackage.solutions?.length || 0,
    media: state.xingcePackage.media?.length || 0,
    valid: errors.length === 0,
    errors,
    warning_count: warnings.length,
    warnings,
  };
  $('#importStatus').textContent = errors.length
    ? `V2试卷有 ${errors.length} 项必须修正`
    : `V2试卷检查通过：${summary.questions}题${warnings.length ? `，${warnings.length}项待复核` : ''}`;
  if (ocrState.jobId) updateOcrStep(errors.length || warnings.length ? 'review' : 'validate');
  logImport(summary);
  renderV2Review();
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function localApiUrl(pathname) {
  return location.protocol === 'file:' ? `http://127.0.0.1:8787${pathname}` : pathname;
}

function renderGeneratedPackages(papers = state.generatedXingcePapers) {
  state.generatedXingcePapers = Array.isArray(papers) ? papers : [];
  setText('#generatedPackageCount', `${state.generatedXingcePapers.length} 套`);
  const list = $('#generatedPackageList');
  if (!list) return;
  list.innerHTML = state.generatedXingcePapers.length ? state.generatedXingcePapers.map(item => {
    const valid = item.valid !== false;
    const statusText = valid ? '结构通过' : `${item.error_count || item.errors?.length || 0}项错误`;
    return `
      <article class="essay-paper-item">
        <div>
          <h3>${escapeHtml(item.title || item.paper_id)}</h3>
          <p>${item.questions || 0}题 · ${item.groups || 0}个题组 · ${item.media || 0}张图片 · ${item.warning_count || 0}项待复核</p>
        </div>
        <div class="import-actions">
          <span class="status-pill">${escapeHtml(statusText)}</span>
          <button class="button ${valid ? '' : 'secondary'} small" data-load-generated-paper="${escapeHtml(item.paper_id)}">
            ${valid ? '载入这套试卷' : '载入查看错误'}
          </button>
        </div>
      </article>
    `;
  }).join('') : '<p class="hint">还没有转换结果，请先点击“批量转换整套试卷”。</p>';
}

async function loadGeneratedCatalog() {
  const response = await fetch(localApiUrl('/api/generated-xingce-catalog'));
  if (!response.ok) return;
  const result = await response.json();
  renderGeneratedPackages(result.papers || []);
}

async function loadGeneratedPackage(paperId) {
  const paper = state.generatedXingcePapers.find(item => item.paper_id === paperId);
  $('#importStatus').textContent = `正在载入：${paper?.title || paperId}`;
  const response = await fetch(localApiUrl(`/api/generated-xingce-package?paper_id=${encodeURIComponent(paperId)}`));
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || '读取生成的 bank.json 失败');
  }
  const pkg = await response.json();
  const localMedia = (pkg.media || []).filter(item => !/^(?:cloud:\/\/|https?:\/\/)/i.test(String(item.path || '')));
  const files = new Map();
  let loaded = 0;
  for (let index = 0; index < localMedia.length; index += 5) {
    await Promise.all(localMedia.slice(index, index + 5).map(async item => {
      const filename = String(item.path || '').split('/').pop();
      const imageUrl = localApiUrl(`/api/generated-xingce-image?paper_id=${encodeURIComponent(paperId)}&filename=${encodeURIComponent(filename)}`);
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) throw new Error(`自动读取图片失败：${filename}`);
      const blob = await imageResponse.blob();
      files.set(filename, new File([blob], filename, { type: item.mime || blob.type || 'application/octet-stream' }));
      loaded += 1;
      $('#importStatus').textContent = `正在载入图片 ${loaded}/${localMedia.length}`;
    }));
  }
  state.xingcePackage = pkg;
  state.importSource = [];
  state.importClean = [];
  state.xingceImageFiles = files;
  const compositeOptionsFilled = normalizeCompositeImageOptions(pkg);
  pkg.validation_errors = validateV2PackageLocally(pkg);
  pkg.validation_warnings = buildV2ReviewWarnings(pkg);
  $('#fileInput').value = '';
  $('#xingceImageInput').value = '';
  $('#xingceImageStatus').textContent = files.size ? `已自动载入 ${files.size} 张图片，无需再选择目录` : '本套试卷没有本地图片';
  const errors = pkg.validation_errors || [];
  const warnings = pkg.validation_warnings || [];
  $('#importStatus').textContent = errors.length
    ? `已载入 ${pkg.questions?.length || 0} 题，发现 ${errors.length} 项错误`
    : `已载入 ${pkg.questions?.length || 0} 题、${files.size} 张图片，${warnings.length}项待复核`;
  logImport({
    loaded_from_generated_package: paperId,
    paper: pkg.paper,
    groups: pkg.groups?.length || 0,
    questions: pkg.questions?.length || 0,
    images: files.size,
    composite_options_filled: compositeOptionsFilled,
    validation_errors: errors,
    validation_warnings: warnings,
  });
  renderV2Review();
  $('#validateBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function findQuestionForIssue(pkg, issue) {
  const path = String(issue?.path || '');
  const direct = (pkg.questions || []).find(question => path.includes(question._id));
  if (direct) return direct;
  const questionIndex = path.match(/^questions\.(\d+)/)?.[1];
  if (questionIndex !== undefined) return pkg.questions?.[Number(questionIndex)] || null;
  const solutionIndex = path.match(/^solutions\.(\d+)/)?.[1];
  if (solutionIndex !== undefined) {
    const solution = pkg.solutions?.[Number(solutionIndex)];
    return (pkg.questions || []).find(question => question._id === solution?.question_id) || null;
  }
  return null;
}

function v2OptionReady(option) {
  return Boolean(
    normalizeText(option?.text)
    || (Array.isArray(option?.images) && option.images.length)
    || (option?.content_blocks || []).some(block => (
      block?.type === 'image'
      || normalizeText(block?.text)
      || (block?.type === 'formula' && normalizeText(block?.latex))
    ))
  );
}

function normalizeCompositeImageOptions(pkg) {
  let updated = 0;
  (pkg?.questions || []).forEach(question => {
    const options = Array.isArray(question.options_v2) ? question.options_v2 : [];
    const hasCompositeStemImage = (question.stem_images || []).length > 0
      || (question.stem_blocks || []).some(block => block?.type === 'image');
    if (!hasCompositeStemImage || options.length !== 4 || options.some(v2OptionReady)) return;
    options.forEach((option, index) => {
      option.key = 'ABCD'[index];
      option.text = '如上图所示';
      option.images = Array.isArray(option.images) ? option.images : [];
      option.content_blocks = [{ type: 'text', text: '如上图所示' }];
    });
    question.options = options.map(option => option.text);
    question.option_images = options.map(option => option.images);
    question.composite_options_in_stem = true;
    updated += 1;
  });
  return updated;
}

function renderV2Review(pkg = state.xingcePackage) {
  const list = $('#v2ReviewList');
  if (!list) return;
  if (!pkg) {
    setText('#v2ReviewCount', '0 项');
    list.innerHTML = '<p class="hint">请先从上方转换结果载入一套试卷。</p>';
    return;
  }
  const issues = [
    ...(pkg.validation_errors || []).map(item => ({ ...item, severity: 'error' })),
    ...(pkg.validation_warnings || []).map(item => ({ ...item, severity: 'warning' })),
  ];
  setText('#v2ReviewCount', `${issues.length} 项`);
  if (!issues.length) {
    list.innerHTML = '<article class="v2-review-item"><div><h4>本套试卷已复核通过</h4><p>没有剩余错误或待复核项，可以继续导入云端。</p></div></article>';
    return;
  }
  const grouped = new Map();
  issues.forEach(issue => {
    const question = findQuestionForIssue(pkg, issue);
    const key = question?._id || `general:${issue.path}`;
    if (!grouped.has(key)) grouped.set(key, { question, issues: [] });
    grouped.get(key).issues.push(issue);
  });
  list.innerHTML = Array.from(grouped.values()).map(group => {
    const question = group.question;
    const isError = group.issues.some(issue => issue.severity === 'error');
    const messages = group.issues.map(issue => issue.message).join('；');
    const options = question?.options_v2 || [];
    const optionStates = question ? 'ABCD'.split('').map((key, index) => {
      const ready = v2OptionReady(options[index]);
      return `<span class="v2-option-state ${ready ? 'ready' : ''}">${key}：${ready ? '已有内容' : '缺失'}</span>`;
    }).join('') : '';
    return `
      <article class="v2-review-item ${isError ? 'error' : ''}">
        <div>
          <h4>${question ? `第 ${question.question_number || question.sequence || '—'} 题 · ${escapeHtml(MODULE_LABELS[question.module_id] || question.module_id)}` : escapeHtml(group.issues[0].path || '试卷问题')}</h4>
          <p><strong>${isError ? '必须修正' : '待复核'}：</strong>${escapeHtml(messages)}</p>
          ${question ? `<p>${escapeHtml(String(question.content || '').slice(0, 180) || '题干文字为空')}</p><div class="v2-review-options">${optionStates}</div>` : ''}
        </div>
        ${question ? `<button class="button ${isError ? '' : 'secondary'} small" data-edit-v2-question="${escapeHtml(question._id)}">编辑修正</button>` : ''}
      </article>
    `;
  }).join('');
}

function validateV2PackageLocally(pkg) {
  const errors = [];
  const groups = Array.isArray(pkg.groups) ? pkg.groups : [];
  const questions = Array.isArray(pkg.questions) ? pkg.questions : [];
  const solutions = Array.isArray(pkg.solutions) ? pkg.solutions : [];
  const groupIds = new Set(groups.map(item => item._id));
  const solutionMap = new Map(solutions.map(item => [item.question_id, item]));
  const mediaIds = new Set((pkg.media || []).map(item => item.asset_id || item._id));
  const hasContentBlock = blocks => (blocks || []).some(block => (
    (block?.type === 'image' && (block.asset_id || block.src))
    || normalizeText(block?.text)
    || (block?.type === 'formula' && normalizeText(block?.latex))
  ));
  const scanMedia = (blocks, path) => (blocks || []).forEach((block, blockIndex) => {
    if (block?.type === 'image' && !mediaIds.has(block.asset_id)) {
      errors.push({ path, message: `图片资源不存在：${block.asset_id || `第${blockIndex + 1}张`}` });
    }
  });
  if (Number(pkg.schema_version) !== 2) errors.push({ path: 'schema_version', message: '仅支持V2试卷包' });
  if (!pkg.paper?._id || !pkg.paper?.title) errors.push({ path: 'paper', message: '试卷ID或标题缺失' });
  if (!questions.length) errors.push({ path: 'questions', message: '试卷没有识别出任何题目' });
  if (questions.length !== solutions.length) errors.push({ path: 'solutions', message: '题目与解析数量不一致' });
  questions.forEach((question, index) => {
    const path = question._id || `questions.${index}`;
    if (!normalizeText(question.content) && !hasContentBlock(question.stem_blocks)) errors.push({ path, message: '题干文字、公式和图片均为空' });
    if (!Array.isArray(question.options_v2) || question.options_v2.length !== 4) errors.push({ path, message: '单选题必须有4个选项' });
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer > 3 || question.answer_verified === false) errors.push({ path, message: '答案缺失或不是A-D' });
    if (question.module_id === 'mod_data' && !groupIds.has(question.group_id)) errors.push({ path, message: '资料分析题未关联有效材料组' });
    const solution = solutionMap.get(question._id);
    if (!solution || (!normalizeText(solution.explanation) && !hasContentBlock(solution.explanation_blocks))) errors.push({ path, message: '解析为空' });
    scanMedia(question.stem_blocks, path);
    (question.options_v2 || []).forEach(option => scanMedia(option.content_blocks, path));
  });
  groups.forEach(group => {
    scanMedia(group.material_blocks, group._id || 'groups');
    if (group.module_id !== 'mod_data') return;
    if ((group.question_ids || []).length !== 5) errors.push({ path: group._id, message: '资料分析题组不是5题' });
    if (!normalizeText(group.material_text) && !hasContentBlock(group.material_blocks)) errors.push({ path: group._id, message: '资料分析材料为空' });
  });
  solutions.forEach(solution => scanMedia(solution.explanation_blocks, solution.question_id || 'solutions'));
  return errors;
}

function buildV2ReviewWarnings(pkg) {
  const warnings = [];
  (pkg.questions || []).forEach(question => {
    if (question.composite_options_in_stem && !question.review_confirmed) {
      warnings.push({
        path: question._id,
        message: '题干图片同时包含 A-D 选项；系统已将四个选项设为“如上图所示”，请人工确认图片完整且顺序正确',
      });
    }
    const options = Array.isArray(question.options_v2) ? question.options_v2 : [];
    const missing = 'ABCD'.split('').filter((key, index) => !v2OptionReady(options[index]));
    if (!missing.length) return;
    if ((question.stem_images || []).length) {
      if (question.review_confirmed) return;
      warnings.push({ path: question._id, message: `选项 ${missing.join(',')} 未单独拆图，当前按题干合成图 + A-D作答，请人工确认顺序` });
    } else {
      warnings.push({ path: question._id, message: `选项 ${missing.join(',')} 文字/图片为空，请补充文字、公式截图或选项图片` });
    }
  });
  return warnings;
}

function revalidateCurrentV2Package() {
  if (!state.xingcePackage) return;
  normalizeCompositeImageOptions(state.xingcePackage);
  state.xingcePackage.validation_errors = validateV2PackageLocally(state.xingcePackage);
  state.xingcePackage.validation_warnings = buildV2ReviewWarnings(state.xingcePackage);
  renderV2Review();
}

let v2ReviewObjectUrls = [];

function clearV2ReviewObjectUrls() {
  v2ReviewObjectUrls.forEach(url => URL.revokeObjectURL(url));
  v2ReviewObjectUrls = [];
}

function reviewImageUrl(src) {
  if (/^(?:cloud:\/\/|https?:\/\/)/i.test(String(src || ''))) return src;
  const filename = String(src || '').split('/').pop();
  const file = state.xingceImageFiles.get(filename);
  if (file) {
    const url = URL.createObjectURL(file);
    v2ReviewObjectUrls.push(url);
    return url;
  }
  const paperId = state.xingcePackage?.paper?._id || '';
  return localApiUrl(`/api/generated-xingce-image?paper_id=${encodeURIComponent(paperId)}&filename=${encodeURIComponent(filename)}`);
}

function renderV2ImagePreview(selector, paths) {
  const node = $(selector);
  if (!node) return;
  node.innerHTML = (paths || []).map(src => `<img src="${escapeHtml(reviewImageUrl(src))}" alt="题目图片" />`).join('');
}

function openV2ReviewEditor(questionId) {
  const pkg = state.xingcePackage;
  const question = pkg?.questions?.find(item => item._id === questionId);
  if (!question) throw new Error('没有找到待修正题目');
  clearV2ReviewObjectUrls();
  const solution = (pkg.solutions || []).find(item => item.question_id === questionId) || {};
  const issues = [...(pkg.validation_errors || []), ...(pkg.validation_warnings || [])]
    .filter(issue => String(issue.path || '').includes(questionId));
  $('#v2EditQuestionId').value = questionId;
  $('#v2ReviewDialogTitle').textContent = `修正第 ${question.question_number || question.sequence} 题`;
  $('#v2ReviewIssueText').textContent = issues.map(item => item.message).join('；');
  $('#v2EditStem').value = question.content || '';
  'ABCD'.split('').forEach((key, index) => {
    $(`#v2EditOption${key}`).value = question.options_v2?.[index]?.text || '';
    $(`#v2EditOptionImage${key}`).value = '';
    renderV2ImagePreview(`#v2OptionPreview${key}`, question.option_images?.[index] || []);
  });
  $('#v2EditAnswer').value = String(Number.isInteger(question.answer) ? question.answer : 0);
  $('#v2EditExplanation').value = solution.explanation || question.explanation || '';
  $('#v2EditCompositeConfirmed').checked = Boolean(question.review_confirmed);
  $('#v2EditStemImage').value = '';
  $('#v2EditExplanationImage').value = '';
  renderV2ImagePreview('#v2CurrentStemImages', question.stem_images || []);
  renderV2ImagePreview('#v2CurrentExplanationImages', solution.explanation_images || question.explanation_images || []);
  $('#v2ReviewDialog').showModal();
}

function textAndExistingImages(blocks, value) {
  const images = (blocks || []).filter(block => block?.type === 'image');
  const text = normalizeText(value);
  return [...(text ? [{ type: 'text', text }] : []), ...images];
}

function extensionForReviewFile(file) {
  const fromName = file.name.match(/\.(png|jpe?g|gif|webp|svg)$/i)?.[0]?.toLowerCase();
  if (fromName) return fromName === '.jpeg' ? '.jpg' : fromName;
  return ({ 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' }[file.type] || '.png');
}

async function registerV2ReviewImage(file) {
  if (!file) return null;
  if (!/^image\//i.test(file.type || '')) throw new Error(`不是有效图片：${file.name}`);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const extension = extensionForReviewFile(file);
  const filename = `${digest.slice(0, 24)}${extension}`;
  const assetId = `asset_${digest.slice(0, 20)}`;
  const paperId = state.xingcePackage.paper._id;
  const path = `/assets/question-images/xingce-v2/${paperId}/${filename}`;
  const storedFile = new File([file], filename, { type: file.type || 'image/png' });
  state.xingceImageFiles.set(filename, storedFile);
  const media = state.xingcePackage.media || (state.xingcePackage.media = []);
  if (!media.some(item => item.asset_id === assetId)) {
    media.push({ asset_id: assetId, path, mime: storedFile.type, extension, bytes: storedFile.size, sha256: digest, source_path: `admin-review:${file.name}` });
  }
  return { type: 'image', asset_id: assetId, src: path };
}

async function saveV2ReviewEditor() {
  const pkg = state.xingcePackage;
  const questionId = $('#v2EditQuestionId').value;
  const question = pkg?.questions?.find(item => item._id === questionId);
  if (!question) throw new Error('没有找到正在编辑的题目');
  const solution = (pkg.solutions || []).find(item => item.question_id === questionId);
  if (!solution) throw new Error('没有找到该题解析记录');

  question.stem_blocks = textAndExistingImages(question.stem_blocks, $('#v2EditStem').value);
  const newStemImage = await registerV2ReviewImage($('#v2EditStemImage').files[0]);
  if (newStemImage) question.stem_blocks.push(newStemImage);
  question.content = normalizeText($('#v2EditStem').value);
  question.stem_images = question.stem_blocks.filter(block => block.type === 'image').map(block => block.src);

  question.options_v2 = Array.from({ length: 4 }, (_, index) => question.options_v2?.[index] || ({ key: 'ABCD'[index], content_blocks: [], text: '', images: [] }));
  for (let index = 0; index < 4; index += 1) {
    const key = 'ABCD'[index];
    const option = question.options_v2[index];
    option.key = key;
    option.content_blocks = textAndExistingImages(option.content_blocks, $(`#v2EditOption${key}`).value);
    const newOptionImage = await registerV2ReviewImage($(`#v2EditOptionImage${key}`).files[0]);
    if (newOptionImage) option.content_blocks.push(newOptionImage);
    option.text = normalizeText($(`#v2EditOption${key}`).value);
    option.images = option.content_blocks.filter(block => block.type === 'image').map(block => block.src);
  }
  question.options = question.options_v2.map(item => item.text || item.key);
  question.option_images = question.options_v2.map(item => item.images);
  question.answer = Number($('#v2EditAnswer').value);
  question.answer_verified = true;
  question.review_confirmed = $('#v2EditCompositeConfirmed').checked;

  solution.answer = question.answer;
  solution.explanation_blocks = textAndExistingImages(solution.explanation_blocks, $('#v2EditExplanation').value);
  const newExplanationImage = await registerV2ReviewImage($('#v2EditExplanationImage').files[0]);
  if (newExplanationImage) solution.explanation_blocks.push(newExplanationImage);
  solution.explanation = normalizeText($('#v2EditExplanation').value);
  solution.explanation_images = solution.explanation_blocks.filter(block => block.type === 'image').map(block => block.src);
  question.explanation = solution.explanation;
  question.explanation_images = solution.explanation_images;

  revalidateCurrentV2Package();
  $('#v2ReviewDialog').close();
  clearV2ReviewObjectUrls();
  const errors = pkg.validation_errors.length;
  const warnings = pkg.validation_warnings.length;
  $('#importStatus').textContent = `修正已保存：剩余 ${errors} 项错误、${warnings} 项待复核`;
  if (ocrState.jobId) updateOcrStep(errors || warnings ? 'review' : 'validate');
  $('#xingceImageStatus').textContent = state.xingceImageFiles.size ? `当前题库包包含 ${state.xingceImageFiles.size} 张待上传图片` : '本套试卷没有本地图片';
  logImport({ status: 'review_saved', question_id: questionId, remaining_errors: errors, remaining_warnings: warnings });
}

async function convertQuestionPackage() {
  const input = $('#packagePathInput');
  const packagePath = input.value.trim();
  if (!packagePath) {
    alert('请填写题库包文件夹或 zip 路径');
    return;
  }
  $('#importStatus').textContent = '正在转换题库包';
  logImport({ status: 'converting_package', path: packagePath });
  const convertUrl = location.protocol === 'file:'
    ? 'http://127.0.0.1:8787/api/convert-package'
    : '/api/convert-package';
  const response = await fetch(convertUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: packagePath }),
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    result = { message: text || err.message };
  }
  if (!response.ok) {
    $('#importStatus').textContent = '题库包转换失败';
    logImport(result);
    throw new Error(result.message || '题库包转换失败');
  }
  if (result.mode !== 'xingce_v2_complete_papers') {
    throw new Error('转换服务未返回新版 V2 整卷包，请重启管理后台后再试。');
  }
  $('#importStatus').textContent = `V2整卷转换完成：${result.valid_papers || 0}/${result.paper_count || 0} 套，${result.questions || 0} 题${result.warning_count ? `，${result.warning_count}项待复核` : ''}`;
  renderGeneratedPackages(result.papers || []);
  logImport(result);
  const invalid = (result.papers || []).filter(item => !item.valid);
  const invalidText = invalid.length
    ? `\n未通过：${invalid.map(item => item.title).join('、')}（请根据日志修正原文件）`
    : '';
  alert(`新版 V2 整卷转换完成。\n通过：${result.valid_papers || 0}/${result.paper_count || 0} 套\n题目：${result.questions || 0} 道\n待人工复核：${result.warning_count || 0} 项\n目录：${result.catalog || ''}${invalidText}\n\n请在转换结果中点击“载入这套试卷”。`);
}

async function refreshData() {
  if (!isOnlineMode()) {
    renderDashboard();
    renderQuestions(state.questions);
    return;
  }

  const dashboard = await callAdmin('dashboard');
  state.dashboard = dashboard;
  renderDashboard(dashboard);

  const questionResult = await callAdmin('list_questions', {
    keyword: $('#keywordInput').value.trim(),
    module_id: $('#moduleFilter').value,
    year: Number($('#yearFilter').value) || 0,
    page: 1,
    page_size: 30,
  });
  state.questions = questionResult.list || [];
  renderQuestions();
}

// ── 智能 OCR 导入（MinerU 优先）──
const ocrState = {
  jobId: null,
  answerJobId: null,
  statusTimer: null,
  currentFile: null,
  answerFile: null,
  detectedType: 'auto',
  markdown: '',
  rawMarkdown: '',
  answerMarkdown: '',
  generatedMarkdown: '',
  generatedAnswerMarkdown: '',
  generatedPackage: null,
};

// 草稿箱状态 (AI 中间层 question_drafts)
const draftState = {
  list: [],
  draftId: null,
  draft: null,
  page: 1,
  detailPage: 1,
  detailPageSize: 10,
  detailFilter: 'all',
  geminiBusy: false,
};

function updateOcrStep(step) {
  $$('.ocr-step').forEach(item => item.classList.toggle('active', item.dataset.step === step));
}

function setOcrStatus(text, type = 'normal') {
  const node = $('#ocrStatus');
  if (node) {
    node.textContent = text;
    node.className = 'status-pill' + (type ? ` ${type}` : '');
  }
}

function autoDetectPaperType(markdown) {
  const text = String(markdown || '').slice(0, 2000);
  const essaySignals = /给定资料|作答要求|阅读给定资料|议论文|策论文|写一篇文章|自拟题目|联系实际|材料\s*\d/;
  const xingceSignals = /A\s*[.．、]|B\s*[.．、]|C\s*[.．、]|D\s*[.．、]|答案\s*[：:]|资料分析|判断推理|言语理解|数量关系|常识判断/;
  if (essaySignals.test(text) && !xingceSignals.test(text)) return 'essay';
  if (xingceSignals.test(text)) return 'xingce';
  return 'essay';
}

function fixCommonOcrMarkdown(markdown) {
  let text = String(markdown || '');
  text = text.replace(/^[#\s]*题组[：:\s]*/gm, '## 题组：');
  text = text.replace(/^[#\s]*(\d+)\s*[.．]\s*/gm, '### $1\n');
  text = text.replace(/^[\s]*([A-D])\s*[.．、)\]]\s*/gm, '$1. ');
  text = text.replace(/^(?:题目|问题|试题)[：:\s]*/gmi, '题干：');
  text = text.replace(/^(?:正确?答案|答案)[：:\s]*/gmi, '答案：');
  text = text.replace(/^(?:解析|分析|解答)[：:\s]*/gmi, '解析：');
  return text;
}

// MinerU is the preferred local engine. The server keeps the same OCR API so
// the preview, V2 conversion, review and cloud import flow stays unchanged.
async function detectOcrEnvironment() {
  const info = $('#ocrDetectInfo');
  if (!info) return;
  try {
    const res = await fetch(localApiUrl('/api/ocr-detect'));
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || '本机未检测到 PDF 识别引擎');
    const engineLabel = data.engine === 'mineru' ? 'MinerU' : '兼容 OCR';
    info.textContent = data.engine === 'mineru'
      ? `✓ ${engineLabel} 已就绪（默认 pipeline，支持 PDF、图片、公式和图片资源导出）`
      : `⚠ 未检测到 MinerU，当前使用兼容 OCR：${data.tool_path || ''}`;
    info.className = data.engine === 'mineru' ? 'ocr-detect-info ok' : 'ocr-detect-info warn';
  } catch (err) {
    info.textContent = `⚠ 本地识别服务不可用：${err.message}`;
    info.className = 'ocr-detect-info warn';
  }
}

async function uploadOcrFile(file) {
  if (!file) throw new Error('请选择需要识别的 PDF 或图片文件');
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(localApiUrl('/api/ocr-upload'), { method: 'POST', body: form });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message || '上传失败');
  return data;
}

async function startOcrRecognition(jobId) {
  const imageMode = $('#ocrImageMode').value || 'base';
  const res = await fetch(localApiUrl('/api/ocr-start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, image_mode: imageMode }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message || '启动失败');
  return data;
}

async function pollOcrStatus(jobId, label = '试卷') {
  return new Promise((resolve, reject) => {
    if (ocrState.statusTimer) clearInterval(ocrState.statusTimer);
    ocrState.statusTimer = setInterval(async () => {
      try {
        const res = await fetch(localApiUrl(`/api/ocr-status?job_id=${encodeURIComponent(jobId)}`));
        const data = await res.json();
        if (data.code !== 0) {
          clearInterval(ocrState.statusTimer);
          reject(new Error(data.message));
          return;
        }
        const rawProgress = Number(data.progress) || 0;
        const progress = data.status === 'completed'
          ? 100
          : Math.min(99, data.engine === 'mineru' ? rawProgress : rawProgress * 10);
        $('#ocrProgressFill').style.width = `${progress}%`;
        $('#ocrProgressText').textContent = data.status === 'queued'
          ? `${label}已进入本机 OCR 队列，前方 ${Math.max(0, Number(data.queue_position || 1) - 1)} 个任务`
          : data.status === 'running'
            ? (data.engine === 'mineru' ? `MinerU 正在识别${label}… ${Math.round(progress)}%` : `正在识别${label}… 已完成 ${rawProgress} 页/张`)
            : '正在处理…';
        $('#ocrProgressLog').textContent = data.log || '';
        if (data.status === 'completed') {
          clearInterval(ocrState.statusTimer);
          resolve(data);
        } else if (data.status === 'failed') {
          clearInterval(ocrState.statusTimer);
          reject(new Error(data.error || 'OCR 识别失败'));
        }
      } catch (err) {
        clearInterval(ocrState.statusTimer);
        reject(err);
      }
    }, 1500);
  });
}

async function loadOcrResult(jobId) {
  const res = await fetch(localApiUrl(`/api/ocr-result?job_id=${encodeURIComponent(jobId)}`));
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message || '读取结果失败');
  return data.markdown;
}

// 拉取智能结构化后的 V2 markdown（可见的「智能化」预览），失败则回退到原始内容。
async function loadOcrStructured(jobId) {
  try {
    const res = await fetch(localApiUrl(`/api/ocr-structure?job_id=${encodeURIComponent(jobId)}`));
    const data = await res.json();
    if (data.code === 0 && data.markdown) return data;
  } catch (err) { /* 忽略，走降级 */ }
  const raw = await loadOcrResult(jobId);
  return { code: 0, raw_markdown: raw, markdown: raw, changed: false, question_count: 0, group_count: 0 };
}

function paperPairSignature(filename) {
  const name = String(filename || '');
  const year = (name.match(/20\d{2}/) || [])[0] || '';
  const level = /行政执法/.test(name) ? 'law'
    : /副省|省级/.test(name) ? 'sub_provincial'
      : /地市|市地/.test(name) ? 'city' : '';
  return { year, level };
}

function validateOcrPair(questionFile, answerFile) {
  if (!answerFile) return true;
  const sameLocalFile = questionFile
    && questionFile.name === answerFile.name
    && questionFile.size === answerFile.size
    && questionFile.lastModified === answerFile.lastModified;
  if (sameLocalFile) {
    alert('题目卷和答案解析卷选择了同一个 PDF。请在右侧重新选择包含“答案/解析”的文件。');
    return false;
  }
  const question = paperPairSignature(questionFile && questionFile.name);
  const answer = paperPairSignature(answerFile.name);
  const mismatches = [];
  if (question.year && answer.year && question.year !== answer.year) mismatches.push(`年份不一致：${question.year} / ${answer.year}`);
  if (question.level && answer.level && question.level !== answer.level) mismatches.push('卷型不一致（副省级、地市级或行政执法）');
  if (!mismatches.length) return true;
  return confirm(`题目卷与答案解析卷可能不是同一套：\n${mismatches.join('\n')}\n\n仍然继续配对识别吗？`);
}

function applyOcrMarkdownToEditor(markdown) {
  if ($('#ocrAutoFixEnabled').checked) {
    markdown = fixCommonOcrMarkdown(markdown);
  }
  ocrState.markdown = markdown;
  ocrState.generatedMarkdown = markdown;
  $('#ocrMarkdownEditor').value = markdown;
  const detected = autoDetectPaperType(markdown);
  ocrState.detectedType = $('#ocrPaperType').value === 'auto' ? detected : $('#ocrPaperType').value;
  updateOcrTypeBadge();
  updateOcrStep('preview');
}

function updateOcrTypeBadge() {
  const type = ocrState.detectedType;
  const map = { xingce: '行测试卷', essay: '申论试卷', auto: '自动检测' };
  $('#ocrPaperTypeBadge').textContent = map[type] || type;
  $('#ocrGenBankBtn').style.display = type === 'xingce' ? '' : 'none';
  $('#ocrGenEssayBtn').style.display = type === 'essay' ? '' : 'none';
}

async function handleOcrStart() {
  try {
    const questionFile = $('#ocrFileInput').files[0];
    const answerFile = $('#ocrAnswerFileInput').files[0];
    if (!questionFile) throw new Error('请先选择题目 PDF');
    if (!validateOcrPair(questionFile, answerFile)) return;
    setOcrStatus('上传题目卷…');
    $('#ocrProgressArea').hidden = false;
    $('#ocrPreviewArea').hidden = true;
    $('#ocrImportResultArea').hidden = true;
    updateOcrStep('recognize');
    const questionUpload = await uploadOcrFile(questionFile);
    ocrState.jobId = questionUpload.job_id;
    ocrState.currentFile = questionFile;
    setOcrStatus('识别题目卷…');
    await startOcrRecognition(ocrState.jobId);
    await pollOcrStatus(ocrState.jobId, '题目卷');
    const structured = await loadOcrStructured(ocrState.jobId);
    ocrState.rawMarkdown = structured.raw_markdown || '';

    ocrState.answerJobId = null;
    ocrState.answerFile = answerFile || null;
    ocrState.answerMarkdown = '';
    ocrState.generatedAnswerMarkdown = '';
    $('#ocrAnswerPreview').hidden = true;
    $('#ocrAnswerMarkdownEditor').value = '';
    if (answerFile) {
      setOcrStatus('上传答案解析卷…');
      $('#ocrProgressFill').style.width = '0%';
      const answerUpload = await uploadOcrFile(answerFile);
      ocrState.answerJobId = answerUpload.job_id;
      setOcrStatus('识别答案解析卷…');
      await startOcrRecognition(ocrState.answerJobId);
      await pollOcrStatus(ocrState.answerJobId, '答案解析卷');
      ocrState.answerMarkdown = await loadOcrResult(ocrState.answerJobId);
      ocrState.generatedAnswerMarkdown = ocrState.answerMarkdown;
      $('#ocrAnswerMarkdownEditor').value = ocrState.answerMarkdown;
      $('#ocrAnswerPreview').hidden = false;
    }

    setOcrStatus(answerFile ? '两份 PDF 识别完成，正在按题号配对' : '题目卷识别完成', 'ok');
    applyOcrMarkdownToEditor(structured.markdown);
    if (structured.changed) {
      const tip = `已智能结构化：识别到 ${structured.group_count} 个模块分组、${structured.question_count} 道题`;
      const badge = $('#ocrStructuredTip');
      if (badge) { badge.textContent = tip; badge.hidden = false; }
    }
    $('#ocrProgressArea').hidden = true;
    $('#ocrPreviewArea').hidden = false;
    // Generate the matching package immediately. The raw Markdown editor
    // remains available for a second conversion after manual corrections.
    if (ocrState.detectedType === 'essay') await handleOcrToEssay();
    else await handleOcrToBank();
  } catch (err) {
    setOcrStatus('识别失败', 'error');
    $('#ocrProgressText').textContent = err.message;
    $('#ocrProgressLog').textContent = err.stack || '';
    alert(err.message);
  }
}

async function handleOcrToBank() {
  try {
    console.log('[OCR] handleOcrToBank start, jobId:', ocrState.jobId);
    setOcrStatus('生成行测试卷…');
    $('#ocrImportResultArea').hidden = true;
    const url = localApiUrl('/api/ocr-to-bank');
    console.log('[OCR] POST', url);
    const questionMarkdown = $('#ocrMarkdownEditor').value;
    const answerMarkdown = $('#ocrAnswerMarkdownEditor').value;
    const questionWasEdited = questionMarkdown !== ocrState.generatedMarkdown;
    const answerWasEdited = answerMarkdown !== ocrState.generatedAnswerMarkdown;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: ocrState.jobId,
        answer_job_id: ocrState.answerJobId,
        // 未经人工修改时，让后端直接处理 MinerU 原始 Markdown + 版面 JSON；
        // 前端的展示型 Markdown 可能因阅读顺序修复不完整而少题。只有管理员
        // 真正编辑过预览内容时才把覆盖文本提交给最终 V2 管线。
        markdown: questionWasEdited ? questionMarkdown : '',
        answer_markdown: answerWasEdited ? answerMarkdown : '',
      }),
    });
    console.log('[OCR] response status:', res.status);
    const data = await res.json();
    console.log('[OCR] response data:', data);
    if (data.code !== 0) throw new Error(data.message || '生成失败');
    ocrState.generatedPackage = data;
    // 显示生成结果摘要，并自动滚动到结果区
    $('#ocrImportResultArea').hidden = false;
    const summary = data.summary || {
      paper_title: data.paper_title,
      paper_id: data.paper_id,
      question_count: data.question_count,
      modules: data.modules,
      low_confidence: data.low_confidence,
    };
    const modulesLine = (data.modules || [])
      .map(m => `${m.module || m.module_name || '?'} ${m.count || 0}题`)
      .join(' / ');
    $('#ocrImportResultLog').textContent =
      `✅ 试卷生成成功：${data.question_count || 0} 道题\n` +
      `paper_id: ${data.paper_id || ''}\n` +
      `paper_title: ${data.paper_title || ''}\n` +
      `模块分布：${modulesLine}\n` +
      (data.paired_import
        ? `题目/解析配对：${data.pair_merge?.matched_count || 0} 题；明确答案 ${data.pair_merge?.answer_count || 0} 题；解析 ${data.pair_merge?.explanation_count || 0} 题；未匹配 ${(data.pair_merge?.missing_question_numbers || []).length} 题\n`
        : '未选择答案解析卷：答案和解析将保持待复核\n') +
      `低置信题号：${(data.low_confidence || []).join(', ') || '无'}\n\n` +
      JSON.stringify(summary, null, 2);
    setOcrStatus(`试卷生成成功：${data.question_count || 0} 道题`, 'ok');
    updateOcrStep('review');
    // 自动滚动到结果区，确保用户看到「存入草稿箱」按钮
    setTimeout(() => {
      const el = $('#ocrImportResultArea');
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  } catch (err) {
    console.error('[OCR] handleOcrToBank error:', err);
    setOcrStatus('生成失败', 'error');
    alert(err.message);
  }
}

async function handleOcrToEssay() {
  try {
    setOcrStatus('生成申论试卷…');
    $('#ocrImportResultArea').hidden = true;
    const res = await fetch(localApiUrl('/api/ocr-to-essay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: ocrState.jobId,
        markdown: $('#ocrMarkdownEditor').value,
      }),
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.message || '生成失败');
    const pkg = window.EssayParser.parseEssayPaperMarkdown(data.markdown, { filename: data.filename });
    state.essayPackage = pkg;
    renderEssayPackage();
    $('#ocrImportResultArea').hidden = false;
    $('#ocrImportResultLog').textContent = JSON.stringify({
      paper: pkg.paper,
      materials: pkg.materials?.length,
      questions: pkg.questions?.length,
      answers: pkg.answers?.length,
      errors: pkg.validation_errors,
    }, null, 2);
    setOcrStatus('申论试卷生成成功', 'ok');
    updateOcrStep('struct');
  } catch (err) {
    setOcrStatus('生成失败', 'error');
    alert(err.message);
  }
}

async function handleOcrCloudImport() {
  if (!isOnlineMode()) {
    alert('请先在连接设置中配置云函数 HTTP 地址和 ADMIN_SECRET。');
    return;
  }
  if (ocrState.detectedType === 'essay') {
    try {
      await handleEssayCloudImport();
      setOcrStatus('导入成功', 'ok');
      updateOcrStep('import');
    } catch (err) {
      setOcrStatus('导入失败', 'error');
      alert(err.message);
    }
    return;
  }
  // 行测 OCR: 不直接入库, 先存入草稿箱 (AI 中间层闸口)
  await saveOcrToDraft();
}

// OCR 行测结果 -> 草稿箱 (question_drafts), 等待人工审核后发布
async function saveOcrToDraft() {
  const pkg = ocrState.generatedPackage;
  if (!pkg || (pkg.question_count || 0) === 0) {
    alert('请先生成行测试卷');
    return;
  }
  if (!state.secret || !state.endpoint) {
    alert('请先前往「连接设置」配置 CloudBase 云函数地址和密钥');
    switchView('settings');
    return;
  }
  try {
    setOcrStatus('存入草稿箱…');
    // 对端点做前端补全：缺少协议自动补 https://，相对路径视为未配置
    let endpoint = String(state.endpoint || '').trim();
    if (endpoint.startsWith('/')) {
      alert('云函数地址不能是相对路径，请填写完整的 HTTPS 地址（如 https://xxx.app.tcloudbase.com/admin）');
      switchView('settings');
      return;
    }
    if (endpoint && !/^https?:\/\//i.test(endpoint)) {
      endpoint = 'https://' + endpoint;
    }
    let endpointUrl;
    try {
      endpointUrl = new URL(endpoint);
    } catch (err) {
      alert('云函数地址格式不正确：' + endpoint);
      switchView('settings');
      return;
    }
    if (!/\.tcloudbase\.com|\.qcloud\.com|localhost|127\.0\.0\.1/i.test(endpointUrl.hostname)) {
      if (!confirm(`云函数地址域名 ${endpointUrl.hostname} 看起来不是腾讯云地址，是否继续？`)) return;
    }
    const res = await fetch(localApiUrl('/api/ocr-save-draft'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: ocrState.jobId,
        drafts_path: pkg.drafts_path,
        admin_secret: state.secret,
        admin_endpoint: endpoint,
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`服务器返回非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (data.code !== 0) throw new Error(data.message || '存入失败');
    setOcrStatus('已存入草稿箱，待审核发布', 'ok');
    updateOcrStep('review');
    $('#ocrImportResultLog').textContent = JSON.stringify({
      draft_id: data.draft_id,
      counts: data.counts,
      batch_count: data.batch_count || 1,
      resumed: data.resumed === true,
      message: '已生成草稿，请到「草稿箱」逐题审核后发布。',
    }, null, 2);
    if (confirm(`已生成草稿 ${data.draft_id}（共 ${data.counts.total} 题，待审核 ${data.counts.pending} 题）。\n是否立即前往「草稿箱」审核？`)) {
      draftState.draftId = data.draft_id;
      await loadDrafts();
      switchView('drafts');
    }
  } catch (err) {
    setOcrStatus('存入失败', 'error');
    alert(err.message);
  }
}

// ───────────────────────────────────────────────────────────
// 草稿箱 (AI 中间层 question_drafts) 前端逻辑
// ───────────────────────────────────────────────────────────

// 从 V2 包题目/解析的 blocks 结构提取纯文本用于展示
function blocksToText(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return '';
  return blocks.map(b => {
    if (!b || typeof b !== 'object') return '';
    if (b.type === 'image') return '[图]';
    if (b.type === 'formula') return b.latex || b.text || '[公式]';
    return b.text || '';
  }).join('');
}
function questionStemText(q) {
  if (typeof q.stem === 'string' && q.stem.trim()) return q.stem;
  return blocksToText(q.stem_blocks);
}
function optionText(opt) {
  if (!opt) return '';
  if (typeof opt === 'string') return opt;
  if (typeof opt.text === 'string') return opt.text;
  if (Array.isArray(opt.content_blocks)) return blocksToText(opt.content_blocks);
  return blocksToText(opt);
}
function answerLetter(q) {
  if (typeof q.answer === 'string' && /^[A-Da-d]$/.test(q.answer)) return q.answer.toUpperCase();
  if (typeof q.answer_index === 'number' && q.answer_index >= 0 && q.answer_index <= 3) return 'ABCD'[q.answer_index];
  return '';
}

function renderGeminiReview(aiReview) {
  if (!aiReview) {
    return '<div class="draft-ai-empty">尚未调用 Gemini 审核。</div>';
  }
  const verdictMeta = {
    pass: ['可通过', 'ok'],
    needs_review: ['需复核', 'warn'],
    incorrect: ['疑似错误', 'danger'],
  };
  const meta = verdictMeta[aiReview.verdict] || verdictMeta.needs_review;
  const risks = Array.isArray(aiReview.risk_points) ? aiReview.risk_points : [];
  const confidence = Math.round((Number(aiReview.confidence) || 0) * 100);
  return `
    <div class="draft-ai-review ${escapeHtml(meta[1])}">
      <div class="draft-ai-review-head">
        <strong>Gemini 审核</strong>
        <span class="status-pill ${escapeHtml(meta[1])}">${escapeHtml(meta[0])}</span>
        <span class="muted">置信度 ${confidence}% · ${escapeHtml(aiReview.model || 'Gemini')}</span>
      </div>
      <div class="draft-ai-summary">${escapeHtml(aiReview.summary || '')}</div>
      ${risks.length ? `<ul>${risks.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
      ${(aiReview.suggested_answer || aiReview.suggested_analysis) ? `
        <div class="draft-ai-suggestion">
          ${aiReview.suggested_answer ? `<span><b>建议答案：</b>${escapeHtml(aiReview.suggested_answer)}</span>` : ''}
          ${aiReview.suggested_analysis ? `<span><b>建议解析：</b>${escapeHtml(aiReview.suggested_analysis)}</span>` : ''}
        </div>` : ''}
      ${aiReview.requires_human_review ? '<div class="draft-ai-human">此题仍需人工复核，Gemini 结果不能直接替代审核。</div>' : ''}
    </div>`;
}

async function loadDrafts(page = 1) {
  if (!isOnlineMode()) { alert('请先在连接设置中配置云函数 HTTP 地址和 ADMIN_SECRET。'); return; }
  draftState.page = page;
  try {
    const [listRes, statsRes] = await Promise.all([
      callAdmin('draft', { draft_action: 'list', page, page_size: 20 }),
      callAdmin('draft', { draft_action: 'stats' }).catch(() => null),
    ]);
    draftState.list = listRes.drafts || [];
    const stats = statsRes || {};
    const statsEl = $('#draftStats');
    if (statsEl) statsEl.textContent = `待审 ${stats.pending || 0} · 已发布 ${stats.published || 0} · 共 ${stats.total || 0}`;
    renderDrafts();
  } catch (err) {
    $('#draftList').innerHTML = `<p class="error">加载失败：${escapeHtml(err.message)}</p>`;
  }
}

function renderDrafts() {
  const el = $('#draftList');
  if (!draftState.list.length) {
    el.innerHTML = '<p class="muted">暂无草稿。用「智能 OCR」识别一套真题后，结果会先进入这里。</p>';
    return;
  }
  const sourceLabel = { ocr: 'OCR', ai: 'AI', manual: '手动' };
  el.innerHTML = draftState.list.map(d => {
    const c = d.counts || {};
    const statusPill = d.status === 'published'
      ? '<span class="status-pill ok">已发布</span>'
      : '<span class="status-pill warn">待审核</span>';
    return `
      <div class="draft-card" data-draft-id="${escapeHtml(d.draft_id)}">
        <div class="draft-card-main">
          <div class="draft-card-title">${escapeHtml(d.paper_name)}</div>
          <div class="draft-card-meta">
            <span class="tag">${sourceLabel[d.source] || d.source}</span>
            ${statusPill}
            <span class="muted">共 ${c.total || 0} 题 · 通过 ${c.approved || 0} · 驳回 ${c.rejected || 0} · 待审 ${c.pending || 0}</span>
          </div>
        </div>
        <div class="draft-card-actions">
          <button class="button small" data-action="open" data-draft-id="${escapeHtml(d.draft_id)}">审核</button>
          <button class="button danger small" data-action="delete" data-draft-id="${escapeHtml(d.draft_id)}">删除</button>
        </div>
      </div>`;
  }).join('');
}

async function openDraft(draftId) {
  try {
    const data = await callAdmin('draft', { draft_action: 'get', draft_id: draftId });
    draftState.draftId = draftId;
    draftState.draft = data;
    draftState.detailPage = 1;
    draftState.detailFilter = 'all';
    renderDraftDetail();
    $('#draftDetailPanel').hidden = false;
    $('#draftDetailPanel').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    alert('打开草稿失败：' + err.message);
  }
}

function renderDraftDetail() {
  const draft = draftState.draft;
  if (!draft) return;
  const c = draft.counts || {};
  $('#draftDetailTitle').textContent = draft.paper_name || draft.draft_id;
  $('#draftDetailMeta').innerHTML =
    `<span class="tag">${escapeHtml(draft.source)}</span> ` +
    `共 ${c.total} 题 · 通过 ${c.approved} · 驳回 ${c.rejected} · 待审 ${c.pending}` +
    (draft.status === 'published' ? ' · <span class="status-pill ok">已发布</span>' : '');

  const questions = (draft.package && draft.package.questions) || [];
  const solutionMap = {};
  ((draft.package && draft.package.solutions) || []).forEach(s => { solutionMap[s.question_id] = s; });
  const groupMap = {};
  ((draft.package && draft.package.groups) || []).forEach(group => { groupMap[group._id] = group; });
  const review = draft.review || {};
  const edits = draft.edits || {};

  if (!questions.length) {
    $('#draftDetailQuestions').innerHTML = '<p class="muted">该草稿没有可审核的题目。</p>';
    $('#draftReviewRange').textContent = '0 题';
    $('#draftReviewPrev').disabled = true;
    $('#draftReviewNext').disabled = true;
    return;
  }

  const matchesFilter = q => {
    const item = review[q._id] || {};
    const status = item.status || 'pending';
    if (draftState.detailFilter === 'all') return true;
    if (draftState.detailFilter === 'ai_risk') {
      return Boolean(item.ai_review) && (
        item.ai_review.verdict !== 'pass' || item.ai_review.requires_human_review === true
      );
    }
    return status === draftState.detailFilter;
  };
  const filteredQuestions = questions.filter(matchesFilter);
  const totalPages = Math.max(1, Math.ceil(filteredQuestions.length / draftState.detailPageSize));
  draftState.detailPage = Math.max(1, Math.min(draftState.detailPage, totalPages));
  const pageStart = (draftState.detailPage - 1) * draftState.detailPageSize;
  const visibleQuestions = filteredQuestions.slice(pageStart, pageStart + draftState.detailPageSize);
  $('#draftReviewFilter').value = draftState.detailFilter;
  $('#draftReviewRange').textContent = filteredQuestions.length
    ? `第 ${pageStart + 1}-${pageStart + visibleQuestions.length} 题 / 共 ${filteredQuestions.length} 题`
    : '当前筛选无题目';
  $('#draftReviewPrev').disabled = draftState.detailPage <= 1;
  $('#draftReviewNext').disabled = draftState.detailPage >= totalPages;

  if (!visibleQuestions.length) {
    $('#draftDetailQuestions').innerHTML = '<p class="muted">当前筛选条件下没有题目。</p>';
    return;
  }

  $('#draftDetailQuestions').innerHTML = visibleQuestions.map((q, idx) => {
    const qid = q._id;
    const st = (review[qid] && review[qid].status) || 'pending';
    const edit = edits[qid] || {};
    const aiReview = review[qid] && review[qid].ai_review;
    const sol = solutionMap[qid];
    const group = groupMap[q.group_id] || {};
    const stem = Object.prototype.hasOwnProperty.call(edit, 'stem') ? edit.stem : questionStemText(q);
    const optionValues = Array.isArray(edit.options) && edit.options.length === 4
      ? edit.options
      : 'ABCD'.split('').map((key, optionIndex) => optionText((q.options_v2 || [])[optionIndex]));
    const originalAnalysis = (sol && (sol.explanation || blocksToText(sol.explanation_blocks))) || '';
    const analysis = Object.prototype.hasOwnProperty.call(edit, 'analysis') ? edit.analysis : originalAnalysis;
    const ans = Object.prototype.hasOwnProperty.call(edit, 'answer') ? edit.answer : answerLetter(q);
    const material = Object.prototype.hasOwnProperty.call(edit, 'material')
      ? edit.material
      : (group.material_text || blocksToText(group.material_blocks));
    const moduleId = edit.module_id || q.module_id || group.module_id || 'mod_language';
    const evidence = q.source_evidence || {};
    const evidenceImages = Array.isArray(evidence.images) ? evidence.images : [];
    const answerEvidenceImages = Array.isArray(evidence.answer_images) ? evidence.answer_images : [];
    const renderEvidenceImages = (items, kind) => items.map(item => {
      const filename = String(item || '').replace(/\\/g, '/').split('/').pop();
      const localUrl = draft.source_task_id && filename
        ? `/api/ocr-evidence-image?job_id=${encodeURIComponent(draft.source_task_id)}&filename=${encodeURIComponent(filename)}`
        : '';
      return `<figure class="draft-evidence-figure">
        ${localUrl ? `<img src="${escapeHtml(localUrl)}" alt="第 ${escapeHtml(String(q.question_number || q.question_no || pageStart + idx + 1))} 题 OCR 原图" loading="lazy" />` : ''}
        <figcaption>${escapeHtml(kind)}：${escapeHtml(String(item))}</figcaption>
      </figure>`;
    }).join('');
    const evidenceImageHtml = renderEvidenceImages(evidenceImages, '题目卷');
    const answerEvidenceImageHtml = renderEvidenceImages(answerEvidenceImages, '解析卷');
    const confidence = Math.round((Number(q.parser_confidence ?? evidence.parser_confidence) || 0) * 100);
    const needsCompositeConfirm = q.composite_options_in_stem === true;
    const reviewConfirmed = Object.prototype.hasOwnProperty.call(edit, 'review_confirmed')
      ? edit.review_confirmed
      : q.review_confirmed === true;
    const statusPill = st === 'approved'
      ? '<span class="status-pill ok">已通过</span>'
      : st === 'rejected' ? '<span class="status-pill danger">已驳回</span>'
        : '<span class="status-pill warn">待审核</span>';
    return `
      <div class="draft-q" data-qid="${escapeHtml(qid)}">
        <div class="draft-q-head">
          <strong>第 ${escapeHtml(String(q.question_number || q.question_no || pageStart + idx + 1))} 题</strong> ${statusPill}
          <span class="muted">${escapeHtml(moduleId)}</span>
          <span class="draft-confidence ${confidence <= 50 ? 'danger' : confidence < 80 ? 'warn' : ''}">OCR ${confidence}%</span>
        </div>
        <div class="draft-review-grid">
          <section class="draft-review-column draft-source-evidence">
            <h4>原始 OCR 证据</h4>
            <div class="draft-evidence-meta">页码：${escapeHtml(String(evidence.page || q.source_page || '未知'))}</div>
            <b>题目卷 OCR</b>
            <pre>${escapeHtml(evidence.raw_text || '未保留原始 OCR 文本')}</pre>
            ${evidenceImages.length ? `<div class="draft-evidence-images">${evidenceImageHtml}</div>` : '<p class="muted">题目卷没有关联图片。</p>'}
            ${evidence.answer_raw_text ? `<b>答案解析卷 OCR</b><pre>${escapeHtml(evidence.answer_raw_text)}</pre>` : '<p class="muted">本题没有匹配到答案解析卷证据。</p>'}
            ${answerEvidenceImages.length ? `<div class="draft-evidence-images">${answerEvidenceImageHtml}</div>` : ''}
          </section>
          <section class="draft-review-column draft-structured-editor">
            <h4>V2 结构化结果</h4>
            <div class="draft-q-edit">
              <label>模块
                <select class="draft-q-module" data-qid="${escapeHtml(qid)}">
                  ${[
                    ['mod_common_sense', '常识判断'], ['mod_language', '言语理解'],
                    ['mod_quantity', '数量关系'], ['mod_logic', '判断推理'], ['mod_data', '资料分析'],
                  ].map(([value, label]) => `<option value="${value}" ${moduleId === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
              </label>
              <label class="draft-q-wide">题干
                <textarea class="draft-q-stem-input" data-qid="${escapeHtml(qid)}" rows="4" placeholder="题干不能为空">${escapeHtml(stem || '')}</textarea>
              </label>
              <div class="draft-option-grid draft-q-wide">
                ${'ABCD'.split('').map((key, optionIndex) => `<label>${key}<input class="draft-q-option" data-qid="${escapeHtml(qid)}" data-option-index="${optionIndex}" value="${escapeHtml(optionValues[optionIndex] || '')}" placeholder="选项 ${key}" /></label>`).join('')}
              </div>
              ${material || moduleId === 'mod_data' ? `<label class="draft-q-wide">共享材料<textarea class="draft-q-material" data-qid="${escapeHtml(qid)}" rows="4" placeholder="资料分析共享材料">${escapeHtml(material || '')}</textarea></label>` : ''}
              <label>答案
                <select class="draft-q-answer" data-qid="${escapeHtml(qid)}">
                  <option value="">未确认</option>
                  ${['A', 'B', 'C', 'D'].map(L => `<option value="${L}" ${ans === L ? 'selected' : ''}>${L}</option>`).join('')}
                </select>
              </label>
              ${needsCompositeConfirm ? `<label class="draft-composite-confirm"><input class="draft-q-review-confirmed" data-qid="${escapeHtml(qid)}" type="checkbox" ${reviewConfirmed ? 'checked' : ''} /> 已查看合成图并确认 A-D 顺序</label>` : ''}
              <label class="draft-q-wide">解析
                <textarea class="draft-q-analysis" data-qid="${escapeHtml(qid)}" rows="4" placeholder="解析不能为空">${escapeHtml(analysis)}</textarea>
              </label>
              <button class="button secondary small draft-q-save" data-qid="${escapeHtml(qid)}">保存修正</button>
            </div>
          </section>
          <section class="draft-review-column draft-ai-column">
            <h4>Gemini 审核建议</h4>
            ${renderGeminiReview(aiReview)}
          </section>
        </div>
        <div class="draft-q-actions">
          <button class="button secondary small draft-q-gemini" data-qid="${escapeHtml(qid)}">Gemini 审核本题</button>
          ${(aiReview && (aiReview.suggested_answer || aiReview.suggested_analysis)) ? `<button class="button secondary small draft-q-apply-ai" data-qid="${escapeHtml(qid)}">填入 Gemini 建议</button>` : ''}
          <button class="button small draft-q-approve ${st === 'approved' ? 'active' : ''}" data-qid="${escapeHtml(qid)}">通过</button>
          <button class="button secondary small draft-q-reject ${st === 'rejected' ? 'active' : ''}" data-qid="${escapeHtml(qid)}">驳回</button>
        </div>
      </div>`;
  }).join('');
}

async function draftSetDecision(qid, status) {
  const draftId = draftState.draftId;
  try {
    const data = await callAdmin('draft', {
      draft_action: status === 'approved' ? 'approve' : 'reject',
      draft_id: draftId,
      question_ids: [qid],
    });
    if (draftState.draft.review[qid]) draftState.draft.review[qid].status = status;
    else draftState.draft.review[qid] = { status, edited: false, comment: '' };
    draftState.draft.counts = data.counts;
    renderDraftDetail();
    refreshDraftStatsPill();
  } catch (err) {
    alert('操作失败：' + err.message);
  }
}

async function draftSaveEdit(qid) {
  const stemArea = document.querySelector(`.draft-q-stem-input[data-qid="${CSS.escape(qid)}"]`);
  const optionInputs = Array.from(document.querySelectorAll(`.draft-q-option[data-qid="${CSS.escape(qid)}"]`))
    .sort((a, b) => Number(a.dataset.optionIndex) - Number(b.dataset.optionIndex));
  const ansSel = document.querySelector(`.draft-q-answer[data-qid="${CSS.escape(qid)}"]`);
  const ansArea = document.querySelector(`.draft-q-analysis[data-qid="${CSS.escape(qid)}"]`);
  const materialArea = document.querySelector(`.draft-q-material[data-qid="${CSS.escape(qid)}"]`);
  const moduleSelect = document.querySelector(`.draft-q-module[data-qid="${CSS.escape(qid)}"]`);
  const compositeConfirm = document.querySelector(`.draft-q-review-confirmed[data-qid="${CSS.escape(qid)}"]`);
  const stem = stemArea ? stemArea.value.trim() : '';
  const options = optionInputs.map(input => input.value.trim());
  const answer = ansSel ? ansSel.value : '';
  const analysis = ansArea ? ansArea.value : '';
  if (!stem) throw new Error('题干不能为空');
  if (options.length !== 4 || options.some(value => !value)) throw new Error('A-D 四个选项都必须填写');
  const patch = {
    stem,
    options,
    answer,
    analysis,
    module_id: moduleSelect ? moduleSelect.value : '',
  };
  if (materialArea) patch.material = materialArea.value.trim();
  if (compositeConfirm) patch.review_confirmed = compositeConfirm.checked;
  try {
    const data = await callAdmin('draft', { draft_action: 'update', draft_id: draftState.draftId, edits: { [qid]: patch } });
    if (!draftState.draft.edits) draftState.draft.edits = {};
    draftState.draft.edits[qid] = patch;
    if (!draftState.draft.review[qid]) draftState.draft.review[qid] = {};
    draftState.draft.review[qid].status = 'pending';
    draftState.draft.review[qid].edited = true;
    draftState.draft.counts = data.counts || draftState.draft.counts;
    renderDraftDetail();
    setDraftGeminiProgress('本题修正已保存，审核状态已重置为“待审核”。', 'ok');
  } catch (err) {
    throw new Error('保存失败：' + err.message);
  }
}

function setDraftGeminiProgress(message, type = 'normal') {
  const node = $('#draftGeminiProgress');
  if (!node) return;
  node.hidden = !message;
  node.className = `draft-gemini-progress ${type}`;
  node.textContent = message || '';
}

async function draftGeminiReviewQuestion(qid, { quiet = false } = {}) {
  if (!draftState.draftId) throw new Error('请先打开一份草稿');
  const result = await callAdmin('draft', {
    draft_action: 'gemini_review',
    draft_id: draftState.draftId,
    question_id: qid,
  }, 85000);
  if (!draftState.draft.review) draftState.draft.review = {};
  draftState.draft.review[qid] = {
    ...(draftState.draft.review[qid] || { status: 'pending', edited: false, comment: '' }),
    ai_review: result.ai_review,
  };
  if (!quiet) {
    renderDraftDetail();
    setDraftGeminiProgress(`本题 Gemini 审核完成：${result.ai_review.summary}`, result.ai_review.verdict === 'incorrect' ? 'danger' : 'ok');
  }
  return result.ai_review;
}

async function draftGeminiReviewAll() {
  if (draftState.geminiBusy) return;
  const questions = (draftState.draft && draftState.draft.package && draftState.draft.package.questions) || [];
  if (!questions.length) { alert('当前草稿没有可审核题目。'); return; }
  if (!confirm(`Gemini 将逐题审核这套草稿，共 ${questions.length} 题。\n审核只给建议，不会自动点“通过”或发布。是否继续？`)) return;

  draftState.geminiBusy = true;
  const button = $('#draftGeminiAllBtn');
  if (button) button.disabled = true;
  let completed = 0;
  const failed = [];
  try {
    for (const question of questions) {
      const qid = question && question._id;
      if (!qid) continue;
      setDraftGeminiProgress(`Gemini 正在审核 ${completed + 1}/${questions.length}：${qid}`);
      try {
        await draftGeminiReviewQuestion(qid, { quiet: true });
        completed += 1;
      } catch (error) {
        failed.push(`${qid}：${error.message}`);
        // 未配置、鉴权失败或模型不可用时继续重试其他题没有意义。
        if (/GEMINI_API_KEY|API key|API_KEY_INVALID|permission|model|模型/i.test(error.message)) break;
      }
      renderDraftDetail();
    }
    renderDraftDetail();
    if (failed.length) {
      setDraftGeminiProgress(`Gemini 审核完成 ${completed} 题，失败 ${failed.length} 题。首个错误：${failed[0]}`, 'danger');
    } else {
      setDraftGeminiProgress(`Gemini 已完成整套 ${completed} 题审核。请按风险提示人工确认后再点“通过”。`, 'ok');
    }
  } finally {
    draftState.geminiBusy = false;
    if (button) button.disabled = false;
  }
}

function draftApplyGeminiSuggestion(qid) {
  const aiReview = draftState.draft && draftState.draft.review &&
    draftState.draft.review[qid] && draftState.draft.review[qid].ai_review;
  if (!aiReview) { alert('本题还没有 Gemini 审核结果。'); return; }
  const ansSel = document.querySelector(`.draft-q-answer[data-qid="${CSS.escape(qid)}"]`);
  const ansArea = document.querySelector(`.draft-q-analysis[data-qid="${CSS.escape(qid)}"]`);
  if (ansSel && aiReview.suggested_answer) ansSel.value = aiReview.suggested_answer;
  if (ansArea && aiReview.suggested_analysis) ansArea.value = aiReview.suggested_analysis;
  setDraftGeminiProgress('Gemini 建议已填入编辑框；请核对后点击“保存修正”。', 'warn');
}

async function draftApproveAll() {
  const draft = draftState.draft;
  const questions = (draft && draft.package && draft.package.questions) || [];
  const candidates = questions.filter(question => {
    const review = draft.review && draft.review[question._id];
    const aiReview = review && review.ai_review;
    const edit = (draft.edits && draft.edits[question._id]) || {};
    const answer = Object.prototype.hasOwnProperty.call(edit, 'answer') ? edit.answer : answerLetter(question);
    const compositeConfirmed = Object.prototype.hasOwnProperty.call(edit, 'review_confirmed')
      ? edit.review_confirmed
      : question.review_confirmed === true;
    return aiReview && aiReview.verdict === 'pass' && !aiReview.requires_human_review && answer && compositeConfirmed;
  }).map(question => question._id);
  if (!candidates.length) {
    alert('没有同时满足“Gemini 可通过、答案已确认、无需额外人工看图”的题目。其他题请逐题确认。');
    return;
  }
  if (!confirm(`仅将 ${candidates.length} 道满足安全条件的题目标记为“通过”，是否继续？`)) return;
  try {
    const data = await callAdmin('draft', { draft_action: 'approve', draft_id: draftState.draftId, question_ids: candidates });
    candidates.forEach(qid => { draftState.draft.review[qid].status = 'approved'; });
    draftState.draft.counts = data.counts;
    renderDraftDetail();
    refreshDraftStatsPill();
  } catch (err) {
    alert('操作失败：' + err.message);
  }
}

async function draftPublish() {
  const c = (draftState.draft && draftState.draft.counts) || {};
  if (!c.total || c.approved !== c.total || c.pending > 0 || c.rejected > 0) {
    alert(`整卷发布前必须全部题目通过。当前：通过 ${c.approved || 0}，待审 ${c.pending || 0}，驳回 ${c.rejected || 0}。`);
    return;
  }
  if (!confirm(`整套 ${c.total} 道题已通过。确认校验并发布到正式题库？`)) return;
  try {
    const data = await callAdmin('draft', { draft_action: 'publish', draft_id: draftState.draftId });
    alert(`发布成功：${JSON.stringify(data.import || {})}`);
    await loadDrafts(draftState.page);
    $('#draftDetailPanel').hidden = true;
  } catch (err) {
    alert('发布失败：' + err.message);
  }
}

async function draftDelete() {
  if (!confirm('确认删除该草稿？（已发布的草稿删除不会影响正式题库）')) return;
  try {
    await callAdmin('draft', { draft_action: 'delete', draft_id: draftState.draftId });
    draftState.draft = null;
    draftState.draftId = null;
    $('#draftDetailPanel').hidden = true;
    await loadDrafts(draftState.page);
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

async function refreshDraftStatsPill() {
  try {
    const stats = await callAdmin('draft', { draft_action: 'stats' });
    const el = $('#draftStats');
    if (el) el.textContent = `待审 ${stats.pending || 0} · 已发布 ${stats.published || 0} · 共 ${stats.total || 0}`;
  } catch (_) { /* noop */ }
}

// 复用的云端导入核心逻辑：将一份 V2 试卷包写入云端题库。
// statusEl 默认更新行测视图的导入状态条，OCR 流程可传入自己的日志元素。
async function importV2PackageToCloud(pkg, statusEl = $('#importStatus')) {
  if (!isOnlineMode()) throw new Error('请先在连接设置中配置云函数地址和 ADMIN_SECRET。');
  if (!pkg) throw new Error('请先载入或生成 V2 试卷。');
  revalidateCurrentV2Package();
  const errors = Array.isArray(pkg.validation_errors) ? pkg.validation_errors : [];
  if (errors.length) {
    statusEl.textContent = `本地校验未通过：还有 ${errors.length} 项必须修正`;
    logImport({ status: 'local_validation_failed', errors, message: '请修正后再导入。' });
    throw new Error(`这套试卷还有 ${errors.length} 项必须修正。`);
  }
  const warnings = Array.isArray(pkg.validation_warnings) ? pkg.validation_warnings : [];
  if (warnings.length) {
    statusEl.textContent = `校验未通过：还有 ${warnings.length} 项待人工复核`;
    logImport({ status: 'review_required', warnings, message: '逐题确认或修正后才能导入云端。' });
    throw new Error(`这套试卷还有 ${warnings.length} 项待复核，请逐题确认后再导入。`);
  }
  const startedAt = performance.now();
  const packageSizeMb = new Blob([JSON.stringify(pkg)]).size / 1024 / 1024;
  let uploadResult = null;
  let result = null;
  const uploadStartedAt = performance.now();
  statusEl.textContent = '本地校验通过，正在准备题库图片';
  uploadResult = await uploadXingceMedia(pkg);
  const uploadMs = Math.round(performance.now() - uploadStartedAt);
  const recordCount = 1
    + (pkg.media || []).length
    + (pkg.groups || []).length
    + (pkg.questions || []).length
    + (pkg.solutions || []).length;
  const importStartedAt = performance.now();
  const updateImportProgress = () => {
    const seconds = Math.max(1, Math.round((performance.now() - importStartedAt) / 1000));
    statusEl.textContent = `正在写入云端题库（约 ${recordCount} 条记录，已用 ${seconds} 秒）`;
  };
  updateImportProgress();
  const progressTimer = setInterval(updateImportProgress, 1000);
  try {
    result = await callAdmin('import_xingce_package', { package: pkg }, 300000);
  } finally {
    clearInterval(progressTimer);
  }
  const importMs = Math.round(performance.now() - importStartedAt);
  const totalMs = Math.round(performance.now() - startedAt);
  statusEl.textContent = `V2行测试卷导入完成（${(totalMs / 1000).toFixed(1)} 秒）`;
  logImport({
    ...result,
    validation: '浏览器本地预检通过，云端导入时最终校验通过',
    uploaded_images: uploadResult?.uploaded || 0,
    package_size_mb: Number(packageSizeMb.toFixed(2)),
    timing: {
      upload_seconds: Number((uploadMs / 1000).toFixed(1)),
      cloud_import_seconds: Number((importMs / 1000).toFixed(1)),
      total_seconds: Number((totalMs / 1000).toFixed(1))
    }
  });
  try {
    await refreshData();
  } catch (err) {
    logImport({ status: 'import_succeeded_refresh_failed', message: err.message, result });
  }
  return result;
}

// 复用的申论云端导入核心逻辑。
async function handleEssayCloudImport() {
  if (!state.essayPackage) throw new Error('请先选择或生成申论真题 Markdown。');
  if (!isOnlineMode()) throw new Error('请先在连接设置中配置云函数地址和 ADMIN_SECRET。');
  const errors = window.EssayParser.validatePackage(state.essayPackage);
  if (errors.length) {
    state.essayPackage.validation_errors = errors;
    renderEssayPackage();
    throw new Error(`试卷包还有 ${errors.length} 项异常，不能导入。`);
  }
  const result = await callAdmin('import_essay_package', { package: state.essayPackage }, 180000);
  logEssay(result);
  await loadEssayPapers();
  return result;
}

function resetOcr() {
  ocrState.jobId = null;
  ocrState.answerJobId = null;
  ocrState.currentFile = null;
  ocrState.answerFile = null;
  ocrState.detectedType = 'auto';
  ocrState.markdown = '';
  ocrState.answerMarkdown = '';
  ocrState.generatedPackage = null;
  if (ocrState.statusTimer) clearInterval(ocrState.statusTimer);
  $('#ocrFileInput').value = '';
  $('#ocrFileName').textContent = '未选择题目卷';
  $('#ocrAnswerFileInput').value = '';
  $('#ocrAnswerFileName').textContent = '未选择答案解析卷';
  $('#ocrMarkdownEditor').value = '';
  $('#ocrAnswerMarkdownEditor').value = '';
  $('#ocrAnswerPreview').hidden = true;
  $('#ocrProgressArea').hidden = true;
  $('#ocrPreviewArea').hidden = true;
  $('#ocrImportResultArea').hidden = true;
  setOcrStatus('等待文件');
  updateOcrStep('upload');
}

function openEditor(question = {}) {
  $('#dialogTitle').textContent = question._id ? '编辑题目' : '新增题目';
  $('#editId').value = question._id || '';
  $('#editModule').value = question.module_id || 'mod_language';
  $('#editYear').value = question.year || new Date().getFullYear();
  $('#editDifficulty').value = question.difficulty || '中等';
  $('#editContent').value = question.content || '';
  $('#editOptions').value = (question.options || []).join('\n');
  $('#editAnswer').value = Array.isArray(question.answer) ? question.answer.join(',') : (question.answer ?? 0);
  $('#editTags').value = (question.tags || []).join(',');
  $('#editExplanation').value = question.explanation || '';
  $('#questionDialog').showModal();
}

function readEditor() {
  return normalizeQuestion({
    _id: $('#editId').value,
    module_id: $('#editModule').value,
    year: $('#editYear').value,
    difficulty: $('#editDifficulty').value,
    content: $('#editContent').value,
    options: $('#editOptions').value.split('\n'),
    answer: $('#editAnswer').value,
    tags: $('#editTags').value,
    explanation: $('#editExplanation').value,
  });
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[char]);
}

function renderBookPacks(list = state.books || []) {
  const tbody = $('#bookTable');
  if (!tbody) return;
  setText('#bookCount', `${list.length} 条`);
  tbody.innerHTML = list.length ? list.map((item, index) => {
    const isWord = item.file_type === 'word';
    const isDisabled = item.status === 'disabled';
    return `
    <tr>
      <td class="row-number">${index + 1}</td>
      <td>
        <div class="file-cell">
          <span class="file-glyph">${isWord ? 'DOC' : 'PDF'}</span>
          <span>
            <strong class="file-title">${escapeHtml(item.title || '未命名资料')}</strong>
            <small class="file-meta">${escapeHtml(item.file_name || '未记录文件名')}</small>
          </span>
        </div>
      </td>
      <td><span class="type-tag ${isWord ? 'word' : ''}">${isWord ? 'WORD' : 'PDF'}</span></td>
      <td>${escapeHtml(item.category || '通用')}</td>
      <td class="numeric">${formatBytes(item.file_size)}</td>
      <td class="center"><span class="live-status ${isDisabled ? 'offline' : ''}">${isDisabled ? '已下线' : '已上架'}</span></td>
      <td class="center">
        <button class="text-button" data-book-delete="${escapeHtml(item._id)}" aria-label="删除 ${escapeHtml(item.title || '资料')}">删除</button>
      </td>
    </tr>
  `;
  }).join('') : '<tr><td class="empty-cell" colspan="7">暂无资料，上传后会显示在这里。</td></tr>';
}

async function loadBookPacks() {
  const tbody = $('#bookTable');
  if (tbody) tbody.innerHTML = '<tr><td class="empty-cell" colspan="7">正在加载资料...</td></tr>';
  if (!isOnlineMode()) { renderBookPacks([]); return; }
  try {
    const res = await callAdmin('list_book_packs', {
      keyword: $('#bookKeywordInput').value.trim(),
      page: 1,
      page_size: 100,
    });
    state.books = res.list || [];
    renderBookPacks();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td class="empty-cell error-cell" colspan="7">加载失败：${escapeHtml(err.message)}</td></tr>`;
  }
}

async function handleBookUpload() {
  const fileInput = $('#bookFile');
  const file = fileInput.files[0];
  const title = $('#bookTitle').value.trim();
  const statusEl = $('#bookUploadStatus');
  const logEl = $('#bookUploadLog');
  if (!title) { alert('请填写资料标题（必填）'); return; }
  if (!file) { alert('请选择要上传的 PDF 或 Word 文件'); return; }
  if (!isOnlineMode()) { alert('请先在连接设置配置云函数地址和密钥'); return; }

  const fileType = /\.(docx?|wps)$/i.test(file.name) ? 'word' : 'pdf';
  const cloudPath = `books/${Date.now()}_${file.name.replace(/[^\\w\\u4e00-\\u9fa5.-]/g, '_')}`;

  const isLocalhost = ['127.0.0.1', 'localhost'].includes(location.hostname) || location.protocol === 'file:';

  statusEl.textContent = '正在连接云存储';
  logEl.textContent = `文件：${file.name}（${formatBytes(file.size)}）\n${isLocalhost ? '通过本地服务上传到 CloudBase Storage...' : '通过网页 SDK 直传到 CloudBase Storage...'}`;

  try {
    let uploadRes;
    if (isLocalhost) {
      statusEl.textContent = '本地服务上传中';
      logEl.textContent += '\n使用本地服务上传，避免浏览器 COS CORS 限制...';
      uploadRes = await uploadBookFileByLocalServer(file, cloudPath);
      logEl.textContent += '\n本地服务上传成功。';
    } else {
      await ensureAnonymousAuth();
      statusEl.textContent = '上传文件中';
      uploadRes = await uploadBookFileToStorage(file, cloudPath);
      logEl.textContent += '\n直传成功。';
    }
    const fileId = uploadRes.fileID || uploadRes.file_id;
    if (!fileId) throw new Error('上传成功但没有返回 fileID');
    logEl.textContent += `\n上传成功，fileID=${fileId}\n正在登记资料...`;

    const upsertRes = await callAdmin('upsert_book_pack', {
      pack: {
        title,
        description: $('#bookDesc').value.trim(),
        category: $('#bookCategory').value,
        sort: Number($('#bookSort').value) || 0,
        file_id: fileId,
        file_name: uploadRes.file_name || file.name,
        file_size: uploadRes.file_size || file.size,
        file_type: uploadRes.file_type || fileType,
        status: 'enabled',
      },
    });
    statusEl.textContent = '发布成功';
    logEl.textContent += `\n发布完成：${upsertRes._id}`;
    fileInput.value = '';
    $('#bookTitle').value = '';
    $('#bookDesc').value = '';
    $('#bookSort').value = '';
    await loadBookPacks();
  } catch (err) {
    statusEl.textContent = '上传失败';
    logEl.textContent += `\n错误：${err.message}`;
    alert(err.message);
  }
}

function bindEvents() {
  $$('.nav-item').forEach(item => item.addEventListener('click', () => {
    switchView(item.dataset.view);
    if (item.dataset.view === 'drafts') loadDrafts(draftState.page);
  }));
  $('#refreshBtn').addEventListener('click', () => refreshData().catch(err => alert(err.message)));
  $('#searchBtn').addEventListener('click', () => refreshData().catch(err => alert(err.message)));
  $('#newQuestionBtn').addEventListener('click', () => openEditor());
  $('#downloadMdTemplateBtn').addEventListener('click', () => {
    downloadText('考公宝行测V2整卷上传模板.md', TEMPLATE_MARKDOWN, 'text/markdown;charset=utf-8');
  });
  $('#downloadJsonTemplateBtn').addEventListener('click', () => {
    downloadJson('考公宝行测V2-bank结构样例.json', TEMPLATE_JSON);
  });
  $('#convertPackageBtn').addEventListener('click', () => {
    convertQuestionPackage().catch(err => alert(err.message));
  });
  $('#generatedPackageList').addEventListener('click', event => {
    const paperId = event.target.dataset.loadGeneratedPaper;
    if (!paperId) return;
    loadGeneratedPackage(paperId).catch(err => {
      $('#importStatus').textContent = '自动载入失败';
      logImport({ error: err.message, paper_id: paperId });
      alert(err.message);
    });
  });
  $('#v2ReviewList').addEventListener('click', event => {
    const questionId = event.target.dataset.editV2Question;
    if (!questionId) return;
    try {
      openV2ReviewEditor(questionId);
    } catch (err) {
      alert(err.message);
    }
  });
  $('#v2SaveReviewBtn').addEventListener('click', event => {
    event.preventDefault();
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '正在保存';
    saveV2ReviewEditor().catch(err => {
      alert(err.message);
      logImport({ error: err.message, action: 'save_v2_review' });
    }).finally(() => {
      button.disabled = false;
      button.textContent = '保存修正并重新校验';
    });
  });
  $('#v2ReviewDialog').addEventListener('close', clearV2ReviewObjectUrls);

  $('#saveSettingsBtn').addEventListener('click', () => {
    let endpoint = $('#endpointInput').value.trim();
    const secret = $('#secretInput').value.trim();
    if (endpoint && !endpoint.startsWith('/')) {
      // 自动补全协议
      if (!/^https?:\/\//i.test(endpoint)) {
        endpoint = 'https://' + endpoint;
      }
      // 基础格式校验
      try {
        new URL(endpoint);
      } catch (err) {
        alert('HTTP 地址格式不正确，请填写完整地址（如 https://xxx.app.tcloudbase.com/admin）');
        return;
      }
    }
    state.endpoint = endpoint;
    state.secret = secret;
    state.envId = $('#envIdInput').value.trim() || 'cloud1-d0gsr2l1ye6344917';
    localStorage.setItem('kg_admin_endpoint', state.endpoint);
    sessionStorage.setItem('kg_admin_secret', state.secret);
    localStorage.removeItem('kg_admin_secret');
    localStorage.setItem('kg_admin_env_id', state.envId);
    cloudbaseApp = null;
    updateConnection();
    alert('连接设置已保存');
  });

  $('#fileInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (Number(parsed?.schema_version) !== 2 || !parsed.paper || !Array.isArray(parsed.groups) || !Array.isArray(parsed.questions) || !Array.isArray(parsed.solutions) || !Array.isArray(parsed.media)) {
        throw new Error('文件不是新版 V2 整卷 bank.json。请先用上方“生成新版 V2 试卷包”转换 Markdown。');
      }
      state.xingcePackage = parsed;
      state.importSource = [];
      state.importClean = [];
      state.xingceImageFiles = new Map();
      $('#xingceImageInput').value = '';
      revalidateCurrentV2Package();
      const total = state.xingcePackage.questions.length;
      $('#importStatus').textContent = `已载入新版 V2 试卷：${total} 题`;
      $('#xingceImageStatus').textContent = state.xingcePackage.media?.length
        ? `本套试卷有 ${state.xingcePackage.media.length} 张图片，请选择同目录 images 文件夹`
        : '本套试卷没有图片，不需要选择 images 文件夹';
      logImport({
        filename: file.name,
        schema_version: 2,
        paper: state.xingcePackage.paper,
        groups: state.xingcePackage.groups.length,
        questions: total,
        solutions: state.xingcePackage.solutions.length,
        media: state.xingcePackage.media.length,
        validation_errors: state.xingcePackage.validation_errors || [],
        validation_warnings: state.xingcePackage.validation_warnings || []
      });
      renderV2Review();
    } catch (err) {
      state.xingcePackage = null;
      $('#importStatus').textContent = '载入失败：不是新版 V2 试卷';
      logImport({ status: 'invalid_v2_file', filename: file.name, message: err.message });
      renderV2Review();
      event.target.value = '';
      alert(err.message);
    }
  });

  $('#xingceImageInput').addEventListener('change', event => {
    state.xingceImageFiles = new Map(Array.from(event.target.files || []).map(file => [file.name, file]));
    $('#xingceImageStatus').textContent = state.xingceImageFiles.size
      ? `已选择 ${state.xingceImageFiles.size} 张图片`
      : '未选择图片目录';
  });

  $('#essayFileInput').addEventListener('change', event => {
    handleEssayFile(event.target.files[0]).catch(err => {
      $('#essayImportStatus').textContent = '解析失败';
      logEssay({ error: err.message });
      alert(err.message);
    });
  });

  $('#essayValidateBtn').addEventListener('click', () => runEssayAction(async () => {
    if (!state.essayPackage) throw new Error('请先选择申论真题 Markdown。');
    if (isOnlineMode()) {
      $('#essayImportStatus').textContent = '正在进行云端校验';
      const result = await callAdmin('preview_essay_package', { package: state.essayPackage });
      state.essayPackage = { ...result.package, validation_errors: result.errors || [] };
    } else {
      state.essayPackage.validation_errors = window.EssayParser.validatePackage(state.essayPackage);
    }
    renderEssayPackage();
  }));

  $('#essayDownloadBtn').addEventListener('click', () => runEssayAction(() => {
    if (!state.essayPackage) throw new Error('请先选择申论真题 Markdown。');
    downloadJson(`${state.essayPackage.paper._id}-package.json`, state.essayPackage);
  }));

  $('#essayCloudImportBtn').addEventListener('click', () => runEssayAction(async () => {
    $('#essayImportStatus').textContent = '正在导入云端';
    await handleEssayCloudImport();
    $('#essayImportStatus').textContent = '云端导入完成';
  }));

  $('#essayRefreshBtn').addEventListener('click', () => loadEssayPapers().catch(err => alert(err.message)));
  $('#essayPaperList').addEventListener('click', event => {
    const paperId = event.target.dataset.essayStatus;
    const targetStatus = event.target.dataset.targetStatus;
    if (!paperId || !targetStatus) return;
    runEssayAction(async () => {
      const verb = targetStatus === 'enabled' ? '发布' : '转为草稿';
      if (!confirm(`确认将申论试卷 ${paperId} ${verb}？`)) return;
      await callAdmin('set_essay_paper_status', { paper_id: paperId, status: targetStatus });
      await loadEssayPapers();
      $('#essayImportStatus').textContent = targetStatus === 'enabled' ? '试卷已发布' : '试卷已转为草稿';
    });
  });

  $('#validateBtn').addEventListener('click', runOfflineClean);
  $('#downloadCleanBtn').addEventListener('click', () => {
    if (!state.xingcePackage) {
      alert('请先载入新版 V2 试卷。');
      return;
    }
    revalidateCurrentV2Package();
    downloadJson(`${state.xingcePackage.paper._id}-bank-v2-修正版.json`, state.xingcePackage);
  });
  $('#cloudImportBtn').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    if (!state.xingcePackage) {
      alert('请先从上方转换结果载入试卷，或选择新版 V2 bank.json。');
      return;
    }
    button.disabled = true;
    try {
      await importV2PackageToCloud(state.xingcePackage);
    } catch (err) {
      $('#importStatus').textContent = `V2试卷导入失败：${err.message}`;
      alert(err.message);
    } finally {
      button.disabled = false;
    }
  });

  $('#repairDataBtn').addEventListener('click', async () => {
    const result = await callAdmin('repair_data_materials', { limit: 1000 });
    logImport(result);
    await refreshData();
  });

  $('#clearQuestionsBtn').addEventListener('click', async () => {
    if (!isOnlineMode()) {
      alert('请先在连接设置中配置云函数 HTTP 地址和 ADMIN_SECRET。');
      return;
    }
    const confirmText = prompt('此操作会永久清空 questions 题库集合，但不会删除用户、答题记录和订单。\n请输入：清空题库');
    if (confirmText !== '清空题库') {
      alert('确认词不匹配，已取消。');
      return;
    }
    const summary = { deleted: 0, remaining: null, rounds: 0 };
    $('#importStatus').textContent = '正在清空题库';
    while (summary.rounds < 1000) {
      const result = await callAdmin('clear_questions', { confirm_text: confirmText, page_size: 20 }, 60000);
      summary.deleted += result.deleted || 0;
      summary.remaining = result.remaining;
      summary.rounds += 1;
      $('#importStatus').textContent = `正在清空：已删 ${summary.deleted} 条，剩余 ${summary.remaining} 条`;
      logImport(summary);
      if (!result.has_more || !result.remaining || result.deleted === 0) break;
    }
    state.questions = [];
    state.importClean = [];
    state.xingcePackage = null;
    state.xingceImageFiles = new Map();
    logImport(summary);
    $('#importStatus').textContent = `已清空 ${summary.deleted} 条题目`;
    await refreshData();
  });

  $('#exportBtn').addEventListener('click', async () => {
    if (isOnlineMode()) {
      const data = await callAdmin('export_questions', { limit: 1000 });
      downloadJson('questions-export.json', data.list);
    } else {
      downloadJson('questions-export.json', state.importClean.length ? state.importClean : state.questions);
    }
  });

  $('#questionTable').addEventListener('click', async event => {
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;
    if (editId) openEditor(state.questions.find(item => item._id === editId));
    if (deleteId && confirm(`确认下线题目 ${deleteId}？`)) {
      if (isOnlineMode()) await callAdmin('delete_question', { question_id: deleteId });
      state.questions = state.questions.filter(item => item._id !== deleteId);
      renderQuestions();
    }
  });

  $('#bookUploadBtn').addEventListener('click', () => handleBookUpload().catch(err => alert(err.message)));
  $('#bookRefreshBtn').addEventListener('click', () => loadBookPacks().catch(err => alert(err.message)));
  $('#bookSearchBtn').addEventListener('click', () => loadBookPacks().catch(err => alert(err.message)));

  // OCR 事件绑定
  $('#ocrFileInput').addEventListener('change', event => {
    const file = event.target.files[0];
    $('#ocrFileName').textContent = file ? file.name : '未选择题目卷';
  });
  $('#ocrAnswerFileInput').addEventListener('change', event => {
    const file = event.target.files[0];
    $('#ocrAnswerFileName').textContent = file ? file.name : '未选择答案解析卷';
  });
  $('#ocrStartBtn').addEventListener('click', () => handleOcrStart().catch(err => alert(err.message)));
  $('#ocrApplyTypeBtn').addEventListener('click', () => {
    const order = { xingce: 'essay', essay: 'xingce' };
    ocrState.detectedType = order[ocrState.detectedType] || 'xingce';
    updateOcrTypeBadge();
  });
  $('#ocrGenBankBtn').addEventListener('click', () => handleOcrToBank().catch(err => alert(err.message)));
  $('#ocrGenEssayBtn').addEventListener('click', () => handleOcrToEssay().catch(err => alert(err.message)));
  $('#ocrCloudImportBtn').addEventListener('click', () => handleOcrCloudImport().catch(err => alert(err.message)));
  $('#ocrResetBtn').addEventListener('click', resetOcr);

  // ── 草稿箱绑定 ──
  $('#draftRefreshBtn').addEventListener('click', () => loadDrafts(draftState.page));
  $('#draftGeminiAllBtn').addEventListener('click', () => draftGeminiReviewAll().catch(err => {
    setDraftGeminiProgress(err.message, 'danger');
    alert(err.message);
  }));
  $('#draftApproveAllBtn').addEventListener('click', () => draftApproveAll().catch(err => alert(err.message)));
  $('#draftPublishBtn').addEventListener('click', () => draftPublish().catch(err => alert(err.message)));
  $('#draftDeleteBtn').addEventListener('click', () => draftDelete().catch(err => alert(err.message)));
  $('#draftBackBtn').addEventListener('click', () => { $('#draftDetailPanel').hidden = true; });
  $('#draftReviewFilter').addEventListener('change', event => {
    draftState.detailFilter = event.target.value;
    draftState.detailPage = 1;
    renderDraftDetail();
  });
  $('#draftReviewPrev').addEventListener('click', () => {
    if (draftState.detailPage <= 1) return;
    draftState.detailPage -= 1;
    renderDraftDetail();
    $('#draftDetailPanel').scrollIntoView({ behavior: 'smooth' });
  });
  $('#draftReviewNext').addEventListener('click', () => {
    draftState.detailPage += 1;
    renderDraftDetail();
    $('#draftDetailPanel').scrollIntoView({ behavior: 'smooth' });
  });

  $('#draftList').addEventListener('click', event => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const draftId = btn.dataset.draftId;
    if (btn.dataset.action === 'open') openDraft(draftId).catch(err => alert(err.message));
    else if (btn.dataset.action === 'delete') {
      if (confirm(`确认删除草稿 ${draftId}？`)) {
        callAdmin('draft', { draft_action: 'delete', draft_id: draftId })
          .then(() => loadDrafts(draftState.page))
          .catch(err => alert(err.message));
      }
    }
  });

  $('#draftDetailQuestions').addEventListener('click', event => {
    const btn = event.target.closest('button');
    if (!btn) return;
    const qid = btn.dataset.qid;
    if (!qid) return;
    if (btn.classList.contains('draft-q-gemini')) {
      btn.disabled = true;
      setDraftGeminiProgress(`Gemini 正在审核 ${qid}…`);
      draftGeminiReviewQuestion(qid)
        .catch(err => {
          setDraftGeminiProgress(err.message, 'danger');
          alert(err.message);
        })
        .finally(() => { btn.disabled = false; });
    }
    else if (btn.classList.contains('draft-q-apply-ai')) draftApplyGeminiSuggestion(qid);
    else if (btn.classList.contains('draft-q-approve')) draftSetDecision(qid, 'approved');
    else if (btn.classList.contains('draft-q-reject')) draftSetDecision(qid, 'rejected');
    else if (btn.classList.contains('draft-q-save')) draftSaveEdit(qid).catch(err => alert(err.message));
  });

  $('#bookTable').addEventListener('click', async event => {
    const deleteId = event.target.dataset.bookDelete;
    if (deleteId && confirm(`确认删除资料 ${deleteId}？该操作会同时删除云存储中的文件。`)) {
      try {
        await callAdmin('delete_book_pack', { pack_id: deleteId });
        state.books = state.books.filter(item => item._id !== deleteId);
        renderBookPacks();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  $('#saveQuestionBtn').addEventListener('click', async event => {
    event.preventDefault();
    const question = readEditor();
    const errors = validateQuestion(question);
    if (errors.length) {
      alert(errors.join('\n'));
      return;
    }
    if (isOnlineMode()) await callAdmin('upsert_question', { question });
    const index = state.questions.findIndex(item => item._id === question._id);
    if (index >= 0) state.questions[index] = question;
    else state.questions.unshift(question);
    $('#questionDialog').close();
    renderQuestions();
    renderDashboard();
  });
}

bindEvents();
updateConnection();
renderDashboard();
renderQuestions();
renderEssayPackage();
renderEssayPapers();
loadGeneratedCatalog().catch(() => {});
