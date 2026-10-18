/* Chud Hud motion: sliding thumb for segmented controls. Respects reduced motion through CSS. */
(function () {
  function place(seg) {
    var on = seg.querySelector('button.on,button[aria-pressed="true"]');
    if (!on || !on.offsetWidth) return;
    seg.style.setProperty('--tx', on.offsetLeft + 'px');
    seg.style.setProperty('--tw', on.offsetWidth + 'px');
    seg.classList.add('ready');
  }
  function all() { document.querySelectorAll('.seg').forEach(place); }
  window.addEventListener('load', all);
  window.addEventListener('resize', all);
  document.addEventListener('click', function () { setTimeout(all, 0); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(all);
  all();
})();
