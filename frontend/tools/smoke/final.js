/* 最终自检：脚本语法（用 vm 编译做静态检查，避免子进程限制）+ 引用完整性 + 交付清单 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

const jsFiles = [];
(function walk(d) {
  fs.readdirSync(d).forEach((f) => {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) jsFiles.push(p);
  });
})(path.join(ROOT, 'scripts'));

let syntaxBad = 0;
jsFiles.forEach((f) => {
  const code = fs.readFileSync(f, 'utf8');
  try {
    new vm.Script(code, { filename: f });   // 只编译不执行
  } catch (e) {
    console.log('  语法错误 ' + path.relative(ROOT, f) + ' → ' + e.message);
    syntaxBad++;
  }
});
console.log('1) 脚本语法：' + jsFiles.length + ' 个文件，错误 ' + syntaxBad + ' 个');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [];
const re = /(?:src|href)="([^"]+)"/g;
let m;
while ((m = re.exec(html))) refs.push(m[1]);
let missing = 0;
refs.forEach((r) => {
  if (!fs.existsSync(path.join(ROOT, r))) { console.log('  缺少文件: ' + r); missing++; }
});
console.log('2) index.html 引用：' + refs.length + ' 个，缺失 ' + missing + ' 个');

const need = ['index.html', 'README.md', 'docs/requirements.md',
  'styles/theme.css', 'styles/app.css', 'styles/views.css',
  'scripts/core/util.js', 'scripts/core/store.js', 'scripts/core/components.js',
  'scripts/core/rag.js', 'scripts/core/dedupe.js', 'scripts/core/writer.js', 'scripts/core/app.js',
  'scripts/data/mock-data.js',
  'scripts/views/dashboard.js', 'scripts/views/library.js', 'scripts/views/reader.js',
  'scripts/views/qa.js', 'scripts/views/graph.js', 'scripts/views/discover.js',
  'scripts/views/writing.js', 'scripts/views/guide.js'];
let miss = 0;
need.forEach((f) => { if (!fs.existsSync(path.join(ROOT, f))) { console.log('  缺少交付文件: ' + f); miss++; } });
console.log('3) 交付清单：' + need.length + ' 个文件，缺失 ' + miss + ' 个');

let lines = 0, bytes = 0;
jsFiles.concat([path.join(ROOT, 'index.html')]).forEach((f) => {
  const s = fs.readFileSync(f, 'utf8');
  lines += s.split('\n').length; bytes += Buffer.byteLength(s);
});
console.log('4) 代码规模：' + lines + ' 行 / ' + (bytes / 1024).toFixed(0) + ' KB');

console.log('');
console.log('结论：' + ((syntaxBad || missing || miss) ? '存在问题，请检查上面输出' : '全部通过'));
process.exit(syntaxBad || missing || miss ? 1 : 0);
