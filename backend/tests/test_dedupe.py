"""
    dedupe 模板的单元测试。

    重点覆盖比赛官方的测试用例：
        1706.03762v1.pdf vs 1706.03762v7.pdf 去重
"""

from pathlib import Path

import pytest

from app.services.dedupe import (
    ExistingPaper,
    detect_duplicate,
    extract_arxiv_id,
    normalize_stem,
    sha1_of_bytes,
)

SAME = "a" * 40
OTHER = "b" * 40

#------------------------------------------  arXiv ID 提取

@pytest.mark.parametrize(
    ("file_name","want_id","want_ver"),
    [
        # 测试官方的测试用例
        ("1706.03762v1.pdf", "1706.03762", 1),
        ("1706.03762v7.pdf", "1706.03762", 7),

        # 常见变体写法
        ("arXiv_1706.03762v7.pdf", "1706.03762", 7),
        ("arXiv:1706.03762v7.pdf", "1706.03762", 7),
        ("arxiv-1706.03762.pdf", "1706.03762", None),
        ("1706.03762.pdf", "1706.03762", None),
        ("1706.03762_v3.pdf", "1706.03762", 3),
        ("1706.03762 v4.pdf", "1706.03762", 4),
        ("arXiv-1706.03762-v2.pdf", "1706.03762", 2),
        ("1706.03762v1_img.pdf", "1706.03762", 1),

        # 旧版编号：斜杠与下划线两种写法都要识别
        ("math.GT_0309136v2.pdf", "math.GT/0309136", 2),
        ("math.GT/0309136v2.pdf", "math.GT/0309136", 2),
        ("math_0309136v1.pdf", "math/0309136", 1),
        ("hep-th_9901001.pdf", "hep-th/9901001", None),

        # 不是 arXiv 的文件
        ("我的论文.pdf", None, None),
        ("report_2024.pdf", None, None),
        ("cs.CV_2024_12345.pdf", None, None),
        ("/abs/path/to/1706.03762v5.pdf", "1706.03762", 5),
        (r"D:\papers\1706.03762v3.pdf", "1706.03762", 3),
        # 目录名像 archive，但文件名不是数字开头 -> 只取文件名，不应提取出 ID
        ("math/papers/我的论文.pdf", None, None),
    ],
)

def test_extract_arxiv_id(file_name, want_id, want_ver):
    assert extract_arxiv_id(file_name) == (
        want_id,
        want_ver,
    )

def test_exrtact_does_not_match_random_numbers():
    assert extract_arxiv_id("2024.pdf") == (None, None)
    assert extract_arxiv_id("1234.pdf") == (None, None)

#-------------------------------------------------------------- 名称归一化

@pytest.mark.parametrize(
    ("stem","expected"),
    [
        ("1706.03762v1", "170603762"),
        ("arXiv_1706.03762_v7", "170603762"),
        ("1706.03762v1_img", "170603762"),
        ("170603762", "170603762"),
    ],
)
def test_normalize_stem(stem, expected):
    assert normalize_stem(stem) == expected

# ---------------------------------------------------------------- SHA1

def test_sha1_of_bytes_matches_hashlib():
    import hashlib
    assert sha1_of_bytes(b"hello") == hashlib.sha1(b"hello").hexdigest()

# ---------------------------------------------------------------- 去重判定

def test_no_match_when_library_empty():
    v= detect_duplicate(sha1 = SAME,file_name = "1706.03762v1.pdf",existing = [])
    assert v.kind == "no_match"
    assert not v.is_duplicate

def test_identical_when_sha1_matches():
    lib = [ExistingPaper("p1",SAME,"1706.03762v1.pdf","1706.03762")]
    v= detect_duplicate(sha1 = SAME,file_name = "ysd.pdf",existing = lib)
    assert v.kind == "identical"
    assert v.existing.paper_id == "p1"

def test_official_case_v1_first_then_v7():
    """官方用例：先传 v1，再传 v7 -> 应识别为更新版本"""
    lib = [ExistingPaper("p1", SAME, "1706.03762v1.pdf", "1706.03762")]
    v = detect_duplicate(
        sha1=OTHER,
        file_name="1706.03762v7.pdf",
        arxiv_id="1706.03762",
        existing=lib,
    )
    assert v.kind == "newer_version"
    assert "v7" in v.describe() or "更新" in v.describe()

def test_official_case_v7_first_then_v1():
    """官方用例反例：先传v7，再传v1 -> 应识别为旧版本"""
    lib =[ExistingPaper("p1",OTHER,"1706.03762v7.pdf","1706.03762")]
    v = detect_duplicate(
        sha1 = SAME,
        file_name = "1706.03762v1.pdf",
        arxiv_id = "1706.03762",
        existing = lib,
    )
    assert v.kind == "older_version"
    assert "更高版本" in v.describe()

def test_scanned_copy_detected_by_name():
    """扫描件与原版：sha1 不同、版本号相同，应通过文件名识别为扫描件。

    这是本项目的关键场景：1706.03762v1_img.pdf（扫描件，无文本层）
    与 1706.03762v1.pdf（原版）内容指纹不同，但显然是同一篇论文。
    """
    lib = [ExistingPaper("p1", SAME, "1706.03762v1.pdf", "1706.03762", 2097152)]
    v = detect_duplicate(
        sha1=OTHER,
        file_name="1706.03762v1_img.pdf",
        size_bytes=4718592,
        existing=lib,
    )
    assert v.kind == "likely_duplicate"
    assert any("扫描件" in r for r in v.reasons)
    assert v.existing.paper_id == "p1"

def test_different_papers_no_match():
    lib = [ExistingPaper("p1",SAME,"1706.03762v1.pdf","1706.03762")]
    v= detect_duplicate(sha1 = OTHER,file_name = "2301.00001v1pdf",existing = lib)
    assert v.kind == "no_match"

def test_same_id_without_version_is_likely_duplicate():
    """库里同时拥有v1和v5时 应该与v5比较"""
    lib = [
        ExistingPaper("p1",SAME,"1706.03762v1.pdf","1706.03762"),
        ExistingPaper("p2",OTHER,"1706.03762v5.pdf","1706.03762"),
        ExistingPaper("p3","c",40, "2301.00001v1.pdf", "2301.00001"),
    ]
    v = detect_duplicate(
        sha1 = "d" * 40,file_name ="1706.03762v3.pdf",
        arxiv_id = "1706.03762",existing = lib,

    )
    assert v.kind == "older_version"
    assert v.existing.paper_id == "p2"  #基准应是v5  不是v1

def test_verdict_describe_is_chinese_and_readable():
    lib = [ExistingPaper("p1",SAME,"1706.03762v1.pdf","1706.03762")]
    v= detect_duplicate(sha1 = SAME,file_name = "x.pdf",existing = lib)
    
    assert isinstance(v.describe(), str)
    assert "1706.03762" in v.describe()



