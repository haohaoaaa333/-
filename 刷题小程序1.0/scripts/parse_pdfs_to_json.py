"""
国考行测 PDF 解析脚本
从 PDF 中提取题目、选项、答案、解析，输出结构化 JSON

资料分析（mod_data）特殊处理：
- 材料块（文字/图表）作为 material 字段
- 每道小题引用材料，但独立存储
"""

import json
import os
import re
import pdfplumber
from collections import OrderedDict
from pathlib import Path

# ========== 配置 ==========
PDF_BASE = r"D:\浏览器下载\全国各省34省+国考【历年真-题】\34省考+国考pdf版【推荐用这个版本】\国考2000-2025真题pdf 【推荐用这个版本】\2000-2025国考行测PDF"
Q_DIR = os.path.join(PDF_BASE, "行测-真题")
A_DIR = os.path.join(PDF_BASE, "行测-答案及解析")

OUTPUT_DIR = Path(__file__).parent.parent / "cloudfunctions" / "parsed_questions"

# 模块映射
MODULE_PATTERNS = OrderedDict({
    '常识判断': 'mod_common_sense',
    '常识': 'mod_common_sense',          # 有些年份只写"常识"
    '言语理解': 'mod_language',
    '言语理解与表达': 'mod_language',
    '数量关系': 'mod_quantity',
    '判断推理': 'mod_logic',
    '资料分析': 'mod_data',
})

# Section header patterns (to find module boundaries in PDF text)
SECTION_RE = re.compile(
    r'([一二三四五六七八九十]+)[、.．]\s*(常识判断|常识|言语理解与表达|言语理解|数量关系|判断推理|资料分析)'
)

# 模块标题正则
MODULE_ID_MAP = {
    '常识判断': 'mod_common_sense', '常识': 'mod_common_sense',
    '言语理解与表达': 'mod_language', '言语理解': 'mod_language',
    '数量关系': 'mod_quantity',
    '判断推理': 'mod_logic',
    '资料分析': 'mod_data',
}

QUESTION_NUM_RE = re.compile(r'^\s*(\d{1,3})\s*$')
QUESTION_NUM_PREFIX_RE = re.compile(r'^\s*(\d{1,3})[、.．：]\s*(.+)')
OPT_START_RE = re.compile(r'^([A-D])[、.．]\s*(.*)')
MATERIAL_MARK_RE = re.compile(r'^[（(]([一二三四五六七八九十]+|[0-9]+)[）)]\s*(.*)')

# 模块标题匹配（兼容多种格式）
# 格式A: 一、常识判断（2007-2020）
# 格式B: 一. 常识判断（2024-2025, 半角点）
# 格式C: 第一部分 常识判断（2000-2006, 2021）
MODULE_HEADER_RE_CN = re.compile(
    r'^[一二三四五六七八九十]+[、.．]\s*(常识判断|常识|言语理解与表达|言语理解|数量关系|判断推理|资料分析)'
)
MODULE_HEADER_RE_PART = re.compile(
    r'^第[一二三四五六七八九十\d]+部分\s*(常识判断|常识|言语理解与表达|言语理解|数量关系|判断推理|资料分析)'
)
# 数字编号格式: 1. 常识判断, 2.言语理解...
MODULE_HEADER_RE_NUM = re.compile(
    r'^\d+\s*[.、．]\s*(常识判断|常识|言语理解与表达|言语理解|数量关系|判断推理|资料分析)'
)

# 答案正则（多格式支持）
ANSWER_RE_LIST = [
    re.compile(r'故正确答案为\s*([A-D])[.。]'),     # 2007-2019 标准格式
    re.compile(r'因此[，,]选择\s*([A-D])\s*选项[.。]'),  # 2022+ 格式
    re.compile(r'选择\s*([A-D])\s*选项[.。]'),       # 2022+ 简写
    re.compile(r'正确答案[是为]?\s*([A-D])[.。]'),     # 通用格式
    re.compile(r'本题答案为\s*([A-D])[.。]'),         # 部分年份
    re.compile(r'答案为\s*([A-D])[.。]'),             # 简版
]

# Material marker: (一), (二), etc. in data analysis section
MATERIAL_RE = re.compile(r'^[（(]([一二三四五六七八九十]+|[0-9]+)[）)]\s*$')

# Material instruction line: 根据以下资料，回答116—120题
def parse_material_range(line):
    """解析材料指令行，返回 (start, end) 或 None"""
    m = re.search(r'回答\s*(\d{1,3})\s*[—\-~]\s*(\d{1,3})\s*题', line)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None

# Year extraction from filename
YEAR_RE = re.compile(r'(\d{4})年')

# Paper type from filename
PAPER_TYPE_MAP = {
    '副省': '副省级',
    '副省级': '副省级',
    '省级': '副省级',
    '地市级': '地市级',
    '地市': '地市级',
    '市地级': '地市级',
    '行政执法': '行政执法卷',
    '行政': '行政执法卷',
    'A卷': 'A卷',
    'B卷': 'B卷',
    '（一）': '卷一',
    '（二）': '卷二',
}


def normalize_text(text):
    """清理文本：统一括号/空格/换行"""
    if not text:
        return ''
    # 统一全角半角
    text = text.replace('\ufeff', '')
    # 合并连续空格/换行
    text = re.sub(r'\s+', '', text)
    return text.strip()


def extract_page_text(page):
    """从 pdfplumber page 提取并清理文本"""
    try:
        text = page.extract_text()
        if not text:
            return ''
        return text
    except Exception:
        return ''


def parse_year_from_name(name):
    """从文件名提取年份"""
    m = YEAR_RE.search(name)
    return int(m.group(1)) if m else 0


def parse_paper_info(name):
    """从文件名提取试卷信息"""
    year = parse_year_from_name(name)
    province = '国家'
    position = ''

    for key, val in PAPER_TYPE_MAP.items():
        if key in name:
            position = val
            break

    # 尝试从文件名中提取
    paper_name = os.path.splitext(name)[0]
    paper_name = paper_name.replace('...', '').strip()

    return year, province, position, paper_name


def match_answer_pdf(q_name, a_files):
    """匹配答案 PDF"""
    q_base = os.path.splitext(q_name)[0].replace('...', '')
    
    # 年份 + 题类型
    year = parse_year_from_name(q_name)
    
    best = None
    best_score = 0
    for a_name in a_files:
        a_base = os.path.splitext(a_name)[0].replace('...', '')
        score = 0
        if str(year) in a_base:
            score += 10
        # 检查是否匹配（副省/地市/行政等）
        for key in ['副省', '地市', '市地', '行政', '省级', 'A卷', 'B卷']:
            if key in q_base and key in a_base:
                score += 5
        if '答案' in a_base or '解析' in a_base:
            score += 3
        if score > best_score:
            best_score = score
            best = a_name

    return best if best_score >= 10 else None


def extract_answer(text):
    """从解析文本中提取答案字母"""
    if not text:
        return ''
    for pattern in ANSWER_RE_LIST:
        m = pattern.search(text)
        if m:
            return m.group(1)
    return ''


def match_module_header(line):
    """检测模块标题行，返回 module_id 或 None"""
    if not line:
        return None
    for pattern in [MODULE_HEADER_RE_CN, MODULE_HEADER_RE_PART, MODULE_HEADER_RE_NUM]:
        m = pattern.match(line.strip())
        if m:
            label = m.group(1)
            return MODULE_ID_MAP.get(label, 'mod_unknown')
    return None


def parse_answer_pdf(pdf_path, expected_questions=None):
    """从答案 PDF 提取各题答案和解析
    
    支持多种格式，自动检测。
    expected_questions: 如果提供题目数量，便于验证。
    
    Returns: dict {question_number: {'answer': 'A', 'explanation': '...'}}
    """
    results = {}
    try:
        with pdfplumber.open(pdf_path) as pdf:
            full_text_parts = []
            for page in pdf.pages:
                text = extract_page_text(page)
                if text:
                    full_text_parts.append(text)
            full_text = '\n'.join(full_text_parts)
        
        # ---- 检测格式 ----
        # 2024 格式：有快速对答案块 "[1-5]BABCB..."
        quick_answer_map = {}
        if '快速对答案' in full_text or '【1-5】' in full_text:
            # 提取快速答案块
            for block in re.findall(r'【(\d+)[-~](\d+)】\s*([A-D]+)', full_text):
                start, end = int(block[0]), int(block[1])
                letters = list(block[2])
                for idx, letter in enumerate(letters):
                    quick_answer_map[start + idx] = letter
            # 也尝试提取单题快速答案
            for m in re.finditer(r'【(\d+)】\s*([A-D])', full_text):
                quick_answer_map[int(m.group(1))] = m.group(2)
        
        if quick_answer_map:
            # 2024 格式: 先用快速答案块填充答案
            for q_num, answer in quick_answer_map.items():
                results[q_num] = {'answer': answer, 'explanation': ''}
            # 再提取详细解析
            detail_segments = re.split(r'\n【(\d+)】\s*解析\s*', '\n' + full_text)
            for i in range(1, len(detail_segments), 2):
                try:
                    q_num = int(detail_segments[i])
                except (ValueError, IndexError):
                    continue
                explanation = detail_segments[i + 1].strip() if i + 1 < len(detail_segments) else ''
                # 截断在下一个【N】之前
                end_m = re.search(r'\n【(\d+)】', explanation)
                if end_m:
                    explanation = explanation[:end_m.start()]
                # 提取答案
                answer = extract_answer(explanation)
                if answer:
                    results[q_num] = {'answer': answer, 'explanation': explanation[:2000]}
                elif q_num in results:
                    results[q_num]['explanation'] = explanation[:2000]
            return results
        
        # ---- 2005 格式: N．X 【解析】... ----
        if re.search(r'\d+\s*[.．]\s*[A-D]\s*[【\[]\s*解析', full_text):
            segments = re.split(r'\n(\d+)\s*[.．]\s*([A-D])\s*[【\[]\s*解析[】\]]', full_text)
            for i in range(1, len(segments), 3):
                try:
                    q_num = int(segments[i])
                    answer = segments[i + 1]
                    explanation = segments[i + 2].strip() if i + 2 < len(segments) else ''
                    results[q_num] = {'answer': answer, 'explanation': explanation[:2000]}
                except (ValueError, IndexError):
                    continue
            if results:
                return results
        
        # ---- 通用格式: 尝试多种分割 ----
        # 先尝试 \nN\n 分割
        segments = re.split(r'\n(\d{1,3})\n', full_text)
        
        if len(segments) <= 3:
            # 尝试 \nN、 分割
            segments = re.split(r'\n(\d{1,3})[、]', '\n' + full_text)
        
        if len(segments) <= 3:
            # 尝试 \nN. 分割 (2022+)
            segments = re.split(r'\n(\d{1,3})\.\s*', '\n' + full_text)
        
        # 2021 格式: 答案在首行 "X Y\n解析\n..."
        if len(segments) <= 5:
            lines = full_text.strip().split('\n')
            # 首行可能是多题答案: "A D\n解析" 对应 Q1=A, Q2=D
            first_line = lines[0].strip() if lines else ''
            if re.match(r'^[A-D\s]+$', first_line) and len(lines) > 1 and '解析' in lines[1]:
                # 提取首行的答案
                letters = re.findall(r'[A-D]', first_line)
                for idx, letter in enumerate(letters, 1):
                    results[idx] = {'answer': letter, 'explanation': ''}
                # 后续行是解析
                segments = re.split(r'\n(\d{1,3})\.?\s*解析\s*', '\n\n'.join(lines[1:]))
                for i in range(1, len(segments), 2):
                    try:
                        q_num = int(segments[i])
                    except (ValueError, IndexError):
                        continue
                    explanation = segments[i + 1].strip() if i + 1 < len(segments) else ''
                    answer = extract_answer(explanation)
                    if answer and q_num not in results:
                        results[q_num] = {'answer': answer, 'explanation': explanation[:2000]}
                if results:
                    return results
        
        # ---- 标准分割后处理 ----
        for i in range(1, len(segments), 2):
            if i + 1 < len(segments):
                try:
                    q_num = int(segments[i])
                except (ValueError, IndexError):
                    continue
                if q_num < 1 or q_num > 200:
                    continue
                    
                text = segments[i + 1]
                answer = extract_answer(text)
                
                if answer:
                    explanation = text[:text.rfind(answer) - 5].strip() if text.rfind(answer) > 5 else text.strip()
                    explanation = re.sub(r'^本题考查[^。]+[。]', '', explanation).strip()
                    results[q_num] = {
                        'answer': answer,
                        'explanation': explanation[:2000]
                    }
    except Exception as e:
        print(f'    解析答案 PDF 出错: {e}')
    
    return results


def parse_question_pdf(pdf_path):
    """从题目 PDF 提取题目
    
    使用简单状态机：
    - SEEK: 寻找下一个题目
    - STEM: 收集题干
    - OPTIONS: 收集选项
    """
    # 收集所有页面的文本
    with pdfplumber.open(pdf_path) as pdf:
        all_lines = []
        for page in pdf.pages:
            text = extract_page_text(page)
            if not text:
                continue
            page_lines = text.split('\n')
            # 过滤页码（页面末尾的纯数字行，以及形如 -12- 的页码标记）
            page_lines = [ln for ln in page_lines if not re.match(r'^-\d{1,3}-$', ln.strip())]
            if page_lines:
                last = page_lines[-1].strip()
                if re.match(r'^\d{1,3}$', last) and len(last) <= 3:
                    page_lines = page_lines[:-1]
            all_lines.extend(page_lines)
    
    questions = []
    current_module = None
    in_data_analysis = False
    data_material = ''  # 资料分析共享材料
    
    i = 0
    n = len(all_lines)
    
    while i < n:
        line = all_lines[i].strip()
        
        # 跳过空行
        if not line:
            i += 1
            continue
        
        # ---------- 检测模块标题 ----------
        mod_id = match_module_header(line)
        if mod_id:
            current_module = mod_id
            in_data_analysis = (current_module == 'mod_data')
            if in_data_analysis:
                data_material = ''
            i += 1
            continue
        
        # ---------- 资料分析材料指令：根据以下资料，回答X—Y题 ----------
        if in_data_analysis and current_module == 'mod_data':
            mat_range = parse_material_range(line)
            if mat_range:
                data_material = ''
                # 把指令行本身也作为材料开头（便于调试）
                data_material = line
                i += 1
                # 继续收集材料文本直到遇到下一道小题
                while i < n:
                    cont = all_lines[i].strip()
                    if not cont:
                        i += 1
                        continue
                    if QUESTION_NUM_RE.match(cont) or QUESTION_NUM_PREFIX_RE.match(cont):
                        break
                    if match_module_header(cont):
                        i -= 1
                        break
                    if OPT_START_RE.match(cont):
                        break
                    data_material += cont
                    i += 1
                continue

        # ---------- 资料分析材料标记：(一) (二) 等 ----------
        if in_data_analysis and current_module == 'mod_data':
            mm = MATERIAL_MARK_RE.match(line)
            if mm:
                marker_text = mm.group(2).strip()
                if not marker_text:
                    # 空标记如（一）（二），仅清空旧材料，等待后续指令行
                    data_material = ''
                    i += 1
                    continue
                data_material = marker_text
                # 材料可能在后续行继续
                i += 1
                while i < n:
                    cont = all_lines[i].strip()
                    if not cont:
                        i += 1
                        continue
                    if QUESTION_NUM_RE.match(cont) or QUESTION_NUM_PREFIX_RE.match(cont):
                        break
                    if OPT_START_RE.match(cont):
                        break
                    if match_module_header(cont):
                        i -= 1  # 回退让外层处理
                        break
                    data_material += cont
                    i += 1
                continue
        
        # ---------- 检测题目编号 ----------
        qm = QUESTION_NUM_RE.match(line)
        
        if not qm:
            # 尝试 "数字、题干" 格式（如 2020 年 PDF）
            qm_prefix = QUESTION_NUM_PREFIX_RE.match(line)
            if qm_prefix:
                q_num = int(qm_prefix.group(1))
                stem_prefix = qm_prefix.group(2).strip()
                i += 1
                
                # 收集题干续行
                stem_parts = [stem_prefix]
                while i < n:
                    stem_line = all_lines[i].strip()
                    if not stem_line:
                        i += 1
                        continue
                    if QUESTION_NUM_RE.match(stem_line):
                        break
                    if QUESTION_NUM_PREFIX_RE.match(stem_line):
                        break
                    if OPT_START_RE.match(stem_line):
                        break
                    if match_module_header(stem_line):
                        break
                    stem_parts.append(stem_line)
                    i += 1
                
                stem = ''.join(stem_parts).strip()
                
                # 收集选项
                options = _collect_options(all_lines, i, n)
                i = _collect_options_end_i
                
                questions.append({
                    'question_number': q_num,
                    'module_id': current_module or 'mod_unknown',
                    'content': stem,
                    'material': data_material if in_data_analysis else '',
                    'options': options,
                    'source': os.path.basename(pdf_path),
                })
                continue
            else:
                # 非特殊行 → 在资料分析中可能是材料文本
                if in_data_analysis and len(line) > 20 and '？' not in line and '?' not in line:
                    data_material += line
                i += 1
                continue
        
        q_num = int(qm.group(1))
        i += 1
        
        # ===== 收集题干 =====
        stem_parts = []
        while i < n:
            stem_line = all_lines[i].strip()
            if not stem_line:
                i += 1
                continue
            # 停止条件
            if QUESTION_NUM_RE.match(stem_line):
                break
            if QUESTION_NUM_PREFIX_RE.match(stem_line):
                break
            if OPT_START_RE.match(stem_line):
                break
            if match_module_header(stem_line):
                break
            if MATERIAL_MARK_RE.match(stem_line) and in_data_analysis:
                break
            stem_parts.append(stem_line)
            i += 1
        
        stem = ''.join(stem_parts).strip()
        
        # 资料分析：检测题干是否为材料文本（无问号且很长）
        is_material = (
            in_data_analysis 
            and len(stem) > 80 
            and '？' not in stem 
            and '?' not in stem
        )
        
        if is_material:
            # 关键修正：如果后面紧跟真实选项，说明是真实题干，不能当作材料
            if i < n and OPT_START_RE.match(all_lines[i].strip()):
                is_material = False
        
        if is_material:
            data_material = stem
            # 如果后面没有选项，这只是一个材料块，跳过
            if i < n:
                next_line = all_lines[i].strip()
                if QUESTION_NUM_RE.match(next_line) or QUESTION_NUM_PREFIX_RE.match(next_line):
                    continue  # 纯材料块，跳过
            if not stem:
                continue
        
        # ===== 收集选项 =====
        options = _collect_options(all_lines, i, n)
        i = _collect_options_end_i
        
        # ===== 确定材料 =====
        material = ''
        if in_data_analysis and current_module == 'mod_data':
            material = data_material if data_material else ''
        
        # ===== 构建题目 =====
        if current_module is None:
            current_module = 'mod_unknown'
        
        questions.append({
            'question_number': q_num,
            'module_id': current_module,
            'content': stem,
            'material': material,
            'options': options,
            'source': os.path.basename(pdf_path),
        })
    
    return questions


# 用于 _collect_options 返回选项收集结束时的索引
_collect_options_end_i = 0


def _collect_options(lines, start_i, n):
    """收集选项，返回选项列表，设置 _collect_options_end_i"""
    global _collect_options_end_i
    i = start_i
    options = []
    
    while i < n:
        opt_line = lines[i].strip()
        if not opt_line:
            i += 1
            continue
        
        om = OPT_START_RE.match(opt_line)
        if om:
            opt_text = om.group(2).strip()
            
            # 检测同行多选项：在选项文本中查找 B、C、D 的标记
            # 如 "A、xxx B、xxx C、xxx D、xxx"
            split_parts = re.split(r'\s+(?=[B-D][、.．])', opt_text)
            if len(split_parts) > 1:
                # 同行包含多选项
                options.append(split_parts[0].strip())
                for part in split_parts[1:]:
                    # 移除选项标记
                    cleaned = re.sub(r'^[B-D][、.．]\s*', '', part).strip()
                    options.append(cleaned)
            else:
                options.append(opt_text)
            
            i += 1
            # 收集该选项的续行
            while i < n:
                cont = lines[i].strip()
                if not cont:
                    i += 1
                    continue
                if OPT_START_RE.match(cont):
                    break
                if QUESTION_NUM_RE.match(cont):
                    break
                if QUESTION_NUM_PREFIX_RE.match(cont):
                    break
                if match_module_header(cont):
                    break
                if options:
                    options[-1] += cont
                i += 1
        elif QUESTION_NUM_RE.match(opt_line) or QUESTION_NUM_PREFIX_RE.match(opt_line):
            break
        elif match_module_header(opt_line):
            break
        else:
            i += 1
    
    _collect_options_end_i = i
    return options


def clean_options(options):
    """清理选项：去除多余空格，统一格式"""
    cleaned = []
    for opt in options:
        opt = opt.strip()
        # 移除以 A. B. 等开头的选项标记（可能出现在文本中）
        opt = re.sub(r'^[A-D][.、．]\s*', '', opt)
        if opt:
            cleaned.append(opt)
    return cleaned


def match_answers(questions, answers):
    """将答案信息匹配到题目"""
    for q in questions:
        q_num = q.get('question_number')
        if q_num and q_num in answers:
            q['answer'] = answers[q_num]['answer']
            q['explanation'] = answers[q_num]['explanation']
        else:
            q['answer'] = ''
            q['explanation'] = ''


def create_question_id(paper_name, q_num, module_id):
    """生成题目唯一 ID"""
    safe_name = re.sub(r'[^\w\u4e00-\u9fff]', '_', paper_name)[:30]
    return f'q_{safe_name}_{module_id}_{q_num:03d}'


def process_all_pdfs():
    """处理所有 PDF"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    q_files = sorted([f for f in os.listdir(Q_DIR) if f.endswith('.pdf')])
    a_files = sorted([f for f in os.listdir(A_DIR) if f.endswith('.pdf')])
    
    all_questions = []
    batch_size = 500
    batch_num = 1
    stats = {'total': 0, 'mod_data': 0, 'with_answer': 0}
    
    print(f'找到 {len(q_files)} 个题目 PDF, {len(a_files)} 个答案 PDF')
    print()
    
    for idx, q_fname in enumerate(q_files):
        q_path = os.path.join(Q_DIR, q_fname)
        year, province, position, paper_name = parse_paper_info(q_fname)
        
        print(f'[{idx+1}/{len(q_files)}] {q_fname}')
        print(f'    年份: {year}, 类型: {position}')
        
        # 匹配答案 PDF
        a_fname = match_answer_pdf(q_fname, a_files)
        if a_fname:
            a_path = os.path.join(A_DIR, a_fname)
            print(f'    答案: {a_fname}')
        else:
            a_path = None
            print(f'    ⚠ 未找到匹配的答案 PDF')
        
        # 解析题目
        try:
            questions = parse_question_pdf(q_path)
        except Exception as e:
            print(f'    ❌ 解析题目失败: {e}')
            continue
        
        # 解析答案
        answers = {}
        if a_path:
            try:
                answers = parse_answer_pdf(a_path)
                print(f'    提取了 {len(answers)} 个答案')
            except Exception as e:
                print(f'    ❌ 解析答案失败: {e}')
        
        # 匹配
        match_answers(questions, answers)
        
        # 添加元数据
        for q in questions:
            q['year'] = year
            q['province'] = province
            q['position'] = position
            q['paper_name'] = paper_name
            q['paper_id'] = f'{year}_{position}' if position else str(year)
            q['_id'] = create_question_id(paper_name, q.get('question_number', 0), q.get('module_id', 'unknown'))
            q['module_id'] = q.get('module_id', 'mod_unknown')
            q['type'] = 'single'
            q['difficulty'] = '中等'
            q['tags'] = []
            q['options'] = clean_options(q.get('options', []))
            
            stats['total'] += 1
            if q['module_id'] == 'mod_data':
                stats['mod_data'] += 1
            if q.get('answer'):
                stats['with_answer'] += 1
        
        all_questions.extend(questions)
        
        # 分批输出
        while len(all_questions) >= batch_size:
            batch = all_questions[:batch_size]
            output_path = OUTPUT_DIR / f'batch_{batch_num:02d}.json'
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(batch, f, ensure_ascii=False, indent=2)
            print(f'    输出: {output_path} ({len(batch)} 题)')
            all_questions = all_questions[batch_size:]
            batch_num += 1
        
        print(f'    本卷提取 {len(questions)} 题')
        print()
    
    # 输出剩余
    if all_questions:
        output_path = OUTPUT_DIR / f'batch_{batch_num:02d}.json'
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(all_questions, f, ensure_ascii=False, indent=2)
        print(f'    输出: {output_path} ({len(all_questions)} 题)')
    
    # 输出统计
    print()
    print('=' * 50)
    print(f'总计提取: {stats["total"]} 题')
    print(f'资料分析: {stats["mod_data"]} 题')
    print(f'有答案: {stats["with_answer"]} 题')
    print(f'答案覆盖率: {stats["with_answer"]/max(stats["total"],1)*100:.1f}%')
    print(f'输出目录: {OUTPUT_DIR}')


if __name__ == '__main__':
    process_all_pdfs()
