/* ============================================================================
   adapter.js — 后端数据 → 视图数据的翻译层
   ----------------------------------------------------------------------------
   为什么需要这一层：
     视图层按照「演示数据」的形状来写（titleZh、keywords、cites、sections…），
     而后端返回的是另一套字段名（page_count、arxiv_id、parse_status…）。
     把翻译集中在这里，好处是：
       1. 视图代码一行都不用改
       2. 将来字段调整只改这个文件
       3. 后端暂时没有的字段，在这里给出安全默认值，
          视图不会因为 undefined 而显示 NaN 或崩掉

   原则：**能算出来的就算，算不出来的给安全默认值，绝不编造假数据。**
   例如 cites（被引次数）后端没有，就给 0，而不是塞一个好看的假数字。
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';

  /* ---------------- 小工具 ---------------- */

  /** 从文件名里提取版本号：xxx_v2.pdf → 'v2'，没有则 'v1' */
  function versionFromFileName(name) {
    const m = String(name || '').match(/[._-]v(\d+)\.pdf$/i);
    return m ? 'v' + m[1] : 'v1';
  }

  /** 后端 authors 是字符串（可能逗号或分号分隔），视图要数组 */
  function splitAuthors(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return String(value)
      .split(/[,;，；]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function splitKeywords(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return String(value)
      .split(/[,;，；]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** 解析状态 → 视图用的可读状态 */
  function statusOf(p) {
    const s = p.parse_status || 'queued';
    if (s === 'done') return 'done';
    if (s === 'need_review') return 'need_review';
    if (s === 'failed') return 'failed';
    if (s === 'parsing') return 'parsing';
    return 'queued';
  }

  /** 从 arXiv 编号推导年份：编号前两位是年份，后两位是月份。
   *  例：1706.03762 → 2017；9912.1234 → 1999。
   *  解析器不提取年份（年份常出现在版权行等位置，不可靠），
   *  而 arXiv 编号本身就编码了提交年月，用它补年份既准确又免费。
   */
  function yearFromArxiv(arxivId) {
    const m = String(arxivId || '').match(/^(\d{2})(\d{2})\./);
    if (!m) return null;
    const yy = parseInt(m[1], 10);
    // arXiv 从 1991 年开始，两位年份 < 91 视为 20xx，否则 19xx
    return yy < 91 ? 2000 + yy : 1900 + yy;
  }

  /* ---------------- 论文 ---------------- */

  /**
   * 后端 Paper → 视图 paper。
   * 后端有：id / file_name / size_bytes / title / authors / year / venue /
   *         arxiv_id / abstract / keywords / quality / page_count /
   *         starred / parse_status / added_at
   * 后端没有的（cites / figures / tables / formulas / citesIds / core 等）：
   *         给安全默认值，界面上显示为「—」或 0，不做假。
   */
  function paperFromApi(p) {
    if (!p) return null;
    const quality = typeof p.quality === 'number' ? p.quality : null;
    const status = statusOf(p);

    return {
      // ---- 与后端一一对应 ----
      id: p.id,
      file: p.file_name,
      title: p.title || p.file_name || '(未命名)',
      authors: splitAuthors(p.authors),
      // 后端没有年份时用 arXiv 编号推导（编号前两位即提交年份）
      year: p.year || yearFromArxiv(p.arxiv_id),
      venue: p.venue || null,
      arxiv: p.arxiv_id || null,
      abstract: p.abstract || '',
      keywords: splitKeywords(p.keywords),
      quality: quality,
      pages: p.page_count || 0,
      sizeBytes: p.size_bytes || 0,
      starred: !!p.starred,
      addedAt: p.added_at || p.created_at || null,
      parsedAt: p.updated_at || null,
      version: versionFromFileName(p.file_name),
      status: status,

      // ---- 视图需要但后端暂不提供的：安全默认值 ----
      // 这些字段在界面上会显示为 0 / 空，不会导致报错
      titleZh: '',
      abstractZh: '',
      scanned: status === 'need_review' && quality !== null && quality < 0.6,
      cites: 0,
      refs: 0,
      sections: 0,
      figures: 0,
      tables: 0,
      formulas: 0,
      citesIds: [],
      citedByIds: [],
      core: 'derived',

      // ---- 原始数据，便于调试时查看后端到底返回了什么 ----
      _raw: p,
    };
  }

  function papersFromApi(resp) {
    const items = (resp && (resp.items || resp.papers)) || [];
    return items.map(paperFromApi).filter(Boolean);
  }

  /* ---------------- 检索片段 ---------------- */

  /**
   * 后端检索命中 → 视图 evidence。
   * 视图读的是 e.section / e.page / e.relevance / e.text。
   * relevance 由 score 归一到 0~1：后端 RRF 分数没有绝对量纲，
   * 直接展示会是一串 0.03 之类的怪数字，归一后更直观。
   */
  function evidenceFromHit(hit, maxScore) {
    if (!hit) return null;
    const score = typeof hit.score === 'number' ? hit.score : 0;
    const top = maxScore && maxScore > 0 ? maxScore : score || 1;

    return {
      id: hit.chunk_id,
      paperId: hit.paper_id,
      section: hit.section_title || '正文',
      page: hit.page_start || 1,
      pageEnd: hit.page_end || hit.page_start || 1,
      text: hit.text || '',
      citation: hit.citation || '',
      sources: hit.sources || [],
      score: score,
      relevance: Math.max(0, Math.min(1, score / top)),
    };
  }

  function evidenceFromHits(hits) {
    const list = hits || [];
    const maxScore = list.reduce((m, h) => Math.max(m, h.score || 0), 0);
    return list.map((h) => evidenceFromHit(h, maxScore)).filter(Boolean);
  }

  /**
   * 用真实图谱数据替换图谱页的分组与洞察文案。
   *
   * 为什么必须替换：洞察面板的文案与分组条数来自演示数据，
   * 会显示「覆盖 20 篇论文、41 条引用边」这类与真实数据不符的数字。
   * 界面上的统计必须真实，否则等于在界面上编造数据。
   *
   * 规则（全部可由真实指标复算，不含人工判断）：
   *   foundation  入度 >= 2 的库内论文，按入度降序
   *   peripheral  入度为 0 的库内论文
   *   summary     由节点数、边数、连通分量数拼出的客观描述
   */
  function installGraphInsights(graphData) {
    if (!App.data || !App.store || !graphData) return false;
    const nodes = graphData.nodes || [];
    const summary = graphData.summary || {};
    const lib = nodes.filter((n) => n.inLibrary);

    // 分组下拉框：真实文库只有一个分组，条数用真实值
    App.data.graphGroups = [{
      id: 'g-transformer',
      name: '当前文库',
      count: lib.length,
    }];

    const foundation = nodes
      .filter((n) => n.core === 'foundation')
      .sort((a, b) => (b.inDegree - a.inDegree) || (b.pagerank - a.pagerank))
      .slice(0, 6)
      .map((n) => ({
        id: n.id,
        reason: '被库内 ' + n.inDegree + ' 篇论文引用，PageRank '
          + (n.pagerank || 0).toFixed(4),
      }));

    const peripheral = nodes
      .filter((n) => n.core === 'peripheral' || n.core === 'frontier')
      .slice(0, 6)
      .map((n) => ({
        id: n.id,
        reason: n.inDegree === 0
          ? '尚未被库内其它论文引用（出度 ' + n.outDegree + '）'
          : '被引 ' + n.inDegree + ' 次',
      }));

    const text = [
      '当前文库 ' + lib.length + ' 篇论文，外部被引文献 ' + (summary.external || 0) + ' 篇，',
      '共 ' + (summary.edgeCount || 0) + ' 条引用边，形成 ' + (summary.clusters || 0) + ' 个连通分支。',
      foundation.length
        ? '被库内论文引用最多的是《' + (nodes.find((n) => n.id === foundation[0].id) || {}).title + '》。'
        : '库内论文之间暂未形成互相引用，建议上传同一方向的相关论文后重建引用关系。',
      (summary.isolated || []).length
        ? '另有 ' + summary.isolated.length + ' 篇论文与库内其它论文没有引用关系。'
        : '',
    ].join('');

    App.data.graphInsights = App.data.graphInsights || {};
    App.data.graphInsights['g-transformer'] = {
      foundation: foundation,
      peripheral: peripheral,
      summary: text,
      // 未来工作方向来自演示数据，真实数据没有可靠依据，置空而不是编造
      futureWork: [],
    };
    return true;
  }

  App.adapter = {
    paperFromApi,
    papersFromApi,
    evidenceFromHit,
    evidenceFromHits,
    versionFromFileName,
    splitAuthors,
    splitKeywords,
    statusOf,
    docFromChunks,
    graphFromApi,
    yearFromArxiv,
    installGraphInsights,
    installDataBridge,
  };

  /* ---------------- 引用图谱适配 ----------------
     后端 /graph 返回的是「节点 + 边 + 指标」，而图谱视图是从
     「每篇论文的 citesIds」自行推导边与度量的。
     这里把边反查成每篇的引用列表，视图侧只需换一个数据来源即可。
     ------------------------------------------------------------------ */

  /**
   * 后端图谱 → 视图认识的节点结构。
   *
   * core（基石/前沿/边缘）在演示数据里是人工标注的；
   * 真实数据没有这等人工判断，这里用可解释的规则推导：
   *   入度 >= 2              → foundation（基石：被多篇库内论文引用）
   *   入度 = 0 且出度 >= 3   → frontier（前沿：大量引用他人但尚未被引）
   *   入度 = 0               → peripheral（边缘）
   *   其余                   → derived（一般）
   * 外部论文（未入库）标 external，图上可见但不可进入阅读器。
   */
  function graphFromApi(data) {
    const cites = {};
    const citedBy = {};
    (data.edges || []).forEach((e) => {
      (cites[e.source] = cites[e.source] || []).push(e.target);
      (citedBy[e.target] = citedBy[e.target] || []).push(e.source);
    });

    const libraryIds = {};
    (data.nodes || []).forEach((n) => {
      if (n.in_library) libraryIds[n.id] = true;
    });

    const nodes = (data.nodes || []).map((n) => {
      let core = 'derived';
      if (!n.in_library) {
        core = 'external';
      } else if ((n.in_degree || 0) >= 2) {
        core = 'foundation';
      } else if ((n.in_degree || 0) === 0 && (n.out_degree || 0) >= 3) {
        core = 'frontier';
      } else if ((n.in_degree || 0) === 0) {
        core = 'peripheral';
      }

      return {
        id: n.id,
        title: n.label,
        authors: [],
        year: n.year || yearFromArxiv(n.arxiv_id),
        venue: n.venue || null,
        arxiv: n.arxiv_id || null,
        quality: null,
        core: core,
        inLibrary: !!n.in_library,
        inDegree: n.in_degree || 0,
        outDegree: n.out_degree || 0,
        pagerank: n.pagerank || 0,
        cluster: n.cluster || 0,
        // 只保留指向库内节点的边：外部节点在图上没有引用数据，
        // 把它们算进边集合会污染度量
        citesIds: (cites[n.id] || []).filter((t) => libraryIds[t]),
        citedByIds: (citedBy[n.id] || []).filter((s) => libraryIds[s]),
      };
    });

    return {
      nodes: nodes,
      edges: (data.edges || []).map((e) => ({ from: e.source, to: e.target })),
      summary: {
        library: data.library_count || 0,
        external: data.external_count || 0,
        edgeCount: data.edge_count || 0,
        clusters: data.cluster_count || 0,
        topPagerank: data.top_by_pagerank || [],
        topInDegree: data.top_by_in_degree || [],
        isolated: data.isolated || [],
      },
    };
  }

  /* ---------------- 阅读器数据桥 ----------------
     阅读器（views/reader.js）调用 App.data.getPaper / getDoc 取数据，
     而这两个函数只认演示数据。这里在演示数据之上做一层桥接：
       · getPaper：演示数据里没有的 id，从真实文库（store.state.papers）里找
       · getDoc  ：演示数据里没有的正文，用后端分块拼出来
     这样 reader.js 一行都不用改，两种数据源可以并存：
     演示论文看完整（含译文/图表），真实论文看真实正文。
     ------------------------------------------------------------------ */

  /**
   * 用后端分块拼出阅读器需要的 doc 结构。
   *
   * 说明：块的边界由检索分块策略决定（约 700 字符、相邻带重叠），
   * 所以相邻段落可能重复少量文字——这是为检索召回率做的取舍。
   * 真实论文暂不提供中文译文，zh 留空（见已知问题 F-03）。
   */
  function docFromChunks(resp, paperId) {
    const blocks = [];
    const toc = [];
    let currentSection = null;

    (resp.chunks || []).forEach((c, i) => {
      const section = c.section_title || '正文';
      if (section !== currentSection) {
        currentSection = section;
        const id = 'sec-' + i;
        blocks.push({
          id: id,
          type: 'h2',
          en: section,
          zh: section,          // 章节名通常已是英文，双语模式下两侧一致
          page: c.page_start,
        });
        toc.push({ id: id, title: section, level: 2 });
      }
      blocks.push({
        id: 'b' + c.chunk_index,
        type: 'p',
        en: c.text,
        // 译文来自后端（chunk_translations 表），未翻译时为空字符串：
        // 双语模式下右侧留空，而不是显示英文冒充中文
        zh: c.text_zh || '',
        page: c.page_start,
        pageEnd: c.page_end,
        chunkId: c.id,
      });
    });

    return {
      paperId: paperId,
      isReal: true,
      pageCount: resp.page_count,
      totalChunks: resp.total_chunks,
      translatedChunks: resp.translated_chunks || 0,
      blocks: blocks,
      toc: toc,
    };
  }

  /** 安装数据桥（在 store 就绪后调用一次） */
  function installDataBridge() {
    if (!App.data || !App.store) return false;
    if (App.data.__bridged) return true;
    App.data.__bridged = true;

    const rawGetDoc = App.data.getDoc.bind(App.data);
    const rawGetPaper = App.data.getPaper.bind(App.data);

    // ---- 论文：演示数据优先，找不到则查真实文库 ----
    App.data.getPaper = function (paperId) {
      const fromMock = rawGetPaper(paperId);
      if (fromMock) return fromMock;
      const papers = (App.store.state && App.store.state.papers) || [];
      return papers.find((p) => p.id === paperId) || null;
    };

    // ---- 正文：演示数据优先，找不到则用后端分块（异步加载 + 缓存）----
    const docs = {};      // paperId → doc | 'loading' | null

    App.data.getDoc = function (paperId) {
      const fromMock = rawGetDoc(paperId);
      if (fromMock) return fromMock;
      if (!paperId) return null;

      if (docs[paperId] !== undefined) {
        return docs[paperId] === 'loading' ? null : docs[paperId];
      }

      // 后端不可用时不发起请求，避免控制台刷错误
      if (!App.api || typeof App.api.paperChunks !== 'function') return null;

      docs[paperId] = 'loading';
      App.api.paperChunks(paperId)
        .then((resp) => {
          docs[paperId] = docFromChunks(resp, paperId);
          App.store.notify('reader');
        })
        .catch((err) => {
          docs[paperId] = null;
          if (App.ui && App.ui.toast) {
            App.ui.toast('加载正文失败：' + err.message, 'error');
          }
          App.store.notify('reader');
        });

      // 首次调用返回 null，视图显示「暂无正文」，数据到达后 notify 会重绘
      return null;
    };

    App.data.invalidateDoc = function (paperId) {
      delete docs[paperId];
    };

    return true;
  }
})(window.App);
