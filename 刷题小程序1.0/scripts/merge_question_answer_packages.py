#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge a question V2 draft package with a standalone answer extraction."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


def image_block(source: str, media: dict[str, dict], context: str) -> dict:
    source = str(source or "").strip().replace("\\", "/")
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    asset_id = f"asset_{digest[:20]}"
    remote = bool(re.match(r"^(?:https?://|cloud://)", source, re.I))
    media.setdefault(asset_id, {
        "asset_id": asset_id,
        "path": source,
        "source_path": source,
        "mime": "external/url" if remote else "application/octet-stream",
        "extension": Path(source.split("?", 1)[0]).suffix.lower(),
        "bytes": 0,
        "sha256": digest,
        "requires_upload": not remote,
        "source_context": context,
    })
    return {"type": "image", "asset_id": asset_id, "src": source}


def merge(package: dict, extracted: dict, answer_task_id: str = "") -> dict:
    records = {int(item["question_no"]): item for item in extracted.get("records", []) if item.get("question_no")}
    solutions = {item.get("question_id"): item for item in package.get("solutions", [])}
    media = {item.get("asset_id"): item for item in package.get("media", []) if item.get("asset_id")}
    matched: list[int] = []
    missing: list[int] = []

    for question in package.get("questions", []):
        number = int(question.get("question_no") or question.get("question_number") or 0)
        record = records.get(number)
        if not record:
            missing.append(number)
            continue
        matched.append(number)
        answer_index = record.get("answer_index")
        verified = bool(record.get("answer_verified")) and isinstance(answer_index, int) and 0 <= answer_index <= 3
        if verified:
            question["answer"] = answer_index
            question["answer_index"] = answer_index
            question["answer_verified"] = True

        solution = solutions.get(question.get("_id"))
        if solution is None:
            solution = {
                "_id": f"solution_{question.get('_id')}",
                "question_id": question.get("_id"),
                "paper_id": package.get("paper_id") or question.get("paper_id"),
                "status": "draft",
                "schema_version": 2,
            }
            package.setdefault("solutions", []).append(solution)
            solutions[question.get("_id")] = solution
        solution["answer"] = answer_index if verified else None
        solution["answer_verified"] = verified
        solution["explanation"] = str(record.get("explanation") or "").strip()
        blocks = []
        if solution["explanation"]:
            blocks.append({"type": "text", "text": solution["explanation"]})
        explanation_images = [str(value).replace("\\", "/") for value in record.get("explanation_images", [])]
        for source in explanation_images:
            blocks.append(image_block(source, media, f"solution.{number}"))
        solution["explanation_blocks"] = blocks
        solution["explanation_images"] = explanation_images
        evidence = question.setdefault("source_evidence", {})
        evidence["answer_task_id"] = answer_task_id
        evidence["answer_raw_text"] = record.get("raw_text") or ""
        evidence["answer_images"] = explanation_images

    package["media"] = list(media.values())
    package["answer_source_task_id"] = answer_task_id
    package["pair_merge"] = {
        "question_count": len(package.get("questions", [])),
        "answer_record_count": len(records),
        "matched_count": len(matched),
        "answer_count": sum(1 for q in package.get("questions", []) if q.get("answer_verified") is True),
        "explanation_count": sum(1 for s in package.get("solutions", []) if s.get("explanation") or s.get("explanation_images")),
        "missing_question_numbers": missing,
        "extra_answer_numbers": sorted(set(records) - set(matched)),
    }

    # Rebuild answer/explanation validation after the merge.  Structural
    # errors produced by the question parser are preserved.
    errors = [item for item in package.get("validation_errors", [])
              if not (str(item.get("path", "")).endswith(".answer")
                      or "答案尚未识别" in str(item.get("message", "")))]
    solution_by_question = {item.get("question_id"): item for item in package.get("solutions", [])}
    for index, question in enumerate(package.get("questions", [])):
        if question.get("answer_verified") is not True:
            errors.append({"path": f"questions.{index}.answer", "message": "答案卷未匹配到明确的A-D答案，请人工复核"})
        solution = solution_by_question.get(question.get("_id"), {})
        if not solution.get("explanation") and not solution.get("explanation_images"):
            errors.append({"path": f"solutions.{index}.explanation", "message": "答案卷未匹配到解析，请人工复核"})
    package["validation_errors"] = errors
    if missing:
        package.setdefault("validation_warnings", []).append({
            "path": "pair_merge.missing_question_numbers",
            "message": "以下题号未在答案解析卷中匹配：" + ", ".join(map(str, missing[:40])) + ("…" if len(missing) > 40 else ""),
        })
    return package


def main() -> None:
    parser = argparse.ArgumentParser(description="题目 V2 草稿 + 独立答案解析 -> 完整 V2 草稿")
    parser.add_argument("--package", required=True)
    parser.add_argument("--answers", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--answer-task-id", default="")
    args = parser.parse_args()
    package = json.loads(Path(args.package).read_text(encoding="utf-8"))
    answers = json.loads(Path(args.answers).read_text(encoding="utf-8"))
    merged = merge(package, answers, args.answer_task_id)
    Path(args.output).write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(merged["pair_merge"], ensure_ascii=False))


if __name__ == "__main__":
    main()
