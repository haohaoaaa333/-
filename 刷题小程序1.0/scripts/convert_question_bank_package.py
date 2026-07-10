#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Convert a question-bank package into the JSON format used by the admin console.

Package shape:
  kg-question-bank/
    questions.md
    images/

The converter copies referenced local images into the app assets directory and
rewrites Markdown image paths to stable /assets/... paths.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


MODULE_LABELS = {
    "资料分析": "mod_data",
    "判断推理": "mod_logic",
    "图形推理": "mod_logic",
    "逻辑判断": "mod_logic",
    "定义判断": "mod_logic",
    "类比推理": "mod_logic",
    "数量关系": "mod_quantity",
    "数学运算": "mod_quantity",
    "数字推理": "mod_quantity",
    "言语理解": "mod_language",
    "常识判断": "mod_common_sense",
    "常识": "mod_common_sense",
}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}


def module_id_from_text(value: str) -> str:
    for keyword, module_id in MODULE_LABELS.items():
        if keyword in value:
            return module_id
    return "mod_language"


def slugify(value: str) -> str:
    text = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", value, flags=re.UNICODE).strip("-_")
    return text[:80] or "question-bank"


def parse_meta(line: str) -> tuple[str, str]:
    match = re.match(r"^([^：:]+)[：:]\s*(.*)$", line.strip())
    return (match.group(1).strip(), match.group(2).strip()) if match else ("", "")


def extract_images(markdown: str) -> list[str]:
    return [m.group(1).strip() for m in re.finditer(r"!\[[^\]]*]\(([^)]+)\)", markdown or "") if m.group(1).strip()]


def strip_images(markdown: str) -> str:
    return re.sub(r"!\[[^\]]*]\([^)]+\)", "", markdown or "").strip()


def clean_md_value(value: str) -> str:
    return re.sub(r"^\s*[:：]\s*", "", strip_images(value)).strip()


def answer_index(value: str) -> int:
    text = (value or "").strip().upper()
    if re.match(r"^[A-D]$", text):
        return ord(text) - ord("A")
    try:
        return int(text)
    except ValueError:
        return 0


def is_external_image(src: str) -> bool:
    return bool(re.match(r"^(https?:)?//|^cloud://|^/assets/", src or "", re.I))


def safe_rel_image_path(src: str) -> PurePosixPath:
    normalized = src.split("?", 1)[0].split("#", 1)[0].replace("\\", "/").strip("/")
    pure = PurePosixPath(normalized)
    parts = [part for part in pure.parts if part not in ("", ".", "..")]
    return PurePosixPath(*parts) if parts else PurePosixPath("image")


class ImageRewriter:
    def __init__(self, package_root: Path, assets_dir: Path, public_prefix: str, slug: str) -> None:
        self.package_root = package_root
        self.target_root = assets_dir / slug
        self.public_prefix = public_prefix.rstrip("/")
        self.slug = slug
        self.warnings: list[str] = []
        self.copied: dict[str, str] = {}

    def rewrite(self, src: str) -> str:
        if not src or is_external_image(src):
            return src

        rel = safe_rel_image_path(src)
        candidates = [
            self.package_root / Path(*rel.parts),
            self.package_root / "images" / Path(*rel.parts),
        ]
        source = next((item for item in candidates if item.exists() and item.is_file()), None)
        if source is None:
            self.warnings.append(f"图片不存在：{src}")
            return src

        if source.suffix.lower() not in IMAGE_EXTS:
            self.warnings.append(f"图片格式不建议使用：{src}")

        # Preserve image subfolders below the package while blocking path traversal.
        if rel.parts and rel.parts[0] == "images":
            target_rel = PurePosixPath(*rel.parts[1:]) if len(rel.parts) > 1 else PurePosixPath(source.name)
        else:
            target_rel = rel
        if target_rel.name == "":
            target_rel = target_rel / source.name

        target = self.target_root / Path(*target_rel.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        public_path = f"{self.public_prefix}/{self.slug}/{target_rel.as_posix()}"
        self.copied[str(source)] = public_path
        return public_path

    def rewrite_many(self, values: list[str]) -> list[str]:
        return [self.rewrite(value) for value in values if value]


def parse_question(section_number: str, body: str, group: dict, sequence: int, images: ImageRewriter) -> dict:
    options = ["", "", "", ""]
    option_images = [[], [], [], []]
    stem_parts: list[str] = []
    stem_images: list[str] = []
    explanation_parts: list[str] = []
    explanation_images: list[str] = []
    answer = 0
    mode = "stem"

    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        option_match = re.match(r"^([A-D])\s*[.、：:]\s*(.*)$", line, re.I)
        if option_match:
            idx = ord(option_match.group(1).upper()) - ord("A")
            value = option_match.group(2) or ""
            options[idx] = clean_md_value(value) or option_match.group(1).upper()
            option_images[idx].extend(images.rewrite_many(extract_images(value)))
            mode = "options"
            continue

        key, value = parse_meta(line)
        if key == "题干":
            stem_parts.append(clean_md_value(value))
            stem_images.extend(images.rewrite_many(extract_images(value)))
            mode = "stem"
            continue
        if key == "答案":
            answer = answer_index(value)
            mode = "answer"
            continue
        if key == "解析":
            explanation_parts.append(clean_md_value(value))
            explanation_images.extend(images.rewrite_many(extract_images(value)))
            mode = "explanation"
            continue

        if mode == "explanation":
            explanation_parts.append(clean_md_value(line))
            explanation_images.extend(images.rewrite_many(extract_images(line)))
        elif mode == "stem":
            stem_parts.append(clean_md_value(line))
            stem_images.extend(images.rewrite_many(extract_images(line)))

    paper_id = group.get("paper_id") or slugify(group.get("paper_name", "paper"))
    question_id = f"q_{paper_id}_{int(section_number or sequence + 1):03d}"
    return {
        "_id": question_id,
        "module_id": group["module_id"],
        "type": "single",
        "difficulty": group.get("difficulty") or "中等",
        "source": group.get("source") or "自建题库",
        "year": group.get("year") or 2026,
        "content": "\n".join(part for part in stem_parts if part).strip(),
        "material": group.get("material") or "",
        "material_images": group.get("material_images") or [],
        "stem_images": stem_images,
        "options": options,
        "option_images": option_images,
        "answer": answer,
        "explanation": "\n".join(part for part in explanation_parts if part).strip(),
        "explanation_images": explanation_images,
        "tags": group.get("tags") or [],
        "paper_id": paper_id,
        "paper_name": group.get("paper_name") or "",
        "province": group.get("province") or "国家",
        "points": 1,
        "status": "enabled",
    }


def validate_question(question: dict) -> list[str]:
    errors: list[str] = []
    if not question.get("_id"):
        errors.append("_id 缺失")
    if not question.get("content"):
        errors.append("题干缺失")
    option_count = max(
        len([item for item in question.get("options", []) if str(item).strip()]),
        len([item for item in question.get("option_images", []) if item]),
    )
    if option_count < 2:
        errors.append("选项少于 2 个")
    if question.get("module_id") not in {"mod_data", "mod_logic", "mod_quantity", "mod_language", "mod_common_sense"}:
        errors.append("模块无效")
    if not isinstance(question.get("answer"), int):
        errors.append("单选答案必须是数字索引")
    return errors


def parse_markdown(markdown: str, package_slug: str, images: ImageRewriter) -> list[dict]:
    text = markdown.replace("\r\n", "\n").replace("\r", "\n")
    groups = [item.strip() for item in re.split(r"^##\s+", text, flags=re.M) if item.strip()]
    questions: list[dict] = []

    for group_index, group_text in enumerate(groups):
        lines = group_text.splitlines()
        title = lines.pop(0).strip() if lines else f"题组{group_index + 1}"
        body = "\n".join(lines)
        year_match = re.search(r"(20\d{2}|19\d{2})", title)
        group = {
            "module_id": module_id_from_text(title),
            "year": int(year_match.group(1)) if year_match else 2026,
            "paper_name": re.sub(r"^题组[：:]\s*", "", title).strip(),
            "source": "自建题库",
            "difficulty": "中等",
            "tags": [],
            "material": "",
            "material_images": [],
            "paper_id": f"{package_slug}_{group_index + 1:03d}",
        }

        before_first_question = re.split(r"^###\s*\d+", body, maxsplit=1, flags=re.M)[0] if body else ""
        for line in before_first_question.splitlines():
            key, value = parse_meta(line)
            if key == "模块":
                group["module_id"] = module_id_from_text(value)
            elif key == "年份":
                group["year"] = int(value) if value.isdigit() else group["year"]
            elif key == "试卷":
                group["paper_name"] = value
            elif key == "来源":
                group["source"] = value
            elif key == "难度":
                group["difficulty"] = value
            elif key == "题组ID":
                group["paper_id"] = slugify(value)
            elif key == "标签":
                group["tags"] = [item.strip() for item in re.split(r"[,，、]", value) if item.strip()]

        material_match = re.search(r"^###\s*材料\s*\n([\s\S]*?)(?=^###\s*\d+|\Z)", body, flags=re.M)
        if material_match:
            material = material_match.group(1)
            group["material"] = "\n".join(item.strip() for item in strip_images(material).splitlines() if item.strip())
            group["material_images"] = images.rewrite_many(extract_images(material))

        question_matches = list(re.finditer(r"^###\s*(\d+)\s*\n([\s\S]*?)(?=^###\s*\d+|\Z)", body, flags=re.M))
        for match in question_matches:
            questions.append(parse_question(match.group(1), match.group(2), group, len(questions), images))

    return questions


def locate_package_root(input_path: Path, temp_dir: tempfile.TemporaryDirectory | None) -> Path:
    if input_path.is_dir():
        return input_path
    if input_path.suffix.lower() != ".zip":
        raise ValueError("输入必须是题库文件夹或 .zip 文件")
    if temp_dir is None:
        raise ValueError("缺少临时目录")
    with zipfile.ZipFile(input_path) as archive:
        archive.extractall(temp_dir.name)
    root = Path(temp_dir.name)
    children = [item for item in root.iterdir() if item.is_dir()]
    if len(children) == 1 and (children[0] / "questions.md").exists():
        return children[0]
    return root


def find_questions_md(package_root: Path) -> Path:
    direct = package_root / "questions.md"
    if direct.exists():
        return direct
    matches = list(package_root.rglob("questions.md"))
    if matches:
        return matches[0]
    raise FileNotFoundError("题库包中没有找到 questions.md")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def convert(args: argparse.Namespace) -> dict:
    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output_dir).resolve()
    assets_dir = Path(args.assets_dir).resolve()
    temp_dir = tempfile.TemporaryDirectory(prefix="kg-bank-") if input_path.is_file() else None

    try:
        package_root = locate_package_root(input_path, temp_dir)
        questions_md = find_questions_md(package_root)
        package_slug = slugify(args.slug or input_path.stem or package_root.name)
        rewriter = ImageRewriter(package_root, assets_dir, args.public_prefix, package_slug)
        markdown = questions_md.read_text(encoding="utf-8-sig")
        questions = parse_markdown(markdown, package_slug, rewriter)

        invalid = []
        valid = []
        for index, question in enumerate(questions):
            errors = validate_question(question)
            if errors:
                invalid.append({"index": index, "_id": question.get("_id"), "errors": errors})
            else:
                valid.append(question)

        all_path = output_dir / f"{package_slug}-questions.json"
        valid_path = output_dir / f"{package_slug}-questions-valid-only.json"
        report_path = output_dir / f"{package_slug}-parse-report.json"
        write_json(all_path, questions)
        write_json(valid_path, valid)

        report = {
            "input": str(input_path),
            "package_root": str(package_root),
            "questions_md": str(questions_md),
            "total": len(questions),
            "valid": len(valid),
            "invalid_count": len(invalid),
            "invalid": invalid,
            "copied_images": len(rewriter.copied),
            "warnings": rewriter.warnings,
            "output_json": str(all_path),
            "valid_json": str(valid_path),
            "report_json": str(report_path),
        }
        write_json(report_path, report)
        return report
    finally:
        if temp_dir is not None:
            temp_dir.cleanup()


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert question-bank folder/zip to admin JSON.")
    parser.add_argument("--input", required=True, help="题库包文件夹或 .zip 路径")
    parser.add_argument("--output-dir", required=True, help="输出 JSON 目录")
    parser.add_argument("--assets-dir", required=True, help="图片复制目标目录")
    parser.add_argument("--public-prefix", default="/assets/question-images/package-bank", help="写入 JSON 的图片 URL 前缀")
    parser.add_argument("--slug", default="", help="输出文件和图片目录名")
    args = parser.parse_args()
    print(json.dumps(convert(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
