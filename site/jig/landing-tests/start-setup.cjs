const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.resolve(__dirname, '../public');
const html = fs.readFileSync(path.resolve(__dirname, '../../../docs/jig/index.html'), 'utf8');
const nodes = [], stack = [];
const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)([^<>]*?)\/?>/g)) {
  if (!token[1]) continue;
  const tag = token[1].toLowerCase();
  if (token[0].startsWith('</')) {
    assert.equal(nodes[stack.at(-1)]?.tag, tag);
    nodes[stack.pop()].end = token.index;
    continue;
  }
  const attrs = {};
  for (const a of token[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
  const index = nodes.push({ tag, attrs, start: token.index, openEnd: token.index + token[0].length }) - 1;
  if (!voids.has(tag) && !token[0].endsWith('/>')) stack.push(index);
}
const byId = id => nodes.find(n => n.attrs.id === id);
const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const stripTagsSafely = value => {
  let previous;
  let current = value;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);
  return current;
};
const text = n => decode(stripTagsSafely(html.slice(n.openEnd, n.end)));
let focused = null;
class Element {
  constructor(node = { attrs: {} }) {
    this.attrs = { ...node.attrs };
    this.id = this.attrs.id;
    this.dataset = Object.fromEntries(Object.entries(this.attrs).filter(([k]) => k.startsWith('data-')).map(([k,v]) => [k.slice(5).replace(/-([a-z])/g, (_,c) => c.toUpperCase()), v]));
    this.hidden = Object.hasOwn(this.attrs, 'hidden');
    this.textContent = node.end ? text(node) : '';
    this.tabIndex = +(this.attrs.tabindex ?? 0);
    this.listeners = new Map();
    this.classList = { contains: name => (this.attrs.class ?? '').split(' ').includes(name) };
  }
  getAttribute(k) { return this.attrs[k] ?? null; }
  setAttribute(k,v) { this.attrs[k] = String(v); }
  addEventListener(k,fn) { if (!this.listeners.has(k)) this.listeners.set(k, []); this.listeners.get(k).push(fn); }
  dispatch(k, e = {}) { e.preventDefault = () => { e.prevented = true; }; return (this.listeners.get(k) ?? []).map(fn => fn(e)); }
  focus() { focused = this; }
}
const tabs = nodes.filter(n => ['setup-tab-agent', 'setup-tab-terminal'].includes(n.attrs.id)).map(n => new Element(n));
const panels = tabs.map(tab => new Element(byId(tab.getAttribute('aria-controls'))));
const sources = panels.map(panel => new Element(nodes.find(n => n.tag === 'pre' && n.start > byId(panel.id).start && n.start < byId(panel.id).end)));
const button = new Element(byId('copy-start')), label = new Element(), status = new Element();
label.textContent = 'Copy'; button.querySelector = () => label;
panels.forEach((panel,i) => { panel.querySelector = selector => { assert.equal(selector, '[data-setup-copy]'); return sources[i]; }; });
const list = new Element({ attrs: { class: 'setup-tabs', 'aria-orientation': 'horizontal' } }); list.querySelectorAll = () => tabs;
const start = new Element(); start.querySelectorAll = selector => { assert.equal(selector, '.setup-tabs [role="tab"]'); return tabs; };
const ids = new Map([['start',start],['copy-start',button],['copy-status',status], ...tabs.map(t => [t.id,t]), ...panels.map(p => [p.id,p])]);
let selectedForCopy = null, clipboardMode = 'success', resolveWrite, rejectWrite;
const writes = [], timers = new Map(); let timerId = 0;
const document = {
  getElementById: id => ids.get(id),
  querySelectorAll: selector => { assert.equal(selector, '[role="tablist"]'); return [list]; },
  createRange: () => ({ selectNodeContents(content) { selectedForCopy = content; } })
};
const window = { setTimeout(fn) { const id = ++timerId; timers.set(id,fn); return id; }, clearTimeout(id) { timers.delete(id); }, getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
const navigator = { clipboard: { writeText(value) { writes.push(value); if (clipboardMode === 'failure') return Promise.reject(Error('unavailable')); if (clipboardMode === 'pending') return new Promise((resolve,reject) => { resolveWrite = resolve; rejectWrite = reject; }); return Promise.resolve(); } } };
const context = vm.createContext({ document, window, navigator });
vm.runInContext(fs.readFileSync(path.join(project, 'landing/app.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(project, 'landing/start-setup.js'), 'utf8'), context);
function selected(index) {
  tabs.forEach((tab,i) => { assert.equal(tab.getAttribute('aria-selected'), String(i === index)); assert.equal(tab.tabIndex, i === index ? 0 : -1); assert.equal(panels[i].hidden, i !== index); });
}
const clickCopy = () => Promise.all(button.dispatch('click'));
(async () => {
  selected(0); assert.equal(status.textContent, ''); assert.equal(writes.length,0);
  assert.equal(tabs[0].id, 'setup-tab-agent', 'Agent setup is first and selected before any interaction');
  assert.equal(tabs[0].getAttribute('role'),'tab'); assert.equal(tabs[1].attrs.type,'button');
  assert(button.getAttribute('aria-label').includes('agent setup instructions'));
  await clickCopy();
  assert.equal(writes.at(-1),sources[0].textContent.trim(), 'The exact visible Agent prompt is copied');
  assert.equal(writes.at(-1),'Bootstrap a Jig project: https://jig.md/guide/for-agents.html');
  assert.equal(label.textContent,'Copied'); assert.equal(status.textContent,'Agent setup instructions copied.');
  tabs[0].dispatch('keydown', { key: 'End' }); selected(1); assert.equal(focused,tabs[1]);
  assert.equal(label.textContent,'Copy'); assert.equal(status.textContent,'');
  assert(button.getAttribute('aria-label').includes('terminal setup commands'));
  await clickCopy();
  assert(writes.at(-1).includes('npm install --global @jigging/jig@alpha'));
  assert(writes.at(-1).includes('jig run flow:flows/hello'));
  assert(!/^\$ /m.test(writes.at(-1)), 'Copied commands have no shell prompt prefix');
  assert.equal(status.textContent,'Terminal setup commands copied.');
  tabs[1].dispatch('keydown', { key: 'Home' }); selected(0); assert.equal(focused,tabs[0]);
  clipboardMode = 'failure'; await clickCopy(); assert.equal(selectedForCopy,sources[0]); assert.equal(label.textContent,'Select & copy');
  assert(status.textContent.includes('Agent setup instructions selected'));
  selectedForCopy = null; clipboardMode = 'pending'; const pendingCopy = clickCopy(); assert.equal(button.disabled,true);
  tabs[0].dispatch('keydown', { key: 'ArrowRight' }); selected(1); resolveWrite(); await pendingCopy;
  assert.equal(button.disabled,false); assert.equal(label.textContent,'Copy'); assert.equal(status.textContent,'', 'Late clipboard feedback never labels the newly selected tab');
  tabs[1].dispatch('click'); selected(1); clipboardMode = 'pending'; const failedCopy = clickCopy();
  tabs[0].dispatch('click'); selected(0); rejectWrite(Error('denied')); await failedCopy;
  assert.equal(selectedForCopy,null, 'A late error does not select hidden instructions');
  assert.equal(label.textContent,'Copy'); assert.equal(status.textContent,'');
  assert.equal(html.match(/id="copy-start"/g).length,1);
  console.log('PASS: actual setup tabs, keyboard navigation, exact active-content copy, clipboard fallback, quiet initialization and safe feedback across pending tab changes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
