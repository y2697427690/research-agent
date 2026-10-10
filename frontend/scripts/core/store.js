/* ============================================================================
   store.js — 全局状态中心（极简发布/订阅）
   ----------------------------------------------------------------------------
   设计意图：
     前端与后端解耦——所有视图只读 store.state，只通过 store.actions 改数据。
     将来把 actions 里的 mockAsync 换成真实 HTTP 请求，视图层一行都不用改。

   结构：
     App.store.state    → 只读数据快照
     App.store.actions  → 所有会改数据的方法（内部调用 set() 通知订阅者）
     App.store.on(fn)   → 订阅变更，返回取消订阅函数
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;

  /* ---------------- 初始状态 ---------------- */
  const state = {
    route: 'dashboard',        // 当前视图 id，见 app.js 的 VIEWS
    routeParams: {},           // 路由参数，例如 { paperId: 'p-attention' }

    // ---- 文库 ----
    papers: [],                // 论文列表（来自 mock-data）
    uploads: [],               // 上传队列：[{ id, name, size, status, progress }]
    duplicates: [],            // 检测到的重复组（去重功能用）

    // ---- 阅读器 ----
    currentPaperId: null,      // 正在阅读的论文 id
    reader: {
      mode: 'bilingual',       // original(原文) | bilingual(中英对照) | translation(纯译文)
      scale: 1,                // 缩放
      syncScroll: true,        // 中英双向同步滚动
      activeAnchor: null,      // 当前定位到的章节锚点
      highlightCite: null,     // 当前高亮的引文编号
      selection: null,         // 划词选中的文本 { text, zh }
    },

    // ---- 问答 ----
    chats: [],                 // 会话列表 [{ id, title, paperIds, messages }]
    activeChatId: null,
    qa: {
      scope: 'single',         // single(单篇) | multi(多篇)
      paperIds: [],            // 已选入上下文的论文
      thinking: false,
      topK: 5,                 // 检索片段数（RAG 参数）
      showEvidence: true,      // 是否展示引用原文
    },

    // ---- 图谱 ----
    graph: { groupId: 'g-transformer', layout: 'force', selectedId: null, highlightCore: true },

    // ---- 推荐 ----
    discover: { tab: 'daily', filter: 'all', feedback: {} },  // feedback: {id: 'up'|'down'}

    // ---- 写作助手 ----
    writing: { tab: 'outline', idea: '', outline: null, running: false, csvData: null },

    // ---- 全局 UI ----
    ui: { toasts: [], modal: null, drawer: null, busy: null },
  };

  /* ---------------- 订阅机制 ---------------- */
  const listeners = new Set();
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function notify(reason) { listeners.forEach((fn) => fn(reason, state)); }

  /** 唯一改状态入口：浅合并 + 通知 */
  function set(patch, reason) {
    Object.assign(state, patch);
    notify(reason || 'set');
  }

  /* ---------------- 动作（业务逻辑） ---------------- */
  const actions = {
    /* ===== 路由 ===== */
    go(route, params) {
      state.route = route;
      state.routeParams = params || {};
      notify('route');
    },

    /* ===== 上传 / 去重 ===== */
    /**
     * 把一批文件加入上传队列，并逐个走「解析→去重」流水线。
     * 真实实现里这里会调用 POST /api/papers（multipart）。
     */
    addUploads(files) {
      const items = files.map((f) => ({
        id: U.uid('up'),
        name: f.name,
        size: f.size,
        status: 'queued',   // queued → parsing → dedupe → done | duplicate | error
        progress: 0,
        pages: null,
        chars: null,
        dupOf: null,
      }));
      state.uploads = state.uploads.concat(items);
      notify('uploads');
      items.forEach((it) => actions._runPipeline(it.id));
      return items;
    },

    /** 模拟：解析 → 去重检测 → 入库 */
    async _runPipeline(id) {
      const get = () => state.uploads.find((u) => u.id === id);
      const patch = (p) => { Object.assign(get(), p); notify('uploads'); };

      patch({ status: 'parsing', progress: 8 });
      await U.sleep(420);
      patch({ progress: 34 });
      await U.sleep(380);

      // 依据文件名猜测页数与字数（真实实现来自后端解析结果）
      const name = get().name;
      const seeded = U.seeded(name);
      const pages = 6 + Math.floor(seeded() * 24);
      patch({ progress: 62, pages, chars: Math.round(pages * (900 + seeded() * 900)) });
      await U.sleep(400);
      patch({ progress: 84 });

      // ---- 去重检测：与文库已有论文比对 ----
      const dup = App.dedupe.findDuplicate(name, state.papers);
      await U.sleep(360);

      if (dup) {
        patch({ status: 'duplicate', progress: 100, dupOf: dup.paper.id, dupInfo: dup });
      } else {
        patch({ status: 'done', progress: 100 });
        const paper = App.data.paperFromUpload(name, get());
        state.papers = [paper].concat(state.papers);
      }
      notify('uploads');
    },

    /** 去重弹窗里选择「覆盖文库版本」 */
    resolveOverwrite(uploadId) {
      const up = state.uploads.find((u) => u.id === uploadId);
      if (!up) return;
      const old = state.papers.find((p) => p.id === up.dupOf);
      if (old) { old.version = up.name.match(/v(\d+)/) ? up.name.match(/v(\d+)/)[1] : old.version; }
      up.status = 'done';
      up.resolved = 'overwrite';
      notify('uploads');
    },

    /** 去重弹窗里选择「保留文库版本（丢弃本次上传）」 */
    resolveKeep(uploadId) {
      const up = state.uploads.find((u) => u.id === uploadId);
      if (!up) return;
      up.status = 'skipped';
      up.resolved = 'keep';
      notify('uploads');
    },

    /** 去重弹窗里选择「两份都留」 */
    resolveKeepBoth(uploadId) {
      const up = state.uploads.find((u) => u.id === uploadId);
      if (!up) return;
      const paper = App.data.paperFromUpload(up.name, up);
      paper.title += '（副本）';
      state.papers = [paper].concat(state.papers);
      up.status = 'done';
      up.resolved = 'both';
      notify('uploads');
    },

    removeUpload(id) {
      state.uploads = state.uploads.filter((u) => u.id !== id);
      notify('uploads');
    },

    /* ===== 文库 ===== */
    deletePaper(id) {
      state.papers = state.papers.filter((p) => p.id !== id);
      if (state.currentPaperId === id) state.currentPaperId = null;
      notify('papers');
    },
    toggleStar(id) {
      const p = state.papers.find((x) => x.id === id);
      if (p) { p.starred = !p.starred; notify('papers'); }
    },
    /** 重新解析（模拟） */
    async reparse(id) {
      const p = state.papers.find((x) => x.id === id);
      if (!p) return;
      p.parsing = true; notify('papers');
      await U.sleep(1400);
      p.parsing = false;
      p.parsedAt = new Date(App.data.NOW).toISOString();
      p.quality = Math.min(0.99, (p.quality || 0.9) + 0.02);
      notify('papers');
      App.ui.toast('《' + U.clip(p.title, 22) + '》解析完成', 'ok');
    },

    /* ===== 阅读器 ===== */
    openPaper(id) {
      state.currentPaperId = id;
      state.reader.activeAnchor = null;
      state.reader.highlightCite = null;
      state.reader.selection = null;
      notify('reader');
      actions.go('reader', { paperId: id });
    },
    setReaderMode(mode) { state.reader.mode = mode; notify('reader'); },
    setReaderScale(scale) { state.reader.scale = scale; notify('reader'); },
    toggleSyncScroll() { state.reader.syncScroll = !state.reader.syncScroll; notify('reader'); },
    /** 点击 [11] 这类引文角标：高亮并跳到参考文献 */
    jumpCite(n) { state.reader.highlightCite = n; notify('reader'); },
    /** 点击大纲锚点：滚动到对应章节 */
    gotoAnchor(id) { state.reader.activeAnchor = id; notify('reader'); },

    /* ===== 问答 ===== */
    newChat() {
      const chat = {
        id: U.uid('chat'),
        title: '新会话',
        paperIds: state.qa.paperIds.slice(),
        messages: [],
        createdAt: new Date(App.data.NOW).toISOString(),
      };
      state.chats = [chat].concat(state.chats);
      state.activeChatId = chat.id;
      notify('chats');
      return chat;
    },
    /** 发送问题：先检索证据片段，再模拟流式回答 */
    async ask(question) {
      const q = String(question || '').trim();
      if (!q || state.qa.thinking) return null;

      let chat = state.chats.find((c) => c.id === state.activeChatId);
      if (!chat) chat = actions.newChat();
      if (chat.messages.length === 0) chat.title = U.clip(q, 18);

      chat.messages.push({ role: 'user', text: q, at: Date.now() });
      const answerMsg = {
        role: 'assistant', text: '', streaming: true, evidence: [], thinking: true, at: Date.now(),
      };
      chat.messages.push(answerMsg);
      state.qa.thinking = true;
      notify('chats');

      // ---- 1. RAG 检索：从 mock 知识库里挑最相关的片段 ----
      await U.sleep(620);
      const hits = App.rag.retrieve(q, state.qa.paperIds, state.qa.topK);
      answerMsg.evidence = hits;
      answerMsg.thinking = false;
      notify('chats');

      // ---- 2. 生成回答（优先用内置的示范答案，否则用检索片段拼装） ----
      const preset = App.rag.presetAnswer(q);
      const body = preset || App.rag.compose(q, hits, state.qa.scope);
      answerMsg.text = body;
      answerMsg.streaming = false;
      state.qa.thinking = false;
      notify('chats');
      return answerMsg;
    },
    setQaScope(scope) {
      state.qa.scope = scope;
      if (scope === 'single' && state.qa.paperIds.length > 1) {
        state.qa.paperIds = state.qa.paperIds.slice(0, 1);
      }
      notify('qa');
    },
    toggleQaPaper(id) {
      const i = state.qa.paperIds.indexOf(id);
      if (i === -1) {
        state.qa.paperIds = state.qa.scope === 'single'
          ? [id]
          : state.qa.paperIds.concat(id);
      } else {
        state.qa.paperIds = state.qa.paperIds.filter((x) => x !== id);
      }
      notify('qa');
    },
    setTopK(k) { state.qa.topK = k; notify('qa'); },
    toggleEvidence() { state.qa.showEvidence = !state.qa.showEvidence; notify('qa'); },

    /* ===== 图谱 ===== */
    selectNode(id) { state.graph.selectedId = id; notify('graph'); },
    setGraphLayout(layout) { state.graph.layout = layout; notify('graph'); },
    toggleCoreHighlight() { state.graph.highlightCore = !state.graph.highlightCore; notify('graph'); },

    /* ===== 推荐 ===== */
    setDiscoverTab(tab) { state.discover.tab = tab; notify('discover'); },
    vote(id, v) {
      state.discover.feedback[id] = state.discover.feedback[id] === v ? null : v;
      notify('discover');
      App.ui.toast(v === 'up' ? '已点赞，推荐将偏向同类主题' : '已标记不感兴趣', v === 'up' ? 'ok' : 'warn');
    },

    /* ===== 写作助手 ===== */
    setWritingTab(tab) { state.writing.tab = tab; notify('writing'); },
    setIdea(v) { state.writing.idea = v; },
    async generateOutline(idea) {
      state.writing.running = true;
      state.writing.idea = idea;
      state.writing.outline = null;
      notify('writing');
      await U.sleep(1100);
      state.writing.outline = App.writer.buildOutline(idea);
      state.writing.running = false;
      notify('writing');
    },

    /* ===== 全局 UI ===== */
    modal(name, payload) { state.ui.modal = name ? { name, payload: payload || {} } : null; notify('ui'); },
    drawer(name, payload) { state.ui.drawer = name ? { name, payload: payload || {} } : null; notify('ui'); },
    busy(text) { state.ui.busy = text || null; notify('ui'); },
  };

  App.store = { state, actions, on, set, notify };
})(window.App);
