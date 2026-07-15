#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MinerU 连续文本 / 版面 JSON -> 确定性题目切割。

架构2 文档第三步：先 Python 做确定性"题目切割"，不调用 AI。
输入：MinerU 的 full.md（或 auto/input.md） + 可选的 content_list.json
输出：raw_questions.json（文档规范：question_no / page / module / raw_text / options / images）

设计要点：
- 模块标题：优先用 content_list 的 text_level==2 块；缺失时（如"四.数量关系"粘连在上一题）
  回退到 markdown 文本中的模块名关键词。
- 题号粘连：OCR 大量出现"人民求解放1.的""乙66.的1.5倍""行70.驶"等粘连，
  用"数字点 + 后接中文/字母"特征识别，并保护小数、过滤名词前缀（图/表/式）。
- 选项粘连：A.6：00 B.7：00 连续文本与逐行两种形态都支持。
- 资料分析：按"4 组 × 5 题"确定性归属材料段落（OCR 常把材料段吸入上一题段尾，
  故第 1 组取模块首题前引导段，第 k 组取上一组末题段尾的"资料起始特征"之后文字）。
- 不修改原题文本，只做切分与结构化分组。
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

# ── 模块定义 ──────────────────────────────────────────────
MODULE_ALIASES = {
    "政治理论": "政治理论",
    "常识判断": "常识判断",
    "常识": "常识判断",
    "言语理解": "言语理解与表达",
    "言语理解与表达": "言语理解与表达",
    "数量关系": "数量关系",
    "数学运算": "数量关系",
    "判断推理": "判断推理",
    "资料分析": "资料分析",
}

MODULE_NAME_RE = re.compile(
    r"(政治理论|常识判断|言语理解(?:与表达)?|数量关系|数学运算|判断推理|资料分析)"
)

# 模块标题行：`## 一. 政治理论：` / `四. 数量关系：` / `（一）` 等
MODULE_HEADING_RE = re.compile(
    r"^\s*#{0,6}\s*"
    r"(?:第[一二三四五六七八九十百0-9]+[部分节章类])?"
    r"([一二三四五六七八九十0-9]+)\s*[.．、]?\s*"
    r"(政治理论|常识判断|言语理解(?:与表达)?|数量关系|数学运算|判断推理|资料分析)"
    r"(?:\s*[（(][^）)]*[）)])?"
    r"(?:\s*[：:].*)?$"
)

# 资料分析材料组标记：（一）（二）（三）（四）
MATERIAL_GROUP_RE = re.compile(r"^\s*[（(]([一二三四五六七八九十0-9]+)[)）]\s*$")

# 题号候选：数字点 + 后接中文/字母/数字/带圈数字（题号特征，题干可能以
# 年份或金额数字开头，如 "113.2019年"）。负向前瞻排除图片扩展名。
# 真小数（如 "1.5倍"）在 find_question_starts 内单独排除。
# 允许题干首字符还包括：行内公式 $（如 "75. $\frac{9}{16}$..."）与句末句号
# "。"（OCR 缺陷，如 "57. 。农药..."）。
QUESTION_CANDIDATE_RE = re.compile(
    r"(\d{1,3})\s*[.．、]\s*"
    # 题干也常以书名号或引号开头，如 ``26.《消费者权益保护法》``、
    # ``45.“南橘北枳”``。这些字符若不纳入会稳定漏掉整道题。
    r"(?=[一-鿿A-Za-z0-9（(①-⑳⑴-⒛㊀-㊉$。“”‘’「」『』《〈【\[])(?!jpe?g|png|gif|webp|bmp|JPE?G|PNG|GIF)"
)
# 真小数：小数点后 1-2 位且不再接数字/点（1.5 / 0.5 / 2.3），不算题号
DECIMAL_RE = re.compile(r"^\d{1,3}\.\d{1,2}(?![.\d])")

# 语句排序题（无题号 OCR 缺陷）锚点：以"将以上N个句子重新排列"定位，
# 向前找圆环数字块（①-⑦）起点作为题块开头。仅当该块位于段首且不被某个
# 已编号题目（"N."）拥有时，才视为孤立题（缺失题号），编号顺延上一题+1。
SENTENCE_ORDER_ANCHOR_RE = re.compile(r"将以上\s*\d+\s*个句子重新排列")
CIRCLED = "①②③④⑤⑥⑦"

# 名词前缀黑名单：避免把"图1.""式2."误判为题号（"表"字易误杀"列表"，已移除）
NON_QUESTION_PREFIX = set("图式例注附第课节章部类项组")
# 选项前缀
OPTION_RE = re.compile(r"^\s*([A-Da-d])\s*[.．、:：]\s*(.*)$")


def protect_decimals(text: str) -> tuple[str, dict]:
    """把 a.b 小数替换为占位符，避免被题号正则误切。"""
    store: dict[int, str] = {}

    def repl(m):
        key = len(store)
        store[key] = m.group(0)
        return f"\u0000{key}\u0000"

    protected = re.sub(r"(\d+)\.(\d+)", repl, text)
    return protected, store


def restore_decimals(text: str, store: dict) -> str:
    def repl(m):
        return store[int(m.group(1))]

    return re.sub(r"\u0000(\d+)\u0000", repl, text)


def _at_line_start(text: str, pos: int) -> bool:
    """pos 处字符是否位于"段首"（允许行首空格/制表符）。"""
    if pos <= 0:
        return True
    j = pos - 1
    while j >= 0 and text[j] in " \t":
        j -= 1
    return j < 0 or text[j] in "\n\r"


def _find_orphan_sentence_order_starts(text: str) -> list[tuple[int, None]]:
    """定位"缺失题号"的语句排序题：题块存在但题号被 OCR 丢掉的孤立题。

    返回 [(题块起始索引, None), ...]；None 表示编号需顺延上一题 +1。
    """
    orphans: list[tuple[int, None]] = []
    for m in SENTENCE_ORDER_ANCHOR_RE.finditer(text):
        anchor = m.start()
        # 向前（不超过 3000 字）找"位于段首"的圆环数字作为题块起点。
        # 仅取段首的圆环数字，避免误用上一道已编号排序题（如 61）的圆环项。
        lo = max(0, anchor - 3000)
        window = text[lo:anchor]
        positions: list[int] = []
        for i, ch in enumerate(window):
            if ch in CIRCLED:
                p = lo + i
                if _at_line_start(text, p):
                    positions.append(p)
        if not positions:
            continue
        block_start = max(positions)  # 最靠近锚点、位于段首的圆环数字（即孤立题首）
        # 条件(b)：题块到锚点之间不能出现已编号题号"N."（否则属于该编号题）
        if re.search(r"\d{1,3}\s*[.．、]", text[block_start:anchor]):
            continue
        orphans.append((block_start, None))
    return orphans


def find_question_starts(text: str) -> list[tuple[int, int | None]]:
    """返回所有题号候选的 (起始索引, 偏好题号)；偏好题为 None 表示缺失题号、需顺延。

    两类来源：
    1) 数字题号 "N."（不紧贴汉字；题干首字可为中文/字母/数字/带圈数字/公式$/句号。等）；
    2) 孤立语句排序题（"将以上N个句子重新排列" 且不被已编号题拥有）。
    不紧贴汉字的要求可过滤正文内的伪题号（如"（横轴位置表示增量115.为0）"里的 115.）。
    """
    starts: list[tuple[int, int | None]] = []
    for m in QUESTION_CANDIDATE_RE.finditer(text):
        num = int(m.group(1))
        if num < 1 or num > 200:
            continue
        idx = m.start(1)
        # 真小数排除（1.5 / 0.5），但允许年份（113.2019）
        if DECIMAL_RE.match(text[idx:]):
            continue
        # 前导字符黑名单（图/式/例/注 等名词前缀）
        before = text[idx - 1] if idx > 0 else ""
        if before and before in NON_QUESTION_PREFIX:
            continue
        # 括号内误识题号：填空被 OCR 误读成 "N."，如
        # "（横轴位置表示增量115.为0）"。真实题号就是该 N，但题块应从本行
        # 行首（真正题干起点，如"以下柱状图反映了…"）开始，而非括号内部。
        ls = text.rfind("\n", 0, idx)
        seg_before = text[:idx] if ls == -1 else text[ls:idx]
        op = seg_before.rfind("（")
        if op != -1 and "）" not in seg_before[op:]:
            line_head = (ls + 1) if ls != -1 else 0
            starts.append((line_head, num))
            continue
        starts.append((idx, num))
    starts.extend(_find_orphan_sentence_order_starts(text))
    starts.sort(key=lambda x: x[0])
    return starts


def split_options(block: str) -> list[dict]:
    """从题目块中提取 A/B/C/D 选项，支持连续与逐行、文字与图片两种形态。

    返回 [{key, text, images}, ...]
    """
    opt_re = re.compile(r"(?<![A-Za-z0-9])([A-Da-d])\s*[.．、:：]\s*")
    positions = [(m.start(1), m.group(1).upper()) for m in opt_re.finditer(block)]
    if not positions:
        return []
    opts: list[dict] = []
    for i, (pos, key) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(block)
        seg = block[pos:end]
        text = re.sub(r"^\s*[A-Da-d]\s*[.．、:：]\s*", "", seg)
        imgs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", seg)
        opts.append({"key": key, "text": text.strip(), "images": imgs})
    return opts


def build_raw_question(no: int, raw_text: str, module: str, material: str | None,
                        page, images: list[str]) -> dict:
    opts = split_options(raw_text)
    # 图形推理回退：无文字选项但题块含多张图片 -> 图片即选项
    if len(opts) < 2:
        all_imgs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", raw_text)
        if len(all_imgs) >= 2:
            opts = [{"key": k, "text": "", "images": [img]} for k, img in zip("ABCD", all_imgs[:4])]
    # 图片收集：选项内图片 + 题干/独立图片（图表、示意图、资料分析配图等）
    opt_imgs = [img for o in opts for img in o["images"]]
    all_imgs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", raw_text)
    stem_imgs = [img for img in all_imgs if img not in opt_imgs]
    combined = list(images or []) + stem_imgs
    return {
        "question_no": no,
        "page": page,
        "module": module,
        "material": material,
        "raw_text": raw_text.strip(),
        "options": [f"{o['key']}.{o['text']}" for o in opts],
        "option_images": opt_imgs,
        "option_count": len(opts),
        "images": combined,
    }


def split_stuck_module_headings(markdown: str) -> str:
    """把粘连在正文中的模块标题（如 '...毒素四. 数量关系：...'）剥离成独立行。

    仅当模块名后接 空白/冒号/括号/行尾 时才视为"标题"（避免把题干里出现的
    "政治理论的相关知识" 这类正常文本误拆）。
    """
    pat = re.compile(
        r"([^\n])("
        r"(?:第[一二三四五六七八九十百0-9]+[部分节章类])?"
        r"[一二三四五六七八九十0-9]+\s*[.．、]\s*"
        r"(政治理论|常识判断|言语理解(?:与表达)?|数量关系|数学运算|判断推理|资料分析)"
        r")(?=[\s：:（(]|$)"
    )
    return pat.sub(r"\1\n\2", markdown)


def parse_module_blocks(markdown: str):
    """把 markdown 按模块标题聚合成 (module_name, lines) 列表。"""
    lines = markdown.split("\n")
    modules: list[dict] = []
    current = {"module": "综合题", "lines": []}
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        m = MODULE_HEADING_RE.match(line)
        if m:
            if current["lines"]:
                modules.append(current)
            current = {"module": MODULE_ALIASES.get(m.group(2), m.group(2)), "lines": []}
            continue
        # 智能结构化预览使用 `### 10` 表示题号。旧逻辑把所有 Markdown
        # 标题都丢弃，导致页面明明显示 130 题，真正生成 V2 时却只剩偶然
        # 在正文里命中的一题。数字标题必须还原为普通的 `10.` 题号行。
        question_heading = re.match(r"^#{1,6}\s*(\d{1,3})\s*[.．、]?\s*$", line)
        if question_heading:
            current["lines"].append(f"{question_heading.group(1)}.")
            continue
        if line.startswith("#"):
            continue
        current["lines"].append(line)
    if current["lines"]:
        modules.append(current)
    return modules


def extract_questions_from_module(module_name: str, lines: list[str],
                                   page_lookup=None) -> list[dict]:
    """模块内确定性切题。starts 为 [(idx, preferred_no), ...]。"""
    text = "\n".join(lines)
    starts = find_question_starts(text)
    if not starts:
        return []

    # 模块内题号序列校验：过滤材料文字里的 "3."、倒退噪音。
    # 模块首题允许大跳变（数量关系 66、资料分析 111）。
    # 偏好题号为 None 的孤立题（缺失题号）一律保留，编号顺延上一题 +1。
    valid_starts: list[tuple[int, int | None]] = []
    last_no = 0
    for s, pref in starts:
        if pref is not None:
            no = pref
            if last_no == 0:
                valid_starts.append((s, no))
                last_no = no
                continue
            if no >= last_no - 2:
                valid_starts.append((s, no))
                last_no = max(last_no, no)
            # 否则（明显倒退，如 112 -> 3）丢弃，视为材料内噪音
        else:
            no = (last_no + 1) if last_no > 0 else (len(valid_starts) + 1)
            valid_starts.append((s, no))
            last_no = no
    starts = valid_starts

    # 预切分题段：记录 (起始, 题号, 结束)
    segs: list[tuple[int, int, int]] = []
    for i, (s, no) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        segs.append((s, no, end))

    # 资料分析：按"4 组 × 5 题"确定性归属材料段落。
    # OCR 把（一）（二）材料标记与题号错位、且材料段常被吸入上一题段尾，
    # 故不依赖标记位置：第 1 组材料取模块首题之前的引导段；第 k(>=1) 组材料
    # 取上一组末题 raw_text 中"资料起始特征"之后的段落（即被吸入的下一则材料）。
    materials: list[str | None] = [None] * len(segs)
    if module_name == "资料分析" and segs:
        materials = _assign_za_materials(text, segs)

    questions: list[dict] = []
    for i, (s, no, end) in enumerate(segs):
        seg = text[s:end].strip()
        page = page_lookup(seg) if page_lookup else None
        q = build_raw_question(no, seg, module_name, materials[i], page, [])
        questions.append(q)
    return questions


# ── 资料分析材料归属（确定性兜底） ──────────────────────────
# 资料起始特征：年范围 / 截至 / 根据以下资料 / 下列资料 / 表图 / <table> / （一）..（四）标记
_ZA_PASSAGE_START_RE = re.compile(
    r"(?:^|\n)\s*"
    r"(?:\d{4}\s*[-—~至]\s*\d{4}\s*年"
    r"|截至"
    r"|根据以下资料|下列[资料表图]"
    r"|如下图|如图所示|表中数据|如下表"
    r"|<table"
    r"|[（(][一二三四五六][)）])",
    re.MULTILINE,
)


def _extract_passage_tail(raw: str) -> str:
    """从被吸入上一题段尾的材料文字中，截取'资料起始特征'之后的段落。"""
    m = _ZA_PASSAGE_START_RE.search(raw)
    if not m:
        return ""
    return raw[m.start():].strip()


def _clean_za_region(region: str) -> str:
    """清理引导段：去掉模块标题回声、材料标记行，保留图表/正文。"""
    out = []
    for ln in region.split("\n"):
        s = ln.strip()
        if not s:
            continue
        if re.match(r"#{1,6}\s*.*资料分析", s):
            continue
        if re.fullmatch(r"#{0,6}\s*[（(][一二三四五六][)）]", s):
            continue
        out.append(s)
    return "\n".join(out).strip()


def _assign_za_materials(text: str, segs: list[tuple]) -> list[str | None]:
    """每 5 题一组，确定性地给出每组材料段落文字（互异，便于 4×5 分组）。"""
    n = len(segs)
    mats: list[str | None] = [None] * n
    seen: dict[str, int] = {}
    group = 0
    for ci in range(0, n, 5):
        chunk = segs[ci:ci + 5]
        if ci == 0:
            # 第 1 组：模块首题之前的引导段（含（一）（二）等材料文字）
            region = text[: chunk[0][0]]
            mat = _clean_za_region(region)
        else:
            # 第 k 组：上一组末题段尾吸入的材料
            prev_last = segs[ci - 1]
            prev_raw = text[prev_last[0]:prev_last[2]]
            mat = _extract_passage_tail(prev_raw)
            if not mat:
                mat = _clean_za_region(text[: chunk[0][0]])  # 退化：用引导段
        # 保证各组材料互异（满足"每组 5 题"去重分组，且 reviewer 可见区分）
        if mat in seen:
            mat = f"{mat}\n[材料组 {group + 1}]"
        seen[mat] = group
        for j in range(len(chunk)):
            mats[ci + j] = mat
        group += 1
    return mats


def page_from_content_list(seg_text: str, content_list: list[dict]) -> int | None:
    """根据题段文本在 content_list 中匹配，返回 page_idx（从1开始）。"""
    # 取题段前 24 字做匹配
    key = seg_text.strip()[:24]
    if not key:
        return None
    best = None
    for item in content_list:
        if item.get("type") != "text":
            continue
        t = item.get("text", "")
        if key[:12] and key[:12] in t:
            best = item.get("page_idx", 0) + 1
            break
    return best


def collect_images_for_page(content_list: list[dict], page_idx_0: int) -> list[str]:
    return [
        item.get("img_path", "").replace("images/", "")
        for item in content_list
        if item.get("type") == "image" and item.get("page_idx") == page_idx_0
    ]


def fix_misplaced_question_numbers(text: str) -> str:
    """Corrects MinerU layout merging anomalies where question numbers are inserted
    into the middle of words (e.g. '普2.遍性' -> '2. 普遍性') by moving them to the
    beginning of their respective paragraphs.
    """
    paragraphs = text.split("\n\n")
    fixed_paragraphs = []
    
    # Pattern to match misplaced question numbers inside words or after punctuation.
    # Group 1: Preceding character (Chinese character or Chinese punctuation)
    # Group 2: The question number (1 to 200)
    # Group 3: Dot or separator
    # Lookahead: Succeeding character (excluding digits 0-9 to protect decimals)
    pattern = re.compile(
        r"([一-鿿a-zA-Z，。？；：”）（])"
        r"(\d{1,3})"
        r"([.．、])"
        r"(?=[一-鿿a-zA-Z①-⑳⑴-⒛㊀-㊉$（(])"
    )
    
    for para in paragraphs:
        para_clean = para.strip()
        if not para_clean:
            fixed_paragraphs.append(para)
            continue
            
        m = pattern.search(para_clean)
        if m:
            # Only move if the paragraph does not already start with a question number
            start_match = re.match(r"^\s*(\d{1,3})\s*[.．、]", para_clean)
            if not start_match:
                qnum = m.group(2)
                dot = m.group(3)
                start_idx = m.start(2)
                end_idx = m.end(3)
                new_para = para_clean[:start_idx] + para_clean[end_idx:]
                new_para = f"{qnum}{dot} {new_para}"
                fixed_paragraphs.append(new_para)
                continue
                
        fixed_paragraphs.append(para)
        
    return "\n\n".join(fixed_paragraphs)


def split_markdown(markdown: str, content_list: list[dict] | None = None):
    """主入口：返回 {paper_title, modules, questions}。"""
    # Pre-process to fix misplaced question numbers
    markdown = fix_misplaced_question_numbers(markdown)
    
    # 试卷标题
    paper_title = "OCR行测试卷"
    for line in markdown.split("\n")[:15]:
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        if re.search(r"\d{4}年|国考|省考|联考|市考|事业单位|真题|行测|申论|公务员录用考试", t) and len(t) <= 80:
            paper_title = t
            break

    page_lookup = None
    if content_list:
        page_lookup = lambda seg: page_from_content_list(seg, content_list)

    # 预处理：把粘连在上一题末尾的模块标题（如"四.数量关系："）拆成独立行，
    # 否则 parse_module_blocks 会漏掉该模块，导致数量关系等模块题被错归上一模块。
    markdown = split_stuck_module_headings(markdown)

    modules_raw = parse_module_blocks(markdown)
    questions: list[dict] = []
    module_summary: list[dict] = []
    for mod in modules_raw:
        qs = extract_questions_from_module(mod["module"], mod["lines"], page_lookup)
        if qs:
            module_summary.append({"module": mod["module"], "count": len(qs)})
            questions.extend(qs)

    # 关联图片（按 page）
    if content_list:
        for q in questions:
            if q.get("page"):
                imgs = collect_images_for_page(content_list, q["page"] - 1)
                if imgs:
                    q["images"] = imgs

    return {
        "paper_title": paper_title,
        "modules": module_summary,
        "question_count": len(questions),
        "questions": questions,
    }


def main():
    ap = argparse.ArgumentParser(description="MinerU 连续文本 -> 确定性题目切割")
    ap.add_argument("--markdown", required=True, help="MinerU full.md / input.md 路径")
    ap.add_argument("--content-list", default=None, help="可选 input_content_list.json")
    ap.add_argument("--output", required=True, help="raw_questions.json 输出路径")
    args = ap.parse_args()

    md = Path(args.markdown).read_text(encoding="utf-8")
    cl = None
    if args.content_list and os.path.exists(args.content_list):
        cl = json.loads(Path(args.content_list).read_text(encoding="utf-8"))
        if isinstance(cl, dict):
            cl = cl.get("pdf_info", [cl])

    result = split_markdown(md, cl)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[split] paper_title : {result['paper_title']}")
    print(f"[split] modules     : {result['modules']}")
    print(f"[split] questions   : {result['question_count']}")
    # 质量快检
    no_opt = [q["question_no"] for q in result["questions"] if q["option_count"] < 2]
    print(f"[split] <2选项的题目 : {len(no_opt)}")
    print(f"[split] -> {args.output}")


if __name__ == "__main__":
    main()
