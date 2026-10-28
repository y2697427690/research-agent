/* ============================================================================
   views/discover.js — 论文发现（arXiv 检索）
   ----------------------------------------------------------------------------
   这一版重写的原因：旧版整页都是演示数据（App.data.recommendations），
   包括虚构的推荐论文、虚构的「引用含金量」、点赞数、主题分布与算法权重。
   演示时一旦被追问细节就会露馅，比界面难看严重得多。

   现在只保留能真正跑通的部分：
     · 按关键词检索 arXiv（真实接口 GET /discover/search）
     · 一键下载入库并自动解析（POST /discover/ingest → /papers/{id}/parse）
     · 明确标出「已在库」，避免用户重复点击后才发现重复

   尚未实现的能力（引用含金量筛选、定期追踪、多用户推荐）在页面底部如实说明，
   而不是做一块假界面。
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  function render(el) {
    const st = App.store.state;
    const d = st.discover;

    el.innerHTML = h`
      <div class="view-head">
        <div class="grow">
          <div class="view-title">论文发现</div>
          <div class="view-desc">
            直接检索 arXiv 上的论文，找到后点「入库」即可下载原文并自动解析、分块、向量化，
            随后就能在问答与阅读器里使用。
          </div>
        </div>
      </div>

      ${searchCard(d)}
      ${resultArea(d)}
      ${footNote()}
    `;

    bind(el);
  }

  /* ---------------- 搜索区 ---------------- */
  function searchCard(d) {
    return App.ui.Out(h`
      <div class="card mb-16">
        <div class="card-body">
          <div class="disc-search">
            <input class="input" id="dq" placeholder="输入关键词，例如 layer normalization、transformer attention"
              value="${d.query || ''}" autocomplete="off" />
            <button class="btn btn-primary nowrap" data-action="discover-search">检索 arXiv</button>
          </div>
          <div class="disc-search-foot">
            <div class="row gap-8">
              <span class="muted small">排序</span>
              <button class="btn btn-sm ${d.sort === 'relevance' ? 'btn-primary' : 'btn-ghost'}"
                data-action="discover-sort" data-sort="relevance">相关度</button>
              <button class="btn btn-sm ${d.sort === 'recent' ? 'btn-primary' : 'btn-ghost'}"
                data-action="discover-sort" data-sort="recent">最新发布</button>
            </div>
            <div class="spacer"></div>
            <span class="muted tiny">
              支持 arXiv 语法：<code>ti:transformer</code>、<code>au:hinton</code>、<code>abs:attention</code>
            </span>
          </div>
          ${d.query
            ? U.raw(h`
              <div class="muted tiny mt-8">
                实际查询：<code>${d.effectiveQuery || d.query}</code>
                ${d.effectiveQuery && d.effectiveQuery !== d.query
                  ? '（多词查询会自动加上引号按短语匹配，精度更高）'
                  : ''}
              </div>`)
            : ''}
        </div>
      </div>`);
  }

  /* ---------------- 结果区 ---------------- */
  function resultArea(d) {
    if (d.loading) {
      return App.ui.Out(h`
        <div class="card"><div class="card-body">
          <div class="disc-state">
            <span class="dot-pulse"></span>
            正在检索 arXiv（官方接口限制约 3 秒一次请求，请稍候）…
          </div>
        </div></div>`);
    }

    if (d.error) {
      return App.ui.Out(h`
        <div class="card"><div class="card-body">
          <div class="disc-state disc-state-err">检索失败：${d.error}</div>
          <div class="muted small mt-8">常见原因：网络不可达、arXiv 限流（短时间内请求过多）。稍等片刻再试。</div>
        </div></div>`);
    }

    if (!d.items.length) {
      const hint = d.hint || '输入关键词后按「检索 arXiv」，或直接回车。';
      return App.ui.Out(h`
        <div class="card"><div class="card-body">
          <div class="disc-state">${hint}</div>
        </div></div>`);
    }

    return App.ui.Out(h`
      <div class="disc-count muted small">共 ${d.total} 条结果（按 ${d.sort === 'recent' ? '最新发布' : '相关度'} 排序）</div>
      <div class="disc-list">
        ${U.raw(d.items.map((it) => itemCard(it, d)).join(''))}
      </div>`);
  }

  /** 一条检索结果 */
  function itemCard(it, d) {
    const busy = !!d.ingesting[it.fullId || it.arxivId];
    const meta = [
      it.authors && it.authors.length ? U.clip(it.authors.slice(0, 3).join(', ') + (it.authors.length > 3 ? ' 等' : ''), 60) : '',
      it.published || '',
      it.primaryCategory || '',
    ].filter(Boolean).join(' · ');

    return App.ui.Out(h`
      <article class="card disc-item">
        <div class="card-body">
          <div class="disc-title-row">
            <a class="disc-title" href="${it.absUrl || '#'}" target="_blank" rel="noopener">${it.title}</a>
            <span class="badge badge-outline mono">arXiv:${it.arxivId}${it.version || ''}</span>
          </div>
          <div class="disc-meta">${meta}</div>
          ${it.comment ? U.raw(h`<div class="disc-comment">${U.clip(it.comment, 120)}</div>`) : ''}
          <p class="disc-abs">${U.clip(it.summary || '', 260)}</p>
          <div class="disc-actions">
            ${it.inLibrary
              ? U.raw(h`<span class="badge badge-ok">已在库</span>`)
              : it.withdrawn
                // 撤稿论文没有 PDF，点了只会等一次 404 —— 直接说明原因，不给按钮
                ? U.raw(h`<span class="badge badge-warn" title="arXiv 已撤稿，没有 PDF 可下载">已撤稿 · 无法入库</span>`)
                : U.raw(h`
                <button class="btn btn-sm btn-primary" data-action="discover-ingest"
                  data-id="${it.fullId || it.arxivId}" ${busy ? 'disabled' : ''}>
                  ${busy ? '下载入库中…' : '入库并解析'}
                </button>`)}
            <a class="btn btn-sm btn-ghost" href="${it.pdfUrl || it.absUrl || '#'}" target="_blank" rel="noopener">PDF 原文</a>
          </div>
        </div>
      </article>`);
  }

  /* ---------------- 底部说明：如实交代未实现的部分 ---------------- */
  function footNote() {
    return App.ui.Out(h`
      <div class="disc-foot">
        <span class="muted small">
          已实现：关键词检索、一键下载入库、自动去重（同篇不同版本会识别并提示）。
          尚未实现：引用含金量筛选、按订阅定期追踪新论文、多用户推荐算法
          —— 这些在需求里属「后续工作」，不做假界面。
        </span>
      </div>`);
  }

  /* ---------------- 交互 ---------------- */
  function bind(el) {
    const input = U.$('#dq', el);
    if (!input) return;
    // 回车即检索：比「输入后去点按钮」顺手，且不影响多行输入（这里是单行）
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        App.store.actions.discoverSearch(input.value);
      }
    });
    // 保留上次的输入内容，重绘后把光标放到末尾。
    // 注意要用类型判断：冒烟测试用的是极简 DOM 垫片，没有 setSelectionRange，
    // 直接调用会让整页渲染抛错（真实浏览器里存在）。
    if (App.store.state.discover.query) {
      input.focus();
      if (typeof input.setSelectionRange === 'function') {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }
    }
  }

  App.views = App.views || {};
  App.views.discover = { render, searchCard, resultArea, itemCard, footNote };
})(window.App);
