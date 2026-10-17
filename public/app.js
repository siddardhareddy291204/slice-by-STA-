import { FORMATS, replay, pointDisplay, pointSituation, validateResult, formatScore, scoreFromState } from '/shared/scoring.js';
import { MIN_MATCHES } from '/shared/standings.js';

// ---------- Tiny templating: h`` escapes values, nested h`` stays raw ----------
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const part = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));
const h = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $modal = document.body.appendChild(document.createElement('div'));

const S = {
  me: null,
  view: null, // day view (organizer or public)
  players: [],
  plan: null, // suggested / manual matches being edited
  mode: 'auto',
  draft: null, // new-day form
  modal: null,
  editingPlayer: null,
  route: null,
};

// ---------- Helpers ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Slice': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && method !== 'GET') {
    CACHE.delete('home');
    CACHE.delete('players');
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    if (res.status === 401 && !['/api/login', '/api/password'].includes(path)) {
      S.me = { organizer: false, setupNeeded: false };
      store('slice.me', JSON.stringify(S.me));
      CACHE.clear();
      go('#/login');
    }
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  $toast.textContent = msg;
  $toast.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.className = bad ? 'bad' : ''), bad ? 4000 : 2000);
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function paint(content) {
  $app.innerHTML = part(content);
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const fmtDate = (date, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, opts);
const fmtTime = (at) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const name = (id) => S.view?.people?.[id] ?? '—';
const first = (id) => name(id).split(' ')[0];
const team = (ids) => ids.map(name).join(' & ');
const pct = (r) => (r.played ? `${Math.round(r.winPct * 100)}%` : '–');
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const avg = (r) => (r.played ? signed(Math.round(r.avgDiff * 10) / 10) : '–');
const photo = (spec) => {
  const [file, ...rest] = spec.split(';');
  return [`--img:url(/img/${file})`, ...rest].join(';');
};

const svg = (d, extra = '') => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`);
const I = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  share: svg('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18.5 14.8c1.6.8 2.7 2.6 3 5.2"/>'),
  out: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>'),
  home: svg('<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7"/>'),
  court: svg('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 12h16M8 3v18M16 3v18M8 7.5h8M8 16.5h8"/>'),
  log: svg('<path d="M12 8v4l2.5 2.5"/><circle cx="12" cy="12" r="8.5"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  arrow: svg('<path d="M7 17L17 7M9 7h8v8"/>', 'stroke-width="2.4"'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" fill="currentColor" stroke="none"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="2.4"'),
  fix: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  scorer: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/><path d="M14 20h6"/>'),
  pin: svg('<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
};

// Original mark: a lime ball with a dark seam.
const ballMark = raw('<svg class="ball" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#D4F04C"/><path d="M4.2 4.6c3.6 3.2 3.6 11.6 0 14.8M19.8 4.6c-3.6 3.2-3.6 11.6 0 14.8" fill="none" stroke="#18231A" stroke-opacity=".55" stroke-width="1.6"/></svg>');
const wordmark = (dark = false) => h`<span class="wordmark ${dark ? 'dark' : ''}">${ballMark}Slice</span>`;

function topbar({ back, title, right = '' }) {
  return h`<header class="topbar"><div class="inner">
    <a class="circle" href="${back}" aria-label="Back">${I.back}</a>
    <div class="title">${title}</div>
    ${right || h`<span style="width:44px"></span>`}
  </div></header>`;
}

function tabbar(items, active) {
  return h`<nav class="tabbar" aria-label="Sections">${items.map(([key, href, icon, label]) => h`<a href="${href}" ${key === active ? raw('aria-current="page"') : ''} aria-label="${label}">${icon}<span>${label}</span></a>`)}</nav>`;
}
const homeTabs = (active) => tabbar([['home', '#/', I.home, 'Home'], ['new', '#/day/new', I.cal, 'New day'], ['players', '#/players', I.users, 'Players'], ['settings', '#/settings', I.gear, 'Settings']], active);
const dayTabs = (id, active) => tabbar([
  ['home', '#/', I.home, 'Home'],
  ['courts', `#/day/${id}`, I.court, 'Courts'],
  ['standings', `#/day/${id}/standings`, I.trophy, 'Standings'],
  ['activity', `#/day/${id}/activity`, I.log, 'Log'],
  ['setup', `#/day/${id}/setup`, I.sliders, 'Setup'],
], active);

function empty(title, text, action = '') {
  return h`<div class="empty"><div class="pic photo"></div><h3>${title}</h3>${text ? h`<p>${text}</p>` : ''}${action}</div>`;
}

const cta = (label, attrs, cls = 'btn-lime') => h`<button class="btn ${cls} cta btn-block" ${raw(attrs)}><span>${label}</span><span class="arrow">${I.arrow}</span></button>`;

// ---------- Instant navigation ----------
// Screens render immediately from the last copy we saw, then refresh in the
// background and re-render only if something actually changed.
const CACHE = new Map();
let navId = 0;

async function fresh(key, fetcher, render) {
  const nav = navId;
  const hit = CACHE.get(key);
  if (hit) render(hit.data);
  let data;
  try {
    data = await fetcher();
  } catch (err) {
    if (hit && err.status !== 401) return; // offline or flaky: keep showing the cached screen
    throw err;
  }
  const json = JSON.stringify(data);
  CACHE.set(key, { data, json });
  if (nav === navId && (!hit || hit.json !== json)) render(data);
}

function prefetch(key, url) {
  if (CACHE.has(key)) return;
  api(url).then((data) => CACHE.set(key, { data, json: JSON.stringify(data) })).catch(() => {});
}

// ---------- Router ----------
let pollTimer = null;
async function route() {
  navId += 1;
  clearInterval(pollTimer);
  S.modal = null;
  paintModal();
  window.scrollTo(0, 0);
  if (location.pathname === '/install') return renderInstall();
  const pub = location.pathname.match(/^\/v\/([\w-]+)/);
  if (pub) {
    store('slice.viewToken', pub[1]);
    return showPublic(pub[1]);
  }
  try {
    if (!S.me) {
      // Trust the last known sign-in so the first screen paints at once; verify in the background.
      let saved = null;
      try { saved = JSON.parse(readLocal('slice.me') ?? 'null'); } catch {}
      if (saved?.organizer) {
        S.me = saved;
        api('/api/me').then((me) => {
          store('slice.me', JSON.stringify(me));
          if (!me.organizer) { S.me = me; route(); }
        }).catch(() => {});
      } else {
        S.me = await api('/api/me');
        store('slice.me', JSON.stringify(S.me));
      }
    }
    const hash = location.hash.slice(1) || '/';
    const viewToken = readLocal('slice.viewToken');
    if (!S.me.organizer && viewToken && isStandalone()) return location.replace(`/v/${viewToken}`);
    if (!S.me.organizer) return renderLogin();
    if (!seen('intro')) return renderIntro();
    let m;
    if (hash === '/' || hash === '/login') return await showHome();
    if (hash === '/players') return await showPlayers();
    if (hash === '/settings') return renderSettings();
    if (hash === '/day/new') return await showNewDay();
    if ((m = hash.match(/^\/day\/(\d+)\/match\/(\d+)$/))) return await showMatch(+m[1], +m[2]);
    if ((m = hash.match(/^\/day\/(\d+)(?:\/(courts|standings|activity|setup))?$/))) return await showDay(+m[1], m[2] || 'courts');
    go('#/');
  } catch (err) {
    if (err.status === 401) return;
    paint(h`${topbar({ back: '#/', title: '' })}<div class="wrap">${empty('Couldn’t load that', err.message, h`<a class="btn btn-dark" href="#/">Home</a>`)}</div>`);
  }
}
window.addEventListener('hashchange', route);

// ---------- Event delegation ----------
const ACT = {};
const FORM = {};
const CHANGE = {};
const BIND = {};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.dataset.act === 'overlay' && e.target !== el) return; // clicks inside the sheet
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve()
    .then(() => fn(el.dataset, el, e))
    .catch((err) => err.status !== 401 && toast(err.message, true));
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const errBox = f.querySelector('[data-error]') ?? f.parentElement?.querySelector(':scope > [data-error]');
  if (errBox) errBox.hidden = true;
  const btn = f.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  Promise.resolve()
    .then(() => FORM[f.dataset.form](Object.fromEntries(new FormData(f)), f))
    .catch((err) => {
      if (err.status === 401 && f.dataset.form !== 'login' && f.dataset.form !== 'password') return;
      if (errBox) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      } else toast(err.message, true);
    })
    .finally(() => btn && (btn.disabled = false));
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el) CHANGE[el.dataset.change]?.(el.dataset, el);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-bind]');
  if (el) BIND[el.dataset.bind]?.(el.dataset, el);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.modal) ACT.closeModal();
});

// ---------- Sign-in ----------
function renderLogin() {
  const setup = S.me.setupNeeded;
  if (location.hash !== '#/login') history.replaceState(null, '', '#/login');
  paint(h`<div class="signin photo">
    <div class="head"><h1>Slice</h1><p class="sub">Sridhar’s Tennis Academy</p></div>
    <form class="glass stack" data-form="${setup ? 'setup' : 'login'}">
      <label class="field on-glass" for="pw"><span>${setup ? 'Create a club password' : 'Club password'}</span></label>
      <div class="pw-row">
        <input class="glass-input" id="pw" type="password" name="password"
          autocomplete="${setup ? 'new-password' : 'current-password'}" required ${setup ? 'minlength=6' : ''}>
        <button class="go" type="submit" aria-label="${setup ? 'Save password' : 'Sign in'}">${I.arrow}</button>
      </div>
      <div class="error" data-error hidden></div>
      <a class="foot small install-link" href="/install">Get Slice on your phone</a>
      <p class="foot small">${readLocal('slice.viewToken') ? h`Just following along? <a href="/v/${readLocal('slice.viewToken')}">Open the live view</a>` : 'Just following along? Open the view link from your group chat.'}</p>
    </form>
  </div>`);
}

FORM.login = async ({ password }) => {
  await api('/api/login', { method: 'POST', body: { password } });
  S.me = { organizer: true, setupNeeded: false };
  store('slice.me', JSON.stringify(S.me));
  go('#/');
};
FORM.setup = async ({ password }) => {
  await api('/api/setup', { method: 'POST', body: { password } });
  S.me = { organizer: true, setupNeeded: false };
  store('slice.me', JSON.stringify(S.me));
  go('#/');
};
ACT.logout = async () => {
  await api('/api/logout', { method: 'POST' });
  S.me = { organizer: false, setupNeeded: false };
  store('slice.me', JSON.stringify(S.me));
  CACHE.clear();
  go('#/login');
};

// ---------- Home ----------
async function showHome() {
  await fresh('home', () => Promise.all([api('/api/days'), api('/api/players')]), ([days, players]) => {
    renderHome(days, players);
    // Warm the screens people open next; Home already has the player list.
    CACHE.set('players', { data: players, json: JSON.stringify(players) });
    for (const d of days.slice(0, 3)) prefetch(`day:${d.id}`, `/api/days/${d.id}`);
  });
}

function renderHome(days, players) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const todays = byDate.get(today());
  const start = new Date();
  start.setDate(start.getDate() - 3);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  paint(h`<div class="wrap">
    <header class="hero photo" style="${photo('hero-home.jpg')}">
      <div class="bar">${wordmark()}<span class="grow"></span>
        <a class="circle glass" href="#/settings" aria-label="Settings">${I.gear}</a></div>
      <div class="title-block">
        <h1>${greet}</h1>
      </div>
      <div class="week">${week.map((d) => {
        const key = iso(d);
        const s = byDate.get(key);
        const cls = `d ${key === today() ? 'on' : ''} ${s ? 'has' : ''}`;
        const inner = h`<span>${d.toLocaleDateString(undefined, { weekday: 'short' })}</span><span class="n">${d.getDate()}</span><span class="dot"></span>`;
        return s ? h`<a class="${cls}" href="#/day/${s.id}" aria-label="${s.title}">${inner}</a>` : h`<span class="${cls}">${inner}</span>`;
      })}</div>
    </header>

    <div style="margin-top:16px">
      ${todays
        ? h`<a class="btn btn-dark cta btn-block" href="#/day/${todays.id}"><span>Open today’s session</span><span class="arrow">${I.arrow}</span></a>`
        : h`<a class="btn btn-lime cta btn-block" href="#/day/new"><span>Start today’s session</span><span class="arrow">${I.arrow}</span></a>`}
    </div>

    <div class="install-slot">${installTip()}</div>
    ${checklist(days, players)}
    <div class="section-head"><h2>Sessions</h2><span class="count">${days.length}</span></div>
    ${days.length ? h`<div class="stack">${days.map(sessionCard)}</div>` : empty('No sessions yet', 'Start one when players arrive.')}
  </div>
  ${homeTabs('home')}`);
}

function sessionCard(d) {
  return h`<a class="card session" href="#/day/${d.id}">
    <div class="info">
      <div class="row between"><h3>${d.title}</h3>${d.liveCount ? h`<span class="pill live">Live</span>` : ''}</div>
      <span class="meta">${I.cal}${fmtDate(d.date)}</span>
      <span class="meta">${I.court}${FORMATS[d.format].short} · ${d.completedCount}/${d.matchCount} played</span>
      ${d.scorer ? h`<span class="meta">${I.scorer}${d.scorer}</span>` : ''}
      <span class="star">${I.star}${d.potd.length ? d.potd.join(' & ') : 'Pending'}</span>
    </div>
    <div class="thumb photo" style="${photo(`court-${(d.id % 3) + 1}.jpg`)}"></div>
  </a>`;
}

// ---------- Players ----------
async function showPlayers() {
  await fresh('players', () => api('/api/players'), (players) => {
    S.players = players;
    renderPlayers();
  });
}

function renderPlayers() {
  const active = S.players.filter((p) => !p.archived);
  const archived = S.players.filter((p) => p.archived);
  const row = (p) =>
    S.editingPlayer === p.id
      ? h`<li><form class="player-row" data-form="renamePlayer" data-id="${p.id}">
          <input type="text" name="name" value="${p.name}" maxlength="40" required autofocus aria-label="Player name">
          <button class="btn btn-lime btn-sm" type="submit">Save</button>
          <button class="circle" type="button" data-act="cancelEdit" aria-label="Cancel">${I.x}</button>
        </form><div class="error" data-error hidden style="margin-bottom:10px"></div></li>`
      : h`<li class="player-row ${p.archived ? 'archived' : ''}">
          <span class="name">${p.name}</span>
          ${p.archived
            ? h`<button class="btn btn-light btn-sm" data-act="archivePlayer" data-id="${p.id}" data-on="0">Restore</button>`
            : h`<button class="circle" data-act="editPlayer" data-id="${p.id}" aria-label="Rename ${p.name}">${I.pencil}</button>
               <button class="btn btn-text btn-sm" data-act="archivePlayer" data-id="${p.id}" data-on="1">Archive</button>`}
        </li>`;
  paint(h`${topbar({ back: '#/', title: 'Players' })}
  <div class="wrap">
    <label class="field" for="newPlayer"><span>Add a player</span></label>
    <form class="row" data-form="addPlayer">
      <input id="newPlayer" type="text" name="name" maxlength="40" required autocomplete="off">
      <button class="btn btn-lime" type="submit">Add</button>
    </form>
    <div class="error" data-error hidden id="addPlayerError" style="margin-top:10px"></div>
    <div class="section-head"><h2>Squad</h2><span class="count">${active.length}</span></div>
    ${active.length ? h`<ul class="list card">${active.map(row)}</ul>` : empty('No players yet', 'Add the regulars once.')}
    ${archived.length ? h`<div class="section-head"><h2>Archived</h2><span class="count">${archived.length}</span></div><ul class="list card">${archived.map(row)}</ul>` : ''}
  </div>
  ${homeTabs('players')}`);
}

FORM.addPlayer = async ({ name: n }) => {
  try {
    const p = await api('/api/players', { method: 'POST', body: { name: n } });
    S.players.push(p);
    S.players.sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name));
    renderPlayers();
    toast(`${p.name} added`);
    document.querySelector('[data-form=addPlayer] input')?.focus();
  } catch (err) {
    const box = document.getElementById('addPlayerError');
    box.textContent = err.message;
    box.hidden = false;
  }
};
FORM.renamePlayer = async ({ name: n }, f) => {
  const p = await api(`/api/players/${f.dataset.id}`, { method: 'PATCH', body: { name: n } });
  S.players = S.players.map((x) => (x.id === p.id ? p : x));
  S.editingPlayer = null;
  renderPlayers();
  toast('Renamed');
};
FORM.password = async ({ current, next }, f) => {
  await api('/api/password', { method: 'POST', body: { current, next } });
  f.reset();
  toast('Password changed');
};
ACT.editPlayer = ({ id }) => {
  S.editingPlayer = +id;
  renderPlayers();
};
ACT.cancelEdit = () => {
  S.editingPlayer = null;
  renderPlayers();
};
ACT.archivePlayer = async ({ id, on }) => {
  const p = await api(`/api/players/${id}`, { method: 'PATCH', body: { archived: on === '1' } });
  S.players = S.players.map((x) => (x.id === p.id ? p : x));
  renderPlayers();
  toast(p.archived ? `${p.name} archived` : `${p.name} restored`);
};

// ---------- New day ----------
async function showNewDay() {
  await fresh('players', () => api('/api/players'), (players) => {
    S.players = players;
    S.draft ??= { date: today(), title: '', format: 'set', courts: 2, playerIds: [], scorer: readLocal('slice.lastScorer') ?? '' };
    renderNewDay();
  });
}

const formatCards = (current, change, nameAttr) =>
  h`<div class="formats">${[['set', '6', 'games'], ['mtb', '10', 'points']].map(([id, big, unit]) => h`<label class="format">
    <input type="radio" name="${nameAttr}" value="${id}" ${current === id ? 'checked' : ''} data-change="${change}">
    <span class="big">${big}</span><strong>${FORMATS[id].short}</strong><span class="muted">${id === 'set' ? 'Tiebreak at 6–6' : 'Win by 2'}</span>
  </label>`)}</div>`;

function renderNewDay() {
  const d = S.draft;
  const active = S.players.filter((p) => !p.archived);
  const n = d.playerIds.length;
  paint(h`${topbar({ back: '#/', title: 'New session' })}
  <div class="wrap">
    <div class="card stack">
      <div class="row" style="gap:12px">
        <label class="field grow"><span>Date</span><input type="date" value="${d.date}" data-bind="draft" data-key="date"></label>
        <div class="field"><span>Courts</span>
          <div class="stepper"><button type="button" data-act="draftCourts" data-d="-1" aria-label="Fewer courts">−</button>
          <output>${d.courts}</output><button type="button" data-act="draftCourts" data-d="1" aria-label="More courts">+</button></div></div>
      </div>
      <label class="field"><span>Title</span>
        <input type="text" maxlength="60" value="${d.title}" placeholder="${fmtDate(d.date, { weekday: 'long' })} session" data-bind="draft" data-key="title"></label>
      <label class="field"><span>Scoring today</span>
        <input type="text" maxlength="40" value="${d.scorer}" list="scorerNames" data-bind="draft" data-key="scorer" autocomplete="off"></label>
      <datalist id="scorerNames">${active.map((p) => h`<option value="${p.name}">`)}</datalist>
    </div>

    <div class="section-head"><h2>Format</h2></div>
    ${formatCards(d.format, 'draftFormat', 'format')}

    <div class="section-head"><h2>Who’s here</h2><span class="count">${n}</span></div>
    ${active.length
      ? h`<div class="chips">${active.map((p) => h`<button type="button" class="chip" aria-pressed="${d.playerIds.includes(p.id)}" data-act="draftToggle" data-id="${p.id}"><span class="tick">${I.check}</span>${p.name}</button>`)}</div>
        <div class="row" style="margin-top:6px"><button class="btn btn-text btn-sm" data-act="draftAll">All</button><button class="btn btn-text btn-sm" data-act="draftNone">None</button></div>`
      : ''}
    <label class="field" for="quickAdd" style="margin-top:14px"><span>Someone new</span></label>
    <form class="row" data-form="quickAdd">
      <input id="quickAdd" type="text" name="name" maxlength="40" required autocomplete="off">
      <button class="btn btn-light" type="submit">Add</button>
    </form>
    <div class="error" data-error hidden id="quickAddError" style="margin-top:10px"></div>
    <div style="margin-top:22px">${cta(n < 2 ? 'Pick at least 2 players' : `Start with ${n} players`, `data-act="createDay" ${n < 2 ? 'disabled' : ''}`)}</div>
  </div>`);
}

BIND.draft = ({ key }, el) => {
  S.draft[key] = el.value;
};
CHANGE.draftFormat = (_, el) => {
  S.draft.format = el.value;
};
ACT.draftCourts = ({ d }) => {
  S.draft.courts = Math.min(12, Math.max(1, S.draft.courts + Number(d)));
  renderNewDay();
};
ACT.draftToggle = ({ id }) => {
  const ids = S.draft.playerIds;
  S.draft.playerIds = ids.includes(+id) ? ids.filter((x) => x !== +id) : [...ids, +id];
  renderNewDay();
};
ACT.draftAll = () => {
  S.draft.playerIds = S.players.filter((p) => !p.archived).map((p) => p.id);
  renderNewDay();
};
ACT.draftNone = () => {
  S.draft.playerIds = [];
  renderNewDay();
};
FORM.quickAdd = async ({ name: n }) => {
  try {
    const p = await api('/api/players', { method: 'POST', body: { name: n } });
    S.players.push(p);
    S.players.sort((a, b) => a.name.localeCompare(b.name));
    S.draft.playerIds.push(p.id);
    renderNewDay();
    document.querySelector('[data-form=quickAdd] input')?.focus();
  } catch (err) {
    const box = document.getElementById('quickAddError');
    box.textContent = err.message;
    box.hidden = false;
  }
};
ACT.createDay = async () => {
  const day = await api('/api/days', { method: 'POST', body: S.draft });
  if (S.draft.scorer) store('slice.lastScorer', S.draft.scorer);
  S.draft = null;
  S.plan = null;
  go(`#/day/${day.id}`);
};

// ---------- Day ----------
async function loadDay(id) {
  S.view = await api(`/api/days/${id}`);
  CACHE.set(`day:${id}`, { data: S.view, json: JSON.stringify(S.view) });
  return S.view;
}

async function showDay(id, tab) {
  if (S.view?.day.id !== id) S.plan = null;
  S.route = { id, tab };
  // Switching tabs inside a session reuses what is already on screen.
  if (S.view?.day.id === id && !CACHE.has(`day:${id}`)) CACHE.set(`day:${id}`, { data: S.view, json: JSON.stringify(S.view) });
  await fresh(`day:${id}`, () => api(`/api/days/${id}`), (view) => {
    S.view = view;
    if (!S.modal) renderDay();
  });
}

function dayHero(publicView = false) {
  const { day } = S.view;
  return h`<header class="hero photo" style="${photo(publicView ? 'hero-public.jpg' : 'hero-day.jpg')};min-height:250px">
    <div class="bar">
      ${publicView ? wordmark() : h`<a class="circle glass" href="#/" aria-label="Home">${I.back}</a>`}
      <span class="grow"></span>
      ${publicView ? h`<span class="pill glass">View only</span>` : h`<button class="circle glass" data-act="share" aria-label="Share player link">${I.share}</button>`}
    </div>
    <div class="title-block">
      <h1>${day.title}</h1>
      <div class="row wrap-row" style="gap:6px;margin-top:12px">
        <span class="pill glass">${fmtDate(day.date)}</span>
        <span class="pill glass">${day.formatInfo.short}</span>
        <span class="pill glass">${day.courts} court${day.courts > 1 ? 's' : ''}</span>
        <span class="pill glass">${S.view.present.length} players</span>
        ${day.scorer ? h`<span class="pill glass" aria-label="Scoring today: ${day.scorer}">${I.scorer} ${day.scorer}</span>` : ''}
      </div>
    </div>
  </header>`;
}

function renderDay() {
  const { tab } = S.route;
  const body = { courts: courtsTab, standings: standingsTab, activity: activityTab, setup: setupTab }[tab]();
  paint(h`<div class="wrap">${dayHero()}${body}</div>${dayTabs(S.view.day.id, tab)}`);
}

const byStatus = (s) => S.view.matches.filter((m) => m.status === s);
const newestFirst = (list) => list.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

function courtsTab() {
  const live = byStatus('live');
  const next = byStatus('scheduled');
  const done = newestFirst(byStatus('completed'));
  const incomplete = byStatus('incomplete');
  return h`
    ${tip('suggest', 'Start here', 'Suggest builds the next round from who’s free. Edit any slot before you save.')}
    ${S.plan ? planEditor(S.plan, 'main') : suggestCard()}
    ${live.length ? h`<div class="section-head"><h2>On court</h2><span class="pill live">${live.length} live</span></div><div class="stack">${live.map((m) => matchCard(m, true))}</div>` : ''}
    ${next.length ? h`<div class="section-head"><h2>Up next</h2><span class="count">${next.length}</span></div><div class="stack">${next.map((m) => matchCard(m, true))}</div>` : ''}
    <div class="section-head"><h2>Results</h2><span class="count">${done.length}</span></div>
    ${done.length ? h`<div class="stack">${done.map((m) => matchCard(m, true))}</div>` : empty('No results yet', '')}
    ${incomplete.length ? h`<div class="section-head"><h2>Incomplete</h2><span class="count">Not counted</span></div><div class="stack">${incomplete.map((m) => matchCard(m, true))}</div>` : ''}`;
}

function suggestCard() {
  if (S.view.present.length < 2) {
    return h`<div style="margin-top:16px">${empty('Who’s playing?', 'Mark at least two players.', h`<a class="btn btn-dark" href="#/day/${S.view.day.id}/setup">Add players</a>`)}</div>`;
  }
  return h`<section class="card stack" style="margin-top:16px">
    <div class="row between"><h2>Next round</h2><button class="btn btn-text btn-sm" data-act="manualMatch">${I.plus} Manual</button></div>
    <div class="seg" role="group" aria-label="Match type">
      ${[['auto', 'Best fit'], ['doubles', 'Doubles'], ['singles', 'Singles']].map(([k, l]) => h`<button type="button" data-act="mode" data-mode="${k}" aria-pressed="${S.mode === k}">${l}</button>`)}
    </div>
    ${cta('Suggest matches', 'data-act="suggest"')}
  </section>`;
}

function liveState(m) {
  if (m.source === 'manual' || !m.points) return null;
  try {
    return replay(S.view.day.format, m.points);
  } catch {
    return null;
  }
}

function scoreCells(m) {
  if (m.status === 'completed' || (m.status === 'incomplete' && m.score)) {
    const s = m.score;
    const tb = (i) => (s.tb ? h`<small>${s.tb[i]}</small>` : '');
    return [h`${s.a}${tb(0)}`, h`${s.b}${tb(1)}`];
  }
  if (m.status === 'live') {
    const st = liveState(m) ?? replay(S.view.day.format, '');
    const p = pointDisplay(st);
    if (st.format === 'mtb') return [p.a, p.b];
    return [h`${st.games[0]}<small>${p.a}</small>`, h`${st.games[1]}<small>${p.b}</small>`];
  }
  return ['', ''];
}

function matchCard(m, organizer) {
  const [sa, sb] = scoreCells(m);
  const cls = (side) => (m.status === 'completed' ? (m.winner === side ? 'won' : 'lost') : '');
  const pill = {
    live: h`<span class="pill live">Live</span>`,
    scheduled: h`<span class="pill">Next</span>`,
    completed: h`<span class="pill done">Final</span>`,
    incomplete: h`<span class="pill warn">Stopped</span>`,
  }[m.status];
  const base = `#/day/${m.dayId}/match/${m.id}`;
  const edit = h`<button class="circle" data-act="lineupModal" data-id="${m.id}" aria-label="Edit match">${I.pencil}</button>`;
  let actions = '';
  if (organizer) {
    if (m.status === 'scheduled') {
      actions = h`<a class="btn btn-lime btn-sm" href="${base}">Start</a><button class="btn btn-light btn-sm" data-act="resultModal" data-id="${m.id}">Enter score</button>${edit}`;
    } else if (m.status === 'live') {
      actions = h`<a class="btn btn-lime btn-sm" href="${base}">Continue scoring</a>${edit}`;
    } else if (m.status === 'completed') {
      actions = h`<button class="btn btn-light btn-sm" data-act="resultModal" data-id="${m.id}">Correct score</button>${edit}`;
    } else {
      actions = h`<button class="btn btn-lime btn-sm" data-act="reopen" data-id="${m.id}">Resume</button><button class="btn btn-light btn-sm" data-act="resultModal" data-id="${m.id}">Enter score</button>${edit}`;
    }
  }
  return h`<article class="card match">
    <div class="match-head"><span class="court">Court ${m.court} · ${m.kind === 'doubles' ? 'Doubles' : 'Singles'}</span>${pill}</div>
    <div class="teams">
      <span class="team ${cls('A')}">${team(m.teamA)}</span><span class="tscore">${sa}</span>
      <span class="team ${cls('B')}">${team(m.teamB)}</span><span class="tscore">${sb}</span>
    </div>
    ${actions ? h`<div class="match-actions">${actions}</div>` : ''}
  </article>`;
}

ACT.mode = ({ mode }) => {
  S.mode = mode;
  renderDay();
};
ACT.suggest = async () => {
  const s = await api(`/api/days/${S.view.day.id}/suggest`, { method: 'POST', body: { mode: S.mode, seed: Math.floor(Math.random() * 1e9) } });
  if (!s.matches.length) {
    const free = S.view.present.filter((p) => !s.busy.includes(p.id));
    toast(free.length ? `Only ${free.map((p) => first(p.id)).join(', ')} free — need two` : 'Everyone is on court or up next', true);
    return;
  }
  S.plan = { matches: s.matches.map((m) => ({ ...m, teamA: [...m.teamA], teamB: [...m.teamB] })), played: s.played, suggested: true };
  renderDay();
};
ACT.manualMatch = () => {
  S.plan = { matches: [blankMatch()], played: playedCounts(), suggested: false };
  renderDay();
};

function playedCounts() {
  const c = {};
  for (const m of S.view.matches) for (const id of [...m.teamA, ...m.teamB]) c[id] = (c[id] ?? 0) + 1;
  return c;
}

function blankMatch() {
  const used = new Set(S.view.matches.filter((m) => m.status === 'live' || m.status === 'scheduled').map((m) => m.court));
  const court = Array.from({ length: S.view.day.courts }, (_, i) => i + 1).find((c) => !used.has(c)) ?? 1;
  const kind = S.view.present.length >= 4 ? 'doubles' : 'singles';
  return { court, kind, teamA: kind === 'doubles' ? [null, null] : [null], teamB: kind === 'doubles' ? [null, null] : [null], notes: [] };
}

// Busy = in a scheduled/live match other than the one being edited.
function busyIds(exceptId) {
  return new Set(S.view.matches.filter((m) => m.id !== exceptId && (m.status === 'live' || m.status === 'scheduled')).flatMap((m) => [...m.teamA, ...m.teamB]));
}

function planEditor(plan, key, exceptId = null) {
  const busy = busyIds(exceptId);
  const inPlan = plan.matches.flatMap((m) => [...m.teamA, ...m.teamB]).filter((x) => x != null);
  const dupes = new Set(inPlan.filter((x, i) => inPlan.indexOf(x) !== i));
  const sitting = S.view.present.filter((p) => !busy.has(p.id) && !inPlan.includes(p.id));
  const played = plan.played ?? playedCounts();
  const isModal = key === 'modal';
  const slot = (i, side, j, val) => h`<select data-change="slot" data-plan="${key}" data-i="${i}" data-side="${side}" data-j="${j}" aria-label="Player">
      <option value="">Choose player</option>
      ${S.view.present.map((p) => h`<option value="${p.id}" ${p.id === val ? 'selected' : ''}>${p.name} (${played[p.id] ?? 0})${busy.has(p.id) ? ' · busy' : ''}</option>`)}
    </select>`;
  const notes = (m) => {
    if (!plan.suggested || exceptId) return '';
    if (!m.notes?.length) return h`<p class="note fresh" style="margin-top:10px">New partners and opponents</p>`;
    const partners = m.notes.filter((n) => n.type === 'partner').length;
    const opp = m.notes.filter((n) => n.type === 'opponent').length;
    return h`<p class="note repeat" style="margin-top:10px">${[partners && `${partners} repeat partner${partners > 1 ? 's' : ''}`, opp && `${opp} repeat opponent${opp > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</p>`;
  };
  return h`<section class="${isModal ? '' : 'card'} stack" style="${isModal ? '' : 'margin-top:16px'}">
    ${isModal ? '' : h`<div class="row between"><h2>${plan.suggested ? 'Suggested' : 'New match'}</h2>
      ${plan.suggested ? h`<button class="btn btn-light btn-sm" data-act="suggest">Shuffle</button>` : ''}</div>`}
    ${plan.matches.map((m, i) => h`<div class="card soft">
      <div class="row between" style="margin-bottom:10px">
        <select data-change="planCourt" data-plan="${key}" data-i="${i}" aria-label="Court" style="width:auto;min-height:44px">
          ${Array.from({ length: S.view.day.courts }, (_, c) => h`<option value="${c + 1}" ${m.court === c + 1 ? 'selected' : ''}>Court ${c + 1}</option>`)}
        </select>
        <div class="seg" style="flex:none">${['singles', 'doubles'].map((k) => h`<button type="button" data-act="planKind" data-plan="${key}" data-i="${i}" data-kind="${k}" aria-pressed="${m.kind === k}">${k === 'singles' ? 'Singles' : 'Doubles'}</button>`)}</div>
      </div>
      <div class="slot-grid">${m.teamA.map((v, j) => slot(i, 'teamA', j, v))}</div>
      <div class="vs">VS</div>
      <div class="slot-grid">${m.teamB.map((v, j) => slot(i, 'teamB', j, v))}</div>
      ${notes(m)}
      ${!isModal && plan.matches.length > 1 ? h`<button class="btn btn-text btn-sm" data-act="planRemove" data-i="${i}" style="margin-top:6px">Remove</button>` : ''}
    </div>`)}
    ${dupes.size ? h`<div class="error">${[...dupes].map(first).join(', ')} picked twice</div>` : ''}
    ${isModal ? '' : h`<p class="note">Sitting out: <b>${sitting.length ? sitting.map((p) => first(p.id)).join(', ') : 'nobody'}</b></p>
      <div class="row"><button class="btn btn-light btn-sm" data-act="planAdd">${I.plus} Match</button><span class="grow"></span><button class="btn btn-text btn-sm" data-act="planCancel">Cancel</button></div>
      ${cta(`Add ${plan.matches.length} to Up next`, 'data-act="planSave"', 'btn-dark')}`}
  </section>`;
}

const planFor = (key) => (key === 'modal' ? S.modal.plan : S.plan);
const repaintPlan = (key) => (key === 'modal' ? paintModal() : renderDay());

CHANGE.slot = ({ plan, i, side, j }, el) => {
  planFor(plan).matches[i][side][j] = el.value ? Number(el.value) : null;
  repaintPlan(plan);
};
CHANGE.planCourt = ({ plan, i }, el) => {
  planFor(plan).matches[i].court = Number(el.value);
};
ACT.planKind = ({ plan, i, kind }) => {
  const m = planFor(plan).matches[i];
  const size = kind === 'doubles' ? 2 : 1;
  m.kind = kind;
  m.teamA = Array.from({ length: size }, (_, j) => m.teamA[j] ?? null);
  m.teamB = Array.from({ length: size }, (_, j) => m.teamB[j] ?? null);
  repaintPlan(plan);
};
ACT.planAdd = () => {
  S.plan.matches.push(blankMatch());
  renderDay();
};
ACT.planRemove = ({ i }) => {
  S.plan.matches.splice(+i, 1);
  renderDay();
};
ACT.planCancel = () => {
  S.plan = null;
  renderDay();
};
ACT.planSave = async () => {
  const matches = S.plan.matches.map(({ court, kind, teamA, teamB }) => ({ court, kind, teamA, teamB }));
  if (matches.some((m) => [...m.teamA, ...m.teamB].some((x) => x == null))) throw new Error('Fill every player slot');
  await api(`/api/days/${S.view.day.id}/matches`, { method: 'POST', body: { matches } });
  S.plan = null;
  await loadDay(S.view.day.id);
  renderDay();
  toast(`${matches.length} added to Up next`);
};
ACT.deleteMatch = async ({ id }) => {
  const m = S.view.matches.find((x) => x.id === +id);
  if (!confirm(`Remove ${team(m.teamA)} v ${team(m.teamB)}?${m.status === 'completed' ? ' Its result leaves the standings.' : ''}`)) return;
  await api(`/api/matches/${id}`, { method: 'DELETE' });
  S.modal = null;
  paintModal();
  await loadDay(S.view.day.id);
  renderDay();
  toast('Match removed');
};
ACT.reopen = async ({ id }) => {
  await api(`/api/matches/${id}/reopen`, { method: 'POST' });
  go(`#/day/${S.view.day.id}/match/${id}`);
};

ACT.share = async () => {
  const url = `${location.origin}/v/${S.view.day.shareToken}`;
  markSeen('shared');
  if (navigator.share) {
    try {
      await navigator.share({ title: S.view.day.title, url });
      return;
    } catch {
      /* fall through to copy */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Player link copied');
  } catch {
    prompt('Player link:', url);
  }
};

// ---------- Standings ----------
function potdCard(potd) {
  if (potd.status === 'pending') {
    return h`<section class="potd photo pending"><span class="pill glass potd-badge">${I.trophy} Player of the Day</span><p class="name">Pending</p>
      <div class="stats"><span class="stat ghost">Needs ${MIN_MATCHES} completed matches</span></div></section>`;
  }
  const w = potd.winners[0];
  return h`<section class="potd photo">
    <span class="pill glass potd-badge">${I.trophy} Player of the Day${potd.shared ? ', shared' : ''}</span>
    <p class="name">${potd.winners.map((x) => x.name).join(' & ')}</p>
    <div class="stats"><span class="stat">${w.wins}–${w.losses}</span><span class="stat">${pct(w)}</span><span class="stat">${avg(w)} ${S.view.day.formatInfo.unit === 'games' ? 'g' : 'pts'}</span>
      <span class="stat ghost">${potd.shared ? 'Tied on all' : `By ${potd.decidedBy === 'average score differential' ? 'differential' : potd.decidedBy}`}</span></div>
  </section>`;
}

// The Player of the Day rule, kept visible but compact.
const ruleLine = () => h`<div class="rule"><span class="step">${MIN_MATCHES}+ matches</span>›<span class="step">Win %</span>›<span class="step">Wins</span>›<span class="step">Avg ±</span>›<span class="step">Ties share</span></div>`;

function board() {
  const rows = S.view.standings;
  if (!rows.length) return empty('No players yet', '');
  return h`<ul class="list card" style="padding:4px 14px">${rows.map((r) => h`<li class="leader ${r.rank === 1 ? 'first' : ''} ${r.eligible ? '' : 'out'}">
    <span class="rk">${r.rank ?? '·'}</span>
    <span class="nm">${r.name}<span class="sub">${r.eligible ? `${r.played} played · ${avg(r)} avg` : r.played ? `${MIN_MATCHES - r.played} more to qualify` : 'Not played'}</span></span>
    <span class="rec"><b>${r.wins}–${r.losses}</b><span>${pct(r)}</span></span>
  </li>`)}</ul>`;
}

function standingsTab() {
  return h`<div style="margin-top:16px">${potdCard(S.view.potd)}${ruleLine()}
    <div class="section-head"><h2>Leaderboard</h2><span class="count">Doubles count for both</span></div>${board()}</div>`;
}

// ---------- Activity ----------
function activityTab() {
  const list = S.view.activity ?? [];
  const icon = { completed: ['done', I.check], corrected: ['fix', I.fix], incomplete: ['fix', I.stop], reopened: ['', I.undo], deleted: ['fix', I.x], scorer: ['', I.scorer] };
  list.splice(0, list.length, ...list.filter((a) => a.action !== 'scorer'));
  return h`<div class="section-head"><h2>Log</h2><span class="count">Result changes</span></div>
    ${list.length
      ? h`<ul class="list card activity" style="padding:2px 14px">${list.map((a) => {
          const [cls, ic] = icon[a.action] ?? ['', I.log];
          return h`<li><span class="ico ${cls}">${ic}</span><div><p class="what">${a.summary}</p>
            <p class="meta">${fmtTime(a.at)}${a.matchLabel ? ` · Court ${a.matchLabel.match(/Court (\d+)/)?.[1]}` : ''}</p>
            ${a.by || a.note ? h`<p class="meta">${[a.by, a.note && `“${a.note}”`].filter(Boolean).join(', ')}</p>` : ''}</div></li>`;
        })}</ul>`
      : empty('Nothing logged yet', 'Results and corrections show up here.')}`;
}

// ---------- Setup ----------
let allPlayersCache = null;
function setupTab() {
  const { day } = S.view;
  const presentIds = new Set(S.view.present.map((p) => p.id));
  const players = (allPlayersCache ?? S.view.present).filter((p) => !p.archived || presentIds.has(p.id));
  if (!allPlayersCache) api('/api/players').then((p) => { allPlayersCache = p; if (S.route?.tab === 'setup') renderDay(); });
  const started = S.view.matches.some((m) => m.status !== 'scheduled' || m.points);
  const url = `${location.origin}/v/${day.shareToken}`;
  return h`
    <div class="section-head"><h2>Who’s here</h2><span class="count">${presentIds.size}</span></div>
    <div class="chips">${players.map((p) => h`<button type="button" class="chip" aria-pressed="${presentIds.has(p.id)}" data-act="togglePresent" data-id="${p.id}"><span class="tick">${I.check}</span>${p.name}</button>`)}</div>
    <label class="field" for="dayAdd" style="margin-top:14px"><span>Someone new</span></label>
    <form class="row" data-form="dayAddPlayer"><input id="dayAdd" type="text" name="name" maxlength="40" required autocomplete="off"><button class="btn btn-light" type="submit">Add</button></form>
    <div class="error" data-error hidden id="dayAddError" style="margin-top:10px"></div>

    <div class="section-head"><h2>Session</h2></div>
    <div class="card stack">
      <div class="row between"><span style="font-weight:600">Courts</span>
        <div class="stepper"><button type="button" data-act="dayCourts" data-d="-1" aria-label="Fewer courts">−</button><output>${day.courts}</output><button type="button" data-act="dayCourts" data-d="1" aria-label="More courts">+</button></div></div>
      <form class="stack" data-form="daySession">
        <label class="field"><span>Title</span><input type="text" name="title" value="${day.title}" maxlength="60"></label>
        <label class="field"><span>Scoring today</span><input type="text" name="scorer" value="${day.scorer ?? ''}" maxlength="40" list="dayScorerNames" autocomplete="off"></label>
        <datalist id="dayScorerNames">${S.view.present.map((p) => h`<option value="${p.name}">`)}</datalist>
        <div class="error" data-error hidden></div>
        <button class="btn btn-light btn-block" type="submit">Save</button>
      </form>
    </div>

    <div class="section-head"><h2>Format</h2>${started ? h`<span class="count">Locked</span>` : ''}</div>
    ${started
      ? h`<div class="card"><strong>${day.formatInfo.name}</strong><p class="note" style="margin-top:4px">${day.formatInfo.rule}</p></div>`
      : formatCards(day.format, 'dayFormat', 'dayformat')}

    <div class="section-head"><h2>Player link</h2><span class="count">View only</span></div>
    ${tip('share', 'Share with players', 'They see live scores and standings. Nothing on it can be changed.')}
    <div class="card stack">
      <div class="share-box">${url}</div>
      <div class="row"><button class="btn btn-lime grow" data-act="share">${I.share} Share</button><a class="btn btn-light" href="${url}" target="_blank" rel="noopener">Open</a></div>
    </div>

    <div class="section-head"><h2>Delete session</h2></div>
    <button class="btn btn-danger btn-block" data-act="deleteDay">Delete “${day.title}”</button>`;
}

ACT.deleteDay = async () => {
  const { day, matches } = S.view;
  const done = matches.filter((m) => m.status === 'completed').length;
  if (!confirm(`Delete “${day.title}”?${done ? ` Its ${done} result${done > 1 ? 's' : ''} and the log go with it.` : ''} This can’t be undone.`)) return;
  await api(`/api/days/${day.id}`, { method: 'DELETE' });
  S.view = null;
  toast('Session deleted');
  go('#/');
};

async function patchDay(body) {
  await api(`/api/days/${S.view.day.id}`, { method: 'PATCH', body });
  await loadDay(S.view.day.id);
  renderDay();
}
ACT.togglePresent = async ({ id }) => {
  const ids = new Set(S.view.present.map((p) => p.id));
  if (ids.has(+id)) ids.delete(+id);
  else ids.add(+id);
  await patchDay({ playerIds: [...ids] });
};
ACT.dayCourts = async ({ d }) => {
  const courts = Math.min(12, Math.max(1, S.view.day.courts + Number(d)));
  if (courts !== S.view.day.courts) await patchDay({ courts });
};
CHANGE.dayFormat = async (_, el) => {
  try {
    await patchDay({ format: el.value });
  } catch (err) {
    toast(err.message, true);
    renderDay();
  }
};
FORM.daySession = async ({ title, scorer }) => {
  await patchDay({ title, scorer });
  if (scorer.trim()) store('slice.lastScorer', scorer.trim());
  toast('Saved');
};
FORM.dayAddPlayer = async ({ name: n }) => {
  try {
    const p = await api('/api/players', { method: 'POST', body: { name: n } });
    allPlayersCache = [...(allPlayersCache ?? []), p];
    await patchDay({ playerIds: [...S.view.present.map((x) => x.id), p.id] });
    toast(`${p.name} added`);
  } catch (err) {
    const box = document.getElementById('dayAddError');
    box.textContent = err.message;
    box.hidden = false;
  }
};

// ---------- Live scoring ----------
let pending = 0;
let queue = Promise.resolve();

async function showMatch(dayId, matchId) {
  S.route = { id: dayId, tab: 'courts', matchId };
  if (S.view?.day.id === dayId && !CACHE.has(`day:${dayId}`)) CACHE.set(`day:${dayId}`, { data: S.view, json: JSON.stringify(S.view) });
  await fresh(`day:${dayId}`, () => api(`/api/days/${dayId}`), (view) => {
    if (pending) return; // never overwrite taps that are still on their way to the server
    S.view = view;
    if (!S.view.matches.some((m) => m.id === matchId)) throw new Error('That match was removed.');
    if (!S.modal) renderMatch();
  });
}

const current = () => S.view.matches.find((m) => m.id === S.route.matchId);

function renderMatch() {
  const m = current();
  const format = S.view.day.format;
  const manual = m.source === 'manual';
  const st = manual ? null : replay(format, m.points);
  const p = st ? pointDisplay(st) : null;
  const sit = st ? pointSituation(st) : { A: null, B: null };
  const over = m.status === 'completed' || m.status === 'incomplete';
  const isSet = format === 'set';
  const games = (i) => (st ? st.games[i] : m.score ? [m.score.a, m.score.b][i] : 0);

  const row = (side, i, ids) => {
    const point = over ? (isSet ? (m.winner === side ? '✓' : '') : m.score ? [m.score.a, m.score.b][i] : '') : p ? [p.a, p.b][i] : '';
    return h`<div class="sb-row ${isSet ? '' : 'mtb'} ${m.winner === side ? 'winner' : ''}">
      <div class="sb-name">${team(ids)}${sit[side] ? h`<span class="sb-tag"><span class="pill live">${sit[side] === 'match' ? 'Match point' : 'Game point'}</span></span>` : ''}</div>
      ${isSet ? h`<div class="sb-games">${games(i)}${st?.tbFinal ? h`<small>TB ${st.tbFinal[i]}</small>` : ''}</div>` : ''}
      <div class="sb-point ${point === '' || (over && isSet) ? 'blank' : ''}">${point}</div>
    </div>`;
  };

  const winnerIds = m.winner === 'A' ? m.teamA : m.teamB;
  let state = '';
  if (!over) state = p.label;
  else if (m.status === 'incomplete') state = 'Stopped · not counted';

  const main = m.status === 'completed'
    ? h`<section class="final glass"><span class="trophy">${I.trophy}</span><p class="who">${team(winnerIds)}</p><p class="score-xl">${formatScore(m.score, m.winner)}</p></section>`
    : m.status === 'incomplete'
      ? h`<div style="flex:1"></div>`
      : h`<div class="pads">
          <button class="pad pad-a" data-act="point" data-side="A" aria-label="Point to ${team(m.teamA)}"><span class="plus">+</span><span class="who">${team(m.teamA)}</span></button>
          <button class="pad pad-b" data-act="point" data-side="B" aria-label="Point to ${team(m.teamB)}"><span class="plus">+</span><span class="who">${team(m.teamB)}</span></button>
        </div>`;

  const tools = m.status === 'completed'
    ? h`${manual ? h`<button class="btn btn-glass" data-act="resultModal" data-id="${m.id}">Correct</button>` : h`<button class="btn btn-glass" data-act="undo">${I.undo} Undo</button>`}
        <a class="btn btn-lime" href="#/day/${m.dayId}">Done</a>`
    : m.status === 'incomplete'
      ? h`<button class="btn btn-lime" data-act="reopenHere">Resume</button><a class="btn btn-glass" href="#/day/${m.dayId}">Back</a>`
      : h`<button class="btn btn-glass" data-act="undo" ${m.points ? '' : 'disabled'}>${I.undo} Undo</button>
          <button class="btn btn-glass" data-act="resultModal" data-id="${m.id}">Final score</button>`;

  paint(h`<div class="scoring photo">
    <div class="bar">
      <a class="circle glass" href="#/day/${m.dayId}" aria-label="Back">${I.back}</a>
      <span class="title">Court ${m.court} · ${S.view.day.formatInfo.short}${S.view.day.scorer ? h`<small>${I.scorer} ${S.view.day.scorer}</small>` : ''}</span>
      ${over ? h`<span style="width:44px"></span>` : h`<button class="circle glass" data-act="incomplete" aria-label="Stop match">${I.stop}</button>`}
    </div>
    <div class="board-glass glass" role="group" aria-label="Scoreboard">
      ${isSet ? h`<div class="sb-row sb-head"><span></span><span style="text-align:center">Games</span><span style="text-align:center">${st?.tiebreak && !over ? 'TB' : 'Point'}</span></div>` : ''}
      ${row('A', 0, m.teamA)}${row('B', 1, m.teamB)}
    </div>
    <div class="state-line">${state}</div>
    ${over ? '' : tip('score', 'Tap a side to give them the point', 'Undo fixes a slip. The square button stops the match.', true)}
    ${main}
    <div class="tools">${tools}</div>
  </div>`);
}

function applyServer(updated) {
  const i = S.view.matches.findIndex((m) => m.id === updated.id);
  if (i >= 0) S.view.matches[i] = updated;
}

function enqueue(path, body) {
  pending += 1;
  queue = queue
    .then(() => api(path, { method: 'POST', body }))
    .then((srv) => {
      pending -= 1;
      if (pending === 0) {
        applyServer(srv);
        if (S.route?.matchId === srv.id && location.hash.includes('/match/')) renderMatch();
      }
    })
    .catch(async (err) => {
      pending -= 1;
      toast(err.message, true);
      if (pending === 0) {
        await loadDay(S.route.id);
        if (location.hash.includes('/match/')) renderMatch();
      }
    });
}

ACT.point = ({ side }) => {
  const m = current();
  if (m.status === 'completed' || m.status === 'incomplete') return;
  const at = m.points.length;
  const st = replay(S.view.day.format, m.points + side);
  m.points += side;
  if (m.status === 'scheduled') m.status = 'live';
  if (st.winner) Object.assign(m, { status: 'completed', winner: st.winner, score: scoreFromState(st), source: 'live' });
  navigator.vibrate?.(st.winner ? [30, 60, 30] : 10); // haptic on the same frame as the visual change
  renderMatch();
  enqueue(`/api/matches/${m.id}/point`, { side, at });
};

ACT.undo = () => {
  const m = current();
  if (!m.points || m.source === 'manual') return;
  const at = m.points.length;
  m.points = m.points.slice(0, -1);
  if (m.status === 'completed') Object.assign(m, { status: 'live', winner: null, score: null, source: null });
  renderMatch();
  enqueue(`/api/matches/${m.id}/undo`, { at });
};

ACT.incomplete = async () => {
  const m = current();
  const note = prompt('Stop this match? It won’t count.\n\nReason (optional):', '');
  if (note === null) return;
  await queue;
  applyServer(await api(`/api/matches/${m.id}/incomplete`, { method: 'POST', body: { note } }));
  renderMatch();
};
ACT.reopenHere = async () => {
  applyServer(await api(`/api/matches/${current().id}/reopen`, { method: 'POST' }));
  renderMatch();
};

// ---------- Sheets: manual score & lineup ----------
function paintModal() {
  if (!S.modal) {
    $modal.innerHTML = '';
    document.body.style.overflow = '';
    return;
  }
  const fresh = !$modal.firstChild;
  document.body.style.overflow = 'hidden';
  const body = { result: resultSheet, lineup: lineupSheet }[S.modal.type]();
  $modal.innerHTML = part(h`<div class="overlay" data-act="overlay" style="${fresh ? '' : 'animation:none'}"><div class="sheet stack" role="dialog" aria-modal="true" style="${fresh ? '' : 'animation:none'}"><div class="grabber"></div>${body}</div></div>`);
}
ACT.overlay = (_, el, e) => {
  if (e.target === el) ACT.closeModal();
};
ACT.closeModal = () => {
  S.modal = null;
  paintModal();
};

ACT.resultModal = ({ id }) => {
  const m = S.view.matches.find((x) => x.id === +id);
  const format = S.view.day.format;
  let a = 0;
  let b = 0;
  let tb = ['', ''];
  if (m.score) ({ a, b } = m.score);
  else if (m.points) ({ a, b } = scoreFromState(replay(format, m.points)));
  if (m.score?.tb) tb = [...m.score.tb];
  S.modal = { type: 'result', id: m.id, a, b, tb, note: '', correcting: m.status === 'completed' };
  paintModal();
};

const sheetHead = (title) => h`<div class="row between"><h2>${title}</h2><button class="circle" data-act="closeModal" aria-label="Close">${I.x}</button></div>`;

function resultSheet() {
  const md = S.modal;
  const m = S.view.matches.find((x) => x.id === md.id);
  const format = S.view.day.format;
  const showTb = format === 'set' && Math.max(md.a, md.b) === 7 && Math.min(md.a, md.b) === 6;
  const check = validateResult(format, { a: md.a, b: md.b, tb: showTb ? md.tb.map((v) => (v === '' ? null : Number(v))) : null });
  const stepper = (k) => h`<div class="stepper"><button type="button" data-act="rs" data-k="${k}" data-d="-1" aria-label="Minus">−</button><output>${md[k]}</output><button type="button" data-act="rs" data-k="${k}" data-d="1" aria-label="Plus">+</button></div>`;
  return h`${sheetHead(md.correcting ? 'Correct score' : 'Final score')}
    <div class="card score-entry">
      <span class="team">${team(m.teamA)}</span>${stepper('a')}
      <span class="team">${team(m.teamB)}</span>${stepper('b')}
    </div>
    ${showTb ? h`<div class="row">
      <label class="field grow"><span>Tiebreak, ${first(m.teamA[0])}</span><input type="number" inputmode="numeric" min="0" value="${md.tb[0]}" data-bind="tb" data-i="0"></label>
      <label class="field grow"><span>Tiebreak, ${first(m.teamB[0])}</span><input type="number" inputmode="numeric" min="0" value="${md.tb[1]}" data-bind="tb" data-i="1"></label></div>` : ''}
    ${md.correcting ? h`<label class="field"><span>Reason (optional)</span><input type="text" maxlength="200" value="${md.note}" data-bind="rnote"></label>` : ''}
    <div id="resultCheck">${md.touched || check.ok ? resultCheck(check, m) : ''}</div>
    ${cta(md.correcting ? 'Save correction' : 'Save result', `data-act="saveResult" id="saveResultBtn" ${check.ok ? '' : 'disabled'}`)}`;
}

function resultCheck(check, m) {
  if (!check.ok) return h`<div class="error">${check.error}</div>`;
  return h`<div class="ok-note">${team(check.winner === 'A' ? m.teamA : m.teamB)} win ${formatScore(check.score, check.winner)}</div>`;
}

ACT.rs = ({ k, d }) => {
  const max = S.view.day.format === 'set' ? 7 : 40;
  S.modal[k] = Math.max(0, Math.min(max, S.modal[k] + Number(d)));
  S.modal.touched = true;
  paintModal();
};
BIND.tb = ({ i }, el) => {
  S.modal.tb[+i] = el.value;
  const md = S.modal;
  const m = S.view.matches.find((x) => x.id === md.id);
  const check = validateResult(S.view.day.format, { a: md.a, b: md.b, tb: md.tb.map((v) => (v === '' ? null : Number(v))) });
  document.getElementById('resultCheck').innerHTML = part(resultCheck(check, m));
  document.getElementById('saveResultBtn').disabled = !check.ok;
};
BIND.rnote = (_, el) => {
  S.modal.note = el.value;
};
ACT.saveResult = async () => {
  const md = S.modal;
  const showTb = S.view.day.format === 'set' && Math.max(md.a, md.b) === 7 && Math.min(md.a, md.b) === 6;
  const tb = showTb && md.tb.some((v) => v !== '') ? md.tb.map((v) => (v === '' ? null : Number(v))) : null;
  await queue;
  const updated = await api(`/api/matches/${md.id}/result`, { method: 'POST', body: { score: { a: md.a, b: md.b, tb }, note: md.note } });
  S.modal = null;
  paintModal();
  applyServer(updated);
  toast(md.correcting ? 'Corrected · logged' : 'Result saved');
  if (location.hash.includes('/match/')) renderMatch();
  else {
    await loadDay(S.view.day.id);
    renderDay();
  }
};

ACT.lineupModal = ({ id }) => {
  const m = S.view.matches.find((x) => x.id === +id);
  S.modal = { type: 'lineup', id: m.id, note: '', plan: { matches: [{ court: m.court, kind: m.kind, teamA: [...m.teamA], teamB: [...m.teamB], notes: [] }], suggested: false } };
  paintModal();
};

function lineupSheet() {
  const m = S.view.matches.find((x) => x.id === S.modal.id);
  const completed = m.status === 'completed';
  return h`${sheetHead(completed ? 'Correct players' : 'Edit match')}
    ${planEditor(S.modal.plan, 'modal', m.id)}
    ${completed ? h`<label class="field"><span>Reason (optional)</span><input type="text" maxlength="200" data-bind="lnote"></label>` : ''}
    ${cta('Save', 'data-act="saveLineup"')}
    ${m.status !== 'live' ? h`<button class="btn btn-danger btn-block" data-act="deleteMatch" data-id="${m.id}">Remove match</button>` : ''}`;
}
BIND.lnote = (_, el) => {
  S.modal.note = el.value;
};
ACT.saveLineup = async () => {
  const { court, kind, teamA, teamB } = S.modal.plan.matches[0];
  if ([...teamA, ...teamB].some((x) => x == null)) throw new Error('Fill every player slot');
  await api(`/api/matches/${S.modal.id}`, { method: 'PATCH', body: { court, kind, teamA, teamB, note: S.modal.note } });
  S.modal = null;
  paintModal();
  await loadDay(S.view.day.id);
  renderDay();
  toast('Match updated');
};

// ---------- First-run: intro, tips, checklist ----------
function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
function readLocal(k) { try { return localStorage.getItem(k); } catch { return null; } }
function seen(k) { try { return localStorage.getItem(`slice.seen.${k}`) === '1'; } catch { return true; } }
function markSeen(k) { store(`slice.seen.${k}`, '1'); }

// A one-time hint. Dismissed hints never come back (Settings can reset them).
function tip(key, title, text, onGlass = false) {
  if (seen(`tip.${key}`)) return '';
  return h`<div class="tip ${onGlass ? 'on-glass' : ''}" role="note"><div class="grow"><b>${title}</b><p>${text}</p></div>
    <button class="circle" data-act="dismissTip" data-key="${key}" aria-label="Dismiss tip">${I.x}</button></div>`;
}
ACT.dismissTip = ({ key }, el) => {
  markSeen(`tip.${key}`);
  const card = el.closest('.tip');
  card.classList.add('leaving');
  setTimeout(() => card.remove(), 220);
};

function checklist(days, players) {
  if (seen('checklist')) return '';
  const steps = [
    ['Add your players', players.filter((p) => !p.archived).length >= 4, '#/players'],
    ['Start a session', days.length > 0, '#/day/new'],
    ['Score a match', days.some((d) => d.completedCount > 0), days[0] ? `#/day/${days[0].id}` : '#/day/new'],
    ['Share the player link', seen('shared'), days[0] ? `#/day/${days[0].id}/setup` : '#/day/new'],
  ];
  const done = steps.filter((x) => x[1]).length;
  if (done === steps.length) return '';
  return h`<section class="card checklist" style="margin-top:16px">
    <div class="row between"><div><h2>Getting started</h2><p class="note">${done} of ${steps.length} done</p></div>
      <button class="btn btn-text btn-sm" data-act="hideChecklist">Hide</button></div>
    <div class="bar-track"><span style="width:${(done / steps.length) * 100}%"></span></div>
    <ol class="steps">${steps.map(([label, ok, href]) => h`<li class="${ok ? 'ok' : ''}"><a href="${href}"><span class="tick">${ok ? I.check : ''}</span>${label}${ok ? '' : h`<span class="go">${I.arrow}</span>`}</a></li>`)}</ol>
  </section>`;
}
ACT.hideChecklist = () => {
  markSeen('checklist');
  route();
};

const SLIDES = [
  ['intro-1.jpg', 'Run the day', 'Mark who showed up. Pick one format so every result compares.'],
  ['court-1.jpg', 'Fair matchups', 'Fewest matches play first. Partners and opponents rotate.'],
  ['intro-2.jpg', 'Every point', 'Big tap targets, deuce and tiebreaks handled, Undo for slips.'],
  ['potd.jpg;--pos:82% 50%', 'Crown the day', 'Live standings, a share link for players and a Player of the Day.'],
];
let introIndex = 0;

function renderIntro() {
  paint(h`<div class="intro" id="intro">
    <div class="intro-track" id="introTrack">${SLIDES.map(([img, title, text], i) => h`<section class="intro-slide photo" style="${photo(img)}" aria-hidden="${i !== introIndex}">
      <div class="intro-copy glass"><h1>${title}</h1><p>${text}</p></div>
    </section>`)}</div>
    <div class="intro-top">${wordmark()}<button class="btn btn-glass btn-sm" data-act="introDone">Skip</button></div>
    <div class="intro-nav">
      <button class="circle glass" data-act="introStep" data-d="-1" aria-label="Previous" id="introPrev">${I.back}</button>
      <div class="dots" id="introDots">${SLIDES.map((_, i) => h`<span class="${i === introIndex ? 'on' : ''}"></span>`)}</div>
      <button class="intro-next" data-act="introStep" data-d="1" aria-label="Next" id="introNext">${I.arrow}</button>
    </div>
  </div>`);
  setIntro(introIndex, false);
  bindIntroSwipe();
}

function setIntro(i, animate = true) {
  introIndex = Math.max(0, Math.min(SLIDES.length - 1, i));
  const track = document.getElementById('introTrack');
  if (!track) return;
  track.style.transition = animate ? '' : 'none';
  track.style.transform = `translateX(${-introIndex * 100}%)`;
  document.querySelectorAll('#introDots span').forEach((d, k) => d.classList.toggle('on', k === introIndex));
  document.querySelectorAll('.intro-slide').forEach((sl, k) => sl.setAttribute('aria-hidden', String(k !== introIndex)));
  document.getElementById('introPrev').style.visibility = introIndex ? 'visible' : 'hidden';
  const next = document.getElementById('introNext');
  next.classList.toggle('last', introIndex === SLIDES.length - 1);
  next.innerHTML = introIndex === SLIDES.length - 1 ? '<span>Get started</span>' : part(I.arrow);
}

ACT.introStep = ({ d }) => {
  if (+d > 0 && introIndex === SLIDES.length - 1) return ACT.introDone();
  setIntro(introIndex + Number(d));
};
ACT.introDone = () => {
  markSeen('intro');
  introIndex = 0;
  route();
};

// Swipe: the track follows the finger 1:1, resists at the ends, and on release
// the velocity decides the direction so a quick flick always turns the page.
function bindIntroSwipe() {
  const root = document.getElementById('intro');
  const track = document.getElementById('introTrack');
  let start = null;
  let samples = [];
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    start = { x: e.clientX, y: e.clientY, w: root.clientWidth };
    samples = [{ x: e.clientX, t: e.timeStamp }];
    track.style.transition = 'none';
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!start) return;
    let dx = e.clientX - start.x;
    const atEdge = (dx > 0 && introIndex === 0) || (dx < 0 && introIndex === SLIDES.length - 1);
    if (atEdge) dx = (dx * start.w * 0.55) / (start.w + 0.55 * Math.abs(dx)); // rubber band
    track.style.transform = `translateX(calc(${-introIndex * 100}% + ${dx}px))`;
    samples.push({ x: e.clientX, t: e.timeStamp });
    if (samples.length > 5) samples.shift();
  });
  const end = (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const a = samples[0];
    const v = (e.clientX - a.x) / Math.max(1, e.timeStamp - a.t); // px per ms
    const projected = dx + v * 180;
    start = null;
    let step = 0;
    if (Math.abs(projected) > root.clientWidth * 0.3) step = projected < 0 ? 1 : -1;
    setIntro(introIndex + step);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}

// ---------- Install (everyone in the group keeps Slice on their phone) ----------
let installEvent = null;
const UA = navigator.userAgent;
const isIOS = /iphone|ipad|ipod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(UA);
const isIOSSafari = isIOS && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(UA);
const installUrl = () => `${location.origin}/install`;
function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
const canInstall = () => !isStandalone() && (installEvent || isIOS);

function installTip() {
  if (!canInstall() || seen('tip.install')) return '';
  return h`<div class="tip install" role="note"><div class="grow"><b>Keep Slice on your phone</b>
    <p>${installEvent ? 'One tap and it opens like an app.' : 'Add it to your home screen in three taps.'}</p>
    ${installEvent ? h`<button class="btn btn-lime btn-sm" data-act="install" style="margin-top:10px">Install</button>` : h`<a class="btn btn-lime btn-sm" href="/install" style="margin-top:10px">Show me how</a>`}</div>
    <button class="circle" data-act="dismissTip" data-key="install" aria-label="Dismiss">${I.x}</button></div>`;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  document.querySelectorAll('.install-slot').forEach((el) => (el.innerHTML = part(installTip())));
  if (location.pathname === '/install') renderInstall();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  markSeen('tip.install');
  document.querySelectorAll('.install-slot').forEach((el) => (el.innerHTML = ''));
  if (location.pathname === '/install') renderInstall();
});

ACT.install = async () => {
  if (!installEvent) {
    location.href = '/install';
    return;
  }
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
};

// /install: one link for the group chat. Android gets a real Install button,
// iPhone gets the Share, Add to Home Screen steps.
const shareIcon = svg('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/>');
const moreIcon = svg('<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>');
const addIcon = svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>');

function installSteps(steps) {
  return h`<ol class="install-steps">${steps.map(([icon, text]) => h`<li><span class="ic">${icon}</span><span>${text}</span></li>`)}</ol>`;
}

function renderInstall() {
  const viewToken = readLocal('slice.viewToken');
  const openHref = viewToken ? `/v/${viewToken}` : '/';
  let body;
  if (isStandalone()) {
    body = h`<h2>Slice is on this phone</h2><p class="note">Open it from your home screen any time.</p>
      <a class="btn btn-lime cta btn-block" href="${openHref}"><span>Open Slice</span><span class="arrow">${I.arrow}</span></a>`;
  } else if (installEvent) {
    body = h`<h2>Install Slice</h2><p class="note">It sits on your home screen and opens full screen, like any app.</p>
      ${cta('Install', 'data-act="install"')}`;
  } else if (isIOS && !isIOSSafari) {
    body = h`<h2>Open this page in Safari</h2><p class="note">iPhone can only add apps to the home screen from Safari.</p>
      ${installSteps([[I.share, 'Copy this link'], [I.arrow, 'Paste it into Safari'], [addIcon, 'Follow the steps there']])}
      <button class="btn btn-dark btn-block" data-act="copyInstall">Copy link</button>`;
  } else if (isIOS) {
    body = h`<h2>Add Slice to your iPhone</h2>
      ${installSteps([[shareIcon, h`Tap <b>Share</b> in Safari’s toolbar`], [addIcon, h`Scroll and tap <b>Add to Home Screen</b>`], [I.check, h`Tap <b>Add</b>`]])}
      <p class="note">Slice then opens from its own icon, full screen.</p>`;
  } else if (isAndroid) {
    body = h`<h2>Add Slice to your phone</h2>
      ${installSteps([[moreIcon, h`Open Chrome’s <b>menu</b> (three dots)`], [addIcon, h`Tap <b>Install app</b> or <b>Add to Home screen</b>`], [I.check, h`Tap <b>Install</b>`]])}`;
  } else {
    body = h`<h2>Open this on your phone</h2><p class="note">Send yourself this link, open it on the phone, and follow the steps for iPhone or Android.</p>
      <div class="share-box">${installUrl()}</div>
      <button class="btn btn-dark btn-block" data-act="copyInstall">Copy link</button>`;
  }
  paint(h`<div class="install-page photo" style="${photo('hero-signin.jpg')}">
    <div class="head"><img src="/icon-192.png" alt="" width="84" height="84"><h1>Slice</h1><p class="sub">Sridhar’s Tennis Academy</p></div>
    <section class="sheet-card stack">${body}</section>
  </div>`);
}

ACT.shareInstall = async () => {
  const url = installUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Slice', text: 'Get Slice on your phone', url });
      return;
    } catch { /* fall back to copying */ }
  }
  ACT.copyInstall();
};

ACT.copyInstall = async () => {
  try {
    await navigator.clipboard.writeText(installUrl());
    toast('Link copied');
  } catch {
    prompt('Copy this link:', installUrl());
  }
};

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---------- Settings ----------
function renderSettings() {
  paint(h`${topbar({ back: '#/', title: 'Settings' })}
  <div class="wrap">
    <div class="section-head" style="margin-top:8px"><h2>Club password</h2></div>
    <form class="card stack" data-form="password">
      <label class="field"><span>Current</span><input type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span>New, 6 or more characters</span><input type="password" name="next" autocomplete="new-password" minlength="6" required></label>
      <div class="error" data-error hidden></div>
      <button class="btn btn-dark btn-block" type="submit">Change password</button>
      <p class="note">Everyone else signs in again with the new one.</p>
    </form>

    <div class="section-head"><h2>Help</h2></div>
    <div class="card list-actions">
      <button data-act="replayIntro">${I.cal}<span class="grow">Replay the intro</span>${I.arrow}</button>
      <button data-act="resetTips">${I.star}<span class="grow">Show tips and checklist again</span>${I.arrow}</button>
    </div>

    <div class="section-head"><h2>Get the app</h2></div>
    <div class="card list-actions">
      ${isStandalone() ? '' : h`<button data-act="install">${addIcon}<span class="grow">Add Slice to this phone</span>${I.arrow}</button>`}
      <button data-act="shareInstall">${I.share}<span class="grow">Send the install link to the group</span>${I.arrow}</button>
    </div>
    <div class="section-head"><h2>Account</h2></div>
    <div class="card list-actions">
      <button data-act="logout">${I.out}<span class="grow">Sign out of this device</span></button>
    </div>
    <p class="foot">Slice v1 · Sridhar’s Tennis Academy</p>
  </div>
  ${homeTabs('settings')}`);
}
ACT.replayIntro = () => {
  try { localStorage.removeItem('slice.seen.intro'); } catch {}
  introIndex = 0;
  go('#/');
};
ACT.resetTips = () => {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('slice.seen.') && k !== 'slice.seen.intro') localStorage.removeItem(k);
  } catch {}
  toast('Tips are back');
};

// ---------- Public, read-only player view ----------
async function showPublic(token) {
  const load = async () => {
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(token)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      S.view = data;
      renderPublic();
    } catch (err) {
      if (!S.view) paint(h`<div class="wrap" style="padding-top:40px">${empty('Link not found', err.message || 'Ask your organizer for a new link.')}</div>`);
    }
  };
  await load();
  pollTimer = setInterval(() => document.visibilityState === 'visible' && load(), 10000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load());
}

function renderPublic() {
  const live = byStatus('live');
  const next = byStatus('scheduled');
  const done = newestFirst(byStatus('completed'));
  const incomplete = byStatus('incomplete');
  paint(h`<div class="wrap">
    ${dayHero(true)}
    <div class="install-slot">${installTip()}</div>
    ${tip('viewer', 'Live view', 'Scores and standings update on their own.')}
    <div style="margin-top:16px">${potdCard(S.view.potd)}${ruleLine()}</div>
    ${live.length ? h`<div class="section-head"><h2>On court</h2><span class="pill live">${live.length} live</span></div><div class="stack">${live.map((m) => matchCard(m, false))}</div>` : ''}
    ${next.length ? h`<div class="section-head"><h2>Up next</h2><span class="count">${next.length}</span></div><div class="stack">${next.map((m) => matchCard(m, false))}</div>` : ''}
    <div class="section-head"><h2>Results</h2><span class="count">${done.length}</span></div>
    ${done.length ? h`<div class="stack">${done.map((m) => matchCard(m, false))}</div>` : empty('No results yet', '')}
    ${incomplete.length ? h`<div class="section-head"><h2>Stopped</h2><span class="count">Not counted</span></div><div class="stack">${incomplete.map((m) => matchCard(m, false))}</div>` : ''}
    <div class="section-head"><h2>Leaderboard</h2></div>
    ${board()}
    <p class="foot">Live · updated ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</p>
  </div>`);
}

route();
