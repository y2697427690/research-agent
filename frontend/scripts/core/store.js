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
      // 翻译进行中：null 或 { paperId, done, total }。
      // 放在 state 里而不是组件内部，是因为阅读器是「状态驱动重绘」的，
      // 只有状态变化才会重新渲染出进度徽标。
      translating: null,
    },

    // ---- 问答 ----
    chats: [],                 // 会话列表 [{ id, title, paperIds, messages }]
    activeChatId: null,
    qa: {
      scope: 'single',         // single(单篇) | multi(多篇)
      paperIds: [],            // 已选入上下文的论文
      thinking: false,
      // 检索片段数：与后端 DEFAULT_TOP_K 对齐。
      // 实测 5~6 时「Base 模型用了多少 GPU」这类问题会拒答，
      // 8 能命中需要的训练细节段落，再往上答案不再变化。
      topK: 8,
      showEvidence: true,      // 是否展示引用原文
    },

    // ---- 图谱 ----
    graph: {
      groupId: 'g-transformer',
      layout: 'force',
      selectedId: null,
      highlightCore: true,
      // 是否在图上显示未入库的外部文献（通常上百个，默认关闭）
      showExternal: false,
    },
    // 真实引用图：由 loadGraph 从后端填充；为空时图谱页回退到演示数据
    graphData: null,

    // ---- 论文发现（arXiv 检索）----
    discover: {
      tab: 'daily',          // 兼容旧字段，新界面不再使用
      filter: 'all',
      feedback: {},
      query: '',             // 用户输入的关键词
      sort: 'relevance',     // relevance | recent
      loading: false,
      error: null,
      total: 0,
      hint: null,            // 后端给的提示（零结果时建议换词或使用 arXiv 语法）
      effectiveQuery: '',    // 实际发给 arXiv 的语句，让用户理解「为什么搜到这些」
      items: [],
      ingesting: {},         // arxivId -> true，表示该条正在下载入库
    },

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

  /* ---------------- 离线守卫 ----------------
     api.js 未加载（例如纯前端冒烟测试）或后端不可达时，
     业务动作应降级为「只改本地状态」，而不是抛错或回滚。
     注意只把「网络层不存在」当作离线；真实网络错误仍要提示用户。
     ------------------------------------------------------------------ */
  function hasApi() {
    return !!(App.api && typeof App.api.health === 'function');
  }

  /* ------------------------------------------------------------------
     问题里是否点名了某篇库内论文
     ------------------------------------------------------------------
     问答范围默认锁定「文库第一篇」，用户问另一篇论文时，
     后端会按问题把该篇补进检索范围；但界面上的「已选 N 篇」
     仍显示旧论文，两边不一致容易让人以为答错了论文。
     这里在发送前做同样的识别，直接切换界面上的选择。

     判断方式与引用匹配一致：把标题归一化成只含小写字母数字后，
     看它是否出现在问题文本里。标题过短（<12 字符）易误命中，跳过。 */
  function normalizeText(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function detectPaperInText(text) {
    const q = normalizeText(text);
    if (!q) return null;
    return (state.papers || []).find((p) => {
      const t = normalizeText(p.title);
      return t.length >= 12 && q.indexOf(t) !== -1;
    }) || null;
  }

  /* ---------------- 动作（业务逻辑） ---------------- */
  const actions = {
    /* ===== 路由 ===== */
    go(route, params) {
      // 离开阅读器时终止正在进行的翻译，避免用户在别的页面时后台还在花钱
      if (route !== 'reader') actions.cancelTranslation();
      state.route = route;
      state.routeParams = params || {};
      notify('route');
      // 进入图谱页时按需加载真实引用图（已有数据则用缓存，不重复请求）
      if (route === 'graph' && !state.graphData) actions.loadGraph();
    },

    /**
     * 加载真实引用图。
     * 后端即时从 citations 表构图并计算指标，数据不大，
     * 因此只在首次进入或用户主动刷新时请求，其余情况用缓存。
     */
    async loadGraph(force) {
      if (!hasApi()) return null;
      if (state.graphData && !force) return state.graphData;
      try {
        const data = await App.api.graph();
        state.graphData = App.adapter.graphFromApi(data);
        // 同步替换分组与洞察文案，否则界面仍显示演示数据的统计数字
        if (App.adapter.installGraphInsights) {
          App.adapter.installGraphInsights(state.graphData);
        }
        notify('graph');
        return state.graphData;
      } catch (err) {
        App.ui.toast('加载引用图谱失败：' + err.message, 'error');
        return null;
      }
    },

    /** 重建引用关系（重新解析 PDF 抽取参考文献）。会覆盖旧边。 */
    async rebuildGraph() {
      if (!hasApi()) return null;
      try {
        App.ui.busy('正在重建引用关系…');
        const st = await App.api.rebuildGraph();
        App.ui.busy(null);
        App.ui.toast(
          '引用重建完成：' + st.total_refs + ' 条参考文献，命中库内 '
          + st.matched + ' 条（编号 ' + st.by_arxiv + ' / 标题 ' + st.by_title + '）',
          'ok', 3600
        );
        return await actions.loadGraph(true);
      } catch (err) {
        App.ui.busy(null);
        App.ui.toast('重建失败：' + err.message, 'error');
        return null;
      }
    },

    /**
     * 终止某篇论文正在进行的翻译。
     *
     * 实现方式是「标记 + 协作式退出」：翻译循环在每批开始前检查标记，
     * 看到就停。当前那一批请求无法中断（后端已经发出去了），
     * 但不会再发起新的一批——最多多等几秒，不会一直翻下去。
     * 相比给每个请求加 AbortController，这种做法的代码量小得多，
     * 代价只是可能多完成一批（约 20 块）。
     */
    cancelTranslation(paperId) {
      const current = state.reader.translating;
      const target = paperId || (current && current.paperId);
      if (!target) return;
      state.__translateCancel = state.__translateCancel || {};
      state.__translateCancel[target] = true;
      // 记下「用户主动停在哪篇」：提示条据此显示「已停止，已翻译 x/y 段」，
      // 而不是与「从未翻译过」共用同一句文案。
      state.reader.translateStoppedId = target;
      if (current && current.paperId === target) {
        state.reader.translating = null;
        notify('reader');
      }
    },

    /* ===== 数据同步 ===== */
    /**
     * 从后端加载论文列表。
     * 应用启动时调用一次；上传/删除后重新调用即可刷新。
     */
    async loadPapers() {
      if (!hasApi()) return state.papers;
      try {
        const resp = await App.api.listPapers(1, 100);
        state.papers = App.adapter.papersFromApi(resp);
        notify('papers');
        return state.papers;
      } catch (err) {
        App.ui.toast('加载论文列表失败：' + err.message, 'error');
        return [];
      }
    },

    /* ===== 上传 / 去重 ===== */
    /**
     * 把一批文件加入上传队列，逐个上传到后端并触发解析。
     *
     * 真实流程（对应后端接口）：
     *   1. POST /papers/upload        → 入库并做去重判定
     *   2. POST /papers/{id}/parse    → 解析并自动切块
     *   3. 稍后可 POST /papers/{id}/embed 生成向量（问答才需要）
     */
    addUploads(files) {
      const items = Array.prototype.map.call(files, (f) => {
        // 从文件名里解析版本号（v7 → 7）。arXiv 的版本就在文件名里，
        // 这是上传瞬间唯一能确定的版本信息（此时还没解析内容）。
        const ver = String(f.name || '').match(/v(\d+)(?=\.pdf$|$)/i);
        return {
          id: U.uid('up'),
          name: f.name,
          size: f.size,
          version: ver ? ver[1] : null,
          status: 'queued',   // queued → parsing → done | duplicate | error
          progress: 0,
          pages: null,
          chars: null,
          dupOf: null,
          file: f,            // 保留原始 File 对象用于上传
        };
      });
      state.uploads = state.uploads.concat(items);
      notify('uploads');
      items.forEach((it) => actions._runPipeline(it.id));
      return items;
    },

    /** 真实上传 + 解析流水线 */
    async _runPipeline(id) {
      const get = () => state.uploads.find((u) => u.id === id);
      const patch = (p) => { if (get()) { Object.assign(get(), p); notify('uploads'); } };

      const item = get();
      if (!item) return;

      // 离线模式：没有后端时用演示数据走一遍流程，界面仍可完整演示
      if (!hasApi()) {
        patch({ status: 'parsing', progress: 30 });
        await U.sleep(300);
        patch({ progress: 80 });
        await U.sleep(200);
        const demo = App.data.paperFromUpload(item.name, item);
        state.papers = [demo].concat(state.papers);
        patch({ status: 'done', progress: 100, pages: demo.pages });
        return;
      }

      patch({ status: 'parsing', progress: 10 });
      let resp;
      try {
        resp = await App.api.uploadPapers([item.file]);
      } catch (err) {
        patch({ status: 'error', progress: 100, error: err.message });
        App.ui.toast(item.name + ' 上传失败：' + err.message, 'error');
        return;
      }

      patch({ progress: 45 });
      const result = (resp.results || [])[0];
      if (!result) {
        patch({ status: 'error', progress: 100, error: '后端未返回结果' });
        return;
      }

      // ---- 情况 1：处理失败 ----
      if (result.error) {
        patch({ status: 'error', progress: 100, error: result.error });
        App.ui.toast(item.name + ' 处理失败：' + result.error, 'error');
        return;
      }

      // ---- 情况 2：判定为重复 ----
      if (result.duplicate) {
        const dup = result.duplicate;
        const existing = state.papers.find((p) => p.id === dup.existing_paper_id);
        patch({
          status: 'duplicate',
          progress: 100,
          dupOf: dup.existing_paper_id,
          dupInfo: {
            kind: dup.kind,
            message: dup.message,
            reasons: dup.reasons || [],
            paper: existing || {
              id: dup.existing_paper_id,
              title: dup.existing_file_name || '（已存在的论文）',
              file: dup.existing_file_name,
            },
          },
        });
        return;
      }

      // ---- 情况 3：入库成功 → 继续解析 ----
      const paper = result.paper;
      if (!paper) {
        patch({ status: 'error', progress: 100, error: '上传失败' });
        return;
      }

      patch({ progress: 70 });
      try {
        const st = await App.api.parsePaper(paper.id, true);
        patch({
          status: 'done',
          progress: 100,
          pages: st.page_count,
          quality: st.quality,
          parseStatus: st.parse_status,
        });
      } catch (err) {
        // 解析失败不影响入库：论文已在列表里，可以稍后重试解析
        patch({ status: 'done', progress: 100, parseError: err.message });
        App.ui.toast('《' + item.name + '》已入库，但解析失败：' + err.message, 'warn');
      }

      await actions.loadPapers();

      // 解析成功但没生成向量时，后台补做一次，让问答立刻可用。
      // 失败不提示：没有向量仍可用 BM25 检索。
      if (get() && get().status === 'done') {
        App.api.embedPaper(paper.id).catch(() => {});
      }
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
    /**
     * 删除论文。
     * 先改本地状态让界面立刻响应，再调用后端；失败则把论文放回原位并提示。
     * 这种「乐观更新」比等网络往返再刷新体验好得多（本地约 1ms vs 网络 50~200ms）。
     *
     * removeFile=false 时后端只删数据库记录（分块/引用/译文级联删除），
     * 服务器上的 PDF 保留，误删后可重新上传恢复；true 则连文件一起删。
     */
    async deletePaper(id, removeFile) {
      const index = state.papers.findIndex((p) => p.id === id);
      if (index === -1) return;

      const removed = state.papers[index];
      const prevCurrent = state.currentPaperId;

      state.papers = state.papers.filter((p) => p.id !== id);
      if (state.currentPaperId === id) state.currentPaperId = null;
      notify('papers');

      // 离线模式：没有后端时本地移除即可，不进入回滚逻辑
      if (!hasApi()) return;

      try {
        await App.api.deletePaper(id, !!removeFile);
        App.ui.toast('已从文库移除', 'ok');
      } catch (err) {
        // 回滚：把论文放回原来的位置，恢复阅读目标
        state.papers = state.papers
          .slice(0, index)
          .concat([removed], state.papers.slice(index));
        if (prevCurrent === id) state.currentPaperId = id;
        notify('papers');
        App.ui.toast('删除失败：' + err.message, 'error');
      }
    },
    async toggleStar(id) {
      const p = state.papers.find((x) => x.id === id);
      if (!p) return;
      const next = !p.starred;
      // 先改本地让界面立刻响应，再同步后端；失败则回滚
      p.starred = next;
      notify('papers');
      if (!hasApi()) return;
      try {
        await App.api.updatePaper(id, { starred: next });
      } catch (err) {
        p.starred = !next;
        notify('papers');
        App.ui.toast('收藏状态同步失败：' + err.message, 'error');
      }
    },
    /** 重新解析：会重建分块，内容未变的块会保留原有向量 */
    async reparse(id) {
      const p = state.papers.find((x) => x.id === id);
      if (!p) return;
      p.parsing = true; notify('papers');
      if (!hasApi()) { p.parsing = false; notify('papers'); return; }
      try {
        const st = await App.api.parsePaper(id, true);
        p.quality = st.quality;
        p.pages = st.page_count;
        p.status = st.parse_status;
        p.parsedAt = new Date().toISOString();
        p.parsing = false;
        notify('papers');
        await actions.loadPapers();
        App.ui.toast('《' + U.clip(p.title, 22) + '》解析完成（置信度 '
          + Math.round((st.quality || 0) * 100) + '%）', 'ok');
      } catch (err) {
        p.parsing = false;
        notify('papers');
        App.ui.toast('重新解析失败：' + err.message, 'error');
      }
    },

    /* ===== 阅读器 ===== */
    openPaper(id) {
      state.currentPaperId = id;
      state.reader.activeAnchor = null;
      state.reader.highlightCite = null;
      state.reader.selection = null;
      // 换论文时终止上一篇的翻译：用户在别的论文上，不必继续为旧论文花钱
      actions.cancelTranslation();
      notify('reader');
      actions.go('reader', { paperId: id });
    },
    /**
     * 切换阅读模式。
     * 切到需要译文的模式（双语/纯译文）时，若当前是真实论文且还没译文，
     * 自动按批触发翻译。演示论文自带译文，不会走到这里。
     */
    /**
     * 记录一次「跳转到原文」的定位请求。
     *
     * 问答页只负责把「片段文本前缀 + 页码 + 小节」塞进状态，
     * 真正的滚动与高亮由阅读器在渲染完成后执行（见 reader.applyFocusEvidence）。
     * 这样即使正文是异步加载的（首次进入需要拉 chunks），
     * 也能在加载完成后的下一次渲染里完成定位。
     */
    focusEvidence(payload) {
      state.reader.focusEvidence = payload || null;
      notify('reader');
    },

    clearFocusEvidence() {
      if (!state.reader.focusEvidence) return;
      state.reader.focusEvidence = null;
      notify('reader');
    },

    async setReaderMode(mode) {
      state.reader.mode = mode;
      notify('reader');
      if (mode !== 'original') {
        await actions.ensureTranslation(state.currentPaperId || state.routeParams.paperId);
      }
    },

    /**
     * 确保这篇论文有完整译文（按需 + 缓存 + 自动续批）。
     *
     * 为什么循环分批而不是一次翻完：
     *   一次请求翻上百块要几十秒，浏览器与代理容易超时；
     *   分批后每批几秒就能返回，用户能边翻边看，中途失败也只损失一批。
     * 为什么要循环到底：
     *   只翻一批会让用户以为"只翻译了一章"——这正是之前的缺陷。
     */
    async ensureTranslation(paperId, batch) {
      if (!paperId || !hasApi()) return null;
      // 演示论文的译文在 mock 数据里，不需要后端。
      // 判据用「是否来自演示数据集」，而不是「是否在 state.papers 里」——
      // 后端不可用时 boot 会把演示数据放进 state.papers，
      // 用后者判断会误把演示论文当成真实论文去请求后端。
      const isMock = (App.data.papers || []).some((p) => p.id === paperId);
      if (isMock) return null;

      // 防止重复启动：用户连点几次"中英对照"不应并发发起多轮翻译
      state.__translating = state.__translating || {};
      if (state.__translating[paperId]) return null;

      const first = App.data && App.data.getDoc ? App.data.getDoc(paperId) : null;
      if (first && first.isReal && first.totalChunks > 0
        && first.translatedChunks >= first.totalChunks) {
        return null;       // 已全部翻译，无需再请求
      }

      const step = Math.max(5, batch || 20);
      state.__translating[paperId] = true;
      // 清掉上一次的取消标记，否则重新进入阅读器会立刻被判定为"已取消"
      state.__translateCancel = state.__translateCancel || {};
      state.__translateCancel[paperId] = false;
      // 重新开始翻译就撤掉「已停止」提示，否则会一直挂着上一轮的状态
      if (state.reader.translateStoppedId === paperId) {
        state.reader.translateStoppedId = null;
      }

      // 立刻进入「翻译中」状态，不等第一批返回。
      // 第一批要 5~8 秒，这期间如果状态还是空，译文面板就是一片空白，
      // 用户会以为点了没反应。total 已知就带上进度，未知就只显示"翻译中…"。
      state.reader.translating = {
        paperId: paperId,
        done: (first && first.translatedChunks) || 0,
        total: (first && first.totalChunks) || 0,
      };
      notify('reader');

      let last = null;
      let cancelled = false;

      try {
        // 首批只翻 5 段：让用户约 2 秒就能看到第一屏中文，
        // 而不是干等 7 秒才出现任何内容。之后恢复每批 20 段，减少请求次数。
        // 上限 40 轮，足够覆盖任何论文，同时防止后端异常时无限循环。
        const FIRST_BATCH = 5;
        for (let round = 0; round < 40; round += 1) {
          if (state.__translateCancel[paperId]) { cancelled = true; break; }

          const limitThisRound = round === 0 ? Math.min(FIRST_BATCH, step) : step;
          const st = await App.api.translatePaper(paperId, { limit: limitThisRound });
          last = st;

          const total = st.progress[0];
          const done = st.progress[1];

          if (st.translated === 0) {
            // 没有新内容：要么已翻完，要么出错（如额度/密钥问题）
            if (done < total && st.errors.length) {
              App.ui.toast('翻译中断：' + st.errors[0], 'warn', 4000);
            }
            break;
          }

          // 进度写进状态：译文面板据此显示「翻译中 40/164」徽标与提示条，
          // 只弹 toast 的话用户不知道整体还有多少、也不知道会自动续
          state.reader.translating = { paperId: paperId, done: done, total: total };
          if (App.data.invalidateDoc) App.data.invalidateDoc(paperId);
          notify('reader');

          if (done >= total) break;
        }

        if (cancelled) {
          App.ui.toast('已停止翻译', 'warn', 2200);
        } else if (last && last.progress[0] > 0 && last.progress[1] >= last.progress[0]) {
          App.ui.toast('译文已就绪（共 ' + last.progress[1] + ' 段）', 'ok', 2600);
        }
        return last;
      } catch (err) {
        App.ui.toast('翻译失败：' + err.message, 'error');
        return null;
      } finally {
        state.__translating[paperId] = false;
        // 结束（正常完成或取消）都要清掉进度，否则徽标会一直挂着
        if (state.reader.translating && state.reader.translating.paperId === paperId) {
          state.reader.translating = null;
        }
        if (App.data.invalidateDoc) App.data.invalidateDoc(paperId);
        notify('reader');
      }
    },

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
    /**
     * 发送问题：真实调用后端 SSE 流式问答。
     *
     * 事件顺序：citations（先给出处）→ token（文本增量，多次）→ done（最终结果）
     * 视图层不需要改：它只读 message.evidence 和 message.text，
     * 这里在流式过程中持续更新这两个字段并 notify 即可。
     */
    async ask(question) {
      const q = String(question || '').trim();
      if (!q || state.qa.thinking) return null;

      let chat = state.chats.find((c) => c.id === state.activeChatId);
      if (!chat) chat = actions.newChat();
      if (chat.messages.length === 0) chat.title = U.clip(q, 18);

      chat.messages.push({ role: 'user', text: q, at: Date.now() });
      const answerMsg = {
        role: 'assistant',
        text: '',
        streaming: true,
        evidence: [],
        thinking: true,
        at: Date.now(),
      };
      chat.messages.push(answerMsg);
      state.qa.thinking = true;
      notify('chats');

      // 离线模式：没有后端时用内置检索与示范答案，界面仍可演示
      if (!hasApi()) {
        await U.sleep(400);
        const offlineHits = App.rag.retrieve(q, state.qa.paperIds, state.qa.topK);
        answerMsg.evidence = offlineHits;
        answerMsg.thinking = false;
        answerMsg.text = App.rag.presetAnswer(q)
          || App.rag.compose(q, offlineHits, state.qa.scope);
        answerMsg.streaming = false;
        state.qa.thinking = false;
        notify('chats');
        return answerMsg;
      }

      await new Promise((resolve) => {
        // 按当前的问答范围传论文 id：
        // 问题点名了某篇论文时，先把界面的问答范围切到那一篇。
        // 否则会出现「界面写着《CLIP》，回答却在讲《Attention》」，
        // 让人以为答错了论文。
        const mentioned = detectPaperInText(q);
        if (mentioned && state.qa.paperIds.indexOf(mentioned.id) === -1) {
          state.qa.paperIds = [mentioned.id];
          if (state.qa.scope === 'multi') state.qa.scope = 'single';
          App.ui.toast('已自动把问答范围切换到《' + mentioned.title + '》', 'ok', 2600);
          notify('chats');
        }

        //   单篇模式 → 只传当前选中的那一篇
        //   多篇模式 → 传全部选中论文，后端据此切换为对比提示词
        // 不传时后端会检索全库，可能把不相关的论文也带进来
        let scopeIds = [];
        if (state.qa.scope === 'multi') {
          scopeIds = state.qa.paperIds.slice();
        } else if (state.qa.paperIds.length) {
          scopeIds = [state.qa.paperIds[0]];
        }

        App.api.askStream(q, state.qa.topK, (event) => {
          if (event.type === 'citations') {
            // 先到的资料来源：让「检索命中 N 段」立刻显示出来
            const snippets = App.adapter.evidenceFromHits(
              (event.snippets || []).map((s) => ({
                chunk_id: s.chunk_id,
                paper_id: s.paper_id,
                citation: s.citation,
                section_title: (s.citation || '').split('（')[0],
                page_start: s.index ? 0 : 0,
                text: s.text,
                score: 0,
              }))
            );
            // 两份数据要分开存：
            //   snippets  = 检索到的全部片段（用于「检索到但未引用」的说明）
            //   evidence  = 模型真正引用到的片段（用于角标与定位）
            // 只存前者会让「模型拒答」看起来像「什么都没检索到」，
            // 排查问题时会把方向带偏。
            answerMsg.snippets = snippets;
            answerMsg.evidence = snippets;
            answerMsg.thinking = false;
            notify('chats');
            return;
          }

          if (event.type === 'token') {
            answerMsg.text += event.text;
            answerMsg.thinking = false;
            notify('chats');
            return;
          }

          if (event.type === 'done') {
            // done 里的 answer 是服务端净化过的：编造的引用编号已被移除，
            // 因此这里用完整文本覆盖流式阶段显示的内容
            answerMsg.text = event.answer;
            // evidence 只保留「模型真正引用到」的片段；
            // 全部检索结果仍留在 answerMsg.snippets 里，
            // 这样界面能区分「没检索到」与「检索到了但模型没引用」
            answerMsg.evidence = App.adapter.evidenceFromHits(
              (event.citations || []).map((c) => ({
                chunk_id: c.chunk_id,
                paper_id: c.paper_id,
                citation: c.citation,
                section_title: (c.citation || '').split('（')[0],
                page_start: null,
                text: c.text,
                score: 1 / (c.index || 1),
                // 保留后端编号，面板显示时用它而不是数组下标，
                // 否则回答里的 [3] 在面板上会变成 [2]
                index: c.index,
              }))
            );
            answerMsg.invalidMarks = event.invalid_marks || [];
            answerMsg.refused = !!event.refused;
            answerMsg.mode = event.mode;
            answerMsg.streaming = false;
            state.qa.thinking = false;
            notify('chats');
            resolve();
            return;
          }

          if (event.type === 'error') {
            answerMsg.text = '回答生成失败：' + (event.message || '未知错误');
            answerMsg.streaming = false;
            answerMsg.error = true;
            state.qa.thinking = false;
            notify('chats');
            resolve();
          }
        }, scopeIds);
      });

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

    /* ===== 论文发现（arXiv） ===== */

    /**
     * 检索 arXiv。
     *
     * 为什么把 loading / error 都放进状态而不是只在视图里临时存：
     * 检索要 1~3 秒（arXiv 有速率限制），期间视图会被重绘，
     * 局部变量会丢；放在状态里才能稳定显示「正在检索…」。
     */
    async discoverSearch(query) {
      if (!hasApi()) return null;
      const q = String(query != null ? query : state.discover.query || '').trim();
      if (!q) {
        App.ui.toast('请输入关键词，例如 layer normalization', 'warn');
        return null;
      }
      state.discover.query = q;
      state.discover.loading = true;
      state.discover.error = null;
      notify('discover');
      try {
        const data = await App.api.searchArxiv(q, 10, state.discover.sort);
        state.discover.items = data.items || [];
        state.discover.total = data.total || 0;
        state.discover.hint = data.hint || null;
        state.discover.effectiveQuery = data.effective_query || '';
        return state.discover.items;
      } catch (err) {
        state.discover.items = [];
        state.discover.total = 0;
        state.discover.error = err.message || '检索失败';
        App.ui.toast('arXiv 检索失败：' + state.discover.error, 'error');
        return null;
      } finally {
        state.discover.loading = false;
        notify('discover');
      }
    },

    /**
     * 把一条检索结果下载入库，随后自动触发解析。
     *
     * 分成两步（入库 → 解析）而不是一步做完：
     * 入库只要 1~3 秒（下载 PDF），解析要几秒到几十秒（大论文更久）。
     * 先让用户看到「已入库」，再单独显示解析进度，比一直转圈体验好。
     */
    async discoverIngest(arxivId, force) {
      if (!hasApi() || !arxivId) return null;
      state.discover.ingesting[arxivId] = true;
      notify('discover');
      try {
        const res = await App.api.ingestArxiv(arxivId, force);

        if (!res.accepted) {
          // 检出重复：如实告诉用户与哪篇重复，并提示可强制入库
          App.ui.toast(
            (res.duplicate && res.duplicate.message) || res.message || '已存在相同论文',
            'warn', 4200
          );
          return res;
        }

        const paperId = res.paper && res.paper.id;
        App.ui.toast('已入库，正在解析…', 'ok');
        // 入库成功后刷新文库列表，界面立刻能看到新论文
        await actions.loadPapers();

        if (paperId) {
          try {
            await App.api.parsePaper(paperId);
          } catch (err) {
            App.ui.toast('解析失败：' + err.message, 'error');
          }
          await actions.loadPapers();
          // 标记该条已在库，避免用户重复点击
          state.discover.items = state.discover.items.map((it) =>
            it.arxivId === arxivId ? Object.assign({}, it, { inLibrary: true }) : it
          );
          App.ui.toast('《' + ((res.paper && res.paper.title) || arxivId) + '》已入库并解析', 'ok', 3200);
        }
        return res;
      } catch (err) {
        App.ui.toast('入库失败：' + (err.message || '未知错误'), 'error');
        return null;
      } finally {
        delete state.discover.ingesting[arxivId];
        notify('discover');
      }
    },

    setDiscoverSort(sort) {
      state.discover.sort = sort === 'recent' ? 'recent' : 'relevance';
      notify('discover');
      // 已经搜过一次的话，换排序后立即重搜，省得用户再点一次
      if (state.discover.query) actions.discoverSearch(state.discover.query);
    },

    /* ===== 推荐（旧演示数据接口，保留以免其它模块调用报错） ===== */
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
