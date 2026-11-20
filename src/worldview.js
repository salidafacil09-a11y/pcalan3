(function (G) {
  'use strict';

  // Construye y actualiza los modelos 3D de cada chunk:
  // suelo con textura, paredes, techos, puertas, ventanas, árboles, farolas,
  // vallas, luces de las habitaciones y armas en el suelo.

  const W = () => G.World;
  const U = G.Util;
  let scene = null;
  let R = null;
  const lightPool = [];
  let lightTimer = 0;
  const animDoors = [];

  // ---------- Texturas procedurales (sin imágenes externas) ----------
  function dataTex(size, fn) {
    const d = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = U.clamp(Math.round(fn(x, y) * 255), 0, 255);
        const i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  function makeTextures() {
    const rnd = U.mulberry32(42);
    const n = new Float32Array(128 * 128).map(() => rnd());
    const smoothN = (x, y, s) => {
      // ruido suave periódico
      const fx = x / s, fy = y / s;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const m = 128 / s;
      const g = (a, b) => n[((((b % m) + m) % m) * 128 + (((a % m) + m) % m)) % n.length];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
      return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    };
    return {
      grass: dataTex(128, (x, y) => 0.78 + smoothN(x, y, 16) * 0.12 + smoothN(x, y, 4) * 0.08 + rnd() * 0.07),
      asphalt: dataTex(128, (x, y) => 0.82 + smoothN(x, y, 32) * 0.08 + rnd() * 0.12),
      concrete: dataTex(128, (x, y) => {
        const seam = (x % 64 < 1 || y % 64 < 1) ? -0.18 : 0;
        return 0.84 + smoothN(x, y, 16) * 0.08 + rnd() * 0.06 + seam;
      }),
      wood: dataTex(128, (x, y) => {
        const plank = Math.floor(y / 16);
        const off = (plank * 37) % 128;
        const seam = (y % 16 === 0 || ((x + off) % 128) === 0) ? -0.28 : 0;
        const grain = Math.sin((x + plank * 13) * 0.35 + smoothN(x, y, 8) * 6) * 0.05;
        return 0.82 + grain + (plank % 3) * 0.04 + seam + rnd() * 0.03;
      }),
      tile: dataTex(128, (x, y) => ((x % 32) < 2 || (y % 32) < 2) ? 0.62 : 0.95 + rnd() * 0.04),
      carpet: dataTex(128, (x, y) => 0.86 + smoothN(x, y, 4) * 0.08 + rnd() * 0.08),
      lino: dataTex(128, (x, y) => ((x % 64) < 1 || (y % 64) < 1) ? 0.75 : 0.9 + smoothN(x, y, 32) * 0.06 + rnd() * 0.03),
      arcade: arcadeCarpet(false),
      arcadeGlow: arcadeCarpet(true)
    };
  }

  // Moqueta de salón recreativo (diseño propio): fondo morado muy oscuro con garabatos, triángulos, aros y
  // puntos de colores chillones; gastada y con manchas. glow: solo los dibujos (brillan en la penumbra)
  function arcadeCarpet(glow) {
    const S = 256;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d');
    const r = U.mulberry32(glow ? 913 : 913);
    x.fillStyle = glow ? '#000' : '#1b1430'; x.fillRect(0, 0, S, S);
    if (!glow) {
      // trama del pelo de la moqueta y manchas de suciedad
      for (let i = 0; i < 2600; i++) { x.fillStyle = 'rgba(' + (r() < 0.5 ? '40,30,70' : '15,10,25') + ',0.5)'; x.fillRect(r() * S, r() * S, 1.5, 1.5); }
    }
    const COL = ['#ff3fa4', '#3fe6ff', '#ffe23f', '#9b5bff', '#53ff8a'];
    // dibuja una figura repetida en los bordes (la textura se repite sin cortes)
    const wrap = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { x.save(); x.translate(ox, oy); fn(); x.restore(); } };
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (let i = 0; i < 18; i++) {
      const cx = r() * S, cy = r() * S, c = COL[Math.floor(r() * COL.length)], kind = Math.floor(r() * 4), sz = 7 + r() * 13, rot = r() * 6.28;
      wrap(() => {
        x.strokeStyle = c; x.fillStyle = c; x.lineWidth = 2.6;
        x.translate(cx, cy); x.rotate(rot);
        x.beginPath();
        if (kind === 0) { x.moveTo(-sz, 0); for (let k = 1; k <= 6; k++) x.quadraticCurveTo(-sz + (k - 0.5) * sz / 3, (k % 2 ? -1 : 1) * sz * 0.5, -sz + k * sz / 3, 0); x.stroke(); }
        else if (kind === 1) { x.moveTo(0, -sz * 0.7); x.lineTo(sz * 0.65, sz * 0.5); x.lineTo(-sz * 0.65, sz * 0.5); x.closePath(); x.stroke(); }
        else if (kind === 2) { x.arc(0, 0, sz * 0.5, 0, Math.PI * 2); x.stroke(); }
        else { for (let k = 0; k < 5; k++) { x.moveTo(k * 5 - 10 + 1.6, 0); x.arc(k * 5 - 10, 0, 1.6, 0, Math.PI * 2); } x.fill(); }
      });
    }
    if (!glow) {
      // desgaste: zonas apagadas y manchas oscuras
      for (let i = 0; i < 14; i++) { const px = r() * S, py = r() * S; const g = x.createRadialGradient(px, py, 2, px, py, 30 + r() * 40); g.addColorStop(0, 'rgba(10,8,14,0.55)'); g.addColorStop(1, 'rgba(10,8,14,0)'); x.fillStyle = g; x.fillRect(0, 0, S, S); }
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // ---------- La intemperie (30 años): musgo, verdín, chorretones, grietas ----------
  // Un ruido suave que se repite (64 x 64) para el sombreador: el musgo sobre lo que mira arriba (tejados, capós,
  // muros bajos), el verdín que sube por las paredes desde el suelo, los chorretones de la lluvia; en el asfalto,
  // grietas y manchas de musgo; en las aceras, verdín en las juntas; en la hierba, manchas secas y otras más
  // frondosas. Cuánto, según el «wild» del mapa (uWild; 0 = nada)
  function noiseTex() {
    const S = 64, rnd = U.mulberry32(777), base = new Float32Array(16 * 16).map(() => rnd());
    const smooth = (x, y, s) => {
      const m = 16 / s, fx = x / (S / m), fy = y / (S / m), x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const g = (a, b) => base[(((b % m) + m) % m) * 16 + (((a % m) + m) % m)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
      return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    };
    const t = dataTex(S, (x, y) => smooth(x, y, 4) * 0.55 + smooth(x, y, 2) * 0.3 + smooth(x, y, 1) * 0.15);
    t.magFilter = THREE.LinearFilter;
    return t;
  }
  const WTH = { uWild: { value: 0 }, uWthNoise: { value: null }, uMoss: { value: new THREE.Color(0x4e5e2c).convertSRGBToLinear() } };
  const WTH_V = [
    '#include <project_vertex>',
    'vec4 wthP4 = vec4( transformed, 1.0 );',
    '#ifdef USE_INSTANCING',
    'wthP4 = instanceMatrix * wthP4;',
    '#endif',
    'wthP4 = modelMatrix * wthP4;',
    'vWthP = wthP4.xyz;',
    'vWthN = normalize( mat3( modelMatrix ) * objectNormal );'].join('\n');
  const WTH_F = {
    wall: [
      'float wN1 = WT( vWthP.xz * 0.09 + vWthP.y * 0.07 );',
      'float wN2 = WT( vWthP.xz * 0.37 + vec2( 0.37, 0.71 ) + vWthP.y * 0.19 );',
      'vec3 wn = normalize( vWthN );',
      'float wUp = smoothstep( 0.45, 0.85, wn.y );',
      'float wMoss = wUp * smoothstep( 0.7 - uWild * 0.32, 0.92 - uWild * 0.2, wN1 * 0.6 + wN2 * 0.4 ) * uWild;',
      'float wSide = 1.0 - abs( wn.y );',
      'float wBase = wSide * ( 1.0 - smoothstep( 0.05, 0.55 + wN1 * 1.3, vWthP.y ) );',
      'float wDrip = wSide * smoothstep( 0.5, 0.82, WT( vec2( ( vWthP.x + vWthP.z ) * 0.8, vWthP.y * 0.05 ) ) );',
      'diffuseColor.rgb = mix( diffuseColor.rgb, uMoss * ( 0.7 + 0.55 * wN2 ), wMoss * 0.85 );',
      'diffuseColor.rgb = mix( diffuseColor.rgb, uMoss * 0.62, wBase * uWild * 0.6 );',
      'diffuseColor.rgb *= 1.0 - wDrip * uWild * 0.3;'].join('\n'),
    asphalt: [
      'float wN1 = WT( vWthP.xz * 0.06 );',
      'float wN2 = WT( vWthP.xz * 0.29 + 0.5 );',
      'float wN3 = WT( vWthP.xz * 1.3 + 0.2 );',
      'diffuseColor.rgb *= 1.0 + uWild * ( 0.26 * wN1 - 0.04 + 0.08 * wN3 );',
      // grietas: finas, en tramos (no una red continua)
      'float wCr = ( 1.0 - smoothstep( 0.0, 0.016, abs( WT( vWthP.xz * 0.19 ) - 0.5 ) ) ) * smoothstep( 0.35, 0.6, wN2 );',
      'wCr = max( wCr, ( 1.0 - smoothstep( 0.0, 0.012, abs( WT( vWthP.xz * 0.47 + 0.31 ) - 0.5 ) ) ) * smoothstep( 0.5, 0.7, wN1 ) );',
      'float wMoss = smoothstep( 0.6, 0.86, wN2 * 0.55 + wN1 * 0.35 + wCr * 0.35 ) * uWild;',
      'diffuseColor.rgb = mix( diffuseColor.rgb, uMoss * ( 0.6 + 0.6 * wN3 ), wMoss * 0.7 );',
      'diffuseColor.rgb *= 1.0 - wCr * 0.38 * uWild;'].join('\n'),
    concrete: [
      'float wN1 = WT( vWthP.xz * 0.08 );',
      'float wN2 = WT( vWthP.xz * 0.41 + 0.3 );',
      'vec2 wJ = abs( fract( vWthP.xz + 0.5 ) - 0.5 );',
      'float wSeam = 1.0 - smoothstep( 0.0, 0.035, min( wJ.x, wJ.y ) );',
      'float wMoss = max( wSeam * smoothstep( 0.3, 0.6, wN2 ), smoothstep( 0.68, 0.9, wN1 * 0.6 + wN2 * 0.4 ) ) * uWild;',
      'diffuseColor.rgb *= 1.0 - uWild * ( 0.12 * wN1 + 0.25 * wSeam );',
      'diffuseColor.rgb = mix( diffuseColor.rgb, uMoss * ( 0.7 + 0.5 * wN2 ), wMoss * 0.7 );'].join('\n'),
    grass: [
      'float wN1 = WT( vWthP.xz * 0.045 );',
      'float wN2 = WT( vWthP.xz * 0.17 + 0.6 );',
      'float wN3 = WT( vWthP.xz * 0.9 + 0.1 );',
      // manchas secas (pajizas) y otras frondosas (más oscuras y verdes); grano fino de hierba
      'vec3 wDry = diffuseColor.rgb * vec3( 1.22, 1.1, 0.62 );',
      'vec3 wLush = diffuseColor.rgb * vec3( 0.7, 0.86, 0.6 );',
      'diffuseColor.rgb = mix( diffuseColor.rgb, wDry, smoothstep( 0.62, 0.85, wN1 ) * uWild * 0.7 );',
      'diffuseColor.rgb = mix( diffuseColor.rgb, wLush, smoothstep( 0.55, 0.8, wN2 ) * uWild * 0.8 );',
      'diffuseColor.rgb *= ( 0.8 + 0.4 * wN3 ) * ( 1.0 - 0.2 * uWild );',
      // un velo pardo (tierra y hojarasca entre la hierba)
      'diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.05, 0.92, 0.7 ), uWild * 0.35 * smoothstep( 0.3, 0.7, wN2 * 0.5 + wN3 * 0.5 ) );'].join('\n')
  };
  // De lejos no se lee el ruido: entre 24 y 34 m el detalle se funde con su valor medio (0,5) y más allá ya no se
  // lee (ahorra de 2 a 6 lecturas de textura por píxel en lo lejano; el color medio queda igual). En los mapas sin
  // intemperie (uWild = 0), nunca
  const WTH_NEAR = [
    'float wNK = uWild > 0.001 ? 1.0 - smoothstep( 24.0, 34.0, distance( vWthP, cameraPosition ) ) : 0.0;',
    '#define WT( p ) ( wNK > 0.0 ? mix( 0.5, texture2D( uWthNoise, p ).r, wNK ) : 0.5 )', ''].join('\n');
  function wthPatch(sh, kind) {
    sh.uniforms.uWild = WTH.uWild; sh.uniforms.uWthNoise = WTH.uWthNoise; sh.uniforms.uMoss = WTH.uMoss;
    sh.vertexShader = 'varying vec3 vWthP;\nvarying vec3 vWthN;\n' + sh.vertexShader.replace('#include <project_vertex>', WTH_V);
    sh.fragmentShader = 'uniform float uWild;\nuniform sampler2D uWthNoise;\nuniform vec3 uMoss;\nvarying vec3 vWthP;\nvarying vec3 vWthN;\n' +
      sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + WTH_NEAR + WTH_F[kind]);
  }
  function weather(mat, kind) {
    mat.onBeforeCompile = (sh) => {
      wthPatch(sh, kind);
      if (kind === 'wall') detPatch(sh, DET_WALL);        // (la hiedra, pintada)
      if (G.Flash) G.Flash.patch(sh);
    };
    mat.customProgramCacheKey = () => 'wth_' + kind;
    return mat;
  }

  // ---------- Lo pintado: la hiedra de las paredes y las hojas caídas y el musgo del suelo ----------
  // Antes eran láminas aparte con transparencia recortada (la hiedra, dos mallas por trozo; las hojas y el musgo,
  // otra instanciada): hasta tres llamadas de dibujo más por trozo y mucho píxel procesado para nada (las hojas y el
  // musgo, oscuros, casi ni se veían). Ahora se pintan en el propio material de las paredes y del suelo, a partir de
  // dos texturas pequeñas que cubren el mundo con un texel por casilla:
  //   uDetIvy: los bordes de cada casilla (los de World: el de -z en su línea z, el de -x en su línea x). r: hasta
  //     dónde trepa la hiedra por la pared del borde -z, g: desde dónde cuelga del tejado; b y a, lo mismo en el
  //     borde -x. Cada byte: la altura (6 bits, de DET_DY en DET_DY m desde DET_Y0) y de qué cara (2 bits: 1, la
  //     que mira a -z / -x; 2, la que mira a +z / +x; 3, las dos). 0 = nada
  //   uDetGnd: cuántas hojas caídas (r) y cuánto musgo (g) hay en la casilla (se mezcla con las de al lado)
  // Las texturas cubren DET_N m desde DET_O y se repiten (en el mundo abierto, lo lejano se pisa con lo nuevo).
  // Unas pocas matas de hojas en 3D, sin textura (en la malla de lo que no da sombra), quitan lo plano
  const DET_N = 384, DET_O = -128, DET_Y0 = -4, DET_DY = 0.3;
  const DET = {
    ivy: null, gnd: null, dIvy: false, dGnd: false, own: new Map(),
    u: { uDetIvy: { value: null }, uDetGnd: { value: null }, uDetIvyTex: { value: null }, uDetLit: { value: null }, uDetOn: { value: 0 } }
  };
  function detInit() {
    const mk = (lin) => {
      const t = new THREE.DataTexture(new Uint8Array(DET_N * DET_N * 4), DET_N, DET_N, THREE.RGBAFormat);
      t.magFilter = t.minFilter = lin ? THREE.LinearFilter : THREE.NearestFilter;
      t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      return t;
    };
    DET.ivy = mk(false); DET.gnd = mk(true);
    DET.u.uDetIvy.value = DET.ivy; DET.u.uDetGnd.value = DET.gnd;
  }
  const detWrap = (v) => ((Math.floor(v) - DET_O) % DET_N + DET_N) % DET_N;
  const detI = (X, Z) => (detWrap(Z) * DET_N + detWrap(X)) * 4;
  // (las texturas de la hiedra y de las hojas: de la vegetación, la primera vez)
  function detTex() {
    if (DET.u.uDetIvyTex.value || !G.Vegetation || !G.Vegetation.detTex) return;
    const t = G.Vegetation.detTex();
    DET.u.uDetIvyTex.value = t.ivy; DET.u.uDetLit.value = t.litter;
  }
  // al empezar a armar un trozo: lo del suelo se vuelve a apuntar entero; lo de las paredes, solo si ese pedazo de
  // la textura era de otro trozo (en el mundo abierto) o es la primera vez (la hiedra de un borde entre dos trozos la
  // puede apuntar cualquiera de los dos: no se borra al rearmar uno)
  function detBegin(c) {
    if (!DET.ivy) return;
    detTex();
    const CS = W().CS, ox = c.cx * CS, oz = c.cz * CS, key = c.cx + ',' + c.cz;
    const blk = Math.floor(detWrap(oz) / CS) * 100 + Math.floor(detWrap(ox) / CS);
    const wipeIvy = DET.own.get(blk) !== key;
    DET.own.set(blk, key);
    const I = DET.ivy.image.data, Gd = DET.gnd.image.data;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const i = detI(ox + x, oz + z);
      if (Gd[i] || Gd[i + 1]) { Gd[i] = Gd[i + 1] = 0; DET.dGnd = true; }
      if (wipeIvy && (I[i] || I[i + 1] || I[i + 2] || I[i + 3])) { I[i] = I[i + 1] = I[i + 2] = I[i + 3] = 0; DET.dIvy = true; }
    }
  }
  // un mapa nuevo: todo en blanco
  function detReset() {
    DET.own.clear();
    if (!DET.ivy) return;
    DET.ivy.image.data.fill(0); DET.gnd.image.data.fill(0);
    DET.ivy.needsUpdate = DET.gnd.needsUpdate = true;
    DET.dIvy = DET.dGnd = false;
  }
  // hiedra en el borde o (orientación 'N' | 'W') de la casilla X, Z: k 0 = trepa hasta y, 1 = cuelga desde y; side:
  // la cara (1: la que mira a -z / -x; 2: a +z / +x; 3: las dos)
  function detIvy(o, X, Z, k, y, side) {
    if (!DET.ivy) return;
    const q = k ? Math.ceil((y - DET_Y0) / DET_DY) : Math.floor((y - DET_Y0) / DET_DY);
    const v = Math.max(1, Math.min(63, q));
    const i = detI(X, Z) + (o === 'N' ? 0 : 2) + k, d = DET.ivy.image.data, old = d[i];
    // (si ya había algo en ese borde, se juntan: las dos caras, y la altura que más hiedra deja)
    const nv = old ? (k ? Math.min(old >> 2, v) : Math.max(old >> 2, v)) : v, ns = (old & 3) | side;
    const b = nv * 4 + ns;
    if (b !== old) { d[i] = b; DET.dIvy = true; }
  }
  // las hojas caídas y el musgo que repartió la vegetación en un trozo: [X, Z, giro, tamaño, ...]
  function detGround(c, litter, moss) {
    if (!DET.ivy) return;
    detTex();
    const d = DET.gnd.image.data;
    const put = (L, ch) => {
      for (const e of L) {
        const i = detI(e[0], e[1]) + ch;
        const v = Math.min(255, d[i] + Math.round((0.42 + 0.22 * Math.min(2, e[3])) * 255));
        if (v !== d[i]) { d[i] = v; DET.dGnd = true; }
      }
    };
    put(litter || [], 0); put(moss || [], 1);
  }
  // (cada fotograma: si algo cambió, se sube; al cargar un mapa son unas pocas veces)
  function detFlush() {
    if (DET.dIvy) { DET.ivy.needsUpdate = true; DET.dIvy = false; }
    if (DET.dGnd) { DET.gnd.needsUpdate = true; DET.dGnd = false; }
  }
  const DET_PARS = [
    'uniform sampler2D uDetIvy;', 'uniform sampler2D uDetGnd;', 'uniform sampler2D uDetIvyTex;', 'uniform sampler2D uDetLit;', 'uniform float uDetOn;',
    'uniform sampler2D uDetNoise;', 'uniform vec3 uDetMoss;',
    '#define DET_O ' + DET_O.toFixed(1), '#define DET_N ' + DET_N.toFixed(1),
    // la altura de un byte de uDetIvy para la cara s (1: la que mira a -z / -x; 2: a +z / +x); -99 si no hay
    'float detDec( float t, float s ) {',
    '  float v = floor( t * 255.0 + 0.5 );',
    '  float sd = mod( v, 4.0 );',
    '  float ok = s < 1.5 ? mod( sd, 2.0 ) : floor( sd / 2.0 );',
    '  return ok > 0.5 ? floor( v / 4.0 ) * ' + DET_DY.toFixed(2) + ' + ' + DET_Y0.toFixed(1) + ' : -99.0;',
    '}', ''].join('\n');
  // la hiedra en las paredes (los que miran de lado y están a menos de 10 cm de la línea de un borde)
  const DET_WALL = [
    'if ( uDetOn > 0.5 ) {',
    '  vec3 dn = normalize( vWthN );',
    '  if ( abs( dn.y ) < 0.3 ) {',
    '    bool dZ = abs( dn.z ) > abs( dn.x );',
    '    float dP = dZ ? vWthP.z : vWthP.x;',
    '    float dLn = floor( dP + 0.5 );',
    '    if ( abs( dP - dLn ) < 0.1 ) {',
    '      vec2 dC = dZ ? vec2( floor( vWthP.x ), dLn ) : vec2( dLn, floor( vWthP.z ) );',
    '      vec4 dI = texture2D( uDetIvy, fract( ( dC + 0.5 - DET_O ) / DET_N ) );',
    '      float dS = ( dZ ? dn.z : dn.x ) < 0.0 ? 1.0 : 2.0;',
    '      float dTop = detDec( dZ ? dI.r : dI.b, dS );',
    '      float dBot = detDec( dZ ? dI.g : dI.a, dS );',
    '      if ( dTop > -50.0 || dBot > -50.0 ) {',
    '        float dA = dZ ? vWthP.x : vWthP.z;',
    // (el borde de la mancha no sale recto)
    '        float dJ = ( texture2D( uDetNoise, vec2( dA * 0.23, dLn * 0.37 ) ).r - 0.5 ) * 0.7;',
    '        float dV = 0.0, dOn = 0.0;',
    '        if ( dTop > -50.0 && vWthP.y < dTop + dJ ) { dV = 1.0 - ( dTop + dJ - vWthP.y ) / 2.8; dOn = 1.0; }',
    // (la que cuelga: tupida arriba, junto al tejado, y abajo algo más suelta; donde se juntan, la más tupida)
    '        if ( dBot > -50.0 && vWthP.y > dBot - dJ ) { float dV2 = 0.55 - ( vWthP.y - dBot + dJ ) / 2.8; dV = dOn > 0.5 ? min( dV, dV2 ) : dV2; dOn = 1.0; }',
    '        if ( dOn > 0.5 ) {',
    // (el dibujo: arriba, los zarcillos sueltos; más de 2,8 m por debajo del borde, la parte tupida, en zigzag)
    '          float dVv = dV > 0.0 ? dV : abs( fract( dV / 0.7 + 0.5 ) * 2.0 - 1.0 ) * 0.35;',
    '          vec4 dT = texture2D( uDetIvyTex, vec2( dA / 1.4, clamp( dVv, 0.004, 0.996 ) ) );',
    '          diffuseColor.rgb = mix( diffuseColor.rgb, sRGBToLinear( dT ).rgb * ( 0.68 + 0.32 * clamp( dVv, 0.0, 1.0 ) ), smoothstep( 0.35, 0.65, dT.a ) );',
    '        }',
    '      }',
    '    }',
    '  }',
    '}', ''].join('\n');
  // las hojas caídas y el musgo en el suelo
  const DET_GND = [
    'if ( uDetOn > 0.5 ) {',
    '  vec4 dG = texture2D( uDetGnd, fract( ( vGndP - DET_O ) / DET_N ) );',
    '  if ( dG.r > 0.01 ) {',
    '    vec4 dL = texture2D( uDetLit, vGndP * 0.42 );',
    '    float dN = texture2D( uDetNoise, vGndP * 0.19 + 0.33 ).r;',
    '    float dK = smoothstep( 0.3, 0.55, dG.r * 1.35 - dN * 0.5 + 0.2 ) * smoothstep( 0.3, 0.7, dL.a );',
    '    diffuseColor.rgb = mix( diffuseColor.rgb, sRGBToLinear( dL ).rgb, dK );',
    '  }',
    '  if ( dG.g > 0.01 ) {',
    '    float dN2 = texture2D( uDetNoise, vGndP * 1.7 + 0.11 ).r;',
    '    float dN3 = texture2D( uDetNoise, vGndP * 0.31 + 0.7 ).r;',
    '    float dM = smoothstep( 0.3, 0.55, dG.g * 1.35 - dN3 * 0.5 + 0.15 ) * smoothstep( 0.22, 0.45, dN2 );',
    '    diffuseColor.rgb = mix( diffuseColor.rgb, uDetMoss * ( 0.75 + 0.55 * dN2 ), dM * 0.9 );',
    '  }',
    '}', ''].join('\n');
  function detPatch(sh, code) {
    const u = DET.u;
    sh.uniforms.uDetIvy = u.uDetIvy; sh.uniforms.uDetGnd = u.uDetGnd; sh.uniforms.uDetIvyTex = u.uDetIvyTex; sh.uniforms.uDetLit = u.uDetLit;
    sh.uniforms.uDetOn = u.uDetOn; sh.uniforms.uDetNoise = WTH.uWthNoise; sh.uniforms.uDetMoss = WTH.uMoss;
    sh.fragmentShader = DET_PARS + sh.fragmentShader.replace('#include <alphamap_fragment>', code + '#include <alphamap_fragment>');
  }

  // ---------- El color del suelo, en cada píxel ----------
  // Cada vértice del suelo lleva su color base (color) y el alterno con la roca de las laderas (aGnd: rgb y a). El
  // moteado entre los dos: manchas suaves de 5 m (70 %) y un grano de 1 m (30 %), de una rejilla al azar de 64 x 64
  // (se repite cada 320 m y 64 m: no se nota). Las laderas empinadas dejan ver la roca, como antes
  function gndTex() {
    const S = 64, rnd = U.mulberry32(4242), d = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) { d[i * 4] = Math.floor(rnd() * 256); d[i * 4 + 1] = Math.floor(rnd() * 256); d[i * 4 + 2] = 0; d[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }
  const GND = { uGndTex: { value: null }, uGndRock: { value: new THREE.Color(0x7a7166).convertSRGBToLinear() } };
  function gndPatch(sh) {
    sh.uniforms.uGndTex = GND.uGndTex; sh.uniforms.uGndRock = GND.uGndRock;
    sh.vertexShader = 'attribute vec4 aGnd;\nvarying vec4 vGnd;\nvarying vec2 vGndP;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\nvGnd = aGnd;\nvGndP = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    sh.fragmentShader = 'uniform sampler2D uGndTex;\nuniform vec3 uGndRock;\nvarying vec4 vGnd;\nvarying vec2 vGndP;\n' + sh.fragmentShader.replace('#include <color_fragment>', [
      'vec2 gQ = vGndP * 0.2;',
      'vec2 gF = fract( gQ );',
      'gF = gF * gF * ( 3.0 - 2.0 * gF );',
      'float gBig = texture2D( uGndTex, ( floor( gQ ) + gF + 0.5 ) / 64.0 ).r;',
      // (el grano de 1 m, solo de cerca: de lejos ni se ve)
      'float gK = 1.0 - smoothstep( 24.0, 34.0, distance( vGndP, cameraPosition.xz ) );',
      'float gSm = gK > 0.0 ? mix( 0.5, texture2D( uGndTex, ( vGndP + 0.5 ) / 64.0 ).g, gK ) : 0.5;',
      'float gV = gBig * 0.7 + gSm * 0.3;',
      'vec3 gC = mix( vColor, vGnd.rgb, gV );',
      'gC = mix( gC, uGndRock, vGnd.a * ( 0.75 + gV * 0.35 ) );',
      'diffuseColor.rgb *= gC;',
      // (y lo que venga detrás: la intemperie de fuera)
      '#include <color_fragment>'].join('\n').replace('#include <color_fragment>', '/*gnd*/'));
  }
  // un material de suelo: con la intemperie (kind) o sin ella
  function groundMat(mat, kind) {
    mat.onBeforeCompile = (sh) => {
      if (kind) wthPatch(sh, kind);
      gndPatch(sh);
      detPatch(sh, DET_GND);                              // (las hojas caídas y el musgo, pintados)
      if (G.Flash) G.Flash.patch(sh);
    };
    mat.customProgramCacheKey = () => 'gnd_' + (kind || '');
    return mat;
  }

  // ---------- Recursos compartidos ----------
  function init(sceneRef) {
    scene = sceneRef;
    const tex = makeTextures();
    const lam = (o) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true }, o || {}));
    WTH.uWthNoise.value = noiseTex();
    GND.uGndTex.value = gndTex();
    detInit();
    R = {
      tex,
      ground: {
        grass: groundMat(lam({ map: tex.grass })), asphalt: groundMat(lam({ map: tex.asphalt })),
        concrete: groundMat(lam({ map: tex.concrete })), wood: groundMat(lam({ map: tex.wood })),
        // fuera (al aire libre): con la intemperie
        grassX: groundMat(lam({ map: tex.grass }), 'grass'), asphaltX: groundMat(lam({ map: tex.asphalt }), 'asphalt'), concreteX: groundMat(lam({ map: tex.concrete }), 'concrete'),
        tile: groundMat(lam({ map: tex.tile })), carpet: groundMat(lam({ map: tex.carpet })), lino: groundMat(lam({ map: tex.lino })),
        // la moqueta del salón recreativo: los dibujos brillan un poco en la penumbra
        arcade: groundMat(lam({ map: tex.arcade, emissive: 0xffffff, emissiveIntensity: 0.17, emissiveMap: tex.arcadeGlow }))
      },
      static: weather(lam(), 'wall'),
      roof: weather(lam({ side: THREE.DoubleSide }), 'wall'),
      inner: lam(),                       // (los interiores: sin musgo)
      glass: new THREE.MeshLambertMaterial({ color: 0xa8c4d0, transparent: true, opacity: 0.3, depthWrite: false }),
      fixture: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      tree: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
      trunk: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      item: lam(),
      itemRing: new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.22, depthWrite: false }),
      doorGeo: makeDoorGeo(),
      glassGeo: new THREE.BoxGeometry(0.86, W().WIN_HI - W().WIN_LO, 0.02),
      fixtureGeo: new THREE.SphereGeometry(0.22, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2),
      lampHeadGeo: new THREE.BoxGeometry(0.5, 0.12, 0.24),
      ringGeo: (() => { const g = new THREE.RingGeometry(0.34, 0.42, 24); g.rotateX(-Math.PI / 2); return g; })()
    };
    R.fixture.toneMapped = false;
    // paredes, techos e interiores: se pueden volver transparentes si tapan al personaje (opción de Imagen)
    if (G.SeeThru) { G.SeeThru.mark(R.static); G.SeeThru.mark(R.roof); G.SeeThru.mark(R.inner); }

    // Luces de las habitaciones: un número fijo, se asignan a las más cercanas
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffd8a0, 0, 9, 1.6);
      l.position.set(0, -50, 0);
      scene.add(l);
      lightPool.push(l);
    }
  }

  function makeDoorGeo() {
    const m = new G.Mesher();
    const col = 0x7a5534;
    m.box(0.43, 1.02, 0, 0.86, 2.04, 0.045, col);
    // paneles en relieve
    m.box(0.43, 1.45, 0, 0.62, 0.7, 0.06, U.shade(col, 0.9));
    m.box(0.43, 0.55, 0, 0.62, 0.7, 0.06, U.shade(col, 0.9));
    m.sphere(0.76, 1.0, 0.04, 0.035, 0.035, 0.035, 0xc9b27a, 0);
    m.sphere(0.76, 1.0, -0.04, 0.035, 0.035, 0.035, 0xc9b27a, 0);
    return m.build();
  }

  // ---------- Colores ----------
  const GROUND = {};
  function groundStyle(g) {
    const F = W().F;
    // los mapas pueden teñir la hierba y la tierra (más apagadas con el cielo cubierto)
    const md = G.Maps && G.Maps.get(W().layout) && G.Maps.get(W().layout).mood;
    const key = g + (md && md.ground ? ':' + W().layout : '');
    if (GROUND[key]) return GROUND[key];
    const s = {
      [F.GRASS]: { mat: 'grass', base: 0x5d7d43, alt: 0x6f8a4a, scale: 0.25 },
      [F.ROAD]: { mat: 'asphalt', base: 0x47484b, alt: 0x4f4f50, scale: 0.2 },
      [F.SIDEWALK]: { mat: 'concrete', base: 0xa6a298, alt: 0xb0aca2, scale: 0.5 },
      [F.DIRT]: { mat: 'grass', base: 0x6e5a42, alt: 0x7a664c, scale: 0.25 },
      [F.WOOD]: { mat: 'wood', base: 0x9a6f48, alt: 0x936a44, scale: 0.5 },
      [F.TILE]: { mat: 'tile', base: 0xd9d6cb, alt: 0xd2cfc4, scale: 1 },
      [F.CONCRETE]: { mat: 'concrete', base: 0x8d8c86, alt: 0x96958e, scale: 0.25 },
      [F.LINO]: { mat: 'lino', base: 0xbfc4b9, alt: 0xb9beb3, scale: 0.5 },
      [F.CARPET]: { mat: 'carpet', base: 0x8b7b6a, alt: 0x857565, scale: 0.5 },
      [F.ARCADE]: { mat: 'arcade', base: 0xffffff, alt: 0xd8d4dc, scale: 0.42 }
    }[g] || { mat: 'grass', base: 0x5d7d43, alt: 0x6f8a4a, scale: 0.25 };
    if (md && md.ground && md.ground[g]) { s.base = md.ground[g][0]; s.alt = md.ground[g][1]; }
    s.c0 = new THREE.Color(s.base).convertSRGBToLinear();
    s.c1 = new THREE.Color(s.alt).convertSRGBToLinear();
    GROUND[key] = s;
    return s;
  }

  // ---------- Suelo ----------
  // Antes: dos triángulos por cada metro cuadrado, siempre (2.048 por zona de 32 m), con el color moteado guardado
  // en cada esquina. Ahora:
  //  · el moteado (manchas de 5 m y un grano de 1 m, entre el color base y el alterno de cada suelo) lo calcula el
  //    sombreador en cada píxel (ver gndPatch). Así el color ya no depende de cuántas esquinas haya
  //  · lo plano y del mismo suelo se junta en rectángulos grandes (un césped llano de 20 x 20 m: 2 triángulos, no 800)
  //  · las laderas siguen metro a metro de cerca; desde la segunda zona (a 32 m o más, ya entre la niebla) van en
  //    bloques de 2 x 2 m, cosidos con los vecinos para que no se abran rendijas (gNear / gFar, ver update)
  // Se ve igual: mismas alturas, mismas normales suaves en las lomas, mismo color.
  function* buildGround(c, group) {
    const Wd = W();
    const F = Wd.F;
    const CS = Wd.CS, RW = CS + 1;
    const ox = c.cx * CS, oz = c.cz * CS;
    const mkParts = () => { const parts = {}; parts.get = (mat) => parts[mat] || (parts[mat] = { p: [], n: [], col: [], g: [], uv: [], idx: [] }); return parts; };
    const common = mkParts(), near = mkParts(), far = mkParts();
    const th = c.th;
    // altura de una esquina (fuera del chunk, la del ruido: es la misma que calcula el vecino)
    const H = (ix, iz) => (ix >= 0 && iz >= 0 && ix <= CS && iz <= CS) ? th[iz * RW + ix] : Wd.rawHeight(ox + ix, oz + iz);
    // normal suave de cada esquina (para que las lomas se iluminen redondeadas)
    const NRM = new Float32Array(RW * RW * 3);
    for (let iz = 0; iz <= CS; iz++) {
      for (let ix = 0; ix <= CS; ix++) {
        const nx = H(ix - 1, iz) - H(ix + 1, iz), nz = H(ix, iz - 1) - H(ix, iz + 1);
        const l = Math.hypot(nx, 2, nz);
        const k = (iz * RW + ix) * 3;
        NRM[k] = nx / l; NRM[k + 1] = 2 / l; NRM[k + 2] = nz / l;
      }
    }
    const UP = [0, 1, 0];
    // un vértice: color base (el moteado hacia el alterno y la roca de las laderas los pone el sombreador)
    const vert = (P, x, y, z, s, n) => {
      const rock = s.mat === 'grass' && n[1] < 0.88 ? Math.min(0.8, (0.88 - n[1]) / 0.22) : 0;
      P.p.push(x, y, z);
      P.n.push(n[0], n[1], n[2]);
      P.col.push(s.c0.r, s.c0.g, s.c0.b);
      P.g.push(s.c1.r, s.c1.g, s.c1.b, rock);
      P.uv.push(x * s.scale, z * s.scale);
      return P.p.length / 3 - 1;
    };
    // triángulo orientado según 'up'
    const tri = (P, a, b, d, up) => {
      const q = P.p;
      const ux = q[b * 3] - q[a * 3], uy = q[b * 3 + 1] - q[a * 3 + 1], uz = q[b * 3 + 2] - q[a * 3 + 2];
      const vx = q[d * 3] - q[a * 3], vy = q[d * 3 + 1] - q[a * 3 + 1], vz = q[d * 3 + 2] - q[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * up[0] + ny * up[1] + nz * up[2] >= 0) P.idx.push(a, b, d); else P.idx.push(a, d, b);
    };
    // cuatro esquinas con su normal; el triángulo se orienta según 'up'
    const quad = (P, a, b, cc, d, s, na, nb, nc, nd, up) => {
      const base = P.p.length / 3;
      vert(P, a[0], a[1], a[2], s, na); vert(P, b[0], b[1], b[2], s, nb);
      vert(P, cc[0], cc[1], cc[2], s, nc); vert(P, d[0], d[1], d[2], s, nd);
      const ux = cc[0] - a[0], uy = cc[1] - a[1], uz = cc[2] - a[2];
      const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * up[0] + ny * up[1] + nz * up[2] >= 0) P.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else P.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const nAt = (ix, iz) => { const k = (iz * RW + ix) * 3; return [NRM[k], NRM[k + 1], NRM[k + 2]]; };
    const flatN = (ix, iz) => { const k = (iz * RW + ix) * 3; return NRM[k + 1] > 0.999999; };

    // 1) qué es cada celda: plana (se junta con las iguales: «llave»), ladera (metro a metro o en bloques) o nada
    const N = CS * CS;
    const key = new Int32Array(N).fill(-1);        // llave de las planas (mismo suelo, misma altura)
    const slope = new Uint8Array(N);               // 1: ladera de suelo normal (sin acera ni edificio)
    const keys = new Map(), kinfo = [];
    const keyOf = (part, s, y) => {
      const k = part + '|' + s.mat + '|' + s.base + '|' + s.alt + '|' + y;
      let id = keys.get(k);
      if (id == null) { id = kinfo.length; keys.set(k, id); kinfo.push({ part, s, y }); }
      return id;
    };
    const partOf = new Array(N), styleOf = new Array(N);
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const i = z * CS + x;
        const g = c.ground[i];
        const s = groundStyle(g);
        const bi = c.bld[i];
        const part = !bi && R.ground[s.mat + 'X'] ? s.mat + 'X' : s.mat;
        partOf[i] = part; styleOf[i] = s;
        if (bi) { key[i] = keyOf(part, s, c.buildings[bi - 1].baseY + 0.04); continue; }
        const e = g === F.SIDEWALK ? 0.1 : 0;
        const h = H(x, z);
        const flat = h === H(x + 1, z) && h === H(x + 1, z + 1) && h === H(x, z + 1) &&
          flatN(x, z) && flatN(x + 1, z) && flatN(x + 1, z + 1) && flatN(x, z + 1);
        if (flat) key[i] = keyOf(part, s, h + e);
        else if (g !== F.SIDEWALK) slope[i] = 1;
      }
    }

    // 2) lo plano: rectángulos lo más grandes posible (de igual llave).
    // Cada rectángulo se agranda 6 mm por cada lado: donde el lado largo de uno toca las esquinas de dos más chicos
    // (o las celdas de una ladera, o el trozo de al lado), la placa de video no siempre calcula esa línea igual para
    // los dos, y quedaba una rendija de un píxel por la que se veía el cielo (las «fisuras» del suelo). Así se pisan
    // un poco y no queda hueco (la textura sale de la posición: no se nota)
    const EP = 0.006;
    const done = new Uint8Array(N);
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const id = key[z * CS + x];
        if (id < 0 || done[z * CS + x]) continue;
        let w = 1;
        while (x + w < CS && key[z * CS + x + w] === id && !done[z * CS + x + w]) w++;
        let h = 1;
        grow: while (z + h < CS) {
          for (let k = 0; k < w; k++) if (key[(z + h) * CS + x + k] !== id || done[(z + h) * CS + x + k]) break grow;
          h++;
        }
        for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) done[(z + dz) * CS + x + dx] = 1;
        const K = kinfo[id], X = ox + x - EP, Z = oz + z - EP, y = K.y, w2 = w + 2 * EP, h2 = h + 2 * EP;
        quad(common.get(K.part), [X, y, Z], [X + w2, y, Z], [X + w2, y, Z + h2], [X, y, Z + h2], K.s, UP, UP, UP, UP, UP);
      }
    }
    yield;

    // 3) laderas y aceras en cuesta, celda a celda; las laderas que formen un bloque de 2 x 2 (mismo suelo) van además
    // en grueso para lejos
    const blockOk = (bx, bz) => {
      const i0 = bz * CS + bx;
      if (!(slope[i0] && slope[i0 + 1] && slope[i0 + CS] && slope[i0 + CS + 1])) return false;
      const p = partOf[i0], s = styleOf[i0];
      return partOf[i0 + 1] === p && partOf[i0 + CS] === p && partOf[i0 + CS + 1] === p &&
        styleOf[i0 + 1] === s && styleOf[i0 + CS] === s && styleOf[i0 + CS + 1] === s;
    };
    const inBlock = new Uint8Array(N);
    const blocks = [];
    for (let bz = 0; bz < CS; bz += 2) for (let bx = 0; bx < CS; bx += 2) {
      if (!blockOk(bx, bz)) continue;
      blocks.push([bx, bz]);
      inBlock[bz * CS + bx] = inBlock[bz * CS + bx + 1] = inBlock[(bz + 1) * CS + bx] = inBlock[(bz + 1) * CS + bx + 1] = 1;
    }
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const i = z * CS + x;
        if (key[i] >= 0) continue;                 // (plana: ya está)
        const g = c.ground[i], s = styleOf[i];
        const X = ox + x, Z = oz + z;
        const e = g === F.SIDEWALK ? 0.1 : 0;
        const h00 = H(x, z) + e, h10 = H(x + 1, z) + e, h11 = H(x + 1, z + 1) + e, h01 = H(x, z + 1) + e;
        // (las de un bloque, de cerca; las sueltas, siempre)
        const P = (inBlock[i] ? near : common).get(partOf[i]);
        quad(P, [X, h00, Z], [X + 1, h10, Z], [X + 1, h11, Z + 1], [X, h01, Z + 1], s, nAt(x, z), nAt(x + 1, z), nAt(x + 1, z + 1), nAt(x, z + 1), UP);
      }
      if (z % 8 === 7) yield;
    }
    // bloques gruesos: 2 triángulos; si un lado da a algo que no es bloque (o al borde de la zona), ese lado lleva
    // su punto medio (y el bloque va en abanico desde el centro): así coincide con las celdas de 1 m de al lado
    for (const [bx, bz] of blocks) {
      const s = styleOf[bz * CS + bx], P = far.get(partOf[bz * CS + bx]);
      const vAt = (ix, iz) => vert(P, ox + ix, H(ix, iz), oz + iz, s, nAt(ix, iz));
      const other = (nbx, nbz) => nbx < 0 || nbz < 0 || nbx >= CS || nbz >= CS || !inBlock[nbz * CS + nbx];
      const mS = other(bx, bz - 1), mE = other(bx + 2, bz), mN = other(bx, bz + 2), mW = other(bx - 1, bz);
      const c00 = vAt(bx, bz), c10 = vAt(bx + 2, bz), c11 = vAt(bx + 2, bz + 2), c01 = vAt(bx, bz + 2);
      if (!mS && !mE && !mN && !mW) {
        // la diagonal que mejor sigue la loma
        const d1 = Math.abs(H(bx, bz) + H(bx + 2, bz + 2) - 2 * H(bx + 1, bz + 1)), d2 = Math.abs(H(bx + 2, bz) + H(bx, bz + 2) - 2 * H(bx + 1, bz + 1));
        if (d1 <= d2) { tri(P, c00, c10, c11, UP); tri(P, c00, c11, c01, UP); }
        else { tri(P, c00, c10, c01, UP); tri(P, c10, c11, c01, UP); }
        continue;
      }
      const ring = [c00];
      if (mS) ring.push(vAt(bx + 1, bz));
      ring.push(c10);
      if (mE) ring.push(vAt(bx + 2, bz + 1));
      ring.push(c11);
      if (mN) ring.push(vAt(bx + 1, bz + 2));
      ring.push(c01);
      if (mW) ring.push(vAt(bx, bz + 1));
      const cc = vAt(bx + 1, bz + 1);
      for (let k = 0; k < ring.length; k++) tri(P, cc, ring[k], ring[(k + 1) % ring.length], UP);
    }
    yield;

    // 4) bordillos de las aceras (siempre)
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const i = z * CS + x;
        if (c.ground[i] !== F.SIDEWALK || c.bld[i]) continue;
        const P = common.get(partOf[i]);
        const cs = groundStyle(F.SIDEWALK);
        const X = ox + x, Z = oz + z;
        const e = 0.1;
        const t00 = H(x, z), t10 = H(x + 1, z), t11 = H(x + 1, z + 1), t01 = H(x, z + 1);
        const h00 = t00 + e, h10 = t10 + e, h11 = t11 + e, h01 = t01 + e;
        const nb = (dx, dz) => {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= CS || zz >= CS) return Wd.ground(X + dx, Z + dz);
          return c.ground[zz * CS + xx];
        };
        if (nb(0, -1) !== F.SIDEWALK) quad(P, [X + 1, t10, Z], [X, t00, Z], [X, h00, Z], [X + 1, h10, Z], cs, [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]);
        if (nb(0, 1) !== F.SIDEWALK) quad(P, [X, t01, Z + 1], [X + 1, t11, Z + 1], [X + 1, h11, Z + 1], [X, h01, Z + 1], cs, [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]);
        if (nb(-1, 0) !== F.SIDEWALK) quad(P, [X, t00, Z], [X, t01, Z + 1], [X, h01, Z + 1], [X, h00, Z], cs, [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0]);
        if (nb(1, 0) !== F.SIDEWALK) quad(P, [X + 1, t11, Z + 1], [X + 1, t10, Z], [X + 1, h10, Z], [X + 1, h11, Z + 1], cs, [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0]);
      }
    }

    // 5) suelo de la planta de arriba (sin el hueco de la escalera), también en rectángulos
    if (c.up) {
      const keyU = new Int32Array(N).fill(-1);
      for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
        const i = z * CS + x;
        if (!c.up.bld[i] || (c.stairMap && c.stairMap[i])) continue;
        const s = groundStyle(c.up.ground[i]);
        keyU[i] = keyOf(s.mat, s, c.buildings[c.up.bld[i] - 1].baseY + Wd.FLOOR_H + 0.04);
      }
      const doneU = new Uint8Array(N);
      for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
        const id = keyU[z * CS + x];
        if (id < 0 || doneU[z * CS + x]) continue;
        let w = 1;
        while (x + w < CS && keyU[z * CS + x + w] === id && !doneU[z * CS + x + w]) w++;
        let h = 1;
        growU: while (z + h < CS) {
          for (let k = 0; k < w; k++) if (keyU[(z + h) * CS + x + k] !== id || doneU[(z + h) * CS + x + k]) break growU;
          h++;
        }
        for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) doneU[(z + dz) * CS + x + dx] = 1;
        const K = kinfo[id], X = ox + x - EP, Z = oz + z - EP, y = K.y, w2 = w + 2 * EP, h2 = h + 2 * EP;
        quad(common.get(K.part), [X, y, Z], [X + w2, y, Z], [X + w2, y, Z + h2], [X, y, Z + h2], K.s, UP, UP, UP, UP, UP);
      }
    }

    // 6) las mallas: lo común, en el grupo; las laderas de cerca y de lejos, cada una en su subgrupo
    const castSh = !c.town && !(G.Maps && G.Maps.get(Wd.layout)) && Wd.layout !== 'refugio';
    const emit = (parts, into) => {
      let n = 0;
      for (const k in parts) {
        if (k === 'get') continue;
        const P = parts[k];
        if (!P.idx.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(P.p, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(P.n, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3));
        geo.setAttribute('aGnd', new THREE.Float32BufferAttribute(P.g, 4));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(P.uv, 2));
        geo.setIndex(P.idx);
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, R.ground[k]);
        mesh.receiveShadow = true;
        mesh.userData.groundTag = true;
        // fuera del pueblo las lomas proyectan sombra (en los mapas y el refugio el suelo es llano: sin sombra)
        mesh.castShadow = castSh;
        into.add(mesh);
        n++;
      }
      return n;
    };
    if (!blocks.length) { emit(common, group); c.gLod = null; return; }
    // dos versiones enteras (lo común + las laderas de cerca, o + las de lejos): se dibuja una sola, así que las
    // llamadas de dibujo son las mismas que con una
    const join = (A, B) => {
      const out = mkParts();
      for (const src of [A, B]) for (const k in src) {
        if (k === 'get') continue;
        const S = src[k], D = out.get(k), base = D.p.length / 3;
        for (let i = 0; i < S.p.length; i++) D.p.push(S.p[i]);
        for (let i = 0; i < S.n.length; i++) D.n.push(S.n[i]);
        for (let i = 0; i < S.col.length; i++) D.col.push(S.col[i]);
        for (let i = 0; i < S.g.length; i++) D.g.push(S.g[i]);
        for (let i = 0; i < S.uv.length; i++) D.uv.push(S.uv[i]);
        for (let i = 0; i < S.idx.length; i++) D.idx.push(S.idx[i] + base);
      }
      return out;
    };
    const gN = new THREE.Group(), gF = new THREE.Group();
    emit(join(common, near), gN); emit(join(common, far), gF);
    gF.visible = false;
    group.add(gN); group.add(gF);
    c.gLod = { near: gN, far: gF, far_: false, cast: castSh };
  }

  // Las laderas de lejos (en bloques de 2 m) o de cerca (de 1 m): desde la segunda zona alrededor, lejos
  function groundLod(chunks, px, pz) {
    const CS = W().CS, pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    chunks.forEach((c) => {
      const L = c.gLod;
      if (!L || !c.view) return;
      const isFar = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) >= 2;
      if (isFar === L.far_) return;
      L.far_ = isFar; L.near.visible = !isFar; L.far.visible = isFar;
      if (L.cast) shDirty();
    });
  }

  // ---------- Paredes ----------
  function sideColor(tx, tz, ownerB, lv) {
    const room = W().roomAt(tx, tz, lv);
    if (room) return { hex: room.wall, ext: false };
    // (los muros sueltos de un mapa: su color, si el mapa lo pide)
    const mp = G.Maps && G.Maps.get(W().layout);
    return { hex: ownerB ? ownerB.siding : ((mp && mp.wallCol) || 0xcccccc), ext: true };
  }

  // Trozo de pared entre y0 e y1 en la arista (o, x, z); a lo largo de [s0, s1] de la arista
  let yOff = 0;     // altura de la planta que se está construyendo
  function wallPiece(m, o, x, z, y0, y1, A, Bc, s0, s1) {
    const Wd = W();
    const ext0 = y0 < 0.3 && !yOff;
    const T = Wd.WALL_T, HT = T / 2;
    const len = (s1 - s0) + 0.008, mid = (s0 + s1) / 2;   // leve solape para que no se vean rendijas
    const parts = [[A, -1], [Bc, 1]];
    for (const [side, sg] of parts) {
      const hex = side.hex;
      const pieces = [];
      if (side.ext && ext0) {
        pieces.push([y0, Math.min(y1, 0.3), U.shade(hex, 0.62)]);
        if (y1 > 0.3) pieces.push([0.3, y1, hex]);
      } else pieces.push([y0, y1, hex]);
      for (const [a, b, h] of pieces) {
        if (o === 'N') m.box(x + mid, (a + b) / 2 + yOff, z + sg * HT / 2, len, b - a, HT, h);
        else m.box(x + sg * HT / 2, (a + b) / 2 + yOff, z + mid, HT, b - a, len, h);
      }
    }
  }

  function trim(m, o, x, z, s, y0, y1, w, d, hex) {
    if (o === 'N') m.box(x + s, (y0 + y1) / 2 + yOff, z, w, y1 - y0, d, hex);
    else m.box(x, (y0 + y1) / 2 + yOff, z + s, d, y1 - y0, w, hex);
  }

  // inner(edificio) -> malla de su interior (tabiques, muebles), que se oculta desde lejos
  function* buildEdges(c, m0, view, lv, inner) {
    const Wd = W();
    const E = Wd.E, CS = Wd.CS;
    const T = Wd.WALL_T, H0 = Wd.WALL_H;
    let H = H0;
    const ox = c.cx * CS, oz = c.cz * CS;
    const TRIM = 0xe9e5da;
    const L = lv ? c.up : c;
    if (!L) return;
    yOff = lv ? Wd.FLOOR_H : 0;
    const terr = (x, z) => Wd.terrainAt(x, z);
    for (const o of ['N', 'W']) {
      const arr = o === 'N' ? L.eN : L.eW;
      for (let z = 0; z < CS; z++) {
        if (z % 8 === 0 && z) { yield; yOff = lv ? Wd.FLOOR_H : 0; }
        for (let x = 0; x < CS; x++) {
          const e = arr[z * CS + x];
          if (!e) continue;
          const X = ox + x, Z = oz + z;
          // casillas a cada lado (A = norte/oeste, B = sur/este)
          const ax = o === 'N' ? X : X - 1, az = o === 'N' ? Z - 1 : Z;
          let m = m0;
          const mxE = o === 'N' ? X + 0.5 : X, mzE = o === 'N' ? Z : Z + 0.5;
          if (e === E.CONT) continue;            // lo dibuja el contenedor (mueble)
          if (e === E.FENCE) { m.oy = terr(mxE, mzE); buildFence(m, o, X, Z, c); m.oy = 0; continue; }
          if (e === E.RAIL) { const ob = Wd.bldAt(X, Z, lv) || Wd.bldAt(ax, az, lv);    // (en el borde de fuera la casilla es la de dentro)
            const mr = ob && inner ? inner(ob) : m; mr.oy = ob ? ob.baseY : 0; buildRail(mr, o, X, Z); mr.oy = 0; continue; }
          if (e === E.GATE) {
            // portón enrollable subido: pared por encima, sin marcos entre casillas
            const owner2 = Wd.bldAt(X, Z, lv) || Wd.bldAt(ax, az, lv);
            H = (owner2 && owner2.wallH) || H0;
            const A2 = sideColor(ax, az, owner2, lv), B2 = sideColor(X, Z, owner2, lv);
            m.oy = owner2 ? owner2.baseY : 0;
            wallPiece(m, o, X, Z, 2.55, H, A2, B2, 0, 1);
            const outA = A2.ext ? -1 : 1;
            if (o === 'N') m.box(X + 0.5, 2.45, Z + outA * 0.12, 1.004, 0.2, 0.14, 0xb8b4a8);
            else m.box(X + outA * 0.12, 2.45, Z + 0.5, 0.14, 0.2, 1.004, 0xb8b4a8);
            m.oy = 0;
            continue;
          }
          const owner = Wd.bldAt(X, Z, lv) || Wd.bldAt(ax, az, lv);
          H = (owner && owner.wallH) || H0;
          const A = sideColor(ax, az, owner, lv), Bc = sideColor(X, Z, owner, lv);
          const ext = A.ext || Bc.ext;
          if (!ext && owner && inner) m = inner(owner);
          const by = owner ? owner.baseY : terr(mxE, mzE);
          m.oy = by;
          // Solo las paredes horizontales se alargan en las esquinas (evita parpadeos)
          let s0 = 0, s1 = 1;
          if (o === 'N') {
            const vert = (vx, vz) => { const q = Wd.eW(vx, vz, lv); return q && q !== E.FENCE && q !== E.RAIL; };
            if (vert(X, Z - 1) || vert(X, Z)) s0 = -T / 2;
            if (vert(X + 1, Z - 1) || vert(X + 1, Z)) s1 = 1 + T / 2;
          }
          if (e === E.WALL) {
            // paredes que se pueden derribar (jefe final): se apunta qué vértices son, para hacerlas desaparecer
            // sin volver a construir todo el trozo
            const brk = !ext && !lv && owner && owner.bp && owner.bp.def.breakable && view.brk;
            const v0 = m.count;
            wallPiece(m, o, X, Z, 0, H, A, Bc, s0, s1);
            if (brk) view.brk.set(Wd.edgeKey({ o, x: X, z: Z, lv: 0 }), { b: owner, st: v0, en: m.count });
          } else if (e === E.DOOR || e === E.DOOR_OPEN || e === E.DOOR_BROKEN || e === E.ARCH) {
            const top = e === E.ARCH ? 2.2 : Wd.DOOR_H;
            const brk = !ext && !lv && owner && owner.bp && owner.bp.def.breakable && view.brk;   // (también se derriban)
            const v0 = m.count;
            wallPiece(m, o, X, Z, top, H, A, Bc, s0, s1);
            wallPiece(m, o, X, Z, 0, top, A, Bc, s0, 0.07);
            wallPiece(m, o, X, Z, 0, top, A, Bc, 0.93, s1);
            trim(m, o, X, Z, 0.5, top, top + 0.07, 0.94, T + 0.03, TRIM);
            trim(m, o, X, Z, 0.055, 0, top, 0.05, T + 0.03, TRIM);
            trim(m, o, X, Z, 0.945, 0, top, 0.05, T + 0.03, TRIM);
            if (brk) view.brk.set(Wd.edgeKey({ o, x: X, z: Z, lv: 0 }), { b: owner, st: v0, en: m.count });
            if (e !== E.ARCH) { const dr = makeDoor(o, X, Z, e, lv); dr.by = by; view.doors.push(dr); }
            if (ext && e !== E.ARCH && !lv) {
              // escalón de entrada (más alto si la base del edificio queda por encima del terreno)
              const outA = A.ext;
              const s = outA ? -1 : 1;
              const sx = o === 'N' ? X + 0.5 : X + s * 0.35, sz = o === 'N' ? Z + s * 0.35 : Z + 0.5;
              const tg = terr(sx + (o === 'N' ? 0 : s * 0.3), sz + (o === 'N' ? s * 0.3 : 0));
              const hh = Math.max(0.1, by + 0.1 - tg);
              m.oy = 0;
              if (o === 'N') m.box(sx, by + 0.1 - hh / 2, sz, 1.2, hh, 0.55, 0x9d998f);
              else m.box(sx, by + 0.1 - hh / 2, sz, 0.55, hh, 1.2, 0x9d998f);
              if (hh > 0.3) {
                // un escalón más abajo
                if (o === 'N') m.box(sx, tg + (hh / 2) / 2, sz + s * 0.38, 1.2, hh / 2, 0.3, 0x95918a);
                else m.box(sx + s * 0.38, tg + (hh / 2) / 2, sz, 0.3, hh / 2, 1.2, 0x95918a);
              }
              m.oy = by;
            }
          } else if (e === E.WIN || e === E.WIN_OPEN || e === E.WIN_BROKEN) {
            wallPiece(m, o, X, Z, 0, Wd.WIN_LO, A, Bc, s0, s1);
            wallPiece(m, o, X, Z, Wd.WIN_HI, H, A, Bc, s0, s1);
            wallPiece(m, o, X, Z, Wd.WIN_LO, Wd.WIN_HI, A, Bc, s0, 0.07);
            wallPiece(m, o, X, Z, Wd.WIN_LO, Wd.WIN_HI, A, Bc, 0.93, s1);
            trim(m, o, X, Z, 0.5, Wd.WIN_LO - 0.05, Wd.WIN_LO, 1.0, T + 0.12, TRIM);
            trim(m, o, X, Z, 0.5, Wd.WIN_HI, Wd.WIN_HI + 0.06, 0.96, T + 0.04, TRIM);
            trim(m, o, X, Z, 0.055, Wd.WIN_LO, Wd.WIN_HI, 0.05, T + 0.04, TRIM);
            trim(m, o, X, Z, 0.945, Wd.WIN_LO, Wd.WIN_HI, 0.05, T + 0.04, TRIM);
            // sin vidrio: solo el hueco de la ventana
          }
          m.oy = 0;
        }
      }
    }
    yOff = 0;
  }

  // Barandilla alrededor del hueco de la escalera
  function buildRail(m, o, X, Z) {
    const y = yOff, col = 0x6e4f33;
    const along = (s, yy, w, h, d) => {
      if (o === 'N') m.box(X + s, y + yy, Z, w, h, d, col);
      else m.box(X, y + yy, Z + s, d, h, w, col);
    };
    along(0.5, 0.95, 1.0, 0.06, 0.08);
    along(0.03, 0.48, 0.06, 0.95, 0.06);
    for (const s of [0.25, 0.5, 0.75]) along(s, 0.47, 0.03, 0.9, 0.03);
  }

  // Escalera: peldaños de la planta baja a la de arriba
  function buildStairs(c, m0, inner) {
    const Wd = W();
    const FH = Wd.FLOOR_H, steps = 16;
    for (const s of c.stairs) {
      const ob = Wd.bldAt(s.x, s.z, 0);
      const m = ob && inner ? inner(ob) : m0;
      m.oy = s.b ? s.b.baseY : 0;
      const bx = s.x + 0.5 - s.dx * 0.5, bz = s.z + 0.5 - s.dz * 0.5;     // pie de la escalera
      const px = -s.dz, pz = s.dx;                                       // perpendicular
      const cxl = s.x + 0.5, czl = s.z + 0.5;
      for (let k = 0; k < steps; k++) {
        const a = k / steps, b = (k + 1) / steps;
        const top = (k + 1) * FH / steps + 0.04;
        const mx = bx + s.dx * s.len * (a + b) / 2, mz = bz + s.dz * s.len * (a + b) / 2;
        const lenA = s.len / steps;
        const w = 0.92;
        // peldaño macizo hasta el suelo (así no se ve hueco por debajo)
        const col = k % 2 ? 0x8a6444 : 0x83603f;
        if (s.dx) m.box(mx, top / 2, cxl * 0 + czl + 0 * pz, lenA + 0.01, top, w, col);
        else m.box(cxl, top / 2, mz, w, top, lenA + 0.01, col);
        // borde del peldaño
        if (s.dx) m.box(mx + s.dx * lenA * 0.45, top + 0.01, czl, 0.04, 0.02, w, 0x6e4f33);
        else m.box(cxl, top + 0.01, mz + s.dz * lenA * 0.45, w, 0.02, 0.04, 0x6e4f33);
      }
      // pasamanos a un lado
      const ang = Math.atan2(FH, s.len);
      const L = Math.hypot(FH, s.len);
      const hx = s.dx ? bx + s.dx * s.len / 2 : cxl + 0.42, hz = s.dz ? bz + s.dz * s.len / 2 : czl + 0.42;
      if (s.dx) m.box(hx, FH / 2 + 0.95, hz, L, 0.05, 0.05, 0x6e4f33, 0, 0, 0, s.dx * ang);
      else m.box(hx, FH / 2 + 0.95, hz, 0.05, 0.05, L, 0x6e4f33, 0, 0, -s.dz * ang, 0);
      m.oy = 0;
    }
  }

  function buildFence(m, o, X, Z, c) {
    const Wd = W();
    if (Wd.fenceStyle === 'chain') {
      // valla de tela metálica (con postes, alambre de espino arriba y la malla en rombos sugerida con alambres)
      const post = 0x5c6064, wire = 0x7d8388;
      const al = (s, y, w, h, d, col) => { if (o === 'N') m.box(X + s, y, Z, w, h, d, col); else m.box(X, y, Z + s, d, h, w, col); };
      al(0, 1.3, 0.07, 2.6, 0.07, post);
      al(0.5, 2.38, 1.0, 0.04, 0.04, post);
      al(0.5, 0.06, 1.0, 0.04, 0.03, wire);
      for (const y of [0.45, 0.9, 1.35, 1.8]) al(0.5, y, 1.0, 0.012, 0.012, wire);
      for (const s of [0.17, 0.34, 0.5, 0.67, 0.84]) al(s, 1.2, 0.012, 2.3, 0.012, wire);
      for (const y of [2.5, 2.62]) al(0.5, y, 1.0, 0.015, 0.015, 0x4a4e52);
      for (const s of [0.25, 0.75]) { al(s, 2.56, 0.06, 0.06, 0.02, 0x4a4e52); al(s, 2.56, 0.02, 0.06, 0.06, 0x4a4e52); }
      return;
    }
    const hx = Wd.hash(c.cx, c.cz, 77) < 0.5 ? 0xe2ddd0 : 0x8a6c4c;
    const along = (s, y, w, h, d) => {
      if (o === 'N') m.box(X + s, y, Z, w, h, d, hx);
      else m.box(X, y, Z + s, d, h, w, hx);
    };
    along(0, 0.6, 0.1, 1.2, 0.1);                 // poste
    along(0.5, 0.35, 1.0, 0.07, 0.04);            // travesaños
    along(0.5, 0.85, 1.0, 0.07, 0.04);
    for (const s of [0.2, 0.4, 0.6, 0.8]) along(s, 0.55, 0.09, 1.05, 0.025);
  }

  function makeDoor(o, X, Z, e, lv) {
    const Wd = W();
    // abre hacia dentro de la casa (o hacia B si ambos lados son interiores)
    const ax = o === 'N' ? X : X - 1, az = o === 'N' ? Z - 1 : Z;
    const inA = Wd.isIndoor(ax, az, lv), inB = Wd.isIndoor(X, Z, lv);
    const swing = (inA && !inB) ? -1 : 1;
    const E = Wd.E;
    const open = e === E.DOOR_OPEN ? 1 : 0;
    return { o, x: X, z: Z, lv: lv || 0, swing, open, target: open, broken: e === E.DOOR_BROKEN };
  }

  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _y = new THREE.Vector3(0, 1, 0);

  function doorMatrix(d) {
    if (d.broken || d.gone) return _m4.makeScale(0, 0, 0);
    let ang;
    const y = 0.04 + (d.lv ? W().FLOOR_H : 0) + (d.by || 0);
    if (d.o === 'N') { _p.set(d.x + 0.07, y, d.z); ang = -Math.PI / 2 * d.open * d.swing; }
    else { _p.set(d.x, y, d.z + 0.07); ang = -Math.PI / 2 + Math.PI / 2 * d.open * d.swing; }
    _q.setFromAxisAngle(_y, ang);
    _s.set(1, 1, 1);
    return _m4.compose(_p, _q, _s);
  }

  function windowMatrix(w, e) {
    const Wd = W(), E = Wd.E;
    if (e === E.WIN_BROKEN) return _m4.makeScale(0, 0, 0);
    const hh = Wd.WIN_HI - Wd.WIN_LO;
    const open = e === E.WIN_OPEN;
    const yc = (open ? Wd.WIN_HI - hh * 0.25 : (Wd.WIN_LO + Wd.WIN_HI) / 2) + (w.lv ? Wd.FLOOR_H : 0) + (w.by || 0);
    _s.set(1, open ? 0.5 : 1, 1);
    if (w.o === 'N') { _p.set(w.x + 0.5, yc, w.z); _q.identity(); }
    else { _p.set(w.x, yc, w.z + 0.5); _q.setFromAxisAngle(_y, Math.PI / 2); }
    return _m4.compose(_p, _q, _s);
  }

  // ---------- Techos ----------
  function buildRoofs(c, m, roofM) {
    const Wd = W();
    for (const b of c.buildings) {
      const x0 = b.x0, z0 = b.z0, x1 = b.x0 + b.w, z1 = b.z0 + b.h;
      // zócalo: tapa la diferencia entre la base nivelada y el terreno alrededor
      const by = b.baseY || 0;
      const side = (ax, az, bx, bz) => {
        let lo = Infinity;
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az)));
        for (let k = 0; k <= n; k++) lo = Math.min(lo, Wd.terrainAt(ax + (bx - ax) * k / n, az + (bz - az) * k / n));
        return lo;
      };
      const FC = 0x8b877e;
      const fz = (z, lo) => { if (by - lo > 0.02) m.box((x0 + x1) / 2, (by + lo - 0.25) / 2 + 0.04, z, b.w + 0.16, by - lo + 0.25 + 0.08, 0.16, FC); };
      const fx = (x, lo) => { if (by - lo > 0.02) m.box(x, (by + lo - 0.25) / 2 + 0.04, (z0 + z1) / 2, 0.16, by - lo + 0.25 + 0.08, b.h + 0.16, FC); };
      fz(z0, side(x0, z0 - 0.1, x1, z0 - 0.1)); fz(z1, side(x0, z1 + 0.1, x1, z1 + 0.1));
      fx(x0, side(x0 - 0.1, z0, x0 - 0.1, z1)); fx(x1, side(x1 + 0.1, z0, x1 + 0.1, z1));
      m.oy = by; roofM.oy = by;
      let H = b.wallH || Wd.WALL_H;
      if (b.floors === 2) {
        // forjado entre plantas (con el hueco de la escalera) y franja de fachada
        const FH = Wd.FLOOR_H;
        for (let z = z0; z < z1; z++) {
          let run = -1;
          for (let x = x0; x <= x1; x++) {
            const hole = x === x1 || Wd.stairAt(x + 0.5, z + 0.5);
            if (!hole && run < 0) run = x;
            if (hole && run >= 0) {
              m.box((run + x) / 2, (H + FH) / 2, z + 0.5, x - run + 0.004, FH - H, 1.004, 0xe8e3d6);
              run = -1;
            }
          }
        }
        const bandC = U.shade(b.siding, 0.82), yb = (H + FH) / 2, hb = FH - H + 0.02;
        m.box((x0 + x1) / 2, yb, z0 - 0.04, b.w + 0.2, hb, 0.1, bandC);
        m.box((x0 + x1) / 2, yb, z1 + 0.04, b.w + 0.2, hb, 0.1, bandC);
        m.box(x0 - 0.04, yb, (z0 + z1) / 2, 0.1, hb, b.h, bandC);
        m.box(x1 + 0.04, yb, (z0 + z1) / 2, 0.1, hb, b.h, bandC);
        H = FH + Wd.WALL_H;
      }
      // sin techo (edificio desmoronado): solo un remate roto encima de las paredes
      if (b.roof === 'none') { m.oy = 0; roofM.oy = 0; continue; }
      // terraza (openUp): casillas de arriba sin techo; la losa y el tejado plano se hacen por tiras
      const openR = b.bp && b.bp.def.openUp;
      if (openR && b.roof === 'flat') {
        const isOpen = (x, z) => openR.some(([ox, oz, ow, oh]) => x - x0 >= ox && x - x0 < ox + ow && z - z0 >= oz && z - z0 < oz + oh);
        const base = H + 0.14, pc = U.shade(b.siding, 0.9);
        for (let z = z0; z < z1; z++) {
          let run = -1;
          for (let x = x0; x <= x1; x++) {
            const hole = x === x1 || isOpen(x, z);
            if (!hole && run < 0) run = x;
            if (hole && run >= 0) {
              const ex0 = run === x0 ? -0.07 : 0, ex1 = x === x1 ? 0.07 : 0, ez0 = z === z0 ? -0.07 : 0, ez1 = z === z1 - 1 ? 0.07 : 0;
              m.box((run + x + ex0 + ex1) / 2, H + 0.07, z + 0.5 + (ez0 + ez1) / 2, x - run - ex0 + ex1 + 0.004, 0.14, 1.004 - ez0 + ez1, 0xe8e3d6);
              roofM.box((run + x) / 2, base + 0.02, z + 0.5, x - run + 0.004, 0.04, 1.004, b.roofColor);
              run = -1;
            }
          }
        }
        // pretil solo sobre lo techado
        for (let x = x0; x < x1; x++) {
          if (!isOpen(x, z0)) m.box(x + 0.5, base + 0.25, z0, 1.004, 0.5, 0.2, pc);
          if (!isOpen(x, z1 - 1)) m.box(x + 0.5, base + 0.25, z1, 1.004, 0.5, 0.2, pc);
        }
        for (let z = z0; z < z1; z++) {
          if (!isOpen(x0, z)) m.box(x0, base + 0.25, z + 0.5, 0.2, 0.5, 1.004, pc);
          if (!isOpen(x1 - 1, z)) m.box(x1, base + 0.25, z + 0.5, 0.2, 0.5, 1.004, pc);
        }
        // borde de la terraza hacia dentro: el pretil del tejado que sí está
        for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
          if (isOpen(x, z)) continue;
          if (z > z0 && isOpen(x, z - 1)) m.box(x + 0.5, base + 0.25, z, 1.004, 0.5, 0.2, pc);
          if (z < z1 - 1 && isOpen(x, z + 1)) m.box(x + 0.5, base + 0.25, z + 1, 1.004, 0.5, 0.2, pc);
        }
        m.oy = 0; roofM.oy = 0;
        continue;
      }
      // losa del techo (también es el cielorraso por dentro)
      m.box((x0 + x1) / 2, H + 0.07, (z0 + z1) / 2, b.w + 0.14, 0.14, b.h + 0.14, 0xe8e3d6);
      const base = H + 0.14;
      if (b.roof === 'flat') {
        roofM.box((x0 + x1) / 2, base + 0.02, (z0 + z1) / 2, b.w + 0.1, 0.04, b.h + 0.1, b.roofColor);
        const pc = U.shade(b.siding, 0.9);
        m.box((x0 + x1) / 2, base + 0.25, z0, b.w + 0.2, 0.5, 0.2, pc);
        m.box((x0 + x1) / 2, base + 0.25, z1, b.w + 0.2, 0.5, 0.2, pc);
        m.box(x0, base + 0.25, (z0 + z1) / 2, 0.2, 0.5, b.h, pc);
        m.box(x1, base + 0.25, (z0 + z1) / 2, 0.2, 0.5, b.h, pc);
        m.oy = 0; roofM.oy = 0;
        continue;
      }
      const ov = 0.4;
      const alongX = b.w >= b.h;
      const span = alongX ? b.h : b.w;
      const rh = span * 0.28 + 0.4;
      const col = b.roofColor;
      if (alongX) {
        const zc = (z0 + z1) / 2;
        const A = [x0 - ov, base - 0.15, z0 - ov], Bq = [x1 + ov, base - 0.15, z0 - ov];
        const C = [x1 + ov, base + rh, zc], D = [x0 - ov, base + rh, zc];
        roofM.quad(A, D, C, Bq, col);
        const A2 = [x0 - ov, base - 0.15, z1 + ov], B2 = [x1 + ov, base - 0.15, z1 + ov];
        roofM.quad(A2, B2, C, D, U.shade(col, 0.92));
        m.tri([x0, base, z0], [x0, base, z1], [x0, base + rh - 0.05, zc], b.siding);
        m.tri([x1, base, z1], [x1, base, z0], [x1, base + rh - 0.05, zc], b.siding);
      } else {
        const xc = (x0 + x1) / 2;
        const A = [x0 - ov, base - 0.15, z0 - ov], Bq = [x0 - ov, base - 0.15, z1 + ov];
        const C = [xc, base + rh, z1 + ov], D = [xc, base + rh, z0 - ov];
        roofM.quad(A, Bq, C, D, col);
        const A2 = [x1 + ov, base - 0.15, z0 - ov], B2 = [x1 + ov, base - 0.15, z1 + ov];
        roofM.quad(A2, D, C, B2, U.shade(col, 0.92));
        m.tri([x0, base, z1], [x1, base, z1], [xc, base + rh - 0.05, z1], b.siding);
        m.tri([x1, base, z0], [x0, base, z0], [xc, base + rh - 0.05, z0], b.siding);
      }
      // chimenea en algunas casas
      if (b.kind === 'casa' && Wd.hash(b.x0, b.z0, 5) < 0.5) {
        const cxp = x0 + b.w * 0.25, czp = z0 + b.h * 0.3;
        m.box(cxp, base + rh * 0.6, czp, 0.6, rh * 1.3 + 0.6, 0.6, 0x7d4b3a);
      }
      m.oy = 0; roofM.oy = 0;
    }
  }

  // ---------- Carteles con texto ----------
  const signCache = {};
  function signMaterial(text, bg, fg) {
    const key = text + bg + fg;
    if (signCache[key]) return signCache[key];
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const x = cv.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 512, 128);
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 6; x.strokeRect(8, 8, 496, 112);
    x.fillStyle = fg;
    x.font = 'bold 72px Arial, Helvetica, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const w = x.measureText(text).width;
    if (w > 470) x.font = 'bold ' + Math.floor(72 * 470 / w) + 'px Arial, Helvetica, sans-serif';
    x.fillText(text, 256, 68);
    // desgaste: manchas
    const rnd = U.mulberry32(text.length * 77);
    for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(40,30,20,' + (rnd() * 0.18) + ')'; x.fillRect(rnd() * 512, rnd() * 128, 4 + rnd() * 30, 2 + rnd() * 10); }
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    signCache[key] = mat;
    return mat;
  }
  const signGeo = () => R.signGeo || (R.signGeo = new THREE.PlaneGeometry(1, 1));

  // Datos del frente de un edificio: normal hacia la calle, centro del lado y puertas en ese lado
  function frontInfo(b) {
    const Wd = W(), E = Wd.E;
    const f = b.bp.front;
    const n = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }[f];
    const x0 = b.x0, z0 = b.z0, x1 = b.x0 + b.w, z1 = b.z0 + b.h;
    const doors = [];
    if (n[1]) {
      const zl = n[1] > 0 ? z1 : z0;
      for (let x = x0; x < x1; x++) { const e = Wd.eN(x, zl, 0); if (e === E.DOOR || e === E.DOOR_OPEN || e === E.DOOR_BROKEN) doors.push([x + 0.5, zl]); }
      return { n, cx: (x0 + x1) / 2, cz: zl, len: b.w, doors, alongX: true };
    }
    const xl = n[0] > 0 ? x1 : x0;
    for (let z = z0; z < z1; z++) { const e = Wd.eW(xl, z, 0); if (e === E.DOOR || e === E.DOOR_OPEN || e === E.DOOR_BROKEN) doors.push([xl, z + 0.5]); }
    return { n, cx: xl, cz: (z0 + z1) / 2, len: b.h, doors, alongX: false };
  }

  // Cartel plano en la fachada (px, pz sobre la pared; y altura del centro)
  function addSign(group, fi, px, py, pz, w, h, mat) {
    py += facadeBy;
    const mesh = new THREE.Mesh(signGeo(), mat);
    mesh.userData.shared = true;
    mesh.scale.set(w, h, 1);
    mesh.position.set(px + fi.n[0] * 0.13, py, pz + fi.n[1] * 0.13);
    mesh.rotation.y = Math.atan2(fi.n[0], fi.n[1]);
    group.add(mesh);
  }

  const SHOP_NAMES = [['MERCADO', '#2f6b3a'], ['ALMACÉN', '#8a3326'], ['AUTOSERVICIO', '#2c4f7a'], ['DESPENSA', '#7a5a22'], ['SUPERMERCADO', '#3a3a6a'], ['ULTRAMARINOS', '#6a2f4a']];

  // Casas viejas (mapas): el mismo abandono que los edificios del fondo. Por cada tramo de pared exterior:
  // manchas de humedad, pintura desconchada, moho en la base, enredaderas que trepan, tablas clavadas sobre
  // algunas ventanas (en la parte de arriba: se sigue pudiendo saltar por ellas) y tablones sueltos
  function buildWorn(c, b, m) {
    const Wd = W(), E = Wd.E, T = Wd.WALL_T / 2;
    const wildNow = G.Vegetation && G.Vegetation.mapInfo ? G.Vegetation.mapInfo().wild > 0 : false;
    const rnd = U.mulberry32((b.x0 * 73856093) ^ (b.z0 * 19349663));
    const floors = b.floors || 1, H1 = b.wallH || Wd.WALL_H;
    const sides = [];
    for (let x = b.x0; x < b.x0 + b.w; x++) { sides.push(['N', x, b.z0, -1]); sides.push(['N', x, b.z0 + b.h, 1]); }
    for (let z = b.z0; z < b.z0 + b.h; z++) { sides.push(['W', b.x0, z, -1]); sides.push(['W', b.x0 + b.w, z, 1]); }
    const by = b.baseY || 0;
    let k = 0;
    for (const [o, X, Z, sg] of sides) {
      for (let lv = 0; lv < floors; lv++) {
        const e = o === 'N' ? Wd.eN(X, Z, lv) : Wd.eW(X, Z, lv);
        if (!e || e === E.RAIL || e === E.FENCE) continue;
        const y0 = by + lv * Wd.FLOOR_H, off = T + 0.012 + (k++ % 5) * 0.006;
        // caja pegada a la cara de fuera: s (0..1 a lo largo), y, ancho, alto, grosor
        const put = (s, y, w, h, d, hex, extra) => {
          const ox = (extra || 0) + off;
          if (o === 'N') m.box(X + s, y0 + y, Z + sg * (ox + d / 2), w, h, d, hex);
          else m.box(X + sg * (ox + d / 2), y0 + y, Z + s, d, h, w, hex);
        };
        const sid = b.siding;
        const win = e === E.WIN || e === E.WIN_OPEN || e === E.WIN_BROKEN, door = e === E.ARCH || e === E.DOOR || e === E.DOOR_OPEN || e === E.NONE;
        if (!door && !win) {
          if (rnd() < 0.55) put(0.2 + rnd() * 0.6, 0.6 + rnd() * (H1 - 1.2), 0.3 + rnd() * 0.6, 0.4 + rnd() * 1.2, 0.006, U.shade(sid, 0.72 + rnd() * 0.12));   // humedad
          if (rnd() < 0.35) put(0.2 + rnd() * 0.6, 0.5 + rnd() * (H1 - 1), 0.2 + rnd() * 0.4, 0.15 + rnd() * 0.3, 0.008, 0xd8d4c8, 0.004);              // desconchón
          if (rnd() < 0.3) put(0.5, 1.0 + rnd() * (H1 - 1.6), 0.95, 0.12, 0.03, U.shade(sid, 0.6), 0.02);                                             // tablón suelto
        }
        if (lv === 0 && !door) put(0.5, 0.18, 1.0, 0.36, 0.01, U.pick(rnd, [0x4a5a32, 0x3e4a2c, 0x5a5a3e]), 0.01);                                     // moho en la base
        if (win && rnd() < 0.45) {
          // tablas en la parte de arriba de la ventana
          const n = 1 + Math.floor(rnd() * 2);
          for (let j = 0; j < n; j++) put(0.5, Wd.WIN_HI - 0.1 - j * 0.24, 1.1, 0.16, 0.03, U.shade(0x8a7050, 0.75 + rnd() * 0.3), 0.04 + j * 0.008);
        }
        if (!wildNow && rnd() < 0.12) {
          // enredadera
          const h = 1.2 + rnd() * (H1 * (floors - lv) - 1.2);
          put(0.3 + rnd() * 0.4, h / 2, 0.5 + rnd() * 0.5, h, 0.05, U.pick(rnd, [0x3e5a2a, 0x4a6a32, 0x52703a]), 0.05);
        }
      }
    }
  }
  // Hiedra (mapas con naturaleza, «wild»): trepa por las paredes desde el suelo en manchas (hasta media pared o
  // hasta el tejado), se queda bajo las ventanas y cuelga del borde del tejado. Nunca tapa puertas ni ventanas.
  // Se pinta en la pared (detIvy: ver DET) y lleva unas pocas matas de hojas en 3D (lm: la malla sin sombra del trozo)
  const IVY_COL = [0x2c4520, 0x36522a, 0x3f5e2c, 0x2a3e1e, 0x47672f];
  // un triángulo con la cara hacia fuera (nx, nz)
  function ivyTri(lm, a, b, c, nx, nz, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cz = ux * vy - uy * vx;
    if (cx * nx + cz * nz < 0) lm.tri(a, c, b, col); else lm.tri(a, b, c, col);
  }
  // una mata de hojas: pirámide baja de cinco caras sobre la pared (P: centro; t: a lo largo; n: hacia fuera;
  // r: radio; d: cuánto sale; h: azar 0..1)
  function ivyClump(lm, px, py, pz, tx, tz, nx, nz, r, d, h) {
    const pts = [];
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2 + h * 6.28, rr = r * (0.75 + 0.5 * ((h * (k + 3) * 7.13) % 1));
      const ca = Math.cos(a) * rr, sa = Math.sin(a) * rr * 0.85;
      pts.push([px + tx * ca, py + sa, pz + tz * ca]);
    }
    const ap = [px + nx * d, py - r * 0.18, pz + nz * d];
    const c0 = Math.floor(h * 50);
    for (let k = 0; k < 5; k++) ivyTri(lm, pts[k], pts[(k + 1) % 5], ap, nx, nz, IVY_COL[(k + c0) % IVY_COL.length]);
  }
  function buildIvy(c, b, lm, wild) {
    const Wd = W(), E = Wd.E, T = Wd.WALL_T / 2;
    const floors = b.floors || 1, H1 = b.wallH || Wd.WALL_H, by = b.baseY || 0, FH = Wd.FLOOR_H;
    const topH = (floors - 1) * FH + H1, ruin = b.roof === 'none';
    const isWin = (e) => e === E.WIN || e === E.WIN_OPEN || e === E.WIN_BROKEN;
    const isHole = (e) => e === E.ARCH || e === E.DOOR || e === E.DOOR_OPEN || e === E.DOOR_BROKEN || e === E.NONE || e === E.GATE;
    const sides = [];
    for (let x = b.x0; x < b.x0 + b.w; x++) { sides.push(['N', x, b.z0, -1]); sides.push(['N', x, b.z0 + b.h, 1]); }
    for (let z = b.z0; z < b.z0 + b.h; z++) { sides.push(['W', b.x0, z, -1]); sides.push(['W', b.x0 + b.w, z, 1]); }
    for (const [o, X, Z, sg] of sides) {
      const e0 = o === 'N' ? Wd.eN(X, Z, 0) : Wd.eW(X, Z, 0);
      if (!e0 || e0 === E.RAIL || e0 === E.FENCE) continue;
      const eUp = floors > 1 ? (o === 'N' ? Wd.eN(X, Z, 1) : Wd.eW(X, Z, 1)) : 0;
      // (¿hay pared arriba? En las terrazas y balcones no: ahí la hiedra llega solo hasta el forjado)
      const wallUp = floors > 1 && eUp && eUp !== E.RAIL && eUp !== E.FENCE;
      const eTop = wallUp ? eUp : e0, topEff = floors > 1 && !wallUp ? FH : topH;
      const n = Wd.vnoise(X / 3.4 + (o === 'N' ? 0 : 50), Z / 3.4, 501), h = Wd.hash(X, Z, 502 + (o === 'N' ? 0 : 7)), h2 = Wd.hash(X, Z, 503 + (o === 'N' ? 0 : 7));
      const side = sg < 0 ? 1 : 2;
      // la cara de la pared: a lo largo (t) y hacia fuera (n)
      const tx = o === 'N' ? 1 : 0, tz = o === 'N' ? 0 : 1, nx = o === 'N' ? 0 : sg, nz = o === 'N' ? sg : 0;
      const at = (s, off) => (o === 'N' ? [X + s, Z + sg * off] : [X + sg * off, Z + s]);
      // trepando desde el suelo (la altura, la media de dos mitades: el borde de arriba lo quiebra el sombreador)
      if (!isHole(e0) && n < wild * 0.62) {
        let tops = 0;
        for (let k = 0; k < 2; k++) {
          const along = (o === 'N' ? X : Z) + 0.25 + k * 0.5, hk = Wd.vnoise(along / 1.7, (o === 'N' ? Z : X) * 0.37, 505);
          const edge = Math.min(1, (wild * 0.62 - n) / 0.12);                   // (al borde de la mancha, más baja)
          let top = isWin(e0) ? Wd.WIN_LO - 0.06 : Math.min(topH, 0.6 + (topH - 0.6) * (0.15 + 0.85 * (h * 0.4 + hk * 0.6)) * Math.min(1, wild * 1.35) * (0.35 + 0.65 * edge));
          if (!isWin(e0) && floors > 1 && top > FH && !wallUp) top = Math.min(top, FH - 0.04);
          else if (!isWin(e0) && floors > 1 && top > FH && (isWin(eTop) || isHole(eTop))) top = Math.min(top, FH + (isWin(eTop) ? Wd.WIN_LO - 0.06 : 0));
          tops += top / 2;
        }
        if (tops > 0.3) {
          detIvy(o, X, Z, 0, by + tops, side);
          // matas en 3D: una a tres, más abajo que arriba (donde la hiedra es más tupida)
          if (lm) {
            const nC = 1 + Math.floor(h2 * 2.99 * Math.min(1, tops / 1.6));
            for (let k = 0; k < nC; k++) {
              const r1 = Wd.hash(X, Z, 540 + k + (o === 'N' ? 0 : 20)), r2 = Wd.hash(X, Z, 550 + k + (o === 'N' ? 0 : 20));
              // (en la parte tupida: los zarcillos de arriba son finos y una mata ahí quedaría suelta)
              const p = at(0.12 + r1 * 0.76, T + 0.004), y = by + 0.1 + Math.max(0.06, tops - 1.6) * Math.pow(r2, 1.4);
              ivyClump(lm, p[0], y, p[1], tx, tz, nx, nz, 0.06 + r2 * 0.04, 0.03 + r1 * 0.025, (r1 * 7.3 + r2) % 1);
            }
          }
        }
      }
      // colgando del tejado (por encima de las ventanas de arriba)
      if (!ruin && h2 < wild * 0.42 && Wd.vnoise(X / 2.6, Z / 2.6 + 30, 504) < 0.6) {
        let L = 0.55 + h * 1.5;
        const lvTop = topEff === topH ? floors - 1 : 0;
        if (isWin(eTop) || isHole(eTop)) L = Math.min(L, topEff - (lvTop * FH + (isWin(eTop) ? Wd.WIN_HI : Wd.DOOR_H)) - 0.06);
        if (L > 0.3) {
          detIvy(o, X, Z, 1, by + topEff - L, side);
          if (lm && h > 0.35) {
            const p = at(0.2 + h2 * 0.6, T + 0.004);
            ivyClump(lm, p[0], by + topEff - 0.15 - L * 0.3 * h, p[1], tx, tz, nx, nz, 0.07 + h * 0.03, 0.04, (h * 3.7) % 1);
          }
        }
      }
    }
  }
  // Vallas (de madera o de alambre, también la del borde del mapa): la hiedra y la maleza las van cubriendo a
  // tramos, por los dos lados. Una lámina oscura de follaje (sin textura ni transparencia: en la malla sin sombra del
  // trozo) con el borde de arriba quebrado, la hiedra pintada encima y alguna mata en 3D
  function fenceIvy(c, lm, wild) {
    const Wd = W(), E = Wd.E, CS = Wd.CS, ox = c.cx * CS, oz = c.cz * CS;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const i = z * CS + x, X = ox + x, Z = oz + z;
      for (const o of ['N', 'W']) {
        if ((o === 'N' ? c.eN[i] : c.eW[i]) !== E.FENCE) continue;
        const n = Wd.vnoise(X / 4 + (o === 'N' ? 0 : 30), Z / 4, 530);
        if (n > wild * 0.7) continue;
        const ty = Wd.terrainAt(X + (o === 'N' ? 0.5 : 0), Z + (o === 'N' ? 0 : 0.5));
        const h = 0.5 + (Wd.FENCE_H + 0.25 - 0.5) * Math.min(1, (wild * 0.7 - n) / 0.25) * (0.6 + 0.4 * Wd.hash(X, Z, 531 + (o === 'N' ? 0 : 1)));
        detIvy(o, X, Z, 0, ty + h, 3);
        if (!lm) continue;
        const tops = [];
        for (let k = 0; k <= 4; k++) tops.push(ty + h * (0.8 + 0.2 * Wd.hash(X * 5 + k, Z, 533 + (o === 'N' ? 0 : 1))));
        for (const sg of [-1, 1]) {
          const nx = o === 'N' ? 0 : sg, nz = o === 'N' ? sg : 0, off = 0.035;
          const P = (s, y) => (o === 'N' ? [X + s, y, Z + sg * off] : [X + sg * off, y, Z + s]);
          for (let k = 0; k < 4; k++) {
            const s0 = -0.04 + k * 0.27, s1 = s0 + 0.27, col = k % 2 ? 0x22341a : 0x27391d;
            ivyTri(lm, P(s0, ty - 0.05), P(s1, ty - 0.05), P(s1, tops[k + 1]), nx, nz, col);
            ivyTri(lm, P(s0, ty - 0.05), P(s1, tops[k + 1]), P(s0, tops[k]), nx, nz, col);
          }
          const r1 = Wd.hash(X, Z, 560 + sg + (o === 'N' ? 0 : 5)), r2 = Wd.hash(X, Z, 570 + sg + (o === 'N' ? 0 : 5));
          if (r1 < 0.75) {
            const p = P(0.15 + r2 * 0.7, ty + h * (0.2 + 0.4 * r1));
            ivyClump(lm, p[0], p[1], p[2], o === 'N' ? 1 : 0, o === 'N' ? 0 : 1, nx, nz, 0.07 + r2 * 0.04, 0.04 + r1 * 0.02, (r1 * 5.1 + r2) % 1);
          }
        }
      }
    }
  }
  // La que trepa por una farola: un manguito de follaje de caras irregulares (cada una de un verde) y unas matas
  function lampIvy(lm, X, Z, ty, hh, h) {
    const S = 6, nY = Math.max(2, Math.round(hh / 0.45));
    const fr = (v) => { const x = Math.sin(v) * 43758.5453; return x - Math.floor(x); };
    const ring = [];
    for (let j = 0; j <= nY; j++) {
      const y = ty - 0.03 + (hh + 0.03) * j / nY, row = [];
      for (let k = 0; k < S; k++) {
        const a = (k + 0.5 * (j % 2)) / S * Math.PI * 2 + h * 6.28;
        const rr = j === nY ? 0.05 : 0.095 + 0.035 * fr(h * 91 + j * 7.1 + k * 3.3);
        const dy = j && j < nY ? (fr(h * 37 + j * 2.9 + k * 5.7) - 0.5) * 0.14 : 0;
        row.push([X + Math.sin(a) * rr, y + dy, Z + Math.cos(a) * rr]);
      }
      ring.push(row);
    }
    const c0 = Math.floor(h * 50);
    for (let j = 0; j < nY; j++) for (let k = 0; k < S; k++) {
      const A = ring[j][k], B = ring[j][(k + 1) % S], C = ring[j + 1][(k + 1) % S], D = ring[j + 1][k];
      const mx = (A[0] + B[0] + C[0] + D[0]) / 4 - X, mz = (A[2] + B[2] + C[2] + D[2]) / 4 - Z, ml = Math.hypot(mx, mz) || 1;
      ivyTri(lm, A, B, C, mx / ml, mz / ml, IVY_COL[(k * 3 + j * 7 + c0) % IVY_COL.length]);
      ivyTri(lm, A, C, D, mx / ml, mz / ml, IVY_COL[(k * 3 + j * 7 + c0 + 2) % IVY_COL.length]);
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4 + h) * Math.PI * 2, nx = Math.sin(a), nz = Math.cos(a);
      const y = ty + 0.3 + (hh - 0.5) * ((h * (k + 2) * 3.7) % 1);
      ivyClump(lm, X + nx * 0.11, y, Z + nz * 0.11, nz, -nx, nx, nz, 0.065, 0.045, (h * (k + 1) * 2.3) % 1);
    }
  }


  function buildFacade(c, b, m, group) {
    if (b.worn) buildWorn(c, b, m);
    const kind = b.kind;
    if (!b.bp || !b.bp.front || (kind !== 'tienda' && kind !== 'bomberos' && kind !== 'policia' && kind !== 'hospital')) return;
    m.oy = b.baseY || 0;
    facadeBy = b.baseY || 0;
    buildFacade2(c, b, m, group);
    m.oy = 0; facadeBy = 0;
  }
  let facadeBy = 0;
  function buildFacade2(c, b, m, group) {
    const Wd = W();
    const kind = b.kind;
    const fi = frontInfo(b);
    const H = b.wallH || Wd.WALL_H;
    // caja a lo largo de la fachada: a = desplazamiento a lo largo, o = hacia fuera, y = altura
    const fbox = (a, y, o, w, h, d, hex) => {
      if (fi.alongX) m.box(fi.cx + a, y, fi.cz + fi.n[1] * o, w, h, d, hex);
      else m.box(fi.cx + fi.n[0] * o, y, fi.cz + a, d, h, w, hex);
    };
    const at = (a) => fi.alongX ? [fi.cx + a, fi.cz] : [fi.cx, fi.cz + a];
    if (kind === 'tienda') {
      const h = Wd.hash(b.x0, b.z0, 91);
      const [name, bg] = b.sign || SHOP_NAMES[Math.floor(h * SHOP_NAMES.length)];        // (b.sign: el nombre que le pone el mapa)
      const p = at(0);
      fbox(0, H + 0.45, 0.07, Math.min(6, fi.len - 1), 0.85, 0.08, 0x2a2a2a);
      addSign(group, fi, p[0], H + 0.45, p[1], Math.min(5.8, fi.len - 1.2), 0.75, signMaterial(name, bg, '#f2ecd8'));
      // toldo a rayas sobre el escaparate
      const cols = [Wd.hash(b.x0, b.z0, 92) < 0.5 ? 0xb8402e : 0x2f6b4a, 0xe8e0cc];
      const L = fi.len - 1;
      const nS = Math.round(L / 0.5);
      for (let k = 0; k < nS; k++) {
        const a = -L / 2 + (k + 0.5) * L / nS;
        const col = cols[k % 2];
        if (fi.alongX) m.box(fi.cx + a, 2.32, fi.cz + fi.n[1] * 0.55, L / nS + 0.005, 0.04, 1.05, col, 0, 0, fi.n[1] * 0.32, 0);
        else m.box(fi.cx + fi.n[0] * 0.55, 2.32, fi.cz + a, 1.05, 0.04, L / nS + 0.005, col, 0, 0, 0, -fi.n[0] * 0.32);
      }
      return;
    }
    if (kind === 'bomberos') {
      const p = at(0);
      addSign(group, fi, p[0], H + 0.45, p[1], 4.6, 0.8, signMaterial('BOMBEROS', '#a3241c', '#f6eedc'));
      // franjas blancas sobre los portones
      fbox(0, 2.62, 0.08, fi.len, 0.06, 0.04, 0xf0e8d8);
      fbox(0, 2.72, 0.08, fi.len, 0.06, 0.04, 0xf0e8d8);
      // torre de mangueras en una esquina trasera
      const tx = b.x0 + (fi.n[0] > 0 ? 1.4 : (fi.n[0] < 0 ? b.w - 1.4 : b.w - 1.4));
      const tz = b.z0 + (fi.n[1] > 0 ? 1.4 : (fi.n[1] < 0 ? b.h - 1.4 : 1.4));
      m.box(tx, H + 2.4, tz, 2.4, 4.8, 2.4, 0x9b4a3c);
      m.box(tx, H + 4.9, tz, 2.7, 0.25, 2.7, 0x6e3329);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m.box(tx + dx * 1.21, H + 3.6, tz + dz * 1.21, dz ? 0.6 : 0.03, 0.9, dx ? 0.6 : 0.03, 0x2c3a44);
      return;
    }
    if (kind === 'policia') {
      const d = fi.doors[0] || at(0);
      addSign(group, fi, fi.alongX ? fi.cx : d[0], H + 0.45, fi.alongX ? d[1] : fi.cz, 4.2, 0.8, signMaterial('POLICÍA', '#1f3a6e', '#f2f2f2'));
      // franja azul y blanca en la fachada
      fbox(0, 2.3, 0.08, fi.len, 0.22, 0.04, 0x2a4a86);
      fbox(0, 2.47, 0.08, fi.len, 0.08, 0.04, 0xeeeeee);
      // mástil con bandera junto a la entrada
      const s = fi.doors[0] ? fi.doors[0] : at(0);
      const fx = s[0] + fi.n[0] * 1.6 + (fi.alongX ? 1.6 : 0), fz = s[1] + fi.n[1] * 1.6 + (fi.alongX ? 0 : 1.6);
      m.cyl(fx, 3.2, fz, 0.05, 0.04, 6.4, 0xb8b8b0, 8);
      m.box(fx + (fi.alongX ? 0.55 : 0), 5.9, fz + (fi.alongX ? 0 : 0.55), fi.alongX ? 1.0 : 0.02, 0.65, fi.alongX ? 0.02 : 1.0, 0x3a5a9a);
      return;
    }
    if (kind === 'hospital') {
      const d = fi.doors[0] || at(0);
      addSign(group, fi, fi.alongX ? fi.cx : d[0], H + 0.45, fi.alongX ? d[1] : fi.cz, 4.4, 0.8, signMaterial('HOSPITAL', '#f2f2ee', '#b8261e'));
      // marquesina sobre la entrada
      const ox = d[0] + fi.n[0] * 1.0, oz = d[1] + fi.n[1] * 1.0;
      m.box(ox, 2.55, oz, fi.alongX ? 3.2 : 2.0, 0.14, fi.alongX ? 2.0 : 3.2, 0xdedcd4);
      for (const s of [-1.4, 1.4]) m.cyl(ox + fi.n[0] * 0.8 + (fi.alongX ? s : 0), 1.28, oz + fi.n[1] * 0.8 + (fi.alongX ? 0 : s), 0.06, 0.06, 2.5, 0xbab8b0, 8);
      // gran cruz roja en el tejado
      const cx = b.x0 + b.w / 2, cz = b.z0 + b.h / 2;
      if (fi.alongX) { m.box(cx, H + 1.6, cz, 1.8, 0.5, 0.15, 0xc23b2b); m.box(cx, H + 1.6, cz, 0.5, 1.8, 0.15, 0xc23b2b); }
      else { m.box(cx, H + 1.6, cz, 0.15, 0.5, 1.8, 0xc23b2b); m.box(cx, H + 1.6, cz, 0.15, 1.8, 0.5, 0xc23b2b); }
      m.box(cx, H + 0.6, cz, 0.12, 0.9, 0.12, 0x8a8a84);
    }
  }

  // ---------- Construcción de un chunk ----------
  // Por etapas (generador): el mundo construye un trozo cada fotograma sin pasarse de unos
  // milisegundos, así cargar una zona nueva no da tirones. build(c) lo hace todo de golpe.
  function build(c) {
    const it = buildSteps(c);
    while (!it.next().done) { /* todo de una vez */ }
  }

  function* buildSteps(c) {
    const Wd = W();
    const O = Wd.O, CS = Wd.CS;
    const group = new THREE.Group();
    const view = { group, brk: new Map(), fbrk: new Map(), doors: [], windows: [], doorMesh: null, glassMesh: null, fixtures: null, fixtureRooms: [], items: new Map(), interiors: [], veg: null, inst: [],
      box: new THREE.Box3(new THREE.Vector3(c.cx * CS, -15, c.cz * CS), new THREE.Vector3(c.cx * CS + CS, 28, c.cz * CS + CS)) };

    detBegin(c);                    // (lo pintado de este trozo: hiedra, hojas caídas y musgo; ver DET)
    yield* buildGround(c, group);
    yield;

    const m = new G.Mesher();
    const roofM = new G.Mesher();
    // interior de cada edificio (tabiques, escalera y muebles): una malla por edificio, sin sombra
    const inMap = new Map();
    const inner = (b) => {
      let im = inMap.get(b);
      if (!im) { im = new G.Mesher(); inMap.set(b, im); }
      return im;
    };
    yield* buildEdges(c, m, view, 0, inner);
    yield;
    if (c.up) yield* buildEdges(c, m, view, 1, inner);
    if (c.stairs.length) buildStairs(c, m, inner);
    buildRoofs(c, m, roofM);
    yield;
    // muebles (al interior de su edificio) y vehículos (fuera, con sombra)
    let n = 0;
    // lo que casi no se ve o no hace falta mirar (charcos, decorados planos, cosas bajas, las pilas de fuera del
    // mapa): sin sombra, que es lo que más cuesta
    const quietM = new G.Mesher();
    // lo más chico y fino (las plantas de los alféizares, los hierbajos de las cornisas, los aires, los alféizares de
    // las fachadas simples...): otra malla sin sombra que se esconde de lejos (ver update: fineFar)
    const fineM = new G.Mesher();
    m.fine = fineM; quietM.fine = fineM;
    // y lo mediano (las escaleras de incendios, los balcones y las enredaderas de las fachadas simples): se ve más
    // lejos, pero no hasta el fondo (donde la niebla ya lo tapa todo)
    const midM = new G.Mesher();
    m.mid = midM; quietM.mid = midM;
    for (const f of c.furn) {
      const ft = G.Furniture.T[f.type];
      let tgt = (ft.noShadow || ft.flat || f.lod || (ft.h < 0.5 && !ft.vehicle)) ? quietM : m, fb = null;
      if (!ft.vehicle) {
        const fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2;
        for (const b of c.buildings) {
          if (fx >= b.x0 && fz >= b.z0 && fx < b.x0 + b.w && fz < b.z0 + b.h) { tgt = inner(b); fb = b; break; }
        }
      }
      if (f.gone || f.calmBlock) continue;          // (los estorbos invisibles de las paradas: no se dibujan)
      const fst = tgt.count;
      G.Furniture.draw(tgt, f);
      // máquinas del salón (jefe final): se apuntan sus vértices para hacerlas desaparecer al destrozarlas
      if (ft.smash && fb) view.fbrk.set(f, { b: fb, st: fst, en: tgt.count });
      if (++n % 60 === 0) yield;
    }
    yield;
    // fachadas especiales: carteles, toldos, torre de bomberos, bandera, marquesina
    for (const b of c.buildings) buildFacade(c, b, m, group);
    // hiedra: por las casas, las vallas y las farolas
    const wildMI = G.Vegetation && G.Vegetation.mapInfo ? G.Vegetation.mapInfo() : { wild: 0 };
    // (pintada en las paredes y en las vallas; las matas en 3D, en la malla sin sombra)
    const iv = wildMI.wild > 0;
    const qOy = quietM.oy;
    quietM.oy = 0;
    if (iv) {
      for (const b of c.buildings) buildIvy(c, b, quietM, wildMI.wild);
      fenceIvy(c, quietM, wildMI.wild);
    }

    // Farolas, arbustos y árboles
    const ox = c.cx * CS, oz = c.cz * CS;
    const trees = [], pines = [], bushes = [], heads = [];
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const o = c.obj[z * CS + x];
        if (!o) continue;
        const X = ox + x + 0.5, Z = oz + z + 0.5;
        if (o === O.LAMP) {
          let dx = 0, dz = 0;
          if (Wd.ground(ox + x, oz + z + 1) === Wd.F.ROAD) dz = 1;
          else if (Wd.ground(ox + x, oz + z - 1) === Wd.F.ROAD) dz = -1;
          else if (Wd.ground(ox + x + 1, oz + z) === Wd.F.ROAD) dx = 1;
          else dx = -1;
          const ty = Wd.terrainAt(X, Z);
          m.oy = ty;
          m.cyl(X, 2.3, Z, 0.08, 0.05, 4.6, 0x3e4245, 7);
          m.box(X + dx * 0.45, 4.55, Z + dz * 0.45, dx ? 0.9 : 0.06, 0.06, dz ? 0.9 : 0.06, 0x3e4245);
          m.oy = 0;
          heads.push([X + dx * 0.85, 4.5 + ty, Z + dz * 0.85, dx !== 0]);
          // hiedra trepando por la farola
          if (iv && Wd.hash(ox + x, oz + z, 520) < 0.7 * wildMI.wild) {
            const hh = 1.4 + Wd.hash(ox + x, oz + z, 521) * 2.6;
            lampIvy(quietM, X, Z, ty, hh, Wd.hash(ox + x, oz + z, 522));
          }
        } else if (o === O.BUSH) bushes.push([X, Z]);
        else if (o === O.TREE) trees.push([X, Z]);
        else if (o === O.PINE) pines.push([X, Z]);
      }
    }
    yield;

    quietM.oy = qOy;

    const staticMesh = new THREE.Mesh(m.build(), R.static);
    staticMesh.castShadow = true;
    staticMesh.receiveShadow = true;
    group.add(staticMesh);
    if (quietM.count) {
      const qm = new THREE.Mesh(quietM.build(), R.static);
      qm.castShadow = false; qm.receiveShadow = true;
      group.add(qm);
    }
    if (fineM.count) {
      const fm = new THREE.Mesh(fineM.build(), R.static);
      fm.castShadow = false; fm.receiveShadow = true;
      group.add(fm);
      view.fine = fm;
    }
    if (midM.count) {
      const dm = new THREE.Mesh(midM.build(), R.static);
      dm.castShadow = false; dm.receiveShadow = true;
      group.add(dm);
      view.mid = dm;
    }
    if (roofM.count) {
      const roofMesh = new THREE.Mesh(roofM.build(), R.roof);
      roofMesh.castShadow = true;
      roofMesh.receiveShadow = true;
      group.add(roofMesh);
    }
    yield;
    for (const [b, im] of inMap) {
      if (!im.count) continue;
      const mesh = new THREE.Mesh(im.build(), R.inner);
      mesh.castShadow = false;          // los muebles y tabiques no proyectan sombra (mucho más barato)
      mesh.receiveShadow = true;
      group.add(mesh);
      view.interiors.push({ b, mesh });
    }
    for (const r of view.brk.values()) { const it = view.interiors.find((q) => q.b === r.b); r.mesh = it ? it.mesh : null; }
    for (const r of view.fbrk.values()) { const it = view.interiors.find((q) => q.b === r.b); r.mesh = it ? it.mesh : null; }
    yield;

    // Árboles, pinos, arbustos y hierba alta
    const pp = G.debug && G.debug.player ? G.debug.player.pos : { x: ox, z: oz };
    view.veg = G.Vegetation.build(c, group, trees, pines, bushes, pp.x, pp.z);
    yield;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    // Cabezas de farola (siempre algo encendidas)
    if (heads.length) {
      const hm = new THREE.InstancedMesh(R.lampHeadGeo, R.fixture, heads.length);
      heads.forEach((h, i) => {
        dummy.position.set(h[0], h[1], h[2]); dummy.rotation.set(0, h[3] ? 0 : Math.PI / 2, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); hm.setMatrixAt(i, dummy.matrix);
        hm.setColorAt(i, color.setHex(0xffe2a8));
      });
      hm.frustumCulled = false;
      group.add(hm); view.inst.push(hm);
    }

    // Puertas
    if (view.doors.length) {
      const dm = new THREE.InstancedMesh(R.doorGeo, R.inner, view.doors.length);
      view.doors.forEach((d, i) => dm.setMatrixAt(i, doorMatrix(d)));
      dm.castShadow = true; dm.receiveShadow = true; dm.frustumCulled = false;
      view.doorMesh = dm;
      group.add(dm); view.inst.push(dm);
    }
    // Vidrios
    if (view.windows.length) {
      const gm = new THREE.InstancedMesh(R.glassGeo, R.glass, view.windows.length);
      view.windows.forEach((w, i) => gm.setMatrixAt(i, windowMatrix(w, Wd.edgeGet(w))));
      gm.frustumCulled = false;
      gm.renderOrder = 2;
      view.glassMesh = gm;
      group.add(gm); view.inst.push(gm);
    }
    // Lámparas del techo
    const rooms = [];
    for (const b of c.buildings) for (const r of b.rooms) rooms.push(r);
    if (rooms.length) {
      const fm = new THREE.InstancedMesh(R.fixtureGeo, R.fixture, rooms.length);
      rooms.forEach((r, i) => {
        dummy.position.set(r.light.x, r.light.y + 0.115, r.light.z);
        dummy.rotation.set(Math.PI, 0, 0); dummy.scale.set(1, 0.45, 1);
        if (r.noLamp) dummy.scale.set(0, 0, 0);          // (al aire: sin lámpara)
        dummy.updateMatrix(); fm.setMatrixAt(i, dummy.matrix);
        fm.setColorAt(i, fixtureColor(r));
      });
      fm.frustumCulled = false;
      view.fixtures = fm;
      view.fixtureRooms = rooms;
      group.add(fm); view.inst.push(fm);
    }

    // Listo: a partir de aquí el chunk ya tiene vista (puertas, objetos, luces)
    c.view = view;
    for (const it of c.items) itemAdded(c, it);
    updateInteriors(c, pp.x, pp.z);
    group.userData.shStatic = true;          // (su sombra va en la capa fija: ver shadowcache.js)
    scene.add(group);
    shDirty();
  }
  function shDirty() { if (G.ShadowCache) G.ShadowCache.dirty(); }

  // Muebles y tabiques: solo si estás dentro del edificio o a pocos metros
  function updateInteriors(c, px, pz) {
    const v = c.view;
    if (!v || !v.interiors.length) return;
    const lim = G.Quality ? G.Quality.cur.interior : 18;
    for (const it of v.interiors) {
      const b = it.b;
      const dx = Math.max(b.x0 - px, 0, px - (b.x0 + b.w)), dz = Math.max(b.z0 - pz, 0, pz - (b.z0 + b.h));
      const vis = dx * dx + dz * dz < lim * lim;
      if (it.mesh.visible !== vis) it.mesh.visible = vis;
    }
  }

  function fixtureColor(r) {
    return new THREE.Color(r.on ? 0xfff3d6 : 0x77746c);
  }

  function dispose(c) {
    const v = c.view;
    if (!v) return;
    scene.remove(v.group);
    shDirty();
    v.group.traverse((o) => {
      if (o.isInstancedMesh) { o.dispose && o.dispose(); if (o.userData.ownGeo) o.geometry.dispose(); return; }
      if (o.isMesh && o.geometry && !o.userData.shared) o.geometry.dispose();
    });
    c.view = null;
  }

  // ---------- Cambios ----------
  // pared derribada: sus vértices se juntan en un punto (desaparece) sin reconstruir el trozo. false si no se pudo
  function hideEdge(c, ref) {
    const v = c.view;
    if (!v || !v.brk) return false;
    const key = W().edgeKey(ref), r = v.brk.get(key);
    if (!r || !r.mesh) return false;
    const pa = r.mesh.geometry.attributes.position, a = pa.array;
    const x = a[r.st * 3], y = a[r.st * 3 + 1], z = a[r.st * 3 + 2];
    for (let i = r.st; i < r.en; i++) { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; }
    pa.needsUpdate = true;
    v.brk.delete(key);
    // si era una puerta, la hoja desaparece con el marco
    const d = v.doors.find((q) => q.o === ref.o && q.x === ref.x && q.z === ref.z && !q.lv);
    if (d && v.doorMesh) { d.gone = true; v.doorMesh.setMatrixAt(v.doors.indexOf(d), doorMatrix(d)); v.doorMesh.instanceMatrix.needsUpdate = true; }
    return true;
  }
  // un mueble destrozado: sus vértices se juntan en un punto (sin volver a construir el trozo)
  function hideFurn(c, f) {
    const v = c.view;
    const r = v && v.fbrk && v.fbrk.get(f);
    if (!r || !r.mesh) return false;
    const pa = r.mesh.geometry.attributes.position, a = pa.array;
    const x = a[r.st * 3], y = a[r.st * 3 + 1], z = a[r.st * 3 + 2];
    for (let i = r.st; i < r.en; i++) { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; }
    pa.needsUpdate = true;
    v.fbrk.delete(f);
    return true;
  }
  function edgeChanged(c, ref, old, v) {
    const view = c.view;
    const E = W().E;
    const lv = ref.lv || 0;
    const d = view.doors.find((q) => q.o === ref.o && q.x === ref.x && q.z === ref.z && q.lv === lv);
    if (d) {
      d.broken = v === E.DOOR_BROKEN;
      d.target = v === E.DOOR_OPEN ? 1 : 0;
      if (d.broken) d.open = 0;
      if (animDoors.indexOf(d) < 0) { d.chunk = c; animDoors.push(d); }
      view.doorMesh.setMatrixAt(view.doors.indexOf(d), doorMatrix(d));
      view.doorMesh.instanceMatrix.needsUpdate = true;
    }
    const wi = view.windows.findIndex((q) => q.o === ref.o && q.x === ref.x && q.z === ref.z && (q.lv || 0) === lv);
    if (wi >= 0) {
      view.glassMesh.setMatrixAt(wi, windowMatrix(view.windows[wi], v));
      view.glassMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function lightChanged(c, room) {
    const v = c.view;
    const i = v.fixtureRooms.indexOf(room);
    if (i >= 0) {
      v.fixtures.setColorAt(i, fixtureColor(room));
      v.fixtures.instanceColor.needsUpdate = true;
    }
    lightTimer = 0;
  }

  function itemAdded(c, it) {
    const v = c.view;
    if (!v) return;
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(G.Models.weaponGeometry(it.id), R.item);
    mesh.userData.shared = true;
    if (it.pile) {
      // montón de cosas (armas cortas, cuerpo a cuerpo, munición): un hatillo genérico (sin sombra: casi no se nota)
      mesh.castShadow = false;
      g.add(mesh);
      g.position.set(it.x, W().groundY(it.x, it.z, it.lv) + 0.01, it.z);
      g.rotation.y = it.rot;
      v.group.add(g);
      v.items.set(it, g);
      return;
    }
    // las armas de fuego quedan tumbadas de lado (la empuñadura no se clava en el suelo)
    const gun = G.Weapons.isGun(G.Weapons.get(it.id));
    mesh.rotation.set(Math.PI / 2, gun ? Math.PI / 2 : 0, 0);
    mesh.castShadow = false;
    g.add(mesh);
    const ring = new THREE.Mesh(R.ringGeo, R.itemRing);
    ring.userData.shared = true;
    ring.position.set(0, 0.012, 0);
    g.add(ring);
    g.position.set(it.x, W().groundY(it.x, it.z, it.lv) + 0.035, it.z);
    g.rotation.y = it.rot;
    // centrar el arma sobre el anillo
    const len = G.Weapons.itemLen(it.id);
    mesh.position.set(0, 0.02, -len / 2);
    v.group.add(g);
    v.items.set(it, g);
  }

  function itemRemoved(c, it) {
    const v = c.view;
    const g = v && v.items.get(it);
    if (!g) return;
    v.group.remove(g);
    v.items.delete(it);
  }

  // Punto donde está el interruptor de una habitación
  function switchPoint(r) {
    const s = r.sw;
    const off = W().WALL_T / 2 + 0.013;
    if (s.dir === 'N') return { o: 'N', x: s.x + 0.5, z: s.z + off, nx: 0, nz: 1 };
    if (s.dir === 'S') return { o: 'N', x: s.x + 0.5, z: s.z + 1 - off, nx: 0, nz: -1 };
    if (s.dir === 'W') return { o: 'W', x: s.x + off, z: s.z + 0.5, nx: 1, nz: 0 };
    return { o: 'W', x: s.x + 1 - off, z: s.z + 0.5, nx: -1, nz: 0 };
  }

  // ---------- Actualización por fotograma ----------
  const cand = [];
  function update(dt, px, pz, chunks) {
    // la intemperie: según el mapa
    WTH.uWild.value = G.Vegetation && G.Vegetation.mapInfo ? G.Vegetation.mapInfo().wild : 0;
    DET.u.uDetOn.value = WTH.uWild.value > 0 ? 1 : 0;
    detFlush();
    // Animación de puertas
    for (let i = animDoors.length - 1; i >= 0; i--) {
      const d = animDoors[i];
      const v = d.chunk.view;
      if (!v) { animDoors.splice(i, 1); continue; }
      const step = dt * 4;
      if (Math.abs(d.open - d.target) <= step) { d.open = d.target; animDoors.splice(i, 1); }
      else d.open += Math.sign(d.target - d.open) * step;
      v.doorMesh.setMatrixAt(v.doors.indexOf(d), doorMatrix(d));
      v.doorMesh.instanceMatrix.needsUpdate = true;
      shDirty();
    }
    G.Vegetation.update(dt, px, pz, chunks, G.debug && G.debug.camera);
    groundLod(chunks, px, pz);
    // puertas, vidrios y lámparas instanciados: se ocultan los chunks fuera de cámara
    const qq = G.Quality ? G.Quality.cur : null;
    const shReach = Math.max(18, (qq && qq.shadows ? (qq.shadowSize || 22) * 1.3 : 0) + 8);
    // lo fino de cada trozo (plantas, hierbajos, alféizares...): solo cerca. La distancia, según la calidad (no la de
    // dibujado: es para ahorrar): baja 25 m, media 35, alta 47 (contados hasta el borde del trozo; con la niebla
    // no se nota cuándo aparece). Lo mediano, hasta 1,6 veces eso (baja 40, media 56, alta 76)
    const qb = G.Quality && G.Quality.PRESETS ? G.Quality.PRESETS[G.Quality.active] : null;
    // (con más distancia de dibujado se ve todo mucho más lejos, que ya cuesta lo suyo: lo fino y lo mediano se
    // acercan un poco para compensar)
    const dK = ({ media: 0.8, alta: 0.7 })[G.Quality && G.Quality.dist] || 1;
    const fineFar = Math.min(50, Math.max(22, (qb ? qb.far : 70) * 0.5)) * dK, midFar = fineFar * 1.6;
    chunks.forEach((c) => {
      const v = c.view;
      if (!v) return;
      const b = v.box;
      const dx = Math.max(b.min.x - px, 0, px - b.max.x), dz = Math.max(b.min.z - pz, 0, pz - b.max.z);
      if (v.fine) v.fine.visible = dx * dx + dz * dz < fineFar * fineFar;
      if (v.mid) v.mid.visible = dx * dx + dz * dz < midFar * midFar;
      if (!v.inst.length) return;
      const inV = G.Vegetation.inView(b), d2 = dx * dx + dz * dz;
      for (const m of v.inst) {
        // (las que proyectan sombra siguen visibles dentro del alcance de la sombra: si no, girar la cámara
        // rehacía la sombra fija entera)
        const vis = inV || d2 < (m.castShadow ? shReach * shReach : 18 * 18);
        if (m.visible !== vis) { m.visible = vis; if (m.castShadow) shDirty(); }
      }
    });
    // Luces: las habitaciones encendidas más cercanas (cuántas, según la calidad)
    lightTimer -= dt;
    if (lightTimer > 0) return;
    lightTimer = 0.25;
    const nL = G.Quality ? G.Quality.cur.lights : 4;
    chunks.forEach((c) => { if (c.view && Math.abs(c.cx * W().CS + 16 - px) < 60 && Math.abs(c.cz * W().CS + 16 - pz) < 60) updateInteriors(c, px, pz); });
    cand.length = 0;
    chunks.forEach((c) => {
      if (!c.view) return;
      for (const b of c.buildings) {
        for (const r of b.rooms) {
          if (!r.on) continue;
          const d = Math.hypot(r.light.x - px, r.light.z - pz);
          if (d < 26) cand.push([d, r]);
        }
      }
    });
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < lightPool.length; i++) {
      const l = lightPool[i];
      // las que sobran se apagan del todo (no cuentan en los sombreadores)
      if (l.visible !== (i < nL)) l.visible = i < nL;
      const cnd = i < nL ? cand[i] : null;
      if (cnd) {
        l.position.set(cnd[1].light.x, cnd[1].light.y - 0.3, cnd[1].light.z);
        l.intensity = 1.5;
      } else {
        l.intensity = 0;
        l.position.set(px, -50, pz);
      }
    }
  }

  // (lo que cambia algo fijo del mundo avisa a la sombra fija)
  const dirtyAfter = (fn) => function () { const r = fn.apply(this, arguments); shDirty(); return r; };
  G.WorldView = { init, build, buildSteps, dispose, update, detGround, detReset, edgeChanged: dirtyAfter(edgeChanged), hideEdge: dirtyAfter(hideEdge), hideFurn: dirtyAfter(hideFurn), lightChanged, itemAdded: dirtyAfter(itemAdded), itemRemoved: dirtyAfter(itemRemoved), switchPoint };
})(window.Game = window.Game || {});
