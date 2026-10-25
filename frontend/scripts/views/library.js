/* ============================================================================
   views/library.js — 文库（论文管理）
   ----------------------------------------------------------------------------
   对应需求 1.1「PDF 文件管理和解析」：
     · 批量上传 + 拖拽上传
     · 解析流水线可视化（排队 → 解析 → 去重 → 入库）
     · 内容去重：识别重复论文并让用户选择「覆盖 / 保留文库版本 / 两份都留」
     · 版本差异对比（v1 vs v7 这类同名不同版本的差异）
     · 元数据管理（CRUD：查看、重命名/标记、重新解析、删除）
     · 结构化解析详情抽屉（标题/作者/摘要/章节/表格/公式/参考文献/附录）
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  /* ==========================================================================
     1. 视图主渲染
     ========================================================================== */
  function render(el) {
    const st = App.store.state;

    el.innerHTML = h`
      <!-- ============ 上传区 ============ -->
      <div class="card mb-16">
        <div class="card-body">
          <div class="dropzone" id="drop">
            <div class="dz-icon">⇪</div>
            <div style="font-weight:650;font-size:15px">拖拽 PDF 到这里，或点击选择文件</div>
            <div class="muted small mt-8">
              支持批量上传 · 自动去重 · 扫描件 OCR · 解析粒度可到「公式 / 表格 / 图表 / 参考文献」
            </div>
            <div class="row gap-8 mt-16" style="justify-content:center">
              <button class="btn btn-primary" data-action="pick-files">选择 PDF 文件</button>
              <button class="btn btn-ghost" id="demo-upload">一键演示：上传 v7 → 再上传 v1</button>
            </div>
            <input type="file" id="fileinput" multiple accept="application/pdf" class="hidden" />
          </div>

          <div class="row gap-12 mt-16 wrap">
            <span class="badge badge-outline">当前文库 ${st.papers.length} 篇</span>
            <span class="badge badge-outline">测试样例来自需求文档 pdf/ 目录</span>
            <span class="badge badge-outline">去重指纹：MinHash + Jaccard</span>
          </div>
        </div>
      </div>

      ${st.uploads.length ? renderPipeline() : ''}

      <!-- ============ 论文列表 ============ -->
      ${U.raw(App.ui.sectionTitle('文库列表', '<span class="muted tiny">点击任意行查看结构化解析详情</span>'))}
      <div class="card">
        <div class="card-head">
          <div class="card-title">共 ${st.papers.length} 篇</div>
          <div class="spacer"></div>
          <select class="select" id="filter" style="width:180px">
            <option value="all">全部论文</option>
            <option value="low">解析质量偏低</option>
            <option value="scanned">扫描件</option>
            <option value="starred">已收藏</option>
          </select>
        </div>
        <div style="overflow:auto">
          <table class="table">
            <thead>
              <tr>
                <th style="width:32%">论文</th>
                <th>作者</th>
                <th>年份 / 版本</th>
                <th>页数</th>
                <th>结构</th>
                <th>解析质量</th>
                <th>加入时间</th>
                <th style="width:150px"></th>
              </tr>
            </thead>
            <tbody id="plist"></tbody>
          </table>
        </div>
      </div>
    `;

    bindUpload();
    renderList();
  }

  /* ==========================================================================
     2. 上传交互（点击 + 拖拽 + 演示按钮）
     ========================================================================== */
  function bindUpload() {
    const input = U.$('#fileinput');
    const dz = U.$('#drop');
    const demo = U.$('#demo-upload');
    // 视图可能已被切走（元素不在 DOM 中），此时无需绑定
    if (!dz || !input) return;

    dz.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      input.click();
    });
    input.addEventListener('change', () => {
      if (input.files && input.files.length) {
        App.store.actions.addUploads(Array.prototype.slice.call(input.files));
        input.value = '';
      }
    });

    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => {
      const files = Array.prototype.slice.call(e.dataTransfer.files || [])
        .filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')
        .map((f) => ({ name: f.name, size: f.size }));
      if (!files.length) { App.ui.toast('请拖入 PDF 文件', 'warn'); return; }
      App.store.actions.addUploads(files);
    });

    // 一键演示：模拟需求第 2 节第 1 条的场景（先 v7，再 v1）
    if (demo) demo.addEventListener('click', async () => {
      App.ui.toast('演示开始：先上传 Attention v7（新论文）', 'ok');
      App.store.actions.addUploads([{ name: '1706.03762v7.pdf', size: 2215244 }]);
      await U.sleep(2600);
      App.ui.toast('接着上传 1706.03762v1.pdf（应被判定为重复）', 'warn');
      App.store.actions.addUploads([{ name: '1706.03762v1.pdf', size: 2128686 }]);
    });
  }

  /** 由外部（顶栏按钮 / 主页快捷入口）触发文件选择 */
  function pickFiles() {
    if (App.store.state.route !== 'library') {
      App.store.actions.go('library');
      setTimeout(() => { const i = U.$('#fileinput'); if (i) i.click(); }, 60);
    } else {
      const i = U.$('#fileinput');
      if (i) i.click();
    }
  }

  /* ==========================================================================
     3. 解析流水线
     ========================================================================== */
  const STATUS_MAP = {
    queued: { text: '排队中', kind: 'badge-outline' },
    parsing: { text: '解析中', kind: 'badge-info' },
    duplicate: { text: '检测到重复', kind: 'badge-warn' },
    done: { text: '已入库', kind: 'badge-ok' },
    skipped: { text: '已跳过', kind: 'badge-outline' },
  };

  function renderPipeline() {
    const ups = App.store.state.uploads;
    return App.ui.Out(h`
      ${App.ui.sectionTitle('上传与解析流水线', h`<span class="muted tiny">共 ${ups.length} 个任务</span>`)}
      <div class="card mb-16">
        <div class="card-body tight">
          ${U.raw(ups.map((u) => {
            const st = STATUS_MAP[u.status] || STATUS_MAP.queued;
            return App.ui.Out(h`
              <div class="pipe-row">
                <div class="pipe-status">${
                  u.status === 'done' ? '✓'
                  : u.status === 'duplicate' ? '⚠'
                  : u.status === 'parsing' ? '◐'
                  : u.status === 'skipped' ? '–' : '○'}</div>
                <div class="grow">
                  <div class="row gap-8">
                    <span class="mono small ellipsis" style="max-width:280px">${u.name}</span>
                    <span class="badge ${st.kind}">${st.text}</span>
                    ${u.pages ? h`<span class="muted tiny">${u.pages} 页 · ${U.num(u.chars)} 字</span>` : ''}
                    <span class="spacer"></span>
                    ${u.status === 'parsing' ? h`<span class="dots"><i></i><i></i><i></i></span>` : ''}
                  </div>
                  <div class="bar mt-8 ${u.status === 'done' ? 'ok' : ''}"><i style="width:${u.progress}%"></i></div>
                </div>
                <div class="pipe-actions">
                  ${u.status === 'duplicate'
                    ? h`<button class="btn btn-sm btn-primary" data-action="show-diff" data-id="${u.id}">处理重复</button>`
                    : ''}
                  ${(u.status === 'done' || u.status === 'skipped')
                    ? h`<button class="btn btn-sm btn-ghost" data-action="remove-upload" data-id="${u.id}">移除</button>`
                    : ''}
                </div>
              </div>`);
          }).join(''))}
        </div>
      </div>`);
  }


  /* ==========================================================================
     4. 去重处理弹窗（需求核心场景）
     ========================================================================== */
  /**
   * 取版本号的数字部分。
   * 数据来源不一致：后端返回 "7"（纯数字），演示数据里是 "v7"（带前缀），
   * 上传项从文件名解析出的也是 "7"。统一在这里归一，避免出现 "vv7" 或 NaN。
   */
  function verNum(v) {
    const m = String(v == null ? '' : v).match(/(\d+)/);
    return m ? Number(m[1]) : NaN;
  }

  /** 版本号的展示形式：能解析就显示 vN，否则显示「未标注」 */
  function verLabel(v) {
    const n = verNum(v);
    return Number.isFinite(n) ? 'v' + n : '未标注';
  }

  /**
   * 比较「文库已有」与「本次上传」的真实字段。
   *
   * 为什么只做这几个字段：
   * 上传瞬间新文件还没解析（页数、章节、参考文献都未知），
   * 真正能确定的只有文件名里的版本号、文件大小这些元信息。
   * 旧版这里展示了「新增 Attention Visualizations 附录」「参考文献由 34 增至 40 条」
   * 一类具体到条目的差异——那些全是写死的演示文本，
   * 版本号缺失时还会渲染成「vNaN」，属于界面在编造数据。
   * 逐段 diff 需要两份都解析后做文本对齐，已列入后续工作。
   */
  function compareRows(paper, up) {
    const oldNum = verNum(paper.version);
    const newNum = verNum(up.version);
    const known = Number.isFinite(oldNum) && Number.isFinite(newNum);

    const rows = [
      { label: '版本号', before: verLabel(paper.version), after: verLabel(up.version) },
      { label: '文件大小', before: U.bytes(paper.sizeBytes), after: U.bytes(up.size) },
      { label: '页数', before: paper.pages ? paper.pages + ' 页' : '未知', after: '解析后可知' },
      { label: '解析状态', before: statusText(paper.status), after: '尚未解析' },
    ];

    // 只有两边都能解析出版本号时，才判断谁更新——否则不臆测
    if (known) {
      const diff = newNum - oldNum;
      rows.push({
        label: '结论',
        before: '',
        after: diff > 0 ? '本次上传更新 ' + diff + ' 个版本'
          : diff < 0 ? '文库版本更新 ' + (-diff) + ' 个版本'
            : '版本号相同',
      });
    }
    return rows;
  }

  function statusText(status) {
    const map = {
      done: '已解析', need_review: '需校对', failed: '解析失败',
      parsing: '解析中', queued: '待解析',
    };
    return map[status] || '未知';
  }

  function showDiff(uploadId) {
    const up = App.store.state.uploads.find((u) => u.id === uploadId);
    if (!up || !up.dupInfo) return;
    const info = up.dupInfo;
    const paper = info.paper;

    // 谁更新：只在两边都有版本号时判断，避免把 undefined 参与比较得出 NaN
    const oldVer = Number(paper.version);
    const newVer = Number(up.version);
    const known = Number.isFinite(oldVer) && Number.isFinite(newVer);
    const libNewer = known && oldVer > newVer;
    const sameVersion = known && oldVer === newVer;

    const kindText = info.kind === 'identical' ? '内容完全相同'
      : info.kind === 'newer_version' ? '同一论文的更新版本'
        : info.kind === 'older_version' ? '同一论文的较旧版本'
          : '疑似重复';

    // 相似度只有离线判定（前端 findDuplicate）才提供；
    // 走后端时不返回该字段，因此必须先判断类型再格式化，
    // 否则 U.pct(undefined) 会显示出「NaN%」。
    const hasSimilarity = typeof info.similarity === 'number' && Number.isFinite(info.similarity);

    const rows = compareRows(paper, up);

    const body = h`
      <div class="notice ${libNewer ? 'warn' : 'info'} mb-16">
        <span>${libNewer ? '⚠' : 'ℹ'}</span>
        <div class="grow">
          <div style="font-weight:600">${info.reason || info.message || '检测到重复'}</div>
          <div class="row gap-8 wrap mt-8">
            <span class="badge badge-outline">${kindText}</span>
            ${hasSimilarity
              ? U.raw(h`<span class="badge badge-outline">相似度 ${U.pct(info.similarity, 1)}</span>`)
              : ''}
            ${libNewer
              ? U.raw(h`<span class="badge badge-warn">文库版本更新</span>`)
              : sameVersion
                ? U.raw(h`<span class="badge badge-outline">版本号相同</span>`)
                : known
                  ? U.raw(h`<span class="badge badge-ok">本次上传更新</span>`)
                  : ''}
          </div>
        </div>
      </div>

      <div class="grid grid-2 mb-16">
        <div class="card"><div class="card-body">
          <div class="muted tiny mb-8">文库中已有</div>
          <div style="font-weight:600">${paper.title}</div>
          <div class="muted small mt-8 mono">${paper.file}</div>
          <div class="muted small mt-8">
            ${paper.version ? 'v' + paper.version + ' · ' : ''}${paper.pages || '?'} 页
            · ${U.bytes(paper.sizeBytes)} · 加入于 ${U.ago(paper.addedAt)}
          </div>
        </div></div>
        <div class="card"><div class="card-body">
          <div class="muted tiny mb-8">本次上传</div>
          <div style="font-weight:600">${String(up.name).replace(/\.pdf$/i, '')}</div>
          <div class="muted small mt-8 mono">${up.name}</div>
          <div class="muted small mt-8">
            ${up.version ? 'v' + up.version + ' · ' : ''}尚未解析
            · ${U.bytes(up.size)}
          </div>
        </div></div>
      </div>

      ${App.ui.sectionTitle('真实可比信息', '<span class="muted tiny">上传瞬间新文件尚未解析，因此只比较元信息</span>')}
      <div class="cmp-table">
        ${U.raw(rows.map((r) => h`
          <div class="cmp-row">
            <span class="cmp-label">${r.label}</span>
            <span class="cmp-before">${r.before || ''}</span>
            <span class="cmp-arrow">→</span>
            <span class="cmp-after">${r.after || ''}</span>
          </div>`).join(''))}
      </div>

      ${info.reasons && info.reasons.length
        ? U.raw(h`
          <div class="mt-16">
            <div class="muted tiny mb-8">判定依据</div>
            ${U.raw(info.reasons.map((r) => h`<div class="muted small">· ${r}</div>`).join(''))}
          </div>`)
        : ''}

      <div class="notice info mt-16">
        <span>ℹ</span>
        <div class="muted small">
          逐段版本差异（哪一节改了什么、参考文献增删了哪些）尚未实现：
          它需要两份 PDF 都完成解析后做文本对齐，已列入后续工作。
          这里只展示确定无误的元信息，不做推测。
        </div>
      </div>
    `;

    // 主按钮跟着「谁更新」走：文库更新时推荐保留文库，本次更新时推荐覆盖
    const primaryIsOverwrite = known && !libNewer && !sameVersion;
    const ui = App.ui.openModal(h`
      <div class="modal wide">
        <div class="modal-head">
          <div class="modal-title">检测到重复论文，请选择处理方式</div>
          <div class="spacer"></div>
          <button class="btn btn-sm btn-ghost" data-close>✕</button>
        </div>
        <div class="modal-body">${U.raw(body)}</div>
        <div class="modal-foot">
          <span class="muted tiny">对应需求 1.1.1：提示用户选择保留哪个版本</span>
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-close>稍后处理</button>
          <button class="btn btn-ghost" data-keep-both>两份都保留</button>
          <button class="btn ${primaryIsOverwrite ? 'btn-ghost' : 'btn-primary'}" data-keep>
            保留文库版本${primaryIsOverwrite ? '' : '（推荐）'}
          </button>
          <button class="btn ${primaryIsOverwrite ? 'btn-primary' : 'btn-ghost'}" data-overwrite>
            用新文件覆盖${primaryIsOverwrite ? '（推荐）' : ''}
          </button>
        </div>
      </div>`);

    U.$('[data-keep]', ui.mask).addEventListener('click', () => { ui.close(); App.store.actions.resolveKeep(uploadId); App.ui.toast('已保留文库中的版本', 'ok'); });
    U.$('[data-overwrite]', ui.mask).addEventListener('click', () => { ui.close(); App.store.actions.resolveOverwrite(uploadId); App.ui.toast('已用上传的文件覆盖文库版本', 'ok'); });
    U.$('[data-keep-both]', ui.mask).addEventListener('click', () => { ui.close(); App.store.actions.resolveKeepBoth(uploadId); App.ui.toast('两份版本均已入库', 'ok'); });
  }

  /* ==========================================================================
     5. 论文列表渲染与筛选
     ========================================================================== */
  let filter = 'all';

  function renderList() {
    const box = U.$('#plist');
    if (!box) return;
    let list = App.store.state.papers.slice();
    if (filter === 'low') list = list.filter((p) => (p.quality || 0) < 0.88);
    if (filter === 'scanned') list = list.filter((p) => p.scanned);
    if (filter === 'starred') list = list.filter((p) => p.starred);

    if (!list.length) {
      box.innerHTML = h`<tr><td colspan="8">${U.raw(App.ui.empty('▤', '没有符合条件的论文'))}</td></tr>`;
      return;
    }

    box.innerHTML = list.map((p) => h`
      <tr>
        <td data-action="parse-detail" data-id="${p.id}" style="cursor:pointer">
          <div class="row gap-8">
            <span style="color:${p.starred ? '#e2a336' : 'var(--text-3)'}">${p.starred ? '★' : '☆'}</span>
            <div class="grow" style="min-width:0">
              <div class="ellipsis" style="max-width:300px">${p.title}</div>
              <div class="muted tiny mono ellipsis" style="max-width:300px">${p.file}</div>
            </div>
          </div>
        </td>
        <td class="small muted"><div class="ellipsis" style="max-width:170px">${App.data.formatAuthors(p.authors, 2)}</div></td>
        <td class="small nowrap">${p.year} <span class="muted">· v${p.version}</span></td>
        <td class="mono small">${p.pages}</td>
        <td class="small muted nowrap">${p.sections} 章 / ${p.figures} 图 / ${p.tables} 表</td>
        <td>${U.raw(App.ui.qualityBadge(p.quality))}</td>
        <td class="small muted nowrap">${U.ago(p.addedAt)}</td>
        <td>
          <div class="row gap-4">
            <button class="btn btn-sm btn-ghost" data-action="open-paper" data-id="${p.id}" title="打开阅读器">阅读</button>
            <button class="btn btn-sm btn-ghost btn-icon" data-action="meta" data-id="${p.id}" title="元数据">✎</button>
            <button class="btn btn-sm btn-ghost btn-icon" data-action="reparse" data-id="${p.id}" title="重新解析">↻</button>
            <button class="btn btn-sm btn-ghost btn-icon" data-action="delete-paper" data-id="${p.id}" title="删除">🗑</button>
          </div>
        </td>
      </tr>`).join('');

    // 收藏点击（行内 ★ 单独处理）
    U.$$('#plist tr').forEach((tr) => {
      const star = U.$('td:first-child span:first-child', tr);
      if (star) star.addEventListener('click', (e) => {
        e.stopPropagation();
        App.store.actions.toggleStar(tr.querySelector('[data-id]').dataset.id);
      });
    });
  }

  function confirmDelete(id) {
    const p = App.data.getPaper(id);
    if (!p) return;
    App.ui.confirm({
      title: '删除论文',
      body: App.ui.Out(h`<div>确定要从文库中删除 <b>${p.title}</b> 吗？</div>
              <div class="muted small mt-8">该操作会同时删除已生成的向量索引与引用关系（演示环境可随时重新上传恢复）。</div>`),
      okText: '删除', danger: true,
    }).then((ok) => {
      if (!ok) return;
      App.store.actions.deletePaper(id);
      App.ui.toast('已删除《' + U.clip(p.title, 18) + '》', 'ok');
    });
  }

  /* ==========================================================================
     6. 解析详情抽屉（结构化解析结果）
     ========================================================================== */
  function drawerHtml(paperId) {
    const p = App.data.getPaper(paperId);
    if (!p) return '';
    const doc = App.data.getDoc(p.id);
    const toc = doc ? doc.toc : [];

    return App.ui.Out(h`
      <div class="modal-head">
        <div class="card-title">结构化解析详情</div>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-ghost" data-action="close-drawer">✕</button>
      </div>
      <div class="modal-body">
        <div style="font-size:16px;font-weight:680">${p.title}</div>
        ${p.titleZh ? h`<div class="muted small mt-8">${p.titleZh}</div>` : ''}
        <div class="row gap-8 mt-12 wrap">
          ${U.raw(App.ui.qualityBadge(p.quality))}
          <span class="badge badge-outline">${p.pages} 页</span>
          <span class="badge badge-outline">${U.bytes(p.sizeBytes)}</span>
          ${p.scanned ? U.raw(h`<span class="badge badge-warn">扫描件 · OCR</span>`) : U.raw(h`<span class="badge badge-ok">含文本层</span>`)}
          <span class="badge badge-outline">${p.arxiv || '非 arXiv'}</span>
        </div>

        ${U.raw(App.ui.sectionTitle('① 标题（Title）'))}
        <div class="kv"><span>英文标题</span><b>${p.title}</b></div>
        <div class="kv"><span>中文标题</span><b>${p.titleZh || '（自动翻译）'}</b></div>
        <div class="kv"><span>来源 / 版本</span><b>${p.venue} · v${p.version}</b></div>

        ${U.raw(App.ui.sectionTitle('② 作者（Authors）'))}
        <div class="card"><div class="card-body tight">
          ${U.raw((p.authors || []).map((a, i) => h`
            <div class="kv kv-row"><span class="muted mono">${i + 1}</span><b>${a}</b>
              <span class="muted tiny">${i === 0 ? '第一作者' : i === (p.authors.length - 1) ? '通讯作者（推定）' : ''}</span>
            </div>`).join(''))}
        </div></div>
        <div class="muted tiny mt-8">机构：Google Brain / Google Research / University of Toronto（演示数据，来自论文首页脚注）</div>

        ${U.raw(App.ui.sectionTitle('③ 摘要（Abstract）'))}
        <div class="abstract-box">
          <div class="abstract-en">${p.abstract}</div>
          <div class="abstract-zh">${p.abstractZh || ''}</div>
        </div>

        ${U.raw(App.ui.sectionTitle('④ 章节层级（TOC）', '<span class="muted tiny">需求要求解析到三级标题</span>'))}
        ${toc.length
          ? U.raw(h`<div class="toc-preview">${toc.map((t) => h`
              <div class="toc-line lv${t.level}">
                <span class="mono muted tiny">p.${t.page}</span>
                <span>${t.title}</span>
                <span class="muted tiny">${t.titleZh || ''}</span>
              </div>`).join('')}</div>`)
          : U.raw(App.ui.empty('❐', '该论文未内置演示目录（仅《Attention Is All You Need》提供了完整章节树）'))}

        ${U.raw(App.ui.sectionTitle('⑤ 结构化元素统计'))}
        <div class="grid grid-4">
          ${U.raw(App.ui.statCard({ label: '表格', value: p.tables, unit: '个' }))}
          ${U.raw(App.ui.statCard({ label: '图表', value: p.figures, unit: '个' }))}
          ${U.raw(App.ui.statCard({ label: '公式', value: p.formulas, unit: '条' }))}
          ${U.raw(App.ui.statCard({ label: '参考文献', value: p.refs, unit: '条' }))}
        </div>

        ${U.raw(App.ui.sectionTitle('⑥ 参考文献（References）'))}
        <div class="muted small">已抽取 ${p.refs} 条参考文献条目；其中可在文库中找到原文的（如 [1] Layer Normalization → 1607.06450v1.pdf）会标记「库中已有」，支持一键跳转阅读。</div>
        <div class="row gap-8 mt-12">
          <span class="badge badge-ok">库中已有：1 条</span>
          <span class="badge badge-outline">可自动下载：${Math.max(0, p.refs - 1)} 条</span>
        </div>

        ${U.raw(App.ui.sectionTitle('⑦ 附录（Appendix）'))}
        <div class="muted small">${p.id === 'p-attention-v7' || p.id === 'p-attention-v1'
          ? '检测到附录：Attention Visualizations（含图 3、图 4 注意力可视化），已单独成节。'
          : '未检测到独立附录章节。'}</div>

        ${p.note ? U.raw(h`<div class="notice info mt-16"><span>ℹ</span><div>${p.note}</div></div>`) : ''}
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-action="meta" data-id="${p.id}">编辑元数据</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" data-action="open-paper" data-id="${p.id}">打开阅读器 →</button>
      </div>`);
  }

  /* ==========================================================================
     7. 元数据编辑抽屉
     ========================================================================== */
  function metaDrawerHtml(paperId) {
    const p = App.data.getPaper(paperId);
    if (!p) return '';
    return App.ui.Out(h`
      <div class="modal-head">
        <div class="card-title">元数据管理</div>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-ghost" data-action="close-drawer">✕</button>
      </div>
      <div class="modal-body">
        <div class="muted small mb-16">这是 CRUD 中的 Update 部分：修正自动解析结果（作者顺序、年份、会议、标签等）。保存后写入数据库。</div>
        <label class="field-label">标题</label>
        <input class="input mb-12" id="meta-title" value="${p.title}" />
        <label class="field-label">作者（每行一位，顺序即署名顺序）</label>
        <textarea class="textarea mb-12" id="meta-authors" rows="4">${(p.authors || []).join('\n')}</textarea>
        <div class="grid grid-2">
          <div>
            <label class="field-label">年份</label>
            <input class="input mb-12" id="meta-year" value="${p.year || ''}" inputmode="numeric" />
          </div>
          <div>
            <label class="field-label">版本（只读）</label>
            <input class="input mb-12" value="${p.version ? 'v' + String(p.version).replace(/^v/i, '') : '未标注'}" disabled />
            <div class="muted tiny mt-8">版本号来自文件名，不能手改</div>
          </div>
        </div>
        <label class="field-label">会议 / 期刊</label>
        <input class="input mb-12" id="meta-venue" value="${p.venue || ''}" />
        <label class="field-label">arXiv ID</label>
        <input class="input mb-12" id="meta-arxiv" value="${p.arxiv || ''}" />
        <label class="field-label">关键词（逗号分隔）</label>
        <input class="input" id="meta-keywords" value="${(p.keywords || []).join(', ')}" />
      </div>
      <div class="modal-foot">
        <button class="btn btn-danger" data-action="delete-paper" data-id="${p.id}">删除该论文</button>
        <div class="spacer"></div>
        <button class="btn btn-ghost" data-action="close-drawer">取消</button>
        <button class="btn btn-primary" id="meta-save" data-id="${p.id}">保存</button>
      </div>`);
  }

  /* ==========================================================================
     8. 工具函数
     ========================================================================== */
  /** 供其他视图打开文库筛选（如 dashboard 点击「需校对」） */
  function setFilter(f) { filter = f; renderList(); }

  App.views = App.views || {};
  App.views.library = {
    render, pickFiles, showDiff, confirmDelete,
    drawerHtml, metaDrawerHtml, setFilter,
    // 导出给冒烟测试：验证重复弹窗里的字段对照（真实数据，不含编造条目）
    compareRows,
  };

  /**
   * 读取抽屉表单 → 调 PATCH /papers/:id。
   *
   * 之前这里只弹一个 toast「已保存（演示：真实实现会 PATCH）」——
   * 用户改完标题刷新就变回原样，属于假按钮。现在真正写入数据库：
   * 保存成功后重新拉取列表，界面上的标题立即变化。
   * 版本号不可改（来自文件名），所以表单里是只读展示。
   */
  async function saveMeta(paperId) {
    const val = (id) => {
      const el = U.$('#' + id);
      return el ? el.value.trim() : '';
    };

    const payload = {};
    const title = val('meta-title');
    if (title) payload.title = title;
    const authors = val('meta-authors');
    if (authors) payload.authors = authors;
    const yearRaw = val('meta-year');
    if (yearRaw) {
      const year = parseInt(yearRaw, 10);
      if (!Number.isFinite(year) || year < 1000 || year > 2999) {
        App.ui.toast('年份需为 1000~2999 之间的整数', 'warn', 3000);
        return;
      }
      payload.year = year;
    }
    const venue = val('meta-venue');
    if (venue) payload.venue = venue;
    const arxiv = val('meta-arxiv');
    if (arxiv) payload.arxiv_id = arxiv;
    const keywords = val('meta-keywords');
    if (keywords) payload.keywords = keywords;

    if (!Object.keys(payload).length) {
      App.ui.toast('没有需要保存的修改', 'warn', 2200);
      return;
    }

    try {
      await App.api.updatePaper(paperId, payload);
      await App.store.actions.loadPapers();
      App.store.actions.drawer(null);
      App.ui.toast('元数据已保存', 'ok', 2200);
    } catch (err) {
      App.ui.toast('保存失败：' + err.message, 'error', 4000);
    }
  }

  /* 抽屉保存按钮与筛选框（因为抽屉是后插入 DOM 的，这里挂在 document 上统一处理） */
  document.addEventListener('click', (e) => {
    if (e.target.id === 'meta-save') {
      const id = e.target.dataset.id
        || (App.store.state.ui.drawer && App.store.state.ui.drawer.payload.paperId);
      if (id) saveMeta(id);
    }
    if (e.target.id === 'filter' || (e.target.dataset && e.target.dataset.bg)) return;
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'filter') setFilter(e.target.value);
  });
})(window.App);
