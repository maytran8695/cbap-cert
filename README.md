# cbap-cert

CBAP Mock Exam Trainer — static web app (no build step) for practicing
3 CBAP mock exam sets (360 questions total, BABOK v3 KA3–KA8).

## Run locally

Browsers block `fetch()` of local JSON when opening `index.html` directly
(`file://`), so serve it over HTTP:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to Cloudflare Pages

Static site, no build command needed:

- **Build command:** (leave empty)
- **Build output directory:** `/`

## Project structure

- `index.html`, `style.css`, `app.js` — the app
- `data/set1.json`, `set2.json`, `set3.json` — parsed question banks
  (Standard / Advanced Set 2 / Expert), one object per file:
  `{ examId, title, questions: [{ id, ka, kaName, question, options, correct, explanation }] }`

Progress (bookmarks and missed questions) is stored in the browser's
`localStorage` — nothing is sent to a server.
