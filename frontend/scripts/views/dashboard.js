/* ============================================================================
   views/dashboard.js — 工作台（首页总览）
   ----------------------------------------------------------------------------
   设计原则（这一版重做的主要原因）：
     1. 只展示真实数据。旧版的「解析质量表」里有图表 / 公式 / 参考文献三列，
        但后端并不提供这些字段，界面上一直显示 0 —— 那不是「还没解析」，
        而是根本没有这个字段，属于界面在编造数据，已整表移除。
     2. 三段式，一屏看完：主操作 → 数据概览 → 最近动态。
        旧版把「统计 / 快捷入口 / 解析表 / 能力地图」四块平铺，
        共 16 张卡片，没有视觉重点，看起来像后台原型。
     3. 卡片数量 16 → 4：快捷入口改成一行文字链接，
        能力地图移到「说明 / 对照表」页（那里本来就是需求对照表，重复展示没有意义）。

   代码约定：各段都是【纯函数】，只返回 HTML（用 App.ui.Out 包好），
   由 render() 一次拼装，数据流单向、便于自动化测试。
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  /* ---------------- 主渲染 ---------------- */
  function render(el) {
    const papers = App.store.state.papers || [];
    el.innerHTML = h`
      ${heroHtml(papers)}
      ${statsHtml(papers)}
      <div class="dash-grid">
        ${recentHtml(papers)}
        ${reviewHtml(papers)}
      </div>
      ${footHtml()}
    `;
  }

  /* ---------------- ① 主操作区 ----------------
     第一印象只需要回答「这个工具是干什么的、我现在该点哪里」。
     两个按钮足够：上传论文（新用户）与开始提问（已有数据的用户）。 */
  function heroHtml(papers) {
    const n = papers.length;
    return App.ui.Out(h`
      <section class="hero">
        <div class="hero-eyebrow">科研小助手 Agent · Research Copilot</div>
        <h1 class="hero-title">把论文变成可问答、可引用、可写作的知识库</h1>
        <p class="hero-sub">
          上传 PDF 后自动解析、分块并向量化；提问时先检索原文片段再作答，
          每个结论都带出处角标，可点回原文核对；同一方向的论文还会连成引用网络。
        </p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" data-action="pick-files">上传论文</button>
          <button class="btn btn-lg" data-action="go" data-route="${n ? 'qa' : 'library'}">
            ${n ? '开始提问' : '查看文库'}
          </button>
          <button class="btn btn-lg btn-ghost" data-action="go" data-route="guide">功能说明</button>
        </div>
      </section>`);
  }

  /* ---------------- ② 数据概览 ----------------
     四个大数字，去掉卡片边框，让它们成为视觉焦点而不是四张小卡片。
     全部来自真实数据；没有数据时显示「—」而不是 0，避免看起来像坏了。 */
  function statsHtml(papers) {
    const n = papers.length;
    const totalPages = papers.reduce((a, p) => a + (p.pages || 0), 0);
    const done = papers.filter((p) => p.status === 'done').length;
    const withQ = papers.filter((p) => typeof p.quality === 'number');
    const avgQ = withQ.length
      ? withQ.reduce((a, p) => a + p.quality, 0) / withQ.length
      : null;

    const items = [
      { num: n ? U.num(n) : '—', label: '篇论文', note: n ? '当前文库' : '还没有上传论文' },
      { num: totalPages ? U.num(totalPages) : '—', label: '页', note: totalPages ? '累计解析页数' : '解析后可统计' },
      { num: done ? U.num(done) : '—', label: '篇已解析', note: n ? `共 ${n} 篇` : '—' },
      { num: avgQ === null ? '—' : U.pct(avgQ, 1), label: '解析置信度', note: avgQ === null ? '待解析' : '平均值' },
    ];

    return App.ui.Out(h`
      <div class="stat-row">
        ${U.raw(items.map((it) => h`
          <div class="stat">
            <div class="stat-num">${it.num}<span class="stat-unit">${it.label}</span></div>
            <div class="stat-note">${it.note}</div>
          </div>`).join(''))}
      </div>`);
  }

  /* ---------------- ③ 最近论文 ---------------- */
  function recentHtml(papers) {
    const list = papers
      .slice()
      .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')))
      .slice(0, 5);

    return App.ui.Out(h`
      <section class="card dash-card">
        <div class="card-head">
          <div class="card-title">最近上传</div>
          <div class="spacer"></div>
          <a class="dash-more" data-action="go" data-route="library">全部 ${papers.length} 篇 →</a>
        </div>
        <div class="card-body tight">
          ${list.length
            ? U.raw(list.map((p) => rowHtml(p)).join(''))
            : U.raw(h`${App.ui.empty('▤', '还没有论文，点上方「上传论文」开始', null)}`)}
        </div>
      </section>`);
  }

  /** 一行论文：标题 + 元信息 + 状态徽标（只用后端真有的字段） */
  function rowHtml(p) {
    const meta = [U.clip((p.authors || []).join(', '), 42), p.year, p.pages ? p.pages + ' 页' : '']
      .filter(Boolean).join(' · ');
    return App.ui.Out(h`
      <div class="dash-item" data-action="open-paper" data-id="${p.id}">
        <div class="grow" style="min-width:0">
          <div class="dash-item-title ellipsis">${p.title}</div>
          <div class="dash-item-meta ellipsis">${meta || p.file}</div>
        </div>
        ${statusBadge(p.status)}
      </div>`);
  }

  function statusBadge(status) {
    const map = {
      done: ['已解析', 'badge-ok'],
      need_review: ['需校对', 'badge-warn'],
      failed: ['失败', 'badge-danger'],
      parsing: ['解析中', 'badge-outline'],
      queued: ['待解析', 'badge-outline'],
    };
    const [text, cls] = map[status] || map.queued;
    return App.ui.Out(h`<span class="badge ${cls}">${text}</span>`);
  }

  /* ---------------- ④ 需要校对 ----------------
     只列真正需要人工介入的论文（置信度低或解析失败），最多 3 条。
     旧版把全部论文做成 8 列的表格，其中 5 列是假数据，信息量大但价值低。 */
  function reviewHtml(papers) {
    const need = papers
      .filter((p) => p.status === 'failed' || (typeof p.quality === 'number' && p.quality < 0.88))
      .sort((a, b) => (a.quality || 0) - (b.quality || 0))
      .slice(0, 3);

    return App.ui.Out(h`
      <section class="card dash-card">
        <div class="card-head">
          <div class="card-title">需要注意</div>
          <div class="spacer"></div>
          <span class="dash-more">${need.length ? need.length + ' 篇' : '无需处理'}</span>
        </div>
        <div class="card-body tight">
          ${need.length
            ? U.raw(need.map((p) => h`
              <div class="dash-item" data-action="parse-detail" data-id="${p.id}">
                <div class="grow" style="min-width:0">
                  <div class="dash-item-title ellipsis">${p.title}</div>
                  <div class="dash-item-meta">${p.status === 'failed' ? '解析失败，可重新解析' : '置信度偏低，建议人工校对'}</div>
                </div>
                ${p.status === 'failed'
                  ? App.ui.Out(h`<span class="badge badge-danger">失败</span>`)
                  : App.ui.qualityBadge(p.quality)}
              </div>`).join(''))
            : U.raw(h`
              <div class="dash-ok">
                <span class="dash-ok-mark">✓</span>
                所有论文解析质量正常，没有需要人工校对的条目
              </div>`)}
        </div>
      </section>`);
  }

  /* ---------------- ⑤ 底部链接 ----------------
     快捷入口原来占 6 张卡片；实际使用时主要靠左侧导航，
     首页只需要把它们收成一行文字链接，作为「不知道去哪时」的补充。 */
  function footHtml() {
    const links = [
      { route: 'qa', text: '基于原文问答' },
      { route: 'graph', text: '引用图谱' },
      { route: 'discover', text: '发现新论文' },
      { route: 'writing', text: '写作助手' },
      { route: 'guide', text: '说明与需求对照' },
    ];
    return App.ui.Out(h`
      <footer class="dash-foot">
        <span class="muted small">还在探索？</span>
        ${U.raw(links.map((l) => h`
          <a class="dash-link" data-action="go" data-route="${l.route}">${l.text}</a>`).join(''))}
      </footer>`);
  }

  App.views = App.views || {};
  App.views.dashboard = { render, heroHtml, statsHtml, recentHtml, reviewHtml, footHtml };
})(window.App);
