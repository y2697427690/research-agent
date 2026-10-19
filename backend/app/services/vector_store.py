"""向量存储与相似度检索。

为什么不用 FAISS / Qdrant：
本项目规模为「数十篇论文、万级分块」。以 2 万块 × 1536 维为例，
向量矩阵约 120 MB，一次余弦检索是一次矩阵乘法（约 3000 万次乘加），
numpy 实测十几毫秒。引入向量数据库带来的额外服务依赖与部署复杂度，
在这个规模下收益不明显。
当分块数达到十万级时再迁移到 FAISS，本模块的对外接口无需改动。

为什么预先归一化：
余弦相似度 = 点积 / 两个长度。如果建索引时就把每行归一化为单位长度，
检索时就退化成一次纯点积，省掉每次查询的除法与开方。
"""
from __future__ import annotations

import numpy as np

from app.services.bm25 import IndexedChunk


def pack_vectors(vectors: list[list[float]]) -> bytes:
    """把一批向量打包成 float32 字节串，便于存入数据库。"""
    if not vectors:
        return b""
    arr = np.asarray(vectors, dtype=np.float32)
    return arr.tobytes()


def unpack_vectors(blob: bytes, dim: int) -> np.ndarray:
    """把字节串还原为 (n, dim) 的矩阵。"""
    if not blob:
        return np.zeros((0, dim), dtype=np.float32)
    arr = np.frombuffer(blob, dtype=np.float32)
    if arr.size % dim != 0:
        raise ValueError(
            f"向量字节数与维度不匹配：{arr.size} 个 float，维度 {dim}"
        )
    return arr.reshape(-1, dim)


def normalize_rows(matrix: np.ndarray) -> np.ndarray:
    """按行做 L2 归一化。

    长度接近 0 的行（例如全零向量）保持为 0，避免除零。
    """
    if matrix.size == 0:
        return matrix
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms < 1e-12] = 1.0
    return matrix / norms


class VectorIndex:
    """内存中的向量索引，支持余弦相似度检索。"""

    def __init__(self) -> None:
        self.chunks: list[IndexedChunk] = []
        # 已归一化的 (n, dim) 矩阵；建好后余弦相似度即一次点积
        self._matrix: np.ndarray | None = None

    def __len__(self) -> int:
        return len(self.chunks)

    @property
    def dim(self) -> int:
        return 0 if self._matrix is None else int(self._matrix.shape[1])

    def build(self, chunks: list[IndexedChunk], matrix: np.ndarray) -> None:
        """用给定分块与向量重建索引。矩阵行数必须与分块数一致。"""
        if matrix.shape[0] != len(chunks):
            raise ValueError(
                f"向量行数 {matrix.shape[0]} 与分块数 {len(chunks)} 不一致"
            )
        self.chunks = list(chunks)
        self._matrix = normalize_rows(np.asarray(matrix, dtype=np.float32))

    def search(
        self, query: list[float], top_k: int = 10, min_score: float = 0.0
    ) -> list[tuple[int, float]]:
        """检索，返回按相似度降序的 (doc_id, score)。"""
        if self._matrix is None or not self.chunks or top_k <= 0:
            return []

        q = np.asarray(query, dtype=np.float32)
        if q.size != self.dim:
            raise ValueError(f"查询维度 {q.size} 与索引维度 {self.dim} 不一致")
        norm = float(np.linalg.norm(q))
        if norm < 1e-12:
            return []
        q = q / norm

        scores = self._matrix @ q        # 归一化后点积即余弦相似度
        # argpartition 只取出前 top_k 个，比全排序快（O(n) 而非 O(n log n)）
        k = min(top_k, scores.size)
        candidates = np.argpartition(-scores, k - 1)[:k]
        candidates = candidates[np.argsort(-scores[candidates])]

        return [
            (int(i), float(scores[i]))
            for i in candidates
            if float(scores[i]) > min_score
        ]
