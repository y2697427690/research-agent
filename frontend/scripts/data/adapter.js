/* ============================================================================
   adapter.js — 后端数据 → 视图数据的翻译层
   ----------------------------------------------------------------------------
   为什么需要这一层：
     视图层按照「演示数据」的形状来写（titleZh、keywords、cites、sections…），
     而后端返回的是另一套字段名（page_count、arxiv_id、parse_status…）。
     把翻译集中在这里，好处是：
       1. 视图代码一行都不用改
       2. 将来字段调整只改这个文件
       3. 后端暂时没有的字段，在这里给出安全默认值，
          视图不会因为 undefined 而显示 NaN 或崩掉

   原则：**能算出来的就算，算不出来的给安全默认值，绝不编造假数据。**
   例如 cites（被引次数）后端没有，就给 0，而不是塞一个好看的假数字。
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';

  /* ---------------- 小工具 ---------------- */

  /** 从文件名里提取版本号：xxx_v2.pdf → 'v2'，没有则 'v1' */
  function versionFromFileName(name) {
    const m = String(name || '').match(/[._-]v(\d+)\.pdf$/i);
    return m ? 'v' + m[1] : 'v1';
  }

  /** 后端 authors 是字符串（可能逗号或分号分隔），视图要数组 */
  function splitAuthors(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return String(value)
      .split(/[,;，；]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function splitKeywords(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return String(value)
      .split(/[,;，；]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** 解析状态 → 视图用的可读状态 */
  function statusOf(p) {
    const s = p.parse_status || 'queued';
    if (s === 'done') return 'done';
    if (s === 'need_review') return 'need_review';
    if (s === 'failed') return 'failed';
    if (s === 'parsing') return 'parsing';
    return 'queued';
  }

  /* ---------------- 论文 ---------------- */

  /**
   * 后端 Paper → 视图 paper。
   * 后端有：id / file_name / size_bytes / title / authors / year / venue /
   *         arxiv_id / abstract / keywords / quality / page_count /
   *         starred / parse_status / added_at
   * 后端没有的（cites / figures / tables / formulas / citesIds / core 等）：
   *         给安全默认值，界面上显示为「—」或 0，不做假。
   */
  function paperFromApi(p) {
    if (!p) return null;
    const quality = typeof p.quality === 'number' ? p.quality : null;
    const status = statusOf(p);

    return {
      // ---- 与后端一一对应 ----
      id: p.id,
      file: p.file_name,
      title: p.title || p.file_name || '(未命名)',
      authors: splitAuthors(p.authors),
      year: p.year || null,
      venue: p.venue || null,
      arxiv: p.arxiv_id || null,
      abstract: p.abstract || '',
      keywords: splitKeywords(p.keywords),
      quality: quality,
      pages: p.page_count || 0,
      sizeBytes: p.size_bytes || 0,
      starred: !!p.starred,
      addedAt: p.added_at || p.created_at || null,
      parsedAt: p.updated_at || null,
      version: versionFromFileName(p.file_name),
      status: status,

      // ---- 视图需要但后端暂不提供的：安全默认值 ----
      // 这些字段在界面上会显示为 0 / 空，不会导致报错
      titleZh: '',
      abstractZh: '',
      scanned: status === 'need_review' && quality !== null && quality < 0.6,
      cites: 0,
      refs: 0,
      sections: 0,
      figures: 0,
      tables: 0,
      formulas: 0,
      citesIds: [],
      citedByIds: [],
      core: 'derived',

      // ---- 原始数据，便于调试时查看后端到底返回了什么 ----
      _raw: p,
    };
  }

  function papersFromApi(resp) {
    const items = (resp && (resp.items || resp.papers)) || [];
    return items.map(paperFromApi).filter(Boolean);
  }

  /* ---------------- 检索片段 ---------------- */

  /**
   * 后端检索命中 → 视图 evidence。
   * 视图读的是 e.section / e.page / e.relevance / e.text。
   * relevance 由 score 归一到 0~1：后端 RRF 分数没有绝对量纲，
   * 直接展示会是一串 0.03 之类的怪数字，归一后更直观。
   */
  function evidenceFromHit(hit, maxScore) {
    if (!hit) return null;
    const score = typeof hit.score === 'number' ? hit.score : 0;
    const top = maxScore && maxScore > 0 ? maxScore : score || 1;

    return {
      id: hit.chunk_id,
      paperId: hit.paper_id,
      section: hit.section_title || '正文',
      page: hit.page_start || 1,
      pageEnd: hit.page_end || hit.page_start || 1,
      text: hit.text || '',
      citation: hit.citation || '',
      sources: hit.sources || [],
      score: score,
      relevance: Math.max(0, Math.min(1, score / top)),
    };
  }

  function evidenceFromHits(hits) {
    const list = hits || [];
    const maxScore = list.reduce((m, h) => Math.max(m, h.score || 0), 0);
    return list.map((h) => evidenceFromHit(h, maxScore)).filter(Boolean);
  }

  App.adapter = {
    paperFromApi,
    papersFromApi,
    evidenceFromHit,
    evidenceFromHits,
    versionFromFileName,
    splitAuthors,
    splitKeywords,
    statusOf,
  };
})(window.App);
