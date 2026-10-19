"""RRF（Reciprocal Rank Fusion）融合。

问题：BM25 分数无上界（可能 0.5 也可能 25），
向量余弦相似度固定在 [-1, 1]，两者量纲不可比，无法直接相加。

常见错误做法是各自归一化到 [0, 1] 再相加。缺点很明显：
归一化会把「分数是否密集」这一信息抹掉——某次查询的 3.0~2.9 分
归一化后占满 0~1，另一次的 30~1 分也一样占满 0~1，
两种完全不同的分布变得无法区分。

RRF 的做法是彻底放弃分数，只用名次：
    RRF(d) = Σ 1 / (k + rank_r(d))
优点是与任何打分体系都兼容，不需要任何分数归一化。
k 取 60 是原论文的经典取值。
"""
from __future__ import annotations

RRF_K = 60


def rrf_fuse(
    rankings: dict[str, list[str]],
    k: int = RRF_K,
    top_k: int | None = None,
) -> list[tuple[str, float, dict[str, int]]]:
    """融合多路排序结果。

    参数：
        rankings: {"bm25": [id1, id2, ...], "vector": [id1, id3, ...]}
                  每个列表按相关度从高到低排列，名次从 1 开始
        k:        平滑常数，越大则名次的影响越平缓
        top_k:    只返回前多少个

    返回：
        [(id, rrf_score, {"bm25": 1, "vector": 3}), ...]  按分数降序

    注意：只出现在一路结果中的文档同样参与计算，
    这正是「单路极端结果被另一路制衡」的体现。
    """
    if k <= 0:
        raise ValueError("k 必须为正数")

    scores: dict[str, float] = {}
    ranks: dict[str, dict[str, int]] = {}

    for source, ranked_ids in rankings.items():
        for position, doc_id in enumerate(ranked_ids, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + position)
            ranks.setdefault(doc_id, {})[source] = position

    fused = sorted(scores.items(), key=lambda pair: -pair[1])
    if top_k is not None:
        fused = fused[:max(0, top_k)]

    return [(doc_id, round(score, 6), ranks[doc_id]) for doc_id, score in fused]
