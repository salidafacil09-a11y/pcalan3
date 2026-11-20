(function (G) {
  'use strict';

  const DEBUG = location.search.indexOf('debug') !== -1;
  const LOW = G.Input.isTouch;            // móviles: sin antialias de fábrica (lo demás lo decide la calidad)
  const Q = G.Quality;
  const FOG = 0xaeb7b8;

  let renderer, scene, camera, player, sun, hemi;
  let state = 'menu';                     // menu | loading | playing | paused | dead | over
  let last = 0;
  let target = null, lootT = null, vaultT = null;
  // Opciones (inicio y pausa): abrir puertas al correr (y saltar ventanas abiertas y vallas)
  const OPT_KEY = 'ceniza.autopuertas';
  // Pruebas de desarrollador: todas las armas (y munición sin fin) y un botón para sacar zombis
  const DEV_KEY = 'ceniza.dev';
  let devMode = (() => { try { return localStorage.getItem(DEV_KEY) === '1'; } catch (e) { return false; } })();
  G.DEV = devMode;
  // contador de rendimiento (solo en el modo desarrollador, o con ?debug en la dirección)
  const PERF_KEY = 'ceniza.contador';
  let perfPref = (() => { try { return localStorage.getItem(PERF_KEY) === '1'; } catch (e) { return false; } })();
  let perfOn = DEBUG || (devMode && perfPref);
  let autoDoors = (() => { try { return localStorage.getItem(OPT_KEY) !== '0'; } catch (e) { return true; } })();
  // correr quita la mira (opción de Controles): apagada de serie
  const RUNAIM_KEY = 'ceniza.correrMira';
  let runDropsAim = (() => { try { return localStorage.getItem(RUNAIM_KEY) === '1'; } catch (e) { return false; } })();
  function setRunDropsAim(v) { runDropsAim = !!v; try { localStorage.setItem(RUNAIM_KEY, runDropsAim ? '1' : '0'); } catch (e) { /* nada */ } }
  // subtítulos de combate (arriba a la izquierda: sigilo, estado, «te persigue...») y consejos (avisos de arriba
  // al centro). Sin consejos solo salen los avisos urgentes (los rojos)
  const SUBS_KEY = 'ceniza.subtitulos', TIPS_KEY = 'ceniza.consejos';
  const OUTL_KEY = 'ceniza.contorno';
  let showOutline = (() => { try { return localStorage.getItem(OUTL_KEY) !== '0'; } catch (e) { return true; } })();
  if (G.Models) G.Models.outlineOff = !showOutline;
  let showSubs = (() => { try { return localStorage.getItem(SUBS_KEY) !== '0'; } catch (e) { return true; } })();
  let showTips = (() => { try { return localStorage.getItem(TIPS_KEY) !== '0'; } catch (e) { return true; } })();
  // ocultar los botones táctiles (jugando con mando en el móvil)
  const TBTN_KEY = 'ceniza.sinbotones';
  let hideBtns = (() => { try { return localStorage.getItem(TBTN_KEY) === '1'; } catch (e) { return false; } })();
  document.body.classList.toggle('no-tbtn', hideBtns);
  // opacidad de los botones táctiles (100: como siempre; 0: invisibles, siguen funcionando)
  const TBOP_KEY = 'ceniza.botonesop';
  let btnOp = (() => { try { const v = localStorage.getItem(TBOP_KEY); return v == null ? 100 : Math.max(0, Math.min(100, +v || 0)); } catch (e) { return 100; } })();
  const applyBtnOp = () => document.documentElement.style.setProperty('--tbop', String(btnOp / 100));
  applyBtnOp();
  // paredes que tapan al personaje: se vuelven transparentes (opción de Imagen)
  const SEE_KEY = 'ceniza.paredesver';
  let seeThru = (() => { try { return localStorage.getItem(SEE_KEY) === '1'; } catch (e) { return false; } })();
  // estela del arma en los golpes cuerpo a cuerpo (Gráficos): encendida de serie
  const TRAIL_KEY = 'ceniza.estela';
  let trailOn = (() => { try { return localStorage.getItem(TRAIL_KEY) !== '0'; } catch (e) { return true; } })();
  function setTrail(v) { trailOn = !!v; try { localStorage.setItem(TRAIL_KEY, trailOn ? '1' : '0'); } catch (e) { /* nada */ } }
  document.body.classList.toggle('no-subs', !showSubs);
  // Cámara: «Dinámica» (por defecto) o «Fija», y el zoom a gusto (-40 a +40 %)
  const CAM_KEY = 'ceniza.camara', ZOOM_KEY = 'ceniza.zoom';
  const CHAR_KEY = 'ceniza.personaje';
  const camPref = (() => { try { return { mode: localStorage.getItem(CAM_KEY) || 'dinamica', pct: +(localStorage.getItem(ZOOM_KEY) || 0) }; } catch (e) { return { mode: 'dinamica', pct: 0 }; } })();
  let aimed = null;          // zombi resaltado con el contorno amarillo
  let kills = 0, survived = 0, deadT = 0;
  let baseFov = 60, scopedNow = false, scopeHint = false;
  let grabT = null;          // zombi que se puede agarrar por la espalda
  let pickT = null;          // objeto suelto al alcance
  let lootHoldT = 0, lootHoldDone = false;   // mantener Recoger
  let execT = null;          // infectado aturdido al alcance (se puede rematar)
  // modo de juego: 'retorno' (carrera: refugio y enfrentamientos), 'practica' (mapa libre de pruebas) o
  // 'asalto' (un enfrentamiento suelto, para pruebas)
  let gameMode = 'retorno';
  let pendingToast = null;   // aviso que espera a que se quite la pantalla de carga
  const el = (id) => document.getElementById(id);

  function fatal(msg) {
    // (sin WebGL, por ejemplo): el aviso a pantalla completa
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;padding:24px;background:#050606;color:#e9e6dc;font:15px system-ui;text-align:center';
    d.textContent = msg; document.body.appendChild(d);
  }

  function init() {
    if (typeof THREE === 'undefined') { fatal('No se pudo cargar Three.js. Revisa tu conexión y recarga la página.'); return; }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
    } catch (e) { fatal('Tu navegador no admite WebGL, necesario para jugar.'); return; }
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = LOW ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    el('game').appendChild(renderer.domElement);
    applyColor();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(FOG).convertSRGBToLinear();
    scene.fog = new THREE.Fog(scene.background.getHex(), 16, 58);

    hemi = new THREE.HemisphereLight(0xd6e0e4, 0x4f4a3c, 0.62);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 1.25);
    sun.castShadow = true;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    scene.add(sun.target);
    renderer.info.autoReset = false;          // (el contador suma todo el fotograma; se pone a cero en el bucle)
    if (G.ShadowCache) G.ShadowCache.init(renderer, sun);

    camera = new THREE.PerspectiveCamera(62, 1, 0.05, 95);
    G.Camera.init(camera);
    G.Camera.setZoom('dinamica', camPref.pct);      // la cámara ya no se elige: siempre dinámica

    G.Input.init(renderer.domElement);
    G.World.init(scene, newSeed());
    G.World.reset(currentSeed);
    G.Population.init(scene);
    if (G.Flash) G.Flash.init(scene);
    player = new G.Player(scene);
    try { const ch = localStorage.getItem(CHAR_KEY); if (ch) player.setCharacter(ch); } catch (e) { /* nada */ }
    document.querySelectorAll('button[data-char]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      player.setCharacter(b.dataset.char);
      try { localStorage.setItem(CHAR_KEY, player.charId); } catch (er) { /* nada */ }
      document.querySelectorAll('button[data-char]').forEach((x) => x.classList.toggle('on', x.dataset.char === player.charId));
    }));
    document.querySelectorAll('button[data-char]').forEach((x) => x.classList.toggle('on', x.dataset.char === player.charId));
    G.World.setSpawnCheck((id) => !!player.spotFor(id));
    refreshWorld(true, 0);

    G.Guns.init(scene);
    G.Guns.onMessage = toast;
    G.Pickups.init(scene);
    if (G.BossFx) G.BossFx.init(scene);
    G.Pickups.onMessage = toast;
    G.Mode.init(scene, player);
    G.Mode.onMessage = toast;
    if (G.Humans) { G.Humans.init(scene); G.Humans.onMessage = toast; }
    G.Mode.onFade = (to, dur) => fadeTo(to, dur);
    G.Mode.onFinish = (win, total) => {
      state = 'over';
      G.Input.enabled = false;
      if (document.exitPointerLock) document.exitPointerLock();
      setupStatsButtons(win, total);
    };
    G.Refugio.init(scene, player, camera);
    G.Refugio.onMessage = toast;
    G.Refugio.onStartEncounter = (i) => startEncounter(i);
    G.Refugio.onStartCalm = (i) => startCalm(i);
    G.Refugio.onTravel = (id, o) => travelTo(id, false, o);
    G.Refugio.onFinishRun = () => finishRun();
    // el modo supervivencia (G.Surv): lo que necesita para cambiar de zona, fundir a negro y volver al modo libre
    if (G.Surv) G.Surv.init({
      get scene() { return scene; }, get player() { return player; },
      toast: (t, k) => toast(t, k),
      // lazy: el mapa se arma poco a poco, cada fotograma (mientras se conduce o se sube la persiana)
      map(id, lazy) { resetWorld(id, lazy); setLighting(id); },
      place(x, z, face, lazy) {
        player.pos.x = x; player.pos.z = z; player.lv = 0; player.y = G.World.groundY(x, z, 0);
        if (player.vel) { player.vel.x = 0; player.vel.z = 0; }
        player.facing = face || 0; G.Camera.yaw = face || 0; G.Camera.pitch = 0.08;
        refreshWorld(!lazy, 0);
      },
      get camera() { return camera; }, get hemi() { return hemi; }, get sun() { return sun; },
      // un corte a negro corto (subir o bajar del coche): sin esperar a que esté todo armado
      cut(work, done) {
        if (state !== 'playing') return;
        state = 'loading';
        G.Input.enabled = false;
        fadeTo(1, 0.4);
        setTimeout(() => {
          try { work(); } catch (e) { console.error(e); }
          state = 'playing';
          G.Input.enabled = true; G.Input.clear();
          fadeTo(0, 0.7);
          if (done) done();
        }, 450);
      },
      // lo que falta del mapa (por partes) y de los cuerpos de los infectados: un poco cada fotograma
      buildStep(dt) {
        G.World.update(player.pos.x, player.pos.z, false, dt || 0);
        const P = G.Zombie.pool;
        if (P && P.missing()) P.step(6);
      },
      needPool: () => poolNeeds(),
      poolStep() { const P = G.Zombie.pool; if (P && P.missing()) P.step(6); },
      ready: () => loadReady() && G.World.buildPending === 0,
      peace(on) { G.Combat.peaceful = !!on; },
      fade: (to, dur) => fadeTo(to, dur),
      shift: (work, done) => survShift(work, done),
      load: (work, done, min) => survLoad(work, done, min),
      clearZombies: () => clearPop(false),
      setMode(m) { gameMode = m; document.body.classList.remove('practica', 'asalto', 'refugio'); document.body.classList.toggle('superv', m === 'superv'); },
      backToFree: (pc) => survBackToFree(pc)
    });
    G.Loot.onMessage = (m, fail) => toast(m, fail ? 'warn' : 'good');
    G.Combat.onMessage = toast;
    G.Guns.onHit = (res, crit) => G.Combat.onHit(res, crit);
    G.Combat.onHit = (res, crit) => {
      if (res === 'kill') kills++;
      const h = el('hitmark');
      h.className = 'on' + (crit ? ' crit' : '');
      clearTimeout(h._t);
      h._t = setTimeout(() => { h.className = ''; }, 140);
    };

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 250));
    document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) lockLandscape(); });
    // el primer toque en cualquier sitio (menús incluidos) ya pide pantalla completa y horizontal
    window.addEventListener('pointerdown', () => { if (G.Input.isTouch && !(document.fullscreenElement || document.webkitFullscreenElement)) tryFullscreen(); }, true);
    checkOrientation();
    applyQuality();
    Q.onChange((msg) => { applyQuality(); if (msg && state === 'playing') toast(msg); });
    setupQualityMenu();
    if (G.Sky && G.Sky.init) G.Sky.init(scene);
    if (G.Sky) G.Sky.onMessage = (t) => { if (state === 'playing' && gameMode !== 'menu') toast(t); };

    // atajos ocultos (pruebas): empiezan sin pasar por los menús
    el('btn-start').addEventListener('click', () => { G.Menus.hide(); start('asalto'); });
    el('btn-practice').addEventListener('click', () => { G.Menus.hide(); start('practica'); });
    el('btn-retry').addEventListener('click', retry);
    el('btn-again').addEventListener('click', () => { if (gameMode === 'retorno') backToRefuge(); else retry(); });
    el('btn-menu').addEventListener('click', toMenu);
    el('btn-menu2').addEventListener('click', () => { if (pendingSum) { const sm = pendingSum; pendingSum = null; el('dead').classList.add('hidden'); showSum(sm, toMenu); } else toMenu(); });
    if (G.PauseMenu) G.PauseMenu.init();
    // práctica libre: botón «+ Zombi» (y la tecla N) que abre la lista de zombis para sacar
    document.body.classList.toggle('dev', devMode);
    const zs = el('btn-zspawn'), zl = el('zspawn-list');
    if (zs) {
      zs.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (!(G.HudEdit && G.HudEdit.editing)) toggleSpawnList(); });
      zs.addEventListener('click', (e) => e.preventDefault());
    }
    // (los mapas ya no van aquí: se eligen en el panel de los mapas, en una pared)
    if (zl) zl.querySelectorAll('button[data-z]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); devSpawnZombie(b.dataset.z); toggleSpawnList(false); });
      b.addEventListener('click', (e) => e.preventDefault());
    });
    // con la lista abierta, 1, 2 y 3 eligen (antes de que lleguen al cambio de arma)
    window.addEventListener('keydown', (e) => {
      if (!zl || zl.classList.contains('hidden')) return;
      const k = { Digit1: 'runner', Digit2: 'blind', Digit3: 'temb', Digit4: 'stalker', Digit5: 'hongo', Digit6: 'nemi', Digit7: 'escuadron', Numpad1: 'runner', Numpad2: 'blind', Numpad3: 'temb', Numpad4: 'stalker', Numpad5: 'hongo', Numpad6: 'nemi', Numpad7: 'escuadron' }[e.code];
      if (k) { devSpawnZombie(k); toggleSpawnList(false); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (e.code === 'Escape') { toggleSpawnList(false); e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyN' && gameMode === 'practica' && state === 'playing' && !e.repeat) toggleSpawnList();
      if (e.code === 'Enter' && !(G.HudEdit && G.HudEdit.editing)) {
        if (state === 'over') { if (gameMode === 'retorno') backToRefuge(); else retry(); }
        else if (state === 'dead') { if (gameMode === 'retorno') toMenu(); else retry(); }
        else if (state === 'paused' && !(G.PauseMenu && G.PauseMenu.handlesKeys)) resume();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      // abrir un mueble suelta el ratón para poder tocar el menú: eso no pausa
      if (!G.Input.isTouch && state === 'playing' && !G.Input.pointerLocked && !G.Loot.isOpen && !G.Backpack.isOpen && !G.Refugio.panelOpen && !(G.Surv && G.Surv.busy) && !player.dead && !(G.Menus && G.Menus.covering)) pause();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });

    G.HUD.init();
    G.HUD.onMessage = toast;
    G.Menus.init({
      onFirst() { if (G.Audio) G.Audio.unlock(); tryFullscreen(); },
      onConfirm() { if (G.Audio) G.Audio.unlock(); G.Input.requestLock(); },
      onStart(mode, charId, cont, chapter) {
        if (player.charId !== charId) player.setCharacter(charId);
        // (el personaje del modo historia no se guarda como el elegido: el menú vuelve con el de siempre)
        if (mode !== 'historia' && mode !== 'tutorial' && mode !== 'superv') { try { localStorage.setItem(CHAR_KEY, player.charId); } catch (e) { /* nada */ } }
        start(mode, cont, chapter);
      },
      onLoaded() {
        // modo historia: antes de ver nada, la pantalla negra con el año y el lugar
        if (storyPending) { const lines = storyPending; storyPending = null; storyCard(lines, () => { fadeTo(0, 1.8); G.Input.enabled = true; G.Input.clear(); if (G.Story) G.Story.begin(storyCh, player, storyCp); }); return; }
        fadeTo(1, 0); fadeTo(0, 1.1);
      }
    });
    tune();
    G.Backpack.onMessage = toast;
    if (G.HudEdit) G.HudEdit.init();
    document.body.classList.toggle('touch', !!G.Input.isTouch);
    syncPerf();
    requestAnimationFrame(loop);
  }

  let currentSeed = 0;
  function newSeed() {
    const m = /[?&]seed=(-?\d+)/.exec(location.search);
    currentSeed = m ? parseInt(m[1], 10) : Math.floor(Math.random() * 1000000);
    return currentSeed;
  }

  // Práctica libre: si hay más de MAX_FREE_CORPSES cadáveres, los más viejos que no se ven desaparecen
  const MAX_FREE_CORPSES = 5;
  const _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
  let corpseT = 0;
  function cleanCorpses(dt) {
    corpseT -= dt;
    if (corpseT > 0) return;
    corpseT = 0.5;
    const list = G.Population.list;
    let dead = 0;
    for (const z of list) if (!z.alive) dead++;
    if (dead <= MAX_FREE_CORPSES) return;
    camera.updateMatrixWorld();
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frus.setFromProjectionMatrix(_pm);
    for (let i = 0; i < list.length && dead > MAX_FREE_CORPSES; i++) {
      const z = list[i];
      if (z.alive || z.state === 'held' || (z.popT != null && !z.popped)) continue;
      _sph.center.set(z.pos.x, (z.y || 0) + 0.6, z.pos.z); _sph.radius = 1.3;
      if (_frus.intersectsSphere(_sph)) continue;           // a la vista: se queda
      if (player.action && player.action.target === z) continue;
      z.dispose();
      list.splice(i, 1); i--; dead--;
    }
  }

  function refreshWorld(immediate, dt) {
    G.World.update(player.pos.x, player.pos.z, immediate, dt);
    G.Population.update(player.pos.x, player.pos.z, dt);
    if (G.Phantoms && state === 'playing') G.Phantoms.tick(dt || 0, player, scene);
  }

  // ---------- Resolución (Opciones > Imagen) ----------
  // 'auto': la de la calidad (Baja 1x, Media 1,25x, Alta y Muy alta 2x, sin pasar de la pantalla) · un número: las
  // líneas del lado corto de la imagen (720 = 1280 x 720 en horizontal), sin pasar de la pantalla · 'nativa': todos
  // los píxeles de la pantalla. Lo demás de la imagen (la interfaz, los botones) se sigue viendo nítido
  const RES_KEY = 'ceniza.resolucion';
  const RES_OK = ['auto', '480', '540', '720', '900', '1080', 'nativa'];
  let resPref = (() => { try { const v = localStorage.getItem(RES_KEY); return RES_OK.indexOf(v) >= 0 ? v : 'auto'; } catch (e) { return 'auto'; } })();
  function basePR() {
    const dpr = window.devicePixelRatio || 1;
    if (resPref === 'nativa') return dpr;
    if (resPref === 'auto') return Math.min(dpr, Q.cur.pr);
    const short = Math.max(1, Math.min(window.innerWidth, window.innerHeight));
    return Math.max(0.35, Math.min(dpr, (+resPref) / short));
  }
  function pixelRatio() { return Math.max(0.35, basePR() * dynK); }

  // ---------- Resolución automática (Gráficos) ----------
  // Red de seguridad para los momentos pesados: si las imágenes tardan de más durante casi un segundo, la nitidez
  // baja un 10 % (como mucho hasta el 70 % de la elegida); cuando vuelve a sobrar tiempo un rato, sube de a 5 %.
  // Cada cambio de tamaño de la imagen cuesta un tirón pequeño: como mucho uno cada par de segundos
  const DYN_KEY = 'ceniza.resauto';
  let dynOn = (() => { try { return localStorage.getItem(DYN_KEY) !== '0'; } catch (e) { return true; } })();
  let dynK = 1;
  const dyn = { acc: 0, n: 0, t: 0, calm: 0, wait: 0 };
  function setDynRes(v) {
    dynOn = !!v;
    try { localStorage.setItem(DYN_KEY, dynOn ? '1' : '0'); } catch (e) { /* nada */ }
    if (!dynOn && dynK !== 1) { dynK = 1; resize(); }
    refreshQualityMenu();
  }
  function dynTick(ms) {
    if (!dynOn || state !== 'playing' || ms <= 0 || ms > 250) return;
    dyn.acc += ms; dyn.n++; dyn.t += ms;
    if (dyn.t < 800) return;
    const avg = dyn.acc / dyn.n;
    dyn.acc = dyn.n = dyn.t = 0;
    if (dyn.wait > 0) { dyn.wait--; return; }
    // con el límite de 30 fps, una imagen que va bien tarda 33 ms: ahí «lento» es pasar de 36
    const cap = Q.fps30, slow = cap ? 36 : 30, fast = cap ? 34.5 : 23;
    if (avg > slow && dynK > 0.701) { dynK = Math.max(0.7, dynK - 0.1); dyn.calm = 0; dyn.wait = 1; resize(); }
    else if (avg < fast && dynK < 1) {
      if (++dyn.calm >= (cap ? 6 : 3)) { dynK = Math.min(1, dynK + 0.05); dyn.calm = 0; dyn.wait = 1; resize(); }
    } else dyn.calm = 0;
  }

  // ---------- Prueba de rendimiento (modo desarrollador) ----------
  // 30 segundos con la cámara girando sola detrás del personaje (dos vueltas: mira hacia todos lados, como al
  // jugar). Mientras, no te mueves ni te hacen daño. Al final: el promedio, la peor imagen y cuántas pasan de 33 y de
  // 50 ms, con los triángulos y las llamadas de dibujo de media. Siempre igual: para comparar antes y después
  const BENCH_T = 30;
  const bench = { on: false, t: 0, ms: [], tris: 0, draws: 0, n: 0, x: 0, z: 0, safe: false, a0: 0 };
  function benchStart() {
    if (state === 'paused') resume();
    if (state !== 'playing' || player.dead) { toast('La prueba se hace jugando, en un mapa', 'warn'); return; }
    Object.assign(bench, { on: true, t: 0, tris: 0, draws: 0, n: 0, x: player.pos.x, z: player.pos.z, safe: !!player.storySafe, a0: (() => { const f = G.Camera.forward(); return Math.atan2(f.x, f.z); })() });
    bench.ms.length = 0;
    player.storySafe = true;
    G.Input.enabled = false;
    toast('Prueba de rendimiento: ' + BENCH_T + ' segundos, no toques nada', 'good');
  }
  // después de la cámara: la pone detrás del personaje, girando
  function benchCam() {
    const a = bench.a0 + (bench.t / BENCH_T) * Math.PI * 4;
    const fx = Math.sin(a), fz = Math.cos(a), py = (player.y || 0);
    camera.position.set(player.pos.x - fx * 3.2, py + 2.1, player.pos.z - fz * 3.2);
    camera.lookAt(player.pos.x + fx * 8, py + 1.2, player.pos.z + fz * 8);
    camera.updateMatrixWorld();
  }
  // al final del fotograma (ms: lo que tardó desde el anterior)
  function benchTick(ms) {
    if (!bench.on) return;
    if (state !== 'playing' || player.dead) { benchEnd(false); return; }
    bench.t += ms / 1000;
    if (bench.t > 1) {                                       // (el primer segundo no cuenta: acaba de cerrarse el menú)
      bench.ms.push(ms);
      const inf = renderer.info.render;
      bench.tris += inf.triangles; bench.draws += inf.calls; bench.n++;
    }
    if (bench.t >= BENCH_T + 1) benchEnd(true);
  }
  function benchEnd(done) {
    bench.on = false;
    player.storySafe = bench.safe;
    G.Input.enabled = true;
    if (!done || !bench.ms.length) { toast('Prueba de rendimiento cancelada', 'warn'); return; }
    const L = bench.ms, n = L.length, sum = L.reduce((a, b) => a + b, 0), avg = sum / n;
    const worst = Math.max.apply(null, L), slow = L.filter((v) => v > 34).length / n, vslow = L.filter((v) => v > 50).length / n;
    const srt = L.slice().sort((a, b) => a - b), p95 = srt[Math.min(n - 1, Math.floor(n * 0.95))];
    const SC = G.ShadowCache, d1 = (v) => v.toFixed(1).replace('.', ',');
    const mp = G.Maps && G.Maps.get(G.World.layout);
    const sh = !sun.castShadow ? 'sin sombras' : (SC && SC.stats.on ? 'sombras en capas' : 'sombras sin capas' + (SC && SC.why ? ' (' + SC.why + ')' : ''));
    const lines = [
      'Prueba de rendimiento · ' + (mp ? mp.name : G.World.layout),
      'Promedio: ' + d1(avg) + ' ms (' + Math.round(1000 / avg) + ' fps) · el 95 % por debajo de ' + Math.round(p95) + ' ms · peor: ' + Math.round(worst) + ' ms',
      'Lentas (más de 33 ms): ' + Math.round(slow * 100) + ' % · muy lentas (más de 50 ms): ' + Math.round(vslow * 100) + ' %',
      Math.round(bench.tris / Math.max(1, bench.n) / 1000) + 'k triángulos · ' + Math.round(bench.draws / Math.max(1, bench.n)) + ' dibujos · ' + sh,
      'Calidad ' + Q.cur.name + ' · resolución ' + resNow() + (dynK < 1 ? ' (automática al ' + Math.round(dynK * 100) + ' %)' : '') + ' · distancia ' + Q.distCur.name + (Q.fps30 ? ' · límite 30 fps' : '')
    ];
    console.log(lines.join('\n'));
    let box = document.getElementById('bench-res');
    if (!box) {
      box = document.createElement('div'); box.id = 'bench-res';
      box.innerHTML = '<pre></pre><button type="button">Cerrar</button>';
      document.body.appendChild(box);
      box.querySelector('button').addEventListener('click', (e) => { e.preventDefault(); box.classList.add('hidden'); });
      box.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    box.querySelector('pre').textContent = lines.join('\n');
    box.classList.remove('hidden');
  }
  function setRes(v) {
    if (RES_OK.indexOf(v) < 0) return;
    resPref = v;
    try { localStorage.setItem(RES_KEY, v); } catch (e) { /* nada */ }
    resize();
  }
  // lo que se dibuja de verdad (ancho x alto en píxeles)
  function resNow() {
    const pr = renderer.getPixelRatio();
    return Math.round(window.innerWidth * pr) + ' x ' + Math.round(window.innerHeight * pr);
  }

  // ---------- Calidad gráfica ----------
  function applyQuality() {
    const q = Q.cur;
    sun.castShadow = q.shadows;
    const S = q.shadowSize;
    const cam = sun.shadow.camera;
    if (cam.right !== S || sun.shadow.mapSize.x !== q.shadowMap) {
      cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S;
      cam.updateProjectionMatrix();
      sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    scene.fog.near = q.fog[0]; scene.fog.far = q.fog[1];
    if (G.World.layout === 'refugio') { scene.fog.near = 9; scene.fog.far = 40; }
    // (el escondite de los Supervivientes: más a oscuras; afuera es de noche y no se ve más que el faro)
    if (G.World.layout === 'refugio' && G.World.refugeKind === 'surv') { scene.fog.near = 5; scene.fog.far = 19; }
    const md = G.Maps && G.Maps.get(G.World.layout) && G.Maps.get(G.World.layout).mood;
    if (md && md.fog) { scene.fog.near *= md.fog; scene.fog.far *= md.fog; }
    if (G.Sky) G.Sky.setFogBase(scene.fog.near, scene.fog.far);
    camera.far = q.far;
    // mapas con niebla negra (la estación de policía): se ve poco, y lo de detrás ni se dibuja
    const bf = G.Maps && G.Maps.get(G.World.layout) && G.Maps.get(G.World.layout).blackFog;
    if (bf) { scene.fog.near = bf[0]; scene.fog.far = bf[1]; if (G.Sky) G.Sky.setFogBase(bf[0], bf[1]); camera.far = bf[1] + 2; }
    // (mapas a oscuras: se entra con la linterna encendida)
    if (bf && G.Flash && !flashAuto[G.World.layout]) {
      flashAuto[G.World.layout] = true;
      if (!G.Flash.on) { G.Flash.set(true); setTimeout(() => toast('Linterna encendida · se apaga y enciende con ' + G.Controls.label('kb', G.Controls.key('flash')) + ', R3 o el botón de arriba', 'good'), 2500); }
    }
    // calidad o distancia de dibujado nuevas: se revisan las zonas de alrededor (se arman o se tiran las que toque)
    if (G.World.reradius) G.World.reradius(Q.distCur);
    resize();
    refreshQualityMenu();
    // (al cambiar las sombras o la calidad hay que recompilar los materiales: se hace ya, no al seguir jugando)
    if (scene && camera) { try { renderer.compile(scene, camera); } catch (e) { /* nada */ } }
  }

  // La mira x2 del rifle: solo con la mejora «Mira x2» del banco (o en las pruebas de desarrollador). Di' Arco
  // nunca la usa (apunta sin la mira telescópica)
  function scopeReady(w) {
    w = w || (player && player.weapon);
    if (!w || !w.scope || !player || player.perks.noScope) return false;
    return devMode || !!(G.Run && G.Run.upgraded(w.id, 'mira'));
  }
  G.scopeReady = scopeReady;

  // Ajustes para el menú de pausa (options.js): leer y cambiar cada opción desde un solo sitio
  function setAutoDoors(v) { autoDoors = !!v; try { localStorage.setItem(OPT_KEY, autoDoors ? '1' : '0'); } catch (e) { /* nada */ } refreshQualityMenu(); }
  function setSubs(v) { showSubs = !!v; document.body.classList.toggle('no-subs', !showSubs); try { localStorage.setItem(SUBS_KEY, showSubs ? '1' : '0'); } catch (e) { /* nada */ } refreshQualityMenu(); }
  function setBtnOp(v) { btnOp = Math.max(0, Math.min(100, Math.round(+v || 0))); applyBtnOp(); try { localStorage.setItem(TBOP_KEY, String(btnOp)); } catch (e) { /* nada */ } }
  function setSeeThru(v) { seeThru = !!v; try { localStorage.setItem(SEE_KEY, seeThru ? '1' : '0'); } catch (e) { /* nada */ } if (G.SeeThru) G.SeeThru.setEnabled(seeThru); }
  function setHideBtns(v) { hideBtns = !!v; document.body.classList.toggle('no-tbtn', hideBtns); try { localStorage.setItem(TBTN_KEY, hideBtns ? '1' : '0'); } catch (e) { /* nada */ } refreshQualityMenu(); }
  // contorno amarillo del enemigo marcado (al apuntar o al ir a golpearlo): se puede quitar
  function setOutlineOpt(v) {
    showOutline = !!v; G.Models.outlineOff = !showOutline;
    try { localStorage.setItem(OUTL_KEY, showOutline ? '1' : '0'); } catch (e) { /* nada */ }
    if (aimed && aimed.model) G.Models.setOutline(aimed.model, showOutline);
    refreshQualityMenu();
  }
  function setTips(v) { showTips = !!v; try { localStorage.setItem(TIPS_KEY, showTips ? '1' : '0'); } catch (e) { /* nada */ } refreshQualityMenu(); }
  // Sensibilidad de la cámara (1 a 10, 5 = la de siempre): general, apuntando y con la mira (francotirador)
  const SENS_KEY = 'ceniza.sens';
  const sensV = (() => { try { const o = JSON.parse(localStorage.getItem(SENS_KEY) || '{}'); return { look: o.look || 5, aim: o.aim || 5, scope: o.scope || 5 }; } catch (e) { return { look: 5, aim: 5, scope: 5 }; } })();
  function sensMul(k) { return Math.pow(1.25, sensV[k] - 5); }
  function setSens(k, v) { sensV[k] = Math.max(1, Math.min(10, Math.round(v))); try { localStorage.setItem(SENS_KEY, JSON.stringify(sensV)); } catch (e) { /* nada */ } }
  // color de la imagen (opciones): saturación, contraste y brillo, en %. Es un filtro sobre el lienzo del juego (lo
  // hace el navegador al componer la página: no toca los sombreadores ni cuesta fotogramas). La interfaz no cambia
  const COLOR_KEY = 'ceniza.color', COLOR_DEF = { sat: 100, con: 100, bri: 100 };
  const colorV = (() => { try { return Object.assign({}, COLOR_DEF, JSON.parse(localStorage.getItem(COLOR_KEY) || '{}')); } catch (e) { return Object.assign({}, COLOR_DEF); } })();
  function applyColor() {
    if (!renderer) return;
    // (escuchando: todo grisáceo y más oscuro)
    const lk = listenK > 0.01 ? listenK : 0;
    const f = (colorV.sat !== 100 ? 'saturate(' + colorV.sat + '%) ' : '') + (colorV.con !== 100 ? 'contrast(' + colorV.con + '%) ' : '') + (colorV.bri !== 100 ? 'brightness(' + colorV.bri + '%)' : '') +
      (lk ? ' grayscale(' + Math.round(lk * 88) + '%) brightness(' + Math.round(100 - lk * 38) + '%)' : '');
    const t = f.trim() || '';
    if (renderer.domElement.style.filter !== t) renderer.domElement.style.filter = t;
  }
  // ---------- Escuchar (habilidad de Vera) ----------
  // Mientras se mantiene (R2 mantenido, X o el botón de la pantalla): la imagen se vuelve gris y más oscura, la
  // cámara se acerca y los enemigos que hay alrededor (LISTEN_R m) se ven blancos a través de las paredes. Al
  // soltarlo, todo vuelve a como estaba. Sin espera entre usos
  const LISTEN_R = 30;
  let listenK = 0;
  const listenGlow = new Set();
  function updateListen(dt) {
    const can = state === 'playing' && !!player && player.perks.listen && !(G.Surv && G.Surv.noListen) && !player.dead;      // (supervivencia: hasta aprender a escuchar)
    G.Input.listenable = can;
    document.body.classList.toggle('can-listen', can);
    const on = can && !!player.listening;
    document.body.classList.toggle('listening', on);
    listenK += ((on ? 1 : 0) - listenK) * Math.min(1, dt * (on ? 6 : 9));
    if (!on && listenK < 0.01) listenK = 0;
    G.Camera.listenK = listenK;
    applyColor();
    const want = new Set();
    if (listenK > 0.02) {
      const L = G.Population.list.concat(G.Humans && G.Humans.members ? G.Humans.members() : []);
      for (const z of L) {
        if (!z || !z.alive || z.gone || z.ally || !z.model) continue;
        if (Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z) <= LISTEN_R + (G.Skills ? G.Skills.bonus(player, 'listenR') : 0)) want.add(z);      // (suplemento Oído fino)
      }
    }
    for (const z of listenGlow) if (!want.has(z)) { if (z.model) G.Models.setListenGlow(z.model, false); listenGlow.delete(z); }
    for (const z of want) { if (!listenGlow.has(z)) { G.Models.setListenGlow(z.model, true); listenGlow.add(z); } }
    if (want.size) { const z0 = want.values().next().value; const g = z0.model.listenGlow; if (g) g.material.uniforms.op.value = listenK; }
  }
  function setColor(k, v) { colorV[k] = Math.round(v); applyColor(); try { localStorage.setItem(COLOR_KEY, JSON.stringify(colorV)); } catch (e) { /* nada */ } }
  // la cámara se acerca sola (y no se puede cambiar) en la estación de policía y en las zonas muy oscuras: una sala
  // con la luz apagada de noche, o en un mapa cerrado sin sol. Con un poco de margen (no parpadea al cruzar puertas)
  let darkT = 0, darkChk = 0, darkNow = false;
  function darkHere() {
    if (state !== 'playing' || !player || player.dead) return false;
    const W = G.World, lay = W.layout;
    if (lay === 'comisaria') return true;
    if (lay === 'refugio') return false;
    const x = player.pos.x, z = player.pos.z, lv = player.lv || 0;
    const r = W.roomAt(x, z, lv);
    if (!r || r.on || r.type === 'terraza' || r.type === 'ruina' || W.openSky(x, z, lv)) return false;
    const mp = G.Maps && G.Maps.get ? G.Maps.get(lay) : null;
    const sunless = !!(mp && (mp.interior || (mp.mood && mp.mood.sun && mp.mood.sun[1] < 0.2)));
    return sunless || !!(G.Sky && G.Sky.nightK > 0.5);
  }
  // Dentro de una sala con la luz encendida (mapas con litInside: la estación en 2020) la luz ambiente es la de los
  // fluorescentes; en las salas con r.flicker, de vez en cuando parpadea
  let litK = 0, litT = 0;
  function indoorLight(dt) {
    litT += dt;
    const W = G.World, mp = G.Maps && G.Maps.get ? G.Maps.get(W.layout) : null;
    let want = 0;
    if (mp && mp.litInside && state === 'playing') {
      const r = W.roomAt(player.pos.x, player.pos.z, player.lv || 0);
      if (r && r.on) {
        want = 1;
        if (r.flicker) {
          const ph = litT % 7.3, n = Math.sin(litT * 31) * Math.sin(litT * 11.7 + 1);
          if ((ph < 0.9 && n > 0.1) || (ph > 4.1 && ph < 4.35)) want = 0.25;
        }
      }
    }
    // (al apagarse de golpe, sin suavizar: es un parpadeo; al volver, rápido)
    litK = want < litK - 0.3 ? want : litK + (want - litK) * Math.min(1, dt * 6);
    if (G.Sky) G.Sky.indoorLit = litK;
  }
  function closeCam(dt) {
    darkChk -= dt;
    if (darkChk <= 0) { darkChk = 0.25; darkNow = darkHere(); }
    // entra tras 0,6 s a oscuras; sale tras 1,5 s con luz (en la estación, al momento)
    darkT = darkNow ? Math.min(1.5, darkT + dt) : Math.max(0, darkT - dt);
    let want = G.World.layout === 'comisaria' ? darkNow : (G.Camera.closeIn ? darkT > 0 : darkT >= 0.6);
    if (gameMode === 'historia' && STORY_CH[storyCh] && STORY_CH[storyCh].close) want = true;     // (el prólogo: la cámara cerca)
    if (want !== G.Camera.closeIn) { G.Camera.closeIn = want; refreshQualityMenu(); }
  }
  function setZoomPct(v) { G.Camera.setZoom(null, v); try { localStorage.setItem(ZOOM_KEY, String(G.Camera.zoomPct)); } catch (e) { /* nada */ } refreshQualityMenu(); }
  G.Settings = {
    get player() { return player; },
    get quality() { return Q.level; }, setQuality(v) { Q.set(v); }, get qualityNow() { return Q.cur.name; },
    get res() { return resPref; }, setRes, get resNow() { return resNow(); },
    get resAuto() { return dynOn; }, setResAuto: setDynRes, get resAutoK() { return dynK; },
    get shadowLayers() { return !G.ShadowCache || G.ShadowCache.enabled; }, setShadowLayers(v) { if (G.ShadowCache) G.ShadowCache.setEnabled(v); },
    get shadowWhy() { return G.ShadowCache ? G.ShadowCache.why : ''; },
    bench: () => benchStart(),
    shadow(k) { return Q.shadow[k]; }, setShadow(k, v) { Q.setShadow(k, v); }, get shadowsNow() { return Q.cur.shadows ? (Q.cur.shadowMap >= 2048 ? 'altas' : (Q.cur.shadowMap >= 1024 ? 'medias' : 'bajas')) : 'apagadas'; },
    get dist() { return Q.dist; }, setDist(v) { Q.setDist(v); }, get veg() { return Q.veg; }, setVeg(v) { Q.setVeg(v); }, get distNow() { return Q.distCur.name; },
    get fps30() { return Q.fps30; }, setFps30(v) { Q.setFps30(v); },
    get autoDoors() { return autoDoors; }, setAutoDoors,
    get runDropsAim() { return runDropsAim; }, setRunDropsAim,
    get subs() { return showSubs; }, setSubs,
    get tips() { return showTips; }, setTips,
    get outline() { return showOutline; }, setOutline: setOutlineOpt,
    get hideBtns() { return hideBtns; }, setHideBtns,
    get btnOp() { return btnOp; }, setBtnOp,
    get seeThru() { return seeThru; }, setSeeThru,
    get trail() { return trailOn; }, setTrail,
    get dev() { return devMode; }, setDev: (v) => setDev(v),
    get perf() { return perfPref; }, setPerf: (v) => setPerf(v),
    get zoom() { return G.Camera.zoomPct; }, setZoom: setZoomPct,
    color(k) { return colorV[k]; }, setColor,
    vol(k) { return G.Audio ? Math.round(G.Audio.vol[k] * 100) : 80; },
    setVol(k, v) { if (G.Audio) G.Audio.setVol(k, v / 100); refreshQualityMenu(); },
    previewVol(k) { if (G.Audio) G.Audio.preview(k); },
    volDefault(k) { return G.Audio && G.Audio.DEF ? Math.round(G.Audio.DEF[k] * 100) : 80; },
    get weaponSens() { return G.HUD.sens; }, setWeaponSens(v) { G.HUD.setSens(v); },
    sens(k) { return sensV[k]; }, setSens,
    resume: () => resume(),
    // «Ir al menú principal» del menú de pausa: en el refugio se guarda; en un enfrentamiento se pierde la carrera
    get quitNote() {
      if (gameMode !== 'retorno' || !G.Run.active) return 'Volverás al menú principal.';
      if (G.Run.daily) return G.Run.inRefuge ? 'Tu partida diaria se guarda: podrás continuarla desde el menú principal.' : 'Estás en medio de un enfrentamiento: si sales ahora, pierdes la partida diaria de hoy (no hay otra hasta mañana).';
      return G.Run.inRefuge ? 'Tu carrera se guarda: podrás continuarla desde el menú principal.' : 'Estás en medio de un enfrentamiento: si sales ahora, la carrera se pierde.';
    },
    get quitDanger() { return gameMode === 'retorno' && G.Run.active && !G.Run.inRefuge && !G.Run.inCalm; },
    quitToMenu: () => quitToMenu(),
    editButtons() { if (G.HudEdit) G.HudEdit.open('paused'); }
  };

  function setupQualityMenu() {
    document.querySelectorAll('.qrow').forEach((row) => {
      row.querySelectorAll('button[data-level]').forEach((b) => {
        b.addEventListener('click', (e) => { e.preventDefault(); Q.set(b.dataset.level); });
      });
      const cb = row.querySelector('input[data-fps30]');
      if (cb) cb.addEventListener('change', () => Q.setFps30(cb.checked));
      row.querySelectorAll('button[data-hud]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); G.HUD.setStyle(b.dataset.hud); refreshQualityMenu(); }));
      row.querySelectorAll('button[data-cam]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault(); G.Camera.setZoom(b.dataset.cam, null);
        try { localStorage.setItem(CAM_KEY, G.Camera.zoomMode); } catch (er) { /* nada */ }
        refreshQualityMenu();
      }));
      const zr = row.querySelector('input[data-zoom]');
      if (zr) zr.addEventListener('input', () => { if (G.Camera.forced) { zr.value = -35; return; } setZoomPct(zr.value); });
      const dv = row.querySelector('input[data-dev]');
      if (dv) dv.addEventListener('change', () => setDev(dv.checked));
      // volumen por canal (con un sonido de muestra al soltar el control)
      row.querySelectorAll('input[data-vol]').forEach((r) => {
        r.addEventListener('input', () => { if (G.Audio) G.Audio.setVol(r.dataset.vol, r.value / 100); refreshQualityMenu(); });
        r.addEventListener('change', () => { if (G.Audio) G.Audio.preview(r.dataset.vol); });
      });
      const ad = row.querySelector('input[data-autodoor]');
      const sb = row.querySelector('input[data-subs]');
      if (sb) sb.addEventListener('change', () => setSubs(sb.checked));
      const tp = row.querySelector('input[data-tips]');
      if (tp) tp.addEventListener('change', () => setTips(tp.checked));
      if (ad) ad.addEventListener('change', () => setAutoDoors(ad.checked));
    });
    refreshQualityMenu();
  }
  function refreshQualityMenu() {
    document.querySelectorAll('.qrow').forEach((row) => {
      row.querySelectorAll('button[data-level]').forEach((b) => b.classList.toggle('on', b.dataset.level === Q.level));
      const cb = row.querySelector('input[data-fps30]');
      if (cb) cb.checked = Q.fps30;
      const ad = row.querySelector('input[data-autodoor]');
      if (ad) ad.checked = autoDoors;
      const sb = row.querySelector('input[data-subs]');
      if (sb) sb.checked = showSubs;
      const tp = row.querySelector('input[data-tips]');
      if (tp) tp.checked = showTips;
      const dv = row.querySelector('input[data-dev]');
      if (dv) dv.checked = devMode;
      row.querySelectorAll('button[data-hud]').forEach((b) => b.classList.toggle('on', b.dataset.hud === G.HUD.style));
      row.querySelectorAll('button[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === G.Camera.zoomMode));
      const zr = row.querySelector('input[data-zoom]');
      if (zr) { zr.disabled = G.Camera.forced; if (document.activeElement !== zr || G.Camera.forced) zr.value = G.Camera.forced ? -35 : G.Camera.zoomPct; }
      const zv = row.querySelector('.qzv');
      if (zv) zv.textContent = G.Camera.forced ? '-35 % · auto' : (G.Camera.zoomPct > 0 ? '+' : '') + G.Camera.zoomPct + ' %';
      row.querySelectorAll('input[data-vol]').forEach((r) => {
        const v = G.Audio ? Math.round(G.Audio.vol[r.dataset.vol] * 100) : 80;
        if (document.activeElement !== r) r.value = v;
        const b = r.parentNode.querySelector('b'); if (b) b.textContent = v;
      });
      const now = row.querySelector('.qnow');
      if (now) now.textContent = Q.level === 'auto' ? '(ahora ' + Q.cur.name + ')' : '';
    });
    if (G.PauseMenu) G.PauseMenu.refresh();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = pixelRatio();
    if (Math.abs(renderer.getPixelRatio() - pr) > 1e-3) renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    baseFov = w < h ? 74 : 60;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }

  // En el móvil el juego va siempre en horizontal: pantalla completa y orientación bloqueada (el navegador solo
  // deja bloquearla en pantalla completa, por eso va después). Donde no se puede bloquear (iPhone), un aviso
  // tapa el juego hasta que giras el teléfono
  function lockLandscape() {
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* no se puede */ }
  }
  function tryFullscreen() {
    if (!G.Input.isTouch) return;
    const d = document.documentElement;
    const req = d.requestFullscreen || d.webkitRequestFullscreen;
    try {
      if (req && !(document.fullscreenElement || document.webkitFullscreenElement)) {
        const p = req.call(d, { navigationUI: 'hide' });
        if (p && p.then) p.then(lockLandscape, lockLandscape); else lockLandscape();
      } else lockLandscape();
    } catch (e) { lockLandscape(); }
  }
  function portrait() { return G.Input.isTouch && window.innerHeight > window.innerWidth * 1.05; }
  function checkOrientation() {
    const on = portrait();
    document.body.classList.toggle('portrait', on);
    if (on && state === 'playing') pause();
  }

  function start(mode, cont, chapter) {
    if (state !== 'menu') return;
    tune();
    if (mode === 'superv' && G.Surv) {
      // el modo supervivencia (en beta): con Eira, en su escondite (o donde descansó la última vez)
      gameMode = 'superv'; tutoPending = null;
      if (G.Audio) G.Audio.unlock();
      tryFullscreen();
      G.Run.inRefuge = false;
      document.body.classList.remove('practica', 'asalto', 'refugio', 'historia');
      document.body.classList.add('superv');
      G.Surv.start(!!cont);
      G.Input.enabled = true;
      state = 'playing';
      prewarm();
      return;
    }
    if (mode === 'historia') { if (G.Diff) G.Diff.set('dificil'); const sv = cont && G.Story && G.Story.saved ? G.Story.saved() : null; startStory(chapter, sv && sv.ch === (chapter || 'prologo') ? sv.cp : 0); prewarm(); return; }
    const daily = mode === 'diaria';
    // el entrenamiento (Tutoriales): el modo libre con las lecciones encima (chapter: la lección por la que empieza)
    const tuto = mode === 'tutorial';
    if (tuto) { mode = 'practica'; if (G.Diff) G.Diff.set('dificil'); }
    tutoPending = tuto ? (chapter || 'mover') : null;
    gameMode = mode === 'practica' ? 'practica' : (mode === 'asalto' ? 'asalto' : 'retorno');
    if (G.Audio) G.Audio.unlock();
    tryFullscreen();
    if (gameMode === 'retorno') {
      // carrera nueva (solo con la pistola) o la guardada; se empieza en el refugio (diaria: la de hoy)
      if (!(cont && G.Run.load(daily))) {
        player.reset();
        G.Run.newRun(player.charId, player, daily);
      }
      enterRefuge();
    } else {
      G.Run.inRefuge = false;
      G.Weapons.applyUpgrades(null);
      // modo libre: el campo con un puesto de comercio y un banco de mejoras gratis
      const lay = gameMode === 'practica' ? 'libre' : 'campo';
      if (G.World.layout !== lay || tuto) resetWorld(lay);
      if (gameMode === 'practica') { G.Run.startFree(player.charId); G.Run.charKit(player); G.Refugio.enter(true); }
      G.Input.enabled = true;
      G.Input.requestLock();
      state = 'playing';
      if (devMode && !tuto) player.applyDev();
      beginMode();
      if (tuto && G.Tutorial) G.Tutorial.begin(tutoPending, tutoHost);
    }
    // con la pantalla de carga delante: prepara ya los materiales (así no hay tirones la primera vez)
    prewarm();
  }

  // ---------- Modo historia ----------
  // Cada capítulo: su mapa, su personaje (en G.Player.STORY) y la pantalla negra del principio (año y lugar)
  // lock: lo que todavía no se puede hacer (y la cámara cerca, como en la estación de siempre); kit: lo que lleva
  // encima (el revólver, en la funda: no se apunta ni se dispara aún); radio: dónde suena la radio de la sala
  const STORY_LOCK = { run: true, aim: true, attack: true, jump: true, crouch: true, prone: true, dodge: true, shove: true, throw: true, scope: true, scopeToggle: true, mira: true, listen: true };
  const STORY_CH = {
    prologo: { map: 'comisaria_2020', card: ['Año 2020', '6 de octubre · Seattle', 'Estación de policía'], lock: STORY_LOCK, close: true, kit: ['revolver'], radio: { x: 13.7, z: 12.8 },
      // los puntos de control: dónde se sigue (el mapa) y la pantalla negra del principio
      cps: { 1: { map: 'cruce_2020', card: ['Prólogo', 'Punto de control', 'La huida'] }, 2: { map: 'cruce_2020', card: ['Prólogo', 'Punto de control', 'El depósito de vehículos'] }, 3: { map: 'vacio', card: ['Prólogo', 'Punto de control', 'El puente'] } } }
  };
  let storyPending = null, storyEl = null, storyCh = null, storyCancel = null, storyCp = 0;
  // cp: desde un punto de control (0: desde el principio del capítulo)
  function startStory(id, cp) {
    const ch = STORY_CH[id] || STORY_CH.prologo;
    const at = cp && ch.cps && ch.cps[cp] ? ch.cps[cp] : null;
    gameMode = 'historia'; storyCh = id || 'prologo'; storyCp = at ? cp : 0;
    G.Run.inRefuge = false;
    G.Weapons.applyUpgrades(null);
    const map = at ? at.map : ch.map;
    resetWorld(map);
    setLighting(map);
    document.body.classList.remove('refugio', 'practica', 'asalto');
    document.body.classList.add('historia');
    player.infinite = false; player.stockMax = {};
    G.Pickups.reset();
    G.Combat.peaceful = true;          // (sin golpes ni disparos)
    G.Input.enabled = false;           // (hasta que se quite la pantalla negra)
    G.Input.locks = ch.lock || null;
    document.body.classList.toggle('st-lock', !!ch.lock);
    if (G.Audio) G.Audio.calm = true;
    // lo que lleva encima: el revólver, en su funda (las manos, libres)
    for (const id of ch.kit || []) {
      const w = G.Weapons.get(id);
      if (!w) continue;
      player.hands[1] = { id, cond: 1, two: false, mag: w.mag };
      if (w.ammo) player.ammo[w.ammo] = Math.max(player.ammo[w.ammo] || 0, w.mag);
    }
    player.equip(-1);
    player.refreshModel();
    // la gente de la estación y la radio (desde un punto de control, lo pone la historia: Alem, la huida...)
    if (at) { if (G.Story && G.Story.prepareCp) G.Story.prepareCp(storyCp, player); }
    else {
      if (G.NPCs) G.NPCs.setup(storyCh, scene, { radio: ch.radio });
      if (G.Story) G.Story.setup(storyCh, player);
    }
    state = 'playing';
    storyPending = at ? at.card : ch.card;
  }
  // morir en el modo historia: se vuelve al último punto de control (o al principio del capítulo)
  function storyRetry() {
    const cp = G.Story && G.Story.cp ? G.Story.cp : 0;
    el('dead').classList.add('hidden');
    if (G.Story) G.Story.clear();
    if (G.NPCs) G.NPCs.clear();
    if (G.Drive) G.Drive.stop(true);
    if (G.CitySound) G.CitySound.stop();
    G.Input.enabled = false;
    state = 'menu';
    G.Menus.loading(() => { try { player.reset(); startStory(storyCh, cp); prewarm(); } catch (e) { console.error(e); } }, () => {
      G.Menus.hide();
      const lines = storyPending; storyPending = null;
      storyCard(lines || ['Prólogo'], () => { fadeTo(0, 1.8); G.Input.enabled = true; G.Input.clear(); G.Input.requestLock(); if (G.Story) G.Story.begin(storyCh, player, storyCp); });
    }, { min: 2.6 });
  }
  // La pantalla negra del principio de un capítulo: las líneas aparecen una a una y se quedan un momento; después
  // se van y se ve el juego (done). Tocando la pantalla (o una tecla) se salta
  function storyCard(lines, done) {
    fadeTo(1, 0);                      // (debajo, el juego queda a negro hasta que se vaya la tarjeta)
    if (storyCancel) storyCancel();
    const d = storyEl = document.createElement('div');
    d.id = 'storycard';
    d.innerHTML = lines.map((t, i) => '<p class="' + (i ? 'sc-sub' : 'sc-year') + '">' + t + '</p>').join('');
    document.body.appendChild(d);
    const ps = d.querySelectorAll('p'), timers = [];
    ps.forEach((p, i) => timers.push(setTimeout(() => p.classList.add('in'), 600 + i * 1200)));
    let ended = false;
    // quitarla sin seguir (se volvió al menú): ni teclas ni temporizadores pendientes
    const cancel = () => { ended = true; timers.forEach(clearTimeout); window.removeEventListener('keydown', skip, true); d.remove(); if (storyEl === d) storyEl = null; if (storyCancel === cancel) storyCancel = null; };
    storyCancel = cancel;
    const end = () => {
      if (ended) return;
      ended = true;
      timers.forEach(clearTimeout);
      d.classList.add('out');
      window.removeEventListener('keydown', skip, true);
      timers.push(setTimeout(() => { d.remove(); if (storyEl === d) storyEl = null; if (storyCancel === cancel) storyCancel = null; done(); }, 1000));
    };
    const t0 = performance.now();
    const skip = (e) => { if (performance.now() - t0 < 1200) return; if (e) { e.preventDefault(); e.stopPropagation(); } end(); };
    d.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip, true);
    timers.push(setTimeout(end, 600 + lines.length * 1200 + 2600));
  }

  // Cuántos cuerpos de infectados tener armados antes de empezar (según lo que va a salir en el enfrentamiento).
  // Se arman durante la pantalla de carga (ver G.Zombie.pool) y luego se reciclan: así no hay un tirón cada vez
  // que aparece uno
  function poolNeeds() {
    const P = G.Zombie.pool;
    if (!P) return;
    const t = G.Mode.active ? G.Mode.type : null, lay = G.World.layout;
    if (lay === 'refugio') P.need(null);
    else if (gameMode === 'superv' && G.Surv && G.Surv.active) P.need(G.Surv.poolNeed());
    else if (G.Mode.humans) {
      P.need({ z: 4 });
      // los escorpiones que llegan después (refuerzos de la caza, oleadas del asalto)
      if (G.Humans && G.Humans.prepare) {
        if (t === 'caza') G.Humans.prepare(['explorador', 'carronero', 'pistolero', 'explorador', 'carronero', 'pistolero', 'explorador', 'carronero']);
        else if (t === 'liberacion') G.Humans.prepare(['lider', 'pistolero', 'escopetero', 'sigilo', 'saqueador', 'tirador', 'bruto', 'explorador', 'carronero', 'pistolero', 'arquero', 'explorador', 'carronero']);
        else if (t === 'asalto') G.Humans.prepare(['explorador', 'explorador', 'explorador', 'carronero', 'carronero', 'carronero', 'lider', 'tirador', 'pistolero', 'arquero', 'escopetero', 'bruto', 'sigilo', 'saqueador']);
      }
    }
    else if (t === 'resistencia' || t === 'asalto') P.need({ z: 16, stalker: 5, blind: 2, temb: 1 });
    else if (t === 'caza') P.need({ z: 12, stalker: 6, blind: 1 });
    else if (t === 'jefe') P.need({ stalker: 4, z: 2 });
    else if (t === 'saqueo') P.need({ z: 4 });
    else P.need({ z: 10, blind: 1 });
  }
  // ¿ya está todo listo para quitar la pantalla de carga?
  function loadReady() { return !G.Zombie.pool || G.Zombie.pool.full; }
  G.loadReady = loadReady;

  // Compila los materiales y prepara los modelos de los infectados detrás de la pantalla de carga
  let warmed = false;
  function prewarm() {
    poolNeeds();
    try {
      if (!warmed) {
        warmed = true;
        const tmp = [];
        for (const k of [{}, { blind: true }, { temb: true }, { stalker: true }, { hongo: true }, { nemi: true }]) {
          const z = new G.Zombie(scene, player.pos.x + 200, player.pos.z + 200, null, 0, k);
          tmp.push(z);
        }
        renderer.compile(scene, camera);
        for (const z of tmp) z.dispose();
      }
      renderer.compile(scene, camera);
      warmUpload();
    } catch (e) { /* nada */ }
  }
  // Sube a la tarjeta gráfica todo el mapa (también lo que no se ve ahora: las zonas de lejos y los interiores):
  // un fotograma con todo a la vista detrás de la pantalla de carga. Si no, cada trozo se sube la primera vez que
  // aparece en pantalla (y eso da un tirón)
  function warmUpload() {
    if (!G.World.showAll) return;
    const vis = [], cul = [];
    G.World.showAll(true);
    G.World.forEachChunk((c) => {
      if (!c.view) return;
      c.view.group.traverse((o) => {
        if (!o.visible) { vis.push(o); o.visible = true; }
        if (o.frustumCulled && (o.isMesh || o.isPoints || o.isLine)) { cul.push(o); o.frustumCulled = false; }
      });
    });
    renderer.render(scene, camera);
    for (const o of vis) o.visible = false;
    for (const o of cul) o.frustumCulled = true;
    G.World.showAll(false);
  }

  // Arranca el modo elegido sobre el mundo ya preparado (práctica o enfrentamiento suelto)
  function beginMode() {
    document.body.classList.toggle('asalto', gameMode !== 'practica');
    document.body.classList.toggle('practica', gameMode === 'practica');
    document.body.classList.remove('refugio');
    // práctica libre: lo que consigues no se gasta (munición, vendas, alcohol, trapos y arrojables)
    player.infinite = gameMode === 'practica'; player.stockMax = {};
    G.Pickups.reset();
    G.Combat.peaceful = false;
    if (gameMode === 'asalto') G.Mode.start({ type: 'asalto' });
    else {
      G.Pickups.spawn(10);
      if (!tutoPending) toast('Práctica libre: saca zombis con «+ Zombi»' + (G.Input.isTouch ? '' : ' (o la tecla N)') + (devMode ? '. Tienes todas las armas.' : '.'));
    }
  }

  // ---------- Modo Retorno ----------
  // Luz: el campo de día; el refugio, cerrado y en penumbra (lo alumbran sus lámparas)
  const flashAuto = {};
  function setLighting(layout) {
    const ref = layout === 'refugio';
    hemi.intensity = ref ? 0.3 : 0.62;
    hemi.color.setHex(ref ? 0xd8c8b0 : 0xd6e0e4);
    hemi.groundColor.setHex(ref ? 0x2a2218 : 0x4f4a3c);
    sun.intensity = ref ? 0.2 : 1.25;
    if (ref && G.World.refugeKind === 'surv') { hemi.intensity = 0.2; sun.intensity = 0.05; }          // (el escondite: una sola bombilla)
    sun.color.setHex(0xfff1dc);
    scene.background.setHex(ref ? 0x0d0b09 : FOG).convertSRGBToLinear();
    // los mapas tienen su propia luz (cielo, niebla, sol)
    const md = G.Maps && G.Maps.get(layout) && G.Maps.get(layout).mood;
    if (md) {
      hemi.color.setHex(md.hemi[0]); hemi.groundColor.setHex(md.hemi[1]); hemi.intensity = md.hemi[2];
      sun.color.setHex(md.sun[0]); sun.intensity = md.sun[1];
      scene.background.setHex(md.sky).convertSRGBToLinear();
    }
    scene.fog.color.copy(scene.background);
    if (G.Maps) { G.Maps.skyline(scene, md ? layout : null); G.Maps.decor(scene, layout); }
    if (ref && G.World.refugeKind === 'surv' && G.Maps && G.Maps.hideoutSky) G.Maps.hideoutSky(scene);          // (el faro, por la ventana)
    if (G.Sky) G.Sky.reset(layout, md);
    applyQuality();
  }

  // Al refugio (al empezar la carrera, al continuarla o al volver de un enfrentamiento): el mundo con la
  // distribución del refugio y lo que llevas (tal como saliste del enfrentamiento); se guarda
  function enterRefuge() {
    G.Mode.stop();
    // (la Trece y Grimes: el escondite de los Supervivientes; si cambia quién lleva la carrera, se rehace)
    if (G.World.layout !== 'refugio' || !G.Refugio.inside || G.World.refugeKind !== (G.World.survRefuge() ? 'surv' : 'normal')) resetWorld('refugio');
    G.Run.enterRefuge(player);
    // armas regaladas por los desafíos: se avisa cuando ya se ve el refugio
    if (G.Run.newGift) pendingToast = 'Por un desafío difícil, hay un arma esperándote en el refugio';
    player.infinite = false; player.stockMax = {};
    G.Combat.peaceful = true;
    G.Refugio.enter();
    setLighting('refugio');
    document.body.classList.remove('asalto', 'practica');
    document.body.classList.add('refugio');
    G.Camera.yaw = Math.PI; G.Camera.pitch = 0.06; player.facing = Math.PI;
    el('m-stats').classList.add('hidden');
    el('dead').classList.add('hidden');
    G.Input.enabled = true;
    G.Input.clear();
    state = 'playing';
  }

  // Del mapa del refugio a un enfrentamiento: pantalla de carga, el campo y el modo elegido
  function startEncounter(i) {
    if (!G.Run.active || state !== 'playing') return;
    G.Input.requestLock();
    const enc = i === 'boss' ? G.Run.beginBoss(player) : G.Run.beginEncounter(i, player);
    if (!enc) return;
    state = 'loading';
    G.Input.enabled = false;
    G.Menus.loading(() => {
      G.Refugio.leave();
      // cada enfrentamiento se juega en uno de los mapas (el que salió en el mapa del refugio)
      const mapId = enc.map && G.Maps.get(enc.map) ? enc.map : 'campo';
      resetWorld(mapId);
      G.Run.restoreInv(player);
      setLighting(mapId);
      // Retorno: la hora de este enfrentamiento la elige el mapa al azar al cargarse, y queda quieta hasta el final
      if (G.Sky) G.Sky.fixHour(true);
      G.Combat.peaceful = false;
      document.body.classList.remove('refugio', 'practica');
      document.body.classList.add('asalto');
      G.Mode.start({ type: enc.type, time: enc.time, retorno: true, humans: !!enc.humans, fatal: !!enc.fatal, avenger: enc.avenger });      // (asalto, caza, saqueo o resistencia)
      // el modificador de este enfrentamiento (el del mapa del refugio): la noche y la niebla se ponen aquí; lo demás
      // lo lee cada sistema de G.Run.modK. Se anuncia al empezar
      if (enc.mod && G.Run.MODS[enc.mod]) {
        const M = G.Run.MODS[enc.mod];
        if (G.Sky && G.Sky.active) {
          if (enc.mod === 'noche') { G.Sky.set(22.6 + Math.random() * 3, null); if (G.Flash && G.Flash.set) G.Flash.set(true); }
          if (enc.mod === 'niebla') G.Sky.set(null, mapId === 'super' ? 'ventisca' : 'niebla');
        }
        // (bajo el título del enfrentamiento, mientras se ve)
        const mt = el('m-title');
        if (mt) mt.insertAdjacentHTML('beforeend', '<em class="m-mod' + (M.good ? ' good' : '') + '"><i>Modificador</i>' + M.name + '<small>' + M.text + '</small></em>');
      }
      prewarm();
      G.Input.enabled = true;
      G.Input.clear();
      if (G.Station) G.Station.begin(scene, player, enc.type);     // (la estación: la entrada y el casillero)
      if (G.Faro) G.Faro.begin(scene, player, enc.type);           // (el faro: la guardia, la linterna y el Aguijón)
      state = 'playing';
    }, () => { fadeTo(1, 0); fadeTo(0, G.Station && G.Station.intro ? 3.6 : 1.1); G.Menus.hide(); }, { min: enc.boss ? 4.6 : 3.6, ready: loadReady });
  }

  // Del mapa del refugio a un descanso que se juega (calm.js): pantalla de carga, el sitio y, al seguir el camino,
  // de vuelta al refugio (la parada cuenta como un tramo)
  function startCalm(i) {
    if (!G.Run.active || state !== 'playing' || !G.Calm) return;
    G.Input.requestLock();
    const c = G.Run.beginCalm(i, player);
    if (!c) return;
    state = 'loading';
    G.Input.enabled = false;
    G.Menus.loading(() => {
      G.Refugio.leave();
      resetWorld(c.map);
      G.Run.restoreInv(player);
      setLighting(c.map);
      if (G.Sky) G.Sky.fixHour(true);
      calmBegin(c, () => endCalm());
    }, () => { fadeTo(1, 0); fadeTo(0, 1.6); G.Menus.hide(); }, { min: 3.0, ready: loadReady });
  }
  function calmBegin(c, done) {
    G.Combat.peaceful = false;
    document.body.classList.remove('refugio', 'practica', 'asalto');
    G.Calm.begin(scene, player, { scene: c.scene, seed: c.seed, step: c.step }, { msg: toast, done, secret: G.Calm.SCENES.faro ? goFaro : null });
    prewarm();
    G.Input.enabled = true;
    G.Input.clear();
    state = 'playing';
  }
  function endCalm() {
    if (!G.Run.active || state !== 'playing') return;
    G.Run.endCalm(player, G.Calm.info);
    state = 'loading';
    G.Input.enabled = false;
    G.Menus.loading(() => { enterRefuge(); prewarm(); }, () => { fadeTo(1, 0); fadeTo(0, 1.1); G.Menus.hide(); }, { min: 2.6 });
  }
  // El desvío al faro (la parada secreta de la bitácora): desde el descanso de la tercera hoja. Ese descanso cuenta
  // como hecho; el faro no cuenta como tramo y, al seguir, de vuelta al refugio. (En el modo libre, de prueba)
  function goFaro() {
    if (state !== 'playing' || !G.Calm) return;
    if (!G.Run.active || G.Run.free) { calmTest('faro'); return; }
    G.Run.endCalm(player, G.Calm.info);
    const c = G.Run.beginSecret(player);
    state = 'loading';
    G.Input.enabled = false;
    if (!c) { G.Menus.loading(() => { enterRefuge(); prewarm(); }, () => { fadeTo(1, 0); fadeTo(0, 1.1); G.Menus.hide(); }, { min: 2.6 }); return; }
    G.Menus.loading(() => {
      G.Calm.stop();
      resetWorld(c.map);
      G.Run.restoreInv(player);
      setLighting(c.map);
      if (G.Sky) G.Sky.fixHour(true);
      calmBegin(c, () => endCalm());
    }, () => { fadeTo(1, 0); fadeTo(0, 1.6); G.Menus.hide(); }, { min: 3.0, ready: loadReady });
  }
  // (modo libre, tablero de simulación) un descanso de prueba: al seguir el camino, de vuelta al campo de pruebas
  function calmTest(id) {
    if (!G.Calm || !G.Calm.SCENES[id]) return;
    if (G.Run.active) G.Run.keep(player);
    const map = G.Calm.SCENES[id].map;
    state = 'loading';
    G.Input.enabled = false;
    G.Input.requestLock();
    G.Menus.loading(() => {
      resetWorld(map);
      if (G.Run.active) G.Run.restoreInv(player);
      setLighting(map);
      if (G.Sky) G.Sky.fixHour(true);
      player.infinite = false; player.stockMax = {};
      calmBegin({ scene: id, seed: 1 + Math.floor(Math.random() * 999983), step: 0 }, () => {
        state = 'loading';
        G.Input.enabled = false;
        G.Menus.loading(() => { state = 'playing'; travelTo('libre', false); G.Input.enabled = true; G.Input.clear(); }, () => { fadeTo(1, 0); fadeTo(0, 1.1); G.Menus.hide(); }, { min: 2.0 });
      });
    }, () => { fadeTo(1, 0); fadeTo(0, 1.6); G.Menus.hide(); }, { min: 3.0, ready: loadReady });
  }

  // ---------- Modo supervivencia ----------
  // De una zona a otra (o al paso): fundido a negro, lo pesado detrás (el mapa nuevo) y, en cuanto están armados los
  // cuerpos de los infectados, otra vez a la vista. Sin pantalla de carga: la oscuridad del paso la tapa
  function survShift(work, done) {
    if (state !== 'playing' && state !== 'dead') return;
    state = 'loading';
    G.Input.enabled = false;
    fadeTo(1, 0.45);
    setTimeout(() => {
      try { work(); } catch (e) { console.error(e); }
      prewarm();
      const t0 = performance.now();
      const wait = () => {
        const P = G.Zombie.pool;
        if (P && P.missing()) P.step(28);
        if (!loadReady() && performance.now() - t0 < 9000) { setTimeout(wait, 16); return; }
        state = 'playing';
        G.Input.enabled = true; G.Input.clear(); G.Input.requestLock();
        fadeTo(0, 0.9);
        if (done) done();
      };
      setTimeout(wait, 60);
    }, 500);
  }
  // con la pantalla de carga (la primera vez: desde el modo libre)
  function survLoad(work, done, min) {
    state = 'loading';
    G.Input.enabled = false;
    G.Input.requestLock();
    G.Menus.loading(() => { try { work(); } catch (e) { console.error(e); } prewarm(); G.Input.enabled = true; G.Input.clear(); state = 'playing'; },
      () => { fadeTo(1, 0); fadeTo(0, 1.2); G.Menus.hide(); if (done) done(); }, { min: min || 3.0, ready: loadReady });
  }
  // de la prueba, otra vez al modo libre: con el personaje y el equipo de antes
  function survBackToFree(pc) {
    state = 'loading';
    G.Input.enabled = false;
    G.Menus.loading(() => {
      gameMode = 'practica';
      document.body.classList.remove('superv');
      if (pc && player.charId !== pc) player.setCharacter(pc);
      state = 'playing';
      travelTo('libre', true);
      G.Input.enabled = true; G.Input.clear();
    }, () => { fadeTo(1, 0); fadeTo(0, 1.1); G.Menus.hide(); }, { min: 2.6, ready: loadReady });
  }

  // Botones de la pantalla de estadísticas: en la carrera, «Volver al refugio» (las recompensas ya cuentan)
  function setupStatsButtons(win, total) {
    const again = el('btn-again'), menu = el('btn-menu'), rw = el('m-rew');
    if (gameMode === 'retorno' && G.Run.active && win && G.Run.encounter && G.Run.encounter.boss) {
      // jefe derrotado: fin de la carrera
      const tot = G.Run.winBoss(player, total, G.Mode.stats);
      G.Mode.achieve('carrera');
      if (G.Run.daily && G.Run.dailyWon) toast('Partida diaria completada · logro: ' + G.Run.dailyWon.name, 'good');
      for (const id of G.Run.unlockedNow) toast('Personaje desbloqueado: ' + G.Player.CHARS[id].name);
      if (G.Run.grimesNow) { G.Run.grimesNow = false; toast('Venganza cumplida · Extras: Grimes ya se puede comprar', 'good'); }
      again.textContent = 'Terminar la carrera';
      menu.classList.add('hidden');
      if (rw && tot) {
        rw.innerHTML = '<span>' + (G.Run.daily ? 'Partida diaria completada' : 'Carrera completada') + '</span><b class="c">Puntaje total: ' + tot.score + '</b><b class="p">Infectados: ' + tot.kills + '</b><small>' + (G.Run.daily && G.Run.dailyWon ? 'Logro: ' + G.Run.dailyWon.name : (G.World.layout === 'comisaria' ? 'Escapaste de la estación de policía' : (G.World.layout === 'faro_jefe' ? 'Venciste al Aguijón en el faro' : 'Venciste al hongomorfo'))) + (G.Run.rankGain ? ' · ' + rankLine(G.Run.rankGain) : '') + '</small>';
        rw.classList.remove('hidden');
      }
    } else if (gameMode === 'retorno' && G.Run.active && win) {
      const got = G.Run.winEncounter(player, total, G.Mode.stats);
      again.textContent = 'Volver al refugio';
      menu.classList.add('hidden');
      if (rw && got) {
        rw.innerHTML = '<span>Recompensa</span><b class="c">' + got.monedas + ' monedas</b><b class="p">' + got.piezas + ' piezas</b><b class="s">' + got.suplementos + ' suplementos</b><small>Te esperan en el cofre del refugio</small>';
        rw.classList.remove('hidden');
      }
    } else if (bossTry) {
      again.textContent = 'Volver al modo libre';
      menu.classList.remove('hidden');
      if (rw) rw.classList.add('hidden');
    } else {
      again.textContent = 'Jugar otra vez';
      menu.classList.remove('hidden');
      if (rw) rw.classList.add('hidden');
    }
  }
  function backToRefuge() {
    if (state !== 'over' || !G.Run.active) return;
    if (G.Run.bossWon) { finishRun(); return; }
    state = 'loading';
    el('m-stats').classList.add('hidden');
    G.Menus.loading(() => { enterRefuge(); prewarm(); }, () => { fadeTo(1, 0); fadeTo(0, 1.1); G.Menus.hide(); }, { min: 2.6 });
  }
  // el rango del personaje al terminar una carrera
  const rankName = (rg) => (G.Player.CHARS[rg.char] || {}).name || '';
  function rankLine(rg) { return rankName(rg) + ': +' + rg.xp + ' de experiencia (rango ' + rg.to + ')'; }
  function rankUp(rg) { return rankName(rg) + ' sube al rango ' + rg.to + (rg.text ? ' · ' + rg.text : ''); }
  // Jefe derrotado: se termina la carrera
  function finishRun() {
    const t = G.Run.totals, rg = G.Run.rankGain;
    const sm = G.Run.summary ? G.Run.summary('win') : null;
    if (rg && !sm) setTimeout(() => toast(rg.to > rg.from ? rankUp(rg) : rankLine(rg), 'good'), 2900);
    G.Run.discard();
    el('m-stats').classList.add('hidden');
    if (sm) { showSum(sm, () => { if (rg && rg.to > rg.from) setTimeout(() => toast(rankUp(rg), 'good'), 1600); toMenu(); }); return; }
    toast('Carrera completada · puntaje ' + (t ? t.score : 0), 'good');
    toMenu();
  }
  // el resumen de la carrera (G.Summary, resumen.js): al cerrarlo, after
  let pendingSum = null;
  function showSum(sm, after) {
    if (!sm || !G.Summary) { after(); return; }
    state = 'over';
    G.Input.enabled = false;
    if (document.exitPointerLock) document.exitPointerLock();
    G.Summary.show(sm, after);
  }
  // Menú de pausa → «Ir al menú principal»
  let quitSum = null;
  function quitToMenu() {
    if (gameMode === 'superv' && G.Surv && G.Surv.active) G.Surv.quit();          // (se guarda: al volver, se despierta en el último descanso)
    if (gameMode === 'retorno' && G.Run.active) {
      if (G.Run.inRefuge) G.Run.keep(player);
      else if (G.Run.inCalm) G.Run.endCalm(player, G.Calm && G.Calm.info);          // (una parada: cuenta como hecha y se vuelve al refugio)
      else { G.Run.recordEnd(G.Mode.stats); quitSum = G.Run.summary ? G.Run.summary('quit', G.Mode.stats) : null; G.Run.discard(); }
    }
    el('paused').classList.add('hidden');
    if (G.PauseMenu) G.PauseMenu.close();
    if (quitSum) { const sm = quitSum; quitSum = null; G.Mode.stop(); showSum(sm, toMenu); return; }
    toMenu();
  }

  // ---------- Fundido a negro ----------
  const fade = { el: null, a: 0, to: 0, sp: 0 };
  function fadeTo(to, dur) {
    if (!fade.el) {
      fade.el = document.createElement('div');
      fade.el.id = 'fade';
      document.body.appendChild(fade.el);
    }
    fade.to = to;
    if (!dur) { fade.a = to; fade.sp = 0; }
    else fade.sp = Math.abs(to - fade.a) / dur;
    fade.el.style.opacity = fade.a.toFixed(3);
    fade.el.style.display = fade.a > 0.001 || fade.to > 0 ? 'block' : 'none';
  }
  function updateFade(dt) {
    if (!fade.el || (fade.a === fade.to)) return;
    const d = fade.to - fade.a, st = fade.sp * Math.min(dt, 0.05);
    fade.a = Math.abs(d) <= st ? fade.to : fade.a + Math.sign(d) * st;
    // un poco más lento al principio y al final (se aclara rápido pero sin golpe)
    fade.el.style.opacity = U_smooth(fade.a).toFixed(3);
    fade.el.style.display = fade.a > 0.001 ? 'block' : 'none';
  }
  const U_smooth = (t) => t * t * (3 - 2 * t);
  G.fadeTo = (to, dur) => fadeTo(to, dur);

  // Vuelve al menú de inicio con un mundo nuevo
  function toMenu() {
    bossTry = false;
    if (G.Calm) G.Calm.stop();
    if (G.Surv) G.Surv.stop();
    document.body.classList.remove('superv');
    if (G.Tutorial) G.Tutorial.stop();
    tutoPending = null;
    document.body.classList.remove('asalto', 'practica', 'refugio', 'historia');
    storyPending = null; if (storyCancel) storyCancel();          // (la pantalla negra del modo historia, si seguía)
    if (G.NPCs) G.NPCs.clear();
    if (G.Story) G.Story.clear();
    if (G.Drive) G.Drive.stop(true);
    if (G.CitySound) G.CitySound.stop();
    G.Input.locks = null; document.body.classList.remove('st-lock');
    player.hidden = false; player.auto = null;
    if (G.Audio) G.Audio.calm = false;
    toggleSpawnList(false);
    el('m-stats').classList.add('hidden');
    el('dead').classList.add('hidden');
    G.Input.enabled = false;
    state = 'menu';
    G.Refugio.leave();
    G.Combat.peaceful = false;
    G.Run.inRefuge = false;
    G.Run.endFree();
    if (document.exitPointerLock) document.exitPointerLock();
    // el mundo nuevo se prepara detrás de la pantalla de carga y se vuelve al menú principal
    G.Menus.toMain(() => { resetWorld('campo'); setLighting('campo'); G.Weapons.applyUpgrades(null); });
  }

  // Corriendo contra una puerta cerrada la abres de un empujón (más ruido); contra una ventana
  // abierta o rota, o una valla, la saltas sin frenar
  function autoDoor() {
    if (!player.running || player.busy() || player.climb) return;
    const v = Math.hypot(player.vel.x, player.vel.z);
    if (v < 2.5) return;
    const W = G.World, E = W.E;
    const dx = player.vel.x / v, dz = player.vel.z / v;
    const x0 = player.pos.x, z0 = player.pos.z, x1 = x0 + dx * 0.6, z1 = z0 + dz * 0.6;
    const f = W.lineHit(x0, z0, x1, z1, (e) => e === E.DOOR || e === E.WIN_OPEN || e === E.WIN_BROKEN || e === E.FENCE, player.lv);
    if (f < 0) return;
    const ref = W.edgeAt(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, dx, dz, player.lv);
    if (!ref) return;
    const e = W.edgeGet(ref);
    const mx = ref.o === 'N' ? ref.x + 0.5 : ref.x, mz = ref.o === 'N' ? ref.z : ref.z + 0.5;
    if (e === E.DOOR) { W.setEdge(ref, E.DOOR_OPEN); W.emit(mx, mz, 7, player.lv); if (G.Audio) G.Audio.play('doorKick', { x: mx, z: mz, lv: player.lv }); if (G.Camera.shake) G.Camera.shake(0.06); }
    else if (!player.lv) {
      const m = G.Interact.climb({ climbable: true, ref, e, x: mx, z: mz }, player);
      if (m) toast(m, 'bad');
    }
  }

  function pause() {
    G.Loot.close(false);
    G.Backpack.close(false);
    state = 'paused';
    G.Input.enabled = false;
    el('paused').classList.remove('hidden');
    if (G.PauseMenu) G.PauseMenu.open();
  }

  function setDev(on) {
    devMode = !!on; G.DEV = devMode;
    try { localStorage.setItem(DEV_KEY, devMode ? '1' : '0'); } catch (e) { /* nada */ }
    document.body.classList.toggle('dev', devMode);
    if (devMode && player && !player.dead && state !== 'menu') { player.applyDev(); toast('Modo desarrollador: todas las armas'); }
    syncPerf();
    refreshQualityMenu();
  }
  function setPerf(on) {
    perfPref = !!on;
    try { localStorage.setItem(PERF_KEY, perfPref ? '1' : '0'); } catch (e) { /* nada */ }
    syncPerf();
  }
  function syncPerf() {
    perfOn = DEBUG || (devMode && perfPref);
    const d = el('debug');
    if (d) { d.classList.toggle('hidden', !perfOn); if (!perfOn) d.textContent = ''; }
    perfReset();
  }

  // Modo libre: viajar a otro mapa con lo que llevas (el campo de pruebas tiene el comercio y el banco gratis)
  function travelTo(id, noKeep, opts) {
    if (gameMode !== 'practica' || state !== 'playing') return;
    if (id === 'jefe') { bossTest(); return; }
    // tablero de simulación: el jefe en la estación de policía y el final variante (una carrera de prueba)
    if (id === 'jefe_com') { bossTest('comisaria'); return; }
    if (id === 'jefe_faro') { bossTest('faro_jefe'); return; }
    if (id.indexOf('parada_') === 0 && G.Calm && G.Calm.SCENES[id.slice(7)]) { calmTest(id.slice(7)); return; }
    if (id === 'sim_final') { simFinal(); return; }
    // pruebas de las modalidades (como en Retorno), en el Barrio
    const TRY = { lib_noche: { type: 'liberacion', map: 'capitolio', storm: true }, asalto_h: { type: 'asalto', humans: true }, caza_h: { type: 'caza', humans: true, time: 150 }, saqueo: { type: 'saqueo' }, resistencia: { type: 'resistencia' }, huida: { type: 'asalto', mixed: true }, huida_h: { type: 'asalto', humans: true, mixed: true }, liberacion: { type: 'liberacion', map: 'capitolio' }, trece: { type: 'asalto', map: 'capitolio', trece: true } };
    // (en un mapa al azar)
    if (TRY[id]) { const L = G.Maps.list(); bossTest(TRY[id].map || L[Math.floor(Math.random() * L.length)] || 'faro', Object.assign({ kit: false }, TRY[id])); return; }
    if (G.Run.active && !noKeep) G.Run.keep(player);
    const lay = id === 'libre' || !G.Maps.get(id) ? 'libre' : id;
    resetWorld(lay);
    if (G.Run.active) G.Run.restoreInv(player);
    setLighting(lay);
    // hora y clima elegidos en el panel de mapas (modo libre); «al azar» deja lo que sale solo
    if (opts && G.Sky) {
      if (opts.hour != null) { G.Sky.set(opts.hour, opts.wx || undefined); G.Sky.fixHour(true); }
      else if (opts.wx) G.Sky.set(null, opts.wx);
    }
    G.Refugio.enter(true);          // el panel de los mapas (y en el campo, el comercio y el banco)
    player.health = 100;
    if (devMode) player.applyDev();
    beginMode();
    toast('Mapa: ' + (lay === 'libre' ? 'Campo de pruebas' : G.Maps.get(lay).name), 'good');
  }

  // Tablero de simulación: el final variante. Una carrera de Retorno de prueba (no se guarda ni cuenta para los
  // récords) que empieza en el refugio con el último enfrentamiento antes del jefe por elegir: la liberación de
  // la caída
  function simFinal() {
    if (gameMode !== 'practica' || state !== 'playing') return;
    state = 'loading';
    G.Input.enabled = false;
    G.Input.requestLock();
    G.Menus.loading(() => {
      bossTry = false;
      gameMode = 'retorno';
      player.infinite = false; player.stockMax = {};
      document.body.classList.remove('practica');
      G.Run.simFinal(player.charId, player);
      enterRefuge();
      prewarm();
    }, () => { fadeTo(1, 0); fadeTo(0, 1.1); G.Menus.hide(); setTimeout(() => toast('Simulación · final variante: elige la liberación en el mapa del refugio', 'good'), 900); }, { min: 3.2, ready: loadReady });
  }

  // Modo libre: la batalla final de prueba (como al llegar al jefe en Retorno). Se guarda el equipo de antes y,
  // al terminar (ganes o mueras), se vuelve al campo de pruebas con él
  let bossTry = false;
  function bossTest(mapId, modeOpts) {
    mapId = mapId || 'arcade';
    if (G.Run.active) G.Run.keep(player);
    state = 'loading';
    G.Input.enabled = false;
    G.Input.requestLock();
    G.Menus.loading(() => {
      resetWorld(mapId);
      if (G.Run.active) G.Run.restoreInv(player);
      setLighting(mapId);
      player.health = 100;
      if (devMode) player.applyDev();
      player.infinite = false; player.stockMax = {};
      G.Combat.peaceful = false;
      document.body.classList.remove('refugio', 'practica');
      document.body.classList.add('asalto');
      bossTry = true;
      G.Mode.start(modeOpts || { type: 'jefe', kit: false });      // (no es Retorno: los desafíos no cuentan)
      prewarm();
      G.Input.enabled = true;
      G.Input.clear();
      if (G.Station) G.Station.begin(scene, player, (modeOpts && modeOpts.type) || 'jefe');
      if (G.Faro) G.Faro.begin(scene, player, (modeOpts && modeOpts.type) || 'jefe');
      state = 'playing';
    }, () => { fadeTo(1, 0); fadeTo(0, G.Station && G.Station.intro ? 3.6 : 1.1); G.Menus.hide(); }, { min: 4.6, ready: loadReady });
  }
  function backFromBoss() {
    bossTry = false;
    el('dead').classList.add('hidden');
    el('m-stats').classList.add('hidden');
    state = 'loading';
    G.Input.enabled = false;
    G.Menus.loading(() => {
      state = 'playing';
      travelTo('libre', true);            // con el equipo de antes de la batalla
      G.Input.enabled = true;
      G.Input.clear();
    }, () => { fadeTo(1, 0); fadeTo(0, 1.1); G.Menus.hide(); }, { min: 2.6 });
  }

  function toggleSpawnList(on) {
    const zl = el('zspawn-list');
    if (!zl) return;
    if (on == null) on = zl.classList.contains('hidden');
    if (state !== 'playing' || gameMode !== 'practica' || (G.Tutorial && G.Tutorial.active)) on = false;      // (en el entrenamiento, no)
    zl.classList.toggle('hidden', !on);
    const nb = zl.querySelector('button[data-z="nemi"]');
    if (nb) nb.lastChild.textContent = nemiName();
  }

  // Saca un zombi delante (a unos metros, donde haya sitio). kind: 'runner' (corredor), 'blind' (chaskeado)
  // o 'temb' (temblante). Solo en la práctica libre
  const ZNAMES = { runner: 'Corredor', blind: 'Chaskeado', temb: 'Temblante', stalker: 'Observador', hongo: 'Hongomorfo', nemi: 'Blindado' };
  // (huevo de pascua: con Vera y las pruebas de desarrollador, el blindado se llama por su apodo)
  function nemiName() { return devMode && player && player.charId === 'vera' ? 'Nemi' : 'Blindado'; }
  // humanos e infectados nunca a la vez: sacar unos quita a los otros
  function clearPop(humans) {
    const list = G.Population.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const z = list[i];
      if (!!z.human !== !!humans) continue;
      if (aimed === z) { G.Models.setOutline(z.model, false); aimed = null; }
      if (player.struggle && player.struggle.z === z) player.struggle = null;
      if (player.beaten && player.beaten.z === z) player.beaten = null;
      if (player.action && player.action.target === z) player.action = null;
      z.dispose(); list.splice(i, 1);
    }
    if (humans && G.Humans) G.Humans.reset();
  }
  function devSpawnZombie(kind) {
    if (gameMode !== 'practica' || state !== 'playing' || player.dead) return;
    if (kind === 'escuadron' && G.Humans) {
      // un escuadrón completo (los ocho papeles) lejos de ti, que empieza a limpiar la zona
      clearPop(false); clearPop(true);
      const z0 = G.Mode.farZone() || { x: player.pos.x + 20, z: player.pos.z + 20 };
      G.Humans.spawnSquad({ at: z0, active: true, face: Math.atan2(player.pos.x - z0.x, player.pos.z - z0.z) });
      if (G.Refugio && G.Refugio.ping) G.Refugio.ping(z0.x, z0.z, 'escorpion', 5);
      toast('Los Escorpiones: ocho supervivientes armados entran en la zona', 'bad');
      return;
    }
    if (G.Humans && G.Humans.members().length) clearPop(true);
    kind = ZNAMES[kind] ? kind : 'runner';
    const W = G.World, f = G.Camera.forward();
    const base = Math.atan2(f.x, f.z), lv = player.lv || 0;
    const inside = W.isIndoor(Math.floor(player.pos.x), Math.floor(player.pos.z), lv);
    for (let tries = 0; tries < 40; tries++) {
      const a = base + (tries === 0 ? 0 : (Math.random() - 0.5) * Math.min(6.2, 0.6 + tries * 0.2));
      const d = Math.max(2.5, 6 + Math.random() * 3 - tries * 0.12);
      const x = player.pos.x + Math.sin(a) * d, z = player.pos.z + Math.cos(a) * d;
      if (W.circleBlocked(x, z, kind === 'hongo' ? 0.6 : 0.35, lv)) continue;
      if (tries < 25 && W.isIndoor(Math.floor(x), Math.floor(z), lv) !== inside) continue;
      // aparece sin haberte visto: mirando hacia otro lado, quieto o deambulando
      const away = Math.atan2(x - player.pos.x, z - player.pos.z) + (Math.random() - 0.5) * 2;
      const zb = new G.Zombie(scene, x, z, null, away, { lv, blind: kind === 'blind', temb: kind === 'temb', stalker: kind === 'stalker', hongo: kind === 'hongo', nemi: kind === 'nemi' });
      zb.state = 'idle'; zb.timer = 1 + Math.random() * 3; zb.target = null; zb.notice = 0;
      G.Population.list.push(zb);
      toast(kind === 'nemi' ? nemiName() : ZNAMES[kind]);
      return;
    }
    toast('No hay sitio para sacar un zombi aquí', 'warn');
  }

  // ---------- Entrenamiento (Tutoriales): lo que necesita G.Tutorial ----------
  let tutoPending = null;
  // saca un infectado para una lección: delante (o con a: girado tanto respecto de la cámara), a d metros, donde
  // haya sitio y dentro del campo. o.face: 'toward' (mirándote) | 'away' (de espaldas) · o.idle: segundos quieto
  function tutoSpawn(kind, o) {
    if (gameMode !== 'practica' || player.dead) return null;
    const W = G.World, f = G.Camera.forward(), lv = player.lv || 0;
    const base = Math.atan2(f.x, f.z) + (o.a || 0), lo = W.ARENA_MIN + 1.5, hi = W.ARENA_MAX - 1.5;
    for (let tries = 0; tries < 60; tries++) {
      const a = base + (tries === 0 ? 0 : (Math.random() - 0.5) * Math.min(6.2, 0.4 + tries * 0.15));
      const d = Math.max(3, (o.d || 8) - tries * 0.12 + (tries ? (Math.random() - 0.5) * 2 : 0));
      const x = player.pos.x + Math.sin(a) * d, z = player.pos.z + Math.cos(a) * d;
      if (x < lo || z < lo || x > hi || z > hi) continue;
      if (W.circleBlocked(x, z, 0.4, lv) || W.isIndoor(Math.floor(x), Math.floor(z), lv)) continue;
      const toP = Math.atan2(player.pos.x - x, player.pos.z - z);
      const face = o.face === 'toward' ? toP : (o.face === 'away' ? toP + Math.PI : toP + Math.PI + (Math.random() - 0.5) * 1.6);
      const zb = new G.Zombie(scene, x, z, null, face, { lv, blind: kind === 'blind', temb: kind === 'temb', stalker: kind === 'stalker' });
      zb.state = 'idle'; zb.timer = o.idle != null ? o.idle : 1 + Math.random() * 2; zb.target = null; zb.notice = 0;
      G.Population.list.push(zb);
      return zb;
    }
    return null;
  }
  // quita los de una lección (vivos o muertos)
  function tutoClear(arr) {
    const list = G.Population.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const z = list[i];
      if (!arr || arr.indexOf(z) < 0) continue;
      if (aimed === z) { G.Models.setOutline(z.model, false); aimed = null; }
      if (player.struggle && player.struggle.z === z) player.struggle = null;
      if (player.beaten && player.beaten.z === z) player.beaten = null;
      if (player.action && player.action.target === z) player.action = null;
      z.dispose(); list.splice(i, 1);
    }
  }
  const tutoHost = {
    get player() { return player; },
    spawn: tutoSpawn, clear: tutoClear,
    toast: (t, k) => toast(t, k),
    playing: () => state === 'playing'
  };

  function resume() {
    if (state !== 'paused') return;
    if (G.HudEdit && G.HudEdit.editing) return;
    el('paused').classList.add('hidden');
    if (G.PauseMenu) G.PauseMenu.close();
    G.Input.enabled = true;
    G.Input.clear();
    G.Input.requestLock();
    state = 'playing';
  }

  function resetWorld(layout, lazy) {
    aimed = null; pickT = null;
    G.Loot.close(false);
    G.Backpack.close(false);
    G.Mode.stop();
    if (G.Calm) G.Calm.stop();
    G.Refugio.clear();
    G.Pickups.reset();
    G.Population.reset();
    if (layout) G.World.setLayout(layout);
    G.World.setFree(gameMode === 'practica');
    G.World.reset(newSeed());
    player.reset();
    if (devMode) player.applyDev();
    G.Combat.dragT = 0;
    G.Guns.reset();
    kills = 0; survived = 0; deadT = 0;
    G.Camera.yaw = Math.PI; G.Camera.pitch = 0.08;
    refreshWorld(!lazy, 0);
  }

  function retry() {
    if (gameMode === 'retorno') { toMenu(); return; }
    if (gameMode === 'historia') { storyRetry(); return; }
    if (gameMode === 'superv' && G.Surv && G.Surv.active) { el('dead').classList.add('hidden'); G.Surv.respawn(); return; }
    if (bossTry) { backFromBoss(); return; }
    resetWorld(gameMode === 'practica' ? 'libre' : 'campo');
    if (gameMode === 'practica') { G.Run.startFree(player.charId); G.Run.charKit(player); G.Refugio.enter(true); }
    el('dead').classList.add('hidden');
    el('m-stats').classList.add('hidden');
    G.Input.enabled = true;
    G.Input.clear();
    G.Input.requestLock();
    state = 'playing';
    beginMode();
  }

  // ---------- HUD ----------
  const NOISE_TEXT = ['Sigilo', 'Caminando', 'Corriendo: te oyen', 'Agachado', 'Pecho a tierra', 'Oculto en la hierba'];
  let toastN = 0;
  function toast(text, kind) {
    if (!showTips && kind !== 'bad') return;
    const box = el('toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = text;
    box.appendChild(d);
    toastN++;
    setTimeout(() => { d.classList.add('out'); }, 2600);
    setTimeout(() => { d.remove(); }, 3100);
    while (box.children.length > 3) box.firstChild.remove();
  }

  // ---------- ¿Te ven? (sigilo) ----------
  // Lo más que te tiene reconocida un enemigo cercano (0 a 1), si alguno te ve ya (o te persigue) y hacia dónde está.
  // Los observadores (que siempre saben dónde estás) y el jefe hongomorfo no cuentan
  const SEEN_ST = { chase: 1, attack: 1, recover: 1, alert: 1, combo: 1, runatk: 1, tcharge: 1, tdash: 1, troar: 1 };
  const DET = { k: 0, shown: false, key: '' };
  function detectNow() {
    let best = 0, bz = null, seen = false, hunt = false;
    const px = player.pos.x, pz = player.pos.z;
    for (const z of G.Population.list) {
      if (!z.alive || z.gone || z.ally || z.spared || z.hongo || (z.lv || 0) !== (player.lv || 0)) continue;
      const d = Math.hypot(z.pos.x - px, z.pos.z - pz);
      if (d > 45) continue;
      let k;
      if (z.human) {
        if (!z.squad || !z.squad.active || z.state === 'beg' || z.state === 'hostage' || z.state === 'flee') continue;
        if (z.squad.mode === 'search') hunt = true;
        k = z.seesP || z.calling ? 1 : (z.notice || 0);
      } else {
        if (z.observer && !z.obsFree) continue;
        k = SEEN_ST[z.state] && d < 35 ? 1 : (z.state === 'sus' ? Math.max(0.15, z.notice || 0) : (z.notice || 0) * 0.9);
      }
      if (k >= 1) seen = true;
      if (k > best + 0.02 || (k >= 1 && best >= 1 && bz && d < Math.hypot(bz.pos.x - px, bz.pos.z - pz))) { best = k; bz = z; }
    }
    return { k: Math.min(1, best), z: bz, seen, hunt };
  }
  function updateDetect(dt) {
    const box = el('detect');
    if (!box) return;
    const on = state === 'playing' && !player.dead && !G.Run.inRefuge && gameMode !== 'historia';
    const D = on ? detectNow() : { k: 0, z: null, seen: false, hunt: false };
    // (sube rápido y baja despacio, para que se lea)
    DET.k += (D.k - DET.k) * Math.min(1, dt * (D.k > DET.k ? 12 : 2.5));
    const show = on && (DET.k > 0.06 || D.seen || D.hunt);
    if (show !== DET.shown) { DET.shown = show; box.classList.toggle('hidden', !show); }
    if (!show) return;
    const cls = D.seen ? 'seen' : (DET.k > 0.6 ? 'hi' : (DET.k > 0.06 ? 'lo' : 'hunt'));
    if (cls !== DET.key) {
      DET.key = cls; box.className = 'dt-' + cls;
      box.querySelector('.dt-t').textContent = D.seen ? 'Te ven' : (cls === 'hunt' ? 'Te buscan' : '');
    }
    box.style.setProperty('--k', (D.seen ? 1 : DET.k).toFixed(3));
    const arr = box.querySelector('.dt-arr');
    if (D.z) {
      // hacia quien: en pantalla, desde arriba y en el sentido de las agujas del reloj
      const a = G.Util.angleDiff(Math.atan2(D.z.pos.x - player.pos.x, D.z.pos.z - player.pos.z), G.Camera.yaw);
      arr.style.transform = 'rotate(' + (-a * 180 / Math.PI).toFixed(1) + 'deg)';
      arr.style.opacity = '1';
    } else arr.style.opacity = '0';
  }

  // el texto de un botón (lo que vas a hacer) que no se salga de la pantalla: los botones se pueden mover (el
  // editor del mando) y uno pegado al borde cortaba los textos largos ('Leer la nota del banco')
  function fitLbl(l) {
    l.style.translate = '';
    if (l.offsetParent === null) { requestAnimationFrame(() => { if (l.offsetParent !== null) fitLbl(l); }); return; }
    const r = l.getBoundingClientRect(), W = window.innerWidth;
    const dx = r.right > W - 8 ? W - 8 - r.right : (r.left < 8 ? 8 - r.left : 0);
    if (dx) l.style.translate = Math.round(dx) + 'px 0';
  }
  function updateHud() {

    const n = el('noise');
    n.textContent = NOISE_TEXT[player.noiseLevel];
    n.className = 'n' + player.noiseLevel;
    const st = [];
    if (G.Sky && G.Sky.active) st.push((G.Sky.night ? 'Noche' : 'Día') + ' · ' + G.Sky.label(G.Sky.weather) + ' · ' + G.Sky.clock());       // la hora y el tiempo
    el('status').textContent = st.join(' · ');
    el('damage').style.opacity = Math.min(1, player.hurt * 2.2);
    // botón de cancelar: aparece al mantener Atacar para apuntar la botella o tensar el arco (móvil)
    const cb = el('btn-cancel');
    if (cb) {
      const now = performance.now(), hold = 180;
      const show = G.Input.isTouch && state === 'playing' && !!((player.thrPress && player.holdingThr && now - player.thrPress.t0 > hold) ||
        (player.bowPress && now - player.bowPress.t0 > hold));
      if (show && cb.classList.contains('hidden')) {
        const r = el('btn-attack').getBoundingClientRect();
        cb.style.left = Math.max(8, r.left - 50) + 'px'; cb.style.top = Math.max(8, r.top - 54) + 'px';
      }
      cb.classList.toggle('hidden', !show);
      if (!show) cb.classList.remove('hot');
    }
    // (vendándote ya no sale la barra en medio de la pantalla: el arco de vida muestra hasta dónde llegas)

    G.HUD.update(player, state);

    // botones de contexto: puerta/ventana, botín (∆) y saltar
    const p = el('prompt');
    const use = el('btn-use'), lb = el('btn-loot'), jb = el('btn-jump');
    const playing = state === 'playing';
    document.body.classList.toggle('playing', playing);
    const parts = [];
    if (grabT && playing) parts.push('<b>Clic</b>Agarrar por la espalda');
    else if (execT && playing) parts.push('<b>Clic</b>Rematar');
    if (playing && G.SafeCrack && G.SafeCrack.active) parts.push('<b>T</b>' + G.SafeCrack.label);
    if (pickT && playing && !player.busy()) parts.push('<b>T</b>' + G.Pickups.label(pickT));
    if (target && playing) parts.push('<b>E</b>' + target.label);
    if (lootT && playing) parts.push('<b>T</b>' + lootT.label);
    if (G.Loot.isOpen && playing) parts.push('<b>T</b>Cerrar');
    if (vaultT && playing) parts.push('<b>X</b>' + vaultT.label);
    const ph = parts.join(' &nbsp; ');
    if (ph) { if (p._h !== ph) { p._h = ph; p.innerHTML = ph; } p.classList.remove('hidden'); } else p.classList.add('hidden');
    use.classList.toggle('hidden', !(target && playing));
    if (target && playing) { const lbl = use.querySelector('.lbl'); if (lbl.textContent !== target.label) { lbl.textContent = target.label; fitLbl(lbl); } }
    // (el agarre para morder y la caja fuerte también usan Recoger)
    const qteOn = playing && !!(player.struggle && player.struggle.qte), crackOn = playing && !!(G.SafeCrack && G.SafeCrack.active);
    const lootOn = playing && (qteOn || crackOn || !!lootT || G.Loot.isOpen || !!pickT || !!(G.Surv && G.Surv.cranking) || (gameMode === 'historia' && !!target));
    lb.classList.toggle('hidden', !lootOn);
    lb.classList.toggle('on', G.Loot.isOpen);
    if (lootOn) { const t = qteOn ? 'Apuñalar' : (crackOn ? G.SafeCrack.label : (G.Loot.isOpen ? 'Cerrar' : (pickT ? 'Coger' : (lootT ? lootT.label : (target ? target.label : 'Girar la manivela'))))); const l2 = lb.querySelector('.lbl'); if (l2.textContent !== t) { l2.textContent = t; fitLbl(l2); } }
    // arrojable que llevas
    const th = playing ? (player.inHandThr || player.throwable || (player.items.molotov ? 'molotov' : null)) : null;
    if (updateHud._th !== th) {
      updateHud._th = th;
      const u = th ? G.Icons.white(th) : null;
      el('thr').classList.toggle('hidden', !th);
      if (u) el('thr').querySelector('img').src = u;
    }
    // forcejeo: anillo que se llena con cada pulsación
    const sg = playing && player.struggle ? player.struggle : null;
    const mash = el('mash');
    mash.classList.toggle('hidden', !sg);
    if (sg) {
      mash.querySelector('.mash-fg').style.strokeDasharray = Math.round(sg.prog * 100) + ' 100';
      // el agarre para morder: el anillo se llena hasta el mordisco y se pone rojo cuando hay que tocar Recoger
      const key = sg.qte ? (G.Input.isTouch ? 'Apuñalar' : 'T') : (G.Input.isTouch ? 'Atacar' : 'Clic');
      const mk = mash.querySelector('.mash-key');
      if (mk.textContent !== key) mk.textContent = key;
      const tx = sg.qte ? (sg.early ? '¡Demasiado pronto!' : '¡Contraataca!') : '¡Suéltate!', mt = mash.querySelector('.mash-tx');
      if (mt.textContent !== tx) mt.textContent = tx;
      mash.classList.toggle('qte', !!sg.qte);
      mash.classList.toggle('go', !!sg.qte && !sg.early && sg.t >= sg.biteT - sg.win);
      mash.classList.toggle('late', !!sg.qte && !!sg.early);
    }
    jb.classList.toggle('vault', !!(vaultT && playing));
    const bag = el('bag');
    bag.classList.toggle('on', G.Backpack.isOpen);
    bag.classList.toggle('nopack', !player.backpack);
    const nv = player.items.venda;
    const bs = bag.querySelector('span');
    if (bs.textContent !== String(nv)) bs.textContent = nv;
    // munición y retícula de las armas de fuego
    const w = player.weapon, sl = player.slot, isGun = G.Weapons.isGun(w) && !!sl;
    const ch = el('crosshair');
    const gunAim = isGun && player.aiming && w.gun !== 'bow';
    // con el arco y con la botella en la mano no hay mira: la línea verde marca por dónde va
    ch.classList.toggle('hidden', player.aiming && (player.holdingThr || (isGun && w.gun === 'bow')));
    ch.classList.toggle('aim', player.aiming && !isGun && !player.holdingThr);
    ch.classList.toggle('gun', gunAim);
    ch.classList.toggle('target', gunAim && !!aimed);
    if (gunAim) {
      const sp = G.Guns.viewSpread(player);
      const px = Math.round(Math.min(160, Math.tan(sp) / Math.tan(camera.fov * Math.PI / 360) * window.innerHeight / 2) * 2 + 8);
      if (ch._px !== px) { ch._px = px; ch.style.width = ch.style.height = px + 'px'; ch.style.margin = (-px / 2) + 'px 0 0 ' + (-px / 2) + 'px'; }
    } else if (ch._px) { ch._px = 0; ch.style.width = ch.style.height = ch.style.margin = ''; }
    el('btn-reload').classList.toggle('hidden', !(isGun && w.gun !== 'bow'));
    // atacar se convierte en agarrar si tienes a un zombi desprevenido de espaldas
    const ab = el('btn-attack');
    const grabbing = state === 'playing' && !player.aiming ? (grabT ? 'Agarrar' : (execT ? 'Rematar' : '')) : '';
    if (ab._g !== grabbing) { ab._g = grabbing; ab.classList.toggle('grab', !!grabbing); ab.querySelector('.lbl').textContent = grabbing; }
    el('cine').classList.toggle('on', !!(player.action && player.action.kind === 'finisher'));      // en el vídeo los remates no llevan bandas negras

    let chasing = 0;
    for (const z of G.Population.list) if (z.alive && (z.state === 'chase' || z.state === 'attack' || z.state === 'bang')) chasing++;
    el('chasers').textContent = chasing ? (chasing === 1 ? 'Te persigue 1 zombi' : 'Te persiguen ' + chasing + ' zombis') : '';
  }

  // ---------- Aturdimiento de la bomba de humo ----------
  // La imagen se emborrona y se arrastra (se superponen los fotogramas anteriores) y pita fuerte un rato
  const daze = { t: 0, dur: 0, k: 0, cv: null, ctx: null, hold: 0, holdK: 0 };
  G.Daze = {
    start(k) {
      k = Math.max(0.3, Math.min(1, k));
      daze.dur = 1.6 + 1.4 * k; daze.t = daze.dur; daze.k = k;
      if (G.Audio && G.Audio.daze) G.Audio.daze(k, daze.dur);
      if (G.Camera.wobble) G.Camera.wobble(0.5 + 0.7 * k);
      if (G.Camera.shake) G.Camera.shake(0.3 * k);
    },
    // aturdido un rato largo (el prólogo, tras el choque): la imagen sigue desfasada y la cámara temblando, a
    // la fuerza k, hasta hold(0) (entonces se va yendo en un segundo)
    hold(k) { daze.hold = Math.max(0, Math.min(1, k || 0)); },
    get active() { return daze.t > 0 || daze.holdK > 0.02; }
  };
  function updateDaze(dt) {
    daze.holdK += (daze.hold - daze.holdK) * Math.min(1, dt * (daze.hold > daze.holdK ? 2.5 : 1.2));
    if (daze.holdK < 0.01 && !daze.hold) daze.holdK = 0;
    if (daze.t <= 0 && !daze.on && daze.holdK <= 0) return;
    const gl = renderer.domElement;
    if (!daze.cv) {
      daze.cv = document.createElement('canvas');
      daze.cv.id = 'daze';
      daze.cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;filter:blur(2px)';
      gl.parentNode.appendChild(daze.cv);
      daze.ctx = daze.cv.getContext('2d');
    }
    daze.t -= dt;
    const play = state === 'playing' || state === 'frozen';
    if (!play) daze.hold = daze.holdK = 0;
    if ((daze.t <= 0 && daze.holdK <= 0) || !play) {
      daze.t = 0; daze.on = false;
      daze.cv.style.opacity = '0'; gl.style.filter = '';
      daze.ctx.clearRect(0, 0, daze.cv.width, daze.cv.height);
      return;
    }
    daze.on = true;
    let f = daze.t > 0 ? Math.min(1, daze.t / daze.dur * 1.4) * daze.k : 0;
    if (daze.holdK > 0) {
      f = Math.max(f, daze.holdK);
      // (con el vaivén: la cámara no deja de mecerse mientras dura)
      if (G.Camera.wobble) G.Camera.wobble(0.35 + 0.75 * daze.holdK);
    }
    const w = Math.max(1, gl.width >> 2), h = Math.max(1, gl.height >> 2);
    if (daze.cv.width !== w || daze.cv.height !== h) { daze.cv.width = w; daze.cv.height = h; }
    try { daze.ctx.globalAlpha = 0.28; daze.ctx.drawImage(gl, 0, 0, w, h); } catch (e) { /* nada */ }
    daze.cv.style.opacity = (0.8 * Math.min(1, f * 1.3)).toFixed(3);
    gl.style.filter = 'blur(' + (3.2 * f).toFixed(2) + 'px)';
  }

  // ---------- Ritmo ----------
  // el paso del tiempo de la partida depende del tono del menú (ver Menus.tone)
  let flow = 0, tuneT = 0;
  function tune() {
    G.__s = ((G.Menus && G.Menus.tone ? G.Menus.tone() : 0) ^ 0x5e3a91c7) | 0;
    flow = 1 / (1 + Math.abs((G.__s ^ G.World.CHUNK_SALT) | 0));
  }

  // ---------- Bucle ----------
  const prof = { logic: 0, zombies: 0, world: 0, render: 0, n: 0, ms: 0, worst: 0, frames: 0, t: 0, draws: 0, shDraws: 0, tris: 0 };
  function perfReset() { prof.logic = prof.zombies = prof.world = prof.render = 0; prof.n = 0; prof.ms = prof.worst = prof.t = 0; prof.frames = 0; prof.draws = prof.shDraws = prof.tris = 0; }
  let lodRankT = 0;
  const shC = { x: null, z: null };          // el centro de la zona de sombra del sol (ver más abajo)
  function loop(ts) {
    requestAnimationFrame(loop);
    // límite opcional de 30 fps (gasta menos batería y calienta menos)
    if (Q.fps30 && ts - last < 1000 / 30 - 3) return;
    const realMs = last ? ts - last : 0;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0) * flow;
    last = ts;
    renderer.info.reset();            // (se cuenta todo el fotograma: sombras, linterna y escena)
    // (la liberación de la caída: más sonidos a la vez, para que no se corten; en lo demás, el límite de siempre)
    if (G.Audio && G.Audio.setBusy) G.Audio.setBusy(!!(G.Mode && G.Mode.active && G.Mode.fatal));
    if ((tuneT += 1) > 240) { tuneT = 0; tune(); }
    let tA = perfOn ? performance.now() : 0, tB = tA;

    // detrás de la pantalla de carga se arman los cuerpos de los infectados que faltan (un poco cada fotograma)
    if (G.Menus && G.Menus.covering && G.Zombie.pool && G.Zombie.pool.missing()) G.Zombie.pool.step(28);
    // (detrás de la pantalla de carga el juego espera)
    if (state === 'playing' && !(G.Menus && G.Menus.covering) && G.Drive && G.Drive.road) {
      // modo historia, conduciendo por la calle (escena aparte: la estación ya no está). Solo el coche, las voces
      // (subtítulos) y lo que pasa en el capítulo
      G.Input.update(dt);
      if (G.Input.pause) pause();
      else {
        G.Drive.update(dt);
        if (G.Humans) G.Humans.update(dt, player);
        if (G.Story) G.Story.update(dt, player);
        if (G.Surv && G.Surv.active) G.Surv.driveTick(dt);          // (el modo supervivencia: el coche de la Trece)
      }
    } else if (state === 'playing' && !(G.Menus && G.Menus.covering)) {
      survived += dt;
      if (pendingToast) { const t = pendingToast; pendingToast = null; setTimeout(() => toast(t, 'good'), 900); }
      G.Input.update(dt);
      // con un panel del refugio abierto (mapa, comercio, banco) la protagonista se queda quieta
      if (G.Refugio.panelOpen || (G.Calm && G.Calm.busy) || (G.Surv && G.Surv.busy)) G.Input.zero();
      if (G.Input.pause) { pause(); }
      const zombies = G.Population.list;
      const camYaw = Math.atan2(G.Camera.forward().x, G.Camera.forward().z);
      if (!player.dead) {
        G.Combat.handleInput(player, G.Input, zombies, camYaw);
        // con el rifle apuntando, la rueda (o el 2.º toque de Apuntar) pone o quita la mira
        const scopeOk = scopeReady() && player.aiming;     // (Di' Arco: sin la mira telescópica; los demás, con la mejora Mira x2)
        if (G.Input.cycle) {
          if (scopeOk && !G.Input.isTouch) player.scope = !player.scope;
          else { const m = player.cycleWeapon(); if (m) toast(m); }
        }
        if (G.Input.quick) { const m = player.quickSwap(); if (m) toast(m); }
        if (G.Input.scope && scopeOk) player.scope = true;
        if (G.Input.scopeToggle && scopeOk) player.scope = !player.scope;        // (mando: Cruz apuntando)
        // la mira x2 con su propio botón (M, L3 o el botón x2 en pantalla): apuntando la pone o la quita; sin apuntar,
        // en el móvil apunta y mira por ella de una vez (con teclado o mando, la pone en cuanto apuntes)
        if (G.Input.mira) {
          const w = player.weapon;
          if (!w || !w.scope) toast('La mira x2 es del rifle');
          else if (!scopeReady(w)) toast(player.perks.noScope ? player.charName + ' apunta sin la mira telescópica' : 'Mira x2: hace falta la mejora del banco del refugio');
          else if (player.aiming) player.scope = !player.scope;
          else { player.wantScope = 1.2; if (G.Input.isTouch && G.Input.setAim) G.Input.setAim(true); }
        }
        if (player.wantScope > 0) { player.wantScope -= dt; if (scopeOk) { player.scope = true; player.wantScope = 0; } }
        for (const n of [1, 2, 3, 4]) if (G.Input['slot' + n]) { const m = player.selectSlot(n); if (m) toast(m); }
        if (G.Input.grip) { const m = player.toggleGrip(); if (m) toast(m); }
        if (G.Input.pack) { if (player.hostage) toast('Con un rehén no puedes abrir la mochila', 'warn'); else G.Backpack.open(player); }
        if (G.Input.flash && G.Flash) G.Flash.toggle();
        // B: la venda a la mano (o de vuelta al arma de antes)
        if (G.Input.bandage && !player.busy()) {
          if (player.cur === -3) { const b = player.prev; player.equip(b >= 0 && player.hands[b] ? b : -1); }
          else { player.equip(-3); toast(player.cur === -3 ? 'Venda en la mano: mantén Atacar para vendarte' : 'No tienes vendas', player.cur === -3 ? '' : 'warn'); }
        }
        // G / cruceta arriba: la botella (o el ladrillo) a la mano, o de vuelta al arma de antes.
        // Con ella en la mano: un toque de Atacar la lanza al fijado, mantener apunta y al soltar la lanza
        if (G.Input.throw && player.hostage) toast('Con un rehén no puedes lanzar nada', 'warn');
        else if (G.Input.throw && !player.busy()) {
          // pasa por la botella (o el ladrillo), la molotov y la bomba de humo, y vuelve al arma de antes
          const order = [-2, -4, -6, -7].filter((s) => (s === -2 ? !!player.throwable : (s === -4 ? player.items.molotov > 0 : (s === -6 ? player.items.humo > 0 : player.items.pandora > 0))));
          const at = order.indexOf(player.cur);
          if (at >= 0) { if (at < order.length - 1) player.equip(order[at + 1]); else { const b = player.preThr; player.equip(b != null && b >= 0 && player.hands[b] ? b : -1); } }
          else if (order.length) { player.preThr = player.cur; player.equip(order[0]); }
          else toast('No llevas nada que lanzar (busca ladrillos y botellas)');
        }
        const camF = G.Camera.forward();
        const busyMenu = G.Loot.isOpen || G.Backpack.isOpen || !!(G.Station && G.Station.intro) || !!(G.Calm && G.Calm.busy) || !!(G.Surv && G.Surv.busy);
        target = busyMenu ? null : G.Interact.find(player, camF, 'door');
        lootT = busyMenu ? null : G.Interact.find(player, camF, 'loot');
        vaultT = busyMenu ? null : G.Interact.find(player, camF, 'vault');
        // ∆ / T: abre o cierra el botín. En el mando (A) es contextual: botín primero, si no la puerta
        const padA = G.Input.use && !!G.Input.padUse;
        // mantener Recoger: todo lo que hay delante de una vez (un cofre de suministros, por ejemplo)
        if (G.Input.lootHeld && !G.Loot.isOpen) {
          lootHoldT += dt;
          if (lootHoldT > 0.42 && !lootHoldDone) { lootHoldDone = true; G.Pickups.collectAll(player, camF.x, camF.z); }
        } else { lootHoldT = 0; lootHoldDone = false; }
        // Recoger durante el agarre para morder (contraataque) o abriendo la caja fuerte (el minijuego): solo eso
        const qteNow = !!(player.struggle && player.struggle.qte), crackNow = !!(G.SafeCrack && G.SafeCrack.active);
        if (qteNow || crackNow) {
          if (G.Input.loot || G.Input.use) { if (qteNow) G.Combat.qtePress(player); else G.SafeCrack.press(); }
        } else if (pickT && !G.Loot.isOpen && (G.Input.loot || padA) && !(lootT && lootT.kind === 'spare')) {
          const m = G.Pickups.startPickup(player, pickT); if (m) toast(m, 'warn');
        } else if (G.Input.loot || (padA && (lootT || G.Loot.isOpen))) {
          if (G.Loot.isOpen) G.Loot.close(true);
          else if (lootT) { const m = G.Interact.use(lootT, player); if (m) toast(m); lootT = null; }
          // (modo historia: el mismo botón sirve para casi todo, también las puertas)
          else if (gameMode === 'historia' && target) { const m = G.Interact.use(target, player); if (m) toast(m); target = null; }
        } else if (G.Input.use) {
          if (G.Loot.isOpen) G.Loot.close(true);
          else if (target) { const m = G.Interact.use(target, player); if (m) toast(m); target = null; }
        }
        // Saltar: trepa si tienes delante una valla o una ventana abierta o rota; si no, un saltito
        if (G.Input.jump) {
          if (vaultT) { const m = G.Interact.climb(vaultT, player); if (m) toast(m, 'bad'); vaultT = null; }
          else player.jump();
        }
        if (autoDoors) autoDoor();
      } else target = null;
      // parón de impacto: unos instantes a cámara muy lenta al acertar un golpe
      const hs = G.Combat.hitStop > 0;
      if (hs) G.Combat.hitStop = Math.max(0, G.Combat.hitStop - dt);
      const gdt = hs ? dt * 0.12 : dt;
      // la entrada a la estación (cinemática): camina sola; la cámara la lleva G.Station
      const stIntro = !!(G.Station && G.Station.intro);
      if (G.Station) G.Station.update(gdt, player);
      if (G.Faro) G.Faro.update(gdt, player);
      if (G.Calm && G.Calm.active) G.Calm.update(gdt, player);          // (las paradas de Retorno que se juegan)
      if (G.Surv && G.Surv.active) G.Surv.update(gdt, player);          // (el modo supervivencia: los descansos, la reja, el camino)
      // (o la del modo supervivencia: la persiana del taller, donde camina sola)
      const svCine = !!(G.Surv && G.Surv.cine);
      player.update(gdt, stIntro ? G.Station.input : (svCine ? G.Surv.cineInput : G.Input), stIntro ? G.Station.cam : (svCine ? G.Surv.cineCam : G.Camera));
      // contorno amarillo: al apuntar (en móvil, cuando hay un zombi a tu alcance delante)
      let tgt = null;
      const gun = G.Weapons.isGun(player.weapon);
      if (!player.dead && gun) {
        if (player.aiming) tgt = G.Guns.rayTarget(player, zombies);
      } else if (!player.dead) {
        // cuerpo a cuerpo: se marca el zombi al que vas a pegar (el más cercano, o hacia donde empujas)
        const mt = G.Combat.meleeTarget(player, zombies, camYaw, G.Input, 1.0);
        tgt = mt ? mt.z : null;
      }
      grabT = player.dead ? null : G.Combat.grabTarget(player, zombies);
      if (grabT && !tgt) tgt = grabT;
      // forcejeando o rematando no se marca a nadie; un aturdido al alcance se marca (se puede rematar)
      execT = null;
      if (player.struggle || (player.action && player.action.exec)) tgt = null;
      else if (player.fatalCam) tgt = null;
      else if (!player.aiming && !player.busy()) { execT = player.dead ? null : G.Combat.execTarget(player, zombies); if (execT) tgt = execT; }
      if (tgt !== aimed) {
        if (aimed) G.Models.setOutline(aimed.model, false);
        if (tgt && tgt.state !== 'feign') G.Models.setOutline(tgt.model, true);        // (el que se hace el muerto no se delata)
        aimed = tgt;
      }
      G.Combat.update(gdt, player, zombies);
      G.Mode.update(gdt);
      if (gameMode === 'practica' && G.Tutorial && G.Tutorial.active) G.Tutorial.update(gdt);
      if (G.Humans) G.Humans.update(gdt, player);
      if (gameMode === 'historia' && G.NPCs) G.NPCs.update(gdt, player);
      if (gameMode === 'historia' && G.Story) G.Story.update(gdt, player);
      if (G.Drive && G.Drive.active && !G.Drive.road) G.Drive.update(gdt);          // (sacando el patrullero del garaje)
      if (gameMode === 'practica') cleanCorpses(gdt);
      G.Loot.update();
      G.Refugio.update(dt);
      if (G.Maps) { G.Maps.followSky(camera); G.Maps.updateDecor(dt); }
      if (G.Sky) G.Sky.update(gdt);
      if (G.BossFx) G.BossFx.update(gdt);
      G.Backpack.update(player);
      G.Guns.update(gdt, player, zombies);
      if (perfOn) { tB = performance.now(); prof.logic += tB - tA; tA = tB; }
      // detalle alto solo para los más cercanos (ver G.Zombie.rankLOD)
      if ((lodRankT -= dt) <= 0) { lodRankT = 0.2; G.Zombie.rankLOD(zombies, G.Camera.pos, Q.cur.hiN || 4); }
      // (resistencia: los infectados van a por ti o a por tu compañero)
      for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i], tg = G.Mode.targetFor ? G.Mode.targetFor(z) : null;
        if (tg) z.update(gdt, tg.p, zombies, tg.c); else z.update(gdt, player, zombies, G.Combat);
      }
      if (perfOn) { tB = performance.now(); prof.zombies += tB - tA; tA = tB; }
      refreshWorld(false, dt);
      if (perfOn) { tB = performance.now(); prof.world += tB - tA; tA = tB; }
      Q.sample(dt);
      if (player.dead) {
        deadT += dt;
        if (player.fatal) fatalTick();
        else if (deadT > 2.2) die();
      }
    } else if (state === 'menu' || state === 'dead' || state === 'paused' || state === 'over') {
      if (state !== 'menu' && G.Input.padConfirm() && !(G.HudEdit && G.HudEdit.editing)) {
        if (state === 'over') { if (gameMode === 'retorno') backToRefuge(); else retry(); }
        else if (state === 'dead') { if (gameMode === 'retorno') toMenu(); else retry(); }
        else if (!(G.PauseMenu && G.PauseMenu.handlesKeys)) resume();
      }
      if (state === 'menu') {
        // la cámara gira lentamente alrededor de la casa en el menú
        G.Camera.yaw += dt * 0.08;
      }
    }

    if (G.Audio) G.Audio.update(dt, player, G.Population.list, state === 'playing');
    if (G.Music) G.Music.update(dt, state, player);
    if (G.Drive && G.Drive.active) G.Drive.paused(state !== 'playing' || !!(G.Menus && G.Menus.covering));
    player.apply(state === 'playing' && G.Combat.hitStop > 0 ? dt * 0.12 : dt);
    // zoom al apuntar con armas de fuego; con el rifle, mira telescópica
    const wpn = player.weapon;
    // la mira telescópica solo aparece si la pides (2.º toque de Apuntar, V, rueda o LB)
    updateListen(dt);
    const scoped = state === 'playing' && scopeReady(wpn) && player.aiming && player.scope && player.gun.aim > 0.85 && !player.dead;
    G.Input.scopeable = scopeReady(wpn) && player.aiming;
    G.Input.scoped = !!player.scope;
    if (G.Input.scopeable && !scopeHint && state === 'playing') {
      scopeHint = true;
      toast(G.Input.isTouch ? 'Toca x2 para mirar por la mira' : 'M, rueda o V: mirar por la mira telescópica');
    }
    el('btn-aim').classList.toggle('scope', !!scoped);
    // el botón x2: con el rifle en la mano (atenuado si falta la mejora); encendido mirando por la mira
    const canScope = state === 'playing' && !!(wpn && wpn.scope) && !player.perks.noScope && !player.dead;
    document.body.classList.toggle('scope-ok', canScope);
    document.body.classList.toggle('scope-off', canScope && !scopeReady(wpn));
    document.body.classList.toggle('scope-on', !!scoped);
    let fovT = baseFov * (scoped ? 0.36 : (G.Weapons.isGun(wpn) ? 1 - 0.12 * player.gun.aim : (player.aiming && player.holdingThr ? 0.88 : 1)));
    // golpe de zoom al acertar un golpe cuerpo a cuerpo (la cámara "entra" en el impacto)
    const kick = G.Camera.fovKick || 0;
    fovT += (scoped ? 0 : (G.Camera.fovOff || 0)) - kick;
    if (Math.abs(camera.fov - fovT) > 0.05) {
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * (scoped ? 14 : (kick > 0.3 ? 22 : 9)));
      camera.updateProjectionMatrix();
    }
    el('scope').classList.toggle('hidden', !scoped);
    scopedNow = scoped;
    // sensibilidad (opciones): la general, y aparte apuntando y con la mira del rifle
    const lookSens = sensMul('look') * (scopedNow ? sensMul('scope') : (player.aiming ? sensMul('aim') : 1));
    closeCam(dt);
    indoorLight(dt);
    if (!G.Camera.held) G.Camera.update(dt, player, state === 'playing' && !(G.Station && G.Station.intro) ? G.Input : { look: { x: 0, y: 0 } }, lookSens);
    if (bench.on) benchCam();
    // la linterna (después de la cámara: apunta al centro de la pantalla)
    if (G.Flash) { camera.updateMatrixWorld(); G.Flash.update(dt, player, camera, state === 'playing' && !G.Menus.wants3d); }
    // paredes transparentes (opción): lo que quede entre la cámara y el personaje
    if (G.SeeThru) G.SeeThru.update(camera, player, (state === 'playing' || state === 'paused') && !G.Menus.wants3d && !scopedNow && !player.hidden);
    // objetos sueltos y proyectiles (después de la cámara: los iconos siguen a lo que se ve)
    {
      const playing = state === 'playing';
      const pdt = playing ? (G.Combat.hitStop > 0 ? dt * 0.12 : dt) : 0;
      const cf = G.Camera.forward();
      pickT = G.Pickups.update(pdt, player, G.Population.list, camera, Math.atan2(cf.x, cf.z), playing);
    }
    player.model.root.visible = ((!G.Camera.near && !scopedNow) || player.dead) && !player.hidden;      // (hidden: dentro del patrullero)

    // el sol sigue al jugador (en pasos para que la sombra no tiemble). Cada paso obliga a rehacer la sombra fija del
    // mundo entera (un tirón), así que la zona de sombra se queda quieta hasta que el jugador se aleja un cuarto de
    // su tamaño de donde estaba (antes: cada 2 metros). Sigue cubriendo de sobra lo que tiene alrededor
    {
      const S = Q.cur.shadowSize || 22, lim = S * 0.25;
      if (shC.x == null || Math.abs(player.pos.x - shC.x) > lim || Math.abs(player.pos.z - shC.z) > lim) {
        shC.x = Math.round(player.pos.x / 2) * 2; shC.z = Math.round(player.pos.z / 2) * 2;
      }
    }
    const sx = shC.x, sz = shC.z;
    const so = G.Sky ? G.Sky.sunOffset() : [-16, 32, 11];
    sun.position.set(sx + Math.round(so[0]), Math.round(so[1]), sz + Math.round(so[2]));
    sun.target.position.set(sx, 0, sz);
    // día y noche, clima y partículas (mapas de los enfrentamientos)
    if (G.Sky && G.Sky.active) {
      const at = { x: player.pos.x, y: player.y || 0, z: player.pos.z, scene };
      G.Sky.apply({ scene, hemi, sun, at });
      G.Sky.update3d(state === 'playing' ? dt : 0, camera, at);
    }

    updateHud();
    updateDetect(dt);
    if (perfOn) tA = performance.now();
    // menús de inicio: el personaje en 3D, o nada (el fondo animado tapa la pantalla y así no gasta)
    const SC = G.ShadowCache;
    if (G.Menus && G.Menus.wants3d) { if (SC) SC.off(); G.Menus.render3d(renderer, dt); }
    else if (G.Menus && G.Menus.covering) { /* la pantalla de carga tapa todo */ }
    else if (G.Drive && G.Drive.road) { if (SC) SC.off(); G.Drive.render(renderer); }             // (la calle del prólogo: su propia escena)
    else if (G.Refugio.wants3d && state === 'playing') { if (SC) SC.off(); G.Refugio.render3d(renderer, dt); }
    else {
      if (G.Flash) G.Flash.render(renderer, scene, player);
      // la sombra del sol en dos capas (ver shadowcache.js): lo fijo guardado, lo que se mueve cada fotograma.
      // «Sombras a medias»: lo que se mueve, un fotograma sí y otro no
      const half = !!(Q.shadow && Q.shadow.half);
      if (SC && SC.frame(scene, camera, half)) {
        scene.autoUpdate = false;                 // (las matrices ya se pusieron al día para la sombra)
        try { renderer.render(scene, camera); } finally { scene.autoUpdate = true; }
      } else {
        renderer.shadowMap.autoUpdate = true;
        renderer.render(scene, camera);
      }
    }
    updateDaze(dt);
    updateFade(dt);
    if (perfOn) { prof.render += performance.now() - tA; prof.n++; }

    if (perfOn && realMs > 0) perfTick(realMs);
    if (realMs > 0) { benchTick(realMs); dynTick(realMs); }
  }

  // ---------- Contador de rendimiento (modo desarrollador) ----------
  // fps y ms por fotograma (y el peor), llamadas de dibujo (y cuántas son de la sombra del sol), triángulos, cuántas
  // veces por segundo se rehace la sombra fija, y cuánto tarda cada parte en el procesador. Con eso se ve qué limita:
  // si el procesador ocupa casi todo el fotograma, es el procesador; si le sobra y aun así va lento, la placa de video
  function perfTick(ms) {
    const inf = renderer.info.render, SC = G.ShadowCache;
    prof.ms += ms; prof.frames++; prof.t += ms;
    if (ms > prof.worst) prof.worst = ms;
    prof.draws += inf.calls; prof.tris += inf.triangles;
    if (SC && SC.stats.on) prof.shDraws += SC.stats.draws;
    const scs = SC ? SC.rate(ms / 1000) : null;
    if (prof.t < 500) return;
    const f = prof.frames, n = Math.max(1, prof.n), avg = (v) => v / n;
    const frameMs = prof.ms / f, fps = 1000 / frameMs;
    const cpu = avg(prof.logic) + avg(prof.zombies) + avg(prof.world) + avg(prof.render);
    const lim = fps >= 56 ? 'va sobrado' : (cpu >= frameMs * 0.7 ? 'procesador' : 'placa de video');
    const st = G.World.stats();
    const d1 = (v) => v.toFixed(1).replace('.', ',');
    const dynTxt = dynK < 1 ? ' · nitidez ' + Math.round(dynK * 100) + ' %' : '';
    const shTxt = !scs ? '' : (scs.on ? ' · sombra fija ' + d1(scs.staticRate) + '/s' : (sun.castShadow ? ' · sombras sin capas' + (SC.why ? ' (' + SC.why + ')' : '') : ' · sin sombras'));
    el('debug').textContent =
      Math.round(fps) + ' fps · ' + d1(frameMs) + ' ms (peor ' + Math.round(prof.worst) + ') · limita: ' + lim + '\n' +
      Math.round(prof.draws / f) + ' dibujos (sombra ' + Math.round(prof.shDraws / f) + ') · ' + Math.round(prof.tris / f / 1000) + 'k triángulos' + shTxt + '\n' +
      'procesador ms: lógica ' + d1(avg(prof.logic)) + ' · infectados ' + d1(avg(prof.zombies)) + ' · mundo ' + d1(avg(prof.world)) + ' · dibujo ' + d1(avg(prof.render)) + '\n' +
      'calidad ' + Q.cur.name + (Q.level === 'auto' ? ' (auto)' : '') + (Q.fps30 ? ' · 30 fps' : '') + ' · resolución ' + resNow() + ' (' + d1(renderer.getPixelRatio()) + 'x)' + dynTxt + ' · ' +
      st.built + '/' + st.generated + ' trozos · ' + G.Population.alive() + ' infectados';
    perfReset();
  }

  // ---------- La caída (última liberación antes del jefe) ----------
  // Te matan al llegar a la salida: la cámara baja hasta tu cuerpo, tu compañera jura venganza y todo se apaga en
  // un negro rojizo. Luego, el refugio con quien te venga (con lo que llevabas encima) y su monólogo
  function fatalTick() {
    if (deadT > 3.2 && !fatalFade) {
      fatalFade = true;
      fadeTo(0, 0);
      if (fade.el) fade.el.classList.add('blood');
      fadeTo(1, 4.4);
    }
    if (deadT > 8.2) fatalRespawn();
  }
  let fatalFade = false;
  function fatalRespawn() {
    if (state !== 'playing' || !player.fatal) return;
    const F = player.fatal;
    state = 'loading';
    G.Input.enabled = false;
    const sc = G.Mode.score ? G.Mode.score(true) : null;
    G.Run.fatalFall(player, sc && sc.total ? sc.total : 0, G.Mode.stats, F.to);
    G.Mode.stop();
    if (G.Humans && G.Humans.Voice) G.Humans.Voice.clear();
    G.Menus.loading(() => {
      player.dead = false; player.victim = null; player.fatal = null; player.fatalCam = null; player.invuln = 0;
      player.setCharacter(F.to);
      try { localStorage.setItem(CHAR_KEY, F.to); } catch (e) { /* nada */ }
      enterRefuge();
      // quien te venga llega sin nada: ni armas (tampoco en el armero ni en la mochila), ni munición, ni
      // suministros. Solo un botiquín. Por eso tiene que ir a buscar armas a la vieja estación de policía
      for (let i = 0; i < player.hands.length; i++) player.hands[i] = null;
      player.stored = [];
      for (const k in player.items) player.items[k] = 0;
      for (const k in player.ammo) player.ammo[k] = 0;
      player.items.venda = 1;
      player.silencers = 0; player.arrowExp = false; player.throwable = null; player.cur = -1; player.prev = -1;
      player.health = 100; player.heal = 0;
      player.refreshModel();
      G.Run.keep(player);
      prewarm();
      fatalFade = false;
    }, () => {
      if (fade.el) fade.el.classList.remove('blood');
      fadeTo(1, 0); fadeTo(0, 2.2); G.Menus.hide();
      setTimeout(revengeTalk, 1800);
    }, { min: 3.2, ready: loadReady });
  }
  // en el refugio, quien te venga: el juramento y la idea de la vieja estación de policía
  const REVENGE = {
    vera: ['Mataron a {x} delante mío. Ni siquiera lo vi venir.', 'Juro que los voy a encontrar. A cada uno de esos Escorpiones.',
      'Se llevaron todo. No me queda nada... un botiquín, y gracias.', 'La vieja estación de policía de Oceanside. La armería tiene que seguir ahí. Voy a buscarla.'],
    diarco: ['Vera... la mataron como a un perro. Y yo ahí, mirando.', 'Se acabó esconderse. Voy a por ellos. A por todos.',
      'Pero así no llego lejos: ni un arma, ni una bala. Un botiquín y mis manos.', 'La comisaría vieja de Oceanside. Nadie volvió a entrar desde el brote... los casilleros de la policía tienen que estar llenos.'],
    paula: ['Mi niña... esos desgraciados me la quitaron.', 'Que se preparen. Esta vieja todavía sabe hacer daño.',
      'Pero con las manos vacías no voy a ningún lado. Un botiquín, eso es todo lo que tengo.', 'La estación de policía de Oceanside... allí guardaban de todo. Iré.'],
    // Grimes, tras la caída de la Trece (llega frío, sin nada)
    grimes: ['Eira. La última de los míos que quedaba en pie.', 'Una vez me quitaron todo. Me encadenaron. Me quebraron. Esta vez se lo quito yo a ellos.',
      'Sin armas. Sin balas. Da igual: me torturaron con menos y sigo aquí.', 'La vieja estación de policía de Oceanside. Ahí empiezo. Y no voy a parar.'],
    // la Trece, si el que cae es Grimes
    eira: ['Grimes. Lo tenía delante y no pude hacer nada.', 'Fue él quien nos juntó a todos. Y lo mataron por la espalda, como cobardes.',
      'No tengo nada. Un botiquín. Me sobra.', 'La estación de policía de Oceanside. Voy a por ellos. Por él.'],
    _: ['Mataron a {x}. Delante mío.', 'Los voy a hacer pagar. A todos.', 'Pero no tengo nada: ni armas, ni balas. Solo un botiquín.', 'La vieja estación de policía de Oceanside. Ahí tiene que quedar algo.']
  };
  function revengeTalk() {
    const R = G.Run.revenge;
    if (!R || R.said || state !== 'playing') return;
    G.Run.revengeSaid();
    const who = G.Player.CHARS[R.to] ? G.Player.CHARS[R.to].name : '';
    const dead = G.Player.nick(R.from);
    const L = REVENGE[R.to] || REVENGE._;
    const s0 = el('m-sub');
    L.forEach((ln, i) => setTimeout(() => {
      if (!s0) return;
      s0.innerHTML = '<b>' + who + ':</b> ' + ln.replace('{x}', dead);
      s0.classList.remove('hidden');
      clearTimeout(s0._t);
      s0._t = setTimeout(() => s0.classList.add('hidden'), 3600);
      if (i === L.length - 1) setTimeout(() => toast('Nuevo destino: la estación de policía de Oceanside (jefe final)', 'good'), 2600);
    }, i * 4000));
  }

  function die() {
    state = 'dead';
    fadeTo(0, 0.8);
    G.Input.enabled = false;
    if (document.exitPointerLock) document.exitPointerLock();
    const m = Math.floor(survived / 60), s = Math.floor(survived % 60);
    el('dead-cause').textContent = player.deathCause;
    let txt = G.Mode.active ? G.Mode.summary() : 'Sobreviviste ' + m + ' min ' + s + ' s · Zombis eliminados: ' + kills;
    const run = gameMode === 'retorno' && G.Run.active;
    if (run) {
      // la muerte es definitiva: la carrera se borra
      txt = (G.Run.daily ? 'Partida diaria perdida: la próxima, mañana. ' : '') + (G.Run.encounter && G.Run.encounter.boss ? 'La carrera ha terminado ante el jefe final. ' : 'La carrera ha terminado en el enfrentamiento ' + (G.Run.step + 1) + ' de ' + G.Run.STEPS + '. ') + txt;
      const rg = G.Run.recordEnd(G.Mode.stats);
      pendingSum = G.Run.summary ? G.Run.summary('dead', G.Mode.stats) : null;
      if (pendingSum) pendingSum.cause = player.deathCause || '';
      G.Run.discard();
      // la experiencia del personaje (su rango): también se gana perdiendo
      if (rg) { txt += ' · ' + rankLine(rg); if (rg.to > rg.from) setTimeout(() => toast(rankUp(rg), 'good'), 1400); }
    }
    const story = gameMode === 'historia', scp = story && G.Story && G.Story.cp;
    const surv = gameMode === 'superv' && G.Surv && G.Surv.active;
    if (surv) txt = G.Surv.deadText();
    if (story) txt = 'Prólogo · ' + (scp ? 'se sigue desde el último punto de control.' : 'se vuelve a empezar desde el principio.');
    el('dead-stats').textContent = txt;
    el('btn-retry').classList.toggle('hidden', gameMode === 'retorno');
    el('btn-retry').textContent = bossTry ? 'Volver al modo libre' : (scp ? 'Reintentar desde el punto de control' : (surv ? 'Despertar en el descanso' : 'Empezar de nuevo'));
    el('btn-menu2').textContent = gameMode === 'retorno' ? (pendingSum ? 'Ver el resumen' : 'Menú principal') : 'Volver al menú';
    el('dead').classList.remove('hidden');
  }

  // Lo que necesita el modo historia para cambiar de mapa dentro de un capítulo (la estación → la calle → el cruce)
  G.StoryHost = {
    get scene() { return scene; }, get camera() { return camera; }, get renderer() { return renderer; },
    map(id) { resetWorld(id); setLighting(id); },
    // la pantalla de carga: work detrás (lo pesado), done al quitarla
    loading(work, done, min) {
      G.Menus.loading(() => { try { work(); } catch (e) { console.error(e); } }, () => { G.Menus.hide(); if (done) done(); }, { min: min || 2.6 });
    },
    fadeTo: (to, dur) => fadeTo(to, dur),
    toast: (t, k) => toast(t, k),
    // el final del capítulo: de vuelta al menú principal
    toMenu: () => toMenu(),
    get chapter() { return storyCh; }
  };

  // Para pruebas automáticas
  G.debug = {
    map(id) { resetWorld(id); setLighting(id); },
    get player() { return player; }, get camera() { return camera; }, get renderer() { return renderer; },
    get scene() { return scene; }, get state() { return state; },
    start, retry, toast, refresh: () => refreshWorld(true, 0), autoDoor: () => autoDoor(),
    startEncounter, backToRefuge, enterRefuge, quitToMenu, finishRun, fadeTo, get gameMode() { return gameMode; },
    // congela al jugador en un momento de una animación (para revisar poses)
    // congela el juego tal cual (para capturas)
    hold() { state = 'frozen'; G.Camera.held = true; },
    sky(h, w) { if (G.Sky) G.Sky.set(h, w); },
    freeze(kind, t, weapon) {
      if (weapon) { player.weapons = []; player.pickUp(weapon, 1); }
      if (player.slot && G.Weapons.isGun(G.Weapons.get(player.slot.id))) player.slot.cond = 1;
      player.action = kind ? { kind, t, dur: 1, done: true, weapon: player.weapon } : null;
      state = 'frozen';
    },
    tp(x, z, yaw, pitch, lv) {
      player.pos.x = x; player.pos.z = z; player.lv = lv || 0; player.y = G.World.groundY(x, z, player.lv);
      if (yaw != null) G.Camera.yaw = yaw;
      if (pitch != null) G.Camera.pitch = pitch;
      G.Camera.dist = 0.1;
      refreshWorld(true, 0);
    }
  };

  window.addEventListener('DOMContentLoaded', init);
})(window.Game = window.Game || {});
