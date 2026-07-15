# -*- coding: utf-8 -*-
"""
[DEPRECATED] Legacy PDF parser.
This script has been refactored and upgraded to a multi-stage pipeline:
1. mineru_worker.py (Runs MinerU and extracts raw questions text/images)
2. ai_structurer.py (AI-based standard schema question structure)
3. question_schema.py (Strict question validation schema)

Please use the new tools directly.
"""

import sys

def main():
    print("=" * 80)
    print("[DEPRECATED] parse_pdfs.py has been upgraded to a modular pipeline!")
    print("Please use the following new scripts:")
    print("  1. mineru_worker.py - to run MinerU layout parsing and deterministic slicing")
    print("  2. ai_structurer.py - to structure raw question segments into standard JSON via AI")
    print("  3. question_schema.py - to define and validate the question database schemas")
    print("\nExample Ingestion Flow:")
    print("  python mineru_worker.py --pdf my_paper.pdf --output-dir ./out --raw-questions ./out/raw_questions.json")
    print("  python ai_structurer.py --input ./out/raw_questions.json --output ./out/question_drafts.json")
    print("=" * 80)
    sys.exit(1)

if __name__ == "__main__":
    main()
