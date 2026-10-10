/* ============================================================================
   util.js — 通用工具函数（无状态、无依赖）
   ----------------------------------------------------------------------------
   作用：提供全站共用的「小工具」，避免每个视图重复造轮子。
   包含：
     · 字符串与 DOM 辅助   （esc / html / $ / $$）
     · 格式化              （字节、日期、百分比、相对时间）
     · 模拟异步            （sleep / mockAsync / streamText）
     · 简单哈希            （用于生成稳定的伪随机 id）
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';

  /* ---------------- DOM ---------------- */

  /** 查询单个元素 */
  const $ = (sel, root) => (root || document).querySelector(sel);
  /** 查询多个元素（返回真数组） */
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ------------------------------------------------------------------
     安全 HTML 的约定
     ------------------------------------------------------------------
     凡是「代码自己生成的 HTML」都返回一个带 __html 标记的对象（叫 Out 对象）：
       · html`` 模板标签直接返回 Out 对象
       · App.ui.Out(x) 把任意字符串包成 Out 对象
     好处：
       1) Out 对象插进任何 html`` 模板都不会被二次转义（嵌套组件天然安全）；
       2) 普通字符串（用户输入、文件里的文字）仍然 100% 自动转义，XSS 防护不削弱；
       3) Out 对象自带 toString()，所以 .join('') / 变量赋值 等旧写法依然可用。
     ------------------------------------------------------------------ */

  /** 把一段已知安全的 HTML 标记为 Out 对象 */
  function Out(s) {
    let html = s == null ? '' : String(s);
    return {
      __html: html,
      toString() { return html; },
    };
  }

  /** 判断是否已经是 Out / raw 对象 */
  const isSafe = (v) => !!(v && typeof v === 'object' && (v.__html != null || v.__raw != null));

  /**
   * HTML 转义：任何拼进 innerHTML 的用户数据都必须先过这里。
   * Out / raw 对象原样返回；其余一律转义。
   */
  const esc = (s) => {
    if (isSafe(s)) return String(s.__html != null ? s.__html : s.__raw);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /**
   * 模板标签：自动转义插值，只有 ${...} 会被转义，其余原样保留。
   * 用法： html`<p>${userInput}</p>`
   * 返回 Out 对象，可直接嵌套进另一个 html`` 而不会被转义。
   */
  function html(strings) {
    const values = Array.prototype.slice.call(arguments, 1);
    const out = strings.reduce((acc, str, i) => {
      if (i === 0) return str;
      const v = values[i - 1];
      return acc + esc(v) + str;
    }, '');
    return Out(out);
  }

  /**
   * 标记一段已知安全的 HTML。
   * 兼容两种用法：raw('...') 用于拼接字符串，h`...` 直接返回 Out 对象。
   */
  const raw = (s) => Out(s);

  /** 事件委托：在 container 上监听，匹配 selector 时触发 handler */
  function delegate(container, eventName, selector, handler) {
    container.addEventListener(eventName, (e) => {
      const target = e.target.closest(selector);
      if (target && container.contains(target)) handler(e, target);
    });
  }

  /* ---------------- 格式化 ---------------- */

  /** 字节数 → 人类可读 */
  function bytes(n) {
    if (n == null) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /** 相对时间：3 分钟前 / 2 天前 */
  function ago(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return iso || '-';
    // 为了让演示数据永远「看起来是新的」，以数据里的 now 为基准（见 mock-data.js）
    const base = (App.data && App.data.NOW) ? new Date(App.data.NOW).getTime() : Date.now();
    const diff = Math.max(0, base - t);
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + ' 个月前';
    return Math.floor(mo / 12) + ' 年前';
  }

  /** 日期：2024-06-14 */
  function date(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || '-';
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  const pct = (x, digits) => (x * 100).toFixed(digits == null ? 0 : digits) + '%';

  /** 数字千分位 */
  const num = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US'));

  /** 截断长文本 */
  const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

  /* ---------------- 异步模拟 ---------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 模拟一次后端请求：延迟 + 返回数据 */
  async function mockAsync(fn, ms) {
    await sleep(ms == null ? 400 + Math.random() * 500 : ms);
    return typeof fn === 'function' ? fn() : fn;
  }

  /**
   * 逐字输出（打字机效果），用于模拟大模型流式回答。
   * 返回一个可中断的控制器：{ stop() }
   */
  function streamText(el, text, opts) {
    const o = Object.assign({ speed: 16, chunk: 2, onDone: null }, opts || {});
    let i = 0;
    let stopped = false;
    el.textContent = '';
    const timer = setInterval(() => {
      if (stopped) return;
      i += o.chunk;
      el.textContent = text.slice(0, i);
      const view = el.closest('.view');
      if (view) view.scrollTop = view.scrollHeight;
      if (i >= text.length) {
        clearInterval(timer);
        if (o.onDone) o.onDone();
      }
    }, o.speed);
    return { stop() { stopped = true; clearInterval(timer); } };
  }

  /* ---------------- 杂项 ---------------- */

  /** 字符串 → 稳定整数（djb2 变体），用于生成确定性伪随机数 */
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /** 基于种子的伪随机：同一 seed 永远得到同一序列（保证刷新页面图表不变） */
  function seeded(seed) {
    let s = hash(String(seed)) || 1;
    return function () {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  /** 深拷贝（仅处理 JSON 可序列化数据） */
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** 简易防抖 */
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms || 200);
    };
  }

  /** 唯一 id */
  let uidSeq = 0;
  const uid = (prefix) => (prefix || 'id') + '-' + (++uidSeq) + '-' + Math.random().toString(36).slice(2, 7);

  /** 生成 n 个元素的数组并 map */
  const times = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

  /** 数组按 key 分组 */
  function groupBy(arr, keyFn) {
    return arr.reduce((acc, item) => {
      const k = keyFn(item);
      (acc[k] = acc[k] || []).push(item);
      return acc;
    }, {});
  }

  App.util = {
    $, $$, esc, html, raw, Out, isSafe, delegate,
    bytes, ago, date, pct, num, clip,
    sleep, mockAsync, streamText,
    hash, seeded, clone, debounce, uid, times, groupBy,
  };
})(window.App);
