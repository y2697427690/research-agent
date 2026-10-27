/* ============================================================================
   views/qa.js — 知识问答（单篇 / 多篇论文，答案必带出处）
   ----------------------------------------------------------------------------
   对应需求 1.2「知识问答」：
     1.2.1 单篇论文问答：RAG 检索 → 生成 → 给出参考原文，便于用户发现幻觉
     1.2.2 多篇论文问答：跨论文对比（如 BERT vs Transformer、GPT-1/2/3 演化）

   页面三栏：
     左：会话历史 + 论文范围选择（RAG 的检索范围）
     中：消息流（用户提问 / 模型回答 + 引用角标）
     右：证据面板（检索到的原文片段，可点击角标定位）
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const U = App.util;
  const h = U.html;

  /** 单篇模式的示例问题（直接来自需求文档 1.2.1） */
  const EXAMPLES_SINGLE = [
    '论文 Attention Is All You Need 的第 6 作者是谁，在哪个公司 / 机构工作？',
    '其中 Adam 优化器的超参数 β1 与 β2 分别被设置为了多少？',
    '这篇论文中提到的 Transformer 架构，在训练 Base 模型时使用了多少个 GPU？具体是什么型号？',
    'Transformer (big) 模型在 English-to-German 任务上的 BLEU 分数是多少？当时的 state-of-the-art 是多少？提升了多少？',
    '请列出论文中引用的关于 "Layer Normalization" 的参考文献的完整作者与年份。',
  ];

  /** 多篇模式的示例问题（需求文档 1.2.2） */
  const EXAMPLES_MULTI = [
    'BERT 的架构与原始 Transformer 的 Encoder 有什么承袭关系？BERT 丢弃了哪个部分？',
    '对比 GPT-1、GPT-2 与 GPT-3，说明这些模型的参数演化，以及上下文长度分别递增到了多少？',
    'GPT-2 相比于 GPT-1，在 Transformer 的 Layer Normalization 位置上做了什么关键调整？',
  ];

  let pendingScroll = false;
  // 用户是否停在消息区底部（流式输出时据此决定是否自动跟随）
  let stickToBottom = true;

  /* ==========================================================================
     1. 主渲染
     ========================================================================== */
  function render(el) {
    const st = App.store.state;
    const chat = st.chats.find((c) => c.id === st.activeChatId) || null;

    el.innerHTML = h`
      <div class="qa-layout">
        <!-- ================= 左栏：范围与会话 ================= -->
        <aside class="qa-side">
          <div class="card mb-12">
            <div class="card-head"><div class="card-title">问答范围</div></div>
            <div class="card-body tight">
              <div class="row gap-4 mb-12" style="background:var(--bg-2);padding:3px;border-radius:10px">
                <button class="btn btn-sm ${st.qa.scope === 'single' ? 'btn-primary' : 'btn-ghost'} grow" data-action="qa-scope" data-scope="single">单篇论文</button>
                <button class="btn btn-sm ${st.qa.scope === 'multi' ? 'btn-primary' : 'btn-ghost'} grow" data-action="qa-scope" data-scope="multi">多篇论文</button>
              </div>
              <div class="muted tiny mb-8">
                ${st.qa.scope === 'single' ? '在单篇论文内检索（精度最高）' : '跨论文检索并做对比（最多可多选）'}
              </div>
              <div class="qa-paper-list">
                ${U.raw(App.store.state.papers.slice(0, 24).map((p) => {
                  const on = st.qa.paperIds.indexOf(p.id) !== -1;
                  return App.ui.Out(h`
                    <button class="qa-paper ${on ? 'on' : ''}" data-action="qa-toggle-paper" data-id="${p.id}">
                      <span class="chk">${on ? '✓' : ''}</span>
                      <span class="grow ellipsis" style="text-align:left">${p.title}</span>
                    </button>`);
                }).join(''))}
              </div>
            </div>
          </div>

          <div class="card mb-12">
            <div class="card-head"><div class="card-title">RAG 参数</div></div>
            <div class="card-body tight">
              <label class="field-label">检索片段数 Top-K</label>
              <select class="select mb-12" data-bind="topk">
                ${U.raw([3, 5, 8, 12].map((k) => h`<option value="${k}" ${k === st.qa.topK ? 'selected' : ''}>Top-${k}</option>`).join(''))}
              </select>
              <button class="btn btn-sm btn-ghost" style="width:100%" data-action="qa-toggle-evidence">
                ${st.qa.showEvidence ? '隐藏' : '显示'}引用原文面板
              </button>
              <div class="muted tiny mt-8">
                真实实现：BM25 + 稠密向量混合检索 → 重排（Rerank）→ 拼接上下文 → LLM 生成。
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <div class="card-title">会话</div>
              <div class="spacer"></div>
              <button class="btn btn-sm btn-ghost" data-action="qa-new-chat">＋ 新建</button>
            </div>
            <div class="card-body tight">
              ${st.chats.length ? U.raw(st.chats.map((c) => h`
                <button class="qa-chat ${c.id === st.activeChatId ? 'on' : ''}" data-action="qa-open-chat" data-id="${c.id}">
                  <span class="grow ellipsis" style="text-align:left">${c.title}</span>
                  <span class="muted tiny">${c.messages.length}</span>
                </button>`).join(''))
                : U.raw(h`<div class="muted small" style="padding:6px 4px">还没有会话，直接提问即可开始。</div>`)}
            </div>
          </div>
        </aside>

        <!-- ================= 中栏：对话 ================= -->
        <section class="qa-main">
          <div class="qa-stream" id="stream" data-scroll-keep>
            ${chat && chat.messages.length ? U.raw(chat.messages.map(msgHtml).join('')) : U.raw(welcomeHtml())}
          </div>

          <div class="qa-composer">
            <textarea class="textarea" id="qinput" rows="2"
              placeholder="${st.qa.scope === 'single' ? '针对单篇论文提问，例如：使用了多少个 GPU？' : '跨论文对比提问，例如：BERT 与原始 Transformer 的 Encoder 有何承袭关系？'}"></textarea>
            <div class="row gap-8 mt-8">
              <span class="badge badge-outline">已选 ${st.qa.paperIds.length} 篇</span>
              <span class="muted tiny">Enter 发送 · Shift+Enter 换行</span>
              <div class="spacer"></div>
              <button class="btn btn-primary" data-action="qa-send" ${st.qa.thinking ? 'disabled' : ''}>
                ${st.qa.thinking ? '思考中…' : '发送提问'}
              </button>
            </div>
          </div>
        </section>

        <!-- ================= 右栏：证据面板 ================= -->
        ${st.qa.showEvidence ? U.raw(h`
          <aside class="qa-evidence">
            <div class="card" style="height:100%">
              <div class="card-head">
                <div class="card-title">引用原文（证据）</div>
                <div class="spacer"></div>
                <span class="muted tiny">点击角标定位</span>
              </div>
              <div class="card-body tight" id="evidence" style="overflow:auto">
                ${U.raw(evidenceHtml(chat))}
              </div>
            </div>
          </aside>`) : ''}
      </div>
    `;

    bindComposer(el);

    // 恢复滚动位置：消息区元素是每次重绘新建的，scrollTop 天然为 0，
    // 若不还原，流式输出期间用户会看到内容「跳回顶部」。
    // app.js 在清空容器前把旧位置存到了 __innerScroll。
    const saved = App.store.state.__innerScroll;
    const streamEl = U.$('#stream', el);
    if (streamEl && typeof saved === 'number') {
      streamEl.scrollTop = saved;
      // 恢复「是否贴底」的判断：内容比上次更高，单看位置会误判，
      // 因此用重绘前记录的状态（__innerAtBottom）覆盖
      stickToBottom = App.store.state.__innerAtBottom !== false;
    }

    // 自动滚动策略：
    //   1) 发送前后：强制滚到底（让用户立刻看到新消息）
    //   2) 流式输出中：持续跟随，否则文字会跑到可视区外
    //   3) 用户手动向上翻看历史时：不打扰（见 bindComposer 里的贴底判断）
    const streaming = chat && chat.messages.some((m) => m.streaming);
    if (pendingScroll) {
      scrollStream(true);          // 刚发出提问：强制看到新消息
      pendingScroll = false;
    } else if (streaming) {
      scrollStream(false);         // 流式增量：只在用户停在底部时跟随
    }
  }

  /* ==========================================================================
     2. 欢迎页 + 示例问题
     ========================================================================== */
  function welcomeHtml() {
    const st = App.store.state;
    const examples = st.qa.scope === 'single' ? EXAMPLES_SINGLE : EXAMPLES_MULTI;
    return App.ui.Out(h`
      <div class="qa-welcome">
        <div class="qa-welcome-icon">✦</div>
        <div style="font-size:17px;font-weight:660">基于原文回答，每句话都能溯源</div>
        <div class="muted small mt-8" style="max-width:620px;text-align:center">
          问答范围限定在你勾选的论文内。回答中出现的 <span class="cite">[1]</span> 角标可点击，
          右侧会同步高亮对应原文片段，方便你核对模型是否在「编造」。
        </div>

        <div class="selftest mt-24" style="width:100%;max-width:720px">
          <div class="muted tiny mb-8">试试这些问题（来自需求文档 1.2 的例题，均已内置标准答案与出处）：</div>
          ${U.raw(examples.map((q) => h`
            <button class="qa-example" data-action="qa-ask-preset" data-q="${q}">
              <span class="muted">▸</span><span>${q}</span>
            </button>`).join(''))}
        </div>
      </div>`);
  }

  /* ==========================================================================
     3. 消息渲染
     ========================================================================== */
  function msgHtml(m) {
    if (m.role === 'user') {
      return App.ui.Out(h`
        <div class="msg msg-user">
          <div class="msg-avatar">我</div>
          <div class="msg-bubble">${m.text}</div>
        </div>`);
    }

    // 助手消息：正文 + 引用角标 + 证据折叠
    let body = m.text || '';
    // 把 [n] 形式替换成可点击角标（仅替换方括号数字）
    body = U.esc(body)
      .replace(/\[(\d+)\]/g, '<span class="cite" data-action="qa-cite" data-cite="$1">[$1]</span>')
      .replace(/\n/g, '<br/>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^&gt;\s?(.*)$/gm, '<div class="quote">$1</div>')
      .replace(/\|(.+?)\|/g, (line) => line); // 表格行保持原样（演示）

    return App.ui.Out(h`
      <div class="msg msg-ai">
        <div class="msg-avatar">✦</div>
        <div class="grow" style="min-width:0">
          <div class="msg-bubble ai">
            ${m.thinking
              ? U.raw(h`<div class="row gap-8"><span class="dots"><i></i><i></i><i></i></span><span class="muted small">正在检索原文片段…</span></div>`)
              : U.raw(body)}
          </div>

          ${m.evidence && m.evidence.length ? U.raw(h`
            <div class="msg-evidence">
              <div class="row gap-8 mb-8">
                <span class="badge badge-brand">
                  ${m.snippets && m.snippets.length > m.evidence.length
                    ? '检索命中 ' + m.snippets.length + ' 段 · 引用 ' + m.evidence.length + ' 段'
                    : '引用 ' + m.evidence.length + ' 段原文'}
                </span>
                <span class="muted tiny">编号与上方回答里的 [n] 一一对应</span>
              </div>
              ${U.raw(m.evidence.map((e, i) => {
                // 用后端给的片段编号，而不是数组下标：
                // 回答可能只引用第 1、3 段，按下标编号会显示成 [1][2]，
                // 用户会以为引用对不上（真实反馈过）。
                const no = e.index || (i + 1);
                return h`
                <div class="evi-item" data-evi="${no}" id="evi-${no}">
                  <div class="row gap-8">
                    <span class="cite">[${no}]</span>
                    <span class="small" style="font-weight:600">${paperTitle(e.paperId)}</span>
                    <span class="muted tiny">${e.section} · 第 ${e.page} 页</span>
                    <div class="spacer"></div>
                    <span class="badge badge-outline">相关度 ${U.pct(e.relevance, 0)}</span>
                  </div>
                  <div class="evi-text mt-8">${e.text}</div>
                  ${e.note ? U.raw(h`<div class="muted tiny mt-8">用途：${e.note}</div>`) : ''}
                </div>`;
              }).join(''))}
            </div>`) : ''}

          <div class="row gap-8 mt-8">
            <button class="btn btn-sm btn-ghost" data-action="copy-text">复制回答</button>
            <button class="btn btn-sm btn-ghost" data-action="qa-open-chat" data-id="${m.chatId || ''}">
              <span class="muted tiny">回答基于 ${App.store.state.qa.paperIds.length} 篇论文的检索结果</span>
            </button>
          </div>
        </div>
      </div>`);
  }

  function paperTitle(id) {
    const p = App.data.getPaper(id);
    return p ? U.clip(p.title, 34) : id;
  }

  /* ==========================================================================
     4. 证据面板
     ========================================================================== */
  function evidenceHtml(chat) {
    if (!chat || !chat.messages.length) {
      return App.ui.Out(h`
        <div class="muted small" style="padding:8px">
          提问后，这里会列出用于生成回答的原文片段（RAG 的检索结果），并可点击角标反向定位。
        </div>`);
    }
    const last = chat.messages.filter((m) => m.role === 'assistant' && m.evidence && m.evidence.length).pop();
    if (!last) {
      // 区分两种情况，否则排查时会被误导：
      //   真没检索到 → 检索或索引有问题
      //   检索到但模型没引用 → 检索没问题，是资料相关性或提示词的问题
      const anyAssistant = chat.messages.filter((m) => m.role === 'assistant').pop();
      const snippets = (anyAssistant && anyAssistant.snippets) || [];
      if (snippets.length) {
        return App.ui.Out(h`
          <div class="muted small" style="padding:8px">
            已检索到 ${snippets.length} 段原文，但模型未引用任何片段
            （通常意味着它判断这些资料不足以支撑回答）。以下为检索结果：
          </div>
          ${U.raw(snippets.map((e, i) => h`
            <div class="evi-card">
              <div class="row gap-8">
                <span class="cite">[${i + 1}]</span>
                <span class="small ellipsis" style="font-weight:600">${paperTitle(e.paperId)}</span>
              </div>
              <div class="muted tiny mt-8">${e.section} · 第 ${e.page} 页</div>
              <div class="evi-text mt-8">${e.text}</div>
            </div>`).join(''))}
        `);
      }
      return App.ui.Out(h`<div class="muted small" style="padding:8px">本次提问没有检索到任何原文片段。</div>`);
    }
    return App.ui.Out(last.evidence.map((e, i) => h`
      <div class="evi-card" id="evi-card-${i + 1}">
        <div class="row gap-8">
          <span class="cite">[${i + 1}]</span>
          <span class="small ellipsis" style="font-weight:600">${paperTitle(e.paperId)}</span>
        </div>
        <div class="muted tiny mt-8">${e.section} · 第 ${e.page} 页 · 相关度 ${U.pct(e.relevance, 0)}</div>
        <div class="evi-text mt-8">${e.text}</div>
        ${e.note ? U.raw(h`<div class="muted tiny mt-8">${e.note}</div>`) : ''}
        <div class="row gap-4 mt-8">
          <button class="btn btn-sm btn-ghost" data-action="open-paper" data-id="${e.paperId}">跳转原文</button>
        </div>
      </div>`).join(''));
  }

  /** 点击角标：滚动到对应证据并高亮 */
  function jumpEvidence(n) {
    const card = U.$('#evi-card-' + n);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1500);
    }
    const inline = U.$('#evi-' + n);
    if (inline) {
      inline.classList.add('flash');
      setTimeout(() => inline.classList.remove('flash'), 1500);
    }
  }

  /* ==========================================================================
     5. 交互
     ========================================================================== */
  function bindComposer(el) {
    const input = U.$('#qinput', el);
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromInput(); }
    });
    if (input.dataset.focus === '1') input.focus();

    // 记录用户是否停在底部：流式输出时只有「本来就在底部」才自动跟随。
    // 否则用户向上翻看上面的问答会被不断拽回底部，非常烦人。
    //
    // 注意：不能在这里无条件把 stickToBottom 置为 true。
    // 视图每个 token 都会整体重绘，bindComposer 也随之重跑；
    // 若无条件重置，用户向上翻看的动作会在下一个 token 到来时被抹掉，
    // 表现为「刚翻上去又被拽回底部」。
    // 只有当前还没有滚动容器（首次进入页面）时才初始化为贴底。
    const stream = U.$('#stream', el);
    if (stream && !stream.dataset.bound) {
      stream.dataset.bound = '1';
      stream.addEventListener('scroll', () => {
        // 程序化滚动也会触发该事件，因此这里只在「用户真的离开底部」时
        // 才把跟随关掉；接近底部时重新打开跟随
        stickToBottom = isNearBottom(stream);
      }, { passive: true });
    }
  }

  /** 距离底部 80px 以内视为「停在底部」 */
  function isNearBottom(el, threshold) {
    const t = threshold == null ? 80 : threshold;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= t;
  }

  function sendFromInput() {
    const input = U.$('#qinput');
    if (!input) return;
    const v = input.value.trim();
    if (!v) { App.ui.toast('请输入问题', 'warn'); return; }
    input.value = '';
    ask(v);
  }

  async function ask(question) {
    const st = App.store.state;
    if (!st.qa.paperIds.length) {
      App.ui.toast('请先在左侧勾选至少一篇论文作为问答范围', 'warn');
      return;
    }
    pendingScroll = true;
    const p = App.store.actions.ask(question);   // 立即插入「思考中」消息
    App.store.notify('chats');
    await p;
    pendingScroll = true;
    App.store.notify('chats');
  }

  /* 滚动跟随：每帧最多执行一次
     --------------------------------------------------------------------------
     后端可能一个字一个 token，一次回答会触发上百次渲染与滚动。
     如果每次都直接写 scrollTop：
       1) 同一帧里写多次，浏览器只认最后一次，前面的白算；
       2) 位置反复变化会让滚动条滑块来回抽动，观感很差。
     因此把「要滚动」的请求记录下来，合并到下一帧统一执行一次。
     阈值 8px：内容只长了一两像素时不值得再滚一次。 */
  let scrollRaf = 0;
  let scrollAskForce = false;

  function scrollStream(force) {
    if (force) scrollAskForce = true;
    if (scrollRaf) return;                 // 本帧已排过队，合并即可
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = 0;
      const wantForce = scrollAskForce;
      scrollAskForce = false;
      flushScroll(wantForce);
    });
  }

  function flushScroll(force) {
    const s = U.$('#stream');
    if (!s) return;

    const maxTop = s.scrollHeight - s.clientHeight;
    const gap = maxTop - s.scrollTop;

    // 本来就不该跟随：用户正在向上翻看历史
    if (!force && !stickToBottom && !isNearBottom(s)) return;

    // 已经贴在底部（小于阈值）就不写了，避免无意义的位置变动
    if (gap <= 8) {
      stickToBottom = true;
      return;
    }

    // 瞬时定位，不使用平滑滚动（见 views.css 中 .qa-stream 的说明）
    s.scrollTop = maxTop;
    stickToBottom = true;
  }

  App.views = App.views || {};
  App.views.qa = { render, ask, sendFromInput, jumpEvidence };
})(window.App);
