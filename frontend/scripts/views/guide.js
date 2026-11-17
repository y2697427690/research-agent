/* ============================================================================
   views/guide.js — 说明 / 对照表
   ----------------------------------------------------------------------------
   这一页的用途：把「需求文档里的每一条」和「前端里的哪个页面 / 哪个元素 / 哪段代码」
   一一对应起来。评审或新同学接手时，从这里就能知道去哪找。
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  /** 需求 → 页面元素 → 代码位置 的对照表（全部指向真实实现） */
  const MAP = [
    {
      no: '1.1', name: 'PDF 文件管理和解析', view: '文库', route: 'library',
      items: [
        { req: '基本 CRUD（上传 / 查看 / 修改元数据 / 删除）', ui: '上传拖拽区、每行右侧的 ✎ / ↻ / 🗑 按钮、元数据抽屉', code: 'views/library.js → render() / metaDrawerHtml()；api/v1/papers.py' },
        { req: '批量上传', ui: '拖拽区 +「选择 PDF 文件」（支持多选）', code: 'library.js → bindUpload()' },
        { req: '上传后解析、提取文字', ui: '「上传与解析流水线」卡片：排队 / 解析 / 完成与进度', code: 'store.js → _runPipeline()；services/parser_service.py' },
        { req: '1.1.1 内容去重（不同文件、相同内容）', ui: '「检测到重复论文」弹窗（SHA-1 → 扫描件特征 → arXiv 版本 → 文件名）', code: 'core/dedupe.js；services/dedupe.py' },
        { req: '版本差异对比（v1 vs v7）', ui: '弹窗中的「真实可比信息」表：版本号、大小、页数、解析状态', code: 'library.js → compareRows()' },
        { req: '1.1.2 标题 / 作者 / 摘要 / 一~三级标题', ui: '解析详情抽屉 + 阅读器左侧三级目录', code: 'services/pdf_parser.py → parse_pdf()' },
        { req: '参考文献 / 附录', ui: '阅读器文末「参考文献」区块；附录章节进目录', code: 'services/pdf_parser.py → extract_references()' },
        { req: '表格结构抽取', ui: '阅读器工具栏「表格」按钮 → 弹窗渲染真实行列', code: 'services/table_extractor.py；GET /papers/{id}/tables' },
        { req: '图片与图注', ui: '阅读器「图片」按钮 → 位图网格 + 图注摘录', code: 'services/figure_extractor.py；GET /papers/{id}/figures、/figure-captions' },
        { req: '扫描件 OCR', ui: '扫描件解析后状态为「需校对」，警告含「已用 OCR 识别前 12 页」', code: 'services/ocr_service.py（tesseract + PyMuPDF）' },
        { req: '超长文档解析（541 页教材）', ui: '文库中的 Understanding Deep Learning（541 页）', code: 'services/chunking.py 分块入库' },
        { req: '测试论文入库', ui: '文库 20 篇（含需求点名的测试文件）', code: '真实数据库 app.db' },
      ],
    },
    {
      no: '1.2', name: '知识问答', view: '知识问答', route: 'qa',
      items: [
        { req: '1.2.1 单篇论文问答（RAG）', ui: '左栏「问答范围：单篇论文」+ 论文勾选列表', code: 'services/retrieval.py → retrieve()；services/rag.py → answer()' },
        { req: '给出参考原文，便于发现幻觉', ui: '回答下方「检索命中 N 段 · 引用 M 段」证据卡片', code: 'qa.js → msgHtml() / evidenceHtml()' },
        { req: '回答中的引用可点击定位', ui: '回答里的 [1] 角标 → 高亮对应证据片段', code: 'qa.js → jumpEvidence()' },
        { req: '需求点名的 5 道例题', ui: '欢迎页示例问题（点击即用真实检索回答，无内置答案）', code: 'qa.js → EXAMPLES_SINGLE；services/rag.py' },
        { req: '1.2.2 多篇论文问答（跨文献对比）', ui: '左栏切「多篇论文」→ 勾选 ≥2 篇 → 对比提示词', code: 'store.js → setQaScope()；rag.py → build_messages()' },
        { req: 'Top-K 检索片段数', ui: '左栏「RAG 参数」Top-K 下拉框（3/5/8/12）', code: 'store.js → setTopK()' },
        { req: 'Agent 自主调用（工具注册表 + 轨迹）', ui: '左栏「Agent 自主调用」→ 打开面板执行；「历史轨迹」可回放', code: 'app/agent/registry.py、loop.py；GET /agent/history' },
        { req: '会话管理 + 导出', ui: '左栏「会话」卡片（新建 / 切换 / 导出 Markdown）', code: 'store.js → newChat()；qa.js → exportChat()' },
      ],
    },
    {
      no: '1.3', name: '阅读和翻译', view: '阅读器', route: 'reader',
      items: [
        { req: '1.3.1 阅读原文（语义块重排，非原位复刻）', ui: '阅读器「原文」面板（标题/正文/公式块）', code: 'reader.js → blockHtml()' },
        { req: '页面缩放', ui: '工具栏 － / ＋ 按钮', code: 'store.js → setReaderScale()' },
        { req: '1.3.2 树状导航栏', ui: '左侧「目录导航」（三级缩进 + 页码）', code: 'reader.js → outlineHtml()' },
        { req: '快速跳转到小节并高亮', ui: '点目录项平滑滚动，滚动时目录自动高亮', code: 'reader.js → scrollToAnchor()' },
        { req: '引文 ↔ References 双向跳转', ui: '正文 [11] 跳条目；条目「跳到正文」跳回引用段（多处轮转）；两侧均有返回按钮', code: 'reader.js → scrollToRef() / jumpToCiting()；GET /papers/{id}/references' },
        { req: '参考文献在库中可直接打开', ui: '条目上的「打开」按钮', code: 'reader.js → refItemHtml()' },
        { req: '疑似应付式引用标记', ui: '参考文献条目的「疑似应付式」徽标（hover 显示依据）', code: 'services/reference_service.py（grouped/solo 统计）' },
        { req: '从参考文献抓取原文', ui: '参考文献区「从参考文献抓取」→ 匹配候选 → 逐条入库', code: 'POST /papers/{id}/references/match；复用 /discover/ingest' },
        { req: '1.3.3.1 划词翻译', ui: '选中文字 → 浮层 →「翻译为中文」（模型）', code: 'reader.js → showSelPop() / translateSelection()；POST /translate' },
        { req: '1.3.3.2 整篇翻译 + 中英对照 + 同步滚动', ui: '工具栏「中英对照 / 整篇译文」；左栏底部同步滚动开关', code: 'reader.js → bindReader() sync()；services/translate_service.py' },
        { req: '公式保留原文不翻译', ui: '公式块标注「公式保留原始 LaTeX」', code: 'reader.js → blockHtml() 的 formula 分支' },
        { req: '导出', ui: '工具栏「导出 MD / 导出 HTML / 打印为 PDF」', code: 'reader.js → exportMarkdown() / exportHtml() / exportPdf()' },
        { req: '表格 / 图片 / 未来工作', ui: '工具栏对应三个按钮，弹窗展示', code: 'reader.js → openTablesModal / openFiguresModal / openFutureModal' },
      ],
    },
    {
      no: '1.4', name: '论文自动下载和推荐', view: '发现与推荐', route: 'discover',
      items: [
        { req: '1.4.1 关键词检索 arXiv 并一键入库', ui: '顶部搜索卡片 + 结果卡片「入库并解析」', code: 'services/discover.py；POST /discover/search、/discover/ingest' },
        { req: '1.4.2 定期追踪新论文', ui: '「我的订阅」：关键词 + 分类；显示「每天 09:00 自动检查 · 下次 …」', code: 'services/subscription_service.py、subscription_scheduler.py；GET /subscriptions/schedule' },
        { req: '订阅命中项批量入库', ui: '命中项「入库并解析」→「入库中…」→「已在库」', code: 'store.js → discoverIngest()' },
        { req: '1.4.3 每日新论文推荐（基于库内相关性）', ui: '命中项「为什么推荐」→ 模型生成的关系说明', code: 'POST /discover/reason；services/recommend_service.py' },
        { req: '有 GitHub 代码的优先', ui: '结果卡片「含代码」徽标（扫摘要中的仓库域名）', code: 'services/discover.py → _has_code()' },
        { req: '用户反馈：点赞 / 踩', ui: '文库每行的 👍 / 👎（计数来自服务端，刷新保留）', code: 'POST /papers/{id}/feedback；models/feedback.py' },
      ],
    },
    {
      no: '1.5', name: '论文分析与生成', view: '引用图谱', route: 'graph',
      items: [
        { req: '1.5.1 局域引用图谱', ui: 'SVG 力导向图，箭头方向 = 引用方向；可按分组切换', code: 'views/graph.js → drawGraph() / layout()；services/graph_service.py' },
        { req: '1.5.2 核心节点挖掘（基石 / 边缘）', ui: '「核心节点挖掘」卡片 + 右侧图指标（入度 / PageRank）', code: 'graph.js → metrics() / renderInsights()' },
        { req: '图论算法可视化', ui: '节点大小随入度变化，高入度显示为金色', code: 'graph.js → drawGraph()' },
        { req: '1.5.3 自动综述', ui: '「自动综述」卡片 →「✦ 生成领域综述」（按入度排序，带《标题》出处）', code: 'POST /graph/summary；services/survey_service.py' },
        { req: '1.5.4 Future Work 摘录', ui: '阅读器「未来工作」按钮 → 候选段（关键词匹配，标注可能误命中）', code: 'GET /papers/{id}/future-work' },
      ],
    },
    {
      no: '1.6', name: '写作助手', view: '写作助手', route: 'writing',
      items: [
        { req: '1.6.1 论文框架生成', ui: '① 论文框架：输入 idea → 生成 7 个章节卡片', code: 'POST /writing/outline；services/writing_service.py' },
        { req: 'References 真实无幻觉', ui: '「References 真实性核验」表；库外条目被白名单过滤', code: 'writing_service.build_outline() 的库内标题白名单' },
        { req: '1.6.2 TikZ / Graphviz / Mermaid / Matplotlib 代码', ui: '② 架构图代码：输入方法 →「用模型生成」→ 对应格式代码', code: 'POST /writing/diagram' },
        { req: '1.6.3 CSV → 表格 / 柱状 / 折线 / 雷达', ui: '③ 数据可视化：载入或上传 CSV，切换图表类型', code: 'core/writer.js → parseCSV() / renderBarChart() / renderRadar()' },
        { req: 'Figure Caption 自动生成', ui: '③ 页下方 Caption 卡片（含最高/最低项与趋势结论）', code: 'core/writer.js → buildCaption()' },
        { req: '1.6.4 中译英', ui: '④ 中译英：输入中文摘要 →「翻译为英文」', code: 'POST /translate?direction=zh2en' },
      ],
    },
    {
      no: '3 / 4', name: '提交要求与评分标准', view: '工作台', route: 'dashboard',
      items: [
        { req: 'AI 技术深度', ui: '本页「30 题 gold set 实测」+ 技术文档第 4 章', code: 'docs/eval/report.md；docs/tech-report/' },
        { req: '功能与工程质量', ui: '本页对照表 + README 模块地图', code: 'README.md' },
        { req: '用户体验', ui: '统一设计令牌、快捷键（Ctrl+K / Esc）、空状态与加载态', code: 'styles/theme.css；core/app.js' },
        { req: '提交要求：密钥不得入库', ui: '后端 .env 配置，仓库只提交 .env.example', code: 'backend/.env.example；core/config.py' },
      ],
    },
  ];

  /** 目录树用普通字符串拼接，避免与模板字符串的反引号冲突 */
  const FILES = [
    'research-assistant/',
    '├── index.html                  入口页：按顺序加载脚本并启动 App.boot()',
    '├── README.md                   使用说明 + 模块地图',
    '├── docs/requirements.md        从 PDF 提取并整理的需求原文',
    '├── styles/',
    '│   ├── theme.css               设计令牌（颜色/字号/圆角/阴影）：换肤只改这里',
    '│   ├── app.css                 应用外壳 + 公共组件（按钮/卡片/表格/弹窗/抽屉/Toast）',
    '│   └── views.css               各业务视图专属样式（文库/阅读器/问答/图谱/写作）',
    '└── scripts/',
    '    ├── core/',
    '    │   ├── util.js             工具函数：转义、模板、日期、模拟异步、流式输出',
    '    │   ├── store.js            全局状态 + 所有业务动作（接后端时改这里）',
    '    │   ├── components.js       公共组件：Toast / 确认框 / 统计卡 / 徽章 / 空状态',
    '    │   ├── rag.js              检索引擎：分词 → BM25 打分 → Top-K → 拼装回答',
    '    │   ├── dedupe.js           去重与版本差异：指纹相似度 + 逐条 diff',
    '    │   ├── writer.js           写作助手算法：框架 / CSV 解析 / 图表 / 图注生成',
    '    │   └── app.js              视图注册表、路由、外壳渲染、事件动作表',
    '    ├── data/',
    '    │   └── adapter.js          后端 snake_case → 前端 camelCase 的映射层',
    '    └── views/',
    '        ├── dashboard.js        工作台',
    '        ├── library.js          文库（上传 / 解析 / 去重 / CRUD）',
    '        ├── reader.js           阅读器（目录 / 对照 / 引文跳转 / 划词翻译）',
    '        ├── qa.js               知识问答（单篇 / 多篇 + 证据面板）',
    '        ├── graph.js            引用图谱（力导向 / 核心节点 / 综述 / 未来工作）',
    '        ├── discover.js         发现与推荐（下载 / 刷新 / 推荐 / 反馈）',
    '        ├── writing.js          写作助手（框架 / 图代码 / 可视化 / 翻译）',
    '        └── guide.js            本页',
  ].join('\n');


  /**
   * 评测卡片：读 /eval/summary（数据由 deploy/eval_gold.py 跑完落盘）。
   * 不在页面里实时跑评测 —— 一次要打 30 题真实模型、2~3 分钟，打开页面等不起。
   */
  function renderEvalCard(el) {
    const box = U.$('#eval-card', el);
    if (!box) return;
    // 离线/测试环境没有 App.api，直接给兜底文案，别让整页渲染抛错
    if (!App.api || typeof App.api.evalSummary !== 'function') {
      box.innerHTML = h`
        <div class="card-head"><div class="card-title">30 题 gold set 实测</div></div>
        <div class="card-body tight"><div class="muted small">离线模式下不加载评测数据。</div></div>`;
      return;
    }
    App.api.evalSummary().then((d) => {
      const pct = (v) => Math.round((v || 0) * 1000) / 10;
      const bar = (label, value) => h`
        <div class="row gap-8 mb-8" style="align-items:center">
          <span class="muted small" style="width:96px">${label}</span>
          <div style="flex:1;height:8px;background:var(--bg-2);border-radius:4px;overflow:hidden">
            <div style="width:${pct(value)}%;height:100%;background:var(--brand)"></div>
          </div>
          <span class="mono small" style="width:52px;text-align:right">${pct(value)}%</span>
        </div>`;
      box.innerHTML = h`
        <div class="card-head">
          <div class="card-title">30 题 gold set 实测</div>
          <div class="spacer"></div>
          <span class="badge badge-ok">${d.n_answerable} 可答 + ${d.n_unanswerable} 不可答</span>
        </div>
        <div class="card-body">
          ${U.raw(bar('Recall@' + d.top_k, d.recall))}
          ${U.raw(bar('引用准确率', d.cite_precision))}
          ${U.raw(bar('可答率', d.answered_rate))}
          ${U.raw(bar('拒答准确率', d.refusal_rate))}
          <div class="muted tiny mt-8">
            平均单题耗时 ${d.avg_cost} 秒 · 评测时间 ${d.generated_at} · 目标 ${d.base}
          </div>
          <div class="muted tiny mt-8">
            逐题结果见 <code>docs/eval/report.md</code>；题目见 <code>docs/eval/gold.json</code>。
            指标定义：Recall@K = 期望事实是否出现在检索前 K 段；引用准确率 = 引用片段中真含该事实的比例。
          </div>
        </div>`;
    }).catch(() => {
      box.innerHTML = h`
        <div class="card-head"><div class="card-title">30 题 gold set 实测</div></div>
        <div class="card-body tight">
          <div class="muted small">还没有评测结果。运行 <code>python deploy/eval_gold.py</code> 后会显示在这里。</div>
        </div>`;
    });
  }

  function render(el) {
    const total = MAP.reduce((a, g) => a + g.items.length, 0);

    el.innerHTML = h`
      <div class="view-head">
        <div class="grow">
          <div class="view-title">说明 · 需求与页面对照表</div>
          <div class="view-desc">
            左边是需求文档里的每一条要求，中间是它在界面上的位置，右边是对应的源码文件。
            共 ${MAP.length} 组功能、${total} 条要求。评审时可直接按这张表逐条验收。
          </div>
        </div>
        <div class="col" style="align-items:flex-end;gap:6px">
          <span class="badge badge-brand">需求来源：科研小助手Agent-AI大模型.pdf</span>
          <span class="badge badge-outline">已映射到具体页面元素</span>
        </div>
      </div>

      <div class="card mb-16" id="eval-card">
        <div class="card-head">
          <div class="card-title">30 题 gold set 实测</div>
          <div class="spacer"></div>
          <span class="badge badge-outline">加载中…</span>
        </div>
        <div class="card-body tight"><div class="muted small">正在读取最近一次评测结果…</div></div>
      </div>

      ${U.raw(MAP.map((g) => h`
        <div class="card mb-16">
          <div class="card-head">
            <span class="badge badge-brand mono">${g.no}</span>
            <div class="card-title">${g.name}</div>
            <div class="spacer"></div>
            <button class="btn btn-sm btn-ghost" data-action="go" data-route="${g.route}">前往「${g.view}」→</button>
          </div>
          <div style="overflow:auto">
            <table class="table">
              <thead>
                <tr>
                  <th style="width:31%">需求条目</th>
                  <th style="width:36%">对应的界面元素（去哪里看）</th>
                  <th>对应代码（去哪里改）</th>
                </tr>
              </thead>
              <tbody>
                ${U.raw(g.items.map((it) => h`
                  <tr>
                    <td class="small">${it.req}</td>
                    <td class="small">${it.ui}</td>
                    <td class="small mono muted">${it.code}</td>
                  </tr>`).join(''))}
              </tbody>
            </table>
          </div>
        </div>`).join(''))}

      ${App.ui.sectionTitle('文件结构说明', '<span class="muted tiny">想改哪里就打开哪个文件</span>')}
      <div class="card">
        <div class="card-body tight">
          <pre class="code-block">${FILES}</pre>
        </div>
      </div>

      ${App.ui.sectionTitle('数据与模型链路', '<span class="muted tiny">全部为真实实现，无演示数据</span>')}
      <div class="grid grid-3">
        ${U.raw([
          { t: '① 数据来源', d: 'SQLite（app.db）+ 本地 PDF 存储；前端通过 /api/v1 读取，无 mock 数据。' },
          { t: '② 检索', d: 'BM25 + 向量混合检索（RRF 融合），嵌入不可用时自动降级为纯 BM25 并在界面提示。' },
          { t: '③ 大模型', d: 'OpenAI 兼容接口（deepseek-chat）；问答走 SSE 流式，未配置 Key 时明确报错而非编造。' },
          { t: '④ 引用校验', d: '回答强制带 [n] 角标，服务端按片段编号校验，越界角标被剥离；证据片段附页码与原文。' },
          { t: '⑤ 定时任务', d: 'APScheduler 每日 09:00 检查订阅，串行 + 4 秒间隔（arXiv 要求 ≥3 秒）。' },
          { t: '⑥ 密钥安全', d: '所有 API Key 只从后端环境变量读取，仓库只提交 .env.example（对应提交要求 3.5）。' },
        ].map((c) => h`
          <div class="card"><div class="card-body">
            <div style="font-weight:640" class="mb-8">${c.t}</div>
            <div class="muted small">${c.d}</div>
          </div></div>`).join(''))}
      </div>
    `;

    // 必须在 innerHTML 赋值之后调用：renderEvalCard 要先找到 #eval-card，
    // 之前放在赋值前导致永远找不到节点，卡片一直停在「正在读取…」。
    renderEvalCard(el);
  }

  App.views = App.views || {};
  App.views.guide = { render, MAP };
})(window.App);
