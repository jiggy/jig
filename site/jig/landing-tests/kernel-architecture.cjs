const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual shipped controls and panels; an optional section fragment
// lets the same checks run before the page owner integrates a delegated section.
const html = fs.readFileSync(process.argv[2] || path.resolve(__dirname, '../../../docs/jig/index.html'), 'utf8');
const start = html.indexOf('<section class="kernel-architecture"');
assert(start >= 0, 'architecture section exists');
const section = html.slice(start, html.indexOf('</section>', start) + 10);
const script = fs.readFileSync(path.join(__dirname, '../public/landing/kernel-architecture.js'), 'utf8');
const attrs = source => Object.fromEntries([...source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] ?? '']));
const camel = key => key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
class Element {
  constructor(attributes = {}) {
    this.attributes = { ...attributes };
    this.dataset = Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [camel(key.slice(5)), value]));
    this.hidden = Object.hasOwn(attributes, 'hidden');
    this.textContent = '';
    this.handlers = {};
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  click() { assert(this.handlers.click, 'control is wired'); this.handlers.click(); }
}
const tags = [...section.matchAll(/<(?:section|div|button|h3|span)\b([^>]*)>/g)].map(match => attrs(match[1]));
const findAll = key => tags.filter(tag => Object.hasOwn(tag, key)).map(tag => new Element(tag));
const contextButtons = findAll('data-ka-select-context');
const strategyButtons = findAll('data-ka-select-strategy');
const clientButtons = findAll('data-ka-select-client');
const topologies = findAll('data-ka-topology');
const controls = findAll('data-ka-controls');
const note = new Element(), clientLabel = new Element(), title = new Element(), input = new Element(), output = new Element(), status = new Element();
const lists = {
  '[data-ka-select-context]': contextButtons,
  '[data-ka-select-strategy]': strategyButtons,
  '[data-ka-select-client]': clientButtons,
  '[data-ka-topology]': topologies,
  '[data-ka-controls]': controls
};
const singles = {
  '[data-ka-strategy-note]': note,
  '[data-ka-client-label]': clientLabel,
  '[data-ka-method-title]': title,
  '[data-ka-input-label]': input,
  '[data-ka-output-label]': output,
  '[data-ka-status]': status
};
const scene = new Element(tags.find(tag => tag.id === 'microkernel'));
scene.querySelectorAll = selector => { assert(Object.hasOwn(lists, selector), `known bounded query ${selector}`); return lists[selector]; };
scene.querySelector = selector => { assert(Object.hasOwn(singles, selector), `known bounded query ${selector}`); return singles[selector]; };

assert.equal(contextButtons.length, 3);
assert.equal(strategyButtons.length, 3);
assert.equal(clientButtons.length, 3);
assert.equal(topologies.length, 9);
assert.equal(controls.length, 3);
assert(controls.every(control => control.hidden), 'no-JS controls stay hidden');
assert.equal(topologies.filter(topology => !topology.hidden).length, 1, 'one complete no-JS diagram');
assert.equal(topologies.find(topology => !topology.hidden).dataset.kaContextPanel, 'research');
assert.equal(topologies.find(topology => !topology.hidden).dataset.kaTopology, 'team');
assert(topologies.every(topology => topology.attributes.role === 'img' && topology.attributes['aria-label']), 'every diagram has a semantic description');
assert(section.includes('<code>method(input)</code>') && !section.includes('<strong>Research workspace</strong>'), 'shared caller is neutral');
assert(section.includes('https://jig.md/guide/agents#local-clients'), 'ACP documentation link is preserved');

vm.runInNewContext(script, { document: { querySelector: () => null } });
vm.runInNewContext(script, { document: { querySelector: () => scene } });
assert.equal(status.textContent, '', 'initialization is quiet');
assert(controls.every(control => !control.hidden), 'working controls are revealed');
const pressed = buttons => buttons.filter(button => button.attributes['aria-pressed'] === 'true');
const providerState = () => JSON.stringify({ client: scene.dataset.kaClient, label: clientLabel.textContent, buttons: clientButtons.map(button => button.attributes) });
const procedureState = () => JSON.stringify({ context: scene.dataset.kaContext, strategy: scene.dataset.kaStrategy, note: note.textContent, title: title.textContent, input: input.textContent, output: output.textContent, contextButtons: contextButtons.map(button => button.attributes), strategyButtons: strategyButtons.map(button => button.attributes), diagrams: topologies.map(topology => ({ dataset: topology.dataset, hidden: topology.hidden, attributes: topology.attributes })) });
const expected = {
  research: ['Prepare a research brief', 'A question', 'Brief + outcome'],
  factory: ['From idea to software', 'An idea', 'Proposed change + evidence'],
  event: ['Plan an event', 'An event brief', 'Proposed event plan']
};
let combinations = 0;
for (let round = 0; round < 2; round++) {
  for (const contextButton of contextButtons) {
    const priorStrategy = scene.dataset.kaStrategy;
    const priorProvider = providerState();
    contextButton.click();
    assert.equal(scene.dataset.kaStrategy, priorStrategy, 'app choice retains selected strategy');
    assert.equal(providerState(), priorProvider, 'app choice preserves operator state');
    assert.deepEqual([title.textContent, input.textContent, output.textContent], expected[scene.dataset.kaContext]);
    for (const strategyButton of strategyButtons) {
      const before = providerState();
      strategyButton.click();
      assert.equal(providerState(), before, 'strategy choice preserves operator state');
      for (const clientButton of clientButtons) {
        const procedure = procedureState();
        clientButton.click();
        assert.equal(procedureState(), procedure, 'Agent choice preserves authored procedure');
        assert.equal(pressed(contextButtons).length, 1);
        assert.equal(pressed(strategyButtons).length, 1);
        assert.equal(pressed(clientButtons).length, 1);
        const visible = topologies.filter(topology => !topology.hidden);
        assert.equal(visible.length, 1);
        assert.equal(visible[0].dataset.kaContextPanel, scene.dataset.kaContext);
        assert.equal(visible[0].dataset.kaTopology, scene.dataset.kaStrategy);
        topologies.forEach(topology => assert.equal(topology.attributes['aria-hidden'], String(topology.hidden)));
        assert(status.textContent.includes('illustration'));
        combinations++;
      }
    }
  }
}
console.log(`Architecture: ${combinations} selections pass (27 combinations, repeated); independent app/strategy/client state, retained strategy, semantic panels, quiet initialization, complete no-JS view.`);
