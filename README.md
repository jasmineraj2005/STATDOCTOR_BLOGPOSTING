# StatDoctor Blog Platform

A full-stack automated blog platform for StatDoctor — combining a Next.js frontend with a Python AI pipeline that researches, writes, and publishes medical/statistics blog posts.

---

## Project Structure

```
STATDOCTOR_BLOGPOSTING/
├── extracted/          # Next.js frontend
└── backend/            # Python AI blog pipeline
```

---

## Frontend (`extracted/`)

Built with **Next.js 15**, **Tailwind CSS**, and **shadcn/ui**.

### Pages
- `/` — Landing page with animated shader background
- `/login` — Login page (credentials: `anu@statdoctor.au` / `statdoctor@1`)
- `/dashboard` — Blog post dashboard
- `/dashboard/analytics` — Analytics view
- `/dashboard/posts/[slug]` — Individual post detail

### Running locally

```bash
cd extracted
pnpm install
pnpm dev
```

Runs at `http://localhost:3000`

---

## Backend (`backend/`)

A 5-agent OpenAI pipeline that autonomously generates blog posts.

### Agents
1. **Researcher** — Finds relevant topic and sources
2. **Writer** — Drafts the blog post
3. **SEO** — Optimises title, meta, and keywords
4. **AHPRA** — Checks medical compliance
5. **Intelligence** — Final quality review

### Output
Generated posts are saved to `backend/output/` as both `.md` and `.json`.

### Running locally

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add your OpenAI API key
python main.py
```

---

## Environment Variables

Create `backend/.env` (never commit this):

```
OPENAI_API_KEY=your_key_here
```
