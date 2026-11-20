// El modo supervivencia (en beta): Eira, la Trece, sola en Oceanside. Sin facción y con su gente desaparecida, busca
// comida, agua, curas y lo que le sirva para seguir. El mundo son zonas conectadas (como un mundo abierto que se
// carga por trayectos): el escondite de la Trece en el centro y, alrededor, el asentamiento de Oceanside, la casa del
// pescador y el faro. Entre dos zonas hay un paso (una galería con una reja en medio que se sube girando una manivela,
// manteniendo Recoger; la reja cae otra vez al pasar): mientras se cruza a oscuras, se carga la zona de al lado.
//
// Los descansos (el saco del escondite y un fuego en cada zona) son lo único fijo: ahí se guarda, se cura (comiendo
// algo), se elige la hora a la que salir, se cocina, se viaja a otro descanso ya encendido (cuesta comida y agua, a
// veces se pierde una venda por el camino y, según la hora, te pueden salir al paso: dos oleadas en el camino de la
// costa), se mejoran las armas con piezas (en la mesa del escondite) y se aprenden habilidades (con suplementos,
// cuando se tiene el manual de esa rama). Al descansar, los infectados de la zona vuelven a estar. Al morir, se
// despierta en el último descanso con lo que se llevaba entonces.
//
// La prueba (modo libre, «Modo supervivencia · prueba»): elegir con qué se empieza y forzar las probabilidades. No
// se guarda. Lo que necesita del juego lo da main.js (init(host)).
(function (G) {
  'use strict';
  const U = G.Util, TAU = Math.PI * 2;
  const KEY = 'ceniza.supervivencia';
  const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const para = (t) => esc(t).split('\n').map((l) => '<p>' + l + '</p>').join('');
  const snd = (id, o) => { if (G.Audio) G.Audio.play(id, o); };
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const rnd = (a, b) => a + Math.random() * (b - a);
  let host = null;
  const P = () => host && host.player;
  // los nombres en medio de una frase: «la casa del pescador», «al escondite de la Trece»
  const lc = (n) => String(n).replace(/^(El|La|Los|Las) /, (m) => m.toLowerCase());
  const toName = (n) => { const l = lc(n); return l.indexOf('el ') === 0 ? 'al ' + l.slice(3) : 'a ' + l; };

  // ================= Los datos =================
  // La hora a la que se sale del descanso: la luz, cuántos infectados hay, lo que se encuentra y lo que arriesgas
  // en un viaje (amb: probabilidad de que te salgan al paso · warn: de verlo venir y poder rodear)
  const HOURS = [
    { id: 'alba', name: 'Al alba', h: 6.5, amb: 0.17, risk: 'medio', zk: 1.2, stalk: 1, blind: 0, loot: 1.0, sup: 1.2, warn: 0.8, day: false,
      note: 'Poca luz y bruma. Los infectados todavía no se han dispersado.' },
    { id: 'manana', name: 'Por la mañana', h: 9.5, amb: 0.08, risk: 'bajo', zk: 1.0, stalk: 0, blind: 0, loot: 1.35, sup: 1.0, warn: 1, day: true,
      note: 'Se ve lejos: si te salen al paso, los ves venir. Se encuentra más comida y agua.' },
    { id: 'mediodia', name: 'A mediodía', h: 13.0, amb: 0.08, risk: 'bajo', zk: 1.0, stalk: 0, blind: 0, loot: 1.35, sup: 1.0, warn: 1, day: true,
      note: 'La hora más tranquila. Se encuentra más comida y agua.' },
    { id: 'tarde', name: 'Por la tarde', h: 16.8, amb: 0.17, risk: 'medio', zk: 1.1, stalk: 0, blind: 0, loot: 1.1, sup: 1.0, warn: 1, day: true,
      note: 'Todavía hay luz, pero empiezan a moverse.' },
    { id: 'atardecer', name: 'Al atardecer', h: 19.3, amb: 0.25, risk: 'alto', zk: 1.3, stalk: 1, blind: 0, loot: 1.0, sup: 1.3, warn: 0.75, day: false,
      note: 'La luz se va. Más infectados, y algún observador.' },
    { id: 'noche', name: 'De noche', h: 23.2, amb: 0.33, risk: 'alto', zk: 1.6, stalk: 2, blind: 1, loot: 0.8, sup: 1.8, warn: 0.5, day: false,
      note: 'Muchos más, y casi no se ve. Pero de noche aparecen más suplementos (y los que están quietos no te ven tan lejos).' }
  ];
  const hourDef = (id) => HOURS.find((h) => h.id === id) || HOURS[1];
  // Las zonas: el mapa, el descanso (y dónde apareces al llegar a él), las salidas (cada una a un paso) y dónde
  // apareces al llegar desde cada zona vecina; cuántos infectados hay (de día) y cuántas cosas se encuentran
  const ZONES = {
    escondite: { map: 'sv_escondite', name: 'El escondite de la Trece', hub: true,
      rest: { x: 21.0, z: 39.6, reach: 1.7, label: 'Dormir en el saco', bed: true }, spawn: { x: 22.6, z: 38.4, face: Math.PI },
      bench: { x: 29.5, z: 37.5, fx: 28.6, fz: 37.5, label: 'La mesa de trabajo (mejorar armas)' },
      exits: [
        { to: 'oceanside', paso: 'via', x: 14.6, z: 7.6, label: 'Ir por la vía · Asentamiento de Oceanside', mark: [16.6, 7.2] },
        { to: 'pescador', paso: 'playa', x: 48.2, z: 43.0, label: 'Ir por la playa · La casa del pescador', mark: [47.6, 41.2] },
        // (a la garita: por el camino del bosque, que sale por el hueco de la valla del este, hasta la persiana)
        { to: 'garita', pers: 'out', label: 'Girar la manivela de la persiana (mantener) · La garita del depósito', mark: [49.3, 13.3] }
      ],
      arrive: { oceanside: { x: 14.5, z: 9.8, face: 0 }, pescador: { x: 46.6, z: 42.8, face: -Math.PI / 2 }, garita: { x: 104.0, z: 16.0, face: -Math.PI / 2 } },
      // el taller de la persiana, al final del camino (mirando al oeste: al camino); y la niebla, cada vez más espesa
      pasaje: { x: 112.0, z: 16.0, dir: 'W', crank: true, inner: true, piece: true, to: 'garita' },
      fog: { x: 112.0, z: 16.0, r0: 8, r1: 58, k: 0.36 },
      // (el refugio: aquí no hay infectados, ni de día ni de noche; tampoco por el camino del bosque)
      zombies: 0, safe: true, loot: 4, own: true, keepOut: [[12, 31, 32, 44]],
      finds: [{ id: 'e_empu', kind: 'sv_p_empu', x: 23.4, z: 34.4 }, { id: 'e_sup', kind: 'sv_sup', n: 10, x: 15.6, z: 39.4 }],
      notes: [[16.6, 41.4, 'sv_esc_1'], [25.2, 41.6, 'sv_esc_2'], [79.0, 16.4, 'sv_bos_1']] },
    oceanside: { map: 'oceanside', name: 'Asentamiento de Oceanside',
      rest: { x: 10.4, z: 28.6, reach: 2.4, label: 'Encender el fuego y descansar', fire: true }, spawn: { x: 11.8, z: 27.0, face: Math.PI / 2 },
      exits: [
        { to: 'escondite', paso: 'via', x: 7.0, z: 12.6, label: 'Pasar por detrás del camión · El escondite', mark: [7.4, 15.9] },
        { to: 'faro', paso: 'cabo', x: 75.0, z: 12.5, label: 'Salir por el portón del este · Faro de Oceanside', mark: [73.4, 16.0] }
        // (a la ciudad, desde la garita del depósito: en el coche de la Trece)
      ],
      arrive: { escondite: { x: 9.2, z: 12.6, face: Math.PI / 2 }, faro: { x: 72.4, z: 12.6, face: -Math.PI / 2 } },
      zombies: 9, loot: 10, crudo: 0.6,
      finds: [{ id: 'o_rifle', kind: 'rifle', n: 1, x: 20.0, z: 23.0 }, { id: 'o_tiro', kind: 'sv_m_tiro', x: 42.0, z: 23.0 },
        { id: 'o_muelle', kind: 'sv_p_muelle', x: 41.5, z: 51.0 }, { id: 'o_carg', kind: 'sv_p_carg', x: 53.5, z: 50.0 }, { id: 'o_sup', kind: 'sv_sup', n: 12, x: 10.0, z: 51.0 }] },
    faro: { map: 'sv_faro', name: 'Faro de Oceanside',
      rest: { x: 27.0, z: 29.6, reach: 2.4, label: 'Encender el fuego y descansar', fire: true }, spawn: { x: 27.0, z: 31.8, face: Math.PI },
      exits: [{ to: 'oceanside', paso: 'cabo', x: 16.5, z: 6.4, label: 'Salir por la verja · Asentamiento de Oceanside', mark: [18.6, 6.0] }],
      arrive: { oceanside: { x: 16.5, z: 8.6, face: 0 } },
      zombies: 7, loot: 8, crudo: 0.5,
      finds: [{ id: 'f_esc', kind: 'escopeta', n: 2, x: 56.0, z: 11.4 }, { id: 'f_mira', kind: 'sv_p_mira', x: 23.0, z: 47.0 },
        { id: 'f_aux', kind: 'sv_m_aux', x: 25.0, z: 13.0 }, { id: 'f_sup', kind: 'sv_sup', n: 12, x: 38.0, z: 37.5 }, { id: 'f_cerr', kind: 'sv_p_cerrojo', x: 10.5, z: 39.0 }] },
    pescador: { map: 'sv_pescador', name: 'La casa del pescador',
      rest: { x: 24.6, z: 36.4, reach: 2.4, label: 'Encender el fuego y descansar', fire: true }, spawn: { x: 26.0, z: 35.0, face: -Math.PI / 2 },
      exits: [{ to: 'escondite', paso: 'playa', x: 12.6, z: 7.4, label: 'Volver por el sendero · El escondite', mark: [14.6, 7.0] }],
      arrive: { escondite: { x: 12.5, z: 9.8, face: 0 } },
      zombies: 5, loot: 7, crudo: 2.4,
      finds: [{ id: 'p_sigilo', kind: 'sv_m_sigilo', x: 21.0, z: 23.0 }, { id: 'p_cuerda', kind: 'sv_p_cuerda', x: 35.0, z: 27.0 }, { id: 'p_culata', kind: 'sv_p_culata', x: 40.4, z: 36.0 }] },
    // la garita del depósito (el del prólogo, treinta años después, entre los mismos bloques): un descanso pobre, sin
    // mapa (de aquí no se viaja: se va a pie o en el coche). Cinco caminos: el de la ciudad (el coche, al sur de la
    // reja rota) y cuatro cortados por ahora; y el taller de la persiana, al oeste, de vuelta al bosque del escondite
    garita: { map: 'sv_garita', name: 'La garita del depósito',
      rest: { x: 43.2, z: 40.0, reach: 1.7, label: 'Echarse en el colchón de la garita', basic: true, noTravel: true, title: 'LA GARITA' }, spawn: { x: 42.6, z: 38.8, face: Math.PI / 2 },
      exits: [
        { to: 'escondite', pers: 'in', label: 'Girar la manivela de la persiana (mantener) · Volver al escondite' },
        { to: 'afueras', car: true, x: 51.2, z: 67.0, label: 'Subir al coche · La ciudad' }
      ],
      // los otros cuatro caminos: cortados (de momento no llevan a ninguna parte)
      closed: [{ x: 53.0, z: 14.0, label: 'El camino del norte · cortado (todavía no se puede seguir)' }, { x: 21.5, z: 28.5, label: 'La carretera del oeste · cortada (todavía no se puede seguir)' },
        { x: 80.5, z: 28.5, label: 'La carretera del este · cortada (todavía no se puede seguir)' }, { x: 78.2, z: 58.0, label: 'La pista del sureste · cortada (todavía no se puede seguir)' }],
      arrive: { escondite: { x: 33.0, z: 46.0, face: Math.PI / 2 }, afueras: { x: 50.4, z: 68.6, face: Math.PI } },
      car: { x: 53.0, z: 68.0, fx: 0, fz: 1 },
      // el taller de la persiana (la boca al oeste, al bosque; por dentro, al patio) y la niebla que entra por él
      pasaje: { x: 22.0, z: 46.0, dir: 'W', crank: true, inner: true, open: true, piece: true, to: 'escondite' },
      fog: { x: 22.0, z: 46.0, r0: 2, r1: 18, k: 0.36 },
      zombies: 4, loot: 6, own: true, keepOut: [[39.5, 35.5, 45.5, 42.5]],
      finds: [{ id: 'g_sup', kind: 'sv_sup', n: 10, x: 58.0, z: 44.0 }, { id: 'g_venda', kind: 'venda', n: 1, x: 47.2, z: 52.0 }],
      notes: [[42.0, 41.6, 'sv_gar_1'], [50.4, 63.4, 'sv_gar_2']] },
    // la avenida de entrada: cerrada por un muro de coches. Se pasa por el taller del oeste (la persiana: mientras se
    // sube, la ciudad se prepara detrás) o se baja al subte. Sin descanso (el fuego está en la plaza)
    afueras: { map: 'sv_afueras', name: 'La avenida de entrada', rest: null, spawn: { x: 32.0, z: 52.5, face: Math.PI }, own: true,
      exits: [
        { to: 'garita', car: true, x: 28.2, z: 54.6, label: 'Subir al coche · Volver a la garita' },
        { to: 'ciudad', pers: 'out', label: 'Girar la manivela de la persiana (mantener)' },
        { to: 'ciudad', paso: 'subte', x: 40.0, z: 22.9, label: 'Bajar al subte · El centro de la ciudad', subte: { x: 40.0, z: 25.8, ry: 0 } }
      ],
      arrive: { garita: { x: 31.8, z: 53.4, face: Math.PI }, ciudad: { x: 40.0, z: 21.6, face: Math.PI } },
      car: { x: 29.6, z: 55.0, fx: 0, fz: -1 },
      // el taller de la persiana: la boca, en x 24 (mirando al este), centrada en z 21
      pasaje: { x: 24.0, z: 21.0, crank: true, to: 'ciudad' },
      zombies: 4, loot: 5, keepOut: [[4, 13, 24, 50], [42, 13, 60, 50]],
      finds: [{ id: 'a_sup', kind: 'sv_sup', n: 8, x: 27.0, z: 40.0 }],
      notes: [[28.8, 42.2, 'sv_afu_1']] },
    // el centro de la ciudad: la plaza (el fuego y la boca del subte), las calles, tres kioscos y tres pisos de arriba
    ciudad: { map: 'sv_ciudad', name: 'El centro de la ciudad', big: true, own: true,
      rest: { x: 53.0, z: 43.6, reach: 2.4, label: 'Encender el fuego y descansar', fire: true }, spawn: { x: 51.6, z: 42.2, face: Math.PI },
      exits: [{ to: 'afueras', paso: 'subte', x: 44.0, z: 51.1, label: 'Bajar al subte · La avenida de entrada', subte: { x: 44.0, z: 54.0, ry: 0 } }],
      arrive: { afueras: { x: 44.0, z: 49.6, face: Math.PI } },
      // el taller de la persiana, por dentro (por aquí se llega desde la avenida): al final de la calle de z 64
      pasaje: { x: 124.0, z: 64.0, open: true, crank: true },
      // (los sueltos, menos que antes: el resto va en escenas, abajo; y se arriman a donde vas: ver updateTrickle)
      zombies: 9, loot: 18, crudo: 0.05,
      // la escalera de mano (una sola: se lleva de un piso a otro) y los tres pisos
      ladder: { x: 86.0, z: 82.6, yaw: Math.PI / 2 },
      aptos: [
        { role: 'apto1', finds: [{ id: 'c_rev', kind: 'revolver', n: 6 }, { id: 'c_mart', kind: 'sv_p_martillo' }] },
        { role: 'apto2', finds: [{ id: 'c_canon', kind: 'sv_p_canon' }, { id: 'c_sup2', kind: 'sv_sup', n: 15 }] },
        { role: 'apto3', finds: [{ id: 'c_tubo', kind: 'sv_p_tubo' }, { id: 'c_rcan', kind: 'sv_p_rcanon' }] }
      ],
      finds: [{ id: 'c_k1', kind: 'sv_sup', n: 8, x: 40.5, z: 42.0 }, { id: 'c_k2', kind: 'venda', n: 1, x: 78.0, z: 81.0 }, { id: 'c_k3', kind: 'mun_9mm', n: 3, x: 48.0, z: 104.5 }],
      // los locales de planta baja (se entra por delante): lo que hay dentro, cada vez que se descansa
      inside: { farmacia: 3, ferreteria: 2, policia: 2, lavanderia: 1, almacen: 2, oficinas: 1, oficinas2: 1 },
      notes: [[0, 0, 'sv_ciu_far', { inside: 'farmacia' }], [0, 0, 'sv_ciu_pol', { inside: 'policia' }], [0, 0, 'sv_ciu_lav', { inside: 'lavanderia' }],
        [0, 0, 'sv_ciu_ofi', { inside: 'oficinas2' }], [33.6, 120.4, 'sv_ciu_camp'], [95.2, 34.0, 'sv_ciu_esc'],
        [0, 0, 'sv_ciu_apto', { inside: 'apto1', lv: 1 }], [0, 0, 'sv_ciu_dib', { inside: 'apto3', lv: 1 }]],
      // las escenas: grupos quietos (el choque, el atasco), la manada que va y viene por las calles del sureste y
      // los de la comisaría (encerrados dentro)
      scenes: [
        { kind: 'grupo', x: 96.0, z: 32.4, r: 4.5, n: 3 },
        { kind: 'grupo', x: 111.0, z: 96.0, r: 7, n: 2 },
        { kind: 'manada', n: 4, pts: [[64, 76], [64, 96], [86, 96], [64, 96], [44, 96], [64, 96]] },
        { kind: 'nido', inside: 'policia', n: 2, stalker: 1 }
      ],
      // lo que se mueve sin ser un infectado: los pájaros, el humo de lejos, el cartel de la farmacia y los ruidos
      life: { birds: [[46.4, 46.2, 0], [77.6, 75.6, 0], [33.2, 117.6, 0], [107.2, 93.2, 1.46]], smoke: [[182, 40, 1], [76, -58, 0.75]],
        sign: { x: 52.4, z: 26.0, ry: 0 }, sounds: true } }
  };
  // Los pasos entre dos zonas (la galería: a = la boca del sur, b = la del norte)
  const PASOS = {
    // (cada uno, como el sitio: el túnel del tren viejo, el sendero entre las rocas de la playa, el camino del
    // acantilado y el túnel del subte; los de afuera, con un portón de troncos en vez de la reja)
    via: { name: 'La galería de la vía', kind: 'via', map: 'sv_paso', a: 'escondite', b: 'oceanside', notes: [[9.0, 9.4, 'sv_via_1']] },
    playa: { name: 'El sendero de las rocas', kind: 'rocas', map: 'sv_sendero', out: true, a: 'escondite', b: 'pescador', notes: [[8.9, 10.6, 'sv_playa_1']] },
    cabo: { name: 'El camino del acantilado', kind: 'cabo', map: 'sv_sendero', out: true, a: 'oceanside', b: 'faro', notes: [[11.1, 21.6, 'sv_cabo_1']] },
    monte: { name: 'El camino del bosque', kind: 'bosque', map: 'sv_sendero', out: true, a: 'escondite', b: 'garita' },
    subte: { name: 'El túnel del subte', kind: 'subte', map: 'sv_paso', a: 'afueras', b: 'ciudad', notes: [[11.0, 22.4, 'sv_subte_1']] }
  };
  const GATE_Z = 16, CRANK_T = 2.6;
  const CRANKS = [{ side: 'a', x: 8.75, z: 14.5, mx: 8.08, ry: 0 }, { side: 'b', x: 11.25, z: 17.5, mx: 11.92, ry: Math.PI }];
  // Lo que se lleva aparte (G.Surv): comida, agua, comida cruda, agua sin hervir y suplementos
  const RES = {
    sv_comida: { k: 'comida', name: 'comida', cap: 8 },
    sv_agua: { k: 'agua', name: 'agua', cap: 8 },
    sv_crudo: { k: 'crudo', name: 'pescado crudo', cap: 6 },
    sv_sucia: { k: 'sucia', name: 'agua sin hervir', cap: 6 },
    sv_sup: { k: 'sup', name: 'suplementos', cap: 999 }
  };
  const RES_NAME = { comida: 'Comida', agua: 'Agua', crudo: 'Pescado crudo', sucia: 'Agua sin hervir' };
  // Las piezas de las armas: cada una, para un arma y una de sus mejoras (las del banco del refugio de Retorno)
  const PARTS = {
    empu: { name: 'una empuñadura de goma', short: 'Empuñadura de goma', w: 'pistola', up: 'estabilidad' },
    muelle: { name: 'un muelle reforzado', short: 'Muelle reforzado', w: 'pistola', up: 'cadencia' },
    carg: { name: 'un cargador ampliado', short: 'Cargador ampliado', w: 'pistola', up: 'capacidad' },
    mira: { name: 'una mira telescópica', short: 'Mira telescópica', w: 'rifle', up: 'mira' },
    cerrojo: { name: 'un cerrojo pulido', short: 'Cerrojo pulido', w: 'rifle', up: 'cadencia' },
    culata: { name: 'una culata acolchada', short: 'Culata acolchada', w: 'escopeta', up: 'estabilidad' },
    cuerda: { name: 'una cuerda de arco nueva', short: 'Cuerda de arco nueva', w: 'arco', up: 'alcance' },
    // (las de la ciudad)
    martillo: { name: 'un martillo pulido', short: 'Martillo pulido', w: 'revolver', up: 'cadencia' },
    canon: { name: 'un cañón pesado', short: 'Cañón pesado', w: 'revolver', up: 'dano' },
    tubo: { name: 'un tubo de cargador largo', short: 'Tubo de cargador largo', w: 'escopeta', up: 'capacidad' },
    rcanon: { name: 'un cañón reforzado', short: 'Cañón reforzado', w: 'rifle', up: 'dano' }
  };
  // Las ramas de habilidades: cada una se abre con su manual (se encuentra) y cada nivel cuesta suplementos
  const BRANCHES = [
    { id: 'sigilo', name: 'Sigilo', manual: 'sigilo', manualName: 'La libreta de rastreo', desc: 'Lo que la Trece aprendió cazando Escorpiones.',
      levels: [{ cost: 15, key: 'listen', val: 1, txt: 'Escuchar: agachada, oyes a los infectados a través de las paredes' },
        { cost: 30, key: 'listenR', val: 8, txt: 'Oído fino: escuchar llega 8 m más lejos' },
        { cost: 45, key: 'stealth', val: 0.12, txt: 'Sin rastro: cuesta más verte agachada' }] },
    { id: 'punteria', name: 'Puntería', manual: 'tiro', manualName: 'El manual de tiro', desc: 'Un manual del ejército, subrayado a lápiz.',
      levels: [{ cost: 20, key: 'aim', val: 0.2, txt: 'Apuntas un 20 % más rápido' },
        { cost: 35, key: 'recoil', val: 0.15, txt: 'Las armas retroceden un 15 % menos' },
        { cost: 50, key: 'reload', val: 0.12, txt: 'Recargas un 12 % más rápido' }] },
    { id: 'aguante', name: 'Aguante', manual: 'aux', manualName: 'El manual de primeros auxilios', desc: 'De la estación de señales del faro.',
      levels: [{ cost: 20, key: 'bandage', val: 10, txt: 'Cada venda cura 10 de vida más' },
        { cost: 35, key: 'heal', val: 0.2, txt: 'Te vendas un 20 % más rápido' },
        { cost: 50, key: 'vit', val: 0.08, txt: 'Aguantas un 8 % más cada golpe' }] }
  ];
  const MANUAL_NAME = { sigilo: 'la libreta de rastreo', tiro: 'el manual de tiro', aux: 'el manual de primeros auxilios' };
  // Lo que se cocina en un descanso
  const RECIPES = [
    { id: 'guiso', name: 'Pescado asado', need: { crudo: 1 }, give: { comida: 2 }, txt: 'Un pescado al fuego: dos raciones de comida.' },
    { id: 'hervir', name: 'Hervir agua', need: { sucia: 1 }, give: { agua: 1 }, txt: 'El agua de lluvia o del pozo, hervida: se puede beber.' },
    { id: 'venda', name: 'Venda hervida', need: { trapo: 1, agua: 1 }, give: { venda: 1 }, txt: 'Un trapo hervido en agua limpia: una venda.' }
  ];
  // Las notas de la Trece (en el escondite): una más cada vez que vuelve herida a dormir
  const EIRA_NOTES = [
    'Me abrí el costado otra vez saltando la valla del asentamiento. Tres puntos, mal dados.\nGrimes diría que soy una burra. Grimes no está.',
    'Las vendas se acaban antes que los infectados. Hierve los trapos, Eira. Hiérvelos aunque estés cansada.\nHoy casi no subo la loma.',
    'Cuento las balas antes de dormir. Las cuento dos veces. Es lo único que me deja dormir.\nEl faro sigue girando. Alguien le da cuerda.',
    'Ya no sé cuántos días van. La comida dice que muchos.\nSi alguien lee esto: no me esperes. Sigue andando.'
  ];
  // Las notas sueltas del mundo: papeles que se levantan (en las zonas, en los pasos y en los locales de la ciudad).
  // Se guardan con las de las paradas (G.Calm.Notes: la pestaña Notas de la mochila) y se releen en los descansos.
  // Cosas pequeñas y con huecos: nadie explica el mundo entero
  const SV_LORE = {
    sv_esc_1: { title: 'Una lista clavada en la puerta', where: 'El escondite de la Trece',
      text: 'Antes de salir:\n— Aceitar la manivela del taller del bosque. Chirría y se oye desde la garita.\n— No volver a la ciudad de noche. Ni con el coche.\n— Hervir los trapos.\n— Grimes.\nLa última línea está tachada y vuelta a escribir tres veces.' },
    sv_esc_2: { title: 'Una foto con algo escrito detrás', where: 'El escondite de la Trece',
      text: 'En la foto, un fuego y once caras. Alguien ha rascado una de ellas con la uña hasta borrarla.\nDetrás, a lápiz:\n«El invierno del puerto. Andrés todavía se reía.\nCuento las caras cada noche. Quedo yo.»' },
    sv_bos_1: { title: 'Un papel atado a un pino con alambre', where: 'El camino del bosque',
      text: 'Al que venga detrás:\nla persiana del taller sube si la giras despacio. Si la fuerzas, se traba, hay que empezar otra vez y el ruido llega lejos.\nNo te pares en la niebla. No es por los infectados.\n— A.' },
    sv_gar_1: { title: 'Parte del vigilante del depósito', where: 'La garita del depósito',
      text: 'Depósito municipal de vehículos. Turno de noche, 14 de octubre de 2020.\nEntradas: seis vehículos. Dos de la comisaría, con sangre en los asientos de atrás. El sheriff dice que no pregunte y que no abra los maleteros.\nHe abierto uno.\nMañana pido el traslado.' },
    sv_gar_2: { title: 'Escrito en una tabla, con carbón', where: 'La garita del depósito',
      text: 'LA REJA LA ROMPIMOS NOSOTROS.\nNO HABÍA OTRA MANERA DE SACAR EL COCHE.\nSI ERA TU COCHE, LO SENTIMOS.\nG. Y A.' },
    sv_via_1: { title: 'Un horario de trenes con cruces', where: 'La galería de la vía',
      text: 'Un horario de cercanías de hace treinta años. Encima de las horas, cruces a bolígrafo; y al margen:\n«Las cruces son las veces que pasa la patrulla del escorpión por la vía. Martes y viernes, siempre de día. De noche, ni ellos.»\nLa última cruz está en un sábado.' },
    sv_playa_1: { title: 'Una nota dentro de una botella', where: 'El sendero de las rocas',
      text: 'Si alguien encuentra esto: estamos en la casa del pescador. Somos tres. Tenemos agua y anzuelos. No tenemos balas.\nSi eres de los del escorpión, aquí no hay nada que llevarse.\nSi no lo eres, trae sal.' },
    sv_cabo_1: { title: 'Una hoja de cuaderno, mojada', where: 'El camino del acantilado',
      text: 'Esta noche el faro ha vuelto a girar. Treinta años apagado y ahora gira.\nMamá dice que es una trampa. Papá dice que donde hay luz hay gente.\nMañana subimos a ver quién tiene razón.' },
    sv_subte_1: { title: 'Un aviso del metro, con algo escrito encima', where: 'El túnel del subte',
      text: 'ESTACIÓN CERRADA POR ORDEN MUNICIPAL. DISCULPEN LAS MOLESTIAS.\nDebajo, con pintura roja:\n«ABAJO VIVE GENTE. NO BAJÉIS CON LUZ.»\nY más abajo, con otra letra:\n«Ya no.»' },
    sv_afu_1: { title: 'Una multa en un parabrisas', where: 'La avenida de entrada',
      text: 'Boletín de denuncia. Estacionamiento en zona de carga y descarga. 14/10/2020, 23:52.\nEn el dorso, a mano:\n«No voy a cobrar esto. No sé ni por qué la he puesto: costumbre. Las llaves están encima de la rueda, por si vuelves.»' },
    sv_ciu_far: { title: 'La libreta del farmacéutico', where: 'La farmacia de la ciudad',
      text: 'Insulina: quedan cuatro cajas. La señora del tercero viene todos los días a preguntar.\nAntibióticos: ninguno. Se los llevó la policía, «para el hospital».\nEl hospital está cerrado desde el martes.\nHe bajado la persiana. Si llama la señora del tercero, le abro.' },
    sv_ciu_pol: { title: 'Un parte de incidencias', where: 'La comisaría de la ciudad',
      text: 'Calabozo 2. El detenido presenta fiebre alta, agresividad y una mordedura en el antebrazo. Se solicita médico.\nSe solicita médico.\nSe solicita médico.\nLas tres líneas, con la misma letra, cada vez más torcida.' },
    sv_ciu_lav: { title: 'Resguardos sin recoger', where: 'La lavandería de la ciudad',
      text: 'Un taco de resguardos clavados en un pincho, todos del mismo día.\nUno tiene algo escrito a mano: «Recoger el vestido de la boda de Lucía antes del sábado».\nDetrás del mostrador, las fundas de plástico siguen colgadas en su barra. Ninguna tiene nombre.' },
    sv_ciu_ofi: { title: 'Un correo impreso', where: 'Las oficinas de la ciudad',
      text: 'De: Recursos Humanos\nAsunto: RECORDATORIO · Simulacro del viernes\nOs recordamos que el simulacro de evacuación del viernes es OBLIGATORIO. No habrá excepciones.\nAlguien ha escrito encima, en grande: «HECHO».' },
    sv_ciu_camp: { title: 'El diario del campamento', where: 'El final de la calle del sur',
      text: 'Día 1: la barricada aguanta. Los de la plaza no nos han visto.\nDía 4: Rober ha bajado a la farmacia. Ha vuelto con vendas y sin una bota.\nDía 9: hay humo al este. Alguien más vive en la ciudad.\nDía 12: nos vamos al subte. Dicen que abajo hay gente.\nDía 12, más tarde: Rober no viene.' },
    sv_ciu_esc: { title: 'Una libreta con un escorpión en la tapa', where: 'El cruce del noreste',
      text: 'Ruta de saqueo, semana 3:\n— Farmacia de la calle mayor: vacía.\n— Comisaría: entrar de dos en dos. Hay uno de los raros dentro; no tocar los calabozos.\n— La pelirroja del brazo quemado: si la veis, no la sigáis. Avisad.\n«No la sigáis» está subrayado dos veces.' },
    sv_ciu_apto: { title: 'Una carta encima de la mesa', where: 'Un piso de la ciudad',
      text: 'A quien suba por la ventana:\nno hay nada. Me llevé lo que servía y lo demás lo quemé para calentarme.\nLa escalera es mía. Puedes quedártela.\nPerdona lo de la puerta: la atranqué yo. No es por ti.' },
    sv_ciu_dib: { title: 'Un dibujo hecho con ceras', where: 'Un piso de la ciudad',
      text: 'Una casa, un sol y cuatro monigotes cogidos de la mano. Debajo, con letra de niño: «MI CASA».\nDetrás, con letra de adulto:\n«Nos vamos a casa de la abuela, a la costa. Si vuelves, ve allí.»' }
  };
  function registerLore() {
    if (G.Calm && G.Calm.Notes && G.Calm.Notes.LORE) Object.assign(G.Calm.Notes.LORE, SV_LORE);
  }
  const hasNote = (id) => !!(G.Calm && G.Calm.Notes && G.Calm.Notes.has(id));
  const keepNote = (id) => !!(G.Calm && G.Calm.Notes && G.Calm.Notes.add(id));

  // los objetos sueltos de este modo (G.Pickups los dibuja y los recoge; player.takeItem los manda aquí)
  function registerKinds() {
    const K = G.Pickups && G.Pickups.KINDS;
    if (!K || K.sv_comida) return;
    K.sv_comida = { name: 'comida', n: [1, 1], w: 0, lift: 0.01 };
    K.sv_agua = { name: 'agua', n: [1, 1], w: 0, lift: 0.01 };
    K.sv_crudo = { name: 'pescado crudo', n: [1, 1], w: 0, lift: 0.01 };
    K.sv_sucia = { name: 'agua sin hervir', n: [1, 1], w: 0, lift: 0.01 };
    K.sv_sup = { name: 'suplementos', n: [4, 9], w: 0, lift: 0.01 };
    for (const id in PARTS) K['sv_p_' + id] = { name: PARTS[id].name, n: [1, 1], w: 0, lift: 0.01 };
    for (const id in MANUAL_NAME) K['sv_m_' + id] = { name: MANUAL_NAME[id], n: [1, 1], w: 0, lift: 0.01 };
    // (las armas de fuego que se encuentran: se cogen como un arma)
    for (const id of ['rifle', 'escopeta', 'revolver', 'arco']) if (!K[id]) { const w = G.Weapons.get(id); if (w) K[id] = { name: w.name, n: [1, 1], w: 0, lift: 0.045, weapon: true }; }
  }

  // ================= El estado =================
  let S = null;                 // la partida (se guarda)
  let snapRest = null;          // copia de la partida en el último descanso (al morir se vuelve a ella)
  let R = null;                 // lo de ahora mismo (no se guarda): la escena de la zona, los props, la reja...
  let active = false, test = null, prevChar = null;
  let hudEl = null, barEl = null, hudT = 0;

  function fresh() {
    return { v: 1, zone: 'escondite', rest: 'escondite', hour: 'manana', visited: { escondite: true }, res: { comida: 2, agua: 2, crudo: 0, sucia: 0 }, sup: 0,
      parts: {}, manuals: {}, skills: {}, up: {}, inv: null, took: {}, Z: {}, rests: 0, wounds: 0, notes: 0, stats: { travels: 0, ambushes: 0, rests: 0 }, intro: false, car: null };
  }
  function save() {
    if (!S || test) return;
    try { localStorage.setItem(KEY, JSON.stringify({ live: S, snap: snapRest })); } catch (e) { /* nada */ }
  }
  function readSave() {
    try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && d.live && d.live.v === 1 ? d : null; } catch (e) { return null; }
  }
  function zstate(id) { if (!S.Z[id]) S.Z[id] = { left: null, lootAt: -1, alive: null, zAt: -1 }; return S.Z[id]; }

  // ---------- el equipo de la protagonista ----------
  function kitNew(p) {
    p.hands = [null, null, null, null, null]; p.stored = [];
    for (const k in p.items) p.items[k] = 0;
    for (const k in p.ammo) p.ammo[k] = 0;
    p.pickUp('pistola', 8, 1);
    p.ammo['9mm'] = 6;
    p.pickUp('arco', 1, 1);
    p.ammo.flecha = 3;
    p.items.venda = 1; p.items.trapo = 1; p.items.pandora = 1;
    p.health = 100;
    p.equip(-1);
  }
  function restorePlayer() {
    const p = P();
    if (S.inv) G.Run.unsnap(p, S.inv); else kitNew(p);
    G.Weapons.applyUpgrades(S.up);
    p.infinite = false; p.stockMax = {};
  }
  function keepPlayer() { const p = P(); if (p && !p.dead) S.inv = G.Run.snap(p); }
  function hasWeapon(id) { const p = P(); return p.hands.concat(p.stored).some((h) => h && h.id === id); }

  // ---------- la hora ----------
  function applyHour() {
    if (!G.Sky) return;
    G.Sky.set(hourDef(S.hour).h, null);
    G.Sky.fixHour(true);
  }

  // ================= La escena de una zona (lo que se dibuja aquí) =================
  let mats = null;
  function M() {
    if (mats) return mats;
    const fl = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    fl.toneMapped = false;
    mats = { body: new THREE.MeshLambertMaterial({ vertexColors: true }), flame: fl };
    return mats;
  }
  function mesh(draw, x, y, z, ry) {
    const m = new G.Mesher(); draw(m);
    const o = new THREE.Mesh(m.build(), M().body);
    o.position.set(x, y, z); o.rotation.y = ry || 0; o.castShadow = true; o.receiveShadow = true;
    R.group.add(o);
    return o;
  }
  const gy = (x, z) => G.World.groundY(x, z, 0);
  function prop(p) { const q = Object.assign({ kind: 'surv', reach: 1.8 }, p); if (p.lab) Object.defineProperty(q, 'label', { get: p.lab, enumerable: true }); G.Props.add(q); R.props.push(q); return q; }
  function newScene() {
    clearScene();
    R = { group: new THREE.Group(), props: [], anims: [], blocks: [], t: 0, fires: [], amb: null, gate: null, crank: null, finds: [], findT: 0, zl: [], near: [] };
    host.scene.add(R.group);
  }
  function clearScene() {
    if (!R) return;
    if (R.group.parent) R.group.parent.remove(R.group);
    R.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const q of R.props) { const i = G.Props.list.indexOf(q); if (i >= 0) G.Props.list.splice(i, 1); }
    R = null;
  }
  // un estorbo invisible (como en las paradas): un mueble sin dibujo
  function blocker(x0, z0, x1, z1, h) {
    const W = G.World, c = W.chunkAt(Math.floor((x0 + x1) / 2) >> 5, Math.floor((z0 + z1) / 2) >> 5);
    const f = { type: 'bloques', lv: 0, x0, x1, z0, z1, y: gy((x0 + x1) / 2, (z0 + z1) / 2), h: h || 1, fx: 0, fz: 1, solid: true, cont: null, calmBlock: true };
    c.furn.push(f);
    if (G.Furniture.indexChunk) G.Furniture.indexChunk(c, 32);
    R.blocks.push({ c, f });
    return f;
  }
  function setSolid(b, on) {
    const B = R.blocks.find((q) => q.f === b);
    if (!B || b.solid === on) return;
    b.solid = on; b.gone = !on;
    if (G.Furniture.indexChunk) G.Furniture.indexChunk(B.c, 32);
  }
  // el sitio libre más cercano (por si el punto cae encima de un mueble)
  function freeNear(x, z, r) {
    const W = G.World, inside = W.isIndoor(Math.floor(x), Math.floor(z), 0);
    for (let d = 0; d <= 3; d += 0.3) {
      for (let k = 0; k < (d ? 12 : 1); k++) {
        const a = k / 12 * TAU, qx = x + Math.sin(a) * d, qz = z + Math.cos(a) * d;
        if (W.circleBlocked(qx, qz, r || 0.32, 0)) continue;
        if (d > 0.6 && W.isIndoor(Math.floor(qx), Math.floor(qz), 0) !== inside) continue;
        return { x: qx, z: qz };
      }
    }
    return { x, z };
  }

  // ---------- un fuego (las llamas; sin luz propia, como en las paradas: no recompila nada) ----------
  function fire(x, z, lit) {
    const y = gy(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z); R.group.add(g);
    // las piedras y los leños
    const m = new G.Mesher();
    for (let k = 0; k < 9; k++) { const a = k / 9 * TAU; m.sphere(Math.sin(a) * 0.5, 0.06, Math.cos(a) * 0.5, 0.13, 0.09, 0.11, U.shade(0x6a665e, 0.85 + (k % 3) * 0.08), 0); }
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI + 0.3; m.cyl(0, 0.08, 0, 0.045, 0.05, 0.7, 0x3a2a1c, 6, undefined, Math.PI / 2 - 0.25, a, 0); }
    const base = new THREE.Mesh(m.build(), M().body); base.receiveShadow = true; g.add(base);
    const fl = new THREE.Group(); g.add(fl);
    const flames = [];
    for (let k = 0; k < 5; k++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.16 - k * 0.015, 0.6 - k * 0.05, 6), M().flame);
      const a = k / 5 * TAU;
      f.position.set(Math.sin(a) * (k ? 0.13 : 0), 0.3, Math.cos(a) * (k ? 0.13 : 0)); fl.add(f);
      flames.push({ m: f, ph: k * 1.7, b: 0.6 - k * 0.05 });
    }
    const F = { x, z, lit: !!lit, fl, flames, crk: 1 };
    fl.visible = F.lit;
    R.fires.push(F);
    return F;
  }
  function updateFires(dt) {
    for (const F of R.fires) {
      if (!F.lit) continue;
      for (const f of F.flames) { const s = 0.75 + 0.3 * Math.sin(R.t * 7 + f.ph) + 0.15 * Math.sin(R.t * 13 + f.ph * 2); f.m.scale.set(1, s, 1); f.m.position.y = f.b * s / 2 + 0.06; }
      if ((F.crk -= dt) <= 0) { F.crk = 1.8 + Math.random() * 2.2; const p = P(); if (p && Math.hypot(p.pos.x - F.x, p.pos.z - F.z) < 9) snd('crackle', { x: F.x, z: F.z, vol: 0.35 }); }
    }
  }
  // la marca de la Trece en sus caminos: un trapo rojo atado a un palo (las salidas se ven así, sin carteles)
  function trailMark(x, z) {
    const y = gy(x, z);
    mesh((m) => { m.cyl(0, 0.65, 0, 0.04, 0.05, 1.3, 0x5a4a38, 6); m.box(0, 1.18, 0.0, 0.07, 0.06, 0.07, 0x7a2a22); }, x, y, z, 0);
    const cl = mesh((m) => { m.box(0, -0.16, 0.13, 0.02, 0.32, 0.22, 0xa8322a); }, x, y + 1.2, z, Math.random() * TAU);
    cl.castShadow = false;
    R.anims.push((dt) => { cl.rotation.y += Math.sin(R.t * 1.3 + x) * dt * 0.6; cl.rotation.z = Math.sin(R.t * 2.1 + z) * 0.12; });
  }

  // ================= Entrar en una zona =================
  // how: { rest: true } (en el descanso: al empezar, al viajar o al despertar) o { from: zona } (por el paso)
  function enterZone(id, how) {
    const Z = ZONES[id] || ZONES.escondite, p = P();
    leaveHere();
    newScene();
    host.map(Z.map);
    restorePlayer();
    applyHour();
    S.zone = id; S.where = 'zone'; S.paso = null;
    const at = how && how.rest ? Z.spawn : ((how && Z.arrive[how.from]) || Z.spawn);
    const sp = freeNear(at.x, at.z);
    host.place(sp.x, sp.z, at.face || 0);
    buildZone(id, Z);
    lootZone(id, Z);
    zombiesZone(id, Z, false);
    host.peace(false);
    save();
    hud(true);
  }
  // antes de irse (o de guardar): lo que quedó en el suelo, los que siguen vivos y el equipo
  function leaveHere() {
    if (!S || !R) return;
    keepPlayer();
    if (S.where === 'zone') {
      syncFinds();
      const zs = zstate(S.zone);
      zs.left = G.Pickups.list.filter((it) => !it.svFind && !it.armed && !it.flying).map((it) => ({ id: it.id, n: it.n, x: it.x, y: it.y, z: it.z, lv: it.lv || 0, cond: it.cond }));
      // (los despiertos y los que duermen en los trozos de lejos: G.Population los guarda allí)
      const all = G.Population.list.filter((z) => z.alive && !z.human).concat(sleepers().map((q) => q.s));
      zs.alive = all.filter((z) => z.svAmb && z.svScene == null).length;
      // (los de las escenas, cada uno en la suya: al volver sin descansar, siguen los que quedaban)
      zs.sc = {};
      for (const z of all) if (z.svScene != null) zs.sc[z.svScene] = (zs.sc[z.svScene] || 0) + 1;
    }
  }
  function buildZone(id, Z) {
    const W = G.World;
    R.doors = {};
    // el descanso (la avenida de entrada no tiene: el fuego está en la plaza de la ciudad)
    const Rr = Z.rest;
    if (Rr) {
      if (Rr.fire) R.restFire = fire(Rr.x, Rr.z, !!S.visited[id]);
      prop({ x: Rr.x, z: Rr.z, reach: Rr.reach || 2.2, lab: () => (S.visited[id] || Rr.bed || Rr.basic ? (Rr.bed || Rr.basic ? Rr.label : 'Descansar junto al fuego') : Rr.label),
        off: () => !!R.carry, use: () => { restStart(id); return null; } });
    }
    // la mesa de trabajo (el escondite)
    if (Z.bench) prop({ x: Z.bench.x, z: Z.bench.z, fx: Z.bench.fx, fz: Z.bench.fz, reach: 1.9, label: Z.bench.label, use: () => { openRest(id, 'mejorar', true); return null; } });
    // las salidas: la marca de la Trece (o la boca del subte) y el camino: a un paso o, si no hace falta, directo
    // (el taller de la persiana y el coche de la Trece, antes que las salidas: las salidas los usan)
    if (Z.pasaje) pasaje(Z.pasaje);
    if (Z.car) parkedCar(Z.car);
    for (const X of Z.exits) {
      if (X.mark) trailMark(X.mark[0], X.mark[1]);
      if (X.subte) subteMouth(X.subte.x, X.subte.z, X.subte.ry || 0);
      if (X.pers) {
        // la manivela de la persiana (se mantiene: ver updatePers): la de fuera o la de dentro del pasillo
        const kind = X.pers === 'in' ? 'in' : 'out', C = crankSpot(kind), Wh = wheelAt(kind);
        X.x = C.x; X.z = C.z;
        prop({ x: C.x, z: C.z, fx: Wh.x, fz: Wh.z, reach: 1.6, label: X.label, off: () => !!R.carry || !!R.pers,
          use: (p) => { persStart(p, kind); return null; } });
        continue;
      }
      prop({ x: X.x, z: X.z, reach: 2.4, label: X.label, off: () => !!R.carry || !!R.pers,
        use: () => { if (X.direct) goZone(X.to, id); else if (X.car) goCar(X.to, id); else goPaso(X.paso, id); return null; } });
    }
    // los caminos cortados (por ahora no llevan a ninguna parte)
    for (const C of Z.closed || []) prop({ x: C.x, z: C.z, reach: 2.8, label: C.label, use: () => 'Por aquí no se pasa. Todavía no' });
    if (id === 'garita') garitaDecor();
    // el escondite: si volvió herida a dormir, las vendas usadas junto al saco y una nota suya en la mesa
    if (Z.hub && S.wounds > 0) {
      for (const [x, z, r] of [[20.2, 38.4, 0.3], [19.8, 40.6, 0.2], [21.9, 41.2, 0.25]]) mesh((m) => { m.box(0, 0.012, 0, r, 0.02, r * 0.7, 0xd8cfc0); m.box(0.03, 0.025, 0.01, r * 0.5, 0.005, r * 0.35, 0x8a2a22); }, x, gy(x, z), z, x * 3);
      const nx = 27.0, nz = 40.6;
      mesh((m) => { m.box(0, 0.006, 0, 0.21, 0.012, 0.28, 0xe8e0cc); m.box(0.02, 0.014, -0.02, 0.16, 0.004, 0.003, 0x6a6458); }, nx, gy(nx, nz) + 0.82, nz, 0.4);
      const k = Math.min(EIRA_NOTES.length, S.wounds) - 1;
      prop({ x: nx, z: nz - 0.8, fx: nx, fz: nz, reach: 1.6, label: 'Leer la nota de la mesa', use: () => { noteUI('Una nota suya, a lápiz', EIRA_NOTES[k]); return null; } });
    }
    // la ciudad: los pisos de arriba y la escalera de mano
    if (Z.aptos) { setupAptos(id, Z); setupLadder(id, Z); }
    // los hallazgos de la zona que no se han cogido todavía
    for (const f of Z.finds || []) {
      if (S.took[f.id]) continue;
      const q = freeNear(f.x, f.z, 0.25);
      addFind(f, q.x, q.z, 0);
    }
    // las notas sueltas que quedan por coger y lo que se mueve (pájaros, humo, el cartel, los ruidos)
    placeNotes(Z.notes, Z);
    if (Z.life) setupLife(Z);
    // al entrar: dónde se está
    setTimeout(() => { if (active && R && S && S.zone === id && S.where === 'zone' && !trip && !R.pers) host.toast(Z.name + (S.visited[id] || !Rr ? '' : (Rr.fire ? ' · busca el fuego para descansar' : '')), 'good'); }, 700);
  }
  function addFind(f, x, z, lv) {
    const it = G.Pickups.add(f.kind, f.n || 1, { x, y: G.World.groundY(x, z, lv), z, lv });
    it.svFind = f.id;
    if (G.Pickups.KINDS[f.kind] && G.Pickups.KINDS[f.kind].weapon) it.cond = f.n || 1;
    R.finds.push({ f, it });
    return it;
  }
  // la boca del subte: el hueco de la escalera con su pretil y la barandilla, los escalones que bajan a lo oscuro y
  // el poste con el cartel redondo. (ry 0: baja hacia +z; se entra por el lado de -z)
  function subteMouth(x, z, ry) {
    const y = gy(x, z), w = 2.4, l = 4.2;
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry || 0; R.group.add(g);
    const m = new G.Mesher();
    for (const s2 of [-1, 1]) { m.box(s2 * (w / 2 + 0.08), 0.45, 0.05, 0.16, 0.9, l + 0.1, 0x8a8478); m.box(s2 * (w / 2 + 0.08), 1.05, 0.05, 0.05, 0.05, l + 0.1, 0x3a3e40); for (let k = 0; k < 4; k++) m.box(s2 * (w / 2 + 0.08), 0.95, -l / 2 + 0.3 + k * (l - 0.5) / 3, 0.04, 0.22, 0.04, 0x3a3e40); }
    m.box(0, 0.45, l / 2 + 0.08, w + 0.32, 0.9, 0.16, 0x8a8478);
    // los escalones: cada vez más oscuros (bajan a lo negro)
    for (let k = 0; k < 7; k++) { const c = Math.round(0x6a * (1 - k / 7.5)); m.box(0, 0.012 + 0.002 * (7 - k), -l / 2 + 0.25 + k * 0.42, w, 0.02, 0.42, (c << 16) | (c << 8) | Math.round(c * 0.96)); }
    m.box(0, 0.01, l / 2 - 0.6, w, 0.02, 1.2, 0x060606);
    // el poste con el cartel
    m.cyl(-w / 2 - 0.5, 1.3, -l / 2 + 0.3, 0.05, 0.05, 2.6, 0x3a3e40, 6);
    m.cyl(-w / 2 - 0.5, 2.5, -l / 2 + 0.3, 0.34, 0.34, 0.05, 0x1e3a6a, 14, undefined, Math.PI / 2, 0, 0);
    m.cyl(-w / 2 - 0.5, 2.5, -l / 2 + 0.33, 0.22, 0.22, 0.02, 0xe8e2d0, 14, undefined, Math.PI / 2, 0, 0);
    const mm = new THREE.Mesh(m.build(), M().body); mm.castShadow = true; mm.receiveShadow = true; g.add(mm);
    const c = Math.cos(ry || 0), sn = Math.sin(ry || 0), hw = (Math.abs(c) * w + Math.abs(sn) * l) / 2 + 0.1, hl = (Math.abs(sn) * w + Math.abs(c) * l) / 2 + 0.1;
    blocker(x - hw, z - hl + (c > 0.5 ? 0.15 : 0), x + hw, z + hl, 1.0);
  }

  // un estorbo partido por los bordes de los trozos del mundo (cada trozo mira solo lo suyo)
  function blockerSplit(x0, z0, x1, z1, h) {
    const out = [], cut = (a0, a1) => { const r = []; let a = a0; while (a < a1 - 1e-6) { const b = Math.min(a1, (Math.floor(a / 32) + 1) * 32); r.push([a, b]); a = b; } return r; };
    for (const [a, b] of cut(x0, x1)) for (const [c, d] of cut(z0, z1)) out.push(blocker(a, c, b, d, h));
    return out;
  }

  // ---------- el coche de la Trece: uno cualquiera, de un color que se elige una vez (aparcado donde lo dejó) ----------
  const CAR_COLS = [0x6a5a3a, 0x3e4a52, 0x5a6a5a, 0x7a3a2e, 0x8a8f86, 0x4a4a46, 0x2e3e4a, 0x7a6a52];
  function carCol() { if (!S.car) S.car = { col: CAR_COLS[Math.floor(Math.random() * CAR_COLS.length)] }; return S.car.col; }
  function parkedCar(C) {
    const T = G.Furniture.T.coche, along = Math.abs(C.fz) > 0.5, hw = (along ? T.w : T.d) / 2, hd = (along ? T.d : T.w) / 2;
    const f = { type: 'coche', x0: C.x - hw, x1: C.x + hw, z0: C.z - hd, z1: C.z + hd, h: T.h, fx: C.fx, fz: C.fz, col: carCol(), seed: 1313, lv: 0, y: gy(C.x, C.z), cont: null, solid: true };
    mesh((m) => G.Furniture.draw(m, f), 0, 0, 0, 0);
    blockerSplit(f.x0 + 0.08, f.z0 + 0.1, f.x1 - 0.08, f.z1 - 0.1, 1.4);
  }
  // la garita: la reja que Grimes reventó con el coche aquella noche (en el patio, doblada, con la hierba entre los
  // barrotes) y las marcas de las ruedas, casi borradas
  function garitaDecor() {
    for (const [x, z, a, tilt] of [[51.0, 56.6, 0.5, 0.06], [54.8, 57.8, -0.35, 0.1], [52.6, 59.8, 1.2, 0.04]]) {
      const o = mesh((m) => {
        for (let q = -0.9; q <= 0.91; q += 0.24) m.box(q, 0.05, 0, 0.04, 0.04, 2.6, 0x4a3e34);
        for (const w of [-1.1, 0, 1.1]) m.box(0, 0.06, w, 2.0, 0.05, 0.06, 0x3e342c);
        for (const [qx, qz, h] of [[0.4, 0.5, 0.34], [-0.5, -0.7, 0.26], [0.1, -0.2, 0.2]]) m.box(qx, 0.04 + h / 2, qz, 0.16, h, 0.2, 0x5a6e40);
      }, x, gy(x, z) + 0.02, z, a);
      o.rotation.z = tilt;
    }
    for (const dx of [-0.78, 0.78]) { const o = mesh((m) => { m.box(0, 0.006, -2.2, 0.16, 0.008, 3.2, 0x5a5854); m.box(0.05, 0.006, 1.6, 0.14, 0.008, 2.6, 0x5e5c58); }, 53 + dx, gy(53, 58) + 0.012, 58.2, 0.05); o.castShadow = false; }
  }

  // ---------- el taller de la persiana (la avenida ↔ la ciudad; el bosque del escondite ↔ la garita) ----------
  // Un taller bajo de bloques con un pasillo de lado a lado; en la boca de fuera, una persiana de chapa enrollable con
  // su manivela (y, si se cruza en los dos sentidos, otra por dentro del pasillo). El mismo en los dos mapas (en uno,
  // cerrado al fondo; en el otro, abierto a la calle o al patio): así, mientras la cámara mira la persiana de cerca, el
  // mapa de detrás puede cambiar sin que se note. Local: u hacia fuera, w a lo largo de la boca; la boca en u 0 y el
  // taller de u -8 a 0. dir: hacia dónde mira la boca (E por defecto)
  const PAS = { D: 8, W: 6, H: 6.4, hw: 1.8, hh: 3.1, mx: 2.5, cu: 0.66 };
  const PERS_T = 7.0, PERS_CAP = 0.2;            // lo que tarda en subir entera; hasta dónde sube mientras el otro lado no está
  const PAS_DIR = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };
  function pasFrame(P0) {
    const o = PAS_DIR[P0.dir || 'E'], ry = Math.atan2(-o[1], o[0]);
    return { ox: o[0], oz: o[1], sx: Math.round(Math.sin(ry)), sz: Math.round(Math.cos(ry)), ry };
  }
  // de lo local del taller al mapa
  const pasW = (P0, F, u, w) => ({ x: P0.x + u * F.ox + w * F.sx, z: P0.z + u * F.oz + w * F.sz });
  function pasRect(P0, F, u0, w0, u1, w1) { const a = pasW(P0, F, u0, w0), b = pasW(P0, F, u1, w1); return [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)]; }
  function pasaje(P0) {
    const F = pasFrame(P0), ap = pasW(P0, F, 1.5, 0), x = P0.x, z = P0.z, y = gy(ap.x, ap.z);
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = F.ry; R.group.add(g);
    const m = new G.Mesher();
    const wall = 0x8a7a62, dk = 0x6a5c4a, inner = 0x3e3a34, iron = 0x3a3c3e;
    // los dos lados (de bloques, con el zócalo sucio), el muro sobre el pasillo, el pretil
    for (const e of [-1, 1]) {
      m.box(-PAS.D / 2, PAS.H / 2, e * (PAS.hw + PAS.W) / 2, PAS.D, PAS.H, PAS.W - PAS.hw, wall);
      m.box(0.02, 0.6, e * (PAS.hw + PAS.W) / 2, 0.06, 1.2, PAS.W - PAS.hw, dk);
      for (let q = 1.6; q < PAS.H - 0.5; q += 1.4) m.box(0.015, q, e * (PAS.hw + PAS.W) / 2, 0.03, 0.04, PAS.W - PAS.hw - 0.2, U.shade(wall, 0.9));
      // la enredadera que sube por un lado (el bosque llega a todo)
      if (e > 0) { m.box(0.07, 1.9, e * 4.6, 0.06, 3.8, 0.9, 0x4e6238); m.box(0.09, 3.2, e * 4.9, 0.08, 1.4, 0.6, 0x5a6e40); }
    }
    m.box(-PAS.D / 2, (PAS.H + PAS.hh) / 2, 0, PAS.D, PAS.H - PAS.hh, PAS.hw * 2, wall);
    m.box(-PAS.D / 2, PAS.H + 0.3, 0, PAS.D + 0.2, 0.6, PAS.W * 2 + 0.2, dk);
    // el pasillo por dentro: suelo, paredes y techo oscuros (en un lado, cerrado al fondo)
    m.box(-PAS.D / 2, 0.02, 0, PAS.D, 0.04, PAS.hw * 2, 0x4a4844);
    for (const e of [-1, 1]) m.box(-PAS.D / 2, PAS.hh / 2, e * (PAS.hw - 0.01), PAS.D, PAS.hh, 0.02, inner);
    m.box(-PAS.D / 2, PAS.hh - 0.01, 0, PAS.D, 0.02, PAS.hw * 2, 0x2e2c28);
    if (!P0.open) m.box(-PAS.D + 0.05, PAS.hh / 2, 0, 0.1, PAS.hh, PAS.hw * 2, 0x1a1816);
    // la boca: las guías, la caja de la persiana y el delantal de hormigón de fuera
    for (const e of [-1, 1]) m.box(0.05, PAS.hh / 2, e * (PAS.hw + 0.04), 0.12, PAS.hh, 0.1, iron);
    m.box(0.18, PAS.hh + 0.25, 0, 0.36, 0.5, PAS.hw * 2 + 0.4, 0x4a4c4e);
    m.box(1.6, 0.025, 0, 3.2, 0.05, PAS.W * 2, 0x7a766e);
    // el rótulo de encima (las letras se borraron hace mucho)
    m.box(0.04, 4.5, 0, 0.06, 0.9, 5.2, 0x6a5040); m.box(0.075, 4.5, 0, 0.01, 0.6, 4.6, 0x9a8a6a);
    // la caja del engranaje de la manivela, en la pared (a la derecha, mirando la persiana); y la de dentro, en la
    // pared del pasillo, junto a la persiana
    if (P0.crank) m.box(0.08, 1.1, PAS.mx, 0.16, 0.5, 0.4, 0x3a3634);
    if (P0.inner) { m.box(-0.95, 1.1, PAS.hw - 0.08, 0.42, 0.5, 0.16, 0x3a3634); m.box(-0.95, 2.0, PAS.hw - 0.03, 0.05, 1.3, 0.05, 0x2e2c2a); }
    const st = new THREE.Mesh(m.build(), M().body); st.castShadow = true; st.receiveShadow = true; g.add(st);
    // la persiana: lamas de chapa; al subir se esconde dentro del muro de arriba
    const sm = new G.Mesher();
    for (let q = 0, i = 0; q < PAS.hh - 0.01; q += 0.13, i++) sm.box((i & 1) * 0.012, q + 0.065, 0, 0.05, 0.142, PAS.hw * 2 + 0.04, (i & 1) ? 0x6e7072 : 0x7c7e80);
    sm.box(0.02, 0.05, 0, 0.08, 0.1, PAS.hw * 2 + 0.06, 0x4a4c4e);
    const sh = new THREE.Mesh(sm.build(), M().body); sh.position.set(-0.12, 0, 0); sh.castShadow = true; sh.receiveShadow = true; g.add(sh);
    // las ruedas de las manivelas (gira la de dentro de cada una: rotation.x)
    const wheels = {};
    const wheel = (px, py, pz, ry) => {
      const piv = new THREE.Group(); piv.position.set(px, py, pz); piv.rotation.y = ry; g.add(piv);
      const sp = new THREE.Group(); piv.add(sp);
      const wm = new G.Mesher();
      for (let k = 0; k < 4; k++) wm.box(0, 0, 0, 0.03, 0.44, 0.03, 0x6a4a30, 0, undefined, k * Math.PI / 4);
      wm.cyl(0, 0, 0, 0.23, 0.23, 0.04, 0x5a3e28, 12, undefined, 0, 0, Math.PI / 2);
      wm.cyl(0.08, 0.17, 0, 0.022, 0.022, 0.16, 0x8a6a48, 6, undefined, 0, 0, Math.PI / 2);
      sp.add(new THREE.Mesh(wm.build(), M().body));
      return sp;
    };
    if (P0.crank) wheels.out = wheel(0.24, 1.1, PAS.mx, 0);
    if (P0.inner) wheels.in = wheel(-0.95, 1.1, PAS.hw - 0.24, Math.PI / 2);
    // lo que choca: los dos lados, el fondo (si está cerrado) y la persiana mientras esté bajada
    const B = (u0, w0, u1, w1, h) => { const r = pasRect(P0, F, u0, w0, u1, w1); return blockerSplit(r[0], r[1], r[2], r[3], h); };
    B(-PAS.D, PAS.hw, 0, PAS.W, PAS.H); B(-PAS.D, -PAS.W, 0, -PAS.hw, PAS.H);
    if (!P0.open) B(-PAS.D, -PAS.hw, -PAS.D + 0.12, PAS.hw, PAS.hh);
    const blk = B(-0.3, -PAS.hw, 0.05, PAS.hw, PAS.hh);
    R.pas = { P0, F, g, sh, wheels, blk, k: 0, y };
  }
  function pasSet(k) { const A = R && R.pas; if (!A) return; A.k = k; A.sh.position.y = k * (PAS.hh - 0.04); }
  // dónde se pone la Trece para girar cada manivela, hacia dónde mira y dónde está la rueda
  function crankSpot(kind) { const A = R.pas; return kind === 'in' ? pasW(A.P0, A.F, -0.95, PAS.hw - 0.62) : pasW(A.P0, A.F, PAS.cu, PAS.mx); }
  function crankFace(kind) { const F = R.pas.F; return kind === 'in' ? Math.atan2(F.sx, F.sz) : Math.atan2(-F.ox, -F.oz); }
  function wheelAt(kind) { const A = R.pas; return kind === 'in' ? pasW(A.P0, A.F, -0.95, PAS.hw - 0.24) : pasW(A.P0, A.F, 0.24, PAS.mx); }

  // ---------- la persiana: de un mapa a otro sin pantalla de carga ----------
  // Se mantiene Recoger en la manivela. La cámara se acerca a la persiana (un plano fijo, cerca: solo se ven la
  // persiana, el muro y la Trece) y, en cuanto llega, el mapa de aquí se deshace y el del otro lado empieza a armarse
  // detrás, poco a poco (la persiana y el muro son iguales en los dos sitios: no se nota). La persiana sube, pero no
  // del todo hasta que el otro lado está listo (piece: solo lo de alrededor del taller; el resto, mientras pasa).
  // Arriba: la Trece pasa sola (sin apuntar), la cámara la ve entrar y la recibe al otro lado; vuelve el control y la
  // persiana baja a su espalda. kind: 'out' (la manivela de fuera: se entra por el pasillo) o 'in' (la de dentro: se
  // sale por la boca)
  let cine = false;
  const cineInput = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
  const cineCam = { yaw: 0, forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }, right() { return { x: -Math.cos(this.yaw), z: Math.sin(this.yaw) }; } };
  const _q = new THREE.Quaternion(), _o = new THREE.PerspectiveCamera();          // (_o: una cámara, para que lookAt mire como las cámaras)
  const chasing = (p, d) => G.Population.list.some((z) => z.alive && !z.human && Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) < d && (z.state === 'chase' || z.state === 'stalk' || z.state === 'attack'));
  function persPose(p, kind) {
    const C = crankSpot(kind), f = crankFace(kind);
    p.pos.x = C.x; p.pos.z = C.z; p.facing = f;
    if (p.vel) { p.vel.x = 0; p.vel.z = 0; }
    if (!p.action || p.action.done || !p.action.svCrank) p.action = { kind: 'search', t: 0, dur: 0.75, impact: 2, face: f, low: false, done: false, svCrank: true };
  }
  function persStart(p, kind) {
    kind = kind || 'out';
    if (busy() || !R.pas || !R.pas.P0.to || R.pers || p.busy() || p.dead) return;
    if (chasing(p, 14)) { host.toast('Con infectados detrás no te da tiempo: quítatelos de encima', 'warn'); return; }
    const cam = host.camera;
    R.pers = { phase: 'zoom', kind, t: 0, k: R.pas.k, from: cam.position.clone(), fq: cam.quaternion.clone(), swapped: false, tick: 0, told: false };
    cine = true;
    cineInput.move.x = cineInput.move.y = 0;
    p.aiming = false;
    G.Camera.held = true;
    persPose(p, kind);
  }
  // el plano fijo de la persiana (respecto a su boca). Fuera: algo a la izquierda, mirando la persiana y la manivela.
  // Dentro: desde el fondo del pasillo, mirando la persiana y la manivela de la pared
  const SHOTS = { out: [[3.5, -0.9, 1.55], [0, 0.8, 1.3]], in: [[-4.6, -0.6, 1.6], [-0.3, 0.75, 1.25]] };
  function persShot(kind) {
    const A = R.pas, L = SHOTS[kind] || SHOTS.out, e = pasW(A.P0, A.F, L[0][0], L[0][1]), t = pasW(A.P0, A.F, L[1][0], L[1][1]);
    return { eye: new THREE.Vector3(e.x, A.y + L[0][2], e.z), at: new THREE.Vector3(t.x, A.y + L[1][2], t.z) };
  }
  function camTo(eye, at, u, fromP, fromQ) {
    const cam = host.camera;
    _o.position.copy(eye); _o.up.set(0, 1, 0); _o.lookAt(at); _q.copy(_o.quaternion);
    if (fromP && u < 1) { cam.position.copy(fromP).lerp(eye, u); cam.quaternion.copy(fromQ).slerp(_q, u); }
    else { cam.position.copy(eye); cam.quaternion.copy(_q); }
  }
  // ¿se puede subir del todo? (el otro lado: entero, o solo lo de alrededor del taller)
  function persReady(Q) {
    if (!Q.swapped) return false;
    if (!R.pas.P0.piece) return host.ready();
    const E = Q.endAt || (Q.endAt = walkPath(Q.kind).slice(-1)[0]);
    return G.World.readyNear(E.x, E.z, 12) && Q.sw > 1.4;
  }
  function updatePers(dt, p) {
    // (después de pasar: lo que aún falta del mapa; y, cuando está, sus infectados)
    if (R && R.fill) {
      host.poolStep();
      const ok = host.ready();
      G.World.setBoost(ok ? 0 : 16);
      if (ok) { const id = R.fill; R.fill = null; zombiesZone(id, ZONES[id], false); host.peace(false); }
    }
    const Q = R && R.pers;
    if (!Q) return;
    const A = R.pas;
    Q.t += dt;
    if (Q.phase === 'zoom' || Q.phase === 'crank') {
      const held = !!G.Input.lootHeld && !p.dead;
      // soltar antes de que cambie el mapa: se deja (la persiana baja por su peso y vuelve la cámara)
      if (!held && !Q.swapped) { persCancel(p); return; }
      persPose(p, Q.kind);
      const sh = persShot(Q.kind), u = U.smooth(U.clamp(Q.t / 0.9, 0, 1));
      camTo(sh.eye, sh.at, u, Q.from, Q.fq);
      G.Camera.fovOff = -22 * u;
      // (detrás, los cuerpos de los infectados del otro lado: un poco cada fotograma; el mapa ya se arma solo, y con
      // más tiempo por fotograma: la cámara está quieta, no se nota)
      if (Q.swapped) { Q.sw += dt; host.poolStep(); G.World.setBoost(host.ready() ? 0 : 18); }
      if (held) {
        Q.k = Math.min(persReady(Q) ? 1 : PERS_CAP, Q.k + dt / PERS_T);
        const Wh = A.wheels[Q.kind];
        if (Wh) Wh.rotation.x += dt * 5.2;
        if ((Q.tick -= dt) <= 0) { Q.tick = 0.32; snd('bClick', { x: A.P0.x, z: A.P0.z, vol: 0.5 }); }
      } else if (!Q.told) { Q.told = true; host.toast('Sigue girando: mantén Recoger', 'warn'); }
      pasSet(Q.k);
      if (Q.phase === 'zoom' && u >= 1) { Q.phase = 'crank'; if (!Q.swapped) persSwap(Q, p); }
      if (Q.k >= 1) persWalk(Q, p);
      return;
    }
    if (Q.phase === 'walk') {
      // pasa sola, sin apuntar; la cámara la mira pasar y, ya del otro lado, la espera
      p.aiming = false;
      if (!host.ready()) { host.poolStep(); G.World.setBoost(14); } else G.World.setBoost(0);
      let W = Q.path[Q.i], dx = W.x - p.pos.x, dz = W.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.45 && Q.i < Q.path.length - 1) { Q.i++; W = Q.path[Q.i]; dx = W.x - p.pos.x; dz = W.z - p.pos.z; d = Math.hypot(dx, dz); }
      cineCam.yaw = Math.atan2(dx, dz);
      cineInput.move.x = 0; cineInput.move.y = -0.55;
      const O = A.P0, F = A.F, hb = new THREE.Vector3(p.pos.x, A.y + 1.15, p.pos.z);
      const uP = (p.pos.x - O.x) * F.ox + (p.pos.z - O.z) * F.oz;
      const near = Q.kind === 'in' ? (Q.t < 2.4 && uP < 2.8) : (Q.t < 2.6 && uP > -4.5);
      if (near) {
        camTo(persShot(Q.kind).eye, hb, 1);
        G.Camera.fovOff = -22 + 10 * U.smooth(U.clamp(Q.t / 2.4, 0, 1));
      } else {
        const e = Q.kind === 'in' ? pasW(O, F, 13.0, -1.3) : pasW(O, F, -14.5, 3.2);
        camTo(new THREE.Vector3(e.x, A.y + (Q.kind === 'in' ? 1.9 : 1.8), e.z), hb, 1);
        G.Camera.fovOff = -8;
      }
      if ((Q.i >= Q.path.length - 1 && d < 0.5) || Q.t > 12) persEnd(p);
      return;
    }
    if (Q.phase === 'close') {
      // la persiana baja a su espalda (o, si se soltó a tiempo, por su peso)
      const k0 = Q.k;
      Q.k = Math.max(0, Q.k - dt / (Q.fall ? 1.2 : 1.6));
      pasSet(Q.k);
      if (k0 > 0 && Q.k === 0) { snd('clang', { x: A.P0.x, z: A.P0.z, vol: 0.7 }); R.pers = null; }
    }
  }
  function persCancel(p) {
    const Q = R.pers;
    cine = false;
    if (p.action && p.action.svCrank) p.action = null;
    G.Camera.held = false; G.Camera.fovOff = 0;
    R.pers = Q.k > 0 ? { phase: 'close', k: Q.k, fall: true, t: 0 } : null;
  }
  // el cambio: el mapa de aquí fuera, el del otro lado detrás (poco a poco). La Trece y la cámara, en el mismo sitio
  // respecto a la persiana del otro taller (los dos miran igual: basta con moverlo todo)
  function persSwap(Q, p) {
    const A0 = R.pas, to = A0.P0.to, Zt = ZONES[to], B = Zt.pasaje, cam = host.camera;
    const dx = B.x - A0.P0.x, dz = B.z - A0.P0.z, y0 = A0.y, wx = G.Sky ? G.Sky.weather : null;
    leaveHere();
    newScene();
    host.map(Zt.map, true);
    restorePlayer();
    applyHour();
    // (el mismo tiempo que aquí: que no cambie la luz de golpe)
    if (wx && G.Sky && G.Sky.set) G.Sky.set(hourDef(S.hour).h, wx);
    S.zone = to; S.where = 'zone'; S.paso = null;
    const C0 = pasW(B, pasFrame(B), Q.kind === 'in' ? -0.95 : PAS.cu, Q.kind === 'in' ? PAS.hw - 0.62 : PAS.mx);
    host.place(C0.x, C0.z, p.facing, true);
    G.Camera.held = true;
    buildZone(to, Zt);
    lootZone(to, Zt);
    host.peace(true);
    host.needPool();
    Q.swapped = true; Q.sw = 0;
    R.pers = Q;
    pasSet(Q.k);
    const dy = R.pas.y - y0;
    Q.from.x += dx; Q.from.y += dy; Q.from.z += dz;
    cam.position.x += dx; cam.position.y += dy; cam.position.z += dz;
    persPose(p, Q.kind);
    save();
    hud(true);
  }
  function walkPath(kind) {
    const A = R.pas, L = kind === 'in' ? [[-0.9, 0.3], [1.3, 0], [4.5, 0], [9.5, 0.1]] : [[1.1, 0.7], [-1.4, 0], [-PAS.D - 2.8, -0.2]];
    return L.map(([u, w]) => pasW(A.P0, A.F, u, w));
  }
  function persWalk(Q, p) {
    const O = R.pas.P0;
    G.World.setBoost(0);
    Q.phase = 'walk'; Q.t = 0; Q.i = 0;
    if (p.action && p.action.svCrank) p.action = null;
    for (const b of R.pas.blk) setSolid(b, false);
    snd('clang', { x: O.x, z: O.z, vol: 0.5 });
    G.Input.enabled = false; if (G.Input.clear) G.Input.clear();
    document.body.classList.add('sv-cine');
    Q.path = walkPath(Q.kind);
  }
  function persEnd(p) {
    const Q = R.pers, id = S.zone, Z = ZONES[id];
    cine = false;
    cineInput.move.x = cineInput.move.y = 0;
    document.body.classList.remove('sv-cine');
    G.Input.enabled = true; if (G.Input.clear) G.Input.clear();
    G.Camera.held = false; G.Camera.fovOff = 0; G.Camera.yaw = p.facing; G.Camera.pitch = 0.08;
    // la persiana baja a su espalda; y el sitio, con los suyos (si ya está todo; si no, en cuanto esté)
    for (const b of R.pas.blk) setSolid(b, true);
    snd('drag', { x: R.pas.P0.x, z: R.pas.P0.z, vol: 0.6 });
    R.pers = { phase: 'close', k: Q.k, t: 0 };
    if (host.ready()) { zombiesZone(id, Z, false); host.peace(false); G.World.setBoost(0); }
    else R.fill = id;
    save();
    hud(true);
    setTimeout(() => { if (active && S && S.zone === id) host.toast(Z.name, 'good'); }, 600);
  }

  // ---------- el coche: de la garita a la avenida de entrada (y de vuelta) ----------
  // Subir: un corte corto a negro; detrás, el mapa de llegada empieza a armarse (poco a poco: mientras se conduce)
  // y se sale a la carretera vieja (G.Drive con G.Road 'ruta', con la luz de la hora y, hacia la ciudad, sus torres
  // a lo lejos). Al final, el coche frena solo; si aún falta algo del mapa, espera. Otro corte y se baja, ya allí
  const TRIP_K = 17;
  let trip = null;
  function goCar(to, from) {
    const p = P();
    if (busy() || trip || R.pers || !G.Drive || p.busy() || p.dead) return;
    if (chasing(p, 12)) { host.toast('No puedes subir al coche con infectados detrás de ti', 'warn'); return; }
    snd('doorOpen', { x: p.pos.x, z: p.pos.z, vol: 0.6 });
    host.cut(() => startTrip(to, from), () => {
      if (G.Drive.active) G.Drive.hint(to === 'garita' ? 'De vuelta a la garita del depósito' : 'La carretera vieja lleva a la ciudad', 5);
    });
  }
  function startTrip(to, from) {
    const Z = ZONES[to], p = P();
    leaveHere();
    newScene();
    host.map(Z.map, true);
    restorePlayer();
    applyHour();
    S.zone = to; S.where = 'zone'; S.paso = null;
    const at = Z.arrive[from] || Z.spawn;
    host.place(at.x, at.z, at.face || 0, true);
    buildZone(to, Z);
    lootZone(to, Z);
    host.peace(true);
    host.needPool();
    p.hidden = true;
    trip = { to, from, at, t: 0, stopT: 0, braking: false, done: false };
    G.Drive.toRoad({ camera: host.camera, type: 'coche', col: carCol(), x: -1.9, z: 4, v: 0,
      road: { style: 'ruta', minK: -1, endK: TRIP_K, salt: to === 'garita' ? 2 : 1 }, look: { skyline: to !== 'garita' } });
    G.Drive.lightsOff = !!hourDef(S.hour).day;
    G.Drive.begin();
    copyLight();
    save();
    hud(true);
  }
  // (cada fotograma, conduciendo: lo que falta del mapa de llegada, la luz de la hora y el final del camino)
  function driveTick(dt) {
    if (!trip || !G.Drive.active) return;
    trip.t += dt;
    G.World.setBoost(host.ready() ? 0 : 9);          // (la carretera pesa poco: el mapa de llegada, algo más rápido)
    host.buildStep(dt);
    copyLight();
    const c = G.Drive.car, end = G.Road.endZ;
    if (!trip.braking && c.z > end - 80) {
      trip.braking = true;
      G.Drive.auto = { pts: [{ x: -1.9, z: end - 24 }], i: 0, spd: 10, stop: true };
      G.Drive.hint(trip.to === 'garita' ? 'La garita, al final del camino' : 'La avenida de entrada: de aquí no pasa el coche', 4);
    }
    const stopped = trip.braking && G.Drive.auto && G.Drive.auto.done && Math.abs(c.v) < 0.5;
    if (stopped) trip.stopT += dt;
    if (stopped && !trip.done && trip.stopT > 0.4 && (host.ready() || trip.stopT > 10)) { trip.done = true; arriveTrip(); }
  }
  function arriveTrip() {
    const T = trip, Z = ZONES[T.to], p = P();
    G.World.setBoost(0);
    host.cut(() => {
      G.Drive.stop(true);
      p.hidden = false;
      const sp = freeNear(T.at.x, T.at.z);
      host.place(sp.x, sp.z, T.at.face || 0, false);
      zombiesZone(T.to, Z, false);
      host.peace(false);
      trip = null;
      S.stats.trips = (S.stats.trips || 0) + 1;
      save();
      hud(true);
    }, () => { snd('doorClose', { x: p.pos.x, z: p.pos.z, vol: 0.6 }); host.toast(Z.name, 'good'); });
  }
  // la luz de la carretera: la misma que la del juego a esa hora (el cielo, la niebla, el sol y su dirección)
  function copyLight() {
    const sc = G.Drive.scene, ms = host.scene;
    if (!sc || !sc.userData.hemi || !host.hemi) return;
    const L = sc.userData;
    if (ms.fog) { sc.fog.color.copy(ms.fog.color); sc.background.copy(ms.background && ms.background.isColor ? ms.background : ms.fog.color); }
    L.hemi.color.copy(host.hemi.color); L.hemi.groundColor.copy(host.hemi.groundColor); L.hemi.intensity = host.hemi.intensity;
    L.sun.color.copy(host.sun.color); L.sun.intensity = host.sun.intensity;
    const so = G.Sky && G.Sky.sunOffset ? G.Sky.sunOffset() : [-16, 32, 11], c = G.Drive.car;
    L.sun.position.set(c.x + so[0], so[1], c.z + so[2]); L.sun.target.position.set(c.x, 0, c.z); L.sun.target.updateMatrixWorld();
  }

  // ---------- los pisos de arriba (la ciudad): la planta baja, atrancada; se entra por una ventana de arriba ----------
  const LAD_L = 4.3;
  const isWinE = (e, E) => e === E.WIN || e === E.WIN_OPEN || e === E.WIN_BROKEN;
  const isDoorE = (e, E) => e === E.DOOR || e === E.DOOR_OPEN || e === E.DOOR_BROKEN;
  const sameB = (a, b) => !!a && !!b && a.x0 === b.x0 && a.z0 === b.z0;
  const inBld = (B, x, z, lv) => sameB(G.World.bldAt(Math.floor(x), Math.floor(z), lv || 0), B);
  function outerEdges(B, lv) {
    const out = [];
    for (let z = B.z0 - 1; z <= B.z0 + B.h; z++) for (let x = B.x0 - 1; x <= B.x0 + B.w; x++) {
      if (!inBld(B, x + 0.5, z + 0.5, lv)) continue;
      if (!inBld(B, x + 0.5, z - 0.5, lv)) out.push({ ref: { o: 'N', x, z, lv }, mx: x + 0.5, mz: z, nx: 0, nz: -1 });
      if (!inBld(B, x + 0.5, z + 1.5, lv)) out.push({ ref: { o: 'N', x, z: z + 1, lv }, mx: x + 0.5, mz: z + 1, nx: 0, nz: 1 });
      if (!inBld(B, x - 0.5, z + 0.5, lv)) out.push({ ref: { o: 'W', x, z, lv }, mx: x, mz: z + 0.5, nx: -1, nz: 0 });
      if (!inBld(B, x + 1.5, z + 0.5, lv)) out.push({ ref: { o: 'W', x: x + 1, z, lv }, mx: x + 1, mz: z + 0.5, nx: 1, nz: 0 });
    }
    return out;
  }
  function redraw(B) {
    const W = G.World, seen = new Set();
    for (let z = B.z0 - 1; z <= B.z0 + B.h + 1; z++) for (let x = B.x0 - 1; x <= B.x0 + B.w + 1; x++) {
      const k = (x >> 5) + ',' + (z >> 5);
      if (seen.has(k)) continue;
      seen.add(k);
      const c = W.chunkAt(x >> 5, z >> 5);
      if (!c || !c.view) continue;
      const old = c.view; c.view = null;
      G.WorldView.build(c); G.WorldView.dispose({ view: old });
    }
  }
  // ¿se pisa? (fuera de las manzanas: en la calle, la plaza o el solar)
  function streetOk(Z, x, z) { return !zoneKeepOut(Z).some((r) => x > r[0] - 0.2 && x < r[2] + 0.2 && z > r[1] - 0.2 && z < r[3] + 0.2); }
  function setupAptos(id, Z) {
    const W = G.World, E = W.E, plan = (G.Maps.get(Z.map) || {}).plan, zs = zstate(id);
    zs.flags = zs.flags || {};
    R.aptos = [];
    if (!plan) return;
    for (const A of Z.aptos) {
      const bd = plan.blds.find((b) => b.role === A.role);
      const B = bd && W.bldAt(Math.floor((bd.rect[0] + bd.rect[2]) / 2), Math.floor((bd.rect[1] + bd.rect[3]) / 2), 0);
      if (!B) continue;
      const apt = { A, B, doors: [], lean: null, win: null };
      R.aptos.push(apt);
      // la planta baja: las puertas atrancadas (si no se quitó ya la tranca desde dentro) y las ventanas, cerradas
      let arch = false;
      for (const q of outerEdges(B, 0)) {
        const e = W.edgeGet(q.ref);
        if (isDoorE(e, E) || e === E.ARCH) {
          if (zs.flags[A.role]) continue;
          if (e === E.ARCH) arch = true;
          W.unlockEdge(q.ref); W.setEdge(q.ref, E.DOOR); W.lockEdge(q.ref);
          const d = Object.assign({ apt }, q);
          apt.doors.push(d); R.doors[W.edgeKey(q.ref)] = d;
        } else if (isWinE(e, E)) { if (e !== E.WIN) { W.setEdge(q.ref, E.WIN); if (W.clearGlass) W.clearGlass(q.ref); } W.lockEdge(q.ref); }
        else if (e === E.NONE) { W.setEdge(q.ref, E.WALL); W.lockEdge(q.ref); arch = true; }
      }
      // arriba: una ventana abierta que da a la calle, con sitio delante para la escalera
      for (const q of outerEdges(B, 1)) {
        if (!isWinE(W.edgeGet(q.ref), E)) continue;
        const fx = q.mx + q.nx * 1.7, fz = q.mz + q.nz * 1.7, ins = { x: q.mx - q.nx * 0.62, z: q.mz - q.nz * 0.62 };
        if (!streetOk(Z, fx, fz) || W.circleBlocked(fx, fz, 0.45, 0) || W.circleBlocked(q.mx + q.nx * 0.8, q.mz + q.nz * 0.8, 0.35, 0)) continue;
        if (!inBld(B, ins.x, ins.z, 1)) continue;
        const g0 = gy(fx, fz), hUp = G.World.groundY(ins.x, ins.z, 1) - g0, top = hUp + 1.0;
        if (!isFinite(hUp) || hUp < 1) continue;
        W.setEdge(q.ref, E.WIN_OPEN); if (W.clearGlass) W.clearGlass(q.ref);
        const th = Math.acos(Math.min(0.99, top / LAD_L)), hor = Math.sqrt(Math.max(0, LAD_L * LAD_L - top * top));
        apt.win = q;
        apt.lean = { th, hor, hUp, g0, ins, foot: { x: q.mx + q.nx * (hor + 0.06), z: q.mz + q.nz * (hor + 0.06) }, face: Math.atan2(-q.nx, -q.nz) };
        // (que no estorbe nada justo al entrar por la ventana)
        for (const o of W.furnNear(ins.x, ins.z, 0.9, 1)) if (o.f.solid && !o.f.gone) W.removeFurn(o.c, o.f);
        break;
      }
      if (arch) redraw(B);
      // dentro, arriba: lo que se encuentra (sitios al azar, pero siempre los mismos para cada piso)
      const rng = U.mulberry32(A.role.length * 977 + B.x0 * 31 + B.z0), spots = [];
      for (let z = B.z0; z < B.z0 + B.h; z++) for (let x = B.x0; x < B.x0 + B.w; x++) {
        const px = x + 0.5, pz = z + 0.5;
        if (!inBld(B, px, pz, 1) || W.stairAt(px, pz) || W.circleBlocked(px, pz, 0.3, 1) || !W.isIndoor(x, z, 1)) continue;
        if (apt.lean && Math.hypot(px - apt.lean.ins.x, pz - apt.lean.ins.z) < 1.2) continue;
        spots.push([px, pz]);
      }
      for (const f of A.finds) {
        if (!spots.length) break;
        const k = Math.floor(rng() * spots.length), sp = spots.splice(k, 1)[0];
        if (!S.took[f.id]) addFind(f, sp[0], sp[1], 1);
      }
    }
  }
  // las puertas atrancadas (interact.js): desde dentro se quita la tranca; desde fuera, no hay manera
  function doorLabel(ref, p) {
    const d = R && R.doors && R.doors[G.World.edgeKey(ref)];
    if (!d) return null;
    return inBld(d.apt.B, p.pos.x, p.pos.z, 0) ? 'Quitar la tranca' : 'Puerta atrancada';
  }
  function doorUse(ref, p) {
    const W = G.World, E = W.E, d = R && R.doors && R.doors[W.edgeKey(ref)];
    if (!d) return null;
    if (!inBld(d.apt.B, p.pos.x, p.pos.z, 0)) { snd('bang', { x: d.mx, z: d.mz, vol: 0.4 }); return d.apt.lean ? 'Atrancada por dentro. Arriba hay una ventana abierta...' : 'Atrancada por dentro'; }
    for (const q of d.apt.doors) { W.unlockEdge(q.ref); W.setEdge(q.ref, E.DOOR); delete R.doors[W.edgeKey(q.ref)]; }
    W.setEdge(ref, E.DOOR_OPEN);
    zstate(S.zone).flags[d.apt.A.role] = true;
    snd('doorOpen', { x: d.mx, z: d.mz, vol: 0.7 });
    return 'Quitas la tranca: desde ahora esta puerta se abre';
  }
  // la escalera de mano: tirada en el solar; se lleva al hombro y se apoya bajo la ventana de un piso
  function ladderDraw(p) {
    const wd = 0x8a7050, wd2 = 0x6e583e;
    for (const s2 of [-1, 1]) p.box(s2 * 0.22, LAD_L / 2, 0, 0.06, LAD_L, 0.07, wd);
    for (let y = 0.3; y < LAD_L - 0.1; y += 0.32) p.box(0, y, 0, 0.44, 0.045, 0.045, wd2);
  }
  function setupLadder(id, Z) {
    const zs = zstate(id);
    if (!zs.lad) zs.lad = { state: 'lying', x: Z.ladder.x, z: Z.ladder.z, yaw: Z.ladder.yaw, at: null };
    const st = zs.lad;
    if (st.state === 'carried') st.state = 'lying';
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); R.group.add(g);
    const m = new G.Mesher(); ladderDraw(m);
    const lm = new THREE.Mesh(m.build(), M().body); lm.castShadow = true; inner.add(lm);
    const lad = R.lad = { g, inner, st };
    const lay = (x, z, yaw) => {
      g.position.set(x - Math.sin(yaw) * LAD_L / 2, gy(x, z) + 0.05, z - Math.cos(yaw) * LAD_L / 2); g.rotation.set(0, yaw, 0);
      inner.rotation.set(Math.PI / 2, 0, 0); inner.position.set(0, 0, 0);
      st.state = 'lying'; st.x = x; st.z = z; st.yaw = yaw; st.at = null;
    };
    const lean = (apt) => {
      const Ln = apt.lean;
      g.position.set(Ln.foot.x, Ln.g0, Ln.foot.z); g.rotation.set(0, Ln.face, 0);
      inner.position.set(0, 0, 0); inner.rotation.set(Ln.th, 0, 0);
      st.state = 'placed'; st.at = apt.A.role;
    };
    lad.lay = lay;
    const placedAt = st.state === 'placed' && R.aptos.find((a) => a.A.role === st.at && a.lean);
    if (placedAt) lean(placedAt); else lay(st.x, st.z, st.yaw);
    const carry = (p) => { R.carry = { kind: 'escalera' }; p.carry = 'escalera'; p.carrySlow = 0.74; if (p.cur !== -1 && p.equip) p.equip(-1); p.aiming = false; st.state = 'carried'; st.at = null; snd('drag', { vol: 0.5 }); };
    const uncarry = (p) => { R.carry = null; p.carry = null; p.carrySlow = 1; };
    prop({ lab: () => 'Coger la escalera', x: st.x, z: st.z, reach: 2.0, id: 'lad_take',
      off: () => st.state !== 'lying' || !!R.carry,
      use: (p) => { if (p.busy() || p.dead) return null; carry(p); return 'Llevas la escalera: búscale una ventana abierta de un piso de arriba'; } });
    prop({ label: 'Dejar la escalera en el suelo', x: 0, z: 0, reach: 1.2, id: 'lad_drop',
      off: () => !R.carry || R.aptos.some((a) => a.lean && Math.hypot(P().pos.x - a.lean.foot.x, P().pos.z - a.lean.foot.z) < 2.6),
      use: (p) => { uncarry(p); const yaw = p.facing, cx = p.pos.x + Math.cos(yaw) * 0.6, cz = p.pos.z - Math.sin(yaw) * 0.6; lay(cx, cz, yaw); takeAt(cx, cz); snd('drag', { vol: 0.4 }); return null; } });
    const takeAt = (x, z) => { const q = R.props.find((o) => o.id === 'lad_take'); if (q) { q.x = x; q.z = z; } };
    takeAt(st.x, st.z);
    for (const apt of R.aptos) {
      if (!apt.lean) continue;
      const Ln = apt.lean, w = apt.win;
      const params = (down) => ({ down, face: Ln.face, h: Ln.hUp, foot: { x: Ln.foot.x + w.nx * 0.42, z: Ln.foot.z + w.nz * 0.42 }, top: { x: w.mx + w.nx * 0.42, z: w.mz + w.nz * 0.42 }, ins: Ln.ins });
      prop({ x: Ln.foot.x, z: Ln.foot.z, reach: 2.4, label: 'Apoyar la escalera bajo la ventana',
        off: () => !R.carry, use: (p) => { uncarry(p); lean(apt); snd('hitBlunt', { vol: 0.35 }); return 'Apoyada bajo la ventana de arriba'; } });
      prop({ x: Ln.foot.x + w.nx * 0.35, z: Ln.foot.z + w.nz * 0.35, reach: 1.6, label: 'Subir por la escalera',
        off: () => st.state !== 'placed' || st.at !== apt.A.role || !!R.carry,
        use: (p) => (p.startLadder && p.startLadder(params(false)) ? null : 'Ahora no puedes') });
      prop({ x: Ln.ins.x, z: Ln.ins.z, lv: 1, reach: 1.5, label: 'Bajar por la escalera',
        off: () => st.state !== 'placed' || st.at !== apt.A.role,
        use: (p) => (p.startLadder && p.startLadder(params(true)) ? null : 'Ahora no puedes') });
      prop({ x: Ln.foot.x - w.nx * 0.2, z: Ln.foot.z - w.nz * 0.2, reach: 1.4, label: 'Quitar la escalera',
        off: () => st.state !== 'placed' || st.at !== apt.A.role || !!R.carry || (P().lv || 0) !== 0,
        use: (p) => { if (p.busy() || p.dead) return null; carry(p); return 'Llevas la escalera'; } });
    }
  }
  // (la escalera al hombro: va con la protagonista)
  function updateCarry(p) {
    if (!R.carry || !R.lad) return;
    const f = p.facing, fx = Math.sin(f), fz = Math.cos(f), rx = Math.cos(f), rz = -Math.sin(f);
    const y = p.y != null ? p.y : gy(p.pos.x, p.pos.z);
    R.lad.g.position.set(p.pos.x - rx * 0.28 - fx * (LAD_L * 0.42), y + 1.38, p.pos.z - rz * 0.28 - fz * (LAD_L * 0.42));
    R.lad.g.rotation.set(0, f, 0);
    R.lad.inner.rotation.set(Math.PI / 2 - 0.08, 0, 0); R.lad.inner.position.set(0, 0, 0);
    const dq = R.props.find((q) => q.id === 'lad_drop');
    if (dq) { dq.x = p.pos.x + fx * 0.5; dq.z = p.pos.z + fz * 0.5; }
  }
  // los hallazgos: se cogen como cualquier otro objeto; si ya no están en el suelo, se cogieron
  function syncFinds() {
    if (!R) return;
    for (const F of R.finds) if (!S.took[F.f.id] && G.Pickups.list.indexOf(F.it) < 0) S.took[F.f.id] = true;
  }
  // lo que no se pisa de una zona (manzanas de edificios cerradas, el escondite...)
  function zoneKeepOut(Z) {
    const m = G.Maps.get(Z.map), P0 = m && m.plan;
    return (Z.keepOut || []).concat(P0 ? P0.blocks.map((b) => [b.x0, b.z0, b.x1, b.z1]) : []);
  }
  // lo que hay por el suelo: lo que se dejó al irse o, si se descansó desde entonces, lo nuevo
  const LOOT_W = (Z, H) => ({ sv_comida: 3, sv_agua: 2.2, sv_sucia: 2.2, sv_crudo: Z.crudo || 0.4, sv_sup: 1.4 * H.sup, _ammo: 3.2, venda: 0.35, alcohol: 1.6, trapo: 1.4, clavos: 0.8, polvo: 0.45, botella: 0.8, ladrillo: 0.6 });
  function lootZone(id, Z) {
    const zs = zstate(id);
    if (zs.left && zs.lootAt >= S.rests) {
      for (const o of zs.left) { if (!G.Pickups.KINDS[o.id]) continue; const it = G.Pickups.add(o.id, o.n, o); if (o.cond != null) it.cond = o.cond; }
      return;
    }
    // (las armas que se soltaron al coger otra no desaparecen: siguen donde se dejaron)
    for (const o of zs.left || []) { const K = G.Pickups.KINDS[o.id]; if (!K || !K.weapon) continue; const it = G.Pickups.add(o.id, o.n, o); if (o.cond != null) it.cond = o.cond; }
    const H = hourDef(S.hour), n = Math.max(2, Math.round(Z.loot * H.loot));
    if (Z.own) ownLoot(Z, n, LOOT_W(Z, H)); else G.Pickups.spawn(n, { weights: LOOT_W(Z, H) });
    if (Z.inside) insideLoot(Z, LOOT_W(Z, H));
    zs.lootAt = S.rests; zs.left = null;
  }
  // (las zonas grandes: por las calles, la plaza, el solar y dentro de los kioscos; nunca dentro de una manzana)
  function ownLoot(Z, n, w0) {
    const W = G.World, p = P(), m = G.Maps.get(Z.map), A = (m.play && m.play[0]) || [m.min + 2, m.min + 2, m.max - 2, m.max - 2], ko = zoneKeepOut(Z);
    const w = Object.assign({}, w0);
    if (w._ammo != null) { const am = G.Pickups.ammoWeights ? G.Pickups.ammoWeights(p, w._ammo) : {}; delete w._ammo; for (const k in am) w[k] = (w[k] || 0) + am[k]; }
    const ids = Object.keys(w).filter((k) => G.Pickups.KINDS[k] && w[k] > 0), tot = ids.reduce((a, k) => a + w[k], 0);
    const pick = () => { let r = Math.random() * tot; for (const k of ids) { r -= w[k]; if (r <= 0) return k; } return ids[0]; };
    const made = [];
    for (let i = 0, t = 0; i < n && t < n * 40; t++) {
      const x = rnd(A[0] + 1, A[2] - 1), z = rnd(A[1] + 1, A[3] - 1);
      if (ko.some((r) => x > r[0] - 0.3 && x < r[2] + 0.3 && z > r[1] - 0.3 && z < r[3] + 0.3)) continue;
      if (!onWalk(m, x, z)) continue;
      if (W.circleBlocked(x, z, 0.4, 0) || Math.hypot(x - p.pos.x, z - p.pos.z) < 3 || made.some((q) => Math.hypot(q[0] - x, q[1] - z) < 5)) continue;
      G.Pickups.add(pick(), null, { x, y: W.groundY(x, z, 0), z, lv: 0 });
      made.push([x, z]); i++;
    }
  }
  // (los mapas que dicen lo que se pisa, m.walk: solo ahí; no detrás de los edificios)
  const onWalk = (m, x, z) => !m.walk || m.walk.some((r) => x > r[0] + 0.6 && x < r[2] - 0.6 && z > r[1] + 0.6 && z < r[3] - 0.6);
  // los infectados de la zona: los de siempre (según la hora) o, si no se descansó desde que te fuiste, los que quedaban
  function zombiesZone(id, Z, refresh) {
    const zs = zstate(id), H = hourDef(S.hour);
    // (el refugio: nadie)
    if (Z.safe) { zs.zAt = S.rests; return; }
    let n = Math.round(Z.zombies * H.zk), st = Z.hub ? 0 : H.stalk * (Z.big ? 2 : 1), bl = Z.hub ? 0 : H.blind * (Z.big ? 2 : 1);
    if (Z.hub && !H.day) n += 1;
    if (!refresh && zs.zAt >= S.rests && zs.alive != null) { const tot = n + st + bl; const k = tot ? zs.alive / tot : 0; n = Math.round(n * k); st = Math.round(st * k); bl = Math.round(bl * k); }
    zs.zAt = S.rests;
    spawnAmbient(Z, n, st, bl);
    sceneZombies(id, Z, refresh);
  }
  function spawnAmbient(Z, n, st, bl) {
    const W = G.World, p = P(), m = G.Maps.get(Z.map), A = (m.play && m.play[0]) || [m.min + 2, m.min + 2, m.max - 2, m.max - 2];
    const away = [[p.pos.x, p.pos.z, 16]].concat(Z.rest ? [[Z.rest.x, Z.rest.z, 14]] : [], Z.exits.map((X) => [X.x, X.z, 9]));
    const ko = zoneKeepOut(Z);
    const kinds = [];
    for (let i = 0; i < n; i++) kinds.push('runner');
    for (let i = 0; i < st; i++) kinds.push('stalker');
    for (let i = 0; i < bl; i++) kinds.push('blind');
    let made = 0;
    for (const kind of kinds) {
      for (let t = 0; t < 60; t++) {
        const x = rnd(A[0] + 1, A[2] - 1), z = rnd(A[1] + 1, A[3] - 1);
        if (away.some((a) => Math.hypot(x - a[0], z - a[1]) < a[2])) continue;
        // (las zonas grandes: casi todos, a media distancia de donde llegas; lo de muy lejos, más tranquilo)
        if (Z.big && t < 30 && Math.hypot(x - p.pos.x, z - p.pos.z) > 62) continue;
        if (ko.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3])) continue;
        if (!onWalk(m, x, z) || W.circleBlocked(x, z, 0.4, 0)) continue;
        if (t < 40 && W.isIndoor(Math.floor(x), Math.floor(z), 0) && Math.random() < 0.7) continue;
        const zb = new G.Zombie(host.scene, x, z, null, Math.random() * TAU, { lv: 0, stalker: kind === 'stalker', blind: kind === 'blind' });
        zb.svAmb = true; zb.state = 'idle'; zb.timer = 1 + Math.random() * 6; zb.target = null; zb.notice = 0;
        G.Population.list.push(zb);
        made++;
        break;
      }
    }
    return made;
  }

  // ================= Los locales de dentro, las notas y las escenas =================
  // un edificio del plano de la zona (por su papel: 'farmacia', 'apto1'...) y los sitios libres de dentro
  function bldRole(Z, role) {
    const plan = Z && (G.Maps.get(Z.map) || {}).plan, bd = plan && plan.blds.find((b) => b.role === role);
    return bd ? G.World.bldAt(Math.floor((bd.rect[0] + bd.rect[2]) / 2), Math.floor((bd.rect[1] + bd.rect[3]) / 2), 0) : null;
  }
  function spotsIn(B, lv) {
    const W = G.World, out = [];
    if (!B) return out;
    for (let z = B.z0; z < B.z0 + B.h; z++) for (let x = B.x0; x < B.x0 + B.w; x++) {
      const px = x + 0.5, pz = z + 0.5;
      if (!inBld(B, px, pz, lv) || W.stairAt(px, pz) || W.circleBlocked(px, pz, 0.3, lv) || !W.isIndoor(x, z, lv)) continue;
      out.push([px, pz]);
    }
    return out;
  }
  // (los sitios de las notas: siempre el mismo para cada nota)
  const strHash = (t) => { let h = 7; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h; };
  function lootPicker(w0) {
    const w = Object.assign({}, w0);
    if (w._ammo != null) { const am = G.Pickups.ammoWeights ? G.Pickups.ammoWeights(P(), w._ammo) : {}; delete w._ammo; for (const k in am) w[k] = (w[k] || 0) + am[k]; }
    const ids = Object.keys(w).filter((k) => G.Pickups.KINDS[k] && w[k] > 0), tot = ids.reduce((a, k) => a + w[k], 0);
    return () => { let r = Math.random() * tot; for (const k of ids) { r -= w[k]; if (r <= 0) return k; } return ids[0]; };
  }
  // lo que hay dentro de los locales de la ciudad (fuera de las calles: ownLoot no entra en las manzanas)
  function insideLoot(Z, w0) {
    const pick = lootPicker(w0), W = G.World;
    for (const role in Z.inside) {
      const sp = spotsIn(bldRole(Z, role), 0);
      for (let i = 0; i < Z.inside[role] && sp.length; i++) {
        const [x, z] = sp.splice(Math.floor(Math.random() * sp.length), 1)[0];
        G.Pickups.add(pick(), null, { x, y: W.groundY(x, z, 0), z, lv: 0 });
      }
    }
  }

  // ---------- las notas: un papel en el suelo (con una piedra encima si está fuera), con el borde amarillo de cerca ----------
  let hullMat = null;
  function placeNotes(list, Z) {
    if (!list || !G.Calm || !G.Calm.Notes) return;
    for (const L of list) {
      const id = L[2], o = L[3] || {}, lv = o.lv || 0;
      if (!SV_LORE[id] || hasNote(id)) continue;
      let x = L[0], z = L[1];
      if (o.inside) {
        const sp = spotsIn(bldRole(Z, o.inside), lv);
        if (!sp.length) continue;
        [x, z] = sp[strHash(id) % sp.length];
      } else { const q = freeNear(x, z, 0.3); x = q.x; z = q.z; }
      notePaper(x, z, lv, id);
    }
  }
  function notePaper(x, z, lv, id) {
    const W = G.World, y = W.groundY(x, z, lv), out = !W.isIndoor(Math.floor(x), Math.floor(z), lv), ry = (strHash(id) % 628) / 100;
    const m = new G.Mesher();
    m.box(0, 0.008, 0, 0.24, 0.016, 0.31, 0xe6dec8);
    m.box(0.02, 0.018, -0.03, 0.17, 0.003, 0.004, 0x6a6458); m.box(0.0, 0.018, 0.03, 0.15, 0.003, 0.004, 0x6a6458);
    if (out) m.box(0.05, 0.04, 0.07, 0.09, 0.05, 0.07, 0x7a766c);
    const geo = m.build(), g = new THREE.Group(); g.position.set(x, y + 0.004, z); g.rotation.y = ry;
    const body = new THREE.Mesh(geo, M().body); body.receiveShadow = true; g.add(body);
    if (!hullMat) hullMat = new THREE.MeshBasicMaterial({ color: 0xf2c230, side: THREE.BackSide, fog: false });
    const hull = new THREE.Mesh(geo, hullMat); hull.scale.set(1.28, 2.6, 1.22); hull.position.y = -0.006; hull.visible = false; g.add(hull);
    R.group.add(g);
    const N = { id, x, z, lv, g, hull, q: null };
    (R.notes = R.notes || []).push(N);
    N.q = prop({ x, z, lv, reach: 1.5, label: 'Coger la nota', off: () => !!R.carry,
      use: () => {
        const L = SV_LORE[id];
        dropNote(N);
        noteUI(L.title, L.text, () => { if (keepNote(id)) host.toast('Nota guardada en la mochila (pestaña Notas) · se relee en los descansos', 'good'); });
        return null;
      } });
  }
  function dropNote(N) {
    if (N.g.parent) N.g.parent.remove(N.g);
    const i = G.Props.list.indexOf(N.q); if (i >= 0) G.Props.list.splice(i, 1);
    const j = R.props.indexOf(N.q); if (j >= 0) R.props.splice(j, 1);
    R.notes.splice(R.notes.indexOf(N), 1);
  }
  function updateNotes(p) {
    for (const N of R.notes || []) N.hull.visible = (p.lv || 0) === N.lv && Math.hypot(N.x - p.pos.x, N.z - p.pos.z) < 3.5;
  }

  // ---------- las escenas con infectados ----------
  const sceneCount = (Z, H) => (Z.scenes || []).reduce((a, sc) => a + (sc.n || 0) + (sc.kind === 'manada' && H && !H.day ? 1 : 0), 0);
  function sceneZombies(id, Z, refresh) {
    R.herds = [];
    if (!Z.scenes) return;
    const zs = zstate(id), H = hourDef(S.hour), keep = !refresh && zs.scAt >= S.rests && zs.sc, p = P(), W = G.World;
    Z.scenes.forEach((sc, i) => {
      let n = (sc.n || 0) + (sc.kind === 'manada' && !H.day ? 1 : 0);
      if (keep) n = Math.min(n, zs.sc[i] || 0);
      const list = [];
      const inSp = sc.inside ? spotsIn(bldRole(Z, sc.inside), 0) : null;
      for (let k = 0; k < n; k++) {
        let x = 0, z = 0, ok = false;
        for (let t = 0; t < 30 && !ok; t++) {
          if (inSp) { if (!inSp.length) break; [x, z] = inSp.splice(Math.floor(Math.random() * inSp.length), 1)[0]; }
          else {
            const c = sc.kind === 'manada' ? sc.pts[0] : [sc.x, sc.z], a = Math.random() * TAU, r = sc.kind === 'manada' ? rnd(0.5, 3) : rnd(1.2, sc.r || 4);
            x = c[0] + Math.sin(a) * r; z = c[1] + Math.cos(a) * r;
          }
          if (W.circleBlocked(x, z, 0.4, 0) || Math.hypot(x - p.pos.x, z - p.pos.z) < 10) continue;
          ok = true;
        }
        if (!ok) continue;
        const kind = k < (sc.stalker || 0) ? 'stalker' : 'runner';
        const zb = new G.Zombie(host.scene, x, z, null, Math.random() * TAU, { lv: 0, stalker: kind === 'stalker', homebound: !!sc.inside });
        zb.svAmb = true; zb.svScene = i; zb.state = 'idle'; zb.timer = 1 + Math.random() * 5; zb.target = null; zb.notice = 0;
        G.Population.list.push(zb); list.push(zb);
      }
      if (sc.kind === 'manada' && list.length) R.herds.push({ sc, idx: i, i: 0, t: 3 });
    });
    zs.scAt = S.rests; zs.sc = null;
  }
  // la manada: van juntos de un punto al siguiente (si alguno se distrae o te persigue, los demás esperan)
  function updateHerds(dt) {
    for (const h of R.herds || []) {
      if ((h.t -= dt) > 0) continue;
      h.t = 3;
      // (los de la manada que están despiertos: los de lejos duermen en su trozo y, al despertar, siguen siendo de ella)
      const list = G.Population.list.filter((z) => z.alive && z.svScene === h.idx);
      if (!list.length || list.some((z) => z.state !== 'idle' && z.state !== 'wander')) continue;
      const g = h.sc.pts[h.i];
      if (!list.some((z) => Math.hypot(z.pos.x - g[0], z.pos.z - g[1]) > 4.5)) h.i = (h.i + 1) % h.sc.pts.length;
      const t = h.sc.pts[h.i];
      list.forEach((z, k) => { const a = k / list.length * TAU + 0.4; z.target = { x: t[0] + Math.sin(a) * 1.5, z: t[1] + Math.cos(a) * 1.5, lv: 0 }; z.enter('wander', 30); });
      h.t = 6 + Math.random() * 4;
    }
  }
  // (la ciudad no se vacía alrededor: si cerca no queda casi nadie, uno de los sueltos de muy lejos, que no te ve
  // ni lo ves, aparece en otra calle, a media distancia y fuera de la vista. No se crea ninguno: se mueven)
  function updateTrickle(dt, p) {
    const Z = ZONES[S.zone];
    if (!Z || !Z.big || S.where !== 'zone' || R.pers || (R.trickT = (R.trickT == null ? 8 : R.trickT) - dt) > 0) return;
    R.trickT = 7;
    const W = G.World, m = G.Maps.get(Z.map), A = (m.play && m.play[0]) || [m.min + 2, m.min + 2, m.max - 2, m.max - 2], ko = zoneKeepOut(Z);
    const dd = (z) => Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);
    const L = G.Population.list.filter((z) => z.alive && !z.human && z.svAmb && z.svScene == null);
    if (L.filter((z) => dd(z) < 45).length >= 3) return;
    let far = L.filter((z) => (z.state === 'idle' || z.state === 'wander') && dd(z) > 70 && !W.hasLOS(p.pos.x, p.pos.z, z.pos.x, z.pos.z, 0)).sort((a, b) => dd(b) - dd(a))[0];
    // (o uno de los que duermen en un trozo lejano: se despierta en el sitio nuevo)
    const sl = far ? null : sleepers().filter((q) => q.s.svAmb && q.s.svScene == null)[0];
    if (!far && !sl) return;
    for (let t = 0; t < 40; t++) {
      const a = Math.random() * TAU, r = rnd(30, 48), x = p.pos.x + Math.sin(a) * r, z = p.pos.z + Math.cos(a) * r;
      if (x < A[0] + 1 || x > A[2] - 1 || z < A[1] + 1 || z > A[3] - 1) continue;
      if (ko.some((q) => x > q[0] && x < q[2] && z > q[1] && z < q[3]) || !onWalk(m, x, z)) continue;
      if (W.circleBlocked(x, z, 0.45, 0) || W.isIndoor(Math.floor(x), Math.floor(z), 0) || W.hasLOS(p.pos.x, p.pos.z, x, z, 0)) continue;
      if (sl) {
        sl.c.sleepers.splice(sl.c.sleepers.indexOf(sl.s), 1);
        far = new G.Zombie(host.scene, x, z, sl.s.look, Math.random() * TAU, Object.assign({}, sl.s, { x, z, homebound: false }));
        G.Population.list.push(far);
      } else { far.pos.x = x; far.pos.z = z; far.y = W.groundY(x, z, 0); far.facing = Math.random() * TAU; }
      far.target = null; far.state = 'idle'; far.timer = 2 + Math.random() * 4; far.notice = 0;
      return;
    }
  }

  // los que duermen (G.Population: los de los trozos lejanos se guardan en su trozo, sin modelo) de este mapa
  function sleepers(dead) {
    const W = G.World, m = W.layout && G.Maps.get(W.layout), out = [];
    if (!m) return out;
    const c0 = Math.floor((m.min || 0) / W.CS), c1 = Math.floor(((m.max || 128) - 0.01) / W.CS);
    for (let cz = c0; cz <= c1; cz++) for (let cx = c0; cx <= c1; cx++) {
      const c = W.chunkAt(cx, cz);
      for (const s of (c && c.sleepers) || []) if (!s.dead || dead) out.push({ c, s });
    }
    return out;
  }

  // ---------- lo que se mueve sin ser un infectado ----------
  function setupLife(Z) {
    const L = Z.life;
    R.flocks = [];
    for (const b of L.birds || []) R.flocks.push(flock(b[0], b[1], b[2] || 0));
    for (const s of L.smoke || []) smokeColumn(s[0], s[1], s[2] || 1);
    if (L.sign) swingSign(L.sign);
    R.sndT = L.sounds ? rnd(4, 9) : null;
  }
  // los cuervos: picotean en el suelo; si te acercas (o hay jaleo cerca), echan a volar y se van
  function flock(x, z, lift) {
    const F = { x, z, birds: [], up: false, t: 0 };
    const n = 4 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const bx = x + rnd(-1.7, 1.7), bz = z + rnd(-1.2, 1.2), by = lift ? G.World.groundY(x, z, 0) + lift : G.World.groundY(bx, bz, 0);
      const g = new THREE.Group(); g.position.set(lift ? x + rnd(-0.8, 0.8) : bx, by, lift ? z + rnd(-0.4, 0.4) : bz); g.rotation.y = Math.random() * TAU; g.scale.setScalar(1.6);
      const mb = new G.Mesher();
      mb.box(0, 0.1, 0, 0.1, 0.1, 0.24, 0x1d1d22); mb.box(0, 0.17, 0.12, 0.08, 0.08, 0.09, 0x1d1d22); mb.box(0, 0.165, 0.185, 0.025, 0.025, 0.06, 0x3a3630);
      mb.box(0, 0.12, -0.15, 0.08, 0.02, 0.1, 0x16161a);
      const body = new THREE.Mesh(mb.build(), M().body); g.add(body);
      const wings = [];
      for (const sd of [-1, 1]) {
        const mw = new G.Mesher(); mw.box(sd * 0.11, 0, 0, 0.22, 0.015, 0.13, 0x16161a);
        const w = new THREE.Mesh(mw.build(), M().body); w.position.set(sd * 0.04, 0.13, 0); w.visible = false; g.add(w); wings.push(w);
      }
      R.group.add(g);
      F.birds.push({ g, body, wings, ph: Math.random() * 10, v: null });
    }
    return F;
  }
  function updateFlocks(dt, p) {
    for (const F of R.flocks || []) {
      if (!F.birds.length) continue;
      if (!F.up) {
        const near = Math.hypot(p.pos.x - F.x, p.pos.z - F.z) < (p.running ? 11 : 7.5) || G.Population.list.some((z) => z.alive && z.state === 'chase' && Math.hypot(z.pos.x - F.x, z.pos.z - F.z) < 6);
        for (const b of F.birds) { b.ph += dt; b.body.rotation.x = Math.max(0, Math.sin(b.ph * 2.3)) * 0.5; if (Math.random() < dt * 0.3) b.g.rotation.y += rnd(-0.8, 0.8); }
        if (near) {
          F.up = true;
          snd('crow', { x: F.x, z: F.z, vol: 0.9 }); snd('rustle', { x: F.x, z: F.z, vol: 0.5 });
          for (const b of F.birds) {
            const a = Math.atan2(F.x - p.pos.x, F.z - p.pos.z) + rnd(-0.8, 0.8);
            b.v = { x: Math.sin(a) * rnd(3, 5), y: rnd(2.2, 3.6), z: Math.cos(a) * rnd(3, 5) }; b.g.rotation.y = a; b.body.rotation.x = -0.25;
            for (const w of b.wings) w.visible = true;
          }
        }
        continue;
      }
      F.t += dt;
      for (const b of F.birds) {
        b.g.position.x += b.v.x * dt; b.g.position.y += b.v.y * dt; b.g.position.z += b.v.z * dt;
        b.v.y = Math.max(0.9, b.v.y - dt * 0.6);
        const fl = Math.sin((F.t + b.ph) * 26) * 0.9;
        b.wings[0].rotation.z = fl; b.wings[1].rotation.z = -fl;
      }
      if (F.t > 6) { for (const b of F.birds) if (b.g.parent) b.g.parent.remove(b.g); F.birds = []; }
    }
  }
  // humo de lejos (alguien vive en otra parte de la ciudad): bocanadas que suben, se abren y se deshacen
  let smokeTex = null;
  function smokeColumn(x, z, k) {
    if (!smokeTex) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const c2 = cv.getContext('2d'), gr = c2.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = gr; c2.fillRect(0, 0, 64, 64);
      smokeTex = new THREE.CanvasTexture(cv);
    }
    const puffs = [], N = 14, H = 46 * k;
    for (let i = 0; i < N; i++) {
      const mt = new THREE.SpriteMaterial({ map: smokeTex, color: 0x6a6a68, transparent: true, depthWrite: false, fog: false, opacity: 0 });
      const s = new THREE.Sprite(mt); R.group.add(s); puffs.push({ s, ph: i / N });
    }
    // (como la silueta de la ciudad: siempre en el horizonte, hacia donde está, detrás de los edificios de lejos;
    // la cámara no ve más allá de unos 95 m)
    R.anims.push((dt) => {
      const C = G.Camera && G.Camera.pos, cx = C ? C.x : x, cz = C ? C.z : z, dl = Math.hypot(x - cx, z - cz) || 1, D = Math.min(dl, 58);
      const bx = cx + (x - cx) / dl * D, bz = cz + (z - cz) / dl * D;
      for (const q of puffs) {
        q.ph = (q.ph + dt * 0.018) % 1;
        const u = q.ph, sz = (5 + u * 22) * k;
        q.s.position.set(bx + Math.sin(u * 3 + q.ph * 9) * 2 + u * 14 * k, 10 + u * H, bz + Math.cos(u * 2.4) * 1.5);
        q.s.scale.set(sz, sz, 1);
        q.s.material.opacity = Math.min(1, u * 6) * (1 - u) * 0.42;
      }
    });
  }
  // el cartel colgante de la farmacia (la cruz verde): se balancea con el viento y cruje
  function swingSign(L) {
    const g = new THREE.Group(), y = gy(L.x, L.z) + 3.25; g.position.set(L.x, y, L.z); g.rotation.y = L.ry || 0; R.group.add(g);
    const mb = new G.Mesher(); mb.box(0, 0, 0.5, 0.05, 0.05, 1.0, 0x2a2a2a); mb.box(0, -0.18, 0.04, 0.04, 0.4, 0.04, 0x2a2a2a);
    const br = new THREE.Mesh(mb.build(), M().body); g.add(br);
    const sw = new THREE.Group(); sw.position.set(0, 0, 0.62); g.add(sw);
    const ms = new G.Mesher();
    ms.box(-0.12, -0.08, 0, 0.012, 0.16, 0.012, 0x3a3a3a); ms.box(0.0, -0.08, 0.24, 0.012, 0.16, 0.012, 0x3a3a3a); ms.box(0.0, -0.08, -0.24, 0.012, 0.16, 0.012, 0x3a3a3a);
    ms.box(0, -0.46, 0, 0.06, 0.62, 0.62, 0xd8d2c0);
    for (const sx of [-0.035, 0.035]) { ms.box(sx, -0.46, 0, 0.012, 0.42, 0.14, 0x2f8a4a); ms.box(sx, -0.46, 0, 0.012, 0.14, 0.42, 0x2f8a4a); }
    const pl = new THREE.Mesh(ms.build(), M().body); pl.castShadow = true; sw.add(pl);
    let nx = rnd(2, 5);
    R.anims.push((dt) => {
      sw.rotation.z = Math.sin(R.t * 1.7) * 0.22 + Math.sin(R.t * 0.63) * 0.12;
      if ((nx -= dt) <= 0) { nx = rnd(3, 7); const p = P(); if (Math.hypot(p.pos.x - L.x, p.pos.z - L.z) < 26) snd('creakFar', { x: L.x, z: L.z, vol: 0.9 }); }
    });
  }
  // los ruidos de la ciudad: lejos y con su sitio (una puerta que golpea, metal, algo que se arrastra, un gemido)
  function updateSounds(dt, p) {
    if (R.sndT == null || (R.sndT -= dt) > 0) return;
    const H = hourDef(S.hour);
    R.sndT = rnd(8, 18) * (H.day ? 1 : 0.75);
    const a = Math.random() * TAU, r = rnd(28, 52), x = p.pos.x + Math.sin(a) * r, z = p.pos.z + Math.cos(a) * r, k = Math.random();
    // (con su sitio, para que se sepa de dónde viene, pero sin que la distancia lo apague del todo: lejos y bajito)
    const far = (n, v) => snd(n, { x, z, vol: v * r / 2.5 * 0.32 });
    if (!H.day && k < 0.12) far('nShriek', 0.5);
    else if (k < 0.3) far('bang', 0.8);
    else if (k < 0.48) far('clang', 0.9);
    else if (k < 0.62) far('drag', 1);
    else if (k < 0.8) far('farMoan', 1);
    else far('creakFar', 1);
  }

  // ================= Los pasos (la galería) =================
  function goPaso(pid, from) {
    if (busy()) return;
    const D = PASOS[pid];
    host.shift(() => enterPaso(pid, from), () => {
      host.toast(D.name + (D.out ? ' · el portón está cerrado' : ' · la reja está bajada') + ': mantén Recoger en la manivela para subirl' + (D.out ? 'o' : 'a'), 'good');
    });
  }
  function enterPaso(pid, from) {
    const D = PASOS[pid];
    leaveHere();
    newScene();
    Surv.pasoKind = D.kind;
    host.map(D.map || 'sv_paso');
    restorePlayer();
    applyHour();
    S.where = 'paso'; S.paso = { id: pid, from };
    const south = from === D.a;
    host.place(10, south ? 3.2 : 28.8, south ? 0 : Math.PI);
    buildPaso(D);
    placeNotes(D.notes, null);
    host.peace(false);
    save();
    hud(true);
  }
  function buildPaso(D) {
    // la reja: barrotes de hierro oxidado de pared a pared; sube y baja en su sitio. Al aire libre, un portón de
    // troncos afilados entre dos postes altos con su viga (lo levantó la Trece con un torno)
    const g = new THREE.Group(); g.position.set(10, gy(10, GATE_Z), GATE_Z); R.group.add(g);
    const m = new G.Mesher();
    if (D.out) {
      for (let x = -1.8; x <= 1.81; x += 0.24) { m.cyl(x, 1.3, 0, 0.11, 0.11, 2.6, U.shade(0x6e5236, 0.85 + ((x * 7) % 1 + 1) % 1 * 0.3), 7); m.cone(x, 2.72, 0, 0.11, 0.26, 0x5a4230, 7); }
      for (const y of [0.5, 1.9]) m.box(0, y, -0.14, 3.9, 0.16, 0.1, 0x4a3828);
      const fm = new G.Mesher();
      for (const sx of [-2.05, 2.05]) fm.cyl(sx, 2.8, 0, 0.16, 0.16, 5.6, 0x5a4230, 8);
      fm.box(0, 5.55, 0, 4.5, 0.26, 0.3, 0x4a3828);
      fm.cyl(0, 5.2, 0, 0.12, 0.12, 0.5, 0x3a3634, 8, undefined, 0, 0, Math.PI / 2);
      const fr = new THREE.Mesh(fm.build(), M().body); fr.position.set(10, gy(10, GATE_Z), GATE_Z); fr.castShadow = true; R.group.add(fr);
    } else {
      for (let x = -1.85; x <= 1.86; x += 0.26) m.cyl(x, 1.4, 0, 0.022, 0.022, 2.8, 0x4a3e34, 5);
      for (const y of [0.12, 1.3, 2.6]) m.box(0, y, 0, 3.86, 0.07, 0.05, 0x3e342c);
      for (let x = -1.85; x <= 1.86; x += 0.26) m.cone(x, -0.05, 0, 0.03, 0.1, 0x3a3028, 4);
    }
    const gm = new THREE.Mesh(m.build(), M().body); gm.castShadow = true; g.add(gm);
    R.gate0 = g.position.y;
    const blk = blocker(8.0, GATE_Z - 0.12, 12.0, GATE_Z + 0.12, 3.0);
    R.gate = { g, blk, k: 0, open: false, openT: 0, falling: false };
    // las dos manivelas: una rueda con su mango, en la pared, a cada lado de la reja
    for (const C of CRANKS) {
      const base = mesh((q) => { if (D.out) q.cyl(-0.06, 0.7, 0, 0.1, 0.12, 1.4, 0x5a4230, 7); q.box(0, 1.1, 0, 0.06, 0.5, 0.36, 0x3a3634); q.cyl(0.07, 1.1, 0, 0.03, 0.03, 0.14, 0x55524e, 6, undefined, 0, 0, Math.PI / 2); }, C.mx, gy(C.mx, C.z), C.z, C.ry);
      const wheel = new THREE.Group(); wheel.position.set(0.16, 1.1, 0); base.add(wheel);
      const wm = new G.Mesher();
      for (let k = 0; k < 4; k++) wm.box(0, 0, 0, 0.03, 0.44, 0.03, 0x6a4a30, 0, undefined, k * Math.PI / 4);
      wm.cyl(0, 0, 0, 0.23, 0.23, 0.04, 0x5a3e28, 12, undefined, 0, 0, Math.PI / 2);
      wm.cyl(0.08, 0.17, 0, 0.022, 0.022, 0.16, 0x8a6a48, 6, undefined, 0, 0, Math.PI / 2);
      const wh = new THREE.Mesh(wm.build(), M().body); wheel.add(wh);
      C.wheel = wheel;
      prop({ x: C.x, z: C.z, fx: C.mx + (C.side === 'a' ? 0.12 : -0.12), fz: C.z, reach: 1.5, lab: () => (R.gate.open ? (D.out ? 'El portón está subido' : 'La reja está subida') : 'Girar la manivela (mantener)'),
        use: (p) => { if (R.gate.open) return (D.out ? 'El portón ya está subido' : 'La reja ya está subida') + ': pasa antes de que caiga'; crankStart(p, C); return null; } });
    }
    // las dos bocas: por donde se llegó y por donde se sigue
    const A = ZONES[D.a], B = ZONES[D.b];
    prop({ x: 10, z: 1.9, reach: 1.9, label: 'Salir · ' + A.name, use: () => { goZone(D.a, D.b); return null; } });
    prop({ x: 10, z: 30.1, reach: 1.9, label: 'Salir · ' + B.name, use: () => { goZone(D.b, D.a); return null; } });
  }
  function goZone(to, from) {
    if (busy()) return;
    host.shift(() => enterZone(to, { from }), null);
  }
  // la manivela: mientras se mantenga Recoger, la reja sube; si se suelta, vuelve a bajar despacio
  function crankStart(p, C) {
    if (p.busy() || p.dead) return;
    R.crank = { C, tick: 0 };
    crankPose(p, C);
  }
  function crankPose(p, C) { p.action = { kind: 'search', t: 0, dur: 0.75, impact: 2, face: Math.atan2(C.mx - p.pos.x, C.z - p.pos.z), low: false, done: false, svCrank: true }; }
  function updateGate(dt, p) {
    const Gt = R.gate;
    if (!Gt) return;
    const cr = R.crank;
    if (cr) {
      const far = Math.hypot(p.pos.x - cr.C.x, p.pos.z - cr.C.z) > 1.7;
      if (!G.Input.lootHeld || far || p.dead || Gt.open) { R.crank = null; if (p.action && p.action.svCrank) p.action = null; }
      else {
        Gt.k = Math.min(1, Gt.k + dt / CRANK_T);
        cr.C.wheel.rotation.x += dt * 5.2;
        if (!p.action || p.action.done || !p.action.svCrank) crankPose(p, cr.C);
        if ((cr.tick -= dt) <= 0) { cr.tick = 0.32; snd('bClick', { x: cr.C.x, z: cr.C.z, vol: 0.5 }); }
        if (Gt.k >= 1) {
          Gt.open = true; Gt.openT = 0; R.crank = null; if (p.action && p.action.svCrank) p.action = null;
          setSolid(Gt.blk, false);
          snd('clang', { x: 10, z: GATE_Z, vol: 0.5 });
          host.toast((PASOS[S.paso && S.paso.id] || {}).out ? 'El portón queda arriba un momento: pasa' : 'La reja queda arriba un momento: pasa', 'good');
        }
      }
    } else if (!Gt.open && Gt.k > 0) {
      // (soltaste la manivela: la reja baja por su peso)
      const k0 = Gt.k;
      Gt.k = Math.max(0, Gt.k - dt * (Gt.falling ? 2.6 : 0.7));
      if (k0 > 0 && Gt.k === 0) { Gt.falling = false; snd('clang', { x: 10, z: GATE_Z, vol: 0.7 }); if (G.Camera.shake && Math.abs(p.pos.z - GATE_Z) < 6) G.Camera.shake(0.08); }
    }
    if (Gt.open) {
      Gt.openT += dt;
      // al pasar (o al irse de su lado), la reja cae de golpe
      if (Gt.openT > 1.2 && Math.abs(p.pos.z - GATE_Z) > 2.8) { Gt.open = false; Gt.falling = true; setSolid(Gt.blk, true); snd('drag', { x: 10, z: GATE_Z, vol: 0.5 }); }
    }
    Gt.g.position.y = (R.gate0 || 0) + Gt.k * 2.45;
  }

  // ================= Los descansos =================
  // Al descansar, la Trece se sienta en el suelo junto al fuego (o junto al saco) y la cámara la mira de frente,
  // de lado, un poco abajo: el panel queda a la izquierda, sobre la escena (imitando el de los juegos de almas, sin
  // copiarlo). Al levantarse, vuelve la cámara de siempre y los infectados de la zona vuelven a estar
  let restFade = false;
  const _side = (f, a) => ({ x: Math.sin(f + a), z: Math.cos(f + a) });
  function seatFor(p, Rr) {
    // sentada a 1,35 m del fuego, del lado por el que llegó, mirándolo
    let dx = p.pos.x - Rr.x, dz = p.pos.z - Rr.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { dx = 0; dz = 1; d = 1; }
    const W = G.World, near = Rr.bed || Rr.basic ? 0.9 : 1.35;
    let x = Rr.x + dx / d * near, z = Rr.z + dz / d * near;
    if (W.circleBlocked(x, z, 0.32, 0)) { x = p.pos.x; z = p.pos.z; }
    return { x, z, face: Math.atan2(Rr.x - x, Rr.z - z), kind: 'ground' };
  }
  // el plano: de frente y a un lado, bajo; si hay una pared en medio, se prueba otro ángulo (o más cerca)
  function seatShot(st) {
    const W = G.World, y = gy(st.x, st.z), inside = W.isIndoor(Math.floor(st.x), Math.floor(st.z), 0);
    const tries = [0.75, -0.75, 1.15, -1.15, 0.35, -0.35, 1.6, -1.6];
    for (const dist of inside ? [2.4, 2.0, 1.6] : [3.0, 2.3, 1.8]) for (const a of tries) {
      const f = _side(st.face, a), ex = st.x + f.x * dist, ez = st.z + f.z * dist;
      if (W.circleBlocked(ex, ez, 0.12, 0) || !W.hasLOS(st.x, st.z, ex, ez, 0)) continue;
      if (W.isIndoor(Math.floor(ex), Math.floor(ez), 0) !== inside) continue;
      return shotFrom(st, y, ex, ez, a);
    }
    const f = _side(st.face, 0.6);
    return Object.assign(shotFrom(st, y, st.x + f.x * 1.9, st.z + f.z * 1.9, 0.6), { fb: true });
  }
  function shotFrom(st, y, ex, ez, a) {
    // que ella quede a la derecha de la imagen: se mira un poco a su izquierda (la del cuadro)
    const vx = st.x - ex, vz = st.z - ez, d = Math.hypot(vx, vz) || 1, lx = -vz / d, lz = vx / d;
    const off = Math.min(0.85, d * 0.28);
    return { eye: new THREE.Vector3(ex, y + 1.05, ez), at: new THREE.Vector3(st.x - lx * off, y + 0.55, st.z - lz * off) };
  }
  function restStart(id) {
    const p = P(), Z = ZONES[id];
    if (busy() || p.dead) return;
    if (chasing(p, 12)) { host.toast('No puedes descansar con infectados detrás de ti', 'warn'); return; }
    restFade = true;
    const st = seatFor(p, Z.rest);
    const prevCur = p.cur;
    p.aiming = false;
    if (p.action && !p.action.done) p.action = null;
    p.sitDown(st);
    snd('rustle', { vol: 0.35 });
    const cam = host.camera, sh = seatShot(st);
    R.sitCam = { t: 0, from: cam.position.clone(), fq: cam.quaternion.clone(), eye: sh.eye, at: sh.at, prevCur };
    G.Camera.held = true;
    setTimeout(() => {
      if (!active || !R) { restFade = false; return; }
      const first = !S.visited[id];
      S.visited[id] = true;
      if (R.restFire) R.restFire.lit = true, R.restFire.fl.visible = true;
      // curarse: comiendo algo, del todo; sin comida, solo un poco
      const lines = [];
      if (p.health < 95) {
        if (Z.rest.bed && p.health < 50) S.wounds++;
        if (S.res.comida > 0) { S.res.comida--; p.health = 100; p.heal = 0; lines.push('Comes algo y descansas: te recuperas del todo (−1 comida)'); }
        else { p.health = Math.min(100, p.health + 30); lines.push('Sin nada que comer, descansar te cura poco'); }
      }
      S.rest = id; S.stats.rests++;
      keepPlayer();
      snapRest = clone(S);
      save();
      if (first) lines.unshift(Z.rest.bed ? 'Tu escondite. Aquí se guarda todo' : (Z.rest.basic ? 'La garita: desde otro descanso podrás volver aquí (de aquí se sale a pie o en el coche)' : 'Fuego encendido: ya puedes volver aquí desde otro descanso'));
      restFade = false;
      openRest(id, null, false, lines);
    }, 1100);
  }
  // levantarse: de pie, la cámara de siempre, el arma que llevaba en la mano
  function unsit(p, quick) {
    const C = R && R.sitCam;
    if (p.sitting) { p.standUp(); if (quick) p.sitOut = 0; }
    if (C) {
      R.sitCam = null;
      G.Camera.held = false; G.Camera.fovOff = 0;
      G.Camera.yaw = p.facing + Math.PI; G.Camera.pitch = 0.1;
      if (C.prevCur != null && C.prevCur !== -1 && p.cur === -1) setTimeout(() => { if (active && !p.dead && p.cur === -1 && !p.sitting) p.equip(C.prevCur); }, quick ? 0 : 450);
    }
  }
  function updateSitCam(dt) {
    const C = R && R.sitCam;
    if (!C) return;
    C.t += dt;
    const u = U.smooth(U.clamp(C.t / 1.0, 0, 1));
    camTo(C.eye, C.at, u, C.from, C.fq);
    G.Camera.fovOff = -8 * u;
  }
  // al levantarse: la hora elegida queda, los infectados vuelven a estar y lo del suelo se renueva
  function restEnd(id) {
    S.rests++;
    const Z = ZONES[id], zs = zstate(id);
    host.clearZombies();
    // (y los que dormían en los trozos de lejos: si no, al volver a pasar por allí, estarían dos veces)
    for (const q of sleepers(true)) q.c.sleepers.length = 0;
    zs.alive = null;
    zombiesZone(id, Z, true);
    keepPlayer();
    snapRest = clone(S);
    save();
    hud(true);
  }

  // ---------- el panel del descanso ----------
  // a la izquierda: el nombre del sitio, la hora (y el tiempo que hace), la lista; abajo, lo que hace lo elegido.
  // Cada opción abre su lista en el mismo panel (Volver: a la lista de antes; desde la primera, levantarse)
  const attr = (t) => esc(t).replace(/"/g, '&quot;');
  const MENU = [
    ['hora', 'Pasar el tiempo', 'Elige a qué hora sales. La luz, los infectados de fuera y lo que arriesgas en el camino dependen de ella.'],
    ['viajar', 'Viajar', 'Ir a otro descanso ya encendido. Cuesta 1 comida y 1 agua; por el camino, a veces se pierde una venda y te pueden salir al paso.'],
    ['cocinar', 'Cocinar', 'Al fuego (o en el hornillo del escondite): comida y medicina. La munición no se cocina.'],
    ['mejorar', 'Mejorar las armas', 'Montar en las armas que llevas las piezas que encontraste. Cada pieza mejora un arma para siempre.'],
    ['habil', 'Habilidades', 'Cada rama se abre con su manual; los niveles se aprenden con suplementos.'],
    ['notas', 'Leer las notas', 'Los papeles que fuiste cogiendo por el camino (también están en la mochila, en la pestaña Notas).']
  ];
  function resLine() {
    const p = P();
    return '<div class="gr-res">' + [['comida', S.res.comida], ['agua', S.res.agua], ['crudo', S.res.crudo], ['sucia', S.res.sucia]].map(([k, v]) => '<span class="r-' + k + '"><i></i>' + RES_NAME[k] + ' <b>' + v + '</b></span>').join('') +
      '<span class="r-sup"><i></i>Suplementos <b>' + S.sup + '</b></span><span class="r-venda"><i></i>Vendas <b>' + (p.items.venda || 0) + '</b></span></div>';
  }
  const row = (k, d, name, right, desc, cls) => '<li><button type="button" data-f data-k="' + k + '" data-d="' + attr(d) + '" data-desc="' + attr(desc || '') + '" class="' + (cls || '') + '"><span>' + esc(name) + '</span>' + (right ? '<em>' + right + '</em>' : '') + '</button></li>';
  function openRest(id, view, benchOnly, lines) {
    const Z = ZONES[id], o = { kind: 'rest', view: benchOnly ? 'mejorar' : (view || 'root'), sel: 0, msg: (lines || []).join(' · '), bench: benchOnly, back: [] };
    const menu = () => MENU.filter((m) => (m[0] !== 'mejorar' || Z.bench) && (m[0] !== 'viajar' || !Z.rest.noTravel));
    o.render = () => {
      let title = '', list = '', paper = '';
      if (o.view === 'root') {
        list = menu().map((m) => row('open', m[0], m[1], '', m[2])).join('') +
          (test ? row('free', '', 'Volver al modo libre', '', 'Termina la prueba y vuelve al modo libre.') : '') +
          row('back', '', 'Levantarse', '', 'Seguir camino. Al levantarte, los infectados de la zona vuelven a estar y lo del suelo se renueva.');
      } else {
        const M = MENU.find((m) => m[0] === o.view);
        title = M ? M[1] : '';
        if (o.view === 'hora') list = hourRows();
        else if (o.view === 'viajar') list = travelRows(id);
        else if (o.view === 'cocinar') list = cookRows();
        else if (o.view === 'mejorar') list = benchRows();
        else if (o.view === 'notas') list = noteRows();
        else if (o.view === 'leer') { const N = SV_LORE[o.note] || { title: '', where: '', text: '' }; title = N.title; paper = '<div class="gr-note"><small>' + esc(N.where) + '</small>' + para(N.text) + '</div>'; }
        else list = skillRows();
        list += row('back', '', benchOnly ? 'Dejar la mesa' : 'Volver', '', benchOnly ? 'Dejar la mesa de trabajo.' : (o.view === 'leer' ? 'Volver a las notas.' : 'Volver a la lista del descanso.'));
      }
      const H = hourDef(S.hour), wx = G.Sky && G.Sky.weather && typeof G.Sky.label === 'function' ? G.Sky.label(G.Sky.weather) : '';
      uiRoot.innerHTML = '<div class="gr-panel">' +
        '<div class="gr-head"><i class="gr-ic"></i><h3>' + esc(benchOnly ? 'La mesa de trabajo' : Z.name) + '</h3>' + (test ? '<small>PRUEBA</small>' : '') + '</div>' +
        '<div class="gr-sub"><span>' + esc(H.name) + '</span>' + (wx ? '<em>' + esc(wx) + '</em>' : '') + '</div>' +
        (title ? '<div class="gr-title">' + esc(title) + '</div>' : '') + paper +
        '<ul class="gr-list">' + list + '</ul>' +
        '<div class="gr-desc"></div>' +
        (o.msg ? '<p class="gr-msg">' + esc(o.msg) + '</p>' : '') +
        (o.view === 'root' || o.view === 'cocinar' || o.view === 'viajar' || o.view === 'habil' ? resLine() : '') + '</div>' +
        '<div class="gr-hint"><button type="button" data-k="ok"><i>' + (G.Input && G.Input.isTouch ? '✓' : 'Enter') + '</i>Aceptar</button><button type="button" data-k="back"><i>' + (G.Input && G.Input.isTouch ? '←' : 'Esc') + '</i>' + (o.view === 'root' && !benchOnly ? 'Levantarse' : 'Volver') + '</button></div>';
      focus(o);
    };
    const leave = () => { closeUI(); if (!benchOnly) { unsit(P()); restEnd(id); } };
    o.key = (k, d) => {
      if (nav(o, k)) return;
      if (k === 'left' || k === 'right') return;
      if (k === 'back') {
        if (o.view === 'root' || benchOnly) { leave(); return; }
        o.view = o.view === 'leer' ? 'notas' : 'root'; o.sel = o.back.pop() || 0; o.msg = ''; snd('uiBack'); o.render(); return;
      }
      if (k === 'open') { o.back.push(o.sel); o.view = d; o.sel = 0; o.msg = ''; snd('uiOk'); o.render(); return; }
      if (k === 'free') { closeUI(); unsit(P(), true); restEnd(id); backToFree(); return; }
      if (k === 'hour') { S.hour = d; applyHour(); o.msg = hourDef(d).name + ': al levantarte, saldrás a esa hora'; snd('uiOk'); }
      else if (k === 'go') { if (d && S.visited[d] && d !== id) { closeUI(); unsit(P(), true); travel(id, d); return; } }
      else if (k === 'cook') o.msg = cook(d);
      else if (k === 'part') o.msg = mount(d);
      else if (k === 'learn') o.msg = learn(d);
      else if (k === 'read') { if (!SV_LORE[d]) return; o.back.push(o.sel); o.view = 'leer'; o.note = d; o.sel = 0; snd('rustle', { vol: 0.35 }); }
      o.render();
    };
    openUI(o);
  }
  const RISK = { bajo: 'riesgo bajo', medio: 'riesgo medio', alto: 'riesgo alto' };
  const chip = (r) => '<b class="rk rk-' + r + '">' + (RISK[r] || r) + '</b>';
  function hourRows() {
    return HOURS.map((H) => row('hour', H.id, H.name, chip(H.risk), H.note, S.hour === H.id ? 'on' : '')).join('');
  }
  function travelRows(id) {
    const L = Object.keys(ZONES).filter((z) => z !== id && S.visited[z] && ZONES[z].rest);
    const H = hourDef(S.hour);
    if (!L.length) return row('none', '', 'Ningún otro fuego encendido', '', 'Ve a pie, por los pasos, y descansa en otro sitio: desde entonces podrás viajar hasta allí.', 'no');
    return L.map((z) => row('go', z, ZONES[z].name, ZONES[z].hub ? 'tu escondite' : (ZONES[z].rest.basic ? 'la garita' : 'fuego'),
      'Cuesta 1 comida y 1 agua (sin ellas, llegas agotada). Saliendo ' + H.name.toLowerCase() + ', ' + (RISK[H.risk] || H.risk) + ' de que te salgan al paso.' + (ZONES[z].rest.basic ? ' La garita no tiene mapa: de allí se sale a pie o en el coche.' : ''))).join('');
  }
  function haveN(k) { const p = P(); return k in S.res ? S.res[k] : (p.items[k] || 0); }
  const NEED_NAME = { crudo: 'pescado crudo', sucia: 'agua sin hervir', agua: 'agua', comida: 'comida', trapo: 'trapo', venda: 'venda' };
  function cookRows() {
    return RECIPES.map((r) => {
      const ok = Object.keys(r.need).every((k) => haveN(k) >= r.need[k]);
      const need = Object.keys(r.need).map((k) => r.need[k] + ' ' + NEED_NAME[k]).join(' + '), give = Object.keys(r.give).map((k) => r.give[k] + ' ' + NEED_NAME[k]).join(', ');
      return row('cook', r.id, r.name, esc(need + ' → ' + give), r.txt, ok ? '' : 'no');
    }).join('');
  }
  function cook(id) {
    const r = RECIPES.find((q) => q.id === id), p = P();
    if (!r) return '';
    const miss = Object.keys(r.need).filter((k) => haveN(k) < r.need[k]);
    if (miss.length) return 'Te falta: ' + miss.map((k) => NEED_NAME[k]).join(', ');
    for (const k of Object.keys(r.give)) {
      if (k in S.res && S.res[k] + r.give[k] > RES['sv_' + k].cap) return 'No te cabe más ' + NEED_NAME[k];
      if (k === 'venda' && p.itemRoom('venda') <= 0) return 'No te caben más vendas';
    }
    for (const k of Object.keys(r.need)) { if (k in S.res) S.res[k] -= r.need[k]; else p.items[k] -= r.need[k]; }
    for (const k of Object.keys(r.give)) { if (k in S.res) S.res[k] += r.give[k]; else p.items[k] = (p.items[k] || 0) + r.give[k]; }
    snd('crackle', { vol: 0.4 });
    keepPlayer(); save();
    return r.name + ': hecho';
  }
  function benchRows() {
    const ids = Object.keys(PARTS).filter((id) => S.parts[id]);
    if (!ids.length) return row('none', '', 'Ninguna pieza todavía', '', 'Aquí se montan las piezas que encuentres en las armas que llevas: una mira para el rifle, un muelle para la pistola...', 'no');
    return ids.map((id) => {
      const D = PARTS[id], used = S.parts[id] === 2, w = G.Weapons.get(D.w), ups = (G.Weapons.UPGRADES || {})[D.w] || [], u = ups.find((q) => q.id === D.up);
      const has = hasWeapon(D.w);
      return row('part', id, D.short, esc((w ? w.name : D.w) + (used ? ' · montada' : '')), (u ? u.name + '. ' : '') + (used ? 'Ya está montada.' : (has ? (u && u.desc ? u.desc : 'Montar.') : 'No llevas el arma encima.')), used ? 'on' : (has ? '' : 'no'));
    }).join('');
  }
  function mount(id) {
    const D = PARTS[id];
    if (!D || !S.parts[id]) return '';
    if (S.parts[id] === 2) return 'Ya está montada';
    if (!hasWeapon(D.w)) return 'Necesitas llevar encima: ' + (G.Weapons.get(D.w) || {}).name;
    S.up[D.w] = S.up[D.w] || {};
    S.up[D.w][D.up] = true;
    S.parts[id] = 2;
    G.Weapons.applyUpgrades(S.up);
    snd('magIn', { vol: 0.6 });
    keepPlayer(); save();
    return D.short + ': montada en ' + (G.Weapons.get(D.w) || {}).name.toLowerCase();
  }
  // las notas guardadas (las de este mundo), para releerlas junto al fuego
  function noteRows() {
    const have = G.Calm && G.Calm.Notes ? G.Calm.Notes.list().filter((id) => SV_LORE[id]) : [];
    if (!have.length) return row('none', '', 'Ninguna nota todavía', '', 'Por el camino hay papeles sueltos (con el borde amarillo, de cerca). Lo que cojas se queda aquí y en la mochila.', 'no');
    return have.map((id) => row('read', id, SV_LORE[id].title, esc(SV_LORE[id].where.replace(/^(El|La|Los|Las|Un|Una) /, '')), SV_LORE[id].text.split('\n')[0])).join('');
  }
  function lvOf(b) { return S.skills[b.id] || 0; }
  function skillRows() {
    return BRANCHES.map((b) => {
      const n = lvOf(b), open = !!S.manuals[b.manual], nx = b.levels[n];
      const lv = b.levels.map((l, i) => (i < n ? '✓ ' : '· ') + l.txt + (i >= n ? ' (' + l.cost + ')' : '')).join('   ');
      return row('learn', b.id, b.name, esc(open ? (nx ? nx.cost + ' suplementos' : 'completa') : 'sin manual'), (open ? '' : 'Hace falta: ' + b.manualName.toLowerCase() + '. ') + lv, !open || !nx ? 'no' : '');
    }).join('');
  }
  function learn(id) {
    const b = BRANCHES.find((q) => q.id === id);
    if (!b) return '';
    if (!S.manuals[b.manual]) return 'Te falta ' + b.manualName.toLowerCase();
    const n = lvOf(b), nx = b.levels[n];
    if (!nx) return 'Ya la tienes completa';
    if (S.sup < nx.cost) return 'Te faltan suplementos (' + S.sup + ' de ' + nx.cost + ')';
    S.sup -= nx.cost; S.skills[b.id] = n + 1;
    snd('uiOk'); save();
    return nx.txt + ': aprendida';
  }

  // ================= Viajar =================
  function travel(from, to) {
    const p = P(), H = hourDef(S.hour), T = test || {};
    const lack = [];
    if (S.res.comida > 0) S.res.comida--; else lack.push('comida');
    if (S.res.agua > 0) S.res.agua--; else lack.push('agua');
    let lost = false;
    const cureP = T.cura === 'siempre' ? 1 : (T.cura === 'nunca' ? 0 : 0.25);
    if ((p.items.venda || 0) > 0 && Math.random() < cureP) { p.items.venda--; lost = true; }
    S.stats.travels++;
    keepPlayer();
    const ambP = T.amb === 'siempre' ? 1 : (T.amb === 'nunca' ? 0 : H.amb);
    const trip = { from, to, lack, lost };
    save();
    if (Math.random() < ambP) {
      S.stats.ambushes++;
      if (Math.random() < H.warn) warnUI(trip);
      else host.shift(() => enterAmbush(trip), () => host.toast('¡Te salen al paso en el camino de la costa!', 'bad'));
    } else arrive(trip);
  }
  function arriveMsgs(trip) {
    const p = P(), m = [];
    if (trip.lack.length) { p.health = Math.max(10, p.health - 18 * trip.lack.length); m.push('Llegas agotada: sin ' + trip.lack.join(' ni ') + ' en todo el camino'); }
    if (trip.lost) m.push('Por el camino se te ha caído una venda');
    return m;
  }
  function arrive(trip) {
    host.shift(() => {
      enterZone(trip.to, { rest: true });
      const m = arriveMsgs(trip);
      S.rest = trip.to;
      keepPlayer(); snapRest = clone(S); save();
      trip.msgs = m;
    }, () => {
      host.toast('Llegas ' + toName(ZONES[trip.to].name), 'good');
      (trip.msgs || []).forEach((t, i) => setTimeout(() => host.toast(t, 'warn'), 900 + i * 1400));
    });
  }
  // el aviso: de día se ven venir de lejos (rodear cuesta algo de comida); a última hora, soltando parte de la carga
  function warnUI(trip) {
    const H = hourDef(S.hour), o = { kind: 'warn', sel: 0 };
    const avoid = H.day ? 'Dar un rodeo (más camino: 1 comida más)' : 'Soltar parte de la carga y rodear';
    o.render = () => {
      uiRoot.innerHTML = '<div class="sv-card sv-warn"><small>EL CAMINO DE LA COSTA</small><h3>' + (H.day ? 'Movimiento más adelante' : 'Algo se mueve entre los coches') + '</h3>' +
        '<div class="sv-txt">' + para(H.day ? 'Desde la loma se ve el camino entero: entre los coches parados hay siluetas que no se mueven como personas. Te esperan. Si das un rodeo, no te verán.' : 'Está oscuro y casi no se ve, pero lo oyes: pasos que se arrastran, entre los coches parados. Si sigues, te van a salir al paso.') + '</div>' +
        '<div class="sv-ft"><button type="button" data-f data-k="fight">Seguir y pelear</button><button type="button" data-f data-k="avoid">' + avoid + '</button></div></div>';
      focus(o);
    };
    o.key = (k) => {
      if (nav(o, k)) return;
      if (k === 'back') return;
      if (k === 'fight') { closeUI(); host.shift(() => enterAmbush(trip), () => host.toast('Dos oleadas: aguanta y sigue el camino', 'warn')); return; }
      if (k === 'avoid') {
        closeUI();
        if (H.day) { if (S.res.comida > 0) S.res.comida--; else trip.lack.push('comida'); }
        else {
          const drop = [];
          for (const k2 of ['comida', 'agua']) { const n = Math.ceil(S.res[k2] / 3); if (n) { S.res[k2] -= n; drop.push(n + ' de ' + k2); } }
          const ns = Math.floor(S.sup / 3); if (ns) { S.sup -= ns; drop.push(ns + ' suplementos'); }
          if (drop.length) trip.msgs0 = 'Para correr, sueltas parte de la carga: ' + drop.join(', ');
        }
        arrive(Object.assign(trip, { pre: true }));
        if (trip.msgs0) setTimeout(() => host.toast(trip.msgs0, 'warn'), 2600);
      }
    };
    openUI(o);
  }
  // la emboscada: el camino de la costa y dos oleadas; despejado, se sigue hasta el descanso de destino
  function enterAmbush(trip) {
    leaveHere();
    newScene();
    host.map('sv_camino');
    restorePlayer();
    applyHour();
    S.where = 'camino'; S.paso = null;
    host.place(7.0, 14.0, Math.PI / 2);
    host.peace(false);
    const T = test || {};
    R.amb = { trip, wave: 0, next: 2.2, list: [], done: false, strong: T.fuerza === 'fuerte' };
    hud(true);
  }
  function spawnWave(A) {
    const p = P(), H = hourDef(S.hour), W = G.World;
    A.wave++;
    const kinds = [];
    const nr = (A.wave === 1 ? 4 : 4) + (H.day ? 0 : 1) + (A.strong ? 2 : 0);
    for (let i = 0; i < nr; i++) kinds.push('runner');
    if (A.wave === 2) { kinds.push('stalker'); if (!H.day) kinds.push('blind'); if (A.strong) kinds.push('temb'); }
    A.list = [];
    for (const kind of kinds) {
      for (let t = 0; t < 50; t++) {
        const side = A.wave === 2 && Math.random() < 0.4;
        const x = side ? rnd(p.pos.x + 6, Math.min(64, p.pos.x + 26)) : rnd(Math.min(60, p.pos.x + 22), 64);
        const z = side ? (Math.random() < 0.5 ? rnd(7, 9) : rnd(19, 21.5)) : rnd(11, 17);
        if (W.circleBlocked(x, z, 0.4, 0) || Math.hypot(x - p.pos.x, z - p.pos.z) < 12) continue;
        const zb = new G.Zombie(host.scene, x, z, null, Math.atan2(p.pos.x - x, p.pos.z - z), { lv: 0, hunter: true, stalker: kind === 'stalker', blind: kind === 'blind', temb: kind === 'temb' });
        zb.svAmb = true;
        if (kind === 'runner' || kind === 'temb') { zb.state = 'chase'; zb.target = { x: p.pos.x, z: p.pos.z, lv: 0 }; zb.lastSeen = 0; zb.screamed = true; }
        else { zb.target = { x: p.pos.x + rnd(-4, 4), z: p.pos.z + rnd(-4, 4), lv: 0 }; zb.enter('investigate', 10); }
        G.Population.list.push(zb); A.list.push(zb);
        break;
      }
    }
    host.toast(A.wave === 1 ? 'Te salen al paso: oleada 1 de 2' : 'Vienen más: oleada 2 de 2', 'bad');
  }
  function updateAmbush(dt) {
    const A = R.amb;
    if (!A || A.done) return;
    if (A.next > 0) { A.next -= dt; if (A.next <= 0) spawnWave(A); return; }
    if (A.list.some((z) => z.alive)) return;
    if (A.wave < 2) { A.next = 3.0; return; }
    A.done = true;
    const got = 6 + Math.floor(Math.random() * 8);
    S.sup += got;
    host.toast('El camino queda libre. Entre los caídos: ' + got + ' suplementos', 'good');
    prop({ x: 64.5, z: 14.0, reach: 3.0, label: 'Seguir el camino · ' + ZONES[A.trip.to].name, use: () => { arrive(A.trip); return null; } });
    trailMark(65.2, 11.6);
  }

  // ================= Lo que se coge (player.itemRoom / takeItem) =================
  function room(id) {
    if (RES[id]) { const k = RES[id].k; return k === 'sup' ? 999 : Math.max(0, RES[id].cap - S.res[k]); }
    if (/^sv_p_/.test(id)) return S.parts[id.slice(5)] ? 0 : 1;
    if (/^sv_m_/.test(id)) return S.manuals[id.slice(5)] ? 0 : 1;
    return 0;
  }
  function takeItem(id, n) {
    if (!S) return { msg: '', left: n };
    if (RES[id]) {
      const k = RES[id].k;
      if (k === 'sup') { S.sup += n; return { msg: '+' + n + ' suplementos', left: 0 }; }
      const t = Math.min(n, room(id));
      S.res[k] += t;
      if (t <= 0) return { msg: 'No te cabe más ' + RES[id].name, left: n };
      return { msg: RES_NAME[k] + ' (' + S.res[k] + ')', left: n - t };
    }
    if (/^sv_p_/.test(id)) {
      const D = PARTS[id.slice(5)];
      S.parts[id.slice(5)] = 1;
      return { msg: 'Pieza: ' + D.short + ' (para ' + ((G.Weapons.get(D.w) || {}).name || D.w).toLowerCase() + '). Se monta en la mesa del escondite', left: 0 };
    }
    if (/^sv_m_/.test(id)) {
      const k = id.slice(5), b = BRANCHES.find((q) => q.manual === k);
      S.manuals[k] = true;
      return { msg: 'Manual: ' + (b ? b.manualName : k) + '. Abre la rama de ' + (b ? b.name.toLowerCase() : '') + ' (se aprende al descansar)', left: 0 };
    }
    return { msg: '', left: n };
  }

  // ================= Las pantallas =================
  let ui = null, uiRoot = null, padPrev = {};
  const hintKeys = () => (G.Input && G.Input.isTouch ? '' : ' <small>(Esc)</small>');
  function ensureUI() {
    if (uiRoot) return;
    uiRoot = document.createElement('div'); uiRoot.id = 'sv-ui'; uiRoot.className = 'hidden';
    document.body.appendChild(uiRoot);
    uiRoot.addEventListener('pointerdown', (e) => e.stopPropagation());
    uiRoot.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b || !ui) return;
      e.preventDefault();
      const fs = Array.from(uiRoot.querySelectorAll('[data-f]')), i = fs.indexOf(b);
      if (i >= 0) ui.sel = i;
      ui.key(b.dataset.k, b.dataset.d);
    });
    window.addEventListener('keydown', (e) => {
      if (!ui) return;
      const K = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
        Enter: 'ok', Space: 'ok', KeyE: 'ok', KeyF: 'ok', KeyT: 'ok', Escape: 'back', Backspace: 'back', KeyQ: 'back', KeyB: 'back' }[e.code];
      e.preventDefault(); e.stopPropagation();
      if (!K || e.repeat || performance.now() - ui.t0 < 220) return;
      ui.key(K);
    }, true);
  }
  function openUI(o) {
    ensureUI();
    o.t0 = performance.now(); o.sel = o.sel || 0;
    ui = o; padPrev = {};
    uiRoot.className = 'sv-' + o.kind;
    document.body.classList.toggle('sv-resting', o.kind === 'rest');
    o.render();
    snd('uiOk');
    if (G.Input && !G.Input.isTouch && G.Input.pointerLocked && document.exitPointerLock) document.exitPointerLock();
  }
  function closeUI() {
    if (!ui) return;
    const o = ui; ui = null;
    uiRoot.className = 'hidden'; uiRoot.innerHTML = '';
    document.body.classList.remove('sv-resting');
    snd('uiBack');
    if (o.onClose) o.onClose();
    if (G.Input && !G.Input.isTouch && G.Input.enabled && G.Input.requestLock && !ui) G.Input.requestLock();
  }
  // moverse entre los botones (↑ ↓) y pulsar el elegido (Aceptar)
  function focus(o) {
    const fs = uiRoot.querySelectorAll('[data-f]');
    if (!fs.length) return;
    o.sel = Math.max(0, Math.min(o.sel || 0, fs.length - 1));
    fs.forEach((b, i) => b.classList.toggle('foc', i === o.sel));
    if (fs[o.sel].scrollIntoView) fs[o.sel].scrollIntoView({ block: 'nearest' });
    // (el panel del descanso: abajo, lo que hace lo elegido)
    const dsc = uiRoot.querySelector('.gr-desc');
    if (dsc) dsc.textContent = fs[o.sel].dataset.desc || '';
  }
  function nav(o, k) {
    const fs = Array.from(uiRoot.querySelectorAll('[data-f]'));
    if (k === 'up' || k === 'down') { if (!fs.length) return true; o.sel = (o.sel + (k === 'up' ? fs.length - 1 : 1)) % fs.length; focus(o); snd('ui'); return true; }
    if (k === 'ok') { const b = fs[o.sel]; if (b) o.key(b.dataset.k, b.dataset.d); return true; }
    return false;
  }
  function padUI() {
    const ps = navigator.getGamepads ? navigator.getGamepads() : [];
    let pd = null; for (let i = 0; i < ps.length; i++) if (ps[i] && ps[i].connected) { pd = ps[i]; break; }
    if (!pd || !ui) return;
    const ax = pd.axes || [], bt = (i) => !!(pd.buttons[i] && pd.buttons[i].pressed);
    const now = { up: bt(12) || ax[1] < -0.6, down: bt(13) || ax[1] > 0.6, left: bt(14) || bt(4) || ax[0] < -0.6, right: bt(15) || bt(5) || ax[0] > 0.6, ok: bt(0), back: bt(1) };
    const prev = padPrev; padPrev = now;
    if (performance.now() - ui.t0 < 250) return;
    for (const k in now) if (now[k] && !prev[k]) { ui.key(k); return; }
  }
  function noteUI(title, text, after) {
    snd('rustle', { vol: 0.35 });
    const o = { kind: 'note', onClose: after };
    o.render = () => { uiRoot.innerHTML = '<div class="sv-card sv-paper"><h3>' + esc(title) + '</h3><div class="sv-txt">' + para(text) + '</div><div class="sv-ft"><button type="button" data-f data-k="back">Cerrar' + hintKeys() + '</button></div></div>'; focus(o); };
    o.key = (k) => { if (k === 'ok' || k === 'back') closeUI(); };
    openUI(o);
  }
  // al empezar una partida: quién eres y cómo va esto
  function introUI(done) {
    const o = { kind: 'intro' };
    o.render = () => {
      uiRoot.innerHTML = '<div class="sv-card sv-intro"><small>MODO SUPERVIVENCIA · BETA</small><h3>La Trece</h3><div class="sv-txt">' +
        para('Los Escorpiones acabaron con tu gente. De los Supervivientes, quedas tú: Eira, la Trece.\nEste es tu escondite, en la costa de Oceanside. Desde aquí, la vía lleva al asentamiento y la playa a la casa del pescador; más allá del asentamiento está el faro. Por el hueco de la valla del este sale el camino del bosque hacia la garita del depósito (al final, la persiana del taller), y de la garita, en tu coche, se llega a la ciudad.\nEn los descansos (el saco y los fuegos) se guarda, se cura comiendo algo, se elige la hora a la que salir, se cocina y se viaja a otro fuego ya encendido (cuesta comida y agua). Las piezas de las armas se montan en tu mesa; los manuales abren habilidades.\nSi caes, despiertas en el último descanso con lo que llevabas entonces.') +
        '</div><div class="sv-ft"><button type="button" data-f data-k="back">Empezar</button></div></div>';
      focus(o);
    };
    o.key = (k) => { if (k === 'ok' || k === 'back') closeUI(); };
    o.onClose = done;
    openUI(o);
  }

  // ---------- la prueba (modo libre) ----------
  const TEST_DEF = { zone: 'escondite', hour: 'manana', comida: 3, agua: 3, venda: 2, sup: 0, amb: 'normal', fuerza: 'normal', cura: 'normal', rests: 'uno', kit: 'superv', skills: 'cerradas', parts: 'no' };
  let testSel = null;
  function openTest(p) {
    const T = testSel = Object.assign({}, TEST_DEF, testSel || {});
    const rows = [
      ['zone', 'Empezar en', Object.keys(ZONES).map((z) => [z, ZONES[z].name])],
      ['hour', 'Hora', HOURS.map((h) => [h.id, h.name])],
      ['comida', 'Comida', [0, 1, 2, 3, 5, 8].map((n) => [n, String(n)])],
      ['agua', 'Agua', [0, 1, 2, 3, 5, 8].map((n) => [n, String(n)])],
      ['venda', 'Vendas', [0, 1, 2, 4].map((n) => [n, String(n)])],
      ['sup', 'Suplementos', [0, 30, 100, 300].map((n) => [n, String(n)])],
      ['amb', 'Emboscada al viajar', [['normal', 'Según la hora'], ['siempre', 'Siempre'], ['nunca', 'Nunca']]],
      ['fuerza', 'Fuerza de la emboscada', [['normal', 'Normal'], ['fuerte', 'Fuerte']]],
      ['cura', 'Perder una venda al viajar', [['normal', '1 de cada 4'], ['siempre', 'Siempre'], ['nunca', 'Nunca']]],
      ['rests', 'Descansos encendidos', [['uno', 'Solo el escondite'], ['todos', 'Todos']]],
      ['kit', 'Equipo', [['superv', 'El de empezar'], ['actual', 'Lo que llevas ahora']]],
      ['skills', 'Manuales', [['cerradas', 'Hay que encontrarlos'], ['abiertas', 'Todos']]],
      ['parts', 'Piezas', [['no', 'Hay que encontrarlas'], ['todas', 'Todas']]]
    ];
    const o = { kind: 'test', sel: 0 };
    o.render = () => {
      uiRoot.innerHTML = '<div class="sv-card sv-test"><div class="sv-head"><small>MODO LIBRE · PRUEBA</small><h3>Modo supervivencia</h3><p class="sv-lead">Juegas con Eira. Elige con qué empiezas y fuerza lo que quieras probar. No se guarda nada; desde cualquier descanso vuelves al modo libre.</p></div>' +
        '<div class="sv-body"><ul class="sv-form">' + rows.map(([k, name, opts]) => '<li><span>' + name + '</span><div>' + opts.map(([v, t]) => '<button type="button" data-f data-k="opt" data-d="' + k + ':' + v + '" class="' + (String(T[k]) === String(v) ? 'on' : '') + '">' + esc(t) + '</button>').join('') + '</div></li>').join('') + '</ul></div>' +
        '<div class="sv-ft"><button type="button" data-f data-k="start" class="main">Empezar la prueba</button><button type="button" data-f data-k="back">Cancelar' + hintKeys() + '</button></div></div>';
      focus(o);
    };
    o.key = (k, d) => {
      if (k === 'left' || k === 'right') {
        // (con el mando o las flechas: ← → cambia la opción de la fila elegida)
        const fs = Array.from(uiRoot.querySelectorAll('[data-f]')), b = fs[o.sel];
        if (b && b.dataset.k === 'opt') { const row = b.parentElement, bs = Array.from(row.querySelectorAll('[data-f]')), i = bs.indexOf(b), nb = bs[(i + (k === 'left' ? bs.length - 1 : 1)) % bs.length]; o.sel = fs.indexOf(nb); nb.click(); }
        return;
      }
      if (nav(o, k)) return;
      if (k === 'back') { closeUI(); return; }
      if (k === 'opt') { const [kk, v] = d.split(':'); T[kk] = isNaN(+v) ? v : +v; snd('ui'); o.render(); return; }
      if (k === 'start') { closeUI(); startTest(p, Object.assign({}, T)); }
    };
    openUI(o);
  }
  function startTest(p, T) {
    prevChar = p.charId;
    if (G.Run && G.Run.active) G.Run.keep(p);
    const cur = T.kit === 'actual' ? G.Run.snap(p) : null;
    host.load(() => {
      host.setMode('superv');
      if (G.Refugio) G.Refugio.leave();
      if (p.charId !== 'eira') p.setCharacter('eira');
      test = T;
      begin(null, T, cur);
    }, null, 3.0);
  }
  function backToFree() {
    const pc = prevChar;
    stop();
    host.backToFree(pc);
  }

  // ================= El HUD =================
  function hud(now) {
    if (!hudEl) { hudEl = document.createElement('div'); hudEl.id = 'sv-hud'; document.body.appendChild(hudEl); barEl = document.createElement('div'); barEl.id = 'sv-bar'; barEl.className = 'hidden'; barEl.innerHTML = '<i></i><b>Girando la manivela</b>'; document.body.appendChild(barEl); }
    if (!active || !S) { hudEl.className = 'hidden'; barEl.className = 'hidden'; return; }
    hudEl.className = '';
    const where = S.where === 'paso' && S.paso ? PASOS[S.paso.id].name : (S.where === 'camino' ? 'El camino de la costa' : ZONES[S.zone].name);
    hudEl.innerHTML = '<b>' + esc(where) + '</b><span class="r-comida"><i></i>' + S.res.comida + '</span><span class="r-agua"><i></i>' + S.res.agua + '</span><span class="r-sup"><i></i>' + S.sup + '</span>' + (test ? '<em>prueba</em>' : '<em>beta</em>');
  }

  // ================= Empezar, seguir, morir =================
  // cont: la partida guardada (null: nueva); T: la prueba (con lo elegido); cur: el equipo de antes (la prueba)
  function begin(saved, T, cur) {
    active = true;
    registerKinds();
    S = saved ? saved.live : fresh();
    snapRest = saved ? (saved.snap || clone(saved.live)) : null;
    if (T) {
      S.hour = T.hour; S.res.comida = T.comida; S.res.agua = T.agua; S.sup = T.sup; S.zone = S.rest = T.zone;
      if (T.rests === 'todos') for (const z in ZONES) S.visited[z] = true;
      else S.visited[T.zone] = true;
      if (T.skills === 'abiertas') for (const b of BRANCHES) S.manuals[b.manual] = true;
      if (T.parts === 'todas') for (const id in PARTS) S.parts[id] = 1;
      S.intro = true;
    }
    const p = P();
    // la Trece, con el poncho (el aspecto secundario, comprado o no: es la ropa de este modo)
    if (G.Player.forceSkin) G.Player.forceSkin('eira', true, p);
    // el equipo: el de empezar (o lo que se llevaba, en la prueba)
    if (!S.inv) {
      if (cur) { G.Run.unsnap(p, cur); p.health = 100; }
      else kitNew(p);
      if (T) p.items.venda = T.venda;
      S.inv = G.Run.snap(p);
    }
    if (!snapRest) snapRest = clone(S);
    enterZone(S.rest, { rest: true });
    if (!S.intro) { S.intro = true; save(); setTimeout(() => { if (active) introUI(); }, 1400); }
  }
  function start(cont) {
    prevChar = null; test = null;
    const sv = cont ? readSave() : null;
    if (!cont) { try { localStorage.removeItem(KEY); } catch (e) { /* nada */ } }
    begin(sv, null, null);
  }
  function respawn() {
    S = clone(snapRest || S);
    host.shift(() => { enterZone(S.rest, { rest: true }); }, () => host.toast('Despiertas en ' + lc(ZONES[S.rest].name) + '. Lo que cogiste desde que descansaste, se perdió', 'warn'));
  }
  function quit() { if (!active || !S) return; if (!(P() && P().dead)) leaveHere(); save(); }
  function stop() {
    closeUI();
    clearScene();
    active = false;
    restFade = false;
    S = null; snapRest = null; test = null;
    Surv.pasoKind = null;
    // (a medio camino en el coche o en la persiana: todo fuera)
    if (trip && G.Drive && G.Drive.active) G.Drive.stop(true);
    trip = null;
    if (G.World.setBoost) G.World.setBoost(0);
    if (G.Sky) G.Sky.fogMul = 1;
    if (G.Audio) G.Audio.calm = false;
    if (cine) { cine = false; G.Camera.held = false; G.Camera.fovOff = 0; document.body.classList.remove('sv-cine'); if (G.Input) G.Input.enabled = true; }
    if (G.Player.forceSkin) G.Player.forceSkin('eira', false, P());
    hud(false);
  }
  function busy() { return !!ui || restFade; }
  function fogAt(F, p) { const t = U.clamp((Math.hypot(p.pos.x - F.x, p.pos.z - F.z) - F.r0) / (F.r1 - F.r0), 0, 1); return F.k + (1 - F.k) * U.smooth(t); }

  // ================= Cada fotograma =================
  function update(dt, p) {
    if (!active || !R) return;
    R.t += dt;
    if (ui) padUI();
    updateFires(dt);
    updateCarry(p);
    for (const a of R.anims) a(dt);
    updateGate(dt, p);
    updatePers(dt, p);
    updateSitCam(dt);
    if (!R) return;
    // la niebla de un sitio (el camino del bosque: cada vez más espesa hacia la persiana; en la garita, la que entra)
    if (G.Sky) { const Fz = S.where === 'zone' && ZONES[S.zone] && ZONES[S.zone].fog; G.Sky.fogMul = Fz ? fogAt(Fz, p) : 1; }
    // (en el refugio, el sonido de la calma: ni gemidos lejanos ni el zumbido grave; solo el viento)
    if (G.Audio) G.Audio.calm = !!(S.where === 'zone' && ZONES[S.zone] && ZONES[S.zone].safe && !R.pers);
    updateNotes(p);
    updateHerds(dt);
    updateTrickle(dt, p);
    updateFlocks(dt, p);
    updateSounds(dt, p);
    updateAmbush(dt);
    if ((R.findT -= dt) <= 0) { R.findT = 0.5; syncFinds(); }
    if ((hudT -= dt) <= 0) { hudT = 0.25; hud(); }
    // la barra de la manivela (la de la reja o la de la persiana)
    if (barEl) {
      const pq = R.pers && (R.pers.phase === 'zoom' || R.pers.phase === 'crank') ? R.pers : null;
      const on = !!(pq || R.crank || (R.gate && R.gate.k > 0 && !R.gate.open && !R.gate.falling));
      barEl.className = on && (R.crank || pq) ? '' : 'hidden';
      if (on) barEl.querySelector('i').style.width = Math.round((pq ? pq.k : (R.gate ? R.gate.k : 0)) * 100) + '%';
    }
  }

  const Surv = {
    init(h) { host = h; registerKinds(); registerLore(); },
    HOURS, ZONES, PASOS, PARTS, BRANCHES, RECIPES,
    start, begin, stop, quit, respawn, update, openTest,
    room, takeItem, doorLabel, doorUse,
    pasoKind: null,
    get active() { return active; },
    get test() { return !!test; },
    get busy() { return !!ui || (active && restFade); },          // (el panel de la prueba se abre también desde el modo libre)
    get state() { return S; },
    get here() { return R; },
    get saved() { const d = readSave(); return d ? { zone: d.live.rest, rests: d.live.stats ? d.live.stats.rests : 0 } : null; },
    // (girando la manivela: el botón de Recoger sigue en pantalla mientras se mantiene)
    get cranking() { return !!(active && R && (R.crank || (R.pers && (R.pers.phase === 'zoom' || R.pers.phase === 'crank')))); },
    // la escena de la persiana (camina sola) y el coche
    get cine() { return active && cine; },
    cineInput, cineCam, driveTick,
    get driving() { return !!trip; },
    upgraded(wid, uid) { return !!(S && S.up[wid] && S.up[wid][uid]); },
    get noListen() { return active && !!S && !(S.skills.sigilo >= 1); },
    // lo que suman las habilidades aprendidas (G.Skills.bonus)
    bonus(key) {
      if (!S) return 0;
      let v = 0;
      for (const b of BRANCHES) { const n = S.skills[b.id] || 0; for (let i = 0; i < n; i++) if (b.levels[i].key === key) v += b.levels[i].val; }
      return v;
    },
    // los cuerpos de infectados a tener armados (detrás del fundido): según la zona y la hora
    poolNeed() {
      if (!S) return { z: 6 };
      const H = hourDef(S.hour);
      if (S.where === 'camino' || (R && R.amb)) return { z: 8, stalker: 1, blind: 1, temb: 1 };
      if (S.where === 'paso') return { z: 1 };
      const Z = ZONES[S.zone], k = Z.big ? 2 : 1, scSt = (Z.scenes || []).reduce((a, sc) => a + (sc.stalker || 0), 0);
      return { z: Math.round(Z.zombies * H.zk) + sceneCount(Z, H) - scSt + 2, stalker: Z.hub ? 0 : H.stalk * k + scSt, blind: Z.hub ? 0 : H.blind * k };
    },
    // el texto de la pantalla de muerte
    deadText() { return 'Despertarás en ' + (S && ZONES[S.rest] ? lc(ZONES[S.rest].name) : 'el escondite') + ', el último sitio donde descansaste. Lo que cogiste desde entonces, se pierde.'; }
  };
  // (para las pruebas automáticas)
  Surv._t = { enterZone, enterPaso, enterAmbush, travel, restStart, openRest, restEnd, goPaso, goZone, arrive, warnUI, closeUI, goCar, persStart, get trip() { return trip; }, get R() { return R; }, get ui() { return ui; } };
  G.Surv = Surv;
})(window.Game = window.Game || {});
