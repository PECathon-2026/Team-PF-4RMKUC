# 2–3 minute demo recording plan

**Length:** about 2 minutes 30 seconds. Record the deployed app in Chrome. Use a screen recorder; keep the dragon artwork and ambience visible but lower the system volume while narrating.

## 0:00–0:20 — Intro

Show the Mystic Mikado home screen. Say: “This is an offline-first RSS and Atom reader. Unlike algorithmic feeds, the timeline is chronological; subscriptions, reading state and cached articles live on this device.” Point to the local sample dispatch and the Timeline/Discover navigation.

## 0:20–0:55 — Add a feed

In the left sidebar, enter `https://xkcd.com/atom.xml` (or `https://hnrss.org/frontpage`) and press `＋`. Explain that the browser first tries the entered URL, then checks `rel=alternate` links and common feed paths. Show the posts in chronological order, click a feed filter, and star a post.

## 0:55–1:30 — Full text + offline

Open a post that has a link to an original article. Point to the extraction status (“Full article extracted in your browser and saved offline”). Explain that the server fetch route returns raw bytes only; extraction and sanitization happen in the browser. Open Chrome DevTools → Network → enable **Offline**, close and reopen the same article, and show the saved copy. Note that a never-cached article falls back to its feed summary offline.

## 1:30–2:00 — Discover

Switch to Discover. Show popular feeds, the co-subscription overlap count, and the “why suggested” explanation. Explain that seed scores are demo baselines until opt-in batches arrive, and the list excludes feeds already followed.

## 2:00–2:25 — Privacy + portability

Point to the unchecked “I choose to share…” checkbox. Say: “No account or persistent reader ID exists. Sharing sends one batch only after this explicit consent and button press; the server stores aggregate counts, not a batch history.” Briefly show Export OPML and mention import is also supported. If the Supabase keys are configured, tick the opt-in checkbox and perform one share; otherwise do not imply a live aggregate submission succeeded.

## Recording checklist

- Use a live public deployment with Supabase configured if demonstrating anonymous submission.
- Start online, follow a working feed, and open its article before switching to Offline.
- Do not show `.env`, API secrets, browser profile data, or personal subscription URLs.
- If the chosen feed is temporarily down, use the fallback/sample dispatch and explain the per-feed error handling instead of presenting the failure as a successful live fetch.
