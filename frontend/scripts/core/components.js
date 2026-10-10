/* ============================================================================
   components.js — 公共 UI 组件与全局浮层
   ----------------------------------------------------------------------------
   这里只放「跨视图复用」的东西：
     · App.ui.toast()    轻提示
     · App.ui.confirm()  确认对话框（Promise 风格）
     · App.ui.modal()    自定义内容弹窗
     · 一组返回 HTML 字符串的小组件工厂：statCard / badge / bar / empty 等
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  /* ------------------------------------------------------------------
     1) Toast 轻提示
     ------------------------------------------------------------------ */
  function toastHost() {
    let host = U.$('.toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toasts';
      document.body.appendChild(host);
    }
    return host;
  }

  /**
   * @param {string} msg  文案
   * @param {'ok'|'warn'|'danger'|''} kind 语义类型
   * @param {number} ms   停留毫秒
   */
  function toast(msg, kind, ms) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    const icon = kind === 'ok' ? '✓' : kind === 'warn' ? '!' : kind === 'danger' ? '×' : 'ℹ';
    el.innerHTML = h`<span>${icon}</span><span>${msg}</span>`;
    toastHost().appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 260);
    }, ms || 2400);
  }

  /* ------------------------------------------------------------------
     2) 通用弹窗 / 确认框（Promise 风格，便于在流程里 await）
     ------------------------------------------------------------------ */
  function mountMask(inner, opts) {
    const o = opts || {};
    const mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML = inner;
    document.body.appendChild(mask);
    const close = (result) => {
      mask.remove();
      document.removeEventListener('keydown', onKey);
      if (o.onClose) o.onClose(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(null); });
    U.$$('[data-close]', mask).forEach((b) => b.addEventListener('click', () => close(null)));
    return { mask, close };
  }

  /**
   * 确认对话框
   * @returns {Promise<boolean>}
   */
  function confirm(opts) {
    const o = Object.assign({
      title: '确认操作', body: '', okText: '确定', cancelText: '取消', danger: false,
    }, opts || {});
    return new Promise((resolve) => {
      const ui = mountMask(h`
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-head">
            <div class="modal-title">${o.title}</div>
            <div class="spacer"></div>
            <button class="btn btn-sm btn-ghost" data-close>✕</button>
          </div>
          <div class="modal-body">${U.raw(o.body)}</div>
          <div class="modal-foot">
            <div class="spacer"></div>
            <button class="btn btn-ghost" data-close>${o.cancelText}</button>
            <button class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" data-ok>${o.okText}</button>
          </div>
        </div>`, { onClose: () => resolve(false) });
      U.$('[data-ok]', ui.mask).addEventListener('click', () => { ui.close(); resolve(true); });
    });
  }

  /* ------------------------------------------------------------------
     3) 小组件工厂（返回【Out 对象】＝已知安全的 HTML）
        约定：所有 App.ui.xxx() 都返回 Out 对象，因此可以被安全地
        插进任何 html`` 模板里而不会被二次转义；用 .join('') 拼接也可以，
        因为 Out 对象自带 toString()。
     ------------------------------------------------------------------ */

  /** 直接复用 util 里的 Out，保证全站只有一种「安全 HTML」标记 */
  const Out = U.Out;

  /** 统计卡片 */
  function statCard(o) {
    return h`
      <div class="stat">
        <div class="stat-label"><span>${o.icon || ''}</span><span>${o.label}</span></div>
        <div class="stat-value">${o.value}${o.unit ? U.raw('<small>' + U.esc(o.unit) + '</small>') : ''}</div>
        ${o.trend ? U.raw('<div class="stat-trend">' + U.esc(o.trend) + '</div>') : ''}
      </div>`;
  }

  /** 带进度条的进度块 */
  function progressRow(label, value, kind) {
    return h`
      <div class="mb-12">
        <div class="row small" style="justify-content:space-between">
          <span class="muted">${label}</span>
          <span class="mono">${Math.round(value)}%</span>
        </div>
        <div class="bar ${kind || ''} mt-8"><i style="width:${Math.max(2, Math.min(100, value))}%"></i></div>
      </div>`;
  }

  /** 空状态 */
  function empty(icon, text, action) {
    return h`
      <div class="empty">
        <div class="empty-icon">${icon || '◌'}</div>
        <div class="mb-12">${text}</div>
        ${action ? U.raw(action) : ''}
      </div>`;
  }

  /** 质量分徽章（解析置信度） */
  function qualityBadge(q) {
    const kind = q >= 0.95 ? 'badge-ok' : q >= 0.88 ? 'badge-info' : q >= 0.8 ? 'badge-warn' : 'badge-danger';
    const text = q >= 0.95 ? '解析优' : q >= 0.88 ? '解析良' : q >= 0.8 ? '需校对' : '低置信';
    return h`<span class="badge ${kind}" title="解析置信度 ${U.pct(q, 0)}">${text} ${U.pct(q, 0)}</span>`;
  }

  /** 可点击的引用角标 [n] */
  function citeBadge(n, action) {
    return h`<span class="cite" data-cite="${n}" data-action="${action || 'jump-cite'}" title="跳转到参考文献 [${n}]">[${n}]</span>`;
  }

  /** 区块标题 */
  function sectionTitle(text, extra) {
    return h`<div class="section-title"><span>${text}</span>${extra ? U.raw(extra) : ''}</div>`;
  }

  /* ------------------------------------------------------------------
     导出
     ------------------------------------------------------------------ */
  App.ui = Object.assign(App.ui || {}, {
    Out, toast, confirm, mountMask,
    statCard, progressRow, empty, qualityBadge, citeBadge, sectionTitle,
    /** 打开自定义弹窗，返回关闭函数 */
    openModal(html, opts) { return mountMask(html, opts); },
  });
})(window.App);
