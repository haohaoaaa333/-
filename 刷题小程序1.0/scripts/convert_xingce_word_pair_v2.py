#!/usr/bin/env python3
"""Convert paired Xingce question/solution DOCX files into a V2 bank package.

The V2 package preserves mixed text/image order and models shared data-analysis
materials as groups instead of duplicating material on every child question.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn


MODULES = [
    ("mod_common_sense", "一、常识判断", "二、言语理解", range(1, 21)),
    ("mod_language", "二、言语理解", "三、数量关系", range(21, 61)),
    ("mod_quantity", "三、数量关系", "四、判断推理", range(61, 71)),
    ("mod_logic", "四、判断推理", "五、资料分析", range(71, 111)),
    ("mod_data", "五、资料分析", "", range(111, 131)),
]
OPTION_RE = re.compile(r"(?<![A-Za-z])([A-D])\s*[、.．]\s*")
PAGE_NOISE_RE = re.compile(r"^(?:第?\d+页(?:共\d+页)?|[-—]\s*\d+\s*[-—])$")
PURE_PAGE_NUMBER_RE = re.compile(r"^\d{1,3}$")
ANSWER_PATTERNS = [
    r"故\s*正确答案\s*为\s*([A-D])",
    r"正确答案\s*为\s*([A-D])",
    r"本题答案\s*为\s*([A-D])",
    r"答案\s*为\s*([A-D])\s*项",
    r"应该选择\s*([A-D])",
    r"应选\s*([A-D])",
    r"选择\s*([A-D])\s*选项",
]


def normalize_text(value: str) -> str:
    value = value.replace("\u3000", " ").replace("\xa0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def slugify(value: str) -> str:
    value = re.sub(r"\s+", "_", value)
    value = re.sub(r"[^\w\u4e00-\u9fff-]+", "", value)
    return value.strip("_")[:72] or "xingce-paper"


def content_hash(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


@dataclass
class Media:
    asset_id: str
    path: str
    mime: str
    extension: str
    bytes: int
    sha256: str
    source_rid: str
    source_part: str

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class Event:
    kind: str
    body_index: int
    text: str = ""
    asset_id: str = ""
    public_path: str = ""
    start: int = 0
    end: int = 0


@dataclass
class DocumentStream:
    text: str
    events: list[Event]
    media: dict[str, Media]
    block_ends: dict[int, int] = field(default_factory=dict)

    def blocks_for_span(self, start: int, end: int) -> list[dict]:
        blocks: list[dict] = []
        for event in self.events:
            if event.kind == "text":
                left = max(start, event.start)
                right = min(end, event.end)
                if left >= right:
                    continue
                value = normalize_text(event.text[left - event.start:right - event.start])
                if value:
                    if blocks and blocks[-1]["type"] == "text":
                        blocks[-1]["text"] = normalize_text(blocks[-1]["text"] + "\n" + value)
                    else:
                        blocks.append({"type": "text", "text": value})
            elif start <= event.start < end:
                blocks.append({"type": "image", "asset_id": event.asset_id, "src": event.public_path})
        return blocks


class DocxStreamReader:
    def __init__(self, path: Path, images_dir: Path, public_prefix: str) -> None:
        self.path = path
        self.doc = Document(str(path))
        self.images_dir = images_dir
        self.public_prefix = public_prefix.rstrip("/")
        self.media: dict[str, Media] = {}
        self.rel_parts = {
            rid: rel.target_part
            for rid, rel in self.doc.part.rels.items()
            if "image" in rel.reltype
        }

    def export_image(self, rid: str) -> tuple[str, str]:
        part = self.rel_parts[rid]
        blob = part.blob
        digest = content_hash(blob)
        asset_id = f"asset_{digest[:20]}"
        ext = Path(part.partname).suffix.lower() or ".png"
        filename = f"{digest[:24]}{ext}"
        target = self.images_dir / filename
        if not target.exists():
            target.write_bytes(blob)
        if asset_id not in self.media:
            mime = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
            }.get(ext, "application/octet-stream")
            self.media[asset_id] = Media(
                asset_id=asset_id,
                path=f"{self.public_prefix}/{filename}",
                mime=mime,
                extension=ext,
                bytes=len(blob),
                sha256=digest,
                source_rid=rid,
                source_part=str(part.partname),
            )
        return asset_id, self.media[asset_id].path

    def iter_atomic(self, element, body_index: int):
        text_buffer: list[str] = []

        def flush_text():
            if text_buffer:
                value = "".join(text_buffer)
                text_buffer.clear()
                if value:
                    return Event(kind="text", body_index=body_index, text=value)
            return None

        for node in element.iter():
            if node.tag.endswith("}t") and node.text:
                text_buffer.append(node.text)
            elif node.tag.endswith("}tab"):
                text_buffer.append("\t")
            elif node.tag.endswith("}br"):
                text_buffer.append("\n")
            elif node.tag.endswith("}blip"):
                rid = node.get(qn("r:embed"))
                pending = flush_text()
                if pending:
                    yield pending
                if rid and rid in self.rel_parts:
                    asset_id, public_path = self.export_image(rid)
                    yield Event(kind="image", body_index=body_index, asset_id=asset_id, public_path=public_path)
        pending = flush_text()
        if pending:
            yield pending

    def read(self) -> DocumentStream:
        raw_blocks: list[tuple[int, list[Event]]] = []
        for body_index, child in enumerate(self.doc.element.body.iterchildren()):
            if not (child.tag.endswith("}p") or child.tag.endswith("}tbl")):
                continue
            events = list(self.iter_atomic(child, body_index))
            visible_text = normalize_text("".join(event.text for event in events if event.kind == "text"))
            has_images = any(event.kind == "image" for event in events)
            if not has_images and visible_text and PAGE_NOISE_RE.fullmatch(visible_text):
                continue
            if visible_text or has_images:
                raw_blocks.append((body_index, events))

        text_parts: list[str] = []
        events: list[Event] = []
        position = 0
        block_ends: dict[int, int] = {}
        for body_index, block_events in raw_blocks:
            if text_parts:
                separator = "\n"
                text_parts.append(separator)
                position += len(separator)
            for event in block_events:
                if event.kind == "text":
                    event.start = position
                    text_parts.append(event.text)
                    position += len(event.text)
                    event.end = position
                else:
                    event.start = position
                    # Give every image a position in the logical document stream.
                    # Without this placeholder, trailing images in Word tables sit
                    # exactly on the span boundary and silently disappear.
                    text_parts.append("\ufffc")
                    position += 1
                    event.end = position
                events.append(event)
            block_ends[body_index] = position
        return DocumentStream(text="".join(text_parts), events=events, media=self.media, block_ends=block_ends)


def candidate_score(text: str, position: int, number: int) -> int:
    before = text[max(0, position - 8):position]
    after = text[position + len(str(number)):position + len(str(number)) + 24]
    stripped = after.lstrip()
    score = 0
    if position == 0 or text[position - 1] == "\n":
        score += 18
    elif text[position - 1].isspace():
        score += 7
    if stripped:
        first = stripped[0]
        if "\u4e00" <= first <= "\u9fff" or first in "“《（(":
            score += 9
        elif re.match(r"20\d{2}", stripped):
            score += 8
    if re.match(r"\s*(?:项|个|人|次|种|位|%|％|年|月|日)", after):
        score -= 20
    if re.search(r"[A-D]\s*[、.．]\s*$", before):
        score -= 18
    if before.endswith(("第", "约", "为")):
        score -= 8
    return score


def locate_sequence(text: str, numbers: list[int], start: int, end: int) -> dict[int, tuple[int, int]]:
    candidates: dict[int, list[tuple[int, int]]] = {}
    for number in numbers:
        rows = []
        for match in re.finditer(rf"(?<!\d){number}(?!\d)", text[start:end]):
            absolute = start + match.start()
            rows.append((absolute, candidate_score(text, absolute, number)))
        candidates[number] = rows
        if not rows:
            raise ValueError(f"未找到题号 {number}")

    states: dict[int, tuple[int, list[tuple[int, int, int]]]] = {}
    first = numbers[0]
    for pos, score in candidates[first]:
        states[pos] = (score, [(first, pos, pos + len(str(first)))])
    for number in numbers[1:]:
        next_states: dict[int, tuple[int, list[tuple[int, int, int]]]] = {}
        for pos, score in candidates[number]:
            best = None
            for prev_pos, (prev_score, path) in states.items():
                if prev_pos >= pos:
                    continue
                gap = pos - prev_pos
                total = prev_score + score - (25 if gap < 8 else 0)
                if best is None or total > best[0]:
                    best = (total, path + [(number, pos, pos + len(str(number)))])
            if best is not None:
                next_states[pos] = best
        if not next_states:
            raise ValueError(f"题号序列在 {number} 处中断")
        states = next_states
    _, best_path = max(states.values(), key=lambda item: item[0])
    return {number: (pos, marker_end) for number, pos, marker_end in best_path}


def module_bounds(text: str) -> dict[str, tuple[int, int, list[int]]]:
    result = {}
    for module_id, start_marker, end_marker, number_range in MODULES:
        start = text.find(start_marker)
        if start < 0:
            raise ValueError(f"未找到模块标题：{start_marker}")
        start += len(start_marker)
        end = text.find(end_marker, start) if end_marker else len(text)
        if end < 0:
            raise ValueError(f"未找到下一个模块标题：{end_marker}")
        result[module_id] = (start, end, list(number_range))
    return result


def find_option_markers(text: str, start: int, end: int) -> list[re.Match]:
    matches = list(OPTION_RE.finditer(text, start, end))
    for index, match in enumerate(matches):
        if match.group(1) != "A":
            continue
        selected = [match]
        cursor = index + 1
        for letter in "BCD":
            while cursor < len(matches) and matches[cursor].group(1) != letter:
                cursor += 1
            if cursor >= len(matches):
                break
            selected.append(matches[cursor])
            cursor += 1
        if len(selected) == 4:
            return selected
    return []


def blocks_text(blocks: list[dict]) -> str:
    return normalize_text("\n".join(block.get("text", "") for block in blocks if block.get("type") == "text"))


def image_paths(blocks: list[dict]) -> list[str]:
    return [block["src"] for block in blocks if block.get("type") == "image"]


def clean_content_blocks(blocks: list[dict], *, drop_page_numbers: bool = True) -> list[dict]:
    """Clean scanner/page artefacts after structural spans have been located."""
    result = []
    for block in blocks:
        if block.get("type") != "text":
            result.append(block)
            continue
        value = normalize_text(block.get("text", ""))
        value = re.sub(r"^\d{1,3}\s*\n\s*", "", value)
        if drop_page_numbers and PURE_PAGE_NUMBER_RE.fullmatch(value):
            continue
        if value:
            result.append({"type": "text", "text": value})
    return result


def body_index_at(stream: DocumentStream, position: int) -> int | None:
    for event in stream.events:
        if event.kind == "text" and event.start <= position < event.end:
            return event.body_index
    return None


def image_blocks_in_body(stream: DocumentStream, body_index: int) -> list[dict]:
    return [
        {"type": "image", "asset_id": event.asset_id, "src": event.public_path}
        for event in stream.events
        if event.kind == "image" and event.body_index == body_index
    ]


def parse_questions(stream: DocumentStream, paper_id: str, paper_name: str, year: int):
    all_markers: dict[int, tuple[int, int]] = {}
    number_modules: dict[int, str] = {}
    bounds = module_bounds(stream.text)
    for module_id, (start, end, numbers) in bounds.items():
        markers = locate_sequence(stream.text, numbers, start, end)
        all_markers.update(markers)
        number_modules.update({number: module_id for number in numbers})

    ordered_numbers = list(range(1, 131))
    questions = []
    consumed_ends: dict[int, int] = {}
    marker_starts = {number: all_markers[number][0] for number in ordered_numbers}
    for index, number in enumerate(ordered_numbers):
        start, marker_end = all_markers[number]
        end = marker_starts[ordered_numbers[index + 1]] if index + 1 < len(ordered_numbers) else len(stream.text)
        option_markers = find_option_markers(stream.text, marker_end, end)
        options = []
        last_body_index = None
        if len(option_markers) == 4:
            stem_end = option_markers[0].start()
            stem_blocks = clean_content_blocks(stream.blocks_for_span(marker_end, stem_end))
            for option_index, match in enumerate(option_markers):
                option_end = option_markers[option_index + 1].start() if option_index < 3 else end
                option_blocks = stream.blocks_for_span(match.end(), option_end)
                options.append({
                    "key": match.group(1),
                    "content_blocks": option_blocks,
                    "text": blocks_text(option_blocks),
                    "images": image_paths(option_blocks),
                })
            # Word commonly stores four graphical options in one table.  Preserve
            # the semantic A-D mapping even when OOXML serialises table drawings
            # after the option labels instead of inline with their cells.
            option_body_indexes = [body_index_at(stream, match.start()) for match in option_markers]
            if option_body_indexes[0] is not None and len(set(option_body_indexes)) == 1:
                table_images = image_blocks_in_body(stream, option_body_indexes[0])
                if len(table_images) == 4:
                    for option_index, option in enumerate(options):
                        text_only = [block for block in option["content_blocks"] if block.get("type") != "image"]
                        option["content_blocks"] = [*text_only, table_images[option_index]]
                        option["text"] = blocks_text(option["content_blocks"])
                        option["images"] = image_paths(option["content_blocks"])
            for event in stream.events:
                if option_markers[3].start() <= event.start < end:
                    last_body_index = event.body_index
                    break
        else:
            # Some graphical-reasoning questions are a single composite image
            # containing both stem and A-D options.
            stem_blocks = clean_content_blocks(stream.blocks_for_span(marker_end, end))
            placeholder_blocks = [{"type": "text", "text": "如上图所示"}] if image_paths(stem_blocks) else []
            options = [
                {
                    "key": key,
                    "content_blocks": [dict(block) for block in placeholder_blocks],
                    "text": "如上图所示" if placeholder_blocks else "",
                    "images": [],
                }
                for key in "ABCD"
            ]
        consumed_end = end
        if number in {115, 120, 125} and last_body_index is not None:
            consumed_end = stream.block_ends.get(last_body_index, end)
            options[3]["content_blocks"] = stream.blocks_for_span(option_markers[3].end(), consumed_end)
            options[3]["text"] = blocks_text(options[3]["content_blocks"])
            options[3]["images"] = image_paths(options[3]["content_blocks"])
        consumed_ends[number] = consumed_end

        stem_text = blocks_text(stem_blocks)
        question = {
            "_id": f"q_{paper_id}_{number:03d}",
            "paper_id": paper_id,
            "paper_name": paper_name,
            "question_number": number,
            "sequence": number,
            "module_id": number_modules[number],
            "type": "single",
            "difficulty": "中等",
            "source": "国考真题",
            "year": year,
            "province": "国家",
            "position": "行政执法",
            "stem_blocks": stem_blocks,
            "content": stem_text,
            "stem_images": image_paths(stem_blocks),
            "options_v2": options,
            "options": [option["text"] or option["key"] for option in options],
            "option_images": [option["images"] for option in options],
            "composite_options_in_stem": bool(image_paths(stem_blocks) and len(option_markers) != 4),
            "answer": 0,
            "group_id": "",
            "status": "draft",
            "schema_version": 2,
        }
        questions.append(question)

    groups = []
    data_start = bounds["mod_data"][0]
    for group_index, first_number in enumerate((111, 116, 121, 126), start=1):
        previous_last = first_number - 1
        material_start = data_start if first_number == 111 else consumed_ends[previous_last]
        material_end = all_markers[first_number][0]
        material_blocks = clean_content_blocks(stream.blocks_for_span(material_start, material_end))
        # Remove section labels and instructions while retaining actual material.
        for block in material_blocks:
            if block.get("type") == "text":
                value = re.sub(
                    r"^。?第五部分资料分析。所给出的图、表、文字或综合性资料均有若干个问题要你回答。你应根据资料提供的信息进行分析、比较、计算和判断处理。\s*",
                    "",
                    block["text"],
                )
                block["text"] = normalize_text(re.sub(r"^[（(][一二三四五][）)]\s*", "", value))
        material_blocks = [block for block in material_blocks if block.get("type") == "image" or block.get("text")]
        group_id = f"group_{paper_id}_data_{group_index:02d}"
        question_ids = [f"q_{paper_id}_{number:03d}" for number in range(first_number, first_number + 5)]
        groups.append({
            "_id": group_id,
            "paper_id": paper_id,
            "module_id": "mod_data",
            "sequence": group_index,
            "title": f"资料分析第{group_index}组",
            "question_ids": question_ids,
            "material_blocks": material_blocks,
            "material_text": blocks_text(material_blocks),
            "material_images": image_paths(material_blocks),
            "status": "draft",
            "schema_version": 2,
        })
        for question in questions[first_number - 1:first_number + 4]:
            question["group_id"] = group_id
    return groups, questions


def clean_solution_text(value: str, number: int) -> str:
    value = re.sub(rf"^\s*{number}\s*", "", value)
    value = re.sub(r"(?:^|\n)\s*\d+\s*$", "", value)
    return normalize_text(value)


def infer_answer(text: str) -> int | None:
    for pattern in ANSWER_PATTERNS:
        matches = list(re.finditer(pattern, text))
        if matches:
            return ord(matches[-1].group(1)) - 65
    return None


def parse_solutions(stream: DocumentStream, paper_id: str):
    markers = locate_sequence(stream.text, list(range(1, 131)), 0, len(stream.text))
    solutions = []
    for number in range(1, 131):
        start, marker_end = markers[number]
        end = markers[number + 1][0] if number < 130 else len(stream.text)
        content_blocks = clean_content_blocks(stream.blocks_for_span(marker_end, end))
        raw_text = clean_solution_text(blocks_text(content_blocks), number)
        answer = infer_answer(raw_text)
        if answer is None:
            raise ValueError(f"第 {number} 题解析中未识别到答案")
        solutions.append({
            "_id": f"solution_{paper_id}_{number:03d}",
            "paper_id": paper_id,
            "question_id": f"q_{paper_id}_{number:03d}",
            "question_number": number,
            "answer": answer,
            "explanation_blocks": content_blocks,
            "explanation": raw_text,
            "explanation_images": image_paths(content_blocks),
            "status": "draft",
            "schema_version": 2,
        })
    return solutions


def validate_package(package: dict) -> list[dict]:
    errors = []
    groups = package["groups"]
    questions = package["questions"]
    solutions = package["solutions"]
    media_ids = {item["asset_id"] for item in package["media"]}
    group_ids = {item["_id"] for item in groups}
    question_ids = {item["_id"] for item in questions}
    if len(questions) != 130:
        errors.append({"path": "questions", "message": f"应有130题，实际{len(questions)}题"})
    if len(solutions) != len(questions):
        errors.append({"path": "solutions", "message": "题目与解析数量不一致"})
    if len(groups) != 4 or any(len(group["question_ids"]) != 5 for group in groups):
        errors.append({"path": "groups", "message": "资料分析必须是4组，每组5题"})
    for question in questions:
        if len(question["options_v2"]) != 4:
            errors.append({"path": question["_id"], "message": "选项不是4个"})
        if question["module_id"] == "mod_data" and question["group_id"] not in group_ids:
            errors.append({"path": question["_id"], "message": "资料分析题缺少有效group_id"})
    for solution in solutions:
        if solution["question_id"] not in question_ids:
            errors.append({"path": solution["_id"], "message": "解析未匹配题目"})
    for container in [*groups, *questions, *solutions]:
        for key in ("material_blocks", "stem_blocks", "explanation_blocks"):
            for block in container.get(key, []):
                if block.get("type") == "image" and block.get("asset_id") not in media_ids:
                    errors.append({"path": container["_id"], "message": f"图片不存在：{block.get('asset_id')}"})
        for option in container.get("options_v2", []):
            for block in option.get("content_blocks", []):
                if block.get("type") == "image" and block.get("asset_id") not in media_ids:
                    errors.append({"path": container["_id"], "message": f"选项图片不存在：{block.get('asset_id')}"})
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert paired Xingce DOCX to V2 bank package")
    parser.add_argument("--questions", required=True)
    parser.add_argument("--answers", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--public-prefix", default="/assets/question-images/xingce-v2")
    parser.add_argument("--paper-id", default="")
    parser.add_argument("--asset-copy-dir", default="", help="Optional project assets directory to receive generated images")
    args = parser.parse_args()

    question_path = Path(args.questions).resolve()
    answer_path = Path(args.answers).resolve()
    output_dir = Path(args.output_dir).resolve()
    images_dir = output_dir / "images"
    if output_dir.exists():
        shutil.rmtree(output_dir)
    images_dir.mkdir(parents=True)

    year_match = re.search(r"(20\d{2}|19\d{2})", question_path.name)
    year = int(year_match.group(1)) if year_match else 0
    paper_id = args.paper_id or f"xingce_{year}_national_law_enforcement"
    paper_name = question_path.stem

    question_stream = DocxStreamReader(question_path, images_dir, args.public_prefix).read()
    answer_stream = DocxStreamReader(answer_path, images_dir, args.public_prefix).read()
    groups, questions = parse_questions(question_stream, paper_id, paper_name, year)
    solutions = parse_solutions(answer_stream, paper_id)
    solution_map = {item["question_id"]: item for item in solutions}
    for question in questions:
        solution = solution_map[question["_id"]]
        question["answer"] = solution["answer"]
        # Legacy fields remain during the client migration window.
        question["explanation"] = solution["explanation"]
        question["explanation_images"] = solution["explanation_images"]

    all_media = {**question_stream.media, **answer_stream.media}
    package = {
        "schema_version": 2,
        "paper": {
            "_id": paper_id,
            "title": paper_name,
            "year": year,
            "exam_type": "national",
            "paper_level": "law_enforcement",
            "question_count": len(questions),
            "group_count": len(groups),
            "source_question_file": question_path.name,
            "source_answer_file": answer_path.name,
            "status": "draft",
        },
        "groups": groups,
        "questions": questions,
        "solutions": solutions,
        "media": [item.to_dict() for item in all_media.values()],
    }
    package["validation_errors"] = validate_package(package)
    (output_dir / "bank.json").write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "manifest.json").write_text(json.dumps({
        "name": paper_name,
        "schema_version": 2,
        "entry": "bank.json",
        "images": "images",
        "stats": {
            "groups": len(groups), "questions": len(questions), "solutions": len(solutions), "media": len(all_media),
        },
        "validation_errors": package["validation_errors"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.asset_copy_dir:
        asset_copy_dir = Path(args.asset_copy_dir).resolve()
        asset_copy_dir.mkdir(parents=True, exist_ok=True)
        shutil.copytree(images_dir, asset_copy_dir, dirs_exist_ok=True)
    print(json.dumps({
        "paper_id": paper_id,
        "groups": len(groups),
        "questions": len(questions),
        "solutions": len(solutions),
        "media": len(all_media),
        "validation_errors": package["validation_errors"],
        "output": str(output_dir / "bank.json"),
        "asset_copy_dir": str(Path(args.asset_copy_dir).resolve()) if args.asset_copy_dir else "",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
