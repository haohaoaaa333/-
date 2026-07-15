# -*- coding: utf-8 -*-
"""
AI Structurer.
Sends raw extracted questions to the Gemini LLM API to format them into structured standard JSON questions.
Provides a deterministic regex fallback when the API key is not available.
"""

import os
import json
import re
import sys
import urllib.request
import urllib.error
import argparse
from datetime import datetime, timezone
from pathlib import Path

# Import the schema validator
sys.path.insert(0, str(Path(__file__).resolve().parent))
import question_schema

DEFAULT_MODEL = "gemini-2.5-flash"
API_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

PROMPT_TEMPLATE = """你是考试题库结构化助手。

任务：
将OCR文本转换成标准JSON。

规则：
1. 不修改原题。
2. 不补充不存在的信息。
3. 没有答案返回null。
4. 公式使用LaTeX。
5. 图片保留路径。
6. 只返回JSON。

请将以下题目文本转换成符合JSON Schema的格式：

---
题目文本：
{raw_text}

原始选项：
{options_text}

关联图片：
{images_text}
---
"""

# JSON Schema for Gemini structured output
GEMINI_SCHEMA = {
    "type": "object",
    "properties": {
        "question_no": {"type": "integer"},
        "type": {"type": "string", "enum": ["single_choice", "multiple_choice", "subjective"]},
        "stem": {"type": "string"},
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "enum": ["A", "B", "C", "D"]},
                    "text": {"type": "string"}
                },
                "required": ["key", "text"]
            }
        },
        "images": {
            "type": "array",
            "items": {"type": "string"}
        },
        "answer": {"type": "string", "nullable": True},
        "knowledge_points": {
            "type": "array",
            "items": {"type": "string"}
        },
        "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
        "confidence": {"type": "number"}
    },
    "required": ["question_no", "type", "stem", "options", "images", "answer", "knowledge_points", "difficulty", "confidence"]
}


def call_gemini_api(api_key: str, model: str, prompt: str) -> dict:
    """Calls Gemini API using standard urllib to avoid extra package requirements."""
    url = API_URL_TEMPLATE.format(model=model, api_key=api_key)
    
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "responseSchema": GEMINI_SCHEMA
        }
    }
    
    req_body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_body,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            res_body = response.read().decode("utf-8")
            res_json = json.loads(res_body)
            
            # Extract response text
            candidates = res_json.get("candidates", [])
            if not candidates:
                raise ValueError("Gemini returned empty candidates")
                
            parts = candidates[0].get("content", {}).get("parts", [])
            if not parts:
                raise ValueError("Gemini returned empty parts")
                
            text_content = parts[0].get("text", "").strip()
            
            # Strip markdown block delimiters if any
            if text_content.startswith("```json"):
                text_content = text_content[7:]
            if text_content.endswith("```"):
                text_content = text_content[:-3]
            text_content = text_content.strip()
            
            return json.loads(text_content)
            
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        raise RuntimeError(f"Gemini API request failed with HTTP status {e.code}: {err_msg}")
    except Exception as e:
        raise RuntimeError(f"Error during Gemini call: {str(e)}")


def deterministic_structurer_fallback(raw_q: dict) -> dict:
    """Fallback method to structure a question using regex and logic (no API required)."""
    raw_text = raw_q.get("raw_text", "")
    q_no = raw_q.get("question_no", 0)
    images = raw_q.get("images", [])
    module = raw_q.get("module", "")
    
    # Simple regex option parsing (A/B/C/D)
    opt_re = re.compile(r"(?<![A-Za-z0-9])([A-D])\s*[.．、:：]\s*(.*?)(?=\s*[A-D]\s*[.．、:：]|$)", re.DOTALL)
    matches = opt_re.findall(raw_text)
    
    options = []
    earliest_opt_idx = len(raw_text)
    
    if len(matches) >= 2:
        for key, text in matches:
            text = text.strip()
            # Clean up trailing spaces or content list items
            options.append({"key": key, "text": text})
            # Find earliest option appearance to isolate stem
            idx = raw_text.find(key)
            if idx != -1 and idx < earliest_opt_idx:
                earliest_opt_idx = idx
        stem = raw_text[:earliest_opt_idx].strip()
    else:
        # Check if list format is in raw_q["options"]
        raw_opts = raw_q.get("options", [])
        if len(raw_opts) >= 2:
            for opt_str in raw_opts:
                m = re.match(r"^\s*([A-D])\s*[.．、:：]\s*(.*)$", opt_str)
                if m:
                    options.append({"key": m.group(1), "text": m.group(2).strip()})
                else:
                    options.append({"key": "A", "text": opt_str.strip()})  # dummy
            stem = raw_text.strip()
        else:
            stem = raw_text.strip()
            
    # Clean stem of leading question number
    stem = re.sub(rf"^\s*#{{0,6}}\s*{q_no}\s*[.．、]\s*", "", stem).strip()
    
    # Infer type
    q_type = "single_choice"
    
    # Map difficulties
    difficulty = "medium"
    if module in {"数量关系", "资料分析"}:
        difficulty = "hard"
    elif module in {"常识判断", "言语理解与表达", "政治理论"}:
        difficulty = "easy"
        
    return {
        "question_no": q_no,
        "type": q_type,
        "stem": stem,
        "options": options if options else [{"key": "A", "text": "暂无选项"}],
        "images": images,
        "answer": None,
        "knowledge_points": [module] if module else [],
        "difficulty": difficulty,
        "confidence": 0.50
    }


def structure_question(raw_q: dict, api_key: str | None = None, model: str = DEFAULT_MODEL) -> dict:
    """Structures a single raw question using Gemini or fallback."""
    q_no = raw_q.get("question_no", 0)
    
    if not api_key:
        # No API Key, run fallback
        return deterministic_structurer_fallback(raw_q)
        
    # Build prompt
    prompt = PROMPT_TEMPLATE.format(
        raw_text=raw_q.get("raw_text", ""),
        options_text="\n".join(raw_q.get("options", [])),
        images_text=", ".join(raw_q.get("images", []))
    )
    
    try:
        structured = call_gemini_api(api_key, model, prompt)
        
        # Verify question_no matches
        structured["question_no"] = q_no
        return structured
    except Exception as e:
        print(f"  [WARN] AI structuring failed for Question #{q_no}: {str(e)}. Falling back to deterministic parsing.")
        return deterministic_structurer_fallback(raw_q)


def process_questions(input_file: str, output_file: str, api_key: str | None = None,
                      task_id: str | None = None, model: str = DEFAULT_MODEL):
    """Processes raw_questions.json and writes draft JSON format."""
    input_path = Path(input_file)
    output_path = Path(output_file)
    
    if not input_path.exists():
        print(f"Error: Input file {input_file} does not exist.")
        sys.exit(1)
        
    print(f"Loading raw questions from {input_file}...")
    try:
        raw_data = json.loads(input_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Error reading JSON input: {e}")
        sys.exit(1)
        
    # Check if raw_data is list or dict containing a questions array (from split_questions.py)
    if isinstance(raw_data, dict):
        raw_questions = raw_data.get("questions", [])
        paper_title = raw_data.get("paper_title", "OCR行测试卷")
    else:
        raw_questions = raw_data
        paper_title = "OCR行测试卷"
        
    if not task_id:
        task_id = "task_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        
    print(f"Structuring {len(raw_questions)} questions using model {model}...")
    if not api_key:
        print("  [INFO] GEMINI_API_KEY environment variable not set. Running in deterministic fallback mode.")
    
    drafts_list = []
    
    for idx, raw_q in enumerate(raw_questions):
        q_no = raw_q.get("question_no") or raw_q.get("num") or (idx + 1)
        raw_q["question_no"] = q_no
        
        print(f"  Structuring Question #{q_no}...")
        structured_q = structure_question(raw_q, api_key, model)
        
        # Schema validation
        is_valid, validation_errors = question_schema.validate_question(structured_q)
        if not is_valid:
            print(f"    [WARN] Validation errors in Question #{q_no}:")
            for err in validation_errors:
                print(f"      - {err}")
                
        # Format as CloudBase drafts database structure (一题一档 question_drafts format)
        draft_record = {
            "_id": f"draft_{task_id}_{q_no:03d}",
            "task_id": task_id,
            "question_no": q_no,
            "page": raw_q.get("page"),
            "status": "pending",
            "raw_text": raw_q.get("raw_text", ""),
            "ai_result": structured_q,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        drafts_list.append(draft_record)
        
    # Save the output
    print(f"Saving drafts to {output_file}...")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(drafts_list, f, ensure_ascii=False, indent=2)
        
    print(f"✅ Successfully structured {len(drafts_list)} questions into drafts database format.")


def main():
    parser = argparse.ArgumentParser(description="AI question structurer (OCR raw text -> standard structured JSON drafts)")
    parser.add_argument("--input", default="raw_questions.json", help="Input raw questions json file")
    parser.add_argument("--output", default="question_drafts.json", help="Output JSON path for draft records")
    parser.add_argument("--task-id", default=None, help="CloudBase task identity")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Gemini API Model Name")
    parser.add_argument("--api-key", default=None, help="Gemini API Key (overrides env GEMINI_API_KEY)")
    
    args = parser.parse_args()
    
    api_key = args.api_key or os.environ.get("GEMINI_API_KEY")
    process_questions(args.input, args.output, api_key, args.task_id, args.model)


if __name__ == "__main__":
    main()
