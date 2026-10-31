(() => {
  'use strict';
  const scene = document.querySelector('[data-ka-strategy]');
  if (!scene) return;
  const strategies = {
    specialist: 'A specialist',
    review: 'Review and refine',
    team: 'A specialist team'
  };
  const contexts = {
    research: {
      label: 'Research brief', title: 'Prepare a research brief', input: 'A question', output: 'Brief + outcome',
      notes: {
        specialist: 'One focused specialist, inside one method.',
        review: 'An authored review loop, inside one method.',
        team: 'Specialists working together, inside one method.'
      }
    },
    factory: {
      label: 'Software factory', title: 'From idea to software', input: 'An idea', output: 'Proposed change + evidence',
      notes: {
        specialist: 'Design, build, and propose a software change.',
        review: 'Run checks and refine the change inside the method.',
        team: 'Plan, build, test, and review as one method.'
      }
    },
    event: {
      label: 'Event plan', title: 'Plan an event', input: 'An event brief', output: 'Proposed event plan',
      notes: {
        specialist: 'Shape an occasion around the event brief.',
        review: 'Check the plan against the limits, then adjust.',
        team: 'Venue, programme, and budget, brought into one plan.'
      }
    }
  };
  const clients = { codex: 'Codex', claude: 'Claude Code', pi: 'Pi' };
  const contextButtons = [...scene.querySelectorAll('[data-ka-select-context]')];
  const strategyButtons = [...scene.querySelectorAll('[data-ka-select-strategy]')];
  const clientButtons = [...scene.querySelectorAll('[data-ka-select-client]')];
  const topologies = [...scene.querySelectorAll('[data-ka-topology]')];
  const strategyNote = scene.querySelector('[data-ka-strategy-note]');
  const clientLabel = scene.querySelector('[data-ka-client-label]');
  const methodTitle = scene.querySelector('[data-ka-method-title]');
  const inputLabel = scene.querySelector('[data-ka-input-label]');
  const outputLabel = scene.querySelector('[data-ka-output-label]');
  const status = scene.querySelector('[data-ka-status]');
  let context = contexts[scene.dataset.kaContext] ? scene.dataset.kaContext : 'research';
  let strategy = strategies[scene.dataset.kaStrategy] ? scene.dataset.kaStrategy : 'team';
  let client = clients[scene.dataset.kaClient] ? scene.dataset.kaClient : 'codex';
  function announce(message) {
    if (status) status.textContent = message;
  }
  function showProcedure() {
    scene.dataset.kaContext = context;
    scene.dataset.kaStrategy = strategy;
    contextButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kaSelectContext === context)));
    strategyButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kaSelectStrategy === strategy)));
    topologies.forEach(topology => {
      const selected = topology.dataset.kaContextPanel === context && topology.dataset.kaTopology === strategy;
      topology.hidden = !selected;
      topology.setAttribute('aria-hidden', String(!selected));
    });
    if (strategyNote) strategyNote.textContent = contexts[context].notes[strategy];
    if (methodTitle) methodTitle.textContent = contexts[context].title;
    if (inputLabel) inputLabel.textContent = contexts[context].input;
    if (outputLabel) outputLabel.textContent = contexts[context].output;
  }
  function showContext(next) {
    if (!contexts[next]) return;
    context = next;
    showProcedure();
    announce(`${contexts[next].label} example selected, using ${strategies[strategy].toLowerCase()}. The ${clients[client]} Agent choice and Jig execution foundation stay the same. Authored procedure illustration.`);
  }
  function showStrategy(next) {
    if (!strategies[next]) return;
    strategy = next;
    showProcedure();
    announce(`${strategies[next]} selected for ${contexts[context].label.toLowerCase()}. The ${clients[client]} Agent choice and Jig execution foundation stay the same. Authored procedure illustration.`);
  }
  function showClient(next, userAction) {
    if (!clients[next]) return;
    client = next;
    scene.dataset.kaClient = next;
    clientButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kaSelectClient === next)));
    if (clientLabel) clientLabel.textContent = clients[next];
    if (userAction) announce(`${clients[next]} via ACP selected. The ${contexts[context].label.toLowerCase()} example, ${strategies[strategy].toLowerCase()} procedure, and Jig execution foundation stay the same. Independent configuration illustration.`);
  }
  contextButtons.forEach(button => button.addEventListener('click', () => showContext(button.dataset.kaSelectContext)));
  strategyButtons.forEach(button => button.addEventListener('click', () => showStrategy(button.dataset.kaSelectStrategy)));
  clientButtons.forEach(button => button.addEventListener('click', () => showClient(button.dataset.kaSelectClient, true)));
  showProcedure();
  showClient(client, false);
  scene.querySelectorAll('[data-ka-controls]').forEach(controls => { controls.hidden = false; });
})();
