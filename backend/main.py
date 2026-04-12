#!/usr/bin/env python3
"""
StatDoctor Blog Automation Pipeline
====================================

Usage:
  python main.py                Run once right now
  python main.py --schedule     Run now, then every 2 days automatically

Output:
  backend/output/<timestamp>_<slug>.json   Full post data (JSON)
  backend/output/<timestamp>_<slug>.md     Blog post with YAML frontmatter
"""

import sys


def main() -> None:
    # Validate env vars before doing anything
    from config import validate
    validate()

    if "--schedule" in sys.argv:
        from scheduler import start_scheduler
        start_scheduler(run_now=True)
    else:
        from pipeline import run_pipeline
        run_pipeline()


if __name__ == "__main__":
    main()
