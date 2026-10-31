'use strict';

function setupTabs(tablist) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  if (tablist.classList.contains('control-tabs')) {
    const narrowLayout = window.matchMedia('(max-width: 800px)');
    const updateOrientation = () => {
      const horizontal = tablist.getAttribute('data-layout') === 'horizontal' || narrowLayout.matches;
      tablist.setAttribute('aria-orientation', horizontal ? 'horizontal' : 'vertical');
    };
    updateOrientation();
    narrowLayout.addEventListener('change', updateOrientation);
  }
  function select(tab, focus = false) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    }
    if (focus) tab.focus();
  }
  const controller = { tabs, select, onUserSelect: null };
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => {
      controller.onUserSelect?.(tab);
      select(tab);
    });
    tab.addEventListener('keydown', event => {
      const vertical = tablist.getAttribute('aria-orientation') === 'vertical';
      const next = vertical ? 'ArrowDown' : 'ArrowRight';
      const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
      let target;
      if (event.key === next) target = tabs[(index + 1) % tabs.length];
      if (event.key === previous) target = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === 'Home') target = tabs[0];
      if (event.key === 'End') target = tabs.at(-1);
      if (target) {
        event.preventDefault();
        controller.onUserSelect?.(target);
        select(target, true);
      }
    });
  }
  return controller;
}
const tabControllers = [...document.querySelectorAll('[role="tablist"]')].map(setupTabs);
