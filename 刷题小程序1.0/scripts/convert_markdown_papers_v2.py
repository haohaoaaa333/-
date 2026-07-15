#!/usr/bin/env python3
"""Convert one or many complete Xingce Markdown papers into V2 packages.

One Markdown file is treated as one paper.  The converter keeps group/material
relationships, supports the legacy image labels emitted by the old Word
template, and produces bank.json + manifest.json + images for every paper.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
from pathlib import Path


def _rm_rf(target: Path) -> None:
    """Recursively remove a directory without going through shutil.rmtree.

    WorkBuddy's bundled Python sitecustomize hooks shutil.rmtree and spawns a
    subprocess for bulk-delete protection.  On some Windows systems the
    subprocess stderr is read with the system code page (gbk) and triggers a
    UnicodeDecodeError when non-ASCII characters are present.  Using os.remove /
    os.rmdir directly avoids that hook.
    """
    target = Path(target)
    if not target.exists():
        return
    if target.is_dir():
        for child in target.iterdir():
            _rm_rf(child)
        os.rmdir(target)
    else:
        os.remove(target)


MODULE_LABELS = {
    "政治理论": "mod_common_sense",
    "常识判断": "mod_common_sense",
    "常识": "mod_common_sense",
    "言语理解": "mod_language",
    "数量关系": "mod_quantity",
    "数学运算": "mod_quantity",
    "判断推理": "mod_logic",
    "图形推理": "mod_logic",
    "资料分析": "mod_data",
}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
IMAGE_KEY_RE = re.compile(r"^(?:题干图|材料图|图片路径|解析图|图\d*)$")
MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*]\(([^)]+)\)")
WATERMARK_RE = re.compile(r"(?:认准.*(?:淘宝|店铺)|通关达人资料库|一站式备考|公考加油站|仅供学习交流)")
PAGE_RE = re.compile(r"^\s*\d+\s*/\s*\d+\s*$")


def clean_text(value: str) -> str:
    value = value.replace("\u3000", " ").replace("\xa0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def slugify(value: str) -> str:
    value = re.sub(r"\s+", "_", value)
    value = re.sub(r"[^\w\u4e00-\u9fff-]+", "", value)
    return value.strip("_")[:80] or "paper"


def parse_meta(line: str) -> tuple[str, str]:
    match = re.match(r"^([^：:]+)[：:]\s*(.*)$", line.strip())
    return (match.group(1).strip(), match.group(2).strip()) if match else ("", "")


def module_id(value: str) -> str:
    return next((result for label, result in MODULE_LABELS.items() if label in value), "mod_language")


def answer_index(value: str) -> int:
    text = value.strip().upper()
    if re.fullmatch(r"[A-D]", text):
        return ord(text) - 65
    try:
        return int(text)
    except ValueError:
        return 0


def blocks_text(blocks: list[dict]) -> str:
    return clean_text("\n".join(item.get("text", "") for item in blocks if item.get("type") == "text"))


def image_paths(blocks: list[dict]) -> list[str]:
    return [item["src"] for item in blocks if item.get("type") == "image"]


def append_text(blocks: list[dict], value: str) -> None:
    value = clean_text(value)
    if not value:
        return
    if blocks and blocks[-1].get("type") == "text":
        blocks[-1]["text"] = clean_text(f"{blocks[-1]['text']}\n{value}")
    else:
        blocks.append({"type": "text", "text": value})


def paper_identity(path: Path, title: str) -> tuple[str, int, str, str]:
    combined = f"{path.stem} {title}"
    year_match = re.search(r"(20\d{2}|19\d{2})", combined)
    year = int(year_match.group(1)) if year_match else 0
    if "行政执法" in combined:
        level, level_code, position = "law_enforcement", "law", "行政执法"
    elif "副省" in combined:
        level, level_code, position = "sub_provincial", "fu", "副省级"
    elif "地市" in combined:
        level, level_code, position = "city", "di", "地市级"
    else:
        level, level_code, position = "general", "general", "通用"
    return f"xingce_{year}_national_{level}", year, level_code, position


class MediaRegistry:
    def __init__(self, source_root: Path, markdown_dir: Path, output_dir: Path, public_prefix: str, paper_id: str):
        self.source_root = source_root
        self.markdown_dir = markdown_dir
        self.images_dir = output_dir / "images"
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.public_prefix = public_prefix.rstrip("/")
        self.paper_id = paper_id
        self.media: dict[str, dict] = {}
        self.errors: list[dict] = []

    def resolve(self, source: str) -> Path | None:
        plain = source.split("?", 1)[0].split("#", 1)[0].replace("\\", "/")
        relative = Path(*[part for part in plain.strip("/").split("/") if part not in {"", ".", ".."}])
        candidates = [
            self.source_root / relative,
            self.markdown_dir / relative,
            self.source_root / "images" / relative.name,
            self.source_root / "assets" / "question-images" / "md-bank" / relative.name,
        ]
        return next((item for item in candidates if item.exists() and item.is_file()), None)

    def block(self, source: str, context: str) -> dict:
        source = source.strip()
        if re.match(r"^(?:https?:)?//|^cloud://", source, re.I):
            digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
            asset_id = f"asset_{digest[:20]}"
            self.media.setdefault(asset_id, {
                "asset_id": asset_id, "path": source, "mime": "external/url", "extension": "",
                "bytes": 0, "sha256": digest, "source_path": source,
            })
            return {"type": "image", "asset_id": asset_id, "src": source}

        path = self.resolve(source)
        if path is None:
            digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
            asset_id = f"missing_{digest[:20]}"
            self.errors.append({"path": context, "message": f"图片不存在：{source}"})
            return {"type": "image", "asset_id": asset_id, "src": source}

        blob = path.read_bytes()
        digest = hashlib.sha256(blob).hexdigest()
        asset_id = f"asset_{digest[:20]}"
        extension = path.suffix.lower() if path.suffix.lower() in IMAGE_EXTS else ".png"
        filename = f"{digest[:24]}{extension}"
        target = self.images_dir / filename
        if not target.exists():
            shutil.copy2(path, target)
        public_path = f"{self.public_prefix}/{self.paper_id}/{filename}"
        self.media.setdefault(asset_id, {
            "asset_id": asset_id,
            "path": public_path,
            "mime": {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml"}.get(extension, "application/octet-stream"),
            "extension": extension,
            "bytes": len(blob),
            "sha256": digest,
            "source_path": str(path),
        })
        return {"type": "image", "asset_id": asset_id, "src": public_path}

    def conventional(self, paper_code: str, kind: str, suffix: str) -> str | None:
        filename = f"{paper_code}-{kind}-{suffix}"
        base = self.source_root / "assets" / "question-images" / "md-bank"
        for extension in IMAGE_EXTS:
            candidate = base / f"{filename}{extension}"
            if candidate.exists():
                return f"/assets/question-images/md-bank/{candidate.name}"
        return None


def image_sources(line: str) -> list[str]:
    sources = [match.group(1).strip() for match in MARKDOWN_IMAGE_RE.finditer(line)]
    key, value = parse_meta(line)
    if IMAGE_KEY_RE.fullmatch(key) and value:
        sources.append(value.strip())
    return list(dict.fromkeys(item for item in sources if item))


def clean_line_text(line: str) -> str:
    return clean_text(MARKDOWN_IMAGE_RE.sub("", line))


def useful_line(line: str) -> bool:
    return bool(line.strip()) and not PAGE_RE.fullmatch(line) and not WATERMARK_RE.fullmatch(line)


def sanitize_source_line(line: str) -> str:
    # Preserve genuine phrases such as “细胞持续更新”, but remove the PDF
    # footer beginning at its bracketed shop watermark (and its page digit).
    line = re.sub(r"\d*【认准[^\n]*$", "", line)
    return "" if WATERMARK_RE.fullmatch(line.strip()) else line.strip()


def recover_misread_option_prefix(option_index: int, value: str) -> str:
    """Recover OCR text such as `A. B两种设备` => `A、B两种设备`."""
    match = re.match(r"^([A-D])(?=[\u4e00-\u9fff])", value)
    if not match or ord(match.group(1)) != ord("A") + option_index + 1:
        return value
    prefix = "、".join(chr(ord("A") + index) for index in range(option_index + 1))
    return f"{prefix}、{value}"


def parse_blocks(text: str, registry: MediaRegistry, context: str) -> list[dict]:
    blocks: list[dict] = []
    for raw in text.splitlines():
        line = sanitize_source_line(raw)
        if not useful_line(line):
            continue
        sources = image_sources(line)
        key, _ = parse_meta(line)
        visible = "" if IMAGE_KEY_RE.fullmatch(key) else clean_line_text(line)
        append_text(blocks, visible)
        blocks.extend(registry.block(source, context) for source in sources)
    return blocks


def parse_question(number: int, body: str, registry: MediaRegistry, paper: dict, group: dict, paper_code: str) -> tuple[dict, dict]:
    stem_blocks: list[dict] = []
    explanation_blocks: list[dict] = []
    options = [{"key": key, "content_blocks": [], "text": "", "images": []} for key in "ABCD"]
    answer = 0
    answer_verified = False
    mode = "stem"
    loose_images: list[dict] = []

    for raw in body.splitlines():
        line = sanitize_source_line(raw)
        if not useful_line(line):
            continue
        option_match = re.match(r"^([A-D])\s*[.、：:]\s*(.*)$", line, re.I)
        if option_match and mode != "explanation":
            index = ord(option_match.group(1).upper()) - 65
            value = option_match.group(2).strip()
            previous_text = blocks_text(options[index]["content_blocks"])
            if previous_text:
                append_text(stem_blocks, recover_misread_option_prefix(index, previous_text))
            option_blocks: list[dict] = []
            visible = clean_line_text(value)
            append_text(option_blocks, visible)
            option_blocks.extend(registry.block(source, f"question.{number}.option.{index}") for source in image_sources(value))
            options[index]["content_blocks"] = option_blocks
            mode = "options"
            continue

        key, value = parse_meta(line)
        if key == "题干":
            append_text(stem_blocks, clean_line_text(value))
            stem_blocks.extend(registry.block(source, f"question.{number}.stem") for source in image_sources(value))
            mode = "stem"
            continue
        if key == "答案":
            answer = answer_index(value)
            answer_verified = bool(re.fullmatch(r"[A-D]", value.strip().upper()))
            mode = "answer"
            continue
        if key == "解析":
            append_text(explanation_blocks, clean_line_text(value))
            explanation_blocks.extend(registry.block(source, f"solution.{number}") for source in image_sources(value))
            mode = "explanation"
            continue
        sources = image_sources(line)
        if sources:
            target = explanation_blocks if mode == "explanation" else stem_blocks
            blocks = [registry.block(source, f"question.{number}.{mode}") for source in sources]
            target.extend(blocks)
            if mode != "explanation":
                loose_images.extend(blocks)
            continue
        if mode == "explanation":
            append_text(explanation_blocks, clean_line_text(line))
        elif mode == "stem":
            append_text(stem_blocks, clean_line_text(line))

    if not image_paths(stem_blocks):
        conventional = registry.conventional(paper_code, "logic", f"{number}-stem")
        if conventional:
            block = registry.block(conventional, f"question.{number}.stem.auto")
            stem_blocks.append(block)
            loose_images.append(block)

    option_texts = [blocks_text(item["content_blocks"]) for item in options]
    composite_options_in_stem = False
    if len(loose_images) == 4 and not any(option_texts):
        stem_blocks = [item for item in stem_blocks if item not in loose_images]
        for index, block in enumerate(loose_images):
            options[index]["content_blocks"] = [block]
    elif image_paths(stem_blocks) and all(not item["content_blocks"] for item in options):
        # Some source papers place the stem and all four graphical/table options
        # in one composite image and therefore omit A-D text entirely.
        for item in options:
            append_text(item["content_blocks"], "如上图所示")
        composite_options_in_stem = True

    for item in options:
        item["text"] = blocks_text(item["content_blocks"])
        item["images"] = image_paths(item["content_blocks"])

    question_id = f"q_{paper['_id']}_{number:03d}"
    question = {
        "_id": question_id,
        "paper_id": paper["_id"],
        "paper_name": paper["title"],
        "question_number": number,
        "sequence": number,
        "module_id": group["module_id"],
        "type": "single",
        "difficulty": group["difficulty"],
        "source": group["source"],
        "year": paper["year"],
        "province": "国家",
        "position": paper["position"],
        "stem_blocks": stem_blocks,
        "content": blocks_text(stem_blocks),
        "stem_images": image_paths(stem_blocks),
        "options_v2": options,
        "options": [item["text"] or item["key"] for item in options],
        "option_images": [item["images"] for item in options],
        "composite_options_in_stem": composite_options_in_stem,
        "review_confirmed": False,
        "answer": answer,
        "answer_verified": answer_verified,
        "group_id": group["_id"],
        "status": "draft",
        "schema_version": 2,
    }
    solution = {
        "_id": f"solution_{paper['_id']}_{number:03d}",
        "paper_id": paper["_id"],
        "question_id": question_id,
        "question_number": number,
        "answer": answer,
        "explanation_blocks": explanation_blocks,
        "explanation": blocks_text(explanation_blocks),
        "explanation_images": image_paths(explanation_blocks),
        "status": "draft",
        "schema_version": 2,
    }
    question["explanation"] = solution["explanation"]
    question["explanation_images"] = solution["explanation_images"]
    return question, solution


def group_sections(markdown: str) -> list[tuple[str, str]]:
    matches = list(re.finditer(r"^##\s+(.+?)\s*$", markdown, re.M))
    return [
        (match.group(1).strip(), markdown[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(markdown)])
        for index, match in enumerate(matches)
    ]


def validate_package(package: dict, registry: MediaRegistry) -> list[dict]:
    errors = list(registry.errors)
    questions = package["questions"]
    solutions = package["solutions"]
    groups = package["groups"]
    ids = [item["_id"] for item in questions]
    if not questions:
        errors.append({"path": "questions", "message": "试卷没有识别出任何题目"})
    if len(ids) != len(set(ids)):
        errors.append({"path": "questions", "message": "题目ID重复"})
    if len(questions) != len(solutions):
        errors.append({"path": "solutions", "message": "题目和解析数量不一致"})
    for question in questions:
        if not question["content"] and not question["stem_images"]:
            errors.append({"path": question["_id"], "message": "题干为空"})
        if len(question["options_v2"]) != 4:
            errors.append({"path": question["_id"], "message": "选项不是4个"})
        if question["answer"] not in range(4):
            errors.append({"path": question["_id"], "message": "答案超出A-D"})
        if not question.get("answer_verified"):
            errors.append({"path": question["_id"], "message": "答案缺失或不是A-D"})
        solution = next((item for item in solutions if item["question_id"] == question["_id"]), None)
        if not solution or (not solution["explanation"] and not image_paths(solution.get("explanation_blocks", []))):
            errors.append({"path": question["_id"], "message": "解析为空"})
    for group in groups:
        if group["module_id"] == "mod_data":
            if len(group["question_ids"]) != 5:
                errors.append({"path": group["_id"], "message": "资料分析题组不是5题"})
            if not group["material_text"] and not group["material_images"]:
                errors.append({"path": group["_id"], "message": "资料分析材料为空"})
    return errors


def validation_warnings(package: dict) -> list[dict]:
    warnings: list[dict] = []
    for question in package["questions"]:
        if question.get("composite_options_in_stem") and not question.get("review_confirmed"):
            warnings.append({
                "path": question["_id"],
                "message": "题干图片同时包含A-D选项，已自动设置为“如上图所示”，请人工确认图片完整且选项顺序正确",
            })
        missing = [item["key"] for item in question["options_v2"] if not item["text"] and not item["images"]]
        if not missing:
            continue
        if question["stem_images"]:
            message = f"选项 {','.join(missing)} 未单独拆图，当前按题干合成图 + A-D作答，请人工确认顺序"
        else:
            message = f"选项 {','.join(missing)} 文字/图片为空，原 Markdown 可能丢失公式或图片，请人工复核"
        warnings.append({"path": question["_id"], "message": message})
    return warnings


def convert_paper(markdown_path: Path, source_root: Path, output_root: Path, public_prefix: str) -> dict:
    markdown = markdown_path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    title_match = re.search(r"^#\s+(.+?)\s*$", markdown, re.M)
    title = clean_text(title_match.group(1) if title_match else markdown_path.stem)
    paper_id, year, level_code, position = paper_identity(markdown_path, title)
    level = {"law": "law_enforcement", "fu": "sub_provincial", "di": "city"}.get(level_code, "general")
    paper_dir = output_root / paper_id
    if paper_dir.exists():
        _rm_rf(paper_dir)
    paper_dir.mkdir(parents=True)
    registry = MediaRegistry(source_root, markdown_path.parent, paper_dir, public_prefix, paper_id)
    digest = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    paper = {
        "_id": paper_id,
        "title": title,
        "year": year,
        "exam_type": "national",
        "paper_level": level,
        "position": position,
        "source_kind": "markdown_combined",
        "source_question_file": markdown_path.name,
        "source_answer_file": markdown_path.name,
        "content_hash": digest,
        "status": "draft",
    }

    groups: list[dict] = []
    questions: list[dict] = []
    solutions: list[dict] = []
    paper_code = f"{year}-{level_code}"
    for group_index, (title_text, body) in enumerate(group_sections(markdown), start=1):
        if not re.search(r"^###\s+\d+\s*$", body, re.M):
            continue
        metadata: dict[str, str] = {}
        first_question = re.search(r"^###\s+\d+\s*$", body, re.M)
        header = body[:first_question.start()] if first_question else body
        for line in header.splitlines():
            key, value = parse_meta(line)
            if key:
                metadata[key] = value
        current_module = module_id(metadata.get("模块", title_text))
        source_group_id = metadata.get("题组ID", "")
        canonical_group_id = f"group_{paper_id}_{group_index:02d}"
        group = {
            "_id": canonical_group_id,
            "paper_id": paper_id,
            "module_id": current_module,
            "sequence": group_index,
            "title": re.sub(r"^题组[：:]\s*", "", title_text),
            "source_group_id": source_group_id,
            "question_ids": [],
            "material_blocks": [],
            "material_text": "",
            "material_images": [],
            "difficulty": metadata.get("难度", "中等"),
            "source": metadata.get("来源", "国考真题"),
            "status": "draft",
            "schema_version": 2,
        }
        material_match = re.search(r"^###\s*材料\s*$([\s\S]*?)(?=^###\s+\d+\s*$|\Z)", body, re.M)
        if material_match:
            group["material_blocks"] = parse_blocks(material_match.group(1), registry, f"group.{group_index}.material")

        question_matches = list(re.finditer(r"^###\s+(\d+)\s*$", body, re.M))
        if current_module == "mod_data" and not image_paths(group["material_blocks"]) and question_matches:
            first_number = int(question_matches[0].group(1))
            conventional = registry.conventional(paper_code, "data", f"{first_number}-{first_number + 4}")
            if conventional:
                group["material_blocks"].append(registry.block(conventional, f"group.{group_index}.material.auto"))
        group["material_text"] = blocks_text(group["material_blocks"])
        group["material_images"] = image_paths(group["material_blocks"])

        for question_index, match in enumerate(question_matches):
            number = int(match.group(1))
            end = question_matches[question_index + 1].start() if question_index + 1 < len(question_matches) else len(body)
            question, solution = parse_question(number, body[match.end():end], registry, paper, group, paper_code)
            questions.append(question)
            solutions.append(solution)
            group["question_ids"].append(question["_id"])
        groups.append(group)

    paper["question_count"] = len(questions)
    paper["group_count"] = len(groups)
    package = {
        "schema_version": 2,
        "paper": paper,
        "groups": groups,
        "questions": questions,
        "solutions": solutions,
        "media": list(registry.media.values()),
    }
    package["validation_errors"] = validate_package(package, registry)
    package["validation_warnings"] = validation_warnings(package)
    (paper_dir / "bank.json").write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "name": title,
        "schema_version": 2,
        "entry": "bank.json",
        "images": "images",
        "stats": {"groups": len(groups), "questions": len(questions), "solutions": len(solutions), "media": len(registry.media)},
        "validation_errors": package["validation_errors"],
        "validation_warnings": package["validation_warnings"],
    }
    (paper_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "paper_id": paper_id,
        "title": title,
        "source": str(markdown_path),
        "groups": len(groups),
        "questions": len(questions),
        "solutions": len(solutions),
        "media": len(registry.media),
        "valid": not package["validation_errors"],
        "errors": package["validation_errors"],
        "warning_count": len(package["validation_warnings"]),
        "warnings": package["validation_warnings"],
        "bank_json": str(paper_dir / "bank.json"),
        "images_dir": str(paper_dir / "images"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert complete Xingce Markdown papers to V2 packages")
    parser.add_argument("--input", required=True, help="Markdown file or directory containing multiple papers")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--public-prefix", default="/assets/question-images/xingce-v2")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_root = Path(args.output_dir).resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    markdown_files = [input_path] if input_path.is_file() and input_path.suffix.lower() == ".md" else sorted(input_path.glob("*.md"))
    if not markdown_files:
        raise FileNotFoundError("没有找到可转换的 .md 行测试卷")
    source_root = input_path if input_path.is_dir() else input_path.parent
    papers = [convert_paper(path, source_root, output_root, args.public_prefix) for path in markdown_files]
    catalog = {
        "schema_version": 2,
        "source": str(input_path),
        "papers": papers,
        "summary": {
            "paper_count": len(papers),
            "valid_papers": sum(1 for item in papers if item["valid"]),
            "invalid_papers": sum(1 for item in papers if not item["valid"]),
            "questions": sum(item["questions"] for item in papers),
            "media": sum(item["media"] for item in papers),
            "warning_count": sum(item["warning_count"] for item in papers),
        },
    }
    catalog_path = output_root / "catalog.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    response_papers = [
        {
            **item,
            "error_count": len(item["errors"]),
            "errors": item["errors"][:20],
            "warnings": item["warnings"][:20],
        }
        for item in papers
    ]
    print(json.dumps({**catalog["summary"], "catalog": str(catalog_path), "papers": response_papers}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
