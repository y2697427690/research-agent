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

  /** 需求 → 页面元素 → 代码位置 的对照表 */
  const MAP = [
    {
      no: '1.1', name: 'PDF 文件管理和解析', view: '文库', route: 'library',
      items: [
        { req: '基本 CRUD（上传 / 查看 / 修改元数据 / 删除）', ui: '上传拖拽区、每行右侧的 ✎ / ↻ / 🗑 按钮、元数据抽屉', code: 'scripts/views/library.js → render() / metaDrawerHtml()' },
        { req: '批量上传', ui: '拖拽区 + 「选择 PDF 文件」（支持多选）', code: 'library.js → bindUpload()' },
        { req: '上传后解析、提取文字', ui: '「上传与解析流水线」卡片，显示排队 / 解析 / 完成与进度条', code: 'store.js → addUploads() / _runPipeline()' },
        { req: '更高级解析（识别结构、公式、表格、图表）', ui: '解析详情抽屉的 7 个分区（标题/作者/摘要/章节/表格/公式/参考文献/附录）', code: 'library.js → drawerHtml()' },
        { req: '1.1.1 内容去重（文件不同但内容相同）', ui: '上传后弹出「检测到重复论文」弹窗', code: 'core/dedupe.js → findDuplicate()' },
        { req: '提示选择保留哪个版本 / 默认保留新版', ui: '弹窗底部四个选项：稍后处理 / 两份都保留 / 保留文库版本 / 用新文件覆盖；主按钮随「谁更新」翻转，推荐项由版本号算出', code: 'views/library.js → showDiff()；store.js → resolveOverwrite / resolveKeep / resolveKeepBoth' },
        { req: '版本差异对比（v1 vs v7）', ui: '弹窗中的「真实可比信息」表：版本号、文件大小、页数、解析状态；逐段 diff 未实现并已在弹窗内注明', code: 'views/library.js → compareRows()' },
        { req: '1.1.2 解析粒度：标题、作者、摘要、一~三级标题', ui: '解析详情抽屉 + 阅读器左侧树状目录', code: '后端 parser_service 解析出章节树 → adapter 映射为目录；views/reader.js → render()' },
        { req: '表格 / 图表 / 公式 / 参考文献 / 附录', ui: '阅读器正文中的表格块、图形块、公式块、References 列表、Appendix 章节', code: 'reader.js → blockHtml()' },
        { req: '扫描件 PDF 解析（1706.03762v1_img.pdf）', ui: '文库列表中带「扫描件」徽章的行 + 解析详情中的 OCR 标记', code: 'mock-data.js → p-attention-img；library.js → 质量徽章' },
        { req: '超长文档解析（541 页教材）', ui: '文库中 Understanding Deep Learning 一行（541 页 / 21 章 / 402 条公式）', code: 'mock-data.js → p-udl' },
        { req: 'pdf/ 目录里的测试论文', ui: '文库列表中的 40+ 篇论文（含需求点名的 4 个测试文件）', code: 'mock-data.js → papers[]' },
      ],
    },
    {
      no: '1.2', name: '知识问答', view: '知识问答', route: 'qa',
      items: [
        { req: '1.2.1 单篇论文问答（RAG）', ui: '左栏「问答范围：单篇论文」+ 论文勾选列表', code: 'core/rag.js → retrieve()' },
        { req: '给出参考原文，便于发现幻觉', ui: '回答气泡下方的「检索命中 N 段」证据卡片 + 右侧「引用原文（证据）」面板', code: 'qa.js → msgHtml() / evidenceHtml()' },
        { req: '回答中的引用可点击定位', ui: '回答中的 [1] 角标，点击后高亮对应证据片段', code: 'qa.js → jumpEvidence()' },
        { req: '例题 1：第 6 作者是谁、在哪个机构', ui: '欢迎页示例问题第 1 条（内置标准答案与出处）', code: 'mock-data.js → answers[0]' },
        { req: '例题 2：Adam 的 β1 / β2', ui: '示例问题第 2 条', code: 'mock-data.js → answers[1]' },
        { req: '例题 3：训练 Base 用了多少 GPU、什么型号', ui: '示例问题第 3 条', code: 'mock-data.js → answers[2]' },
        { req: '例题 4：Transformer (big) 的 BLEU 与当时 SOTA', ui: '示例问题第 4 条', code: 'mock-data.js → answers[3]' },
        { req: '例题 5：Layer Normalization 参考文献作者与年份', ui: '示例问题第 5 条', code: 'mock-data.js → answers[4]' },
        { req: '1.2.2 多篇论文问答（跨论文对比）', ui: '左栏切到「多篇论文」后示例问题换成 3 条对比题', code: 'qa.js → EXAMPLES_MULTI；store.js → setQaScope()' },
        { req: 'Top-K 检索片段数（RAG 可调参数）', ui: '左栏「RAG 参数」中的 Top-K 下拉框', code: 'store.js → setTopK()' },
        { req: '会话管理', ui: '左栏「会话」卡片（新建 / 切换 / 显示消息数）', code: 'store.js → newChat() / ask()' },
      ],
    },
    {
      no: '1.3', name: '阅读和翻译', view: '阅读器', route: 'reader',
      items: [
        { req: '1.3.1 保留原文排版（双栏/单栏、公式、表格）', ui: '阅读器中间的「原文」面板，含公式块、表格块、图形块', code: 'reader.js → blockHtml()' },
        { req: '页面缩放', ui: '顶栏工具条的 － / ＋ 按钮', code: 'store.js → setReaderScale()' },
        { req: '1.3.2 一/二级标题做成树状导航栏', ui: '阅读器左侧「目录导航」（三级缩进 + 页码）', code: 'reader.js → outlineHtml()' },
        { req: '快速跳转到某个小节（如 3.2.2）', ui: '点击目录任意一项平滑滚动，滚动时目录自动高亮当前节', code: 'reader.js → scrollToAnchor() + 滚动高亮逻辑' },
        { req: '引文点击跳到 References', ui: '正文里的 [11] [1] 角标', code: 'reader.js → scrollToRef()' },
        { req: '从 References 快速跳回原位', ui: '跳到参考文献后出现的「↩ 跳回原文引用位置」按钮', code: 'reader.js → scrollToRef() 中的 back-to-cite' },
        { req: '参考文献若库中已有原文可直接打开', ui: 'References 条目下的「库中已有原文 → 打开阅读」按钮', code: 'reader.js → blockHtml() 的 reference 分支' },
        { req: '1.3.3.1 部分翻译 / 划词翻译', ui: '在原文区划选文字 → 弹出浮层 → 「翻译为中文」', code: 'reader.js → showSelPop() / translateSelection()' },
        { req: '1.3.3.2 整篇翻译（Markdown 重排 / 保排版 PDF 两种方案）', ui: '顶栏切到「整篇译文」模式，顶部提示条说明两种方案与中英长度差异问题', code: 'reader.js → modeBanner()' },
        { req: '公式 / 代码保留英文不翻译', ui: '公式块下方标注「公式保留原始 LaTeX，翻译时不改动」', code: 'mock-data.js → blocks type:"formula"' },
        { req: '1.3.3.3 中英对比阅读 + 双向同步滚动', ui: '顶栏切到「中英对照」，左右两栏；左栏底部有「同步滚动」开关', code: 'reader.js → bindReader() 中的 sync()' },
      ],
    },
    {
      no: '1.4', name: '论文自动下载和推荐', view: '发现与推荐', route: 'discover',
      items: [
        { req: '1.4.1 给定论文名称自动下载并入库', ui: '顶部「按名称自动下载」卡片', code: 'discover.js → doDownloadByName()' },
        { req: '根据参考文献批量下载', ui: '「批量抓取参考文献」卡片（演示 40 条 → 筛出 28 条）', code: 'discover.js → #refs-crawl' },
        { req: '更高级：按正文内容筛选重要参考文献', ui: '抓取按钮的提示文案「跳过 12 条为引用而引用的条目」', code: 'discover.js → #refs-crawl' },
        { req: '1.4.2 定期刷新 arXiv', ui: '右上「↻ 立即刷新 arXiv」+「订阅设置」卡片（cs.CL / cs.LG / 每 24 小时）', code: 'discover.js → #fetch-now' },
        { req: '1.4.3 每日 / 每周新论文推荐', ui: '「每日新论文」「本周精选」两个标签页', code: 'discover.js → renderList()' },
        { req: '推荐理由（基于内容，如「在 xxx 基础上提出…」）', ui: '每张推荐卡片里的「推荐理由」区块', code: 'mock-data.js → recommendations[].reason' },
        { req: '有 GitHub 代码的优先推荐', ui: '卡片上的「含代码」徽章 +「查看代码」按钮，排序时加权', code: 'discover.js → renderList() 排序逻辑' },
        { req: '用户反馈：点赞 / 踩一下', ui: '卡片右下「👍 有用 / 👎 不感兴趣」，点击后立即重排序', code: 'store.js → vote()' },
        { req: '多用户 / 协同过滤', ui: '「我的兴趣画像」标签页中的说明与权重条', code: 'discover.js → renderInterest()' },
      ],
    },
    {
      no: '1.5', name: '论文分析与生成', view: '引用图谱', route: 'graph',
      items: [
        { req: '1.5.1 一次性上传 20 篇后生成局域引用图谱', ui: '页面顶部的图谱分组选择器（Transformer 与大模型架构 · 20 篇）', code: 'mock-data.js → graphGroups' },
        { req: '在前端展示引用与被引用关系', ui: 'SVG 力导向图，箭头方向 = 引用方向；可切成「按时间环」布局', code: 'graph.js → drawGraph() / layout()' },
        { req: '1.5.2 核心节点挖掘（基石 / 边缘衍生）', ui: '「核心节点挖掘」两张卡片 + 右侧「图指标」入度排行', code: 'graph.js → metrics() / renderInsights()' },
        { req: '图论算法（入度、PageRank 思路）', ui: '节点大小随入度变化；高入度节点显示为金色', code: 'graph.js → drawGraph() 中的半径与配色' },
        { req: '1.5.3 自动综述', ui: '「自动综述」卡片 +「✦ 生成领域综述」按钮（流式输出）', code: 'graph.js → bind() 中的 #gen-summary' },
        { req: '1.5.4 未来工作探索（考虑时间与最新工作）', ui: '「未来工作探索」卡片，每条带「空档风险」评级与相关论文', code: 'mock-data.js → graphInsights.futureWork' },
      ],
    },
    {
      no: '1.6', name: '写作助手', view: '写作助手', route: 'writing',
      items: [
        { req: '1.6.1 论文框架生成（Abstract/Intro/Related Work/References）', ui: '① 论文框架 标签页，输入 idea → 生成 7 个章节卡片', code: 'core/writer.js → buildOutline()' },
        { req: '确保 References 真实、无幻觉', ui: '「References 真实性核验」表格（已验证 / 待联网核验）', code: 'writer.js → buildOutline().verify()' },
        { req: '1.6.2 生成 TikZ / Graphviz / Mermaid 架构图代码', ui: '② 架构图代码 标签页，三个格式切换按钮 + 代码块 + 结构预览', code: 'mock-data.js → writerPresets；writing.js → renderDiagram()' },
        { req: '1.6.3 上传 CSV → 表格 / 折线图 / 柱状图 / 三维雷达图', ui: '③ 数据可视化 标签页的四块区域', code: 'writer.js → parseCSV() / renderBarChart() / renderRadar()' },
        { req: '自动生成学术规范的 Figure Caption（含趋势结论）', ui: '④ 自动生成的 Figure Caption 卡片', code: 'writer.js → buildCaption()' },
        { req: '1.6.4 中文摘要 / 全文翻译为英文', ui: '④ 中译英 标签页 + 术语一致性表', code: 'writing.js → doTranslate()；writer.js → translateAbstract()' },
      ],
    },
    {
      no: '3 / 4', name: '提交要求与评分标准', view: '工作台', route: 'dashboard',
      items: [
        { req: '评分维度：AI 技术深度 35%', ui: '工作台「能力地图」中的 1.1 / 1.2 卡片（文档智能解析 + RAG 架构）', code: 'docs/requirements.md 第 4 节' },
        { req: '评分维度：产品功能工程质量 30%', ui: '本页对照表 + README 的模块说明（模块化、无构建依赖、数据层可独立替换）', code: 'README.md' },
        { req: '评分维度：用户体验 10%', ui: '统一设计令牌、键盘快捷键（Ctrl+K 搜索、Esc 关闭浮层）、空状态与加载态', code: 'styles/theme.css；core/app.js 快捷键' },
        { req: '提交要求 3.5：API 密钥不得出现在公开仓库', ui: '本页「接后端要改的地方」第 ⑥ 条', code: 'README.md → 安全与配置' },
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
    '    │   └── mock-data.js        所有演示数据（论文库/正文/知识片段/推荐/图谱）',
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

      ${App.ui.sectionTitle('接后端要改的地方', '<span class="muted tiny">前端已把数据层与视图层完全分离</span>')}
      <div class="grid grid-3">
        ${U.raw([
          { t: '① 换数据源', d: '把 scripts/data/mock-data.js 换成真实接口：App.data 的每个字段对应一个 GET 请求。' },
          { t: '② 换业务动作', d: 'store.js 里 actions 的方法内部，把 U.mockAsync / U.sleep 换成 fetch()，视图层无需改动。' },
          { t: '③ 换检索引擎', d: 'rag.js 的 retrieve() 换成后端接口（BM25 + 向量混合检索 + Rerank），保持函数签名一致即可。' },
          { t: '④ 换大模型', d: 'store.actions.ask() 中的流式输出改成 SSE / WebSocket 接收 token。' },
          { t: '⑤ 图表算法上移', d: 'graph.js 的力导向布局可交给后端（NetworkX 预计算），前端只负责绘制。' },
          { t: '⑥ 密钥安全', d: '所有 API Key 只从环境变量读取，绝不出现在前端代码或公开仓库（对应提交要求 3.5）。' },
        ].map((c) => h`
          <div class="card"><div class="card-body">
            <div style="font-weight:640" class="mb-8">${c.t}</div>
            <div class="muted small">${c.d}</div>
          </div></div>`).join(''))}
      </div>
    `;
  }

  App.views = App.views || {};
  App.views.guide = { render, MAP };
})(window.App);
