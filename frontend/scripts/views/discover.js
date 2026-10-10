/* ============================================================================
   views/discover.js — 发现与推荐（论文自动下载 + 每日推荐）
   ----------------------------------------------------------------------------
   对应需求 1.4「论文自动下载和推荐」：
     1.4.1 基本下载     —— 给定论文名称自动下载并入库；根据参考文献批量下载
     1.4.2 下载最新论文 —— 定期刷新 arXiv，找出与文库相关的新论文
     1.4.3 每日/每周推荐 —— 给出相关性 + 推荐理由；优先推荐有 GitHub 代码的；
                            支持点赞 / 踩一下（用户反馈）
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  /* ==========================================================================
     1. 主渲染
     ========================================================================== */
  function render(el) {
    const st = App.store.state;
    const tab = st.discover.tab;

    el.innerHTML = h`
      <div class="view-head">
        <div class="grow">
          <div class="view-title">发现与推荐</div>
          <div class="view-desc">
            定期刷新 arXiv（可用 sickle 等库），把与文库主题相关的新论文推到你面前；
            每条推荐都附带「为什么推荐给你」的理由，并优先挑选带 GitHub 代码、容易复现的工作。
          </div>
        </div>
        <button class="btn btn-ghost" id="fetch-now">↻ 立即刷新 arXiv</button>
        <button class="btn btn-primary" id="download-by-name">⬇ 按名称下载论文</button>
      </div>

      <!-- ============ 自动下载区 ============ -->
      <div class="grid grid-3 mb-16">
        <div class="card">
          <div class="card-body">
            <div class="row gap-8 mb-8"><span style="font-size:18px">⬇</span><b>按名称自动下载</b></div>
            <div class="muted small mb-12">输入论文标题，Agent 通过搜索引擎 / arXiv API 定位并下载入库。</div>
            <div class="row gap-8">
              <input class="input" id="paper-name" placeholder="例如：BERT: Pre-training of Deep…" />
              <button class="btn btn-primary btn-sm nowrap" id="name-go">下载</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-body">
            <div class="row gap-8 mb-8"><span style="font-size:18px">⇲</span><b>批量抓取参考文献</b></div>
            <div class="muted small mb-12">
              从已入库论文的 References 出发，自动下载全部（或被正文提及的）参考文献，
              并按「被正文引用的次数」筛掉纯凑数的引用。
            </div>
            <button class="btn btn-ghost btn-sm" id="refs-crawl">从《Attention Is All You Need》抓取 40 条</button>
          </div>
        </div>
        <div class="card">
          <div class="card-body">
            <div class="row gap-8 mb-8"><span style="font-size:18px">⚙</span><b>订阅设置</b></div>
            <div class="muted small mb-12">抓取频率、arXiv 分类、相关性阈值。</div>
            <div class="row gap-8 wrap">
              <span class="badge badge-outline">cs.CL</span>
              <span class="badge badge-outline">cs.LG</span>
              <span class="badge badge-outline">cs.CV</span>
              <span class="badge badge-brand">每 24 小时</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ 推荐列表 ============ -->
      <div class="card">
        <div class="card-head">
          <div class="tabs" style="border:none">
            <button class="tab ${tab === 'daily' ? 'active' : ''}" data-action="discover-tab" data-tab="daily">每日新论文</button>
            <button class="tab ${tab === 'weekly' ? 'active' : ''}" data-action="discover-tab" data-tab="weekly">本周精选</button>
            <button class="tab ${tab === 'interest' ? 'active' : ''}" data-action="discover-tab" data-tab="interest">我的兴趣画像</button>
          </div>
          <div class="spacer"></div>
          <span class="muted tiny">排序：相关性 × 有代码加权 × 反馈修正</span>
        </div>
        <div class="card-body" id="reclist"></div>
      </div>
    `;

    renderList();
    bind(el);
  }

  /* ==========================================================================
     2. 推荐卡片
     ========================================================================== */
  function renderList() {
    const box = U.$('#reclist');
    if (!box) return;
    const st = App.store.state;
    const tab = st.discover.tab;

    if (tab === 'interest') { renderInterest(box); return; }

    let list = App.data.recommendations.filter((r) => r.kind === tab);
    // 用户反馈修正排序：点赞 +0.06，踩 -0.3（踩过的会被排到最后）
    list = list.map((r) => {
      const fb = st.discover.feedback[r.id];
      return Object.assign({}, r, { _score: r.score + (fb === 'up' ? 0.06 : fb === 'down' ? -0.3 : 0) });
    }).sort((a, b) => b._score - a._score);

    if (!list.length) {
      box.innerHTML = App.ui.empty('☄', '这个时间窗内暂无新论文，试试切换到其他标签').__raw;
      return;
    }

    box.innerHTML = list.map((r) => {
      const fb = st.discover.feedback[r.id];
      return App.ui.Out(h`
        <div class="rec-card ${fb === 'down' ? 'dim' : ''}">
          <div class="row gap-16" style="align-items:flex-start">
            <div class="rec-score">
              <div class="mono" style="font-size:19px;font-weight:700">${U.pct(r._score, 0)}</div>
              <div class="muted tiny">相关度</div>
            </div>
            <div class="grow" style="min-width:0">
              <div class="row gap-8 wrap">
                <span style="font-weight:640;font-size:14.5px">${r.title}</span>
                ${r.hasCode ? h`<span class="badge badge-ok">含代码</span>` : App.ui.Out(h`<span class="badge badge-outline">无代码</span>`)}
                ${r.cited > 30 ? h`<span class="badge badge-brand">快速升温</span>` : ''}
              </div>
              <div class="muted small mt-8">
                ${r.authors.join(', ')} · ${r.venue} · ${U.date(r.date)} · arXiv:${r.arxiv}
              </div>

              <div class="rec-reason mt-12">
                <div class="row gap-8 mb-8">
                  <span class="badge badge-brand">推荐理由</span>
                  <span class="muted tiny">Agent 依据你文库中论文的内容生成</span>
                </div>
                <div>${r.reason}</div>
              </div>

              <div class="row gap-8 mt-12 wrap">
                ${r.tags.map((t) => h`<span class="badge badge-outline">${t}</span>`).join('')}
                <span class="muted tiny">· 近 7 天被引 ${r.cited} 次</span>
              </div>

              <div class="row gap-8 mt-12">
                <button class="btn btn-sm btn-ghost" data-open-arxiv="${r.arxiv}">在 arXiv 打开</button>
                ${r.codeUrl ? h`<button class="btn btn-sm btn-ghost" data-open-url="${r.codeUrl}">查看代码</button>` : ''}
                <button class="btn btn-sm btn-ghost" data-add-lib="${r.id}">加入文库</button>
                <div class="spacer"></div>
                <button class="btn btn-sm ${fb === 'up' ? 'btn-primary' : 'btn-ghost'}" data-action="vote-up" data-id="${r.id}" title="点赞：推荐更多同类主题">👍 有用</button>
                <button class="btn btn-sm ${fb === 'down' ? 'btn-danger' : 'btn-ghost'}" data-action="vote-down" data-id="${r.id}" title="不感兴趣：降低同类权重">👎 不感兴趣</button>
              </div>
            </div>
          </div>
        </div>`);
    }).join('');

    // 外部链接与「加入文库」
    U.$$('[data-open-arxiv]', box).forEach((b) => b.addEventListener('click', () =>
      App.ui.toast('演示环境不跳转外链，arXiv:' + b.dataset.openArxiv, 'ok')));
    U.$$('[data-open-url]', box).forEach((b) => b.addEventListener('click', () =>
      App.ui.toast('演示环境不跳转外链：' + b.dataset.openUrl, 'ok')));
    U.$$('[data-add-lib]', box).forEach((b) => b.addEventListener('click', () => addToLibrary(b.dataset.addLib)));
  }

  /** 把推荐论文加入文库（模拟下载入库：复用上传流水线） */
  async function addToLibrary(recId) {
    const r = App.data.recommendations.find((x) => x.id === recId);
    if (!r) return;
    App.ui.toast('正在下载 ' + r.arxiv + ' …', 'ok');
    await U.sleep(700);
    App.store.actions.addUploads([{
      name: r.arxiv.replace(/v\d+$/, '') + 'v1.pdf',
      size: 1200000 + Math.round(Math.random() * 2000000),
    }]);
    App.store.actions.go('library');
  }

  /* ==========================================================================
     3. 兴趣画像（多用户 / 协同过滤的入口）
     ========================================================================== */
  function renderInterest(box) {
    const papers = App.store.state.papers;
    const tagCount = {};
    papers.forEach((p) => (p.keywords || []).forEach((k) => { tagCount[k] = (tagCount[k] || 0) + 1; }));
    const tags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]).slice(0, 14);
    const max = Math.max.apply(null, tags.map((t) => tagCount[t]).concat([1]));

    const fb = App.store.state.discover.feedback;
    const ups = Object.keys(fb).filter((k) => fb[k] === 'up').length;
    const downs = Object.keys(fb).filter((k) => fb[k] === 'down').length;

    box.innerHTML = h`
      <div class="grid grid-2">
        <div>
          <div class="card-title mb-12">主题分布（来自你文库中的论文）</div>
          ${tags.map((t) => h`
            <div class="mb-12">
              <div class="row small" style="justify-content:space-between">
                <span>${t}</span><span class="muted mono">${tagCount[t]} 篇</span>
              </div>
              <div class="bar mt-8"><i style="width:${(tagCount[t] / max * 100).toFixed(0)}%"></i></div>
            </div>`).join('')}
        </div>
        <div>
          <div class="card-title mb-12">反馈统计</div>
          <div class="grid grid-2 mb-16">
            ${App.ui.statCard({ icon: '👍', label: '点赞', value: ups, unit: '条' })}
            ${App.ui.statCard({ icon: '👎', label: '不感兴趣', value: downs, unit: '条' })}
          </div>
          <div class="notice info mb-16">
            <span>ℹ</span>
            <div>
              当前为单用户模式，推荐使用「内容相关性 + 代码可用性 + 引用增速」三因子排序。
              若实现多用户，可升级为协同过滤（UserCF / ItemCF），并引入矩阵分解或双塔召回。
            </div>
          </div>
          <div class="card-title mb-12">推荐算法当前权重</div>
          ${[
            { k: '内容相关性（文库主题匹配）', v: 45 },
            { k: '代码可用性（GitHub 星标 / 可复现）', v: 20 },
            { k: '引用增速（近 7 天）', v: 20 },
            { k: '作者 / 机构历史命中率', v: 10 },
            { k: '用户反馈修正', v: 5 },
          ].map((w) => h`
            <div class="mb-12">
              <div class="row small" style="justify-content:space-between"><span>${w.k}</span><span class="mono muted">${w.v}%</span></div>
              <div class="bar mt-8"><i style="width:${w.v * 2}%"></i></div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  /* ==========================================================================
     4. 交互绑定
     ========================================================================== */
  function bind(el) {
    const nameGo = U.$('#name-go', el);
    if (nameGo) nameGo.addEventListener('click', doDownloadByName);

    const byName = U.$('#download-by-name', el);
    if (byName) byName.addEventListener('click', () => {
      const i = U.$('#paper-name');
      if (i) i.focus();
      App.ui.toast('在下方输入论文标题后点击「下载」', 'ok');
    });

    const refresh = U.$('#fetch-now', el);
    if (refresh) refresh.addEventListener('click', async () => {
      App.ui.toast('正在刷新 arXiv（cs.CL / cs.LG）…', 'ok');
      await U.sleep(1100);
      App.ui.toast('抓取完成：新增 ' + App.data.recommendations.length + ' 条候选，已去重并排序', 'ok');
    });

    const crawl = U.$('#refs-crawl', el);
    if (crawl) crawl.addEventListener('click', async () => {
      App.ui.toast('解析 References：共 40 条，其中「被正文明确提及」28 条', 'ok');
      await U.sleep(900);
      App.ui.toast('已下载 28 篇参考文献入库，跳过 12 条「为引用而引用」的条目', 'ok');
    });

    const input = U.$('#paper-name', el);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doDownloadByName(); });
  }

  async function doDownloadByName() {
    const i = U.$('#paper-name');
    if (!i || !i.value.trim()) { App.ui.toast('请输入论文名称', 'warn'); return; }
    const name = i.value.trim();
    i.value = '';
    App.ui.toast('正在搜索并下载：' + U.clip(name, 24) + ' …', 'ok');
    await U.sleep(900);
    App.store.actions.addUploads([{ name: name.replace(/[^\w\-.]/g, '_') + '.pdf', size: 1600000 }]);
    App.store.actions.go('library');
  }

  App.views = App.views || {};
  App.views.discover = { render };
})(window.App);
