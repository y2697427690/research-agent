/* ============================================================================
   api.js — 与后端通信的唯一出口
   ----------------------------------------------------------------------------
   为什么单独抽一层：
     1. 视图层不需要知道「数据从哪来」，只读 store.state
     2. 服务器地址只在这里出现一次，换环境改一行
     3. 错误处理、超时、SSE 解析集中在一处，不在每个 action 里重复

   注意 SSE 流式的实现方式：
     浏览器的 EventSource 只支持 GET，而问答必须 POST 传问题，
     因此用 fetch + ReadableStream 手动解析 text/event-stream。
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';

  /* ---------------- 配置 ---------------- */

  // 本机开发用 127.0.0.1，其它情况指向线上服务器。
  // 也可以在浏览器控制台执行 localStorage.setItem('API_BASE', '...') 临时覆盖。
  const DEFAULT_LOCAL = 'http://127.0.0.1:8000/api/v1';
  const DEFAULT_ONLINE = 'http://47.96.97.141:8000/api/v1';

  /**
   * 决定后端地址，优先级从高到低：
   *   1. localStorage 里手动设置的 API_BASE（调试用）
   *   2. 页面本身由后端托管（http/https 且同端口有 /api）→ 直接用同源，
   *      这样换 IP、换域名、经反向代理访问都不用改代码
   *   3. 本机开发 → 127.0.0.1:8000
   *   4. 其余情况（例如直接用 file:// 打开本地文件）→ 线上服务器
   *
   * 第 2 条是后加的：后端现在直接托管 frontend/ 目录，
   * 若仍按 hostname 白名单判断，用别的 IP 或域名访问时就会连到写死的地址。
   */
  function resolveBase() {
    const saved = localStorage.getItem('API_BASE');
    if (saved) return saved.replace(/\/$/, '');

    const proto = location.protocol;
    const host = location.hostname;
    const servedByHttp = proto === 'http:' || proto === 'https:';
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

    if (servedByHttp && !isLocal) {
      // 页面是从某个 http(s) 地址打开的，且不是本机 → 同源调用
      return location.origin.replace(/\/$/, '') + '/api/v1';
    }
    return isLocal ? DEFAULT_LOCAL : DEFAULT_ONLINE;
  }

  let API_BASE = resolveBase();

  /* ---------------- 错误类型 ---------------- */

  class ApiError extends Error {
    constructor(message, code, status, detail) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'UNKNOWN';
      this.status = status || 0;
      this.detail = detail || null;
    }
  }

  /** 把后端的统一错误信封解析成 ApiError */
  async function toError(resp) {
    let code = 'HTTP_' + resp.status;
    let message = '请求失败（' + resp.status + '）';
    let detail = null;
    try {
      const body = await resp.json();
      if (body && body.error) {
        code = body.error.code || code;
        message = body.error.message || message;
        detail = body.error.detail || null;
      }
    } catch (e) {
      // 响应不是 JSON（例如 502 网关错误），保留默认信息
    }
    return new ApiError(message, code, resp.status, detail);
  }

  /* ---------------- 基础请求 ---------------- */

  async function request(path, options) {
    const opts = Object.assign({}, options);
    opts.headers = Object.assign({}, opts.headers);

    let resp;
    try {
      resp = await fetch(API_BASE + path, opts);
    } catch (e) {
      // fetch 抛异常通常意味着服务不可达（断网 / 服务没起 / CORS 被拒）
      throw new ApiError(
        '无法连接后端服务。请确认服务已启动、地址为 ' + API_BASE,
        'NETWORK', 0, { reason: String(e) }
      );
    }

    if (!resp.ok) throw await toError(resp);
    if (resp.status === 204) return null;
    return resp.json();
  }

  function get(path) { return request(path, { method: 'GET' }); }

  /**
   * POST JSON；可选 timeoutMs：超时后主动中断请求。
   * 用途：arXiv 下载可能因为对方限速拖到几分钟，界面不能一直转圈，
   * 到点必须给出明确失败提示（后端另有 75 秒的下载截止时间兜底）。
   */
  function postJson(path, body, timeoutMs) {
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    };
    if (!timeoutMs) return request(path, opts);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    opts.signal = controller.signal;
    return request(path, opts)
      .catch((err) => {
        if (err && err.name === 'AbortError') {
          throw new ApiError(
            '请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）：arXiv 可能对服务器限速，请稍后重试',
            'TIMEOUT', 0
          );
        }
        // request 会把 AbortError 包成 NETWORK，这里还原成超时语义
        if (err && err.code === 'NETWORK' && controller.signal.aborted) {
          throw new ApiError(
            '请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）：arXiv 可能对服务器限速，请稍后重试',
            'TIMEOUT', 0
          );
        }
        throw err;
      })
      .finally(() => clearTimeout(timer));
  }

  function patchJson(path, body) {
    return request(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  function del(path) { return request(path, { method: 'DELETE' }); }

  /* ---------------- 业务接口 ---------------- */

  const api = {
    ApiError,
    get base() { return API_BASE; },
    setBase(url) {
      API_BASE = String(url || '').replace(/\/$/, '') || resolveBase();
      localStorage.setItem('API_BASE', API_BASE);
      return API_BASE;
    },

    /* ---- 健康检查 ---- */
    health() { return get('/health'); },

    /* ---- 论文 ---- */
    listPapers(page, pageSize) {
      const q = '?page=' + (page || 1) + '&page_size=' + (pageSize || 50);
      return get('/papers' + q);
    },
    getPaper(id) { return get('/papers/' + encodeURIComponent(id)); },
    deletePaper(id, removeFile) {
      return del('/papers/' + encodeURIComponent(id) + '?remove_file=' + !!removeFile);
    },
    updatePaper(id, fields) { return patchJson('/papers/' + encodeURIComponent(id), fields); },
    stats() { return get('/papers/stats'); },

    /**
     * 上传一批文件。
     * 后端一次请求可接收多个文件，返回 results 数组，每项可能是：
     *   { paper: {...} }                     新入库
     *   { duplicate: { kind, existing_paper_id, ... } }   判为重复
     *   { error: {...} }                     该文件失败
     */
    uploadPapers(fileList) {
      const files = Array.prototype.slice.call(fileList || []);
      if (!files.length) throw new Error('没有选择文件');
      // 只接受真正的 File/Blob。
      // 踩过的坑：「一键演示」按钮传的是 {name, size} 这种普通对象，
      // FormData.append 会把它转成字符串 "[object Object]" 发给后端，
      // 后端解析 multipart 失败 → 422（而当时异常处理器又崩了，最终是 500）。
      // 这里提前拦下并给出明确提示，比让服务器兜底更容易排查。
      files.forEach((f) => {
        const isBlob = f && (typeof f.slice === 'function' || typeof f.arrayBuffer === 'function');
        if (!isBlob) {
          throw new Error('上传参数不是文件对象：' + (f && f.name ? f.name : String(f)));
        }
      });
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      // 注意：不要手动设置 Content-Type，浏览器需要自己加 boundary
      return request('/papers/upload', { method: 'POST', body: fd });
    },

    /* ---- 解析 ---- */
    /** wait=true 会阻塞到解析完成（小文件几百毫秒，大书几秒） */
    parsePaper(id, wait) {
      return postJson('/papers/' + encodeURIComponent(id) + '/parse?wait=' + (wait !== false), {});
    },
    /** 后台解析模式下轮询这个接口 */
    parseState(id) { return get('/papers/' + encodeURIComponent(id) + '/parse'); },

    /** 取论文正文分块（阅读器用来渲染真实正文） */
    paperChunks(id, lang) {
      return get('/papers/' + encodeURIComponent(id) + '/chunks?lang=' + (lang || 'zh'));
    },

    /**
     * 为论文生成中文译文（按需调用，结果在后端持久化）。
     * limit 控制本次翻译多少块：分批推进可避免单次请求持续数分钟。
     */
    translatePaper(id, opts) {
      const body = Object.assign({ limit: 20, concurrency: 4 }, opts || {});
      return postJson('/papers/' + encodeURIComponent(id) + '/translate', body);
    },

    /**
     * 通用文本翻译（写作页中译英 / 划词翻译英译中）。
     *
     * 与 translatePaper 的区别：那个按论文 id 翻整篇并落库，
     * 这个只翻一段文字、不落库，所以走独立接口 /translate。
     * 超时给 60 秒：一段摘要通常 1~5 秒返回，超时基本是上游异常。
     */
    translateText(text, direction) {
      return postJson(
        '/translate',
        { text: text, direction: direction || 'zh2en' },
        60000
      );
    },

    /* ---- 向量化 ---- */
    embedPaper(id, limit) {
      return postJson('/papers/' + encodeURIComponent(id) + '/embed',
        limit ? { limit: limit } : {});
    },
    indexStatus() { return get('/search/index'); },

    /* ---- 论文发现（arXiv） ---- */
    /**
     * 检索 arXiv。
     * 关键词必须 encodeURIComponent：用户可能输入中文、空格、冒号（arXiv 语法），
     * 直接拼进 URL 会破坏查询串。
     */
    searchArxiv(q, maxResults, sort) {
      return get(
        '/discover/search?q=' + encodeURIComponent(q) +
        '&max_results=' + (maxResults || 10) +
        '&sort=' + (sort || 'relevance')
      );
    },
    /**
     * 把某篇 arXiv 论文下载入库（返回 accepted / duplicate）。
     * 90 秒超时：正常 10~30 秒即可，主要耗时在 arXiv 那边的限速；
     * 超过这个时间基本可判定对方在限制我们，继续等没有意义，
     * 直接给用户「超时，请稍后重试」比一直转圈好。
     */
    ingestArxiv(arxivId, force) {
      return postJson('/discover/ingest', { arxiv_id: arxivId, force: !!force }, 90000);
    },

    /* ---- 引用图谱 ---- */
    graph() { return get('/graph'); },
    /** 重建引用关系：需要重新解析 PDF，约 1~2 秒（6 篇），只在用户点击时调用 */
    rebuildGraph() { return postJson('/graph/rebuild', {}); },

    /* ---- 检索 ---- */
    search(query, topK, allowVector) {
      return postJson('/search', {
        query: query,
        top_k: topK || 8,
        allow_vector: allowVector !== false,
      });
    },

    /* ---- 问答（非流式，便于调试） ---- */
    ask(question, topK, paperIds) {
      return postJson('/qa', {
        question: question,
        top_k: topK || 6,
        paper_ids: paperIds || [],
      });
    },

    /**
     * 问答（SSE 流式）。
     * onEvent 会依次收到：
     *   { type: 'citations', snippets: [...] }   先到的资料来源
     *   { type: 'token', text: '...' }           文本增量
     *   { type: 'done', answer, citations, invalid_marks, refused, mode }
     *   { type: 'error', message }
     *
     * 返回一个 { abort } 对象，调用 abort() 可中断生成。
     */
    askStream(question, topK, onEvent, paperIds) {
      const controller = new AbortController();

      const run = async () => {
        let resp;
        try {
          resp = await fetch(API_BASE + '/qa/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: question,
              top_k: topK || 6,
              // 传 2 篇及以上时后端自动切换为对比模式
              paper_ids: paperIds || [],
            }),
            signal: controller.signal,
          });
        } catch (e) {
          if (e.name === 'AbortError') return;
          throw new ApiError('无法连接后端服务', 'NETWORK', 0, { reason: String(e) });
        }

        if (!resp.ok) throw await toError(resp);
        if (!resp.body) throw new ApiError('当前浏览器不支持流式响应', 'NO_STREAM');

        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        // SSE 的帧以空行分隔。必须缓冲到完整帧再解析，
        // 否则一个 JSON 被网络切断成两半就会解析失败。
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });

          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = frame.split('\n').find((l) => l.indexOf('data: ') === 0);
            if (!line) continue;
            let event;
            try {
              event = JSON.parse(line.slice(6));
            } catch (e) {
              continue;      // 半帧或空帧，忽略
            }
            onEvent(event);
          }
        }
      };

      run().catch((err) => {
        if (err.name === 'AbortError') return;
        onEvent({
          type: 'error',
          message: err.message || '流式请求失败',
          code: err.code,
        });
      });

      return { abort: () => controller.abort() };
    },
  };

  App.api = api;
})(window.App);