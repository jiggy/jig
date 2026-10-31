'use strict';

(() => {
  const carousel = document.getElementById('reuse-carousel');
  if (!carousel) return;
  const tabs = [...carousel.querySelectorAll('.fr-carousel-tabs [role="tab"]')];
  const previous = carousel.querySelector('.previous-reuse');
  const next = carousel.querySelector('.next-reuse');
  const count = carousel.querySelector('.fr-carousel-count');
  const announcement = carousel.querySelector('.fr-carousel-announcement');
  if (!tabs.length || !previous || !next) return;
  const names = tabs.map(tab => tab.textContent.trim());
  let announced = -1;

  // Keep the method itself intact. Only its selected app connection changes.
  const appScenes = [...carousel.querySelectorAll('.fr-stage[data-fr-context]')];
  for (const stage of appScenes) {
    const choices = [...stage.querySelectorAll('[data-fr-app-choice]')];
    const controls = stage.querySelector('[data-fr-context-controls]');
    if (choices.length !== 2 || !controls) continue;
    function connect(value, announce = false) {
      const selected = value === '1' ? '1' : '0';
      stage.dataset.frContext = selected;
      for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.frAppChoice === selected));
      if (announce && announcement) {
        const name = choices.find(choice => choice.dataset.frAppChoice === selected).textContent.trim();
        announcement.textContent = `${name} connected. Same Flow; a different app. The method stays unchanged.`;
      }
    }
    connect(stage.dataset.frContext);
    stage.dataset.frReady = 'true';
    controls.hidden = false;
    for (const choice of choices) choice.addEventListener('click', () => connect(choice.dataset.frAppChoice, true));
  }

  function sync(announce = true) {
    const index = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
    if (index < 0) return;
    if (count) count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(tabs.length).padStart(2, '0')}`;
    previous.setAttribute('aria-label', `Previous Flow example: ${names[(index - 1 + tabs.length) % tabs.length]}`);
    next.setAttribute('aria-label', `Next Flow example: ${names[(index + 1) % tabs.length]}`);
    if (announce && announcement && index !== announced) announcement.textContent = `${names[index]}, ${index + 1} of ${tabs.length}`;
    announced = index;
  }
  function move(direction) {
    const index = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
    tabs[(Math.max(index, 0) + direction + tabs.length) % tabs.length].click();
  }
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  // The shared app.js tab controller owns selection and keyboard navigation.
  for (const tab of tabs) {
    tab.addEventListener('click', () => sync());
    tab.addEventListener('keydown', () => sync());
  }
  sync(false);
})();
