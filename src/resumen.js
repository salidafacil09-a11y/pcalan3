// El resumen de la carrera de Retorno: al terminarla (venciendo al jefe final, cayendo o abandonándola a mitad de
// un enfrentamiento). Quién la jugó y en qué dificultad, el camino que siguió (cada tramo: enfrentamiento, descanso,
// comerciante, suceso, el faro y el jefe; dónde cayó), los números (puntaje, infectados, tiempo de combate, cabeza,
// precisión, cuerpo a cuerpo, remates y daño), lo de los descansos (hallazgos y hojas de la bitácora), las marcas
// nuevas (de esa dificultad) y la experiencia del personaje. Los datos los da G.Run.summary(); lo enseña main.js.
// Se cierra con Continuar (o Aceptar / Escape, o A / B con el mando).
(function (G) {
  'use strict';
  const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const S = (p) => '<svg viewBox="0 0 20 20" aria-hidden="true">' + p + '</svg>';
  const IC = {
    enc: S('<path d="M4 16 L14.5 5.5 M12 4 L16 8 M16 16 L5.5 5.5 M8 4 L4 8 M3.5 13.5 L6.5 16.5 M16.5 13.5 L13.5 16.5"/>'),
    descanso: S('<path d="M10 3.5 Q14 8 12.5 11 Q12 9 10 8.5 Q11 11 9 12.5 Q7 11 8 8.5 Q5.5 11 7.5 14 M4 16.5 L16 13.5 M4 13.5 L16 16.5"/>'),
    mercader: S('<path d="M5 7 H15 L14 16.5 H6 Z M7.5 7 Q7.5 3.5 10 3.5 Q12.5 3.5 12.5 7"/>'),
    suceso: S('<path d="M7.5 7 Q7.5 4 10 4 Q12.5 4 12.5 6.5 Q12.5 8.5 10 9.5 V11.5 M10 14.5 V15.5"/>'),
    faro: S('<path d="M8 17 L8.8 7 H11.2 L12 17 Z M8 7 H12 M8.5 7 V4.5 H11.5 V7 M10 4.5 V3 M3 5 L7.5 5.8 M17 5 L12.5 5.8"/>'),
    boss: S('<path d="M10 3.5 Q15.5 3.5 15.5 9 Q15.5 12 13 13 V16 H7 V13 Q4.5 12 4.5 9 Q4.5 3.5 10 3.5 Z M7.5 8.5 H8.5 M11.5 8.5 H12.5 M9 16 V14 M11 16 V14"/>'),
    x: S('<circle cx="10" cy="10" r="8.5"/><path d="M6.8 6.8 L13.2 13.2 M13.2 6.8 L6.8 13.2"/>')
  };
  const KIND = { enc: 'enc', descanso: 'descanso', mercader: 'mercader', suceso: 'suceso', faro: 'faro', boss: 'boss' };
  let root = null, after = null, t0 = 0, raf = 0, padPrev = null;

  function fmtTime(sec) { sec = Math.round(sec || 0); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? h + ' h ' + m + ' min' : m + ' min ' + (s < 10 ? '0' : '') + s + ' s'; }
  const num = (v) => Math.round(v || 0).toLocaleString('es');

  function ensure() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'run-sum'; root.className = 'hidden';
    document.body.appendChild(root);
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.addEventListener('click', (e) => { if (e.target.closest('[data-rs="ok"]')) { e.preventDefault(); close(); } });
    document.addEventListener('keydown', (e) => {
      if (!after) return;
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); e.stopPropagation(); if (performance.now() - t0 > 600) close(); }
      else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { const b = root.querySelector('.rs-card'); if (b) b.scrollTop += e.code === 'ArrowDown' ? 60 : -60; e.preventDefault(); }
    }, true);
  }
  // el mando: A o B cierran; la cruceta, arriba y abajo, desplaza
  function pad() {
    raf = 0;
    if (!after) return;
    raf = requestAnimationFrame(pad);
    const ps = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = null; for (let i = 0; i < ps.length; i++) if (ps[i] && ps[i].connected) { p = ps[i]; break; }
    if (!p) return;
    const now = p.buttons.map((b) => !!(b && b.pressed));
    const prev = padPrev || now;
    padPrev = now;
    if (performance.now() - t0 < 600) return;
    if ((now[0] && !prev[0]) || (now[1] && !prev[1])) { close(); return; }
    const b = root.querySelector('.rs-card');
    if (b && now[13]) b.scrollTop += 8; if (b && now[12]) b.scrollTop -= 8;
  }

  function show(sm, done) {
    ensure();
    after = done || (() => {});
    t0 = performance.now(); padPrev = null;
    const t = sm.totals || {}, CH = G.Player && G.Player.CHARS ? G.Player.CHARS[sm.char] : null;
    const name = CH ? CH.name : (sm.char || '');
    const dn = G.Diff ? G.Diff.name(sm.diff) : sm.diff;
    const head = sm.how === 'win' ? (sm.daily ? 'Partida diaria completada' : 'Carrera completada')
      : (sm.how === 'quit' ? 'Carrera abandonada' : (sm.daily ? 'Partida diaria perdida' : 'La carrera termina'));
    const where = sm.how === 'win' ? 'Llegaste hasta el final' : (sm.step >= sm.steps ? 'Ante el jefe final' : 'En el tramo ' + Math.min(sm.steps, sm.step + 1) + ' de ' + sm.steps);
    // el camino: cada tramo, con su icono (y lo que quedó por hacer, en gris)
    const route = (sm.route || []).map((r) => '<li class="rs-n ' + (r.state === 'lost' ? 'lost' : 'done') + ' k-' + (KIND[r.kind] || 'enc') + '">' +
      '<i>' + (r.state === 'lost' ? IC.x : (IC[KIND[r.kind]] || IC.enc)) + '</i><b>' + esc(r.name) + '</b><small>' + esc(r.place || '') + (r.mod ? ' · ' + esc(r.mod) : '') + '</small></li>').join('');
    // (lo que quedó por recorrer: los tramos y el jefe)
    const slots = (sm.route || []).filter((r) => r.kind !== 'faro').length, left = sm.how === 'win' ? 0 : Math.max(0, sm.steps + 1 - slots);
    const rest = Array.from({ length: Math.min(left, 12) }, () => '<li class="rs-n todo"><i></i></li>').join('');
    const prec = (t.shots || 0) > 0 ? Math.round((t.hits || 0) / t.shots * 100) + ' %' : '—';
    const tiles = [['Puntaje', num(t.score), 'big'], ['Infectados', num(t.kills)], ['Tiempo de combate', fmtTime(t.time)], ['Disparos a la cabeza', num(t.head)],
      ['Precisión', prec], ['Cuerpo a cuerpo', num(t.melee)], ['Remates', num(t.exec)], ['En sigilo', num(t.stealth)], ['Daño recibido', num(t.hurt)]];
    const C = sm.calm || {};
    const cp = [];
    if (C.n) cp.push(C.n + (C.n === 1 ? ' descanso' : ' descansos') + ' · ' + C.found + ' de ' + C.total + ' hallazgos');
    if (sm.pages) cp.push(sm.pages + (sm.pages === 1 ? ' hoja' : ' hojas') + ' de la bitácora');
    if (C.faro) cp.push('<em>llegaste al faro</em>');
    const calm = cp.length ? '<p class="rs-calm">' + cp.join(' · ') + '</p>' : '';
    const recs = sm.newRec && sm.newRec.length ? '<div class="rs-recs"><h4>Marcas nuevas · ' + esc(dn) + '</h4><ul>' + sm.newRec.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul></div>' : '';
    const rk = sm.rank, rname = rk && G.Player && G.Player.CHARS[rk.char] ? G.Player.CHARS[rk.char].name : name;
    const rank = rk ? '<p class="rs-rank">' + esc(rname) + ': +' + rk.xp + ' de experiencia' + (rk.to > rk.from ? ' · <b>sube al rango ' + rk.to + '</b>' + (rk.text ? ' (' + esc(rk.text) + ')' : '') : ' · rango ' + rk.to) + '</p>' : '';
    root.innerHTML = '<div class="rs-card ' + (sm.how === 'win' ? 'win' : 'lost') + '">' +
      '<div class="rs-top"><small>' + esc(head.toUpperCase()) + ' · ' + esc(dn.toUpperCase()) + '</small><h2>' + esc(name) + '</h2><p class="rs-where">' + esc(where) + (sm.cause ? ' · ' + esc(sm.cause) : '') + '</p></div>' +
      '<ol class="rs-route">' + route + rest + '</ol>' +
      '<div class="rs-body"><div class="rs-grid">' + tiles.map((x) => '<div class="rs-t' + (x[2] ? ' ' + x[2] : '') + '"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>').join('') + '</div>' +
      '<div class="rs-side">' + calm + recs + rank + '<p class="rs-note">Fácil y Normal también cuentan para los logros y los desafíos. Las marcas de la clasificación van aparte, por dificultad.</p></div></div>' +
      '<div class="rs-ft"><button type="button" data-rs="ok">Continuar</button></div></div>';
    root.className = '';
    if (G.Audio && G.Audio.ui) G.Audio.ui('uiOk');
    if (!raf) raf = requestAnimationFrame(pad);
  }
  function close() {
    if (!after) return;
    const fn = after; after = null;
    root.className = 'hidden'; root.innerHTML = '';
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (G.Audio && G.Audio.ui) G.Audio.ui('uiBack');
    fn();
  }

  G.Summary = { show, close, get open() { return !!after; } };
})(window.Game = window.Game || {});
