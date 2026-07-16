#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MinerU 切割结果 -> 确定性结构化兜底（架构2 第四步的"AI 结构化"兜底版）。

输入：split_questions.py 产出的 raw_questions.json
输出：question_drafts.json（每条 status=pending，供人工/AI 审核）

本脚本只做"格式标准化"，不调用大模型、不重新 OCR：
- type：按模块推断（资料分析 / 图形推理 / 单选）
- stem：题干（剥离首选项之前的正文）
- options：结构化 [{key,text,image}]
- answer：留空（确定性无法判定，交由 AI/人工补全）
- knowledge_points：按模块归类
- difficulty：按模块难度基线（数量/资料=hard，判断=medium，其余=easy）
- confidence：随题干质量递减（选项越不全、文本越短 -> 越低），提示人工优先复核

LLM 接口：structure_with_llm() 为预留钩子，接入真实大模型时替换该函数即可，
其余流程（落库、审核）无需改动。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# 复用切割脚本里的选项解析与图片提取逻辑，保证 stem/options 一致
sys.path.insert(0, str(Path(__file__).resolve().parent))
import split_questions as sq  # noqa: E402


# ── 模块 -> 难度 / 题型 / 知识点 ──────────────────────────────
MODULE_DIFFICULTY = {
    "政治理论": "easy",
    "常识判断": "easy",
    "言语理解与表达": "easy",
    "数量关系": "hard",
    "判断推理": "medium",
    "资料分析": "hard",
}

MODULE_IDS = {
    "政治理论": "mod_common_sense",
    "常识判断": "mod_common_sense",
    "言语理解与表达": "mod_language",
    "数量关系": "mod_quantity",
    "判断推理": "mod_logic",
    "资料分析": "mod_data",
    "综合题": "mod_language",
}

MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")

OPTION_RE = re.compile(r"(?<![A-Za-z0-9])([A-Da-d])\s*[.．、:：]\s*")


def extract_stem_and_options(raw_text: str):
    """返回 (stem, options_struct)。options_struct = [{key,text,image}]。"""
    opts = sq.split_options(raw_text)
    opt_struct = [
        {
            "key": o["key"],
            "text": o["text"],
            "image": (o["images"][0] if o["images"] else None),
        }
        for o in opts
    ]
    # 题干 = 首个选项（文字或图片）之前的正文
    earliest = len(raw_text)
    for o in opts:
        for img in o["images"]:
            p = raw_text.find(f"]({img})")
            if p != -1 and p < earliest:
                earliest = p
        if o["text"]:
            m = re.search(re.escape(o["key"]) + r"\s*[.．、:：]\s*", raw_text)
            if m and m.start() < earliest:
                earliest = m.start()
    stem = raw_text[:earliest].strip() if earliest < len(raw_text) else raw_text.strip()
    return stem, opt_struct


def infer_type(module: str, raw_text: str, opt_struct: list[dict]) -> str:
    if module == "资料分析":
        return "资料分析"
    if module == "判断推理":
        has_img_opt = any(o["image"] for o in opt_struct)
        if has_img_opt or "图形" in raw_text[:40]:
            return "图形推理"
        return "判断推理"
    return "single"


def infer_confidence(raw_text: str, option_count: int) -> float:
    """随题干质量递减：选项越不全、文本越短 -> 越低。"""
    base = {
        4: 0.90,
        3: 0.70,
        2: 0.50,
    }.get(option_count, 0.30)
    # 文本过短（疑为碎片）再降一档
    if len(raw_text.strip()) < 25:
        base = min(base, 0.30)
    return round(base, 2)


def clean_visible_text(value: str) -> str:
    value = MARKDOWN_IMAGE_RE.sub("", value or "")
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def register_image(source: str, media: dict[str, dict], context: str) -> dict:
    """Create a stable V2 image block without pretending a local file is cloud-ready."""
    source = str(source or "").strip().replace("\\", "/")
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    asset_id = f"asset_{digest[:20]}"
    is_remote = bool(re.match(r"^(?:https?://|cloud://)", source, re.I))
    media.setdefault(asset_id, {
        "asset_id": asset_id,
        "path": source,
        "source_path": source,
        "mime": "external/url" if is_remote else "application/octet-stream",
        "extension": Path(source.split("?", 1)[0]).suffix.lower(),
        "bytes": 0,
        "sha256": digest,
        "requires_upload": not is_remote,
        "source_context": context,
    })
    return {"type": "image", "asset_id": asset_id, "src": source}


def build_text_blocks(value: str) -> list[dict]:
    visible = clean_visible_text(value)
    return [{"type": "text", "text": visible}] if visible else []


def structure_one(raw_q: dict, task_id: str, paper_id: str,
                  group_id: str, sequence: int, media: dict[str, dict]) -> tuple[dict, dict]:
    raw = raw_q.get("raw_text", "")
    stem, opt_struct = extract_stem_and_options(raw)
    module = raw_q.get("module", "")
    option_count = raw_q.get("option_count", len(opt_struct))
    q_no = raw_q.get("question_no", 0)
    q_id = f"q_{paper_id}_{q_no:03d}"
    stem = re.sub(rf"^\s*#{{0,6}}\s*{q_no}\s*[.．、]\s*", "", stem).strip()

    # Keep explicit Markdown images in their semantic position. Images detected
    # only by page coordinates remain source evidence until a reviewer assigns them.
    stem_image_sources = MARKDOWN_IMAGE_RE.findall(stem)
    evidence_images = list(dict.fromkeys(str(item) for item in raw_q.get("images", []) if item))
    composite = False
    resolved_option_count = sum(
        1
        for item in opt_struct
        if (
            clean_visible_text(str(item.get("text", ""))).strip().upper()
            not in {"", "A", "B", "C", "D"}
            or item.get("image")
        )
    )
    image_heavy_composite = (
        module == "判断推理"
        # Page-level evidence may contain only one assigned image even though
        # the Markdown block itself contains the complete stem + A-D montage.
        and max(len(evidence_images), len(MARKDOWN_IMAGE_RE.findall(raw))) >= 4
        and resolved_option_count < 4
    )
    if (not opt_struct and evidence_images) or image_heavy_composite:
        # Common graph-reasoning layout: stem and A-D are one composite image.
        # The option labels are intentionally placeholders and publishing remains
        # blocked until review_confirmed is set by a human.
        opt_struct = [{"key": key, "text": "如上图所示", "image": None} for key in "ABCD"]
        composite = True
        if not stem_image_sources:
            stem_image_sources = evidence_images

    option_map = {str(item.get("key", "")).upper(): item for item in opt_struct}
    options_v2 = []
    for key in "ABCD":
        item = option_map.get(key, {})
        option_text = clean_visible_text(str(item.get("text", "")))
        option_blocks = build_text_blocks(option_text)
        image_source = item.get("image")
        if image_source:
            option_blocks.append(register_image(image_source, media, f"question.{q_no}.option.{key}"))
        options_v2.append({
            "key": key,
            "content_blocks": option_blocks,
            "text": option_text,
            "images": [image_source] if image_source else [],
        })

    stem_blocks = build_text_blocks(stem)
    for source in stem_image_sources:
        stem_blocks.append(register_image(source, media, f"question.{q_no}.stem"))

    confidence = infer_confidence(raw, option_count)
    question = {
        "_id": q_id,
        "paper_id": paper_id,
        "group_id": group_id,
        "module_id": MODULE_IDS.get(module, "mod_language"),
        "question_number": q_no,
        "question_no": q_no,
        "sequence": sequence,
        "type": "single",
        "question_subtype": infer_type(module, raw, opt_struct),
        "content": clean_visible_text(stem),
        "stem": clean_visible_text(stem),
        "stem_blocks": stem_blocks,
        "stem_images": stem_image_sources,
        "options_v2": options_v2,
        "options": [item["text"] for item in options_v2],
        "option_images": [item["images"] for item in options_v2],
        "answer": None,
        "answer_index": None,
        "answer_verified": False,
        "knowledge_points": [module] if module else [],
        "difficulty": MODULE_DIFFICULTY.get(module, "medium"),
        "parser_confidence": confidence,
        "composite_options_in_stem": composite,
        "review_confirmed": False if composite else True,
        # 标记本地下游由云端 aiStruct 云函数（免费 hy3）做 AI 结构化，
        # 落库后由 aiStruct.structure_pending 消费；未配置 AI 时由该函数确定性兜底。
        "needs_ai_structure": True,
        "source_page": raw_q.get("page"),
        "source_evidence": {
            "task_id": task_id,
            "page": raw_q.get("page"),
            "raw_text": raw,
            "images": evidence_images,
            "parser_confidence": confidence,
        },
        "status": "draft",
        "schema_version": 2,
    }
    solution = {
        "_id": f"solution_{q_id}",
        "question_id": q_id,
        "paper_id": paper_id,
        "answer": None,
        "answer_verified": False,
        "explanation": "",
        "explanation_blocks": [],
        "explanation_images": [],
        "status": "draft",
        "schema_version": 2,
    }
    return question, solution


def structure_with_llm(raw_q: dict, task_id: str) -> dict:
    """大模型结构化钩子（云端 AI 版）。

    本地流水线不再直接调用大模型：先由 structure_one 产出 V2 草稿（确定性兜底，
    答案置空、保留 review_confirmed/answer_verified 要求），并打上
    needs_ai_structure=True 标记。落库后由 aiStruct 云函数（免费 HunYuan hy3）
    在云端完成 answer/knowledge_points/difficulty/analysis 的 AI 结构化与回写。

    返回与 structure_one 相同结构的 dict，仅额外保证 needs_ai_structure=True。
    其余落库/审核逻辑无需改动。
    """
    question, solution = structure_one(raw_q, task_id)
    question["needs_ai_structure"] = True
    return question, solution


def structure_package(raw: dict, task_id: str | None = None,
                      paper_id: str | None = None) -> dict:
    if not task_id:
        task_id = "task_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    if not paper_id:
        paper_id = "paper_" + re.sub(r"[^\w一-鿿-]+", "_", raw.get("paper_title", "unknown"))[:40]
    raw_questions = raw.get("questions", [])
    media: dict[str, dict] = {}
    groups: list[dict] = []
    questions: list[dict] = []
    solutions: list[dict] = []
    group_by_key: dict[str, dict] = {}
    data_index = 0

    for sequence, raw_q in enumerate(raw_questions, start=1):
        module = raw_q.get("module") or "综合题"
        module_code = MODULE_IDS.get(module, "mod_language")
        if module_code == "mod_data":
            group_key = f"{module_code}_{data_index // 5 + 1}"
            data_index += 1
        else:
            group_key = module_code

        if group_key not in group_by_key:
            group = {
                "_id": f"group_{paper_id}_{len(groups) + 1:02d}",
                "paper_id": paper_id,
                "module_id": module_code,
                "sequence": len(groups) + 1,
                "title": module,
                "question_ids": [],
                "material_blocks": [],
                "material_text": "",
                "material_images": [],
                "status": "draft",
                "schema_version": 2,
            }
            material = str(raw_q.get("material") or "").strip()
            if material:
                group["material_text"] = clean_visible_text(material)
                group["material_blocks"] = build_text_blocks(material)
                for source in MARKDOWN_IMAGE_RE.findall(material):
                    group["material_blocks"].append(register_image(source, media, f"group.{group['_id']}.material"))
                    group["material_images"].append(source)
            groups.append(group)
            group_by_key[group_key] = group

        group = group_by_key[group_key]
        question, solution = structure_one(raw_q, task_id, paper_id, group["_id"], sequence, media)
        group["question_ids"].append(question["_id"])
        questions.append(question)
        solutions.append(solution)

    title = raw.get("paper_title", "") or "OCR行测试卷"
    paper = {
        "_id": paper_id,
        "title": title,
        "year": 0,
        "exam_type": "xingce",
        "level": "general",
        "position": "通用",
        "source": "MinerU OCR",
        "question_count": len(questions),
        "group_count": len(groups),
        "status": "draft",
        "schema_version": 2,
    }

    validation_errors: list[dict] = []
    validation_warnings: list[dict] = []
    for index, question in enumerate(questions):
        if not question["content"] and not question["stem_blocks"]:
            validation_errors.append({"path": f"questions.{index}.stem_blocks", "message": "题干为空"})
        for option_index, option in enumerate(question["options_v2"]):
            if not option["text"] and not option["content_blocks"]:
                validation_errors.append({"path": f"questions.{index}.options_v2.{option_index}", "message": f"选项 {'ABCD'[option_index]} 为空"})
        validation_errors.append({"path": f"questions.{index}.answer", "message": "答案尚未识别，请人工或 AI 复核"})
        if question["parser_confidence"] <= 0.5:
            validation_warnings.append({"path": f"questions.{index}", "message": "OCR 结构置信度较低，需优先复核"})
        if question["composite_options_in_stem"]:
            validation_warnings.append({"path": f"questions.{index}.review_confirmed", "message": "题干与选项为合成图，请人工确认 A-D 顺序"})

    for group_index, group in enumerate(groups):
        if group["module_id"] == "mod_data" and len(group["question_ids"]) != 5:
            validation_errors.append({"path": f"groups.{group_index}.question_ids", "message": "资料分析材料组必须关联5道小题"})

    return {
        "schema_version": 2,
        "task_id": task_id,
        "paper_id": paper_id,
        "paper_title": title,
        "source": "mineru_ocr",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending_review",
        "count": len(questions),
        "paper": paper,
        "groups": groups,
        "questions": questions,
        "solutions": solutions,
        "media": list(media.values()),
        "validation_errors": validation_errors,
        "validation_warnings": validation_warnings,
    }


def main():
    ap = argparse.ArgumentParser(description="raw_questions.json -> question_drafts.json（确定性结构化）")
    ap.add_argument("--input", required=True, help="split_questions.py 产出的 raw_questions.json")
    ap.add_argument("--output", required=True, help="question_drafts.json 输出路径")
    ap.add_argument("--paper-id", default=None)
    ap.add_argument("--task-id", default=None)
    args = ap.parse_args()

    raw = json.loads(Path(args.input).read_text(encoding="utf-8"))
    result = structure_package(raw, args.task_id, args.paper_id)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[structure] task_id   : {result['task_id']}")
    print(f"[structure] paper_id  : {result['paper_id']}")
    print(f"[structure] count     : {result['count']}")
    low = [d["question_no"] for d in result["questions"] if d["parser_confidence"] <= 0.5]
    print(f"[structure] 低置信待复核: {len(low)} -> {low}")


if __name__ == "__main__":
    main()
