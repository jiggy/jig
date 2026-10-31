'use strict';

(() => {
  const scenes = [...document.querySelectorAll('[data-sample-motion]')];
  if (!scenes.length) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hasFrames = typeof window.requestAnimationFrame === 'function' && typeof window.cancelAnimationFrame === 'function';
  const hasObserver = typeof window.IntersectionObserver === 'function';
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
  const ease = value => { const t = clamp(value); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const cycle = [
    { from: 0, to: 0, duration: 1800, name: 'before' },
    { from: 0, to: 1, duration: 1600, name: 'arrange' },
    { from: 1, to: 1, duration: 4300, name: 'after' },
    { from: 1, to: 0, duration: 1250, name: 'return' },
  ];
  let frame = null;
  let frameVersion = 0;
  let previousTime = null;
  let pageVisible = document.visibilityState !== 'hidden';

  const controllers = scenes.flatMap(scene => {
    const stage = scene.querySelector('.sm-stage');
    const items = [...scene.querySelectorAll('[data-sm-item]')];
    const buttons = [...scene.querySelectorAll('[data-sample-view]')];
    const hint = scene.querySelector('[data-sm-hint]');
    if (!stage || !items.length || buttons.length !== 2) return [];
    return [{ scene, stage, items, buttons, hint, progress: 1, segmentIndex: 0, elapsed: 0,
      manual: false, target: null, active: !hasObserver, sequence: [], painted: '' }];
  });

  function paint(state) {
    const segment = state.sequence[state.segmentIndex];
    const phase = segment ? state.manual ? 'manual' : segment.name : 'settled';
    const key = [state.progress.toFixed(5), phase, state.manual, state.target, reduced.matches].join('|');
    if (state.painted === key) return;
    state.painted = key;
    const p = clamp(state.progress);
    state.stage.style.setProperty('--sm-progress', p.toFixed(5));
    state.stage.style.setProperty('--sm-source-opacity', (1 - smooth(p / .34)).toFixed(5));
    state.stage.style.setProperty('--sm-after-opacity', smooth((p - .28) / .32).toFixed(5));
    state.stage.style.setProperty('--sm-grid-opacity', smooth((p - .1) / .3).toFixed(5));
    state.stage.style.setProperty('--sm-result-opacity', smooth((p - .57) / .34).toFixed(5));
    state.stage.style.setProperty('--sm-draft-opacity', smooth((p - .76) / .24).toFixed(5));
    for (const item of state.items) {
      const delay = Math.max(0, Number(item.dataset.smOrder) || 0) * 60;
      const travelled = ease((p * 1600 - delay) / (1600 - delay));
      item.style.setProperty('--sm-move', travelled.toFixed(5));
    }
    state.stage.dataset.progress = p.toFixed(5);
    state.stage.dataset.phase = phase;
    const selected = state.target ?? segment?.to ?? (p === 0 ? 0 : p === 1 ? 1 : null);
    for (const button of state.buttons) button.setAttribute('aria-pressed', String(Number(button.dataset.sampleView) === selected));
    if (state.hint) state.hint.textContent = reduced.matches || !hasFrames || !hasObserver
      ? 'Choose Before or After to explore.'
      : state.manual ? 'Preview paused · Choose a view to explore.'
        : 'Auto preview · Choose a view to pause.';
  }
  function mayRun(state) {
    return hasFrames && !reduced.matches && pageVisible && state.active && state.stage.isConnected
      && !state.scene.closest('[hidden]') && !!state.sequence[state.segmentIndex];
  }
  function cancel() {
    frameVersion += 1;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
  }
  function requestFrame() {
    if (frame !== null || !controllers.some(mayRun)) return;
    const version = frameVersion;
    frame = window.requestAnimationFrame(time => {
      if (version !== frameVersion) return;
      frame = null;
      tick(time);
    });
  }
  function tick(time) {
    const delta = previousTime === null ? 0 : Math.min(100, Math.max(0, time - previousTime));
    previousTime = time;
    for (const state of controllers) {
      if (!mayRun(state)) continue;
      state.elapsed += delta;
      let segment = state.sequence[state.segmentIndex];
      while (segment && state.elapsed >= segment.duration) {
        state.elapsed -= segment.duration;
        state.progress = segment.to;
        state.segmentIndex += 1;
        if (!state.manual && state.segmentIndex === state.sequence.length) state.segmentIndex = 0;
        segment = state.sequence[state.segmentIndex];
      }
      if (segment) state.progress = segment.from + (segment.to - segment.from) * clamp(state.elapsed / segment.duration);
      paint(state);
    }
    if (!controllers.some(mayRun)) previousTime = null;
    requestFrame();
  }
  function takeControl(state, target = null) {
    cancel();
    state.manual = true;
    state.target = target;
    state.sequence = [];
    state.segmentIndex = 0;
    state.elapsed = 0;
    if (target !== null) {
      if (reduced.matches || !hasFrames || Math.abs(state.progress - target) < .00001) state.progress = target;
      else state.sequence = [{ from: state.progress, to: target, duration: Math.max(140, Math.abs(target - state.progress) * (target > state.progress ? 1600 : 1250)), name: 'manual' }];
    }
    paint(state);
    requestFrame();
  }
  for (const state of controllers) {
    if (!reduced.matches && hasFrames && hasObserver) { state.progress = 0; state.sequence = cycle; }
    paint(state);
    for (const button of state.buttons) button.addEventListener('click', () => takeControl(state, Number(button.dataset.sampleView)));
    state.scene.addEventListener('focusin', () => { if (!state.manual) takeControl(state); });
  }
  if (hasObserver) {
    const observer = new window.IntersectionObserver(entries => {
      cancel();
      for (const entry of entries) {
        const state = controllers.find(candidate => candidate.stage === entry.target);
        if (!state) continue;
        if (!entry.isIntersecting || entry.intersectionRatio <= 0) state.active = false;
        else if (entry.intersectionRatio >= .55) state.active = true;
      }
      requestFrame();
    }, { threshold: [0, .55] });
    for (const state of controllers) observer.observe(state.stage);
  }
  document.addEventListener('visibilitychange', () => {
    pageVisible = document.visibilityState !== 'hidden';
    cancel();
    requestFrame();
  });
  window.addEventListener('pagehide', () => { pageVisible = false; cancel(); });
  window.addEventListener('pageshow', () => { pageVisible = document.visibilityState !== 'hidden'; cancel(); requestFrame(); });
  reduced.addEventListener('change', event => {
    cancel();
    for (const state of controllers) {
      state.sequence = [];
      state.segmentIndex = 0;
      state.elapsed = 0;
      if (event.matches) state.progress = state.target ?? 1;
      else if (!state.manual && hasFrames && hasObserver) { state.progress = 0; state.sequence = cycle; }
      paint(state);
    }
    requestFrame();
  });
})();
