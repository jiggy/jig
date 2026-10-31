'use strict';

(() => {
  const carousel = document.getElementById('examples-carousel');
  if (!carousel) return;
  const tabs = [...carousel.querySelectorAll('.examples-tabs [role="tab"]')];
  const previous = carousel.querySelector('.previous-example-button');
  const next = carousel.querySelector('.next-example-button');
  const count = carousel.querySelector('.example-count');
  const announcement = carousel.querySelector('.examples-announcement');
  if (!tabs.length || !previous || !next) return;
  const names = tabs.map(tab => tab.textContent.trim());
  let announced = -1;

  function sync(announce = true) {
    const index = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
    if (index < 0) return;
    if (count) count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(tabs.length).padStart(2, '0')}`;
    previous.setAttribute('aria-label', `Previous example: ${names[(index - 1 + tabs.length) % tabs.length]}`);
    next.setAttribute('aria-label', `Next example: ${names[(index + 1) % tabs.length]}`);
    if (announce && announcement && index !== announced) announcement.textContent = `${names[index]}, ${index + 1} of ${tabs.length}`;
    announced = index;
  }
  function move(direction) {
    const index = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
    tabs[(Math.max(index, 0) + direction + tabs.length) % tabs.length].click();
  }
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  // app.js owns the standard tab selection and keyboard behavior. It is loaded
  // first, so these listeners only reflect its completed selection.
  for (const tab of tabs) {
    tab.addEventListener('click', () => sync());
    tab.addEventListener('keydown', () => sync());
  }
  sync(false);
})();
