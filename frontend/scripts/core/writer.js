/* ============================================================================
   writer.js — 写作助手：论文框架、架构图代码、数据可视化与图注生成
   ----------------------------------------------------------------------------
   对应需求 1.6「写作助手」的四项能力：
     1.6.1 论文框架生成（Abstract / Introduction / Related Work / References）
     1.6.2 架构拓扑图代码生成（TikZ / Graphviz / Mermaid）
     1.6.3 数据可视化（CSV → 图表 + 自动 Figure Caption）
     1.6.4 中文摘要 → 英文翻译
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;

  /* ------------------------------------------------------------------
     1.6.1 论文框架生成
     ------------------------------------------------------------------ */
  function buildOutline(idea) {
    const topic = (idea || '').trim() || '面向科研文献的检索增强问答系统';
    const key = topic.length > 18 ? topic.slice(0, 18) + '……' : topic;

    return {
      topic: topic,
      sections: [
        {
          name: 'Abstract', zh: '摘要', words: '180–220 words',
          content:
            '本文提出「' + key + '」。针对现有方法在 X 场景下存在的 A、B 两个问题，' +
            '我们设计了由 ① 检索增强模块 ② 多智能体协作框架 组成的方案，并在 C 数据集上与 D、E 两个基线对比。' +
            '实验表明，本方法在指标 M1 上提升 4.4 分、指标 M2 上提升 2.3 分，同时推理开销仅增加 20 ms。',
          todo: ['明确一句话贡献（contribution）', '数字必须与正文一致', '避免出现未在正文定义过的缩写'],
        },
        {
          name: '1 Introduction', zh: '引言', words: '900–1200 words',
          content:
            '1.1 研究背景：说明为什么这个问题现在值得做（给出 2–3 篇近两年文献的量化现状）。\n' +
            '1.2 问题定义：形式化描述输入、输出与评价指标。\n' +
            '1.3 挑战与动机：现有方法的三点不足（每条都要对应后文的一个设计）。\n' +
            '1.4 本文贡献：用 3–4 条编号列表给出，每条都要可被实验验证。',
          todo: ['贡献点与实验章节一一对应', '第 1 段不要超过 5 行'],
        },
        {
          name: '2 Related Work', zh: '相关工作', words: '700–1000 words',
          content:
            '2.1 文献检索与表示（引用你库中 RAG / DPR 一线工作）。\n' +
            '2.2 大模型对齐与推理（引用 InstructGPT / DPO / DeepSeek-R1）。\n' +
            '2.3 与本文最接近的工作，并逐条说明差异（这是审稿人最关注的一段）。',
          todo: ['每个小节结尾必须有「与本文的区别」', '避免只罗列不点评'],
        },
        {
          name: '3 Method', zh: '方法', words: '1500–2200 words',
          content:
            '3.1 整体框架（对应图 1，说明数据流）。\n' +
            '3.2 模块一：检索增强 —— 给出检索公式与超参数表。\n' +
            '3.3 模块二：多智能体协作 —— 说明角色划分与消息协议。\n' +
            '3.4 训练与推理细节（硬件、步数、学习率，格式对齐 Attention 论文 5.2/5.3 节）。',
          todo: ['公式逐一编号', '所有符号在首次出现处定义'],
        },
        {
          name: '4 Experiments', zh: '实验', words: '1200–1800 words',
          content:
            '4.1 数据集与评价指标。\n' +
            '4.2 基线方法（至少 3 个）。\n' +
            '4.3 主实验结果（表 1）。\n' +
            '4.4 消融实验（逐模块去掉，验证每个设计的贡献）。\n' +
            '4.5 案例分析（包含失败案例，体现客观性）。',
          todo: ['表格中最好值加粗', '报告方差或多次运行结果'],
        },
        {
          name: '5 Conclusion', zh: '结论', words: '250–350 words',
          content:
            '复述问题、方法与最重要的两个结论；明确指出至少一条局限（limitation），并给出可执行的未来工作方向。',
          todo: ['不要引入新结果', '局限要具体，不要写「仍有提升空间」'],
        },
        {
          name: 'References', zh: '参考文献', words: '30–60 条',
          content:
            '格式建议 BibTeX + 统一风格（如 NeurIPS 模板）。本工具会自动从你文库中抽取可引用的真实条目，' +
            '并标记「库中已有原文」的可直接跳转。',
          todo: ['禁止引用不存在或与正文不对应的文献', '引用前用本工具做一次「真实性核验」'],
          verified: true,
        },
      ],
      references: [
        { key: 'vaswani2017attention', text: 'Vaswani et al. Attention Is All You Need. NeurIPS, 2017.', inLib: 'p-attention-v7' },
        { key: 'lewis2020rag', text: 'Lewis et al. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. NeurIPS, 2020.', inLib: 'p-rag' },
        { key: 'karpukhin2020dpr', text: 'Karpukhin et al. Dense Passage Retrieval for Open-Domain QA. EMNLP, 2020.', inLib: 'p-dpr' },
        { key: 'ouyang2022instructgpt', text: 'Ouyang et al. Training language models to follow instructions with human feedback. NeurIPS, 2022.', inLib: 'p-instructgpt' },
        { key: 'rafailov2023dpo', text: 'Rafailov et al. Direct Preference Optimization. NeurIPS, 2023.', inLib: 'p-dpo' },
        { key: 'hu2021lora', text: 'Hu et al. LoRA: Low-Rank Adaptation of Large Language Models. ICLR, 2022.', inLib: 'p-lora' },
      ],
      /** 真实性核验：库中能找到原文的条目标为「已验证」 */
      verify() {
        return this.references.map((r) => ({
          key: r.key,
          ok: !!r.inLib,
          note: r.inLib ? '文库中已有该论文原文，可直接引用' : '未在文库中找到，需联网核验 DOI / arXiv 号',
        }));
      },
    };
  }

  /* ------------------------------------------------------------------
     1.6.3 数据可视化：CSV → 图表 + Figure Caption
     ------------------------------------------------------------------ */
  /** 解析 CSV 文本（支持引号包裹、逗号与制表符分隔） */
  function parseCSV(text) {
    const lines = String(text).trim().split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { head: [], rows: [] };
    const split = (line) => {
      const out = []; let cur = ''; let q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { q = !q; continue; }
        if ((c === ',' || c === '\t') && !q) { out.push(cur.trim()); cur = ''; continue; }
        cur += c;
      }
      out.push(cur.trim());
      return out;
    };
    return { head: split(lines[0]), rows: lines.slice(1).map(split) };
  }

  /** 从 CSV 生成「表格」渲染所需的模型 */
  function toTable(csv) {
    const numeric = csv.head.map((_, ci) =>
      csv.rows.every((r) => r[ci] === '' || !isNaN(parseFloat(r[ci]))));
    return { head: csv.head, rows: csv.rows, numeric: numeric };
  }

  /**
   * 生成图表配置（供 canvas 折线/柱状图使用）。
   * @param {object} csv 解析后的 CSV
   * @param {number} valueCol 数值列索引
   * @param {number} labelCol 标签列索引
   */
  function toChart(csv, valueCol, labelCol) {
    const labels = csv.rows.map((r) => r[labelCol]);
    const values = csv.rows.map((r) => parseFloat(r[valueCol]) || 0);
    const max = Math.max.apply(null, values.concat([1]));
    return { labels, values, max };
  }

  /** 自动生成学术规范的 Figure Caption（含趋势结论） */
  function buildCaption(csv, valueCol, labelCol) {
    const labelName = csv.head[labelCol], valueName = csv.head[valueCol];
    const chart = toChart(csv, valueCol, labelCol);
    const bestIdx = chart.values.indexOf(Math.max.apply(null, chart.values));
    const worstIdx = chart.values.indexOf(Math.min.apply(null, chart.values));
    const first = chart.values[0], last = chart.values[chart.values.length - 1];
    const delta = last - first;
    const trend = delta > 0 ? '上升' : delta < 0 ? '下降' : '持平';

    return '图 4 不同模型在 ' + valueName + ' 指标上的对比。' +
      '横轴为 ' + labelName + '，纵轴为 ' + valueName + '。' +
      '可以看出：' + chart.labels[bestIdx] + ' 取得最高值 ' + chart.values[bestIdx] +
      '，' + chart.labels[worstIdx] + ' 最低（' + chart.values[worstIdx] + '），' +
      '两者相差 ' + (chart.values[bestIdx] - chart.values[worstIdx]).toFixed(1) + '。' +
      '首末项相比整体呈' + trend + '趋势（' + first + ' → ' + last + '，' +
      (delta >= 0 ? '+' : '') + delta.toFixed(1) + '），' +
      '表明在 ' + labelName + ' 维度上存在明显的性能分层，' +
      '其中排名靠前的配置可作为后续调优的优先基线。';
  }

  /** 常用的柱状/折线绘制（返回 SVG 字符串，避免额外依赖） */
  function renderBarChart(chart, opts) {
    const o = Object.assign({ width: 560, height: 260, pad: 42, line: false, color: '#4f6ef7' }, opts || {});
    const innerW = o.width - o.pad * 2;
    const innerH = o.height - o.pad * 2;
    const n = chart.values.length || 1;
    const step = innerW / n;
    const bw = Math.min(46, step * 0.55);
    let bars = '', line = '', dots = '';

    chart.values.forEach((v, i) => {
      const hgt = (v / chart.max) * innerH;
      const x = o.pad + step * i + (step - bw) / 2;
      const y = o.pad + innerH - hgt;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
        '" height="' + hgt.toFixed(1) + '" rx="5" fill="' + o.color + '" opacity="' +
        (0.45 + 0.55 * (v / chart.max)).toFixed(2) + '"/>' +
        '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) +
        '" text-anchor="middle" font-size="11" fill="#b7bed2">' + v + '</text>' +
        '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (o.pad + innerH + 16) +
        '" text-anchor="middle" font-size="10.5" fill="#8189a0">' + U.esc(U.clip(chart.labels[i], 12)) + '</text>';
      const cx = o.pad + step * i + step / 2;
      const cy = o.pad + innerH - hgt;
      line += (i ? ' L' : 'M') + cx.toFixed(1) + ' ' + cy.toFixed(1);
      dots += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3.5" fill="#e2a336"/>';
    });

    // 轴
    let grid = '';
    for (let g = 0; g <= 4; g++) {
      const y = o.pad + (innerH / 4) * g;
      const val = Math.round(chart.max * (1 - g / 4));
      grid += '<line x1="' + o.pad + '" y1="' + y.toFixed(1) + '" x2="' + (o.width - o.pad) +
        '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.07)"/>' +
        '<text x="' + (o.pad - 8) + '" y="' + (y + 4).toFixed(1) +
        '" text-anchor="end" font-size="10" fill="#5b6379">' + val + '</text>';
    }

    return '<svg viewBox="0 0 ' + o.width + ' ' + o.height + '" width="100%" style="max-width:' + o.width + 'px">' +
      grid + bars +
      (o.line ? '<path d="' + line + '" fill="none" stroke="#e2a336" stroke-width="2"/>' + dots : '') +
      '</svg>';
  }

  /** 三维雷达图（需求里点名的图表类型），输入若干维度与 1~3 个系列 */
  function renderRadar(axes, series) {
    const size = 300, cx = size / 2, cy = size / 2 + 6, R = 96;
    const n = axes.length;
    const pt = (i, r) => {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    let grid = '';
    for (let ring = 1; ring <= 4; ring++) {
      const r = (R * ring) / 4;
      const pts = axes.map((_, i) => pt(i, r).map((v) => v.toFixed(1)).join(',')).join(' ');
      grid += '<polygon points="' + pts + '" fill="none" stroke="rgba(255,255,255,0.09)"/>';
    }
    axes.forEach((a, i) => {
      const p = pt(i, R);
      grid += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) +
        '" stroke="rgba(255,255,255,0.09)"/>' +
        '<text x="' + pt(i, R + 20)[0].toFixed(1) + '" y="' + pt(i, R + 20)[1].toFixed(1) +
        '" text-anchor="middle" font-size="10.5" fill="#8189a0">' + U.esc(a) + '</text>';
    });
    const colors = ['#4f6ef7', '#2fb37a', '#e2a336'];
    const polys = series.map((s, si) => {
      const pts = s.values.map((v, i) => pt(i, (R * Math.max(0, Math.min(1, v)))).map((x) => x.toFixed(1)).join(',')).join(' ');
      return '<polygon points="' + pts + '" fill="' + colors[si % 3] + '" fill-opacity="0.18" stroke="' +
        colors[si % 3] + '" stroke-width="2"/>';
    }).join('');
    const legend = series.map((s, si) =>
      '<g><rect x="' + (10 + si * 92) + '" y="' + (size - 16) + '" width="9" height="9" rx="2" fill="' +
      colors[si % 3] + '"/><text x="' + (23 + si * 92) + '" y="' + (size - 8) +
      '" font-size="10.5" fill="#b7bed2">' + U.esc(s.name) + '</text></g>').join('');
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="100%" style="max-width:' + size + 'px">' +
      grid + polys + legend + '</svg>';
  }

  /* ------------------------------------------------------------------
     1.6.4 中译英（演示：词典替换 + 结构保留；真实实现调用翻译 API）
     ------------------------------------------------------------------ */
  /**
   * 中译英术语表。
   * 注意：键的顺序即替换顺序，长词组必须排在短词组之前，
   * 否则「我们提出了」会先被「提出」截断，导致译文错乱。
   */
  const DICT = {
    // —— 句式与动词 ——
    '本文提出了一种': 'We propose a', '本文提出了': 'We propose', '本文提出': 'We propose',
    '我们提出了一种': 'We propose a', '我们提出了': 'We propose', '我们提出': 'We propose',
    '提出了一种新的': 'propose a new', '提出了一种': 'propose a', '提出了': 'propose',
    '针对': 'To address', '通过': 'by means of', '基于': 'based on',
    '实验结果表明': 'Experimental results show that', '结果表明': 'Results show that',
    '表明': 'indicate that', '说明': 'demonstrate that',
    // —— 术语与名词 ——
    '注意力机制': 'attention mechanism', '自注意力': 'self-attention',
    '多头注意力': 'multi-head attention', '位置编码': 'positional encoding',
    '层归一化': 'layer normalization', '残差连接': 'residual connection',
    '循环神经网络': 'recurrent neural network', '卷积神经网络': 'convolutional neural network',
    '神经网络': 'neural network', '检索增强生成': 'retrieval-augmented generation',
    '序列转换模型': 'sequence transduction model', '网络架构': 'network architecture',
    '深度学习': 'deep learning', '机器学习': 'machine learning',
    '编码器': 'encoder', '解码器': 'decoder', '架构': 'architecture', '模型': 'model',
    '数据集': 'dataset', '基线': 'baseline', '实验': 'experiment', '方法': 'method',
    '问题': 'problem', '性能': 'performance', '效果': 'effect', '结果': 'result',
    // —— 修饰与连接 ——
    '全新的': 'novel', '完全': 'entirely', '彻底': 'completely', '显著': 'significantly',
    '大幅度': 'substantially', '复杂': 'complex', '简单': 'simple', '新的': 'new',
    '此外': 'In addition', '因此': 'Therefore', '然而': 'However', '最后': 'Finally',
    '总结': 'In summary', '同时': 'Meanwhile', '以及': 'as well as',
    '包含': 'includes', '连接': 'connect', '摒弃了': 'dispensing with', '摒弃': 'dispense with',
    '提升': 'improves', '降低': 'reduces',
  };

  function translateAbstract(zh) {
    let out = String(zh || '').trim();
    // 按词条长度从长到短替换，保证「我们提出了」不会被「提出」抢先匹配
    Object.keys(DICT)
      .sort((a, b) => b.length - a.length)
      .forEach((k) => { out = out.split(k).join(DICT[k]); });
    return out;
  }

  App.writer = {
    buildOutline, parseCSV, toTable, toChart, buildCaption,
    renderBarChart, renderRadar, translateAbstract,
  };
})(window.App);
