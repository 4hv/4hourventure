'use strict';

// ────────────────────────────────────────────
//  UTILS
// ────────────────────────────────────────────
const $ = id => document.getElementById(id);
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = a => a[rnd(0, a.length - 1)];
const shuf = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = rnd(0, i); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ────────────────────────────────────────────
//  STORAGE
// ────────────────────────────────────────────
const Ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v != null ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

// ────────────────────────────────────────────
//  CONFIG
// ────────────────────────────────────────────
const Cfg = {
  grade: Ls.get('sm_g', 5),
  sessLen: Ls.get('sm_sl', 10),
  sound: Ls.get('sm_snd', false),
  explain: Ls.get('sm_exp', true),
  xp: Ls.get('sm_xp', 0),
  level: Ls.get('sm_lv', 1),
  save() {
    Ls.set('sm_g', this.grade); Ls.set('sm_sl', this.sessLen);
    Ls.set('sm_snd', this.sound); Ls.set('sm_exp', this.explain);
    Ls.set('sm_xp', this.xp); Ls.set('sm_lv', this.level);
  }
};

// ────────────────────────────────────────────
//  HIGHSCORES
// ────────────────────────────────────────────
const HS = {
  all() { return Ls.get('sm_hs', []); },
  save(list) { Ls.set('sm_hs', list); },
  add(name, score, grade) {
    const list = this.all();
    list.push({ name: name || 'Anonym', score, grade, date: new Date().toLocaleDateString('de') });
    list.sort((a, b) => b.score - a.score);
    this.save(list.slice(0, 200));
  },
  isRecord(score, grade) {
    const top = this.all().filter(e => e.grade === grade);
    return !top.length || score > top[0].score;
  },
  top(grade, n = 50) {
    const list = this.all();
    return (grade === 'all' ? list : list.filter(e => e.grade === grade)).slice(0, n);
  }
};

// ────────────────────────────────────────────
//  QUESTION DATABASE  (uses global QUESTIONS from questions.js)
// ────────────────────────────────────────────
const QDB = (() => {
  // Cache by grade for fast random picks
  const byGrade = {};
  for (let g = 1; g <= 10; g++) {
    byGrade[g] = QUESTIONS.filter(q => q.grade === g);
  }

  // Track which questions were used this session so we don't repeat
  let usedNrs = {};

  function resetUsed(grade) {
    usedNrs[grade] = new Set();
  }

  function pickQuestion(grade) {
    const pool = byGrade[grade];
    if (!usedNrs[grade]) usedNrs[grade] = new Set();
    // Reset if all used
    if (usedNrs[grade].size >= pool.length) usedNrs[grade] = new Set();
    let q;
    let attempts = 0;
    do {
      q = pick(pool);
      attempts++;
    } while (usedNrs[grade].has(q.nr) && attempts < 50);
    usedNrs[grade].add(q.nr);
    return q;
  }

  // Parse an answer string to a float (handles German comma decimals)
  function parseNum(str) {
    const clean = String(str).trim().replace(',', '.');
    const n = parseFloat(clean);
    return isFinite(n) ? n : null;
  }

  // Extract numeric part and optional unit from answer like "105 cm²" or "-30,85"
  function parseNumericAnswer(ans) {
    const m = String(ans).trim().match(/^(-?[\d]+(?:[,.][\d]+)?)\s*(cm²|cm|m²|m|kg|g|°|%)?$/);
    if (!m) return null;
    return { num: parseFloat(m[1].replace(',', '.')), unit: m[2] || '', raw: m[1] };
  }

  // Format a number back to German style (comma decimal) matching original precision
  function fmtNum(n, referenceStr) {
    // Check if reference uses comma decimal
    const usesComma = String(referenceStr).includes(',');
    // Count decimal places in reference
    const decPart = String(referenceStr).replace(',', '.').split('.')[1];
    const decimals = decPart ? decPart.length : 0;
    let result = n.toFixed(decimals);
    if (usesComma) result = result.replace('.', ',');
    return result;
  }

  // Generate numeric distractors close to the correct number
  function numericDistractors(parsed, referenceStr, n = 3) {
    const { num, unit } = parsed;
    const seen = new Set([num]);
    const results = [];
    const spread = Math.max(1, Math.abs(num) * 0.3 + 2);
    let tries = 0;
    while (results.length < n && tries++ < 200) {
      let d;
      const type = rnd(0, 4);
      if (type === 0) d = num + rnd(1, Math.ceil(spread));
      else if (type === 1) d = num - rnd(1, Math.ceil(spread));
      else if (type === 2) d = num + rnd(-Math.ceil(spread * 2), Math.ceil(spread * 2));
      else if (type === 3) d = Math.round(num * (1 + (Math.random() - 0.5) * 0.4) * 10) / 10;
      else d = num + (Math.random() > 0.5 ? 1 : -1) * rnd(Math.ceil(spread * 0.5), Math.ceil(spread * 2));

      if (!isFinite(d) || seen.has(d)) continue;
      // For non-negative contexts keep positive
      if (num >= 0 && d < 0) continue;
      seen.add(d);
      results.push(fmtNum(d, referenceStr) + (unit ? ' ' + unit : ''));
    }
    return results;
  }

  // Pick wrong answers from same grade's answer pool
  function gradeDistractors(correctAns, grade, n = 3) {
    const pool = byGrade[grade];
    const candidates = shuf(pool.map(q => q.answer)).filter(a => a !== correctAns);
    return candidates.slice(0, n);
  }

  // Build 3 wrong-answer distractors for a question
  function makeDistractors(answer, grade) {
    const parsed = parseNumericAnswer(answer);
    if (parsed) {
      const dists = numericDistractors(parsed, answer, 3);
      if (dists.length >= 3) return dists;
    }
    // Fall back to picking from same-grade answers
    return gradeDistractors(answer, grade, 3);
  }

  // Build a task object from a raw question
  function buildTask(rawQ) {
    const distractors = makeDistractors(rawQ.answer, rawQ.grade);
    const cards = shuf([
      { val: rawQ.answer, ok: true },
      ...distractors.map(v => ({ val: v, ok: false }))
    ]);
    return {
      q: rawQ.question,
      ans: rawQ.answer,
      cards,
      exp: `Richtige Antwort: ${rawQ.answer}`
    };
  }

  return {
    gen(grade) {
      const raw = pickQuestion(grade);
      return buildTask(raw);
    },
    resetSession(grade) {
      resetUsed(grade);
    }
  };
})();

// ────────────────────────────────────────────
//  GAME STATE
// ────────────────────────────────────────────
const GS = {
  qIdx: 0, total: 10, task: null, cards: [],
  streak: 0, maxStreak: 0, score: 0, totalErr: 0, qErr: 0,
  correctCount: 0, totalSwipes: 0, startTime: 0,
  log: [],
  PTS: 100, PEN: 25,

  init(grade, sessLen) {
    this.qIdx = 0; this.total = sessLen;
    this.streak = 0; this.maxStreak = 0; this.score = 0;
    this.totalErr = 0; this.qErr = 0;
    this.correctCount = 0; this.totalSwipes = 0;
    this.startTime = Date.now(); this.log = [];
    QDB.resetSession(grade);
    this._loadQ(grade);
  },

  _loadQ(grade) {
    this.task = QDB.gen(grade);
    this.cards = [...this.task.cards];
    this.qErr = 0;
  },

  // Returns { ok, found }
  // found=true means the correct card was swiped right → answer found, advance question
  swipe(card, right) {
    const found = card.ok && right;
    const ok = found || (!card.ok && !right);
    this.totalSwipes++;
    if (ok) {
      if (found) {
        this.correctCount++;
        this.streak++;
        if (this.streak > this.maxStreak) this.maxStreak = this.streak;
      }
      return { ok: true, found };
    } else {
      this.streak = 0; this.qErr++; this.totalErr++;
      this.score = Math.max(0, this.score - this.PEN);
      Cfg.xp = Math.max(0, Cfg.xp - 5);
      return { ok: false, found: false };
    }
  },

  finQuestion(grade) {
    const pts = Math.max(0, this.PTS - this.qErr * this.PEN);
    this.score += pts;
    Cfg.xp += Math.max(5, Math.floor(pts / 8));
    this._lvl();
    this.log.push({ q: this.task.q, ans: this.task.ans, pts, err: this.qErr });
    this.qIdx++;
    if (this.qIdx < this.total) this._loadQ(grade);
  },

  _lvl() {
    const t = [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 6500, 9000];
    for (let i = t.length - 1; i >= 1; i--) { if (Cfg.xp >= t[i]) { Cfg.level = i + 1; return; } }
    Cfg.level = 1;
  },

  get acc() { return this.totalSwipes > 0 ? Math.round(this.correctCount / this.totalSwipes * 100) : 100; }
};

// ────────────────────────────────────────────
//  SOUND
// ────────────────────────────────────────────
const Snd = {
  ctx: null,
  _c() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); return this.ctx; },
  _p(f, d, t = 'sine', g = .28) {
    if (!Cfg.sound) return;
    try {
      const c = this._c(), o = c.createOscillator(), gn = c.createGain();
      o.connect(gn); gn.connect(c.destination);
      o.frequency.value = f; o.type = t;
      gn.gain.setValueAtTime(g, c.currentTime);
      gn.gain.exponentialRampToValueAtTime(.001, c.currentTime + d);
      o.start(); o.stop(c.currentTime + d);
    } catch {}
  },
  ok() { this._p(523, .07); setTimeout(() => this._p(659, .07), 70); setTimeout(() => this._p(784, .1), 140); },
  no() { this._p(180, .25, 'sawtooth', .18); },
  yay() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._p(f, .09), i * 70)); }
};

// ────────────────────────────────────────────
//  CONFETTI
// ────────────────────────────────────────────
const Conf = (() => {
  const cv = $('confetti-canvas'), ctx = cv.getContext('2d');
  let ps = [], aid = null;
  const cols = ['#00E87A', '#FF3B6A', '#7C5CFC', '#5CE4FF', '#FFD700', '#FF6B00'];
  const resize = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; };
  window.addEventListener('resize', resize); resize();
  function burst(x, y, n = 45) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
      ps.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3.5, c: cols[rnd(0, cols.length - 1)], s: 4 + Math.random() * 5, l: 1, d: .014 + Math.random() * .02, r: Math.random() * 360, rv: (Math.random() - .5) * 9 });
    }
    if (!aid) anim();
  }
  function anim() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ps = ps.filter(p => p.l > 0);
    ps.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += .15; p.vx *= .98; p.l -= p.d; p.r += p.rv;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r * Math.PI / 180);
      ctx.globalAlpha = p.l; ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s / 2); ctx.restore();
    });
    if (ps.length) aid = requestAnimationFrame(anim); else aid = null;
  }
  return { burst };
})();

// ────────────────────────────────────────────
//  XP POP FLOATER
// ────────────────────────────────────────────
function pop(x, y, val, good) {
  const el = document.createElement('div'); el.className = 'xp-pop';
  el.textContent = good ? `+${val} Pkt.` : `−${Math.abs(val)} Pkt.`;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.color = good ? 'var(--xp)' : 'var(--wrong)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

// ────────────────────────────────────────────
//  UI HELPERS
// ────────────────────────────────────────────
let _activeScreen = 'landing';
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  _activeScreen = name;
}

function updateTopBar() {
  $('streak-badge').textContent = `🔥 ${GS.streak}`;
  $('level-badge').textContent = `⭐ Lv.${Cfg.level}`;
  $('score-badge').textContent = `★ ${GS.score}`;
}

function updateProgress() {
  const idx = GS.qIdx + 1, tot = GS.total;
  $('prog-fill').style.width = `${(idx / tot) * 100}%`;
  $('prog-text').textContent = `Frage ${idx} / ${tot}`;
  $('err-text').textContent = `${GS.totalErr} Fehler`;
}

function updatePenalty() {
  $('q-penalty').textContent = GS.qErr > 0 ? `−${GS.qErr * GS.PEN} Pkt. Abzug` : '';
}

function renderQuestion(task) {
  $('q-txt').textContent = task.q;
  $('q-penalty').textContent = '';
  $('q-area').classList.remove('q-done', 'flash-ok', 'flash-no');
  $('q-lbl').textContent = 'Was ist die richtige Antwort?';
}

function flashQ(ok) {
  const a = $('q-area');
  a.classList.remove('flash-ok', 'flash-no');
  void a.offsetWidth;
  a.classList.add(ok ? 'flash-ok' : 'flash-no');
  setTimeout(() => a.classList.remove('flash-ok', 'flash-no'), 450);
}

// Show big green "done" celebration on the card stack, then call cb
function showQuestionDone(correctAns, cb) {
  const overlay = $('done-overlay');
  const qArea = $('q-area');

  // Highlight q-area green
  qArea.classList.add('q-done');
  $('q-lbl').textContent = '✓ Richtig!';

  // Show answer in overlay
  $('done-ans-val').textContent = correctAns;
  overlay.classList.add('show');

  setTimeout(() => {
    overlay.classList.remove('show');
    qArea.classList.remove('q-done');
    $('q-lbl').textContent = 'Was ist die richtige Antwort?';
    cb();
  }, 650);
}

function showExplain(text) {
  document.querySelectorAll('.expl-box').forEach(e => e.remove());
  if (!Cfg.explain) return;
  const el = document.createElement('div'); el.className = 'expl-box';
  el.textContent = '💡 ' + text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function updateCardsRem() {
  const n = GS.cards.length;
  $('cards-rem').textContent = n === 1 ? '1 Karte übrig' : `${n} Karten`;
}

// ────────────────────────────────────────────
//  END SCREEN
// ────────────────────────────────────────────
function showEndScreen() {
  const acc = GS.acc;
  const secs = Math.round((Date.now() - GS.startTime) / 1000);
  $('end-score').textContent = GS.score;
  $('end-score-break').textContent = `${GS.total} Fragen · ${GS.totalErr} Fehler · ${secs}s`;
  $('end-acc').textContent = acc + '%';
  $('end-streak').textContent = GS.maxStreak;
  $('end-time').textContent = secs + 's';
  $('end-mistakes').textContent = GS.totalErr;

  if (acc >= 90) { $('end-icon').textContent = '🏆'; $('end-title').textContent = 'PERFEKT!'; $('end-sub').textContent = 'Ausgezeichnet – du bist ein Mathe-Profi!'; }
  else if (acc >= 70) { $('end-icon').textContent = '🎉'; $('end-title').textContent = 'SEHR GUT!'; $('end-sub').textContent = 'Klasse Leistung! Weiter so.'; }
  else { $('end-icon').textContent = '💪'; $('end-title').textContent = 'WEITER ÜBEN!'; $('end-sub').textContent = 'Noch etwas üben – du schaffst das!'; }

  const log = $('q-log');
  log.innerHTML = '<div class="q-log-title">🗒 Fragen-Übersicht</div>';
  GS.log.forEach((entry, i) => {
    const clean = entry.err === 0;
    const row = document.createElement('div'); row.className = 'q-log-row';
    row.innerHTML = `
      <div class="q-num ${clean ? 'ok' : 'bad'}">${i + 1}</div>
      <div class="q-qtext">${entry.q}</div>
      <div class="q-pts ${clean ? 'ok' : 'bad'}">${clean ? '+' : ''}${entry.pts}</div>
      <div class="q-errs">${entry.err > 0 ? entry.err + '×✗' : '✓'}</div>`;
    log.appendChild(row);
  });

  if (HS.isRecord(GS.score, Cfg.grade)) {
    $('new-rec').style.display = 'flex';
    $('new-rec-g').textContent = Cfg.grade;
  } else {
    $('new-rec').style.display = 'none';
  }

  Cfg.save();
  showScreen('end');
  if (acc >= 70) Conf.burst(window.innerWidth / 2, window.innerHeight / 3, 60);
  if (HS.isRecord(GS.score, Cfg.grade)) {
    setTimeout(() => showNameModal(GS.score, () => renderHSPreview()), 700);
  }
}

// ────────────────────────────────────────────
//  NAME MODAL
// ────────────────────────────────────────────
let _modalCb = null;
function showNameModal(score, cb) {
  _modalCb = cb;
  $('modal-score-val').textContent = score + ' Punkte';
  const input = $('name-input');
  input.value = Ls.get('sm_lastName', '');
  $('name-modal').classList.add('show');
  setTimeout(() => input.focus(), 200);
}
function closeModal(save) {
  $('name-modal').classList.remove('show');
  if (save) {
    const name = $('name-input').value.trim() || 'Anonym';
    Ls.set('sm_lastName', name);
    HS.add(name, GS.score, Cfg.grade);
  }
  if (_modalCb) _modalCb(); _modalCb = null;
}
$('modal-save').addEventListener('click', () => closeModal(true));
$('modal-skip').addEventListener('click', () => closeModal(false));
$('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') closeModal(true); });

// ────────────────────────────────────────────
//  HIGHSCORE TABLE
// ────────────────────────────────────────────
let _hsFilter = 'all';
function buildHSFilters() {
  const c = $('hs-filter'); c.innerHTML = '';
  const allB = document.createElement('button'); allB.className = 'hf-btn sel'; allB.dataset.g = 'all'; allB.textContent = 'Alle';
  allB.addEventListener('click', () => renderHSTable('all')); c.appendChild(allB);
  for (let g = 1; g <= 10; g++) {
    const b = document.createElement('button'); b.className = 'hf-btn'; b.dataset.g = String(g); b.textContent = `Kl.${g}`;
    b.addEventListener('click', () => renderHSTable(g)); c.appendChild(b);
  }
}
function renderHSTable(grade) {
  _hsFilter = grade;
  document.querySelectorAll('.hf-btn').forEach(b => b.classList.toggle('sel', b.dataset.g === String(grade)));
  const entries = HS.top(grade);
  const tbl = $('hs-table');
  tbl.innerHTML = `<div class="hs-thead"><div>#</div><div>Name</div><div style="text-align:right;padding-right:7px">Punkte</div><div style="text-align:right">Kl.</div></div>`;
  if (!entries.length) { tbl.innerHTML += `<div class="hs-no-entry">Noch keine Einträge${grade !== 'all' ? ' für Klasse ' + grade : ''}.<br>Spiel eine Runde!</div>`; return; }
  entries.forEach((e, i) => {
    const rc = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const ri = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
    const row = document.createElement('div'); row.className = 'hs-row';
    row.innerHTML = `<div class="hs-r ${rc}">${ri}</div><div class="hs-n">${e.name}</div><div class="hs-s">${e.score}</div><div class="hs-g">Kl.${e.grade}</div>`;
    tbl.appendChild(row);
  });
}
function renderHSPreview() {
  const c = $('hs-preview');
  const grade = Cfg.grade;
  $('hs-grade-lbl').textContent = `Klasse ${grade}`;
  const top = HS.top(grade, 3);
  if (!top.length) { c.innerHTML = `<div class="hs-empty-sm">Noch keine Einträge für Klasse ${grade}</div>`; return; }
  c.innerHTML = '<div class="hs-pv-head"><span>TOP 3</span><button onclick="renderHSTable(\'all\');showScreen(\'hs\')">Alle →</button></div>';
  const icons = ['🥇', '🥈', '🥉'];
  top.forEach((e, i) => {
    const row = document.createElement('div'); row.className = 'hs-pv-row';
    row.innerHTML = `<div class="pv-rank">${icons[i] || i + 1}</div><div class="pv-name">${e.name}</div><div class="pv-score">${e.score}</div><div class="pv-grade">Kl.${e.grade}</div>`;
    c.appendChild(row);
  });
}

// ────────────────────────────────────────────
//  SWIPE CONTROLLER
// ────────────────────────────────────────────
const Swipe = (() => {
  let sx = 0, sy = 0, cx = 0, cy2 = 0;
  let dragging = false, activeEl = null, activeData = null;
  let animating = false;

  function render() {
    const stack = $('card-stack');
    // Remove existing cards (keep done-overlay)
    stack.querySelectorAll('.answer-card').forEach(e => e.remove());
    updateCardsRem();
    if (!GS.cards.length) return;

    [...GS.cards].reverse().forEach((data, ri) => {
      const i = GS.cards.length - 1 - ri;
      const isTop = i === GS.cards.length - 1;
      const el = document.createElement('div');
      el.className = 'answer-card';
      el.style.transform = `translateY(${ri * -6}px) scale(${1 - ri * 0.04})`;
      el.style.zIndex = i;
      el.innerHTML = `
        <div class="swipe-ind r">✓ RICHTIG</div>
        <div class="swipe-ind l">✗ FALSCH</div>
        <div class="card-ans">${data.val}</div>
        <div class="card-sub">← Falsch &nbsp;·&nbsp; Richtig →</div>`;

      if (isTop) {
        activeEl = el; activeData = data;
        attachDrag(el, data);
      }
      stack.appendChild(el);
    });
  }

  function snapBack(el) {
    el.style.transition = 'transform .35s cubic-bezier(.175,.885,.32,1.275)';
    el.style.transform = 'translateX(0) rotate(0deg)';
    el.querySelector('.swipe-ind.r').style.opacity = 0;
    el.querySelector('.swipe-ind.l').style.opacity = 0;
    setTimeout(() => {
      el.style.transition = '';
      animating = false; btnState();
    }, 360);
  }

  function attachDrag(el, data) {
    const onStart = (clientX, clientY) => {
      if (animating) return;
      dragging = true; sx = clientX; sy = clientY; cx = 0; cy2 = 0;
      el.style.transition = 'none';
    };
    const onMove = (clientX, clientY) => {
      if (!dragging) return;
      cx = clientX - sx; cy2 = clientY - sy;
      const rot = cx * 0.08;
      const indR = el.querySelector('.swipe-ind.r');
      const indL = el.querySelector('.swipe-ind.l');
      el.style.transform = `translate(${cx}px,${cy2 * 0.3}px) rotate(${rot}deg)`;
      indR.style.opacity = Math.max(0, Math.min(1, cx / 80));
      indL.style.opacity = Math.max(0, Math.min(1, -cx / 80));
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      if (Math.abs(cx) > 80) {
        doSwipe(el, data, cx > 0);
      } else {
        snapBack(el);
      }
    };
    el.addEventListener('mousedown', e => { onStart(e.clientX, e.clientY); e.preventDefault(); });
    el.addEventListener('touchstart', e => { onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    document.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    document.addEventListener('touchend', onEnd);
  }

  function doSwipe(el, data, toRight) {
    if (animating) return;
    animating = true; btnState();
    const res = GS.swipe(data, toRight);
    const rect = el.getBoundingClientRect();
    const pcx = rect.left + rect.width / 2, pcy = rect.top + rect.height / 2;

    if (res.ok) {
      // Fly card off screen
      const fx = toRight ? window.innerWidth + 130 : -(window.innerWidth + 130);
      el.style.transition = 'transform .4s cubic-bezier(.4,0,1,1),opacity .35s ease';
      el.style.transform = `translateX(${fx}px) rotate(${toRight ? 28 : -28}deg)`;
      el.style.opacity = '0';

      if (res.found) {
        // ── CORRECT ANSWER FOUND ──
        el.style.boxShadow = '0 0 40px rgba(0,232,122,.8)';
        Snd.ok();
        try { navigator.vibrate && navigator.vibrate([22, 8, 22]); } catch {}
        const xpG = 10 + Math.floor(GS.streak / 5) * 5;
        pop(pcx, pcy - 26, xpG, true);
        if (GS.streak > 0 && GS.streak % 5 === 0) { Conf.burst(pcx, pcy, 50); Snd.yay(); }

        setTimeout(() => {
          el.remove();
          // Show done overlay + green q-area, then advance
          showQuestionDone(GS.task.ans, () => {
            GS.finQuestion(Cfg.grade);
            updateTopBar();
            if (GS.qIdx >= GS.total) {
              animating = false;
              showEndScreen();
            } else {
              renderQuestion(GS.task);
              updateProgress();
              updatePenalty();
              render();
              animating = false;
            }
            btnState();
          });
        }, 380);

      } else {
        // ── DISMISSED A WRONG CARD (swiped left) ──
        setTimeout(() => {
          el.remove();
          GS.cards = GS.cards.filter(c => c !== data);
          render();
          animating = false; btnState();
        }, 380);
      }

    } else {
      // ── WRONG SWIPE ──
      snapBack(el);
      Snd.no();
      try { navigator.vibrate && navigator.vibrate(80); } catch {}
      flashQ(false);
      pop(pcx, pcy - 26, GS.PEN, false);
      updatePenalty();
      if (GS.task) showExplain(GS.task.exp);
      updateTopBar();
      updateProgress();
    }
  }

  function btnState() {
    const ok = GS.cards && GS.cards.length > 0 && !animating;
    $('btn-wrong').disabled = !ok;
    $('btn-correct').disabled = !ok;
  }

  function setupBtns() {
    $('btn-wrong').addEventListener('click', () => {
      if (!animating && activeEl && activeData) doSwipe(activeEl, activeData, false);
    });
    $('btn-correct').addEventListener('click', () => {
      if (!animating && activeEl && activeData) doSwipe(activeEl, activeData, true);
    });
  }

  return { render, setupBtns };
})();

// ────────────────────────────────────────────
//  LANDING SETUP
// ────────────────────────────────────────────
function setupLanding() {
  const grid = $('grade-grid');
  for (let g = 1; g <= 10; g++) {
    const btn = document.createElement('button');
    btn.className = 'grade-btn' + (g === Cfg.grade ? ' sel' : '');
    btn.innerHTML = `<span>${g}</span><span class="gk">Kl.</span>`;
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.grade-btn').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel'); Cfg.grade = g; Cfg.save(); renderHSPreview();
    });
    grid.appendChild(btn);
  }
  document.querySelectorAll('.sess-btn').forEach(b => {
    if (parseInt(b.dataset.v) === Cfg.sessLen) b.classList.add('sel');
    b.addEventListener('click', () => {
      document.querySelectorAll('.sess-btn').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); Cfg.sessLen = parseInt(b.dataset.v); Cfg.save();
    });
  });
  function tog(id, key) {
    const b = $(id); if (Cfg[key]) b.classList.add('on');
    b.addEventListener('click', () => { Cfg[key] = !Cfg[key]; b.classList.toggle('on', Cfg[key]); Cfg.save(); });
  }
  tog('tog-sound', 'sound'); tog('tog-explain', 'explain');
  $('start-btn').addEventListener('click', startGame);
}

function startGame() {
  GS.init(Cfg.grade, Cfg.sessLen);
  $('grade-pill').textContent = `Klasse ${Cfg.grade}`;
  renderQuestion(GS.task);
  updateTopBar(); updateProgress(); updatePenalty();
  Swipe.render();
  showScreen('game');
}

// ────────────────────────────────────────────
//  BUTTON WIRING
// ────────────────────────────────────────────
$('back-btn').addEventListener('click', () => $('dlg').classList.add('show'));
$('dlg-cancel').addEventListener('click', () => $('dlg').classList.remove('show'));
$('dlg-confirm').addEventListener('click', () => { $('dlg').classList.remove('show'); Cfg.save(); showScreen('landing'); renderHSPreview(); });

$('play-again-btn').addEventListener('click', () => {
  if (HS.isRecord(GS.score, Cfg.grade)) { showNameModal(GS.score, () => { renderHSPreview(); startGame(); }); }
  else startGame();
});
$('home-btn').addEventListener('click', () => {
  if (HS.isRecord(GS.score, Cfg.grade)) { showNameModal(GS.score, () => { renderHSPreview(); showScreen('landing'); }); }
  else { renderHSPreview(); showScreen('landing'); }
});
$('hs-from-end-btn').addEventListener('click', () => {
  if (HS.isRecord(GS.score, Cfg.grade)) { showNameModal(GS.score, () => { renderHSTable(_hsFilter); showScreen('hs'); }); }
  else { renderHSTable(_hsFilter); showScreen('hs'); }
});
$('hs-close').addEventListener('click', () => showScreen('landing'));

// ────────────────────────────────────────────
//  INIT
// ────────────────────────────────────────────
setupLanding();
buildHSFilters();
renderHSPreview();
Swipe.setupBtns();
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
