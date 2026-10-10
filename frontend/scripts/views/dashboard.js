/* ============================================================================
   views/dashboard.js — 工作台（首页总览）
   ----------------------------------------------------------------------------
   这一页回答三个问题：
     1. 我的文库现在什么状态？（统计卡片）
     2. 哪些论文解析得好、哪些需要校对？（解析质量表）
     3. 我接下来该做什么？（快捷入口 + 产品能力清单）

   代码约定：quickHtml / qualityRowsHtml / capMapHtml 都是【纯函数】，
   只返回 HTML（用 App.ui.Out 包好），由 render() 一次拼装完成。
   这样数据流是单向的，也便于自动化测试。
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  function render(el) {
    const papers = App.store.state.papers;
    const totalPages = papers.reduce((a, p) => a + (p.pages || 0), 0);
    const totalRefs = papers.reduce((a, p) => a + (p.refs || 0), 0);
    const scanned = papers.filter((p) => p.scanned).length;
    const avgQ = papers.reduce((a, p) => a + (p.quality || 0), 0) / (papers.length || 1);
    const needReview = papers.filter((p) => (p.quality || 0) < 0.88).length;
    const longest = Math.max.apply(null, papers.map((p) => p.pages || 0));

    el.innerHTML = h`
      <div class="view-head">
        <div>
          <div class="view-title">科研小助手 · 工作台</div>
          <div class="view-desc">
            一个面向科研文献的 AI Agent：把 PDF 变成可检索、可问答、可引用、可写作的结构化知识。
            下面是你的文库概况与推荐下一步动作。
          </div>
        </div>
      </div>

      ${App.ui.sectionTitle('文库概况')}
      <div class="grid grid-4">
        ${App.ui.statCard({ icon: '▤', label: '论文数量', value: papers.length, unit: '篇', trend: '含 ' + scanned + ' 篇扫描件' })}
        ${App.ui.statCard({ icon: '❐', label: '累计页数', value: U.num(totalPages), unit: '页', trend: '最长单篇 ' + longest + ' 页' })}
        ${App.ui.statCard({ icon: '⇄', label: '参考文献条目', value: U.num(totalRefs), unit: '条', trend: '可自动批量下载 PDF' })}
        ${App.ui.statCard({ icon: '✓', label: '平均解析置信度', value: U.pct(avgQ, 1), trend: needReview + ' 篇需要人工校对' })}
      </div>

      ${App.ui.sectionTitle('快捷入口', '<span class="muted tiny">点一下就能看到对应功能</span>')}
      <div class="grid grid-3" id="quick">
        ${quickHtml()}
      </div>

      ${App.ui.sectionTitle('解析质量一览', '<span class="muted tiny">质量分由版面还原、公式识别、表格结构三部分加权得出</span>')}
      <div class="card">
        <div class="card-head">
          <div class="card-title">论文解析结果</div>
          <div class="spacer"></div>
          <span class="muted small">点击行可查看结构化解析详情</span>
        </div>
        <div style="max-height:420px;overflow:auto">
          <table class="table">
            <thead>
              <tr>
                <th style="width:34%">论文</th><th>页数</th><th>章节</th><th>图表</th>
                <th>公式</th><th>参考文献</th><th>解析质量</th><th style="width:110px"></th>
              </tr>
            </thead>
            <tbody id="qtable">
              ${qualityRowsHtml()}
            </tbody>
          </table>
        </div>
      </div>

      ${App.ui.sectionTitle('能力地图', '<span class="muted tiny">对应需求文档第 1 章的六组功能</span>')}
      <div class="grid grid-3" id="capmap">
        ${capMapHtml()}
      </div>
    `;
  }

  /* ---------------- 快捷入口 ---------------- */
  function quickHtml() {
    const items = [
      { icon: '⇪', title: '上传并解析 PDF', desc: '支持批量上传、自动去重、扫描件 OCR', route: 'library', cta: '去文库' },
      { icon: '❐', title: '结构化阅读', desc: '树状目录 + 中英对照 + 引文点击跳转', route: 'reader', cta: '打开阅读器' },
      { icon: '✦', title: '基于原文问答', desc: '回答必带出处角标，可直接点回原文核对', route: 'qa', cta: '开始提问' },
      { icon: '⬡', title: '引文网络分析', desc: '识别基石论文与边缘衍生论文，自动生成综述', route: 'graph', cta: '查看图谱' },
      { icon: '☄', title: '发现新论文', desc: '定期抓取 arXiv，按你的文库做相关性推荐', route: 'discover', cta: '看看推荐' },
      { icon: '✎', title: '写作助手', desc: '框架生成、TikZ/Mermaid 图代码、CSV 可视化', route: 'writing', cta: '开始写作' },
    ];
    return App.ui.Out(items.map((it) => h`
      <div class="card quick-card" data-action="go" data-route="${it.route}">
        <div class="card-body">
          <div class="row gap-12">
            <div class="quick-icon">${it.icon}</div>
            <div class="grow">
              <div style="font-weight:650">${it.title}</div>
              <div class="muted small">${it.desc}</div>
            </div>
          </div>
          <div class="row mt-12" style="justify-content:flex-end">
            <span class="badge badge-brand">${it.cta} →</span>
          </div>
        </div>
      </div>`).join(''));
  }

  /* ---------------- 解析质量表（按质量升序，最需校对的排最前） ---------------- */
  function qualityRowsHtml() {
    const papers = App.store.state.papers.slice().sort((a, b) => (a.quality || 0) - (b.quality || 0));
    return App.ui.Out(papers.map((p) => h`
      <tr data-action="parse-detail" data-id="${p.id}" style="cursor:pointer">
        <td>
          <div class="ellipsis" style="max-width:330px">${p.title}</div>
          <div class="muted tiny mono">${p.file}${p.scanned ? ' · 扫描件' : ''}</div>
        </td>
        <td class="mono">${p.pages}</td>
        <td class="mono">${p.sections}</td>
        <td class="mono">${p.figures} / ${p.tables}</td>
        <td class="mono">${p.formulas}</td>
        <td class="mono">${p.refs}</td>
        <td>${App.ui.qualityBadge(p.quality)}</td>
        <td class="muted small nowrap">查看详情 →</td>
      </tr>`).join(''));
  }

  /* ---------------- 能力地图 ---------------- */
  function capMapHtml() {
    const caps = [
      { n: '1.1', t: 'PDF 管理与解析', d: 'CRUD、批量上传、内容去重、细粒度结构抽取（标题 / 作者 / 摘要 / 多级标题 / 表格 / 图表 / 公式 / 参考文献 / 附录）', route: 'library' },
      { n: '1.2', t: '知识问答', d: '单篇与多篇论文问答；通过 RAG 检索原文片段，回答附带出处，便于发现幻觉', route: 'qa' },
      { n: '1.3', t: '阅读与翻译', d: '双栏 / 单栏还原、树状导航、引文跳转、划词翻译、整篇翻译、中英同步对比滚动', route: 'reader' },
      { n: '1.4', t: '下载与推荐', d: '按论文名自动下载入库、抓取参考文献、定期刷新 arXiv、按兴趣推荐并给出理由', route: 'discover' },
      { n: '1.5', t: '分析与生成', d: '局域引用图谱、核心节点挖掘、领域自动综述、未来工作探索建议', route: 'graph' },
      { n: '1.6', t: '写作助手', d: '论文框架生成、TikZ / Graphviz / Mermaid 架构图、CSV 数据可视化与图注生成、中译英', route: 'writing' },
    ];
    return App.ui.Out(caps.map((c) => h`
      <div class="card cap-card" data-action="go" data-route="${c.route}">
        <div class="card-body">
          <div class="row gap-8 mb-8">
            <span class="badge badge-brand mono">需求 ${c.n}</span>
            <span style="font-weight:650">${c.t}</span>
          </div>
          <div class="muted small">${c.d}</div>
        </div>
      </div>`).join(''));
  }

  App.views = App.views || {};
  App.views.dashboard = { render, quickHtml, qualityRowsHtml, capMapHtml };
})(window.App);
