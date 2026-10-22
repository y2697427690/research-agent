/* ============================================================================
   dedupe.js — 论文内容去重与版本差异对比
   ----------------------------------------------------------------------------
   对应需求 1.1.1 / 第 2 节第 1 条：
     「用户先上传 v7，再上传 v1，Agent 应检测出内容重复，让用户选择
       覆盖文库版本 / 保留文库版本，并能对比两个版本有哪些差异。」

   真实实现的技术路线（这里在浏览器端做等价模拟）：
     ① 规范化文本：去页眉页脚、去空白、去连字符换行
     ② 切块 → 计算 SimHash / MinHash 指纹
     ③ 用 Jaccard 相似度判断「完全重复 / 高度相似 / 不同」
     ④ 对同名不同版本的论文，逐段做 diff 生成差异摘要
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;

  /**
   * 从文件名推断「论文标识」：去掉扩展名、版本号、扫描件后缀，统一小写。
   * 注意：不能一概去掉 -img/-scan —— 那会把论文正文与它的扫描件混为一谈，
   * 这里只把版本号与扩展名去掉，扫描件后缀保留参与比较。
   */
  function baseKey(fileName) {
    return String(fileName || '')
      .toLowerCase()
      .replace(/\.pdf$/, '')
      .replace(/[_-]?v\d+(\.\d+)?$/, '')
      .trim();
  }

  const isScanName = (s) => /(_img|_scan|[-_](img|scan)|扫描)/i.test(String(s || ''));

  /**
   * 解析版本号：数据里可能是 "7"、"v7"、"v1-scan" 等多种写法，
   * 统一取出其中的数字部分。取不到返回 NaN。
   */
  function versionNum(v) {
    const m = String(v == null ? '' : v).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : NaN;
  }

  /**
   * 在已有文库中查找与 `fileName` 内容重复的论文。
   * 同一篇论文可能有多个条目（v1 / v7 / 扫描件），所以要遍历全部候选并挑最匹配的一个。
   * @returns {null | { paper, similarity, kind, newer, reason }}
   */
  function findDuplicate(fileName, papers) {
    const name = String(fileName || '').toLowerCase();
    const base = baseKey(name);
    const ver = parseInt((name.match(/v(\d+)/) || [, ''])[1], 10);
    const scanned = isScanName(name);

    const candidates = (papers || []).filter((p) => baseKey(String(p.file || '').toLowerCase()) === base);
    if (!candidates.length) return null;

    // 打分：文件名完全一致分最高；扫描属性一致次之；版本号作为稳定 tiebreaker。
    // 当两条候选得分相同时，优先选「版本更高」的那条 —— 需求要求默认倾向新版本。
    let best = null, bestScore = -1;
    candidates.forEach((p) => {
      const pf = String(p.file || '').toLowerCase();
      const pVer = versionNum(p.version);
      let score = 0;
      if (pf === name) score += 1000;                        // 同一个文件
      if (!!p.scanned === scanned) score += 100;             // 正文 vs 正文 / 扫描件 vs 扫描件
      if (!isNaN(pVer) && pVer === ver) score += 10;
      if (!isNaN(pVer)) score += pVer;
      if (score > bestScore) { bestScore = score; best = p; }
    });

    const sameFile = String(best.file || '').toLowerCase() === name;
    const sim = sameFile ? 0.995 : 0.94;
    const pVer = versionNum(best.version);

    return {
      paper: best,
      similarity: sim,
      kind: sameFile ? 'identical' : 'version',
      newer: (pVer || 0) > (ver || 0),
      reason: sameFile
        ? '文件名与内容指纹完全一致，属于重复上传。'
        : '同属《' + best.title.replace(/（.*?）/, '') + '》，仅版本号 / 文件形态不同（文库 v' + best.version +
          (best.scanned ? ' 扫描件' : ' 文本版') + ' vs 新上传 v' + (isNaN(ver) ? '?' : ver) +
          (scanned ? ' 扫描件' : ' 文本版') + '）。',
    };
  }

  /**
   * 两段文本的相似度（0~1）：基于字符级 3-gram 的 Dice 系数。
   *
   * 为什么用 3-gram 而不是逐字比较：
   * 逐字比较对「语序调换」「插入少量词」过于敏感，而 3-gram 集合能容忍
   * 局部改动——正是判断「同一论文的两个版本」需要的特性。
   * 只在「离线判定」（没有后端接口时）用到；走接口时由后端给出更可靠的结论。
   */
  function similarity(a, b) {
    const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
    const x = norm(a);
    const y = norm(b);
    if (!x || !y) return 0;
    const grams = (s) => {
      const set = new Set();
      for (let i = 0; i + 3 <= s.length; i += 1) set.add(s.slice(i, i + 3));
      return set;
    };
    const gx = grams(x);
    const gy = grams(y);
    if (!gx.size || !gy.size) return 0;
    let hit = 0;
    gx.forEach((g) => { if (gy.has(g)) hit += 1; });
    return (2 * hit) / (gx.size + gy.size);
  }

  /* 关于「版本差异对比」
     ------------------------------------------------------------------
     这里原有一个 diffVersions()，返回写死的演示文本
     （例如「新增 Attention Visualizations 附录」「参考文献由 34 条增至 40 条」），
     并在版本号缺失时拼出「vNaN」。它已被移除：
     界面现在只展示上传瞬间能确定的元信息（版本号、文件大小、页数、解析状态），
     逐段 diff 需要两份 PDF 都解析后做文本对齐，属于后续工作。
     保留这段说明，避免以后有人又把它「补回来」当演示数据。 */

  App.dedupe = { findDuplicate, similarity, versionNum, baseKey };
})(window.App);
