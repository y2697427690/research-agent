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
   * 生成两个版本的差异摘要（演示用：内容依据两版论文的真实改动方向撰写）。
   * @returns {Array<{type, text}>}
   */
  function diffVersions(oldPaper, newFileName) {
    const newVerNum = versionNum((String(newFileName).match(/v(\d+)/) || [, ''])[1]);
    const oldVerNum = versionNum(oldPaper.version);
    // 文库中的版本是否比本次上传的更新？（需求明确要求的场景）
    const libIsNewer = !isNaN(oldVerNum) && !isNaN(newVerNum) && oldVerNum > newVerNum;

    const older = libIsNewer ? String(newVerNum) : String(oldVerNum);
    const newer = libIsNewer ? String(oldVerNum) : String(newVerNum);
    const oldPages = oldPaper.pages || '?';
    const newPages = 11;

    // 通用的「arXiv 版本迭代」典型差异（演示数据，接后端后可换成真实逐段 diff）
    const items = [
      { type: 'same', text: '标题、作者列表、作者顺序均未变化（8 位作者，单位标注一致）。' },
      { type: 'same', text: '核心方法（缩放点积注意力、多头注意力、位置编码）与主实验结论一致。' },
      { type: 'add', text: 'v' + newer + ' 新增「Attention Visualizations」附录，补充了编码器各层注意力的可视化图（图 3、图 4）。' },
      { type: 'add', text: 'v' + newer + ' 在 6.1 节补充了与同期工作的对比说明，并新增若干参考文献（参考文献数量由 34 条增至 40 条）。' },
      { type: 'mod', text: 'v' + newer + ' 修正了训练细节表述：明确了 warmup_steps = 4000 与 β2 = 0.98 的取值说明。' },
      { type: 'mod', text: 'v' + newer + ' 调整了部分表格数值的呈现方式（如训练成本列的记法统一为科学计数法）。' },
      { type: 'del', text: 'v' + newer + ' 删除了 v' + older + ' 中关于某个早期基线的冗长描述。' },
      { type: 'same', text: '页数变化：v' + older + ' 共 ' + (libIsNewer ? newPages : oldPages) +
        ' 页，v' + newer + ' 共 ' + (libIsNewer ? oldPages : newPages) + ' 页。' },
    ];

    if (libIsNewer) {
      items.unshift({
        type: 'warn',
        text: '⚠️ 文库中的版本（v' + oldPaper.version + '）比本次上传的版本（v' + newVerNum + '）更新，' +
          '建议保留文库版本（点击「保留文库版本」）；如需保留本次上传，请确认你确实要回退版本。',
      });
    }
    return items;
  }

  /**
   * 计算两个文本块的相似度（Jaccard，基于 3-gram）。
   * 真实实现中用于「文件不同但内容基本相同」的判定。
   */
  function similarity(a, b) {
    const gram = (s) => {
      const t = String(s).toLowerCase().replace(/\s+/g, ' ');
      const set = new Set();
      for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
      return set;
    };
    const A = gram(a), B = gram(b);
    if (!A.size && !B.size) return 1;
    let inter = 0;
    A.forEach((g) => { if (B.has(g)) inter++; });
    return inter / (A.size + B.size - inter || 1);
  }

  App.dedupe = { findDuplicate, diffVersions, similarity, versionNum, baseKey };
})(window.App);
