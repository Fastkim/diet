import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as metrics from '../js/metrics.js';
import { Vault, emptyData, STORAGE_KEY } from '../js/vault.js';

// These are rendering/security regression tests, not a browser simulation.
// The fixture deliberately does not parse HTML or claim CSS/layout coverage.
const appSource = (await readFile(new URL('../js/app.js', import.meta.url), 'utf8'))
  .replace(/^import[^\n]*\r?\n/gm, '');
const importNames = ['Vault', 'emptyData', 'STORAGE_KEY', ...Object.keys(metrics)];
const executable = `const { ${importNames.join(', ')} } = __imports;\n${appSource}`;

function element(id) {
  return {
    id, innerHTML: '', textContent: '', hidden: true, open: false,
    listeners: new Map(),
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    },
    replaceChildren() { this.innerHTML = ''; this.textContent = ''; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() {},
  };
}

function harness() {
  const nodes = new Map(['app', 'access', 'toast', 'record-dialog', 'confirm-dialog', 'restore-dialog']
    .map((id) => [`#${id}`, element(id)]));
  const dialogs = [...nodes.values()].filter((node) => node.id.endsWith('-dialog'));
  const documentListeners = new Map();
  const windowListeners = new Map();
  const stored = new Map();
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  const document = {
    hidden: false,
    querySelector: (selector) => nodes.get(selector) ?? null,
    querySelectorAll: (selector) => selector === 'dialog' ? dialogs : [],
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
  };
  const context = vm.createContext({
    __imports: {
      ...metrics, todayISO: () => '2026-11-15', emptyData, STORAGE_KEY,
      Vault: class extends Vault { constructor() { super(storage); } },
    },
    document,
    window: { scrollTo() {}, addEventListener: (type, listener) => windowListeners.set(type, listener) },
    crypto: webcrypto,
    isSecureContext: true,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame() {},
  });
  vm.runInContext(executable, context, { filename: 'js/app.js' });
  return {
    nodes, dialogs, document,
    run: (code) => vm.runInContext(code, context),
    start(value) { context.seed = value; vm.runInContext('startSession(seed); delete globalThis.seed;', context); },
    emit(type) { for (const listener of documentListeners.get(type) ?? []) listener(); },
    get html() { return nodes.get('#app').innerHTML; },
  };
}

const record = (date, weight, note = '') => ({ date, weight, note });

test('starting a session renders real selected-year records and clears access inputs', () => {
  const app = harness();
  assert.match(app.nodes.get('#access').innerHTML, /기록장 만들기/);
  app.start({ version: 1, goal: 68, records: [
    record('2025-12-31', 79, 'previous-year-private-note'),
    record('2026-11-13', 72.1, 'first-private-note'),
    record('2026-11-14', 71.8, 'second-private-note'),
    record('2026-11-15', 71.3, 'today-private-note'),
  ] });
  assert.equal(app.nodes.get('#app').hidden, false);
  assert.equal(app.nodes.get('#access').hidden, true);
  assert.equal(app.nodes.get('#access').innerHTML, '');
  assert.match(app.html, /today-private-note/);
  assert.match(app.html, /71\.3/);
  assert.doesNotMatch(app.html, /previous-year-private-note/);
  assert.equal((app.html.match(/class="chart-point"/g) ?? []).length, 3);
  assert.match(app.html, /<option value="2026" selected>2026년<\/option>/);
  assert.doesNotMatch(app.html, /NaN|undefined|Infinity/);
});

test('calendar renders every leap-year date exactly once and filters other years', () => {
  const app = harness();
  app.start({ version: 1, goal: null, records: [
    record('2024-02-29', 72.4), record('2024-12-31', 70.2), record('2025-01-01', 69.9),
  ] });
  app.run("year = 2024; view = 'calendar'; renderApp();");
  assert.equal((app.html.match(/class="month-day(?: |")/g) ?? []).length, 366);
  assert.equal((app.html.match(/data-date="2024-02-29"/g) ?? []).length, 1);
  assert.match(app.html, /aria-label="2024-02-29, 72\.4kg, 기록 수정"/);
  assert.doesNotMatch(app.html, /data-date="2025-/);
  assert.match(app.html, /2024년 2일 기록/);
});

test('history escapes hostile notes and search input as text', () => {
  const app = harness();
  const hostile = '</td><script>globalThis.compromised=true</script><img src=x onerror="alert(1)"> & \' "';
  app.start({ version: 1, goal: null, records: [record('2026-11-15', 71.3, hostile)] });
  app.run("view = 'history'; renderApp();");
  assert.doesNotMatch(app.html, /<script>|<img src=x|<\/td><script>/);
  assert.match(app.html, /&lt;script&gt;globalThis\.compromised=true&lt;\/script&gt;/);
  assert.match(app.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(app.html, /&amp; &#39; &quot;/);
  app.run(`historyQuery = ${JSON.stringify('" autofocus onfocus="alert(1)')}; renderApp();`);
  assert.match(app.html, /value="&quot; autofocus onfocus=&quot;alert\(1\)"/);
  assert.doesNotMatch(app.html, /value="" autofocus/);
});

test('locking removes personal DOM, pending dialog values and history searches', () => {
  const app = harness();
  app.start({ version: 1, goal: 68, records: [record('2026-11-15', 71.3, 'secret-note-xyz')] });
  app.run("historyQuery = 'secret-note-xyz'; historyMonth = '11'; historyPage = 9; recordOriginalDate = '2026-11-15';");
  for (const dialog of app.dialogs) { dialog.open = true; dialog.innerHTML = 'secret-dialog-password'; }
  app.nodes.get('#toast').textContent = 'secret-note-xyz';
  app.run("lock('잠갔어요.');");
  assert.equal(app.nodes.get('#app').hidden, true);
  assert.equal(app.html, '');
  assert.equal(app.nodes.get('#toast').textContent, '');
  for (const dialog of app.dialogs) { assert.equal(dialog.open, false); assert.equal(dialog.innerHTML, ''); }
  assert.equal(app.run('data === null && recordOriginalDate === null'), true);
  assert.equal(app.run('historyQuery'), '');
  assert.equal(app.run('historyMonth'), '');
  assert.equal(app.run('historyPage'), 1);
  assert.doesNotMatch(app.nodes.get('#access').innerHTML, /secret-note-xyz|secret-dialog-password|71\.3/);
});

test('an empty vault renders absent measurements without fabricated graph points', () => {
  const app = harness();
  app.start(emptyData());
  assert.match(app.html, /첫 체중을 기록하면/);
  assert.match(app.html, /나의 변화가 시작될 자리/);
  assert.doesNotMatch(app.html, /class="chart-point"|NaN|undefined|Infinity/);
  const statHTML = app.run('renderStats()');
  assert.equal((statHTML.match(/>—<small>kg<\/small>/g) ?? []).length, 2);
  app.run("view = 'calendar'; renderApp();");
  assert.match(app.html, /평균 — kg/);
  assert.match(app.html, /최저 — kg · 최고 — kg/);
  assert.doesNotMatch(app.html, /NaN|undefined|Infinity/);
});

test('past-year dashboard labels do not call historical observations this year or today', () => {
  const app = harness();
  app.start({ version: 1, goal: null, records: [record('2024-01-01', 75.1), record('2024-12-31', 73.4)] });
  app.run('year = 2024; renderApp();');
  assert.match(app.html, /2024년의 나를/);
  assert.match(app.html, /value="2024-01-01"/);
  assert.doesNotMatch(app.run('renderStats()'), /올해/);
  assert.doesNotMatch(app.run('renderQuickForm()'), /오늘의 작은 기록/);
  assert.match(app.html, /75\.1kg → 73\.4kg/);
});

test('January chart includes preceding calendar days in its average without clipping it', () => {
  const app = harness();
  app.start({ version: 1, goal: null, records: [
    record('2025-12-31', 120), record('2026-01-01', 80), record('2026-01-02', 79),
  ] });
  const chart = app.run('renderChart()');
  const averagePoints = chart.match(/<polyline points="([^"]+)"[^>]*stroke="#b9c79c"/)[1]
    .split(' ').map((point) => point.split(',').map(Number));
  const firstRecordedY = Number(chart.match(/<circle class="chart-point"[^>]*cy="([^"]+)"/)[1]);
  assert.equal(averagePoints.length, 2);
  assert.ok(averagePoints[0][1] < firstRecordedY, 'January 1 average includes December 31');
  for (const [x, y] of averagePoints) {
    assert.ok(x >= 45 && x <= 678, 'average point remains inside horizontal plot bounds');
    assert.ok(y >= 22 && y <= 210, 'average point remains inside vertical plot bounds');
  }
});

test('leaving the tab clears unlocked private content immediately', () => {
  const app = harness();
  app.start({ version: 1, goal: null, records: [record('2026-11-15', 71.3, 'private-visible-note')] });
  assert.match(app.html, /private-visible-note/);
  app.document.hidden = true;
  app.emit('visibilitychange');
  assert.equal(app.html, '');
  assert.equal(app.nodes.get('#app').hidden, true);
  assert.equal(app.run('data'), null);
  assert.doesNotMatch(app.nodes.get('#access').innerHTML, /private-visible-note/);
});
