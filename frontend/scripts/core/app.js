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
      // 不在主导航显示：它是「需求对照表」，给开发/评审看，
      // 不属于产品功能。入口挪到侧边栏底部的「能力说明」小链接，
      // 答辩/演示时再主动打开。
      hidden: true,
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
            <div class="brand-logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                <path d="M7.4 3.2h6.1L17 6.7v12.1a1.4 1.4 0 0 1-1.4 1.4H7.4A1.4 1.4 0 0 1 6 18.8V4.6a1.4 1.4 0 0 1 1.4-1.4Z" fill="#ffffff"/>
                <path d="M13.5 3.2 17 6.7h-3.5V3.2Z" fill="#c9d8ff"/>
                <path d="M8.6 11.1h6.0M8.6 13.8h4.2" stroke="#2f6fed" stroke-width="1.1" stroke-linecap="round" opacity=".5"/>
                <path d="m18.9 3.9.5 1.25 1.25.5-1.25.5-.5 1.25-.5-1.25-1.25-.5 1.25-.5.5-1.25Z" fill="#f5b942"/>
              </svg>
            </div>
            <div class="col" style="line-height:1.2">
              <span class="brand-name">科研小助手</span>
              <span class="brand-sub">Research Agent</span>
            </div>
          </div>
          <nav class="nav" id="nav"></nav>
          <div class="side-foot">
            <div class="side-status" id="sys-status" title="来自 /api/v1/health 的实时状态">
              <span class="dot pulse" id="sys-dot"></span>
              <div class="col" style="line-height:1.3">
                <span id="sys-status-text">正在连接后端…</span>
                <span class="muted tiny" id="sys-status-sub">检测中</span>
              </div>
            </div>
            <!-- 需求对照表不属于产品功能，放成底部小链接，答辩时主动打开即可 -->
            <button class="side-link" data-action="open-guide" title="需求条目 → 界面元素 → 代码位置">
              能力说明 · 需求对照
            </button>
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
    // 抽屉（元数据 / 解析详情）是 appendChild 到 document.body 的，
    // 不在 shellEls.view 范围内，上面的委托覆盖不到 ——
    // 于是抽屉里的「删除该论文」「✕」「取消」点了没反应（用户反馈的"点删除没反应"）。
    // 这里单独补一条委托，选择器限定 .drawer 内部，不会与视图按钮重复触发。
    U.delegate(document.body, 'click', '.drawer [data-action]', (e, el) => {
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
      // 引用卡片里的「跳转原文」：打开论文并定位到该片段
      case 'open-evidence':
        S.openPaper(data.id);
        S.focusEvidence({
          text: data.text || '',
          page: parseInt(data.page, 10) || 0,
          section: data.section || '',
        });
        break;

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
      // 需求对照表：不在主导航里，从侧边栏底部的小链接进入
      case 'open-guide': S.go('guide'); break;

      /* ---- 阅读器 ---- */
      case 'reader-mode': S.setReaderMode(data.mode); break;
      case 'reader-zoom': S.setReaderScale(parseFloat(data.scale)); break;
      case 'toggle-sync': S.toggleSyncScroll(); break;
      case 'jump-cite': S.jumpCite(parseInt(data.cite, 10)); App.views.reader.scrollToRef(parseInt(data.cite, 10)); break;
      case 'goto-anchor': S.gotoAnchor(data.id); App.views.reader.scrollToAnchor(data.id); break;
      case 'goto-publication': App.views.reader.gotoPublication(data.id); break;
      case 'open-ref-paper': S.openPaper(data.id); break;
      case 'translate-selection': App.views.reader.translateSelection(); break;
      case 'continue-translate':
        S.ensureTranslation(App.store.state.currentPaperId);
        break;
      // 用户主动停止：只是打标记让翻译循环下一批不再发起，
      // 已发出的那一批会跑完（协作式取消），最多多等一批
      case 'cancel-translate':
        S.cancelTranslation(App.store.state.currentPaperId || undefined);
        break;
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
      case 'qa-cite': App.views.qa.jumpEvidence(parseInt(data.cite, 10), el); break;

      /* ---- 图谱 ---- */
      case 'graph-select': S.selectNode(data.id); break;
      case 'toggle-theme': toggleTheme(); break;
      case 'graph-layout': S.setGraphLayout(data.layout); break;
      case 'graph-toggle-core': S.toggleCoreHighlight(); break;
      case 'graph-toggle-external':
        App.store.set({
          graph: Object.assign({}, App.store.state.graph, {
            showExternal: !App.store.state.graph.showExternal,
            selectedId: null,
          }),
        }, 'graph');
        break;
      case 'graph-open-paper': S.openPaper(data.id); break;

      /* ---- 论文发现（arXiv） ---- */
      case 'discover-tab': S.setDiscoverTab(data.tab); break;
      case 'discover-search': S.discoverSearch(); break;
      case 'discover-sort': S.setDiscoverSort(data.sort); break;
      case 'discover-ingest': S.discoverIngest(data.id); break;
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
    // hidden 的视图不进导航（例如「需求对照表」只在侧边栏底部留入口）
    VIEWS.filter((v) => !v.hidden).forEach((v) => {
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
        <button class="btn btn-ghost" data-action="toggle-theme" title="切换浅色 / 深色主题">
          ${currentTheme() === 'dark' ? '☀ 浅色' : '☾ 深色'}
        </button>
        <button class="btn btn-ghost" data-action="pick-files">⇪ 上传 PDF</button>
        <button class="btn btn-primary" data-action="go" data-route="qa">✦ 开始问答</button>`;
  }

  /* ---------------- 主题切换 ----------------
     默认浅色（阅读友好），深色作为可选项。
     选择写入 localStorage，index.html 的头部脚本会在首次绘制前应用，
     因此刷新页面不会先闪一下另一种主题。 */
  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('app.theme', next);
    } catch (e) {
      /* 隐私模式下可能不可写，忽略即可，仅本次会话生效 */
    }
    renderTopbar();   // 更新按钮文字
    // 图谱用 SVG 绘制，节点配色写死在视图里，换主题后需要重绘一次
    if (App.store.state.route === 'graph') App.store.notify('graph');
  }

  /* 需要「填满一屏、内部各自滚动」的视图。
     这些页面里的内容区（如问答的消息列表）应该自己滚动，
     而不是让整个页面跟着滚——否则滚轮会把标题栏一起带走。 */
  const FILL_VIEWS = { qa: true };

  function renderView() {
    const v = viewById(App.store.state.route);
    const mod = v.view();
    const el = shellEls.view;
    const scrollTop = el.scrollTop;

    // 问答页的滚动发生在消息区内部，不在 .view 上。
    // 每次重绘都会销毁消息区元素、把它的 scrollTop 清零，
    // 若不在重绘前记下来，流式输出期间用户会看到「跳回顶部」。
    // 同时记录「重绘前是否贴底」：恢复位置后内容已变高，
    // 只看位置会被误判成「用户在看历史」，从而停止自动跟随。
    const inner = el.querySelector('[data-scroll-keep]');
    if (inner) {
      App.store.state.__innerScroll = inner.scrollTop;
      App.store.state.__innerAtBottom =
        inner.scrollHeight - inner.scrollTop - inner.clientHeight <= 80;
    }

    // 切换页面对应的布局模式：填满模式关闭 .view 自身的滚动
    el.className = FILL_VIEWS[v.id] ? 'view view--fill' : 'view';
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

    // 安装阅读器数据桥：让 getPaper/getDoc 能找到真实文库与后端分块。
    // 必须在 store 与 api 都就绪后调用。
    if (App.adapter && typeof App.adapter.installDataBridge === 'function') {
      App.adapter.installDataBridge();
    }

    // ---- 异步同步真实数据 ----
    (async () => {
      try {
        const health = await App.api.health();
        applySystemStatus(health);
        const papers = await App.store.actions.loadPapers();
        if (papers.length > 0) {
          App.store.state.qa.paperIds = [papers[0].id];
          App.store.notify('papers');
        }
        App.ui.toast('已连接后端：' + (health.app || '服务')
          + '，文库 ' + papers.length + ' 篇', 'ok', 2600);
      } catch (err) {
        applySystemStatus(null, err);
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

  /**
   * 把 /health 的真实结果写进侧边栏底部。
   *
   * 为什么必须来自接口：这里原来写死「本地模型已就绪 / DeepSeek-V3 · 671B MoE」，
   * 而本项目的对话能力实际走 https://api.deepseek.com/v1 的云端接口，
   * 既不是本地模型，也无法证实「671B MoE」这类参数——属于界面在编造事实。
   * 改为读 health 后，这一行同时变成了「真实健康指示器」：
   * 后端没连上、Key 没配、接口可达性异常，都能一眼看出来。
   */
  function applySystemStatus(health, err) {
    const dot = U.$('#sys-dot');
    const main = U.$('#sys-status-text');
    const sub = U.$('#sys-status-sub');
    if (!main || !sub) return;

    const set = (color, text, subText, pulsing) => {
      if (dot) {
        dot.style.background = color;
        dot.className = pulsing ? 'dot pulse' : 'dot';
      }
      main.textContent = text;
      sub.textContent = subText;
    };

    if (!health) {
      set('var(--danger)', '未连接后端', '当前显示演示数据', false);
      if (err && App.ui && App.ui.toast) {
        // 已由调用方 toast，这里不重复提示
      }
      return;
    }

    const llm = health.llm || {};
    const db = health.db || {};
    if (!llm.configured) {
      set('var(--warn)', '对话模型未配置', '需设置 APP_LLM_API_KEY', false);
      return;
    }
    if (llm.reachable === false) {
      set('var(--warn)', '对话模型不可达', '检索与解析仍可用', false);
      return;
    }
    // reachable 为 null 表示后端未做主动探测，此时以「已配置」为准
    const model = llm.model || 'deepseek-chat';
    set('var(--ok)', 'DeepSeek API 已连接',
      model + ' · ' + (db.ok ? '数据库正常' : '数据库异常'), true);
  }

  App.VIEWS = VIEWS;
  App.boot = boot;
  App.render = render;
  App.viewById = viewById;
  App.applySystemStatus = applySystemStatus;
})(window.App);
