"""
修复答案：重新解析所有答案 PDF 并更新 batch JSON 文件中的 answer/explanation 字段
（只处理 answer 为空的题目）
"""
import json, os, sys, re, pdfplumber
sys.path.insert(0, os.path.dirname(__file__))
from parse_pdfs_to_json import parse_answer_pdf, match_answer_pdf, parse_paper_info

BATCH_DIR = os.path.join(os.path.dirname(__file__), '..', 'cloudfunctions', 'parsed_questions')
A_DIR = r"D:\浏览器下载\全国各省34省+国考【历年真-题】\34省考+国考pdf版【推荐用这个版本】\国考2000-2025真题pdf 【推荐用这个版本】\2000-2025国考行测PDF\行测-答案及解析"

total_updated = 0
total_questions = 0

batch_files = sorted(f for f in os.listdir(BATCH_DIR) if f.endswith('.json'))
a_files = sorted(os.listdir(A_DIR))

for bf in batch_files:
    batch_path = os.path.join(BATCH_DIR, bf)
    with open(batch_path, 'r', encoding='utf-8') as f:
        questions = json.load(f)
    
    batch_no_answer = [q for q in questions if not q.get('answer')]
    if not batch_no_answer:
        print(f'{bf}: 全部有答案，跳过 ({len(questions)} 题)')
        continue
    
    # 按 source (原始 PDF 文件名) 分组
    by_source = {}
    for q in batch_no_answer:
        src = q.get('source', '')
        if src not in by_source:
            by_source[src] = []
        by_source[src].append(q)
    
    updated = 0
    for src, qs in by_source.items():
        a_fname = match_answer_pdf(src, a_files)
        if not a_fname:
            continue
        a_path = os.path.join(A_DIR, a_fname)
        
        # 获取这些题目的答案范围
        q_nums = [q.get('question_number', 0) for q in qs]
        
        try:
            answers = parse_answer_pdf(a_path)
        except Exception as e:
            print(f'  {src}: 解析答案失败 - {e}')
            continue
        
        for q in qs:
            q_num = q.get('question_number')
            if q_num and q_num in answers:
                q['answer'] = answers[q_num]['answer']
                q['explanation'] = answers[q_num].get('explanation', '')
                updated += 1
    
    if updated > 0:
        with open(batch_path, 'w', encoding='utf-8') as f:
            json.dump(questions, f, ensure_ascii=False, indent=2)
        print(f'{bf}: 修复 {updated}/{len(batch_no_answer)} 道，共 {len(questions)} 题')
    else:
        print(f'{bf}: 无法修复 {len(batch_no_answer)} 道，共 {len(questions)} 题')
    
    total_questions += len(questions)
    total_updated += updated

print(f'\n总计: {total_updated}/{total_questions} 题已修复答案')
