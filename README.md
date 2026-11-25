# Hanzi

Hanzi is an installable, offline-first Mandarin flashcard app. It is a small static Progressive Web App (PWA), built with browser JavaScript, HTML, and CSS. A PWA is the best fit here: one codebase works on iOS and Android, it installs from the browser, needs no app-store account, and can keep vocabulary and review progress on the phone without a network connection.

## Run it

Serve this folder from a local web server while developing. For example, from this folder run `python -m http.server 8000` and open `http://localhost:8000`. The first visit caches the app shell and HSK 1 vocabulary. After that, the installed app can be opened offline. Service workers require HTTPS on a hosted site; publish this folder to an HTTPS static host such as GitHub Pages to install it on a phone. Open the hosted URL in Safari or Chrome and choose **Add to Home Screen** / **Install app**.

## Add another HSK level

1. Add the next vocabulary file beside `hsk1.json`, using the same fields: `no`, `chinese`, `pinyin`, `english`, and `category`.
2. Add its entry to the `LEVELS` array near the top of `app.js`, for example `{ id: 'hsk2', name: 'HSK 2', file: './hsk2.json' }`.
3. Add the new JSON filename to `APP_FILES` in `sw.js` and increment `CACHE_NAME` so installed devices download the new offline copy.

Review progress is stored locally in the browser. It is not synced between devices. Clearing the browser's site data removes that local progress.

## Review schedule

Cards begin at a 2.3 multiplier and a zero-day interval. Passes grow their interval with overdue credit, gentle multiplier recovery, a five-year maximum, and a small load-balanced window for longer intervals. Show Again tracks misses persistently, spaces repeats in the queue, applies lapse intervals, and flags recurring difficult words for attention. The daily queue prioritizes due reviews, then missed cards, then up to ten new words. New words pause automatically when more than 40 reviews are due; **Learn 10 more new words** is always available as a manual override.
