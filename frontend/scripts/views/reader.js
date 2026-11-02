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

  /* ---- 参考文献视图状态 ----
   * 为什么放在模块里而不是 store：
   *   它只是某篇论文的渲染数据，跨页面没有意义；
   *   放进 store 会让"状态快照 / 回滚 / 测试复位"都要照顾它，得不偿失。
   * paperId 用来判断缓存是否属于当前论文，避免 A 论文的参考文献渲染到 B 上。
   */
  const refState = {
    paperId: null,     // 缓存属于哪篇论文
    report: null,      // 接口返回的 ReferenceListOut
    loading: false,    // 是否正在请求
    error: null,       // 请求失败的原因（给用户看）
  };
  /** 每条参考文献「跳到正文」的游标：多次点击依次跳到第 1、2、3…处 */
  const citingCursor = {};

  /**
   * 当前划词选中的文本（只在内存里，不进 store）。
   *
   * 为什么不放 state：写 state 会 notify → 阅读器整页重绘，
   * 滚动位置回到顶部、浏览器选区丢失。划词这种"高频、瞬时"的交互
   * 不适合走全局状态，放模块变量最稳。
   */
  let pendingSelection = null;

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

    // 重绘前记住滚动位置：翻译进度、参考文献加载等都会触发 notify → 重绘，
    // 若不还原，读者每翻一页就会被拽回文首（实测很影响阅读体验）。
    // 只在同一篇论文内还原；切换论文时应该从顶部开始。
    const prevBody = U.$('#body-en');
    const prevScroll = prevBody ? prevBody.scrollTop : 0;
    const prevPaper = el.dataset.paperId || '';

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
            ${U.raw(refsHtml(paperId))}
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

    // 还原滚动位置（同一篇论文内）；切换论文时从头开始
    if (prevPaper === paperId && prevScroll > 0) {
      const nextBody = U.$('#body-en', el);
      if (nextBody) nextBody.scrollTop = prevScroll;
    }
    el.dataset.paperId = paperId;

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
      App.store.actions.clearFocusEvidence(true);
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
      App.store.actions.clearFocusEvidence(true);
      return;
    }

    hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
    hit.classList.remove('blk-flash');
    void hit.offsetWidth;
    hit.classList.add('blk-flash');
    // 同时把该段所在的小节标题标出来，长文里更容易定位
    setTimeout(() => hit.classList.remove('blk-flash'), 1800);

    const page = focus.page ? '第 ' + focus.page + ' 页' : '';
    const sec = focus.section && focus.section !== '正文' ? focus.section : '';
    App.ui.toast('已定位到原文' + (page || sec ? '：' + [page, sec].filter(Boolean).join(' · ') : ''),
      'ok', 2400);
    // silent：只消费掉请求，不触发重绘。
    // 若这里 notify，阅读器会重建整篇正文的 DOM，刚加的高亮类和滚动位置会一起消失
    // —— 表现正是「toast 出来了但没有高亮」（真实反馈过）。
    App.store.actions.clearFocusEvidence(true);
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
      <button class="btn btn-sm btn-ghost" data-action="export-md" title="把当前论文导出为 Markdown（含元信息、正文、参考文献）">导出 MD</button>
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

  /**
   * 把正文里出现的 [n] 就地替换成可点击角标。
   *
   * 为什么不在段尾追加：真实论文的文字里本来就有 [12]，
   * 再在末尾追加一份就成了双重显示（用户会以为段尾那几个是额外引用）。
   * 只有「文本里完全没有 [n]」的演示数据，才走 citeSpans 的追加逻辑。
   *
   * 入参必须是**已转义**的文本（先 esc 再替换），
   * 否则正文里的 < > 会破坏 HTML 结构。
   */
  function inlineCites(escapedText) {
    return String(escapedText || '').replace(/\[([0-9,，\-–—\s]+)\]/g, (whole, group) => {
      const digits = group.split(/[,，]/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
      // [图 3]、[3-5] 这类不是单条文献编号，原样保留，避免误转
      if (!digits.length) return whole;
      const spans = digits.map((n) =>
        h`<span class="cite" data-action="jump-cite" data-cite="${n}" title="跳转到参考文献 [${n}]">${n}</span>`
      ).join(', ');
      return '[' + spans + ']';
    });
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
      case 'p': {
        const safe = U.esc(text).replace(/\n/g, '<br/>');
        // 文字里自带 [n] → 就地转成角标，不再追加角标簇
        const hasInline = /\[[0-9,，\-–—\s]+\]/.test(String(text || ''));
        const body = hasInline ? inlineCites(safe) : safe;
        const extra = hasInline ? '' : cites;
        return App.ui.Out(h`<p class="doc-p" data-page="${b.page || 1}" id="${b.id}-${lang}">${U.raw(body)}${U.raw(extra)}</p>`);
      }
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

  /**
   * 显示划词浮层。
   *
   * 重要：这里**不能写 store**。
   * 早先的实现把选中文本写进 `state.reader.selection`，而 App.store.set()
   * 会 notify('reader') → 阅读器整页重绘，带来两个副作用：
   *   1. #body-en 的 innerHTML 被重建 → 滚动位置回到顶部（用户以为"跳回第一页"）；
   *   2. 浏览器原生的文本选区随 DOM 一起失效 → 选中状态消失。
   * 所以选中文本只放在模块变量里，等用户点「翻译为中文」时再取用。
   */
  function showSelPop(pop, text, sel) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();

    // 只记在内存里，不触发重绘（保持滚动位置与选区）
    pendingSelection = { text: text };

    const fresh = pop || U.$('#selpop');
    if (!fresh) return;

    fresh.innerHTML = h`
      <div class="row gap-8 mb-8">
        <span class="badge badge-brand">划词翻译</span>
        <span class="muted tiny">${text.length} 字符</span>
      </div>
      <div class="muted small mb-8" style="max-width:280px">${U.clip(text, 120)}</div>
      <div class="row gap-4">
        <button class="btn btn-sm btn-primary" data-action="translate-selection">翻译为中文</button>
        <button class="btn btn-sm btn-ghost" data-action="copy-text">复制</button>
      </div>`;

    // 定位后显示（fixed 定位，不需要加 scrollY）
    fresh.style.left = Math.min(window.innerWidth - 320, Math.max(12, rect.left - 60)) + 'px';
    fresh.style.top = (rect.bottom + 8) + 'px';
    fresh.classList.remove('hidden');

    window.__selection_rect = rect;
  }

  /* ==========================================================================
     5.3.1 导出 Markdown
     --------------------------------------------------------------------------
     纯前端实现：把当前论文拼成 Markdown 文本，再用 Blob 下载，不经过服务器。
     为什么不做后端导出：内容全在页面上，前端拼装零网络开销、也不需要新增接口。
     ========================================================================== */
  function exportMarkdown() {
    const st = App.store.state;
    const paperId = st.currentPaperId || st.routeParams.paperId;
    const paper = paperId ? App.data.getPaper(paperId) : null;
    if (!paper) { App.ui.toast('请先打开一篇论文', 'warn'); return; }

    const doc = App.data.getDoc(paperId);
    const lines = [];

    // ---- 标题与元信息表 ----
    lines.push('# ' + (paper.title || paper.fileName || '论文'), '');
    lines.push('| 项 | 内容 |', '| --- | --- |');
    lines.push('| 作者 | ' + (paper.authors && paper.authors.length ? paper.authors.join(', ') : '—') + ' |');
    lines.push('| 年份 | ' + (paper.year || '—') + ' |');
    lines.push('| 会议 / 期刊 | ' + (paper.venue || '—') + ' |');
    if (paper.arxiv) lines.push('| arXiv | ' + paper.arxiv + ' |');
    lines.push('| 页数 | ' + (paper.pages || '—') + ' |');
    lines.push('| 解析置信度 | ' + (typeof paper.quality === 'number' ? U.pct(paper.quality, 0) : '—') + ' |');
    lines.push('', '> 由「科研小助手 Agent」导出 · ' + new Date().toISOString().slice(0, 10), '');

    // ---- 正文 ----
    if (doc && doc.blocks && doc.blocks.length) {
      doc.blocks.forEach((b) => {
        const text = String(b.en || '').trim();
        if (!text) return;
        switch (b.type) {
          case 'h1': lines.push('', '# ' + text, ''); break;
          case 'h2': lines.push('', '## ' + text, ''); break;
          case 'h3': lines.push('', '### ' + text, ''); break;
          case 'list':
            text.split('\n').forEach((l) => {
              const item = l.replace(/^•\s*/, '').trim();
              if (item) lines.push('- ' + item);
            });
            lines.push('');
            break;
          case 'formula':
            lines.push('```text', text, '```', '');
            break;
          case 'reference':
            lines.push('[' + (b.refNo || '?') + '] ' + text);
            break;
          default:
            lines.push(text, '');
        }
      });
    } else {
      lines.push('（正文尚未解析，或该论文只有演示数据）');
    }

    // ---- 参考文献（若已加载，附带被引次数） ----
    const report = refState.paperId === paperId ? refState.report : null;
    if (report && report.items && report.items.length) {
      lines.push('', '---', '', '## 参考文献', '');
      report.items.forEach((it) => {
        lines.push('- **[' + it.ref_no + ']** ' + (it.text || '（原文缺失）'));
        const sub = ['被正文引用 ' + it.cited_count + ' 段'];
        if (it.arxiv_id) sub.push('arXiv:' + it.arxiv_id);
        lines.push('  <sub>' + sub.join(' · ') + '</sub>');
      });
      if (report.note) lines.push('', '> ' + report.note);
    }

    const name = U.safeFileName(paper.title || paper.fileName || 'paper') + '.md';
    U.download(name, lines.join('\n'), 'text/markdown;charset=utf-8');
    App.ui.toast('已导出 ' + name, 'ok', 2400);
  }
  /* ==========================================================================
     5.4 参考文献（双向跳转）
     --------------------------------------------------------------------------
     两个方向：
       正文角标 [n]  →  跳到文末参考文献第 n 条
       参考文献第 n 条 →  跳到正文里引用它的段落（多处可循环）
     ========================================================================== */

  /** 按编号取一条参考文献，取不到返回 null */
  function findRef(n) {
    const items = (refState.report && refState.report.items) || [];
    return items.find((it) => it.ref_no === n) || null;
  }

  /**
   * 拉取参考文献（同一篇论文只拉一次）。
   *
   * 为什么成功后要 notify：列表是渲染时拼进 DOM 的，
   * 请求回来时必须让阅读器重绘一次才能显示出来。
   * 失败也要 notify，否则界面会永远停在「正在载入…」。
   */
  function ensureReferences(paperId) {
    if (!paperId || refState.loading) return;
    if (refState.paperId === paperId && refState.report) return;

    // 离线模式（或测试环境未加载 api.js）时 App.api 不存在。
    // 这里必须兜住：否则一进阅读器就抛异常，整页渲染直接中断。
    if (!App.api || typeof App.api.references !== 'function') {
      refState.loading = false;
      refState.paperId = null;
      refState.report = null;
      refState.error = '离线模式：未连接后端，无法加载参考文献';
      return;
    }

    refState.loading = true;
    refState.error = null;
    refState.paperId = paperId;

    App.api.references(paperId)
      .then((report) => {
        refState.report = report;
        refState.loading = false;
        App.store.notify('reader');
      })
      .catch((err) => {
        refState.loading = false;
        refState.report = null;
        refState.error = err.message || '请求失败';
        App.store.notify('reader');
      });
  }

  /** 清掉失败状态并重新请求（重试按钮调用） */
  function retryReferences() {
    refState.report = null;
    refState.error = null;
    refState.loading = false;
    refState.paperId = null;
    App.store.notify('reader');   // 触发重绘，refsHtml 会重新发起请求
  }
  /** 一条参考文献的 HTML */
  function refItemHtml(it) {
    const meta = [it.cited_count ? `被正文引用 ${it.cited_count} 段` : '正文未引用'];
    if (it.match_method === 'arxiv') meta.push('按 arXiv 编号匹配');
    else if (it.match_method === 'title') meta.push('按标题匹配');
    else meta.push('未匹配到库内论文');
    if (it.arxiv_id) meta.push('arXiv:' + it.arxiv_id);

    return h`
      <div class="doc-ref" id="ref-${it.ref_no}" data-ref-no="${it.ref_no}">
        <span class="ref-no mono">[${it.ref_no}]</span>
        <div class="grow" style="min-width:0">
          <div class="ref-text">${it.text || '（原文缺失）'}</div>
          <div class="muted tiny mt-8">${meta.join(' · ')}</div>
        </div>
        ${it.cited_count
          ? U.raw(h`<button class="btn btn-sm btn-ghost" data-action="jump-citing"
                      data-ref="${it.ref_no}">跳到正文</button>`)
          : ''}
      </div>`;
  }

  /** 正文末尾的参考文献区块（首次进入时先给占位，避免布局跳动） */
  function refsHtml(paperId) {
    if (!paperId) return '';

    const stale = refState.paperId !== paperId;
    if (stale || (!refState.report && !refState.error)) {
      ensureReferences(paperId);
    }

    // 先处理失败：否则离线/出错时会一直停在「正在载入…」
    if (refState.error) {
      return h`
        <section class="refs-block" id="refs-block">
          <div class="refs-head">
            <span class="refs-title">参考文献</span>
            <span class="muted tiny">${refState.error}</span>
            <div class="spacer"></div>
            <button class="btn btn-sm btn-ghost" data-action="reload-refs">重试</button>
          </div>
        </section>`;
    }

    // 缓存还不属于当前论文（首次进入 / 刚切换论文）：先渲染骨架
    if (stale || (!refState.report && !refState.error)) {
      return h`
        <section class="refs-block" id="refs-block">
          <div class="refs-head">
            <span class="refs-title">参考文献</span>
            <span class="muted tiny">正在载入…</span>
          </div>
        </section>`;
    }

    const report = refState.report;
    const items = report.items || [];
    if (!items.length) {
      return h`
        <section class="refs-block" id="refs-block">
          <div class="refs-head">
            <span class="refs-title">参考文献</span>
            <span class="muted tiny">这篇论文没有解析出参考文献</span>
          </div>
        </section>`;
    }

    const note = report.note
      ? U.raw(h`<div class="notice info mb-12"><span>ℹ</span><div>${report.note}</div></div>`)
      : '';

    return h`
      <section class="refs-block" id="refs-block">
        <div class="refs-head">
          <span class="refs-title">参考文献</span>
          <span class="muted tiny">共 ${report.total} 条 · 被正文引用 ${report.cited_total} 条</span>
        </div>
        ${note}
        ${U.raw(items.map((it) => refItemHtml(it)).join(''))}
      </section>`;
  }

  /**
   * 从参考文献跳到正文里引用它的段落。
   *
   * 「多处引用」用游标轮转：连点「跳到正文」依次走第 1、2、3 处，
   * 走到底回到第 1 处 —— 比给每条挂一排小圆点更省地方。
   */
  function jumpToCiting(n) {
    const item = findRef(n);
    if (!item) {
      App.ui.toast('参考文献还没加载好，请稍候', 'warn', 2000);
      return;
    }
    if (!item.cited_in || !item.cited_in.length) {
      App.ui.toast('这条参考文献在正文里没有被引用', 'warn', 2200);
      return;
    }

    const total = item.cited_in.length;
    const idx = (citingCursor[n] || 0) % total;
    citingCursor[n] = (idx + 1) % total;

    const chunk = item.cited_in[idx];
    const box = U.$('#body-en');
    const target = box && (U.$('#b' + chunk + '-en', box) || U.$('#b' + chunk + '-zh', box));
    if (!target) {
      App.ui.toast('正文里找不到第 ' + chunk + ' 段（可能未渲染）', 'warn', 2400);
      return;
    }

    lastCiteScroll = box.scrollTop;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('blk-flash');
    void target.offsetWidth;
    target.classList.add('blk-flash');
    setTimeout(() => target.classList.remove('blk-flash'), 2000);

    U.$$('.ref-back-bar').forEach((b) => b.remove());
    const bar = document.createElement('div');
    bar.className = 'ref-back-bar';

    const back = document.createElement('button');
    back.className = 'btn btn-sm btn-primary';
    back.textContent = '↩ 回到参考文献 [' + n + ']';
    back.addEventListener('click', () => { scrollToRef(n); bar.remove(); });
    bar.appendChild(back);

    if (total > 1) {
      const next = document.createElement('button');
      next.className = 'btn btn-sm btn-ghost';
      next.textContent = '下一处（' + (idx + 2 > total ? 1 : idx + 2) + '/' + total + '）';
      next.addEventListener('click', () => { bar.remove(); jumpToCiting(n); });
      bar.appendChild(next);
    }

    box.appendChild(bar);
    App.ui.toast('已跳到正文第 ' + (idx + 1) + '/' + total + ' 处引用', 'ok', 1500);
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

    const target = U.$('#ref-' + n, en) || U.$('[data-refno="' + n + '"]', en);
    if (!target) {
      // 区分三种「找不到」，给用户的提示完全不同
      if (refState.loading || !refState.report) {
        App.ui.toast('参考文献正在载入，请稍候再点', 'warn', 2000);
        ensureReferences(App.store.state.currentPaperId);
      } else if (refState.report && (refState.report.items || []).length) {
        App.ui.toast('参考文献里没有编号 [' + n + ']（正文引用了未列出的文献）', 'warn', 2600);
      } else {
        App.ui.toast('这篇论文没有解析出参考文献', 'warn', 2400);
      }
      return;
    }

    // 记住当前位置，方便「跳回原位」
    lastCiteScroll = en.scrollTop;
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
    en.appendChild(back);
  }

  /** 打开该论文的解析详情抽屉 */
  function gotoPublication(paperId) {
    App.store.actions.drawer('parse', { paperId: paperId || App.store.state.currentPaperId });
  }

    /**
   * 划词翻译：把选中的英文译为中文。
   *   现在调后端 POST /translate（direction=en2zh），术语与句式由模型处理
   *   弹窗先开、译文后填 —— 网络往返 1~3 秒，不让用户盯着空窗
   *   失败时退回本地术语表，并在弹窗里标「降级」
   */
  async function translateSelection() {
    // 优先用内存里的本次划词；测试用例直接写 store，保留回退
    const sel = pendingSelection || App.store.state.reader.selection;
    if (!sel) return;
    const text = sel.text;
    pendingSelection = null;

    // 先把弹窗打开，译文位置放「翻译中」，这样点击立刻有反馈
    const modal = App.ui.openModal(h`
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">划词翻译</div>
          <div class="spacer"></div>
          <span class="badge badge-outline" id="sel-badge">翻译中…</span>
          <button class="btn btn-sm btn-ghost" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="muted tiny mb-8">原文</div>
          <div class="abstract-en mb-16">${sel.text}</div>
          <div class="muted tiny mb-8">译文</div>
          <div class="abstract-zh" id="sel-zh">
            <span class="dots"><i></i><i></i><i></i></span>
          </div>
          <div class="row gap-8 mt-16">
            <button class="btn btn-sm btn-ghost" id="sel-copy">复制译文</button>
          </div>
          <div class="notice info mt-16">
            <span>ℹ</span>
            <div>对应需求 1.3.3.1：划词翻译。英译中走服务端模型；未配置 Key 或断网时退回本地术语表。</div>
          </div>
        </div>
      </div>`);

    // 只收起浮层，**不写 store**：
    // 写 store 会触发整页重绘，滚动位置回到顶部、浏览器选区丢失。
    // 用户要求"选中后保持选中状态"，所以这里什么状态都不动。
    const pop = U.$('#selpop');
    if (pop) pop.classList.add('hidden');

    const out = U.$('#sel-zh', modal.mask);
    const badge = U.$('#sel-badge', modal.mask);
    const copyBtn = U.$('#sel-copy', modal.mask);

    try {
      const res = await App.api.translateText(text, 'en2zh');
      if (out) out.textContent = res.text || '';
      if (badge) {
        badge.textContent = res.cached ? '模型翻译 · 缓存' : '模型翻译';
        badge.className = 'badge badge-brand';
      }
    } catch (err) {
      // 降级：本地术语表替换，保证功能可用，同时如实告知
      const fallback = localGlossaryTranslate(text);
      if (out) out.textContent = fallback;
      if (badge) {
        badge.textContent = '本地术语表（降级）';
        badge.className = 'badge badge-warn';
      }
      App.ui.toast('模型翻译不可用（' + err.message + '），已退回本地术语表', 'warn', 4000);
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const now = out && out.textContent ? out.textContent : '';
        if (!now) return;
        if (navigator.clipboard) navigator.clipboard.writeText(now);
        App.ui.toast('译文已复制', 'ok');
      });
    }
  }

  /**
   * 本地术语表翻译（降级用）。
   *
   * 注意：它只是逐词替换，**不是翻译**。保留它有两个原因：
   *   1. 断网演示时页面不至于空白；
   *   2. 单元测试可以在没有网络的情况下验证弹窗渲染。
   * 界面上必须标「降级」，否则就是骗用户。
   */
  function localGlossaryTranslate(text) {
    const glossary = {
      'residual connection': '残差连接', 'layer normalization': '层归一化',
      'multi-head attention': '多头注意力', 'scaled dot-product attention': '缩放点积注意力',
      'self-attention': '自注意力', 'positional encoding': '位置编码',
      'feed-forward network': '前馈网络', 'attention': '注意力', 'encoder': '编码器',
      'decoder': '解码器', 'embedding': '词嵌入', 'softmax': 'softmax（不变）',
      'dropout': '随机失活', 'hyperparameter': '超参数', 'baseline': '基线',
    };
    let zh = String(text || '');
    Object.keys(glossary).forEach((k) => {
      zh = zh.replace(new RegExp(k, 'gi'), glossary[k]);
    });
    if (zh === text) zh = '（未命中术语表，且模型不可用，暂无法翻译这段文本）';
    return zh;
  }

  /** 复制选中的文本 */
  function copy(el) {
    // 与 translateSelection 同源：优先内存里的本次划词，测试写 store 时回退
    const sel = pendingSelection || App.store.state.reader.selection;
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
    jumpToCiting, retryReferences, exportMarkdown,
  };
})(window.App);
