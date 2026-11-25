# Hanzi

Hanzi is an installable, offline-first Mandarin flashcard app. It is a small static Progressive Web App (PWA), built with browser JavaScript, HTML, and CSS. A PWA is the best fit here: one codebase works on iOS and Android, it installs from the browser, needs no app-store account, and can keep vocabulary and review progress on the phone without a network connection.

## Run it

Serve this folder from a local web server while developing. For example, from this folder run `python -m http.server 8000` and open `http://localhost:8000`. The first visit caches the app shell and HSK 1 vocabulary. After that, the installed app can be opened offline. Service workers require HTTPS on a hosted site; publish this folder to an HTTPS static host such as GitHub Pages to install it on a phone. Open the hosted URL in Safari or Chrome and choose **Add to Home Screen** / **Install app**.

## Vocabulary files

Put `hsk1.json` through `hsk6.json` in the `Vocabulary/` folder. The app already lists these levels and caches each file for offline use. Each file should contain a JSON array of entries with `no`, `chinese`, `pinyin`, `english`, and `category`. A level with a missing or invalid file will show a message while other levels remain usable.

If you add a differently named level later, add its `id`, display `name`, and `./Vocabulary/...` file path to `LEVELS` in `app.js`, add its file to `APP_FILES` in `sw.js`, and increment the service worker `CACHE_NAME`.

## Transfer progress between phones

On the **Progress** page, tap **Download progress** to save a JSON backup. On the other phone, open the same app, go to **Progress → Import progress**, and select that file. Import replaces progress stored by that browser, after confirmation. It restores card schedules, notes, daily queues, settings, and review statistics; the vocabulary itself still comes from the app's `Vocabulary/` files.

Progress is stored locally in the browser and is not synced automatically. Keep a downloaded backup somewhere accessible to both phones. Clearing browser site data removes local progress, so export backups periodically.

## Review schedule

Cards begin at a 2.3 multiplier and a zero-day interval. Passes grow their interval with overdue credit, gentle multiplier recovery, a five-year maximum, and a small load-balanced window for longer intervals. Show Again tracks misses persistently, spaces repeats in the queue, applies lapse intervals, and flags recurring difficult words for attention. The daily queue prioritizes due reviews, then missed cards, then up to ten new words. New words pause automatically when more than 40 reviews are due; **Learn 10 more new words** is always available as a manual override.
