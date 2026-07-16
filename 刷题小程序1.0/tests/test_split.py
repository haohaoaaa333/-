# -*- coding: utf-8 -*-
"""切题四层算法回归测试。

覆盖：
- 第一层：题号格式扩展（第N题 / （N）） + 全卷连续性诊断
- 第二层：选项区间内误识题号抑制（跨页/截断场景）
- 第三层：通用材料组识别（不限资料分析）
- 第四层：图片按 bbox 空间就近归属
纯 Python，无需 MinerU/GPU，`python tests/test_split.py` 即可运行。
"""

import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import split_questions as sq  # noqa: E402


def _run(markdown, content_list=None):
    return sq.split_markdown(markdown, content_list)


def _check(name, cond, extra=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name} {extra}")
    if not cond:
        _check.failed += 1
_check.failed = 0


# ── 第一层：题号格式 ──────────────────────────────────────
def test_number_formats():
    md = """# 言语理解与表达
第1题 下列哪一选项正确？
A. 甲 B. 乙 C. 丙 D. 丁
（2）下列关于法的说法正确的是？
A. 对 B. 错 C. 中 D. 外
3. 普通数字题号仍应识别。
A. a B. b C. c D. d
文中子项（1）首先…（2）其次…不应被当成题。"""
    res = _run(md)
    nos = [q["question_no"] for q in res["questions"]]
    _check("第一层-第N题/（N）/N. 均识别", nos == [1, 2, 3], f"nos={nos}")
    _check("第一层-子项（1）（2）未误识", 1 in nos and 2 in nos and 3 in nos)
    _check("第一层-全部 4 选项", all(q["option_count"] == 4 for q in res["questions"]))


# ── 第一层：全卷连续性诊断 ────────────────────────────────
def test_numbering_report():
    md = """1. 题一
A. a B. b C. c D. d
2. 题二
A. a B. b C. c D. d
4. 题四（缺 3）
A. a B. b C. c D. d"""
    res = _run(md)
    rep = res["numbering"]
    _check("连续性-缺失题号检出", rep["missing"] == [3], f"missing={rep['missing']}")
    _check("连续性-计数正确", rep["count"] == 3 and rep["min"] == 1 and rep["max"] == 4)
    _check("连续性-has_gap", rep["has_gap"] is True)


# ── 第二层：选项内误识题号（跨页/截断） ───────────────────
def test_option_internal_false_start():
    # 75 题选项后混入一个像题号的数字「3.」，不应被切成新题
    md = """75. 某行程问题，甲车速度？
A. 6：00 B. 7：00 C. 8：00 D. 9：00
3. 这是误识的数字，不应成为新题
76. 下一题正常。
A. x B. y C. z D. w"""
    res = _run(md)
    nos = [q["question_no"] for q in res["questions"]]
    _check("第二层-误识数字未成题", nos == [75, 76], f"nos={nos}")
    _check("第二层-75 题保留 4 选项", any(q["question_no"] == 75 and q["option_count"] == 4 for q in res["questions"]))


# ── 第三层：通用材料组（不限资料分析） ────────────────────
def test_material_group():
    md = """根据以下资料，回答111～115题。
2023年某省GDP为X亿元，结构如下（图表）。
111. 第一题
A. a B. b C. c D. d
112. 第二题
A. a B. b C. c D. d"""
    res = _run(md)
    nos = [q["question_no"] for q in res["questions"]]
    _check("第三层-材料组题号识别", nos == [111, 112], f"nos={nos}")
    mat = [q.get("material") for q in res["questions"] if q["question_no"] in (111, 112)]
    _check("第三层-材料挂到题区间", all(m and "GDP" in m for m in mat), f"material={mat}")


# ── 第四层：图片按 bbox 空间就近归属 ──────────────────────
def test_spatial_image():
    cl = [
        {"type": "paragraph", "bbox": [10, 50, 200, 80], "content": "75. 题干在上方"},
        {"type": "image", "bbox": [10, 120, 80, 160], "img_path": "near.png"},
        {"type": "paragraph", "bbox": [10, 700, 200, 740], "content": "99. 很远的另一题"},
        {"type": "image", "bbox": [10, 900, 80, 940], "img_path": "far.png"},
    ]
    md = """75. 题干在上方
A. a B. b C. c D. d
99. 很远的另一题
A. a B. b C. c D. d"""
    res = _run(md, cl)
    by_no = {q["question_no"]: q for q in res["questions"]}
    near = by_no[75].get("images", [])
    far = by_no[99].get("images", [])
    _check("第四层-近图归属 75", "near.png" in near, f"75.images={near}")
    _check("第四层-远图不归 75", "far.png" not in near)
    _check("第四层-远图归属 99", "far.png" in far, f"99.images={far}")


# ── 回归：原有 N. 格式 + 模块切分不受影响 ─────────────────
def test_regression_basic():
    md = """# 一. 言语理解与表达
1. 古代汉语中“之”的用法？
A. 助词 B. 动词 C. 名词 D. 形容词
2. 下列哪项不属于成语？
A. 画蛇添足 B. 守株待兔 C. 亡羊补牢 D. 好好学习
# 二. 数量关系
66. 计算 1+2+...+100=？
A. 5050 B. 5000 C. 4950 D. 5100"""
    res = _run(md)
    nos = [q["question_no"] for q in res["questions"]]
    _check("回归-N. 格式题号", nos == [1, 2, 66], f"nos={nos}")
    _check("回归-模块统计", any(m["module"] == "言语理解与表达" and m["count"] == 2 for m in res["modules"]))
    # 跨模块跳号（言语1→数量66）属正常；模块内不应有缺口
    pm = res["numbering"]["per_module"]
    _check("回归-模块内无异常缺口",
           pm.get("言语理解与表达", {}).get("has_gap") is False
           and pm.get("数量关系", {}).get("has_gap") is False,
           f"per_module={pm}")


def main():
    test_number_formats()
    test_numbering_report()
    test_option_internal_false_start()
    test_material_group()
    test_spatial_image()
    test_regression_basic()
    print("\n" + ("全部通过 ✅" if _check.failed == 0 else f"有 {_check.failed} 项失败 ❌"))
    sys.exit(1 if _check.failed else 0)


if __name__ == "__main__":
    main()
