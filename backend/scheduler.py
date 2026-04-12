"""
Scheduler — runs the pipeline every 2 days (alternate days).
Uses APScheduler with a blocking scheduler so it keeps the process alive.

Usage:
  python main.py --schedule
"""

from datetime import datetime

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger


def _run_job() -> None:
    from pipeline import run_pipeline

    print(f"\n[Scheduler] Triggered at {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    try:
        run_pipeline()
    except Exception as e:
        print(f"[Scheduler] Pipeline error: {e}")
        raise


def start_scheduler(run_now: bool = True) -> None:
    """
    Start the scheduler. Runs the pipeline immediately on startup,
    then every 2 days.

    Args:
        run_now: If True, fire one pipeline run before entering the loop.
    """
    if run_now:
        print("[Scheduler] Running initial pipeline before entering schedule...")
        _run_job()

    scheduler = BlockingScheduler(timezone="Australia/Sydney")
    scheduler.add_job(
        _run_job,
        trigger=IntervalTrigger(days=2),
        id="statdoctor_blog_pipeline",
        name="StatDoctor Blog — every 2 days",
        replace_existing=True,
        misfire_grace_time=3600,  # allow up to 1h late if process was down
    )

    jobs = scheduler.get_jobs()
    if jobs:
        next_run = jobs[0].next_run_time
        print(f"\n[Scheduler] Running every 2 days. Next run: {next_run}")

    print("[Scheduler] Press Ctrl+C to stop\n")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        print("\n[Scheduler] Stopped cleanly.")
