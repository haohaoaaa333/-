#!/usr/bin/env python3
from __future__ import annotations

import argparse
import difflib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph


MODULE_RULES = [
    ("mod_common_sense", ["政治理论", "常识判断", "常识"]),
    ("mod_language", ["言语理解", "言语理解与表达"]),
    ("mod_quantity", ["数量关系", "数学运算", "数字推理"]),
    ("mod_logic", ["判断推理", "图形推理", "定义判断", "类比推理", "逻辑判断"]),
    ("mod_data", ["资料分析"]),
]

QUESTION_RE = re.compile(r"(?:^|请开始答题[:：]?\s*)(\d{1,3})(?:\s*[、.．]\s*|\s+)(.*)$")
QUESTION_MARK_RE = re.compile(r"(?<!\d)(\d{1,3})\s*[、.．]\s*")
SPACE_QUESTION_MARK_RE = re.compile(r"(?<![A-Za-z0-9、.．])(\d{1,3})\s+(?![的年月日个项位条家人%％])(?=[\u4e00-\u9fff“《（(])")
SPACE_ANSWER_MARK_RE = re.compile(r"(?<![A-Za-z0-9、.．])(\d{1,3})\s+(?=(?:本题|[①②③④⑤]|[A-D]\s*项))")
MATERIAL_RE = re.compile(r"^\s*[（(]\s*材料\s*\d*\s*[）)]\s*$")
OPTION_MARK_RE = re.compile(r"(?<![A-Za-z0-9])([A-D])\s*[、.．]\s*")
ANSWER_LETTER = {"A": 0, "B": 1, "C": 2, "D": 3}


@dataclass
class Block:
    text: str = ""
    images: list[str] = field(default_factory=list)


@dataclass
class QuestionBuilder:
    num: int
    module_id: str
    year: int
    paper_id: str
    paper_name: str
    stem_parts: list[str] = field(default_factory=list)
    stem_images: list[str] = field(default_factory=list)
    options: list[str] = field(default_factory=lambda: ["", "", "", ""])
    option_images: list[list[str]] = field(default_factory=lambda: [[], [], [], []])
    material: str = ""
    material_images: list[str] = field(default_factory=list)

    def to_record(self) -> dict:
        options = [opt.strip() for opt in self.options]
        if not any(options):
            options = ["A", "B", "C", "D"]
        return {
            "_id": f"q_{self.paper_id}_{self.num:03d}",
            "module_id": self.module_id,
            "type": "single",
            "difficulty": "中等",
            "source": "国考真题",
            "year": self.year,
            "paper_id": self.paper_id,
            "paper_name": self.paper_name,
            "province": "国家",
            "position": level_label(self.paper_name),
            "paper_date": "",
            "question_number": self.num,
            "content": "\n".join(p for p in self.stem_parts if p).strip(),
            "stem_images": self.stem_images,
            "material": self.material,
            "material_images": self.material_images,
            "options": options,
            "option_images": self.option_images,
            "answer": 0,
            "explanation": "（待匹配答案解析）",
            "explanation_images": [],
            "tags": module_tags(self.module_id),
            "status": "enabled",
        }


def module_tags(module_id: str) -> list[str]:
    return {
        "mod_common_sense": ["常识判断"],
        "mod_language": ["言语理解"],
        "mod_quantity": ["数量关系"],
        "mod_logic": ["判断推理"],
        "mod_data": ["资料分析"],
    }.get(module_id, ["行测"])


def safe_slug(text: str) -> str:
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"[^\w\u4e00-\u9fff-]+", "", text)
    return text.strip("_")[:70] or "paper"


def normalize_text(text: str) -> str:
    text = text.replace("\u3000", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def extract_year(path: Path) -> int:
    match = re.search(r"(20\d{2}|19\d{2})", path.name)
    return int(match.group(1)) if match else 0


def level_key(name: str) -> str:
    if "行政执法" in name:
        return "xzzf"
    if "地市" in name or "市地" in name or "地市类" in name:
        return "dishi"
    if "副省" in name or "省级" in name or "省部" in name:
        return "fusheng"
    if "A卷" in name or "Ａ卷" in name:
        return "a"
    if "B卷" in name or "Ｂ卷" in name:
        return "b"
    if "卷（一）" in name or "卷一" in name:
        return "one"
    if "卷（二）" in name or "卷二" in name:
        return "two"
    return "general"


def level_label(name: str) -> str:
    return {
        "xzzf": "行政执法",
        "dishi": "地市级",
        "fusheng": "副省级",
        "a": "A卷",
        "b": "B卷",
        "one": "卷一",
        "two": "卷二",
    }.get(level_key(name), "")


def is_xingce(path: Path) -> bool:
    name = path.name
    return "行测" in name or "行政职业能力测验" in name


def is_answer_file(path: Path) -> bool:
    name = path.name
    return any(key in name for key in ["答案", "解析", "参考答案"])


def paper_id_for(path: Path) -> str:
    return f"gk{extract_year(path)}_{level_key(path.name)}_{safe_slug(path.stem)}"


def rel_image_map(doc: Document) -> dict[str, object]:
    return {rid: rel.target_part for rid, rel in doc.part.rels.items() if "image" in rel.reltype}


def copy_image(rel_part, assets_dir: Path, public_prefix: str, paper_id: str, rid: str, index: int) -> str:
    ext = Path(rel_part.partname).suffix or ".png"
    filename = f"{paper_id}_{index:04d}_{rid}{ext}"
    target = assets_dir / filename
    if not target.exists():
        target.write_bytes(rel_part.blob)
    return f"{public_prefix.rstrip('/')}/{filename}"


def iter_body_items(doc: Document):
    for child in doc.element.body.iterchildren():
        if child.tag.endswith("}p"):
            yield Paragraph(child, doc)
        elif child.tag.endswith("}tbl"):
            yield Table(child, doc)


def table_text(table: Table) -> str:
    rows = []
    for row in table.rows:
        cells = [normalize_text(cell.text) for cell in row.cells]
        if any(cells):
            rows.append("\t".join(cells))
    return "\n".join(rows)


def item_blips(item) -> list[str]:
    return [blip.get(qn("r:embed")) for blip in item._element.xpath(".//a:blip") if blip.get(qn("r:embed"))]


def iter_blocks(docx_path: Path, assets_dir: Path, public_prefix: str, image_prefix_id: str) -> Iterable[Block]:
    doc = Document(str(docx_path))
    rels = rel_image_map(doc)
    image_index = 0
    for item in iter_body_items(doc):
        if isinstance(item, Paragraph):
            text = normalize_text(item.text)
        else:
            text = table_text(item)
        images = []
        for rid in item_blips(item):
            if rid in rels:
                image_index += 1
                images.append(copy_image(rels[rid], assets_dir, public_prefix, image_prefix_id, rid, image_index))
        yield Block(text=text, images=images)


def split_block_by_question_markers(block: Block) -> list[Block]:
    matches = []
    raw_matches = list(QUESTION_MARK_RE.finditer(block.text)) + list(SPACE_QUESTION_MARK_RE.finditer(block.text))
    raw_matches.sort(key=lambda item: item.start())
    for match in raw_matches:
        next_char_index = match.end()
        next_char = block.text[next_char_index:next_char_index + 1]
        if match.re is SPACE_QUESTION_MARK_RE:
            matches.append(match)
            continue
        if match.start() == 0 and next_char.isdigit():
            if re.search(r"[，,、（(]", block.text[next_char_index:next_char_index + 8]):
                matches.append(match)
        elif match.start() == 0 or not next_char.isdigit():
            matches.append(match)
    if not matches:
        return [block]
    if len(matches) == 1 and matches[0].start() == 0:
        return [block]
    pieces = []
    if matches[0].start() > 0:
        pieces.append(Block(text=block.text[:matches[0].start()].strip(), images=block.images))
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(block.text)
        images = block.images if idx == 0 and matches[0].start() == 0 else []
        pieces.append(Block(text=block.text[match.start():end].strip(), images=images))
    return [piece for piece in pieces if piece.text or piece.images]


def answer_marker_positions(text: str) -> list[int]:
    patterns = [
        r"(?<!\d)\d{1,3}\s*[、.．](?!\d)\s*【答案】\s*[A-D]+",
        r"(?<!\d)\d{1,3}\s*[、.．](?!\d)\s*正确答案\s*[:：]\s*[A-D]",
        r"(?<!\d)\d{1,3}\s*[.．](?!\d)\s*[A-D]\s*[。.]?\s*【解析】",
        r"[【\[]\s*\d{1,3}\s*[】\]]\s*解析",
        r"(?<!\d)\d{1,3}\s*[、.．](?!\d)\s*(?:本题|根据|由|材料|文段|题干|A\s*项|首先|观察)",
        r"(?<!\d)\d{1,3}\s*[、.．](?!\d)",
        r"(?<![A-Za-z0-9、.．])\d{1,3}\s+(?=(?:本题|[①②③④⑤]|[A-D]\s*项))",
    ]
    starts = []
    for pattern in patterns:
        starts.extend(match.start() for match in re.finditer(pattern, text))
    return sorted(set(starts))


def split_block_by_answer_markers(block: Block) -> list[Block]:
    starts = answer_marker_positions(block.text)
    if len(starts) <= 1:
        return [block]
    pieces = []
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(block.text)
        images = block.images if idx == 0 else []
        pieces.append(Block(text=block.text[start:end].strip(), images=images))
    return pieces


def detect_module(text: str, current: str) -> str:
    compact = text.replace(" ", "")
    if len(compact) > 120:
        return current
    for module_id, keys in MODULE_RULES:
        if any(key in compact for key in keys):
            return module_id
    return current


def is_page_noise(text: str) -> bool:
    compact = text.replace(" ", "")
    return (
        compact in {"第", "页", "共"}
        or re.fullmatch(r"第?\d+页共?", compact) is not None
        or re.fullmatch(r"\d+页", compact) is not None
        or re.fullmatch(r"第?\d+页共\d+页", compact) is not None
        or re.fullmatch(r"-?\d+-?", compact) is not None
    )


def split_stem_options(text: str) -> tuple[str, list[str] | None]:
    matches = list(OPTION_MARK_RE.finditer(text))
    if len(matches) < 4:
        return text.strip(), None
    letters = [m.group(1) for m in matches[:4]]
    if letters != ["A", "B", "C", "D"]:
        return text.strip(), None
    stem = text[: matches[0].start()].strip()
    options = []
    for idx, match in enumerate(matches[:4]):
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < 4 else len(text)
        options.append(text[start:end].strip())
    return stem, options


def apply_option_block(question: QuestionBuilder, block: Block) -> bool:
    stem, options = split_stem_options(block.text)
    if options is not None and not stem:
        question.options = options
        if len(block.images) == 4:
            question.option_images = [[img] for img in block.images]
        elif block.images:
            question.stem_images.extend(block.images)
        return True

    match = re.match(r"^\s*([A-D])\s*[、.．]\s*(.*)$", block.text)
    if match:
        idx = ord(match.group(1)) - 65
        question.options[idx] = match.group(2).strip()
        question.option_images[idx].extend(block.images)
        return True
    return False


def parse_question_docx(docx_path: Path, assets_dir: Path, public_prefix: str) -> list[dict]:
    year = extract_year(docx_path)
    paper_id = paper_id_for(docx_path)
    paper_name = docx_path.stem
    assets_dir.mkdir(parents=True, exist_ok=True)

    current_module = "mod_unknown"
    current_material_parts: list[str] = []
    current_material_images: list[str] = []
    in_material = False
    current_question: QuestionBuilder | None = None
    records: list[dict] = []

    def flush_question() -> None:
        nonlocal current_question
        if current_question:
            records.append(current_question.to_record())
        current_question = None

    source_blocks = []
    for block in iter_blocks(docx_path, assets_dir, public_prefix, paper_id):
        source_blocks.extend(split_block_by_question_markers(block))

    for block in source_blocks:
        text = block.text
        if not text and not block.images:
            continue
        if text and not block.images and is_page_noise(text):
            continue

        next_module = detect_module(text, current_module)
        if next_module != current_module:
            flush_question()
            current_module = next_module
            in_material = current_module == "mod_data"
            if current_module == "mod_data":
                current_material_parts = []
                current_material_images = []
            continue

        q_match = QUESTION_RE.search(text)
        if current_module == "mod_data" and not q_match and MATERIAL_RE.match(text):
            flush_question()
            current_material_parts = []
            current_material_images = []
            in_material = True
            continue

        if q_match:
            flush_question()
            num = int(q_match.group(1))
            rest = q_match.group(2).strip()
            current_question = QuestionBuilder(
                num=num,
                module_id=current_module,
                year=year,
                paper_id=paper_id,
                paper_name=paper_name,
                material="\n".join(current_material_parts).strip() if current_module == "mod_data" else "",
                material_images=list(current_material_images) if current_module == "mod_data" else [],
            )
            stem, options = split_stem_options(rest)
            if stem:
                current_question.stem_parts.append(stem)
            if options is not None:
                current_question.options = options
            current_question.stem_images.extend(block.images)
            in_material = False
            continue

        if current_module == "mod_data" and (in_material or current_question is None):
            if text:
                current_material_parts.append(text)
            current_material_images.extend(block.images)
            in_material = True
            continue

        if current_module == "mod_data" and current_question and all(current_question.options) and text:
            flush_question()
            current_material_parts = [text]
            current_material_images = list(block.images)
            in_material = True
            continue

        if current_question is None:
            continue
        if apply_option_block(current_question, block):
            continue
        if text:
            current_question.stem_parts.append(text)
        current_question.stem_images.extend(block.images)

    flush_question()
    return dedupe_question_records(records)


def question_record_score(record: dict) -> int:
    options = record.get("options") or []
    option_text = sum(len(opt) for opt in options if opt and opt not in ["A", "B", "C", "D"])
    image_count = (
        len(record.get("stem_images", []))
        + len(record.get("material_images", []))
        + sum(len(group) for group in record.get("option_images", []))
    )
    return len(record.get("content", "")) + option_text * 2 + image_count * 80


def dedupe_question_records(records: list[dict]) -> list[dict]:
    best: dict[int, dict] = {}
    first_seen: dict[int, int] = {}
    for idx, record in enumerate(records):
        num = int(record.get("question_number") or 0)
        if num <= 0 or num > 200:
            continue
        if num not in first_seen:
            first_seen[num] = idx
        if num not in best or question_record_score(record) > question_record_score(best[num]):
            best[num] = record
    return [best[num] for num in sorted(best, key=lambda n: first_seen[n])]


def parse_quick_answers(text: str) -> dict[int, int]:
    answers: dict[int, int] = {}
    for match in re.finditer(r"[【\[]\s*(\d{1,3})\s*[-—]\s*(\d{1,3})\s*[】\]]\s*([A-D\s]+)", text):
        start, end = int(match.group(1)), int(match.group(2))
        letters = re.sub(r"\s+", "", match.group(3))
        for offset, letter in enumerate(letters):
            num = start + offset
            if num <= end and letter in ANSWER_LETTER:
                answers[num] = ANSWER_LETTER[letter]
    for match in re.finditer(r"(\d{1,3})\s*[、.．](?!\d)\s*正确答案\s*[:：]\s*([A-D])", text):
        answers[int(match.group(1))] = ANSWER_LETTER[match.group(2)]
    for match in re.finditer(r"(\d{1,3})\s*[、.．](?!\d)\s*【答案】\s*([A-D]+)", text):
        letter = match.group(2)[0]
        if letter in ANSWER_LETTER:
            answers[int(match.group(1))] = ANSWER_LETTER[letter]
    for match in re.finditer(r"(?<!\d)(\d{1,3})\s*[.．](?!\d)\s*([A-D])\s*[。.]?\s*【解析】", text):
        answers[int(match.group(1))] = ANSWER_LETTER[match.group(2)]
    return answers


def answer_start(text: str):
    patterns = [
        re.compile(r"^\s*(\d{1,3})\s*[、.．](?!\d)\s*正确答案\s*[:：]\s*([A-D])"),
        re.compile(r"^\s*(\d{1,3})\s*[、.．](?!\d)\s*【答案】\s*([A-D]+)"),
        re.compile(r"^\s*[【\[]\s*(\d{1,3})\s*[】\]]\s*解析"),
        re.compile(r"(?<!\d)(\d{1,3})\s*[.．](?!\d)\s*([A-D])\s*[。.]?\s*【解析】"),
        re.compile(r"^\s*(\d{1,3})\s*[、.．](?!\d)\s*(?:本题|根据|由|材料|文段|题干|A\s*项|首先|观察)"),
        re.compile(r"^\s*(\d{1,3})\s*[、.．](?!\d)"),
        re.compile(r"^\s*(\d{1,3})\s+(?:本题|[①②③④⑤]|[A-D]\s*项)"),
    ]
    best = None
    for pattern in patterns:
        match = pattern.search(text)
        if not match:
            continue
        if best is None or match.start() < best.start():
            best = match
    if not best:
        return None
    num = int(best.group(1))
    answer = None
    if best.lastindex and best.lastindex >= 2 and best.group(2) and best.group(2)[0] in ANSWER_LETTER:
        answer = ANSWER_LETTER[best.group(2)[0]]
    return best, num, answer


def clean_explanation(text: str) -> str:
    lines = []
    for raw in text.split("\n"):
        line = normalize_text(raw)
        if not line:
            continue
        if re.fullmatch(r"\d+\s*/\s*\d+|-?\s*\d+\s*-?", line):
            continue
        if "认准淘宝店铺" in line or "通关达人" in line:
            continue
        lines.append(line)
    text = "\n".join(lines)
    text = re.sub(r"^\s*(\d{1,3})\s*[、.．]\s*正确答案\s*[:：]\s*[A-D][，,。]?", "", text)
    text = re.sub(r"^\s*(\d{1,3})\s*[、.．]\s*【答案】\s*[A-D]+", "", text)
    text = re.sub(r"^\s*[【\[]\s*\d{1,3}\s*[】\]]\s*解析\s*", "", text)
    text = re.sub(r"(?<!\d)\d{1,3}\s*[.．]\s*[A-D]\s*[。.]?\s*【解析】\s*", "", text, count=1)
    return text.strip()


def infer_answer_from_text(text: str) -> int | None:
    patterns = [
        r"故\s*正确答案\s*为\s*([A-D])",
        r"正确答案\s*为\s*([A-D])",
        r"本题答案\s*为\s*([A-D])",
        r"答案\s*为\s*([A-D])\s*项",
        r"应该选择\s*([A-D])",
        r"应选\s*([A-D])",
        r"选择\s*([A-D])\s*选项",
    ]
    for pattern in patterns:
        matches = list(re.finditer(pattern, text))
        if matches:
            return ANSWER_LETTER[matches[-1].group(1)]
    return None


def parse_answer_docx(docx_path: Path, assets_dir: Path, public_prefix: str, image_prefix_id: str) -> dict[int, dict]:
    blocks = []
    for block in iter_blocks(docx_path, assets_dir, public_prefix, image_prefix_id):
        blocks.extend(split_block_by_answer_markers(block))
    full_text = "\n".join(block.text for block in blocks if block.text)
    quick = parse_quick_answers(full_text)

    parsed: dict[int, dict] = {}
    current_num: int | None = None
    current_answer: int | None = None
    current_parts: list[str] = []
    current_images: list[str] = []

    def flush() -> None:
        nonlocal current_num, current_answer, current_parts, current_images
        if current_num is None:
            return
        explanation = clean_explanation("\n".join(current_parts))
        raw_text = "\n".join(current_parts)
        answer = current_answer if current_answer is not None else quick.get(current_num)
        if answer is None:
            answer = infer_answer_from_text(raw_text)
        if answer is None:
            answer = 0
        parsed[current_num] = {
            "answer": answer,
            "explanation": explanation or "（暂无解析）",
            "explanation_images": list(current_images),
        }
        current_num = None
        current_answer = None
        current_parts = []
        current_images = []

    for block in blocks:
        text = block.text
        start = answer_start(text)
        if start:
            flush()
            match, num, answer = start
            current_num = num
            current_answer = answer if answer is not None else quick.get(num)
            current_parts = [text[match.start():]]
            current_images = list(block.images)
            continue
        if current_num is not None:
            if text:
                current_parts.append(text)
            current_images.extend(block.images)

    flush()

    for num, answer in quick.items():
        parsed.setdefault(num, {"answer": answer, "explanation": "（暂无解析）", "explanation_images": []})
    return parsed


def match_answer_file(question_file: Path, answer_files: list[Path]) -> Path | None:
    year = extract_year(question_file)
    q_level = level_key(question_file.name)
    candidates = [f for f in answer_files if extract_year(f) == year]
    if not candidates:
        return None
    scored = []
    for candidate in candidates:
        score = 0
        if level_key(candidate.name) == q_level:
            score += 100
        if q_level != "general" and q_level in level_key(candidate.name):
            score += 20
        score += int(20 * difflib.SequenceMatcher(None, question_file.stem, candidate.stem).ratio())
        scored.append((score, candidate))
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def merge_answers(records: list[dict], answers: dict[int, dict]) -> int:
    matched = 0
    for record in records:
        info = answers.get(record.get("question_number"))
        if not info:
            continue
        record["answer"] = info["answer"]
        record["explanation"] = info["explanation"]
        record["explanation_images"] = info["explanation_images"]
        matched += 1
    return matched


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse Word question papers and answer explanations into import JSON.")
    parser.add_argument("--input", default=r"C:\Users\hao\Desktop\题库")
    parser.add_argument("--output", default=r"刷题小程序1.0\admin-output\word-bank-questions-with-answers.json")
    parser.add_argument("--report", default=r"刷题小程序1.0\admin-output\word-bank-parse-report.json")
    parser.add_argument("--assets-dir", default=r"刷题小程序1.0\assets\question-images\word-bank")
    parser.add_argument("--public-prefix", default="/assets/question-images/word-bank")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    input_dir = Path(args.input)
    all_files = sorted(input_dir.rglob("*.docx"))
    question_files = [f for f in all_files if is_xingce(f) and not is_answer_file(f)]
    answer_files = [f for f in all_files if is_xingce(f) and is_answer_file(f)]
    if args.limit > 0:
        question_files = question_files[: args.limit]

    assets_dir = Path(args.assets_dir)
    all_records: list[dict] = []
    report = []

    for q_file in question_files:
        answer_file = match_answer_file(q_file, answer_files)
        records = parse_question_docx(q_file, assets_dir, args.public_prefix)
        answer_count = 0
        matched_answers = 0
        if answer_file:
            answers = parse_answer_docx(answer_file, assets_dir, args.public_prefix, paper_id_for(q_file) + "_answer")
            answer_count = len(answers)
            matched_answers = merge_answers(records, answers)
        all_records.extend(records)
        image_count = sum(
            len(q.get("stem_images", []))
            + len(q.get("material_images", []))
            + sum(len(x) for x in q.get("option_images", []))
            + len(q.get("explanation_images", []))
            for q in records
        )
        row = {
            "question_file": str(q_file),
            "answer_file": str(answer_file) if answer_file else "",
            "questions": len(records),
            "answers_found": answer_count,
            "answers_matched": matched_answers,
            "images_linked": image_count,
        }
        report.append(row)
        print(f"{q_file.name}: {len(records)} q, {matched_answers}/{answer_count} answers, {image_count} images")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(all_records, ensure_ascii=False, indent=2), encoding="utf-8")
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(all_records)} questions -> {output}")
    print(f"wrote report -> {args.report}")


if __name__ == "__main__":
    main()
