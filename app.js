(() => {
  'use strict';

  const LEVELS = [
    { id: 'hsk1', name: 'HSK 1', file: './Vocabulary/hsk1.json' },
    { id: 'hsk2', name: 'HSK 2', file: './Vocabulary/hsk2.json' },
    { id: 'hsk3', name: 'HSK 3', file: './Vocabulary/hsk3.json' },
    { id: 'hsk4', name: 'HSK 4', file: './Vocabulary/hsk4.json' },
    { id: 'hsk5', name: 'HSK 5', file: './Vocabulary/hsk5.json' },
    { id: 'hsk6', name: 'HSK 6', file: './Vocabulary/hsk6.json' },
  ];
  const STORAGE_KEY = 'hanzi-study-v1';
  const DAY_MS = 86_400_000;
  const MAX_INTERVAL = 1_825;
  const DAILY_NEW_LIMIT = 10;
  const MAX_AUTO_BACKLOG = 40;
  const notes = [
    'Small, steady practice makes room for long-term memory.',
    'A few words remembered well are a lovely place to begin.',
    'Let your curiosity lead. The rhythm will follow.',
    'Every return to a word makes it a little more familiar.',
    'A calm minute of practice can carry a word a long way.',
    'There is no rush. You are building something that lasts.',
    'Today’s small effort is a gift to your future self.',
  ];

  let state = loadState();
  let wordsByLevel = new Map();
  let levelErrors = new Map();
  let activePage = 'study';
  let selectedCategory = 'All';
  let searchValue = '';
  let filterValue = 'all';
  let answerShown = false;
  let toastTimer;

  const $ = (id) => document.getElementById(id);
  const today = () => localDateKey(new Date());
  const selectedLevel = () => state.settings.selectedLevel || LEVELS[0].id;
  const sessionKey = (date, levelId) => `${date}:${levelId}`;
  const activeSession = () => state.sessions[sessionKey(today(), selectedLevel())];
  const allCards = () => Object.values(state.cards);
  const wordsForLevel = (levelId = selectedLevel()) => wordsByLevel.get(levelId) || [];
  const cardForWord = (levelId, wordId) => state.cards[`${levelId}:${wordId}`];

  function localDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function dayNumber(dateString) {
    if (!dateString) return 0;
    const [y, m, d] = dateString.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
  }

  function daysBetween(from, to) {
    if (!from || !to) return 0;
    return Math.max(0, dayNumber(to) - dayNumber(from));
  }

  function defaultState() {
    return {
      cards: {},
      sessions: {},
      settings: { selectedLevel: LEVELS[0].id, extraNew: {}, repeatOrder: 0 },
      stats: { byDate: {}, totalPasses: 0, totalAgain: 0, firstStudyDate: '', lastStudyDate: '' },
    };
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return defaultState();
      const parsed = JSON.parse(saved);
      const base = defaultState();
      return {
        ...base,
        ...parsed,
        cards: parsed.cards || {},
        sessions: parsed.sessions || {},
        settings: { ...base.settings, ...(parsed.settings || {}) },
        stats: { ...base.stats, ...(parsed.stats || {}) },
      };
    } catch (error) {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { showToast('Could not save progress on this device.'); }
  }

  function exportProgress() {
    const backup = {
      format: 'hanzi-progress',
      version: 1,
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hanzi-progress-${today()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Progress backup downloaded.');
  }

  async function importProgress(file) {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup.format !== 'hanzi-progress' || backup.version !== 1 || !backup.state || typeof backup.state.cards !== 'object') {
        throw new Error('This is not a Hanzi progress backup.');
      }
      if (!window.confirm('Import this backup and replace progress currently saved in this browser? Export your current progress first if you want to keep a copy.')) return;
      const incoming = backup.state;
      const knownCards = Object.fromEntries(Object.entries(state.cards).map(([id, card]) => [id, {
        ...card,
        interval: 0, multiplier: 2.3, due_date: '', last_reviewed: '',
        misses_in_cycle: 0, miss_cycle_counted: false, last_attempted: '', repeat_order: 0,
        leech_score: 0, paused: false, first_seen: '', note: '',
      }]));
      for (const [id, card] of Object.entries(incoming.cards)) {
        if (knownCards[id] && card && typeof card === 'object') knownCards[id] = { ...knownCards[id], ...card, id };
      }
      const validIds = new Set(Object.keys(knownCards));
      const sessions = {};
      for (const [key, session] of Object.entries(incoming.sessions || {})) {
        if (!session || !Array.isArray(session.queue)) continue;
        sessions[key] = { ...session, queue: session.queue.filter((id) => validIds.has(id)) };
      }
      state.cards = knownCards;
      state.sessions = sessions;
      state.settings = { ...defaultState().settings, ...(incoming.settings || {}) };
      if (!LEVELS.some((level) => level.id === state.settings.selectedLevel)) state.settings.selectedLevel = LEVELS[0].id;
      state.stats = { ...defaultState().stats, ...(incoming.stats || {}) };
      saveState();
      showToast('Progress imported.');
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      window.alert(error.message || 'Could not read that progress file.');
    }
  }

  async function loadVocabulary() {
    for (const level of LEVELS) {
      try {
        const response = await fetch(level.file);
        if (!response.ok) throw new Error(`Could not load ${level.name}`);
        const sourceWords = await response.json();
        if (!Array.isArray(sourceWords)) throw new Error(`${level.name} must contain a JSON array`);
        wordsByLevel.set(level.id, sourceWords);
        levelErrors.delete(level.id);
        for (const word of sourceWords) {
          const key = `${level.id}:${word.no}`;
          if (!state.cards[key]) {
            state.cards[key] = {
              id: key, levelId: level.id, wordId: word.no,
              interval: 0, multiplier: 2.3, due_date: '', last_reviewed: '',
              misses_in_cycle: 0, miss_cycle_counted: false, last_attempted: '', repeat_order: 0,
              leech_score: 0, paused: false, first_seen: '', note: '',
            };
          }
        }
      } catch (error) {
        console.error(error);
        wordsByLevel.set(level.id, []);
        levelErrors.set(level.id, error);
      }
    }
    saveState();
  }

  function ensureSession() {
    const key = sessionKey(today(), selectedLevel());
    if (state.sessions[key]) return state.sessions[key];
    const cards = wordsForLevel().map((word) => cardForWord(selectedLevel(), word.no)).filter(Boolean);
    const due = cards.filter((card) => !card.paused && card.interval > 0 && card.due_date && card.due_date <= today() && !(card.last_attempted === today() && card.misses_in_cycle > 0));
    due.sort((a, b) => {
      const aLate = daysBetween(a.due_date, today()) / Math.max(1, a.interval);
      const bLate = daysBetween(b.due_date, today()) / Math.max(1, b.interval);
      return aLate - bLate || a.due_date.localeCompare(b.due_date) || a.interval - b.interval;
    });
    const again = cards.filter((card) => !card.paused && card.misses_in_cycle > 0 && card.last_attempted === today());
    again.sort((a, b) => a.repeat_order - b.repeat_order);
    const dailyAutoAllowed = due.length <= MAX_AUTO_BACKLOG;
    const newLimit = DAILY_NEW_LIMIT + (state.settings.extraNew[today()] || 0);
    const seenToday = allCards().filter((card) => card.first_seen === today()).length;
    const remainingNew = Math.max(0, newLimit - seenToday);
    const newWords = cards.filter((card) => !card.paused && card.interval === 0 && card.first_seen !== today());
    const queuedNew = dailyAutoAllowed ? newWords.slice(0, remainingNew) : [];
    state.sessions[key] = { date: today(), levelId: selectedLevel(), queue: [...due, ...again, ...queuedNew].map((card) => card.id) };
    saveState();
    return state.sessions[key];
  }

  function currentCard() {
    const session = ensureSession();
    while (session.queue.length) {
      const card = state.cards[session.queue[0]];
      if (card && !card.paused) return card;
      session.queue.shift();
    }
    return null;
  }

  function currentWord(card) {
    return card && wordsForLevel(card.levelId).find((word) => word.no === card.wordId);
  }

  function countDue(levelId = selectedLevel()) {
    return wordsForLevel(levelId).reduce((count, word) => {
      const card = cardForWord(levelId, word.no);
      return count + (card && !card.paused && card.interval > 0 && card.due_date && card.due_date <= today() && !(card.last_attempted === today() && card.misses_in_cycle > 0) ? 1 : 0);
    }, 0);
  }

  function viewedTodayCount() {
    return allCards().filter((card) => card.first_seen === today()).length;
  }

  function quotaRemaining() {
    return Math.max(0, DAILY_NEW_LIMIT + (state.settings.extraNew[today()] || 0) - viewedTodayCount());
  }

  function newWordCandidates(levelId = selectedLevel()) {
    return wordsForLevel(levelId).map((word) => cardForWord(levelId, word.no)).filter((card) => card && !card.paused && card.interval === 0 && card.first_seen !== today());
  }

  function renderAll() {
    renderLevelPicker();
    renderStudy();
    renderWords();
    renderProgress();
    updateNavigation();
  }

  function renderLevelPicker() {
    const select = $('level-select');
    const current = selectedLevel();
    select.innerHTML = LEVELS.map((level) => `<option value="${escapeHtml(level.id)}">${escapeHtml(level.name)}</option>`).join('');
    select.value = current;
    document.querySelectorAll('.level-name').forEach((node) => { node.textContent = LEVELS.find((level) => level.id === current)?.name || current.toUpperCase(); });
  }

  function renderStudy() {
    const session = ensureSession();
    const card = currentCard();
    const word = currentWord(card);
    const queueSize = session.queue.length;
    const practicedToday = state.stats.byDate[today()]?.newPassed || 0;
    const newGoal = DAILY_NEW_LIMIT + (state.settings.extraNew[today()] || 0);
    const due = countDue();
    $('study-subtitle').textContent = levelErrors.has(selectedLevel())
      ? `${LEVELS.find((level) => level.id === selectedLevel())?.name || 'This level'} vocabulary is missing or invalid. Add a JSON array in the Vocabulary folder.`
      : 'Build a steady rhythm, one recall at a time.';
    $('due-count').textContent = `${due} ${due === 1 ? 'due' : 'due'}`;
    $('card-counter').textContent = queueSize ? `${queueSize} ${queueSize === 1 ? 'WORD' : 'WORDS'} IN TODAY’S QUEUE` : 'TODAY’S QUEUE';
    $('today-passed').textContent = String(practicedToday);
    $('today-goal').textContent = `of ${newGoal}`;
    $('today-progress-bar').style.width = `${Math.min(100, newGoal ? practicedToday / newGoal * 100 : 0)}%`;
    $('remaining-words').textContent = `${queueSize} ${queueSize === 1 ? 'word' : 'words'} left in today’s queue`;
    const todayStats = state.stats.byDate[today()] || { passed: 0, again: 0 };
    const attempts = todayStats.passed + todayStats.again;
    $('accuracy-today').textContent = attempts ? `${Math.round(todayStats.passed / attempts * 100)}% remembered` : 'Ready when you are';
    $('streak-count').textContent = String(calculateStreak());
    $('daily-note').textContent = notes[(dayNumber(today()) + 7) % notes.length];

    if (!card || !word) {
      $('card-content').hidden = true;
      $('empty-state').hidden = false;
      $('card-actions').hidden = true;
      $('empty-title').textContent = due === 0 && quotaRemaining() === 0 ? 'You’re all caught up.' : 'Nothing in the queue just yet.';
      $('empty-copy').textContent = due > MAX_AUTO_BACKLOG && quotaRemaining() > 0
        ? `You have ${due} reviews waiting. New words are paused until the backlog is smaller.`
        : 'Your next words will be ready when it’s time. Let today’s Mandarin settle in.';
    } else {
      $('card-content').hidden = false;
      $('empty-state').hidden = true;
      $('card-actions').hidden = false;
      $('card-category').textContent = `${LEVELS.find((level) => level.id === card.levelId)?.name || 'HSK'} · ${word.category || 'WORD'}`;
      $('card-hanzi').textContent = word.chinese;
      $('card-pinyin').textContent = word.pinyin || '';
      $('card-meaning').textContent = word.english || 'Grammar particle';
      $('card-note').textContent = card.note || '';
      $('card-note').hidden = !card.note;
      $('card-hint').hidden = answerShown;
      $('answer-block').hidden = !answerShown;
      $('reveal-button').hidden = answerShown;
      $('answer-actions').hidden = !answerShown;
      $('review-hint').textContent = card.misses_in_cycle > 0 ? 'Take your time. This word is on your team.' : 'A good guess counts. Trust your memory.';
    }

    const attentionCards = allCards().filter((item) => item.levelId === selectedLevel() && item.leech_score >= 3 && !item.paused);
    $('attention-card').hidden = attentionCards.length === 0;
    $('attention-count').textContent = String(attentionCards.length);
    $('learn-more-button').hidden = newWordCandidates().length === 0;
    $('empty-learn-button').hidden = newWordCandidates().length === 0;
  }

  function renderWords() {
    const words = wordsForLevel();
    $('word-total').textContent = String(words.length);
    const categories = ['All', ...new Set(words.map((word) => word.category).filter(Boolean))];
    if (!categories.includes(selectedCategory)) selectedCategory = 'All';
    $('category-strip').innerHTML = categories.map((category) => `<button class="category-chip ${category === selectedCategory ? 'active' : ''}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
    const query = searchValue.trim().toLowerCase();
    const results = words.filter((word) => {
      const card = cardForWord(selectedLevel(), word.no);
      const matchesCategory = selectedCategory === 'All' || word.category === selectedCategory;
      const matchesQuery = !query || [word.chinese, word.pinyin, word.english, word.category].some((value) => String(value || '').toLowerCase().includes(query));
      const matchesFilter = filterValue === 'all' ||
        (filterValue === 'new' && card.interval === 0 && !card.paused) ||
        (filterValue === 'learning' && card.interval > 0 && !card.paused && card.leech_score < 3) ||
        (filterValue === 'attention' && card.leech_score >= 3 && !card.paused) ||
        (filterValue === 'paused' && card.paused);
      return matchesCategory && matchesQuery && matchesFilter;
    });
    $('word-list').innerHTML = results.length ? results.map((word) => {
      const card = cardForWord(selectedLevel(), word.no);
      const status = card.paused ? ['Paused', ''] : card.leech_score >= 3 ? ['Attention', 'attention'] : card.interval > 0 ? ['Learning', 'learning'] : ['New', ''];
      const action = card.paused ? `<button class="word-action" type="button" data-resume-card="${escapeHtml(card.id)}">Resume</button>` : '';
      return `<article class="word-row"><div class="word-hanzi" lang="zh-Hans">${escapeHtml(word.chinese)}</div><div class="word-info"><div class="word-pinyin" lang="zh-Latn-pinyin">${escapeHtml(word.pinyin || '')}</div><div class="word-meaning">${escapeHtml(word.english || 'Grammar particle')}</div><div class="word-category">${escapeHtml(word.category || 'Word')}</div></div><span class="word-status ${status[1]}"><span class="status-mini-dot"></span>${status[0]}</span>${action}</article>`;
    }).join('') : '<div class="no-results">No words found. Try another search or category.</div>';
    $('list-end').textContent = results.length === words.length ? `Showing all ${words.length} words` : `${results.length} of ${words.length} words`;
  }

  function renderProgress() {
    const levelCards = wordsForLevel().map((word) => cardForWord(selectedLevel(), word.no)).filter(Boolean);
    const introduced = levelCards.filter((card) => card.interval > 0 || card.first_seen).length;
    const longest = Math.max(0, ...levelCards.map((card) => card.interval));
    $('stat-learned').textContent = String(introduced);
    $('stat-learned-detail').textContent = `of ${levelCards.length} ${LEVELS.find((level) => level.id === selectedLevel())?.name || ''} words`;
    $('stat-longest').textContent = String(longest);
    $('stat-longest-detail').textContent = longest >= 365 ? 'A word remembered for the long run' : longest ? 'The rhythm is growing' : 'Your first word is waiting';
    $('stat-streak').textContent = String(calculateStreak());
    $('stat-streak-detail').textContent = calculateStreak() ? 'Keep your gentle rhythm going' : 'A fresh start is always here';
    $('stat-reviews').textContent = String(state.stats.totalPasses || 0);
    $('stat-again-detail').textContent = `${state.stats.totalAgain || 0} shown again`;

    const dates = Array.from({ length: 7 }, (_, index) => {
      const d = new Date(); d.setDate(d.getDate() + index);
      return localDateKey(d);
    });
    const counts = dates.map((date, index) => levelCards.reduce((sum, card) => sum + (!card.paused && (index === 0 ? card.due_date && card.due_date <= date : card.due_date === date) ? 1 : 0), 0));
    const maxCount = Math.max(1, ...counts);
    $('horizon-total').textContent = `${counts.reduce((a, b) => a + b, 0)} scheduled`;
    $('schedule-bars').innerHTML = dates.map((date, index) => {
      const d = new Date(`${date}T12:00:00`);
      const label = index === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' });
      const height = counts[index] ? Math.max(9, counts[index] / maxCount * 80) : 3;
      return `<div class="schedule-day ${index === 0 ? 'today' : ''}"><div class="bar-track"><div class="bar-fill" style="height:${height}px" title="${counts[index]} words"></div></div><span>${label}</span></div>`;
    }).join('');
    const attention = levelCards.filter((card) => card.leech_score >= 3 && !card.paused);
    $('attention-list-panel').hidden = attention.length === 0;
    $('attention-total').textContent = `${attention.length} ${attention.length === 1 ? 'word' : 'words'}`;
    $('attention-list').innerHTML = attention.map((card) => {
      const word = currentWord(card) || wordsForLevel(card.levelId).find((item) => item.no === card.wordId);
      if (!word) return '';
      return `<div class="attention-word"><div class="word-hanzi">${escapeHtml(word.chinese)}</div><div class="word-info"><strong>${escapeHtml(word.pinyin)}</strong><div>${escapeHtml(word.english || 'Grammar particle')} · ${card.leech_score} tough recalls</div></div><button type="button" data-note-card="${escapeHtml(card.id)}">Add a hint</button><button type="button" data-pause-card="${escapeHtml(card.id)}">Pause</button></div>`;
    }).join('');
  }

  function calculateStreak() {
    const studied = (date) => {
      const stats = state.stats.byDate[date];
      return !!stats && stats.passed > 0;
    };
    let cursor = new Date();
    let key = localDateKey(cursor);
    if (!studied(key)) { cursor.setDate(cursor.getDate() - 1); key = localDateKey(cursor); }
    let streak = 0;
    while (studied(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      key = localDateKey(cursor);
    }
    return streak;
  }

  function updateNavigation() {
    document.querySelectorAll('.nav-link').forEach((link) => {
      const selected = link.dataset.page === activePage;
      link.classList.toggle('selected', selected);
      if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    const due = countDue();
    $('nav-due-badge').hidden = !due;
  }

  function navigate(page) {
    if (!['study', 'words', 'progress'].includes(page)) page = 'study';
    activePage = page;
    document.querySelectorAll('.page').forEach((element) => {
      const selected = element.id === `${page}-page`;
      element.classList.toggle('active', selected);
      element.hidden = !selected;
    });
    history.replaceState(null, '', `#${page}`);
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function revealAnswer() {
    const card = currentCard();
    const word = currentWord(card);
    if (!card || !word) return;
    answerShown = true;
    saveState();
    renderStudy();
    $('pass-button').focus({ preventScroll: true });
  }

  function nextIntervalWithFuzz(raw, card, todayKey) {
    const bounded = Math.min(MAX_INTERVAL, Math.max(1, Math.round(raw)));
    if (bounded < 10) return bounded;
    const fuzz = Math.round(bounded * 0.05);
    const candidates = [];
    const loads = new Map();
    for (const other of allCards()) {
      if (other.id === card.id || other.paused || !other.due_date) continue;
      loads.set(other.due_date, (loads.get(other.due_date) || 0) + 1);
    }
    const low = Math.max(1, bounded - fuzz);
    const high = Math.min(MAX_INTERVAL, bounded + fuzz);
    for (let interval = low; interval <= high; interval += 1) {
      const due = addDays(todayKey, interval);
      candidates.push({ interval, due, load: loads.get(due) || 0 });
    }
    candidates.sort((a, b) => a.load - b.load || a.interval - b.interval);
    return candidates[0]?.interval ?? bounded;
  }

  function addDays(dateKey, count) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d, 12);
    date.setDate(date.getDate() + count);
    return localDateKey(date);
  }

  function advanceCurrent() {
    const session = ensureSession();
    session.queue.shift();
    answerShown = false;
  }

  function recordPass() {
    const session = ensureSession();
    const card = currentCard();
    if (!card || !answerShown) return;
    const date = today();
    const interval = card.interval;
    const misses = card.misses_in_cycle;
    const isNewCard = interval === 0;
    if (!card.first_seen) card.first_seen = date;
    if (interval === 0 && misses === 0) {
      card.interval = 1;
      card.multiplier = 2.3;
      card.due_date = addDays(date, 1);
      card.last_reviewed = date;
    } else if (misses > 0) {
      if (interval >= 1) card.multiplier = Math.max(1.5, Math.round((card.multiplier - 0.25) * 100) / 100);
      let next;
      if (misses >= 2 || interval <= 7) next = 1;
      else next = Math.max(3, Math.min(30, Math.round(interval * 0.25)));
      card.interval = nextIntervalWithFuzz(next, card, date);
      card.last_reviewed = date;
      card.due_date = addDays(date, card.interval);
    } else {
      let multiplier = card.multiplier;
      if (interval >= 3) multiplier = Math.min(2.6, Math.round((multiplier + 0.05) * 100) / 100);
      if (interval >= 7) card.leech_score = Math.max(0, card.leech_score - 1);
      let rawNext;
      const elapsed = daysBetween(card.last_reviewed, date);
      const overdue = Math.max(0, elapsed - interval);
      if (interval === 1 && overdue === 0 && multiplier >= 2.0) rawNext = 3;
      else {
        const base = interval + Math.min(overdue * 0.5, interval);
        rawNext = Math.round(base * multiplier);
      }
      card.interval = nextIntervalWithFuzz(Math.min(MAX_INTERVAL, rawNext), card, date);
      card.last_reviewed = date;
      card.due_date = addDays(date, card.interval);
    }
    card.misses_in_cycle = 0;
    card.miss_cycle_counted = false;
    card.last_attempted = date;
    advanceCurrent();
    const stats = state.stats.byDate[date] ||= { passed: 0, again: 0, newPassed: 0 };
    stats.passed += 1;
    if (isNewCard) stats.newPassed = (stats.newPassed || 0) + 1;
    state.stats.totalPasses += 1;
    state.stats.lastStudyDate = date;
    if (!state.stats.firstStudyDate) state.stats.firstStudyDate = date;
    if (session.queue.length === 0) state.stats.lastCompletedDate = date;
    saveState();
    renderAll();
    if (!session.queue.length) showToast('Lovely work. Let those words settle in.');
  }

  function recordAgain() {
    const session = ensureSession();
    const card = currentCard();
    if (!card || !answerShown) return;
    const date = today();
    if (!card.first_seen) card.first_seen = date;
    card.misses_in_cycle += 1;
    card.last_attempted = date;
    if (card.interval > 0 && !card.miss_cycle_counted) {
      card.leech_score += 1;
      card.miss_cycle_counted = true;
    }
    advanceCurrent();
    const othersRemaining = session.queue.length;
    const shouldStopLoop = card.misses_in_cycle >= 3 || (card.misses_in_cycle >= 2 && othersRemaining <= 1);
    if (shouldStopLoop) {
      applyForcedLapse(card, date);
      showToast('We’ll revisit that word tomorrow.');
    } else {
      state.settings.repeatOrder += 1;
      card.repeat_order = state.settings.repeatOrder;
      const insertAt = session.queue.length >= 4 ? 4 : session.queue.length;
      session.queue.splice(insertAt, 0, card.id);
    }
    const stats = state.stats.byDate[date] ||= { passed: 0, again: 0, newPassed: 0 };
    stats.again += 1;
    state.stats.totalAgain += 1;
    saveState();
    renderAll();
  }

  function applyForcedLapse(card, date) {
    if (card.interval > 0) {
      card.multiplier = Math.max(1.5, Math.round((card.multiplier - 0.25) * 100) / 100);
      if (!card.miss_cycle_counted) card.leech_score += 1;
    }
    card.misses_in_cycle = 0;
    card.miss_cycle_counted = false;
    card.interval = 1;
    card.due_date = addDays(date, 1);
    card.last_reviewed = date;
    card.last_attempted = date;
  }

  function addTenNewWords() {
    const session = ensureSession();
    const candidates = newWordCandidates();
    const alreadyQueued = new Set(session.queue);
    const chosen = candidates.filter((card) => !alreadyQueued.has(card.id)).slice(0, 10);
    if (!chosen.length) { showToast('You’ve opened all the new words available today.'); return; }
    state.settings.extraNew[today()] = (state.settings.extraNew[today()] || 0) + chosen.length;
    session.queue.push(...chosen.map((card) => card.id));
    saveState();
    answerShown = false;
    renderAll();
    showToast(`${chosen.length} new ${chosen.length === 1 ? 'word' : 'words'} added to today’s queue.`);
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2300);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function bindEvents() {
    document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(link.dataset.page);
    }));
    $('level-select').addEventListener('change', (event) => {
      state.settings.selectedLevel = event.target.value;
      answerShown = false;
      selectedCategory = 'All';
      saveState();
      renderAll();
    });
    $('reveal-button').addEventListener('click', revealAnswer);
    $('pass-button').addEventListener('click', recordPass);
    $('again-button').addEventListener('click', recordAgain);
    $('learn-more-button').addEventListener('click', addTenNewWords);
    $('export-progress-button').addEventListener('click', exportProgress);
    $('import-progress-button').addEventListener('click', () => $('import-progress-file').click());
    $('import-progress-file').addEventListener('change', (event) => {
      importProgress(event.target.files?.[0]);
      event.target.value = '';
    });
    $('empty-learn-button').addEventListener('click', addTenNewWords);
    $('attention-button').addEventListener('click', () => { filterValue = 'attention'; navigate('words'); $('word-filter').value = filterValue; renderWords(); });
    $('word-search').addEventListener('input', (event) => { searchValue = event.target.value; renderWords(); });
    $('word-filter').addEventListener('change', (event) => { filterValue = event.target.value; renderWords(); });
    $('category-strip').addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      selectedCategory = button.dataset.category;
      renderWords();
    });
    $('attention-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-note-card]');
      const pauseButton = event.target.closest('[data-pause-card]');
      if (button) {
        const card = state.cards[button.dataset.noteCard];
        const word = wordsForLevel(card.levelId).find((item) => item.no === card.wordId);
        const note = window.prompt(`Add a memory hint for ${word.chinese} (${word.pinyin})`, card.note || '');
        if (note === null) return;
        card.note = note.trim();
        saveState();
        showToast(card.note ? 'Memory hint saved on this device.' : 'Memory hint cleared.');
      } else if (pauseButton) {
        const card = state.cards[pauseButton.dataset.pauseCard];
        card.paused = true;
        for (const session of Object.values(state.sessions)) session.queue = session.queue.filter((id) => id !== card.id);
        saveState();
        renderAll();
        showToast('Word paused. You can resume it from your word list.');
      }
    });
    $('word-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-resume-card]');
      if (!button) return;
      const card = state.cards[button.dataset.resumeCard];
      card.paused = false;
      const session = ensureSession();
      if (!session.queue.includes(card.id)) session.queue.push(card.id);
      saveState();
      renderAll();
      showToast('Word back in your study rotation.');
    });
    $('main-content').addEventListener('click', (event) => {
      if (event.target.closest('.word-row')) return;
    });
    document.addEventListener('keydown', (event) => {
      if (activePage !== 'study' || event.altKey || event.ctrlKey || event.metaKey || event.target.matches('input,select,textarea')) return;
      const card = currentCard();
      if (!card) return;
      if (!answerShown && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); revealAnswer(); }
      else if (answerShown && event.key === '1') recordAgain();
      else if (answerShown && event.key === '2') recordPass();
    });
    window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
  }

  async function init() {
    bindEvents();
    await loadVocabulary();
    ensureSession();
    const requestedPage = location.hash.slice(1);
    if (['study', 'words', 'progress'].includes(requestedPage)) activePage = requestedPage;
    navigate(activePage);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Offline cache registration failed', error));
    }
  }

  init();
})();
