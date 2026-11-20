// Paredes transparentes (opción de Imagen). Lo del mundo que queda entre la cámara y el personaje (una pared, una
// columna, un mueble alto, la copa de un árbol) se vuelve semitransparente para que no lo tape.
//
// Cómo: un tubo que va de la cámara al pecho del personaje (estrecho junto a la cámara, ancho junto a él). Los
// píxeles de los materiales marcados (paredes, techos, interiores, árboles) que caen dentro del tubo, y por delante
// del personaje, se recortan a trama (como una rejilla fina: deja ver a través y no hay que ordenar transparencias).
// El recorte va en el mismo sombreador que la linterna (G.Flash.patch), pero solo se compila en los materiales
// marcados y solo con la opción puesta (#define SEE_THRU): apagada no cuesta nada (un «discard» en el sombreador
// le quita al móvil el descarte rápido de lo tapado, así que no se deja ahí si no se usa).
(function (G) {
  'use strict';

  // uSeeA: la cámara (xyz) y si está activo (w) · uSeeB: el pecho del personaje (xyz) y el radio junto a él (w)
  const A = new THREE.Vector4(0, 0, 0, 0), B = new THREE.Vector4(0, 0, 0, 0.75);
  const U = { uSeeA: { value: A }, uSeeB: { value: B } };
  const R_CAM = 0.22;      // radio del tubo junto a la cámara
  const R_PLAYER = 0.75;   // junto al personaje (lo que ocupa de cuerpo en pantalla)
  const FRONT = 0.4;       // solo lo que está al menos esto por delante de él (lo que tiene al lado no se toca)
  const MAXCUT = 0.8;      // en el centro del tubo se quitan 8 de cada 10 píxeles

  const FRAG_PARS = [
    '#ifdef SEE_THRU',
    'uniform vec4 uSeeA;',
    'uniform vec4 uSeeB;',
    // rejilla ordenada de 4 x 4 (Bayer): cada píxel con su umbral, sin ruido que parpadee
    'float seeBayer( vec2 fc ) {',
    '  vec2 p = mod( floor( fc ), 4.0 );',
    '  vec2 a = mod( p, 2.0 ), c = floor( p * 0.5 );',
    '  float b1 = mod( 2.0 * a.x + 3.0 * a.y, 4.0 ), b2 = mod( 2.0 * c.x + 3.0 * c.y, 4.0 );',
    '  return ( 4.0 * b1 + b2 + 0.5 ) / 16.0;',
    '}',
    '#endif'
  ].join('\n');
  const FRAG_MAIN = [
    '#ifdef SEE_THRU',
    'if ( uSeeA.w > 0.5 ) {',
    '  vec3 sAB = uSeeB.xyz - uSeeA.xyz;',
    '  float sL = max( length( sAB ), 1e-3 );',
    '  vec3 sDir = sAB / sL;',
    '  float sS = dot( vFlW - uSeeA.xyz, sDir );',
    '  if ( sS > -0.2 && sS < sL - ' + FRONT.toFixed(2) + ' ) {',
    '    float sT = clamp( sS / sL, 0.0, 1.0 );',
    '    float sR = mix( ' + R_CAM.toFixed(2) + ', uSeeB.w, sT );',
    '    float sD = length( vFlW - ( uSeeA.xyz + sDir * sS ) );',
    '    float sK = ( 1.0 - smoothstep( sR * 0.55, sR, sD ) ) * ' + MAXCUT.toFixed(2) + ';',
    '    if ( sK > seeBayer( gl_FragCoord.xy ) ) discard;',
    '  }',
    '}',
    '#endif'
  ].join('\n');

  // la llama G.Flash.patch con el sombreador Lambert ya preparado (vFlW: la posición en el mundo)
  function patch(sh) {
    sh.uniforms.uSeeA = U.uSeeA; sh.uniforms.uSeeB = U.uSeeB;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>\n' + FRAG_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_MAIN);
  }

  // los materiales que se pueden ver a través
  const mats = [];
  let enabled = (() => { try { return localStorage.getItem('ceniza.paredesver') === '1'; } catch (e) { return false; } })();
  function apply(m) {
    m.defines = m.defines || {};
    const has = 'SEE_THRU' in m.defines;
    if (enabled && !has) { m.defines.SEE_THRU = ''; m.needsUpdate = true; }
    else if (!enabled && has) { delete m.defines.SEE_THRU; m.needsUpdate = true; }
  }
  function mark(m) { if (m && mats.indexOf(m) < 0) { mats.push(m); apply(m); } return m; }
  function setEnabled(v) { enabled = !!v; for (let i = 0; i < mats.length; i++) apply(mats[i]); if (!enabled) A.w = 0; }

  // cada fotograma, tras mover la cámara. on: false en los planos de cine, el refugio, etc.
  function update(camera, player, on) {
    if (!enabled || !on || !camera || !player || player.dead) { A.w = 0; return; }
    A.set(camera.position.x, camera.position.y, camera.position.z, 1);
    const crouch = player.crouchAmt || 0;
    B.set(player.pos.x, (player.y || 0) + 1.1 - 0.35 * crouch, player.pos.z, R_PLAYER);
  }

  G.SeeThru = { patch, mark, setEnabled, update, get enabled() { return enabled; } };
})(window.Game = window.Game || {});
