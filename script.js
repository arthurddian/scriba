/* ==========================================================================
   SCRIBA — Personal Study Management System (v2)
   --------------------------------------------------------------------------
   Translations live in i18n.js (window.SCRIBA_I18N), loaded before this file.

   Sections
     1. Constants
     2. State, validation & persistence (localStorage)
     3. Helpers (dates, formatting, icons, i18n)
     4. UI primitives (toast, confirm dialog, forms)
     5. Renderers (dashboard, schedule, planner, focus, data)
     6. Pomodoro timer
     7. Actions (CRUD, sample data, import / export, theme, language, navigation)
     8. Event wiring & init
   ========================================================================== */
(() => {
  'use strict';

  const I18N = window.SCRIBA_I18N;
  if (!I18N) throw new Error('Scriba: i18n.js must be loaded before script.js');

  /* ======================================================================
     1. CONSTANTS
     ====================================================================== */
  const STORAGE_KEY = 'scriba.v1';
  const APP_ID = 'scriba';
  const PRIORITIES = ['high', 'medium', 'low'];
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
  const KINDS = ['task', 'class'];
  const MAX_ITEMS = 5000;            // per collection, enforced when loading/importing
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const VIEWS = ['dashboard', 'tasks', 'planner', 'focus', 'data'];
  const DEFAULT_POMO = { work: 25, short: 5, long: 15, cycles: 4, sound: true, auto: false };
  const POMO_PRESETS = { classic: { work: 25, short: 5, long: 15 }, deep: { work: 50, short: 10, long: 30 } };
  const TICK_MS = 250;
  const RING_LENGTH = 2 * Math.PI * 88;      // circumference of the timer ring (r = 88)
  const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

  /* ======================================================================
     2. STATE, VALIDATION & PERSISTENCE
     ====================================================================== */
  const defaultState = () => ({
    tasks: [],      // {id, title, subject, kind, date, time, priority, done}
    sessions: [],   // {id, subject, topic, date, start, end, done}
    goals: [],      // {id, title, targetHours, deadline, loggedMinutes, done}
    focusLog: [],   // {id, date, minutes, subject, at}
    settings: { theme: null, lang: 'pt', pomodoro: { ...DEFAULT_POMO } }
  });

  /** Sanitises any object (stored data or an imported file) into a valid state. */
  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;

    const list = (v) => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);   // cap: a hostile file can't flood storage
    const isObj = (v) => v && typeof v === 'object';
    const text = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const date = (v) => (typeof v === 'string' && RE_DATE.test(v) ? v : '');
    const time = (v) => (typeof v === 'string' && RE_TIME.test(v) ? v : '');
    const id = (v) => {
      const clean = typeof v === 'string' ? v.replace(/[^\w-]/g, '').slice(0, 40) : '';
      return clean || uid();
    };
    const int = (v, min, max, fallback) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };

    base.tasks = list(raw.tasks).filter(isObj).map((x) => ({
      id: id(x.id),
      title: text(x.title),
      subject: text(x.subject, 60),
      kind: KINDS.includes(x.kind) ? x.kind : 'task',
      date: date(x.date),
      time: time(x.time),
      priority: PRIORITIES.includes(x.priority) ? x.priority : 'medium',
      done: !!x.done
    })).filter((x) => x.title);

    base.sessions = list(raw.sessions).filter(isObj).map((x) => ({
      id: id(x.id),
      subject: text(x.subject, 60),
      topic: text(x.topic),
      date: date(x.date),
      start: time(x.start),
      end: time(x.end),
      done: !!x.done
    })).filter((x) => x.subject && x.date && x.start && x.end && toMinutes(x.end) > toMinutes(x.start));

    base.goals = list(raw.goals).filter(isObj).map((x) => ({
      id: id(x.id),
      title: text(x.title),
      targetHours: Math.min(1000, Math.max(0.5, Number(x.targetHours) || 1)),
      deadline: date(x.deadline),
      loggedMinutes: int(x.loggedMinutes, 0, 600000, 0),
      done: !!x.done
    })).filter((x) => x.title);

    base.focusLog = list(raw.focusLog).filter(isObj).map((x) => ({
      id: id(x.id),
      date: date(x.date),
      minutes: int(x.minutes, 1, 600, 25),
      subject: text(x.subject, 60),
      at: Number.isFinite(Number(x.at)) ? Number(x.at) : 0
    })).filter((x) => x.date);

    const s = isObj(raw.settings) ? raw.settings : {};
    const p = isObj(s.pomodoro) ? s.pomodoro : {};
    base.settings = {
      theme: s.theme === 'dark' || s.theme === 'light' ? s.theme : null,
      lang: s.lang === 'en' ? 'en' : 'pt',
      pomodoro: {
        work: int(p.work, 1, 180, DEFAULT_POMO.work),
        short: int(p.short, 1, 60, DEFAULT_POMO.short),
        long: int(p.long, 1, 90, DEFAULT_POMO.long),
        cycles: int(p.cycles, 2, 8, DEFAULT_POMO.cycles),
        sound: p.sound !== false,
        auto: p.auto === true
      }
    };
    return base;
  }

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch (err) {
      return defaultState();
    }
  }

  // Loaded inside init(), once every helper below has been defined.
  let state = defaultState();

  /** Persists the state. Returns false (and warns the user) on failure. */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      toast(t('toast.saveError'), { type: 'error' });
      return false;
    }
  }

  /* ======================================================================
     3. HELPERS
     ====================================================================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => (window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 9));

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /** Inline SVG icon from the sprite in index.html. */
  const icon = (name) => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

  /* ----- Dates & durations (always local time, never UTC) ----- */
  const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => toISODate(new Date());
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDaysISO = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISODate(d); };
  const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const locale = () => (state.settings.lang === 'en' ? 'en-US' : 'pt-BR');
  const fmtDate = (iso, opts) => new Intl.DateTimeFormat(locale(), opts).format(parseISO(iso));

  function fmtDuration(totalMin) {
    const min = Math.max(0, Math.round(totalMin));
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h && m) return `${h}h ${m}min`;
    if (h) return `${h}h`;
    return `${m}min`;
  }
  const sessionMinutes = (s) => toMinutes(s.end) - toMinutes(s.start);

  /* ----- i18n ----- */
  function t(key, vars) {
    const dict = I18N[state.settings.lang] || I18N.pt;
    let str = dict[key] ?? I18N.pt[key] ?? key;
    if (vars) str = str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return str;
  }
  const plural = (key, n) => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n });

  /** Translates every [data-i18n*] node (static text, placeholders, aria labels). */
  function translateTree(root = document) {
    $$('[data-i18n]', root).forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-placeholder]', root).forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$('[data-i18n-aria]', root).forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  }

  function applyTranslations() {
    const lang = state.settings.lang;
    document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';
    translateTree();
    $$('#langToggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    syncSessionTimes();
  }

  /* ======================================================================
     4. UI PRIMITIVES
     ====================================================================== */
  const els = {
    taskForm: $('#taskForm'),
    sessionForm: $('#sessionForm'),
    goalForm: $('#goalForm'),
    pomoForm: $('#pomoForm')
  };
  const allForms = () => [els.taskForm, els.sessionForm, els.goalForm];
  let currentView = 'dashboard';

  /** Small non-blocking notification, optionally with an action button (e.g. Undo). */
  function toast(message, { type = 'info', actionLabel, onAction, duration } = {}) {
    const host = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' error' : ''}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const span = document.createElement('span');
    span.textContent = message;
    el.append(span);

    let timerId;
    const close = () => { clearTimeout(timerId); el.remove(); };

    if (actionLabel) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', () => { if (onAction) onAction(); close(); });
      el.append(btn);
    }

    host.append(el);
    while (host.children.length > 3) host.firstElementChild.remove();
    timerId = setTimeout(close, duration ?? (actionLabel ? 6000 : 3500));
  }

  /** Accessible confirmation modal built on <dialog>. Resolves to true/false. */
  function confirmDialog(message) {
    const dlg = $('#confirmDialog');
    $('#confirmMessage').textContent = message;
    if (typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(message));
    return new Promise((resolve) => {
      const onClose = () => {
        dlg.removeEventListener('close', onClose);
        resolve(dlg.returnValue === 'confirm');
      };
      dlg.addEventListener('close', onClose);
      dlg.returnValue = '';
      dlg.showModal();
    });
  }

  /** Puts keyboard focus back on a control after the lists were re-rendered. */
  function refocus(selector) {
    const el = $(selector);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }

  /* ----- Generic form helpers (inputs are bound by their `name`) ----- */
  function readForm(form) {
    const data = {};
    for (const el of form.elements) if (el.name) data[el.name] = el.value.trim();
    return data;
  }

  function fillForm(form, obj) {
    for (const el of form.elements) {
      if (!el.name) continue;
      el.value = obj[el.name] == null ? '' : String(obj[el.name]);
    }
  }

  /** Switches a form between "add" and "edit" presentation. */
  /* ----- Collapsible forms (phones/tablets only; CSS ignores the state on desktop) ----- */
  function setFormOpen(form, open, { focus = false } = {}) {
    form.classList.toggle('is-collapsed', !open);
    const toggle = $('.form-toggle', form);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      const key = open ? 'form.close' : form.dataset.addTitle;
      const label = $('[data-i18n]', toggle);
      label.dataset.i18n = key;
      label.textContent = t(key);
      $('use', toggle).setAttribute('href', open ? '#i-x' : '#i-plus');
    }
    if (open && focus) {
      const first = $('[data-autofocus]', form);
      if (first) first.focus({ preventScroll: true });
    }
  }

  /** Opens the form that contains `el` (used by empty-state shortcuts). */
  function openFormOf(el) {
    const form = el && el.closest && el.closest('.form-card');
    if (form) setFormOpen(form, true);
  }

  function setupFormToggles() {
    allForms().forEach((form) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn form-toggle';
      btn.dataset.action = 'toggle-form';
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = `${icon('plus')}<span data-i18n="${form.dataset.addTitle}"></span>`;
      form.prepend(btn);
      setFormOpen(form, false);
    });
  }

  function setEditMode(form, editing) {
    form.dataset.editing = editing ? 'true' : 'false';
    const title = $('.form-title', form);
    const label = $('.form-submit [data-i18n]', form);
    const titleKey = editing ? form.dataset.editTitle : form.dataset.addTitle;
    const labelKey = editing ? 'common.save' : 'common.add';
    title.dataset.i18n = titleKey;
    title.textContent = t(titleKey);
    label.dataset.i18n = labelKey;
    label.textContent = t(labelKey);
    $('.form-submit use', form).setAttribute('href', editing ? '#i-check' : '#i-plus');
    $('.form-cancel', form).hidden = !editing;
  }

  const FORM_DEFAULTS = {
    taskForm: () => ({ date: todayISO(), kind: 'task', priority: 'medium' }),
    sessionForm: () => ({ date: todayISO() }),
    goalForm: () => ({ targetHours: 10 })
  };

  function resetForm(form) {
    form.reset();
    // NB: `form.id` would return the hidden <input name="id"> (named fields shadow
    // form properties), so the attribute is read explicitly.
    const makeDefaults = FORM_DEFAULTS[form.getAttribute('id')];
    const defaults = makeDefaults ? makeDefaults() : {};
    for (const [name, value] of Object.entries(defaults)) form.elements[name].value = value;
    setEditMode(form, false);
    if (form === els.sessionForm) syncSessionTimes();
    setFormOpen(form, false);
  }

  function startEdit(form, record) {
    fillForm(form, record);
    setEditMode(form, true);
    setFormOpen(form, true);
    if (form === els.sessionForm) syncSessionTimes();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const first = $('[data-autofocus]', form);
    if (first) first.focus({ preventScroll: true });
  }

  /**
   * Study-block times: end must be after start (native constraint validation),
   * and a live "duration" hint is shown under the fields.
   */
  function syncSessionTimes() {
    const { start, end } = els.sessionForm.elements;
    const both = start.value && end.value;
    const diff = both ? toMinutes(end.value) - toMinutes(start.value) : 0;
    end.setCustomValidity(both && diff <= 0 ? t('err.endAfterStart') : '');
    $('#sessionDuration').textContent = both && diff > 0 ? t('plan.duration', { time: fmtDuration(diff) }) : '';
  }

  /* ======================================================================
     5. RENDERERS
     ====================================================================== */
  const taskFilters = { status: 'all', kind: 'all', q: '' };

  function emptyHTML(iconName, titleKey, textKey, { tone = '', cta } = {}) {
    return `<div class="empty">
      <div class="empty-icon ${tone}" aria-hidden="true">${icon(iconName)}</div>
      <h4>${esc(t(titleKey))}</h4>
      <p>${esc(t(textKey))}</p>
      ${cta ? `<button type="button" class="btn btn-accent btn-sm" data-action="focus-field" data-target="${cta}">${icon('plus')}${esc(t('common.addFirst'))}</button>` : ''}
    </div>`;
  }

  const actionButtons = (kind, id, name) => `
    <button type="button" class="btn btn-sm btn-square" data-action="edit-${kind}" data-id="${esc(id)}" aria-label="${esc(t('common.edit'))}: ${esc(name)}" title="${esc(t('common.edit'))}">${icon('edit')}</button>
    <button type="button" class="btn btn-sm btn-square btn-danger" data-action="delete-${kind}" data-id="${esc(id)}" aria-label="${esc(t('common.delete'))}: ${esc(name)}" title="${esc(t('common.delete'))}">${icon('trash')}</button>`;

  const checkboxHTML = (action, id, checked, name) => `
    <label class="check">
      <input type="checkbox" data-action="${action}" data-id="${esc(id)}" ${checked ? 'checked' : ''} aria-label="${esc(t('item.markDone'))}: ${esc(name)}">
      <span class="check-box" aria-hidden="true"></span>
    </label>`;

  /** Groups records by date (undated last) → [[date, items[]], …] */
  function groupByDate(items) {
    const map = new Map();
    for (const it of items) {
      const key = it.date || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }

  function dateHeading(iso) {
    if (!iso) return esc(t('date.none'));
    const diff = Math.round((parseISO(iso) - parseISO(todayISO())) / 864e5);
    const label = fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'short' });
    const rel = { 0: 'date.today', 1: 'date.tomorrow', '-1': 'date.yesterday' }[diff];
    return rel ? `${esc(t(rel))} · ${esc(label)}` : esc(label);
  }

  const groupsHTML = (items, itemFn) => groupByDate(items).map(([date, group]) => `
    <section class="group">
      <h4 class="group-title">${dateHeading(date)}</h4>
      <ul class="list">${group.map((x) => itemFn(x)).join('')}</ul>
    </section>`).join('');

  /** Whether the "earlier history" folds are open (kept across re-renders). */
  const pastOpen = {};

  /**
   * Time-aware list: overdue items first, then today and upcoming, with finished
   * past items folded away so "today" is never buried under months of history.
   * `flat` (searching / "done" filter) keeps the plain chronological view.
   */
  function timelineHTML(items, itemFn, key, flat) {
    if (flat) return groupsHTML(items, itemFn);
    const today = todayISO();
    const isPast = (x) => x.date && x.date < today;
    const overdue = items.filter((x) => isPast(x) && !x.done);
    const past = items.filter((x) => isPast(x) && x.done);
    const current = items.filter((x) => !isPast(x));
    return [
      overdue.length ? `<section class="group group-overdue">
        <h4 class="group-title">${esc(t('list.overdueGroup'))} · ${overdue.length}</h4>
        <ul class="list">${overdue.map((x) => itemFn(x)).join('')}</ul>
      </section>` : '',
      groupsHTML(current, itemFn),
      past.length ? `<details class="past" data-key="${key}"${pastOpen[key] ? ' open' : ''}>
        <summary>${icon('clock')}<span>${esc(t('list.pastToggle', { n: past.length }))}</span></summary>
        ${groupsHTML(past.slice().reverse(), itemFn)}
      </details>` : ''
    ].join('');
  }

  /* ----- Tasks / classes ----- */
  function taskItemHTML(task, { compact = false } = {}) {
    const overdue = !task.done && task.date && task.date < todayISO();
    const badges = [
      task.kind === 'class' ? `<span class="badge badge-class">${icon('book')}${esc(t('kind.class'))}</span>` : '',
      task.subject ? `<span class="badge">${esc(task.subject)}</span>` : '',
      task.time ? `<span class="badge">${icon('clock')}${esc(task.time)}</span>` : '',
      `<span class="badge badge-${task.priority}">${esc(t('prio.' + task.priority))}</span>`,
      overdue ? `<span class="badge badge-warn">${esc(t('date.overdue'))}</span>` : ''
    ].join('');

    return `<li class="item p-${task.priority}${task.done ? ' is-done' : ''}${compact ? ' compact' : ''}">
      ${checkboxHTML('toggle-task', task.id, task.done, task.title)}
      <div>
        <p class="item-title">${esc(task.title)}</p>
        <div class="item-meta">${badges}</div>
      </div>
      ${compact ? '' : `<div class="item-actions">${actionButtons('task', task.id, task.title)}</div>`}
    </li>`;
  }

  const taskMatches = (x, { status, kind, q }) => {
    if (status === 'pending' && x.done) return false;
    if (status === 'done' && !x.done) return false;
    if (kind !== 'all' && x.kind !== kind) return false;
    const query = q.trim().toLowerCase();
    return !query || `${x.title} ${x.subject}`.toLowerCase().includes(query);
  };

  function renderTasks() {
    const filtered = state.tasks.filter((x) => taskMatches(x, taskFilters)).sort((a, b) =>
      (a.date || '9999').localeCompare(b.date || '9999') ||
      (a.time || '99:99').localeCompare(b.time || '99:99') ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      a.title.localeCompare(b.title));

    // Filter controls: pressed state + live counts per status
    $$('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(taskFilters[b.dataset.filter] === b.dataset.value)));
    ['all', 'pending', 'done'].forEach((status) => {
      const n = state.tasks.filter((x) => taskMatches(x, { ...taskFilters, status })).length;
      $(`[data-count="${status}"]`).textContent = state.tasks.length ? n : '';
    });

    $('#taskCount').textContent = plural('count.items', filtered.length);
    $('#clearDone').hidden = !state.tasks.some((x) => x.done);
    const host = $('#taskList');

    if (!state.tasks.length) {
      host.innerHTML = emptyHTML('book', 'tasks.emptyTitle', 'tasks.emptyText', { cta: 'taskTitle' });
    } else if (!filtered.length) {
      host.innerHTML = emptyHTML('search', 'tasks.emptyFilterTitle', 'tasks.emptyFilterText', { tone: 'is-solid' });
    } else {
      const flat = taskFilters.status === 'done' || taskFilters.q.trim() !== '';
      const html = timelineHTML(filtered, taskItemHTML, 'tasks', flat);
      host.innerHTML = html || emptyHTML('sparkles', 'tasks.allDoneTitle', 'tasks.allDoneText', { tone: 'is-solid' });
    }
  }

  /* ----- Study blocks ----- */
  function sessionItemHTML(s, { compact = false } = {}) {
    const overdue = !s.done && s.date < todayISO();
    return `<li class="item${s.done ? ' is-done' : ''}${compact ? ' compact' : ''}">
      ${checkboxHTML('toggle-session', s.id, s.done, s.subject)}
      <div>
        <p class="item-title">${esc(s.subject)}</p>
        ${s.topic ? `<p class="item-note">${esc(s.topic)}</p>` : ''}
        <div class="item-meta">
          ${compact ? `<span class="badge badge-class">${icon('calendar')}${esc(t('plan.blockBadge'))}</span>` : ''}
          <span class="badge">${icon('clock')}${esc(s.start)}–${esc(s.end)}</span>
          <span class="badge">${esc(fmtDuration(sessionMinutes(s)))}</span>
          ${overdue ? `<span class="badge badge-warn">${esc(t('date.overdue'))}</span>` : ''}
        </div>
      </div>
      ${compact ? '' : `<div class="item-actions">${actionButtons('session', s.id, s.subject)}</div>`}
    </li>`;
  }

  function renderSessions() {
    const sorted = [...state.sessions].sort((a, b) =>
      a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    const host = $('#sessionList');
    const summary = $('#sessionSummary');

    if (!sorted.length) {
      summary.hidden = true;
      host.innerHTML = emptyHTML('calendar', 'plan.emptyTitle', 'plan.emptyText', { tone: 'is-solid', cta: 'sessionSubject' });
      return;
    }
    const today = todayISO();
    const todayMin = sorted.filter((s) => s.date === today).reduce((sum, s) => sum + sessionMinutes(s), 0);
    const totalMin = sorted.reduce((sum, s) => sum + sessionMinutes(s), 0);
    summary.hidden = false;
    summary.textContent = t('plan.summary', { today: fmtDuration(todayMin), total: fmtDuration(totalMin) });
    host.innerHTML = timelineHTML(sorted, sessionItemHTML, 'sessions', false);
  }

  /* ----- Goals ----- */
  function goalItemHTML(g) {
    const targetMin = g.targetHours * 60;
    const pct = Math.min(100, Math.round((g.loggedMinutes / targetMin) * 100));
    const overdue = !g.done && g.deadline && g.deadline < todayISO();
    const adjust = (minutes, labelKey, variant = '') => `
      <button type="button" class="btn btn-sm ${variant}" data-action="goal-adjust" data-minutes="${minutes}" data-id="${esc(g.id)}"
        aria-label="${esc(t(labelKey))}: ${esc(g.title)}" ${minutes < 0 && g.loggedMinutes <= 0 ? 'disabled' : ''}>${esc(t(labelKey))}</button>`;
    return `<li class="item p-medium${g.done ? ' is-done' : ''}">
      ${checkboxHTML('toggle-goal', g.id, g.done, g.title)}
      <div>
        <p class="item-title">${esc(g.title)}</p>
        <div class="item-meta">
          ${g.deadline ? `<span class="badge">${icon('calendar')}${esc(t('goal.deadline', { date: fmtDate(g.deadline, { day: 'numeric', month: 'short', year: 'numeric' }) }))}</span>` : ''}
          ${overdue ? `<span class="badge badge-warn">${esc(t('date.overdue'))}</span>` : ''}
        </div>
        <div class="goal-line">
          <span>${esc(t('goal.progress', { logged: fmtDuration(g.loggedMinutes), target: fmtDuration(targetMin) }))}</span>
          <span>${pct}%</span>
        </div>
        <div class="progress sm" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(g.title)}">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="goal-adjust">
          ${adjust(-30, 'goal.sub')}
          ${adjust(30, 'goal.add', 'btn-accent')}
          ${adjust(60, 'goal.add60', 'btn-accent')}
        </div>
      </div>
      <div class="item-actions">${actionButtons('goal', g.id, g.title)}</div>
    </li>`;
  }

  function renderGoals() {
    const sorted = [...state.goals].sort((a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.deadline || '9999').localeCompare(b.deadline || '9999') ||
      a.title.localeCompare(b.title));
    $('#goalList').innerHTML = sorted.length
      ? `<ul class="list">${sorted.map(goalItemHTML).join('')}</ul>`
      : emptyHTML('target', 'goals.emptyTitle', 'goals.emptyText', { cta: 'goalTitle' });
  }

  /* ----- Dashboard ----- */
  /**
   * Minutes studied per day. A planned block and a Pomodoro for the same subject on the
   * same day are usually the same effort, so per (day, subject) the larger of the two counts.
   */
  function minutesByDay() {
    const perKey = new Map();
    const add = (kind, date, subject, minutes) => {
      const key = `${date}|${(subject || '').trim().toLowerCase()}`;
      const entry = perKey.get(key) || { focus: 0, blocks: 0 };
      entry[kind] += minutes;
      perKey.set(key, entry);
    };
    state.focusLog.forEach((x) => add('focus', x.date, x.subject, x.minutes));
    state.sessions.filter((x) => x.done).forEach((x) => add('blocks', x.date, x.subject, sessionMinutes(x)));
    const byDay = new Map();
    perKey.forEach((e, key) => {
      const date = key.split('|')[0];
      byDay.set(date, (byDay.get(date) || 0) + Math.max(e.focus, e.blocks));
    });
    return byDay;
  }

  function totalStudiedMinutes() {
    let total = 0;
    minutesByDay().forEach((v) => { total += v; });
    return total;
  }

  /** Consecutive days with study time, ending today (or yesterday if today is still empty). */
  function studyStreak() {
    const byDay = minutesByDay();
    let day = todayISO();
    if (!byDay.get(day)) day = addDaysISO(day, -1);
    let n = 0;
    while (byDay.get(day) > 0) { n += 1; day = addDaysISO(day, -1); }
    return n;
  }

  /* ----- "Next step" hero ----- */
  function nextUpItem() {
    const today = todayISO();
    const pending = [
      ...state.tasks.filter((x) => !x.done).map((x) => ({ kind: 'task', id: x.id, date: x.date || '', time: x.time || '', title: x.title, subject: x.subject })),
      ...state.sessions.filter((x) => !x.done).map((x) => ({ kind: 'session', id: x.id, date: x.date, time: x.start, title: x.subject + (x.topic ? ` — ${x.topic}` : ''), subject: x.subject }))
    ];
    const byTime = (a, b) => `${a.date || '9999'} ${a.time || '99:99'}`.localeCompare(`${b.date || '9999'} ${b.time || '99:99'}`);
    const pick = (fn) => pending.filter(fn).sort(byTime)[0];
    const now = pick((x) => x.date === today);
    if (now) return { ...now, tag: 'now' };
    const late = pick((x) => x.date && x.date < today);
    if (late) return { ...late, tag: 'overdue' };
    const next = pick((x) => !x.date || x.date > today);
    return next ? { ...next, tag: 'next' } : null;
  }

  function renderNextUp() {
    const host = $('#nextUp');
    if (!hasAnyData()) { host.hidden = true; return; }
    host.hidden = false;
    const n = nextUpItem();
    host.classList.toggle('is-clear', !n);
    if (!n) {
      host.innerHTML = `<div class="nextup-body">
        <p class="eyebrow">${esc(t('next.tagClear'))}</p>
        <h3 class="nextup-title">${esc(t('next.clearTitle'))}</h3>
        <p class="muted">${esc(t('next.clearText'))}</p></div>`;
      return;
    }
    const when = n.date && n.date !== todayISO() ? fmtDate(n.date, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
    const meta = [
      n.subject ? `<span class="badge">${esc(n.subject)}</span>` : '',
      when ? `<span class="badge">${icon('calendar')}${esc(when)}</span>` : '',
      n.time ? `<span class="badge">${icon('clock')}${esc(n.time)}</span>` : ''
    ].join('');
    host.innerHTML = `
      <div class="nextup-body">
        <p class="eyebrow">${esc(t('next.tag.' + n.tag))}</p>
        <h3 class="nextup-title">${esc(n.title)}</h3>
        ${meta ? `<div class="item-meta">${meta}</div>` : ''}
      </div>
      <div class="nextup-actions">
        <button type="button" class="btn btn-primary" data-action="next-done" data-kind="${n.kind}" data-id="${esc(n.id)}">${icon('check')}<span>${esc(t('next.done'))}</span></button>
        <button type="button" class="btn" data-action="next-focus" data-subject="${esc(n.subject || n.title)}">${icon('play')}<span>${esc(t('next.focus'))}</span></button>
      </div>`;
  }

  /* ----- Last 7 days bar chart ----- */
  function renderStudyBars() {
    const today = todayISO();
    const byDay = minutesByDay();
    const days = Array.from({ length: 7 }, (_, i) => addDaysISO(today, i - 6));
    const mins = days.map((d) => byDay.get(d) || 0);
    const max = Math.max(60, ...mins);
    const short = (m) => (m < 60 ? `${m}m` : `${(m / 60).toFixed(1).replace('.0', '')}h`);
    $('#studyBars').innerHTML = days.map((d, i) => {
      const label = `${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${mins[i] ? fmtDuration(mins[i]) : t('week.free')}`;
      return `<div class="bar${i === 6 ? ' is-today' : ''}${mins[i] ? '' : ' is-empty'}" role="img" aria-label="${esc(label)}" title="${esc(label)}">
        <span class="bar-val">${mins[i] ? short(mins[i]) : ''}</span>
        <span class="bar-col"><i style="height:${Math.round((mins[i] / max) * 100)}%"></i></span>
        <span class="bar-name">${esc(fmtDate(d, { weekday: 'short' }).replace('.', ''))}</span>
      </div>`;
    }).join('');
    const sum = mins.reduce((a, b) => a + b, 0);
    $('#studyBarsTotal').textContent = sum
      ? t('dash.lastTotal', { total: fmtDuration(sum), avg: fmtDuration(sum / 7) })
      : t('dash.lastEmpty');
  }

  const hasAnyData = () => state.tasks.length + state.sessions.length + state.goals.length + state.focusLog.length > 0;

  /** Progress per category (tasks / blocks / goals) under the main bar. */
  function breakdownHTML() {
    const rows = [
      { key: 'bd.tasks', done: state.tasks.filter((x) => x.done).length, total: state.tasks.length, cls: '' },
      { key: 'bd.blocks', done: state.sessions.filter((x) => x.done).length, total: state.sessions.length, cls: 'm-mid' },
      { key: 'bd.goals', done: state.goals.filter((x) => x.done).length, total: state.goals.length, cls: 'm-stripe' }
    ].filter((r) => r.total > 0);
    return rows.map((r) => `
      <div class="bd-row">
        <span>${esc(t(r.key))}</span>
        <span class="meter ${r.cls}"><i style="width:${Math.round((r.done / r.total) * 100)}%"></i></span>
        <span class="bd-val">${r.done}/${r.total}</span>
      </div>`).join('');
  }

  /** Today + the next 6 days: how many things are still pending each day. */
  function weekHTML() {
    const today = todayISO();
    return Array.from({ length: 7 }, (_, i) => {
      const iso = addDaysISO(today, i);
      const items = [...state.tasks, ...state.sessions].filter((x) => x.date === iso);
      const done = items.filter((x) => x.done).length;
      const pending = items.length - done;
      const pct = items.length ? Math.round((done / items.length) * 100) : 0;
      const label = `${fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' })}: ${pending ? plural('week.pending', pending) : t('week.free')}`;
      return `<div class="day${i === 0 ? ' is-today' : ''}${pending ? '' : ' is-empty'}" role="img" aria-label="${esc(label)}" title="${esc(label)}">
        <span class="day-name">${esc(fmtDate(iso, { weekday: 'short' }).replace('.', ''))}</span>
        <span class="day-num">${parseISO(iso).getDate()}</span>
        <span class="meter"><i style="width:${pct}%"></i></span>
        <span class="day-count">${pending || '–'}</span>
      </div>`;
    }).join('');
  }

  function renderDashboard() {
    const hour = new Date().getHours();
    $('#greeting').textContent = t(hour < 12 ? 'dash.morning' : hour < 18 ? 'dash.afternoon' : 'dash.evening');
    $('#dashDate').textContent = t('dash.dateLine', {
      date: fmtDate(todayISO(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    });
    $('#welcomeCard').hidden = hasAnyData();

    const today = todayISO();
    const goalsDone = state.goals.filter((g) => g.done).length;
    const overdue = state.tasks.filter((x) => !x.done && x.date && x.date < today).length;
    const focusToday = state.focusLog.filter((x) => x.date === today);

    $('#mPending').textContent = state.tasks.filter((x) => !x.done).length;
    $('#mPendingHint').textContent = overdue ? t('dash.overdueHint', { n: overdue }) : '';
    $('#mHours').textContent = fmtDuration(totalStudiedMinutes());
    $('#mGoals').textContent = `${goalsDone}/${state.goals.length}`;
    $('#mPomos').textContent = focusToday.length;
    $('#mPomosHint').textContent = focusToday.length
      ? t('dash.focusTime', { time: fmtDuration(focusToday.reduce((sum, x) => sum + x.minutes, 0)) }) : '';

    // Overall progress across tasks, study blocks and goals
    const total = state.tasks.length + state.sessions.length + state.goals.length;
    const done = state.tasks.filter((x) => x.done).length
      + state.sessions.filter((x) => x.done).length + goalsDone;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('#progressFill').style.width = `${pct}%`;
    $('#progressPct').textContent = `${pct}%`;
    $('#progressBar').setAttribute('aria-valuenow', String(pct));
    $('#progressText').textContent = total ? t('dash.progressText', { done, total }) : t('dash.progressEmpty');
    $('#progressBreakdown').innerHTML = breakdownHTML();

    // Today's agenda (tasks + study blocks), ordered by time
    const entries = [
      ...state.tasks.filter((x) => x.date === today).map((x) => ({ time: x.time, html: taskItemHTML(x, { compact: true }) })),
      ...state.sessions.filter((x) => x.date === today).map((x) => ({ time: x.start, html: sessionItemHTML(x, { compact: true }) }))
    ].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));

    $('#todayList').innerHTML = entries.length
      ? `<ul class="list">${entries.map((e) => e.html).join('')}</ul>`
      : emptyHTML('sunrise', 'dash.todayEmptyTitle', 'dash.todayEmptyText');

    $('#weekStrip').innerHTML = weekHTML();
    renderNextUp();
    renderStudyBars();

    const streak = studyStreak();
    $('#streak').hidden = streak < 1;
    if (streak) $('#streak').textContent = plural('dash.streak', streak);
  }

  /* ----- Focus log, settings & data summary ----- */
  function renderFocusLog() {
    const today = todayISO();
    const entries = state.focusLog.filter((x) => x.date === today).sort((a, b) => b.at - a.at);
    const minutes = entries.reduce((sum, x) => sum + x.minutes, 0);
    $('#focusSummary').textContent = `${plural('focus.sessions', entries.length)} · ${fmtDuration(minutes)}`;

    $('#focusLogList').innerHTML = entries.length
      ? `<ul class="list">${entries.map((x) => `
          <li class="item log">
            <div>
              <p class="item-title">${esc(x.subject || t('focus.noSubject'))}</p>
              <div class="item-meta"><span class="badge">${icon('clock')}${x.at ? esc(new Date(x.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })) : '--:--'}</span></div>
            </div>
            <span class="badge badge-medium">${esc(fmtDuration(x.minutes))}</span>
          </li>`).join('')}</ul>`
      : emptyHTML('timer', 'focus.logEmptyTitle', 'focus.logEmptyText', { tone: 'is-solid' });
  }

  function renderPomoSettings() {
    for (const el of els.pomoForm.elements) {
      if (!el.name || document.activeElement === el) continue;
      if (el.type === 'checkbox') el.checked = !!state.settings.pomodoro[el.name];
      else el.value = state.settings.pomodoro[el.name];
    }
  }

  const BACKUP_KEY = 'scriba.backup.v1';
  function renderDataStats() {
    let last = null;
    try { last = localStorage.getItem(BACKUP_KEY); } catch (err) { /* optional */ }
    $('#statBackup').textContent = last
      ? new Date(last).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
      : t('data.never');
    $('#statTasks').textContent = state.tasks.length;
    $('#statSessions').textContent = state.sessions.length;
    $('#statGoals').textContent = state.goals.length;
    $('#statFocus').textContent = state.focusLog.length;
    $('#statSize').textContent = `${(new Blob([JSON.stringify(state)]).size / 1024).toFixed(1)} KB`;
  }

  /** Autocomplete suggestions: every subject the user has used so far. */
  function renderSubjects() {
    const subjects = new Set([
      ...state.tasks.map((x) => x.subject),
      ...state.sessions.map((x) => x.subject),
      ...state.focusLog.map((x) => x.subject)
    ].filter(Boolean));
    $('#subjectList').innerHTML = [...subjects].sort((a, b) => a.localeCompare(b))
      .map((s) => `<option value="${esc(s)}"></option>`).join('');
  }

  function renderAll() {
    renderSubjects();
    renderDashboard();
    renderTasks();
    renderSessions();
    renderGoals();
    renderFocusLog();
    renderPomoSettings();
    renderDataStats();
    renderTimer();
  }

  /* ======================================================================
     6. POMODORO TIMER
     --------------------------------------------------------------------
     The countdown is derived from an absolute end timestamp, so it stays
     accurate even when the browser throttles timers in background tabs.
     ====================================================================== */
  const timer = { mode: 'work', total: 0, remaining: 0, running: false, endAt: 0, intervalId: null, cyclesDone: 0 };
  let audioCtx = null;

  const modeSeconds = (mode) => state.settings.pomodoro[mode] * 60;
  const mmss = (sec) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;

  function stopTicking() {
    clearInterval(timer.intervalId);
    timer.intervalId = null;
  }

  /* The running timer survives a reload: only mode/remaining/endAt are stored. */
  const TIMER_KEY = 'scriba.timer.v1';
  function persistTimer() {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify({
        mode: timer.mode, remaining: timer.remaining, running: timer.running,
        endAt: timer.endAt, cyclesDone: timer.cyclesDone, day: todayISO()
      }));
    } catch (err) { /* storage is optional */ }
  }

  function restoreTimer() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); } catch (err) { /* ignore */ }
    if (!saved || !['work', 'short', 'long'].includes(saved.mode)) return false;
    timer.cyclesDone = saved.day === todayISO() ? Math.max(0, Number(saved.cyclesDone) || 0) : 0;
    timer.mode = saved.mode;
    timer.total = modeSeconds(saved.mode);
    if (saved.running && saved.endAt > Date.now()) {
      timer.remaining = Math.min(timer.total, Math.ceil((saved.endAt - Date.now()) / 1000));   // never trust stored numbers
      timer.endAt = Date.now() + timer.remaining * 1000;
      timer.running = true;
      timer.intervalId = setInterval(tick, TICK_MS);
    } else if (saved.running) {
      // It finished while the page was closed: don't invent a log entry, just say so.
      timer.remaining = timer.total;
      toast(t('timer.expired'), { duration: 6000 });
    } else {
      timer.remaining = Math.min(timer.total, Math.max(0, Number(saved.remaining) || timer.total));
    }
    renderTimer();
    return true;
  }

  function setMode(mode) {
    stopTicking();
    timer.running = false;
    timer.mode = mode;
    timer.total = timer.remaining = modeSeconds(mode);
    persistTimer();
    renderTimer();
  }

  function startTimer() {
    if (timer.running) return;
    ensureAudio();
    timer.running = true;
    timer.endAt = Date.now() + timer.remaining * 1000;
    timer.intervalId = setInterval(tick, TICK_MS);
    persistTimer();
    renderTimer();
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    stopTicking();
    timer.running = false;
    persistTimer();
    renderTimer();
  }

  const toggleTimer = () => (timer.running ? pauseTimer() : startTimer());

  function resetTimer() {
    stopTicking();
    timer.running = false;
    timer.remaining = timer.total;
    persistTimer();
    renderTimer();
  }

  /** Skips to the next phase without logging the current one. */
  function skipTimer() {
    setMode(timer.mode === 'work' ? 'short' : 'work');
  }

  function tick() {
    timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    if (timer.remaining <= 0) completeTimer();
    else renderTimer();
  }

  function completeTimer() {
    stopTicking();
    timer.running = false;
    beep();

    let next;
    if (timer.mode === 'work') {
      state.focusLog.push({
        id: uid(),
        date: todayISO(),
        minutes: state.settings.pomodoro.work,
        subject: $('#focusSubject').value.trim().slice(0, 60),
        at: Date.now()
      });
      timer.cyclesDone += 1;
      save();
      next = timer.cyclesDone % state.settings.pomodoro.cycles === 0 ? 'long' : 'short';
      toast(t('toast.focusDone', { min: state.settings.pomodoro[next] }), { duration: 6000 });
    } else {
      next = 'work';
      toast(t('toast.breakDone'), { duration: 5000 });
    }

    setMode(next);
    renderFocusLog();
    renderDashboard();
    renderSubjects();
    renderDataStats();
    if (state.settings.pomodoro.auto) startTimer();
  }

  function renderTimer() {
    $('#timerCard').dataset.mode = timer.mode;
    $('#timerDisplay').textContent = mmss(timer.remaining);

    // Ring: fills up as the phase elapses
    const elapsed = Math.min(1, Math.max(0, timer.total ? 1 - timer.remaining / timer.total : 0));
    const ring = $('#ringFill');
    ring.style.strokeDashoffset = String(RING_LENGTH * (1 - elapsed));
    ring.style.opacity = elapsed > 0 ? '1' : '0';   // a zero-length dash can still paint a hairline

    $$('#modeTabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === timer.mode)));

    const paused = !timer.running && timer.remaining < timer.total;
    // The button's markup stays fixed: replacing its children while the mouse is down
    // (e.g. a settings field blurring into this click) would make the browser drop the click.
    $('#timerToggleIcon').setAttribute('href', timer.running ? '#i-pause' : '#i-play');
    $('#timerToggleLabel').textContent = t(timer.running ? 'focus.pause' : paused ? 'focus.resume' : 'focus.start');
    $('#timerPhase').textContent = t(timer.running ? 'phase.running' : paused ? 'phase.paused' : 'phase.ready');

    // Cycle dots: how many focus sessions are done in the current round
    const cycles = state.settings.pomodoro.cycles;
    const mod = timer.cyclesDone % cycles;
    const filled = mod === 0 && timer.cyclesDone > 0 && timer.mode === 'long' ? cycles : mod;
    const dots = $('#cycleDots');
    dots.innerHTML = Array.from({ length: cycles }, (_, i) => `<span class="dot${i < filled ? ' on' : ''}"></span>`).join('');
    dots.setAttribute('aria-label', t('focus.cycleAria', { n: filled, total: cycles }));

    // Show the countdown in the browser tab while running
    document.title = timer.running
      ? `${mmss(timer.remaining)} · ${t('mode.' + timer.mode)} — Scriba`
      : `Scriba — ${t('brand.tag')}`;
  }

  /* ----- Audio cue (Web Audio, no external files) ----- */
  function ensureAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (err) { /* audio is optional */ }
  }

  function beep() {
    if (!audioCtx || !state.settings.pomodoro.sound) return;
    try {
      const now = audioCtx.currentTime;
      [0, 0.28, 0.56].forEach((offset) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.22);
      });
    } catch (err) { /* ignore */ }
  }

  /* ======================================================================
     7. ACTIONS
     ====================================================================== */
  const COLLECTIONS = {
    task: { key: 'tasks', form: () => els.taskForm },
    session: { key: 'sessions', form: () => els.sessionForm },
    goal: { key: 'goals', form: () => els.goalForm }
  };

  const findById = (key, id) => state[key].find((x) => x.id === id);

  /** Deletes a record and offers an Undo through the toast. */
  function removeWithUndo(kind, id) {
    const { key, form } = COLLECTIONS[kind];
    const idx = state[key].findIndex((x) => x.id === id);
    if (idx < 0) return;
    const [item] = state[key].splice(idx, 1);
    if (form().elements.id.value === id) resetForm(form());
    save();
    renderAll();
    toast(t('toast.deleted'), {
      actionLabel: t('common.undo'),
      onAction: () => {
        state[key].splice(Math.min(idx, state[key].length), 0, item);
        save();
        renderAll();
      }
    });
  }

  /** Removes every completed task (undoable). */
  function clearDoneTasks() {
    const removed = state.tasks.filter((x) => x.done);
    if (!removed.length) return;
    state.tasks = state.tasks.filter((x) => !x.done);
    if (removed.some((x) => x.id === els.taskForm.elements.id.value)) resetForm(els.taskForm);
    save();
    renderAll();
    toast(plural('toast.cleared', removed.length), {
      actionLabel: t('common.undo'),
      onAction: () => { state.tasks.push(...removed); save(); renderAll(); }
    });
  }

  function adjustGoal(id, deltaMinutes) {
    const goal = findById('goals', id);
    if (!goal) return;
    const wasDone = goal.done;
    goal.loggedMinutes = Math.max(0, goal.loggedMinutes + deltaMinutes);
    goal.done = goal.loggedMinutes >= goal.targetHours * 60;
    save();
    renderAll();
    if (goal.done && !wasDone) toast(t('toast.goalDone'));
  }

  /** Fills a date input from a shortcut chip ("today", "tomorrow", "clear"…). */
  function setDateShortcut(inputId, offset) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = offset === '' ? '' : addDaysISO(todayISO(), Number(offset));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ----- Sample data ----- */
  function sampleData(lang) {
    const en = lang === 'en';
    const d = (n) => addDaysISO(todayISO(), n);
    const s = en
      ? { m: 'Mathematics', h: 'History', b: 'Biology', p: 'Physics' }
      : { m: 'Matemática', h: 'História', b: 'Biologia', p: 'Física' };
    return {
      tasks: [
        { title: en ? 'Solve calculus worksheet' : 'Resolver lista de cálculo', subject: s.m, kind: 'task', date: d(0), time: '', priority: 'high', done: false },
        { title: en ? 'Class: Cell Biology' : 'Aula: Biologia Celular', subject: s.b, kind: 'class', date: d(0), time: '14:00', priority: 'medium', done: false },
        { title: en ? 'Read chapter 4' : 'Ler o capítulo 4', subject: s.h, kind: 'task', date: d(1), time: '', priority: 'medium', done: false },
        { title: en ? 'Physics midterm' : 'Prova de Física', subject: s.p, kind: 'task', date: d(5), time: '08:00', priority: 'high', done: false },
        { title: en ? 'Organize notes' : 'Organizar anotações', subject: '', kind: 'task', date: d(-1), time: '', priority: 'low', done: true }
      ],
      sessions: [
        { subject: s.m, topic: en ? 'Derivatives — exercises' : 'Derivadas — exercícios', date: d(0), start: '16:00', end: '17:30', done: false },
        { subject: s.p, topic: en ? 'Review for the midterm' : 'Revisão para a prova', date: d(2), start: '19:00', end: '20:30', done: false },
        { subject: s.b, topic: en ? 'Summary of chapter 2' : 'Resumo do capítulo 2', date: d(-1), start: '10:00', end: '11:00', done: true }
      ],
      goals: [
        { title: en ? 'Review all of Physics' : 'Revisar toda a Física', targetHours: 10, deadline: d(6), loggedMinutes: 240, done: false },
        { title: en ? 'Finish the History reading list' : 'Concluir as leituras de História', targetHours: 6, deadline: '', loggedMinutes: 0, done: false }
      ]
    };
  }

  function loadSample() {
    const sample = sampleData(state.settings.lang);
    sample.tasks.forEach((x) => state.tasks.push({ id: uid(), ...x }));
    sample.sessions.forEach((x) => state.sessions.push({ id: uid(), ...x }));
    sample.goals.forEach((x) => state.goals.push({ id: uid(), ...x }));
    save();
    renderAll();
    toast(t('toast.sampleAdded'));
  }

  /* ----- Form submissions ----- */
  function submitTask(e) {
    e.preventDefault();
    const d = readForm(els.taskForm);
    if (!d.title) { els.taskForm.elements.title.focus(); return; }
    const record = {
      title: d.title,
      subject: d.subject,
      kind: KINDS.includes(d.kind) ? d.kind : 'task',
      date: RE_DATE.test(d.date) ? d.date : '',
      time: RE_TIME.test(d.time) ? d.time : '',
      priority: PRIORITIES.includes(d.priority) ? d.priority : 'medium'
    };
    const existing = d.id && findById('tasks', d.id);
    if (existing) Object.assign(existing, record);
    else state.tasks.push({ id: uid(), done: false, ...record });
    save();
    resetForm(els.taskForm);
    renderAll();
    toast(t(existing ? 'toast.updated' : 'toast.added'));
    els.taskForm.elements.title.focus({ preventScroll: true });   // quick consecutive entry
  }

  function submitSession(e) {
    e.preventDefault();
    const d = readForm(els.sessionForm);
    if (!d.subject) { els.sessionForm.elements.subject.focus(); return; }
    const record = { subject: d.subject, topic: d.topic, date: d.date, start: d.start, end: d.end };
    const existing = d.id && findById('sessions', d.id);
    if (existing) Object.assign(existing, record);
    else state.sessions.push({ id: uid(), done: false, ...record });
    save();
    resetForm(els.sessionForm);
    renderAll();
    toast(t(existing ? 'toast.updated' : 'toast.added'));
  }

  function submitGoal(e) {
    e.preventDefault();
    const d = readForm(els.goalForm);
    if (!d.title) { els.goalForm.elements.title.focus(); return; }
    const record = {
      title: d.title,
      targetHours: Math.min(1000, Math.max(0.5, Number(d.targetHours) || 1)),
      deadline: RE_DATE.test(d.deadline) ? d.deadline : ''
    };
    const existing = d.id && findById('goals', d.id);
    if (existing) {
      Object.assign(existing, record);
      if (existing.loggedMinutes >= existing.targetHours * 60) existing.done = true;
    } else {
      state.goals.push({ id: uid(), loggedMinutes: 0, done: false, ...record });
    }
    save();
    resetForm(els.goalForm);
    renderAll();
    toast(t(existing ? 'toast.updated' : 'toast.added'));
  }

  /** Pomodoro settings: clamp, persist, and refresh an untouched timer. */
  function changePomoSettings() {
    const pristine = !timer.running && timer.remaining === timer.total;
    const f = els.pomoForm.elements;
    const clamp = (name, min, max) => {
      const n = Math.round(Number(f[name].value));
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_POMO[name];
    };
    state.settings.pomodoro = {
      work: clamp('work', 1, 180),
      short: clamp('short', 1, 60),
      long: clamp('long', 1, 90),
      cycles: clamp('cycles', 2, 8),
      sound: f.sound.checked,
      auto: f.auto.checked
    };
    save();
    renderPomoSettings();
    if (pristine) setMode(timer.mode); else renderTimer();
  }

  function applyPomoPreset(name) {
    const preset = POMO_PRESETS[name];
    if (!preset) return;
    const pristine = !timer.running && timer.remaining === timer.total;
    state.settings.pomodoro = { ...state.settings.pomodoro, ...preset };
    save();
    renderPomoSettings();
    if (pristine) setMode(timer.mode); else renderTimer();
  }

  /* ----- Backup: export / import / reset ----- */
  function exportData() {
    const payload = { app: APP_ID, version: 1, exportedAt: new Date().toISOString(), data: state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scriba-backup-${todayISO()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (err) { /* optional */ }
    renderDataStats();
    toast(t('toast.exported'));
  }

  function afterDataReplaced() {
    allForms().forEach(resetForm);
    timer.cyclesDone = 0;
    setMode('work');
    renderAll();
  }

  async function importData(file) {
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('file too large');
      const parsed = JSON.parse(await file.text());
      const raw = parsed && typeof parsed === 'object' && parsed.data ? parsed.data : parsed;
      const looksValid = raw && typeof raw === 'object'
        && ['tasks', 'sessions', 'goals', 'focusLog'].some((k) => Array.isArray(raw[k]));
      if (!looksValid) throw new Error('invalid backup');

      const next = normalizeState(raw);
      if (!(await confirmDialog(t('confirm.import')))) return;

      next.settings.theme = state.settings.theme;   // keep this device's look & language
      next.settings.lang = state.settings.lang;
      state = next;
      save();
      afterDataReplaced();
      toast(t('toast.imported'));
    } catch (err) {
      toast(t('toast.importError'), { type: 'error' });
    } finally {
      $('#importFile').value = '';
    }
  }

  async function resetData() {
    if (!(await confirmDialog(t('confirm.reset')))) return;
    const fresh = defaultState();
    fresh.settings = state.settings;
    state = fresh;
    save();
    afterDataReplaced();
    toast(t('toast.reset'));
  }

  /* ----- Theme, language & navigation ----- */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = $('#themeToggle');
    btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
    $$('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', theme === 'dark' ? '#151515' : '#ffffff'));
  }

  function toggleTheme() {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.settings.theme);
    save();
  }

  function setLang(lang) {
    if (lang === state.settings.lang) return;
    state.settings.lang = lang;
    save();
    applyTranslations();
    renderAll();
  }

  function showView(name, { focusHeading = true } = {}) {
    if (!VIEWS.includes(name)) name = 'dashboard';
    currentView = name;
    VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== name; });
    $$('.tab').forEach((b) => b.setAttribute('aria-current', b.dataset.view === name ? 'page' : 'false'));
    try { history.replaceState(null, '', `#${name}`); } catch (err) { /* e.g. sandboxed file:// */ }
    window.scrollTo({ top: 0 });
    if (name !== 'focus') setZen(false);
    const viewEl = $(`#view-${name}`);
    viewEl.classList.remove('enter');
    void viewEl.offsetWidth;              // restart the staggered entrance
    viewEl.classList.add('enter');
    setTimeout(() => viewEl.classList.remove('enter'), 1000);
    if (focusHeading) $(`#view-${name} h2`).focus({ preventScroll: true });
    if (name === 'dashboard') renderDashboard();
  }

  /* ======================================================================
     8. EVENT WIRING & INIT
     ====================================================================== */
  function setZen(on) {
    $('#timerCard').classList.toggle('is-zen', on);
    document.body.classList.toggle('zen-open', on);
    $('#zenToggle').setAttribute('aria-pressed', String(on));
    if (on) $('#timerToggle').focus({ preventScroll: true });
  }

  /* ----- PWA: install button + offline service worker ----- */
  let installPrompt = null;
  function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => { installPrompt = null; $('#installBtn').hidden = true; });
  }

  function setupPWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();               // keep the browser's mini-bar away; offer our own button
      installPrompt = e;
      $('#installBtn').hidden = false;
    });
    window.addEventListener('appinstalled', () => { installPrompt = null; $('#installBtn').hidden = true; });
    // Service workers only run on https:// or localhost (not when opened as a local file)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode is optional */ });
    }
  }

  function openHelp() {
    const dlg = $('#helpDialog');
    if (!dlg.open) dlg.showModal();
  }

  function bindEvents() {
    // Navigation, language, theme
    $$('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    $$('#langToggle button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
    $('#themeToggle').addEventListener('click', toggleTheme);
    $('.brand').addEventListener('click', (e) => { e.preventDefault(); showView('dashboard'); });

    // Forms
    els.taskForm.addEventListener('submit', submitTask);
    els.sessionForm.addEventListener('submit', submitSession);
    els.goalForm.addEventListener('submit', submitGoal);
    allForms().forEach((form) => {
      $('.form-cancel', form).addEventListener('click', () => resetForm(form));
      form.addEventListener('keydown', (e) => { if (e.key === 'Escape' && form.dataset.editing === 'true') resetForm(form); });
    });
    els.sessionForm.elements.start.addEventListener('input', syncSessionTimes);
    els.sessionForm.elements.end.addEventListener('input', syncSessionTimes);

    // Task filters
    $('#filterSearch').addEventListener('input', (e) => { taskFilters.q = e.target.value; renderTasks(); });

    // Pomodoro
    $('#timerToggle').addEventListener('click', toggleTimer);
    $('#timerReset').addEventListener('click', resetTimer);
    $('#timerSkip').addEventListener('click', skipTimer);
    $('#modeTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (btn && btn.dataset.mode !== timer.mode) setMode(btn.dataset.mode);
    });
    els.pomoForm.addEventListener('change', changePomoSettings);
    els.pomoForm.addEventListener('submit', (e) => e.preventDefault());

    // Space starts / pauses the timer while the Focus tab is open
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || currentView !== 'focus' || e.repeat) return;
      if (e.target.closest('input, select, textarea, button, a, dialog, [contenteditable]')) return;
      e.preventDefault();
      toggleTimer();
    });

    // Zen (full-screen) timer
    $('#zenToggle').addEventListener('click', () => setZen(!$('#timerCard').classList.contains('is-zen')));

    // Global keyboard shortcuts (never while typing or with a dialog open)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#timerCard').classList.contains('is-zen')) { setZen(false); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest('input, select, textarea, [contenteditable]') || document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase();
      if (/^[1-5]$/.test(k)) { showView(VIEWS[Number(k) - 1]); return; }
      if (k === 'n') {
        e.preventDefault();
        showView('tasks', { focusHeading: false });
        setFormOpen(els.taskForm, true, { focus: true });
      } else if (k === '/') {
        e.preventDefault();
        showView('tasks', { focusHeading: false });
        $('#filterSearch').focus();
      } else if (k === 't') toggleTheme();
      else if (k === 'z' && currentView === 'focus') setZen(!$('#timerCard').classList.contains('is-zen'));
      else if (e.key === '?') openHelp();
    });

    // Backup
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); });
    $('#resetBtn').addEventListener('click', resetData);

    // Delegated buttons (lists, chips, filters, empty states…)
    document.addEventListener('click', (e) => {
      const filterBtn = e.target.closest('[data-filter]');
      if (filterBtn) {
        taskFilters[filterBtn.dataset.filter] = filterBtn.dataset.value;
        renderTasks();
        return;
      }

      const el = e.target.closest('[data-action]');
      if (!el || el.matches('input[type="checkbox"]')) return;
      const { action, id, target, field } = el.dataset;

      switch (action) {
        case 'goto':
          showView(target, { focusHeading: !field });
          if (field) { const f = document.getElementById(field); openFormOf(f); if (f) f.focus(); }
          break;
        case 'focus-field': {
          const f = document.getElementById(target);
          openFormOf(f);
          if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.focus({ preventScroll: true }); }
          break;
        }
        case 'help': openHelp(); break;
        case 'install': installApp(); break;
        case 'next-done': {
          const rec = findById(el.dataset.kind === 'session' ? 'sessions' : 'tasks', id);
          if (rec) { rec.done = true; save(); renderAll(); toast(t('toast.nextDone')); }
          break;
        }
        case 'next-focus':
          $('#focusSubject').value = String(el.dataset.subject || '').slice(0, 60);
          showView('focus', { focusHeading: false });
          break;
        case 'toggle-form': {
          const form = el.closest('.form-card');
          setFormOpen(form, form.classList.contains('is-collapsed'), { focus: true });
          break;
        }
        case 'set-date': setDateShortcut(target, el.dataset.offset); break;
        case 'pomo-preset': applyPomoPreset(el.dataset.preset); break;
        case 'load-sample': loadSample(); break;
        case 'clear-done': clearDoneTasks(); break;
        case 'edit-task': { const r = findById('tasks', id); if (r) startEdit(els.taskForm, r); break; }
        case 'edit-session': { const r = findById('sessions', id); if (r) startEdit(els.sessionForm, r); break; }
        case 'edit-goal': { const r = findById('goals', id); if (r) startEdit(els.goalForm, r); break; }
        case 'delete-task': removeWithUndo('task', id); break;
        case 'delete-session': removeWithUndo('session', id); break;
        case 'delete-goal': removeWithUndo('goal', id); break;
        case 'goal-adjust': {
          const selector = `[data-action="goal-adjust"][data-minutes="${el.dataset.minutes}"][data-id="${CSS.escape(id)}"]`;
          adjustGoal(id, Number(el.dataset.minutes));
          refocus(selector);
          break;
        }
        default: break;
      }
    });

    // Delegated checkboxes inside rendered lists (keyboard focus is preserved)
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.matches('input[type="checkbox"][data-action]')) return;
      const map = { 'toggle-task': 'tasks', 'toggle-session': 'sessions', 'toggle-goal': 'goals' };
      const key = map[el.dataset.action];
      const record = key && findById(key, el.dataset.id);
      if (!record) return;
      const hadFocus = document.activeElement === el;
      const host = el.closest('[id]') ? el.closest('#taskList, #sessionList, #goalList, #todayList') || document.body : document.body;
      const scope = host === document.body ? 'main' : `#${host.id}`;
      const selector = `${scope} input[data-action="${el.dataset.action}"][data-id="${CSS.escape(el.dataset.id)}"]`;
      record.done = el.checked;
      save();
      renderAll();
      if (hadFocus) {
        const again = $(selector);
        const hidden = !again || (again.closest('details.past') && !again.closest('details.past').open);
        // A finished past item folds away: keep keyboard users in the list instead of dropping to <body>.
        if (hidden) refocus(host.id ? `#${host.id} input[type="checkbox"][data-action]` : 'main input[type="checkbox"][data-action]');
        else refocus(selector);
      }
    });

    // Keep "today" fresh when the user comes back to the tab
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { renderDashboard(); renderTasks(); renderSessions(); renderFocusLog(); }
    });
  }

  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d && d.matches && d.matches('details.past')) pastOpen[d.dataset.key] = d.open;
  }, true);

  function init() {
    state = loadState();

    // Theme: saved preference, otherwise the system preference
    if (!state.settings.theme) {
      state.settings.theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(state.settings.theme);

    // Ask the browser not to evict our data under storage pressure (best effort)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (err) { /* optional */ }

    setupFormToggles();
    setupPWA();
    bindEvents();
    allForms().forEach(resetForm);
    applyTranslations();
    if (!restoreTimer()) setMode('work');
    renderAll();

    const initial = location.hash.replace('#', '');
    showView(VIEWS.includes(initial) ? initial : 'dashboard', { focusHeading: false });
  }

  init();
})();
