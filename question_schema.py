# -*- coding: utf-8 -*-
"""
Question Schema Definition and Strict Validation.
Defines the standard structured question schema and provides utility functions
to validate raw and structured question records.
"""

from typing import Dict, Any, List, Tuple, Optional

# Valid question types
VALID_TYPES = {"single_choice", "multiple_choice", "subjective"}

# Valid difficulties
VALID_DIFFICULTIES = {"easy", "medium", "hard"}

# Valid answer values (A, B, C, D) for choices
VALID_ANSWERS = {"A", "B", "C", "D", None}

def validate_question(q: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validates a question dict against the standard schema.
    Returns:
        (is_valid, errors_list)
    """
    errors = []

    # 1. Check required fields and types
    required_fields = {
        "question_no": int,
        "type": str,
        "stem": str,
        "options": list,
        "images": list,
        "knowledge_points": list,
        "difficulty": str,
        "confidence": (float, int)  # confidence can be int (like 1) or float (like 0.95)
    }

    for field, expected_type in required_fields.items():
        if field not in q:
            errors.append(f"Missing required field: '{field}'")
            continue
        val = q[field]
        if not isinstance(val, expected_type):
            errors.append(f"Field '{field}' should be of type {expected_type}, got {type(val).__name__}")

    # 2. Check if answer field exists (can be string or None)
    if "answer" not in q:
        errors.append("Missing required field: 'answer'")
    else:
        ans = q["answer"]
        if ans is not None and not isinstance(ans, str):
            errors.append(f"Field 'answer' must be string or null, got {type(ans).__name__}")
        elif isinstance(ans, str):
            clean_ans = ans.strip().upper()
            if clean_ans not in VALID_ANSWERS:
                errors.append(f"Invalid answer: '{ans}'. Must be one of {VALID_ANSWERS}")

    # 3. Check type constraints
    if "type" in q and isinstance(q["type"], str):
        if q["type"] not in VALID_TYPES:
            errors.append(f"Invalid type: '{q['type']}'. Must be one of {VALID_TYPES}")

    # 4. Check options structures
    if "options" in q and isinstance(q["options"], list):
        for idx, opt in enumerate(q["options"]):
            if not isinstance(opt, dict):
                errors.append(f"Option at index {idx} must be a dictionary, got {type(opt).__name__}")
                continue
            if "key" not in opt:
                errors.append(f"Option at index {idx} is missing 'key'")
            elif not isinstance(opt["key"], str) or opt["key"].upper() not in {"A", "B", "C", "D"}:
                errors.append(f"Option 'key' must be A, B, C, or D, got {opt.get('key')}")
            
            if "text" not in opt:
                errors.append(f"Option at index {idx} is missing 'text'")
            elif not isinstance(opt["text"], str):
                errors.append(f"Option 'text' must be a string, got {type(opt['text']).__name__}")

    # 5. Check images constraints
    if "images" in q and isinstance(q["images"], list):
        for idx, img in enumerate(q["images"]):
            if not isinstance(img, str):
                errors.append(f"Image path at index {idx} must be a string, got {type(img).__name__}")

    # 6. Check knowledge points constraints
    if "knowledge_points" in q and isinstance(q["knowledge_points"], list):
        for idx, kp in enumerate(q["knowledge_points"]):
            if not isinstance(kp, str):
                errors.append(f"Knowledge point at index {idx} must be a string, got {type(kp).__name__}")

    # 7. Check difficulty constraints
    if "difficulty" in q and isinstance(q["difficulty"], str):
        if q["difficulty"] not in VALID_DIFFICULTIES:
            errors.append(f"Invalid difficulty: '{q['difficulty']}'. Must be one of {VALID_DIFFICULTIES}")

    # 8. Check confidence bounds
    if "confidence" in q and isinstance(q["confidence"], (float, int)):
        if not (0.0 <= q["confidence"] <= 1.0):
            errors.append(f"Confidence score {q['confidence']} must be between 0.0 and 1.0")

    return len(errors) == 0, errors

def print_validation_report(q: Dict[str, Any]) -> None:
    """Helper to print validation report for a question."""
    valid, errors = validate_question(q)
    if valid:
        print(f"Question #{q.get('question_no')} validates successfully.")
    else:
        print(f"Question #{q.get('question_no')} validation failed with {len(errors)} error(s):")
        for err in errors:
            print(f"  - {err}")
