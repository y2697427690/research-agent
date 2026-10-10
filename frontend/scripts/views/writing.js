/* ============================================================================
   views/writing.js — 写作助手
   ----------------------------------------------------------------------------
   对应需求 1.6「写作助手」的四个标签页：
     outline   1.6.1 论文框架生成（Abstract / Introduction / Related Work / References）
     diagram   1.6.2 论文架构拓扑图代码（TikZ / Graphviz DOT / Mermaid）
     viz       1.6.3 数据可视化（上传 CSV → 表格 / 柱状图 / 折线 / 雷达图 + 自动 Figure Caption）
     translate 1.6.4 中文摘要 / 全文翻译为英文
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  let chartCol = '1';      // CSV 中作为数值的列索引
  let diagramKind = 'mermaid';

  /* ==========================================================================
     1. 主渲染
     ========================================================================== */
  function render(el) {
    const st = App.store.state;
    const tab = st.writing.tab;

    el.innerHTML = h`
      <div class="view-head">
        <div class="grow">
          <div class="view-title">写作助手</div>
          <div class="view-desc">
            从「一个 idea」到「可投稿的稿件骨架」：生成论文框架、绘制架构图代码、
            把实验 CSV 变成规范图表并自动写 Figure Caption，最后把中文摘要译成英文。
          </div>
        </div>
      </div>

      <div class="tabs mb-16">
        <button class="tab ${tab === 'outline' ? 'active' : ''}" data-action="writing-tab" data-tab="outline">① 论文框架</button>
        <button class="tab ${tab === 'diagram' ? 'active' : ''}" data-action="writing-tab" data-tab="diagram">② 架构图代码</button>
        <button class="tab ${tab === 'viz' ? 'active' : ''}" data-action="writing-tab" data-tab="viz">③ 数据可视化</button>
        <button class="tab ${tab === 'translate' ? 'active' : ''}" data-action="writing-tab" data-tab="translate">④ 中译英</button>
      </div>

      <div id="wbody"></div>
    `;

    const body = U.$('#wbody', el);
    if (tab === 'outline') renderOutline(body);
    else if (tab === 'diagram') renderDiagram(body);
    else if (tab === 'viz') renderViz(body);
    else renderTranslate(body);
  }

  /* ==========================================================================
     2. ① 论文框架生成
     ========================================================================== */
  function renderOutline(body) {
    const st = App.store.state;
    const o = st.writing.outline;

    body.innerHTML = h`
      <div class="card mb-16">
        <div class="card-body">
          <label class="field-label">输入你的 idea（一句话即可，越具体越好）</label>
          <textarea class="textarea" id="idea" rows="3" data-bind="idea"
            placeholder="例如：面向科研文献的检索增强问答系统，用多智能体协作处理跨论文对比问题">${st.writing.idea}</textarea>
          <div class="row gap-8 mt-12">
            <button class="btn btn-primary" data-action="gen-outline" ${st.writing.running ? 'disabled' : ''}>
              ${st.writing.running ? '生成中…' : '✦ 生成论文框架'}
            </button>
            <button class="btn btn-ghost" id="demo-idea">用示例 idea 试一下</button>
            <div class="spacer"></div>
            ${o ? U.raw(h`<button class="btn btn-ghost" data-action="export-doc">导出 Markdown</button>`) : ''}
          </div>
          <div class="muted tiny mt-8">生成内容：Abstract / Introduction / Related Work / Method / Experiments / Conclusion / References</div>
        </div>
      </div>

      ${st.writing.running ? U.raw(loadingCard('正在组织结构、推导每个章节要写什么…')) : ''}
      ${o ? U.raw(outlineHtml(o)) : ''}
    `;

    const demo = U.$('#demo-idea', body);
    if (demo) demo.addEventListener('click', () => {
      const i = U.$('#idea');
      i.value = '面向科研文献的检索增强问答系统：用多智能体协作完成跨论文对比与引用溯源';
      App.store.actions.setIdea(i.value);
    });
  }

  function outlineHtml(o) {
    return App.ui.Out(h`
      ${App.ui.sectionTitle('生成的论文框架', h`<span class="muted tiny">主题：${U.clip(o.topic, 40)}</span>`)}
      <div class="grid grid-2 mb-16">
        ${U.raw(o.sections.map((s, i) => h`
          <div class="card">
            <div class="card-head">
              <span class="badge badge-brand mono">${i + 1}</span>
              <div class="card-title">${s.name}</div>
              <span class="muted tiny">${s.zh}</span>
              <div class="spacer"></div>
              <span class="badge badge-outline">${s.words}</span>
            </div>
            <div class="card-body tight">
              <div class="small" style="white-space:pre-wrap;line-height:1.75">${s.content}</div>
              ${s.todo ? U.raw(h`
                <div class="mt-12">
                  <div class="muted tiny mb-8">写作提醒</div>
                  ${U.raw(s.todo.map((t) => h`<div class="todo-item">• ${t}</div>`).join(''))}
                </div>`) : ''}
            </div>
          </div>`).join(''))}
      </div>

      ${App.ui.sectionTitle('References 真实性核验', h`<span class="muted tiny">确保引用没有幻觉 —— 对应需求 1.6.1</span>`)}
      <div class="card">
        <div class="card-head">
          <div class="card-title">自动生成的参考文献（已对照文库核验）</div>
          <div class="spacer"></div>
          <span class="badge badge-ok">库中可验证 ${o.references.filter((r) => r.inLib).length} 条</span>
        </div>
        <div class="card-body tight">
          <table class="table">
            <thead><tr><th style="width:34%">BibTeX Key</th><th>条目</th><th>核验状态</th><th></th></tr></thead>
            <tbody>
              ${U.raw(o.references.map((r) => {
                const ok = !!r.inLib;
                return App.ui.Out(h`
                  <tr>
                    <td class="mono small">${r.key}</td>
                    <td class="small">${r.text}</td>
                    <td>${ok ? U.raw(h`<span class="badge badge-ok">已验证 · 库中已有原文</span>`) : U.raw(h`<span class="badge badge-warn">待联网核验</span>`)}</td>
                    <td>${ok ? U.raw(h`<button class="btn btn-sm btn-ghost" data-action="open-paper" data-id="${r.inLib}">打开</button>`) : ''}</td>
                  </tr>`);
              }).join(''))}
            </tbody>
          </table>
        </div>
        <div class="card-foot muted tiny">
          核验逻辑：先在文库内做「标题 + 作者 + 年份」三元组匹配，命中则标记为已验证；
          未命中的条目会调用 Crossref / arXiv API 校验 DOI 与 arXiv 号是否存在，避免出现不存在的文献。
        </div>
      </div>`);
  }

  /* ==========================================================================
     3. ② 架构图代码
     ========================================================================== */
  function renderDiagram(body) {
    const p = App.data.writerPresets;
    const code = diagramKind === 'mermaid' ? p.mermaid : diagramKind === 'tikz' ? p.tikz : p.graphviz;

    body.innerHTML = h`
      <div class="notice info mb-16">
        <span>ℹ</span>
        <div>
          把论文的逻辑结构（研究问题 → 方法 → 实验 → 结论）直接转成可编译的绘图代码。
          三种输出格式覆盖 LaTeX 论文（TikZ）、通用排版（Graphviz DOT）与网页 / Markdown（Mermaid）。
        </div>
      </div>

      <div class="row gap-8 mb-16">
        ${U.raw([['mermaid', 'Mermaid（网页 / Markdown）'], ['tikz', 'TikZ（LaTeX 论文）'], ['graphviz', 'Graphviz DOT']]
          .map(([k, label]) => h`
            <button class="btn btn-sm ${diagramKind === k ? 'btn-primary' : 'btn-ghost'}" data-diagram="${k}">${label}</button>`).join(''))}
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head">
            <div class="card-title">生成的绘图代码</div>
            <div class="spacer"></div>
            <button class="btn btn-sm btn-ghost" data-action="copy-code">复制代码</button>
          </div>
          <div class="card-body tight">
            <pre class="code-block" id="diagram-code">${code}</pre>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div class="card-title">结构预览</div></div>
          <div class="card-body">
            ${U.raw(diagramPreview())}
          </div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head"><div class="card-title">Python Matplotlib 脚本（可选）</div></div>
        <div class="card-body tight">
          <pre class="code-block">${matplotlibSnippet()}</pre>
        </div>
      </div>
    `;

    U.$$('[data-diagram]', body).forEach((b) => b.addEventListener('click', () => {
      diagramKind = b.dataset.diagram;
      renderDiagram(body);
    }));
  }

  /** 结构预览：用 HTML/CSS 画一个简化流程图（无需引入 mermaid 运行时） */
  function diagramPreview() {
    const steps = [
      { t: '研究问题定义', d: '明确任务、输入输出与评价指标' },
      { t: '文献调研', d: 'RAG 检索 + 引用图谱定位基线' },
      { t: '方法设计', d: '模块一：检索增强 · 模块二：多智能体协作' },
      { t: '实验设计', d: '主实验 + 消融实验' },
      { t: '结果分析', d: '指标对比、案例分析' },
      { t: '结论与未来工作', d: '局限 + 可执行方向' },
    ];
    return App.ui.Out(h`
      <div class="flow">
        ${U.raw(steps.map((s, i) => h`
          <div class="flow-node">
            <div class="flow-idx mono">${i + 1}</div>
            <div>
              <div style="font-weight:600">${s.t}</div>
              <div class="muted tiny">${s.d}</div>
            </div>
          </div>
          ${i < steps.length - 1 ? '<div class="flow-arrow">↓</div>' : ''}`).join(''))}
      </div>`);
  }

  function matplotlibSnippet() {
    return App.ui.Out([
      'import matplotlib.pyplot as plt',
      'import pandas as pd',
      '',
      'df = pd.read_csv("experiment_results.csv")',
      'fig, ax1 = plt.subplots(figsize=(7, 4.2), dpi=200)',
      '',
      'bars = ax1.bar(df["Model"], df["BLEU (EN-DE)"], color="#4f6ef7", alpha=.85, width=.55)',
      'ax1.set_ylabel("BLEU (EN-DE)", fontsize=10)',
      'ax1.set_ylim(20, 31)',
      'ax1.bar_label(bars, fmt="%.1f", fontsize=8)',
      '',
      'ax2 = ax1.twinx()',
      'ax2.plot(df["Model"], df["Latency (ms)"], color="#e2a336", marker="o", lw=1.6)',
      'ax2.set_ylabel("Latency (ms)", fontsize=10)',
      '',
      'ax1.set_title("图 4  各模型在 WMT2014 英德任务上的性能与延迟", fontsize=10)',
      'plt.xticks(rotation=18)',
      'plt.tight_layout()',
      'plt.savefig("fig4_performance.pdf")',
    ].join('\n'));
  }

  /* ==========================================================================
     4. ③ 数据可视化
     ========================================================================== */
  function renderViz(body) {
    const p = App.data.writerPresets;
    const csv = p.csv;
    const table = App.writer.toTable(csv);
    const colIdx = Math.max(1, Math.min(csv.head.length - 1, parseInt(chartCol, 10) || 1));
    const chart = App.writer.toChart(csv, colIdx, 0);
    const caption = App.writer.buildCaption(csv, colIdx, 0);

    const radarAxes = ['BLEU', '参数效率', '推理速度', '可复现性', '训练成本'];
    const radarSeries = [
      { name: '本方法', values: [0.92, 0.78, 0.72, 0.88, 0.7] },
      { name: 'Transformer-base', values: [0.8, 0.9, 0.85, 0.95, 0.92] },
      { name: 'ConvS2S', values: [0.7, 0.55, 0.6, 0.7, 0.5] },
    ];

    body.innerHTML = h`
      <div class="card mb-16">
        <div class="card-body">
          <div class="row gap-12 wrap">
            <div class="grow">
              <div style="font-weight:620">上传实验原始 CSV</div>
              <div class="muted small mt-8">Agent 会自动识别表头与数值列，生成表格、柱状图、折线图或三维雷达图，并写一段学术规范的 Figure Caption。</div>
            </div>
            <button class="btn btn-primary" data-action="load-csv-demo">载入示例 CSV</button>
            <input type="file" id="csvfile" accept=".csv,text/csv" class="hidden" />
            <button class="btn btn-ghost" id="pick-csv">上传我的 CSV</button>
          </div>
        </div>
      </div>

      <div class="grid grid-2 mb-16">
        <div class="card">
          <div class="card-head">
            <div class="card-title">① 自动转成表格</div>
            <div class="spacer"></div>
            <span class="badge badge-outline mono">${csv.name}</span>
          </div>
          <div class="card-body tight">
            <table class="table">
              <thead><tr>${U.raw(table.head.map((th, i) =>
                h`<th>${th}${table.numeric[i] ? ' <span class="muted tiny">#</span>' : ''}</th>`).join(''))}</tr></thead>
              <tbody>
                ${U.raw(table.rows.map((r) => h`<tr>${U.raw(r.map((c, ci) => h`<td class="mono small ${table.numeric[ci] ? 'num' : ''}">${c}</td>`).join(''))}</tr>`).join(''))}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title">② 自动生成图表</div>
            <div class="spacer"></div>
            <select class="select" style="width:190px" data-bind="chart-col">
              ${U.raw(csv.head.map((hd, i) => i === 0 ? '' :
                h`<option value="${i}" ${i === colIdx ? 'selected' : ''}>数值列：${hd}</option>`).join(''))}
            </select>
          </div>
          <div class="card-body">
            ${U.raw(App.writer.renderBarChart(chart, { line: true }))}
            <div class="row gap-8 mt-12">
              <span class="badge badge-brand">柱状图</span>
              <span class="badge badge-warn">折线：Latency (ms)</span>
              <span class="muted tiny">数值列可切换，图表实时重绘</span>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-2 mb-16">
        <div class="card">
          <div class="card-head"><div class="card-title">③ 三维雷达图（多维度对比）</div></div>
          <div class="card-body center">
            ${U.raw(App.writer.renderRadar(radarAxes, radarSeries))}
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title">④ 自动生成的 Figure Caption</div>
            <div class="spacer"></div>
            <span class="badge badge-brand">含趋势结论</span>
          </div>
          <div class="card-body">
            <div class="caption-box">${caption}</div>
            <div class="muted tiny mt-12">
              说明：Caption 不只描述图表内容，还自动提炼趋势结论（最高/最低项、首末变化），
              符合学术论文图注的写作规范 —— 对应需求 1.6.3。
            </div>
          </div>
        </div>
      </div>
    `;

    const pick = U.$('#pick-csv', body);
    const input = U.$('#csvfile', body);
    if (pick && input) {
      pick.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        if (!input.files || !input.files.length) return;
        const f = input.files[0];
        const rd = new FileReader();
        rd.onload = () => {
          const parsed = App.writer.parseCSV(String(rd.result));
          if (!parsed.head.length) { App.ui.toast('CSV 解析失败', 'danger'); return; }
          App.data.writerPresets.csv = { name: f.name, head: parsed.head, rows: parsed.rows };
          App.ui.toast('已载入 ' + f.name + '（' + parsed.rows.length + ' 行）', 'ok');
          renderViz(body);
        };
        rd.readAsText(f);
      });
    }
  }

  /* ==========================================================================
     5. ④ 中译英
     ========================================================================== */
  function renderTranslate(body) {
    const zh = App.data.getPaper('p-attention-v7').abstractZh;
    const en = App.data.getPaper('p-attention-v7').abstract;
    const out = App.writer.translateAbstract(zh);

    body.innerHTML = h`
      <div class="notice info mb-16">
        <span>ℹ</span>
        <div>
          自动把中文摘要（或全文）翻译为英文。学术翻译需要保留术语一致性，
          因此术语表会与文库中的论文标题 / 关键词对齐（例如「注意力机制」固定译为 attention mechanism）。
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head">
            <div class="card-title">中文输入</div>
            <div class="spacer"></div>
            <span class="badge badge-outline">自动取自文库摘要</span>
          </div>
          <div class="card-body">
            <textarea class="textarea" id="zh-src" rows="9">${zh}</textarea>
            <div class="row gap-8 mt-12">
              <button class="btn btn-primary" data-action="translate-abstract">翻译为英文</button>
              <button class="btn btn-ghost" id="use-lib-abstract">重新载入文库摘要</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title">英文译文</div>
            <div class="spacer"></div>
            <span class="badge badge-brand">术语对齐文库</span>
          </div>
          <div class="card-body">
            <div class="abstract-en" id="en-out" style="min-height:180px">${out}</div>
            <div class="muted tiny mt-12">
              参考：论文原始英文摘要（可对比翻译质量）
            </div>
            <div class="caption-box mt-8">${en}</div>
          </div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head"><div class="card-title">术语一致性表（部分）</div></div>
        <div class="card-body tight">
          <table class="table">
            <thead><tr><th>中文</th><th>英文</th><th>来源</th></tr></thead>
            <tbody>
              <tr><td>注意力机制</td><td class="mono">attention mechanism</td><td class="muted small">Attention Is All You Need</td></tr>
              <tr><td>多头注意力</td><td class="mono">multi-head attention</td><td class="muted small">同上</td></tr>
              <tr><td>层归一化</td><td class="mono">layer normalization</td><td class="muted small">Layer Normalization (1607.06450)</td></tr>
              <tr><td>检索增强生成</td><td class="mono">retrieval-augmented generation (RAG)</td><td class="muted small">RAG (2005.11401)</td></tr>
              <tr><td>专家混合</td><td class="mono">mixture-of-experts (MoE)</td><td class="muted small">Switch Transformer</td></tr>
              <tr><td>直接偏好优化</td><td class="mono">direct preference optimization (DPO)</td><td class="muted small">DPO (2305.18290)</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    const reload = U.$('#use-lib-abstract', body);
    if (reload) reload.addEventListener('click', () => {
      U.$('#zh-src', body).value = zh;
      App.ui.toast('已重新载入文库中的中文摘要', 'ok');
    });
  }

  /* ==========================================================================
     6. 由 app.js 动作表调用
     ========================================================================== */
  function generate() {
    const idea = (U.$('#idea') && U.$('#idea').value) || App.store.state.writing.idea;
    if (!idea.trim()) { App.ui.toast('请先输入你的 idea', 'warn'); return; }
    App.store.actions.generateOutline(idea.trim());
  }

  function loadDemoCsv() {
    App.ui.toast('已载入示例 CSV：experiment_results.csv（5 行）', 'ok');
    if (App.store.state.writing.tab !== 'viz') App.store.actions.setWritingTab('viz');
    else App.render();
  }

  function setChartCol(v) { chartCol = v; App.render(); }

  function copyCode() {
    const pre = U.$('#diagram-code');
    if (!pre) return;
    if (navigator.clipboard) navigator.clipboard.writeText(pre.textContent);
    App.ui.toast('绘图代码已复制到剪贴板', 'ok');
  }

  function doTranslate() {
    const src = U.$('#zh-src');
    const out = U.$('#en-out');
    if (!src || !out) return;
    if (!src.value.trim()) { App.ui.toast('请输入要翻译的中文内容', 'warn'); return; }
    out.textContent = '';
    const result = App.writer.translateAbstract(src.value);
    App.ui.toast('翻译完成（演示：术语替换 + 句式保留）', 'ok');
    U.streamText(out, result, { speed: 10, chunk: 4 });
  }

  function loadingCard(text) {
    return App.ui.Out(h`
      <div class="card mb-16"><div class="card-body">
        <div class="row gap-8">
          <span class="dots"><i></i><i></i><i></i></span>
          <span class="muted small">${text}</span>
        </div>
      </div></div>`);
  }

  App.views = App.views || {};
  App.views.writing = { render, generate, loadDemoCsv, setChartCol, copyCode, doTranslate };
})(window.App);
