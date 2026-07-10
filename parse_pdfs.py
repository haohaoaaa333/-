#!/usr/bin/env python3
"""
国考行测 PDF 批量解析器 v2
兼容 2000-2025 不同年代格式
"""
import pdfplumber, re, json, os
from pathlib import Path
from collections import OrderedDict

BASE_DIR = Path(r"D:\浏览器下载\全国各省34省+国考【历年真-题】\34省考+国考pdf版【推荐用这个版本】\国考2000-2025真题pdf 【推荐用这个版本】\2000-2025国考行测PDF")
PAPER_DIR = BASE_DIR / "行测-真题"
ANSWER_DIR = BASE_DIR / "行测-答案及解析"
OUTPUT = Path(r"C:\Users\hao\WorkBuddy\刷题小程序1.0\parsed_questions.json")

# 模块名→module_id + 识别关键词列表
MODULES = [
    (["常识判断", "常识"], "mod_common_sense"),
    (["言语理解", "言语理解与表达"], "mod_language"),
    (["数量关系", "数学运算", "数字推理"], "mod_quantity"),
    (["判断推理", "图形推理", "定义判断", "类比推理", "逻辑判断", "演绎推理", "事件排序"], "mod_logic"),
    (["资料分析"], "mod_data"),
]

# 答案字母→索引
ANSWER_MAP = {"A": 0, "B": 1, "C": 2, "D": 3, "a": 0, "b": 1, "c": 2, "d": 3}

def extract_year(fn):
    m = re.search(r"(\d{4})", Path(fn).stem)
    return int(m.group(1)) if m else 0

def pdf_text(path):
    try:
        with pdfplumber.open(path) as p:
            pages = [pg.extract_text() or "" for pg in p.pages]
        text = "\n".join(pages)
        text = text.replace("\u3000", " ").replace("\xa0", " ")
        return re.sub(r"\n{3,}", "\n\n", text).strip()
    except Exception as e:
        print(f"  [ERR] {Path(path).name}: {e}")
        return ""

# ==================== 模块拆分 ====================

def find_modules(paper_text):
    """从试卷文本中找到各模块的起始位置和 module_id"""
    lines = paper_text.split("\n")
    positions = []
    
    for i, line in enumerate(lines):
        line_clean = line.strip()
        for keywords, mid in MODULES:
            for kw in keywords:
                # 匹配模块标题：第一部分xx / 一、xx / 一．xx / 一. xx 等
                patterns = [
                    rf"第[一二三四五六七八九十\d]+部分\s*.*?{kw}",
                    rf"[一二三四五六七八九十]+[\s、．\.、]+.*?{kw}",
                ]
                for pat in patterns:
                    if re.search(pat, line_clean) and len(line_clean) < 120:
                        positions.append((i, mid, kw))
                        break
                else:
                    continue
                break
    
    # 去重相邻行
    if positions:
        filtered = [positions[0]]
        for i in range(1, len(positions)):
            if positions[i][0] - filtered[-1][0] > 1:
                filtered.append(positions[i])
        positions = filtered
    
    if not positions:
        return [("mod_unknown", paper_text)]
    
    modules = []
    for idx, (line_no, mid, kw) in enumerate(positions):
        start = line_no
        end = positions[idx + 1][0] if idx + 1 < len(positions) else len(lines)
        text = "\n".join(lines[start:end])
        modules.append((mid, text))
    return modules


# ==================== 题目拆分 ====================

def split_questions(module_text):
    """从模块文本中拆分单题"""
    # 支持多种题号格式:
    #   123.  123．  123、  123,  (标准格式)
    #   123\n  (2023-2025 格式：题号独占一行)
    qnum_re = re.compile(r"(?:^|\n)\s*(\d{1,3})\s*(?:[.．、,]?\s*|(?:\n))")
    matches = list(re.finditer(qnum_re, module_text))
    
    # 过滤：排除不是题号的数字（如年份、页码等）
    valid_matches = []
    for m in matches:
        qnum = int(m.group(1))
        # 跳过明显的非题号：页码、年份等
        if qnum > 200 or qnum == 0:
            continue
        # 检查上下文：题号通常在行首或段首
        ctx_before = module_text[max(0, m.start()-5):m.start()]
        if re.search(r"\d{4}|页|Page", ctx_before):
            continue
        valid_matches.append(m)
    
    questions = []
    for idx, m in enumerate(valid_matches):
        qnum = int(m.group(1))
        start = m.end()
        end = valid_matches[idx + 1].start() if idx + 1 < len(valid_matches) else len(module_text)
        raw_text = module_text[start:end].strip()
        
        # 清理页脚/页码
        raw_text = re.sub(r"-\d+-", "", raw_text)
        raw_text = re.sub(r"\d+\s*/\s*\d+", "", raw_text)
        
        # 提取选项
        options = parse_options(raw_text)
        
        # 题干 = 选项前的内容
        stem = raw_text
        if options:
            for i, opt in enumerate(options):
                # 找选项起始
                opt_start = find_option_start(raw_text, i, opt)
                if opt_start >= 0:
                    stem = raw_text[:opt_start].strip()
                    break
        
        # 确保信息完整
        if len(stem) < 20 and len(raw_text) > 50:
            stem = raw_text.split("\n")[0] if "\n" in raw_text else raw_text[:100]
        
        questions.append({
            "num": qnum,
            "stem": stem,
            "options": options or ["A", "B", "C", "D"],
            "raw": raw_text,
        })
    
    return questions


def find_option_start(text, opt_idx, opt_text):
    """找到选项在文本中的起始位置"""
    letters = ["A", "B", "C", "D"]
    # 尝试多种格式
    patterns = [
        rf"(?:^|\s){letters[opt_idx]}[\.、．\s]+{re.escape(opt_text[:8])}",
        rf"{letters[opt_idx]}[\.、．\s]+{re.escape(opt_text[:8])}",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.start()
    return -1


def parse_options(text):
    """提取 ABCD 四个选项"""
    # 格式1: A．xxx B．xxx C．xxx D．xxx
    # 格式2: A、xxx B、xxx C、xxx D、xxx
    # 格式3: A.xxx B.xxx C.xxx D.xxx
    # 格式4: A  xxx B  xxx C  xxx D  xxx
    
    patterns = [
        r"A[\.、．\s]+(.+?)\s*B[\.、．\s]+(.+?)\s*C[\.、．\s]+(.+?)\s*D[\.、．\s]+(.+?)$",
        r"A[\.、．\s]+(.+?)$",  # fallback
    ]
    
    for pat in patterns:
        m = re.search(pat, text, re.DOTALL)
        if m and len(m.groups()) >= 4:
            opts = [m.group(i).strip() for i in range(1, 5)]
            # 清理选项末尾
            opts = [re.sub(r"\s+$", "", o).strip() for o in opts]
            # 基本合法性检查
            if all(len(o) > 0 for o in opts):
                return opts
    
    # 备用方案：逐行找 A/B/C/D 开头
    lines = text.split("\n")
    opts = []
    for letter in ["A", "B", "C", "D"]:
        found = ""
        for line in lines:
            line = line.strip()
            if re.match(rf"^{letter}[\.、．\s]+", line):
                found = re.sub(rf"^{letter}[\.、．\s]+", "", line).strip()
                break
        opts.append(found if found else f"选项{letter}")
    
    if all(o for o in opts):
        return opts
    return None


# ==================== 答案解析 ====================

def extract_answers(answer_text, year):
    """从答案PDF提取每题答案和解析"""
    answers = {}     # {qnum: answer_idx}
    explanations = {}  # {qnum: "解析文本"}
    
    # 策略1: "快速对答案" 块 (2014+)
    quick = re.search(r"快速对答案[：:]*\s*(.*?)(?:\n\n|\n(?:【|一[\.\s]|第[一二三]))", answer_text, re.DOTALL)
    if quick:
        block = quick.group(1)
        for m in re.finditer(r"[\[【]?\s*(\d+)\s*[—\-–~～]\s*(\d+)\s*[\]】]?\s*([A-Da-d\s]+)", block):
            start, end, letters = int(m.group(1)), int(m.group(2)), re.sub(r"\s+", "", m.group(3))
            for i, ch in enumerate(letters):
                if ch in ANSWER_MAP and start + i <= end:
                    answers[start + i] = ANSWER_MAP[ch]
        for m in re.finditer(r"(?:^|\n)\s*(\d{1,3})\s*[\.、．\s]+([A-Da-d])", block):
            qnum = int(m.group(1))
            if qnum not in answers:
                answers[qnum] = ANSWER_MAP[m.group(2)]
    
    # 策略2: 逐题解析 EACH Q HAS "故正确答案为X" AT END (2005-2022 主格式)
    # Split by question number
    q_blocks = re.split(r"(?:^|\n)(?=\d{1,3}[、\s]*(?:[A-Da-d]\s*[【\[]?\s*解析?)?)", answer_text)
    
    for block in q_blocks:
        # Extract question number
        qnum_m = re.match(r"(\d{1,3})", block)
        if not qnum_m:
            continue
        qnum = int(qnum_m.group(1))
        if qnum > 200:
            continue
        
        # Try to extract answer: "N．X 【解析】" or just "故正确答案为X"
        ans_m = re.search(r"(?:^|\b)([A-Da-d])\s*[【\[]?\s*解析?", block[:50])
        if ans_m and qnum not in answers:
            answers[qnum] = ANSWER_MAP.get(ans_m.group(1), -1)
        
        # Extract explanation (everything after possible answer prefix)
        expl_start = block
        if ans_m:
            expl_start = block[ans_m.end():]
        
        # Find "故正确答案为X" to get/confirm answer
        correct_m = re.search(r"故正确答案为[：:]*\s*([A-D])", expl_start)
        if correct_m:
            if qnum not in answers:
                answers[qnum] = ANSWER_MAP.get(correct_m.group(1), -1)
            # Also capture explanation text
            expl = expl_start.strip()
            if len(expl) > 15 and qnum not in explanations:
                explanations[qnum] = clean_expl(expl)
    
    # 策略3: 【N】解析 格式 (部分 modern)
    if len(explanations) < 10:
        for m in re.finditer(r"[【\[](\d{1,3})[】\]]\s*解析?\s*\n?(.*?)(?=(?:[【\[]\d{1,3}[】\]]\s*解析?)|(?:$))", answer_text, re.DOTALL):
            qnum = int(m.group(1))
            expl = m.group(2)
            if qnum not in explanations and len(expl) > 10:
                explanations[qnum] = clean_expl(expl)
                ans_match = re.search(r"故正确答案为[：:]*\s*([A-D])", expl)
                if ans_match and qnum not in answers:
                    answers[qnum] = ANSWER_MAP.get(ans_match.group(1), -1)
    
    return answers, explanations


def clean_expl(text):
    """清理解析文本"""
    text = re.sub(r"\d+\s*/\s*\d+", "", text)
    text = re.sub(r"【认准淘宝.*?】", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()[:2000]


MODULE_TAG_MAP = {
    "mod_common_sense": ["常识判断"],
    "mod_language": ["言语理解"],
    "mod_quantity": ["数量关系"],
    "mod_logic": ["判断推理"],
    "mod_data": ["资料分析"],
}


def process_pair(paper_path, ans_path):
    year = extract_year(paper_path)
    name = Path(paper_path).stem[:60]
    print(f"\n--- [{year}] {name}")
    
    paper_text = pdf_text(paper_path)
    ans_text = pdf_text(ans_path)
    
    if not paper_text or not ans_text:
        print(f"  [SKIP] 文本为空")
        return []
    
    # 解析答案
    answers, explanations = extract_answers(ans_text, year)
    print(f"  答案: {len(answers)}题  解析: {len(explanations)}题")
    
    # 解析试卷
    modules = find_modules(paper_text)
    print(f"  模块: {len(modules)} 个")
    
    all_q = []
    for mid, mod_text in modules:
        questions = split_questions(mod_text)
        print(f"    {mid}: {len(questions)}题")
        
        for q in questions:
            num = q["num"]
            ans = answers.get(num, -1)
            expl = explanations.get(num, "")
            
            if ans == -1 and expl:
                m2 = re.search(r"故正确答案为[：:]*\s*([A-D])", expl)
                if m2:
                    ans = ANSWER_MAP.get(m2.group(1), -1)
            
            record = {
                "_id": f"q_gk{year}_{mid.split('_')[-1]}_{num:03d}",
                "module_id": mid,
                "type": "single",
                "difficulty": "中等",
                "source": "真题",
                "year": year,
                "content": q["stem"][:500],
                "options": q["options"],
                "answer": ans if ans >= 0 else 0,
                "explanation": expl if expl else "（暂无解析）",
                "tags": MODULE_TAG_MAP.get(mid, ["行测"]),
            }
            all_q.append(record)
    
    print(f"  [OK] {len(all_q)}题")
    return all_q


def match_answer_file(paper_path, answer_files):
    """匹配对应的答案PDF"""
    pyear = str(extract_year(paper_path))
    paper_stem = Path(paper_path).stem
    
    for key, af in sorted(answer_files.items(), key=lambda x: -len(x[0])):
        ayear = str(extract_year(af))
        if ayear != pyear:
            continue
        
        ans_stem = af.stem
        # 检查级别匹配
        pairs = [("副省", "副省"), ("地市", "地市"), ("行政", "行政"),
                 ("A卷", "A卷"), ("B卷", "B卷"), ("省级", "省级"),
                 ("省", "省"), ("执法", "执法")]
        
        for pk, ak in pairs:
            if pk in paper_stem and ak in ans_stem:
                return af
        
        # 检查级别: (一) vs (一)
        for pk, ak in [("（一）", "（一）"), ("（二）", "（二）")]:
            if pk in paper_stem and ak in ans_stem:
                return af
    
    # 回退: 仅年份匹配
    for af in answer_files.values():
        if str(extract_year(af)) == pyear:
            return af
    
    return None


def main():
    print("国考行测 PDF 解析器 v2")
    print(f"试卷目录: {PAPER_DIR}")
    print(f"答案目录: {ANSWER_DIR}")
    
    paper_files = sorted(PAPER_DIR.glob("*.pdf"))
    answer_files = {f.stem: f for f in ANSWER_DIR.glob("*.pdf")}
    
    print(f"试卷: {len(paper_files)}  答案: {len(answer_files)}")
    
    all_data = []
    skipped = 0
    
    for pp in paper_files:
        af = match_answer_file(pp, answer_files)
        if not af:
            print(f"\n[SKIP] 无匹配答案: {pp.stem[:50]}")
            skipped += 1
            continue
        
        qs = process_pair(pp, af)
        if not qs:
            skipped += 1
        all_data.extend(qs)
    
    print(f"\n{'='*60}")
    print(f"总计: {len(all_data)} 题  (跳过 {skipped} 套试卷)")
    
    # 模块统计
    stats = {}
    for q in all_data:
        mid = q["module_id"]
        s = stats.get(mid, {"count": 0, "years": set()})
        s["count"] += 1
        s["years"].add(q.get("year", 0))
        stats[mid] = s
    
    for mid, s in sorted(stats.items()):
        yrs = sorted(s["years"])
        print(f"  {mid}: {s['count']}题 ({yrs[0]}-{yrs[-1]})" if yrs else f"  {mid}: {s['count']}题")
    
    # 写入
    json_str = json.dumps(all_data, ensure_ascii=False, indent=2)
    mb = len(json_str.encode('utf-8')) / 1024 / 1024
    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write(json_str)
    print(f"\n输出: {OUTPUT} ({mb:.1f} MB)")
    print("✅ 完成")


if __name__ == "__main__":
    main()
