"""技术文档配图生成：分层架构 / 数据流 / 部署拓扑。

为什么用代码画图而不是截图或手绘
------------------------------------------------------------------------
1. 可版本管理——图随代码一起改，评审能看到图的来历；
2. 不会模糊——输出 2 倍像素密度，打印清楚；
3. 一致性——三张图用同一套配色与字体，文档看起来是"一个人做的"。

依赖只用 Pillow（环境自带），不引入 graphing 库：
三张图都是方块 + 箭头，用矩形和线段足够表达。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
IMG = HERE / "img"
IMG.mkdir(exist_ok=True)

S = 2  # 超采样倍数：先按 2 倍画，再缩小，边缘更平滑
FS = 1.35  # 字号系数：图会被压到 15.5cm 宽，原字号打印后偏小，整体放大

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]

# 配色（与文档 CSS 一致）
BLUE = (47, 111, 237)
BLUE_SOFT = (238, 243, 251)
INK = (27, 34, 48)
GREY = (91, 100, 114)
LINE = (185, 194, 208)
GREEN = (30, 142, 62)
GREEN_SOFT = (233, 246, 236)
AMBER = (192, 122, 0)
AMBER_SOFT = (253, 244, 227)
WHITE = (255, 255, 255)


def font(size: int) -> ImageFont.FreeTypeFont:
    px = int(size * FS * S)
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, px)
    return ImageFont.load_default()


def box(draw, xy, text, *, fill=WHITE, outline=LINE, color=INK,
        size=15, radius=10, bold=False, pad=10) -> None:
    """圆角矩形 + 居中文本（支持多行，用 \n 分隔）。"""
    x0, y0, x1, y1 = [v * S for v in xy]
    draw.rounded_rectangle([x0, y0, x1, y1], radius=radius * S,
                           fill=fill, outline=outline, width=max(1, S))
    lines = text.split("\n")
    f = font(size)
    heights = [draw.textbbox((0, 0), ln, font=f)[3] for ln in lines]
    total = sum(heights) + (len(lines) - 1) * 6 * S
    y = (y0 + y1) / 2 - total / 2
    for ln, h in zip(lines, heights):
        w = draw.textbbox((0, 0), ln, font=f)[2]
        draw.text(((x0 + x1) / 2 - w / 2, y), ln, font=f, fill=color)
        y += h + 6 * S


def arrow(draw, p0, p1, *, color=GREY, width=2, head=9) -> None:
    x0, y0 = p0[0] * S, p0[1] * S
    x1, y1 = p1[0] * S, p1[1] * S
    draw.line([x0, y0, x1, y1], fill=color, width=width * S)
    # 箭头三角：按方向画
    if abs(x1 - x0) >= abs(y1 - y0):
        s = 1 if x1 > x0 else -1
        draw.polygon([(x1, y1), (x1 - head * S * s, y1 - head * S // 2),
                      (x1 - head * S * s, y1 + head * S // 2)], fill=color)
    else:
        s = 1 if y1 > y0 else -1
        draw.polygon([(x1, y1), (x1 - head * S // 2, y1 - head * S * s),
                      (x1 + head * S // 2, y1 - head * S * s)], fill=color)


def label(draw, xy, text, *, size=13, color=GREY, anchor="la") -> None:
    draw.text((xy[0] * S, xy[1] * S), text, font=font(size), fill=color, anchor=anchor)


def save(img: Image.Image, name: str) -> None:
    w, h = img.size
    img = img.resize((w // S, h // S), Image.LANCZOS)
    path = IMG / name
    img.save(path, optimize=True)
    print(f"  {name}  {img.width}x{img.height}")


# ---------------------------------------------------------------- 图 3-1

def fig_layers() -> None:
    W, H = 1600, 900
    img = Image.new("RGB", (W * S, H * S), WHITE)
    d = ImageDraw.Draw(img)

    label(d, (40, 34), "图 3-1  分层架构与依赖方向（箭头只向下，禁止反向依赖）", size=17, color=INK)

    layers = [
        ("接入层", "FastAPI 路由 / StaticFiles / CORS / 统一异常处理", BLUE_SOFT, BLUE),
        ("契约层", "Pydantic 模型：请求校验、响应序列化、OpenAPI 生成", AMBER_SOFT, AMBER),
        ("业务层", "解析 · 分块 · 去重 · 检索 · RAG · 图谱 · 翻译（纯 Python，无 FastAPI 类型）", GREEN_SOFT, GREEN),
        ("数据层", "SQLAlchemy 异步模型 + SQLite 文件 + 上传目录", BLUE_SOFT, BLUE),
    ]
    top = 100
    for i, (name, desc, fill, edge) in enumerate(layers):
        y0 = top + i * 170
        box(d, (60, y0, 1450, y0 + 120), "", fill=fill, outline=edge, radius=12)
        box(d, (80, y0 + 18, 320, y0 + 102), name, fill=WHITE, outline=edge, size=19, bold=True)
        label(d, (350, y0 + 40), desc, size=15, color=INK)
        label(d, (350, y0 + 74), [
            "职责：参数校验、路由分发、静态资源",
            "职责：定义数据形状，业务层与接口层解耦",
            "职责：所有业务逻辑，可脱离 HTTP 单独测试",
            "职责：ORM 映射与持久化",
        ][i], size=13, color=GREY)
        if i < len(layers) - 1:
            arrow(d, (755, y0 + 122), (755, y0 + 166), color=GREY, width=2)

    label(d, (1480, 176), "依赖", size=12, color=GREY)
    label(d, (1480, 200), "↓", size=20, color=BLUE)
    box(d, (60, 800, 1450, 866),
        "约束：业务层不得 import FastAPI；接口层不得直接写 SQL；跨层调用只能相邻向下",
        fill=WHITE, outline=LINE, size=14, color=GREY)
    save(img, "fig3-1-layers.png")


# ---------------------------------------------------------------- 图 3-2

def fig_flow() -> None:
    W, H = 1600, 780
    img = Image.new("RGB", (W * S, H * S), WHITE)
    d = ImageDraw.Draw(img)
    label(d, (40, 26), "图 3-2  一次问答的完整数据流（含三道防幻觉闸门）", size=18, color=INK)

    steps = [
        ("① 提问", "POST /qa\n问题 + 可选论文范围"),
        ("② 范围判定", "是否锁定单篇\n是否需要扩展"),
        ("③ 混合检索", "BM25 + 向量\nRRF 融合"),
        ("④ 片段拼装", "首页块 + 参考文献\n按论文配额裁剪"),
        ("⑤ 生成", "DeepSeek\ntemperature = 0"),
        ("⑥ 校验", "引用编号合法性\n拒答判定"),
        ("⑦ 输出", "SSE 逐段推送\n附带原文片段"),
    ]
    gap = 20
    bw = (1520 - gap * (len(steps) - 1)) // len(steps)
    for i, (title, sub) in enumerate(steps):
        x0 = 40 + i * (bw + gap)
        fill = GREEN_SOFT if i in (2, 5) else WHITE
        edge = GREEN if i in (2, 5) else LINE
        box(d, (x0, 74, x0 + bw, 234), "", fill=fill, outline=edge)
        box(d, (x0, 84, x0 + bw, 132), title, fill=fill, outline=edge, size=17, bold=True)
        label(d, (x0 + 14, 150), sub.split("\n")[0], size=14, color=INK)
        if "\n" in sub:
            label(d, (x0 + 14, 182), sub.split("\n")[1], size=14, color=INK)
        if i < len(steps) - 1:
            arrow(d, (x0 + bw + 2, 154), (x0 + bw + gap - 2, 154), width=2)

    # 三道闸门：纵向排列，左侧标序号
    label(d, (40, 262), "三道闸门都在服务端执行 —— 模型负责生成，服务端负责把关", size=16, color=AMBER)
    gates = [
        "闸门 1 检索层：检索无命中 → 直接拒答，不调用模型，杜绝「凭空编造」",
        "闸门 2 提示层：提示词要求每个结论都必须带 [n]，没有编号即视为无依据",
        "闸门 3 服务端：校验编号是否越界；越界标记丢弃、答案中删除并记录告警",
    ]
    for i, text in enumerate(gates):
        y = 312 + i * 96
        box(d, (110, y, 1520, y + 68), text, fill=AMBER_SOFT, outline=AMBER, size=16)
        box(d, (44, y + 9, 94, y + 59), str(i + 1), fill=AMBER, outline=AMBER, size=20, color=WHITE)

    box(d, (110, 632, 1520, 700),
        "三层叠加的效果：宁可说「资料中没有」，也不给出无法溯源的结论",
        fill=WHITE, outline=LINE, size=16, color=GREY)
    save(img, "fig3-2-flow.png")


# ---------------------------------------------------------------- 图 3-3

def fig_deploy() -> None:
    W, H = 1600, 780
    img = Image.new("RGB", (W * S, H * S), WHITE)
    d = ImageDraw.Draw(img)
    label(d, (40, 30), "图 3-3  部署拓扑（阿里云 ECS 单机 + systemd，无 nginx）", size=17, color=INK)

    box(d, (60, 110, 420, 300), "浏览器\n（零依赖前端）", fill=BLUE_SOFT, outline=BLUE, size=18, bold=True)
    label(d, (60, 320), "同源请求：", size=13, color=GREY)
    label(d, (60, 344), "location.origin + /api/v1", size=13, color=GREY)

    box(d, (620, 90, 1500, 560), "", fill=WHITE, outline=BLUE, radius=14)
    label(d, (640, 100), "阿里云 ECS · systemd 托管 · 单进程 uvicorn :8000", size=15, color=BLUE)

    box(d, (660, 150, 1050, 250), "StaticFiles\n前端静态资源（最后注册）", fill=GREEN_SOFT, outline=GREEN, size=15)
    box(d, (1080, 150, 1460, 250), "FastAPI 路由\n/api/v1（17 个接口）", fill=GREEN_SOFT, outline=GREEN, size=15)
    box(d, (660, 290, 1460, 380), "业务层 services（检索 / RAG / 解析 / 图谱 / 翻译）",
        fill=AMBER_SOFT, outline=AMBER, size=15)
    box(d, (660, 420, 1050, 520), "SQLite 文件\nbackend/data/app.db", fill=BLUE_SOFT, outline=BLUE, size=15)
    box(d, (1080, 420, 1460, 520), "上传目录\nbackend/data/uploads/", fill=BLUE_SOFT, outline=BLUE, size=15)

    arrow(d, (424, 205), (614, 205), width=2)
    label(d, (430, 176), "HTTP / SSE", size=13, color=GREY)

    box(d, (60, 610, 470, 700), "DeepSeek API\n对话生成", fill=WHITE, outline=LINE, size=15)
    box(d, (540, 610, 950, 700), "DashScope\n向量嵌入", fill=WHITE, outline=LINE, size=15)
    box(d, (1020, 610, 1500, 700), "arXiv API\n论文检索与下载", fill=WHITE, outline=LINE, size=15)
    for x in (265, 745, 1260):
        arrow(d, (x, 606), (x, 564), width=2, color=GREY)
    label(d, (60, 726), "外部依赖：三者任一不可用都会触发降级（见 3.4），不会让整个服务不可用", size=13, color=GREY)
    save(img, "fig3-3-deploy.png")


if __name__ == "__main__":
    fig_layers()
    fig_flow()
    fig_deploy()
    print("  配图已生成到 img/")
