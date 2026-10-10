/* 把 _tools/smoke/tests.js 的测试块拼进 run.js（保持两者可独立维护） */
const fs = require('fs');
const path = require('path');

const runPath = path.join(__dirname, 'run.js');
const testsPath = path.join(__dirname, 'tests.js');

let run = fs.readFileSync(runPath, 'utf8');
const tests = fs.readFileSync(testsPath, 'utf8');

const START = '/* --- 1. 八个视图都能渲染';
const END = '/* ==========================================================================\n   输出';

const i = run.indexOf(START);
const j = run.indexOf(END, i);
if (i === -1 || j === -1) {
  console.error('拼接失败：找不到测试块边界 (i=' + i + ', j=' + j + ')');
  process.exit(1);
}

// tests.js 里用的是 documentStub，这里保持一致
run = run.slice(0, i) + tests + '\n' + run.slice(j);
fs.writeFileSync(runPath, run, 'utf8');
console.log('已把测试块写入 run.js（' + tests.split('\n').length + ' 行）');
