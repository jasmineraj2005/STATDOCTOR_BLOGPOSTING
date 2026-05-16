# M3 Domain Attach Runbook

`blog.statdoctor.app` → live + GSC + Bing + Perplexity Publisher enrolled.
**Total time: ~17 minutes.** All steps are browser clicks or one terminal command.

Path A is picked (per `DOMAIN_CUTOVER.md`): subdomain CNAME pointing at Vercel. The Webflow site at `statdoctor.app` is untouched.

---

## 0. Pre-flight (1 min)

Confirm you have all of these open and accessible before starting:

| What | Where |
|---|---|
| GoDaddy account that controls `statdoctor.app` DNS | <https://dcc.godaddy.com/control/portfolio/statdoctor.app/settings/dns> |
| Vercel project `statdoctor-blogposting` | <https://vercel.com/dashboard> |
| Google account that can verify a domain (Workspace or personal — both work) | Google Search Console login |
| Microsoft account | Bing Webmaster login |
| Perplexity account (free signup if you don't have one) | <https://www.perplexity.ai> |

Have a text editor open (notes app is fine) to accumulate these four values as you generate them:

| Env var name | What it is | Generated in step |
|---|---|---|
| `GSC_SERVICE_ACCOUNT_JSON` | Full JSON key file contents (single line) | Step 3 |
| `GSC_SITE_URL` | `sc-domain:statdoctor.app` | Hardcoded — paste this exactly |
| `BING_WEBMASTER_API_KEY` | API key from Bing Webmaster console | Step 4 |
| `BING_SITE_URL` | `https://blog.statdoctor.app/` | Hardcoded — paste this exactly |

You'll paste all four into Vercel in step 5 in one go.

---

## 1. Subdomain DNS (~3 min, GoDaddy)

1. Go to <https://dcc.godaddy.com/control/portfolio/statdoctor.app/settings/dns>
2. Log in if prompted.
3. Scroll to the **DNS Records** table. Click **Add New Record**.
4. Fill in:
   - **Type:** CNAME
   - **Name:** `blog`
   - **Value:** `cname.vercel-dns.com`
   - **TTL:** 1 Hour (3600)
5. Click **Save**.
6. Verify the record appears in the table: Name=`blog`, Type=CNAME, Value=`cname.vercel-dns.com`.

Propagation check — run this in Terminal (can take 1–30 min; move on to step 2 while waiting):

```bash
dig +short blog.statdoctor.app
```

Expected output: one or more Vercel IP addresses (e.g., `76.76.21.21`). If you get `NXDOMAIN` or nothing, GoDaddy hasn't propagated yet — wait 5 min and retry.

---

## 2. Vercel domain attach (~2 min)

1. Open <https://vercel.com/dashboard> → click the **statdoctor-blogposting** project.
2. **Settings** (top navigation) → **Domains** (left sidebar).
3. In the "Add Domain" input, type `blog.statdoctor.app` → click **Add**.
4. Vercel will check the CNAME. If it prompts you to add a record, it should already match what you added in step 1 — click **Verify**.
5. SSL provisioning is automatic. Wait ~1–5 min. The domain status dot turns green when done.

Smoke test once the dot is green:

```bash
curl -sI https://blog.statdoctor.app/ | head -5
```

Expected: `HTTP/2 200` (or `HTTP/2 307` if the app redirects unauthenticated traffic to `/admin`). A `curl: (6) Could not resolve host` or SSL error means provisioning isn't done — wait 2 more minutes and retry.

---

## 3. Google Search Console (~7 min)

### 3a. Verify domain ownership

1. Go to <https://search.google.com/search-console/welcome>
2. In the left-hand panel ("Domain"), type `statdoctor.app` → click **Continue**.
   - Note: choose the **Domain** property type (not the URL-prefix type). Domain covers all subdomains and protocols, so `blog.statdoctor.app` is automatically included.
3. Google displays a TXT record value: `google-site-verification=XXXX...`. Copy the entire value.
4. Back in GoDaddy DNS (<https://dcc.godaddy.com/control/portfolio/statdoctor.app/settings/dns>) → **Add New Record**:
   - **Type:** TXT
   - **Name:** `@`
   - **Value:** paste the `google-site-verification=...` string exactly
   - **TTL:** 1 Hour
5. Click **Save**.
6. Wait ~1 min, then return to GSC and click **Verify**.
   - If it fails: GoDaddy propagation can lag. Wait another 5 min, click Verify again.
   - GSC shows a "Ownership verified" confirmation when done.

### 3b. Create the service account (for the SEO cron)

The `/api/cron/seo-snapshot` cron needs programmatic GSC access. This is a one-time setup.

1. Go to <https://console.cloud.google.com/iam-admin/serviceaccounts>
2. If you have no project: click the project picker (top-left) → **New Project** → name it `statdoctor-seo` → **Create**. Then navigate back to the service accounts page.
3. Click **+ Create Service Account**.
   - Service account name: `statdoctor-seo-pull`
   - Service account ID: `statdoctor-seo-pull` (auto-filled)
   - Click **Create and Continue**
   - Skip the optional role grant — click **Continue**
   - Click **Done**
4. You're back on the service accounts list. Click the row for `statdoctor-seo-pull`.
5. Go to the **Keys** tab → **Add Key** → **Create New Key** → select **JSON** → click **Create**.
6. A `.json` file downloads automatically. Keep this tab open.

Convert the JSON to a single line for Vercel:

```bash
# Replace <path-to-downloaded-file> with the actual file path
cat ~/Downloads/<your-key-file>.json | tr -d '\n'
```

Copy the entire output — this is the value for `GSC_SERVICE_ACCOUNT_JSON`.

7. Open the downloaded JSON in a text editor. Find the `client_email` field — it looks like `statdoctor-seo-pull@statdoctor-seo-XXXXX.iam.gserviceaccount.com`. Copy it.

### 3c. Add the service account to GSC

1. In GSC, click **Settings** (gear icon, bottom-left sidebar) → **Users and permissions**.
2. Click **Add user** (top-right).
   - Email: paste the `client_email` from the JSON
   - Permission: **Owner**
   - Click **Add**
   - Note: Owner is required — Read-only does not grant API access for the Search Analytics endpoint.

### 3d. Submit the sitemap

1. GSC → left sidebar → **Indexing** → **Sitemaps**.
2. Click **Add a new sitemap**.
3. Paste: `https://blog.statdoctor.app/sitemap.xml`
4. Click **Submit**.
5. It will show "0 discovered URLs" initially — that is expected. Google crawls on its own schedule.

---

## 4. Bing Webmaster (~3 min)

1. Go to <https://www.bing.com/webmasters>
2. Sign in with your Microsoft account.
3. Click **Add a site** (or the **+** button).
4. Enter: `https://blog.statdoctor.app/` → click **Add**.
5. On the verification screen, choose **Import from Google Search Console** (this is the fastest path since GSC is already verified above).
   - Click **Import** → sign in with the same Google account used for GSC → grant access.
   - Bing imports the verified sites from GSC. Select `statdoctor.app` → **Import**.
   - Bing will confirm verification instantly.
   - If import-from-GSC fails (see troubleshooting §9): fall back to the TXT record method — same record you added for GSC in step 3a usually satisfies Bing too.
6. Once verified, go to **Settings** (gear icon) → **API Access** → **Generate API Key**.
7. Copy the API key. Save it as `BING_WEBMASTER_API_KEY` in your notes.

---

## 5. Vercel environment variables (~2 min)

1. Vercel → **statdoctor-blogposting** → **Settings** → **Environment Variables**.
2. Add these four variables. For each: set **Environment** to **Production** and **Preview**; leave Development unchecked unless you want to test locally.

| Name | Value |
|---|---|
| `GSC_SERVICE_ACCOUNT_JSON` | the single-line JSON from step 3b |
| `GSC_SITE_URL` | `sc-domain:statdoctor.app` |
| `BING_WEBMASTER_API_KEY` | the key from step 4 |
| `BING_SITE_URL` | `https://blog.statdoctor.app/` |

3. Click **Save** after each one.
4. Vercel triggers a redeployment automatically when env vars are saved. You can confirm under the **Deployments** tab — a new deployment appears within ~30 seconds. If it doesn't, go to Deployments → click the three-dot menu on the most recent deployment → **Redeploy**.

---

## 6. Perplexity Publisher Program (~2 min)

Healthcare publishers receive above-average citation revenue per the program's published examples (source noted in `plan.md` SEO/AEO cross-check, May 2026). Enrollment is free.

1. Go to Perplexity's Publisher Program page. As of the plan's research date, the entry point is via Perplexity's homepage → navigate to **Publishers** or **For Publishers** in the footer. The exact URL may shift — check from <https://www.perplexity.ai> rather than relying on a hardcoded deep link.
2. Sign in with your Perplexity account (create one free if needed).
3. Click **Enroll** or **Apply as Publisher**.
4. Enter your domain: `statdoctor.app` (the root domain, not the subdomain).
5. Domain verification: choose the **DNS TXT record** option. Perplexity will show you a TXT record value.
   - If it's the same format as the GSC TXT (`google-site-verification=...`), the GoDaddy record from step 3a may already satisfy it — try **Verify** before adding a new record.
   - If a different TXT value is required: GoDaddy DNS → Add New Record → Type=TXT, Name=`@`, Value=paste Perplexity's value, TTL=1 Hour → Save. Wait 1–2 min → click Verify.
6. Once enrolled, `statdoctor.app` articles become eligible for citation revenue share. No further configuration needed.

---

## 7. Reporting-delay reality

Do not expect data immediately. The timeline after completing steps 1–6:

| Service | Lag | What you'll see before then |
|---|---|---|
| Google Search Console | 2–3 days | "No data" / empty charts in GSC |
| Bing Webmaster | ~24 hours | Empty reports in Bing console |
| `/admin/seo` dashboard | ~5 days | "Warming up" empty-state until the daily `seo-snapshot` cron (02:00 UTC) has run several times and accumulated a window of data |

Plan for **day 5** as the earliest you'll see meaningful dashboard data. Day 1 is not a signal of anything being wrong.

---

## 8. Verification at +5 days

Run these from Terminal after the waiting period:

```bash
# DNS still resolves to Vercel:
dig +short blog.statdoctor.app

# Vercel serving the app (expect HTTP/2 200 or 307):
curl -sI https://blog.statdoctor.app/ | head -5

# Health endpoint is happy:
curl -s https://statdoctor-blogposting.vercel.app/api/health | jq .

# Manually trigger the SEO snapshot cron (replace $CRON_SECRET with your actual secret):
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://statdoctor-blogposting.vercel.app/api/cron/seo-snapshot | jq .
# → expect { ok: true } or { ok: true, rows: N }
```

Then open the dashboard in a browser:

```
https://statdoctor-blogposting.vercel.app/admin/seo
```

Expected at +5 days: keyword table populated, impressions/clicks charts visible, at least one Bing row in the data.

If the SEO snapshot cron hasn't fired automatically yet, confirm the `cron-seo-snapshot` GitHub Actions workflow is enabled: GitHub → Actions tab → look for a `Cron — seo-snapshot` workflow → should show a green run from the last 24h.

---

## 9. Troubleshooting

### DNS doesn't resolve after 30 min

Check GoDaddy: confirm the CNAME record saved correctly (Name=`blog`, Value=`cname.vercel-dns.com` — no trailing slash, no `https://`). GoDaddy TTL settings affect how quickly changes propagate externally; 1 Hour is correct. If the record looks right in GoDaddy but `dig` still returns nothing, wait another 30 min — GoDaddy propagation can occasionally take up to 2 hours. You can also check from a second network (phone hotspot) to rule out local DNS caching.

### GSC verification fails

The TXT record hasn't propagated to Google's resolvers yet. Wait 5 min and click Verify again in GSC. If it keeps failing after 15 min: confirm the TXT record in GoDaddy is under Name=`@` (not `blog` or blank), and that the Value is the full `google-site-verification=...` string with no extra spaces or quotes.

### Service account returns 403 on the GSC API

The service account email was not added as an Owner in GSC, or was added with a lower permission level. Go to GSC → Settings → Users and permissions → confirm the `client_email` appears with **Owner** permission. If it shows **Read-only** or is missing: remove it, re-add it as Owner. Allow 5 min for the permission to propagate before testing the cron again.

### Bing import-from-GSC fails

This occasionally happens if the Google OAuth flow times out or Bing can't access GSC. Manual fallback: in Bing Webmaster → verification screen → choose **XML file** or **Meta tag** method. The Meta tag method requires adding a `<meta>` tag to the blog's `<head>` — check `extracted/app/layout.tsx` for where to add it, or choose the TXT record method instead (same GoDaddy flow as GSC verification above, using Bing's TXT value).

### SEO dashboard still empty after 5 days

1. Check Vercel function logs: Vercel → statdoctor-blogposting → **Logs** → filter by `/api/cron/seo-snapshot`.
2. Look for errors. Common ones:
   - `GSC_SERVICE_ACCOUNT_JSON is not set` — the env var didn't save; re-add it in Vercel Settings → Environment Variables.
   - `Error 403: The caller does not have permission` — service account permission issue; see "Service account returns 403" above.
   - `BING_WEBMASTER_API_KEY is not set` — same fix in Vercel env vars.
3. If logs show the cron is succeeding but the dashboard is still empty: query the DB directly via Neon dashboard → SQL editor:
   ```sql
   SELECT source, captured_on, COUNT(*) FROM seo_snapshots GROUP BY 1, 2 ORDER BY 2 DESC LIMIT 10;
   ```
   If this returns rows, the data is in the DB — the issue is the dashboard query or rendering. If it returns nothing, the cron is silently not writing rows; check for upsert constraint errors in the logs.

### Perplexity enrollment page not found

Perplexity's Publisher Program URL changes as the product evolves. Start from <https://www.perplexity.ai> and look for a **Publishers** or **For Publishers** link in the header or footer. If the program isn't surfaced there, check <https://www.perplexity.ai/hub/blog> for an announcement post with a direct enrollment link.

---

## Done checklist

- [ ] CNAME record in GoDaddy: Name=`blog`, Value=`cname.vercel-dns.com`
- [ ] `blog.statdoctor.app` added to Vercel `statdoctor-blogposting` project; SSL green
- [ ] `curl -sI https://blog.statdoctor.app/` returns 200 or 307
- [ ] GSC Domain property `statdoctor.app` verified (TXT in GoDaddy)
- [ ] Service account `statdoctor-seo-pull` created; JSON key downloaded
- [ ] Service account email added to GSC as Owner
- [ ] Sitemap submitted: `https://blog.statdoctor.app/sitemap.xml`
- [ ] `GSC_SERVICE_ACCOUNT_JSON` and `GSC_SITE_URL` set in Vercel
- [ ] Bing `https://blog.statdoctor.app/` verified via GSC import
- [ ] `BING_WEBMASTER_API_KEY` and `BING_SITE_URL` set in Vercel
- [ ] Vercel redeployed (confirm green deployment)
- [ ] Perplexity Publisher Program enrolled for `statdoctor.app`
- [ ] Calendar reminder set for +5 days to run verification checks (§8)
