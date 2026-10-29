# Mystic Mikado — Shadow Dragon Reader

An offline-first RSS/Atom reader with a Japanese-fantasy interface, continuous ambient sound, and privacy-conscious blog discovery. The original dragon backdrop, ink ripples, sakura motion, sound effects, and ambient synth engine are retained; the reader and server capabilities are built around them.

## What is implemented

- **Unified chronological timeline:** RSS 2.0/RSS 1.x-style item feeds, RDF/RSS, and Atom feeds are parsed in the browser. Posts from subscribed feeds are merged by publication date; read/unread, star, search, and per-feed filtering work locally.
- **Autodiscovery:** Accept a feed URL or a website URL. The client checks `<link rel="alternate">` and common feed paths such as `/feed`, `/rss.xml`, `/atom.xml`, `/feed.xml`, and `/index.xml`.
- **Full-text reader:** The client fetches the original page through `/api/fetch`, performs a Readability-style semantic/content-density extraction in the browser, applies a strict element/attribute allowlist sanitizer before rendering, and falls back to the feed summary when extraction fails or `robots.txt` disallows the page.
- **Offline-first:** IndexedDB stores subscriptions, posts, read/star state, and sanitized article text/HTML. The service worker caches the application shell. Cached articles remain available without a network connection; an online startup or `online` event refreshes subscribed feeds.
- **No ranking in the timeline:** Recommendations appear on a separate Discover page with a visible reason for each suggestion. A curated seed catalogue means Discover is not empty on demo day.
- **Opt-in anonymous discovery:** Sharing is unchecked by default. A user must tick consent and press the share button. The client sends one batch of normalized feed URLs, using a short-lived HMAC-signed, single-use token. The database stores only aggregate feed counts and pairwise co-subscription counts—not batches, accounts, reader IDs, post content, or a browsing history.
- **Abuse/SSRF controls:** HTTP(S)-only URLs, URL normalization, public-DNS/IP validation, DNS-pinned proxy requests, redirect revalidation, body/time limits, a small in-memory proxy throttle, batch caps, salted-hash rate limiting with expiry, and single-use tokens.
- **Extras:** OPML import/export, ETag/Last-Modified conditional fetching, simplified `robots.txt` respect for original article extraction, offline status, and a deliberate duplicate URL alias in the seed list to demonstrate normalization.

## Architecture overview

```mermaid
flowchart TD
  UI[Browser UI: timeline / subscriptions / reader / Discover]
  IDB[(Browser IndexedDB: feeds, posts, read state, articles)]
  SW[Service worker: app shell cache]
  Parse[Browser: RSS / Atom parser]
  Extract[Browser: article extraction + allowlist sanitizer]
  Fetch[/GET /api/fetch?url=.../]
  Token[/POST /api/discovery/token/]
  Submit[/POST /api/discovery/submit/]
  Recs[/POST /api/discovery/recommendations/]
  Popular[/GET /api/discovery/popular/]
  Proxy[Raw HTTP(S) proxy: validate, fetch, return bytes; no content storage]
  DB[(Supabase Postgres: catalog + aggregate counts + expiring hashes/tokens)]
  UI <--> IDB
  SW -. caches shell .-> UI
  UI --> Fetch --> Proxy
  Proxy -- raw bytes / validators --> UI
  UI --> Parse
  UI --> Extract
  Parse --> IDB
  Extract --> IDB
  UI --> Token --> DB
  UI --> Submit --> DB
  UI --> Recs --> DB
  UI --> Popular --> DB
```

### Request responsibilities

| Path | Method | Purpose |
|---|---|---|
| `/api/fetch?url=...` | GET | Fetch a public HTTP(S) URL and return the upstream bytes/content type and validators. It does not parse or store the body. |
| `/api/discovery/token` | POST | Issues a signed, 90-second, single-use token; applies a hashed-IP rate limit. |
| `/api/discovery/submit` | POST | Validates and normalizes a batch of up to 100 public feed URLs; consumes the token once; updates aggregate counts only. |
| `/api/discovery/recommendations` | POST | Returns feeds not already followed, ranked by aggregate popularity and co-subscription overlap. |
| `/api/discovery/popular?limit=12` | GET | Returns pre-seeded/popular feeds. |

The fetch endpoint does not accept a URL to a private/local IP, checks DNS results before connecting, pins the connection to a validated IP, revalidates every redirect, and imposes a 5 MB body cap and a timeout. HTML responses are marked as downloads on direct navigation so untrusted proxied HTML is not executed under the app's origin. The browser still reads those bytes with `fetch()` and parses them as a string.

## Setup instructions

### Local run (reader works without database credentials)

Requirements: Node.js 20 or newer.

```bash
npm run check
npm test
npm run build
npm run dev
```

Open `http://localhost:3000`. The local sample dispatch is stored in IndexedDB on first run, so the app has something to read immediately. Add a public site/feed URL in the left sidebar to test live subscriptions. The static seed list remains available in Discover if Supabase is not configured; anonymous sharing/recommendations from the database require the next setup step.

No frontend npm packages or third-party runtime scripts are required. Feed parsing, extraction, sanitization, and IndexedDB caching run in the browser.

### Supabase database for anonymous discovery

1. Create a Supabase project.
2. In Supabase SQL Editor, run the complete contents of [`sql/schema.sql`](sql/schema.sql). This creates server-only tables, RPC functions, seed feed catalogue entries, a seeded popularity baseline, and demo overlap edges.
3. Copy `.env.example` to `.env` for local testing. Set:

   ```env
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
   DISCOVERY_TOKEN_SECRET=at-least-32-random-secret-characters
   IP_HASH_SALT=a-different-long-random-secret
   ```

   Use the **service role key only on the server**; never place it in `index.html`, `app.js`, or any public environment variable. For a real deployment, create strong independent secrets rather than copying the example values.

4. Restart with `npm run dev`. The Discover page now calls the database API and the opt-in share control is enabled.

The seed set has 15 entries and 14 canonical feed URLs. The deliberate trap is the pair `https://www.smashingmagazine.com/feed/` and `https://smashingmagazine.com/feed`: URL normalization removes `www`, tracking parameters, fragments, and trailing slashes, so this is stored as one feed instead of two. The pre-filled counts are clearly labelled demo baseline scores; they are not claims about real readers.

### Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `SUPABASE_URL` | Database-backed Discover/share | The project URL, without a trailing slash. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server database access | Secret server-side key only. |
| `DISCOVERY_TOKEN_SECRET` | Signed one-time token | At least 32 characters; generate randomly. |
| `IP_HASH_SALT` | Hashed-IP rate limits | Long, unique secret; separate from the token secret. |
| `PORT` | Local server only | Defaults to `3000`. |

## Deployment on Vercel

This repository includes `vercel.json` and a build script. The frontend is static; the files in `api/` are Vercel Node functions.

1. Put this project in a Git repository and push it to a GitHub repository you control.
2. Import that repository in Vercel. Leave the build command as `npm run build` and output directory as `dist` (already declared in `vercel.json`).
3. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DISCOVERY_TOKEN_SECRET`, and `IP_HASH_SALT` in the Vercel project’s **server environment variables** for Preview and Production.
4. Deploy. Run `sql/schema.sql` in Supabase before testing opt-in sharing.
5. Test `/api/fetch` with a public feed URL, verify a local/private URL returns HTTP 400, follow a live feed, and submit an opt-in batch only after checking the consent box.

The files are deployment-ready, but this workspace has no access to the user’s Vercel/Supabase/GitHub accounts, so an external production deployment or public remote repository has not been created from here. Do not commit `.env` or expose the Supabase service-role key.

## Demo instructions (2–3 minutes)

A voice-over and click-by-click recording plan is available in [`docs/demo-script.md`](docs/demo-script.md). Suggested demo sequence:

1. Open the app and explain that the timeline is chronological and the sample feed is local.
2. Add a real site or feed URL (try `https://xkcd.com/atom.xml` or `https://hnrss.org/frontpage`). Show autodiscovery and posts appearing in the timeline.
3. Open a post, show extracted full text and the cached status. In browser DevTools, switch Network to Offline and reopen the same post to show the saved copy; a first-time uncached article correctly falls back to its feed summary offline.
4. Open Discover. Explain the sample baseline, the overlap reason and the exclusion of feeds already followed.
5. Tick the opt-in box and click Share only if Supabase environment variables are configured; show OPML export/import if the live discovery database is unavailable.

## Edge cases to test

- **No feed at site URL:** the client checks alternate feed links and common paths, then shows an actionable error without clearing the timeline.
- **Dead/slow feed:** requests time out or return an error; old cached posts remain in place and the subscription shows an error marker.
- **Malformed XML:** parser errors are caught per feed; other feeds still render.
- **Duplicate URL:** `www`, trailing slash, fragments, and common tracking parameters normalize to one canonical URL.
- **Extraction failure:** the reading view shows the feed's own summary, with a reason.
- **`robots.txt` disallow:** the client does not request the original article and uses the feed summary.
- **Offline:** app shell, timeline, read/star state, and articles already fetched remain local; no new article can be extracted offline.
- **Untrusted article HTML:** only allowlisted tags/attributes survive; scripts, event handlers, frames, forms, SVG, dangerous URL schemes, and inline styles are dropped. Remote images are loaded through the protected raw-proxy route to avoid exposing the reader's IP to an image host.
- **Private/local URLs:** the server rejects localhost/private/reserved address ranges and revalidates redirect destinations.

## Privacy and threat model

### We defend against

- Cross-site scripting from hostile feed summaries or proxied HTML (strict allowlist sanitizer before every article render).
- Server-side request forgery to loopback, private, link-local, reserved, and metadata IP ranges; DNS rebinding is mitigated by validating DNS answers and pinning the connection IP for each request.
- Stolen/replayed discovery submissions (HMAC-signed, 90-second token stored by nonce hash and atomically consumed once).
- Basic burst abuse (max 100 URLs per batch, one-hour hashed-IP limits for discovery, a best-effort per-warm-instance raw proxy throttle, URL validation, response caps and timeouts).
- Accidental disclosure of a real IP in persistent analytics or subscription logs (there is no analytics and raw IPs are not persisted).

### What the server stores

- Canonical feed URLs and optional curated title/description/category metadata in `feed_catalog`.
- Aggregate submission counts per feed and co-subscription counts for feed pairs. There is no submitted-batch log, user account, stable reader ID, article content or browsing history.
- A hash of the one-time token nonce until expiry, then cleanup removes expired tokens.
- A salted SHA-256 hash of a connecting IP for rate limiting. The SQL row expires after 24 hours; expired rows are cleaned during token issuance. The raw IP is not stored in Postgres.

### What opt-in means

The checkbox defaults to off. Without ticking it and pressing Share, no subscription list is sent to the discovery API. Sharing sends one URL array with no title, article history, read state, star state, account, or persistent client ID. Feed lists themselves can reveal interests, so users should only share if comfortable with that list being reflected in aggregate counts and co-subscription relationships.

### Accepted limitations / residual risks

- Aggregate counts represent opt-in **submission batches**, not deduplicated real humans. Without persistent identity, the server cannot prove that separate batches came from separate people; the app does not make that claim.
- Salted IP hashes are pseudonymous during the short rate-limit window; they are not mathematically anonymous. They are used only for abuse prevention and expire quickly.
- A public feed server sees a fetch from the app server rather than directly from the reader. The proxy itself is public, so SSRF checks, size/time limits and throttling are important but not a guarantee against all abuse. The per-instance proxy throttle is best-effort on serverless deployments.
- The article extractor is a lightweight browser-side Readability-style heuristic, not Mozilla's full Readability library. Complex sites may fall back to feed summaries.
- `robots.txt` matching is intentionally conservative/simple and is not a full robots protocol implementation. It checks the wildcard/reader agent disallow paths before extracting a page.
- Popularity seed numbers and overlap edges are clearly marked demo baselines until real opt-in batches alter the aggregates.

## Automated checks

```bash
npm run check
npm test
```

The tests cover URL normalization (including the deliberate duplicate trap), HTTP(S)-only validation, and common private/reserved IPv4/IPv6 ranges.
