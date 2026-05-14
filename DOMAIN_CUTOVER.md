# DOMAIN_CUTOVER.md

Audit of `statdoctor.app` and the steps needed to wire SEO data into the dashboard.

Audit run: 2026-05-14.

---

## What `statdoctor.app` currently serves

```
$ curl -I https://statdoctor.app/
HTTP/2 200
server: cloudflare
x-wf-region: us-east-1          ← Webflow
surrogate-key: pageId:689471e0…  ← Webflow page id
content-type: text/html
```

**It's a Webflow site, fronted by Cloudflare's CDN.** Live in production. Returns 200. Has been responding since at least 2026-05-12 (`last-modified` header).

Other findings:
- `www.statdoctor.app` 301-redirects to the bare domain. Good.
- DNS hosted at **GoDaddy** (`ns65/66.domaincontrol.com`).
- No `sitemap.xml` (404).
- `robots.txt` exists but is empty.

There's a separate Next.js deployment at `statdoctor-frontend.vercel.app` (the author/about page). It's not the production domain — Webflow is.

---

## Decision you need to make

The dashboard's design assumes the blog (`/blog/[slug]`) is rendered by a Next.js site that reads the approved articles from the dashboard's `/api/public/posts` endpoint. But `statdoctor.app` is currently Webflow, which can't render Next.js content natively.

**Three paths forward** — pick one. None are urgent — the dashboard runs fine in all three; the only thing that changes is where blog readers land.

### Path A — Subdomain (lowest risk, simplest)

- Point `blog.statdoctor.app` at the Next.js site (`statdoctor-frontend.vercel.app`).
- Blog readers land at `https://blog.statdoctor.app/sydney-locum-rates-2026`.
- Webflow site at `statdoctor.app` is untouched.
- ~5 min: add a CNAME on GoDaddy → `cname.vercel-dns.com`. Add the domain in the Vercel frontend project. Done.

### Path B — Migrate the whole site off Webflow

- The Next.js frontend (`statdoctor-frontend.vercel.app`) takes over `statdoctor.app`.
- Blog at `statdoctor.app/blog/[slug]`.
- Webflow is sunset.
- ~half a day: rebuild any marketing pages currently on Webflow inside the Next.js app, update DNS, redirect map for any URLs that change.

### Path C — Cloudflare Worker / reverse proxy

- Keep Webflow on `statdoctor.app/`.
- A Cloudflare Worker intercepts `/blog/*` requests and proxies them to the Vercel frontend.
- ~1-2 hours: write the Worker, deploy it, test.
- Most invisible to readers but most moving parts.

**Recommendation: Path A.** Fastest, cleanest, no migration risk. Once you have a year of blog traffic data, you can revisit whether to do Path B.

---

## Search Console + Bing setup (do this regardless of A/B/C)

The SEO dashboard at `/admin/seo` needs Google Search Console + Bing Webmaster data to populate. Both are free and take ~10 min each.

### Google Search Console (~10 min)

1. **Verify ownership.**
   - Go to <https://search.google.com/search-console/welcome>
   - Choose **Domain** property (covers all subdomains + protocols)
   - Enter `statdoctor.app`
   - Google shows a TXT record like `google-site-verification=…`
   - Add it to GoDaddy DNS → Records → Add → Type=TXT, Name=@, Value=`google-site-verification=…`
   - Click Verify in Google's UI

2. **Submit sitemap.** (Path A: `https://blog.statdoctor.app/sitemap.xml`. Path B: `https://statdoctor.app/sitemap.xml`.)
   - GSC → Indexing → Sitemaps → Add a new sitemap → paste the URL → Submit

3. **Create a service account so the SEO cron can pull data.**
   - <https://console.cloud.google.com/iam-admin/serviceaccounts>
   - Create a new project (e.g., "statdoctor-seo"), then Create Service Account
   - Role: leave blank
   - Create a JSON key, download it
   - Open the JSON, copy the entire contents into one line
   - Paste the email (from `client_email` in the JSON) into GSC → Settings → Users and permissions → Add User → Owner

4. **Set Vercel env vars:**
   - `GSC_SERVICE_ACCOUNT_JSON` = the single-line JSON
   - `GSC_SITE_URL` = `sc-domain:statdoctor.app` (note the prefix — required for Domain properties)

### Bing Webmaster (~5 min)

1. <https://www.bing.com/webmasters>
2. Sign in with a Microsoft account
3. Add Site → enter `https://statdoctor.app` (or `https://blog.statdoctor.app` for Path A)
4. **Import from Google Search Console** is the easiest verification path
5. Once verified: Settings → API access → Generate API Key
6. Vercel env:
   - `BING_WEBMASTER_API_KEY` = the key
   - `BING_SITE_URL` = `https://statdoctor.app/` (or `https://blog.statdoctor.app/`)

---

## Reporting-delay reality

- **Google Search Console** has a 2–3 day reporting lag. Even after verification, expect zero data on day 1.
- **Bing** has a ~24h lag.
- The dashboard's "Warming up" empty-state will show until the daily `seo-snapshot` cron has run and pulled a meaningful window of data. Plan for **~5 days** before the dashboard looks alive.

---

## Pre-cutover checklist (when you eventually move blog traffic)

Run through these the day BEFORE you point any new traffic at the Next.js blog:

- [ ] Webflow's existing pages all return 200 (run `wget --spider --recursive --level=2 https://statdoctor.app/` and check log)
- [ ] If Path A: `blog.statdoctor.app` resolves to the Next.js project (`dig +short blog.statdoctor.app` returns Vercel IPs)
- [ ] Vercel project has all env vars populated
- [ ] `/api/admin/migrate` has been run successfully
- [ ] At least 4 articles have status='published' in the DB
- [ ] `/api/public/posts` returns those articles in JSON when called
- [ ] `/sitemap.xml` resolves on the chosen public domain
- [ ] Google PageSpeed score ≥80 on the first blog URL
- [ ] Schema validators pass (https://search.google.com/test/rich-results)
- [ ] You've exported any existing Google Search Console history for `statdoctor.app` (Performance → Export → Download CSV) — this data is irreplaceable

---

## Next action

1. Decide Path A / B / C (default: A).
2. Verify GSC + Bing for `statdoctor.app` (10 + 5 min) — independent of the path you choose, gives you data on whatever Webflow is currently doing.
3. Once GSC is verified, set the two GSC env vars on Vercel.
4. The next `seo-snapshot` cron run (daily 02:00 UTC) starts populating the dashboard.
