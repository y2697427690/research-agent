/* ============================================================================
   views/graph.js — 引用图谱与论文分析
   ----------------------------------------------------------------------------
   对应需求 1.5「论文分析与生成」：
     1.5.1 局域图谱生成 —— 一次性上传 20 篇 PDF，自动解析引用 / 被引用关系并可视化
     1.5.2 核心节点挖掘 —— 图论算法算出「基石论文」与「边缘衍生论文」
     1.5.3 自动综述     —— 依据图谱结果自动生成该领域的简短综述
     1.5.4 未来工作探索 —— 依据多篇论文的 Future Work，提出尚未被尝试的方向

   图谱绘制说明：
     使用原生 SVG。节点位置由「确定性的力导向迭代」在渲染前算好
     （随机种子固定 → 每次刷新布局一致，便于演示与截图）。
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  let positions = {};
  let graphSize = { w: 880, h: 560 };

  /* ==========================================================================
     1. 主渲染
     ========================================================================== */
  function render(el) {
    const st = App.store.state;
    const groups = App.data.graphGroups;
    const gid = st.graph.groupId;
    const group = groups.find((g) => g.id === gid) || groups[0];
    const nodes = collectNodes();

    el.innerHTML = h`
      <div class="view-head">
        <div class="grow">
          <div class="view-title">引用图谱与论文分析</div>
          <div class="view-desc">
            批量上传同一方向的论文后，系统会解析论文之间的引用与被引用关系，构建引用网络；
            再用图论指标（入度、PageRank、介数中心性）识别领域内的基石论文与边缘衍生论文。
          </div>
        </div>
        <select class="select" id="ggroup" style="width:250px">
          ${U.raw(groups.map((g) => h`<option value="${g.id}" ${g.id === gid ? 'selected' : ''}>${g.name}（${g.count} 篇）</option>`).join(''))}
        </select>
      </div>

      <div class="graph-layout">
        <div class="card">
          <div class="card-head">
            <div class="card-title">引用网络 · ${group.name}</div>
            <div class="spacer"></div>
            <div class="row gap-4" style="background:var(--bg-2);padding:3px;border-radius:10px">
              <button class="btn btn-sm ${st.graph.layout === 'force' ? 'btn-primary' : 'btn-ghost'}" data-action="graph-layout" data-layout="force">力导向</button>
              <button class="btn btn-sm ${st.graph.layout === 'radial' ? 'btn-primary' : 'btn-ghost'}" data-action="graph-layout" data-layout="radial">按时间环</button>
            </div>
            <button class="btn btn-sm btn-ghost" data-action="graph-toggle-core">
              ${st.graph.highlightCore ? '隐藏核心高亮' : '显示核心高亮'}
            </button>
            ${(() => {
              const ext = st.graphData && st.graphData.summary ? st.graphData.summary.external : 0;
              if (!ext) return '';
              return U.raw(h`
                <button class="btn btn-sm ${st.graph.showExternal ? 'btn-primary' : 'btn-ghost'}" data-action="graph-toggle-external">
                  ${st.graph.showExternal ? '只看库内论文' : '显示外部文献（' + ext + '）'}
                </button>`);
            })()}
          </div>
          <div class="card-body" style="padding:0">
            <div class="graph-canvas" id="gcanvas"></div>
          </div>
          <div class="card-foot">
            <div class="row gap-16 wrap small muted">
              <span><i class="lg-dot" style="background:#e2a336"></i> 基石论文（高入度）</span>
              <span><i class="lg-dot" style="background:#4f6ef7"></i> 主干论文</span>
              <span><i class="lg-dot" style="background:#2fb37a"></i> 前沿论文（2024+）</span>
              <span><i class="lg-dot" style="background:#5b6379"></i> 边缘衍生论文</span>
              <span>箭头方向 = 引用方向（A → B 表示 A 引用了 B）</span>
            </div>
          </div>
        </div>

        <aside class="graph-side" id="gside"></aside>
      </div>

      ${App.ui.sectionTitle('核心节点挖掘', '<span class="muted tiny">对应需求 1.5.2：基石论文 vs 边缘衍生论文</span>')}
      <div class="grid grid-2" id="insights"></div>

      ${App.ui.sectionTitle('自动综述', '<span class="muted tiny">对应需求 1.5.3：大模型依据图谱结果生成领域综述</span>')}
      <div class="card mb-16">
        <div class="card-body">
          <div class="row gap-8 mb-12">
            <button class="btn btn-primary" id="gen-summary">✦ 生成领域综述</button>
            <span class="muted tiny">基于 ${nodes.length} 个节点与 ${countEdges()} 条引用边</span>
          </div>
          <div id="summary-box" class="summary-box">
            <div class="muted small">点击上方按钮，Agent 会读取图谱结构 + 各论文摘要，输出该领域的简短综述。</div>
          </div>
        </div>
      </div>

      ${App.ui.sectionTitle('未来工作探索', '<span class="muted tiny">对应需求 1.5.4：排除已被最新论文尝试过的 idea</span>')}
      <div class="grid grid-2" id="future"></div>
    `;

    drawGraph(nodes);
    renderSide(nodes);
    renderInsights(nodes);
    bind(el);
  }

  /* ==========================================================================
     2. 数据准备
     ========================================================================== */
  /** 参与图谱的论文（有引用关系的主干集合） */
  function collectNodes() {
    // 有真实数据时优先用后端的引用图（含未入库的外部节点）。
    // 外部节点只有入边、没有引用数据，图上可见但不可进入阅读器。
    const real = App.store.state.graphData;
    if (real && real.nodes && real.nodes.length) {
      // 默认只显示库内论文：外部文献通常上百个，全画出来会挤成一团、
      // 标签互相遮挡，反而看不出结构。需要时用顶部开关展开。
      return App.store.state.graph.showExternal
        ? real.nodes
        : real.nodes.filter((n) => n.inLibrary);
    }

    const ids = {};
    App.store.state.papers.forEach((p) => {
      if ((p.citesIds || []).length || (p.citedByIds || []).length) ids[p.id] = p;
    });
    ['p-attention-v7', 'p-bert', 'p-gpt1', 'p-gpt2', 'p-gpt3', 'p-vit', 'p-lora', 'p-switch',
      'p-llama', 'p-deepseekv2', 'p-r1', 'p-rag', 'p-flash'].forEach((id) => {
      const p = App.data.getPaper(id);
      if (p) ids[id] = p;
    });
    return Object.keys(ids).map((k) => ids[k]);
  }

  function collectEdges(nodes) {
    const set = {};
    nodes.forEach((n) => { set[n.id] = true; });
    const edges = [];
    nodes.forEach((n) => {
      (n.citesIds || []).forEach((t) => { if (set[t]) edges.push({ from: n.id, to: t }); });
    });
    return edges;
  }

  function countEdges() { return collectEdges(collectNodes()).length; }

  /** 入度 / 出度 / 综合评分（核心节点判定的依据） */
  function metrics(nodes) {
    const edges = collectEdges(nodes);
    const m = {};
    nodes.forEach((n) => { m[n.id] = { in: 0, out: 0, score: 0 }; });
    edges.forEach((e) => {
      if (m[e.to]) m[e.to].in++;
      if (m[e.from]) m[e.from].out++;
    });
    nodes.forEach((n) => {
      // 简化 PageRank：以入度为主，基石/前沿加权，出度过高（综述型）轻微抑制
      m[n.id].score = m[n.id].in
        + (n.core === 'foundation' ? 1.6 : 0)
        + (n.core === 'frontier' ? 0.8 : 0)
        - m[n.id].out * 0.06;
    });
    return { m, edges };
  }

  /* ==========================================================================
     3. 布局：确定性力导向 / 按时间环
     ========================================================================== */
  function layout(nodes, mode) {
    const W = graphSize.w, H = graphSize.h;
    const pos = {};
    const rnd = U.seeded('graph-' + mode + '-' + nodes.length);

    nodes.forEach((n, i) => {
      const a = (Math.PI * 2 * i) / Math.max(1, nodes.length);
      const r = 0.34 * Math.min(W, H);
      pos[n.id] = {
        x: W / 2 + Math.cos(a) * r + (rnd() - 0.5) * 24,
        y: H / 2 + Math.sin(a) * r + (rnd() - 0.5) * 24,
      };
    });

    if (mode === 'radial') {
      const years = nodes.map((n) => n.year);
      const minY = Math.min.apply(null, years), maxY = Math.max.apply(null, years);
      const byYear = U.groupBy(nodes, (n) => n.year);
      Object.keys(byYear).forEach((y) => {
        const k = (y - minY) / Math.max(1, maxY - minY);
        const list = byYear[y];
        list.forEach((n, i) => {
          const a = (Math.PI * 2 * i) / list.length - Math.PI / 2;
          const r = 70 + k * (Math.min(W, H) / 2 - 90);
          pos[n.id] = { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r };
        });
      });
      return pos;
    }

    /* ---- 力导向迭代 ---- */
    const edges = collectEdges(nodes);
    const idx = {};
    nodes.forEach((n, i) => { idx[n.id] = i; });

    // 斥力常数原本按 20 个节点左右调过。节点上百时若不放大，
    // 所有点会挤成一小团；节点多时也适当减少迭代次数以控制耗时。
    const repelScale = Math.max(1, nodes.length / 40);
    const iterations = nodes.length > 100 ? 200 : 300;

    for (let iter = 0; iter < iterations; iter++) {
      const disp = nodes.map(() => ({ x: 0, y: 0 }));
      // 节点间斥力
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = pos[nodes[i].id], b = pos[nodes[j].id];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = rnd() - 0.5; dy = rnd() - 0.5; d2 = 1; }
          const f = (26000 * repelScale) / d2;
          const d = Math.sqrt(d2);
          disp[i].x += (dx / d) * f; disp[i].y += (dy / d) * f;
          disp[j].x -= (dx / d) * f; disp[j].y -= (dy / d) * f;
        }
      }
      // 边上的引力（让互相引用的论文聚在一起）
      edges.forEach((e) => {
        const i = idx[e.from], j = idx[e.to];
        if (i == null || j == null) return;
        const a = pos[e.from], b = pos[e.to];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = (d - 120) * 0.02;
        disp[i].x += (dx / d) * f; disp[i].y += (dy / d) * f;
        disp[j].x -= (dx / d) * f; disp[j].y -= (dy / d) * f;
      });
      // 向心力 + 位移限幅
      const cool = 0.10 * (1 - iter / iterations) + 0.01;
      nodes.forEach((n, i) => {
        disp[i].x += (W / 2 - pos[n.id].x) * 0.012;
        disp[i].y += (H / 2 - pos[n.id].y) * 0.012;
        const len = Math.max(1, Math.hypot(disp[i].x, disp[i].y));
        const cap = 34;
        pos[n.id].x += (disp[i].x / len) * Math.min(cap, len * cool * 4);
        pos[n.id].y += (disp[i].y / len) * Math.min(cap, len * cool * 4);
        pos[n.id].x = Math.max(60, Math.min(W - 60, pos[n.id].x));
        pos[n.id].y = Math.max(46, Math.min(H - 40, pos[n.id].y));
      });
    }
    return pos;
  }

  /* ==========================================================================
     4. 绘制 SVG
     ========================================================================== */
  function drawGraph(nodes) {
    const canvas = U.$('#gcanvas');
    if (!canvas) return;
    const st = App.store.state;
    const w = canvas.clientWidth || 880;
    graphSize = { w: Math.max(680, w), h: Math.max(480, Math.round(Math.max(680, w) * 0.62)) };
    canvas.style.height = graphSize.h + 'px';

    positions = layout(nodes, st.graph.layout);
    const met = metrics(nodes);
    const m = met.m, edges = met.edges;
    const maxIn = Math.max.apply(null, nodes.map((n) => m[n.id].in).concat([1]));

    const color = (n) => {
      if (st.graph.highlightCore && m[n.id].in >= Math.max(2, maxIn * 0.7)) return '#e2a336';
      if (n.core === 'foundation') return '#4f6ef7';
      if (n.core === 'frontier') return '#2fb37a';
      if (n.core === 'textbook') return '#8b5cf6';
      return '#5b6379';
    };

    const defs = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" ' +
      'markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.25)"/></marker></defs>';

    // ---- 引用边 ----
    let edgeSvg = '';
    edges.forEach((e) => {
      const a = positions[e.from], b = positions[e.to];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const x1 = a.x + (dx / d) * 16, y1 = a.y + (dy / d) * 16;
      const x2 = b.x - (dx / d) * 18, y2 = b.y - (dy / d) * 18;
      const mx = (x1 + x2) / 2 + dy * 0.06, my = (y1 + y2) / 2 - dx * 0.06;
      const hot = st.graph.selectedId && (e.from === st.graph.selectedId || e.to === st.graph.selectedId);
      edgeSvg += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Q' + mx.toFixed(1) + ' ' + my.toFixed(1) +
        ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" fill="none" stroke="' +
        (hot ? 'rgba(79,110,247,.85)' : 'rgba(255,255,255,0.16)') + '" stroke-width="' + (hot ? 1.8 : 1) +
        '" marker-end="url(#arrow)"/>';
    });

    // ---- 节点 ----
    let nodeSvg = '';
    nodes.forEach((n) => {
      const p = positions[n.id];
      if (!p) return;
      const deg = m[n.id].in;
      const r = 12 + Math.min(12, deg * 3.2);
      const c = color(n);
      const sel = st.graph.selectedId === n.id;
      const label = U.clip(n.title.replace(/（.*?）/, ''), 26);

      // 外部文献（未入库）通常上百个，若都画标签会互相遮挡、整张图糊成一片。
      // 只在三种情况下显示标签：已入库的论文、当前选中的节点、被多篇引用的外部文献。
      // 其余节点仍可悬停查看完整标题（用 <title> 提供原生提示）。
      const showLabel = n.inLibrary || sel || deg >= 2;

      nodeSvg +=
        '<g class="gnode" data-action="graph-select" data-id="' + n.id + '">' +
        (sel ? '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (r + 7) +
          '" fill="none" stroke="' + c + '" stroke-opacity=".45" stroke-width="2"/>' : '') +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + c +
        '" fill-opacity="' + (n.inLibrary ? 0.9 : 0.55) + '" stroke="rgba(255,255,255,.35)"/>' +
        '<title>' + U.esc(n.title) + (n.inLibrary ? '' : '（未入库）') + '</title>' +
        (showLabel
          ? '<text x="' + p.x.toFixed(1) + '" y="' + (p.y - r - 7).toFixed(1) +
            '" text-anchor="middle" font-size="10.5" fill="' + (sel ? '#eef1f8' : '#b7bed2') + '">' +
            U.esc(label) + '</text>'
          : '') +
        // 年份只对有年份的论文显示：外部文献没有解析年份，
        // 原先直接取模会算成 0，节点里全是「0」既难看也没意义
        (n.year
          ? '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + 3.5).toFixed(1) +
            '" text-anchor="middle" font-size="9.5" fill="#0d1017" font-weight="700">' +
            (n.year % 100) + '</text>'
          : '') +
        '</g>';
    });

    canvas.innerHTML = '<svg viewBox="0 0 ' + graphSize.w + ' ' + graphSize.h + '" width="100%" height="100%">' +
      defs + edgeSvg + nodeSvg + '</svg>';
  }

  /* ==========================================================================
     5. 右侧节点详情 + 图指标
     ========================================================================== */
  function renderSide(nodes) {
    const box = U.$('#gside');
    if (!box) return;
    const st = App.store.state;
    const m = metrics(nodes).m;
    const sel = st.graph.selectedId ? nodes.find((n) => n.id === st.graph.selectedId) : null;
    const degSorted = nodes.slice().sort((a, b) => m[b.id].in - m[a.id].in);

    box.innerHTML = h`
      <div class="card mb-12">
        <div class="card-head">
          <div class="card-title">图指标</div>
          <div class="spacer"></div>
          <span class="badge badge-outline">${nodes.length} 节点 / ${countEdges()} 边</span>
        </div>
        <div class="card-body tight">
          ${U.raw(degSorted.slice(0, 8).map((n, i) => h`
            <div class="row gap-8 mb-8">
              <span class="mono muted tiny" style="width:16px">${i + 1}</span>
              <span class="grow ellipsis small" data-action="graph-select" data-id="${n.id}" style="cursor:pointer">${n.title}</span>
              <span class="badge ${i === 0 ? 'badge-warn' : 'badge-outline'}">入度 ${m[n.id].in}</span>
            </div>`).join(''))}
          <div class="muted tiny mt-8">入度 = 被图谱内论文引用的次数（PageRank 的简化代理）。</div>
        </div>
      </div>

      ${sel ? h`
        <div class="card">
          <div class="card-head">
            <div class="card-title">节点详情</div>
            <div class="spacer"></div>
            <button class="btn btn-sm btn-ghost" data-action="graph-select" data-id="">✕</button>
          </div>
          <div class="card-body tight">
            <div style="font-weight:640">${sel.title}</div>
            <div class="muted small mt-8">${App.data.formatAuthors(sel.authors, 3)} · ${sel.year} · ${sel.venue}</div>
            <div class="row gap-8 mt-12 wrap">
              ${App.ui.qualityBadge(sel.quality)}
              <span class="badge badge-outline">入度 ${m[sel.id].in}</span>
              <span class="badge badge-outline">出度 ${m[sel.id].out}</span>
              <span class="badge ${sel.core === 'foundation' ? 'badge-brand' : sel.core === 'frontier' ? 'badge-ok' : 'badge-outline'}">
                ${sel.core === 'foundation' ? '基石 / 主干' : sel.core === 'frontier' ? '前沿' : sel.core === 'peripheral' ? '边缘衍生' : sel.core === 'textbook' ? '教材' : '一般'}
              </span>
            </div>
            <div class="muted small mt-12">${U.clip(sel.abstract, 200)}</div>
            <div class="row gap-8 mt-12">
              <button class="btn btn-sm btn-primary" data-action="graph-open-paper" data-id="${sel.id}">打开阅读</button>
              <button class="btn btn-sm btn-ghost" data-action="parse-detail" data-id="${sel.id}">解析详情</button>
            </div>
          </div>
        </div>`
        : App.ui.Out(h`
        <div class="card"><div class="card-body">
          <div class="muted small">点击图谱中的任意节点，这里会显示该论文的引用指标、类别与摘要。</div>
        </div></div>`)}
    `;
  }

  /* ==========================================================================
     6. 核心节点挖掘结果
     ========================================================================== */
  function renderInsights(nodes) {
    const box = U.$('#insights');
    if (!box) return;
    const ins = App.data.graphInsights['g-transformer'];
    const lookup = (id) => App.data.getPaper(id) || { title: id, year: '', venue: '' };

    box.innerHTML = h`
      <div class="card">
        <div class="card-head">
          <span style="color:#e2a336">★</span>
          <div class="card-title">基石论文（高入度核心节点）</div>
        </div>
        <div class="card-body tight">
          ${U.raw(ins.foundation.map((f) => {
            const p = lookup(f.id);
            return App.ui.Out(h`
              <div class="insight-item">
                <div class="row gap-8">
                  <span class="badge badge-warn">基石</span>
                  <span class="grow" style="font-weight:600">${p.title}</span>
                </div>
                <div class="muted tiny mt-8">${p.venue} · ${p.year}</div>
                <div class="small mt-8">${f.reason}</div>
                <button class="btn btn-sm btn-ghost mt-8" data-action="graph-open-paper" data-id="${f.id}">打开原文</button>
              </div>`);
          }).join(''))}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <span>◇</span>
          <div class="card-title">边缘衍生论文（低连通度节点）</div>
        </div>
        <div class="card-body tight">
          ${U.raw(ins.peripheral.map((f) => {
            const p = lookup(f.id);
            return App.ui.Out(h`
              <div class="insight-item">
                <div class="row gap-8">
                  <span class="badge badge-outline">边缘</span>
                  <span class="grow" style="font-weight:600">${p.title}</span>
                </div>
                <div class="muted tiny mt-8">${p.venue} · ${p.year}</div>
                <div class="small mt-8">${f.reason}</div>
              </div>`);
          }).join(''))}
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     7. 自动综述 + 未来工作
     ========================================================================== */
  function bind(el) {
    const gen = U.$('#gen-summary', el);
    if (gen) {
      gen.addEventListener('click', async () => {
        const box = U.$('#summary-box');
        box.innerHTML = h`<div class="row gap-8"><span class="dots"><i></i><i></i><i></i></span>
          <span class="muted small">正在读取图谱结构、论文摘要与引用方向…</span></div>`;
        await U.sleep(900);
        const text = App.data.graphInsights['g-transformer'].summary;
        box.innerHTML = h`<div class="summary-text" id="sumtxt"></div>`;
        U.streamText(U.$('#sumtxt'), text, { speed: 8, chunk: 3 });
        renderFuture();
        App.ui.toast('综述已生成，未来工作建议已同步更新', 'ok');
      });
    }

    const g = U.$('#ggroup', el);
    if (g) {
      g.addEventListener('change', () => {
        App.store.set({
          graph: Object.assign({}, App.store.state.graph, { groupId: g.value, selectedId: null }),
        }, 'graph');
      });
    }
  }

  function renderFuture() {
    const box = U.$('#future');
    if (!box || box.dataset.done) return;
    box.dataset.done = '1';
    const list = App.data.graphInsights['g-transformer'].futureWork;
    box.innerHTML = list.map((f) => h`
      <div class="card">
        <div class="card-body">
          <div class="row gap-8 mb-8">
            <span class="badge ${f.risk === '低' ? 'badge-ok' : f.risk === '中' ? 'badge-warn' : 'badge-danger'}">空档风险 ${f.risk}</span>
            <span style="font-weight:620">${f.title}</span>
          </div>
          <div class="muted small">${f.reason}</div>
          <div class="row gap-4 mt-12 wrap">
            ${U.raw(f.related.map((id) => {
              const p = App.data.getPaper(id);
              return p ? h`<button class="badge badge-outline" data-action="graph-open-paper" data-id="${id}" style="cursor:pointer">${U.clip(p.title, 22)}</button>` : '';
            }).join(''))}
          </div>
        </div>
      </div>`).join('');
  }

  App.views = App.views || {};
  App.views.graph = { render, drawGraph, renderSide };
})(window.App);
