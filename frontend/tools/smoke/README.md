# tools/smoke — 无浏览器自测工具

不需要浏览器、不需要任何 npm 依赖（只用 Node.js 内置模块），直接在命令行验证整个前端。

## 怎么跑

```bash
cd research-assistant

node tools/smoke/run.js        # 主测试：80 项（渲染 / 交互 / 算法 / 数据一致性）
node tools/smoke/scanraw.js    # 检查有没有 HTML 被当成文本输出（转义类 bug）
node tools/smoke/checkobj.js   # 检查渲染结果里有没有 [object Object]
node tools/smoke/final.js      # 交付自检：语法 / 引用完整性 / 文件清单 / 代码规模
```

预期输出：

```
=== 脚本加载 ===
  16 个脚本全部加载成功，无语法/引用错误
=== 冒烟测试（渲染 + 交互 + 算法 + 数据一致性）===
  [OK  ] 渲染视图 dashboard（工作台）
  ...
—— 结果：80/80 通过，失败 0，加载错误 0 个 ——
```

## 它是怎么工作的

`run.js` 里内置了一个**极简 DOM 实现**（约 300 行）：

- `El` 类：支持 `innerHTML`（会真正解析成子元素树）、`textContent`、`classList`、`className`、
  `dataset`、`querySelector(All)`（支持 `#id` / `.class` / `tag` / `[data-x="y"]`）
- `serializeChildren()`：把 DOM 树重新序列化成 HTML 字符串（模拟浏览器的 innerHTML getter）
- `document` / `window` / `requestAnimationFrame` 等全局桩

然后把 `index.html` 里那 16 个脚本按同样的顺序 `vm.runInContext` 加载，调用 `App.boot()`，
最后逐个视图渲染并断言。

**这样做的好处**：测试跑的就是真实代码路径（不是 mock），能抓到
「模板写错导致元素没渲染」「插值被转义」「字段名拼错」这类真实缺陷。
开发过程中它确实抓出了多个 bug（例如阅读器引用了未定义的 `bindSelection`、
翻译模式仍显示原文面板、版本号 `"v7"` 被 `parseInt` 解析成 `NaN` 等）。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `run.js` | 测试运行器 + DOM 桩 + 测试用例（由 `tests.js` 拼接而来） |
| `tests.js` | 测试用例正文（改测试改这里，然后跑 `splice.js`） |
| `splice.js` | 把 `tests.js` 拼进 `run.js`（保持两者可独立维护） |
| `scanraw.js` | 扫描所有视图渲染结果里的 `&lt;div` 之类转义痕迹 |
| `checkobj.js` | 扫描渲染结果里的 `[object Object]` |
| `final.js` | 交付自检（语法 / 引用 / 清单 / 规模） |

## 加一条新测试

在 `tests.js` 末尾追加：

```js
t('我的新功能：xxx 应该 yyy', () => {
  restore();                    // 复位状态，避免污染其它用例
  renderView('library');        // 渲染某个视图
  mustFind('#plist');           // 断言元素存在
  mustText('某段文字');          // 断言文字可见
  // 也可以直接调用算法：App.rag.retrieve(...) / App.dedupe.findDuplicate(...)
});
```

然后运行：

```bash
node tools/smoke/splice.js && node tools/smoke/run.js
```

异步用例用 `ta('名称', async () => { ... })`，它们会在同步用例跑完后统一执行。
