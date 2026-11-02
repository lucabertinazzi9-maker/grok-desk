# grok-desk

Static iPhone web app for the desk. Code only: no data, keys or links to data live in this repo.

## How it reads data

- Open the app once with `#d=<data id>` (and `#t=<app token>` if given). Both go to this device's storage.
  On iPhone, add to Home Screen from that same tab: the home-screen app has its own storage and starts from
  the URL that was on screen; it drops the fragment from the URL the first time it runs.
- Files: `state.json`, `activity.json`, `chart.json`, `agents.json`, `account.json`, `coins.json`, `coin_<mint>.json`.
- Raw files every 15 s, the gist API every 75 s; the newest `ts` wins. Nothing from the data is cached offline.
- Settings, pause/resume and mode are read-only here and change from Telegram.

## Local preview

`python -m http.server` from a folder holding this app as `app/` and mock files as `mock/`, then
`http://127.0.0.1:8000/app/index.html?src=/mock/&screen=home` (also `agents`, `activity`, `account`,
`coin&mint=…`, `auditor&mint=…`). `src` and `screen` only work on localhost.
