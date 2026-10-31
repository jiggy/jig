'use strict';

(() => {
  const start = document.getElementById('start');
  if (!start) return;
  const tabs = [...start.querySelectorAll('.setup-tabs [role="tab"]')];
  const button = document.getElementById('copy-start');
  const status = document.getElementById('copy-status');
  const label = button?.querySelector('span');
  if (!tabs.length || !button || !status || !label) return;
  let panelId = '';
  let feedbackVersion = 0;
  let resetTimer = null;
  let pending = false;

  function selected() {
    const tab = tabs.find(item => item.getAttribute('aria-selected') === 'true');
    const pane = tab && document.getElementById(tab.getAttribute('aria-controls'));
    const content = pane?.querySelector('[data-setup-copy]');
    return content ? { id: pane.id, content, name: content.dataset.setupCopy === 'prompt' ? 'Agent setup instructions' : 'Terminal setup commands' } : null;
  }
  function resetFeedback() {
    feedbackVersion += 1;
    if (resetTimer !== null) window.clearTimeout(resetTimer);
    resetTimer = null;
    label.textContent = 'Copy';
  }
  function sync() {
    const value = selected();
    if (!value || panelId === value.id) return;
    panelId = value.id;
    resetFeedback();
    status.textContent = '';
    button.setAttribute('aria-label', `Copy ${value.name.charAt(0).toLowerCase() + value.name.slice(1)}`);
  }
  // app.js owns tab selection and keyboard navigation; reflect its completed change.
  for (const tab of tabs) {
    tab.addEventListener('click', sync);
    tab.addEventListener('keydown', sync);
  }
  button.addEventListener('click', async () => {
    if (pending) return;
    const value = selected();
    if (!value) return;
    resetFeedback();
    const version = feedbackVersion;
    const raw = value.content.textContent.trim();
    const text = value.content.dataset.setupCopy === 'commands' ? raw.replace(/^\$ /gm, '') : raw;
    pending = true;
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(text);
      if (version === feedbackVersion) {
        label.textContent = 'Copied';
        status.textContent = `${value.name} copied.`;
      }
    } catch {
      if (version === feedbackVersion) {
        const range = document.createRange();
        range.selectNodeContents(value.content);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        label.textContent = 'Select & copy';
        status.textContent = `Copy is unavailable. ${value.name} selected for manual copying.`;
      }
    } finally {
      pending = false;
      button.disabled = false;
    }
    if (version === feedbackVersion) resetTimer = window.setTimeout(() => {
      if (version === feedbackVersion) label.textContent = 'Copy';
      resetTimer = null;
    }, 2200);
  });
  sync();
})();
