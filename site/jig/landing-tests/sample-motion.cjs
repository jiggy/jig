const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const project = path.resolve(__dirname, '../public');
const source = fs.readFileSync(path.join(project, 'landing/sample-motion.js'), 'utf8');
const css = fs.readFileSync(path.join(project, 'landing/sample-motion.css'), 'utf8');
const markupPath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../../../docs/jig/index.html');
const html = fs.readFileSync(markupPath, 'utf8');
const attr = text => Object.fromEntries([...text.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)].map(m => [m[1], m[2] ?? m[3] ?? m[4] ?? '']));
const markup = [...html.matchAll(/<section\b([^>]*\bdata-sample-motion="[^"]+"[^>]*)>([\s\S]*?)<\/section>/g)].map(match => {
  const nodes = [...match[2].matchAll(/<([\w-]+)\b([^<>]*)>/g)].map(m => ({ tag: m[1], attrs: attr(m[2]) }));
  return { attrs: attr(match[1]), items: nodes.filter(n => Object.hasOwn(n.attrs, 'data-sm-item')).map(n => n.attrs),
    buttons: nodes.filter(n => Object.hasOwn(n.attrs, 'data-sample-view')).map(n => n.attrs), nodes };
});
// Exercise the two independent scenes by identity, regardless of carousel reading order.
markup.sort((a, b) => a.attrs['data-sample-motion'].localeCompare(b.attrs['data-sample-motion']));
assert.equal(markup.length, 2, 'Both actual app illustrations must be present');
assert.deepEqual(markup.map(m => m.attrs['data-sample-motion']), ['kitchen', 'support']);
assert.equal(markup[0].items.length, 6, 'Six volunteer identities move to their assigned places');
assert.equal(markup[1].items.length, 2, 'The two original charges stay visible through the match');
assert.equal(new Set(markup[0].items.map(i => i['data-person'])).size, 6);
for (const m of markup) {
  assert.equal(m.buttons.length, 2);
  assert.equal(m.buttons[1]['aria-pressed'], 'true', 'No JavaScript shows the useful result');
  assert(m.buttons.every(b => b.type === 'button'));
}
assert(!/cloneNode|createElement|getBoundingClientRect|setTimeout|setInterval/.test(source), 'No clones, handoffs, measuring or timer chains');
assert(css.includes('height:326px'));
assert(css.includes('height:426px'));
assert(css.includes('--sm-move:1'));
assert(!css.match(/transition:\s*(?:all|transform)/), 'The shared clock owns the reversible path');

// The desktop scene remains 326px high when its draft wraps to two lines.
// Derive this bound from the real CSS rather than a separate mock layout.
function declarations(selector) {
  const text = css.slice(css.indexOf(selector + '{') + selector.length + 1).split('}')[0];
  return Object.fromEntries(text.split(';').filter(Boolean).map(part => { const at = part.indexOf(':'); return [part.slice(0, at), part.slice(at + 1)]; }));
}
const replyBox = declarations('.sm-reply'), replyLabel = declarations('.sm-reply>span'), replyText = declarations('.sm-reply>p');
const px = text => parseFloat(text);
const draftHeight = 2 * px(replyBox.padding) + 2 + px(replyLabel['font-size']) * px(replyLabel['line-height']) + px(replyLabel['margin-bottom']) + 2 * px(replyText['font-size']) * px(replyText['line-height']);
assert(px(replyBox.top) + draftHeight <= 326, 'A wrapped two-line draft stays inside the desktop stage');

function boot(options = {}) {
  let now = 0, next = 0, writes = 0;
  const frames = new Map(), canceled = [], documentEvents = new Map(), windowEvents = new Map();
  class Element {
    constructor(attrs = {}) {
      this.attrs = { ...attrs };
      this.dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
      this.props = new Map(); this.listeners = new Map(); this.isConnected = true; this.textContent = '';
      this.style = { setProperty: (k, v) => { writes++; this.props.set(k, String(v)); }, getPropertyValue: k => this.props.get(k) ?? '' };
    }
    getAttribute(k) { return this.attrs[k] ?? null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(k, fn) { if (!this.listeners.has(k)) this.listeners.set(k, []); this.listeners.get(k).push(fn); }
    dispatch(k, event = {}) { for (const fn of this.listeners.get(k) ?? []) fn(event); }
    closest(selector) { assert.equal(selector, '[hidden]'); return this.panelHidden ? {} : null; }
  }
  const states = markup.map((m, index) => {
    const scene = new Element(m.attrs), stage = new Element(), hint = new Element();
    const items = m.items.map(a => new Element(a)), buttons = m.buttons.map(a => new Element(a));
    scene.panelHidden = index !== 0;
    scene.querySelector = selector => selector === '.sm-stage' ? stage : selector === '[data-sm-hint]' ? hint : null;
    scene.querySelectorAll = selector => selector === '[data-sm-item]' ? items : selector === '[data-sample-view]' ? buttons : [];
    return { scene, stage, hint, items, buttons, progress: () => Number(stage.dataset.progress) };
  });
  let observer;
  class Observer {
    constructor(fn) { this.fn = fn; this.targets = []; observer = this; }
    observe(target) { this.targets.push(target); }
    emit(entries) { this.fn(entries.map(([state, ratio, intersects = true]) => ({ target: state.stage, intersectionRatio: ratio, isIntersecting: intersects }))); }
  }
  const reduced = { matches: !!options.reduced, listeners: [], addEventListener(type, fn) { assert.equal(type, 'change'); this.listeners.push(fn); }, change(value) { this.matches = value; for (const fn of this.listeners) fn({ matches: value }); } };
  const document = { visibilityState: options.hidden ? 'hidden' : 'visible', querySelectorAll(selector) { assert.equal(selector, '[data-sample-motion]'); return states.map(s => s.scene); }, addEventListener(k, fn) { documentEvents.set(k, fn); } };
  const window = { IntersectionObserver: options.noObserver ? undefined : Observer, matchMedia: () => reduced,
    requestAnimationFrame: options.noFrames ? undefined : fn => { const id = ++next; frames.set(id, fn); return id; },
    cancelAnimationFrame: options.noFrames ? undefined : id => { if (frames.has(id)) canceled.push(frames.get(id)); frames.delete(id); },
    addEventListener(k, fn) { windowEvents.set(k, fn); } };
  vm.runInNewContext(source, { document, window }, { filename: 'sample-motion.js' });
  const identities = states.map(s => [...s.items]);
  function step(ms = 16) { now += ms; const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now); assert(frames.size <= 1, 'All scenes share at most one pending clock'); }
  function advance(ms) { let left = ms; while (left > 0) { if (!frames.size) { now += left; break; } const delta = Math.min(16, left); step(delta); left -= delta; } }
  function open(index) { states.forEach((state, i) => state.scene.panelHidden = i !== index); observer.emit(states.map((state, i) => [state, i === index ? .9 : 0, i === index])); }
  return { states, kitchen: states[0], support: states[1], frames, canceled, observer, reduced, document, step, advance, open, writes: () => writes,
    persistent() { states.forEach((s, i) => assert.deepEqual(s.items, identities[i])); },
    emitDocument(type) { documentEvents.get(type)?.(); }, emitWindow(type) { windowEvents.get(type)?.(); } };
}
const close = (actual, expected, msg) => assert(Math.abs(actual - expected) < .0001, msg ?? `${actual} should equal ${expected}`);
const positions = state => state.items.map(i => i.style.getPropertyValue('--sm-move'));
const pressed = (state, value) => state.buttons.forEach((b, i) => assert.equal(b.getAttribute('aria-pressed'), String(i === value)));

let x = boot();
assert.equal(x.frames.size, 0); close(x.kitchen.progress(), 0); close(x.support.progress(), 0);
x.open(0); x.step(0); const startWrites = x.writes(); x.advance(1700); assert.equal(x.writes(), startWrites, 'Readable hold causes no repeated style writes');
x.advance(100); assert.equal(x.kitchen.stage.dataset.phase, 'arrange');
x.advance(800); close(x.kitchen.progress(), .5); const midpoint = positions(x.kitchen);
assert(midpoint.some(p => +p > 0 && +p < 1)); assert(+midpoint[0] > +midpoint[5], 'The cards move with restrained stagger');
x.advance(800); close(x.kitchen.progress(), 1); pressed(x.kitchen, 1); assert(positions(x.kitchen).every(p => +p === 1));
const resultWrites = x.writes(); x.advance(4200); assert.equal(x.writes(), resultWrites, 'Result stays readable for a full hold');
x.advance(100); x.advance(625); close(x.kitchen.progress(), .5); assert.deepEqual(positions(x.kitchen), midpoint, 'Reverse travel uses the identical persistent-card path');
x.advance(625); close(x.kitchen.progress(), 0); assert.equal(x.kitchen.stage.dataset.phase, 'before'); x.persistent();

// Inactive carousel scenes pause and resume from the same moment without catch-up.
x = boot(); x.open(0); x.step(0); x.advance(2500); const kitchenPaused = x.kitchen.progress();
x.open(1); x.step(0); x.advance(2600); close(x.kitchen.progress(), kitchenPaused); assert(x.support.progress() > 0);
const supportPaused = x.support.progress(); x.open(0); x.step(0); close(x.kitchen.progress(), kitchenPaused); x.advance(100); assert(x.kitchen.progress() > kitchenPaused); close(x.support.progress(), supportPaused);
x.open(-1); assert.equal(x.frames.size, 0); x.advance(30000); close(x.kitchen.progress(), kitchenPaused + 100 / 1600); close(x.support.progress(), supportPaused);

// Focus owns playback. Choices begin at the exact in-flight location, including reversal.
x = boot(); x.open(1); x.step(0); x.advance(2500); const p = x.support.progress();
x.support.scene.dispatch('focusin'); assert.equal(x.frames.size, 0); assert.match(x.support.hint.textContent, /paused/); x.advance(9000); close(x.support.progress(), p);
x.support.buttons[0].dispatch('click'); close(x.support.progress(), p); pressed(x.support, 0); x.step(0); x.advance(200); const reversed = x.support.progress(); assert(reversed < p);
x.support.buttons[1].dispatch('click'); close(x.support.progress(), reversed); pressed(x.support, 1); x.step(0); x.advance(1600); close(x.support.progress(), 1); assert.equal(x.frames.size, 0);
x.open(0); x.open(1); assert.equal(x.frames.size, 0, 'Manual ownership survives leaving the carousel'); x.persistent();

// Rapid choices cannot revive a canceled timeline or schedule competing clocks.
x = boot(); x.open(0); x.step(0); x.advance(2500); const rapid = x.kitchen.progress();
for (let i = 0; i < 16; i++) { x.kitchen.buttons[i % 2].dispatch('click'); close(x.kitchen.progress(), rapid); }
for (const fn of x.canceled) fn(999999); close(x.kitchen.progress(), rapid); assert(x.frames.size <= 1); x.step(0); x.advance(1600); close(x.kitchen.progress(), 1);

// Page lifecycle pauses, reduced motion, and missing capabilities all preserve a useful scene.
for (const event of ['visibilitychange', 'pagehide']) {
  x = boot(); x.open(0); x.step(0); x.advance(2400); const before = x.kitchen.progress();
  if (event === 'visibilitychange') { x.document.visibilityState = 'hidden'; x.emitDocument(event); }
  else x.emitWindow(event);
  assert.equal(x.frames.size, 0); x.advance(30000); close(x.kitchen.progress(), before);
  x.document.visibilityState = 'visible'; if (event === 'visibilitychange') x.emitDocument(event); else x.emitWindow('pageshow');
  x.step(0); close(x.kitchen.progress(), before); x.advance(16); assert(x.kitchen.progress() > before);
}
x = boot({ reduced: true }); for (const state of x.states) { close(state.progress(), 1); pressed(state, 1); } x.open(0); assert.equal(x.frames.size, 0);
x.kitchen.buttons[0].dispatch('click'); close(x.kitchen.progress(), 0); assert.equal(x.frames.size, 0);
x = boot(); x.open(0); x.step(0); x.advance(2400); x.reduced.change(true); close(x.kitchen.progress(), 1); assert.equal(x.frames.size, 0); x.reduced.change(false); close(x.kitchen.progress(), 0);
for (const options of [{ noFrames: true }, { noObserver: true }]) { x = boot(options); for (const state of x.states) close(state.progress(), 1); assert.equal(x.frames.size, 0); x.kitchen.buttons[0].dispatch('click'); if (options.noFrames) close(x.kitchen.progress(), 0); else { x.step(0); x.advance(1250); close(x.kitchen.progress(), 0); } }
x = boot(); x.open(0); x.step(0); x.advance(2400); x.kitchen.stage.isConnected = false; x.step(16); assert.equal(x.frames.size, 0, 'Removed scenes stop their clock');
console.log(`PASS: ${markupPath}; persistent volunteer and charge cards, exact reversible paths, readable holds, one shared clock, native phase choices, focus/visibility/carousel ownership, reduced-motion and static fallbacks.`);
