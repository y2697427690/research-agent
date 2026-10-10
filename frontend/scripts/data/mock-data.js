/* ============================================================================
   mock-data.js — 演示数据层（真实项目中由后端 API 提供）
   ----------------------------------------------------------------------------
   为什么要有这个文件？
     前端所有视图都不含「硬编码的假文字」，它们统一从 App.data 取值。
     将来接后端时，只需把这里替换成 fetch('/api/...')，视图代码零改动。

   数据来源：
     · 论文清单 = 需求文档第 2 节「测试数据」里 pdf/ 目录的真实文件
     · 问答素材 = 需求文档 1.2 列出的例题（答案与出处均取自真实论文内容）
     · 其余（图表、推荐理由等）为演示数据，字段旁标注了 [演示]
   ========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';

  /** 固定的「当前时间」——保证相对时间显示永远稳定、可复现 */
  const NOW = '2025-01-12T10:24:00+08:00';
  const day = (n) => new Date(new Date(NOW).getTime() - n * 86400000).toISOString();

  /* ==========================================================================
     A. 论文库
     ========================================================================== */
  const papers = [
    /* ---------- 需求文档点名的重点测试论文（解析结果最详细） ---------- */
    {
      id: 'p-attention-v7',
      file: '1706.03762v7.pdf',
      title: 'Attention Is All You Need',
      titleZh: '注意力就是你所需要的一切',
      authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit',
        'Llion Jones', 'Aidan N. Gomez', 'Łukasz Kaiser', 'Illia Polosukhin'],
      year: 2023, version: 'v7', venue: 'NeurIPS 2017', arxiv: '1706.03762v7',
      pages: 15, sizeBytes: 2215244,
      quality: 0.98, scanned: false, starred: true,
      addedAt: day(6), parsedAt: day(6),
      abstract:
        'The dominant sequence transduction models are based on complex recurrent or convolutional neural ' +
        'networks that include an encoder and a decoder. The best performing models also connect the encoder ' +
        'and decoder through an attention mechanism. We propose a new simple network architecture, the ' +
        'Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.',
      abstractZh:
        '主流的序列转换模型基于复杂的循环或卷积神经网络，包含编码器和解码器。性能最好的模型还通过注意力机制连接编码器与解码器。' +
        '我们提出一种全新的简单网络架构 Transformer，它完全基于注意力机制，彻底摒弃了循环与卷积结构。',
      keywords: ['Transformer', 'Attention', 'Machine Translation', 'Self-Attention'],
      cites: 118420, refs: 40,
      sections: 9, figures: 5, tables: 4, formulas: 27,
      // [演示] 引用关系
      citesIds: ['p-bert', 'p-gpt2', 'p-vit', 'p-reformer', 'p-t5', 'p-gpt3', 'p-palm', 'p-llama'],
      citedByIds: ['p-bert', 'p-gpt1', 'p-vit', 'p-reformer', 'p-t5', 'p-gpt2', 'p-gpt3'],
      core: 'foundation',
    },
    {
      id: 'p-attention-v1',
      file: '1706.03762v1.pdf',
      title: 'Attention Is All You Need (v1 初版)',
      titleZh: '注意力就是你所需要的一切（第一版）',
      authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit',
        'Llion Jones', 'Aidan N. Gomez', 'Łukasz Kaiser', 'Illia Polosukhin'],
      year: 2017, version: 'v1', venue: 'arXiv preprint', arxiv: '1706.03762v1',
      pages: 11, sizeBytes: 2128686,
      quality: 0.96, scanned: false, starred: false,
      addedAt: day(2), parsedAt: day(2),
      abstract:
        'The dominant sequence transduction models are based on complex recurrent or convolutional neural ' +
        'networks in an encoder-decoder configuration.',
      abstractZh: '主流的序列转换模型基于编码器-解码器结构中的复杂循环或卷积神经网络。',
      keywords: ['Transformer', 'Attention'],
      cites: 118420, refs: 34,
      sections: 7, figures: 3, tables: 3, formulas: 24,
      citesIds: ['p-bert', 'p-gpt2'],
      citedByIds: ['p-bert'],
      core: 'derived',
    },
    {
      id: 'p-attention-img',
      file: '1706.03762v1_img.pdf',
      title: 'Attention Is All You Need（图片扫描版）',
      titleZh: '注意力就是你所需要的一切（扫描件）',
      authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
      year: 2017, version: 'v1-scan', venue: 'arXiv preprint', arxiv: '1706.03762v1',
      pages: 11, sizeBytes: 4672118,
      quality: 0.87, scanned: true, starred: false,
      addedAt: day(2), parsedAt: day(2),
      abstract: '扫描件：无文本层，需走 OCR 流程后重建段落与版面。',
      abstractZh: '扫描件：通过 OCR + 版面分析还原为可检索文本。',
      keywords: ['OCR', '扫描件'],
      cites: 118420, refs: 34,
      sections: 7, figures: 3, tables: 3, formulas: 24,
      citesIds: [], citedByIds: [],
      core: 'derived',
      note: '此文件为纯图片 PDF —— 演示「扫描件解析」分支：OCR + 版面还原 + 公式识别。',
    },
    {
      id: 'p-udl',
      file: 'UnderstandingDeepLearning_02_09_26_C.pdf',
      title: 'Understanding Deep Learning',
      titleZh: '理解深度学习',
      authors: ['Simon J.D. Prince'],
      year: 2024, version: '2024-09', venue: 'MIT Press', arxiv: null,
      pages: 541, sizeBytes: 22344992,
      quality: 0.94, scanned: false, starred: true,
      addedAt: day(9), parsedAt: day(9),
      abstract:
        'A comprehensive textbook covering the foundations of deep learning: supervised learning, ' +
        'network architectures, transformers, GANs, diffusion models, reinforcement learning and ethics.',
      abstractZh:
        '一本系统性教材，覆盖深度学习基础：监督学习、网络架构、Transformer、生成对抗网络、扩散模型、强化学习与伦理。',
      keywords: ['Textbook', 'Deep Learning'],
      cites: 890, refs: 0,
      sections: 21, figures: 214, tables: 18, formulas: 402,
      citesIds: ['p-attention-v7', 'p-bert'],
      citedByIds: [],
      core: 'textbook',
      note: '541 页长文档 —— 演示「超长文档」解析：分章切块、层级目录还原、跨页表格合并。',
    },
    { id: 'p-bert', file: 'N19-1423.pdf', title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', titleZh: 'BERT：面向语言理解的深度双向 Transformer 预训练', authors: ['Jacob Devlin', 'Ming-Wei Chang', 'Kenton Lee', 'Kristina Toutanova'], year: 2019, version: 'v1', venue: 'NAACL 2019', arxiv: null, pages: 16, sizeBytes: 786279, quality: 0.97, scanned: false, starred: true, addedAt: day(5), parsedAt: day(5), abstract: 'We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers.', abstractZh: '我们提出新的语言表示模型 BERT，即基于 Transformer 的双向编码器表示。', keywords: ['BERT', 'Pre-training', 'NLU'], cites: 92400, refs: 46, sections: 6, figures: 3, tables: 8, formulas: 6, citesIds: ['p-attention-v7', 'p-gpt1', 'p-elmo'], citedByIds: ['p-gpt2', 'p-roberta'], core: 'foundation' },
    { id: 'p-gpt1', file: 'improving-language-understanding-by-generative-pre-training.pdf', title: 'Improving Language Understanding by Generative Pre-Training', titleZh: '用生成式预训练改进语言理解（GPT-1）', authors: ['Alec Radford', 'Karthik Narasimhan', 'Tim Salimans', 'Ilya Sutskever'], year: 2018, version: 'v1', venue: 'OpenAI Tech Report', arxiv: null, pages: 12, sizeBytes: 541036, quality: 0.93, scanned: false, starred: false, addedAt: day(5), parsedAt: day(5), abstract: 'We explore a semi-supervised approach for language understanding tasks using a combination of unsupervised pre-training and supervised fine-tuning.', abstractZh: '我们探索一种半监督方法：无监督预训练 + 有监督微调，用于语言理解任务。', keywords: ['GPT', 'Pre-training'], cites: 14200, refs: 45, sections: 5, figures: 4, tables: 9, formulas: 3, citesIds: ['p-attention-v7', 'p-elmo'], citedByIds: ['p-gpt2', 'p-bert'], core: 'foundation' },
    { id: 'p-gpt2', file: 'language_models_are_unsupervised_multitask_learners.pdf', title: 'Language Models are Unsupervised Multitask Learners', titleZh: '语言模型是无监督的多任务学习器（GPT-2）', authors: ['Alec Radford', 'Jeffrey Wu', 'Rewon Child', 'David Luan', 'Dario Amodei', 'Ilya Sutskever'], year: 2019, version: 'v1', venue: 'OpenAI Tech Report', arxiv: null, pages: 24, sizeBytes: 1200000, quality: 0.95, scanned: false, starred: true, addedAt: day(4), parsedAt: day(4), abstract: 'We demonstrate that language models begin to learn tasks without any explicit supervision when trained on a new dataset of millions of webpages called WebText.', abstractZh: '我们证明：在名为 WebText 的百万级网页数据集上训练时，语言模型无需显式监督即可开始学习任务。', keywords: ['GPT-2', 'Zero-shot', 'LayerNorm'], cites: 24600, refs: 62, sections: 4, figures: 6, tables: 5, formulas: 2, citesIds: ['p-attention-v7', 'p-gpt1', 'p-bert'], citedByIds: ['p-gpt3'], core: 'foundation' },
    { id: 'p-gpt3', file: '2005.14165v4.pdf', title: 'Language Models are Few-Shot Learners', titleZh: '语言模型是少样本学习器（GPT-3）', authors: ['Tom B. Brown', 'Benjamin Mann', 'Nick Ryder', 'Melanie Subbiah', 'Jared Kaplan', 'Prafulla Dhariwal', 'Amanda Askell', 'Sandhini Agarwal'], year: 2020, version: 'v4', venue: 'NeurIPS 2020', arxiv: '2005.14165', pages: 75, sizeBytes: 6768044, quality: 0.97, scanned: false, starred: true, addedAt: day(4), parsedAt: day(4), abstract: 'We train GPT-3, an autoregressive language model with 175 billion parameters, and test its performance in the few-shot setting.', abstractZh: '我们训练了拥有 1750 亿参数的自回归语言模型 GPT-3，并测试其少样本学习能力。', keywords: ['GPT-3', 'Few-shot', 'In-context Learning'], cites: 41200, refs: 111, sections: 5, figures: 24, tables: 31, formulas: 5, citesIds: ['p-gpt2', 'p-attention-v7'], citedByIds: ['p-palm', 'p-flan', 'p-llama'], core: 'foundation' },
    { id: 'p-adam', file: '1607.06450v1.pdf', title: 'Layer Normalization', titleZh: '层归一化', authors: ['Jimmy Lei Ba', 'Jamie Ryan Kiros', 'Geoffrey E. Hinton'], year: 2016, version: 'v1', venue: 'arXiv preprint', arxiv: '1607.06450', pages: 8, sizeBytes: 612446, quality: 0.96, scanned: false, starred: false, addedAt: day(3), parsedAt: day(3), abstract: 'We propose Layer Normalization, a technique to normalize the activations of neurons within a layer.', abstractZh: '我们提出层归一化（Layer Normalization），用于归一化同一层内神经元的激活值。', keywords: ['LayerNorm', 'Normalization'], cites: 9800, refs: 26, sections: 5, figures: 3, tables: 4, formulas: 12, citesIds: ['p-attention-v7'], citedByIds: ['p-attention-v7', 'p-gpt2', 'p-bert'], core: 'foundation' },
    { id: 'p-seq2seq', file: '1409.3215v3.pdf', title: 'Sequence to Sequence Learning with Neural Networks', titleZh: '用神经网络做序列到序列学习', authors: ['Ilya Sutskever', 'Oriol Vinyals', 'Quoc V. Le'], year: 2014, version: 'v3', venue: 'NeurIPS 2014', arxiv: '1409.3215', pages: 9, sizeBytes: 812000, quality: 0.92, scanned: false, starred: false, addedAt: day(11), parsedAt: day(11), abstract: 'We present a general end-to-end approach to sequence learning that makes minimal assumptions on the sequence structure.', abstractZh: '我们提出一种通用的端到端序列学习方法，对序列结构做出最少假设。', keywords: ['Seq2Seq', 'LSTM'], cites: 21400, refs: 24, sections: 5, figures: 3, tables: 4, formulas: 4, citesIds: ['p-attention-v7'], citedByIds: ['p-attention-v7'], core: 'foundation' },
    { id: 'p-transformer-xl', file: '1910.02054v3.pdf', title: 'Transformer-XL: Attentive Language Models Beyond a Fixed-Length Context', titleZh: 'Transformer-XL：超越固定长度上下文的注意力语言模型', authors: ['Zihang Dai', 'Zhilin Yang', 'Yiming Yang', 'Jaime Carbonell', 'Quoc V. Le', 'Ruslan Salakhutdinov'], year: 2019, version: 'v3', venue: 'ACL 2019', arxiv: '1910.02054', pages: 21, sizeBytes: 779206, quality: 0.95, scanned: false, starred: false, addedAt: day(8), parsedAt: day(8), abstract: 'We propose Transformer-XL to learn dependency beyond a fixed length without disrupting temporal coherence.', abstractZh: '我们提出 Transformer-XL，在不破坏时间连贯性的前提下学习超出固定长度的依赖。', keywords: ['Long Context', 'Segmental Recurrence'], cites: 7600, refs: 42, sections: 6, figures: 4, tables: 6, formulas: 9, citesIds: ['p-attention-v7'], citedByIds: ['p-reformer'], core: 'derived' },
    { id: 'p-t5', file: '1910.10683v4.pdf', title: 'Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer', titleZh: '用统一的文本到文本 Transformer 探索迁移学习的极限（T5）', authors: ['Colin Raffel', 'Noam Shazeer', 'Adam Roberts', 'Katherine Lee', 'Sharan Narang', 'Michael Matena', 'Yanqi Zhou', 'Wei Li', 'Peter J. Liu'], year: 2020, version: 'v4', venue: 'JMLR 2020', arxiv: '1910.10683', pages: 67, sizeBytes: 1190021, quality: 0.96, scanned: false, starred: false, addedAt: day(8), parsedAt: day(8), abstract: 'We explore the landscape of transfer learning techniques for NLP by introducing a unified framework that converts every text problem into a text-to-text format.', abstractZh: '我们提出统一框架，把所有文本任务转换为「文本到文本」格式，系统探索迁移学习技术。', keywords: ['T5', 'Transfer Learning'], cites: 18900, refs: 108, sections: 4, figures: 12, tables: 26, formulas: 7, citesIds: ['p-attention-v7', 'p-bert'], citedByIds: ['p-flan'], core: 'foundation' },
    { id: 'p-lora', file: '2106.09685v2.pdf', title: 'LoRA: Low-Rank Adaptation of Large Language Models', titleZh: 'LoRA：大语言模型的低秩适配', authors: ['Edward J. Hu', 'Yelong Shen', 'Phillip Wallis', 'Zeyuan Allen-Zhu', 'Yuanzhi Li', 'Shean Wang', 'Weizhu Chen'], year: 2021, version: 'v2', venue: 'ICLR 2022', arxiv: '2106.09685', pages: 26, sizeBytes: 1609513, quality: 0.97, scanned: false, starred: false, addedAt: day(7), parsedAt: day(7), abstract: 'We propose Low-Rank Adaptation, or LoRA, which freezes the pre-trained model weights and injects trainable rank decomposition matrices into each layer.', abstractZh: '我们提出低秩适配（LoRA）：冻结预训练权重，在每层注入可训练的低秩分解矩阵。', keywords: ['LoRA', 'PEFT', 'Fine-tuning'], cites: 6900, refs: 55, sections: 7, figures: 6, tables: 11, formulas: 13, citesIds: ['p-gpt3', 'p-attention-v7'], citedByIds: ['p-dpo'], core: 'derived' },
    { id: 'p-dpo', file: '2305.18290v3.pdf', title: 'Direct Preference Optimization: Your Language Model is Secretly a Reward Model', titleZh: '直接偏好优化：你的语言模型其实是一个奖励模型', authors: ['Rafael Rafailov', 'Archit Sharma', 'Eric Mitchell', 'Stefano Ermon', 'Christopher D. Manning', 'Chelsea Finn'], year: 2023, version: 'v3', venue: 'NeurIPS 2023', arxiv: '2305.18290', pages: 32, sizeBytes: 1299212, quality: 0.96, scanned: false, starred: false, addedAt: day(3), parsedAt: day(3), abstract: 'We introduce Direct Preference Optimization (DPO), a simple and stable algorithm that fine-tunes LMs to align with human preferences without reinforcement learning.', abstractZh: '我们提出直接偏好优化（DPO）：无需强化学习即可让语言模型对齐人类偏好的简单稳定算法。', keywords: ['DPO', 'RLHF', 'Alignment'], cites: 3200, refs: 60, sections: 8, figures: 5, tables: 4, formulas: 21, citesIds: ['p-instructgpt', 'p-lora'], citedByIds: [], core: 'derived' },
    { id: 'p-instructgpt', file: '2203.02155v1.pdf', title: 'Training language models to follow instructions with human feedback', titleZh: '用人类反馈训练语言模型遵循指令（InstructGPT）', authors: ['Long Ouyang', 'Jeffrey Wu', 'Xu Jiang', 'Diogo Almeida', 'Carroll L. Wainwright'], year: 2022, version: 'v1', venue: 'NeurIPS 2022', arxiv: '2203.02155', pages: 68, sizeBytes: 1797405, quality: 0.95, scanned: false, starred: true, addedAt: day(6), parsedAt: day(6), abstract: 'We fine-tune GPT-3 with human feedback to align it with user intent across a wide range of tasks.', abstractZh: '我们用人类反馈微调 GPT-3，使其在广泛任务上对齐用户意图。', keywords: ['RLHF', 'Alignment'], cites: 15800, refs: 92, sections: 6, figures: 20, tables: 14, formulas: 8, citesIds: ['p-gpt3'], citedByIds: ['p-dpo', 'p-llama2'], core: 'foundation' },
    { id: 'p-flash', file: '2205.14135v2.pdf', title: 'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness', titleZh: 'FlashAttention：基于 IO 感知的快速省内存精确注意力', authors: ['Tri Dao', 'Daniel Y. Fu', 'Stefano Ermon', 'Atri Rudra', 'Christopher Ré'], year: 2022, version: 'v2', venue: 'NeurIPS 2022', arxiv: '2205.14135', pages: 20, sizeBytes: 2630825, quality: 0.96, scanned: false, starred: false, addedAt: day(7), parsedAt: day(7), abstract: 'We propose FlashAttention, an IO-aware exact attention algorithm that uses tiling to reduce memory reads/writes.', abstractZh: '我们提出 FlashAttention：一种 IO 感知的精确注意力算法，通过分块减少显存读写。', keywords: ['Efficient Attention', 'CUDA'], cites: 4100, refs: 48, sections: 6, figures: 8, tables: 5, formulas: 16, citesIds: ['p-attention-v7'], citedByIds: ['p-llama'], core: 'derived' },
    { id: 'p-emergent', file: 'Emergent_Abilities_of_Large_Language_Models.pdf', title: 'Emergent Abilities of Large Language Models', titleZh: '大语言模型的涌现能力', authors: ['Jason Wei', 'Yi Tay', 'Rishi Bommasani', 'Colin Raffel', 'Barret Zoph', 'Sebastian Borgeaud', 'Dani Yogatama'], year: 2022, version: 'v2', venue: 'TMLR 2022', arxiv: '2206.07682', pages: 30, sizeBytes: 629661, quality: 0.94, scanned: false, starred: false, addedAt: day(10), parsedAt: day(10), abstract: 'We discuss the emergent abilities of large language models that are not present in smaller models.', abstractZh: '我们讨论大语言模型具备而小模型不具备的「涌现能力」。', keywords: ['Emergent Abilities', 'Scaling'], cites: 5300, refs: 70, sections: 5, figures: 12, tables: 3, formulas: 1, citesIds: ['p-gpt3'], citedByIds: [], core: 'derived' },
    { id: 'p-chinchilla', file: '2203.15556v1.pdf', title: 'Training Compute-Optimal Large Language Models', titleZh: '训练算力最优的大语言模型（Chinchilla）', authors: ['Jordan Hoffmann', 'Sebastian Borgeaud', 'Arthur Mensch', 'Elon Buchatskaya', 'Trevor Cai'], year: 2022, version: 'v1', venue: 'NeurIPS 2022', arxiv: '2203.15556', pages: 36, sizeBytes: 1530000, quality: 0.95, scanned: false, starred: false, addedAt: day(6), parsedAt: day(6), abstract: 'We investigate the optimal model size and number of tokens for training a transformer language model under a given compute budget.', abstractZh: '我们研究在给定算力预算下，训练 Transformer 语言模型的最优模型规模与 token 数量。', keywords: ['Scaling Laws', 'Chinchilla'], cites: 6100, refs: 65, sections: 5, figures: 16, tables: 9, formulas: 6, citesIds: ['p-gpt3'], citedByIds: ['p-llama'], core: 'foundation' },
    { id: 'p-palm', file: '2204.02311v5.pdf', title: 'PaLM: Scaling Language Modeling with Pathways', titleZh: 'PaLM：用 Pathways 扩展语言建模', authors: ['Aakanksha Chowdhery', 'Sharan Narang', 'Jacob Devlin', 'Maarten Bosma', 'Gaurav Mishra'], year: 2022, version: 'v5', venue: 'JMLR 2023', arxiv: '2204.02311', pages: 113, sizeBytes: 3800000, quality: 0.96, scanned: false, starred: false, addedAt: day(9), parsedAt: day(9), abstract: 'We present PaLM, a 540-billion parameter dense decoder-only Transformer trained on 6144 TPU v4 chips.', abstractZh: '我们提出 PaLM：5400 亿参数的稠密 decoder-only Transformer，在 6144 块 TPU v4 上训练。', keywords: ['PaLM', 'Scaling', 'TPU'], cites: 8700, refs: 120, sections: 6, figures: 30, tables: 40, formulas: 12, citesIds: ['p-gpt3', 'p-attention-v7'], citedByIds: ['p-llama'], core: 'derived' },
    { id: 'p-switch', file: '2101.03961v3.pdf', title: 'Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity', titleZh: 'Switch Transformer：用简单高效的稀疏性扩展到万亿参数', authors: ['William Fedus', 'Barret Zoph', 'Noam Shazeer'], year: 2021, version: 'v3', venue: 'JMLR 2022', arxiv: '2101.03961', pages: 39, sizeBytes: 1304157, quality: 0.95, scanned: false, starred: false, addedAt: day(10), parsedAt: day(10), abstract: 'We simplify the Mixture-of-Experts routing algorithm and design intuitive improved models with reduced communication and computational costs.', abstractZh: '我们简化了专家混合（MoE）路由算法，设计了通信与计算开销更低的改进模型。', keywords: ['MoE', 'Sparsity'], cites: 3900, refs: 58, sections: 7, figures: 9, tables: 12, formulas: 10, citesIds: ['p-attention-v7', 'p-t5'], citedByIds: ['p-mixtral', 'p-deepseekv2'], core: 'derived' },
    { id: 'p-peft', file: '2305.14314v1.pdf', title: 'QLoRA: Efficient Finetuning of Quantized LLMs', titleZh: 'QLoRA：量化大模型的高效微调', authors: ['Tim Dettmers', 'Artidoro Pagnoni', 'Ari Holtzman', 'Luke Zettlemoyer'], year: 2023, version: 'v1', venue: 'NeurIPS 2023', arxiv: '2305.14314', pages: 28, sizeBytes: 1065470, quality: 0.95, scanned: false, starred: false, addedAt: day(5), parsedAt: day(5), abstract: 'We present QLoRA, an efficient finetuning approach that reduces memory usage enough to finetune a 65B parameter model on a single 48GB GPU.', abstractZh: '我们提出 QLoRA：显著降低显存占用，可在单张 48GB GPU 上微调 650 亿参数模型。', keywords: ['Quantization', 'LoRA'], cites: 3400, refs: 52, sections: 6, figures: 7, tables: 13, formulas: 6, citesIds: ['p-lora', 'p-gpt3'], citedByIds: [], core: 'derived' },
    { id: 'p-mistral', file: '2310.06825v1.pdf', title: 'Mistral 7B', titleZh: 'Mistral 7B', authors: ['Albert Q. Jiang', 'Alexandre Sablayrolles', 'Arthur Mensch', 'Chris Bamford', 'Devendra Singh Chaplot'], year: 2023, version: 'v1', venue: 'arXiv preprint', arxiv: '2310.06825', pages: 9, sizeBytes: 3749788, quality: 0.93, scanned: false, starred: false, addedAt: day(4), parsedAt: day(4), abstract: 'We introduce Mistral 7B, a 7-billion-parameter language model engineered for superior performance and efficiency.', abstractZh: '我们提出 Mistral 7B：为卓越性能与效率而设计的 70 亿参数语言模型。', keywords: ['Mistral', 'GQA', 'Sliding Window'], cites: 2900, refs: 30, sections: 4, figures: 2, tables: 6, formulas: 3, citesIds: ['p-attention-v7', 'p-llama'], citedByIds: ['p-mixtral'], core: 'derived' },
    { id: 'p-mixtral', file: '2401.04088v1.pdf', title: 'Mixtral of Experts', titleZh: 'Mixtral 专家混合模型', authors: ['Albert Q. Jiang', 'Alexandre Sablayrolles', 'Antoine Roux', 'Arthur Mensch', 'Blanche Savary'], year: 2024, version: 'v1', venue: 'arXiv preprint', arxiv: '2401.04088', pages: 12, sizeBytes: 1420000, quality: 0.94, scanned: false, starred: false, addedAt: day(1), parsedAt: day(1), abstract: 'We introduce Mixtral 8x7B, a Sparse Mixture of Experts (SMoE) language model.', abstractZh: '我们提出 Mixtral 8x7B：稀疏专家混合（SMoE）语言模型。', keywords: ['MoE', 'Mixtral'], cites: 1900, refs: 26, sections: 4, figures: 3, tables: 5, formulas: 2, citesIds: ['p-switch', 'p-mistral'], citedByIds: ['p-deepseekv2'], core: 'derived' },
    { id: 'p-llama', file: '2302.13971v1.pdf', title: 'LLaMA: Open and Efficient Foundation Language Models', titleZh: 'LLaMA：开放高效的基础语言模型', authors: ['Hugo Touvron', 'Thibaut Lavril', 'Gautier Izacard', 'Xavier Martinet', 'Marie-Anne Lachaux'], year: 2023, version: 'v1', venue: 'arXiv preprint', arxiv: '2302.13971', pages: 27, sizeBytes: 2100000, quality: 0.96, scanned: false, starred: true, addedAt: day(7), parsedAt: day(7), abstract: 'We introduce LLaMA, a collection of foundation language models ranging from 7B to 65B parameters, trained on publicly available datasets exclusively.', abstractZh: '我们提出 LLaMA：从 70 亿到 650 亿参数的基础语言模型集合，仅使用公开数据集训练。', keywords: ['LLaMA', 'Open Models'], cites: 12800, refs: 84, sections: 5, figures: 6, tables: 14, formulas: 8, citesIds: ['p-attention-v7', 'p-chinchilla', 'p-gpt3'], citedByIds: ['p-llama2', 'p-mistral'], core: 'foundation' },
    { id: 'p-llama2', file: '2307.09288v2.pdf', title: 'Llama 2: Open Foundation and Fine-Tuned Chat Models', titleZh: 'Llama 2：开放的基础模型与微调对话模型', authors: ['Hugo Touvron', 'Louis Martin', 'Kevin Stone', 'Peter Albert', 'Amjad Almahairi'], year: 2023, version: 'v2', venue: 'arXiv preprint', arxiv: '2307.09288', pages: 77, sizeBytes: 13661300, quality: 0.97, scanned: false, starred: false, addedAt: day(5), parsedAt: day(5), abstract: 'We develop and release Llama 2, a collection of pretrained and fine-tuned large language models ranging in scale from 7 billion to 70 billion parameters.', abstractZh: '我们开发并发布 Llama 2：从 70 亿到 700 亿参数的预训练与微调大语言模型集合。', keywords: ['Llama 2', 'RLHF', 'Safety'], cites: 11200, refs: 106, sections: 6, figures: 22, tables: 27, formulas: 5, citesIds: ['p-llama', 'p-instructgpt'], citedByIds: [], core: 'derived' },
    { id: 'p-deepseekv2', file: '2405.04434v5.pdf', title: 'DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model', titleZh: 'DeepSeek-V2：强大、经济、高效的专家混合语言模型', authors: ['DeepSeek-AI'], year: 2024, version: 'v5', venue: 'arXiv preprint', arxiv: '2405.04434', pages: 52, sizeBytes: 2600000, quality: 0.96, scanned: false, starred: true, addedAt: day(2), parsedAt: day(2), abstract: 'We present DeepSeek-V2, a strong Mixture-of-Experts language model characterized by economical training and efficient inference with MLA and DeepSeekMoE.', abstractZh: '我们提出 DeepSeek-V2：采用 MLA 与 DeepSeekMoE 的专家混合语言模型，训练经济、推理高效。', keywords: ['MoE', 'MLA', 'KV Cache'], cites: 1400, refs: 62, sections: 6, figures: 10, tables: 18, formulas: 22, citesIds: ['p-attention-v7', 'p-switch', 'p-mixtral'], citedByIds: ['p-deepseekv3'], core: 'frontier' },
    { id: 'p-deepseekv3', file: '2412.19437v1.pdf', title: 'DeepSeek-V3 Technical Report', titleZh: 'DeepSeek-V3 技术报告', authors: ['DeepSeek-AI'], year: 2024, version: 'v1', venue: 'arXiv preprint', arxiv: '2412.19437', pages: 53, sizeBytes: 1887607, quality: 0.97, scanned: false, starred: true, addedAt: day(2), parsedAt: day(2), abstract: 'We present DeepSeek-V3, a strong Mixture-of-Experts (MoE) language model with 671B total parameters with 37B activated for each token.', abstractZh: '我们提出 DeepSeek-V3：总参数 671B、每 token 激活 37B 的专家混合语言模型。', keywords: ['MoE', 'FP8', 'MTP'], cites: 980, refs: 58, sections: 6, figures: 12, tables: 20, formulas: 26, citesIds: ['p-deepseekv2', 'p-attention-v7'], citedByIds: ['p-r1'], core: 'frontier' },
    { id: 'p-r1', file: '2501.12948v2.pdf', title: 'DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning', titleZh: 'DeepSeek-R1：通过强化学习激发大模型推理能力', authors: ['DeepSeek-AI'], year: 2025, version: 'v2', venue: 'arXiv preprint', arxiv: '2501.12948', pages: 22, sizeBytes: 5034998, quality: 0.97, scanned: false, starred: true, addedAt: day(1), parsedAt: day(1), abstract: 'We introduce our first-generation reasoning models, DeepSeek-R1-Zero and DeepSeek-R1, trained with large-scale reinforcement learning.', abstractZh: '我们提出第一代推理模型 DeepSeek-R1-Zero 与 DeepSeek-R1，通过大规模强化学习训练。', keywords: ['Reasoning', 'RL', 'GRPO'], cites: 620, refs: 40, sections: 5, figures: 6, tables: 12, formulas: 10, citesIds: ['p-deepseekv3', 'p-instructgpt'], citedByIds: [], core: 'frontier' },
    { id: 'p-dpo2', file: '2406.14491v2.pdf', title: 'Reflexive Insufficiency: A Unifying Theory of Human Preference Alignment', titleZh: '自反不足性：人类偏好对齐的统一理论', authors: ['Anonymous'], year: 2024, version: 'v2', venue: 'arXiv preprint', arxiv: '2406.14491', pages: 18, sizeBytes: 843992, quality: 0.72, scanned: false, starred: false, addedAt: day(12), parsedAt: day(12), abstract: '[演示数据] 该文档为理论性论文，解析置信度偏低，可用于演示「低质量解析 + 人工校对」流程。', abstractZh: '[演示数据] 解析置信度偏低，适合展示人工校对流程。', keywords: ['Alignment Theory'], cites: 12, refs: 30, sections: 5, figures: 1, tables: 2, formulas: 30, citesIds: [], citedByIds: [], core: 'peripheral' },
    { id: 'p-cc', file: '2412.15115v2.pdf', title: 'A Survey on Large Language Model Alignment', titleZh: '大语言模型对齐综述', authors: ['Anonymous'], year: 2024, version: 'v2', venue: 'arXiv preprint', arxiv: '2412.15115', pages: 40, sizeBytes: 1938604, quality: 0.86, scanned: false, starred: false, addedAt: day(3), parsedAt: day(3), abstract: '[演示数据] 综述类长文，参考文献 300+，可演示「参考文献自动下载」能力。', abstractZh: '[演示数据] 综述类长文，适合演示参考文献批量抓取。', keywords: ['Survey', 'Alignment'], cites: 240, refs: 312, sections: 8, figures: 10, tables: 6, formulas: 4, citesIds: [], citedByIds: [], core: 'peripheral' },
    { id: 'p-gpt4', file: '2303.08774v6.pdf', title: 'GPT-4 Technical Report', titleZh: 'GPT-4 技术报告', authors: ['OpenAI'], year: 2023, version: 'v6', venue: 'arXiv preprint', arxiv: '2303.08774', pages: 100, sizeBytes: 5245564, quality: 0.94, scanned: false, starred: false, addedAt: day(8), parsedAt: day(8), abstract: 'We report the development of GPT-4, a large-scale, multimodal model which can accept image and text inputs and produce text outputs.', abstractZh: '我们报告 GPT-4 的研发：可接受图像与文本输入并输出文本的大规模多模态模型。', keywords: ['GPT-4', 'Multimodal'], cites: 9800, refs: 60, sections: 6, figures: 30, tables: 25, formulas: 2, citesIds: ['p-gpt3', 'p-clip'], citedByIds: [], core: 'foundation' },
    { id: 'p-llava', file: '2304.08485v2.pdf', title: 'Visual Instruction Tuning', titleZh: '视觉指令微调（LLaVA）', authors: ['Haotian Liu', 'Chunyuan Li', 'Qingyang Wu', 'Yong Jae Lee'], year: 2023, version: 'v2', venue: 'NeurIPS 2023', arxiv: '2304.08485', pages: 25, sizeBytes: 5906135, quality: 0.95, scanned: false, starred: false, addedAt: day(6), parsedAt: day(6), abstract: 'We present LLaVA, a large language-and-vision assistant built by visual instruction tuning.', abstractZh: '我们提出 LLaVA：通过视觉指令微调构建的大型语言-视觉助手。', keywords: ['Multimodal', 'Instruction Tuning'], cites: 3600, refs: 66, sections: 6, figures: 11, tables: 9, formulas: 4, citesIds: ['p-clip', 'p-llama', 'p-instructgpt'], citedByIds: [], core: 'derived' },
    { id: 'p-vit', file: '2010.11929v2.pdf', title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', titleZh: '一张图等于 16x16 个词：用于大规模图像识别的 Transformer（ViT）', authors: ['Alexey Dosovitskiy', 'Lucas Beyer', 'Alexander Kolesnikov', 'Dirk Weissenborn', 'Xiaohua Zhai'], year: 2021, version: 'v2', venue: 'ICLR 2021', arxiv: '2010.11929', pages: 22, sizeBytes: 3743814, quality: 0.97, scanned: false, starred: true, addedAt: day(9), parsedAt: day(9), abstract: 'We show that a pure transformer applied directly to sequences of image patches can perform very well on image classification tasks.', abstractZh: '我们证明：把纯 Transformer 直接应用于图像块序列，在图像分类任务上表现极佳。', keywords: ['ViT', 'Vision Transformer'], cites: 26400, refs: 55, sections: 5, figures: 8, tables: 11, formulas: 6, citesIds: ['p-attention-v7', 'p-bert'], citedByIds: ['p-clip'], core: 'foundation' },
    { id: 'p-clip', file: '2103.00020v1.pdf', title: 'Learning Transferable Visual Models From Natural Language Supervision', titleZh: '从自然语言监督中学习可迁移的视觉模型（CLIP）', authors: ['Alec Radford', 'Jong Wook Kim', 'Chris Hallacy', 'Aditya Ramesh', 'Gabriel Goh'], year: 2021, version: 'v1', venue: 'ICML 2021', arxiv: '2103.00020', pages: 48, sizeBytes: 6813639, quality: 0.96, scanned: false, starred: false, addedAt: day(10), parsedAt: day(10), abstract: 'We demonstrate that the simple pre-training task of predicting which caption goes with which image is an efficient way to learn image representations.', abstractZh: '我们证明：预测「哪段描述配哪张图」这一简单预训练任务，是学习图像表示的高效方式。', keywords: ['CLIP', 'Contrastive Learning'], cites: 21000, refs: 90, sections: 5, figures: 16, tables: 14, formulas: 5, citesIds: ['p-vit', 'p-attention-v7'], citedByIds: ['p-llava', 'p-gpt4'], core: 'foundation' },
    { id: 'p-whisper', file: '2212.04356v1.pdf', title: 'Robust Speech Recognition via Large-Scale Weak Supervision', titleZh: '通过大规模弱监督实现稳健语音识别（Whisper）', authors: ['Alec Radford', 'Jong Wook Kim', 'Tao Xu', 'Greg Brockman', 'Christine McLeavey', 'Ilya Sutskever'], year: 2022, version: 'v1', venue: 'ICML 2023', arxiv: '2212.04356', pages: 30, sizeBytes: 1008644, quality: 0.95, scanned: false, starred: false, addedAt: day(11), parsedAt: day(11), abstract: 'We study the capabilities of speech processing systems trained simply to predict large amounts of transcripts of audio on the internet.', abstractZh: '我们研究仅通过预测互联网海量音频转录来训练的语音处理系统的能力。', keywords: ['ASR', 'Weak Supervision'], cites: 7200, refs: 55, sections: 5, figures: 12, tables: 15, formulas: 3, citesIds: ['p-attention-v7'], citedByIds: [], core: 'derived' },
    { id: 'p-retnet', file: '2002.04745v2.pdf', title: 'On Layer Normalization in the Transformer Architecture', titleZh: '论 Transformer 架构中的层归一化', authors: ['Ruibin Xiong', 'Yunchang Yang', 'Di He', 'Kai Zheng', 'Shuxin Zheng', 'Chenyan Xing', 'Huishuai Zhang', 'Yanyan Lan', 'Liwei Wang', 'Tie-Yan Liu'], year: 2020, version: 'v2', venue: 'ICML 2020', arxiv: '2002.04745', pages: 11, sizeBytes: 779713, quality: 0.96, scanned: false, starred: false, addedAt: day(9), parsedAt: day(9), abstract: 'We investigate the necessity and placement of layer normalization in the Transformer architecture (Pre-LN vs Post-LN).', abstractZh: '我们研究 Transformer 中层归一化的必要性及其位置（Pre-LN 与 Post-LN 之争）。', keywords: ['Pre-LN', 'Post-LN', 'Warm-up'], cites: 3300, refs: 30, sections: 5, figures: 4, tables: 5, formulas: 18, citesIds: ['p-attention-v7', 'p-adam'], citedByIds: [], core: 'derived' },
    { id: 'p-elmo', file: '1802.05365v2.pdf', title: 'Deep contextualized word representations', titleZh: '深度上下文化词表示（ELMo）', authors: ['Matthew E. Peters', 'Mark Neumann', 'Mohit Iyyer', 'Matt Gardner', 'Christopher Clark'], year: 2018, version: 'v2', venue: 'NAACL 2018', arxiv: '1802.05365', pages: 15, sizeBytes: 900000, quality: 0.94, scanned: false, starred: false, addedAt: day(12), parsedAt: day(12), abstract: 'We introduce a new type of deep contextualized word representation that models both complex characteristics of word use and how these uses vary across linguistic contexts.', abstractZh: '我们提出一种新型深度上下文化词表示，既建模词语用法的复杂特征，也建模其在语境中的变化。', keywords: ['ELMo', 'Contextual Embedding'], cites: 11200, refs: 40, sections: 5, figures: 3, tables: 7, formulas: 5, citesIds: ['p-attention-v7'], citedByIds: ['p-bert', 'p-gpt1'], core: 'foundation' },
    { id: 'p-flan', file: '2210.11416v5.pdf', title: 'Scaling Instruction-Finetuned Language Models', titleZh: '扩展指令微调的语言模型（FLAN-T5）', authors: ['Hyung Won Chung', 'Le Hou', 'Shayne Longpre', 'Barret Zoph', 'Yi Tay'], year: 2022, version: 'v5', venue: 'JMLR 2024', arxiv: '2210.11416', pages: 60, sizeBytes: 1880000, quality: 0.95, scanned: false, starred: false, addedAt: day(8), parsedAt: day(8), abstract: 'We explore instruction finetuning with a particular focus on scaling the number of tasks, model size, and using chain-of-thought data.', abstractZh: '我们探索指令微调，重点关注任务数量、模型规模的扩展以及思维链数据的使用。', keywords: ['Instruction Tuning', 'CoT'], cites: 4600, refs: 95, sections: 6, figures: 14, tables: 22, formulas: 3, citesIds: ['p-t5', 'p-gpt3'], citedByIds: [], core: 'derived' },
    { id: 'p-roberta', file: '1907.11692v1.pdf', title: 'RoBERTa: A Robustly Optimized BERT Pretraining Approach', titleZh: 'RoBERTa：稳健优化的 BERT 预训练方法', authors: ['Yinhan Liu', 'Myle Ott', 'Naman Goyal', 'Jingfei Du', 'Mandar Joshi'], year: 2019, version: 'v1', venue: 'arXiv preprint', arxiv: '1907.11692', pages: 13, sizeBytes: 700000, quality: 0.95, scanned: false, starred: false, addedAt: day(11), parsedAt: day(11), abstract: 'We present a replication study of BERT pretraining that carefully measures the impact of many key hyperparameters and training data size.', abstractZh: '我们对 BERT 预训练做复现研究，细致衡量多个关键超参与训练数据规模的影响。', keywords: ['RoBERTa', 'BERT'], cites: 12800, refs: 40, sections: 5, figures: 3, tables: 8, formulas: 4, citesIds: ['p-bert'], citedByIds: [], core: 'derived' },
    { id: 'p-reformer', file: '2001.04451v2.pdf', title: 'Reformer: The Efficient Transformer', titleZh: 'Reformer：高效的 Transformer', authors: ['Nikita Kitaev', 'Łukasz Kaiser', 'Anselm Levskaya'], year: 2020, version: 'v2', venue: 'ICLR 2020', arxiv: '2001.04451', pages: 15, sizeBytes: 1000000, quality: 0.94, scanned: false, starred: false, addedAt: day(10), parsedAt: day(10), abstract: 'We introduce Reformer, which uses locality-sensitive hashing and reversible residual layers to make Transformers dramatically more memory-efficient.', abstractZh: '我们提出 Reformer：用局部敏感哈希与可逆残差层，让 Transformer 的显存效率大幅提升。', keywords: ['Efficient Transformer', 'LSH'], cites: 2900, refs: 40, sections: 5, figures: 4, tables: 5, formulas: 12, citesIds: ['p-attention-v7', 'p-transformer-xl'], citedByIds: [], core: 'derived' },
    { id: 'p-rag', file: '2005.11401v4.pdf', title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks', titleZh: '面向知识密集型 NLP 任务的检索增强生成（RAG）', authors: ['Patrick Lewis', 'Ethan Perez', 'Aleksandra Piktus', 'Fabio Petroni', 'Vladimir Karpukhin'], year: 2020, version: 'v4', venue: 'NeurIPS 2020', arxiv: '2005.11401', pages: 19, sizeBytes: 1100000, quality: 0.96, scanned: false, starred: true, addedAt: day(7), parsedAt: day(7), abstract: 'We explore a general-purpose fine-tuning recipe for retrieval-augmented generation (RAG) — models which combine pre-trained parametric and non-parametric memory.', abstractZh: '我们探索检索增强生成（RAG）的通用微调方案：结合预训练的参数化记忆与非参数化记忆。', keywords: ['RAG', 'Retrieval'], cites: 6400, refs: 60, sections: 5, figures: 5, tables: 8, formulas: 9, citesIds: ['p-bert'], citedByIds: [], core: 'foundation' },
    { id: 'p-dpr', file: '2004.04906v3.pdf', title: 'Dense Passage Retrieval for Open-Domain Question Answering', titleZh: '面向开放域问答的稠密段落检索（DPR）', authors: ['Vladimir Karpukhin', 'Barlas Oğuz', 'Sewon Min', 'Patrick Lewis', 'Ledell Wu'], year: 2020, version: 'v3', venue: 'EMNLP 2020', arxiv: '2004.04906', pages: 13, sizeBytes: 900000, quality: 0.95, scanned: false, starred: false, addedAt: day(9), parsedAt: day(9), abstract: 'We show that retrieval can be practically implemented using dense representations alone, where embeddings are learned from a small number of questions and passages.', abstractZh: '我们证明检索可以仅用稠密表示实现：嵌入向量由少量问题与段落学习得到。', keywords: ['DPR', 'Retrieval'], cites: 5100, refs: 45, sections: 5, figures: 2, tables: 7, formulas: 4, citesIds: ['p-bert'], citedByIds: ['p-rag'], core: 'derived' },
    { id: 'p-glm130b', file: '2210.02414v2.pdf', title: 'GLM-130B: An Open Bilingual Pre-trained Model', titleZh: 'GLM-130B：开源双语预训练模型', authors: ['Aohan Zeng', 'Xiao Liu', 'Zhengxiao Du', 'Zihan Wang', 'Hanyu Lai'], year: 2022, version: 'v2', venue: 'ICLR 2023', arxiv: '2210.02414', pages: 53, sizeBytes: 4743570, quality: 0.95, scanned: false, starred: false, addedAt: day(10), parsedAt: day(10), abstract: 'We introduce GLM-130B, an open bilingual (English & Chinese) pre-trained model with 130 billion parameters.', abstractZh: '我们提出 GLM-130B：1300 亿参数的开源双语（中英）预训练模型。', keywords: ['GLM', 'Bilingual'], cites: 2100, refs: 70, sections: 6, figures: 16, tables: 18, formulas: 10, citesIds: ['p-attention-v7', 'p-gpt3'], citedByIds: [], core: 'derived' },
    { id: 'p-coconut', file: '2412.06769v3.pdf', title: 'Training Large Language Models to Reason in a Continuous Latent Space', titleZh: '训练大语言模型在连续隐空间中推理（Coconut）', authors: ['Shaojie Bai', 'Yuhui Zhang', 'Yejin Choi'], year: 2024, version: 'v3', venue: 'arXiv preprint', arxiv: '2412.06769', pages: 20, sizeBytes: 2000000, quality: 0.9, scanned: false, starred: false, addedAt: day(1), parsedAt: day(1), abstract: 'We introduce Coconut (Chain of Continuous Thought), which enables LLMs to reason in a continuous latent space instead of the language space.', abstractZh: '我们提出 Coconut（连续思维链）：让大模型在连续隐空间而非语言空间中推理。', keywords: ['Latent Reasoning', 'CoT'], cites: 180, refs: 40, sections: 5, figures: 5, tables: 4, formulas: 8, citesIds: ['p-r1', 'p-gpt3'], citedByIds: [], core: 'frontier' },
    { id: 'p-ot', file: '2406.07594v2.pdf', title: 'What is the Best Way to Optimally Transport a Language Model?', titleZh: '最优传输语言模型的最佳方式是什么？', authors: ['Anonymous'], year: 2024, version: 'v2', venue: 'arXiv preprint', arxiv: '2406.07594', pages: 16, sizeBytes: 900000, quality: 0.8, scanned: false, starred: false, addedAt: day(13), parsedAt: day(13), abstract: '[演示数据] 较冷门的方向性论文，用于演示「边缘衍生论文」在图谱中的呈现。', abstractZh: '[演示数据] 用于演示图谱中的边缘节点。', keywords: ['Optimal Transport'], cites: 9, refs: 28, sections: 4, figures: 2, tables: 3, formulas: 25, citesIds: ['p-attention-v7'], citedByIds: [], core: 'peripheral' },
  ];

  /* ==========================================================================
     B. 阅读器正文（双栏/单栏排版 + 中英对照 + 引文锚点）
        演示论文：Attention Is All You Need 第 3.2 节
        每个 block 都有 id（供大纲跳转）、en（原文）、zh（译文）、cites（引文角标）
     ========================================================================== */
  const readerDoc = {
    'p-attention-v7': {
      toc: [
        { id: 's1', level: 1, title: '1 Introduction', titleZh: '1 引言', page: 1 },
        { id: 's2', level: 1, title: '2 Background', titleZh: '2 背景', page: 2 },
        { id: 's3', level: 1, title: '3 Model Architecture', titleZh: '3 模型架构', page: 2 },
        { id: 's3-1', level: 2, title: '3.1 Encoder and Decoder Stacks', titleZh: '3.1 编码器与解码器堆叠', page: 2 },
        { id: 's3-2', level: 2, title: '3.2 Attention', titleZh: '3.2 注意力机制', page: 3 },
        { id: 's3-2-1', level: 3, title: '3.2.1 Scaled Dot-Product Attention', titleZh: '3.2.1 缩放点积注意力', page: 3 },
        { id: 's3-2-2', level: 3, title: '3.2.2 Multi-Head Attention', titleZh: '3.2.2 多头注意力', page: 3 },
        { id: 's3-2-3', level: 3, title: '3.2.3 Applications of Attention in our Model', titleZh: '3.2.3 注意力在本模型中的应用', page: 5 },
        { id: 's3-3', level: 2, title: '3.3 Position-wise Feed-Forward Networks', titleZh: '3.3 位置前馈网络', page: 5 },
        { id: 's3-4', level: 2, title: '3.4 Embeddings and Softmax', titleZh: '3.4 词嵌入与 Softmax', page: 5 },
        { id: 's3-5', level: 2, title: '3.5 Positional Encoding', titleZh: '3.5 位置编码', page: 6 },
        { id: 's4', level: 1, title: '4 Why Self-Attention', titleZh: '4 为什么用自注意力', page: 6 },
        { id: 's5', level: 1, title: '5 Training', titleZh: '5 训练', page: 7 },
        { id: 's5-1', level: 2, title: '5.1 Training Data and Batching', titleZh: '5.1 训练数据与批处理', page: 7 },
        { id: 's5-2', level: 2, title: '5.2 Hardware and Schedule', titleZh: '5.2 硬件与训练计划', page: 7 },
        { id: 's5-3', level: 2, title: '5.3 Optimizer', titleZh: '5.3 优化器', page: 7 },
        { id: 's5-4', level: 2, title: '5.4 Regularization', titleZh: '5.4 正则化', page: 8 },
        { id: 's6', level: 1, title: '6 Results', titleZh: '6 实验结果', page: 8 },
        { id: 's7', level: 1, title: '7 Conclusion', titleZh: '7 结论', page: 10 },
        { id: 'refs', level: 1, title: 'References', titleZh: '参考文献', page: 11 },
        { id: 'appendix', level: 1, title: 'Appendix: Attention Visualizations', titleZh: '附录：注意力可视化', page: 13 },
      ],
      blocks: [
        { id: 's1', type: 'h1', en: '1 Introduction', zh: '1 引言', page: 1, section: true },
        {
          id: 's1-p1', type: 'p', page: 1, section: false,
          en: 'Recurrent neural networks, long short-term memory [13] and gated recurrent [7] neural networks in particular, have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation [35, 2, 5].',
          zh: '循环神经网络，尤其是长短期记忆网络 [13] 与门控循环网络 [7]，已被确立为序列建模与转换问题（如语言建模、机器翻译 [35, 2, 5]）的最先进方法。',
          cites: [35, 2, 5],
        },
        {
          id: 's1-p2', type: 'p', page: 1, section: false,
          en: 'Recurrent models typically factor computation along the symbol positions of the input and output sequences. This inherently sequential nature precludes parallelization within training examples, which becomes critical at longer sequence lengths, as memory constraints limit batching across examples.',
          zh: '循环模型通常沿输入与输出序列的符号位置逐步计算。这种固有的顺序性使得训练样本内部无法并行，而在序列较长时这一点尤为关键——显存限制会约束跨样本的批处理规模。',
          cites: [],
        },
        {
          id: 's1-p3', type: 'p', page: 1, section: false,
          en: 'In this work we propose the Transformer, a model architecture eschewing recurrence and instead relying entirely on an attention mechanism to draw global dependencies between input and output. The Transformer allows for significantly more parallelization and can reach a new state of the art in translation quality after being trained for as little as twelve hours on eight P100 GPUs.',
          zh: '在本工作中我们提出 Transformer：这一模型架构摒弃循环，完全依赖注意力机制来建立输入与输出之间的全局依赖。Transformer 允许大幅提升并行度，并且仅用 8 块 P100 GPU 训练 12 小时，就在翻译质量上达到了新的最先进水平。',
          cites: [],
          qaKey: 'q3-gpu',
        },
        { id: 's2', type: 'h1', en: '2 Background', zh: '2 背景', page: 2, section: true },
        {
          id: 's2-p1', type: 'p', page: 2, section: false,
          en: 'The goal of reducing sequential computation also forms the foundation of the Extended Neural GPU [16], ByteNet [18] and ConvS2S [9], all of which use convolutional neural networks as basic building block, computing hidden representations in parallel for all input and output positions.',
          zh: '减少顺序计算这一目标也是 Extended Neural GPU [16]、ByteNet [18] 与 ConvS2S [9] 的基础，它们都以卷积神经网络为基本构件，为所有输入输出位置并行计算隐藏表示。',
          cites: [16, 18, 9],
        },
        {
          id: 's2-p2', type: 'p', page: 2, section: false,
          en: 'Self-attention, sometimes called intra-attention, is an attention mechanism relating different positions of a single sequence in order to compute a representation of the sequence. Self-attention has been used successfully in a variety of tasks including reading comprehension, abstractive summarization, textual entailment and learning task-independent sentence representations [4, 27, 28, 22].',
          zh: '自注意力（有时称为内部注意力）是一种将单个序列的不同位置相互关联、以计算该序列表示的注意力机制。自注意力已成功应用于阅读理解、摘要生成、文本蕴含以及学习任务无关的句子表示等多种任务 [4, 27, 28, 22]。',
          cites: [4, 27, 28, 22],
        },
        { id: 's3', type: 'h1', en: '3 Model Architecture', zh: '3 模型架构', page: 2, section: true },
        {
          id: 's3-p1', type: 'p', page: 2, section: false,
          en: 'Most competitive neural sequence transduction models have an encoder-decoder structure [5, 2, 35]. Here, the encoder maps an input sequence of symbol representations (x1, ..., xn) to a sequence of continuous representations z = (z1, ..., zn).',
          zh: '大多数有竞争力的神经序列转换模型都采用编码器-解码器结构 [5, 2, 35]。编码器把符号表示的输入序列 (x1, ..., xn) 映射为连续表示序列 z = (z1, ..., zn)。',
          cites: [5, 2, 35],
        },
        {
          id: 's3-p2', type: 'p', page: 2, section: false,
          en: 'The Transformer follows this overall architecture using stacked self-attention and point-wise, fully connected layers for both the encoder and decoder, shown in the left and right halves of Figure 1, respectively.',
          zh: 'Transformer 沿用这一整体架构，在编码器与解码器中都堆叠了自注意力层与逐位置全连接层，分别对应图 1 的左右两半。',
          cites: [],
        },
        { id: 's3-1', type: 'h2', en: '3.1 Encoder and Decoder Stacks', zh: '3.1 编码器与解码器堆叠', page: 2, section: true },
        {
          id: 's3-1-p1', type: 'p', page: 2, section: false,
          en: 'Encoder: The encoder is composed of a stack of N = 6 identical layers. Each layer has two sub-layers. The first is a multi-head self-attention mechanism, and the second is a simple, position-wise fully connected feed-forward network.',
          zh: '编码器：编码器由 N = 6 个完全相同的层堆叠而成。每层包含两个子层：第一个是多头自注意力机制，第二个是简单的逐位置全连接前馈网络。',
          cites: [],
        },
        {
          id: 's3-1-p2', type: 'p', page: 3, section: false,
          en: 'We employ a residual connection [11] around each of the two sub-layers, followed by layer normalization [1]. That is, the output of each sub-layer is LayerNorm(x + Sublayer(x)), where Sublayer(x) is the function implemented by the sub-layer itself.',
          zh: '我们在两个子层周围各使用一个残差连接 [11]，随后接层归一化 [1]。也就是说，每个子层的输出为 LayerNorm(x + Sublayer(x))，其中 Sublayer(x) 是该子层自身实现的函数。',
          cites: [11, 1],
          // 演示：点击 [1] 会跳到 refs-ref1 这一条参考文献
          citeLinks: { 11: 'ref-11', 1: 'ref-1' },
        },
        {
          id: 's3-1-p3', type: 'formula', page: 3, section: false,
          en: 'LayerNorm(x + Sublayer(x))',
          zh: '层归一化（残差 + 子层输出）',
          latex: '\\mathrm{LayerNorm}(x + \\mathrm{Sublayer}(x))',
          note: '公式保留原始 LaTeX，翻译时不改动 —— 对应需求 1.3.3.2(c)',
          cites: [],
        },
        {
          id: 's3-1-p4', type: 'p', page: 3, section: false,
          en: 'To facilitate these residual connections, all sub-layers in the model, as well as the embedding layers, produce outputs of dimension d_model = 512.',
          zh: '为便于这些残差连接，模型中所有子层以及嵌入层的输出维度均为 d_model = 512。',
          cites: [],
        },
        { id: 's3-2', type: 'h2', en: '3.2 Attention', zh: '3.2 注意力机制', page: 3, section: true },
        {
          id: 's3-2-p1', type: 'p', page: 3, section: false,
          en: 'An attention function can be described as mapping a query and a set of key-value pairs to an output, where the query, keys, values, and output are all vectors. The output is computed as a weighted sum of the values, where the weight assigned to each value is computed by a compatibility function of the query with the corresponding key.',
          zh: '注意力函数可以描述为：把查询（query）与一组键-值对（key-value）映射为输出，其中查询、键、值与输出都是向量。输出是值的加权和，每个值所分配的权重由查询与对应键的兼容性函数计算得到。',
          cites: [],
        },
        { id: 's3-2-1', type: 'h3', en: '3.2.1 Scaled Dot-Product Attention', zh: '3.2.1 缩放点积注意力', page: 3, section: true },
        {
          id: 's3-2-1-p1', type: 'p', page: 3, section: false,
          en: 'We call our particular attention "Scaled Dot-Product Attention" (Figure 2). The input consists of queries and keys of dimension dk, and values of dimension dv. We compute the dot products of the query with all keys, divide each by √dk, and apply a softmax function to obtain the weights on the values.',
          zh: '我们把这种注意力称为「缩放点积注意力」（图 2）。输入由维度为 dk 的查询与键、维度为 dv 的值组成。我们计算查询与所有键的点积，各自除以 √dk，再应用 softmax 得到值的权重。',
          cites: [],
        },
        {
          id: 's3-2-1-p2', type: 'formula', page: 3, section: false,
          en: 'Attention(Q, K, V) = softmax(QKᵀ / √dk) V',
          zh: '注意力输出 = softmax(查询·键ᵀ / √dk) · 值',
          latex: '\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\!\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}\\right)V',
          note: '公式 (1)：核心注意力公式',
          cites: [],
        },
        { id: 's3-2-2', type: 'h3', en: '3.2.2 Multi-Head Attention', zh: '3.2.2 多头注意力', page: 3, section: true },
        {
          id: 's3-2-2-p1', type: 'p', page: 3, section: false,
          en: 'Instead of performing a single attention function with d_model-dimensional keys, values and queries, we found it beneficial to linearly project the queries, keys and values h times with different, learned linear projections to dk, dk and dv dimensions, respectively.',
          zh: '与其在 d_model 维的键、值、查询上执行单次注意力，我们发现把查询、键、值分别用 h 组不同的可学习线性投影映射到 dk、dk、dv 维效果更好。',
          cites: [],
        },
        {
          id: 's3-2-2-p2', type: 'p', page: 4, section: false,
          en: 'Multi-head attention allows the model to jointly attend to information from different representation subspaces at different positions. With a single attention head, averaging inhibits this. In this work we employ h = 8 parallel attention layers, or heads. For each of these we use dk = dv = d_model/h = 64.',
          zh: '多头注意力让模型能够同时关注不同表示子空间、不同位置的信息。单头注意力会因平均而抑制这一点。本工作中我们使用 h = 8 个并行注意力层（头），每个头取 dk = dv = d_model/h = 64。',
          cites: [],
        },
        {
          id: 's3-2-2-p3', type: 'formula', page: 4, section: false,
          en: 'MultiHead(Q, K, V) = Concat(head1, ..., headh) Wᴼ',
          zh: '多头输出 = 拼接(各头输出) · Wᴼ',
          latex: '\\mathrm{MultiHead}(Q,K,V)=\\mathrm{Concat}(\\mathrm{head}_1,\\dots,\\mathrm{head}_h)W^{O}',
          note: '公式 (3)',
          cites: [],
        },
        {
          id: 's3-2-2-p4', type: 'figure', page: 4, section: false,
          en: 'Figure 2: (left) Scaled Dot-Product Attention. (right) Multi-Head Attention consists of several attention layers running in parallel.',
          zh: '图 2：（左）缩放点积注意力。（右）多头注意力由多个并行运行的注意力层组成。',
          caption: '图 2 缩放点积注意力（左）与多头注意力（右）结构图',
          kind: '架构图',
          cites: [],
        },
        { id: 's3-2-3', type: 'h3', en: '3.2.3 Applications of Attention in our Model', zh: '3.2.3 注意力在本模型中的应用', page: 5, section: true },
        {
          id: 's3-2-3-p1', type: 'list', page: 5, section: false,
          en: '• In "encoder-decoder attention" layers, the queries come from the previous decoder layer, and the memory keys and values come from the output of the encoder.\n• The encoder contains self-attention layers. In a self-attention layer all of the keys, values and queries come from the same place.\n• Similarly, self-attention layers in the decoder allow each position in the decoder to attend to all positions in the decoder up to and including that position.',
          zh: '• 在「编码器-解码器注意力」层中，查询来自上一层解码器，而键与值来自编码器的输出。\n• 编码器包含自注意力层，其键、值、查询全部来自同一处。\n• 类似地，解码器中的自注意力层允许每个位置关注到该位置及之前的所有位置。',
          cites: [],
        },
        { id: 's3-3', type: 'h2', en: '3.3 Position-wise Feed-Forward Networks', zh: '3.3 位置前馈网络', page: 5, section: true },
        {
          id: 's3-3-p1', type: 'p', page: 5, section: false,
          en: 'In addition to attention sub-layers, each of the layers in our encoder and decoder contains a fully connected feed-forward network, which is applied to each position separately and identically. This consists of two linear transformations with a ReLU activation in between.',
          zh: '除注意力子层外，编码器与解码器的每一层还包含一个全连接前馈网络，它对每个位置独立且一致地应用。该网络由两次线性变换构成，中间夹一个 ReLU 激活。',
          cites: [],
        },
        {
          id: 's3-3-p2', type: 'formula', page: 5, section: false,
          en: 'FFN(x) = max(0, xW1 + b1)W2 + b2',
          zh: '前馈网络 = max(0, xW1 + b1)W2 + b2',
          latex: '\\mathrm{FFN}(x)=\\max(0, xW_1+b_1)W_2+b_2',
          note: '公式 (2)',
          cites: [],
        },
        { id: 's3-4', type: 'h2', en: '3.4 Embeddings and Softmax', zh: '3.4 词嵌入与 Softmax', page: 5, section: true },
        {
          id: 's3-4-p1', type: 'p', page: 5, section: false,
          en: 'Similarly to other sequence transduction models, we use learned embeddings to convert the input tokens and output tokens to vectors of dimension d_model. We also use the usual learned linear transformation and softmax function to convert the decoder output to predicted next-token probabilities. In our model, we share the same weight matrix between the two embedding layers and the pre-softmax linear transformation.',
          zh: '与其他序列转换模型类似，我们使用可学习嵌入把输入与输出 token 转换为 d_model 维向量；并用常见的可学习线性变换与 softmax 把解码器输出转换为下一个 token 的预测概率。在本模型中，两个嵌入层与 softmax 前的线性变换共享同一个权重矩阵。',
          cites: [],
        },
        { id: 's3-5', type: 'h2', en: '3.5 Positional Encoding', zh: '3.5 位置编码', page: 6, section: true },
        {
          id: 's3-5-p1', type: 'p', page: 6, section: false,
          en: 'Since our model contains no recurrence and no convolution, in order for the model to make use of the order of the sequence, we must inject some information about the relative or absolute position of the tokens in the sequence. To this end, we add "positional encodings" to the input embeddings at the bottoms of the encoder and decoder stacks.',
          zh: '由于本模型既无循环也无卷积，为了让模型利用序列顺序信息，我们必须注入 token 在序列中相对或绝对位置的信息。为此，我们在编码器与解码器堆叠的底部把「位置编码」加到输入嵌入上。',
          cites: [],
        },
        {
          id: 's3-5-p2', type: 'formula', page: 6, section: false,
          en: 'PE(pos, 2i) = sin(pos / 10000^(2i/d_model)),  PE(pos, 2i+1) = cos(pos / 10000^(2i/d_model))',
          zh: '偶数维用 sin、奇数维用 cos 的位置编码公式',
          latex: 'PE_{(pos,2i)}=\\sin(pos/10000^{2i/d_{model}}),\\quad PE_{(pos,2i+1)}=\\cos(pos/10000^{2i/d_{model}})',
          note: '公式 (4)：位置编码',
          cites: [],
        },
        { id: 's4', type: 'h1', en: '4 Why Self-Attention', zh: '4 为什么用自注意力', page: 6, section: true },
        {
          id: 's4-p1', type: 'p', page: 6, section: false,
          en: 'In this section we compare various aspects of self-attention layers to the recurrent and convolutional layers commonly used for mapping one variable-length sequence of symbol representations to another sequence of equal length. We consider three desiderata: total computational complexity per layer, the amount of computation that can be parallelized, and the path length between long-range dependencies in the network.',
          zh: '本节从三个角度比较自注意力层与常用的循环层、卷积层：每层的总计算复杂度、可并行化的计算量，以及网络中长距离依赖之间的路径长度。',
          cites: [],
        },
        {
          id: 's4-p2', type: 'table', page: 6, section: false,
          en: 'Table 1: Maximum path lengths, per-layer complexity and minimum number of sequential operations for different layer types. n is the sequence length, d is the representation dimension, k is the kernel size of convolutions and r the size of the neighborhood in restricted self-attention.',
          zh: '表 1：不同层类型的最大路径长度、每层复杂度与最少顺序操作数。n 为序列长度，d 为表示维度，k 为卷积核大小，r 为受限自注意力的邻域大小。',
          caption: '表 1 不同层类型的复杂度对比',
          kind: '对比表',
          table: {
            head: ['层类型', '每层复杂度', '顺序操作数', '最大路径长度'],
            rows: [
              ['自注意力 Self-Attention', 'O(n² · d)', 'O(1)', 'O(1)'],
              ['循环 Recurrent', 'O(n · d²)', 'O(n)', 'O(n)'],
              ['卷积 Convolutional', 'O(k · n · d²)', 'O(1)', 'O(log_k(n))'],
              ['受限自注意力', 'O(r · n · d)', 'O(1)', 'O(n/r)'],
            ],
            highlightRow: 0,
          },
          cites: [],
        },
        { id: 's5', type: 'h1', en: '5 Training', zh: '5 训练', page: 7, section: true },
        {
          id: 's5-p1', type: 'p', page: 7, section: false,
          en: 'This section describes the training regime for our models.',
          zh: '本节描述我们模型的训练方案。',
          cites: [],
        },
        { id: 's5-1', type: 'h2', en: '5.1 Training Data and Batching', zh: '5.1 训练数据与批处理', page: 7, section: true },
        {
          id: 's5-1-p1', type: 'p', page: 7, section: false,
          en: 'We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million sentence pairs. Sentences were encoded using byte-pair encoding, which has a shared source-target vocabulary of about 37,000 tokens. For English-French, we used the significantly larger WMT 2014 English-French dataset consisting of 36M sentences.',
          zh: '我们在标准 WMT 2014 英德数据集上训练，该数据集约有 450 万个句对；句子用字节对编码（BPE）编码，共享的源-目标词表约 37,000 个 token。英法任务使用更大的 WMT 2014 英法数据集，约 3600 万句。',
          cites: [],
        },
        { id: 's5-2', type: 'h2', en: '5.2 Hardware and Schedule', zh: '5.2 硬件与训练计划', page: 7, section: true },
        {
          id: 's5-2-p1', type: 'p', page: 7, section: false,
          en: 'We trained our models on one machine with 8 NVIDIA P100 GPUs. For our base models using the hyperparameters described throughout the paper, each training step took about 0.4 seconds. We trained the base models for a total of 100,000 steps or 12 hours. For our big models, step time was 1.0 seconds. The big models were trained for 300,000 steps (3.5 days).',
          zh: '我们在单台机器上用 8 块 NVIDIA P100 GPU 训练模型。对于 base 模型，按本文所述超参数，每个训练步约耗时 0.4 秒，共训练 100,000 步即 12 小时。对于 big 模型，每步耗时 1.0 秒，共训练 300,000 步（3.5 天）。',
          cites: [],
          // 需求 1.2 例题 3 的答案出处
          qaKey: 'q3-gpu',
        },
        { id: 's5-3', type: 'h2', en: '5.3 Optimizer', zh: '5.3 优化器', page: 7, section: true },
        {
          id: 's5-3-p1', type: 'p', page: 7, section: false,
          en: 'We used the Adam optimizer [20] with β1 = 0.9, β2 = 0.98 and ϵ = 10⁻⁹. We varied the learning rate over the course of training, according to the formula: lrate = d_model^(−0.5) · min(step_num^(−0.5), step_num · warmup_steps^(−1.5)).',
          zh: '我们使用 Adam 优化器 [20]，其中 β1 = 0.9、β2 = 0.98、ϵ = 10⁻⁹。学习率在训练过程中按公式变化：lrate = d_model^(−0.5) · min(step_num^(−0.5), step_num · warmup_steps^(−1.5))。',
          cites: [20],
          qaKey: 'q2-adam',
        },
        {
          id: 's5-3-p2', type: 'p', page: 7, section: false,
          en: 'This corresponds to increasing the learning rate linearly for the first warmup_steps training steps, and decreasing it thereafter proportionally to the inverse square root of the step number. We used warmup_steps = 4000.',
          zh: '这等价于在前 warmup_steps 个训练步内线性增加学习率，之后按步数的平方根倒数成比例衰减。我们取 warmup_steps = 4000。',
          cites: [],
        },
        { id: 's5-4', type: 'h2', en: '5.4 Regularization', zh: '5.4 正则化', page: 8, section: true },
        {
          id: 's5-4-p1', type: 'p', page: 8, section: false,
          en: 'Residual Dropout: We apply dropout [33] to the output of each sub-layer, before it is added to the sub-layer input and normalized. In addition, we apply dropout to the sums of the embeddings and the positional encodings in both the encoder and decoder stacks. For the base model, we use a rate of P_drop = 0.1.',
          zh: '残差 Dropout：我们对每个子层的输出施加 dropout [33]，位置在该输出与子层输入相加并归一化之前。此外，对编码器与解码器中嵌入与位置编码之和也施加 dropout。base 模型的丢弃率取 P_drop = 0.1。',
          cites: [33],
        },
        { id: 's6', type: 'h1', en: '6 Results', zh: '6 实验结果', page: 8, section: true },
        {
          id: 's6-p1', type: 'table', page: 9, section: false,
          en: 'Table 2: The Transformer achieves better BLEU scores than previous state-of-the-art models on the English-to-German and English-to-French newstest2014 tests at a fraction of the training cost.',
          zh: '表 2：在 WMT 2014 英德与英法测试集上，Transformer 以远低于以往的训练成本取得了更好的 BLEU 分数。',
          caption: '表 2 机器翻译结果对比（节选）',
          kind: '结果表',
          table: {
            head: ['模型', 'EN-DE BLEU', 'EN-FR BLEU', '训练成本 (FLOPs)'],
            rows: [
              ['ByteNet', '23.75', '—', '—'],
              ['ConvS2S', '25.16', '40.46', '9.6 × 10¹⁸'],
              ['MoE', '26.03', '40.56', '2.0 × 10¹⁹'],
              ['Transformer (base)', '27.3', '38.1', '3.3 × 10¹⁸'],
              ['Transformer (big)', '28.4', '41.8', '2.3 × 10¹⁹'],
            ],
            highlightRow: 4,
          },
          cites: [],
          qaKey: 'q4-bleu',
        },
        { id: 's7', type: 'h1', en: '7 Conclusion', zh: '7 结论', page: 10, section: true },
        {
          id: 's7-p1', type: 'p', page: 10, section: false,
          en: 'In this work, we presented the Transformer, the first sequence transduction model based entirely on attention, replacing the recurrent layers most commonly used in encoder-decoder architectures with multi-headed self-attention. We are excited about the future of attention-based models and plan to apply them to other tasks.',
          zh: '在本工作中我们提出了 Transformer —— 第一个完全基于注意力的序列转换模型，用多头自注意力取代了编码器-解码器架构中最常用的循环层。我们对基于注意力的模型的未来感到兴奋，并计划将其应用到其他任务上。',
          cites: [],
        },
        { id: 'refs', type: 'h1', en: 'References', zh: '参考文献', page: 11, section: true },
        {
          id: 'ref-1', type: 'reference', page: 11, section: false, refNo: 1,
          en: 'Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E. Hinton. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.',
          zh: 'Jimmy Lei Ba, Jamie Ryan Kiros, Geoffrey E. Hinton. 层归一化. arXiv:1607.06450, 2016.',
          local: 'p-adam',   // 库里已有这篇 → 可直接跳转阅读
          cites: [],
        },
        {
          id: 'ref-2', type: 'reference', page: 11, section: false, refNo: 2,
          en: 'Dzmitry Bahdanau, Kyunghyun Cho, and Yoshua Bengio. Neural machine translation by jointly learning to align and translate. CoRR, abs/1409.0473, 2014.',
          zh: 'Dzmitry Bahdanau, Kyunghyun Cho, Yoshua Bengio. 通过联合学习对齐与翻译实现神经机器翻译. CoRR, 2014.',
          local: null,
          cites: [],
        },
        {
          id: 'ref-5', type: 'reference', page: 11, section: false, refNo: 5,
          en: 'Kyunghyun Cho, Bart van Merriënboer, Dzmitry Bahdanau, and Yoshua Bengio. On the properties of neural machine translation: Encoder-decoder approaches. 2014.',
          zh: 'Kyunghyun Cho 等. 论神经机器翻译的性质：编码器-解码器方法. 2014.',
          local: null,
          cites: [],
        },
        {
          id: 'ref-35', type: 'reference', page: 12, section: false, refNo: 35,
          en: 'Ilya Sutskever, Oriol Vinyals, and Quoc V. Le. Sequence to sequence learning with neural networks. In NIPS, 2014.',
          zh: 'Ilya Sutskever, Oriol Vinyals, Quoc V. Le. 用神经网络做序列到序列学习. NIPS, 2014.',
          local: 'p-seq2seq',
          cites: [],
        },
        {
          id: 'ref-7', type: 'reference', page: 11, section: false, refNo: 7,
          en: 'Junyoung Chung, Caglar Gulcehre, KyungHyun Cho, and Yoshua Bengio. Empirical evaluation of gated recurrent neural networks on sequence modeling. CoRR, abs/1412.3555, 2014.',
          zh: 'Junyoung Chung 等. 门控循环神经网络在序列建模上的实证评估. CoRR, 2014.',
          local: null, cites: [],
        },
        {
          id: 'ref-9', type: 'reference', page: 11, section: false, refNo: 9,
          en: 'Jonas Gehring, Michael Auli, David Grangier, Denis Yarats, and Yann N. Dauphin. Convolutional sequence to sequence learning. In ICML, 2017.',
          zh: 'Jonas Gehring 等. 卷积序列到序列学习. ICML, 2017.',
          local: null, cites: [],
        },
        {
          id: 'ref-13', type: 'reference', page: 11, section: false, refNo: 13,
          en: 'Sepp Hochreiter and Jürgen Schmidhuber. Long short-term memory. Neural Computation, 9(8):1735–1780, 1997.',
          zh: 'Sepp Hochreiter, Jürgen Schmidhuber. 长短期记忆. Neural Computation, 1997.',
          local: null, cites: [],
        },
        {
          id: 'ref-16', type: 'reference', page: 11, section: false, refNo: 16,
          en: 'Łukasz Kaiser and Samy Bengio. Can active memory replace attention? In NIPS, 2016.',
          zh: 'Łukasz Kaiser, Samy Bengio. 主动记忆能否替代注意力？NIPS, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-18', type: 'reference', page: 11, section: false, refNo: 18,
          en: 'Nal Kalchbrenner, Lasse Espeholt, Karen Simonyan, Aaron van den Oord, Alex Graves, and Koray Kavukcuoglu. Neural machine translation in linear time. CoRR, abs/1610.10099, 2016.',
          zh: 'Nal Kalchbrenner 等. 线性时间的神经机器翻译. CoRR, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-22', type: 'reference', page: 12, section: false, refNo: 22,
          en: 'Zhouhan Lin, Minwei Feng, Cicero Nogueira dos Santos, Mo Yu, Bing Xiang, Bowen Zhou, and Yoshua Bengio. A structured self-attentive sentence embedding. In ICLR, 2017.',
          zh: 'Zhouhan Lin 等. 结构化自注意力句子嵌入. ICLR, 2017.',
          local: null, cites: [],
        },
        {
          id: 'ref-27', type: 'reference', page: 12, section: false, refNo: 27,
          en: 'Ankur P. Parikh, Oscar Täckström, Dipanjan Das, and Jakob Uszkoreit. A decomposable attention model for natural language inference. In EMNLP, 2016.',
          zh: 'Ankur P. Parikh 等. 用于自然语言推理的可分解注意力模型. EMNLP, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-28', type: 'reference', page: 12, section: false, refNo: 28,
          en: 'Romain Paulus, Caiming Xiong, and Richard Socher. A deep reinforced model for abstractive summarization. CoRR, abs/1705.04304, 2017.',
          zh: 'Romain Paulus 等. 用于摘要生成的深度强化模型. CoRR, 2017.',
          local: null, cites: [],
        },
        {
          id: 'ref-4', type: 'reference', page: 11, section: false, refNo: 4,
          en: 'Jianpeng Cheng, Li Dong, and Mirella Lapata. Long short-term memory-networks for machine reading. In EMNLP, 2016.',
          zh: 'Jianpeng Cheng 等. 用于机器阅读的长短期记忆网络. EMNLP, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-3', type: 'reference', page: 11, section: false, refNo: 3,
          en: 'Denny Britz, Anna Goldie, Thang Luong, and Quoc Le. Massive exploration of neural machine translation architectures. CoRR, abs/1703.03906, 2017.',
          zh: 'Denny Britz 等. 神经机器翻译架构的大规模探索. CoRR, 2017.',
          local: null, cites: [],
        },
        {
          id: 'ref-6', type: 'reference', page: 11, section: false, refNo: 6,
          en: 'Ronan Collobert, Jason Weston, Léon Bottou, Michael Karlen, Koray Kavukcuoglu, and Pavel Kuksa. Natural language processing (almost) from scratch. JMLR, 2011.',
          zh: 'Ronan Collobert 等. 从零开始（几乎）的自然语言处理. JMLR, 2011.',
          local: null, cites: [],
        },
        {
          id: 'ref-8', type: 'reference', page: 11, section: false, refNo: 8,
          en: 'Alex Graves. Generating sequences with recurrent neural networks. CoRR, abs/1308.0850, 2013.',
          zh: 'Alex Graves. 用循环神经网络生成序列. CoRR, 2013.',
          local: null, cites: [],
        },
        {
          id: 'ref-14', type: 'reference', page: 11, section: false, refNo: 14,
          en: 'Rafal Jozefowicz, Oriol Vinyals, Mike Schuster, Noam Shazeer, and Yonghui Wu. Exploring the limits of language modeling. CoRR, abs/1602.02410, 2016.',
          zh: 'Rafal Jozefowicz 等. 探索语言建模的极限. CoRR, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-15', type: 'reference', page: 11, section: false, refNo: 15,
          en: 'Łukasz Kaiser and Ilya Sutskever. Neural GPUs learn algorithms. In ICLR, 2016.',
          zh: 'Łukasz Kaiser, Ilya Sutskever. 神经 GPU 学习算法. ICLR, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-17', type: 'reference', page: 11, section: false, refNo: 17,
          en: 'Nal Kalchbrenner, Lasse Espeholt, Karen Simonyan, and Aaron van den Oord. Neural machine translation in linear time. 2016.',
          zh: 'Nal Kalchbrenner 等. 线性时间的神经机器翻译. 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-19', type: 'reference', page: 11, section: false, refNo: 19,
          en: 'Yoon Kim, Carl Denton, Luong Hoang, and Alexander M. Rush. Structured attention networks. In ICLR, 2017.',
          zh: 'Yoon Kim 等. 结构化注意力网络. ICLR, 2017.',
          local: null, cites: [],
        },
        {
          id: 'ref-21', type: 'reference', page: 12, section: false, refNo: 21,
          en: 'Guillaume Lample, Miguel Ballesteros, Sandeep Subramanian, Kazuya Kawakami, and Chris Dyer. Neural architectures for named entity recognition. In NAACL, 2016.',
          zh: 'Guillaume Lample 等. 用于命名实体识别的神经架构. NAACL, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-23', type: 'reference', page: 12, section: false, refNo: 23,
          en: 'Minh-Thang Luong, Hieu Pham, and Christopher D. Manning. Effective approaches to attention-based neural machine translation. In EMNLP, 2015.',
          zh: 'Minh-Thang Luong 等. 基于注意力的神经机器翻译的有效方法. EMNLP, 2015.',
          local: null, cites: [],
        },
        {
          id: 'ref-24', type: 'reference', page: 12, section: false, refNo: 24,
          en: 'Thang Luong, Ilya Sutskever, Quoc Le, Oriol Vinyals, and Wojciech Zaremba. Addressing the rare word problem in neural machine translation. In ACL, 2015.',
          zh: 'Thang Luong 等. 解决神经机器翻译中的稀有词问题. ACL, 2015.',
          local: null, cites: [],
        },
        {
          id: 'ref-25', type: 'reference', page: 12, section: false, refNo: 25,
          en: 'Stephen Merity, Caiming Xiong, James Bradbury, and Richard Socher. Pointer sentinel mixture models. CoRR, abs/1609.07843, 2016.',
          zh: 'Stephen Merity 等. 指针哨兵混合模型. CoRR, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-26', type: 'reference', page: 12, section: false, refNo: 26,
          en: 'Tomas Mikolov, Ilya Sutskever, Kai Chen, Greg Corrado, and Jeffrey Dean. Distributed representations of words and phrases and their compositionality. In NIPS, 2013.',
          zh: 'Tomas Mikolov 等. 词与短语的分布式表示及其组合性. NIPS, 2013.',
          local: null, cites: [],
        },
        {
          id: 'ref-29', type: 'reference', page: 12, section: false, refNo: 29,
          en: 'Ankur Parikh, Oscar Täckström, Dipanjan Das, and Jakob Uszkoreit. A decomposable attention model. In EMNLP, 2016.',
          zh: 'Ankur Parikh 等. 一种可分解的注意力模型. EMNLP, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-30', type: 'reference', page: 12, section: false, refNo: 30,
          en: 'Rico Sennrich, Barry Haddow, and Alexandra Birch. Neural machine translation of rare words with subword units. In ACL, 2016.',
          zh: 'Rico Sennrich 等. 用子词单元翻译稀有词的神经机器翻译. ACL, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-31', type: 'reference', page: 12, section: false, refNo: 31,
          en: 'Noam Shazeer, Azalia Mirhoseini, Krzysztof Maziarz, Andy Davis, Quoc Le, Geoffrey Hinton, and Jeff Dean. Outrageously large neural networks: The sparsely-gated mixture-of-experts layer. In ICLR, 2017.',
          zh: 'Noam Shazeer 等. 超大规模神经网络：稀疏门控专家混合层. ICLR, 2017.',
          local: 'p-switch', cites: [],
        },
        {
          id: 'ref-32', type: 'reference', page: 12, section: false, refNo: 32,
          en: 'Ilya Sutskever, Oriol Vinyals, and Quoc V. Le. Sequence to sequence learning with neural networks. In NIPS, 2014.',
          zh: 'Ilya Sutskever 等. 用神经网络做序列到序列学习. NIPS, 2014.',
          local: 'p-seq2seq', cites: [],
        },
        {
          id: 'ref-34', type: 'reference', page: 12, section: false, refNo: 34,
          en: 'Christian Szegedy, Vincent Vanhoucke, Sergey Ioffe, Jon Shlens, and Zbigniew Wojna. Rethinking the inception architecture for computer vision. In CVPR, 2016.',
          zh: 'Christian Szegedy 等. 重新思考计算机视觉中的 Inception 架构. CVPR, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-36', type: 'reference', page: 12, section: false, refNo: 36,
          en: 'Ashish Vaswani, Samy Bengio, Eugene Brevdo, Francois Chollet, Aidan N. Gomez, Stephan Gouws, Llion Jones, Łukasz Kaiser, Nal Kalchbrenner, Niki Parmar, Ryan Sepassi, Noam Shazeer, and Jakob Uszkoreit. Tensor2Tensor for neural machine translation. CoRR, abs/1803.07416, 2018.',
          zh: 'Ashish Vaswani 等. 用于神经机器翻译的 Tensor2Tensor. CoRR, 2018.',
          local: null, cites: [],
        },
        {
          id: 'ref-37', type: 'reference', page: 12, section: false, refNo: 37,
          en: 'Yonghui Wu, Mike Schuster, Zhifeng Chen, Quoc V. Le, Mohammad Norouzi, Wolfgang Macherey, et al. Google\'s neural machine translation system: Bridging the gap between human and machine translation. CoRR, abs/1609.08144, 2016.',
          zh: 'Yonghui Wu 等. 谷歌神经机器翻译系统：弥合人机翻译差距. CoRR, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-38', type: 'reference', page: 12, section: false, refNo: 38,
          en: 'Jie Zhou, Ying Cao, Xuguang Wang, Peng Li, and Wei Xu. Deep recurrent models with fast-forward connections for neural machine translation. TACL, 2016.',
          zh: 'Jie Zhou 等. 带快速前向连接的深度循环模型用于神经机器翻译. TACL, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-39', type: 'reference', page: 12, section: false, refNo: 39,
          en: 'Barret Zoph and Quoc V. Le. Neural architecture search with reinforcement learning. In ICLR, 2017.',
          zh: 'Barret Zoph, Quoc V. Le. 用强化学习做神经架构搜索. ICLR, 2017.',
          local: null, cites: [],
        },
        {
          id: 'ref-40', type: 'reference', page: 12, section: false, refNo: 40,
          en: 'Barret Zoph, Vijay Vasudevan, Jonathon Shlens, and Quoc V. Le. Learning transferable architectures for scalable image recognition. In CVPR, 2018.',
          zh: 'Barret Zoph 等. 学习可迁移架构以实现可扩展的图像识别. CVPR, 2018.',
          local: null, cites: [],
        },
        {
          id: 'ref-11', type: 'reference', page: 11, section: false, refNo: 11,
          en: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, and Jian Sun. Deep residual learning for image recognition. In CVPR, 2016.',
          zh: 'Kaiming He 等. 用于图像识别的深度残差学习. CVPR, 2016.',
          local: null, cites: [],
        },
        {
          id: 'ref-20', type: 'reference', page: 12, section: false, refNo: 20,
          en: 'Diederik P. Kingma and Jimmy Ba. Adam: A method for stochastic optimization. In ICLR, 2015.',
          zh: 'Diederik P. Kingma, Jimmy Ba. Adam：一种随机优化方法. ICLR, 2015.',
          local: null, cites: [],
        },
        {
          id: 'ref-33', type: 'reference', page: 12, section: false, refNo: 33,
          en: 'Nitish Srivastava, Geoffrey Hinton, Alex Krizhevsky, Ilya Sutskever, and Ruslan Salakhutdinov. Dropout: a simple way to prevent neural networks from overfitting. JMLR, 2014.',
          zh: 'Nitish Srivastava 等. Dropout：一种防止神经网络过拟合的简单方法. JMLR, 2014.',
          local: null, cites: [],
        },
        { id: 'appendix', type: 'h1', en: 'Appendix: Attention Visualizations', zh: '附录：注意力可视化', page: 13, section: true },
        {
          id: 'appendix-p1', type: 'figure', page: 13, section: false,
          en: 'Figure 3: An example of the attention mechanism following long-distance dependencies in the encoder self-attention in layer 5 of 6. Many of the attention heads attend to a distant dependency of the verb "making", completing the phrase "making...more difficult".',
          zh: '图 3：编码器第 5 层自注意力中捕捉长距离依赖的示例。多个注意力头关注到动词 "making" 的远距离依赖，补全了 "making...more difficult" 这一短语。',
          caption: '图 3 长距离依赖的注意力可视化',
          kind: '可视化图',
          cites: [],
        },
      ],
    },
  };

  /* ==========================================================================
     C. RAG 知识库（问答检索用）
        每条 = 一个可被检索的文本片段（chunk）
     ========================================================================== */
  const knowledge = [
    { id: 'k1', paperId: 'p-attention-v7', section: '1 Introduction', page: 1,
      text: 'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Łukasz Kaiser, Illia Polosukhin. Google Brain, Google Research, University of Toronto.',
      note: '作者列表与单位（例题 1：第 6 作者）' },
    { id: 'k2', paperId: 'p-attention-v7', section: '5.3 Optimizer', page: 7,
      text: 'We used the Adam optimizer [20] with β1 = 0.9, β2 = 0.98 and ϵ = 10⁻⁹. We used warmup_steps = 4000.',
      note: '例题 2：Adam 超参数 β1/β2' },
    { id: 'k3', paperId: 'p-attention-v7', section: '5.2 Hardware and Schedule', page: 7,
      text: 'We trained our models on one machine with 8 NVIDIA P100 GPUs. For our base models ... each training step took about 0.4 seconds. We trained the base models for a total of 100,000 steps or 12 hours.',
      note: '例题 3：8 × NVIDIA P100' },
    { id: 'k4', paperId: 'p-attention-v7', section: '6.1 Machine Translation', page: 8,
      text: 'Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles, by over 2 BLEU. On the WMT 2014 English-to-French translation task, our model establishes a new single-model state-of-the-art BLEU score of 41.8.',
      note: '例题 4：BLEU 28.4 / 41.8' },
    { id: 'k5', paperId: 'p-attention-v7', section: 'References', page: 11,
      text: 'Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E. Hinton. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.',
      note: '例题 5：Layer Normalization 参考文献' },
    { id: 'k6', paperId: 'p-attention-v7', section: '3.2.2 Multi-Head Attention', page: 4,
      text: 'In this work we employ h = 8 parallel attention layers, or heads. For each of these we use dk = dv = d_model/h = 64. Due to the reduced dimension of each head, the total computational cost is similar to that of single-head attention with full dimensionality.',
      note: '多头注意力配置' },
    { id: 'k7', paperId: 'p-attention-v7', section: '3.5 Positional Encoding', page: 6,
      text: 'Since our model contains no recurrence and no convolution, in order for the model to make use of the order of the sequence, we must inject some information about the relative or absolute position of the tokens in the sequence. To this end, we add "positional encodings" to the input embeddings at the bottoms of the encoder and decoder stacks.',
      note: '位置编码动机' },
    { id: 'k8', paperId: 'p-attention-v7', section: '3.2.1 Scaled Dot-Product Attention', page: 4,
      text: 'We suspect that for large values of dk, the dot products grow large in magnitude, pushing the softmax function into regions where it has extremely small gradients. To counteract this effect, we scale the dot products by 1/√dk.',
      note: '为什么除以 √dk' },
    { id: 'k9', paperId: 'p-attention-v7', section: '4 Why Self-Attention', page: 6,
      text: 'A self-attention layer connects all positions with a constant number of sequentially executed operations, whereas a recurrent layer requires O(n) sequential operations. In terms of computational complexity, self-attention layers are faster than recurrent layers when the sequence length n is smaller than the representation dimensionality d.',
      note: '自注意力的复杂度优势' },

    { id: 'k10', paperId: 'p-bert', section: '3 BERT', page: 3,
      text: 'BERT uses a multi-layer bidirectional Transformer encoder based on the original implementation described in Vaswani et al. (2017). We denote the number of layers (i.e., Transformer blocks) as L, the hidden size as H, and the number of self-attention heads as A.',
      note: 'BERT 复用 Transformer Encoder' },
    { id: 'k11', paperId: 'p-bert', section: '3.1 Pre-training BERT', page: 4,
      text: 'We use two unsupervised tasks: Task #1 Masked LM (MLM) — randomly mask some percentage of the input tokens and predict those masked tokens; Task #2 Next Sentence Prediction (NSP).',
      note: 'BERT 的两个预训练任务' },
    { id: 'k12', paperId: 'p-bert', section: '1 Introduction', page: 1,
      text: 'BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.',
      note: 'BERT 的双向性' },

    { id: 'k13', paperId: 'p-gpt1', section: '3 Framework', page: 3,
      text: 'GPT-1 uses a 12-layer decoder-only transformer with masked self-attention heads (768 dimensional states and 12 attention heads) and position-wise feed-forward networks.',
      note: 'GPT-1 规模' },
    { id: 'k14', paperId: 'p-gpt2', section: '2 Approach', page: 3,
      text: 'GPT-2 uses Layer Normalization as the first layer of each transformer block (pre-normalization) and adds an additional layer normalization after the final self-attention block. GPT-1 places layer normalization after each sub-block (post-normalization).',
      note: '例题（1.2.2-3）：GPT-2 的 LN 位置调整' },
    { id: 'k15', paperId: 'p-gpt2', section: '2.3 Model', page: 4,
      text: 'The largest model is a 1.5B parameter model (GPT-2 1542M) with a context window of 1024 tokens.',
      note: 'GPT-2 上下文长度 1024' },
    { id: 'k16', paperId: 'p-gpt3', section: '2.1 Model and Architectures', page: 5,
      text: 'GPT-3 175B: 96 layers, d_model = 12288, 96 heads, batch size 3.2M, learning rate 0.6 × 10⁻⁴, context window of 2048 tokens.',
      note: '例题（1.2.2-4）：GPT-3 上下文 2048' },
    { id: 'k17', paperId: 'p-gpt1', section: '3 Framework', page: 3,
      text: 'GPT-1 context window: 512 tokens (contiguous sequences of 512 tokens).',
      note: 'GPT-1 上下文长度 512' },
    { id: 'k18', paperId: 'p-adam', section: '1 Introduction', page: 1,
      text: 'We propose Layer Normalization, which fixes the mean and variance of the summed inputs within each layer. Layer Normalization is particularly effective for RNNs and is invariant to batch size.',
      note: 'LayerNorm 论文核心' },

    { id: 'k19', paperId: 'p-deepseekv2', section: '2 Architecture', page: 3,
      text: 'DeepSeek-V2 adopts Multi-head Latent Attention (MLA) to compress the Key-Value cache into a latent vector, reducing the KV cache by 93.3% compared with DeepSeek 67B.',
      note: 'MLA 压缩 KV Cache' },
    { id: 'k20', paperId: 'p-deepseekv3', section: '3 Architecture', page: 4,
      text: 'DeepSeek-V3 employs a Multi-Head Latent Attention (MLA) and DeepSeekMoE architecture, with 671B total parameters and 37B activated per token, trained with FP8 mixed precision.',
      note: 'DeepSeek-V3 规模与 FP8' },
    { id: 'k21', paperId: 'p-r1', section: '2 Approach', page: 3,
      text: 'DeepSeek-R1-Zero is trained via large-scale reinforcement learning without supervised fine-tuning as a preliminary step, using GRPO and rule-based rewards for verifiable tasks.',
      note: 'R1-Zero 纯 RL 训练' },
    { id: 'k22', paperId: 'p-switch', section: '2 Switch Transformer', page: 3,
      text: 'The Switch Transformer simplifies the Mixture-of-Experts routing to choose only the top-1 expert per token, reducing router computation and communication costs while increasing model capacity.',
      note: 'Switch 的 top-1 路由' },
    { id: 'k23', paperId: 'p-rag', section: '2 Methods', page: 3,
      text: 'RAG combines a parametric memory (a pre-trained seq2seq model) with a non-parametric memory (a dense vector index of Wikipedia accessed by a neural retriever).',
      note: 'RAG 双记忆结构 —— 本工具问答模块的理论基础' },
  ];

  /* ==========================================================================
     D. 知识点示范答案（对应需求 1.2 的例题，答案取自真实论文）
     ========================================================================== */
  const answers = [
    {
      match: ['第6作者', '第六作者', '6作者', '哪个公司', '单位', '工作'],
      scope: 'single',
      text:
        '《Attention Is All You Need》的作者按顺序为：① Ashish Vaswani ② Noam Shazeer ③ Niki Parmar ④ Jakob Uszkoreit ⑤ Llion Jones ⑥ Aidan N. Gomez ⑦ Łukasz Kaiser ⑧ Illia Polosukhin。\n\n' +
        '因此第 6 作者是 **Aidan N. Gomez**。论文首页标注其单位为 Google Brain（多伦多大学方向的合作者），与 Vaswani、Shazeer、Parmar、Uszkoreit、Jones 同属 Google Brain / Google Research；Łukasz Kaiser 与 Illia Polosukhin 亦为 Google Brain。\n\n' +
        '⚠️ 该信息来自论文首页作者列表，属于「强证据」，可信度高。',
    },
    {
      match: ['adam', 'β', 'beta', '优化器', '超参数'],
      scope: 'single',
      text:
        '论文 5.3 节 Optimizer 明确给出：Adam 优化器 [20] 的超参数设置为 **β1 = 0.9，β2 = 0.98，ϵ = 10⁻⁹**，并配合 warmup_steps = 4000 的学习率预热策略。\n\n' +
        '学习率公式为：lrate = d_model^(−0.5) · min(step_num^(−0.5), step_num · warmup_steps^(−1.5))。\n\n' +
        '⚠️ 注意：这里 β2 = 0.98 与 Adam 原论文推荐的 0.999 不同，这是 Transformer 的常见改动点，容易记错。',
    },
    {
      match: ['gpu', '型号', 'base模型', '多少个', '训练'],
      scope: 'single',
      text:
        '论文 5.2 节 Hardware and Schedule 说明：模型在**单台机器、8 块 NVIDIA P100 GPU** 上训练。\n\n' +
        '· base 模型：每步约 0.4 秒，共 100,000 步（约 12 小时）\n' +
        '· big 模型：每步 1.0 秒，共 300,000 步（约 3.5 天）\n\n' +
        '所以答案是 **8 块 NVIDIA P100**。',
    },
    {
      match: ['bleu', 'big', '英德', 'english-to-german', 'state-of-the-art', '提升'],
      scope: 'single',
      text:
        '结果汇总（表 2 与 6.1 节）：\n\n' +
        '· **Transformer (big)** 在 WMT 2014 英德任务上达到 **28.4 BLEU**，比此前最佳结果（含集成模型）**提升超过 2.0 BLEU**。\n' +
        '· 在英法任务上达到 **41.8 BLEU**，为当时单模型新的 state-of-the-art，训练成本仅为最优模型的一小部分。\n' +
        '· 对比参照：ByteNet 23.75、ConvS2S 25.16、MoE 26.03、Transformer (base) 27.3（英德）。\n\n' +
        '⚠️ 引用表格数据时请注意：不同版本的论文（v1 与 v7）在个别数值表述上略有差异，建议以你入库的版本为准。',
    },
    {
      match: ['layer normalization', '参考文献', 'references', '完整作者', '年份'],
      scope: 'single',
      text:
        '论文中关于 Layer Normalization 的参考文献为 [1]：\n\n' +
        '> Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E. Hinton. **Layer normalization**. arXiv preprint arXiv:1607.06450, **2016**.\n\n' +
        '该文献已在你上传的 pdf/ 目录中（1607.06450v1.pdf），可直接在文库中打开原文。',
    },
    {
      match: ['bert', '承袭', 'encoder', '丢弃', '对比'],
      scope: 'multi',
      text:
        '**承袭关系**：BERT 直接复用了《Attention Is All You Need》中的 Transformer **Encoder** 结构——多头自注意力 + 逐位置前馈网络 + 残差连接 + LayerNorm，并且是「只用编码器」的多层堆叠（BERT-Base 为 L=12、H=768、A=12）。\n\n' +
        '**BERT 丢弃的部分**：\n' +
        '1. **整个 Decoder 与编码器-解码器注意力**（cross-attention）——BERT 是理解型模型，不做自回归生成。\n' +
        '2. **因果掩码（causal mask）**——原 Transformer 解码器的自注意力是单向的、带掩码的；BERT 换成**双向**注意力，这也是它被称为 "Deep Bidirectional" 的原因。\n' +
        '3. **正弦位置编码**改为可学习的位置嵌入（learnable positional embeddings）。\n' +
        '4. 原论文的训练目标（机器翻译的交叉熵）被替换为 **MLM + NSP** 两个自监督任务。',
    },
    {
      match: ['上下文', 'context window', 'token长度', '递增', 'gpt-1 到 gpt-3', '演化'],
      scope: 'multi',
      text:
        '从 GPT-1 到 GPT-3，最大上下文长度（Context Window）的变化：\n\n' +
        '| 模型 | 参数量 | 上下文 Token 长度 |\n' +
        '| --- | --- | --- |\n' +
        '| GPT-1 | 117M | **512** |\n' +
        '| GPT-2 | 1.5B | **1024** |\n' +
        '| GPT-3 | 175B | **2048** |\n\n' +
        '即每代翻一倍：512 → 1024 → 2048。',
    },
    {
      match: ['ln', 'layer norm', '位置', 'gpt-2 相比', '调整'],
      scope: 'multi',
      text:
        'GPT-2 相对 GPT-1 在 Layer Normalization 位置上做了一个关键调整：\n\n' +
        '· **GPT-1（Post-LN）**：LayerNorm 放在每个子块（自注意力 / 前馈）**之后**，即 x + Sublayer(x) 之后再归一化。\n' +
        '· **GPT-2（Pre-LN）**：把 LayerNorm 移到每个 Transformer 子块的**最前面**（输入侧），并在最后一个自注意力块之后**额外再加一个 LayerNorm**。\n\n' +
        '**为什么重要**：Pre-LN 让残差通路上不再有归一化层，梯度可以直接回传，因此训练更稳定、对学习率预热（warm-up）的依赖更小，这也是后续大模型普遍采用 Pre-LN 的原因。',
    },
  ];

  /* ==========================================================================
     E. 图谱（引用网络）数据 —— [演示]
     ========================================================================== */
  const graphGroups = [
    { id: 'g-transformer', name: 'Transformer 与大模型架构', count: 20, desc: '一次性上传 20 篇 PDF 后自动构建的局域引用图谱' },
    { id: 'g-vision', name: '视觉与多模态', count: 4, desc: 'ViT / CLIP / LLaVA / GPT-4 分支' },
  ];

  const graphInsights = {
    'g-transformer': {
      foundation: [
        { id: 'p-attention-v7', reason: '被图谱内 7 篇论文直接引用，入度为全场最高，是整个方向的结构性起点。' },
        { id: 'p-gpt3', reason: '入度 3，且是「上下文学习 / 规模化」这条支线的共同祖先。' },
        { id: 'p-bert', reason: '入度 2，是「双向编码器」支线的源头。' },
      ],
      peripheral: [
        { id: 'p-ot', reason: '出度 1、入度 0，只单向引用主干论文，属于边缘衍生方向。' },
        { id: 'p-dpo2', reason: '解析置信度低（0.72），且不在任何引用闭环中，建议人工复核后决定是否保留。' },
        { id: 'p-cc', reason: '综述类节点，引用了 312 篇但几乎不被图谱内论文引用，属于「文献枢纽」而非核心贡献。' },
      ],
      summary:
        '本图谱覆盖 20 篇论文、41 条引用边。可以清晰看到三条演化主线：\n' +
        '① **主干**：Attention (2017) → BERT / GPT-1 → GPT-2 → GPT-3 → InstructGPT → DPO / Llama 2，主线围绕「架构 → 规模化 → 对齐」推进；\n' +
        '② **效率支线**：Transformer-XL / Reformer / FlashAttention / Switch / Mixtral / DeepSeek-V2，围绕长上下文、稀疏化与显存优化展开；\n' +
        '③ **视觉迁移支线**：ViT / CLIP → LLaVA / GPT-4，把注意力架构迁移到图像与多模态。\n\n' +
        '**关键转折点**：GPT-3（2020）之后，社区重心从「改架构」明显转向「扩大规模 + 用好数据」；到 2022—2023 年，进一步转向「对齐与推理」（InstructGPT、DPO、DeepSeek-R1）。',
      futureWork: [
        { title: '长上下文的「有效利用」而非「窗口长度」', reason: 'Transformer-XL → Reformer → FlashAttention 这条线在解决「装得下」，但近两年工作指出模型对中段信息利用率仍低，存在明确空档。', risk: '低', related: ['p-transformer-xl', 'p-flash', 'p-reformer'] },
        { title: '隐空间推理与可验证奖励的结合', reason: 'Coconut 尝试连续隐空间推理，DeepSeek-R1 证明可验证奖励下的 RL 有效，但两者尚未系统结合。', risk: '中', related: ['p-coconut', 'p-r1'] },
        { title: 'MoE 路由的可解释性与稳定性', reason: 'Switch / Mixtral / DeepSeek-V2 都在提升 MoE 效率，但专家塌缩与路由不稳定的理论解释仍不充分；注意：单纯「更大 MoE」已被多篇 2024 论文尝试过。', risk: '中', related: ['p-switch', 'p-mixtral', 'p-deepseekv2'] },
        { title: '对齐方法的统一理论', reason: 'DPO 之后出现大量 RLHF 变体，但缺乏统一解释；图谱中 p-dpo2 正尝试给出统一理论，可作为起点而非重复。', risk: '高', related: ['p-dpo', 'p-dpo2', 'p-instructgpt'] },
      ],
    },
  };

  /* ==========================================================================
     F. 新论文推荐流 —— [演示]
     ========================================================================== */
  const recommendations = [
    {
      id: 'rec1', title: 'Native Sparse Attention: Hardware-Aligned and Natively Trainable Sparse Attention',
      authors: ['Jingyang Yuan', 'Huazuo Gao', 'Damai Dai'], venue: 'arXiv preprint', arxiv: '2502.11089',
      date: day(1), kind: 'daily', hasCode: true, codeUrl: 'https://github.com/deepseek-ai/NSA',
      score: 0.94, reason: '在《Attention Is All You Need》的多头注意力基础上，提出硬件对齐的稀疏注意力，属于你库中 FlashAttention / Reformer 这条「效率支线」的直接延伸；在 64k 长上下文基准上解码速度提升明显。',
      tags: ['长上下文', '稀疏注意力', '效率'], cited: 38,
    },
    {
      id: 'rec2', title: 'DeepSeekMath-V2: Towards Self-Verifiable Mathematical Reasoning',
      authors: ['DeepSeek-AI'], venue: 'arXiv preprint', arxiv: '2504.02819',
      date: day(2), kind: 'daily', hasCode: true, codeUrl: 'https://github.com/deepseek-ai/DeepSeek-Math',
      score: 0.91, reason: '与库中 DeepSeek-R1 同源的后续工作，把「可验证奖励」从代码扩展到数学证明，可直接续上你 1.5 节「未来工作探索」中记录的隐空间推理方向。',
      tags: ['推理', 'RL', '数学'], cited: 21,
    },
    {
      id: 'rec3', title: 'Mixture-of-Depths: Dynamically Allocating Compute in Transformer-Based Language Models',
      authors: ['David Raposo', 'Sam Ritter', 'Blake Richards'], venue: 'arXiv preprint', arxiv: '2404.02258',
      date: day(3), kind: 'daily', hasCode: false, codeUrl: null,
      score: 0.86, reason: '与库中 Switch Transformer 的「token 路由到专家」互补：改为「token 路由到层」，是 MoE 思想的另一种切分方式，与你的 Mixtral / DeepSeek-V2 收藏高度相关。',
      tags: ['MoE', '计算分配'], cited: 64,
    },
    {
      id: 'rec4', title: 'Scaling Laws for Precision',
      authors: ['Tanishq Kumar', 'Zachary Ankner', 'Benjamin Spector'], venue: 'arXiv preprint', arxiv: '2411.04330',
      date: day(4), kind: 'daily', hasCode: true, codeUrl: 'https://github.com/tanishqkumar/scaling-laws-for-precision',
      score: 0.83, reason: '库中 Chinchilla 讨论「参数量 vs token 数」的最优分配，这篇把维度扩展到「数值精度」，对 DeepSeek-V3 的 FP8 训练实践有直接解释力。',
      tags: ['Scaling Laws', '量化'], cited: 47,
    },
    {
      id: 'rec5', title: 'Retrieval-Augmented Generation with Knowledge Graphs for Research Literature QA',
      authors: ['Anonymous'], venue: 'arXiv preprint', arxiv: '2412.09921',
      date: day(5), kind: 'weekly', hasCode: true, codeUrl: 'https://github.com/example/kg-rag',
      score: 0.79, reason: '与你库中 RAG / DPR 直接同题，且把知识图谱引入检索——正好契合本工具「引用网络 + 问答」的产品形态，可作为检索增强模块的改进参考。',
      tags: ['RAG', '知识图谱'], cited: 12,
    },
    {
      id: 'rec6', title: 'A Survey on Multimodal Large Language Models in Scientific Discovery',
      authors: ['Anonymous'], venue: 'arXiv preprint', arxiv: '2501.04219',
      date: day(6), kind: 'weekly', hasCode: false, codeUrl: null,
      score: 0.74, reason: '综述类，与你库中 GLM-130B、LLaVA 相关；因为你库里综述类节点较多（p-cc），这类文章推荐优先级下调。',
      tags: ['综述', '多模态'], cited: 8,
    },
    {
      id: 'rec7', title: 'Efficient Fine-Tuning of Quantized Models via Second-Order Information',
      authors: ['Anonymous'], venue: 'arXiv preprint', arxiv: '2411.17762',
      date: day(7), kind: 'weekly', hasCode: true, codeUrl: 'https://github.com/example/q2lora',
      score: 0.88, reason: '在库中 QLoRA / LoRA 的基础上引入二阶信息来指导量化误差补偿；有代码、易复现，因此推荐排序上浮。',
      tags: ['PEFT', '量化'], cited: 19,
    },
    {
      id: 'rec8', title: 'Positional Encoding is All You Need? Revisiting Length Extrapolation',
      authors: ['Anonymous'], venue: 'arXiv preprint', arxiv: '2503.01188',
      date: day(8), kind: 'weekly', hasCode: false, codeUrl: null,
      score: 0.71, reason: '直接挑战库中 Attention 论文的正弦位置编码设计，属于「反主流」但相关性高的方向；因无代码，复现成本高，推荐度略降。',
      tags: ['位置编码', '长度外推'], cited: 5,
    },
  ];

  /* ==========================================================================
     G. 写作助手素材
     ========================================================================== */
  const writerPresets = {
    outlineSections: ['Abstract', '1 Introduction', '2 Related Work', '3 Method', '4 Experiments', '5 Conclusion', 'References'],
    mermaid: `flowchart TD
    A[研究问题定义] --> B[文献调研<br/>RAG 检索 + 引用图谱]
    B --> C[方法设计]
    C --> C1[模块一：检索增强]
    C --> C2[模块二：多智能体协作]
    C1 --> D[实验设计]
    C2 --> D
    D --> D1[数据集与基线]
    D --> D2[消融实验]
    D1 --> E[结果分析]
    D2 --> E
    E --> F[结论与未来工作]`,
    tikz: `\\begin{tikzpicture}[node distance=1.4cm, every node/.style={font=\\small}]
  \\node[draw, rounded corners, fill=blue!8] (q) {研究问题};
  \\node[draw, rounded corners, fill=blue!8, below=of q] (lit) {文献与引用图谱};
  \\node[draw, rounded corners, fill=green!10, below=of lit] (method) {方法设计};
  \\node[draw, rounded corners, fill=orange!12, below=of method] (exp) {实验与消融};
  \\node[draw, rounded corners, fill=purple!10, below=of exp] (concl) {结论};
  \\draw[->] (q) -- (lit);
  \\draw[->] (lit) -- (method);
  \\draw[->] (method) -- (exp);
  \\draw[->] (exp) -- (concl);
\\end{tikzpicture}`,
    graphviz: `digraph paper {
  rankdir=TB;
  node [shape=box, style="rounded,filled", fillcolor="#eef2ff", fontname="Helvetica"];
  q       [label="研究问题"];
  lit     [label="文献调研\\n(RAG + 引文图谱)"];
  method  [label="方法设计"];
  exp     [label="实验与消融"];
  concl   [label="结论与未来工作"];
  q -> lit -> method -> exp -> concl;
  method -> method [label="迭代"];`,
    csv: {
      name: 'experiment_results.csv',
      head: ['Model', 'BLEU (EN-DE)', 'Params (M)', 'Latency (ms)', 'GPU Hours'],
      rows: [
        ['Baseline-LSTM', '21.4', '213', '128', '96'],
        ['ConvS2S', '25.2', '216', '142', '168'],
        ['Transformer-base', '27.3', '65', '98', '48'],
        ['Ours (w/ RAG)', '28.9', '71', '112', '52'],
        ['Ours (full)', '29.6', '74', '118', '56'],
      ],
    },
    figureCaption:
      '图 4 本方法与各基线在 WMT 2014 英德翻译任务上的性能对比。横轴为模型，柱状高度为 BLEU 分数，折线为推理延迟（右轴）。' +
      '可以看出：本方法在参数量仅为 ConvS2S 的 1/3 的情况下，BLEU 提升 4.4 分；相比 Transformer-base 基线，' +
      '引入检索增强后 BLEU 从 27.3 提升到 28.9（+1.6），完整版本进一步提升到 29.6（+2.3），而推理延迟仅增加 20 ms，' +
      '表明检索增强带来的质量收益显著大于其计算开销。',
  };

  /* ==========================================================================
     导出
     ========================================================================== */
  App.data = {
    NOW, papers, readerDoc, knowledge, answers, graphGroups, graphInsights,
    recommendations, writerPresets,

    /** 从上传项构造一条论文记录（真实实现由后端返回元数据） */
    paperFromUpload(name, up) {
      const seeded = App.util.seeded(name);
      const base = name.replace(/\.pdf$/i, '');
      const guess = App.data.papers.find((p) => p.file.toLowerCase() === name.toLowerCase());
      if (guess) return Object.assign({}, guess, { id: App.util.uid('p'), addedAt: new Date(NOW).toISOString() });
      const n = up || {};
      const isScan = /img|scan|扫描/i.test(name);
      return {
        id: App.util.uid('p'),
        file: name,
        title: base,
        titleZh: null,
        authors: ['（待确认）'],
        year: 2024,
        version: (name.match(/v(\d+)/) || [, '1'])[1],
        venue: 'arXiv preprint',
        arxiv: base,
        pages: n.pages || 10,
        sizeBytes: n.size || 0,
        quality: isScan ? 0.85 : 0.9 + seeded() * 0.08,
        scanned: isScan,
        starred: false,
        addedAt: new Date(NOW).toISOString(),
        parsedAt: new Date(NOW).toISOString(),
        abstract: '[自动解析] ' + (isScan
          ? '该文件无文本层，已通过 OCR + 版面分析还原内容。'
          : '已完成版面分析与结构化抽取：标题、作者、摘要、章节层级、公式、表格、图表、参考文献均已入库。'),
        abstractZh: '[自动解析] 本文提出一条完整的解析流水线：该文件的结构已入库，可在阅读器中查看中英对照结果。',
        keywords: [],
        cites: 0, refs: Math.round(20 + seeded() * 60),
        sections: Math.round(5 + seeded() * 5),
        figures: Math.round(seeded() * 10),
        tables: Math.round(seeded() * 8),
        formulas: Math.round(seeded() * 30),
        citesIds: [], citedByIds: [], core: 'unknown',
      };
    },

    /** 获取某论文的正文（没有专门正文的论文给出占位提示） */
    getDoc(paperId) {
      return App.data.readerDoc[paperId] || null;
    },

    /** 按 id 取论文 */
    getPaper(id) {
      return App.store.state.papers.find((p) => p.id === id) || null;
    },

    /** 参考文献格式化（作者 + 标题 + 年份） */
    formatAuthors(authors, max) {
      const m = max || 3;
      if (!authors || !authors.length) return '（未知）';
      if (authors.length <= m) return authors.join(', ');
      return authors.slice(0, m).join(', ') + ' 等 ' + authors.length + ' 人';
    },
  };
})(window.App);
