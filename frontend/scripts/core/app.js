/* ============================================================================
   app.js — 应用入口：视图注册、路由、外壳渲染
   ----------------------------------------------------------------------------
   渲染流程（单向数据流）：
     store 状态变更 → notify → render() → 顶栏 + 侧边栏 + 当前视图重绘
   新增一个页面只需要两步：
     ① 写一个 render(el) 函数（放 scripts/views/xxx.js）
     ② 在下面的 VIEWS 表里注册：{ id, title, icon, group, view }
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  /* ==========================================================================
     1. 视图注册表
        group 决定它出现在侧边栏的哪个分组；icon 用 emoji 保持零依赖。
     ========================================================================== */
  const VIEWS = [
    {
      id: 'dashboard', title: '工作台', icon: '◎', group: '总览',
      subtitle: '文库概况、解析质量与快捷入口',
      view: () => App.views.dashboard,
    },
    {
      id: 'library', title: '文库', icon: '▤', group: '论文管理',
      subtitle: '上传、解析、去重与元数据管理',
      badge: () => App.store.state.papers.length,
      view: () => App.views.library,
    },
    {
      id: 'reader', title: '阅读器', icon: '❐', group: '论文管理',
      subtitle: '结构化阅读 · 中英对照 · 引文跳转',
      view: () => App.views.reader,
    },
    {
      id: 'qa', title: '知识问答', icon: '✦', group: '智能分析',
      subtitle: '单篇 / 多篇论文问答，回答均带原文出处',
      view: () => App.views.qa,
    },
    {
      id: 'graph', title: '引用图谱', icon: '⬡', group: '智能分析',
      subtitle: '引文网络、核心节点挖掘与自动综述',
      view: () => App.views.graph,
    },
    {
      id: 'discover', title: '发现与推荐', icon: '☄', group: '智能分析',
      subtitle: '最新论文抓取、相关性推荐与用户反馈',
      badge: () => App.data.recommendations.filter((r) => r.kind === 'daily').length,
      view: () => App.views.discover,
    },
    {
      id: 'writing', title: '写作助手', icon: '✎', group: '创作工具',
      subtitle: '框架生成、架构图代码、数据可视化与翻译',
      view: () => App.views.writing,
    },
    {
      id: 'guide', title: '说明 / 对照表', icon: '؟', group: '创作工具',
      subtitle: '需求 → 页面元素的一一对应关系',
      view: () => App.views.guide,
    },
  ];

  const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];

  /* ==========================================================================
     2. 外壳渲染
     ========================================================================== */
  let shellEls = null;

  function buildShell() {
    const root = U.$('#app');
    root.innerHTML = h`
      <div class="app">
        <aside class="sidebar">
          <div class="brand">
            <div class="brand-logo">科</div>
            <div class="col" style="line-height:1.2">
              <span class="brand-name">科研小助手</span>
              <span class="brand-sub">Research Agent</span>
            </div>
          </div>
          <nav class="nav" id="nav"></nav>
          <div class="side-foot">
            <div class="side-status">
              <span class="dot pulse"></span>
              <div class="col" style="line-height:1.3">
                <span>本地模型已就绪</span>
                <span class="muted tiny">DeepSeek-V3 · 671B MoE</span>
              </div>
            </div>
          </div>
        </aside>
        <div class="main">
          <header class="topbar" id="topbar"></header>
          <main class="view" id="view"></main>
        </div>
      </div>`;

    shellEls = {
      nav: U.$('#nav', root),
      topbar: U.$('#topbar', root),
      view: U.$('#view', root),
    };

    // 侧边栏使用事件委托，避免每次重绘都重新绑定
    U.delegate(shellEls.nav, 'click', '[data-route]', (e, el) => {
      App.store.actions.go(el.dataset.route);
    });
    // 顶栏上的返回等按钮
    U.delegate(shellEls.topbar, 'click', '[data-action]', (e, el) => {
      handleAction(el.dataset.action, el.dataset, el);
    });
    // 视图内统一的事件委托（各视图只需渲染 HTML，交互在这里分发）
    U.delegate(shellEls.view, 'click', '[data-action]', (e, el) => {
      handleAction(el.dataset.action, el.dataset, el);
    });
    U.delegate(shellEls.view, 'input', '[data-bind]', (e, el) => {
      App.store.actions.setIdea ? null : null;
      if (el.dataset.bind === 'idea') App.store.actions.setIdea(el.value);
      if (el.dataset.bind === 'search') App.store.set({ search: el.value }, 'search');
    });
    U.delegate(shellEls.view, 'change', '[data-bind]', (e, el) => {
      if (el.dataset.bind === 'topk') App.store.actions.setTopK(parseInt(el.value, 10));
      if (el.dataset.bind === 'chart-col') App.views.writing.setChartCol(el.value);
    });
  }

  /* ==========================================================================
     3. 事件动作表
        所有 data-action="xxx" 的点击都会路由到这里，方便统一查看/维护。
     ========================================================================== */
  function handleAction(action, data, el) {
    const S = App.store.actions;
    switch (action) {
      /* ---- 全局 ---- */
      case 'go': S.go(data.route, data); break;
      case 'open-paper': S.openPaper(data.id); break;

      /* ---- 文库：上传 / 去重 ---- */
      case 'pick-files': App.views.library.pickFiles(); break;
      case 'resolve-overwrite': S.resolveOverwrite(data.id); App.ui.toast('已用新版本覆盖文库版本', 'ok'); break;
      case 'resolve-keep': S.resolveKeep(data.id); App.ui.toast('已保留文库中的较新版本', 'ok'); break;
      case 'resolve-keep-both': S.resolveKeepBoth(data.id); App.ui.toast('两个版本均已入库', 'ok'); break;
      case 'show-diff': App.views.library.showDiff(data.id); break;
      case 'remove-upload': S.removeUpload(data.id); break;

      /* ---- 文库：行操作 ---- */
      case 'star': S.toggleStar(data.id); break;
      case 'reparse': S.reparse(data.id); break;
      case 'delete-paper': App.views.library.confirmDelete(data.id); break;
      case 'meta': App.ui.drawer('meta', { paperId: data.id }); break;
      case 'close-drawer': App.ui.drawer(null); break;
      case 'parse-detail': App.ui.drawer('parse', { paperId: data.id }); break;
      case 'back-to-list': S.go('library'); break;

      /* ---- 阅读器 ---- */
      case 'reader-mode': S.setReaderMode(data.mode); break;
      case 'reader-zoom': S.setReaderScale(parseFloat(data.scale)); break;
      case 'toggle-sync': S.toggleSyncScroll(); break;
      case 'jump-cite': S.jumpCite(parseInt(data.cite, 10)); App.views.reader.scrollToRef(parseInt(data.cite, 10)); break;
      case 'goto-anchor': S.gotoAnchor(data.id); App.views.reader.scrollToAnchor(data.id); break;
      case 'goto-publication': App.views.reader.gotoPublication(data.id); break;
      case 'open-ref-paper': S.openPaper(data.id); break;
      case 'translate-selection': App.views.reader.translateSelection(); break;
      case 'clear-selection': App.store.set({ reader: Object.assign({}, App.store.state.reader, { selection: null }) }, 'reader'); break;
      case 'copy-text': App.views.reader.copy(el); break;

      /* ---- 问答 ---- */
      case 'qa-scope': S.setQaScope(data.scope); break;
      case 'qa-toggle-paper': S.toggleQaPaper(data.id); break;
      case 'qa-ask-preset': App.views.qa.ask(data.q); break;
      case 'qa-send': App.views.qa.sendFromInput(); break;
      case 'qa-new-chat': S.newChat(); break;
      case 'qa-open-chat': App.store.set({ activeChatId: data.id }, 'chats'); break;
      case 'qa-toggle-evidence': S.toggleEvidence(); break;
      case 'qa-cite': App.views.qa.jumpEvidence(parseInt(data.cite, 10)); break;

      /* ---- 图谱 ---- */
      case 'graph-select': S.selectNode(data.id); break;
      case 'graph-layout': S.setGraphLayout(data.layout); break;
      case 'graph-toggle-core': S.toggleCoreHighlight(); break;
      case 'graph-open-paper': S.openPaper(data.id); break;

      /* ---- 推荐 ---- */
      case 'discover-tab': S.setDiscoverTab(data.tab); break;
      case 'vote-up': S.vote(data.id, 'up'); break;
      case 'vote-down': S.vote(data.id, 'down'); break;

      /* ---- 写作助手 ---- */
      case 'writing-tab': S.setWritingTab(data.tab); break;
      case 'gen-outline': App.views.writing.generate(); break;
      case 'load-csv-demo': App.views.writing.loadDemoCsv(); break;
      case 'export-doc': App.ui.toast('已导出为 Markdown（演示）', 'ok'); break;
      case 'copy-code': App.views.writing.copyCode(el); break;
      case 'translate-abstract': App.views.writing.doTranslate(); break;
    }
  }

  /* ==========================================================================
     4. 渲染函数
     ========================================================================== */
  function renderNav() {
    const cur = App.store.state.route;
    const groups = [];
    VIEWS.forEach((v) => {
      let g = groups.find((x) => x.name === v.group);
      if (!g) { g = { name: v.group, items: [] }; groups.push(g); }
      g.items.push(v);
    });

    shellEls.nav.innerHTML = groups.map((g) => h`
      <div class="nav-group">
        <div class="nav-group-title">${g.name}</div>
        ${U.raw(g.items.map((v) => {
          const badge = v.badge ? v.badge() : null;
          return h`
            <button class="nav-item ${v.id === cur ? 'active' : ''}" data-route="${v.id}">
              <span class="nav-icon">${v.icon}</span>
              <span class="nav-text">${v.title}</span>
              ${badge ? h`<span class="nav-badge">${badge}</span>` : ''}
            </button>`;
        }).join(''))}
      </div>`).join('');
  }

  function renderTopbar() {
    const v = viewById(App.store.state.route);
    const st = App.store.state;
    const isReader = v.id === 'reader' && st.currentPaperId;
    const paper = isReader ? App.data.getPaper(st.currentPaperId) : null;

    shellEls.topbar.innerHTML = isReader && paper
      ? h`
        <button class="btn btn-ghost btn-sm" data-action="back-to-list">← 返回文库</button>
        <div class="sep"></div>
        <div class="col grow" style="line-height:1.3;min-width:0">
          <div class="ellipsis" style="font-weight:600">${paper.title}</div>
          <div class="muted tiny ellipsis">${App.data.formatAuthors(paper.authors, 4)} · ${paper.venue} · v${paper.version}</div>
        </div>
        ${U.raw(App.views.reader ? App.views.reader.toolbar() : '')}`
      : h`
        <div class="col grow" style="line-height:1.3">
          <h1>${v.title}</h1>
          <div class="subtitle">${v.subtitle}</div>
        </div>
        <div class="search">
          <span class="muted">⌕</span>
          <input placeholder="搜索文库中的论文、作者、关键词…" data-bind="search" />
        </div>
        <button class="btn btn-ghost" data-action="pick-files">⇪ 上传 PDF</button>
        <button class="btn btn-primary" data-action="go" data-route="qa">✦ 开始问答</button>`;
  }

  function renderView() {
    const v = viewById(App.store.state.route);
    const mod = v.view();
    const el = shellEls.view;
    const scrollTop = el.scrollTop;
    el.innerHTML = '';
    if (mod && typeof mod.render === 'function') {
      mod.render(el);
    } else {
      el.innerHTML = App.ui.empty('◌', '视图「' + v.title + '」尚未实现');
    }
    // 保持滚动位置（仅在非路由切换时；切页时归零）
    el.scrollTop = App.store.state.__keepScroll ? scrollTop : 0;
    App.store.state.__keepScroll = false;
  }

  function render() {
    if (!shellEls) return;
    renderNav();
    renderTopbar();
    renderView();
    renderOverlays();
  }

  /** 全局浮层：解析详情抽屉、模态框、忙碌遮罩 */
  function renderOverlays() {
    U.$$('.drawer').forEach((d) => d.remove());
    const st = App.store.state;
    if (st.ui.drawer && st.ui.drawer.name === 'parse') {
      const d = document.createElement('div');
      d.className = 'drawer';
      d.innerHTML = App.views.library.drawerHtml(st.ui.drawer.payload.paperId);
      document.body.appendChild(d);
    }
    if (st.ui.drawer && st.ui.drawer.name === 'meta') {
      const d = document.createElement('div');
      d.className = 'drawer';
      d.innerHTML = App.views.library.metaDrawerHtml(st.ui.drawer.payload.paperId);
      document.body.appendChild(d);
    }
  }

  /* ==========================================================================
     5. 启动
     ========================================================================== */
  function boot() {
    // 初始数据：先用演示数据把界面渲染出来，避免首屏空白。
    // 随后异步从后端拉真实文库，成功则整体替换。
    // 这样即使后端没起，界面仍可浏览（只是数据是演示用的）。
    App.store.state.papers = App.data.papers.slice();
    App.store.state.qa.paperIds = ['p-attention-v7'];

    buildShell();
    App.store.on(render);
    render();

    // ---- 异步同步真实数据 ----
    (async () => {
      try {
        const health = await App.api.health();
        const papers = await App.store.actions.loadPapers();
        if (papers.length > 0) {
          App.store.state.qa.paperIds = [papers[0].id];
          App.store.notify('papers');
        }
        App.ui.toast('已连接后端：' + (health.app || '服务')
          + '，文库 ' + papers.length + ' 篇', 'ok', 2600);
      } catch (err) {
        App.ui.toast('未连接后端，当前为演示数据（' + err.message + '）', 'warn', 4000);
      }
    })();

    // 全局快捷键
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (App.store.state.ui.drawer) App.store.actions.drawer(null);
        else if (App.store.state.reader.selection) App.store.set({ reader: Object.assign({}, App.store.state.reader, { selection: null }) }, 'reader');
      }
      // Ctrl/Cmd + K 聚焦搜索
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = U.$('.search input');
        if (input) input.focus();
      }
    });
  }

  App.VIEWS = VIEWS;
  App.boot = boot;
  App.render = render;
  App.viewById = viewById;
})(window.App);
