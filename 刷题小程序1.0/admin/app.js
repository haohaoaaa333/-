const MODULE_LABELS = {
  mod_common_sense: '常识判断',
  mod_language: '言语理解',
  mod_quantity: '数量关系',
  mod_logic: '判断推理',
  mod_data: '资料分析',
};

const state = {
  endpoint: localStorage.getItem('kg_admin_endpoint') || '',
  secret: localStorage.getItem('kg_admin_secret') || '',
  envId: localStorage.getItem('kg_admin_env_id') || 'cloud1-d0gsr2l1ye6344917',
  view: 'dashboard',
  dashboard: null,
  questions: [],
  books: [],
  importSource: [],
  importClean: [],
};

const TEMPLATE_MARKDOWN = `# 考公宝题库上传模板

> 推荐用 Markdown 录题。图片不要粘贴到正文里，请先放到项目目录或云存储，然后在模板里写图片路径。
> 图片路径示例：/assets/question-images/md-bank/2022-data-116-120.png

## 题组：2022国考副省级 资料分析 116-120
模块：资料分析
年份：2022
试卷：2022年国家公务员考试行测真题副省级
来源：国考真题
难度：中等

### 材料
这里填写资料分析大段文字材料。

![材料图1](/assets/question-images/md-bank/2022-data-116-120.png)

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

## 题组：2022国考副省级 图形推理 61
模块：判断推理
年份：2022
试卷：2022年国家公务员考试行测真题副省级
来源：国考真题
难度：中等

### 61
题干：请选择最合适的一项。

![题干图](/assets/question-images/md-bank/2022-logic-061-stem.png)

A. ![A](/assets/question-images/md-bank/2022-logic-061-a.png)
B. ![B](/assets/question-images/md-bank/2022-logic-061-b.png)
C. ![C](/assets/question-images/md-bank/2022-logic-061-c.png)
D. ![D](/assets/question-images/md-bank/2022-logic-061-d.png)

答案：C
解析：观察图形规律，选择C。
![解析图](/assets/question-images/md-bank/2022-logic-061-analysis.png)
`;

const TEMPLATE_JSON = [
  {
    _id: 'q_template_data_116',
    module_id: 'mod_data',
    type: 'single',
    difficulty: '中等',
    source: '国考真题',
    year: 2022,
    paper_id: 'gk2022_template',
    paper_name: '2022年国家公务员考试行测真题副省级',
    content: '2019年，中国IC先进封装市场规模约为多少亿元？',
    material: '这里填写同一题组共用的大段材料文字。',
    material_images: ['/assets/question-images/md-bank/2022-data-116-120.png'],
    stem_images: [],
    options: ['296', '279', '252', '235'],
    option_images: [[], [], [], []],
    answer: 3,
    explanation: '这里填写解析。',
    explanation_images: [],
    tags: ['资料分析'],
    status: 'enabled',
  },
  {
    _id: 'q_template_logic_061',
    module_id: 'mod_logic',
    type: 'single',
    difficulty: '中等',
    source: '国考真题',
    year: 2022,
    paper_id: 'gk2022_template',
    paper_name: '2022年国家公务员考试行测真题副省级',
    content: '请选择最合适的一项。',
    material: '',
    material_images: [],
    stem_images: ['/assets/question-images/md-bank/2022-logic-061-stem.png'],
    options: ['A', 'B', 'C', 'D'],
    option_images: [
      ['/assets/question-images/md-bank/2022-logic-061-a.png'],
      ['/assets/question-images/md-bank/2022-logic-061-b.png'],
      ['/assets/question-images/md-bank/2022-logic-061-c.png'],
      ['/assets/question-images/md-bank/2022-logic-061-d.png'],
    ],
    answer: 2,
    explanation: '这里填写解析。',
    explanation_images: ['/assets/question-images/md-bank/2022-logic-061-analysis.png'],
    tags: ['判断推理', '图形推理'],
    status: 'enabled',
  },
];

const TEMPLATE_WORD_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>考公宝题库上传模板</title></head>
<body>
<h1>考公宝题库上传模板</h1>
<p>请按固定标题填写。Word 写完后，建议复制到 Markdown 文件再导入后台。</p>
<h2>题组：2022国考副省级 资料分析 116-120</h2>
<p>模块：资料分析</p>
<p>年份：2022</p>
<p>试卷：2022年国家公务员考试行测真题副省级</p>
<p>来源：国考真题</p>
<p>难度：中等</p>
<h3>材料</h3>
<p>这里填写资料分析大段文字材料。</p>
<p>图片路径：/assets/question-images/md-bank/2022-data-116-120.png</p>
<h3>116</h3>
<p>题干：2019年，中国IC先进封装市场规模约为多少亿元？</p>
<p>A. 296</p><p>B. 279</p><p>C. 252</p><p>D. 235</p>
<p>答案：D</p>
<p>解析：根据材料图表计算，选择D。</p>
<h2>图形推理图片题</h2>
<h3>61</h3>
<p>题干：请选择最合适的一项。</p>
<p>题干图：/assets/question-images/md-bank/2022-logic-061-stem.png</p>
<p>A. /assets/question-images/md-bank/2022-logic-061-a.png</p>
<p>B. /assets/question-images/md-bank/2022-logic-061-b.png</p>
<p>C. /assets/question-images/md-bank/2022-logic-061-c.png</p>
<p>D. /assets/question-images/md-bank/2022-logic-061-d.png</p>
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
    import: ['导入处理', '上传 JSON，清洗校验后分批导入。'],
    settings: ['连接设置', '配置管理云函数 HTTP 地址和密钥。'],
  };
  setText('#viewTitle', copy[view][0]);
  setText('#viewDesc', copy[view][1]);

  if (view === 'bookpacks' && isOnlineMode()) {
    loadBookPacks().catch(err => console.error('加载图书礼包失败', err));
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
  `).join('') : '<tr><td colspan="6">暂无题目。可先在“导入处理”上传 JSON。</td></tr>';
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
      options[idx] = cleanMdValue(value) || optionMatch[1].toUpperCase();
      optionImages[idx].push(...extractImages(value));
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

    if (extractImages(line).length && mode === 'stem') {
      stemImages.push(...extractImages(line));
      return;
    }
    if (extractImages(line).length && mode === 'explanation') {
      explanationImages.push(...extractImages(line));
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
    };

    const beforeFirstQuestion = body.split(/^###\s*\d+/m)[0] || '';
    beforeFirstQuestion.split('\n').forEach(line => {
      const [key, value] = parseMetaValue(line.trim());
      if (key === '模块') group.module_id = moduleIdFromText(value);
      if (key === '年份') group.year = Number(value) || group.year;
      if (key === '试卷') group.paper_name = value;
      if (key === '来源') group.source = value;
      if (key === '难度') group.difficulty = value;
      if (key === '题组ID') group.paper_id = value;
    });

    const materialMatch = body.match(/^###\s*材料\s*\n([\s\S]*?)(?=^###\s*\d+|(?![\s\S]))/m);
    if (materialMatch) {
      group.material = stripImages(materialMatch[1]).split('\n').map(item => item.trim()).filter(Boolean).join('\n');
      group.material_images = extractImages(materialMatch[1]);
    }

    const questionMatches = Array.from(body.matchAll(/^###\s*(\d+)\s*\n([\s\S]*?)(?=^###\s*\d+|(?![\s\S]))/gm));
    questionMatches.forEach((match, index) => {
      questions.push(parseMarkdownQuestion({ number: match[1], body: match[2] }, group, questions.length + index));
    });
  });

  return questions;
}

function runOfflineClean() {
  state.importClean = repairDataMaterials(state.importSource.map(normalizeQuestion));
  const invalid = state.importClean
    .map((question, index) => ({ index, _id: question._id, errors: validateQuestion(question) }))
    .filter(item => item.errors.length > 0);

  $('#importStatus').textContent = invalid.length ? `发现 ${invalid.length} 条异常` : `清洗完成 ${state.importClean.length} 条`;
  state.questions = state.importClean.slice(0, 100);
  renderDashboard();
  renderQuestions();
  logImport({
    total: state.importClean.length,
    valid: state.importClean.length - invalid.length,
    invalid,
    module_counts: countModules(state.importClean),
    preview: state.importClean.slice(0, 3),
  });
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
  $('#importStatus').textContent = `转换完成 ${result.valid || 0}/${result.total || 0} 条`;
  logImport(result);
  alert(`转换完成。\n有效题：${result.valid || 0}/${result.total || 0}\n导入文件：${result.valid_json || result.output_json || ''}`);
}

function makeBatches(list, size = 5) {
  const batches = [];
  for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
  return batches.map((questions, index) => ({
    action: 'batch_import_questions',
    force_update: true,
    batch_no: index + 1,
    questions,
  }));
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
  $$('.nav-item').forEach(item => item.addEventListener('click', () => switchView(item.dataset.view)));
  $('#refreshBtn').addEventListener('click', () => refreshData().catch(err => alert(err.message)));
  $('#searchBtn').addEventListener('click', () => refreshData().catch(err => alert(err.message)));
  $('#newQuestionBtn').addEventListener('click', () => openEditor());
  $('#downloadMdTemplateBtn').addEventListener('click', () => {
    downloadText('考公宝题库上传模板.md', TEMPLATE_MARKDOWN, 'text/markdown;charset=utf-8');
  });
  $('#downloadJsonTemplateBtn').addEventListener('click', () => {
    downloadJson('考公宝题库上传模板.json', TEMPLATE_JSON);
  });
  $('#downloadWordTemplateBtn').addEventListener('click', () => {
    downloadText('考公宝题库上传模板.doc', TEMPLATE_WORD_HTML, 'application/msword;charset=utf-8');
  });
  $('#convertPackageBtn').addEventListener('click', () => {
    convertQuestionPackage().catch(err => alert(err.message));
  });

  $('#saveSettingsBtn').addEventListener('click', () => {
    state.endpoint = $('#endpointInput').value.trim();
    state.secret = $('#secretInput').value.trim();
    state.envId = $('#envIdInput').value.trim() || 'cloud1-d0gsr2l1ye6344917';
    localStorage.setItem('kg_admin_endpoint', state.endpoint);
    localStorage.setItem('kg_admin_secret', state.secret);
    localStorage.setItem('kg_admin_env_id', state.envId);
    cloudbaseApp = null;
    updateConnection();
  });

  $('#fileInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const text = await file.text();
    if (/\.md$|\.txt$/i.test(file.name)) {
      state.importSource = parseMarkdownBank(text);
    } else {
      const parsed = JSON.parse(text);
      state.importSource = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.data || []);
    }
    $('#importStatus').textContent = `已读取 ${state.importSource.length} 条`;
    logImport({ filename: file.name, total: state.importSource.length, preview: state.importSource.slice(0, 2) });
  });

  $('#validateBtn').addEventListener('click', runOfflineClean);
  $('#downloadCleanBtn').addEventListener('click', () => downloadJson('questions-clean.json', state.importClean));
  $('#downloadBatchesBtn').addEventListener('click', () => downloadJson('questions-import-batches.json', makeBatches(state.importClean)));
  $('#cloudImportBtn').addEventListener('click', async () => {
    if (!state.importClean.length) runOfflineClean();
    const invalid = state.importClean
      .map((question, index) => ({ index, _id: question._id, errors: validateQuestion(question) }))
      .filter(item => item.errors.length > 0);
    const validQuestions = state.importClean.filter(question => validateQuestion(question).length === 0);
    const batches = makeBatches(validQuestions);
    const summary = { total: state.importClean.length, valid: validQuestions.length, skipped_invalid: invalid.length, batches: batches.length, created: 0, updated: 0, skipped: 0, errors: [] };

    if (!validQuestions.length) {
      throw new Error('没有可导入的有效题目，请先修复异常数据。');
    }

    for (let index = 0; index < batches.length; index += 1) {
      $('#importStatus').textContent = `正在导入 ${index + 1}/${batches.length}`;
      logImport({ ...summary, current_batch: index + 1 });
      const result = await callAdmin('batch_import_questions', batches[index]);
      summary.created += result.created || 0;
      summary.updated += result.updated || 0;
      summary.skipped += result.skipped || 0;
      if (Array.isArray(result.errors) && result.errors.length) {
        summary.errors.push(...result.errors);
      }
    }

    $('#importStatus').textContent = '云端导入完成';
    logImport(summary);
    await refreshData();
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
