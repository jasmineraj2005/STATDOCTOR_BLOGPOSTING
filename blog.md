# blog.md — StatDoctor editorial system

The StatDoctor blog exists to rank on page one of Google for high-intent locum
queries and to convert that traffic to doctor sign-ups on the app. Every
editorial decision is graded against those two outcomes.

This doc owns *what we publish and why*. Engineering bible: `AGENTS.md`.
Pipeline integration bible: `BLOG_AGENT.md`.

---

## Three streams (40 / 40 / 20)

| Stream | Driver | Decay | Example |
|---|---|---|---|
| **News** | News-cycle, Intelligence agent fans out across 5 news adapters | Days | Geelong refinery fire and locum travel costs; Medicare reform impact on locum billing |
| **Guides** | Pillar-coverage gaps, evergreen topic bank | Years | Locum GP rates by state 2026; AHPRA registration step-by-step |
| **Inside StatDoctor** | Founder POV, marketplace mechanics | Years | Why we built StatDoctor; The economics of removing the middleman |

The Intelligence agent runs the 40/40/20 weighting automatically with two override rules:

1. Never run three of the same `content_type` in a row.
2. Force a guide if any of `{Pay & Rates, How-to, Location, Wellbeing}` has zero coverage in the last 12 posts.

Manual override: `MODE=news|guide|company python main.py`.

---

## Pillar map

| Pillar | Content types | Cluster anchor |
|---|---|---|
| `industry_news` | news | "What changed for locums this month" |
| `locum_pay_rates` | guide | "Locum GP rates by state" |
| `how_to_locum` | guide | "AHPRA registration walkthrough" |
| `locum_by_location` | guide | "Locum work in regional NSW" |
| `doctor_wellbeing` | guide | "Burnout in locum medicine" |
| `locum_vs_agency` | guide, company | "Marketplace vs agency fee structures" |
| `company_pov` | company | "Why we built StatDoctor" |

---

## Voice rules

- Australian English (organisation, licence, practise, recognise).
- Doctor-first, not patient-first. Readers are clinicians.
- Marketplace honest about limitations. Don't oversell.
- **AHPRA-banned**: best, number one, #1, guaranteed, cure, leading, world-class, miracle, proven, 100% safe, no side effects.
- **Editorially banned**: comprehensive, delve, today, this week, recently (in guides), groundbreaking, robust, world-class.
- Anchor text on inline citations is the entity name, never `[source]`. Example: "[AHPRA registration requirements](https://www.ahpra.gov.au/...)" — not "[source](...)".
- Currency: `A$` or `AUD` prefix, never bare `$`.
- Dates absolute, never relative (`April 2026`, not `last month`).

---

## Competitor positioning

Each competitor's blog is a topic source, not a template. We take inspiration on what to cover, not how to write.

| Competitor | Their angle | What they do well | StatDoctor differentiator |
|---|---|---|---|
| [Hopmedic](https://hopmedic.com/) | Marketplace + telehealth | Closest model to ours | We're zero-commission; they take a cut |
| [Go Locum](https://golocum.com.au/) | Web-app for flexible shifts | Remote AU coverage | We have hospital depth; they're rural-thin |
| [Wavelength](https://wave.com.au/) | Largest AU recruiter (agency, since 1999) | Brand authority + content depth | We don't take buyout fees |
| [Medrecruit](https://medrecruit.medworld.com/) | Australasia's largest recruiter | Volume of placements | We're direct, not gatekept |
| [Blugibbon](https://www.blugibbon.com.au/) | Boutique Sydney agency | Personal-service narrative | We scale personal at zero margin |
| [Locumate](https://locumate.ai/) | Multi-vertical AU staffing | Live ROI calculator | We focus on doctors specifically |
| [Patchwork Health](https://patchwork.health) | UK collaborative bank | Strongest brand voice in the category globally | We bring that voice to AU regs |
| [Nomad Health](https://nomadhealth.com) | US travel medicine marketplace | Scroll-driven editorial design | We localise editorially for AU/NZ |
| [ShiftKey](https://www.shiftkey.com) | US per-diem marketplace | Strongest photographic direction | We pair photography with primary-source rigour |

The competitor audit at `app/api/cron/competitor-audit` runs **Mon/Wed/Fri 14:00 UTC** (midnight Sydney AEDT), scrapes each blog index, and proposes additions to the evergreen topic bank. Approvals at `/admin/competitor-topics`.

---

## Quality bar — publishing checklist

Pre-merge, every new post JSON must satisfy:

- [ ] AHPRA agent passed (or flags reviewed by a clinician)
- [ ] ≥3 distinct publishers cited; ≥1 government / peer-reviewed
- [ ] Anchor text uses entity names, never `[source]`
- [ ] Hero image renders in full (no crop) with publisher + title citation
- [ ] Callout quota met (4 guides, 3 news, 3 company)
- [ ] FAQ count met (8+ guides, 6+ news, 4+ company)
- [ ] Internal links present (3–5 guides, 1–2 news, 2–3 company)
- [ ] Schema validates (FAQPage + MedicalScholarlyArticle + BreadcrumbList)
- [ ] Slug ≤ 60 chars; TL;DR ≤ 240 chars
- [ ] meta_title ≤ 60; meta_description ≤ 155
- [ ] Word count in band (1500–2000 news, 2000–2800 guide, 1200–1800 company)

---

## Topic bank pointers

- **Evergreen seed**: `backend/data/evergreen_topics.json` (30 cornerstone topics across 6 pillars).
- **Competitor proposals**: Vercel KV `competitor:proposed:latest`, surfaced at `/admin/competitor-topics`.
- **Dedupe ledger**: `backend/past_topics.json` — structured, with `content_type`, `pillar`, `slug`, `ts`.
- **Approved competitor adds**: copied from admin UI into the seed file as a versioned PR. Direct GitHub-API auto-PR is a v2 enhancement.

---

## Operations

| Action | Command |
|---|---|
| News run | `MODE=news python main.py` |
| Guide run | `MODE=guide python main.py` |
| Company run | `MODE=company python main.py` |
| Auto run (40/40/20) | `python main.py` |
| Regenerate single post | `python main.py --regen <slug>` |
| Backfill `content_type` on existing posts | `python -m backend.scripts.backfill_content_type` |
| Migrate `past_topics.json` schema | `python -m backend.scripts.migrate_past_topics` |
| Trigger competitor audit manually | `curl -H "Authorization: Bearer $CRON_SECRET" https://statdoctor.app/api/cron/competitor-audit` |

---

## Editorial cadence

Default schedule (when scheduler is enabled): one post every 48 hours, picked by the dispatcher per the 40/40/20 weighting. At that cadence the blog ships ~15 posts/month: ~6 news, ~6 guides, ~3 company.

Quarterly: review every guide for stale figures, update `dateModified`, re-publish. AHPRA fees, pay rates, tax thresholds, and Medicare item numbers are the most common rot.
