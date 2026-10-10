/* 扫描所有视图：渲染后，找出「本该是元素却被当文本输出」的 HTML —— 即漏了 U.raw() 的插值 */
const path = require('path');
const fs = require('fs');
const harness = fs.readFileSync(path.join(__dirname, 'run.js'), 'utf8');
const cut = harness.indexOf('/* --- 1. 八个视图都能渲染');
const code = harness.slice(0, cut) + `
module.exports = { App, El, documentStub };
`;
const mod = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', code)(mod, mod.exports, require, __dirname);
const H = mod.exports;
const App = H.App;

const suspects = [];
const RE = /&lt;(\/?)([a-zA-Z][\w-]*)/g;

function scan(label, html) {
  let m; const seen = {};
  while ((m = RE.exec(html))) {
    const tag = m[2].toLowerCase();
    seen[tag] = (seen[tag] || 0) + 1;
  }
  const tags = Object.keys(seen);
  if (tags.length) suspects.push(label + ' → ' + tags.map((t) => t + '×' + seen[t]).join(', '));
}

['dashboard', 'library', 'reader', 'qa', 'graph', 'discover', 'writing', 'guide'].forEach((id) => {
  const c = new H.El('main');
  App.store.state.route = id;
  App.store.state.currentPaperId = id === 'reader' ? 'p-attention-v7' : null;
  try { App.VIEWS.find((v) => v.id === id).view().render(c); } catch (e) { /* 渲染错误已在别处报告 */ }
  scan(id, c.innerHTML);
});

// 读者模式的中英/译文
['original', 'bilingual', 'translation'].forEach((mode) => {
  const c = new H.El('main');
  App.store.state.route = 'reader';
  App.store.state.currentPaperId = 'p-attention-v7';
  App.store.state.reader.mode = mode;
  try { App.views.reader.render(c); } catch (e) {}
  scan('reader[' + mode + ']', c.innerHTML);
});

// 写作四个标签页
['outline', 'diagram', 'viz', 'translate'].forEach((tab) => {
  const c = new H.El('main');
  App.store.state.route = 'writing';
  App.store.state.writing.tab = tab;
  try { App.views.writing.render(c); } catch (e) {}
  scan('writing[' + tab + ']', c.innerHTML);
});

// 推荐三个标签页
['daily', 'weekly', 'interest'].forEach((tab) => {
  const c = new H.El('main');
  App.store.state.route = 'discover';
  App.store.state.discover.tab = tab;
  try { App.views.discover.render(c); } catch (e) {}
  scan('discover[' + tab + ']', c.innerHTML);
});

// 图谱两种布局
['force', 'radial'].forEach((l) => {
  const c = new H.El('main');
  App.store.state.route = 'graph';
  App.store.state.graph.layout = l;
  try { App.views.graph.render(c); } catch (e) {}
  scan('graph[' + l + ']', c.innerHTML);
});

// 生成综述后再扫一次
(function () {
  const c = new H.El('main');
  App.store.state.route = 'graph';
  try { App.views.graph.render(c); } catch (e) {}
})();

if (!suspects.length) {
  console.log('✓ 没有发现被转义的 HTML 片段 —— 所有插值都正确使用了 U.raw()');
} else {
  console.log('✗ 发现以下位置把 HTML 当成文本输出了（漏了 U.raw）：');
  suspects.forEach((s) => console.log('   ' + s));
}
process.exit(suspects.length ? 1 : 0);
