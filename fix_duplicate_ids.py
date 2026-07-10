#!/usr/bin/env python3
"""
修复 parsed_questions.json 中的重复 _id，并重新生成 12 个 batch 文件。
用法：直接运行此脚本即可。
"""
import json
from pathlib import Path
from collections import Counter

ROOT = Path(r"C:\Users\hao\WorkBuddy\刷题小程序1.0")
PARSED = ROOT / "parsed_questions.json"
BATCH_DIR = ROOT / "刷题小程序1.0" / "cloudfunctions"

# 子函数目录与对应批次
FUNCTION_BATCHES = {
    "importQuestions1": [1, 2, 3],
    "importQuestions2": [4, 5, 6],
    "importQuestions3": [7, 8],
    "importQuestions4": [9, 10, 11, 12],
}


def load_questions():
    with open(PARSED, "r", encoding="utf-8") as f:
        return json.load(f)


def fix_duplicate_ids(questions):
    """确保所有 _id 唯一：重复的 ID 追加自增计数"""
    seen = {}
    fixed = []
    for q in questions:
        qid = q["_id"]
        if qid in seen:
            seen[qid] += 1
            new_id = f"{qid}_{seen[qid]}"
            q = {**q, "_id": new_id}
        else:
            seen[qid] = 0
        fixed.append(q)
    return fixed


def save_questions(questions):
    with open(PARSED, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)


def split_batches(questions, batch_size=500):
    """按固定大小切分批次"""
    return [questions[i:i + batch_size] for i in range(0, len(questions), batch_size)]


def save_batches(batches):
    """保存 batch_01.json ~ batch_12.json 到各子函数目录"""
    for idx, batch in enumerate(batches, 1):
        bname = f"batch_{idx:02d}.json"
        # 找到这个批次属于哪个子函数目录
        target_fn = None
        for fn, batches_in_fn in FUNCTION_BATCHES.items():
            if idx in batches_in_fn:
                target_fn = fn
                break
        if not target_fn:
            raise ValueError(f"批次 {idx} 没有对应子函数目录")
        target_dir = BATCH_DIR / target_fn
        target_dir.mkdir(parents=True, exist_ok=True)
        with open(target_dir / bname, "w", encoding="utf-8") as f:
            json.dump(batch, f, ensure_ascii=False, indent=2)
        print(f"  已写入 {target_fn}/{bname} ({len(batch)} 题)")


def main():
    print(f"读取 {PARSED} ...")
    questions = load_questions()
    total = len(questions)
    unique = len({q["_id"] for q in questions})
    print(f"原始：{total} 条，唯一 ID：{unique} 条，重复：{total - unique} 条")

    print("\n修复重复 ID ...")
    fixed = fix_duplicate_ids(questions)
    print(f"修复后：{len(fixed)} 条，唯一 ID：{len({q['_id'] for q in fixed})} 条")

    print("\n写回 parsed_questions.json ...")
    save_questions(fixed)

    print("\n重新生成 12 个 batch 文件 ...")
    batches = split_batches(fixed)
    save_batches(batches)

    print(f"\n完成：共 {len(batches)} 个批次，{len(fixed)} 道题。")
    print("请清空数据库后重新部署 4 个子函数并导入。")


if __name__ == "__main__":
    main()
