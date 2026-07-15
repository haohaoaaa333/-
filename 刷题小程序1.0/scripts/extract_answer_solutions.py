#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract answer/explanation records from a standalone answer PDF Markdown.

The answer books used by the project normally contain one numbered explanation
per question and finish with text such as ``正确答案为D``.  This script keeps
the complete OCR evidence and only accepts an explicit A-D answer; it never
guesses from the analysis.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
ANSWER_RE = re.compile(
    r"(?:正确答案|参考答案|本题答案|答案)\s*(?:为|是|选|[:：])?\s*([A-D])(?:\b|[。．、，,；;])",
    re.I,
)
HEADING_RE = re.compile(r"^\s*(?:#{1,6}\s*)?(\d{1,3})\s*(?:[.．、]\s*)?$", re.M)
INLINE_HEADING_RE = re.compile(r"^\s*(?:#{1,6}\s*)?(\d{1,3})\s*[.．、]\s*(?=\S)", re.M)
BRACKET_HEADING_RE = re.compile(
    r"^\s*(?:#{1,6}\s*)?[【\[]\s*(\d{1,3})\s*[】\]]\s*(?:答案)?解析\s*$",
    re.M,
)
ANSWER_TABLE_RE = re.compile(r"(?<!\d)(\d{1,3})\s*[.．、:：]\s*([A-D])(?:\b|\s|[，,；;])", re.I)
RANGE_ANSWER_TABLE_RE = re.compile(
    r"[【\[]\s*(\d{1,3})\s*[-—–至~～]\s*(\d{1,3})\s*[】\]]\s*([A-D](?:\s*[A-D])*)",
    re.I,
)


def split_numbered_blocks(markdown: str) -> list[tuple[int, str]]:
    # MinerU commonly emits answer books as ``## 【1】解析``.  Prefer these
    # explicit headings so page numbers or numbers inside formulas cannot cut
    # an explanation into the wrong question.
    candidates = list(BRACKET_HEADING_RE.finditer(markdown))
    if len(candidates) < 2:
        candidates = list(HEADING_RE.finditer(markdown))
    if len(candidates) < 2:
        candidates = list(INLINE_HEADING_RE.finditer(markdown))
    # Page footers in these PDFs are also bare numeric lines.  Accept only a
    # monotonically increasing question sequence, allowing a small OCR gap;
    # this prevents page number "2" from cutting question 5's explanation.
    matches = []
    expected = 1
    for match in candidates:
        number = int(match.group(1))
        if number == expected or (number > expected and number <= expected + 5):
            matches.append(match)
            expected = number + 1
    blocks: list[tuple[int, str]] = []
    for index, match in enumerate(matches):
        number = int(match.group(1))
        if number < 1 or number > 200:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        body = markdown[match.end():end].strip()
        if not body:
            continue
        blocks.append((number, body))
    return blocks


def extract(markdown: str) -> dict:
    records: dict[int, dict] = {}
    for number, body in split_numbered_blocks(markdown):
        answers = ANSWER_RE.findall(body)
        letter = answers[-1].upper() if answers else None
        images = [value.strip().replace("\\", "/") for value in IMAGE_RE.findall(body)]
        visible = IMAGE_RE.sub("", body).strip()
        records[number] = {
            "question_no": number,
            "answer": letter,
            "answer_index": "ABCD".index(letter) if letter else None,
            "answer_verified": bool(letter),
            "explanation": visible,
            "explanation_images": images,
            "raw_text": body,
        }

    # Some books start with a compact answer table.  It may fill a missing
    # answer, but must not overwrite a more specific per-question conclusion.
    for match in ANSWER_TABLE_RE.finditer(markdown):
        number = int(match.group(1))
        letter = match.group(2).upper()
        record = records.setdefault(number, {
            "question_no": number,
            "answer": None,
            "answer_index": None,
            "answer_verified": False,
            "explanation": "",
            "explanation_images": [],
            "raw_text": "",
        })
        if not record["answer_verified"]:
            record["answer"] = letter
            record["answer_index"] = "ABCD".index(letter)
            record["answer_verified"] = True

    # Compact tables produced by MinerU look like ``【1-5】BCDAA``.  Expand
    # each range deterministically and use it only to fill answers that were
    # not already confirmed by the per-question explanation.
    for match in RANGE_ANSWER_TABLE_RE.finditer(markdown):
        start = int(match.group(1))
        end = int(match.group(2))
        letters = re.sub(r"\s+", "", match.group(3)).upper()
        if start < 1 or end < start or end > 200 or len(letters) != end - start + 1:
            continue
        for offset, letter in enumerate(letters):
            number = start + offset
            record = records.setdefault(number, {
                "question_no": number,
                "answer": None,
                "answer_index": None,
                "answer_verified": False,
                "explanation": "",
                "explanation_images": [],
                "raw_text": "",
            })
            if not record["answer_verified"]:
                record["answer"] = letter
                record["answer_index"] = "ABCD".index(letter)
                record["answer_verified"] = True

    ordered = [records[number] for number in sorted(records)]
    return {
        "records": ordered,
        "count": len(ordered),
        "answer_count": sum(1 for item in ordered if item["answer_verified"]),
        "explanation_count": sum(1 for item in ordered if item["explanation"] or item["explanation_images"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="独立答案解析 Markdown -> 按题号答案/解析 JSON")
    parser.add_argument("--markdown", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    source = Path(args.markdown).read_text(encoding="utf-8")
    result = extract(source)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("count", "answer_count", "explanation_count")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
