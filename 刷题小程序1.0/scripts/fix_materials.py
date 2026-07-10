"""
修复 资料分析（mod_data）题目的 material 字段。
支持两种 PDF 格式：
1. 含 "根据以下资料，回答 X—Y 题" 指令行
2. 无指令行，材料直接是图表或文字（常见于 2002-2004、2020-2023）
"""

import json
import os
import re
import pdfplumber
from pathlib import Path
from collections import defaultdict

PDF_BASE = r"D:\浏览器下载\全国各省34省+国考【历年真-题】\34省考+国考pdf版【推荐用这个版本】\国考2000-2025真题pdf 【推荐用这个版本】\2000-2025国考行测PDF"
Q_DIR = os.path.join(PDF_BASE, "行测-真题")
OUTPUT_DIR = Path(__file__).parent.parent / "cloudfunctions" / "parsed_questions"

# 匹配 "根据以下资料，回答 X—Y 题"
MATERIAL_RANGE_RE = re.compile(r'根据以下资料\s*,?\s*回答\s*(\d{1,3})\s*([—\-~～])\s*(\d{1,3})\s*题')
# 页码标记
PAGE_MARK_RE = re.compile(r'^-\d{1,3}-$')


def extract_page_text(page):
    try:
        text = page.extract_text()
        return text or ''
    except Exception:
        return ''


def extract_pdf_lines(pdf_path):
    all_lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = extract_page_text(page)
            if not text:
                continue
            page_lines = text.split('\n')
            page_lines = [ln for ln in page_lines if not PAGE_MARK_RE.match(ln.strip())]
            if page_lines:
                last = page_lines[-1].strip()
                if re.match(r'^\d{1,3}$', last) and len(last) <= 3:
                    page_lines = page_lines[:-1]
            all_lines.extend(page_lines)
    return all_lines


def looks_like_question_prefix(line):
    s = line.strip()
    if re.match(r'^\s*\d{1,3}\s*$', s):
        return True
    if re.match(r'^\s*\d{1,3}\s*[、.．：]\s*.+', s):
        return True
    return False


def looks_like_option(line):
    s = line.strip()
    return bool(re.match(r'^[A-D][、.．]\s*', s))


def extract_question_number(line):
    m = re.match(r'^\s*(\d{1,3})\s*[、.．：]\s*.+', line.strip())
    if m:
        return int(m.group(1))
    return None


def is_invalid_material(text):
    """判断材料是否无效（包含选项或问号）"""
    if not text:
        return True
    text = text.strip()
    # 包含 A-D 选项
    if re.search(r'[A-D][、.．]\s*', text):
        return True
    # 包含问号
    if '？' in text or '?' in text:
        return True
    return False


def is_module_header(line):
    """判断是否是模块标题行"""
    s = line.strip()
    # 如：第五部分 资料分析，或 五、资料分析
    if re.search(r'资料分析', s):
        return True
    return bool(re.search(r'^(第[一二三四五六七八九十\d]+部分|[一二三四五六七八九十]+[、.．])\s*(常识|言语|数量|判断|申论)', s))


def extract_section(lines, start_idx):
    """从模块标题开始提取资料分析区段，直到下一个模块或结束"""
    section_lines = []
    i = start_idx + 1
    n = len(lines)
    while i < n:
        line = lines[i].strip()
        # 下一个模块标题
        if is_module_header(line) and not re.search(r'资料分析', line):
            break
        section_lines.append(lines[i])
        i += 1
    return section_lines, i


def extract_materials_from_section(section_lines):
    """
    从资料分析区段提取材料块。
    返回 [(start_q, end_q, material_text), ...]
    """
    materials = []
    i = 0
    n = len(section_lines)
    
    while i < n:
        line = section_lines[i].strip()
        if not line:
            i += 1
            continue
        
        # 1. 指令行格式：根据以下资料，回答X—Y题
        m = MATERIAL_RANGE_RE.search(line)
        if m:
            start_q = int(m.group(1))
            end_q = int(m.group(3))
            material_text = line
            i += 1
            while i < n:
                cont = section_lines[i].strip()
                if not cont:
                    i += 1
                    continue
                if looks_like_question_prefix(cont) or looks_like_option(cont):
                    break
                if MATERIAL_RANGE_RE.search(cont):
                    break
                material_text += cont
                i += 1
            materials.append((start_q, end_q, material_text))
            continue
        
        # 2. 非指令行文字材料：长文本且后面跟着题目
        if len(line) > 20 and not looks_like_question_prefix(line) and not looks_like_option(line):
            # 向后看，如果后面是题目，则这段文字是材料
            material_text = line
            j = i + 1
            found_question = False
            while j < n and j < i + 30:
                cont = section_lines[j].strip()
                if not cont:
                    j += 1
                    continue
                if looks_like_question_prefix(cont):
                    found_question = True
                    break
                if looks_like_option(cont):
                    break
                material_text += cont
                j += 1
            
            if found_question:
                first_q = None
                for k in range(j, min(n, j + 20)):
                    q = extract_question_number(section_lines[k])
                    if q:
                        first_q = q
                        break
                if first_q is not None:
                    # 材料覆盖到下一个材料或区段结束，先按 5 题估算
                    materials.append((first_q, first_q + 4, material_text))
                    i = j
                    continue
        
        i += 1
    
    return materials


def extract_materials_from_pdf(pdf_path):
    """从单个 PDF 提取所有材料块"""
    lines = extract_pdf_lines(pdf_path)
    all_materials = []
    n = len(lines)
    i = 0
    
    while i < n:
        line = lines[i].strip()
        if re.search(r'资料分析', line) and not re.search(r'常识|言语|数量|判断|申论', line):
            section_lines, i = extract_section(lines, i)
            if section_lines:
                mats = extract_materials_from_section(section_lines)
                if mats:
                    all_materials.extend(mats)
            continue
        i += 1
    
    return all_materials


def year_from_filename(name):
    m = re.search(r'(\d{4})年', name)
    return int(m.group(1)) if m else 0


def paper_type_from_filename(name):
    for key in ['副省', '副省级', '省级', '地市', '地市级', '市地级', '行政']:
        if key in name:
            return key
    return ''


def fix_materials():
    all_questions = []
    for f in sorted(OUTPUT_DIR.glob('batch_*.json')):
        all_questions.extend(json.loads(f.read_text(encoding='utf-8')))

    # 先清空所有 mod_data 的无效 material
    cleared = 0
    for q in all_questions:
        if q.get('module_id') == 'mod_data' and is_invalid_material(q.get('material', '')):
            q['material'] = ''
            cleared += 1
    print(f'已清空 {cleared} 道无效 material')

    # 按 (year, position) 分组
    grouped = defaultdict(list)
    for q in all_questions:
        key = (q.get('year', 0), q.get('position', ''))
        grouped[key].append(q)

    # 遍历 PDF 重新提取材料
    q_files = sorted([f for f in os.listdir(Q_DIR) if f.endswith('.pdf')])
    fixed = 0
    for q_name in q_files:
        q_path = os.path.join(Q_DIR, q_name)
        year = year_from_filename(q_name)
        position = paper_type_from_filename(q_name)
        if not year:
            continue
        
        materials = extract_materials_from_pdf(q_path)
        if not materials:
            continue
        
        group = grouped.get((year, position), [])
        if not group:
            group = [q for q in all_questions if q.get('year') == year]
        
        mat_map = {}
        for start_q, end_q, mat_text in materials:
            for q_num in range(start_q, end_q + 1):
                existing = mat_map.get(q_num, '')
                if len(mat_text) > len(existing):
                    mat_map[q_num] = mat_text
        
        for q in group:
            if q.get('module_id') != 'mod_data':
                continue
            q_num = q.get('question_number', 0)
            if q_num in mat_map and mat_map[q_num] and not is_invalid_material(mat_map[q_num]):
                q['material'] = mat_map[q_num]
                fixed += 1
    
    print(f'已修复 {fixed} 道 material')

    # 重新写回 batch
    batch_size = 500
    batch_num = 1
    for i in range(0, len(all_questions), batch_size):
        batch = all_questions[i:i + batch_size]
        output_path = OUTPUT_DIR / f'batch_{batch_num:02d}.json'
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(batch, f, ensure_ascii=False, indent=2)
        print(f'输出: {output_path} ({len(batch)} 题)')
        batch_num += 1


if __name__ == '__main__':
    fix_materials()
