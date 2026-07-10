#!/usr/bin/env python3
"""
Parse .docx civil-service question papers while preserving image order.

Old .doc files should be converted to .docx first. That conversion step matters:
the parser relies on Word's inline image anchors to bind material charts, stem
images, and option images to the right question.
"""
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from docx import Document
from docx.oxml.ns import qn


MODULE_RULES = [
    ("mod_common_sense", ["常识判断", "常识"]),
    ("mod_language", ["言语理解", "言语理解与表达"]),
    ("mod_quantity", ["数量关系", "数学运算", "数字推理"]),
    ("mod_logic", ["判断推理", "图形推理", "定义判断", "类比推理", "逻辑判断"]),
    ("mod_data", ["资料分析"]),
]

QUESTION_RE = re.compile(r"^\s*(\d{1,3})\s*[、.．]\s*(.*)$")
MATERIAL_RE = re.compile(r"^\s*[（(]\s*材料\s*\d*\s*[）)]\s*$")
OPTION_INLINE_RE = re.compile(r"([A-D])\s*[、.．]\s*")


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
            "position": "",
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
    return text.strip("_")[:80] or "paper"


def extract_year(path: Path) -> int:
    match = re.search(r"(20\d{2}|19\d{2})", path.name)
    return int(match.group(1)) if match else 0


def detect_module(text: str, current: str) -> str:
    if len(text) > 80:
        return current
    for module_id, keys in MODULE_RULES:
        if any(key in text for key in keys):
            return module_id
    return current


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u3000", " ").replace("\xa0", " ")).strip()


def rel_image_map(doc: Document) -> dict[str, object]:
    return {
        rid: rel.target_part
        for rid, rel in doc.part.rels.items()
        if "image" in rel.reltype
    }


def copy_image(rel_part, assets_dir: Path, public_prefix: str, paper_id: str, rid: str, index: int) -> str:
    ext = Path(rel_part.partname).suffix or ".png"
    filename = f"{paper_id}_{index:03d}_{rid}{ext}"
    target = assets_dir / filename
    if not target.exists():
        target.write_bytes(rel_part.blob)
    return f"{public_prefix.rstrip('/')}/{filename}"


def iter_blocks(docx_path: Path, assets_dir: Path, public_prefix: str, paper_id: str) -> Iterable[Block]:
    doc = Document(str(docx_path))
    images = rel_image_map(doc)
    image_index = 0
    for para in doc.paragraphs:
        block = Block(text=normalize_text(para.text))
        for run in para.runs:
            for blip in run._element.xpath(".//a:blip"):
                rid = blip.get(qn("r:embed"))
                if rid in images:
                    image_index += 1
                    block.images.append(copy_image(images[rid], assets_dir, public_prefix, paper_id, rid, image_index))
        yield block


def parse_inline_options(text: str) -> list[str] | None:
    matches = list(OPTION_INLINE_RE.finditer(text))
    letters = [m.group(1) for m in matches]
    if letters != ["A", "B", "C", "D"]:
        return None
    options = []
    for idx, match in enumerate(matches):
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        options.append(text[start:end].strip())
    return options


def apply_option_block(question: QuestionBuilder, block: Block) -> bool:
    inline = parse_inline_options(block.text)
    if inline is not None:
        question.options = inline
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


def parse_docx(docx_path: Path, assets_dir: Path, public_prefix: str) -> list[dict]:
    year = extract_year(docx_path)
    paper_id = f"gk{year}_{safe_slug(docx_path.stem)}"
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

    for block in iter_blocks(docx_path, assets_dir, public_prefix, paper_id):
        text = block.text
        if not text and not block.images:
            continue

        next_module = detect_module(text, current_module)
        if next_module != current_module:
            flush_question()
            current_module = next_module
            in_material = False
            continue

        if current_module == "mod_data" and MATERIAL_RE.match(text):
            flush_question()
            current_material_parts = []
            current_material_images = []
            in_material = True
            continue

        q_match = QUESTION_RE.match(text)
        if q_match:
            flush_question()
            num = int(q_match.group(1))
            current_question = QuestionBuilder(
                num=num,
                module_id=current_module,
                year=year,
                paper_id=paper_id,
                paper_name=paper_name,
                material="\n".join(current_material_parts).strip() if current_module == "mod_data" else "",
                material_images=list(current_material_images) if current_module == "mod_data" else [],
            )
            rest = q_match.group(2).strip()
            inline = parse_inline_options(rest)
            if inline is not None:
                current_question.options = inline
            elif rest:
                current_question.stem_parts.append(rest)
            current_question.stem_images.extend(block.images)
            in_material = False
            continue

        if current_module == "mod_data" and in_material:
            if text:
                current_material_parts.append(text)
            current_material_images.extend(block.images)
            continue

        if current_question is None:
            continue

        if apply_option_block(current_question, block):
            continue
        if text:
            current_question.stem_parts.append(text)
        current_question.stem_images.extend(block.images)

    flush_question()
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse national exam Word .docx files into importable JSON.")
    parser.add_argument("--input", default=r"D:\浏览器下载\全国各省34省+国考【历年真-题】\此文件夹为word版【赠送】,不推荐使用\国考2000-2022真题word\国家行测2000年-2022年word版【赠送-供参考】\国考2000-2022真题")
    parser.add_argument("--output", default=r"刷题小程序1.0\admin-output\word-docx-questions.json")
    parser.add_argument("--assets-dir", default=r"刷题小程序1.0\assets\question-images\word")
    parser.add_argument("--public-prefix", default="/assets/question-images/word")
    parser.add_argument("--limit", type=int, default=0, help="Optional limit for quick sampling.")
    args = parser.parse_args()

    input_path = Path(args.input)
    files = [input_path] if input_path.is_file() else sorted(input_path.glob("*.docx"))
    if args.limit > 0:
        files = files[: args.limit]

    all_records: list[dict] = []
    for docx_path in files:
        try:
            records = parse_docx(docx_path, Path(args.assets_dir), args.public_prefix)
        except Exception as err:
            print(f"{docx_path.name}: skipped ({err})")
            continue
        all_records.extend(records)
        image_count = sum(
            len(q.get("stem_images", []))
            + len(q.get("material_images", []))
            + sum(len(x) for x in q.get("option_images", []))
            for q in records
        )
        print(f"{docx_path.name}: {len(records)} questions, {image_count} linked images")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(all_records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(all_records)} questions -> {output}")


if __name__ == "__main__":
    main()
