(function (G) {
  'use strict';

  // Modo Retorno: una carrera de 7 enfrentamientos (y el jefe final: el hongomorfo, en el salón recreativo) con un refugio
  // entre uno y otro. Aquí vive el estado de la carrera: el mapa de enfrentamientos, las monedas (para el
  // puesto de comercio) y las piezas (para el banco de mejoras), las mejoras de las armas, lo que hay a la
  // venta, lo que espera en el cofre de recompensas y lo que llevas encima.
  //
  // Guardado (como un roguelike): solo se guarda en el refugio. Al empezar un enfrentamiento la partida queda
  // marcada; si sales a mitad (o se cierra el juego) la carrera se pierde. Una carrera nueva desde el menú
  // principal empieza de cero (sin mejoras).

  const KEY = 'ceniza.retorno';
  const STEPS = 7;                  // (antes 5: dos enfrentamientos más hasta el jefe)
  // Partida diaria: una sola por día (se reinicia a medianoche), 10 enfrentamientos, el mismo mapa para todos
  // ese día (sale de la fecha), un personaje desbloqueado al azar y más difícil (más enemigos, golpes que
  // duelen más y algo menos de recompensa). Se guarda aparte: no pisa la carrera normal
  const DAILY_STEPS = 10;
  const DKEY = 'ceniza.diaria.carrera';       // la carrera diaria guardada
  const DSTATE = 'ceniza.diaria';             // { day, char, res: 'jugando' | 'perdida' | 'completada' }
  const DAILY = { hurt: 1.25, enemies: 1.25, reward: 0.85 };
  const U = G.Util;

  // ---------- Enfrentamientos ----------
  const TYPES = {
    asalto: { name: 'Asalto', text: 'Aguanta tres oleadas de infectados que llegan desde todo el mapa. Al despejar cada oleada aparece un cofre con suministros.', foes: 'Corredores y observadores; en la 2.ª oleada, a veces un chasqueador o un temblante; en la 3.ª, uno o dos temblantes.' },
    caza: { name: 'Caza', text: 'Sobrevive hasta que se acabe el tiempo. Los infectados no dejan de llegar (como mucho 12 a la vez) y cada vez más rápido cuanto menos falta para volver.', foes: 'Muchos corredores, algunos chasqueadores y pocos observadores. Sin temblantes.' },
    asalto_h: { name: 'Asalto · Escorpiones', text: 'Unos saqueadores de los Escorpiones rondan la zona. Dos oleadas de exploradores con pistola y carroñeros con palos; el último en pie huirá a buscar a su grupo, y la tercera oleada será ese grupo, con su líder.', foes: 'Los Escorpiones: exploradores (pistola) y carroñeros (palo); en la tercera oleada, un escuadrón con líder, tirador, escopetero, bruto... Sin infectados.' },
    caza_h: { name: 'Caza · Escorpiones', text: 'Aguanta hasta que se acabe el tiempo mientras los Escorpiones te buscan por el mapa. Llegan de a poco: como mucho ocho, y nunca más de cuatro a la vez.', foes: 'Los Escorpiones: exploradores (pistola), carroñeros (palo) y pistoleros. Sin infectados.' },
    saqueo: { name: 'Saqueo', text: 'Los Escorpiones protegen una caja fuerte con botín y no la van a soltar. Tienes 3 min 30 s para abrirla (girando la rueda o encajando los pernos en el momento justo: fallar hace ruido), a escondidas o acabando con ellos. Si se acaba el tiempo, vuelves con un cuarto de la recompensa.', foes: 'Los Escorpiones: un escuadrón con su líder, tirador, escopetero, bruto, sigilosa... Sin infectados.' },
    resistencia: { name: 'Resistencia', text: 'Aguanta las oleadas de infectados con un compañero (uno de los personajes que no llevas). Va contigo por todo el mapa, pelea y te ayuda, pero aguanta poco: si cae, pierdes.', foes: 'Infectados: corredores en grupos pequeños y, al final, algún chaskeado o temblante.' },
  };
  TYPES.liberacion = { name: 'Liberación', text: 'Cuélate en la Red del Capitolio, donde los Escorpiones tienen presos a los tuyos, y sácalos con vida. Puedes liberar a varios a la vez, cuando quieras: si es pronto, salen sin armas con toda la guardia despierta. Luego, salid juntos por donde entraste. Hay Supervivientes en otras celdas (liberarlos es opcional) y chasqueadores encadenados que dan la alarma.', foes: 'La guarnición de los Escorpiones (tres grupos repartidos por la sede) y chasqueadores encadenados.' };
  // paradas: nodos sin pelea (ver EVENTS)
  TYPES.descanso = { name: 'Descanso', calm: true, text: 'Un sitio tranquilo en el camino, sin enemigos: recórrelo, resuelve lo que esconde y siéntate un rato junto al fuego. Te vas cuando quieras, por donde llegaste.', foes: 'Sin enemigos.' };
  TYPES.mercader = { name: 'Comerciante', calm: true, text: 'Un comerciante de paso de los Supervivientes. Sus precios no son los del refugio, y solo hace un trato.', foes: 'Sin enemigos.' };
  TYPES.suceso = { name: 'Suceso', calm: true, text: 'Algo en el camino. Habrá que decidir qué hacer; algunas opciones son seguras y otras se la juegan.', foes: 'Sin enemigos... casi seguro.' };
  TYPES.escuadron = TYPES.saqueo;          // (carreras guardadas de antes: el escuadrón es ahora el saqueo)
  // duración de la caza según la columna del mapa (segundos)
  const CAZA_T = [120, 135, 150, 165, 180];

  // ---------- Modificadores de ruta ----------
  // Algunos enfrentamientos del mapa traen un modificador (se sortea al crear el mapa; los de los desvíos lo traen casi
  // siempre): lo pone más difícil y paga más. rew: lo que suma a la recompensa (ya va contado en lo que muestra el mapa);
  // k: lo que multiplica durante el enfrentamiento (enemies: cuántos llegan; hp: cuánto aguantan; hurt: cuánto duelen los
  // golpes; ammo: la munición del mapa y la que sueltan). sky: cambia la hora o el clima (solo en mapas con cielo);
  // inf: solo contra infectados
  const MODS = {
    niebla: { name: 'Niebla espesa', rew: 0.15, sky: true, text: 'Casi no se ve a lo lejos: ni tú a ellos, ni ellos a ti.' },
    noche: { name: 'Noche cerrada', rew: 0.25, sky: true, inf: true, text: 'Se juega de noche, con la linterna: salen más infectados y más acechadores.' },
    horda: { name: 'Horda', rew: 0.3, k: { enemies: 1.3 }, text: 'Llegan bastantes más enemigos de lo normal.' },
    curtidos: { name: 'Curtidos', rew: 0.25, k: { hp: 1.25 }, text: 'Los enemigos aguantan una cuarta parte más.' },
    sangre: { name: 'Heridas abiertas', rew: 0.25, k: { hurt: 1.3 }, text: 'Cada golpe que recibes duele bastante más.' },
    escasez: { name: 'Munición escasa', rew: 0.2, k: { ammo: 0.4 }, text: 'En el mapa apenas hay balas y los enemigos casi no sueltan.' },
    nido: { name: 'Nido de chasqueadores', rew: 0.25, inf: true, text: 'Muchos de los corredores son chasqueadores: conviene ir en silencio.' },
    cerrado: { name: 'Sin comercio al volver', rew: 0.35, text: 'A la vuelta, el puesto de comercio está cerrado hasta el siguiente enfrentamiento.' },
    calma: { name: 'Zona tranquila', rew: -0.2, good: true, k: { enemies: 0.75 }, text: 'Llegan menos enemigos, y también hay menos que llevarse.' }
  };
  const MOD_P = 0.35, MOD_P_SUB = 0.85;        // probabilidad de modificador: en la línea y en un desvío

  // ---------- Paradas (nodos sin pelea) ----------
  // Entre los enfrentamientos, a veces hay una parada: no se pelea ni da la recompensa de siempre. Se resuelve desde el
  // mapa del refugio con una pantalla de texto y unas opciones. Tres tipos: descanso (curarte o rebuscar), comerciante
  // de paso (un solo trato, con precios raros) y suceso (una decisión; algunas opciones se la juegan).
  // Cada opción: label; cost (lo que cuesta: monedas, piezas, suplementos) y need (cosas que hay que llevar: se gastan);
  // out: los desenlaces posibles (p: probabilidad; el último se lleva lo que falte). Cada desenlace: text y lo que da o
  // quita: monedas, piezas, suplementos, vida (negativa: daño; nunca mata), items { id: n }, balas (k: munición para
  // las armas que llevas, en veces lo que trae el comercio), weapon (un arma), fix (arregla el arma cuerpo a cuerpo)
  const CALM = { descanso: 1, mercader: 1, suceso: 1 };
  const CALM_N = 3, CALM_P_SUB = 0.4;          // tres descansos (sitios que se juegan) en cada línea y, a veces, una parada al final de un desvío
  // (con quién va la carrera al hacer el mapa: los refugios de los otros salen según el personaje, ver calm.js)
  let mapChar = null;
  const EVENTS = {
    // --- descansos ---
    caseta: { type: 'descanso', title: 'La caseta del guardabosques', text: 'Una caseta con la puerta entera y una estufa de leña. Nadie ha pasado por aquí en semanas.', opts: [
      { label: 'Dormir unas horas', hint: 'Recuperas 60 de vida.', out: [{ text: 'Atrancas la puerta y duermes de un tirón por primera vez en días.', vida: 60 }] },
      { label: 'Registrarla a fondo', hint: 'Una venda, balas y algunos suplementos.', out: [{ text: 'Debajo del catre hay una caja de primeros auxilios y, en el armario, munición de caza.', items: { venda: 1 }, balas: 1, suplementos: 10 }] }
    ] },
    barca: { type: 'descanso', title: 'La barca varada', text: 'Una barca de pesca varada en la arena, con la cabina cerrada por dentro. Quien la cerró ya no está.', opts: [
      { label: 'Descansar en la cabina', hint: 'Recuperas 60 de vida.', out: [{ text: 'El mar tapa cualquier otro ruido. Duermes con la navaja en la mano y nadie viene.', vida: 60 }] },
      { label: 'Vaciar las taquillas', hint: 'Una venda, balas y algunos suplementos.', out: [{ text: 'Bengalas mojadas, un botiquín en buen estado y una caja de balas envuelta en plástico.', items: { venda: 1 }, balas: 1, suplementos: 10 }] }
    ] },
    // --- comerciante de paso (los tratos se sortean al crear el mapa: van en el nodo) ---
    carro: { type: 'mercader', title: 'Comerciante de paso', text: 'Una mujer de los Supervivientes con un carro cargado hasta arriba y una escopeta en el regazo. Tiene prisa: te deja hacer un trato y se va.', opts: [] },
    // --- sucesos ---
    herido: { type: 'suceso', title: 'El coche volcado', text: 'Un hombre de los Supervivientes, con la pierna abierta, te hace señas desde un coche volcado. No puede caminar.', opts: [
      { label: 'Darle una venda', hint: 'Gastas una venda.', need: { venda: 1 }, out: [{ text: 'Lo vendas y lo dejas a cubierto. Te da lo que llevaba encima: ya no lo va a necesitar hoy.', piezas: 25, suplementos: 30 }] },
      { label: 'Registrar el coche y seguir', hint: 'Algo habrá en la guantera.', out: [{ text: 'No lo miras a la cara. En la guantera quedaban unas monedas.', monedas: 3 }] }
    ] },
    alijo: { type: 'suceso', title: 'La caja del escorpión', text: 'Una caja con el escorpión pintado, en mitad del camino y sin guardia a la vista. Demasiado fácil.', opts: [
      { label: 'Abrirla', hint: 'Puede estar llena... o tener trampa.', out: [
        { p: 0.6, text: 'Estaba llena. Alguien de los Escorpiones va a tener un mal día.', piezas: 30, monedas: 8 },
        { text: 'El cable estaba por dentro. La tapa te revienta en las manos; aun así, algo se salva.', vida: -25, piezas: 10 }] },
      { label: 'Desmontarla desde lejos', hint: 'Seguro, pero se pierde casi todo.', out: [{ text: 'Le tiras un ladrillo desde detrás de un coche. Si había trampa, ya no. De lo que queda, poco sirve.', piezas: 10 }] }
    ] },
    puente: { type: 'suceso', title: 'El puente', text: 'El camino corto cruza un puente con infectados dormidos entre los coches. El largo rodea por el río.', opts: [
      { label: 'Cruzar en silencio', hint: 'Los coches no están vacíos. Ellos, quizá, tampoco dormidos.', out: [
        { p: 0.55, text: 'Ni uno levanta la cabeza. De los maleteros abiertos sale munición y algo de dinero.', balas: 1.5, monedas: 6 },
        { text: 'Uno te agarra del tobillo desde debajo de un coche. Sales, pero cojeando.', vida: -22, balas: 0.5 }] },
      { label: 'Rodear por el río', hint: 'Sin riesgo.', out: [{ text: 'En la orilla, enganchado a unas cañas, hay un botiquín de pesca.', suplementos: 20 }] }
    ] },
    farmacia: { type: 'suceso', title: 'La farmacia', text: 'Una farmacia con la persiana a medio bajar. Dentro se oye algo que arrastra los pies.', opts: [
      { label: 'Entrar hasta la trastienda', hint: 'Ahí es donde está lo bueno.', out: [
        { p: 0.5, text: 'Lo que arrastraba los pies estaba encerrado en el baño. La trastienda es tuya.', items: { venda: 2 }, suplementos: 15 },
        { text: 'No estaba encerrado. Te llevas un zarpazo en el antebrazo y una sola venda del estante.', vida: -18, items: { venda: 1 } }] },
      { label: 'Coger lo del mostrador y salir', hint: 'Sin riesgo.', out: [{ text: 'Vitaminas, calmantes, un frasco sin etiqueta. Mejor que nada.', suplementos: 20 }] }
    ] },
    taller: { type: 'suceso', title: 'El taller', text: 'Un taller con la puerta abierta. El banco de trabajo todavía tiene las herramientas colgadas.', opts: [
      { label: 'Desmontar todo lo que sirva', hint: 'Piezas para el banco de mejoras.', out: [{ text: 'Muelles, tornillos, un torno de mano. Te llevas lo que cabe.', piezas: 40 }] },
      { label: 'Arreglar tu arma cuerpo a cuerpo', hint: 'Queda como nueva.', need: { melee: 1 }, out: [{ text: 'Una hora de lima y cinta. Vuelve a pegar como el primer día.', fix: true, piezas: 10 }] }
    ] },
    mochila: { type: 'suceso', title: 'La mochila en la rama', text: 'Una mochila colgada de una rama, bien a la vista. Debajo, la tierra está removida.', opts: [
      { label: 'Descolgarla', hint: 'Está llena. Lo del suelo, a saber.', out: [
        { p: 0.65, text: 'La tierra removida era una tumba, no una trampa. La mochila ya no le hace falta a nadie.', balas: 1.5, items: { molotov: 1 } },
        { text: 'Era una mina. Te tira de espaldas y la mochila acaba en el árbol de al lado, hecha trizas.', vida: -30, balas: 0.5 }] },
      { label: 'Tirarle una piedra antes', hint: 'Seguro, pero se rompe algo.', out: [{ text: 'La mina revienta sola. De la mochila se salva la mitad.', balas: 0.75 }] }
    ] }
  };
  const EV_BY = (type) => Object.keys(EVENTS).filter((id) => EVENTS[id].type === type);
  // los tratos del comerciante: tres al azar, distintos. cost / lo que da, como los desenlaces
  const DEALS = [
    { label: 'Dos vendas', cost: { monedas: 4 }, items: { venda: 2 } },
    { label: 'Una molotov y una mina', cost: { monedas: 6 }, items: { molotov: 1, mina: 1 } },
    { label: 'Munición para tus armas', cost: { monedas: 3 }, balas: 2 },
    { label: 'Te cose las heridas', cost: { monedas: 5 }, vida: 50 },
    { label: 'Te compra piezas', cost: { piezas: 30 }, monedas: 10 },
    { label: 'Te vende piezas', cost: { monedas: 8 }, piezas: 40 },
    { label: 'Vendas por suplementos', cost: { suplementos: 40 }, items: { venda: 2 } },
    { label: 'Suplementos de contrabando', cost: { monedas: 5 }, suplementos: 45 },
    { label: 'Un revólver de segunda mano', cost: { monedas: 6 }, weapon: 'revolver' },
    { label: 'Una escopeta recortada a mano', cost: { piezas: 45 }, weapon: 'escopeta' },
    { label: 'Un arco de caza', cost: { monedas: 5 }, weapon: 'arco' }
  ];

  // ---------- Rango por personaje ----------
  // Cada carrera (ganada o perdida) da experiencia al personaje con el que la empezaste. Al subir de rango, ese
  // personaje empieza las carreras siguientes con algo más (en la partida diaria no cuenta: es igual para todos).
  // at: experiencia que hace falta
  const XKEY = 'ceniza.rangos';
  const RANKS = [
    { at: 0, text: '' },
    { at: 60, perk: 'venda', text: 'Empieza con una venda más.' },
    { at: 150, perk: 'monedas', text: 'Empieza con 4 monedas más.' },
    { at: 280, perk: 'sup', text: 'Empieza con 40 suplementos.' },
    { at: 450, perk: 'balas', text: 'Empieza con más munición para sus armas.' },
    { at: 700, perk: 'piezas', text: 'Empieza con 30 piezas y una molotov.' }
  ];
  const XP_DIFF = { facil: 0.6, normal: 0.8, dificil: 1 };
  const Rank = {
    LIST: RANKS,
    read() { try { const r = JSON.parse(localStorage.getItem(XKEY) || '{}'); return r && typeof r === 'object' ? r : {}; } catch (e) { return {}; } },
    xp(id) { return Math.max(0, Math.floor(this.read()[id] || 0)); },
    of(xp) { let n = 1; for (let i = 1; i < RANKS.length; i++) if (xp >= RANKS[i].at) n = i + 1; return n; },
    // { rank (1 a 6), xp, at (donde empezó este rango), next (lo que pide el siguiente; null en el último), perks, nextText }
    info(id) {
      const xp = this.xp(id), rank = this.of(xp), nx = RANKS[rank] || null;
      return { rank, max: RANKS.length, xp, at: RANKS[rank - 1].at, next: nx ? nx.at : null, perks: RANKS.slice(1, rank).map((r) => r.text), nextText: nx ? nx.text : '' };
    },
    // lo que da una carrera que termina: 10 por parada superada, 25 por llegar al jefe y 60 por completarla
    // (menos en Fácil y en Normal; algo más en la diaria)
    worth(run, completed) {
      const n = run.steps || STEPS, step = Math.min(n, run.step || 0);
      const base = step * 10 + (step >= n ? 25 : 0) + (completed ? 60 : 0);
      return Math.max(5, Math.round(base * (XP_DIFF[run.diff] || 1) * (run.daily ? 1.25 : 1)));
    },
    gain(run, completed) {
      const id = run.revenge ? run.revenge.from : run.char;          // (si caíste en la liberación: cuenta para quien empezó)
      if (!id) return null;
      const all = this.read(), from = this.of(Math.floor(all[id] || 0)), xp = this.worth(run, completed);
      all[id] = Math.floor(all[id] || 0) + xp;
      try { localStorage.setItem(XKEY, JSON.stringify(all)); } catch (e) { /* sin almacenamiento */ }
      const to = this.of(all[id]);
      return { char: id, xp, from, to, text: to > from ? RANKS[to - 1].text : '' };
    },
    // las ventajas del rango, al empezar una carrera (después del equipo del personaje)
    apply(player, run, id) {
      const rank = this.of(this.xp(id)), has = (k) => RANKS.slice(1, rank).some((r) => r.perk === k);
      if (rank < 2 || !run) return rank;
      if (has('monedas')) run.monedas += 4;
      if (has('sup')) run.suplementos = (run.suplementos || 0) + 40;
      if (has('piezas')) run.piezas += 30;
      if (!player) return rank;
      if (has('venda')) player.items.venda = (player.items.venda || 0) + 1;
      if (has('piezas') && !(player.fullOf && player.fullOf('molotov'))) player.items.molotov = (player.items.molotov || 0) + 1;
      if (has('balas')) {
        const seen = {};
        for (const s of player.hands) {
          const w = s && G.Weapons.get(s.id);
          if (!w || !G.Weapons.isGun(w) || !w.ammo || seen[w.ammo]) continue;
          seen[w.ammo] = 1;
          const cap = player.ammoCap ? player.ammoCap(w.ammo) : 99;
          player.ammo[w.ammo] = Math.min(cap, (player.ammo[w.ammo] || 0) + Math.ceil((w.mag || 6) * 0.5));
        }
      }
      return rank;
    }
  };
  G.Rank = Rank;

  // ---------- Puesto de comercio ----------
  // Solo hay 4 cosas a la vez (y los dados para volver a sortearlas, que cuestan monedas). Se renueva tras cada
  // enfrentamiento. Las monedas cuestan de ganar (de 13 a 32 por enfrentamiento): los precios son bajos.
  // p: peso al sortear lo que sale
  const SHOP = [
    { id: 'venda', name: 'Venda', icon: 'botiquin', n: 1, price: 3, p: 1.0, desc: 'Una venda para curarte.' },
    { id: 'humo', name: 'Bomba de humo', icon: 'humo', n: 1, price: 4, p: 0.6, desc: 'Una nube que aturde a los infectados que la cruzan.' },
    { id: 'molotov', name: 'Molotov', icon: 'molotov', n: 1, price: 4, p: 0.7, desc: 'Prende fuego a todo lo que alcanza.' },
    { id: 'mina', name: 'Mina', icon: 'mina', n: 1, price: 5, p: 0.5, desc: 'Revienta cuando un infectado la pisa.' },
    { id: 'mun_9mm', name: 'Balas de 9 mm', icon: 'mun_9mm', n: 6, price: 2, p: 1.2, desc: 'Munición para la pistola.' },
    { id: 'mun_cartucho', name: 'Cartuchos', icon: 'mun_cartucho', n: 4, price: 3, p: 0.8, desc: 'Munición para las escopetas.' },
    { id: 'mun_rifle', name: 'Balas de rifle', icon: 'mun_rifle', n: 3, price: 3, p: 0.7, desc: 'Munición para el rifle de cerrojo.' },
    { id: 'mun_flecha', name: 'Flechas', icon: 'mun_flecha', n: 4, price: 2, p: 0.7, desc: 'Flechas para el arco (solo se recuperan las que dan en la cabeza).' },
    { id: 'mun_revolver', name: 'Balas de revólver', icon: 'mun_revolver', n: 4, price: 3, p: 0.7, desc: 'Munición para el revólver.' },
    { id: 'mun_smg', name: 'Balas de subfusil', icon: 'mun_smg', n: 6, price: 6, p: 0.25, desc: 'Munición para el subfusil silenciado.' },
    { id: 'mun_gas', name: 'Combustible', icon: 'mun_gas', n: 20, price: 3, p: 0.5, desc: 'Combustible para el lanzallamas.' },
    { id: 'pistola', name: 'Pistola semiautomática', icon: 'pistola', weapon: true, price: 6, p: 0.3, desc: 'Arma corta de 9 mm. Se mejora en el banco de mejoras.' },
    { id: 'revolver', name: 'Revólver', icon: 'revolver', weapon: true, price: 10, p: 0.4, desc: 'Arma corta: mucho daño y seis balas. Se mejora en el banco de mejoras.' },
    { id: 'arco', name: 'Arco', icon: 'arco', weapon: true, price: 10, p: 0.4, desc: 'Silencioso. Mantén Atacar para tensarlo.' },
    { id: 'escopeta', name: 'Escopeta de corredera', icon: 'escopeta', weapon: true, price: 12, p: 0.4, desc: 'Demoledora de cerca. Se mejora en el banco de mejoras.' },
    { id: 'rifle', name: 'Rifle de cerrojo', icon: 'rifle', weapon: true, price: 14, p: 0.35, desc: 'El arma más potente, con mira. Se mejora en el banco de mejoras.' },
    { id: 'doble', name: 'Escopeta de doble cañón', icon: 'doble', weapon: true, price: 14, p: 0.35, desc: 'Dos disparos brutales de cerca.' },
    { id: 'subfusil', name: 'Subfusil silenciado', icon: 'subfusil', weapon: true, special: true, price: 18, p: 0.2, desc: 'Ráfagas casi sin ruido. Arma especial: no se mejora.' },
    { id: 'lanzallamas', name: 'Lanzallamas', icon: 'lanzallamas', weapon: true, special: true, price: 20, p: 0.15, desc: 'Un chorro de fuego de unos 7 m. Arma especial: no se mejora.' }
  ];
  const SHOP_SLOTS = 4, REROLL = 3;
  // modo libre: fichas de práctica para la tragamonedas (si te quedas sin, te dan otras tantas)
  const FREE_CHIPS = 20;
  // quién te venga cuando caes en esa liberación: Di' Arco y Vera, la una a la otra; a Vera, a veces, la señora
  // Paula (cuando se pueda jugar con ella); al resto, Vera (o Di' Arco)
  // La Trece y Grimes (los dos de los Supervivientes) se vengan el uno al otro
  function avengerFor(id) {
    const ok = (c) => !!G.Player.CHARS[c] && !G.Player.CHARS[c].dev;
    if (id === 'eira' && ok('grimes')) return 'grimes';
    if (id === 'grimes' && ok('eira')) return 'eira';
    if (id === 'diarco') return ok('vera') ? 'vera' : 'tomas';
    if (id === 'vera') return ok('paula') && Math.random() < 0.35 ? 'paula' : 'diarco';
    return ok('vera') ? 'vera' : 'diarco';
  }
  // carreras de Retorno completadas (desbloquean personajes)
  const DONE_KEY = 'ceniza.carreras';
  function runsDone() { try { return Math.max(0, parseInt(localStorage.getItem(DONE_KEY) || '0', 10) || 0); } catch (e) { return 0; } }

  // Sitios del mapa (nombres para los enfrentamientos; inventados)
  const PLACES = ['Granja del arroyo', 'Taller de la ruta', 'Depósito ferroviario', 'Escuela del barrio', 'Estación de servicio', 'Aserradero',
    'Oficina del primer piso', 'Mercado cubierto', 'Galpón portuario', 'Clínica vieja', 'Biblioteca municipal', 'Planta de agua'];

  // ---------- Desafíos ----------
  // Cada uno cuenta una vez por carrera. Al completarlo, las recompensas del enfrentamiento en el que lo hiciste
  // (piezas, suplementos y monedas) se multiplican según lo difícil que es (si haces varios, se suman). Los
  // difíciles, además, tienen una probabilidad baja de dejar un arma (una sola) sobre un mueble del refugio.
  // Se cuenta también cuántas veces los has hecho en total (en el menú de Desafíos)
  const LEVEL = { facil: { name: 'Fácil', mult: 1.15 }, media: { name: 'Media', mult: 1.3 }, dificil: { name: 'Difícil', mult: 1.5 } };
  const GIFT_P = 0.2;          // probabilidad de arma con un desafío difícil
  const CHALLENGES = [
    { id: 'sigilo_chasq', name: 'Silencio mortal', lv: 'dificil', text: 'Mata a un chasqueador por la espalda sin que se entere.' },
    { id: 'molotov_temb', name: 'Fuego al gigante', lv: 'media', text: 'Mata a un temblante con una molotov.' },
    { id: 'cabezas', name: 'Puntería', lv: 'media', text: 'Mata a 5 infectados de un disparo en la cabeza en un mismo enfrentamiento.' },
    { id: 'remates', name: 'Sin piedad', lv: 'facil', text: 'Remata a 3 infectados aturdidos en un mismo enfrentamiento.' },
    { id: 'intacta', name: 'Ni un rasguño', lv: 'dificil', text: 'Supera una oleada de un asalto sin recibir daño.' },
    { id: 'cazador', name: 'Cazadora', lv: 'facil', text: 'Elimina a 15 infectados en una caza.' },
    // contra los Escorpiones (y la resistencia)
    { id: 'esc_sigilo', esc: true, name: 'Fantasma', lv: 'dificil', text: 'Abre la caja fuerte de un saqueo sin que los Escorpiones te descubran.' },
    { id: 'saqueo_rapido', esc: true, name: 'Golpe limpio', lv: 'media', text: 'Abre la caja fuerte de un saqueo con más de 2 minutos de margen.' },
    { id: 'esc_lider', esc: true, name: 'Cortar la cabeza', lv: 'media', text: 'Mata al líder de los Escorpiones antes que a ningún otro de su grupo.' },
    { id: 'esc_rehen', esc: true, name: 'Escudo humano', lv: 'media', text: 'Mata a un escorpión mientras tienes a otro de rehén.' },
    { id: 'esc_perdon', esc: true, name: 'Misericordia', lv: 'facil', text: 'Deja ir a 2 escorpiones que se rindan en un mismo enfrentamiento.' },
    { id: 'esc_golpes', esc: true, name: 'Cuerpo a cuerpo', lv: 'media', text: 'Mata a 3 escorpiones cuerpo a cuerpo en un mismo enfrentamiento.' },
    { id: 'esc_fuga', esc: true, name: 'Que no escape', lv: 'media', text: 'En un asalto de los Escorpiones, mata al que huye a buscar a su grupo antes de que escape.' },
    { id: 'lib_sigilo', esc: true, name: 'Sin alarma', lv: 'dificil', text: 'Completa una liberación sin que salte la alarma de la sede.' },
    { id: 'resist_entero', esc: true, name: 'Guardaespaldas', lv: 'dificil', text: 'Termina una resistencia con tu compañero por encima del 75 % de vida.' },
    // jefe final (multiplican el puntaje de la batalla)
    { id: 'jefe_rapido', boss: true, name: 'Contra reloj', lv: 'dificil', text: 'Vence al jefe final en menos de 4 minutos desde que sale el hongomorfo.' },
    { id: 'jefe_vida', boss: true, name: 'Sin un rasguño', lv: 'dificil', text: 'Vence al jefe final sin recibir daño.' },
    { id: 'jefe_blindado', boss: true, name: 'Primero la lata', lv: 'dificil', text: 'Mata al blindado antes que al hongomorfo.' },
    { id: 'jefe_esquiva', boss: true, name: 'Bailarina', lv: 'media', text: 'Esquiva 3 agarres del hongomorfo en la misma batalla.' },
    { id: 'jefe_fuego', boss: true, name: 'A la brasa', lv: 'media', text: 'Acaba con el hongomorfo con fuego.' },
    { id: 'jefe_salon', boss: true, name: 'Salón en pie', lv: 'media', text: 'Vence al jefe final con 5 máquinas o menos destruidas.' },
    // la estación de policía (el final variante)
    // (el jefe del faro: el Aguijón, líder de los Escorpiones)
    { id: 'faro_apagon', boss: true, faro: true, name: 'A oscuras', lv: 'media', text: 'En el faro, corta la corriente de la linterna antes de que salga el Aguijón.' },
    { id: 'faro_limpio', boss: true, faro: true, name: 'Entre barrido y barrido', lv: 'dificil', text: 'Vence al Aguijón sin que el tirador del balcón te alcance ni una vez.' },
    { id: 'faro_rapido', boss: true, faro: true, name: 'Marea viva', lv: 'dificil', text: 'Vence al jefe del faro en menos de 7 minutos.' },
    { id: 'st_silencio', boss: true, station: true, name: 'Ni un chasquido', lv: 'media', text: 'En la estación de policía, coge las armas del casillero sin que ningún chasqueador te oiga.' },
    { id: 'st_antes', boss: true, station: true, name: 'Ellos primero', lv: 'dificil', text: 'En la estación de policía, mata a los tres Escorpiones antes de que empiecen los golpes en la pared.' },
    { id: 'st_rapido', boss: true, station: true, name: 'Con tiempo de sobra', lv: 'dificil', text: 'Escapa de la estación de policía con más de 1 minuto en el reloj.' },
    // armas largas
    { id: 'mazazo', name: 'Mazazo', lv: 'media', text: 'Mata a 3 infectados con el golpe de arriba abajo de un arma larga en un mismo enfrentamiento.' }
  ];
  // puntos de desafiante (se gastan en Extras): según la dificultad, la primera vez que consigues cada logro o desafío
  const PTS = { facil: 10, media: 20, dificil: 35, epico: 60 };
  const PTS_NAME = { facil: 'Fácil', media: 'Media', dificil: 'Difícil', epico: 'Épico' };
  // Logros: para siempre (en Retorno y en la batalla de prueba del modo libre)
  const ACHIEVEMENTS = [
    { id: 'hongo', lv: 'dificil', name: 'Cazahongos', text: 'Vence al hongomorfo.' },
    { id: 'aguijon', lv: 'dificil', name: 'Sin aguijón', text: 'Vence al Aguijón, el líder de los Escorpiones, en el Faro de Oceanside.' },
    { id: 'estacion', lv: 'dificil', name: 'Sin mirar atrás', text: 'Escapa de la estación de policía con los tres Escorpiones muertos.' },
    { id: 'huida', lv: 'media', name: 'No era un asalto', text: 'Sal con vida de una huida: un asalto en el que aparece la otra facción.' },
    { id: 'carrera', lv: 'dificil', name: 'De vuelta a casa', text: 'Completa una carrera de Retorno.' },
    { id: 'blindado', lv: 'media', name: 'Abrelatas', text: 'Mata al blindado.' },
    { id: 'esquiva', lv: 'facil', name: 'Por los pelos', text: 'Esquiva un agarre del hongomorfo.' },
    { id: 'demolicion', lv: 'facil', name: 'Fin de la partida', text: 'Deja que el hongomorfo destroce 10 máquinas en una misma batalla.' },
    { id: 'intocable', lv: 'epico', name: 'Intocable', text: 'Vence al jefe final sin recibir daño.' },
    { id: 'maestro', lv: 'epico', name: 'Dueña del salón', text: 'Completa alguna vez todos los desafíos del jefe final.' },
    { id: 'picadura', lv: 'facil', name: 'Primera picadura', text: 'Mata a tu primer escorpión.' },
    { id: 'exterminio', lv: 'media', name: 'Plaga', text: 'Mata a 50 escorpiones (en total).' },
    { id: 'saqueo', lv: 'facil', name: 'Ladrona de cajas', text: 'Abre una caja fuerte de los Escorpiones.' },
    { id: 'fantasma', lv: 'media', name: 'Nadie te vio', text: 'Abre una caja fuerte sin que los Escorpiones te descubran.' },
    { id: 'rehen', lv: 'facil', name: 'Moneda de cambio', text: 'Toma a un escorpión de rehén.' },
    { id: 'clemencia', lv: 'facil', name: 'Clemencia', text: 'Deja ir a un escorpión que se rinde.' },
    { id: 'sin_trato', lv: 'facil', name: 'Sin trato', text: 'Ejecuta a un rehén.' },
    { id: 'venganza', lv: 'media', name: 'Que vengan todos', text: 'Supera un asalto de los Escorpiones (las tres oleadas).' },
    { id: 'guardaespaldas', lv: 'media', name: 'Fiel compañía', text: 'Completa una resistencia.' },
    { id: 'liberacion', lv: 'media', name: 'Nadie se queda atrás', text: 'Completa una liberación en la Red del Capitolio.' },
    { id: 'rejas', lv: 'facil', name: 'Fuera rejas', text: 'Libera a un Superviviente de su celda.' },
    { id: 'cuatro', lv: 'media', name: 'De todo un poco', text: 'Completa alguna vez las cuatro modalidades: asalto, caza, saqueo y resistencia.' },
    // la estación de policía
    { id: 'casillero', lv: 'facil', name: 'Armería de la poli', text: 'Encuentra el casillero de armas de la estación de policía.' },
    { id: 'ajuste', lv: 'dificil', name: 'Ajuste de cuentas', text: 'Con Vera, mata tú misma a los tres Escorpiones de la estación de policía.' },
    // la muerte súbita (en el refugio)
    { id: 'subita', lv: 'media', name: 'Muerte súbita', text: 'Sobrevive al temblante que revienta la pared del refugio.' },
    { id: 'subita_dura', lv: 'dificil', name: 'Con lo puesto', text: 'Mata al temblante del refugio habiendo vuelto con menos de 6 balas entre todas tus armas.' },
    { id: 'subita_palos', lv: 'dificil', name: 'A palos', text: 'Remata al temblante del refugio cuerpo a cuerpo.' },
    { id: 'precario', lv: 'facil', name: 'Lo que queda', text: 'Compra algo en el armario del comercio de después.' },
    // los descansos: la bitácora del faro
    { id: 'faro_alba', lv: 'media', name: 'Siguiendo la luz', text: 'Junta tres hojas de la bitácora del faro en una misma carrera y llega al faro al alba.' },
    { id: 'bitacora', lv: 'dificil', name: 'La bitácora del farero', text: 'Lee las siete hojas de la bitácora del faro (la última está en el faro).' },
    // armas largas
    { id: 'bateadora', lv: 'media', name: 'Bateadora', text: 'Mata a 50 infectados con armas largas (en total).' },
    // el entrenamiento (Tutoriales)
    { id: 'entrenada', lv: 'facil', name: 'Lista para salir', text: 'Completa todas las lecciones del entrenamiento (Tutoriales).' },
    // partida diaria: uno por personaje (el que te tocó ese día)
    { id: 'diaria_vera', big: true, lv: 'epico', name: 'La sombra del puerto', text: 'Completa una partida diaria con Vera.' },
    { id: 'diaria_tomas', big: true, lv: 'epico', name: 'Nada que no se arregle', text: 'Completa una partida diaria con Tomás.' },
    { id: 'diaria_diarco', big: true, lv: 'epico', name: 'Puños vendados', text: "Completa una partida diaria con Di' Arco." },
    { id: 'diaria_booster', big: true, lv: 'epico', name: 'Treinta años y un día', text: 'Completa una partida diaria con Booster.' },
    { id: 'diaria_paula', big: true, lv: 'epico', name: 'Veterana de todas las guerras', text: 'Completa una partida diaria con la señora Paula.' }
  ];
  const AKEY = 'ceniza.logros';
  function achRecord() { try { return JSON.parse(localStorage.getItem(AKEY) || '{}') || {}; } catch (e) { return {}; } }
  const CKEY = 'ceniza.desafios';
  const GIFTS = ['revolver', 'doble', 'escopeta', 'rifle', 'arco', 'subfusil', 'lanzallamas'];
  function chalRecord() { try { return JSON.parse(localStorage.getItem(CKEY) || '{}') || {}; } catch (e) { return {}; } }

  let st = null;          // estado de la carrera (null: no hay)
  let inRefuge = false;
  let encMul = 1;             // lo que se lleva de la recompensa el enfrentamiento en curso (saqueo fallido: 0,25)

  function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function rngOf(seed) { let x = seed >>> 0; return () => { x = (x + 0x6D2B79F5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daySeed(day, salt) { let h = 2166136261; for (const c of 'retorno|' + day + '|' + (salt || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  // lo difícil que es la columna k de un mapa de n (0 a 4 en la carrera normal; en la diaria, de 1 a 5). Con más
  // enfrentamientos la dificultad sube igual, solo que más repartida
  function tierOf(k, n, daily) { return daily ? 1 + k * 4 / Math.max(1, n - 1) : k * 4 / Math.max(1, n - 1); }

  function pickMap(rnd) { const L = G.Maps ? G.Maps.list() : []; return L.length ? L[Math.floor((rnd || Math.random)() * L.length)] : null; }
  function mapName(node) { const m = node && node.map && G.Maps && G.Maps.get(node.map); return m ? m.name : (node && node.place) || 'Campo de pruebas'; }
  // El mapa: dos líneas (una arriba y otra abajo) que llegan al jefe final. Al elegir el primer enfrentamiento
  // quedas en esa línea hasta el final. Cada línea tiene dos desvíos (sublíneas) de dos enfrentamientos seguidos,
  // por si lo que viene en la tuya no te convence: sale de la línea, se juegan los dos y vuelve a ella.
  // Cada columna: [línea 0, línea 1, y los desvíos que pasan por ella]; subAt[L]: las columnas donde empiezan los
  // desvíos de la línea L (de 1 a n - 2: nunca en la primera, y terminan como mucho en la última). Los dos de una
  // línea no se pisan (el segundo empieza, como pronto, donde vuelve el primero: se pueden hacer seguidos).
  // (Las carreras guardadas de antes traen un solo número por línea: subsOf lo entiende igual)
  function subsOf(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
  function makeMap(steps, rnd, daily, forceFatal) {
    steps = steps || STEPS; rnd = rnd || Math.random;
    const rI = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    // de las cuatro modalidades: asalto y caza (de infectados o de escorpiones), saqueo (solo escorpiones) y
    // resistencia (solo infectados)
    const pickT = () => { const r = rnd(); return r < 0.28 ? 'asalto' : (r < 0.56 ? 'caza' : (r < 0.78 ? 'saqueo' : 'resistencia')); };
    const other = (not) => { let t = pickT(); for (let i = 0; i < 5 && not.indexOf(t) >= 0; i++) t = pickT(); return t; };
    const rw = daily ? DAILY.reward : 1;
    // el camino falso: una de las dos líneas (al azar cuál, y sin que nada lo indique) termina SIEMPRE con la
    // liberación en la Red del Capitolio de noche y con tormenta: la caída (ver Mode.fatalAmbush y Run.fatalFall).
    // Te matan a la salida y quien te venga va a la vieja estación de policía: el jefe final variante. La otra
    // línea lleva al hongomorfo del salón recreativo, como se espera. En el mapa, las dos parecen iguales
    const falseLine = rnd() < 0.5 ? 0 : 1;
    // ningún mapa más de 2 veces en una misma carrera: se cuenta por línea (con su desvío), que es lo que se juega.
    // (la línea falsa ya tiene reservada la Red del Capitolio del final)
    const used = [{}, {}];
    used[forceFatal ? 0 : falseLine].capitolio = 1;
    if (forceFatal) used[1].capitolio = 1;
    const mapFor = (line) => {
      const L = G.Maps ? G.Maps.list() : [], ok = L.filter((m) => (used[line][m] || 0) < 2);
      const pool = ok.length ? ok : L;
      const m = pool.length ? pool[Math.floor(rnd() * pool.length)] : null;
      if (m) used[line][m] = (used[line][m] || 0) + 1;
      return m;
    };
    // qué modificador le puede tocar a un enfrentamiento (o null)
    const pickMod = (n, k) => {
      const mm = G.Maps && G.Maps.get(n.map), skyOk = !!(mm && !mm.boss && !mm.interior) && n.map !== 'capitolio';
      const horde = n.type === 'asalto' || n.type === 'caza' || n.type === 'resistencia';
      const pool = {};
      for (const id in MODS) {
        const M = MODS[id];
        if (M.sky && !skyOk) continue;
        if (M.inf && (n.humans || !horde)) continue;
        if (M.good && n.sub) continue;                         // (los desvíos: más riesgo, nunca menos)
        if (id === 'cerrado' && k >= steps - 1) continue;      // (antes del jefe siempre hay comercio)
        pool[id] = M.good ? 0.6 : 1;
      }
      return Object.keys(pool).length ? U.weighted(rnd, pool) : null;
    };
    // las paradas (sin pelea): un suceso distinto cada vez, mientras queden
    const usedEv = {};
    // (los sitios de los descansos, barajados: los de las líneas salen de aquí, sin repetir mientras queden; los de
    // los desvíos, al azar, mejor uno que no esté ya en su línea)
    // (la parada secreta no sale en el mapa; el escondite de la Trece, solo si no vas con ella ni con Grimes, y el
    // refugio del grupo de Di' Arco, solo si vas con uno de los dos)
    const SCN = G.Calm && G.Calm.SCENES ? G.Calm.SCENES : {};
    const scenes = Object.keys(SCN).filter((id) => { const d = SCN[id]; if (d.secret) return false; if (d.only) return d.only.indexOf(mapChar) >= 0; if (d.not) return d.not.indexOf(mapChar) < 0; return true; });
    for (let i = scenes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = scenes[i]; scenes[i] = scenes[j]; scenes[j] = t; }
    let nextSc = 0;
    const lineSc = [{}, {}];
    const calmNode = (type, line, sub) => {
      // los descansos: un sitio que se juega (calm.js)
      if (type === 'descanso' && scenes.length) {
        let sc;
        if (!sub) sc = scenes[nextSc++ % scenes.length];
        else { const free = scenes.filter((id) => !lineSc[line][id]); const pool = free.length ? free : scenes; sc = pool[Math.floor(rnd() * pool.length)]; }
        lineSc[line][sc] = 1;
        return { type, calm: true, play: true, scene: sc, seed: 1 + Math.floor(rnd() * 999983), ev: null, line, sub: !!sub, place: G.Calm.SCENES[sc].name, humans: false, time: 0, piezas: 0, suplementos: 0, monedas: 0 };
      }
      const all = EV_BY(type), free = all.filter((id) => !usedEv[id]), pool = free.length ? free : all;
      const ev = pool[Math.floor(rnd() * pool.length)];
      usedEv[ev] = 1;
      const n = { type, calm: true, ev, line, sub: !!sub, place: 'En el camino', humans: false, time: 0, piezas: 0, suplementos: 0, monedas: 0 };
      if (type === 'mercader') {
        // tres tratos distintos (como mucho, un arma)
        const idx = DEALS.map((d, i) => i), out = [];
        while (out.length < 3 && idx.length) {
          const d = idx.splice(Math.floor(rnd() * idx.length), 1)[0];
          if (DEALS[d].weapon && out.some((o) => DEALS[o].weapon)) continue;
          out.push(d);
        }
        n.deals = out;
      }
      return n;
    };
    const calmType = () => { const r = rnd(); return r < 0.45 ? 'descanso' : (r < 0.68 ? 'mercader' : 'suceso'); };
    const node = (k, type0, line, sub) => {
      const tier = tierOf(k, steps, daily), kk = Math.min(4, Math.round(tier));
      const last = k === steps - 1 && (forceFatal || line === falseLine);
      const map = last ? 'capitolio' : mapFor(line);
      // en la Red del Capitolio, a menudo toca la liberación (el modo de ese mapa) y, si no, casi siempre el asalto
      // (el de la Trece: por la tarde, con suerte, está en una celda del fondo)
      const rc = map === 'capitolio' ? rnd() : 1;
      const type = last ? 'liberacion' : (rc < 0.55 ? 'liberacion' : (rc < 0.9 ? 'asalto' : type0));
      const n = {
        type, map, line, sub: !!sub, fatal: last || undefined,
        humans: type === 'saqueo' || type === 'liberacion' || ((type === 'asalto' || type === 'caza') && rnd() < 0.4),
        time: type === 'caza' ? CAZA_T[kk] + (tier > 4 ? 15 : 0) : (type === 'resistencia' ? 180 + Math.round(tier * 15) : (type === 'saqueo' ? 210 : 0)),
        // recompensa (en el cofre del refugio): las monedas cuestan de ganar; más cuanto más cerca del jefe
        // final y en la caza (más difícil). El asalto da más piezas
        piezas: Math.round(((type === 'asalto' ? 50 : (type === 'saqueo' || type === 'liberacion' ? 60 : (type === 'resistencia' ? 45 : 35))) + tier * 10 + rI(0, 2) * 5) * rw),
        suplementos: Math.round((50 + tier * 8 + rI(0, 4) * 5) * rw),
        monedas: Math.round((13 + tier * 4 + (type === 'caza' || type === 'resistencia' ? 2 : (type === 'saqueo' || type === 'liberacion' ? 4 : 0)) + rI(0, 1)) * rw)
      };
      // el modificador (nunca en el primero ni en la caída): lo que paga de más ya va en la recompensa del mapa
      if (!last && k > 0 && rnd() < (sub ? MOD_P_SUB : MOD_P)) {
        const id = pickMod(n, k);
        if (id) {
          const f = 1 + MODS[id].rew;
          n.mod = id;
          n.piezas = Math.round(n.piezas * f); n.suplementos = Math.round(n.suplementos * f); n.monedas = Math.max(1, Math.round(n.monedas * f));
        }
      }
      return n;
    };
    // dos desvíos por línea: todas las parejas de columnas que caben (separadas por dos o más), una al azar
    const pairs = [];
    for (let a = 1; a <= steps - 2; a++) for (let b = a + 2; b <= steps - 2; b++) pairs.push([a, b]);
    const pickSubs = () => (pairs.length ? pairs[rI(0, pairs.length - 1)].slice() : [rI(1, Math.max(1, steps - 2))]);
    const subAt = [pickSubs(), pickSubs()];
    for (let t = 0; t < 6 && subAt[1].join() === subAt[0].join() && pairs.length > 1; t++) subAt[1] = pickSubs();
    // los descansos (sitios que se juegan, sin pelea): tres en cada línea, ni al principio ni justo antes del jefe y,
    // si caben, nunca dos seguidos (en la carrera normal quedan alternos: pelea, descanso, pelea...)
    const calmAt = [0, 1].map(() => {
      const cand = [];
      for (let k = 1; k <= steps - 2; k++) cand.push(k);
      const want = Math.min(CALM_N, cand.length);
      // todas las maneras de elegirlas (separadas por una pelea como poco; si no caben, como sea) y una al azar
      const ways = [], walk = (from, acc, gap) => {
        if (acc.length === want) { ways.push(acc.slice()); return; }
        for (let i = from; i < cand.length; i++) if (!acc.length || cand[i] - acc[acc.length - 1] >= gap) { acc.push(cand[i]); walk(i + 1, acc, gap); acc.pop(); }
      };
      walk(0, [], 2);
      if (!ways.length) walk(0, [], 1);
      return ways.length ? ways[Math.floor(rnd() * ways.length)] : [];
    });
    const cols = [];
    for (let k = 0; k < steps; k++) {
      const a = pickT(), b = other([a]);
      const col = [0, 1].map((L) => (calmAt[L].indexOf(k) >= 0 ? calmNode('descanso', L, false) : node(k, L ? b : a, L, false)));
      // el desvío: distinto de lo que hay en su línea en esa columna (y, a veces, su segundo tramo es una parada)
      for (const L of [0, 1]) {
        if (!subAt[L].some((s0) => k === s0 || k === s0 + 1)) continue;
        const second = subAt[L].indexOf(k - 1) >= 0 && subAt[L].indexOf(k) < 0;
        if (second && k < steps - 1 && rnd() < CALM_P_SUB) col.push(calmNode(calmType(), L, true));
        else col.push(node(k, other([col[L].type]), L, true));
      }
      cols.push(col);
    }
    return { cols, subAt, falseLine };
  }

  // 4 cosas al azar (sin repetir, sin armas que ya tengas)
  function makeShop(player) {
    const out = [], pool = {};
    const fuel = player && player.perks ? player.perks.fuel : 1;
    for (const s of SHOP) {
      if (s.weapon && player && player.weapons.some((w) => w.id === s.id)) continue;
      // (la señora Paula: ni escopetas ni rifles a la venta, y el combustible sale mucho más)
      if (player && player.canUse && !player.canUse(s.id)) continue;
      if (fuel > 1 && (s.id === 'mun_cartucho' || s.id === 'mun_rifle')) continue;
      pool[s.id] = s.p * (s.id === 'mun_gas' ? fuel * 1.6 : 1) * (s.id === 'mun_revolver' && player && player.perks && player.perks.revAmmo > 1 ? 2.2 : 1);
    }
    // siempre algo ya fabricado (venda, molotov, mina o humo) y algo de munición; como mucho 2 armas
    const isW = (id) => SHOP.find((s) => s.id === id).weapon;
    const take = (filter) => {
      const sub = {}; for (const k in pool) if (filter(k)) sub[k] = pool[k];
      if (!Object.keys(sub).length) return;
      const id = U.weighted(Math.random, sub); delete pool[id]; out.push({ id, left: 1 });
    };
    take((k) => k === 'venda' || k === 'molotov' || k === 'mina' || k === 'humo');
    take((k) => k.indexOf('mun_') === 0);
    while (out.length < SHOP_SLOTS && Object.keys(pool).length) {
      const nw = out.filter((o) => isW(o.id)).length;
      if (nw >= 2) for (const k in pool) if (isW(k)) delete pool[k];
      if (!Object.keys(pool).length) break;
      const id = U.weighted(Math.random, pool);
      delete pool[id];
      out.push({ id, left: 1 });
    }
    return out;
  }

  // ---------- Inventario (entre el refugio y los enfrentamientos) ----------
  const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : o);
  // ---------- Muerte súbita ----------
  // las balas de tus armas de fuego (en la mano, en la mochila y, Di' Arco, en el armero): las cargadas más las de
  // reserva de su tipo. per: lo que tiene la que más tiene; total: todas juntas (cada reserva cuenta una vez)
  // quién lleva el comercio de después: Vera (si eres Vera, Di' Arco); nunca quien cayó en la liberación
  function keeperFor() {
    const me = st ? st.char : null, fallen = st && st.revenge ? st.revenge.from : null;
    for (const id of me === 'vera' ? ['diarco', 'tomas'] : ['vera', 'diarco', 'tomas']) if (id !== me && id !== fallen) return id;
    return 'tomas';
  }
  function gunAmmo(p) {
    const slots = (p.hands || []).concat(p.stored || [], (p.packless && st && st.rack) || []);
    const types = {};
    let per = -1, total = 0, n = 0;
    for (const s of slots) {
      if (!s) continue;
      const w = G.Weapons.get(s.id);
      if (!G.Weapons.isGun(w)) continue;
      n++;
      const res = w.ammo ? (p.ammo[w.ammo] || 0) : 0;
      per = Math.max(per, (s.mag || 0) + res);
      total += s.mag || 0;
      if (w.ammo && !types[w.ammo]) { types[w.ammo] = 1; total += res; }
    }
    return n ? { per, total, n } : null;
  }
  const SUDDEN_PER = 3;      // se activa si ninguna arma de fuego tiene más de 3 balas (cargadas y de reserva)
  const SUDDEN_HARD = 6;     // y si entre todas no llegan a 6, el temblante aguanta más

  function snapshot(p) {
    // Di' Arco: lo que no lleva encima se queda en el armero del refugio (fuera de él no lo tiene a mano)
    const stored = p.packless && !inRefuge && st ? clone(st.rack || []) : clone(p.stored);
    return {
      hands: clone(p.hands), stored, items: clone(p.items), ammo: clone(p.ammo),
      backpack: !!p.backpack, silencers: p.silencers || 0, arrowExp: !!p.arrowExp, throwable: p.throwable || null,
      health: p.health
    };
  }
  function restore(p, s) {
    if (!s) return;
    p.hands = clone(s.hands) || [];
    while (p.hands.length < 5) p.hands.push(null);
    p.stored = (clone(s.stored) || []).filter(Boolean);
    if (p.packless) {
      if (st) st.rack = clone(p.stored);
      if (!inRefuge) p.stored = [];             // (en un enfrentamiento: solo lo que lleva encima)
    }
    for (const k in s.items) p.items[k] = s.items[k];
    for (const k in s.ammo) p.ammo[k] = s.ammo[k];
    p.backpack = s.backpack !== false && !p.packless; p.silencers = s.silencers || 0; p.arrowExp = !!s.arrowExp; p.throwable = s.throwable || null;
    // se llega como se estaba (la vida no se llena sola al volver al refugio)
    if (s.health != null) { p.health = Math.max(1, Math.min(100, s.health)); p.heal = 0; }
    // las armas de fuego no traen más balas de las que caben ahora en el cargador
    for (const h of p.hands.concat(p.stored)) if (h && h.mag != null) h.mag = Math.min(h.mag, G.Weapons.get(h.id).mag);
    // (partidas viejas: las armas de fuego ya no se rompen)
    for (const h of p.hands.concat(p.stored)) if (h && G.Weapons.isGun(G.Weapons.get(h.id))) { h.broken = false; h.cond = 1; }
    p.cur = -1; p.prev = -1;
    G.Models.setBackpack(p.model, p.backpack);
    p.refreshModel();
  }

  function save() {
    if (!st || st.free || st.sim) return;           // el modo libre (y la simulación) no se guarda
    try { localStorage.setItem(st.daily ? DKEY : KEY, JSON.stringify(st)); } catch (e) { /* sin guardado */ }
  }
  // daily: la carrera diaria guardada (si no, la normal)
  function readSave(daily) {
    try { const t = localStorage.getItem(daily ? DKEY : KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }
  // la partida diaria de hoy: ¿ya se jugó?
  function dayRec() { try { const r = JSON.parse(localStorage.getItem(DSTATE) || 'null'); return r && typeof r === 'object' ? r : null; } catch (e) { return null; } }
  function setDay(o) { try { localStorage.setItem(DSTATE, JSON.stringify(o)); } catch (e) { /* nada */ } }
  // cómo terminó la diaria (si es la de hoy)
  function dayResult(run, res) { const r = dayRec(); if (run && run.daily && r && r.day === run.daily && r.res !== 'completada') { r.res = res; setDay(r); } }

  // Lo que trae un arma al comprarla: como mucho 12 balas entre el cargador y la reserva, según el arma (las
  // de cargador grande vienen a medias; las de pocas balas traen alguna de repuesto)
  const BUY_ROUNDS = { pistola: [9, 12], revolver: [8, 12], escopeta: [6, 9], doble: [6, 9], rifle: [5, 8], arco: [6, 9], subfusil: [6, 9] };
  function buyRounds(w) {
    if (w.gun === 'flame') return { load: w.mag, spare: 0 };
    const r = BUY_ROUNDS[w.id] || [6, 12];
    const total = Math.min(12, r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1)));
    const load = Math.min(w.mag, total);
    return { load, spare: total - load };
  }

  // suma lo de un enfrentamiento a la carrera (para el puntaje final y la clasificación)
  const SUM = ['kills', 'time', 'head', 'shots', 'hits', 'melee', 'exec', 'hurt', 'stealth'];
  function addStats(stats) {
    if (!st || !stats) return;
    for (const k of SUM) st.totals[k] = (st.totals[k] || 0) + (stats[k] || 0);
    if (stats.bossTime) st.totals.bossTime = stats.bossTime;
  }

  // ---------- Clasificación: los récords propios de este navegador ----------
  // Cada récord guarda el valor, con qué personaje y cuándo. Se anota al terminar cada carrera de Retorno
  // (completada, muerta o abandonada); el tiempo es el de los enfrentamientos (el refugio no cuenta).
  const RKEY = 'ceniza.clasificacion';
  const RECS = [
    { id: 'rapida', name: 'Carrera más rápida', low: true, done: true, fmt: 'time' },
    { id: 'jefe', name: 'Jefe final más rápido', low: true, done: true, fmt: 'time' },
    { id: 'puntaje', name: 'Mejor puntaje de carrera', fmt: 'n' },
    { id: 'enc', name: 'Mejor puntaje en un enfrentamiento', fmt: 'n' },
    { id: 'bajas', name: 'Más infectados en una carrera', fmt: 'n' },
    { id: 'cabeza', name: 'Más disparos a la cabeza', fmt: 'n' },
    { id: 'cuerpo', name: 'Más bajas cuerpo a cuerpo', fmt: 'n' },
    { id: 'remates', name: 'Más remates', fmt: 'n' },
    { id: 'precision', name: 'Mejor precisión (40 disparos o más)', fmt: 'pct' },
    { id: 'ileso', name: 'Menos daño recibido (carrera completa)', low: true, done: true, fmt: 'hp' },
    { id: 'lejos', name: 'Más lejos', fmt: 'step' }
  ];
  const Records = {
    LIST: RECS,
    // Las marcas van por dificultad (r.diff[facil|normal|dificil] = { rec, runs, done }): una carrera en Fácil no
    // compite con una en Difícil. Las de antes de elegir dificultad se quedan aparte (r.old), para verlas
    read() {
      let r = null; try { r = JSON.parse(localStorage.getItem(RKEY) || 'null'); } catch (e) { /* nada */ }
      r = r && typeof r === 'object' ? r : {};
      r.rec = r.rec || {}; r.runs = r.runs || 0; r.done = r.done || 0; r.kills = r.kills || 0; r.time = r.time || 0; r.chars = r.chars || {};
      if (!r.v2) { if (Object.keys(r.rec).length) r.old = r.rec; r.rec = {}; r.v2 = 1; }
      r.diff = r.diff || {};
      return r;
    },
    bucket(r, diff) { const k = diff === 'facil' || diff === 'normal' ? diff : 'dificil'; return (r.diff[k] = r.diff[k] || { rec: {}, runs: 0, done: 0 }); },
    write(r) { try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch (e) { /* sin almacenamiento */ } },
    // intenta mejorar un récord (devuelve true si es nuevo)
    put(r, id, v, char, diff) {
      const d = RECS.find((x) => x.id === id);
      if (!d || v == null || !isFinite(v)) return false;
      if (!d.low && d.fmt === 'n' && v <= 0) return false;          // (cero infectados o cero remates no es una marca)
      const R = this.bucket(r, diff).rec, o = R[id];
      if (o && (d.low ? v >= o.v : v <= o.v)) return false;
      R[id] = { v, char, date: Date.now() };
      return true;
    },
    // enfrentamiento ganado: mejor puntaje en uno solo
    encounter(run, score) {
      if (!run || run.free || run.sim) return;
      const r = this.read();
      if (this.put(r, 'enc', Math.round(score), run.char, run.diff)) (run.newRec = run.newRec || []).push('enc');
      this.write(r);
    },
    // fin de la carrera. extra: lo del enfrentamiento en curso (si moriste o saliste a mitad)
    runEnded(run, extra, completed) {
      if (!run || run.free || run.sim || run.recorded) return;
      run.recorded = true;
      // experiencia para el personaje (su rango: ver Rank)
      run.rankGain = Rank.gain(run, completed);
      const t = Object.assign({}, run.totals);
      if (extra) for (const k of SUM) t[k] = (t[k] || 0) + (extra[k] || 0);
      const r = this.read(), ch = run.char, nw = run.newRec = run.newRec || [];
      // la partida diaria (más larga y más difícil) se cuenta aparte: no compite con las marcas de la normal
      if (run.daily) {
        dayResult(run, completed ? 'completada' : 'perdida');
        const d = r.daily = r.daily || { runs: 0, done: 0, chars: {} };
        d.runs++; r.kills += t.kills || 0; r.time += t.time || 0;
        const c = d.chars[ch] = d.chars[ch] || { runs: 0, done: 0 };
        c.runs++;
        if (completed) {
          d.done++; c.done++;
          if (!d.best || t.time < d.best.v) { d.best = { v: Math.round(t.time || 0), char: ch, date: Date.now() }; nw.push('diaria'); }
        }
        if (!d.far || (completed ? DAILY_STEPS + 2 : (run.step || 0) + 1) > d.far) d.far = completed ? DAILY_STEPS + 2 : (run.step || 0) + 1;
        this.write(r);
        return;
      }
      const put = (id, v) => { if (this.put(r, id, v, ch, run.diff)) nw.push(id); };
      const B = this.bucket(r, run.diff);
      r.runs++; r.kills += t.kills || 0; r.time += t.time || 0; B.runs++;
      const c = r.chars[ch] = r.chars[ch] || { runs: 0, done: 0 };
      c.runs++;
      if (completed) {
        r.done++; c.done++; B.done++;
        put('rapida', Math.round(t.time || 0));
        if (t.bossTime) put('jefe', Math.round(t.bossTime));
        put('ileso', Math.round(t.hurt || 0));
      }
      put('puntaje', Math.round(t.score || 0));
      put('bajas', t.kills || 0);
      put('cabeza', t.head || 0);
      put('cuerpo', t.melee || 0);
      put('remates', t.exec || 0);
      if ((t.shots || 0) >= 40) put('precision', Math.round((t.hits || 0) / t.shots * 1000) / 10);
      put('lejos', completed ? STEPS + 2 : (run.step || 0) + 1);        // (STEPS + 1: llegó al jefe; + 2: completa)
      this.write(r);
    },
    reset() { try { localStorage.removeItem(RKEY); } catch (e) { /* nada */ } }
  };
  G.Records = Records;

  // ---------- Paradas: lo que da o quita un desenlace ----------
  const COIN_N = { monedas: ['moneda', 'monedas'], piezas: ['pieza', 'piezas'], suplementos: ['suplemento', 'suplementos'] };
  const cnt = (n, k) => n + ' ' + COIN_N[k][n === 1 ? 0 : 1];
  function costText(c) { const out = []; for (const k of ['monedas', 'piezas', 'suplementos']) if (c && c[k]) out.push(cnt(c[k], k)); return out.join(' y ') || 'Gratis'; }
  function itemName(id, n) { const sh = SHOP.find((x) => x.id === id), nm = sh ? sh.name.toLowerCase() : id; return n > 1 ? n + ' ' + (id === 'venda' ? 'vendas' : (id === 'mina' ? 'minas' : nm)) : (id === 'venda' ? 'una venda' : (id === 'molotov' ? 'una molotov' : (id === 'mina' ? 'una mina' : nm))); }
  function itemWord(id, n) { const sh = SHOP.find((x) => x.id === id), nm = sh ? sh.name.toLowerCase() : id; return id === 'venda' ? (n > 1 ? 'vendas' : 'venda') : (id === 'mina' ? (n > 1 ? 'minas' : 'mina') : (id === 'molotov' ? (n > 1 ? 'molotovs' : 'molotov') : nm)); }
  function gainText(d) {
    const out = [];
    for (const k of ['monedas', 'piezas', 'suplementos']) if (d[k]) out.push(cnt(d[k], k));
    if (d.vida) out.push(d.vida + ' de vida');
    if (d.items) for (const id in d.items) out.push(itemName(id, d.items[id]));
    if (d.balas) out.push('balas para lo que llevas');
    if (d.weapon) out.push(G.Weapons.get(d.weapon).name.toLowerCase());
    return out.join(' y ');
  }
  // aplica un desenlace al jugador y a la carrera; devuelve las líneas del resumen
  function applyOut(out, p) {
    const lines = [];
    for (const k of ['monedas', 'piezas', 'suplementos']) if (out[k]) { st[k] = Math.max(0, (st[k] || 0) + out[k]); lines.push((out[k] > 0 ? '+' : '−') + cnt(Math.abs(out[k]), k)); }
    if (!p) return lines;
    if (out.vida) {
      const h0 = p.health;
      p.health = out.vida > 0 ? Math.min(100, p.health + out.vida) : Math.max(5, p.health + out.vida);       // (nunca mata)
      const d = Math.round(p.health - h0);
      lines.push(d >= 0 ? (d > 0 ? '+' + d + ' de vida' : 'Ya tenías la vida entera') : '−' + (-d) + ' de vida');
    }
    if (out.items) for (const id in out.items) {
      const n = out.items[id];
      let got = n;
      if (id === 'molotov') { got = p.fullOf && p.fullOf('molotov') ? 0 : n; p.items.molotov = (p.items.molotov || 0) + got; }
      else { const r = p.takeItem(id, n); got = n - ((r && r.left) || 0); }
      lines.push(got > 0 ? '+' + got + ' ' + itemWord(id, got) : 'No te cabía: ' + itemName(id, n));
    }
    if (out.balas) {
      // munición para las armas de fuego que llevas (en veces lo que trae el comercio)
      const seen = {};
      let any = false;
      for (const s of p.hands) {
        const w = s && G.Weapons.get(s.id), a = w && G.Weapons.isGun(w) && w.ammo && G.Weapons.AMMO[w.ammo];
        if (!a || seen[w.ammo]) continue;
        seen[w.ammo] = 1;
        const sh = SHOP.find((x) => x.id === a.item), n = Math.max(1, Math.round((sh ? sh.n : 4) * out.balas));
        const room = Math.max(0, (p.ammoCap ? p.ammoCap(w.ammo) : 99) - (p.ammo[w.ammo] || 0)), got = Math.min(n, room);
        p.ammo[w.ammo] = (p.ammo[w.ammo] || 0) + got;
        if (got > 0) { any = true; lines.push('+' + got + ' ' + (sh ? (sh.id === 'mun_gas' ? 'de combustible' : sh.name.toLowerCase()) : w.ammo)); }
      }
      if (!any) lines.push('No te cabía más munición');
    }
    if (out.weapon) {
      const w = G.Weapons.get(out.weapon), b = buyRounds(w), r = p.pickUp(out.weapon, b.load, 1);
      if (r && r.ok) {
        if (b.spare && G.Weapons.AMMO[w.ammo]) p.ammo[w.ammo] = Math.min(p.ammoCap(w.ammo), (p.ammo[w.ammo] || 0) + b.spare);
        p.equip(-1);
        lines.push('+' + w.name);
      }
    }
    if (out.fix) { const m = p.hands[0]; if (m) { m.cond = 1; m.broken = false; lines.push('Arma cuerpo a cuerpo como nueva'); } if (p.refreshModel) p.refreshModel(); }
    return lines;
  }

  const Run = {
    BASE_STEPS: STEPS, DAILY_STEPS, DAILY, TYPES, SHOP, REROLL, mapName,
    // lo que lleva encima, como copia (y de vuelta): el modo supervivencia guarda así su equipo (G.Surv)
    snap: (p) => snapshot(p), unsnap: (p, s) => restore(p, s),
    // enfrentamientos antes del jefe en la carrera en curso (5; la diaria, 8)
    get STEPS() { return (st && st.steps) || STEPS; },
    get active() { return !!st; },
    get daily() { return !!(st && st.daily); },
    // lo difícil que es el enfrentamiento en curso (para el número y la dureza de los enemigos)
    get tier() { if (!st) return 2; const n = st.steps || STEPS; return st.daily ? Math.min(5.5, tierOf(st.step, n, true)) : tierOf(st.step, n, false); },
    // nombre y textos de un camino del mapa (asalto y caza pueden ser de escorpiones)
    typeInfo(n) { if (!n) return TYPES.asalto; if (n.type === 'escuadron') return TYPES.saqueo; return (n.humans && TYPES[n.type + '_h']) || TYPES[n.type] || TYPES.asalto; },
    setEncMul(k) { encMul = k; },
    get st() { return st; },
    get inRefuge() { return inRefuge; },
    set inRefuge(v) { inRefuge = !!v; },
    get step() { return st ? st.step : 0; },
    get monedas() { return st ? st.monedas : 0; },
    // la tragamonedas del refugio: apuesta (n negativo) y premio
    addCoins(n) { if (!st) return false; if (st.monedas + n < 0) return false; st.monedas += n; save(); return true; },
    get piezas() { return st ? st.piezas : 0; },
    get suplementos() { return st ? (st.suplementos || 0) : 0; },
    // recompensas esperando en el cofre del refugio (o null)
    get pending() { return st ? st.pending || null : null; },
    get done() { return !!st && st.step >= this.STEPS; },

    // ¿Hay una carrera guardada que se puede continuar? (si saliste en medio de un enfrentamiento, se perdió)
    // daily: la carrera diaria (si no, la normal)
    saveInfo(daily) {
      const s = readSave(daily);
      if (!s || s.v !== 1) return null;
      return { lost: !!s.inEnc, char: s.char, step: s.step, steps: s.steps || STEPS, daily: !!s.daily, diff: s.diff || 'dificil' };
    },
    // carrera guardada que se pierde sin jugarla (salió a mitad de un enfrentamiento, o empieza otra): a la clasificación
    recordSaved(daily) { const s = readSave(daily); if (s && s.v === 1 && !s.free) Records.runEnded(s, null, !!s.bossWon); },
    // la carrera en curso termina (muerte o abandono); stats: lo del enfrentamiento a medias
    recordEnd(stats) { if (!st) return null; Records.runEnded(st, st.inEnc ? stats : null, !!st.bossWon); return st.rankGain || null; },
    // la experiencia que dio la carrera que acaba de terminar: { char, xp, from, to, text } (o null)
    get rankGain() { return st ? st.rankGain || null : null; },
    // ---------- El resumen de la carrera (al terminar: completada, muerta o abandonada; antes de discard) ----------
    // how: 'win' | 'dead' | 'quit'. extra: lo del enfrentamiento a medias (si moriste o saliste en uno)
    summary(how, extra) {
      if (!st || st.free) return null;
      const n = st.steps || STEPS, t = Object.assign({}, st.totals);
      if (extra && how !== 'win') for (const k of SUM) t[k] = (t[k] || 0) + (extra[k] || 0);
      const nodeOf = (nd, state) => {
        if (!nd) return null;
        if (nd.calm) return { kind: nd.play ? 'descanso' : nd.type, name: (TYPES[nd.type] || {}).name || 'Parada', place: nd.place || '', state };
        return { kind: 'enc', name: (TYPES[nd.type] || {}).name || nd.type, place: mapName(nd), mod: MODS[nd.mod] ? MODS[nd.mod].name : null, state };
      };
      const route = [];
      for (let k = 0; k < st.path.length; k++) {
        const o = nodeOf(st.map[k] && st.map[k][st.path[k]], 'done');
        if (o) route.push(o);
        if (st.faroAt === k + 1) route.push({ kind: 'faro', name: 'El faro, al alba', place: 'La bitácora', state: 'done' });
      }
      const boss = st.enc && st.enc.boss, bmap = (boss && st.enc.map) || this.bossMap;
      if (how !== 'win' && st.inEnc && st.enc && !boss) { const o = nodeOf(st.map[st.enc.col] && st.map[st.enc.col][st.enc.i], 'lost'); if (o) route.push(o); }
      if (how === 'win' || (st.inEnc && boss)) route.push({ kind: 'boss', name: 'Jefe final', place: mapName({ map: bmap }), state: how === 'win' ? 'done' : 'lost' });
      const log = st.calmLog || [];
      const sum = (f) => log.reduce((a, c) => a + (c[f] || 0), 0);
      return {
        how, char: st.char, diff: st.diff || 'dificil', daily: !!st.daily, step: st.step, steps: n, totals: t, route,
        calm: { n: log.filter((c) => !c.secret).length, found: sum('found'), total: sum('total'), faro: !!st.faro },
        pages: st.pages || 0,
        newRec: (st.newRec || []).map((id) => (id === 'diaria' ? 'Partida diaria más rápida' : (RECS.find((x) => x.id === id) || { name: id }).name)),
        rank: st.rankGain || null
      };
    },
    // borra la carrera en curso (o la guardada: daily true / false)
    discard(daily) {
      // (la carrera de prueba del tablero de simulación no está guardada: no se borra la de verdad)
      if (st && st.sim) { st = null; inRefuge = false; G.Weapons.applyUpgrades(null); return; }
      const d = daily != null ? !!daily : !!(st && st.daily);
      if (!st || !!st.daily === d) { st = null; inRefuge = false; G.Weapons.applyUpgrades(null); }
      try { localStorage.removeItem(d ? DKEY : KEY); } catch (e) { /* nada */ }
    },

    // ---------- Partida diaria ----------
    // estado de la de hoy: { day, played (ya empezada hoy), res, char (el que toca), saved (hay una a medias), left (ms hasta medianoche) }
    dailyInfo() {
      const day = today(), r = dayRec(), sv = this.saveInfo(true);
      const end = new Date(); end.setHours(24, 0, 0, 0);
      return { day, played: !!(r && r.day === day), res: r && r.day === day ? r.res : null, char: r && r.day === day ? r.char : this.dailyChar(day),
        saved: sv && !sv.lost ? sv : null, lost: !!(sv && sv.lost), left: end - Date.now() };
    },
    // el personaje que toca hoy: uno de los desbloqueados, al azar (sale de la fecha)
    dailyChar(day) {
      const ids = Object.keys(G.Player.CHARS).filter((id) => this.unlocked(id, true) && !G.Player.CHARS[id].buy);      // (Eira, comprada aparte: fuera de la diaria)
      return ids[Math.floor(rngOf(daySeed(day || today(), 'pj'))() * ids.length)] || 'vera';
    },

    // Carrera nueva: solo con la pistola (cargador lleno y un cargador de reserva) y una venda.
    // daily: la partida diaria de hoy (8 enfrentamientos, el mapa sale de la fecha)
    newRun(charId, player, daily) {
      this.recordSaved(!!daily);
      const day = daily ? today() : null, steps = daily ? DAILY_STEPS : STEPS;
      mapChar = charId;
      const m = makeMap(steps, daily ? rngOf(daySeed(day, 'mapa')) : null, !!daily);
      st = {
        v: 1, char: charId, step: 0, steps, lines: true, subAt: m.subAt, falseLine: m.falseLine, path: [], map: m.cols, monedas: 4, piezas: 0, suplementos: 0, pending: null, up: {},
        inv: null, shop: [], crate: [], inEnc: false, enc: null, chal: {}, gifts: [],
        totals: { kills: 0, time: 0, score: 0 }, last: null
      };
      if (daily) { st.daily = day; setDay({ day, char: charId, res: 'jugando' }); }
      // el jefe final de esta carrera: el hongomorfo del salón recreativo o el Aguijón en el faro (a suertes; en la
      // diaria sale de la fecha, igual para todos). Se ve en el mapa del refugio desde el principio
      st.bossId = (daily ? rngOf(daySeed(day, 'jefe'))() : Math.random()) < 0.5 ? 'faro' : 'salon';
      // la dificultad (la que se eligió con el personaje; la diaria, siempre Difícil): se guarda con la carrera
      if (G.Diff) { if (daily) G.Diff.set('dificil'); st.diff = G.Diff.cur; }
      G.Weapons.applyUpgrades(st.up);
      if (player) {
        player.hands = [null, null, null, null, null]; player.stored = [];
        player.pickUp('pistola', G.Weapons.get('pistola').mag, 1);
        player.ammo['9mm'] = 6;
        player.items.venda = 1;
        this.charKit(player, st);
        if (!daily) st.rank = Rank.apply(player, st, charId);          // (el rango del personaje: empieza con algo más)
        player.equip(-1);
        st.inv = snapshot(player);
      }
      st.shop = makeShop(player);
      save();
    },
    // Tablero de simulación (modo libre): el final variante. Una carrera de prueba que no se guarda ni cuenta para
    // los récords: el mapa ya en el último enfrentamiento antes del jefe, con la liberación de la caída en todas
    // las opciones, y el equipo inicial del personaje (con algo de monedas y piezas para el refugio)
    simFinal(charId, player) {
      mapChar = charId;
      const steps = STEPS, m = makeMap(steps, null, false, true);
      st = {
        v: 1, sim: true, char: charId, step: steps - 1, steps, lines: false, subAt: m.subAt, path: [], map: m.cols, monedas: 30, piezas: 80, suplementos: 40, pending: null, up: {},
        inv: null, shop: [], crate: [], inEnc: false, enc: null, chal: {}, gifts: [],
        totals: { kills: 0, time: 0, score: 0 }, last: null
      };
      for (let k = 0; k < steps - 1; k++) st.path.push(0);
      G.Weapons.applyUpgrades(st.up);
      if (player) {
        player.hands = [null, null, null, null, null]; player.stored = [];
        for (const k in player.items) player.items[k] = 0; for (const k in player.ammo) player.ammo[k] = 0;
        player.pickUp('pistola', G.Weapons.get('pistola').mag, 1);
        player.ammo['9mm'] = 12;
        player.items.venda = 2;
        this.charKit(player, st);
        player.equip(-1);
        player.health = 100;
        st.inv = snapshot(player);
      }
      st.shop = makeShop(player);
      inRefuge = false;
    },
    get sim() { return !!(st && st.sim); },
    // Lo que trae cada personaje de más al empezar. Di' Arco: el rifle (con la mejora de daño ya puesta) y dos minas.
    // Vera: un revólver y una molotov, además de la pistola.
    // Booster: solo la escopeta y dos molotov (sin pistola). La señora Paula: el lanzallamas con combustible (sin pistola)
    charKit(player, run) {
      if (!player) return;
      const R = run || st;
      const drop = (id) => { for (const i of [1, 2, 3, 4]) if (player.hands[i] && player.hands[i].id === id) player.hands[i] = null; };
      if (player.charId === 'booster') {
        drop('pistola'); player.ammo['9mm'] = 0;
        if (!player.weapons.some((w) => w.id === 'escopeta')) player.pickUp('escopeta', G.Weapons.get('escopeta').mag, 1);
        player.ammo.cartucho = Math.max(player.ammo.cartucho || 0, 6);
        player.items.molotov = Math.max(player.items.molotov || 0, 2);
        player.refreshModel && player.refreshModel();
        return;
      }
      // todos empiezan con un botiquín (una venda)
      player.items.venda = Math.max(player.items.venda || 0, 1);
      // Tomás: la pistola, un revólver con algo de munición y tres bombas de humo
      if (player.charId === 'tomas') {
        if (!player.weapons.some((w) => w.id === 'pistola')) player.pickUp('pistola', G.Weapons.get('pistola').mag, 1);
        if (!player.weapons.some((w) => w.id === 'revolver')) player.pickUp('revolver', G.Weapons.get('revolver').mag, 1);
        player.ammo.revolver = Math.max(player.ammo.revolver || 0, 6);
        player.items.humo = Math.max(player.items.humo || 0, 3);
        player.refreshModel && player.refreshModel();
        return;
      }
      // Vera (táctica): la pistola de siempre, un revólver con algo de munición y una molotov
      if (player.charId === 'vera') {
        if (!player.weapons.some((w) => w.id === 'pistola')) player.pickUp('pistola', G.Weapons.get('pistola').mag, 1);
        if (!player.weapons.some((w) => w.id === 'revolver')) player.pickUp('revolver', G.Weapons.get('revolver').mag, 1);
        player.ammo.revolver = Math.max(player.ammo.revolver || 0, 6);
        player.items.molotov = Math.max(player.items.molotov || 0, 1);
        player.refreshModel && player.refreshModel();
        return;
      }
      // Grimes: su revólver, con todas las mejoras, un subfusil con balas y su hacha (que no se rompe)
      if (player.charId === 'grimes') {
        this.maxWeapon('revolver', R);
        drop('pistola'); player.ammo['9mm'] = 0;
        if (!player.weapons.some((w) => w.id === 'revolver')) player.pickUp('revolver', G.Weapons.get('revolver').mag, 1);
        if (!player.weapons.some((w) => w.id === 'subfusil')) player.pickUp('subfusil', G.Weapons.get('subfusil').mag, 1);
        if (!player.hands[0] || player.hands[0].id !== 'hacha_grimes') player.hands[0] = { id: 'hacha_grimes', cond: 1, two: false };
        player.ammo.revolver = Math.max(player.ammo.revolver || 0, 12);
        player.ammo.smg = Math.max(player.ammo.smg || 0, 24);
        player.refreshModel && player.refreshModel();
        return;
      }
      // Eira: el arco con todas las mejoras y flechas explosivas (y normales), el rifle de cerrojo, la pistola, tres
      // rompepandoras, el botiquín y dos molotovs
      if (player.charId === 'eira') {
        this.maxWeapon('arco', R);
        if (!player.weapons.some((w) => w.id === 'pistola')) player.pickUp('pistola', G.Weapons.get('pistola').mag, 1);
        if (!player.weapons.some((w) => w.id === 'rifle')) player.pickUp('rifle', G.Weapons.get('rifle').mag, 1);
        if (!player.weapons.some((w) => w.id === 'arco')) player.pickUp('arco', G.Weapons.get('arco').mag, 1);
        player.ammo.rifle = Math.max(player.ammo.rifle || 0, 5);
        player.ammo.flecha = Math.max(player.ammo.flecha || 0, player.ammoCap('flecha'));
        player.ammo.flecha_exp = Math.max(player.ammo.flecha_exp || 0, player.ammoCap('flecha_exp'));
        player.arrowExp = true;
        player.items.pandora = Math.max(player.items.pandora || 0, 3);
        player.items.molotov = Math.max(player.items.molotov || 0, 2);
        player.refreshModel && player.refreshModel();
        return;
      }
      if (player.charId === 'paula') {
        drop('pistola'); player.ammo['9mm'] = 0;
        if (!player.weapons.some((w) => w.id === 'lanzallamas')) player.pickUp('lanzallamas', G.Weapons.get('lanzallamas').mag, 1);
        player.ammo.gas = Math.max(player.ammo.gas || 0, Math.round(player.ammoCap('gas') * 0.6));
        player.refreshModel && player.refreshModel();
        return;
      }
      if (player.charId !== 'diarco') return;
      if (R) { R.up = R.up || {}; R.up.rifle = Object.assign({}, R.up.rifle, { dano: true }); G.Weapons.applyUpgrades(R.up); }
      if (!player.weapons.some((w) => w.id === 'pistola')) player.pickUp('pistola', G.Weapons.get('pistola').mag, 1);
      if (!player.weapons.some((w) => w.id === 'rifle')) player.pickUp('rifle', G.Weapons.get('rifle').mag, 1);
      player.ammo.rifle = Math.max(player.ammo.rifle || 0, 6);
      player.items.mina = Math.max(player.items.mina || 0, 2);
      player.backpack = false;
      player.refreshModel && player.refreshModel();
    },
    // todas las mejoras de un arma (Grimes: su revólver al empezar; las escopetas al cogerlas)
    maxWeapon(id, run) {
      const R = run || st, U = G.Weapons.UPGRADES[id];
      if (!R || !U) return;
      R.up = R.up || {};
      R.up[id] = Object.assign({}, R.up[id]);
      for (const u of U) R.up[id][u.id] = true;
      G.Weapons.applyUpgrades(R.up);
    },
    // Continuar la carrera guardada
    load(daily) {
      const s = readSave(daily);
      if (!s || s.v !== 1 || s.inEnc) return false;
      st = s;
      if (G.Diff) G.Diff.set(st.diff || 'dificil');          // (las carreras de antes de la dificultad: Difícil)
      G.Weapons.applyUpgrades(st.up);
      return true;
    },
    save,

    // ---------- Refugio ----------
    // al llegar al refugio: llegas tal cual saliste del enfrentamiento (vida, balas y todo) y se guarda
    enterRefuge(player) {
      if (!st) return;
      inRefuge = true;
      st.inEnc = false; st.enc = null; st.calm = null;
      G.Weapons.applyUpgrades(st.up);
      restore(player, st.inv);
      // el arma de un desafío difícil (si salió): espera sobre un mueble del refugio hasta que la cojas
      this.newGift = null;
      const give = (id, mag) => {
        if (player.weapons.some((w) => w.id === id)) return false;
        player.stored.push({ id, mag: mag != null ? mag : G.Weapons.get(id).mag, cond: 1 });
        return true;
      };
      if (st.gifts && st.gifts.length && !st.shelf) { st.shelf = st.gifts[0]; this.newGift = st.shelf; }
      st.gifts = [];
      // (partidas viejas: lo que quedaba en el cofre de antes va a la mochila)
      for (const c of st.crate || []) {
        const w = G.Weapons.get(c.id);
        if (w && w.cat === 'gun') give(c.id, c.cond); else player.takeItem(c.id, c.cond || 1);
      }
      st.crate = [];
      st.inv = snapshot(player);
      save();
    },
    // lo que llevas, otra vez encima (al empezar un enfrentamiento, tras reiniciar el mundo)
    restoreInv(player) { if (st) { G.Weapons.applyUpgrades(st.up); restore(player, st.inv); } },
    // guarda lo que llevas (cada vez que cambia algo en el refugio)
    keep(player) { if (!st || !player) return; st.inv = snapshot(player); save(); },

    // ---------- Mapa ----------
    choices() { return st && st.step < this.STEPS ? st.map[st.step] : []; },
    // ¿empieza un desvío de la línea L en la columna k?
    subStart(L, k) { return !!st && subsOf(st.subAt && st.subAt[L]).indexOf(k) >= 0; },
    // los enfrentamientos de la columna actual que se pueden elegir (índices): al principio, el primero de cada
    // línea; luego, solo los de tu línea (y su desvío, donde sale; dentro del desvío, se sigue por él)
    allowed() {
      if (!st || st.step >= this.STEPS) return [];
      const col = st.map[st.step];
      if (!st.lines) return col.map((n, i) => i);          // (carreras guardadas de antes: como siempre)
      if (st.step === 0) return col.map((n, i) => (n.sub ? -1 : i)).filter((i) => i >= 0);
      const pn = st.map[st.step - 1][st.path[st.step - 1]], L = pn.line, S = subsOf(st.subAt[L]), out = [];
      // (a mitad de un desvío: se sigue por él. Si no: tu línea o, donde empieza uno, el desvío)
      const mid = pn.sub && S.indexOf(st.step - 1) >= 0;
      col.forEach((n, i) => {
        if (n.line !== L) return;
        if (mid ? n.sub : (!n.sub || S.indexOf(st.step) >= 0)) out.push(i);
      });
      return out;
    },
    // de dónde se llega al enfrentamiento i de la columna k (índices de la columna k - 1; -1: el refugio)
    preds(k, i) {
      if (!st) return [];
      if (k === 0) return [-1];
      const prev = st.map[k - 1];
      if (!st.lines) return prev.map((n, j) => j);
      const n = st.map[k][i], L = n.line, S = subsOf(st.subAt[L]);
      const mainI = prev.findIndex((x) => x.line === L && !x.sub), subI = prev.findIndex((x) => x.line === L && x.sub);
      // (el desvío de la columna anterior, ¿termina ahí?: entonces de él también se llega aquí)
      const ended = subI >= 0 && S.indexOf(k - 2) >= 0;
      if (n.sub && S.indexOf(k) < 0) return [subI];              // el segundo del desvío: solo desde el primero
      return ended ? [mainI, subI] : [mainI];
    },
    // de dónde se llega al jefe final (índices de la última columna)
    bossPreds() {
      if (!st) return [];
      const n = this.STEPS, last = st.map[n - 1];
      if (!st.lines) return last.map((x, j) => j);
      return last.map((x, j) => (!x.sub || subsOf(st.subAt[x.line]).indexOf(n - 2) >= 0 ? j : -1)).filter((j) => j >= 0);
    },
    // empieza el enfrentamiento i de la columna actual (queda marcado: salir a mitad pierde la carrera)
    beginEncounter(i, player) {
      if (!st || st.step >= this.STEPS) return null;
      const node = st.map[st.step][i];
      if (!node || node.calm || this.allowed().indexOf(i) < 0) return null;
      st.inv = snapshot(player);
      if (!node.map || !(G.Maps && G.Maps.get(node.map))) node.map = pickMap();
      st.enc = { col: st.step, i, type: node.type, time: node.time, map: node.map, humans: !!node.humans, fatal: !!node.fatal, mod: MODS[node.mod] ? node.mod : null };
      // la caída: quién te vengará (va entre los presos a liberar)
      if (node.fatal) st.enc.avenger = avengerFor(st.char);
      st.encBonus = 0; st.encChal = [];
      st.inEnc = true;
      inRefuge = false;
      save();
      return st.enc;
    },
    // ---------- Modificadores ----------
    MODS, EVENTS, Rank,
    modInfo(n) { return n && MODS[n.mod] ? Object.assign({ id: n.mod }, MODS[n.mod]) : null; },
    // el del enfrentamiento en curso (null en el refugio y en el jefe)
    get mod() { return st && st.inEnc && st.enc && MODS[st.enc.mod] ? st.enc.mod : null; },
    // lo que multiplica ahora mismo (enemies, hp, hurt, ammo): 1 si no hay modificador
    modK(key) { const id = this.mod, M = id && MODS[id]; return M && M.k && M.k[key] != null ? M.k[key] : 1; },

    // ---------- Paradas (sin pelea) ----------
    isCalm(n) { return !!(n && n.calm && CALM[n.type]); },
    // ¿se juega? (los descansos nuevos: un sitio con algo que resolver, ver calm.js)
    isPlay(n) { return !!(n && n.calm && n.play && n.scene && G.Calm && G.Calm.SCENES && G.Calm.SCENES[n.scene]); },
    // ir a la parada i de la columna actual (se juega): { scene, seed, map, step }
    beginCalm(i, player) {
      if (!st || st.step >= this.STEPS) return null;
      const n = st.map[st.step][i];
      if (!this.isPlay(n) || this.allowed().indexOf(i) < 0) return null;
      st.inv = snapshot(player);
      st.calm = { col: st.step, i, scene: n.scene, seed: n.seed || 1 };
      inRefuge = false;
      save();
      return { scene: n.scene, seed: n.seed || 1, map: G.Calm.SCENES[n.scene].map, step: st.step + 1 };
    },
    get inCalm() { return !!(st && st.calm); },
    // ---------- La bitácora del faro ----------
    // una hoja más en esta carrera (devuelve cuántas van)
    calmPage() { if (!st) return 0; st.pages = (st.pages || 0) + 1; save(); return st.pages; },
    get pages() { return st ? st.pages || 0 : 0; },
    // ¿se puede ir al faro? (tres hojas en esta carrera, y aún no se ha ido)
    faroOK() { return !!st && !st.faro && (st.pages || 0) >= 3; },
    // el desvío al faro (la parada secreta), justo después del descanso de la tercera hoja: no cuenta como tramo
    beginSecret(player) {
      if (!this.faroOK() || !G.Calm || !G.Calm.SCENES || !G.Calm.SCENES.faro) return null;
      st.faro = true; st.faroAt = st.step;
      st.inv = snapshot(player);
      st.calm = { col: -1, i: -1, scene: 'faro', seed: 1 + Math.floor(Math.random() * 999983), secret: true };
      inRefuge = false;
      save();
      return { scene: 'faro', seed: st.calm.seed, map: G.Calm.SCENES.faro.map, step: st.step, secret: true };
    },
    // lo que se encuentra en la parada (al momento): monedas, piezas, suplementos, vida, objetos, balas
    calmGive(out, player) { return st ? applyOut(out, player) : []; },
    // se sigue el camino: la parada cuenta como un tramo, y se guarda lo que llevas
    endCalm(player, info) {
      if (!st || !st.calm) return false;
      const c = st.calm;
      st.calm = null;
      // (para el resumen: lo que se encontró en cada parada)
      (st.calmLog = st.calmLog || []).push({ scene: c.scene, found: info ? info.found || 0 : 0, total: info ? info.total || 0 : 0, secret: !!c.secret });
      if (st.step === c.col) { st.path.push(c.i); st.step++; st.calmDone = (st.calmDone || 0) + 1; }
      if (player) st.inv = snapshot(player);
      save();
      return true;
    },
    // la parada i de la columna actual: { type, title, text, opts: [{ label, hint, no (por qué no se puede, o null) }] }
    calmInfo(i, player) {
      if (!st || st.step >= this.STEPS) return null;
      const n = st.map[st.step][i], E = n && n.calm && EVENTS[n.ev];
      if (!E || this.allowed().indexOf(i) < 0) return null;
      const opts = this.calmOpts(n).map((o) => ({ label: o.label, hint: o.hint || '', no: this.calmWhyNot(o, player) }));
      // (siempre se puede pasar de largo)
      opts.push({ label: E.type === 'mercader' ? 'No comprar nada' : 'Seguir de largo', hint: 'No pasa nada.', no: null, skip: true });
      return { type: E.type, title: E.title, text: E.text, opts };
    },
    calmOpts(n) {
      const E = EVENTS[n.ev];
      if (E.type !== 'mercader') return E.opts;
      return (n.deals || []).map((d) => DEALS[d]).filter(Boolean).map((d) => ({ label: d.label, hint: costText(d.cost) + ' → ' + gainText(d), cost: d.cost, out: [Object.assign({ text: 'Trato hecho. Recoge, te desea suerte sin mirarte y sigue su camino.' }, d, { cost: undefined, label: undefined })] }));
    },
    calmWhyNot(o, player) {
      const c = o.cost || {};
      if ((c.monedas || 0) > st.monedas) return 'Te faltan monedas';
      if ((c.piezas || 0) > st.piezas) return 'Te faltan piezas';
      if ((c.suplementos || 0) > (st.suplementos || 0)) return 'Te faltan suplementos';
      const nd = o.need || {};
      if (nd.venda && (!player || (player.items.venda || 0) < nd.venda)) return 'No te quedan vendas';
      if (nd.melee) { const m = player && player.hands[0]; if (!m || G.Weapons.isGun(G.Weapons.get(m.id))) return 'No llevas arma cuerpo a cuerpo'; }
      const w = o.out && o.out[0] && o.out[0].weapon;
      if (w && player) {
        if (player.weapons.some((x) => x.id === w)) return 'Ya la tienes';
        if (player.canUse && !player.canUse(w)) return 'No la usa';
        if (!player.spotFor(w)) return 'Sin espacio';
      }
      return null;
    },
    // elegir la opción k de la parada i: aplica lo que pase, avanza el mapa y guarda.
    // Devuelve { text, lines: ['+25 piezas', ...], bad } (o null si no se puede)
    resolveCalm(i, k, player) {
      const info = this.calmInfo(i, player);
      if (!info || !info.opts[k] || info.opts[k].no) return null;
      const n = st.map[st.step][i];
      let res = { text: info.type === 'mercader' ? 'La ves alejarse con el carro, sin prisa ya.' : 'Sigues tu camino sin tocar nada.', lines: [], bad: false };
      if (!info.opts[k].skip) {
        const o = this.calmOpts(n)[k], c = o.cost || {}, nd = o.need || {};
        st.monedas -= c.monedas || 0; st.piezas -= c.piezas || 0; st.suplementos = (st.suplementos || 0) - (c.suplementos || 0);
        if (nd.venda && player) player.items.venda = Math.max(0, (player.items.venda || 0) - nd.venda);
        // el desenlace: al azar entre los posibles
        let out = o.out[o.out.length - 1], r = Math.random();
        for (const x of o.out) { if (x.p == null) { out = x; break; } if (r < x.p) { out = x; break; } r -= x.p; }
        res = { text: out.text || '', lines: applyOut(out, player), bad: (out.vida || 0) < 0 };
      }
      st.path.push(i);
      st.step++;
      st.calmDone = (st.calmDone || 0) + 1;
      if (player) st.inv = snapshot(player);
      save();
      return res;
    },

    get encounter() { return st ? st.enc : null; },
    // el jefe final (tras los siete enfrentamientos): el hongomorfo, en el salón recreativo, o el Aguijón (el líder
    // de los Escorpiones), en el faro: sale a suertes al empezar la carrera (bossId). Si caíste en la liberación (el
    // camino falso), es en la vieja estación de policía de Oceanside (adonde va a por armas quien te venga)
    BOSS_MAP: 'arcade',
    get bossId() { return st && st.revenge ? 'comisaria' : (st && st.bossId === 'faro' ? 'faro' : 'salon'); },
    get bossMap() { return { comisaria: 'comisaria', faro: 'faro_jefe', salon: 'arcade' }[this.bossId]; },
    beginBoss(player) {
      if (!st || st.step < this.STEPS) return null;
      st.inv = snapshot(player);
      st.enc = { boss: true, type: 'jefe', map: this.bossMap, revenge: !!(st && st.revenge) };
      st.encBonus = 0; st.encChal = [];
      st.inEnc = true;
      inRefuge = false;
      save();
      return st.enc;
    },
    // jefe derrotado: la carrera termina (se suma al total)
    winBoss(player, score, stats) {
      if (!st || !st.enc || !st.enc.boss) return null;
      st.totals.score += Math.round((score || 0) * (1 + (st.encBonus || 0)));     // (los desafíos del jefe lo multiplican)
      addStats(stats);
      Records.runEnded(st, null, true);
      // carreras completadas (para desbloquear personajes: la señora Paula, con 3)
      if (!st.bossWon && !st.sim) {
        const n0 = runsDone();
        try { localStorage.setItem(DONE_KEY, String(n0 + 1)); } catch (e) { /* nada */ }
        st.unlockedNow = Object.keys(G.Player.CHARS).filter((id) => G.Player.CHARS[id].lock && n0 < G.Player.CHARS[id].lock && n0 + 1 >= G.Player.CHARS[id].lock);
      }
      // Grimes: terminó la venganza de la Trece. Desde ahora aparece en Extras
      if (!st.sim && st.revenge && st.char === 'grimes' && G.Extras && G.Extras.markGrimes) this.grimesNow = G.Extras.markGrimes();
      st.bossWon = true;
      st.inEnc = false;
      save();
      if (st.daily) { this.dailyWon = this.achieve('diaria_' + st.char) || ACHIEVEMENTS.find((a) => a.id === 'diaria_' + st.char) || null; }
      return st.totals;
    },
    get bossWon() { return !!(st && st.bossWon); },
    runsDone,
    // ¿se puede elegir este personaje? (lock: carreras completadas que hacen falta)
    unlocked(id, real) { const c = G.Player.CHARS[id]; if (c && G.DEV && !real) return true; return !!c && !c.dev && (!c.lock || runsDone() >= c.lock) && (!c.buy || !!(G.Extras && G.Extras.owns(c.buy))); },   // (dev: en desarrollo; buy: se compra en Extras)
    get unlockedNow() { return (st && st.unlockedNow) || []; },
    // enfrentamiento superado: las recompensas (piezas, suplementos y monedas) esperan en el cofre del refugio
    winEncounter(player, score, stats) {
      if (!st || !st.enc) return null;
      const e = st.enc, node = st.map[e.col][e.i];
      // desafíos completados en este enfrentamiento: multiplican lo que da (se suman entre sí)
      // (saqueo sin abrir la caja a tiempo: un cuarto)
      const mult = (1 + (st.encBonus || 0)) * (encMul || 1);
      encMul = 1;
      const got = {
        piezas: Math.round(node.piezas * mult),
        suplementos: Math.round((node.suplementos != null ? node.suplementos : 50 + e.col * 8) * mult),
        monedas: Math.round((node.monedas != null && node.monedas <= 60 ? node.monedas : 13 + e.col * 4) * mult),
        place: mapName(node), type: e.type, mult: Math.round(mult * 100) / 100, chals: (st.encChal || []).slice(), mod: e.mod || null
      };
      st.encBonus = 0; st.encChal = [];
      const p = st.pending;
      if (p) { p.piezas += got.piezas; p.suplementos += got.suplementos; p.monedas += got.monedas; p.place = got.place; p.type = got.type; p.mult = got.mult; p.chals = got.chals; p.mod = got.mod; }
      else st.pending = Object.assign({}, got);
      st.path.push(e.i);
      st.step++;
      st.totals.score += score || 0;
      addStats(stats);
      Records.encounter(st, score || 0);
      st.inv = snapshot(player);
      // (modificador «sin comercio al volver»: el puesto, vacío y sin dados hasta el siguiente enfrentamiento)
      st.shopShut = e.mod === 'cerrado' || undefined;
      st.shop = st.shopShut ? [] : makeShop(player);
      st.last = got;
      // la muerte súbita (una vez por carrera): tras la del refugio, el siguiente enfrentamiento trae el comercio de
      // después; si no pasó todavía, ¿vuelves casi sin balas?
      const SD = st.sd;
      if (SD && SD.phase === 'done' && !SD.keeper) SD.keeper = keeperFor();
      else if (!SD) {
        const a = gunAmmo(player);
        if (a && a.per <= SUDDEN_PER) st.sd = { phase: 'armed', hard: a.total < SUDDEN_HARD, total: a.total, at: st.step };
      }
      // el enfrentamiento ya terminó: si sales ahora, se continúa desde el refugio
      st.inEnc = false;
      save();
      return got;
    },

    // La caída: te mataron al llegar a la salida de la liberación de antes del jefe. El enfrentamiento cuenta como
    // superado (la recompensa espera en el cofre) y la carrera sigue con quien te venga, con lo que llevabas
    // encima (las mismas armas y cosas; la vida, entera). Se habilita la estación de policía para el jefe
    fatalFall(player, score, stats, to) {
      if (!st || !st.enc) return null;
      const from = st.char;
      const got = this.winEncounter(player, score, stats);
      st.char = to;
      st.revenge = { from, to, said: false };
      if (st.inv) st.inv.health = 100;
      st.rack = [];                    // (el armero del refugio, vacío: llega sin nada)
      // (la muerte súbita no se arma con las balas de quien cayó: el que te venga llega sin nada)
      if (st.sd && st.sd.phase === 'armed' && st.sd.at === st.step) st.sd = null;
      save();
      return got;
    },
    // ---------- Muerte súbita ----------
    get sudden() { return st && st.sd ? st.sd : null; },
    gunAmmo,
    // empieza (al tocar algo en el refugio) / el temblante cayó (el comercio queda destrozado) / ya te echó la bronca
    suddenStart() { if (st && st.sd) { st.sd.phase = 'fight'; save(); } },
    suddenDone() { if (st && st.sd) { st.sd.phase = 'done'; st.sd.gone = true; save(); } },
    suddenScolded() { if (st && st.sd) { st.sd.scolded = true; save(); } },
    get revenge() { return st ? st.revenge || null : null; },
    keeperFor,
    revengeSaid() { if (st && st.revenge) { st.revenge.said = true; save(); } },
    avengerFor,
    get char() { return st ? st.char : null; },

    // recoger lo del cofre del refugio
    takeRewards(player) {
      const p = st && st.pending;
      if (!p) return null;
      st.piezas += p.piezas; st.suplementos = (st.suplementos || 0) + p.suplementos; st.monedas += p.monedas;
      st.pending = null;
      if (player) st.inv = snapshot(player);
      save();
      return p;
    },

    // ---------- Comercio ----------
    // (la señora Paula: no le ofrecen escopetas ni rifles, y el combustible le sale más barato y en más cantidad)
    shopList() {
      if (!st) return [];
      const paula = st.char === 'paula', NO = { escopeta: 1, doble: 1, rifle: 1, mun_cartucho: 1, mun_rifle: 1 };
      return st.shop.filter((o) => SHOP.some((s) => s.id === o.id) && !(paula && NO[o.id])).map((o) => Object.assign({}, SHOP.find((s) => s.id === o.id), { left: o.left },
        paula && o.id === 'mun_gas' ? { price: 2, n: 30, desc: 'Combustible para el lanzallamas (Paula consigue más y más barato).' } : {}, st.free ? { price: 0 } : {}));
    },
    // los dados: vuelve a sortear lo que hay a la venta (cuesta monedas)
    rerollWhyNot() { if (!st || st.free) return 'No disponible'; if (st.shopShut) return 'El comercio está cerrado hasta el siguiente enfrentamiento'; return st.monedas < REROLL ? 'Te faltan monedas' : null; },
    get shopShut() { return !!(st && st.shopShut); },
    reroll(player) {
      const no = this.rerollWhyNot();
      if (no) return { msg: no, fail: true };
      st.monedas -= REROLL;
      st.shop = makeShop(player);
      this.keep(player);
      if (G.Audio) G.Audio.play('pickup');
      return { msg: 'El puesto de comercio cambió' };
    },
    // Modo libre: comercio y banco de mejoras gratis (todo a la venta, sin gastar nada). No se guarda
    get free() { return !!(st && st.free); },
    startFree(charId) {
      st = {
        v: 1, free: true, char: charId, step: 0, path: [], map: makeMap().cols, monedas: FREE_CHIPS, piezas: 0, up: {},
        inv: null, shop: SHOP.map((s) => ({ id: s.id, left: 99 })), crate: [], inEnc: false, enc: null, chal: {}, gifts: [],
        totals: { kills: 0, time: 0, score: 0 }, last: null
      };
      inRefuge = false;
      G.Weapons.applyUpgrades(st.up);
    },
    // modo libre: la tragamonedas sin fichas te da otras
    refillChips() { if (!st || !st.free || st.monedas >= 3) return false; st.monedas = FREE_CHIPS; return true; },
    // Tienda de armas cuerpo a cuerpo (modo libre): todas, gratis. La que compras va a su espacio (cuerpo a cuerpo)
    meleeList() {
      const MEL = { lblunt: 1, sblunt: 1, axe: 1, lblade: 1, sblade: 1, spear: 1 };
      return G.Weapons.LIST.filter((w) => MEL[w.cat] && !G.Weapons.isGun(w) && !w.own).map((w) => ({
        id: w.id, name: w.name, icon: w.id, weapon: true, melee: true, price: 0, left: 99,
        desc: (w.hands === 2 ? 'A dos manos' : 'A una mano') + ' · daño ' + w.dmg[0] + '–' + w.dmg[1] + ' · alcance ' + w.range + ' m · aguanta unos ' + Math.round(w.cond * G.Weapons.DURABILITY) + ' golpes.'
      }));
    },
    meleeWhyNot(o, player) {
      if (!o) return 'No disponible';
      if (player.canUse && !player.canUse(o.id)) return player.charName + ' solo usa su navaja';
      const m = player.hands[0];
      return m && m.id === o.id && !m.broken ? 'Ya la llevas' : null;
    },
    buyMelee(id, player) {
      const o = this.meleeList().find((x) => x.id === id), no = this.meleeWhyNot(o, player);
      if (no) return { msg: no, fail: true };
      // la que llevabas para el cuerpo a cuerpo se queda en la mochila (sin mochila, en la tienda)
      const old = player.hands[0];
      let kept = false;
      if (old) {
        if (player.cur === 0) player.equip(-1);
        player.hands[0] = null;
        if (!old.broken && player.backpack && !player.packless && !player.stored.some((x) => x.id === old.id)) { player.stored.push(old); kept = true; }
      }
      const r = player.pickUp(id, 1, 1);
      if (!r.ok) { if (old) { player.hands[0] = old; if (kept) player.stored.pop(); } return { msg: 'Sin espacio', fail: true }; }
      if (G.Audio) G.Audio.play('pickup');
      return { msg: 'Llevas: ' + G.Weapons.get(id).name + (kept ? ' (' + G.Weapons.get(old.id).name.toLowerCase() + ' a la mochila)' : '') };
    },
    endFree() { if (st && st.free) { st = null; inRefuge = false; G.Weapons.applyUpgrades(null); } },
    // por qué no se puede comprar (o null)
    whyNot(o, player) {
      if (!o || o.left <= 0) return 'Agotado';
      if (st.monedas < o.price) return 'Te faltan monedas';
      if (o.weapon) return player.weapons.some((w) => w.id === o.id) ? 'Ya la tienes' : (player.spotFor(o.id) ? null : (player.canUse && !player.canUse(o.id) ? 'No la usa' : 'Sin espacio'));
      if (o.id === 'molotov') return player.fullOf('molotov') ? 'No te caben más' : null;
      return player.itemRoom(o.id) > 0 ? null : 'No te caben más';
    },
    buy(id, player) {
      if (!st) return null;
      const o = this.shopList().find((x) => x.id === id);
      const no = this.whyNot(o, player);
      if (no) return { msg: no, fail: true };
      let msg;
      if (o.weapon) {
        const w = G.Weapons.get(o.id);
        const b = buyRounds(w);
        const r = player.pickUp(o.id, b.load, 1);
        if (!r.ok) return { msg: 'Sin espacio', fail: true };
        let extra = 0;
        if (b.spare && G.Weapons.AMMO[w.ammo]) { extra = Math.max(0, Math.min(b.spare, player.ammoCap(w.ammo) - (player.ammo[w.ammo] || 0))); player.ammo[w.ammo] = (player.ammo[w.ammo] || 0) + extra; }
        player.equip(-1);
        msg = 'Compraste: ' + w.name + (w.gun !== 'flame' ? ' (' + (b.load + extra) + ' ' + (w.gun === 'bow' ? 'flechas' : 'balas') + ')' : '');
        // (Booster: la larga que llevaba queda sobre el mueble del refugio, para cambiarla otra vez si quiere)
        if (r.old && !r.old.broken) { if (!st.shelf) { st.shelf = r.old.id; msg += ' · dejaste ' + G.Weapons.get(r.old.id).name.toLowerCase() + ' en el refugio'; } }
      } else if (o.id === 'molotov') {
        player.items.molotov = (player.items.molotov || 0) + 1; msg = 'Compraste una molotov';
      } else {
        const r = player.takeItem(o.id, o.n);
        msg = 'Compraste: ' + (o.n > 1 ? o.n + ' ' : '') + o.name.toLowerCase() + (r.left > 0 ? ' (no te cabía todo)' : '');
      }
      st.monedas -= o.price;
      const so = st.shop.find((x) => x.id === id);
      if (!st.free) so.left = 0;
      this.keep(player);
      if (G.Audio) G.Audio.play('pickup');
      return { msg };
    },

    // ---------- Mejoras ----------
    upgraded(wid, uid) { if (G.Surv && G.Surv.active) return G.Surv.upgraded(wid, uid); return !!(st && st.up[wid] && st.up[wid][uid]); },          // (supervivencia: las piezas montadas)
    // ---------- Suplementos (mejoras del personaje: src/skills.js) ----------
    skillLevel(id) { return st && st.skills ? (st.skills[id] || 0) : 0; },
    learnSkill(id, cost) {
      if (!st) return false;
      st.skills = st.skills || {};
      st.skills[id] = (st.skills[id] || 0) + 1;
      if (cost) st.suplementos = Math.max(0, (st.suplementos || 0) - cost);
      save();
      return true;
    },
    upgradeWhyNot(wid, u) {
      if (!st) return 'Sin carrera';
      if (this.upgraded(wid, u.id)) return 'Mejorada';
      if (u.req && !this.upgraded(wid, u.req)) return 'Antes: ' + G.Weapons.UPGRADES[wid].find((x) => x.id === u.req).name;
      if (!st.free && st.piezas < u.cost) return 'Te faltan piezas';
      return null;
    },
    // todas las mejoras de esas armas (el casillero de la policía en la estación): quedan para la carrera
    maxUpgrades(ids) {
      if (!st) return null;
      st.up = st.up || {};
      for (const id of ids) { const o = st.up[id] || (st.up[id] = {}); for (const u of G.Weapons.UPGRADES[id] || []) o[u.id] = true; }
      G.Weapons.applyUpgrades(st.up);
      save();
      return st.up;
    },
    upgrade(wid, uid, player) {
      const u = (G.Weapons.UPGRADES[wid] || []).find((x) => x.id === uid);
      if (!u) return { msg: 'No existe', fail: true };
      const no = this.upgradeWhyNot(wid, u);
      if (no) return { msg: no, fail: true };
      if (!st.free) st.piezas -= u.cost;
      (st.up[wid] || (st.up[wid] = {}))[uid] = true;
      G.Weapons.applyUpgrades(st.up);
      // con más capacidad, el cargador se llena gratis (como en el banco del vídeo de referencia)
      if (uid === 'capacidad') for (const h of player.hands.concat(player.stored)) if (h && h.id === wid) h.mag = G.Weapons.get(wid).mag;
      this.keep(player);
      return { msg: G.Weapons.get(wid).name + ': ' + u.name + ' mejorada' };
    },

    // ---------- Cofre de recompensas ----------
    get crate() { return st ? st.crate : []; },

    // ---------- Desafíos ----------
    CHALLENGES, LEVEL, ACHIEVEMENTS, PTS, PTS_NAME,
    // puntos de desafiante de un logro o desafío, y los que llevas ganados (cada uno cuenta la primera vez)
    ptsOf(x) { return PTS[x && x.lv] || PTS.facil; },
    dareEarned() {
      const A = achRecord(), C = chalRecord();
      let n = 0;
      for (const a of ACHIEVEMENTS) if (A[a.id]) n += PTS[a.lv] || PTS.facil;
      for (const c of CHALLENGES) if (C[c.id]) n += PTS[c.lv] || PTS.facil;
      return n;
    },
    dareTotal() { return ACHIEVEMENTS.concat(CHALLENGES).reduce((n, x) => n + (PTS[x.lv] || PTS.facil), 0); },
    achieved(id) { return !!achRecord()[id]; },
    // logro nuevo: lo devuelve (null si ya lo tenías)
    achieve(id) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      const rec = achRecord();
      if (!a || rec[id]) return null;
      rec[id] = Date.now();
      try { localStorage.setItem(AKEY, JSON.stringify(rec)); } catch (e) { /* nada */ }
      return a;
    },
    // el arma esperando sobre un mueble del refugio (o null) y cogerla
    get shelf() { return st ? st.shelf || null : null; },
    takeShelf(player) {
      const id = st && st.shelf;
      if (!id) return null;
      const w = G.Weapons.get(id);
      if (player.weapons.some((x) => x.id === id)) { st.shelf = null; this.keep(player); return 'Ya tienes ' + w.name.toLowerCase(); }
      const r = player.pickUp(id, w.mag, 1);
      if (!r || !r.ok) player.stored.push({ id, mag: w.mag, cond: 1 });
      st.shelf = null;
      this.keep(player);
      if (G.Audio) G.Audio.play('pickup');
      return 'Cogiste: ' + w.name;
    },
    chalDone(id) { return !!(st && st.chal && st.chal[id]); },
    chalTimes(id) { return chalRecord()[id] || 0; },
    // completar un desafío (en una carrera): una sola vez por carrera. Multiplica las recompensas de este
    // enfrentamiento; si es difícil, a veces deja un arma (una sola, y solo si no hay ya otra esperando)
    challenge(id, player) {
      const c = CHALLENGES.find((x) => x.id === id);
      if (!st || !c) return null;
      st.chal = st.chal || {}; st.gifts = st.gifts || [];
      if (st.chal[id]) return null;
      st.chal[id] = true;
      const rec = chalRecord(); rec[id] = (rec[id] || 0) + 1;
      try { localStorage.setItem(CKEY, JSON.stringify(rec)); } catch (e) { /* nada */ }
      const L = LEVEL[c.lv] || LEVEL.facil;
      st.encBonus = (st.encBonus || 0) + (L.mult - 1);
      (st.encChal || (st.encChal = [])).push(c.name);
      let gift = null;
      if (c.lv === 'dificil' && !st.shelf && !st.gifts.length && Math.random() < GIFT_P) {
        const have = new Set(player ? player.weapons.map((w) => w.id) : []);
        const pool = GIFTS.filter((g) => !have.has(g));
        if (pool.length) { gift = pool[Math.floor(Math.random() * pool.length)]; st.gifts.push(gift); }
      }
      save();
      return { gift, c, mult: L.mult, total: Math.round((1 + st.encBonus) * 100) / 100 };
    },

    // ---------- Final ----------
    get totals() { return st ? st.totals : null; },
    get last() { return st ? st.last : null; }
  };

  G.Run = Run;
})(window.Game = window.Game || {});
