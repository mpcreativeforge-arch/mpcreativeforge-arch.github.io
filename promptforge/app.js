/* PromptForge for the web: the Android app's features in plain HTML/CSS/JS, MP Forge HUD look.
 * Everything is stored in this browser (localStorage), separately for each user.
 * The sign-in is only a lock for show: names and passwords are visible in this file. */
(function () {
  'use strict';

  // ---- Constants (mirroring the Android app) -------------------------------------------------

  // Sign-in for show only, see the note above.
  const USERS = [
    { id: 'natasa', name: 'Natasa', password: 'Natasa' },
    { id: 'michal', name: 'Michal', password: 'Michal' }
  ];

  const LANGS = [
    ['en', 'English'], ['cs', 'Čeština'], ['pl', 'Polski'], ['es', 'Español'], ['zh-CN', '中文（简体）'],
    ['hi', 'हिन्दी'], ['ar', 'العربية'], ['fr', 'Français'], ['pt', 'Português'], ['ru', 'Русский'], ['de', 'Deutsch']
  ];

  const OTHER = 'OTHER';
  const CATEGORIES = ['IMAGE', 'VIDEO', 'AUDIO', 'CHARACTER', 'VFX', 'ADVERTISING', 'STORY', OTHER];
  // Category accents are CSS variables (--cat-IMAGE …) so each mode has its own readable shades.
  const WARM = CATEGORIES.map(c => 'var(--cat-' + c + ')');
  const MODELS = ['Veo', 'Runway', 'Kling', 'Seedance', 'Luma', 'Midjourney', 'Flux', 'Sora', 'Gemini', 'Other'];

  const MAX_PROMPT = 100000, MAX_TITLE = 120, MAX_NOTE = 5000, MAX_MODEL = 40, MAX_CATEGORY = 24;
  const MAX_TAG = 32, MAX_TAGS = 20, MAX_TERMS = 6, RECENT = 5;
  const APP_ID = 'PROMPT FORGE', BRAND = 'MP CREATIVE FORGE', SCHEMA = 1, MAX_IMPORT = 64 * 1024 * 1024;
  const WEB_VERSION = 'WEB 1.1';

  const KEY = {
    session: 'promptforge.session',
    lang: 'promptforge.lang',
    theme: 'promptforge.theme',
    intro: 'promptforge.intro',
    vault: u => 'promptforge.vault.' + u,
    settings: u => 'promptforge.settings.' + u
  };

  // ---- Storage (never throws) ----------------------------------------------------------------

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    json(k) { try { return JSON.parse(this.get(k)); } catch (e) { return null; } }
  };
  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  // ---- Language ------------------------------------------------------------------------------

  const S = window.PF_STRINGS || { en: {} };
  const W = window.PF_WEB_STRINGS || { en: {} };
  let lang = 'en';

  function matchLang(tag) {
    if (!tag) return null;
    const exact = LANGS.find(l => l[0].toLowerCase() === tag.toLowerCase());
    if (exact) return exact[0];
    const base = tag.split('-')[0].toLowerCase();
    const loose = LANGS.find(l => l[0].split('-')[0].toLowerCase() === base);
    return loose ? loose[0] : null;
  }
  function systemLang() {
    const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (const tag of list) { const m = matchLang(tag); if (m) return m; }
    return 'en';
  }
  function setLang(choice) {
    lang = matchLang(choice) || systemLang();
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';
    // Scripts that join letters (Arabic) or build conjuncts (Devanagari) must not be letter-spaced.
    if (lang === 'ar' || lang === 'hi') html.dataset.script = 'joined'; else delete html.dataset.script;
  }
  function t(key, ...args) {
    const s = (S[lang] && S[lang][key]) || (W[lang] && W[lang][key]) || (S.en && S.en[key]) || (W.en && W.en[key]) || key;
    return s.replace(/\{(\d)\}/g, (m, i) => (args[i - 1] !== undefined ? String(args[i - 1]) : ''));
  }
  function catLabel(name) {
    const key = 'cat_' + String(name).toLowerCase();
    return CATEGORIES.includes(name) ? t(key) : name;
  }
  function catColor(name) { return CATEGORIES.includes(name) ? 'var(--cat-' + name + ')' : 'var(--gold)'; }
  function metaLine(category, model) {
    const label = catLabel(category).toUpperCase();
    return model && model.trim() ? label + ' • ' + model.toUpperCase() : label;
  }
  function fmtDate(ms) {
    try { return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)); }
    catch (e) { return new Date(ms).toLocaleString(); }
  }
  function fmtNum(n) { try { return n.toLocaleString(lang); } catch (e) { return String(n); } }

  // ---- Text tools (same rules as core/TextTools.kt) ------------------------------------------

  const WS = /\s+/g;
  const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  function safeTake(text, max) {
    if (text.length <= max) return text;
    let end = max;
    const code = text.charCodeAt(end - 1);
    if (end > 0 && code >= 0xD800 && code <= 0xDBFF) end--;
    return text.substring(0, end);
  }
  const normalizeForCompare = s => s.trim().replace(WS, ' ');
  function suggestTitle(text, max = 48) {
    const line = text.split('\n').map(l => l.trim()).find(l => l.length);
    if (!line) return '';
    const clean = line.replace(WS, ' ');
    if (clean.length <= max) return clean;
    return safeTake(clean, max - 1).trimEnd() + '…';
  }
  const cleanTitle = s => safeTake(s.replace(WS, ' ').trim(), MAX_TITLE);
  const normalizeModel = s => safeTake(s.replace(WS, ' ').trim(), MAX_MODEL);
  function normalizeTag(raw) {
    const v = raw.trim().replace(/^#+/, '').trim().toLowerCase().replace(WS, '-').replace(/,/g, '');
    return v ? safeTake(v, MAX_TAG) : null;
  }
  function normalizeCategory(raw) {
    const c = raw.replace(WS, ' ').trim().toUpperCase();
    return c ? safeTake(c, MAX_CATEGORY).trim() : null;
  }
  const sanitize = s => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/﻿/g, '').replace(CONTROL, '');

  /** Small LCS line diff, as LineDiff.kt. */
  function lineDiff(oldText, newText) {
    const a = oldText.split('\n'), b = newText.split('\n'), n = a.length, m = b.length;
    if (n * m > 2000000) return a.map(x => ['-', x]).concat(b.map(x => ['+', x]));
    const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push([' ', a[i]]); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push(['-', a[i++]]);
      else out.push(['+', b[j++]]);
    }
    while (i < n) out.push(['-', a[i++]]);
    while (j < m) out.push(['+', b[j++]]);
    return out;
  }

  // ---- State ---------------------------------------------------------------------------------

  let user = null;      // { id, name }
  let settings = null;  // per user
  let vault = null;     // per user: { prompts, categories, nextId }
  const filter = { query: '', fav: false, category: null, showAll: false };
  let editor = null;    // editor screen state
  let leaveGuard = false;

  const DEFAULT_SETTINGS = { crt: true, sounds: true, lang: '', defaultCategory: OTHER, defaultModel: '', theme: '' };

  function loadUser(u) {
    user = u;
    settings = Object.assign({}, DEFAULT_SETTINGS, store.json(KEY.settings(u.id)) || {});
    const v = store.json(KEY.vault(u.id));
    vault = v && Array.isArray(v.prompts) ? v : { prompts: [], categories: [], nextId: 1 };
    if (!Array.isArray(vault.categories)) vault.categories = [];
    if (!vault.nextId) vault.nextId = vault.prompts.reduce((mx, p) => Math.max(mx, p.id), 0) + 1;
    filter.query = ''; filter.fav = false; filter.category = null; filter.showAll = false;
    setLang(settings.lang);
    applyTheme(settings.theme || store.get(KEY.theme) || 'dark');
  }
  function saveSettings() { store.set(KEY.settings(user.id), JSON.stringify(settings)); }

  /** All-or-nothing write: the change is applied to a copy and kept only if the browser stored it. */
  function mutate(fn) {
    const draft = JSON.parse(JSON.stringify(vault));
    const result = fn(draft);
    if (!store.set(KEY.vault(user.id), JSON.stringify(draft))) {
      dialog({ title: t('dialog_error_title'), message: t('storage_full'), buttons: [{ text: t('action_ok') }] });
      throw new Error('storage');
    }
    vault = draft;
    return result;
  }

  // ---- Repository (same behaviour as PromptRepository.kt) ------------------------------------

  const byId = id => vault.prompts.find(p => p.id === id) || null;
  const allCategories = () => CATEGORIES.concat(vault.categories.filter(c => !CATEGORIES.includes(c)));

  function cleanDraft(d) {
    const title = cleanTitle(d.title) || suggestTitle(d.text) || 'Untitled prompt';
    const tags = [];
    for (const raw of d.tags) { const tg = normalizeTag(raw); if (tg && !tags.includes(tg)) tags.push(tg); }
    return {
      title, text: d.text,
      category: normalizeCategory(d.category) || OTHER,
      model: normalizeModel(d.model),
      tags: tags.slice(0, MAX_TAGS),
      note: safeTake(d.note, MAX_NOTE)
    };
  }
  function ensureCategory(v, name) {
    if (!CATEGORIES.includes(name) && !v.categories.includes(name)) v.categories.push(name);
  }
  function findDuplicates(text, excludeId) {
    const key = normalizeForCompare(text);
    return vault.prompts
      .filter(p => p.id !== excludeId && normalizeForCompare(p.text) === key)
      .sort((a, b) => a.createdAt - b.createdAt).slice(0, 5);
  }
  function createPrompt(d) {
    return mutate(v => {
      const c = cleanDraft(d), now = Date.now(), id = v.nextId++;
      v.prompts.push({
        id, title: c.title, text: c.text, category: c.category, model: c.model, note: c.note, favorite: false,
        createdAt: now, updatedAt: now, currentVersion: 1, tags: c.tags, versions: [{ n: 1, text: c.text, createdAt: now }]
      });
      ensureCategory(v, c.category);
      return id;
    });
  }
  function updatePrompt(id, d, asNewVersion) {
    mutate(v => {
      const p = v.prompts.find(x => x.id === id);
      if (!p) throw new Error('missing');
      const c = cleanDraft(d), now = Date.now();
      if (asNewVersion) {
        const next = Math.max(...p.versions.map(x => x.n)) + 1;
        p.versions.push({ n: next, text: c.text, createdAt: now });
        p.currentVersion = next;
      } else if (c.text !== p.text) {
        p.versions.find(x => x.n === p.currentVersion).text = c.text;
      }
      Object.assign(p, { title: c.title, text: c.text, category: c.category, model: c.model, note: c.note, tags: c.tags, updatedAt: now });
      ensureCategory(v, c.category);
    });
  }
  function duplicatePrompt(id) {
    return mutate(v => {
      const s = v.prompts.find(x => x.id === id), now = Date.now(), nid = v.nextId++;
      v.prompts.push(Object.assign({}, s, {
        id: nid, title: safeTake(t('title_copy_format', s.title), MAX_TITLE), favorite: false,
        createdAt: now, updatedAt: now, currentVersion: 1, tags: s.tags.slice(),
        versions: [{ n: 1, text: s.text, createdAt: now }]
      }));
      return nid;
    });
  }
  const deletePrompt = id => mutate(v => { v.prompts = v.prompts.filter(p => p.id !== id); });
  const setFavorite = (id, fav) => mutate(v => { v.prompts.find(p => p.id === id).favorite = fav; });
  function makeCurrent(id, n) {
    mutate(v => {
      const p = v.prompts.find(x => x.id === id), ver = p.versions.find(x => x.n === n);
      Object.assign(p, { text: ver.text, currentVersion: n, updatedAt: Date.now() });
    });
  }
  function restoreAsNew(id, n) {
    return mutate(v => {
      const p = v.prompts.find(x => x.id === id), old = p.versions.find(x => x.n === n), now = Date.now();
      const next = Math.max(...p.versions.map(x => x.n)) + 1;
      p.versions.push({ n: next, text: old.text, createdAt: now });
      Object.assign(p, { text: old.text, currentVersion: next, updatedAt: now });
      return next;
    });
  }
  function addCategory(raw) {
    const name = normalizeCategory(raw);
    if (!name) return null;
    mutate(v => ensureCategory(v, name));
    return name;
  }
  function deleteCategory(name) {
    if (CATEGORIES.includes(name)) return;
    mutate(v => {
      v.prompts.forEach(p => { if (p.category === name) p.category = OTHER; });
      v.categories = v.categories.filter(c => c !== name);
    });
    if (settings.defaultCategory === name) { settings.defaultCategory = OTHER; saveSettings(); }
  }

  /** Whitespace-separated terms are AND-ed; each matches title, text, category, model, note or a tag. */
  function query(f, limit) {
    const terms = f.query.trim().split(WS).filter(Boolean).slice(0, MAX_TERMS).map(s => s.toLowerCase());
    return vault.prompts
      .filter(p => !f.fav || p.favorite)
      .filter(p => !f.category || p.category === f.category)
      .filter(p => {
        if (!terms.length) return true;
        const hay = [p.title, p.text, p.category, catLabel(p.category), p.model, p.note].concat(p.tags).join('\n').toLowerCase();
        return terms.every(term => hay.includes(term));
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id)
      .slice(0, limit || 5000);
  }
  function categoryCounts() {
    const counts = {};
    vault.prompts.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
    const order = allCategories().concat(Object.keys(counts).filter(c => !allCategories().includes(c)));
    return order.filter(c => counts[c]).map(c => ({ name: c, count: counts[c] }));
  }

  // ---- Export / import (VaultCodec.kt, schemaVersion 1, compatible with the Android app) -----

  function exportVault() {
    const out = {
      app: APP_ID, brand: BRAND, schemaVersion: SCHEMA, exportedAt: new Date().toISOString(),
      promptCount: vault.prompts.length, categories: vault.categories.slice(),
      prompts: vault.prompts.slice().sort((a, b) => a.id - b.id).map(p => ({
        id: p.id, title: p.title, category: p.category, model: p.model, note: p.note, favorite: p.favorite,
        createdAt: p.createdAt, updatedAt: p.updatedAt, currentVersion: p.currentVersion, tags: p.tags.slice(),
        versions: p.versions.slice().sort((a, b) => a.n - b.n).map(x => ({ versionNumber: x.n, promptText: x.text, createdAt: x.createdAt }))
      }))
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'prompt-forge-vault-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(t('export_done', out.prompts.length));
  }

  class VaultError extends Error { constructor(key) { super(key); this.key = key; } }
  const isStr = x => typeof x === 'string';
  const isNum = x => typeof x === 'number' && isFinite(x);

  function parseVault(json) {
    let root;
    try { root = JSON.parse(json.replace(/^﻿/, '')); } catch (e) { throw new VaultError('vault_err_not_json'); }
    if (!root || typeof root !== 'object' || Array.isArray(root)) throw new VaultError('vault_err_not_json');
    if (root.app !== APP_ID) throw new VaultError('vault_err_not_vault');
    if (!isNum(root.schemaVersion)) throw new VaultError('vault_err_no_schema');
    const schema = Math.trunc(root.schemaVersion);
    if (schema < 1) throw new VaultError('vault_err_bad_schema');
    if (schema > SCHEMA) throw new VaultError('vault_err_newer');
    if (!Array.isArray(root.prompts)) throw new VaultError('vault_err_no_prompts');
    const now = Date.now(), prompts = [];
    let skipped = 0;
    for (const o of root.prompts) {
      const p = o && typeof o === 'object' && !Array.isArray(o) ? parsePrompt(o, now) : null;
      if (p) prompts.push(p); else skipped++;
    }
    const categories = [];
    (Array.isArray(root.categories) ? root.categories : []).forEach(c => {
      const n = isStr(c) ? normalizeCategory(c) : null;
      if (n && !categories.includes(n)) categories.push(n);
    });
    return { prompts, categories, skipped };
  }
  function parsePrompt(o, now) {
    const createdAt = isNum(o.createdAt) && o.createdAt > 0 ? o.createdAt : now;
    const updatedAt = isNum(o.updatedAt) && o.updatedAt > 0 ? o.updatedAt : createdAt;
    const versions = new Map();
    (Array.isArray(o.versions) ? o.versions : []).forEach(v => {
      if (!v || typeof v !== 'object' || !isNum(v.versionNumber) || !isStr(v.promptText)) return;
      const n = Math.trunc(v.versionNumber);
      if (n < 1 || !v.promptText.trim() || versions.has(n)) return;
      versions.set(n, { n, text: v.promptText, createdAt: isNum(v.createdAt) && v.createdAt > 0 ? v.createdAt : createdAt });
    });
    if (!versions.size) {
      if (!isStr(o.promptText) || !o.promptText.trim()) return null;
      versions.set(1, { n: 1, text: o.promptText, createdAt });
    }
    const list = Array.from(versions.values()).sort((a, b) => a.n - b.n);
    const req = isNum(o.currentVersion) ? Math.trunc(o.currentVersion) : null;
    const current = req !== null && versions.has(req) ? req : list[list.length - 1].n;
    const text = versions.get(current).text;
    const title = (isStr(o.title) && cleanTitle(o.title)) || suggestTitle(text) || 'Untitled prompt';
    const tags = [];
    (Array.isArray(o.tags) ? o.tags : []).forEach(x => { const tg = isStr(x) ? normalizeTag(x) : null; if (tg && !tags.includes(tg)) tags.push(tg); });
    return {
      title, text,
      category: (isStr(o.category) && normalizeCategory(o.category)) || OTHER,
      model: isStr(o.model) ? normalizeModel(o.model) : '',
      note: isStr(o.note) ? o.note : '',
      favorite: o.favorite === true,
      createdAt, updatedAt, currentVersion: current, tags: tags.slice(0, MAX_TAGS), versions: list
    };
  }
  /** Merge: existing prompts are never changed; one with the same text, title and category is skipped. */
  function importVault(parsed) {
    return mutate(v => {
      let added = 0, present = 0;
      parsed.categories.forEach(c => ensureCategory(v, c));
      for (const p of parsed.prompts) {
        const key = normalizeForCompare(p.text);
        if (v.prompts.some(x => normalizeForCompare(x.text) === key && x.title === p.title && x.category === p.category)) { present++; continue; }
        v.prompts.push(Object.assign({ id: v.nextId++ }, p));
        ensureCategory(v, p.category);
        added++;
      }
      return { added, present, invalid: parsed.skipped };
    });
  }

  // ---- DOM helpers ---------------------------------------------------------------------------

  const app = document.getElementById('app');
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }

  const ICONS = {
    settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    sun: 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z',
    moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    starOutline: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z'
  };
  function icon(name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }
  const iconBtn = (name, label, onClick, extra) =>
    h('button', Object.assign({ type: 'button', class: 'icon-btn', 'aria-label': label, title: label, onClick }, extra || {}),
      icon(name, name === 'back' ? 'flip' : null));
  const btn = (text, onClick, kind, extra) =>
    h('button', Object.assign({ type: 'button', class: 'btn ' + (kind || ''), onClick }, extra || {}), text);
  const micro = (text, color) => h('div', { class: 'micro', style: color ? { color } : null }, String(text).toUpperCase());
  // Brand lines are never translated and always read left to right.
  const brandLine = () => h('div', { class: 'micro', dir: 'ltr' }, t('brand_tagline'));
  function section(text, trailing) { return h('div', { class: 'section' }, h('h2', null, text), trailing || null); }
  function chip(text, pressed, onClick, accent, role) {
    return h('button', {
      type: 'button', class: 'chip', 'aria-pressed': role === 'button' ? null : String(!!pressed), onClick,
      style: accent ? { '--accent': accent } : null
    }, text);
  }
  function panel(...kids) { return h('div', { class: 'panel' }, h('div', { class: 'in' }, kids)); }
  function emptyState(title, msg) {
    return panel(h('div', { class: 'empty' }, h('div', { class: 'card-title' }, title), h('div', { class: 'small' }, msg)));
  }
  function field(label, control, hint) {
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    control.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label),
      h('div', { class: 'input' }, h('div', { class: 'in' }, control)), hint || null);
  }
  function topbar(title, onBack, trailing) {
    return h('div', { class: 'topbar' }, iconBtn('back', t('action_back'), onBack), h('h1', null, title), trailing || null);
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.remove('hide');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hide'), 2600);
  }

  /** HUD dialog. buttons: [{ text, kind, onClick, keepOpen }]. Returns a close function. */
  function dialog(opts) {
    const prevFocus = document.activeElement;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
      h('div', { class: 'in' },
        h('h2', null, opts.title),
        opts.message ? h('p', null, opts.message) : null,
        opts.body || null,
        h('div', { class: 'list-opt' }, (opts.buttons || []).map(b =>
          btn(b.text, () => { if (!b.keepOpen) close(); if (b.onClick) b.onClick(close); }, (b.kind || '') + ' block')))));
    const back = h('div', { class: 'dialog-back', onClick: e => { if (e.target === back) close(); } }, box);
    document.body.appendChild(back);
    document.addEventListener('keydown', onKey);
    const first = box.querySelector('input,textarea,select') || box.querySelector('.btn');
    if (first) first.focus();
    return close;
  }

  // ---- Sounds, CRT ---------------------------------------------------------------------------

  const sounds = { save: new Audio('assets/vault_save.mp3'), dial: new Audio('assets/vault_dial.mp3') };
  Object.values(sounds).forEach(a => { a.preload = 'auto'; });
  function play(name) {
    if (!settings || !settings.sounds) return;
    try { const a = sounds[name]; a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }
  function applyCrt() { document.getElementById('crt').hidden = !!settings && !settings.crt; }

  // Dark: the HUD with the CRT effect. Light: clean ochre paper, no CRT (switched off in CSS).
  const isLight = () => document.documentElement.dataset.theme === 'light';
  function applyTheme(theme) {
    if (theme === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#e8d9b5' : '#050403';
    applyCrt();
  }
  function setTheme(theme) {
    store.set(KEY.theme, theme);
    if (settings) { settings.theme = theme; saveSettings(); }
    applyTheme(theme);
    document.querySelectorAll('.theme-btn').forEach(updateThemeBtn);
  }
  function updateThemeBtn(b) {
    const label = t(isLight() ? 'theme_to_dark' : 'theme_to_light');
    b.setAttribute('aria-label', label); b.title = label;
    b.replaceChildren(icon(isLight() ? 'moon' : 'sun'));
  }
  function themeBtn() {
    const b = h('button', { type: 'button', class: 'icon-btn theme-btn', onClick: () => setTheme(isLight() ? 'dark' : 'light') });
    updateThemeBtn(b);
    return b;
  }

  // ---- Clipboard & share ---------------------------------------------------------------------

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    const ta = h('textarea', { style: { position: 'fixed', top: '-1000px', opacity: '0' } });
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  async function sharePrompt(p) {
    if (navigator.share) {
      try { await navigator.share({ title: p.title, text: p.text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (await copyText(p.text)) toast(t('copied')); else toast(t('copy_failed'));
  }

  // ---- Router --------------------------------------------------------------------------------

  function go(hash, replace) {
    if (replace) location.replace(hash); else location.hash = hash;
  }
  function route() {
    const m = location.hash.replace(/^#\/?/, '').split('/');
    return { name: m[0] || 'home', id: m[1] ? Number(m[1]) : 0, sub: m[2] || '' };
  }
  function render() {
    window.scrollTo(0, 0);
    leaveGuard = false;
    if (!user) return renderLogin();
    const r = route();
    app.replaceChildren(userBar());
    if (r.name === 'new') renderEditor(0);
    else if (r.name === 'edit') renderEditor(r.id);
    else if (r.name === 'p' && r.sub === 'versions') renderVersions(r.id);
    else if (r.name === 'p') renderDetail(r.id);
    else if (r.name === 'settings') renderSettings();
    else renderHome();
    app.appendChild(footer());
    document.title = 'PromptForge';
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', e => { if (leaveGuard) { e.preventDefault(); e.returnValue = ''; } });

  // ---- Login ---------------------------------------------------------------------------------

  function renderLogin() {
    setLang(store.get(KEY.lang) || '');
    applyTheme(store.get(KEY.theme) || 'dark');
    const name = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const err = h('p', { class: 'err', role: 'alert' });
    const card = panel(
      h('div', { class: 'micro', style: { color: 'var(--gold)' } }, t('login_title').toUpperCase()),
      field(t('login_user'), name),
      field(t('login_pass'), pass),
      err,
      btn(t('login_submit'), null, 'primary block', { type: 'submit' })
    );
    const langSel = h('select', { 'aria-label': t('settings_language'), onChange: e => { store.set(KEY.lang, e.target.value); renderLogin(); } },
      h('option', { value: '' }, t('language_system')),
      LANGS.map(([tag, n]) => h('option', { value: tag }, n)));
    langSel.value = store.get(KEY.lang) || '';
    const form = h('form', {
      class: 'login', autocomplete: 'on', onSubmit: e => {
        e.preventDefault();
        const u = USERS.find(x => fold(x.name) === fold(name.value) && x.password === pass.value);
        if (!u) {
          err.textContent = t('login_error');
          card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
          pass.value = ''; pass.focus();
          return;
        }
        store.set(KEY.session, u.id);
        loadUser(u);
        if (location.hash && location.hash !== '#/') go('#/', true);
        render();
      }
    },
      h('img', { class: 'logo', src: 'assets/mp_creative_forge_logo.png', alt: 'MP CREATIVE FORGE' }),
      h('div', { class: 'brandline' }, h('h1', { class: 'brand', dir: 'ltr' }, 'PROMPTFORGE'), brandLine()),
      card,
      h('div', { class: 'tools' }, h('div', { class: 'input lang-pick' }, h('div', { class: 'in' }, langSel)), themeBtn())
    );
    app.replaceChildren(form, footer());
    name.focus();
  }
  function footer() {
    return h('footer', { class: 'site-foot', dir: 'ltr' }, '© ' + new Date().getFullYear() + ' MICROVISION s.r.o.');
  }
  // Names compare without case or accents, so "natasa", "Nataša" and "NATASA" all work.
  const fold = s => s.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function userBar() {
    return h('div', { class: 'userbar' }, h('div', { class: 'inner' },
      h('div', { class: 'who' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), t('user_label').toUpperCase() + ': ', h('b', null, user.name.toUpperCase())),
      themeBtn(),
      btn(t('logout'), logout, 'text')));
  }
  function logout() {
    const doIt = () => { store.del(KEY.session); user = settings = vault = null; editor = null; go('#/', true); render(); };
    if (leaveGuard) {
      dialog({ title: t('dialog_discard_title'), message: t('dialog_discard_msg'), buttons: [
        { text: t('action_discard'), kind: 'danger', onClick: doIt }, { text: t('action_keep_editing') }] });
    } else doIt();
  }

  // ---- Home ----------------------------------------------------------------------------------

  function gauge(count) {
    const NS = 'http://www.w3.org/2000/svg', w = 220, c = 110;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 220 220'); svg.setAttribute('aria-hidden', 'true');
    const x = (v, mirror) => ((mirror ? 1 - v : v) * w).toFixed(1);
    const bracket = mirror => 'M' + [[0.04, 0.10], [0.40, 0.10], [0.34, 0.23], [0.17, 0.23], [0.17, 0.77], [0.34, 0.77], [0.40, 0.90], [0.04, 0.90]]
      .map(([px, py]) => x(px, mirror) + ' ' + (py * w).toFixed(1)).join(' L') + ' Z';
    let ticks = '';
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0, a = i * 6 * Math.PI / 180, outer = 0.29 * w, inner = outer - (major ? 0.04 : 0.022) * w;
      const col = WARM[Math.floor(i * WARM.length / 60)];
      ticks += `<line x1="${(c + outer * Math.sin(a)).toFixed(2)}" y1="${(c - outer * Math.cos(a)).toFixed(2)}" x2="${(c + inner * Math.sin(a)).toFixed(2)}" y2="${(c - inner * Math.cos(a)).toFixed(2)}" style="stroke:${col}" stroke-opacity="${major ? 1 : 0.7}" stroke-width="${major ? 1.5 : 1}" stroke-linecap="round"/>`;
    }
    svg.innerHTML =
      '<defs><linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--metal-1)"/><stop offset=".5" style="stop-color:var(--metal-2)"/><stop offset="1" style="stop-color:var(--metal-3)"/></linearGradient></defs>' +
      `<path d="${bracket(false)}" fill="url(#metal)"/><path d="${bracket(true)}" fill="url(#metal)"/>` +
      `<circle cx="${c}" cy="${c}" r="${0.315 * w}" style="fill:var(--gauge-disc)"/>` +
      `<circle cx="${c}" cy="${c}" r="${0.305 * w}" fill="none" style="stroke:var(--gold)" stroke-width="1.5"/>` +
      `<g class="ring">${ticks}</g>` +
      `<circle cx="${c}" cy="${c}" r="${0.225 * w}" fill="none" style="stroke:var(--gold)" stroke-opacity=".8" stroke-width="1"/>`;
    const el = h('div', { class: 'gauge', role: 'img', 'aria-label': count + ' ' + t('home_prompts_label') }, svg,
      h('div', { class: 'count' }, h('b', null, String(count)), micro(t('home_prompts_label'))));
    // The dial turns once and settles each time the home screen appears, with the ratchet sound.
    requestAnimationFrame(() => { el.classList.add('spin'); play('dial'); });
    return el;
  }

  function promptCard(p, onChanged) {
    const open = () => go('#/p/' + p.id);
    const star = favStar(p, onChanged);
    const tags = p.tags.length ? h('div', { class: 'small ellipsis', style: { color: 'var(--text-faint)', marginTop: '6px' } }, p.tags.map(x => '#' + x).join('  ')) : null;
    const preview = p.text.slice(0, 220).replace(/\n/g, ' ');
    return h('div', { class: 'card', role: 'link', tabindex: '0', onClick: open, onKeydown: e => { if (e.key === 'Enter') open(); } },
      h('div', { class: 'card-body' },
        h('div', { style: { flex: '1', minWidth: '0' } },
          micro(metaLine(p.category, p.model), catColor(p.category)),
          h('div', { class: 'card-title clamp2', style: { marginTop: '4px' } }, p.title),
          preview.trim() ? h('div', { class: 'small clamp2', style: { color: 'var(--text-dim)', marginTop: '4px' } }, preview) : null,
          tags),
        star));
  }
  function favStar(p, onChanged) {
    const label = p.favorite ? t('fav_remove_cd') : t('fav_add_cd');
    return h('button', {
      type: 'button', class: 'icon-btn' + (p.favorite ? '' : ' star-off'), 'aria-label': label, title: label, 'aria-pressed': String(p.favorite),
      onClick: e => {
        e.stopPropagation();
        setFavorite(p.id, !p.favorite);
        toast(t(p.favorite ? 'fav_removed' : 'fav_added'));
        onChanged();
      }
    }, icon(p.favorite ? 'star' : 'starOutline'));
  }

  function renderHome() {
    const screen = h('main', { class: 'screen stack' });
    const content = h('div', { class: 'stack' });
    const search = h('input', { type: 'search', placeholder: t('home_search_hint'), value: filter.query, enterkeyhint: 'search' });
    const clear = iconBtn('close', t('home_clear_search'), () => { search.value = ''; filter.query = ''; clear.hidden = true; refresh(); search.focus(); });
    clear.hidden = !filter.query;
    let debounce = 0;
    search.addEventListener('input', () => {
      clear.hidden = !search.value;
      clearTimeout(debounce);
      debounce = setTimeout(() => { filter.query = search.value; refresh(); }, 120);
    });
    search.addEventListener('keydown', e => { if (e.key === 'Escape') { search.value = ''; filter.query = ''; clear.hidden = true; refresh(); } });
    const searchField = field(t('home_search_label'), search);
    searchField.querySelector('.in').appendChild(clear);

    const gaugeSlot = h('div', { class: 'gauge-wrap' }, micro(t('home_your_vault')), h('div', { style: { height: '4px' } }), gauge(vault.prompts.length));

    append(screen, [
      h('header', { class: 'home-head' },
        h('img', { class: 'mark', src: 'assets/logo_mp_mark.png', alt: 'MP CREATIVE FORGE' }),
        h('div', { class: 'center' }, h('h1', { class: 'brand ellipsis', dir: 'ltr' }, 'PROMPTFORGE'), brandLine()),
        h('div', { class: 'end' }, iconBtn('settings', t('action_settings'), () => go('#/settings')))),
      gaugeSlot,
      searchField,
      btn(t('action_new_prompt'), () => go('#/new'), 'primary block'),
      content
    ]);
    app.appendChild(screen);

    function refresh() {
      // "View all" opens the full list (the browse view) without any filter.
      const active = filter.showAll || filter.query.trim() !== '' || filter.fav || filter.category !== null;
      content.replaceChildren(...(active ? browse() : dashboard()).flat());
    }
    function dashboard() {
      const total = vault.prompts.length;
      if (!total) return [emptyState(t('empty_vault_title'), t('empty_vault_msg'))];
      const favs = vault.prompts.filter(p => p.favorite).length;
      const tile = (label, value, onClick) => h('div', { class: 'card tile', role: 'button', tabindex: '0', onClick, onKeydown: e => { if (e.key === 'Enter') onClick(); } },
        h('div', { class: 'in-t' }, micro(label, 'var(--gold)'), h('div', { class: 'value' }, String(value))));
      return [
        h('div', { class: 'tiles' },
          tile(t('home_favorites'), favs, () => { filter.fav = true; refresh(); }),
          tile(t('home_all_prompts'), total, showAll)),
        h('div', null, section(t('home_categories')),
          h('div', { class: 'wrap-row', style: { marginTop: '10px' } },
            categoryCounts().map(c => chip(catLabel(c.name) + '  ' + c.count, false, () => { filter.category = c.name; refresh(); }, catColor(c.name), 'button')))),
        section(t('home_recent'), btn(t('action_view_all'), showAll, 'text')),
        query({ query: '', fav: false, category: null }, RECENT).map(p => promptCard(p, refresh))
      ];
    }
    function showAll() { filter.showAll = true; refresh(); }
    function browse() {
      const results = query(filter);
      const out = [
        h('div', { class: 'scroll-row' },
          chip(t('home_favorites'), filter.fav, () => { filter.fav = !filter.fav; refresh(); }),
          chip(t('chip_all'), filter.category === null, () => { filter.category = null; refresh(); }),
          categoryCounts().map(c => chip(catLabel(c.name), filter.category === c.name, () => { filter.category = c.name; refresh(); }, catColor(c.name)))),
        section(t('home_results') + ' • ' + results.length, btn(t('action_clear'), () => {
          filter.query = ''; filter.fav = false; filter.category = null; filter.showAll = false;
          search.value = ''; clear.hidden = true; refresh();
        }, 'text'))
      ];
      if (!results.length) {
        out.push(filter.fav && !filter.query.trim() && filter.category === null
          ? emptyState(t('empty_favs_title'), t('empty_favs_msg'))
          : emptyState(t('empty_search_title'), t('empty_search_msg')));
      } else out.push(results.map(p => promptCard(p, refresh)));
      return out;
    }
    refresh();
  }

  // ---- Detail --------------------------------------------------------------------------------

  function notFound(title) {
    app.appendChild(h('main', { class: 'screen stack' }, topbar(title, () => go('#/')),
      emptyState(t('editor_not_found_title'), t('editor_not_found_msg'))));
  }

  function renderDetail(id) {
    const p = byId(id);
    if (!p) return notFound(t('detail_title'));
    const rerender = () => render();
    const metaRow = (label, value) => h('div', { class: 'meta-row' }, micro(label), h('div', { class: 'small', style: { color: 'var(--text-dim)' } }, value));
    const screen = h('main', { class: 'screen stack' },
      topbar(t('detail_title'), () => go('#/')),
      h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'grow' }, micro(metaLine(p.category, p.model), catColor(p.category)),
          h('h2', { class: 'headline', style: { marginTop: '6px' } }, p.title)),
        favStar(p, rerender)),
      p.tags.length ? h('div', { class: 'wrap-row' }, p.tags.map(x => h('span', { class: 'tag' }, '#' + x))) : null,
      panel(micro(t('field_prompt'), 'var(--gold)'), h('pre', { class: 'prompt-text', style: { marginTop: '8px' } }, p.text)),
      p.note.trim() ? h('div', { class: 'stack', style: { gap: '6px' } }, micro(t('detail_note')), h('div', { style: { color: 'var(--text-dim)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, p.note)) : null,
      metaRow(t('detail_version'), t('version_label', p.currentVersion)),
      metaRow(t('detail_created'), fmtDate(p.createdAt)),
      metaRow(t('detail_modified'), fmtDate(p.updatedAt)),
      btn(t('detail_history', p.versions.length), () => go('#/p/' + id + '/versions'), 'block'),
      h('div', { class: 'row' },
        btn(t('action_edit'), () => go('#/edit/' + id), 'grow'),
        btn(t('action_duplicate'), () => {
          const nid = duplicatePrompt(id);
          toast(t('duplicated'));
          go('#/p/' + nid);
        }, 'grow')),
      h('div', { class: 'row' },
        btn(t('action_share'), () => sharePrompt(p), 'grow'),
        btn(t('action_delete'), () => dialog({
          title: t('dialog_delete_title'), message: t('dialog_delete_msg', p.title), buttons: [
            { text: t('action_delete'), kind: 'danger', onClick: () => { deletePrompt(id); toast(t('deleted')); go('#/', true); } },
            { text: t('action_cancel') }]
        }), 'danger grow'))
    );
    const bar = h('div', { class: 'actionbar' }, h('div', { class: 'inner' },
      btn(t('action_copy_prompt'), async () => { toast(await copyText(p.text) ? t('copied') : t('copy_failed')); }, 'confirm')));
    app.append(screen, bar);
  }

  // ---- Editor --------------------------------------------------------------------------------

  function renderEditor(id) {
    const existing = id ? byId(id) : null;
    if (id && !existing) return notFound(t('editor_title_edit'));
    const base = existing
      ? { title: existing.title, text: existing.text, category: existing.category, model: existing.model, tags: existing.tags.slice(), note: existing.note }
      : { title: '', text: '', category: settings.defaultCategory, model: settings.defaultModel, tags: [], note: '' };
    if (!allCategories().includes(base.category)) base.category = OTHER;
    const f = Object.assign({}, base, { tags: base.tags.slice() });
    editor = { f };
    const dirty = () => JSON.stringify(f) !== JSON.stringify(base) || tagInput.value.trim() !== '';
    const leave = () => { if (existing) go('#/p/' + id); else go('#/'); };
    const tryLeave = () => {
      if (!dirty()) return leave();
      dialog({ title: t('dialog_discard_title'), message: t('dialog_discard_msg'), buttons: [
        { text: t('action_discard'), kind: 'danger', onClick: () => { leaveGuard = false; leave(); } },
        { text: t('action_keep_editing') }] });
    };
    const touch = () => { leaveGuard = dirty(); };

    const title = h('input', { type: 'text', maxlength: String(MAX_TITLE), placeholder: t('field_title_hint'), value: f.title,
      onInput: e => { f.title = e.target.value; touch(); } });
    const counter = h('span', null);
    const textHint = h('div', { class: 'hint' }, h('span', { class: 'grow' }), counter);
    const text = h('textarea', { placeholder: t('field_prompt_hint'), maxlength: String(MAX_PROMPT), value: f.text });
    const updateCounter = () => { counter.textContent = t('editor_counter', fmtNum(f.text.length), fmtNum(MAX_PROMPT)); };
    text.addEventListener('input', () => {
      f.text = safeTake(text.value, MAX_PROMPT);
      textField.querySelector('.input').classList.remove('error');
      textHint.classList.remove('err'); textHint.firstChild.textContent = '';
      updateCounter(); touch();
    });
    text.addEventListener('paste', () => setTimeout(() => {
      const clean = sanitize(text.value);
      if (clean !== text.value) { text.value = clean; f.text = clean; updateCounter(); }
      if (!title.value.trim() && f.text.trim()) { title.value = suggestTitle(f.text); f.title = title.value; }
      touch();
    }, 0));
    updateCounter();
    const textField = field(t('field_prompt'), text, textHint);

    const catRow = h('div', { class: 'wrap-row' });
    function drawCategories() {
      catRow.replaceChildren(
        ...allCategories().map(c => chip(catLabel(c), f.category === c, () => { f.category = c; drawCategories(); touch(); }, catColor(c))),
        chip(t('editor_new_category'), false, newCategory, null, 'button'));
    }
    function newCategory() {
      const input = h('input', { type: 'text', maxlength: String(MAX_CATEGORY) });
      const submit = () => { const name = addCategory(input.value); if (name) { f.category = name; drawCategories(); touch(); } };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); closeDlg(); } });
      const closeDlg = dialog({ title: t('dialog_new_category'), body: field(t('field_category_name'), input), buttons: [
        { text: t('action_add_category'), kind: 'primary', onClick: submit }, { text: t('action_cancel') }] });
    }
    drawCategories();

    const model = h('input', { type: 'text', maxlength: String(MAX_MODEL), placeholder: t('field_model_hint'), value: f.model,
      onInput: e => { f.model = e.target.value; drawModels(); touch(); } });
    const modelRow = h('div', { class: 'scroll-row' });
    function drawModels() {
      modelRow.replaceChildren(...MODELS.map(m => chip(m, f.model.trim().toLowerCase() === m.toLowerCase(), () => {
        f.model = f.model.trim().toLowerCase() === m.toLowerCase() ? '' : m; model.value = f.model; drawModels(); touch();
      })));
    }
    drawModels();

    const tagList = h('div', { class: 'wrap-row' });
    const tagInput = h('input', { type: 'text', maxlength: String(MAX_TAG * 4), placeholder: t('field_tags_hint') });
    function addTag(raw) {
      const tg = normalizeTag(raw);
      if (tg && !f.tags.includes(tg) && f.tags.length < MAX_TAGS) f.tags.push(tg);
    }
    function drawTags() {
      tagList.replaceChildren(...f.tags.map(tg => h('button', {
        type: 'button', class: 'tag', 'aria-label': t('editor_remove_tag', tg), title: t('editor_remove_tag', tg),
        onClick: () => { f.tags = f.tags.filter(x => x !== tg); drawTags(); touch(); }
      }, '#' + tg + '  ×')));
    }
    function commitTag() { addTag(tagInput.value); tagInput.value = ''; drawTags(); touch(); }
    tagInput.addEventListener('input', () => {
      if (/[,\n]/.test(tagInput.value)) {
        const parts = tagInput.value.split(/[,\n]/);
        parts.slice(0, -1).forEach(addTag);
        tagInput.value = parts[parts.length - 1];
        drawTags();
      }
      touch();
    });
    tagInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitTag(); } });
    const tagField = field(t('field_tags'), tagInput);
    tagField.querySelector('.in').appendChild(btn(t('action_add'), commitTag, 'text'));
    drawTags();

    const note = h('textarea', { class: 'short', maxlength: String(MAX_NOTE), placeholder: t('field_note_hint'), value: f.note,
      onInput: e => { f.note = e.target.value; touch(); } });

    let saving = false;
    function save(asNew, skipDup) {
      if (saving) return;
      if (!f.text.trim()) {
        textField.querySelector('.input').classList.add('error');
        textHint.classList.add('err'); textHint.firstChild.textContent = t('editor_text_required');
        text.focus();
        return;
      }
      if (tagInput.value.trim()) commitTag();
      const textChanged = !existing || f.text !== base.text;
      if (!skipDup && textChanged) {
        const dups = findDuplicates(f.text, existing ? existing.id : 0);
        if (dups.length) {
          const first = dups[0];
          dialog({
            title: t('dialog_dup_title'),
            message: dups.length > 1 ? t('dialog_dup_msg_more', first.title, dups.length - 1) : t('dialog_dup_msg', first.title),
            buttons: [
              { text: t('action_view_existing'), kind: 'primary', onClick: () => { leaveGuard = false; go('#/p/' + first.id); } },
              { text: t('action_save_anyway'), onClick: () => save(asNew, true) },
              { text: t('action_cancel') }]
          });
          return;
        }
      }
      saving = true;
      try {
        let target = id;
        if (existing) updatePrompt(id, f, asNew); else target = createPrompt(f);
        leaveGuard = false;
        play('save');
        toast(t(asNew ? 'saved_version' : 'saved_prompt'));
        go('#/p/' + target, true);
      } catch (e) {
        saving = false;
        if (e.message !== 'storage') toast(t('save_failed'));
      }
    }

    const screen = h('main', { class: 'screen stack' },
      topbar(t(existing ? 'editor_title_edit' : 'editor_title_new'), tryLeave),
      existing ? h('div', { class: 'notice' }, t('editor_version_hint', existing.currentVersion)) : null,
      field(t('field_title'), title),
      textField,
      h('div', { class: 'field' }, h('label', null, t('field_category')), catRow),
      field(t('field_model'), model),
      modelRow,
      h('div', { class: 'small', style: { color: 'var(--text-faint)' } }, t('field_model_note')),
      tagField,
      tagList,
      field(t('field_note'), note)
    );
    const bar = h('div', { class: 'actionbar' }, h('div', { class: 'inner' },
      existing
        ? [btn(t('action_save'), () => save(false), 'primary'), btn(t('action_save_new_version'), () => save(true))]
        : btn(t('action_save_prompt'), () => save(false), 'primary')));
    app.append(screen, bar);
    (existing ? title : text).focus();
  }

  // ---- Versions ------------------------------------------------------------------------------

  function renderVersions(id) {
    const p = byId(id);
    if (!p) return notFound(t('versions_title'));
    const expanded = new Set();
    const list = h('div', { class: 'stack' });
    function draw() {
      list.replaceChildren(...p.versions.slice().sort((a, b) => b.n - a.n).map(v => {
        const isCurrent = v.n === p.currentVersion;
        const txt = h('pre', { class: 'prompt-text' + (expanded.has(v.n) ? '' : ' clamp4'), style: { color: 'var(--text-dim)' } }, v.text);
        const toggle = () => { if (expanded.has(v.n)) expanded.delete(v.n); else expanded.add(v.n); draw(); };
        return h('div', { class: 'card', role: 'button', tabindex: '0', 'aria-expanded': String(expanded.has(v.n)),
          onClick: e => { if (!e.target.closest('.btn')) toggle(); }, onKeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) toggle(); } },
        h('div', { class: 'stack pad', style: { gap: '10px' } },
          h('div', { class: 'row' },
            h('span', { class: 'card-title', style: { color: isCurrent ? 'var(--gold)' : null } }, t('version_label', v.n)),
            isCurrent ? h('span', { class: 'micro tag', style: { color: 'var(--gold)', background: 'var(--gold)' } }, t('versions_current').toUpperCase()) : null,
            h('span', { class: 'small grow', style: { color: 'var(--text-faint)', textAlign: 'end' } }, fmtDate(v.createdAt))),
          txt,
          isCurrent ? null : [
            btn(t('versions_compare'), () => compare(v), 'block'),
            h('div', { class: 'row' },
              btn(t('versions_make_current'), () => { makeCurrent(id, v.n); toast(t('versions_made_current', v.n)); render(); }, 'grow'),
              btn(t('versions_restore_new'), () => { const n = restoreAsNew(id, v.n); toast(t('versions_restored', n)); render(); }, 'grow'))
          ]));
      }));
    }
    function compare(v) {
      const lines = lineDiff(v.text, p.text);
      const same = lines.every(l => l[0] === ' ');
      const body = h('div', { class: 'stack', style: { gap: '8px' } },
        h('div', { class: 'row', style: { gap: '16px' } }, micro(t('diff_removed_legend'), 'var(--err)'), micro(t('diff_added_legend'), 'var(--amber-hot)')),
        same ? h('p', null, t('diff_identical'))
          : h('div', { class: 'diff' }, lines.map(([k, s]) => h('div', { class: k === '+' ? 'add' : k === '-' ? 'del' : '' }, (k === ' ' ? '  ' : (k === '+' ? '+ ' : '− ')) + s))));
      dialog({ title: t('versions_compare_title', v.n, p.currentVersion), body, buttons: [{ text: t('action_close') }] });
    }
    draw();
    app.appendChild(h('main', { class: 'screen stack' },
      topbar(t('versions_title'), () => go('#/p/' + id)),
      h('div', null, micro(t('versions_for')), h('h2', { class: 'headline clamp2' }, p.title)),
      list));
  }

  // ---- Settings ------------------------------------------------------------------------------

  function renderSettings() {
    const rerender = () => render();
    const desc = s => h('div', { class: 'small', style: { color: 'var(--text-dim)' } }, s);
    const onOff = (value, set) => h('div', { class: 'row' },
      chip(t('crt_on'), value, () => set(true)), chip(t('crt_off'), !value, () => set(false)));
    const settingRow = (label, control) => h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
      h('div', { class: 'card-title', style: { fontSize: '15px' } }, label), control);

    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onChange: () => { const fl = file.files[0]; file.value = ''; if (fl) startImport(fl); } });

    const langName = settings.lang ? (LANGS.find(l => l[0] === settings.lang) || [, settings.lang])[1] : t('language_system');
    const custom = vault.categories.filter(c => !CATEGORIES.includes(c));

    const defCat = h('select', { onChange: e => { settings.defaultCategory = e.target.value; saveSettings(); } },
      allCategories().map(c => h('option', { value: c }, catLabel(c))));
    defCat.value = allCategories().includes(settings.defaultCategory) ? settings.defaultCategory : OTHER;
    const defModel = h('select', { onChange: e => { settings.defaultModel = e.target.value; saveSettings(); } },
      h('option', { value: '' }, t('model_none')), MODELS.map(m => h('option', { value: m }, m)));
    defModel.value = MODELS.includes(settings.defaultModel) ? settings.defaultModel : '';

    const screen = h('main', { class: 'screen stack' },
      topbar(t('settings_title'), () => go('#/')),

      section(t('settings_vault')),
      panel(h('div', { class: 'stack' },
        btn(t('settings_export'), exportVault, 'block'), desc(t('settings_export_desc')),
        btn(t('settings_import'), () => file.click(), 'block'), desc(t('settings_import_desc')), file)),

      section(t('settings_appearance')),
      panel(h('div', { class: 'stack' },
        settingRow(t('theme_label'), h('div', { class: 'row' },
          chip(t('theme_dark'), !isLight(), () => { setTheme('dark'); rerender(); }),
          chip(t('theme_light'), isLight(), () => { setTheme('light'); rerender(); }))),
        isLight() ? null : settingRow(t('settings_crt'), onOff(settings.crt, v => { settings.crt = v; saveSettings(); applyCrt(); rerender(); })),
        settingRow(t('settings_vault_sounds'), onOff(settings.sounds, v => { settings.sounds = v; saveSettings(); if (v) play('save'); rerender(); })))),

      section(t('settings_language')),
      btn(langName, pickLanguage, 'block'),

      section(t('settings_defaults')),
      field(t('settings_default_category'), defCat),
      field(t('settings_default_model'), defModel),

      section(t('settings_categories')),
      custom.length
        ? h('div', { class: 'wrap-row' }, custom.map(c => h('button', {
          type: 'button', class: 'tag', 'aria-label': t('cat_delete_cd', c), title: t('cat_delete_cd', c),
          onClick: () => dialog({ title: t('categories_delete_title'), message: t('categories_delete_msg', c), buttons: [
            { text: t('action_delete'), kind: 'danger', onClick: () => { deleteCategory(c); rerender(); } }, { text: t('action_cancel') }] })
        }, c + '  ×')))
        : desc(t('settings_categories_empty')),

      section(t('user_label')),
      panel(h('div', { class: 'row' }, h('div', { class: 'grow card-title' }, user.name), btn(t('logout'), logout))),

      section(t('settings_about')),
      panel(h('div', { class: 'stack', style: { gap: '8px' } },
        h('div', { class: 'card-title', style: { color: 'var(--heading)', letterSpacing: 'var(--ls-micro)' } }, 'PROMPTFORGE'),
        brandLine(),
        h('div', { class: 'meta-row' }, micro(t('about_developer')), h('div', { class: 'small' }, t('developer_name'))),
        h('div', { class: 'meta-row' }, micro(t('about_publisher')), h('div', { class: 'small' }, t('publisher_name'))),
        h('div', { class: 'small', style: { color: 'var(--text-faint)' } }, t('about_version', WEB_VERSION)),
        h('a', { class: 'btn block', href: 'https://mpcreativeforge-arch.github.io/', target: '_blank', rel: 'noopener' }, t('about_hub')))),

      section(t('settings_privacy')),
      panel(h('div', { class: 'stack' }, desc(t('web_privacy')))),
      h('div', { class: 'micro', style: { textAlign: 'center', marginTop: '16px', color: 'var(--text-faint)' } }, t('brand_philosophy'))
    );
    app.appendChild(screen);
  }

  function pickLanguage() {
    const close = dialog({
      title: t('dialog_language_title'),
      body: h('div', { class: 'list-opt' },
        [['', t('language_system')]].concat(LANGS).map(([tag, n]) => btn(n, () => {
          settings.lang = tag; saveSettings(); store.set(KEY.lang, tag); setLang(tag); close(); render();
        }, settings.lang === tag ? 'primary block' : 'block'))),
      buttons: [{ text: t('action_cancel') }]
    });
  }

  function startImport(fileObj) {
    const fail = key => dialog({ title: t('dialog_error_title'), message: t(key), buttons: [{ text: t('action_ok') }] });
    if (fileObj.size > MAX_IMPORT) return fail('vault_err_too_large');
    toast(t('status_reading'));
    const reader = new FileReader();
    reader.onerror = () => fail('vault_err_io');
    reader.onload = () => {
      let parsed;
      try { parsed = parseVault(String(reader.result)); } catch (e) { return fail(e instanceof VaultError ? e.key : 'vault_err_io'); }
      if (!parsed.prompts.length) return fail('import_nothing');
      dialog({
        title: t('import_confirm_title'),
        message: t('import_confirm_msg', parsed.prompts.length) + (parsed.skipped ? '\n' + t('import_confirm_skipped', parsed.skipped) : ''),
        buttons: [
          { text: t('action_import'), kind: 'primary', onClick: () => {
            let rep;
            try { rep = importVault(parsed); } catch (e) { if (e.message !== 'storage') fail('import_failed_untouched'); return; }
            dialog({ title: t('import_done_title'),
              message: [t('report_added', rep.added), t('report_present', rep.present), rep.invalid ? t('report_invalid', rep.invalid) : null].filter(Boolean).join('\n'),
              buttons: [{ text: t('action_ok'), onClick: () => render() }] });
          } },
          { text: t('action_cancel') }]
      });
    };
    reader.readAsText(fileObj);
  }

  // ---- Intro (MICROVISION publisher scene, then MP Creative Forge Studio boot) ---------------

  function intro(done) {
    if (session.get(KEY.intro) || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    session.set(KEY.intro, '1');
    const SEG = 24;
    const segs = Array.from({ length: SEG }, () => h('div', { class: 'seg' }));
    const bar = h('div', { class: 'bar' }, h('div', { class: 'in' }, segs));
    const statusText = h('span'), pct = h('span');
    const pub = h('div', { class: 'scene pub' }, h('img', { src: 'assets/logo_microvision.png', alt: t('publisher_name') }), h('div', { class: 'rule' }));
    const studio = h('div', { class: 'scene studio' },
      h('img', { src: 'assets/mp_creative_forge_logo.png', alt: 'MP CREATIVE FORGE' }),
      h('div', { class: 'st' }, 'STUDIO'),
      h('div', { class: 'boot' }, bar, h('div', { class: 'status' }, statusText, pct)));
    const credit = h('div', { class: 'credit' }, h('div', null, t('developer_name').toUpperCase()), h('div', null, 'A ' + t('publisher_name').toUpperCase() + ' COMPANY'));
    const el = h('div', { id: 'intro', role: 'presentation' }, pub);
    document.body.appendChild(el);
    let finished = false, raf = 0;
    const timers = [];
    const finish = () => {
      if (finished) return; finished = true;
      timers.forEach(clearTimeout); cancelAnimationFrame(raf);
      el.classList.add('out');
      setTimeout(() => el.remove(), 420);
      done();
    };
    el.addEventListener('click', finish);
    requestAnimationFrame(() => pub.classList.add('on'));
    timers.push(setTimeout(() => pub.classList.add('fade'), 1650));
    timers.push(setTimeout(() => {
      el.replaceChildren(studio, credit);
      requestAnimationFrame(() => { studio.classList.add('on'); credit.classList.add('on'); });
      const keys = [[0, 0], [250, .12], [600, .31], [850, .36], [1200, .58], [1450, .64], [1800, .88], [2000, .95], [2200, 1]];
      const start = performance.now() + 300;
      let cursor = true;
      const blink = setInterval(() => { cursor = !cursor; }, 260);
      timers.push(blink);
      const step = now => {
        const ms = Math.max(0, now - start);
        let v = 1;
        for (let i = 1; i < keys.length; i++) {
          if (ms <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; v = v0 + (v1 - v0) * (ms - t0) / (t1 - t0); break; }
        }
        const lit = v * SEG;
        segs.forEach((s, i) => {
          s.classList.toggle('lit', lit - i > 0.5);
          s.classList.toggle('lead', v < 1 && i === Math.min(SEG - 1, Math.floor(lit)));
        });
        bar.classList.toggle('full', v >= 1);
        const st = v >= 1 ? 'splash_status_ready' : v >= .62 ? 'splash_status_display' : v >= .32 ? 'splash_status_prompts' : 'splash_status_vault';
        statusText.textContent = '> ' + t(st).toUpperCase() + (cursor ? '_' : ' ');
        pct.textContent = String(Math.floor(v * 100)).padStart(3, ' ') + ' %';
        if (ms < 2300) raf = requestAnimationFrame(step);
        else { clearInterval(blink); timers.push(setTimeout(finish, 300)); }
      };
      raf = requestAnimationFrame(step);
    }, 2000));
  }

  // ---- Start ---------------------------------------------------------------------------------

  const saved = store.get(KEY.session);
  const known = USERS.find(u => u.id === saved);
  if (known) loadUser(known); else { setLang(store.get(KEY.lang) || ''); applyTheme(store.get(KEY.theme) || 'dark'); }
  intro(render);
})();
