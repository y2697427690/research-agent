"""论文去重与版本识别。

去重的判断依据是「内容指纹 + 文献标识」，而不是文件名：
同一篇论文换个文件名仍应被识别为重复，不同版本则提示用户选择保留哪一份。

本模块只做纯计算，不涉及数据库与 IO，便于单元测试。
"""
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------- 常量与正则

# 新版 arXiv 编号：YYMM.NNNNN（4~5 位序号），可带 vN
_ARXIV_NEW = re.compile(r"(?<!\d)(\d{4}\.\d{4,5})(v\d+)?(?!\d)")

# 旧版 arXiv 编号：archive.subject/YYMMNNN，例如 math.GT/0309136
# 文件名里 "/" 常被写成 "_"，两种都要能识别
_ARXIV_OLD = re.compile(
    r"(?<![a-z0-9])([a-z][a-z-]*(?:\.[A-Za-z]{2})?[/_]\d{7})(v\d+)?(?!\d)"
)

# 显式带 arxiv 字样的写法，用于提高置信度
_ARXIV_LABEL = re.compile(r"arxiv[:\-_ ]*", re.IGNORECASE)

# 版本标记紧跟在编号之后，允许 _ - 空格 分隔，例如 "1706.03762_v3"
_VERSION_AFTER = re.compile(r"^[\s_\-]*v(\d+)(?=[\s_\-.()]|$)", re.IGNORECASE)

# 像 arXiv 旧版 archive 前缀：math / math.GT / hep-th / cs.CV
_ARCHIVE_LIKE = re.compile(r"^[a-z][a-z-]*(\.[A-Za-z]{2})?$")

# 扫描件/副本命名特征
_SCAN_MARKERS = (
    "img", "image", "scan", "scanned", "ocr", "photo", "copy", "副本", "扫描",
)

# 用于判定文件名是否带扫描件/副本特征（整词匹配，避免误伤 image_net 之类的正常词）
_SCAN_RE = re.compile(
    r"(?<![a-z])(" + "|".join(_SCAN_MARKERS) + r")(?![a-z])", re.IGNORECASE
)


def is_scan_like(name: str) -> bool:
    """判断文件名是否带扫描件/副本特征，例如 1706.03762v1_img.pdf。"""
    stem = Path(_strip_dir_prefix(name)).stem.lower()
    return bool(_SCAN_RE.search(stem))


def normalize_stem(stem: str) -> str:
    """把文件名主干归一化成「基础名」，用于粗粒度比对。

    去掉：扩展名残留、版本标记、扫描件标记、分隔符差异。
    例如：
        "1706.03762v1"       -> "170603762"
        "arXiv_1706.03762_v7" -> "170603762"
        "1706.03762v1_img"   -> "170603762"
    """
    s = stem.strip().lower()
    # 去掉 arxiv 标签
    s = _ARXIV_LABEL.sub("", s)
    # 去掉版本标记
    s = re.sub(r"v\d+", "", s)
    # 去掉扫描件等标记（按整词匹配，避免误伤正常单词）
    for marker in _SCAN_MARKERS:
        s = re.sub(rf"(?<![a-z]){re.escape(marker)}(?![a-z])", "", s)
    # 去掉所有非字母数字字符（把点、下划线、连字符、空格统一去掉）
    s = re.sub(r"[^a-z0-9]", "", s)
    return s


def extract_arxiv_id(name: str) -> tuple[str | None, int | None]:
    """从文件名中提取 arXiv ID 与版本号。

    返回 (arxiv_id, version)。版本号缺失时返回 None（表示「未标注版本」）。
    例如：
        "1706.03762v7.pdf"        -> ("1706.03762", 7)
        "arXiv_1706.03762.pdf"    -> ("1706.03762", None)
        "math.GT_0309136v2.pdf"   -> ("math.GT/0309136", 2)
        "我的论文.pdf"             -> (None, None)
    """
    raw = _strip_dir_prefix(name)

    for pattern in (_ARXIV_NEW, _ARXIV_OLD):
        m = pattern.search(raw)
        if m:
            arxiv_id = m.group(1).replace("_", "/")
            ver = _parse_version(m.group(2))
            if ver is None:
                ver = _parse_version_from_following(raw, m)
            return arxiv_id, ver

    return None, None


def _strip_dir_prefix(name: str) -> str:
    """去掉目录前缀，只留文件名。

    不能直接用 os.path.basename：Windows 上它不把 "/" 当分隔符，
    而 "math.GT/0309136v2.pdf" 里的 "/" 是旧版 arXiv 标识的一部分，必须保留。
    """
    parts = re.split(r"[\\/]+", name)
    if len(parts) == 1:
        return parts[0]
    # 目录名恰好是 archive 形态、且文件名以数字开头时，"/" 属于标识的一部分
    if _ARCHIVE_LIKE.match(parts[-2]) and parts[-1][:1].isdigit():
        return "/".join(parts[-2:])
    return parts[-1]


def _parse_version(token: str | None) -> int | None:
    """把 "v3" 解析成 3。"""
    if not token:
        return None
    m = re.match(r"v(\d+)", token, re.IGNORECASE)
    return int(m.group(1)) if m else None


def _parse_version_from_following(text: str, m: re.Match) -> int | None:
    """在正则匹配位置【之后】的一小段文本里找版本号。

    限制搜索范围有两个好处：
      1. 支持 "1706.03762_v3.pdf" 这种用下划线分隔的写法
      2. 不会误抓远处无关的 vN（例如目录名里出现的版本标记）
    """
    rest = text[m.end():m.end() + 24]
    vm = _VERSION_AFTER.match(rest)
    return int(vm.group(1)) if vm else None


def sha1_of_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    """分块计算文件的 SHA1（避免把大文件一次性读进内存）。"""
    digest = hashlib.sha1()
    with open(path, "rb") as fh:
        while chunk := fh.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def sha1_of_bytes(data: bytes) -> str:
    """计算字节内容的 SHA1。"""
    return hashlib.sha1(data).hexdigest()


# ---------------------------------------------------------------- 数据结构


@dataclass(frozen=True)
class ExistingPaper:
    """已入库论文的最小信息，用于比对。"""

    paper_id: str
    sha1: str
    file_name: str
    arxiv_id: str | None = None
    size_bytes: int | None = None


@dataclass
class DuplicateVerdict:
    """去重结论。

    kind 取值：
        no_match        没有找到重复
        identical       内容完全相同（同一份文件）
        newer_version   新上传的是更高版本
        older_version   新上传的是更低版本
        likely_duplicate 疑似同一篇（文件名归一化后相同，但内容指纹不同，
                         例如扫描件与原版）
    """

    kind: str
    existing: ExistingPaper | None = None
    reasons: list[str] = field(default_factory=list)

    @property
    def is_duplicate(self) -> bool:
        return self.kind != "no_match"

    def describe(self) -> str:
        """生成给前端显示的中文说明。"""
        if self.existing is None:
            return "未发现重复"
        name = self.existing.file_name
        if self.kind == "identical":
            return f"与已有论文内容完全相同：{name}"
        if self.kind == "newer_version":
            return f"这是 {name} 的更新版本，是否替换？"
        if self.kind == "older_version":
            return f"已有更高版本：{name}，是否仍要导入？"
        if self.kind == "likely_duplicate":
            return f"疑似与已有论文重复（文件名高度相似）：{name}"
        return "未发现重复"


# ---------------------------------------------------------------- 核心比对


def detect_duplicate(
    *,
    sha1: str,
    file_name: str,
    size_bytes: int | None = None,
    arxiv_id: str | None = None,
    existing: list[ExistingPaper],
) -> DuplicateVerdict:
    """在已入库论文中查找新文件是否重复。

    判定优先级（从强到弱）：
        1. 内容指纹 sha1 相同              -> identical
        2. 文件带扫描件特征且基础名相同     -> likely_duplicate
           （必须排在版本比较之前：例如库中已有 v1，再传 v1_img 扫描件，
            若先比版本会得到「版本号无法区分」，丢失了「这是扫描件」的信息）
        3. arXiv ID 相同，比较版本号        -> newer_version / older_version
        4. 文件名归一化后相同              -> likely_duplicate
    """
    if not existing:
        return DuplicateVerdict(kind="no_match")

    # 1) 内容完全相同
    for item in existing:
        if item.sha1 and item.sha1 == sha1:
            return DuplicateVerdict(
                kind="identical",
                existing=item,
                reasons=["内容指纹（SHA1）完全相同"],
            )

    # extract_arxiv_id 返回的是 (id, ver) 元组，必须先解包；
    # 若调用方显式传入了 arxiv_id，则优先使用它，但版本号仍从文件名提取
    parsed_id, parsed_ver = extract_arxiv_id(file_name)
    new_id = arxiv_id or parsed_id
    new_ver = parsed_ver

    # 2) 带扫描件特征的文件：优先按基础文件名匹配
    if is_scan_like(file_name):
        new_key = normalize_stem(Path(file_name).stem)
        if new_key:
            for item in existing:
                if normalize_stem(Path(item.file_name).stem) == new_key:
                    reasons = ["文件名归一化后相同", "文件名含扫描件/副本特征"]
                    if size_bytes and item.size_bytes:
                        reasons.append(
                            f"大小不同（新 {size_bytes} / 已有 {item.size_bytes}），"
                            "可能是扫描件或不同版本"
                        )
                    return DuplicateVerdict(
                        kind="likely_duplicate", existing=item, reasons=reasons
                    )

    # 3) 同一篇论文的不同版本
    if new_id:
        same_id = [
            it for it in existing
            if it.arxiv_id and it.arxiv_id.lower() == new_id.lower()
        ]
        if same_id:
            # 取版本号最大的那条作为比较基准
            def ver_of(item: ExistingPaper) -> int:
                return extract_arxiv_id(item.file_name)[1] or 0

            newest = max(same_id, key=ver_of)
            old_ver = ver_of(newest)
            cur_ver = new_ver or 0

            if cur_ver and old_ver and cur_ver > old_ver:
                return DuplicateVerdict(
                    kind="newer_version",
                    existing=newest,
                    reasons=[f"同一 arXiv 编号 {new_id}",
                             f"新文件版本 v{cur_ver} 高于已有 v{old_ver}"],
                )
            if cur_ver and old_ver and cur_ver < old_ver:
                return DuplicateVerdict(
                    kind="older_version",
                    existing=newest,
                    reasons=[f"同一 arXiv 编号 {new_id}",
                             f"新文件版本 v{cur_ver} 低于已有 v{old_ver}"],
                )
            # 版本号相同或缺失，但 ID 相同
            return DuplicateVerdict(
                kind="likely_duplicate",
                existing=newest,
                reasons=[f"同一 arXiv 编号 {new_id}，版本号无法区分"],
            )

    # 4) 文件名归一化后相同
    new_key = normalize_stem(Path(file_name).stem)
    if new_key:
        for item in existing:
            old_key = normalize_stem(Path(item.file_name).stem)
            if old_key and old_key == new_key:
                reasons = ["文件名归一化后相同"]
                if size_bytes and item.size_bytes:
                    reasons.append(
                        f"大小不同（新 {size_bytes} / 已有 {item.size_bytes}），"
                        "可能是扫描件或不同版本"
                    )
                return DuplicateVerdict(
                    kind="likely_duplicate", existing=item, reasons=reasons
                )

    return DuplicateVerdict(kind="no_match")
