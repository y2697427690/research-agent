"""把界面截图裁到"内容区"，去掉侧栏与空白，让文档里的图更清楚。

为什么要裁：整页截图（1900x1100）压到 14.2cm 宽后，字高只剩 4pt 左右，
在 PDF 里基本不可读；而且左侧栏与大片留白占了画面一半。
裁掉它们后同样的显示宽度，内容放大约 1.6 倍。
"""
from pathlib import Path

from PIL import Image

IMG = Path(r"D:\Desktop\科研小助手-web\docs\tech-report\img")

# 每张图的裁剪框：(left, top, right, bottom)，None 表示不限
CROPS = {
    # 问答页：去掉左侧「问答范围/RAG 参数/会话」侧栏，以及下方大片空白
    "shot-qa.png": (232, 20, 1935, 640),
    # 中英对照：只去掉顶部工具条，保留左右两栏（宽度就是内容）
    "shot-bilingual.png": (0, 46, 2015, 1132),
    # 图谱：裁到节点分布区域，去掉四周空白
    "shot-graph.png": (330, 130, 1090, 810),
}


def main() -> None:
    for name, box in CROPS.items():
        path = IMG / name
        if not path.exists():
            print(f"  跳过（不存在）: {name}")
            continue
        backup = IMG / (name.replace(".png", "-原图.png"))
        if not backup.exists():
            backup.write_bytes(path.read_bytes())
        im = Image.open(path)
        w, h = im.size
        left, top, right, bottom = box
        right = min(right, w)
        bottom = min(bottom, h)
        cropped = im.crop((left, top, right, bottom))
        cropped.save(path, optimize=True)
        print(f"  {name}: {w}x{h} → {cropped.width}x{cropped.height}")


if __name__ == "__main__":
    main()
