# Gold set 评测报告

- 目标服务：`http://47.96.97.141:8000`
- 检索段数 K：16
- 题目：可答 25 题 / 不可答 5 题

## 指标

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Recall@16 | **96.0%** | 期望事实是否出现在检索前 16 段 |
| 引用准确率 | **82.3%** | 引用片段中含期望事实的比例 |
| 可答率 | 80.0% | 回答正文命中期望关键词且至少一条引用 |
| 拒答准确率 | **100.0%** | 库内没有的问题是否明确拒答 |
| 平均问答耗时 | 2.2 s | 单题端到端（检索 + 生成） |

## 逐题结果

| ID | 类型 | Recall | 引用准确率 | 引用数 | 题目 |
| --- | --- | --- | --- | --- | --- |
| a01 | 可答 | ✓ | 100% | 3 | Attention Is All You Need 中 Transforme |
| a02 | 可答 | ✓ | 100% | 2 | 训练 base 版 Transformer 模型用了多少块 GPU？ |
| a03 | 可答 | ✗ | 100% | 1 | 论文 Attention Is All You Need 的第六作者是谁？ |
| a04 | 可答 | ✓ | 100% | 3 | BERT-large 有多少层 Transformer？ |
| a05 | 可答 | ✓ | 0% | 0 | BERT 的预训练目标是什么？ |
| a06 | 可答 | ✓ | 75% | 4 | Layer Normalization 为什么比 Batch Normali |
| a07 | 可答 | ✓ | 100% | 2 | T5 使用的 C4 数据集来自哪里？ |
| a08 | 可答 | ✓ | 100% | 3 | CLIP 怎么做零样本分类？ |
| a09 | 可答 | ✓ | 100% | 2 | Vision Transformer 把图像切分成多大的 patch？ |
| a10 | 可答 | ✓ | 100% | 5 | Codex 在 HumanEval 上的通过率是多少？ |
| a11 | 可答 | ✓ | 0% | 0 | InstructGPT 用了多少名标注人员？ |
| a12 | 可答 | ✓ | 100% | 4 | Qwen2.5 发布了哪些尺寸的模型？ |
| a13 | 可答 | ✓ | 100% | 2 | ZeRO 的三个优化阶段分别切分了什么？ |
| a14 | 可答 | ✓ | 100% | 2 | PPO 的 clipped surrogate objective 解决了什 |
| a15 | 可答 | ✓ | 100% | 5 | Understanding Deep Learning 这本书主要讲什么？ |
| a16 | 可答 | ✓ | 0% | 0 | Improving Language Understanding 用的是哪套 |
| a17 | 可答 | ✓ | 100% | 6 | 在 Transformer 中用 Pre-LN 相比 Post-LN 有什么 |
| a18 | 可答 | ✓ | 100% | 4 | Emergent Abilities of Large Language M |
| a19 | 可答 | ✓ | 100% | 3 | LLaMA 论文总共训练了多少个 token？ |
| a20 | 可答 | ✓ | 100% | 5 | ViT 在大规模数据上预训练后效果如何？ |
| a21 | 可答 | ✓ | 100% | 1 | BERT 论文里用了什么数据做预训练？ |
| a22 | 可答 | ✓ | 100% | 4 | Transformer 的多头注意力里，每个头的维度怎么算？ |
| a23 | 可答 | ✓ | 83% | 6 | GPT 系列里 InstructGPT 和原始 GPT-3 的目标有什么不同 |
| a24 | 可答 | ✓ | 0% | 0 | CLIP 的训练目标是什么？ |
| a25 | 可答 | ✓ | 100% | 2 | T5 把所有任务统一成了什么形式？ |
| u01 | 不可答 | — | — | 0 | ✓ 已拒答 |
| u02 | 不可答 | — | — | 0 | ✓ 已拒答 |
| u03 | 不可答 | — | — | 0 | ✓ 已拒答 |
| u04 | 不可答 | — | — | 0 | ✓ 已拒答 |
| u05 | 不可答 | — | — | 0 | ✓ 已拒答 |

> 本报告由 `deploy/eval_gold.py` 自动生成；题目见 `docs/eval/gold.json`。
