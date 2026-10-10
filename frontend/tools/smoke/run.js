/* 无浏览器的冒烟测试：加载全部脚本、渲染每个视图、执行关键交互，捕获运行时错误。
   自带一个极简 HTML 解析器作为 querySelector 的桩，用来发现「找不到元素」类真实缺陷。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

/* ==========================================================================
   极简 DOM：innerHTML 赋值时会解析出 id / class / tag 索引
   ========================================================================== */
class El {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.id = '';
    this.children = [];
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    };
    this._rawHtml = '';
    this._pieces = [];
    this._text = '';
    this._className = '';
    this.value = '';
    this.files = null;
    this.clientWidth = 1000;
    this.clientHeight = 700;
    this.scrollTop = 0;
    this.scrollHeight = 1400;
    this.parentNode = null;
  }

  get innerHTML() { return this.children.length ? serializeChildren(this) : this._rawHtml; }
  set innerHTML(v) {
    this._rawHtml = String(v == null ? '' : v);
    this.children = [];
    this._pieces = [];
    parseInto(this);
  }

  /** className 支持（很多组件用 el.className = '...' 设样式） */
  get className() { return Array.from(this.classList._s).join(' '); }
  set className(v) {
    this.classList._s = new Set(String(v == null ? '' : v).split(/\s+/).filter(Boolean));
    this._className = String(v == null ? '' : v);
  }

  /** 递归文本内容（把标签去掉，把实体还原），用于断言「页面上能看到这段文字」 */
  get textContent() {
    return (this.children.length ? serializeChildren(this) : this._rawHtml)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  set textContent(v) { this._rawHtml = String(v == null ? '' : v); this.children = []; }

  appendChild(c) { c.parentNode = this; this.children.push(c); parseHtmlInto(this, c._html || ''); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener() {}
  removeEventListener() {}
  closest(sel) { return matchAncestor(this, sel); }
  contains(n) { return n === this || this.children.indexOf(n) !== -1; }
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 0, right: 0 }; }
  scrollIntoView() {}
  focus() {}
  setAttribute(k, v) { if (k === 'id') this.id = v; }
  getAttribute() { return null; }

  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
}

/* ---------- 选择器支持：#id  .class  tag  [attr]  tag[attr] ---------- */
function parseSelector(sel) {
  sel = sel.trim();
  const parts = { tag: null, id: null, classes: [], attr: null, attrVal: null };
  const m = sel.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
  if (!m) return parts;
  if (m[1]) parts.tag = m[1].toUpperCase();
  (m[2] || '').split('.').filter(Boolean).forEach((t) => {
    if (t[0] === '#') parts.id = t.slice(1);
    else if (t[0] === '.') parts.classes.push(t.slice(1));
    else parts.classes.push(t);
  });
  if (m[3]) parts.attr = m[3];
  if (m[4] !== undefined) parts.attrVal = m[4];
  return parts;
}

function matches(el, p) {
  if (p.tag && el.tagName !== p.tag) return false;
  if (p.id && el.id !== p.id) return false;
  for (const c of p.classes) if (!el.classList.contains(c)) return false;
  if (p.attr) {
    const k = p.attr.replace(/^data-/, '');
    const has = el.dataset[k] !== undefined || el.dataset[p.attr] !== undefined;
    if (!has) return false;
    if (p.attrVal !== null) {
      const v = el.dataset[k] !== undefined ? el.dataset[k] : el.dataset[p.attr];
      if (String(v) !== p.attrVal) return false;
    }
  }
  return true;
}

function walk(el, fn) {
  el.children.forEach((c) => { fn(c); walk(c, fn); });
}

function queryAll(root, sel) {
  const out = [];
  const p = parseSelector(sel.split(',')[0]);
  // 注意：root 自身也要参与匹配（否则 container.querySelector('#x') 找不到直接子元素）
  if (matches(root, p)) out.push(root);
  walk(root, (el) => { if (matches(el, p)) out.push(el); });
  return out;
}
function matchAncestor(el, sel) {
  const p = parseSelector(sel);
  let cur = el;
  while (cur) { if (matches(cur, p)) return cur; cur = cur.parentNode; }
  return null;
}

/* ---------- 超轻量 HTML 解析 ---------- */
const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
const VOID = new Set(['INPUT', 'BR', 'IMG', 'HR', 'META', 'LINK']);

function applyAttrs(el, attrStr) {
  const re = /([\w-]+)(?:="([^"]*)")?/g;
  let m;
  while ((m = re.exec(attrStr))) {
    const k = m[1], v = m[2] === undefined ? '' : m[2];
    if (k === 'class') v.split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === 'id') el.id = v;
    else if (k.indexOf('data-') === 0) el.dataset[k.slice(5)] = v;
  }
}
function parseHtmlInto(parent, html) {
  if (!html) return;
  const stack = [parent];
  TAG_RE.lastIndex = 0;
  let m, last = 0;
  while ((m = TAG_RE.exec(html))) {
    // 记录标签之间的文本（用于 textContent 断言）
    const text = html.slice(last, m.index);
    if (text.trim()) stack[stack.length - 1]._pieces.push(text);
    last = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toUpperCase();
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag) { stack.length = i; break; }
      }
      continue;
    }
    const el = new El(tag);
    el._attrs = (m[3] || '').trim();
    applyAttrs(el, m[3] || '');
    const top = stack[stack.length - 1];
    el.parentNode = top;
    top.children.push(el);
    if (!m[4] && !VOID.has(tag)) stack.push(el);
  }
  const tail = html.slice(last);
  if (tail.trim()) stack[stack.length - 1]._pieces.push(tail);
}

function parseInto(el) { parseHtmlInto(el, el._rawHtml); }

/** 把解析出来的 DOM 树重新序列化成 HTML 字符串（innerHTML 的 getter 用它）。
    属性原样保留（像浏览器那样），文字部分做实体转义。 */
const VOID_SERIALIZE = new Set(['INPUT', 'BR', 'IMG', 'HR', 'META', 'LINK']);
function serializeChildren(node) {
  const tag = node.tagName.toLowerCase();
  const open = '<' + tag + (node._attrs ? ' ' + node._attrs : '') + '>';
  if (VOID_SERIALIZE.has(node.tagName)) return open;
  let inner;
  if (node.children.length) inner = node.children.map(serializeChildren).join('');
  else if (node._pieces.length) inner = node._pieces.map(escapeText).join('');
  else inner = node._rawHtml;
  return open + inner + '</' + tag + '>';
}

/** 文本节点转义（与浏览器 innerHTML 的行为一致） */
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ==========================================================================
   全局桩
   ========================================================================== */
const appRoot = new El('div'); appRoot.id = 'app';
const body = new El('body');
// 测试容器（在文件后面创建，这里先声明，供上面的查询函数引用）
let testContainer = null;

const documentStub = {
  readyState: 'complete',
  body,
  documentElement: new El('html'),
  createElement: (t) => new El(t),
  querySelector(sel) {
    // 优先在测试容器内查找。容器是挂在 body 下的，如果直接在 body 上做全局查找，
    // 会命中 App.boot() 建立的「应用外壳」里的同名旧元素（浏览器里同一时刻只应有一份）。
    const inContainer = testContainer.querySelector(sel);
    if (inContainer) return inContainer;
    const r = appRoot.querySelector(sel);
    if (r) return r;
    return body.querySelector(sel);
  },
  querySelectorAll(sel) {
    const c = queryAll(testContainer, sel);
    const a = queryAll(appRoot, sel);
    const b = queryAll(body, sel);
    return c.concat(a.filter((x) => c.indexOf(x) === -1))
      .concat(b.filter((x) => c.indexOf(x) === -1 && a.indexOf(x) === -1));
  },
  getElementById(id) { return this.querySelector('#' + id); },
  addEventListener() {},
  removeEventListener() {},
};
documentStub.body = body;
body.parentNode = null;

const windowStub = {
  document: documentStub,
  navigator: { clipboard: { writeText() {} } },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  getSelection: () => ({ toString: () => '', getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 0, bottom: 0 }) }) }),
  innerWidth: 1600,
  addEventListener: () => {},
  console,
};
windowStub.window = windowStub;

const ctx = vm.createContext(windowStub);
Object.assign(ctx, {
  globalThis: windowStub, console, setTimeout, clearTimeout, setInterval, clearInterval,
  document: documentStub, navigator: windowStub.navigator,
  FileReader: class { readAsText() {} },
});
ctx.window = windowStub;

/* ==========================================================================
   加载脚本
   ========================================================================== */
const ORDER = [
  'scripts/core/util.js',
  'scripts/data/mock-data.js',
  'scripts/core/rag.js',
  'scripts/core/dedupe.js',
  'scripts/core/writer.js',
  'scripts/core/components.js',
  'scripts/core/store.js',
  'scripts/views/dashboard.js',
  'scripts/views/library.js',
  'scripts/views/reader.js',
  'scripts/views/qa.js',
  'scripts/views/graph.js',
  'scripts/views/discover.js',
  'scripts/views/writing.js',
  'scripts/views/guide.js',
  'scripts/core/app.js',
];

const loadErrors = [];
ORDER.forEach((rel) => {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel }); }
  catch (e) { loadErrors.push('LOAD ' + rel + ' → ' + e.message); }
});

const App = windowStub.App;

/* ==========================================================================
   测试容器
   注意：必须在 App.boot() 之前挂进 body —— 各视图内部会用 App.util.$('#xxx')
   做「全局查询」回退（例如 library 渲染列表、graph 画 SVG），
   只有挂在 body 下的元素才能被找到，这与浏览器里的真实行为一致。
   ========================================================================== */
const el = new El('main');
el.id = 'testview';
testContainer = el;
documentStub.body.appendChild(el);

/* 启动应用（构建外壳、载入演示数据、首次渲染）—— 与浏览器里的行为保持一致 */
try {
  App.boot();
} catch (e) {
  loadErrors.push('BOOT → ' + e.message + '\n        ' + String(e.stack || '').split('\n')[1]);
}

/* ==========================================================================
   测试执行
   ========================================================================== */
const RESULTS = [];
function t(label, fn) {
  try { fn(); RESULTS.push(['OK  ', label]); }
  catch (e) {
    RESULTS.push(['FAIL', label + '\n        → ' + e.message +
      '\n        ' + String(e.stack || '').split('\n')[1]]);
  }
}
/* 异步测试 */
const pending = [];
function ta(label, fn) { pending.push([label, fn]); }

function renderView(id) {
  App.store.state.route = id;
  App.store.state.__keepScroll = false;
  el.innerHTML = '';
  App.VIEWS.find((v) => v.id === id).view().render(el);
  if (!el.innerHTML.length) throw new Error('渲染结果为空');
  return el.innerHTML;
}

/** 断言：渲染结果里必须真的存在这个选择器（captures「代码写了但元素没出来」的缺陷） */
function mustFind(sel, hint) {
  const found = el.querySelector(sel);
  if (!found) throw new Error('找不到元素 ' + sel + (hint ? '（' + hint + '）' : ''));
  return found;
}
function mustFindAll(sel, min, hint) {
  const found = el.querySelectorAll(sel);
  if (found.length < min) throw new Error(sel + ' 只找到 ' + found.length + ' 个，期望至少 ' + min + (hint ? '（' + hint + '）' : ''));
  return found;
}
function mustText(sub, where) {
  const hay = el.innerHTML + ' ' + el.textContent;
  if (hay.indexOf(sub) === -1) throw new Error((where || '渲染结果') + ' 中缺少文本「' + sub + '」');
}
/** 精确计数（避免受其它测试残留元素干扰） */
function countExact(sel) { return el.querySelectorAll(sel).length; }

/* ==========================================================================
   快照：每个测试前恢复论文库 / 阅读目标 / 路由，避免测试互相污染
   ========================================================================== */
const SNAPSHOT = JSON.stringify(App.data.papers);
function restore() {
  App.store.state.papers = JSON.parse(SNAPSHOT);
  App.store.state.uploads = [];
  App.store.state.currentPaperId = null;
  App.store.state.route = 'dashboard';
  App.store.state.qa.paperIds = ['p-attention-v7'];
  App.store.state.qa.scope = 'single';
  App.store.state.discover.feedback = {};
  App.store.state.writing.tab = 'outline';
  // 阅读器 / 图谱状态也要复位，否则上一个用例会污染下一个用例
  App.store.state.reader.mode = 'original';
  App.store.state.reader.scale = 1;
  App.store.state.reader.syncScroll = true;
  App.store.state.reader.selection = null;
  App.store.state.graph.selectedId = null;
  App.store.state.graph.layout = 'force';
  App.store.state.graph.highlightCore = true;
}

/* --- 1. 八个视图都能渲染（每个测试前后都恢复状态，避免互相污染） --- */
App.VIEWS.forEach((v) => t('渲染视图 ' + v.id + '（' + v.title + '）', () => {
  restore();
  renderView(v.id);
  restore();
}));

/* --- 2. 各视图的关键元素必须真的存在 --- */
t('工作台：三个核心区块 + 解析质量表 + 统计数字', () => {
  restore();
  renderView('dashboard');
  ['文库概况', '解析质量一览', '能力地图'].forEach(mustText);
  mustFindAll('tr[data-action="parse-detail"]', 30, '解析质量表行');
  mustFindAll('.quick-card', 6, '快捷入口卡片');
  mustFindAll('.cap-card', 6, '能力地图卡片');
  const total = App.store.state.papers.reduce((a, p) => a + p.pages, 0);
  if (total < 500) throw new Error('累计页数异常：' + total);
  mustText('541', '最长书籍页数');
});

t('文库：拖拽区 / 文件输入 / 列表容器 / 筛选框都在', () => {
  restore();
  renderView('library');
  mustFind('#drop');
  mustFind('#fileinput');
  mustFind('#plist');
  mustFind('#filter');
  mustFindAll('#plist tr', 30, '论文列表行');
  mustText('拖拽 PDF 到这里');
  mustText('MinHash');
});

t('文库：每行都有阅读 / 元数据 / 重新解析 / 删除四个操作', () => {
  restore();
  renderView('library');
  mustFindAll('[data-action="open-paper"]', 30, '阅读按钮');
  mustFindAll('[data-action="meta"]', 30, '元数据按钮');
  mustFindAll('[data-action="reparse"]', 30, '重新解析按钮');
  mustFindAll('[data-action="delete-paper"]', 30, '删除按钮');
});

t('文库：扫描件与超长书籍都被正确标注', () => {
  restore();
  renderView('library');
  mustText('扫描件', '扫描件徽章');
  mustText('Understanding Deep Learning', '541 页书籍');
});

t('图谱：SVG、节点、引用箭头都画出来了', () => {
  restore();
  renderView('graph');
  mustFind('#gcanvas');
  mustFind('#gcanvas svg');
  if (countExact('.gnode') < 10) throw new Error('图谱节点过少：' + countExact('.gnode'));
  if (countExact('#gcanvas path') < 5) throw new Error('引用边过少：' + countExact('#gcanvas path'));
  mustFind('#arrow');
  mustFind('#insights');
  mustFind('#summary-box');
  mustFind('#future');
  mustFind('#gside');
});

t('问答：欢迎页含需求文档里的 5 道例题', () => {
  restore();
  App.store.actions.setQaScope('single');
  renderView('qa');
  mustFindAll('.qa-example', 5, '示例问题');
  mustText('第 6 作者');
  mustFind('#qinput');
  mustFindAll('.qa-paper', 10, '论文勾选项');
});

t('问答：多篇模式换成 3 道对比例题', () => {
  restore();
  App.store.actions.setQaScope('multi');
  renderView('qa');
  const rows = el.querySelectorAll('.qa-example');
  if (rows.length !== 3) throw new Error('多篇示例应为 3 条，实际 ' + rows.length);
  mustText('承袭关系');
});

t('写作：四个标签页都能渲染且各有核心元素', () => {
  const expects = { outline: '#idea', diagram: '#diagram-code', viz: '#pick-csv', translate: '#zh-src' };
  Object.keys(expects).forEach((tab) => {
    restore();
    App.store.actions.setWritingTab(tab);
    renderView('writing');
    mustFind(expects[tab]);
  });
});

t('写作：数据可视化页有表格、图表与自动图注', () => {
  restore();
  App.store.actions.setWritingTab('viz');
  renderView('writing');
  mustFindAll('table', 1, '表格');
  mustFindAll('svg', 2, '图表 SVG');
  mustText('Figure Caption');
  mustText('BLEU');
});

t('说明页：需求对照表覆盖 1.1–1.6 与评分标准', () => {
  restore();
  renderView('guide');
  ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '评分标准'].forEach(mustText);
  mustFindAll('tr', 40, '对照表行');
  mustText('scripts/views/library.js');
  mustText('research-assistant/');
});

/* --- 3. 阅读器 --- */
t('阅读器：打开 Attention 并渲染正文 / 目录 / 引文', () => {
  restore();
  App.store.actions.openPaper('p-attention-v7');
  renderView('reader');
  mustText('Multi-Head Attention');
  mustFindAll('.toc-item', 15, '目录项');
  mustFindAll('[data-action="jump-cite"]', 3, '引文角标');
  mustFind('#outline');
  mustFind('#body-en');
});
t('阅读器：中英对照模式出现两个正文面板', () => {
  restore();
  App.store.actions.openPaper('p-attention-v7');
  App.store.actions.setReaderMode('bilingual');
  renderView('reader');
  mustFind('#body-en');
  mustFind('#body-zh');
  mustText('中英对照模式');
});
t('阅读器：整篇译文模式只保留译文面板', () => {
  restore();
  App.store.actions.openPaper('p-attention-v7');
  App.store.actions.setReaderMode('translation');
  renderView('reader');
  mustFind('#body-zh');
  // 只检查本次渲染的容器，避免命中外壳里的旧节点
  if (el.querySelector('#body-en')) throw new Error('译文模式不应出现原文面板');
});
t('阅读器：三种模式切换都不报错', () => {
  restore();
  App.store.actions.openPaper('p-attention-v7');
  ['original', 'bilingual', 'translation'].forEach((m) => {
    App.store.actions.setReaderMode(m);
    renderView('reader');
  });
});
t('阅读器：公式块保留 LaTeX 原文（对应需求「公式不翻译」）', () => {
  restore();
  App.store.actions.openPaper('p-attention-v7');
  App.store.actions.setReaderMode('original');
  renderView('reader');
  mustText('LayerNorm');
  mustText('公式保留原始 LaTeX');
  mustFind('.doc-formula .latex');
});
t('阅读器：表格块渲染出表头与高亮行', () => {
  restore();
  App.store.actions.openPaper('p-attention-v7');
  renderView('reader');
  mustText('Transformer (big)');
  mustFindAll('tr.hl', 1, '高亮行');
});
t('阅读器：参考文献条目标注「库中已有原文」并可跳转', () => {
  restore();
  App.store.actions.openPaper('p-attention-v7');
  renderView('reader');
  mustText('库中已有原文');
  mustFindAll('[data-action="open-ref-paper"]', 1, '参考文献跳转按钮');
});
t('阅读器：划词翻译能从选中文本生成译文弹窗', () => {
  restore();
  App.store.actions.openPaper('p-attention-v7');
  App.store.set({ reader: Object.assign({}, App.store.state.reader, { selection: { text: 'residual connection and layer normalization' } }) }, 'reader');
  App.views.reader.translateSelection();
  // 弹窗挂在 document.body 上
  const modal = documentStub.body.querySelector('.modal');
  if (!modal) throw new Error('未生成翻译弹窗');
  const txt = modal.innerHTML || '';
  if (txt.indexOf('残差连接') === -1 || txt.indexOf('层归一化') === -1) throw new Error('术语未翻译：' + txt.slice(0, 120));
});
t('阅读器：未选择论文时给出选择列表', () => {
  restore();
  App.store.state.currentPaperId = null;
  App.store.state.routeParams = {};
  renderView('reader');
  mustText('选择要阅读的论文');
});

/* --- 4. 去重（需求 1.1.1 / 第 2 节第 1 条） --- */
t('去重：把 v1 上传到「只有 v7」的文库，会识别为同论文不同版本', () => {
  restore();
  // 真实场景（需求第 2 节第 1 条）：先有 v7，再上传 v1
  App.store.state.papers = App.data.papers.filter((p) => p.id !== 'p-attention-v1');
  const dup = App.dedupe.findDuplicate('1706.03762v1.pdf', App.store.state.papers);
  if (!dup) throw new Error('未识别出重复论文');
  if (dup.kind !== 'version') throw new Error('未判定为同论文不同版本，实际：' + dup.kind);
  if (dup.paper.id !== 'p-attention-v7') throw new Error('应命中文库中的 v7，实际命中 ' + dup.paper.id);
  const diff = App.dedupe.diffVersions(dup.paper, '1706.03762v1.pdf');
  if (!diff.length) throw new Error('未生成差异条目');
  if (diff[0].type !== 'warn') throw new Error('首条差异不是「提醒」，而是 ' + diff[0].type);
  if (diff[0].text.indexOf('保留文库版本') === -1) throw new Error('未给出保留建议');
});
t('去重：上传与文库完全相同的文件，识别为 identical', () => {
  restore();
  const d = App.dedupe.findDuplicate('1706.03762v1.pdf', App.data.papers);
  if (!d || d.kind !== 'identical') throw new Error('同名文件未判为 identical');
  if (d.paper.id !== 'p-attention-v1') throw new Error('命中了错误的条目：' + d.paper.id);
  if (d.similarity < 0.99) throw new Error('相似度异常：' + d.similarity);
});
t('去重：上传 v7 会命中同名文件（identical）', () => {
  restore();
  const d = App.dedupe.findDuplicate('1706.03762v7.pdf', App.data.papers);
  if (!d || d.kind !== 'identical') throw new Error('同名文件未判为 identical');
  if (d.similarity < 0.99) throw new Error('相似度异常：' + d.similarity);
});
t('去重：不同论文不会被误判（含 arXiv 号近似的情况）', () => {
  restore();
  // 库中已有 2005.11401v4.pdf（RAG），上传同名文件属于「重复上传」而非「误判」，
  // 这里检查的是「不相关的文件不会被判为重复」。
  ['2502.11089v1.pdf', '9999.00000v1.pdf', '1709.99999v1.pdf', '1503.00001v2.pdf'].forEach((f) => {
    const d = App.dedupe.findDuplicate(f, App.data.papers);
    if (d) throw new Error(f + ' 被误判为与 ' + d.paper.file + ' 重复');
  });
  // 同一论文的新版本允许被识别
  const v9 = App.dedupe.findDuplicate('1706.03762v9.pdf', App.data.papers);
  if (!v9 || v9.kind !== 'version') throw new Error('同论文新版本未被识别为 version');
});
t('去重：同一论文的扫描件与文本版都会被识别为重复（kind 允许 identical/version）', () => {
  restore();
  const d = App.dedupe.findDuplicate('1706.03762v1_img.pdf', App.data.papers);
  if (!d) throw new Error('扫描件未被识别为重复');
  if (['identical', 'version'].indexOf(d.kind) === -1) throw new Error('kind 异常：' + d.kind);
  if (['p-attention-v1', 'p-attention-v7', 'p-attention-img'].indexOf(d.paper.id) === -1) {
    throw new Error('命中了无关的论文：' + d.paper.id);
  }
});
t('去重：相似度算法对近似文本给高分、对无关文本给低分', () => {
  const a = 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.';
  const b = 'We propose a new simple network architecture the Transformer based solely on attention mechanisms';
  const s = App.dedupe.similarity(a, b);
  if (s < 0.7) throw new Error('相似度偏低：' + s.toFixed(3));
  const s2 = App.dedupe.similarity(a, '完全不同的另一段中文内容，讲的是完全无关的主题与结论。');
  if (s2 > 0.3) throw new Error('不相似文本得分过高：' + s2.toFixed(3));
});
t('去重：三种处理方式都能生效（覆盖 / 保留 / 两份都留）', () => {
  restore();
  const before = App.store.state.papers.length;
  // 覆盖
  App.store.state.uploads = [{ id: 'u1', name: '1706.03762v1.pdf', status: 'duplicate', dupOf: 'p-attention-v7', progress: 100, size: 100 }];
  App.store.actions.resolveOverwrite('u1');
  if (App.store.state.uploads[0].status !== 'done') throw new Error('覆盖流程未完成');
  // 保留
  App.store.state.uploads = [{ id: 'u2', name: '1706.03762v1.pdf', status: 'duplicate', dupOf: 'p-attention-v7', progress: 100, size: 100 }];
  App.store.actions.resolveKeep('u2');
  if (App.store.state.uploads[0].status !== 'skipped') throw new Error('保留流程未完成');
  // 两份都留
  App.store.state.uploads = [{ id: 'u3', name: '1706.03762v1.pdf', status: 'duplicate', dupOf: 'p-attention-v7', progress: 100, size: 100, pages: 11 }];
  App.store.actions.resolveKeepBoth('u3');
  if (App.store.state.papers.length !== before + 1) throw new Error('两份都留未新增记录');
  restore();
});
t('去重：新论文走完整流水线后状态从 parsing 变为 done', async () => {
  restore();
  App.store.actions.addUploads([{ name: '2406.07594v2.pdf', size: 900000 }]);
  const up = App.store.state.uploads[App.store.state.uploads.length - 1];
  if (!up) throw new Error('上传项未入队');
  if (['parsing', 'queued'].indexOf(up.status) === -1) throw new Error('初始状态异常：' + up.status);
  await App.util.sleep(3000);
  if (up.status !== 'done') throw new Error('流水线结束后状态为 ' + up.status + '（期望 done）');
  if (!(up.pages > 0) || !(up.chars > 0)) throw new Error('未产出页数/字数');
  if (!App.store.state.papers.some((p) => p.file === '2406.07594v2.pdf')) throw new Error('论文未入库');
  restore();
});
t('去重：上传 v1 会走到 duplicate 状态并带出版本差异', async () => {
  restore();
  App.store.actions.addUploads([{ name: '1706.03762v1.pdf', size: 2128686 }]);
  const up = App.store.state.uploads[App.store.state.uploads.length - 1];
  await App.util.sleep(3000);
  if (up.status !== 'duplicate') throw new Error('未进入 duplicate 状态，实际：' + up.status);
  if (!up.dupInfo) throw new Error('缺少去重信息');
  if (up.dupInfo.paper.id !== 'p-attention-v7') throw new Error('命中了错误的论文：' + up.dupInfo.paper.id);
  restore();
});

/* --- 5. RAG 检索质量（对应需求 1.2 的例题） --- */
t('RAG：能命中「第 6 作者 / 机构」片段', () => {
  const hits = App.rag.retrieve('Attention Is All You Need 的第 6 作者是谁，在哪个公司工作？', ['p-attention-v7'], 5);
  if (!hits.length) throw new Error('未命中');
  if (!hits.some((h) => /Vaswani|Gomez|Google/i.test(h.text))) throw new Error('未命中作者信息片段');
});
t('RAG：能命中 Adam 超参数片段（β2 = 0.98）', () => {
  const hits = App.rag.retrieve('Adam 优化器的超参数 β1 与 β2 分别是多少', ['p-attention-v7'], 5);
  if (!hits.some((h) => h.text.indexOf('0.98') !== -1)) throw new Error('未命中 β2=0.98');
});
t('RAG：能命中 GPU 型号片段（P100）', () => {
  const hits = App.rag.retrieve('训练 Base 模型用了多少个 GPU，什么型号', ['p-attention-v7'], 5);
  if (!hits.some((h) => h.text.indexOf('P100') !== -1)) throw new Error('未命中 P100');
});
t('RAG：能命中 BLEU 结果片段（28.4 / 41.8）', () => {
  const hits = App.rag.retrieve('Transformer big 的 BLEU 分数是多少', ['p-attention-v7'], 5);
  if (!hits.some((h) => h.text.indexOf('28.4') !== -1)) throw new Error('未命中 BLEU 28.4');
});
t('RAG：能命中 Layer Normalization 参考文献片段', () => {
  const hits = App.rag.retrieve('列出关于 Layer Normalization 的参考文献完整作者与年份', ['p-attention-v7'], 5);
  if (!hits.some((h) => /Jimmy Lei Ba|1607\.06450/i.test(h.text))) throw new Error('未命中该参考文献');
});
t('RAG：多篇模式下能跨论文命中 BERT 承袭关系', () => {
  const hits = App.rag.retrieve('BERT 的架构与原始 Transformer 的 Encoder 有什么承袭关系', ['p-attention-v7', 'p-bert', 'p-gpt1'], 6);
  if (!hits.length) throw new Error('未命中');
  if (!hits.some((h) => h.paperId === 'p-bert')) throw new Error('未命中 BERT 片段');
});
t('RAG：检索范围限定生效', () => {
  const hits = App.rag.retrieve('GPU 型号 P100', ['p-bert'], 5);
  if (hits.some((h) => h.paperId !== 'p-bert')) throw new Error('返回了范围外的片段');
});
t('RAG：5 道需求例题都能匹配到内置标准答案', () => {
  const qs = [
    '论文 Attention Is All You Need 的第 6 作者是谁，在哪个公司 / 机构工作？',
    '其中 Adam 优化器的超参数 β1 与 β2 分别被设置为了多少？',
    '这篇论文中提到的 Transformer 架构，在训练 Base 模型时使用了多少个 GPU？具体是什么型号？',
    'Transformer (big) 模型在 English-to-German 任务上的 BLEU 分数是多少？提升了多少？',
    '请列出论文中引用的关于 "Layer Normalization" 的参考文献的完整作者与年份。',
  ];
  qs.forEach((q) => {
    const a = App.rag.presetAnswer(q);
    if (!a) throw new Error('未匹配预设答案：' + q.slice(0, 20));
    if (!a.text.length) throw new Error('答案为空');
  });
});
t('RAG：多篇模式的 3 道对比例题也能匹配', () => {
  restore();
  App.store.actions.setQaScope('multi');
  ['BERT 的架构与原始 Transformer 的 Encoder 有什么承袭关系？BERT 丢弃了哪个部分？',
    '对比 GPT-1、GPT-2 与 GPT-3 的论文，参数如何演化？',
    'GPT-2 相比于 GPT-1，在 Layer Normalization 位置上做了什么关键调整？'].forEach((q) => {
    if (!App.rag.presetAnswer(q)) throw new Error('未匹配：' + q.slice(0, 16));
  });
});
t('RAG：回答里带出处（论文名 + 章节 + 页码）', () => {
  const hits = App.rag.retrieve('位置编码 目的', ['p-attention-v7'], 3);
  const text = App.rag.compose('位置编码', hits, 'single');
  if (text.indexOf('出处：') === -1) throw new Error('回答缺少出处标注');
  if (text.indexOf('第') === -1 || text.indexOf('页') === -1) throw new Error('出处缺少页码');
});
t('RAG：检索不到时明确说明而不是编造', () => {
  const hits = App.rag.retrieve('zzzzqqqq 无关', ['p-attention-v7'], 3);
  if (hits.length) throw new Error('无关查询不应命中，实际命中 ' + hits.length + " 条");
  const text = App.rag.compose('zzzzqqqq', hits, 'single');
  if (text.indexOf('没有检索到') === -1) throw new Error('无命中时未给出提示');
});
t('RAG：完整问答链路能产出带引用的回答', async () => {
  restore();
  App.store.actions.setQaScope('single');
  App.store.actions.toggleQaPaper('p-attention-v7');
  await App.store.actions.ask('训练 Base 模型使用了多少个 GPU？');
  const chat = App.store.state.chats[0];
  if (!chat) throw new Error('未创建会话');
  const ai = chat.messages.filter((m) => m.role === 'assistant').pop();
  if (!ai) throw new Error('没有助手消息');
  if (ai.thinking || ai.streaming) throw new Error('回答仍处于思考/流式状态');
  if (ai.text.indexOf('P100') === -1) throw new Error('回答未包含正确答案 P100');
  if (!ai.evidence.length) throw new Error('回答没有携带证据片段');
  renderView('qa');
  mustFindAll('.msg', 2, '消息气泡');
  mustFindAll('.evi-card', 1, '右侧证据卡片');
  mustFind('[data-action="qa-cite"]');
  restore();
});

/* --- 6. 图谱算法 --- */
t('图谱：核心节点挖掘区块存在且给出基石 / 边缘结论', () => {
  restore();
  renderView('graph');
  mustText('基石论文');
  mustText('边缘衍生');
  mustText('入度');
});
t('图谱：自动综述覆盖三条演化主线', () => {
  const ins = App.data.graphInsights['g-transformer'];
  ['主干', '效率支线', '视觉迁移'].forEach((k) => {
    if (ins.summary.indexOf(k) === -1) throw new Error('综述缺少 ' + k);
  });
  restore();
});
t('图谱：未来工作建议体现「排除已被尝试的 idea」', () => {
  const fw = App.data.graphInsights['g-transformer'].futureWork;
  if (fw.length < 3) throw new Error('建议过少');
  if (!fw.some((f) => f.reason.indexOf('已被') !== -1)) throw new Error('未体现排除说明');
});
t('图谱：切换布局与显隐核心高亮都生效', () => {
  restore();
  App.store.actions.setGraphLayout('radial');
  renderView('graph');
  if (countExact('.gnode') < 10) throw new Error('时间环布局节点过少：' + countExact('.gnode'));
  App.store.actions.toggleCoreHighlight();
  renderView('graph');
  if (countExact('.gnode') < 10) throw new Error('关闭高亮后节点过少：' + countExact('.gnode'));
  if (countExact('#gcanvas path') < 5) throw new Error('关闭高亮后引用边丢失');
  App.store.actions.setGraphLayout('force');
  restore();
});
t('图谱：点击节点会记录选中并在侧栏展示详情', () => {
  restore();
  renderView('graph');
  App.store.actions.selectNode('p-attention-v7');
  renderView('graph');
  const side = el.querySelector('#gside');
  if (!side) throw new Error('缺少侧栏 #gside');
  if (side.textContent.indexOf('节点详情') === -1) throw new Error('侧栏未展示节点详情');
  if (side.textContent.indexOf('打开阅读') === -1) throw new Error('侧栏缺少操作按钮');
  mustText('入度');
  restore();
});

/* --- 7. 推荐 --- */
t('推荐：每日/每周/兴趣三个标签页可切换并渲染', () => {
  ['daily', 'weekly', 'interest'].forEach((tab) => {
    restore();
    App.store.actions.setDiscoverTab(tab);
    renderView('discover');
  });
});
t('推荐：每条卡片都有分数、理由与反馈按钮', () => {
  restore();
  App.store.actions.setDiscoverTab('daily');
  renderView('discover');
  if (countExact('.rec-card') < 4) throw new Error('推荐卡片过少：' + countExact('.rec-card'));
  if (countExact('.rec-score') !== countExact('.rec-card')) throw new Error('分数数量与卡片不匹配');
  mustText('推荐理由');
  if (countExact('[data-action="vote-up"]') !== countExact('.rec-card')) throw new Error('点赞按钮数量不匹配');
  if (countExact('[data-action="vote-down"]') !== countExact('.rec-card')) throw new Error('踩按钮数量不匹配');
});
t('推荐：踩过的条目会排到最后且被标记变暗', () => {
  restore();
  App.store.actions.setDiscoverTab('daily');
  renderView('discover');
  App.store.actions.vote('rec1', 'down');
  renderView('discover');
  const cards = el.querySelectorAll('.rec-card');
  const titles = cards.map((c) => c.textContent.replace(/\s+/g, ' '));
  const i1 = titles.findIndex((t) => t.indexOf('Native Sparse Attention') !== -1);
  if (i1 === -1) throw new Error('找不到被踩的条目');
  if (i1 !== cards.length - 1) throw new Error('被踩的条目没有被排到最后（位置 ' + i1 + '/' + cards.length + '）');
  if (!el.querySelector('.rec-card.dim')) throw new Error('被踩的条目没有变暗');
  restore();
});
t('推荐：每条推荐的理由与代码标记都有内容', () => {
  App.data.recommendations.forEach((r) => {
    if (!r.reason || r.reason.length < 20) throw new Error(r.id + ' 缺少推荐理由');
    if (typeof r.hasCode !== 'boolean') throw new Error(r.id + ' 缺少代码标记');
    if (r.hasCode && !r.codeUrl) throw new Error(r.id + ' 有代码但没有链接');
  });
});
t('推荐：自动下载区三个入口都在', () => {
  restore();
  renderView('discover');
  mustFind('#paper-name');
  mustFind('#name-go');
  mustFind('#refs-crawl');
  mustFind('#fetch-now');
});

/* --- 8. 写作助手算法 --- */
t('写作：CSV 解析（含引号包裹的逗号）', () => {
  const csv = App.writer.parseCSV('Model,BLEU,Latency\nA,21.4,128\n"B, big",27.3,98');
  if (csv.head.length !== 3) throw new Error('表头解析错误');
  if (csv.rows.length !== 2) throw new Error('行数错误');
  if (csv.rows[1][0] !== 'B, big') throw new Error('引号内的逗号未被正确处理');
});
t('写作：图注自动包含最高/最低与趋势结论', () => {
  const csv = App.writer.parseCSV('Model,BLEU\nA,21.4\nB,27.3\nC,29.6');
  const cap = App.writer.buildCaption(csv, 1, 0);
  ['最高值', '最低', '趋势', '29.6', '21.4'].forEach((k) => {
    if (cap.indexOf(k) === -1) throw new Error('图注缺少：' + k);
  });
});
t('写作：柱状图与雷达图都是合法 SVG', () => {
  const csv = App.writer.parseCSV('M,V\nA,1\nB,3');
  const bar = App.writer.renderBarChart(App.writer.toChart(csv, 1, 0), { line: true });
  if (bar.slice(0, 4) !== '<svg' || bar.indexOf('</svg>') === -1) throw new Error('柱状图 SVG 非法');
  const radar = App.writer.renderRadar(['a', 'b', 'c'], [{ name: 'x', values: [0.2, 0.6, 0.9] }]);
  if (radar.slice(0, 4) !== '<svg') throw new Error('雷达图 SVG 非法');
});
t('写作：框架生成包含 7 个章节与可核验的参考文献', () => {
  const o = App.writer.buildOutline('测试 idea');
  ['Abstract', '1 Introduction', '2 Related Work', '4 Experiments', 'References'].forEach((s) => {
    if (!o.sections.some((x) => x.name === s)) throw new Error('缺少章节 ' + s);
  });
  const v = o.verify();
  if (v.filter((x) => x.ok).length !== o.references.length) throw new Error('参考文献未全部核验通过');
});
t('写作：三种架构图代码都非空且可辨识', () => {
  const p = App.data.writerPresets;
  if (p.mermaid.indexOf('flowchart') === -1) throw new Error('mermaid 代码异常');
  if (p.tikz.indexOf('\\begin{tikzpicture}') === -1) throw new Error('tikz 代码异常');
  if (p.graphviz.indexOf('digraph') === -1) throw new Error('graphviz 代码异常');
});
t('写作：中译英能把中文摘要转为英文骨架', () => {
  const zh = App.data.getPaper('p-attention-v7').abstractZh;
  const en = App.writer.translateAbstract(zh);
  if (!en.length || en === zh) throw new Error('翻译无输出');
  if (en.indexOf('We propose') === -1) throw new Error('术语表未生效');
});

/* --- 9. 组件与工具 --- */
t('工具：html 模板会自动转义插值（防 XSS）', () => {
  const out = String(App.util.html`<p>${'<script>alert(1)</script>'}</p>`);
  if (out.indexOf('<script>') !== -1) throw new Error('XSS 未被转义');
  if (out.indexOf('&lt;script&gt;') === -1) throw new Error('转义结果不正确');
});
t('工具：raw() 可以插入未转义 HTML，天真的插值不会', () => {
  const safe = String(App.util.html`<div>${App.util.raw('<b>ok</b>')}</div>`);
  if (safe.indexOf('<b>ok</b>') === -1) throw new Error('raw 失效');
  const unsafe = String(App.util.html`<div>${'<b>ok</b>'}</div>`);
  if (unsafe.indexOf('<b>ok</b>') !== -1) throw new Error('普通字符串不应被当作 HTML 插入');
});
t('工具：html 返回的是 Out 对象，可以无限层嵌套而不会被转义', () => {
  const inner = App.util.html`<span class="x">${'a<b>'}</span>`;
  const outer = String(App.util.html`<div>${inner}</div>`);
  if (outer.indexOf('<span class="x">') === -1) throw new Error('嵌套结果被转义了');
  if (outer.indexOf('a&lt;b&gt;') === -1) throw new Error('内层文本未按预期转义');
  if (String(inner).indexOf('a&lt;b&gt;') === -1) throw new Error('内层文本未转义');
});
t('工具：seeded 伪随机可复现（同种子同序列）', () => {
  const a = App.util.seeded('x'); const b = App.util.seeded('x');
  for (let i = 0; i < 5; i++) if (a() !== b()) throw new Error('伪随机不可复现');
});
t('工具：格式化函数正确', () => {
  if (App.util.bytes(2215244) !== '2.1 MB') throw new Error('bytes 错误：' + App.util.bytes(2215244));
  if (App.util.pct(0.9812, 1) !== '98.1%') throw new Error('pct 错误');
  if (App.util.num(118420) !== '118,420') throw new Error('num 错误');
  if (App.util.clip('abcdefghij', 5) !== 'abcd…') throw new Error('clip 错误');
});
t('组件：Toast 会插入到 body 并带语义类型', () => {
  App.ui.toast('测试提示', 'ok');
  const host = documentStub.body.querySelector('.toasts');
  if (!host) throw new Error('未创建 .toasts 挂载点');
  // 取【最后一个】toast，避免匹配到之前用例留下的旧提示
  const all = host.querySelectorAll('.toast');
  if (!all.length) throw new Error('未生成 Toast');
  const tst = all[all.length - 1];
  const text = tst.innerHTML + '|' + tst.textContent;
  if (text.indexOf('测试提示') === -1) throw new Error('Toast 文案缺失，实际：' + JSON.stringify(tst.innerHTML));
  if (!tst.classList.contains('ok')) throw new Error('Toast 未带语义类型 ok');
});

/* --- 10. 数据一致性 --- */
t('数据：论文库字段完整、引用关系自洽', () => {
  const ids = App.data.papers.map((p) => p.id);
  if (ids.length < 40) throw new Error('论文不足 40 篇：' + ids.length);
  App.data.papers.forEach((p) => {
    ['id', 'title', 'authors', 'year', 'quality', 'pages', 'file'].forEach((k) => {
      if (p[k] === undefined) throw new Error(p.id + ' 缺少字段 ' + k);
    });
    if (!Array.isArray(p.authors) || !p.authors.length) throw new Error(p.id + ' 作者为空');
    if (p.quality < 0 || p.quality > 1) throw new Error(p.id + ' 质量分越界');
    (p.citesIds || []).forEach((c) => { if (ids.indexOf(c) === -1) throw new Error(p.id + ' 引用了不存在的 id：' + c); });
    if (p.citedByIds && !Array.isArray(p.citedByIds)) throw new Error(p.id + ' citedByIds 类型错误');
  });
});
t('数据：需求点名的 4 个测试文件都在文库中', () => {
  const files = App.data.papers.map((p) => p.file);
  ['1706.03762v7.pdf', '1706.03762v1.pdf', '1706.03762v1_img.pdf', 'UnderstandingDeepLearning_02_09_26_C.pdf']
    .forEach((f) => { if (files.indexOf(f) === -1) throw new Error('缺少测试文件 ' + f); });
});
t('数据：知识片段都能对应到真实论文 id', () => {
  const ids = App.data.papers.map((p) => p.id);
  if (App.data.knowledge.length < 20) throw new Error('知识片段过少');
  App.data.knowledge.forEach((k) => {
    if (ids.indexOf(k.paperId) === -1) throw new Error(k.id + ' 的 paperId 不存在：' + k.paperId);
    if (!k.text.length) throw new Error(k.id + ' 内容为空');
  });
});
t('数据：正文块的引文编号都有对应参考文献条目', () => {
  const doc = App.data.readerDoc['p-attention-v7'];
  const refNos = doc.blocks.filter((b) => b.type === 'reference').map((b) => b.refNo);
  doc.blocks.forEach((b) => {
    (b.cites || []).forEach((n) => {
      if (refNos.indexOf(n) === -1) throw new Error('正文引用了 [' + n + ']，但 References 里没有该条目');
    });
  });
});
t('数据：正文块 id 唯一，且目录锚点都能对应到正文块', () => {
  const doc = App.data.readerDoc['p-attention-v7'];
  const seen = {};
  doc.blocks.forEach((b) => {
    if (seen[b.id]) throw new Error('正文块 id 重复：' + b.id);
    seen[b.id] = 1;
  });
  doc.toc.forEach((t2) => {
    if (!doc.blocks.some((b) => b.id === t2.id)) throw new Error('目录项 ' + t2.id + ' 没有对应正文块');
  });
});
t('数据：附录与参考文献章节都存在（对应解析粒度要求）', () => {
  const doc = App.data.readerDoc['p-attention-v7'];
  const types = {};
  doc.blocks.forEach((b) => { types[b.type] = (types[b.type] || 0) + 1; });
  ['h1', 'h2', 'h3', 'p', 'formula', 'table', 'figure', 'reference', 'list'].forEach((k) => {
    if (!types[k]) throw new Error('缺少内容类型：' + k);
  });
});

/* --- 11. 状态流转 --- */
t('状态：切换到各视图后 route 正确', () => {
  App.VIEWS.forEach((v) => { App.store.actions.go(v.id); if (App.store.state.route !== v.id) throw new Error(v.id + ' 路由失败'); });
  restore();
});
t('状态：问答范围从多篇切回单篇时会收敛到 1 篇', () => {
  restore();
  App.store.actions.setQaScope('multi');
  App.store.actions.toggleQaPaper('p-bert');
  App.store.actions.toggleQaPaper('p-gpt2');
  if (App.store.state.qa.paperIds.length < 2) throw new Error('多选失败');
  App.store.actions.setQaScope('single');
  if (App.store.state.qa.paperIds.length !== 1) throw new Error('未收敛到 1 篇');
  restore();
});
t('状态：删除论文会同时清理当前阅读目标', () => {
  restore();
  App.store.actions.openPaper('p-dpo');
  App.store.actions.deletePaper('p-dpo');
  if (App.store.state.currentPaperId === 'p-dpo') throw new Error('未清理 currentPaperId');
  if (App.store.state.papers.some((p) => p.id === 'p-dpo')) throw new Error('未删除');
  restore();
});
t('状态：订阅通知次数正确，并可取消订阅', () => {
  restore();
  let n = 0;
  const off = App.store.on(() => n++);
  App.store.actions.toggleEvidence();
  App.store.actions.toggleEvidence();
  off();
  App.store.actions.toggleEvidence();
  if (n !== 2) throw new Error('通知次数异常：' + n);
  restore();
});

/* ==========================================================================
   输出：先跑完全部异步用例，再统一打印
   ========================================================================== */
(async function main() {
  for (const [label, fn] of pending) {
    try { await fn(); RESULTS.push(['OK  ', label]); }
    catch (e) {
      RESULTS.push(['FAIL', label + '\n        → ' + e.message +
        '\n        ' + String(e.stack || '').split('\n')[1]]);
    }
  }

  const okCount = RESULTS.filter((r) => r[0] === 'OK  ').length;
  const failCount = RESULTS.length - okCount;
  console.log('=== 脚本加载 ===');
  console.log(loadErrors.length ? loadErrors.join('\n') : '  16 个脚本全部加载成功，无语法/引用错误');
  console.log('\n=== 冒烟测试（渲染 + 交互 + 算法 + 数据一致性）===');
  RESULTS.forEach(([s, m]) => console.log('  [' + s + '] ' + m));
  console.log('\n—— 结果：' + okCount + '/' + RESULTS.length + ' 通过，失败 ' + failCount +
    '，加载错误 ' + loadErrors.length + ' 个 ——');
  process.exit(failCount === 0 && loadErrors.length === 0 ? 0 : 1);
})();
