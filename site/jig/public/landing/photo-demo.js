'use strict';

(() => {
  const scene = document.getElementById('photo-demo');
  const stage = scene?.querySelector('.photo-motion-stage');
  if (!stage) return;
  const photos = [...stage.querySelectorAll('.photo-card')];
  const labels = [...stage.querySelectorAll('.photo-album-caption')];
  const buttons = [...scene.querySelectorAll('[data-photo-view]')];
  const hint = scene.querySelector('.photo-motion-hint');
  if (photos.length !== 6 || buttons.length !== 3) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hasFrames = typeof window.requestAnimationFrame === 'function' && typeof window.cancelAnimationFrame === 'function';
  const hasObserver = typeof window.IntersectionObserver === 'function';
  const gatherTime = 1100;
  const composeTime = 1200;
  const cycle = [
    { name: 'photos', from: 0, to: 0, duration: 1400 },
    { name: 'gather', from: 0, to: 1, duration: gatherTime },
    { name: 'albums', from: 1, to: 1, duration: 2200 },
    { name: 'compose', from: 1, to: 2, duration: composeTime },
    { name: 'yearbook', from: 2, to: 2, duration: 4000 },
    { name: 'unfold', from: 2, to: 1, duration: 1000 },
    { name: 'albums-return', from: 1, to: 1, duration: 600 },
    { name: 'scatter', from: 1, to: 0, duration: 750 },
  ];
  let progress = 2;
  let sequence = [];
  let segmentIndex = 0;
  let elapsed = 0;
  let manual = false;
  let manualTarget = null;
  let activeInView = !hasObserver;
  let pageVisible = document.visibilityState !== 'hidden';
  let frame = null;
  let frameVersion = 0;
  let previousTime = null;
  let lastPaint = '';

  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };
  const ease = value => {
    const t = clamp(value);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };
  const currentSegment = () => sequence[segmentIndex];

  function paint() {
    const segment = currentSegment();
    const phase = segment ? manual ? 'manual' : segment.name : 'settled';
    const signature = [progress.toFixed(5), phase, manual, manualTarget, reducedMotion.matches].join('|');
    if (signature === lastPaint) return;
    lastPaint = signature;
    const albumProgress = clamp(progress);
    const bookProgress = clamp(progress - 1);
    for (const photo of photos) {
      const group = Number(photo.dataset.group);
      const pair = Number(photo.dataset.pair);
      // The original scatter-to-albums path and stagger remain unchanged.
      const gathered = ease((albumProgress * gatherTime - group * 120 - pair * 40) / 820);
      const composed = ease((bookProgress * composeTime - group * 70 - pair * 40) / 960);
      photo.style.setProperty('--card-progress', gathered.toFixed(5));
      photo.style.setProperty('--book-progress', composed.toFixed(5));
    }
    for (const label of labels) {
      const end = (Number(label.dataset.group) * 120 + 40 + 820) / gatherTime;
      const opacity = smooth((albumProgress - end + 0.14) / 0.14) * (1 - smooth(bookProgress / 0.22));
      label.style.setProperty('--label-opacity', opacity.toFixed(5));
    }
    stage.style.setProperty('--filename-opacity', (1 - smooth(albumProgress / 0.18)).toFixed(5));
    stage.style.setProperty('--book-opacity', smooth((bookProgress - 0.08) / 0.6).toFixed(5));
    stage.style.setProperty('--book-copy-opacity', smooth((bookProgress - 0.62) / 0.3).toFixed(5));
    stage.dataset.progress = progress.toFixed(5);
    stage.dataset.phase = phase;
    const selection = manualTarget ?? segment?.to ?? (Number.isInteger(progress) ? progress : null);
    for (const button of buttons) button.setAttribute('aria-pressed', String(Number(button.dataset.photoView) === selection));
    if (hint) hint.textContent = reducedMotion.matches || !hasFrames || !hasObserver
      ? 'Choose Photos, Albums or Yearbook to explore.'
      : manual ? 'Preview paused · Choose a phase to explore.'
        : 'Auto preview · Choose a phase to pause.';
  }

  function pause() {
    frameVersion += 1;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
  }
  function mayRun() {
    return hasFrames && !!currentSegment() && !reducedMotion.matches && activeInView && pageVisible && stage.isConnected;
  }
  function requestFrame() {
    if (frame !== null || !mayRun()) return;
    const version = frameVersion;
    frame = window.requestAnimationFrame(time => {
      if (version !== frameVersion) return;
      frame = null;
      tick(time);
    });
  }
  function tick(time) {
    if (!mayRun()) { previousTime = null; return; }
    const delta = previousTime === null ? 0 : Math.min(100, Math.max(0, time - previousTime));
    previousTime = time;
    elapsed += delta;
    let segment = currentSegment();
    while (segment && elapsed >= segment.duration) {
      elapsed -= segment.duration;
      progress = segment.to;
      segmentIndex += 1;
      if (!manual && segmentIndex === sequence.length) segmentIndex = 0;
      segment = currentSegment();
    }
    if (segment) progress = segment.from + (segment.to - segment.from) * clamp(elapsed / segment.duration);
    paint();
    requestFrame();
  }
  function takeControl(target = null) {
    pause();
    manual = true;
    manualTarget = target;
    sequence = [];
    segmentIndex = 0;
    elapsed = 0;
    if (target !== null) {
      if (reducedMotion.matches || !hasFrames || Math.abs(target - progress) < 0.00001) progress = target;
      else {
        // Crossing Albums follows both legs, including when the user reverses in flight.
        const stops = [progress];
        if ((progress < 1 && target > 1) || (progress > 1 && target < 1)) stops.push(1);
        stops.push(target);
        sequence = stops.slice(1).map((to, index) => {
          const from = stops[index];
          const onBookLeg = Math.max(from, to) > 1;
          const speed = to > from ? onBookLeg ? composeTime : gatherTime : onBookLeg ? 1000 : 750;
          return { from, to, duration: Math.max(140, Math.abs(to - from) * speed) };
        });
      }
    }
    paint();
    requestFrame();
  }

  for (const button of buttons) button.addEventListener('click', () => takeControl(Number(button.dataset.photoView)));
  scene.addEventListener('focusin', () => { if (!manual) takeControl(); });
  document.addEventListener('visibilitychange', () => {
    pageVisible = document.visibilityState !== 'hidden';
    if (pageVisible) requestFrame();
    else pause();
  });
  window.addEventListener('pagehide', () => { pageVisible = false; pause(); });
  window.addEventListener('pageshow', () => {
    pageVisible = document.visibilityState !== 'hidden';
    requestFrame();
  });
  reducedMotion.addEventListener('change', event => {
    pause();
    sequence = [];
    segmentIndex = 0;
    elapsed = 0;
    if (event.matches) progress = manualTarget ?? 2;
    else if (!manual && hasFrames && hasObserver) { progress = 0; sequence = cycle; }
    paint();
    requestFrame();
  });

  if (!reducedMotion.matches && hasFrames && hasObserver) { progress = 0; sequence = cycle; }
  paint();
  if (hasObserver) {
    const observer = new window.IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === stage);
      if (!entry) return;
      if (!entry.isIntersecting || entry.intersectionRatio <= 0) activeInView = false;
      else if (entry.intersectionRatio >= 0.55) activeInView = true;
      if (activeInView) requestFrame();
      else pause();
    }, { threshold: [0, 0.55] });
    observer.observe(stage);
  }
})();
