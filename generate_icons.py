from PIL import Image, ImageDraw
import os

OUT_DIR = r"C:\Users\hao\WorkBuddy\刷题小程序1.0\刷题小程序1.0\assets\tabbar"
SIZE = 81

# 颜色：同时适配亮色/暗色 tabBar 背景
NORMAL_COLOR = (100, 116, 139, 255)  # #64748b
ACTIVE_COLOR = (26, 86, 219, 255)    # #1a56db

def new_image():
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

def draw_home(active: bool):
    im = new_image()
    d = ImageDraw.Draw(im)
    color = ACTIVE_COLOR if active else NORMAL_COLOR
    # house body
    body_w, body_h = 38, 30
    body_left = (SIZE - body_w) // 2
    body_top = 38
    d.rectangle([body_left, body_top, body_left + body_w, body_top + body_h], fill=color)
    # roof triangle
    roof_points = [
        (body_left - 8, body_top),
        (body_left + body_w // 2, body_top - 22),
        (body_left + body_w + 8, body_top),
    ]
    d.polygon(roof_points, fill=color)
    # door
    door_w, door_h = 12, 18
    door_left = (SIZE - door_w) // 2
    d.rectangle([door_left, body_top + body_h - door_h, door_left + door_w, body_top + body_h], fill=(0, 0, 0, 0))
    return im

def draw_book(active: bool):
    im = new_image()
    d = ImageDraw.Draw(im)
    color = ACTIVE_COLOR if active else NORMAL_COLOR
    cx = SIZE // 2
    top = 22
    h = 38
    w = 30
    # left page
    d.polygon([(cx, top), (cx - w, top + 6), (cx - w, top + h - 6), (cx, top + h)], fill=color)
    # right page
    d.polygon([(cx, top), (cx + w, top + 6), (cx + w, top + h - 6), (cx, top + h)], fill=color)
    # spine
    d.rectangle([cx - 2, top, cx + 2, top + h], fill=color)
    return im

def draw_profile(active: bool):
    im = new_image()
    d = ImageDraw.Draw(im)
    color = ACTIVE_COLOR if active else NORMAL_COLOR
    cx = SIZE // 2
    head_r = 11
    head_y = 30
    d.ellipse([cx - head_r, head_y - head_r, cx + head_r, head_y + head_r], fill=color)
    body_h = 18
    body_w = 28
    d.rounded_rectangle([cx - body_w // 2, head_y + head_r + 4, cx + body_w // 2, head_y + head_r + 4 + body_h], radius=8, fill=color)
    return im

icons = [
    ("home", draw_home),
    ("book", draw_book),
    ("profile", draw_profile),
]

for name, draw in icons:
    draw(False).save(os.path.join(OUT_DIR, f"{name}.png"))
    draw(True).save(os.path.join(OUT_DIR, f"{name}_active.png"))
    print(f"generated {name}.png / {name}_active.png")
