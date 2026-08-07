// KineSys — shared site script
// Kept intentionally light: one IntersectionObserver for reveals,
// no layout-thrashing scroll listeners, respects reduced motion.

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Scroll reveal ----
  const reveals = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('visible'));
  } else {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    reveals.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i % 6, 5) * 60 + 'ms';
      obs.observe(el);
    });
  }

  // ---- Heatmap carousel: arrow-button scroll (native touch swipe already works) ----
  document.querySelectorAll('.heatmap-wrap').forEach((wrap) => {
    const track = wrap.querySelector('.heatmap-track');
    const left = wrap.querySelector('.heatmap-arrow.left');
    const right = wrap.querySelector('.heatmap-arrow.right');
    if (!track) return;
    const step = () => (track.querySelector('.heatmap-card')?.offsetWidth || 280) + 20;
    left?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: reduceMotion ? 'auto' : 'smooth' }));
    right?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: reduceMotion ? 'auto' : 'smooth' }));
  });
})();
