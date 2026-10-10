/* ============================================================================
   rag.js — 问答检索引擎（浏览器端简化版 RAG）
   ----------------------------------------------------------------------------
   对应需求 1.2「知识问答」的核心链路：
     用户问题 → ① 混合检索（关键词 + 向量相似度）→ ② 取 Top-K 片段
              → ③ 片段拼装成提示词 → ④ 大模型生成 → ⑤ 回带出处引用
   真实实现里：① 用 BM25 + 稠密向量（如 bge-m3）做混合检索，③④ 走 LLM API，
   本文件用纯前端算法模拟，但**接口签名与真实后端一致**，可直接替换。
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;

  /* ------------------------------------------------------------------
     1) 轻量分词：英文按词、中文按 2-gram
     ------------------------------------------------------------------ */
  const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'is', 'are', 'was', 'were', 'to', 'and',
    'or', 'for', 'with', 'that', 'this', 'it', 'as', 'by', 'at', 'be', 'from', 'we', 'our',
    '的', '了', '是', '在', '和', '与', '有', '个', '这', '那', '吗', '呢', '什么', '多少', '请问']);

  function tokenize(text) {
    const s = String(text || '').toLowerCase();
    const tokens = [];
    // 英文/数字词
    (s.match(/[a-z][a-z0-9\-_.]{1,}/g) || []).forEach((w) => {
      if (!STOP.has(w)) tokens.push(w);
    });
    // 中日韩字符 → 单字 + 双字组合，保证「超参数」能命中「超参数」
    const cjk = s.match(/[\u4e00-\u9fff]+/g) || [];
    cjk.forEach((run) => {
      for (let i = 0; i < run.length; i++) {
        tokens.push(run[i]);
        if (i + 1 < run.length) tokens.push(run.slice(i, i + 2));
      }
    });
    return tokens;
  }

  /* ------------------------------------------------------------------
     2) 检索：BM25 风格打分（词频 + 文档长度归一 + 稀有词加权）
     ------------------------------------------------------------------ */
  function retrieve(query, paperIds, topK) {
    const chunks = App.data.knowledge;
    const pool = (paperIds && paperIds.length)
      ? chunks.filter((c) => paperIds.indexOf(c.paperId) !== -1)
      : chunks;

    const qTokens = tokenize(query);
    if (!qTokens.length) return [];
    const qSet = new Set(qTokens);

    // 文档频率（用于 IDF）
    const df = {};
    pool.forEach((c) => {
      const t = new Set(tokenize(c.text + ' ' + c.section + ' ' + (c.note || '')));
      t.forEach((x) => { df[x] = (df[x] || 0) + 1; });
    });
    const N = pool.length || 1;
    const avgLen = pool.reduce((a, c) => a + tokenize(c.text).length, 0) / N || 1;

    const scored = pool.map((c) => {
      const dTokens = tokenize(c.text + ' ' + c.section + ' ' + (c.note || ''));
      const len = dTokens.length || 1;
      const tf = {};
      dTokens.forEach((t) => { tf[t] = (tf[t] || 0) + 1; });

      let score = 0;
      qSet.forEach((term) => {
        const f = tf[term] || 0;
        if (!f) return;
        const idf = Math.log(1 + (N - (df[term] || 0) + 0.5) / ((df[term] || 0) + 0.5));
        const k1 = 1.4, b = 0.72;
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len / avgLen));
      });

      // 命中标题 / 备注时额外加权（标题通常更「语义集中」）
      const head = (c.section + ' ' + (c.note || '')).toLowerCase();
      qSet.forEach((t) => { if (head.indexOf(t) !== -1) score *= 1.12; });

      return Object.assign({}, c, { score: score });
    });

    return scored
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK || 5)
      .map((c) => {
        // 归一化成 0~1 的「相关度」，供 UI 显示
        const top = scored.reduce((m, x) => Math.max(m, x.score), 0.0001);
        return Object.assign({}, c, { relevance: Math.min(1, c.score / top) });
      });
  }

  /* ------------------------------------------------------------------
     3) 命中预设答案？（需求 1.2 里的例题都内置了标准答案）
     ------------------------------------------------------------------ */
  function presetAnswer(query) {
    const q = String(query || '').toLowerCase();
    let best = null, bestHit = 0;
    App.data.answers.forEach((a) => {
      const hit = a.match.reduce((n, k) => (q.indexOf(k.toLowerCase()) !== -1 ? n + 1 : n), 0);
      if (hit > bestHit) { bestHit = hit; best = a; }
    });
    return bestHit >= 1 ? best : null;
  }

  /* ------------------------------------------------------------------
     4) 没有预设答案时，用检索片段拼一个「有出处的回答骨架」
        真实实现里这一步由大模型完成，这里只是占位演示。
     ------------------------------------------------------------------ */
  function compose(query, hits, scope) {
    if (!hits || !hits.length) {
      return '在当前选定的论文范围内没有检索到与问题直接相关的段落。\n\n' +
        '建议：\n· 更换关键词或使用论文中的英文术语重试；\n· 扩大问答范围（改为「多篇论文」并勾选更多论文）；\n· 或确认该论文是否已完成解析。';
    }
    const lines = [];
    lines.push('根据检索到的 ' + hits.length + ' 个原文片段，可以整理出以下信息：');
    lines.push('');
    hits.forEach((kb, i) => {
      const paper = App.data.getPaper(kb.paperId);
      const who = paper ? paper.title : kb.paperId;
      lines.push((i + 1) + '. ' + kb.text);
      lines.push('   —— 出处：' + who + ' · ' + kb.section + ' · 第 ' + kb.page + ' 页 [' + (i + 1) + ']');
      lines.push('');
    });
    lines.push('⚠️ 以上内容直接摘自原文片段，未经过额外推断。若需要跨片段归纳或对比结论，请再追问一次。');
    if (scope === 'multi') {
      lines.push('');
      lines.push('（当前为「多篇论文」模式，已按论文分别标注出处，便于交叉核对。）');
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------
     5) 检索可视化用的分数明细（UI 上展示「为什么召回这段」）
     ------------------------------------------------------------------ */
  function explain(query, chunk) {
    const q = new Set(tokenize(query));
    const d = new Set(tokenize(chunk.text));
    const hit = [];
    q.forEach((t) => { if (d.has(t)) hit.push(t); });
    return hit.slice(0, 12);
  }

  App.rag = { tokenize, retrieve, presetAnswer, compose, explain };
})(window.App);
