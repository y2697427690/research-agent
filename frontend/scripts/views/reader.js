/* ============================================================================
   views/reader.js — 阅读器（结构化阅读 / 翻译 / 中英对比）
   ----------------------------------------------------------------------------
   对应需求 1.3「阅读和翻译」：
     1.3.1 基本阅读功能 —— 保留原文排版（双栏·单栏·公式·表格）
     1.3.2 智能引导     —— ① 一/二/三级标题树状导航栏，任意跳转
                          ② 引文角标 [1] 可点击跳到 References，并能跳回原位
     1.3.3 翻译         —— ① 划词/选中翻译 ② 整篇翻译（Markdown 重排 / 保排版两种方案）
                          ③ 中英对比阅读：拖动一侧，另一侧自动同步滚动
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  /** 记录最近一次点击的引文，用于「跳回原位」 */
  let lastCiteScroll = null;
  /** 同步滚动锁，避免两侧互相触发形成死循环 */
  let syncing = false;

  /* ==========================================================================
     1. 主渲染
     ========================================================================== */
  function render(el) {
    const st = App.store.state;
    const paperId = st.currentPaperId || st.routeParams.paperId;

    if (!paperId) { el.innerHTML = pickerHtml(); bindPicker(el); return; }
    const paper = App.data.getPaper(paperId);
    if (!paper) { el.innerHTML = U.html`${U.raw(App.ui.empty('▤', '找不到这篇论文，可能已被删除'))}`; return; }

    const doc = App.data.getDoc(paperId);
    const mode = st.reader.mode;

    el.innerHTML = h`
      ${U.raw(modeBanner(mode, paper))}
      <div class="reader ${mode === 'bilingual' ? 'is-bilingual' : ''}">
        <!-- 左：树状导航 -->
        <aside class="rd-outline">
          <div class="rd-outline-head">
            <div class="card-title">目录导航</div>
            <div class="muted tiny">一 / 二 / 三级标题</div>
          </div>
          <div class="rd-outline-body" id="outline">
            ${U.raw(doc ? outlineHtml(doc.toc) : U.html`<div class="muted small" style="padding:12px">该论文暂无演示目录</div>`)}
          </div>
          <div class="rd-outline-foot">
            <div class="row small" style="justify-content:space-between">
              <span class="muted">同步滚动</span>
              <button class="switch ${st.reader.syncScroll ? 'on' : ''}" data-action="toggle-sync" title="开启后拖动一侧另一侧会跟随">
                <i></i>
              </button>
            </div>
            <div class="muted tiny mt-8">中英对比阅读：拖动任一侧，另一侧自动滚动到对应位置。</div>
          </div>
        </aside>

        <!-- 中：原文（「整篇译文」模式下隐藏，只保留译文） -->
        ${mode !== 'translation' ? U.raw(h`
        <section class="rd-pane" id="pane-en">
          <div class="rd-pane-head">
            <span class="badge badge-outline">原文</span>
            <span class="muted tiny">${paper.venue} · ${paper.year} · v${paper.version}</span>
            <div class="spacer"></div>
            <span class="muted tiny">划选文字可直接翻译</span>
          </div>
          <div class="rd-pane-body" id="body-en" data-pane="en">
            ${U.raw(doc ? blocksHtml(doc.blocks, 'en') : placeholderDoc(paper))}
          </div>
        </section>`) : ''}

        <!-- 右：译文（仅对比/纯译文模式出现） -->
        ${mode !== 'original' ? U.raw(h`
          <section class="rd-pane" id="pane-zh">
            <div class="rd-pane-head">
              <span class="badge badge-brand">${mode === 'bilingual' ? '中文译文' : '全文翻译'}</span>
              ${U.raw(translateBadge(st, paperId))}
              <span class="muted tiny">公式 / 代码保留英文原文</span>
              <div class="spacer"></div>
              <span class="muted tiny">机器翻译 · 仅供参考</span>
            </div>
            <div class="rd-pane-body" id="body-zh" data-pane="zh">
              ${U.raw(translateHint(st, paperId))}
              ${U.raw(doc
                ? (isTranslating(st, paperId) && (doc.translatedChunks || 0) === 0
                  ? translatingSkeleton()
                  : blocksHtml(doc.blocks, 'zh'))
                : placeholderDoc(paper))}
            </div>
          </section>`) : ''}
      </div>

      <!-- 划词翻译浮层 -->
      <div class="sel-pop hidden" id="selpop"></div>
    `;

    if (doc) bindReader(el, doc, paper);
    bindSelection(el);
    // 从问答页「跳转原文」过来时，定位到对应段落并高亮
    applyFocusEvidence(el, doc, st);
  }

  /**
   * 应用「跳转到原文」的定位请求。
   *
   * 背景：问答页的引用卡片有个「跳转原文」按钮，原来只是打开整篇论文，
   * 用户还得自己在正文里翻——反馈"跳过去不知道看哪儿"。
   * 现在带着片段文本前缀过来，在正文里按文本匹配定位，滚动 + 高亮 + 提示页码。
   *
   * 匹配用「去空白后的前 40 字」：正文块和片段来自同一批分块，
   * 文字一致，只是换行/空格可能不同。
   */
  function applyFocusEvidence(el, doc, st) {
    const focus = st.reader.focusEvidence;
    if (!focus) return;
    if (!doc) return;          // 正文还在异步加载，等下一次渲染再试

    const key = String(focus.text || '').replace(/\s+/g, '').slice(0, 40);
    if (!key) {
      App.store.actions.clearFocusEvidence();
      return;
    }

    const blocks = el.querySelectorAll('.doc-p, .doc-list, .doc-h1, .doc-h2, .doc-h3');
    let hit = null;
    for (let i = 0; i < blocks.length; i += 1) {
      const txt = String(blocks[i].textContent || '').replace(/\s+/g, '');
      if (txt.indexOf(key) !== -1) { hit = blocks[i]; break; }
    }
    // 文本没匹配上（分块边界或换行差异）时退回按页码定位：
    // 至少把用户带到该页的第一个段落，比打开整篇让人自己翻强。
    if (!hit && focus.page) {
      hit = el.querySelector('.doc-p[data-page="' + focus.page + '"]')
        || el.querySelector('[data-page="' + focus.page + '"]');
    }

    if (!hit) {
      App.ui.toast('已打开论文，但没在正文里定位到该段（可能该段未渲染）', 'warn', 3200);
      App.store.actions.clearFocusEvidence();
      return;
    }

    hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
    hit.classList.remove('blk-flash');
    void hit.offsetWidth;
    hit.classList.add('blk-flash');
    setTimeout(() => hit.classList.remove('blk-flash'), 2600);

    const page = focus.page ? '第 ' + focus.page + ' 页' : '';
    const sec = focus.section && focus.section !== '正文' ? focus.section : '';
    App.ui.toast('已定位到原文' + (page || sec ? '：' + [page, sec].filter(Boolean).join(' · ') : ''),
      'ok', 2400);
    App.store.actions.clearFocusEvidence();
  }

  /**
   * 划词翻译绑定。因为正文是用 innerHTML 一次性写入的，
   * 所以这里只绑定一次 mouseup 委托在容器上（而不是每个段落绑一次）。
   */
  function bindSelection(el) {
    const pane = U.$('#body-en', el);
    const pop = U.$('#selpop', el);
    if (pane && pop) {
      pane.addEventListener('mouseup', () => {
        const sel = window.getSelection();
        const txt = sel ? String(sel.toString()).trim() : '';
        if (!txt || txt.length < 2) { pop.classList.add('hidden'); return; }
        showSelPop(pop, txt, sel);
      });
    }
    // 点击页面其他位置时收起浮层
    document.addEventListener('mousedown', (e) => {
      const p = U.$('#selpop');
      if (p && !p.classList.contains('hidden') && !p.contains(e.target)) {
        p.classList.add('hidden');
      }
    });
  }

  /** 未选论文时的选择列表 */
  function pickerHtml() {
    const papers = App.store.state.papers;
    return App.ui.Out(h`
      <div class="view-head"><div>
        <div class="view-title">选择要阅读的论文</div>
        <div class="view-desc">阅读器提供结构化阅读：树状目录、引文跳转、中英对照与划词翻译。</div>
      </div></div>
      <div class="grid grid-2">
        ${U.raw(papers.slice(0, 12).map((p) => h`
          <div class="card" data-action="open-paper" data-id="${p.id}" style="cursor:pointer">
            <div class="card-body">
              <div style="font-weight:620">${p.title}</div>
              <div class="muted small mt-8">${App.data.formatAuthors(p.authors, 2)} · ${p.year}</div>
              <div class="row gap-8 mt-12">
                ${U.raw(App.ui.qualityBadge(p.quality))}
                <span class="badge badge-outline">${p.pages} 页</span>
                ${App.data.getDoc(p.id) ? U.raw(h`<span class="badge badge-brand">含演示正文</span>`) : ''}
              </div>
            </div>
          </div>`).join(''))}
      </div>`);
  }
  function bindPicker() { /* 通过全局事件委托 */ }

  /** 顶部模式说明条 */
  function modeBanner(mode, paper) {
    const map = {
      original: { icon: '❐', title: '原文模式', desc: '仅显示英文原文，保留论文原有的排版结构（单栏 / 双栏、公式、表格）。' },
      bilingual: { icon: '⇄', title: '中英对照模式', desc: '左右双栏逐段对齐：拖动任意一侧，另一侧自动同步滚动到对应段落。公式与代码默认不翻译。' },
      translation: { icon: '文', title: '整篇译文模式', desc: '仅显示中文译文（Markdown 重排）。另一种方案是「输出 PDF 并按原位置重新排版」，需额外处理中英文长度差异。' },
    };
    const m = map[mode] || map.original;
    return App.ui.Out(h`
      <div class="notice info mb-16">
        <span>${m.icon}</span>
        <div>
          <div style="font-weight:600">${m.title}</div>
          <div class="muted tiny">${m.desc}</div>
        </div>
      </div>`);
  }

  /* ==========================================================================
     2. 顶栏工具条（由 app.js 的 renderTopbar 调用）
     ========================================================================== */
  function toolbar() {
    const r = App.store.state.reader;
    const st = App.store.state;
    const paperId = st.currentPaperId || st.routeParams.paperId;
    return App.ui.Out(h`
      <div class="row gap-4" style="background:var(--bg-2);padding:3px;border-radius:10px">
        <button class="btn btn-sm ${r.mode === 'original' ? 'btn-primary' : 'btn-ghost'}" data-action="reader-mode" data-mode="original">原文</button>
        <button class="btn btn-sm ${r.mode === 'bilingual' ? 'btn-primary' : 'btn-ghost'}" data-action="reader-mode" data-mode="bilingual">中英对照</button>
        <button class="btn btn-sm ${r.mode === 'translation' ? 'btn-primary' : 'btn-ghost'}" data-action="reader-mode" data-mode="translation">整篇译文</button>
      </div>
      <div class="sep"></div>
      <div class="row gap-4">
        <button class="btn btn-sm btn-ghost btn-icon" data-action="reader-zoom" data-scale="0.9" title="缩小">－</button>
        <span class="mono small muted" style="width:38px;text-align:center">${U.pct(r.scale, 0)}</span>
        <button class="btn btn-sm btn-ghost btn-icon" data-action="reader-zoom" data-scale="1.15" title="放大">＋</button>
      </div>
      <div class="sep"></div>
      <button class="btn btn-sm btn-ghost" data-action="goto-publication" data-id="${paperId}">查看解析详情</button>`);
  }

  /* ==========================================================================
     3. 目录导航
     ========================================================================== */
  function outlineHtml(toc) {
    return App.ui.Out(toc.map((t) => h`
      <button class="toc-item lv${t.level}" data-action="goto-anchor" data-id="${t.id}">
        <span class="toc-dot"></span>
        <span class="grow" style="text-align:left;min-width:0">
          <span class="toc-en ellipsis">${t.title}</span>
          ${t.titleZh ? h`<span class="toc-zh ellipsis">${t.titleZh}</span>` : ''}
        </span>
        <span class="muted tiny mono">${t.page}</span>
      </button>`).join(''));
  }

  /* ==========================================================================
     4. 正文块渲染（按语言）
     ========================================================================== */
  /** 当前是否正在翻译某篇论文 */
  function isTranslating(st, paperId) {
    const t = st.reader.translating;
    return !!(t && t.paperId === paperId);
  }

  /**
   * 译文面板的骨架屏。
   *
   * 为什么需要：翻译按批请求，第一批要 5~8 秒才回来。
   * 这段时间里译文面板本来是空的，用户会以为"点了没反应"。
   * 现在先铺几条灰条占位（带呼吸动画），视觉上明确表示"正在生成"。
   */
  function translatingSkeleton() {
    const lines = [92, 84, 96, 70, 88, 62];
    return h`
      <div class="rd-skeleton" aria-busy="true" aria-label="正在翻译">
        ${U.raw(lines.map((w) => h`
          <span class="rd-skeleton-line" style="width:${w}%"></span>`).join(''))}
      </div>`;
  }

  /**
   * 译文面板标题旁的进度徽标。
   * 翻译是按批自动续的，用户需要知道"正在进行"与"已完成多少"，
   * 否则译文区域空白会被误认为功能卡住。
   */
  function translateBadge(st, paperId) {
    const t = st.reader.translating;
    if (!t || t.paperId !== paperId) return '';
    // total 为 0 表示还没拿到总段数（首批请求尚未返回），此时只显示"翻译中…"
    if (!t.total) return h`<span class="badge badge-outline mono">翻译中…</span>`;
    const pct = Math.round((t.done / t.total) * 100);
    return h`<span class="badge badge-outline mono">翻译中 ${t.done}/${t.total} · ${pct}%</span>`;
  }

  /**
   * 译文面板顶部的提示条。
   * 三种状态：
   *   翻译中   → 提示会自动续翻，可手动停止
   *   部分已译 → 提示还剩多少段，点击继续
   *   已完成   → 不显示
   */
  function translateHint(st, paperId) {
    const t = st.reader.translating;
    if (t && t.paperId === paperId) {
      const progress = t.total ? `（${t.done}/${t.total}）` : '';
      return h`
        <div class="rd-translate-hint">
          <span class="dot-pulse"></span>
          正在翻译${progress}，首批结果马上出来，完成后自动显示中文。
          <button class="btn btn-sm btn-ghost" data-action="cancel-translate">停止翻译</button>
        </div>`;
    }
    const doc = App.data && App.data.getDoc ? App.data.getDoc(paperId) : null;
    if (doc && doc.isReal && doc.totalChunks > 0
      && doc.translatedChunks < doc.totalChunks) {
      // 区分「用户主动停止」与「没开始过」：停止后明确提示已译到哪，
      // 并保留继续入口，避免用户以为进度丢了。
      const stopped = st.reader.translateStoppedId === paperId;
      return h`
        <div class="rd-translate-hint">
          ${stopped
            ? `已停止，已翻译 ${doc.translatedChunks}/${doc.totalChunks} 段。`
            : `已翻译 ${doc.translatedChunks}/${doc.totalChunks} 段，尚未完成。`}
          <button class="btn btn-sm btn-ghost" data-action="continue-translate">继续翻译</button>
        </div>`;
    }
    return '';
  }

  function blocksHtml(blocks, lang) {
    return App.ui.Out(blocks.map((b) => blockHtml(b, lang)).join(''));
  }

  function citeSpans(b, lang) {
    if (!b.cites || !b.cites.length) return '';
    return App.ui.Out(' ' + b.cites.map((n) =>
      h`<span class="cite" data-action="jump-cite" data-cite="${n}" title="跳转到参考文献 [${n}]">[${n}]</span>`).join(''));
  }

  function blockHtml(b, lang) {
    const isEn = lang === 'en';
    const text = isEn ? b.en : b.zh;
    // 中文侧在段落末尾同样保留引文角标，方便对照
    const cites = citeSpans(b, lang);

    switch (b.type) {
      case 'h1': return App.ui.Out(h`<h1 class="doc-h1" data-page="${b.page || 1}" id="${b.id}-${lang}">${text}<span class="anchor-flag">§</span></h1>`);
      case 'h2': return App.ui.Out(h`<h2 class="doc-h2" data-page="${b.page || 1}" id="${b.id}-${lang}">${text}</h2>`);
      case 'h3': return App.ui.Out(h`<h3 class="doc-h3" data-page="${b.page || 1}" id="${b.id}-${lang}">${text}</h3>`);
      case 'p':
        return App.ui.Out(h`<p class="doc-p" data-page="${b.page || 1}" id="${b.id}-${lang}">${U.raw(U.esc(text).replace(/\n/g, '<br/>'))}${U.raw(cites)}</p>`);
      case 'list':
        return App.ui.Out(h`<div class="doc-list" data-page="${b.page || 1}" id="${b.id}-${lang}">${U.raw(U.esc(text).split('\n').map((l) =>
          h`<div class="doc-li">${l.replace(/^•\s*/, '')}</div>`).join(''))}</div>`);
      case 'formula':
        return App.ui.Out(h`
          <div class="doc-formula" id="${b.id}-${lang}">
            <div class="fx">${text}</div>
            ${isEn && b.latex ? h`<div class="latex mono">${b.latex}</div>` : ''}
            ${b.note ? h`<div class="muted tiny">${b.note}</div>` : ''}
          </div>`);
      case 'figure':
        return App.ui.Out(h`
          <div class="doc-figure" id="${b.id}-${lang}">
            <div class="fig-canvas">${U.raw(figureSvg(b))}</div>
            <div class="fig-caption">
              <div class="muted tiny mb-8">${b.kind || '图'} · 自动提取的 Figure Caption${b.caption ? ' · ' + b.caption : ''}</div>
              <div>${text}</div>
            </div>
          </div>`);
      case 'table':
        return App.ui.Out(h`
          <div class="doc-table" id="${b.id}-${lang}">
            ${b.caption ? h`<div class="muted tiny mb-8">${b.caption}</div>` : ''}
            <table class="table">
              <thead><tr>${U.raw(b.table.head.map((th) => h`<th>${th}</th>`).join(''))}</tr></thead>
              <tbody>${U.raw(b.table.rows.map((r, ri) => h`
                <tr class="${ri === b.table.highlightRow ? 'hl' : ''}">
                  ${U.raw(r.map((c) => h`<td class="mono">${c}</td>`).join(''))}
                </tr>`).join(''))}</tbody>
            </table>
            <div class="muted small mt-8">${text}</div>
          </div>`);
      case 'reference':
        return App.ui.Out(h`
          <div class="doc-ref" id="${b.id}-${lang}" data-refno="${b.refNo}">
            <span class="ref-no mono">[${b.refNo}]</span>
            <div class="grow">
              <div class="ref-text">${text}</div>
              ${b.local ? U.raw(h`<button class="btn btn-sm btn-ghost mt-8" data-action="open-ref-paper" data-id="${b.local}">库中已有原文 → 打开阅读</button>`) : ''}
            </div>
          </div>`);
      default: return App.ui.Out(h`<p class="doc-p">${text}</p>`);
    }
  }

  /** 图形块占位 SVG（演示：真实实现会显示从 PDF 抽取的位图） */
  function figureSvg(b) {
    if (b.id === 'appendix-p1') {
      return '<svg viewBox="0 0 520 130" width="100%"><g stroke="#4f6ef7" stroke-width="1.2" fill="none">' +
        Array.from({ length: 9 }, (_, i) => {
          const y1 = 16 + i * 13, y2 = 16 + ((i * 3 + 2) % 9) * 13;
          return '<path d="M60 ' + y1 + ' C 180 ' + y1 + ', 300 ' + y2 + ', 460 ' + y2 + '" opacity="' +
            (0.25 + (i % 4) * 0.2).toFixed(2) + '"/>';
        }).join('') +
        '<rect x="6" y="8" width="48" height="112" rx="6" fill="rgba(79,110,247,.12)" stroke="#4f6ef7"/>' +
        '<rect x="466" y="8" width="48" height="112" rx="6" fill="rgba(226,163,54,.14)" stroke="#e2a336"/>' +
        '<text x="30" y="68" font-size="10" fill="#b7bed2" text-anchor="middle">encoder</text>' +
        '<text x="490" y="68" font-size="10" fill="#b7bed2" text-anchor="middle">output</text></g></svg>';
    }
    // 默认：多头注意力架构示意
    return App.ui.Out('<svg viewBox="0 0 520 190" width="100%">' +
      '<g font-size="11" fill="#b7bed2">' +
      '<rect x="150" y="10" width="90" height="26" rx="6" fill="rgba(79,110,247,.18)" stroke="#4f6ef7"/><text x="195" y="27" text-anchor="middle">MatMul</text>' +
      '<rect x="150" y="46" width="90" height="26" rx="6" fill="rgba(79,110,247,.14)" stroke="#4f6ef7"/><text x="195" y="63" text-anchor="middle">SoftMax</text>' +
      '<rect x="150" y="82" width="90" height="26" rx="6" fill="rgba(79,110,247,.14)" stroke="#4f6ef7"/><text x="195" y="99" text-anchor="middle">Mask (opt.)</text>' +
      '<rect x="150" y="118" width="90" height="26" rx="6" fill="rgba(79,110,247,.14)" stroke="#4f6ef7"/><text x="195" y="135" text-anchor="middle">Scale</text>' +
      '<text x="18" y="27" fill="#8189a0">V</text><text x="18" y="99" fill="#8189a0">K</text><text x="18" y="135" fill="#8189a0">Q</text>' +
      '<path d="M34 22 H120 V138 H146" fill="none" stroke="rgba(255,255,255,.25)"/>' +
      '<path d="M34 95 H120 V138" fill="none" stroke="rgba(255,255,255,.25)"/>' +
      '<path d="M34 130 H146" fill="none" stroke="rgba(255,255,255,.25)"/>' +
      '<path d="M195 36 V44" stroke="rgba(255,255,255,.3)"/><path d="M195 72 V80" stroke="rgba(255,255,255,.3)"/>' +
      '<path d="M195 108 V116" stroke="rgba(255,255,255,.3)"/><path d="M195 144 V160" stroke="rgba(255,255,255,.3)"/>' +
      '<text x="195" y="178" text-anchor="middle" fill="#eef1f8">Attention(Q,K,V)</text>' +
      '<text x="330" y="24" fill="#8189a0">Linear</text><text x="330" y="52" fill="#8189a0">Concat</text>' +
      '<text x="330" y="80" fill="#8189a0">Scaled Dot-Product</text><text x="330" y="108" fill="#8189a0">h = 8 heads</text>' +
      '</g></svg>');
  }

  /** 论文没有演示正文时的占位内容 */
  function placeholderDoc(paper) {
    return App.ui.Out(h`
      <div class="notice info mb-16">
        <span>ℹ</span>
        <div>
          本演示只为《Attention Is All You Need》内置了完整正文与译文。
          当前论文《${paper.title}》的正文已入库，但未附带演示排版，因此这里展示解析结果摘要。
        </div>
      </div>
      <h2 class="doc-h2">Abstract</h2>
      <p class="doc-p">${paper.abstract}</p>
      <h2 class="doc-h2">摘要</h2>
      <p class="doc-p">${paper.abstractZh || '（暂无译文）'}</p>
      <h2 class="doc-h2">解析统计</h2>
      <div class="doc-table">
        <table class="table">
          <thead><tr><th>项目</th><th>数量</th></tr></thead>
          <tbody>
            <tr><td>页数</td><td class="mono">${paper.pages}</td></tr>
            <tr><td>章节（含子标题）</td><td class="mono">${paper.sections}</td></tr>
            <tr><td>表格 / 图表</td><td class="mono">${paper.tables} / ${paper.figures}</td></tr>
            <tr><td>公式</td><td class="mono">${paper.formulas}</td></tr>
            <tr><td>参考文献</td><td class="mono">${paper.refs}</td></tr>
          </tbody>
        </table>
      </div>`);
  }

  /* ==========================================================================
     5. 阅读器交互绑定
     ========================================================================== */
  function bindReader(el, doc, paper) {
    const en = U.$('#body-en', el);
    const zh = U.$('#body-zh', el);
    const outline = U.$('#outline', el);

    /* ---- 5.1 中英同步滚动 ---- */
    if (en && zh && App.store.state.reader.syncScroll) {
      const sync = (from, to) => {
        from.addEventListener('scroll', () => {
          if (syncing) return;
          syncing = true;
          const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
          to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight);
          requestAnimationFrame(() => { syncing = false; });
        });
      };
      sync(en, zh);
      sync(zh, en);
    }

    /* ---- 5.2 大纲高亮跟随滚动 ---- */
    if (outline && en) {
      const marks = U.$$('.doc-h1, .doc-h2, .doc-h3', en);
      const onScroll = U.debounce(() => {
        let cur = null;
        marks.forEach((m) => {
          if (m.getBoundingClientRect().top < 140) cur = m.id.replace(/-en$/, '');
        });
        U.$$('.toc-item', outline).forEach((b) =>
          b.classList.toggle('active', b.dataset.id === cur));
      }, 80);
      en.addEventListener('scroll', onScroll);
      onScroll();
    }

    /* ---- 5.3 缩放 ---- */
    el.style.setProperty('--reader-zoom', App.store.state.reader.scale);
  }

  function showSelPop(pop, text, sel) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    pop.classList.remove('hidden');
    pop.innerHTML = h`
      <div class="row gap-8 mb-8">
        <span class="badge badge-brand">划词翻译</span>
        <span class="muted tiny">${text.length} 字符</span>
      </div>
      <div class="muted small mb-8" style="max-width:280px">${U.clip(text, 120)}</div>
      <div class="row gap-4">
        <button class="btn btn-sm btn-primary" data-action="translate-selection">翻译为中文</button>
        <button class="btn btn-sm btn-ghost" data-action="copy-text">复制</button>
      </div>`;
    pop.style.left = Math.min(window.innerWidth - 320, Math.max(12, rect.left - 60)) + 'px';
    pop.style.top = (rect.bottom + 8 + window.scrollY) + 'px';
    App.store.set({
      reader: Object.assign({}, App.store.state.reader, { selection: { text: text } }),
    }, 'reader');
    window.__selection_rect = rect;
  }

  /* ==========================================================================
     6. 由 app.js 的动作表调用
     ========================================================================== */
  function scrollToAnchor(id) {
    const en = U.$('#body-en');
    const target = en && (U.$('#' + id + '-en') || U.$('[id^="' + id + '"]', en));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToRef(n) {
    const en = U.$('#body-en');
    if (!en) return;
    // 记住当前位置，方便「跳回原位」
    lastCiteScroll = en.scrollTop;
    const target = U.$('[data-refno="' + n + '"]', en);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1600);
      // 在参考文献处放一个「跳回原位」按钮
      let back = U.$('.back-to-cite');
      if (back) back.remove();
      back = document.createElement('button');
      back.className = 'btn btn-sm btn-primary back-to-cite';
      back.textContent = '↩ 跳回原文引用位置';
      back.addEventListener('click', () => {
        en.scrollTo({ top: lastCiteScroll || 0, behavior: 'smooth' });
        back.remove();
      });
      const container = U.$('#body-en') || en;
      container.appendChild(back);
    } else {
      App.ui.toast('当前论文未抽取到编号 [' + n + '] 的参考文献', 'warn');
    }
  }

  /** 打开该论文的解析详情抽屉 */
  function gotoPublication(paperId) {
    App.store.actions.drawer('parse', { paperId: paperId || App.store.state.currentPaperId });
  }

  /** 划词翻译：把选中英文译为中文并弹窗展示 */
  function translateSelection() {
    const sel = App.store.state.reader.selection;
    if (!sel) return;
    // 演示：内置少量术语翻译 + 通用提示
    const glossary = {
      'residual connection': '残差连接', 'layer normalization': '层归一化',
      'multi-head attention': '多头注意力', 'scaled dot-product attention': '缩放点积注意力',
      'self-attention': '自注意力', 'positional encoding': '位置编码',
      'feed-forward network': '前馈网络', 'attention': '注意力', 'encoder': '编码器',
      'decoder': '解码器', 'embedding': '词嵌入', 'softmax': 'softmax（不变）',
      'dropout': '随机失活', 'hyperparameter': '超参数', 'baseline': '基线',
    };
    let zh = sel.text;
    Object.keys(glossary).forEach((k) => {
      const re = new RegExp(k, 'gi');
      zh = zh.replace(re, glossary[k]);
    });
    if (zh === sel.text) zh = '【机器翻译】' + sel.text + '（演示环境仅展示术语替换结果，真实实现会调用翻译模型）';

    App.ui.openModal(h`
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">划词翻译</div>
          <div class="spacer"></div>
          <button class="btn btn-sm btn-ghost" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="muted tiny mb-8">原文</div>
          <div class="abstract-en mb-16">${sel.text}</div>
          <div class="muted tiny mb-8">译文</div>
          <div class="abstract-zh">${zh}</div>
          <div class="notice info mt-16">
            <span>ℹ</span>
            <div>划词翻译对应需求 1.3.3.1；也支持整段选中翻译与鼠标悬停翻译（悬停需接入术语库以避免误触）。</div>
          </div>
        </div>
      </div>`);
    App.store.set({ reader: Object.assign({}, App.store.state.reader, { selection: null }) }, 'reader');
    const pop = U.$('#selpop');
    if (pop) pop.classList.add('hidden');
  }

  /** 复制选中的文本 */
  function copy(el) {
    const sel = App.store.state.reader.selection;
    if (!sel) return;
    if (navigator.clipboard) navigator.clipboard.writeText(sel.text);
    App.ui.toast('已复制到剪贴板', 'ok');
  }

  App.views = App.views || {};
  // applyFocusEvidence 额外导出，便于冒烟测试直接验证「定位到段落」的逻辑
  // （测试用的极简 DOM 会丢掉段落纯文本，走整页渲染没法稳定断言）
  App.views.reader = {
    render, toolbar, scrollToAnchor, scrollToRef, gotoPublication,
    translateSelection, copy, applyFocusEvidence,
  };
})(window.App);
