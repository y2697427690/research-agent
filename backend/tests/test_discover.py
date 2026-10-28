"""arXiv 检索 / 入库的纯逻辑测试。

不联网：只测「能不能正确判断」和「失败时的兜底顺序」。
真实下载由线上验证脚本覆盖（它会真的访问 arxiv.org）。
"""
from __future__ import annotations

from app.services.discover import _is_withdrawn, _pdf_candidates


def test_withdrawn_detected_from_summary():
    """arXiv 撤稿的论文会把摘要换成一句说明，必须能识别。

    识别不出来时，用户点「入库」只会得到一次 404 的下载失败。
    """
    summary = (
        "This submission has been withdrawn by arXiv administrators "
        "because it contains fictitious content."
    )
    assert _is_withdrawn(summary, None) is True


def test_withdrawn_detected_from_comment():
    assert _is_withdrawn("Normal abstract.", "Withdrawn by the author") is True


def test_normal_paper_is_not_withdrawn():
    summary = "We prove an uncertainty principle for subsets of R."
    assert _is_withdrawn(summary, "Accepted at NeurIPS 2025") is False


def test_empty_fields_are_not_withdrawn():
    assert _is_withdrawn(None, None) is False
    assert _is_withdrawn("", "") is False


def test_pdf_candidates_try_version_then_bare():
    """带版本号失败时要再试不带版本号的入口（少数旧论文只保留后者）。"""
    assert _pdf_candidates("1706.03762v7") == ["1706.03762v7", "1706.03762"]
    # 已经是裸编号时只有一个候选，不做无意义的重复请求
    assert _pdf_candidates("1706.03762") == ["1706.03762"]


def test_pdf_candidates_strips_spaces():
    assert _pdf_candidates("  2510.09904v2 ") == ["2510.09904v2", "2510.09904"]
