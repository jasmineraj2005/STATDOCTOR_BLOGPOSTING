import os
from pathlib import Path
from dotenv import load_dotenv

_root = Path(__file__).parent

# Load .env — try parent dir first (shared with Next.js frontend), then local
for candidate in [_root.parent / ".env", _root / ".env"]:
    if candidate.exists():
        load_dotenv(candidate)
        break

OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
GUARDIAN_API_KEY: str = os.environ.get("GUARDIAN_API_KEY", "")
UNSPLASH_ACCESS_KEY: str = os.environ.get("UNSPLASH_ACCESS_KEY", "")

# Models — gpt-4o for quality writing, gpt-4o-mini for structured tasks
WRITER_MODEL = "gpt-4o"
FAST_MODEL = "gpt-4o-mini"

# Site
SITE_URL = "https://statdoctor.app"
SITE_NAME = "StatDoctor"

# Content
MIN_WORDS = 1500
MAX_WORDS = 2500

# Paths
OUTPUT_DIR = _root / "output"
OUTPUT_DIR.mkdir(exist_ok=True)
TOPICS_LOG = _root / "past_topics.json"


def validate():
    """Warn about missing keys at startup."""
    missing = []
    if not OPENAI_API_KEY:
        missing.append("OPENAI_API_KEY")
    if not GUARDIAN_API_KEY:
        missing.append("GUARDIAN_API_KEY (news feed will be skipped)")
    if not UNSPLASH_ACCESS_KEY:
        missing.append("UNSPLASH_ACCESS_KEY (images will be skipped)")
    if missing:
        print(f"[Config] Missing env vars: {', '.join(missing)}")
    if not OPENAI_API_KEY:
        raise EnvironmentError("OPENAI_API_KEY is required. Add it to your .env file.")
