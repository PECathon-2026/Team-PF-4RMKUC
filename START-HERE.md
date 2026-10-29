# Open Mystic Mikado as a website

## Quick visual preview

Open `OPEN-WEBSITE-PREVIEW.html` in Chrome. It is a single-file preview with the embedded dragon background, sound, animation, sample articles, reading view, and seeded Discover catalogue. Because a local HTML file has no server, adding live RSS feeds and database-backed anonymous sharing require the full server version.

## Full website with the server routes

**Windows:** install Node.js 20+, extract the ZIP, then double-click `START-WEBSITE-WINDOWS.bat`. It builds the app and starts it at `http://localhost:3000`.

**macOS/Linux:** install Node.js 20+, open a terminal in the project folder, and run:

```bash
chmod +x start-website-mac-linux.sh
./start-website-mac-linux.sh
```

Then visit `http://localhost:3000`.

The sample reader and curated Discover catalogue work without a database. For live anonymous sharing and recommendations, configure the Supabase environment variables in `.env` and run `sql/schema.sql` in the Supabase SQL editor. See `README.md` for deployment setup.

## Public hosting

The project is configured for Vercel deployment. Public hosting still requires importing this project into a GitHub repository and connecting it to a Vercel account; those account actions are not performed by this ZIP alone.
