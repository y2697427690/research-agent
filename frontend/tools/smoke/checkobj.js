/* 检查所有视图渲染结果里是否出现 [object Object]（说明有对象被当成字符串拼接了） */
const path = require('path');
const fs = require('fs');
const harness = fs.readFileSync(path.join(__dirname, 'run.js'), 'utf8');
const cut = harness.indexOf('/* ==========================================================================\n   测试执行');
const code = harness.slice(0, cut) + `module.exports = { App, El };`;
const mod = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', code)(mod, mod.exports, require, __dirname);
const App = mod.exports.App, El = mod.exports.El;

const cases = [
  ['dashboard', () => {}],
  ['library', () => {}],
  ['reader', () => { App.store.state.currentPaperId = 'p-attention-v7'; }],
  ['qa', () => { App.store.state.chats = []; App.store.actions.setQaScope('single'); }],
  ['graph', () => {}],
  ['discover', () => { App.store.actions.setDiscoverTab('daily'); }],
  ['writing', () => { App.store.actions.setWritingTab('outline'); }],
  ['guide', () => {}],
];
App.store.state.papers = App.data.papers.slice();
let bad = 0;
cases.forEach(([view, setup]) => {
  setup();
  const c = new El('main');
  App.store.state.route = view;
  try { App.VIEWS.find((v) => v.id === view).view().render(c); }
  catch (e) { console.log('!! ' + view + ' 抛错: ' + e.message); return; }
  const html = c.innerHTML;
  const n = (html.match(/\[object Object\]/g) || []).length;
  console.log((n ? '✗' : '✓') + ' ' + view + ' 长度=' + html.length + ' [object Object]×' + n);
  if (n) bad++;
});
process.exit(bad ? 1 : 0);
