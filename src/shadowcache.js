// Sombras del sol en dos capas.
// El mapa de sombras dibuja la escena entera otra vez (desde el sol): es casi la mitad del coste de cada fotograma.
// Pero casas, árboles, coches y rocas no se mueven, y el sol avanza muy despacio. Así que:
//  · capa fija: el mundo (los trozos del mapa). Se dibuja solo cuando cambia algo (el sol da un paso, se carga un
//    trozo, se abre una puerta, un árbol cambia de detalle...) y se guarda aparte.
//  · capa móvil: todo lo demás (tú, los infectados, la gente, lo que se lanza). Cada fotograma se copia la capa
//    fija al mapa de sombras (con su profundidad) y encima se dibuja solo lo que se mueve.
// Se ve igual: lo que se mueve sigue proyectando su sombra en cada fotograma.
// Lo fijo es lo que cuelga de un grupo marcado con userData.shStatic (los trozos del mundo).
(function (G) {
  'use strict';

  let R = null, sun = null, ok = false;
  let copyMat = null, copyScene = null, copyCam = null, staticRT = null;
  let dirtyF = true, key = '', tick = 0, frameN = 0, active = false;
  // por qué no se usa (para el contador): '' si va bien
  let why = '';
  const hid = [];
  const noClear = function () {};
  // para el contador del modo desarrollador
  const stats = { statics: 0, staticRate: 0, draws: 0, on: false, _t: 0, _n: 0 };

  function init(renderer, light) {
    R = renderer; sun = light;
    // copiar la profundidad exige escribirla desde el sombreador (WebGL2, o la extensión en WebGL1)
    ok = !!(R.capabilities.isWebGL2 || R.extensions.get('EXT_frag_depth'));
    if (!ok) { why = 'el navegador no puede copiar la profundidad'; return; }
    copyMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null } },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        '#include <packing>',
        'uniform sampler2D tMap;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec4 c = texture2D(tMap, vUv);',
        '  gl_FragColor = c;',
        '  gl_FragDepthEXT = clamp(unpackRGBAToDepth(c), 0.0, 1.0);',
        '}'].join('\n'),
      depthTest: true, depthWrite: true
    });
    copyMat.depthFunc = THREE.AlwaysDepth;
    copyMat.extensions.fragDepth = true;
    copyMat.toneMapped = false;
    copyMat.fog = false;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
    quad.frustumCulled = false;
    copyScene = new THREE.Scene();
    copyScene.add(quad);
    copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  function blit(tex, rt) {
    copyMat.uniforms.tMap.value = tex;
    R.setRenderTarget(rt);
    R.render(copyScene, copyCam);
  }

  function ensureRT(map) {
    const w = map.width, h = map.height;
    if (staticRT && staticRT.width === w && staticRT.height === h) return;
    if (staticRT) staticRT.dispose();
    staticRT = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
    staticRT.texture.generateMipmaps = false;
    dirtyF = true;
  }

  // oculta (para el pase del sol) los hijos de la escena que sean fijos (wantStatic) o los que no lo sean
  function hide(scene, staticOnes) {
    const ch = scene.children;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i];
      if (!o.visible || o.isLight) continue;
      if (!!(o.userData && o.userData.shStatic) === staticOnes) { o.visible = false; hid.push(o); }
    }
  }
  function restore() { for (let i = 0; i < hid.length; i++) hid[i].visible = true; hid.length = 0; }

  function sunPassIn(scene, camera, clear) {
    const c = R.clear;
    if (!clear) R.clear = noClear;
    sun.shadow.needsUpdate = true;
    try { R.shadowMap.render([sun], scene, camera); } finally { R.clear = c; }
  }
  // El pase del sol no se puede llamar suelto: three.js solo prepara su estado interno de dibujo dentro de
  // renderer.render() (fuera de ahí falla con «Cannot read properties of null (reading 'state')», y por eso las capas
  // nunca llegaban a usarse). Así que se lanza desde dentro de un render() de una escena vacía: un objeto que no
  // dibuja nada (0 puntos) y que, justo antes de «dibujarse», hace el pase del sol de la escena de verdad
  let host = null, hostCam = null, pend = null, pendErr = null;
  function makeHost() {
    host = new THREE.Scene();
    host.autoUpdate = false;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setDrawRange(0, 0);
    const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
    const o = new THREE.Mesh(g, m);
    o.frustumCulled = false;
    o.onBeforeRender = function () {
      const p = pend; pend = null;
      if (!p) return;
      try { sunPassIn(p.scene, p.camera, p.clear); } catch (e) { pendErr = e; }
    };
    host.add(o);
    hostCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  function sunPass(scene, camera, clear) {
    if (!host) makeHost();
    pend = { scene, camera, clear }; pendErr = null;
    const ac = R.autoClear, rt = R.getRenderTarget();
    R.autoClear = false;
    try { R.setRenderTarget(null); R.render(host, hostCam); }
    finally { R.autoClear = ac; R.setRenderTarget(rt); }
    if (pend) { pend = null; throw new Error('el pase del sol no se lanzó'); }
    if (pendErr) throw pendErr;
  }

  // Antes de pintar la escena. true si se encargó de la sombra del sol (y la escena ya tiene las matrices al día).
  // Si algo falla (un móvil que no sabe copiar la profundidad...), se apaga y las sombras van como siempre
  function frame(scene, camera, half) {
    try { return frameIn(scene, camera, half); }
    catch (e) {
      console.warn('ShadowCache: apagado', e && e.message);
      ok = false; restore();
      why = 'falló: ' + ((e && e.message) || 'error').slice(0, 90);
      try { R.setRenderTarget(null); } catch (e2) { /* nada */ }
      off();
      return false;
    }
  }
  // ¿el sombreador de copia compiló? (si no, three.js no lo dice: se comprobaría con una sombra que no está)
  let checked = false;
  function copyOk() {
    if (checked) return true;
    const pr = R.properties && R.properties.get(copyMat).program;
    if (!pr) return true;
    checked = true;
    if (pr.diagnostics && pr.diagnostics.runnable === false) { console.warn('ShadowCache: la copia no compila'); why = 'la copia no compila en este móvil'; return false; }
    return true;
  }
  // (se puede apagar en Gráficos > Sombras, para comparar con el contador. La clave es nueva: la de antes, la del
  // modo desarrollador, podía haber quedado apagada de alguna prueba; ahora vuelve a empezar encendida)
  const KEY = 'ceniza.sombracapas2';
  let enabled = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } })();
  function setEnabled(v) { enabled = !!v; try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) { /* nada */ } off(); }
  function frameIn(scene, camera, half) {
    frameN++;
    if (!ok || !enabled || !sun.castShadow || !R.shadowMap.enabled) {
      if (ok) why = !enabled ? 'apagadas en Gráficos' : (!sun.castShadow ? '' : 'sin mapa de sombras');
      off(); return false;
    }
    active = true; why = '';
    const sh = sun.shadow;
    sh.autoUpdate = false;                 // (el pase normal de la escena ya no rehace la del sol)
    R.shadowMap.autoUpdate = true;         // (las otras luces con sombra, si las hubiera, siguen como siempre)
    scene.updateMatrixWorld();
    // el sol da un paso, cambia el tamaño o el detalle de la sombra: hay que rehacer la capa fija
    const p = sun.position, t = sun.target.position, cam = sh.camera;
    const k = p.x + ',' + p.y + ',' + p.z + ',' + t.x + ',' + t.z + ',' + sh.mapSize.x + ',' + cam.right + ',' + cam.far;
    if (k !== key) { key = k; dirtyF = true; }
    if (!sh.map || !staticRT || staticRT.width !== sh.map.width) dirtyF = true;
    // (por si algo cambió sin avisar: muy de vez en cuando, de todas formas. Antes era cada 90 imágenes: un tirón
    // cada segundo y medio; ahora todo lo que cambia algo fijo avisa con dirty(), incluido mostrar u ocultar zonas)
    if (++tick >= 1800) dirtyF = true;
    const c0 = R.info.render.calls;
    if (dirtyF) {
      // 1) lo fijo, solo
      hide(scene, false);
      try { sunPass(scene, camera, true); } finally { restore(); }
      ensureRT(sh.map);
      blit(sh.map.texture, staticRT);
      if (!copyOk()) throw new Error('copia');
      // 2) lo que se mueve, encima (la profundidad de lo fijo sigue en el mapa de sombras)
      hide(scene, true);
      try { sunPass(scene, camera, false); } finally { restore(); }
      dirtyF = false; tick = 0; stats._n++;
    } else if (!half || (frameN & 1) === 0) {
      // 1) lo fijo, copiado (color y profundidad); 2) lo que se mueve, encima
      blit(staticRT.texture, sh.map);
      hide(scene, true);
      try { sunPass(scene, camera, false); } finally { restore(); }
    }
    R.setRenderTarget(null);
    stats.draws = R.info.render.calls - c0;
    stats.on = true;
    return true;
  }

  // Cuando se pinta otra cosa (menús, refugio, la calle del prólogo): el sol vuelve a lo de siempre
  function off() {
    if (sun) sun.shadow.autoUpdate = true;
    if (active) { active = false; dirtyF = true; }
    stats.on = false;
  }

  // algo fijo cambió (un trozo nuevo, una puerta, una pared derribada, un árbol que cambia de detalle...)
  function dirty() { dirtyF = true; }

  // sombras fijas rehechas por segundo (para el contador)
  function rate(dt) {
    stats._t += dt;
    if (stats._t >= 1) { stats.staticRate = stats._n / stats._t; stats._n = 0; stats._t = 0; }
    return stats;
  }

  G.ShadowCache = { init, frame, off, dirty, rate, stats, get ok() { return ok; }, get enabled() { return enabled; }, get why() { return why; }, setEnabled };
})(window.Game = window.Game || {});
