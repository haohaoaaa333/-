# -*- coding: utf-8 -*-
"""
MinerU Worker.
Orchestrates PDF ingestion using MinerU, ensures single-GPU lock, runs deterministic
splitting logic, and outputs raw_questions.json.
"""

import os
import sys
import json
import time
import subprocess
import argparse
from pathlib import Path

# Add scripts directory to path to import split_questions
sys.path.insert(0, str(Path(__file__).resolve().parent / "刷题小程序1.0" / "scripts"))
try:
    import split_questions as sq
except ImportError:
    # Try alternate paths
    sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
    try:
        import split_questions as sq
    except ImportError as e:
        print(f"Error: Could not import split_questions.py: {e}")
        sys.exit(1)


def acquire_lock(lock_file_path: str):
    """Acquires a simple filesystem lock for serialization (GPU Lock)."""
    while True:
        try:
            # Try to exclusively create the lock file
            fd = os.open(lock_file_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            return fd
        except FileExistsError:
            print("  [LOCK] MinerU is currently running on another task. Waiting for GPU memory lock...")
            time.sleep(5)


def release_lock(fd, lock_file_path: str):
    """Releases the lock and deletes the lock file."""
    try:
        os.close(fd)
        os.remove(lock_file_path)
    except Exception as e:
        print(f"  [LOCK-WARN] Failed to release lock cleanly: {e}")


def run_mineru(pdf_path: str, output_dir: str, backend: str) -> bool:
    """Invokes MinerU CLI based on environment configuration."""
    mineru_command = os.environ.get("MINERU_COMMAND", "mineru")
    mineru_python = os.environ.get("MINERU_PYTHON", "")
    
    cmd = []
    if mineru_python and os.path.exists(mineru_python):
        cmd = [
            mineru_python, "-m", "mineru.cli.client",
            "-p", pdf_path,
            "-o", output_dir,
            "-b", backend
        ]
    else:
        cmd = [
            mineru_command,
            "-p", pdf_path,
            "-o", output_dir,
            "-b", backend
        ]
        
    print(f"Running MinerU command: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        print("MinerU ran successfully.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"MinerU execution failed with code {e.returncode}")
        print(f"Stdout:\n{e.stdout.decode('utf-8', errors='ignore')}")
        print(f"Stderr:\n{e.stderr.decode('utf-8', errors='ignore')}")
        return False
    except Exception as e:
        print(f"Failed to launch MinerU process: {e}")
        return False


def find_output_files(output_dir: str) -> tuple[str | None, str | None]:
    """Scans the output directory for markdown text files and content list JSONs."""
    md_file = None
    cl_file = None
    
    # Standard MinerU output produces paths under a subfolder matching the PDF's stem.
    # We walk the output_dir to find md and json.
    all_mds = []
    for root, dirs, files in os.walk(output_dir):
        for f in files:
            p = os.path.join(root, f)
            if f.endswith(".md"):
                all_mds.append(p)
            elif "content_list" in f and f.endswith(".json"):
                cl_file = p
                
    if all_mds:
        # Prioritize auto/ directories if available
        all_mds.sort(key=lambda x: 0 if "/auto/" in x.replace("\\", "/") else 1)
        md_file = all_mds[0]
        
    return md_file, cl_file


def process_pdf_to_raw_questions(pdf_path: str, output_dir: str, raw_output_path: str, backend: str):
    """Full workflow: Lock -> Run MinerU -> Slices -> Output JSON."""
    # Ensure directories exist
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    Path(raw_output_path).parent.mkdir(parents=True, exist_ok=True)
    
    lock_file = os.path.join(os.environ.get("TEMP", "."), "mineru_gpu.lock")
    print(f"Acquiring GPU lock: {lock_file}")
    lock_fd = acquire_lock(lock_file)
    
    success = False
    try:
        success = run_mineru(pdf_path, output_dir, backend)
    finally:
        print("Releasing GPU lock.")
        release_lock(lock_fd, lock_file)
        
    if not success:
        print("Worker failed because MinerU execution crashed.")
        sys.exit(1)
        
    print("MinerU finished. Locating output files...")
    md_file, cl_file = find_output_files(output_dir)
    
    if not md_file:
        print(f"Error: No Markdown output files found in {output_dir}")
        sys.exit(1)
        
    print(f"Found Markdown: {md_file}")
    if cl_file:
        print(f"Found Content List: {cl_file}")
    else:
        print("No Content List JSON found (will run splitter without layout coordinates).")
        
    # Read Markdown and Content List
    markdown_content = Path(md_file).read_text(encoding="utf-8")
    content_list = None
    if cl_file and os.path.exists(cl_file):
        try:
            content_list = json.loads(Path(cl_file).read_text(encoding="utf-8"))
            if isinstance(content_list, dict):
                content_list = content_list.get("pdf_info", [content_list])
        except Exception as e:
            print(f"Warning: Failed to load content list JSON: {e}")
            
    # Run the Python split logic
    print("Slicing markdown text into raw question structure...")
    split_result = sq.split_markdown(markdown_content, content_list)
    
    # Save raw questions JSON
    print(f"Saving raw questions to {raw_output_path}...")
    with open(raw_output_path, "w", encoding="utf-8") as f:
        json.dump(split_result, f, ensure_ascii=False, indent=2)
        
    print(f"✅ Slicing completed. Extracted {split_result.get('question_count', 0)} questions.")


def main():
    parser = argparse.ArgumentParser(description="MinerU worker (PDF ingestion, serial parsing & slicing)")
    parser.add_argument("--pdf", required=True, help="Path to input PDF paper")
    parser.add_argument("--output-dir", default="output", help="Directory for MinerU layout outputs")
    parser.add_argument("--raw-questions", default="raw_questions.json", help="Path to output raw questions json")
    parser.add_argument("--backend", default="pipeline", help="MinerU parsing backend configuration (pipeline or layout)")
    
    args = parser.parse_args()
    
    process_pdf_to_raw_questions(
        args.pdf,
        args.output_dir,
        args.raw_questions,
        args.backend
    )


if __name__ == "__main__":
    main()
