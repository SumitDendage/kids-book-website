(function () {
  var btn = document.getElementById('navMenuBtn');
  var drawer = document.getElementById('navDrawer');
  var scrim = document.getElementById('navScrim');
  if (!btn || !drawer) return;

  function open() {
    drawer.hidden = false;
    if (scrim) scrim.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('nav-drawer-open');
  }

  function close() {
    drawer.hidden = true;
    if (scrim) scrim.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-drawer-open');
  }

  function toggle() {
    if (drawer.hidden) open();
    else close();
  }

  btn.addEventListener('click', toggle);
  if (scrim) scrim.addEventListener('click', close);
  drawer.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', close);
  });
})();
