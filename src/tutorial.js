(function (G) {
  'use strict';

  // Tutoriales (menú principal > Tutoriales). Dos partes:
  //  · Entrenamiento: lecciones jugables en el campo del modo libre, con Vera (tiene todo lo básico, Escuchar
  //    incluido). Cada paso pide una cosa (el objetivo arriba, con el botón de verdad: el del HUD brilla en el
  //    móvil; en PC y con mando, la tecla o el botón que tengas puesto) y se marca solo al hacerla. Las lecciones
  //    van seguidas: al terminar una empieza la siguiente. Siempre se puede saltar un paso (botón Saltar o Intro);
  //    si uno se atasca, a los 75 s se sigue solo. En el entrenamiento no se muere: si te tumban, te levantas.
  //  · Guías: para leer (los infectados, los Escorpiones y el modo Retorno), por páginas, desde el menú.
  // main.js pone el anfitrión (host: jugador, sacar y quitar enemigos, avisos) y llama a update cada fotograma.
  // Si algo falla dentro del tutorial, se apaga solo y sigues en el modo libre (nunca rompe la partida).

  const KEY = 'ceniza.tutos';             // lecciones completadas { id: 1 }
  const U = G.Util;

  // ================= Controles: cómo se dice cada cosa en cada aparato =================
  // btn: el botón del HUD táctil (se ilumina mientras el paso lo pide) · kb: la acción del teclado (su tecla) ·
  // pad: la acción del mando (su botón) · t*: texto fijo cuando no es un botón
  const K = {
    move: { n: 'Moverse', tTouch: 'Joystick', tKb: 'W A S D', tPad: 'Stick izquierdo' },
    look: { n: 'Mirar', tTouch: 'Desliza a la derecha', tKb: 'Ratón', tPad: 'Stick derecho' },
    run: { n: 'Correr', btn: 'btn-run', kb: 'run', pad: 'dodgeRun', padHold: true },
    crouch: { n: 'Agacharse', btn: 'btn-crouch', kb: 'crouch', pad: 'stance' },
    jump: { n: 'Saltar', btn: 'btn-jump', kb: 'jump', pad: 'jump' },
    dodge: { n: 'Esquivar', btn: 'btn-dodge', kb: 'dodge', pad: 'dodgeRun' },
    attack: { n: 'Atacar', btn: 'btn-attack', kb: 'attack', pad: 'melee' },
    aim: { n: 'Apuntar', btn: 'btn-aim', kb: 'aim', pad: 'aim' },
    fire: { n: 'Disparar', btn: 'btn-attack', kb: 'attack', pad: 'fire' },
    reload: { n: 'Recargar', btn: 'btn-reload', kb: 'reload', pad: 'fire', padNote: 'sin apuntar' },
    flash: { n: 'Linterna', btn: 'btn-flash', kb: 'flash', pad: 'flash' },
    listen: { n: 'Escuchar', btn: 'btn-listen', kb: 'listen', pad: 'cycle', hold: true },
    pack: { n: 'Mochila', btn: 'bag', kb: 'pack', pad: 'pack' },
    swap: { n: 'Cambiar de arma', btn: 'wpn', tTouch: 'Toca el arma', kb: 'quick', pad: 'cycle' },
    wmenu: { n: 'Menú de armas', btn: 'wpn', tTouch: 'Mantén el arma', kb: 'quick', kbNote: 'mantener', tPad: 'Cruceta' },
    venda: { n: 'Venda a la mano', btn: 'wpn', tTouch: 'Mantén el arma · arriba', kb: 'bandage', tPad: 'Cruceta ↑' },
    throwIt: { n: 'Lanzar', btn: 'btn-attack', kb: 'attack', pad: 'fire' },
    useHand: { n: 'Usar', btn: 'btn-attack', kb: 'attack', pad: 'fire', hold: true }
  };
  function dev() {
    if (G.Input && G.Input.padMode) return 'pad';
    return G.Input && G.Input.isTouch ? 'touch' : 'kb';
  }

  // ================= Las lecciones =================
  // Cada paso: t (lo que se pide), sub (una aclaración), keys (controles), enter(T) (al empezar: dar cosas,
  // sacar enemigos), check(T) (¿hecho?), ok (lo que se dice al hacerlo), info (solo leer: se sigue sola).
  // T: el contexto del paso (ver ctx): p (jugador), seen (lo que ha pasado en este paso), mine (sus enemigos)...
  const alive = (z) => !!(z && z.alive);
  const allDead = (T) => T.mine.length > 0 && T.mine.every((z) => !alive(z));
  const distTo = (T, z) => (z ? Math.hypot(z.pos.x - T.p.pos.x, z.pos.z - T.p.pos.z) : 99);
  const LESSONS = [
    { id: 'mover', name: 'Moverse', desc: 'Andar, mirar, correr, agacharte, saltar, esquivar y la linterna.', steps: [
      { t: 'Muévete por el campo', keys: ['move'], check: (T) => T.moved > 5, ok: 'Así se camina' },
      { t: 'Mira a tu alrededor', sub: 'La cámara va siempre detrás de ti', keys: ['look'], check: (T) => T.yaw > 2.2 },
      { t: 'Corre un poco', sub: 'Correr cansa y hace ruido: te oyen de lejos', keys: ['run', 'move'], check: (T) => T.runT > 1.3 },
      { t: 'Agáchate y camina agachada', sub: 'Haces menos ruido y te ven solo de cerca', keys: ['crouch', 'move'], check: (T) => T.crouchMoved > 2.5 },
      { t: 'Levántate y salta', sub: 'Saltando también trepas muros bajos y vallas', keys: ['jump'], check: (T) => T.seen.hop > 0 },
      { t: 'Esquiva', sub: 'Hacia donde te muevas; si no, hacia atrás', keys: ['dodge'], check: (T) => T.seen.dodge > 0, ok: 'Esquivar te salva de golpes y agarres' },
      { t: 'Enciende la linterna', sub: 'Ilumina, pero los Escorpiones la ven desde lejos', keys: ['flash'], check: () => !!(G.Flash && G.Flash.on) }
    ] },
    { id: 'golpes', name: 'Cuerpo a cuerpo', desc: 'Golpes encadenados, esquivar a tiempo, rematar y el ataque en carrera.', steps: [
      { t: 'Golpea tres veces seguidas', sub: 'Tocar Atacar durante un golpe encadena el siguiente', keys: ['attack'],
        enter: (T) => T.giveMelee(), check: (T) => T.seen.melee >= 3, ok: 'Un combo de tres' },
      { t: 'Viene un corredor: espera a que prepare el golpe y esquiva', sub: 'Se le ve venir: levanta los brazos', keys: ['dodge'],
        enter: (T) => T.spawn('runner', { d: 10, face: 'toward', idle: 0.4 }), check: (T) => T.seen.dodgeNear > 0 || allDead(T), ok: 'Bien esquivado' },
      { t: 'Golpéalo hasta que se tambalee y vuelve a atacar para rematarlo', sub: 'Un aturdido se remata con Atacar', keys: ['attack'],
        enter: (T) => { if (!T.mine.some(alive)) T.spawn('runner', { d: 6, face: 'toward', idle: 0.3 }); }, check: (T) => allDead(T) || T.seen.exec > 0,
        ok: (T) => (T.seen.exec ? '¡Remate!' : 'Uno menos') },
      { t: 'Ataque en carrera: corre hacia él y ataca', sub: 'Con impulso, el golpe pega mucho más', keys: ['run', 'attack'],
        enter: (T) => T.spawn('runner', { d: 13, face: 'away', idle: 6 }), check: (T) => T.seen.runatk > 0 || allDead(T), ok: 'Con todo el impulso' },
      { t: 'Acaba con lo que quede en pie', keys: ['attack', 'dodge'], check: (T) => !T.mine.some(alive) }
    ] },
    { id: 'tiros', name: 'Armas de fuego', desc: 'Apuntar, disparar, recargar, tiros a la cabeza y cambiar de arma.', steps: [
      { t: 'Apunta', sub: 'Mantén Apuntar', keys: ['aim'], enter: (T) => T.giveGun(), check: (T) => T.aimT > 0.6 },
      { t: 'Dispara apuntando', keys: ['aim', 'fire'], check: (T) => T.seen.shot > 0, ok: 'Ojo: un disparo se oye en todo el mapa' },
      { t: 'Recarga', sub: 'Mejor antes de que se te acaben las balas', keys: ['reload'], enter: (T) => T.emptyMag(), check: (T) => T.seen.reload > 0 },
      { t: 'Un corredor a lo lejos: dispárale a la cabeza', sub: 'A la cabeza cae de un tiro', keys: ['aim', 'fire'],
        enter: (T) => T.spawn('runner', { d: 15, face: 'away', idle: 4 }), check: (T) => allDead(T),
        ok: (T) => (T.crits > 0 ? '¡A la cabeza!' : 'Abatido (a la cabeza, de un tiro)') },
      { t: 'Cambia de arma', sub: 'Vera lleva también un revólver', keys: ['swap', 'wmenu'], check: (T) => T.seen.swap > 0 },
      { t: 'Escopetas, rifles, arcos...', sub: 'En el refugio de Retorno se compran y se mejoran. El arco no hace ruido: mantén Atacar para tensarlo', info: 7 }
    ] },
    { id: 'sigilo', name: 'Sigilo', desc: 'Pasar sin que te oigan, eliminar por la espalda, escuchar y distraer.', steps: [
      { t: 'Un chasqueador: no ve, pero oye muy bien', sub: 'Te oye caminar de pie y correr. Agáchate y acércate a su espalda', keys: ['crouch', 'move'],
        enter: (T) => { T.p.setStance && T.p.setStance('stand'); T.spawn('blind', { d: 11, face: 'away', idle: 30 }); },
        check: (T) => { const z = T.mine.find(alive); return !z || (distTo(T, z) < 2.6 && T.p.stance === 'crouch'); }, ok: 'Ni se enteró' },
      { t: 'Atácalo por la espalda', sub: 'Desprevenido y de espaldas: lo eliminas sin ruido', keys: ['attack'],
        check: (T) => T.seen.grab > 0 || !T.mine.some(alive), ok: (T) => (T.seen.grab ? 'En silencio' : 'Hecho') },
      { t: 'Mantén Escuchar', sub: 'Ves a los enemigos a través de las paredes (solo Vera y 13)', keys: ['listen'],
        enter: (T) => T.spawn('runner', { d: 16, a: Math.PI * 0.7, face: 'away', idle: 30 }), check: (T) => T.listenT > 1.2 },
      { t: 'Coge la botella y lánzala lejos de ti', sub: 'El ruido lo atrae hacia allí. Toca para lanzar; mantén para ver dónde cae', keys: ['throwIt'],
        enter: (T) => T.giveBottle(), check: (T) => T.seen.thr > 0, ok: 'Ahora ve hacia allí' },
      { t: 'Elimínalos como prefieras', sub: 'Por la espalda, agachada, es lo más limpio', keys: ['crouch', 'attack'], check: (T) => !T.mine.some(alive) }
    ] },
    { id: 'vivir', name: 'Supervivencia', desc: 'Curarte, la mochila, fabricar una molotov y usarla.', steps: [
      { t: 'Estás herida: véndate', sub: 'Pon la venda en la mano y mantén Atacar', keys: ['venda', 'useHand'],
        enter: (T) => T.hurt(), check: (T) => T.p.health >= T.healTo || T.seen.heal > 0, ok: 'La venda cura poco a poco' },
      { t: 'Abre la mochila', keys: ['pack'], check: () => !!(G.Backpack && G.Backpack.isOpen) },
      { t: 'Fabrica una molotov', sub: 'Alcohol y un trapo: los tienes en la mochila', keys: ['pack'],
        enter: (T) => T.giveMats(), check: (T) => (T.p.items.molotov || 0) > T.mol0, ok: 'Molotov lista' },
      { t: 'Cierra la mochila y lanza la molotov al grupo', sub: 'Ponla en la mano con el menú de armas', keys: ['wmenu', 'throwIt'],
        enter: (T) => { T.spawn('runner', { d: 14, face: 'away', idle: 6 }); T.spawn('runner', { d: 15, a: 0.15, face: 'away', idle: 6 }); },
        check: (T) => T.seen.molotov > 0 || allDead(T), ok: 'Que ardan' },
      { t: 'Acaba con los que queden', keys: ['attack', 'aim', 'fire'], check: (T) => !T.mine.some(alive) },
      { t: 'Lo que sueltan los infectados', sub: 'Munición, materiales y chocolatinas (curan un poco al cogerlas). Acércate y recógelos', info: 7 }
    ] }
  ];

  // ================= Guías (para leer, desde el menú) =================
  // Cada página: t (título), tag (una etiqueta corta), ic (iconos de armas que van bien), p (párrafos), tips (viñetas)
  const GUIDES = [
    { id: 'g_inf', name: 'Los infectados', desc: 'Qué es cada uno, cómo se mueve y cómo acabar con él.', pages: [
      { t: 'Corredor', tag: 'El más común', ic: ['pistola', 'bate'],
        p: ['Corre casi tan rápido como tú y te ve desde lejos. Cuando te descubre, se para un instante y chilla: el chillido despierta a los que están cerca y van a por ti.'],
        tips: ['Se le ve preparar el golpe: esquiva en ese momento y contraataca.', 'Un tiro a la cabeza lo tumba siempre.', 'A veces no pega: intenta agarrarte. Si te atrapa, toca Atacar rápido para soltarte.'] },
      { t: 'Chasqueador', tag: 'Ciego · lo oye todo', ic: ['revolver', 'molotov'],
        p: ['No ve nada, pero oye muy bien: te oye caminar de pie, correr y hasta correr agachada. Caminando agachada pasas a su lado sin que se entere.', 'Aguanta más que un corredor y su agarre es casi mortal.'],
        tips: ['Una botella o un ladrillo lo mandan hacia otro lado.', 'La placa de hongo de la cabeza aguanta un tiro de pistola: hacen falta dos.', 'Esquivarlo no lo aturde.'] },
      { t: 'Observador', tag: 'Espera su momento', ic: ['rifle', 'revolver'],
        p: ['Siempre sabe dónde estás, pero no ataca mientras queden otros enemigos: te mira desde lejos, escondido. Cuando ya no queda nadie más, viene a por ti.'],
        tips: ['Acaba con él antes de quedarte sola con él.', 'En la estación de policía se asoman a las puertas y desaparecen si los sigues.'] },
      { t: 'Temblante', tag: 'Enorme · aguanta muchísimo', ic: ['molotov', 'mina', 'rifle'],
        p: ['Grande y muy duro. Los golpes cuerpo a cuerpo casi no le hacen nada: solo el ataque en carrera con un arma grande lo aturde.', 'A veces se fija en dónde estás, grita y embiste hacia ese punto aunque te muevas. Al frenar o chocar suelta una nube de esporas.'],
        tips: ['Fuego y explosivos: es lo que mejor le va.', 'Con el rifle mejorado hacen falta 4 tiros a la cabeza.', 'No se le puede eliminar por la espalda: te levanta y te tira.', 'Cuando grite, apártate de su camino. Al morir revienta: aléjate.'] },
      { t: 'Blindado', tag: 'Coraza de hongo', ic: ['revolver', 'escopeta'],
        p: ['Del tamaño de un corredor, ennegrecido y rojizo. Te sigue escondido y te agarra cuando no lo miras. La coraza aguanta: a la cabeza hacen falta unos tres tiros de pistola y los golpes le quitan la mitad.'],
        tips: ['Aparece en la batalla final, cuando el jefe ya está tocado.', 'Gira la cámara a menudo: mirarlo lo frena.'] },
      { t: 'Hongomorfo', tag: 'Jefe final · el salón', ic: ['molotov', 'mina', 'rifle'],
        p: ['Más grande que un temblante y cubierto de placas de hongo. Si te alcanza con el zarpazo o la embestida, te mata. Se arranca trozos de hongo y te los lanza: revientan en una nube de esporas.', 'Atraviesa las paredes interiores embistiendo.'],
        tips: ['El fuego le quita mucho más que las balas.', 'No te quedes en su línea: esquiva el agarre en el último momento.'] }
    ] },
    { id: 'g_esc', name: 'Los Escorpiones', desc: 'La facción enemiga: quiénes son, cómo pelean y qué hacer con los que se rinden.', pages: [
      { t: 'Quiénes son', tag: 'Humanos armados',
        p: ['Una facción que vive de saquear y de tener presos a los demás. Solo te atacan si te ven; fuera de sus bases se organizan para saquear casas.', 'Pelean en grupo, se cubren y se avisan entre ellos.'],
        tips: ['La linterna encendida se ve desde lejos: en la oscuridad, apágala si no quieres que te descubran.', 'Si el haz les da en la cara, te notan casi al instante.'] },
      { t: 'El escuadrón', tag: 'Cada uno a lo suyo', ic: ['subfusil', 'rifle', 'escopeta'],
        p: ['Líder (subfusil y chaleco) · Tirador (rifle, de lejos) · Pistolero · Arquera · Escopetero (peligroso de cerca) · Bruto (hacha, cuerpo a cuerpo) · Sigilosa (cuchillo, se acerca sin que la veas).', 'Los exploradores y los carroñeros son los más débiles; el saqueador es un cobarde.'],
        tips: ['Al tirador, cúbrete y acércate por los lados.', 'Al bruto, mantenlo lejos: pega muy fuerte.'] },
      { t: 'Sigilo', tag: 'Que no te vean', ic: ['cuchillo_caza', 'pistola'],
        p: ['El ojo de encima de la mira se llena mientras alguien te está reconociendo; en rojo, te vieron. La flecha apunta hacia quien.', 'El primero que te ve grita y tarda un segundo en avisar a los demás: si lo callas o te escondes a tiempo, el resto no sabe dónde estás. Un cuerpo que nadie vio caer se queda ahí hasta que alguien pase cerca y lo encuentre.'],
        tips: ['Agachada te ven de mucho más cerca, y en la hierba alta todavía más.', 'Agachada detrás de unos sacos o una barricada, sin apuntar, no te dan: al apuntar, asomas la cabeza.', 'Los disparos sin silenciador los oyen todos.'] },
      { t: 'Los que se rinden', tag: 'Tú decides',
        p: ['Muy tocado, a veces uno se rinde y se pone de rodillas. Puedes dejarlo ir, tomarlo de rehén o acabar con él.', 'El líder y el bruto no se rinden nunca.'],
        tips: ['Con un rehén puedes seguir disparando a los demás con un arma corta.'] },
      { t: 'Las cajas fuertes', tag: 'Saqueo',
        p: ['En el saqueo, los Escorpiones protegen una caja fuerte. Se abre girando la rueda o encajando los pernos en el momento justo.'],
        tips: ['Fallar hace ruido: si hay alguno cerca, te oirá.', 'Abrirla sin que te descubran tiene premio.'] },
      { t: 'El Aguijón', tag: 'Jefe final · el faro', ic: ['rifle', 'revolver', 'molotov'],
        p: ['El líder de los Escorpiones, atrincherado en el Faro de Oceanside. La linterna del faro barre la meseta, y a lo que el haz ilumina le dispara el tirador del balcón: te apunta con un láser rojo algo más de un segundo antes de tirar.', 'Cuando cae su guardia, el Aguijón sale de la torre con su escolta. Lleva casco y chaleco: nada lo mata de un tiro, no se le aturde ni se le remata. Dos veces pide refuerzos, que suben por el camino.'],
        tips: ['Al tirador no se le puede disparar. Rompe la línea con una pared, o corre de lado cuando el láser se queda fijo.', 'Pegado al pie de la torre no te ve; agachado en la hierba alta, el haz no te descubre.', 'El generador está detrás de la caseta de la sirena: cortarle el cable apaga el faro, y el tirador baja.', 'Rifle y revólver a la cabeza es lo que más le quita.'] }
    ] },
    { id: 'g_ret', name: 'Modo Retorno', desc: 'Cómo funciona una carrera: el refugio, el mapa, el comercio, las mejoras y los desafíos.', pages: [
      { t: 'La carrera', tag: 'Siete tramos y el jefe',
        p: ['Desde el refugio eliges cada tramo en el mapa. Hay dos líneas: al elegir la primera ya no puedes pasarte a la otra, pero cada una tiene dos desvíos de dos tramos.', 'Empiezas con lo de tu personaje; lo demás se consigue por el camino.'],
        tips: ['La muerte es definitiva.', 'Se guarda en el refugio: si sales en medio de un enfrentamiento, la carrera se pierde.', 'El jefe final cambia de una carrera a otra: el hongomorfo en el salón recreativo o el Aguijón en el faro. El mapa lo dice desde el principio.'] },
      { t: 'Los enfrentamientos', tag: 'Cada uno distinto',
        p: ['Asalto: tres oleadas, con un cofre de suministros al despejar cada una. Caza: aguanta hasta que se acabe el tiempo. Saqueo: abre la caja fuerte de los Escorpiones. Resistencia: protege a un compañero. Liberación: saca a los tuyos de la Red del Capitolio.'],
        tips: ['En la caza no hace falta acabar con todos: aguanta.'] },
      { t: 'El refugio', tag: 'Entre enfrentamientos', ic: ['botiquin', 'molotov', 'mina'],
        p: ['En el comercio compras armas, vendas, molotovs, minas y balas con monedas. Solo hay cuatro cosas a la vez; los dados vuelven a sortearlas.', 'En el banco de mejoras usas las piezas para mejorar las armas: las mejoras duran toda la carrera.'],
        tips: ['En el refugio se puede apuntar, pero no disparar ni golpear.'] },
      { t: 'Desafíos y logros', tag: 'Puntos de desafiante',
        p: ['Los desafíos multiplican las recompensas del enfrentamiento en el que los completas. Los difíciles, a veces, dejan un arma en el refugio.', 'La primera vez que consigues un desafío o un logro te da puntos de desafiante, que se gastan en Extras.'] },
      { t: 'Modificadores y paradas', tag: 'Elegir el camino',
        p: ['En el mapa, cada enfrentamiento muestra lo que paga: monedas, piezas y suplementos. Los que llevan un rombo rojo traen un modificador (niebla, noche, horda, munición escasa...): son más difíciles y pagan más. Los desvíos lo traen casi siempre.', 'Algunos tramos son paradas sin pelea: un descanso, un comerciante de paso o un suceso en el que hay que decidir. No dan la recompensa de siempre; lo que saques depende de lo que elijas.'],
        tips: ['Con poca vida, un descanso vale más que cualquier cofre.', 'En los sucesos, la opción segura da poco; la otra, a veces mucho y a veces un susto.', 'El comerciante solo hace un trato.'] },
      { t: 'Los descansos', tag: 'Paradas que se juegan', ic: ['botiquin'],
        p: ['Cada línea del camino tiene tres descansos: sitios tranquilos, sin enemigos (una granja, un camping, una gasolinera, una ermita, un apeadero... y, a veces, el refugio de los otros). Cada uno esconde varias cosas: una casa atrancada, una puerta cerrada con llave, un candado de combinación, algo colgado muy alto, un generador sin arrancar, una radio que sintonizar, una caja de fusibles. Algunas van encadenadas: la radio sin corriente, el cuarto que se abre con lo que dice la radio. Nada obliga a resolverlo todo.', 'Junto al fuego puedes sentarte a descansar (cura, una vez). Te vas por donde llegaste, con «Seguir el camino».'],
        tips: ['Lo que buscas lleva el contorno amarillo cuando estás cerca (y, si hay que averiguarlo, cuando ya lo sabes). Las puertas cerradas también.', 'Lee las notas: dicen dónde está lo escondido. Se quedan en la mochila, en la pestaña Notas.', 'El generador se arranca tirando de la cuerda cuando la marca pasa por la franja: tres tirones buenos.', 'La radio: gira el dial con el joystick hasta que la estática baje y se entienda algo, y toca Fijar. Hay varias emisoras: una nota dice cuál importa.', 'La caja de fusibles: el fusible gordo que falta está por ahí, y cada cable va a su borne. Si te equivocas, salta un chispazo y ves cuántos pilotos se encienden; mejor busca el esquema.', 'Lo que encuentras sale en un cartel, como las recompensas del cofre, y te lo llevas al momento. La parada cuenta como un tramo del camino.'] },
      { t: 'La bitácora del faro', tag: 'Un secreto en el camino',
        p: ['En cada descanso, junto al fuego, hay una hoja doblada debajo de una piedra: una página de la bitácora del farero de Oceanside. Cada vez, la siguiente que te falta. Se guardan en la mochila (Notas), en orden.', 'Si juntas tres hojas en una misma carrera, al seguir el camino del tercer descanso puedes desviarte al faro, al alba, cuando no hay nadie. Esa parada no sale en el mapa ni cuenta como tramo. Allí está la última hoja.'],
        tips: ['Las hojas se quedan aunque pierdas la carrera: la historia se va completando carrera a carrera.', 'Si vas con la Trece o con Grimes, uno de los descansos puede ser el refugio de antes del grupo de Di\' Arco. Si vas con cualquier otro, el escondite de la costa.'] },
      { t: 'El rango del personaje', tag: 'Entre carreras',
        p: ['Cada carrera, la ganes o la pierdas, da experiencia al personaje con el que la empezaste: más cuanto más lejos llegues. Al subir de rango, ese personaje empieza las siguientes con algo más: una venda, monedas, suplementos, munición, piezas.'],
        tips: ['El rango se ve al elegir personaje.', 'En Fácil y en Normal se gana algo menos de experiencia.', 'En la partida diaria las ventajas del rango no cuentan: es igual para todos.'] },
      { t: 'Dificultad y partida diaria', tag: 'A tu medida',
        p: ['La dificultad se elige después del personaje: en Fácil y en Normal los enemigos aguantan menos. Difícil es el juego tal como es.', 'Las tres cuentan igual para los logros y los desafíos. Las marcas de la clasificación van aparte, por dificultad, y al terminar cada carrera sale su resumen: el camino que hiciste, tus números y las marcas que batiste.', 'La partida diaria es una carrera más larga y más dura, una vez al día, con un personaje que elige el juego.'] }
    ] },
    { id: 'g_sv', name: 'Modo supervivencia', desc: 'En beta: Eira sola en Oceanside, los pasos entre zonas, la garita, el coche, los descansos, la comida y el agua.', pages: [
      { t: 'La Trece, sola', tag: 'Beta · un mundo conectado', ic: ['pistola', 'arco'],
        p: ['Juegas con Eira, la Trece: los Escorpiones acabaron con su gente y ahora sobrevive sola. Empieza en su escondite, en la costa, con la pistola, el arco y casi nada más.', 'Las zonas están conectadas: desde el escondite, la vía lleva al asentamiento de Oceanside, la playa a la casa del pescador y el bosque a la garita del depósito; desde el asentamiento, el portón del este lleva al faro. Las salidas las marca ella misma: un trapo rojo atado a un palo.'],
        tips: ['Lo que encuentras en cada zona se queda donde lo dejaste.', 'Al principio no puedes escuchar: lo aprendes con la libreta de rastreo.'] },
      { t: 'Los pasos', tag: 'La reja y la manivela', ic: ['navaja'],
        p: ['Entre dos zonas hay un paso que tiene que ver con el sitio: el túnel del tren viejo, un sendero entre las rocas, el camino del acantilado o el túnel del subte. En medio, una reja (o un portón de troncos). Para subirla, mantén Recoger en la manivela (si la sueltas, vuelve a bajar). Pasa rápido: cae otra vez detrás de ti. Al otro lado hay otra manivela para volver.'],
        tips: ['Mientras cruzas la galería a oscuras, se prepara la zona de al lado.'] },
      { t: 'Los descansos', tag: 'Donde se guarda', ic: ['botiquin'],
        p: ['El saco del escondite y un fuego en cada zona. Al descansar se guarda la partida y te curas del todo si comes algo (sin comida, solo un poco). Después eliges la hora a la que sales: de día hay menos infectados y se encuentra más comida y agua; de noche hay muchos más, pero aparecen más suplementos.', 'Al levantarte, los infectados de la zona vuelven a estar. Si caes, despiertas en el último descanso con lo que llevabas entonces.'],
        tips: ['En el descanso también se cocina: pescado asado, agua hervida y vendas hervidas.', 'Tu escondite es seguro: ahí no entran infectados, ni de día ni de noche.'] },
      { t: 'Viajar', tag: 'Cuesta comida y agua', ic: ['mun_9mm'],
        p: ['Desde un descanso puedes viajar a cualquier otro fuego que ya hayas encendido. Cuesta una comida y una agua (sin ellas, llegas agotada) y una de cada cuatro veces se te cae una venda por el camino.', 'Según la hora, te pueden salir al paso en el camino de la costa: dos oleadas. De día lo ves venir y puedes dar un rodeo (más camino: una comida más); a última hora, para rodear, sueltas parte de la carga. De noche, a veces no lo ves venir.'],
        tips: ['El riesgo de cada hora se ve al elegirla: bajo, medio o alto.'] },
      { t: 'Piezas y habilidades', tag: 'Sin niveles', ic: ['rifle'],
        p: ['Las armas se mejoran con piezas que se encuentran (una mira para el rifle, un muelle para la pistola...): se montan en la mesa de trabajo del escondite, llevando el arma encima.', 'Las habilidades van en tres ramas (sigilo, puntería y aguante). Cada rama se abre con su manual y sus niveles se aprenden en un descanso con suplementos.'],
        tips: ['En el modo libre, la mesa «Modo supervivencia · prueba» te deja empezar con lo que quieras y forzar las emboscadas.'] },
      { t: 'La garita', tag: 'Cinco caminos', ic: ['navaja'],
        p: ['El depósito municipal, treinta años después, entre los mismos edificios de aquella noche (ahora con la hierba encima): la Trece duerme en la garita del vigilante cuando pasa por aquí. Es un descanso pobre: sin mapa, de aquí no se viaja (se sale a pie o en el coche).', 'Se llega desde el escondite por el camino del bosque, que sale por el hueco de la valla del este: la niebla se va espesando hasta el taller de la persiana. Mantén Recoger en la manivela y, mientras sube, la garita aparece al otro lado. Para volver, la misma persiana tiene su manivela por dentro.', 'Salen cinco caminos. El de la ciudad, por la reja que alguien reventó hace mucho: ahí está su coche. Los otros cuatro, de momento, están cortados.'],
        tips: ['En el coche, la carretera vieja lleva hasta la avenida de entrada; al final frena solo.'] },
      { t: 'La ciudad', tag: 'La persiana o el subte', ic: ['revolver'],
        p: ['La avenida de entrada está cerrada por un muro de coches. Al centro se pasa por el taller del oeste (mantén Recoger en la manivela de la persiana hasta que suba del todo: la Trece pasa sola) o bajando al subte. Allí las manzanas son edificios cerrados; se entra en tres kioscos y en tres pisos de arriba.', 'Los pisos tienen la planta baja atrancada: busca la escalera de mano (está en el solar), llévala al hombro hasta un piso y apóyala bajo la ventana abierta. Desde dentro puedes quitar la tranca de la puerta: la próxima vez, entras sin escalera.'],
        tips: ['Con la escalera al hombro no puedes correr ni usar armas.', 'El fuego para descansar está en la plaza, junto a la boca del subte.'] },
      { t: 'Las notas', tag: 'Papeles sueltos', ic: ['navaja'],
        p: ['Por todas partes hay papeles tirados: en el escondite, en los pasos, en la garita, en la avenida y en los locales de la ciudad. De cerca se ven con el borde amarillo; se cogen con Recoger y se leen en el momento.', 'Lo que coges se guarda en la mochila (pestaña Notas) y, en cualquier descanso, en «Leer las notas». Son cosas pequeñas de la gente que estuvo antes: no explican todo, pero se responden unas a otras.'],
        tips: ['En la ciudad, la farmacia, la comisaría, la lavandería, las oficinas y los ultramarinos se abren por delante: dentro hay cosas (y alguna nota).'] }
    ] }
  ];

  // ================= Progreso guardado =================
  function rec() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function mark(id) { const r = rec(); r[id] = 1; try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) { /* nada */ } }
  const isDone = (id) => !!rec()[id];
  const allDone = () => LESSONS.every((l) => isDone(l.id));

  // ================= El panel (arriba, en el centro) =================
  let box = null;
  function ui() {
    if (box) return box;
    box = document.createElement('div');
    box.id = 'tuto';
    box.className = 'hidden';
    box.innerHTML = '<div class="tu-top"><b class="tu-les"></b><span class="tu-n"></span></div><div class="tu-txt"></div><div class="tu-sub"></div>' +
      '<div class="tu-keys"></div><div class="tu-bar"><i></i></div><button type="button" class="tu-skip">Saltar</button>';
    document.body.appendChild(box);
    const sk = box.querySelector('.tu-skip');
    sk.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); skip(); });
    sk.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    // PC: Intro salta el paso (en la partida, Intro no hace nada más)
    window.addEventListener('keydown', (e) => {
      if (!run || e.code !== 'Enter' || e.repeat) return;
      if (!host || !host.playing()) return;
      e.preventDefault(); skip();
    });
    return box;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // un control, en el aparato que estés usando
  function chip(k, d) {
    const c = K[k];
    if (!c) return '';
    let ic = '', lab = '';
    if (d === 'touch') {
      const b = c.btn && document.getElementById(c.btn), sv = b && b.querySelector('svg');
      if (sv && !c.tTouch) ic = '<i class="tu-ic">' + sv.outerHTML + '</i>';
      lab = c.tTouch || c.n;
    } else if (d === 'pad') {
      const v = c.pad ? G.Controls.label('pad', G.Controls.padBtn(c.pad)) : c.tPad;
      ic = '<i class="tu-kk">' + esc(v || '—') + '</i>';
      lab = c.n + (c.padHold ? ' (mantener)' : '') + (c.padNote ? ' (' + c.padNote + ')' : '');
    } else {
      const v = c.kb ? G.Controls.label('kb', G.Controls.key(c.kb)) : c.tKb;
      ic = '<i class="tu-kk">' + esc(v || '—') + '</i>';
      lab = c.n + (c.kbNote ? ' (' + c.kbNote + ')' : '');
    }
    if (c.hold) lab += ' (mantener)';
    return '<span class="tu-k">' + ic + '<span>' + esc(lab) + '</span></span>';
  }
  // los botones del HUD que pide el paso: brillan (solo en táctil)
  let glowing = [];
  function glow(keys) {
    for (const e of glowing) e.classList.remove('tu-glow');
    glowing = [];
    if (dev() !== 'touch' || !keys) return;
    for (const k of keys) {
      const c = K[k], e = c && c.btn && document.getElementById(c.btn);
      if (e && glowing.indexOf(e) < 0) { e.classList.add('tu-glow'); glowing.push(e); }
    }
  }
  function show(step) {
    const b = ui(), L = LESSONS[run.li];
    b.classList.remove('hidden', 'ok', 'fin', 'info');
    b.querySelector('.tu-les').textContent = 'Entrenamiento · ' + L.name;
    b.querySelector('.tu-n').textContent = (run.si + 1) + ' / ' + L.steps.length;
    b.querySelector('.tu-txt').textContent = step.t;
    b.querySelector('.tu-sub').textContent = step.sub || '';
    b.classList.toggle('info', !!step.info);
    run.dev = dev();
    b.querySelector('.tu-keys').innerHTML = (step.keys || []).map((k) => chip(k, run.dev)).join('');
    skipLabel(step.info ? 'Seguir' : 'Saltar');
    const bar = b.querySelector('.tu-bar i'), pct = run.si / L.steps.length * 100;
    bar.style.transition = pct < (run.pct || 0) ? 'none' : '';             // (lección nueva: vacía de golpe)
    bar.style.width = pct.toFixed(1) + '%';
    run.pct = pct;
    glow(step.keys);
  }
  function showOk(text) {
    const b = ui(), L = LESSONS[run.li];
    b.classList.add('ok');
    if (text !== '') b.querySelector('.tu-sub').textContent = text || '¡Bien!';      // ('' : el texto se queda)
    run.pct = (run.si + 1) / L.steps.length * 100;
    b.querySelector('.tu-bar i').style.width = run.pct.toFixed(1) + '%';
    glow(null);
  }
  function hide() { if (box) box.classList.add('hidden'); glow(null); }
  // el botón de saltar (en PC, con la tecla al lado)
  function skipLabel(t) { const b = ui().querySelector('.tu-skip'); b.innerHTML = esc(t) + (dev() === 'kb' ? ' <small>Intro</small>' : ''); }

  // ================= El director =================
  let host = null, run = null;
  function ctx() {
    const p = host.player;
    return {
      p, mine: [], seen: { hop: 0, dodge: 0, dodgeNear: 0, melee: 0, exec: 0, runatk: 0, grab: 0, thr: 0, molotov: 0, shot: 0, reload: 0, heal: 0, swap: 0 },
      t: 0, moved: 0, yaw: 0, runT: 0, crouchMoved: 0, aimT: 0, listenT: 0, crits: 0, kills: 0, mol0: 0, healTo: 0,
      spawn(kind, o) { const z = host.spawn(kind, o || {}); if (z) { z.tuto = true; this.mine.push(z); run.all.push(z); } return z; },
      giveMelee() {
        if (!p.hands[0] && p.spotFor && p.spotFor('bate')) p.pickUp('bate', 1);
        p.equip(-1);
      },
      giveGun() {
        let i = p.hands.findIndex((s) => s && s.id === 'pistola');
        if (i < 0) { const r = p.pickUp('pistola', 15, 1); i = p.hands.findIndex((s) => s && s.id === 'pistola'); if (!r || !r.ok) i = -1; }
        p.ammo['9mm'] = Math.max(p.ammo['9mm'] || 0, 30);
        if (i > 0) p.equip(i);
      },
      emptyMag() { const s = p.slot; if (s && s.mag > 3) s.mag = 3; },
      giveBottle() {
        if (!p.throwable) p.throwable = 'botella';
        p.equip(-2);
        this.spawn('runner', { d: 14, face: 'away', idle: 30 });
      },
      hurt() {
        p.health = Math.min(p.health, 55);
        p.items.venda = Math.max(p.items.venda || 0, 1);
        this.healTo = Math.min(100, p.health + 15);
      },
      giveMats() {
        p.items.alcohol = Math.max(p.items.alcohol || 0, 2); p.items.trapo = Math.max(p.items.trapo || 0, 2);
        if ((p.items.molotov || 0) >= ((G.Player && G.Player.MOLOTOV_CAP) || 3)) p.items.molotov = 1;
        if (p.stockMax) { p.stockMax.imolotov = p.items.molotov; p.stockMax.ialcohol = p.items.alcohol; p.stockMax.itrapo = p.items.trapo; }
        this.mol0 = p.items.molotov || 0;
      }
    };
  }
  // lo que pasa cada fotograma (para los pasos): qué hace el jugador
  function observe(T, dt) {
    const p = T.p, o = run.o;
    const dx = p.pos.x - o.x, dz = p.pos.z - o.z, step = Math.hypot(dx, dz);
    if (step < 3) { T.moved += step; if (p.stance === 'crouch') T.crouchMoved += step; }
    o.x = p.pos.x; o.z = p.pos.z;
    const yaw = G.Camera ? G.Camera.yaw : 0;
    if (o.yaw != null) T.yaw += Math.abs(U.angleDiff(yaw, o.yaw));
    o.yaw = yaw;
    if (p.running && (p.speedNow || 0) > 2) T.runT += dt;
    if (p.aiming) T.aimT += dt;
    if (p.listening) T.listenT += dt;
    // acciones nuevas (cada golpe, remate, agarre, lanzamiento... es un objeto nuevo)
    const a = p.action;
    if (a && a !== o.act) {
      if (a.combo != null && a.weapon) T.seen.melee++;
      if (a.exec) T.seen.exec++;
      if (a.kind === 'grab') T.seen.grab++;
      if (a.kind === 'runatk' || a.kind === 'runshove' || a.kind === 'runKill' || a.kind === 'execRun') T.seen.runatk++;
      if (a.kind === 'throw') { T.seen.thr++; if (a.item === 'molotov') T.seen.molotov++; }
      if (a.kind === 'bandage') T.seen.heal++;
    }
    o.act = a;
    if (p.healing && !o.heal) T.seen.heal++;
    o.heal = !!p.healing;
    if (p.hop && !o.hop) T.seen.hop++;
    if (p.climb && !o.climb) T.seen.hop++;
    o.hop = !!p.hop; o.climb = !!p.climb;
    if (p.dodging && p.dodging !== o.dodge) {
      T.seen.dodge++;
      for (const z of T.mine) if (alive(z) && distTo(T, z) < 4.5) { T.seen.dodgeNear++; break; }
    }
    o.dodge = p.dodging;
    // disparos: el cargador del arma en la mano baja; recarga: empieza una
    const s = p.slot;
    if (s && s === o.slot && s.mag != null && o.mag != null && s.mag < o.mag) T.seen.shot++;
    o.slot = s; o.mag = s ? s.mag : null;
    if (o.cur != null && p.cur !== o.cur) T.seen.swap++;           // (cualquier cambio de lo que llevas en la mano)
    o.cur = p.cur;
    if (p.gun && p.gun.reload && !o.rl) T.seen.reload++;
    o.rl = !!(p.gun && p.gun.reload);
    // te agarraron: cómo soltarse (una vez por lección)
    if (p.struggle && !o.strug && !run.strugTold) {
      run.strugTold = true;
      if (host.toast) host.toast(dev() === 'touch' ? '¡Te agarró! Toca Atacar muy rápido para soltarte' : '¡Te agarró! Pulsa Atacar muy rápido para soltarte', 'warn');
    }
    o.strug = !!p.struggle;
  }
  function startStep() {
    const L = LESSONS[run.li], step = L.steps[run.si];
    const T = ctx();
    run.T = T; run.step = step; run.pause = 0; run.stuck = 0;
    const p = T.p;
    // los enemigos del paso anterior que siguen vivos pasan a este (los pasos de una misma pelea)
    T.mine = run.all.filter(alive);
    if (step.enter) step.enter(T);
    // (cómo está todo al empezar: lo que cambie a partir de aquí es lo que hizo el jugador)
    run.o = { x: p.pos.x, z: p.pos.z, yaw: null, act: p.action, dodge: p.dodging, slot: p.slot, mag: p.slot ? p.slot.mag : null, cur: p.cur, rl: !!(p.gun && p.gun.reload), hop: !!p.hop, climb: !!p.climb, heal: !!p.healing };
    show(step);
  }
  function stepDone(text) {
    const T = run.T;
    const t = typeof text === 'function' ? text(T) : text;
    showOk(t);
    if (G.Audio && G.Audio.ui) G.Audio.ui('uiOk');
    run.pause = run.step.info ? 0.2 : 1.6;
    run.next = true;
  }
  function next() {
    const L = LESSONS[run.li];
    run.si++;
    if (run.si < L.steps.length) { startStep(); return; }
    // lección terminada
    mark(L.id);
    host.clear(run.all); run.all = [];
    const last = run.li >= LESSONS.length - 1;
    const b = ui();
    b.classList.remove('ok', 'info'); b.classList.add('fin');
    b.querySelector('.tu-n').textContent = '';
    b.querySelector('.tu-txt').textContent = 'Lección completada: ' + L.name;
    b.querySelector('.tu-sub').textContent = last ? 'Terminaste el entrenamiento. Sigue practicando aquí (con «+ Infectado») o sal desde la pausa.'
      : 'Sigue: ' + LESSONS[run.li + 1].name;
    b.querySelector('.tu-keys').innerHTML = '';
    b.querySelector('.tu-bar i').style.width = '100%'; run.pct = 100;
    skipLabel(last ? 'Cerrar' : 'Seguir');
    glow(null);
    if (G.Audio && G.Audio.play) G.Audio.play('pickup');
    if (allDone() && G.Mode && G.Mode.achieve) G.Mode.achieve('entrenada');
    run.fin = last ? 'end' : 'next';
    run.pause = last ? 9 : 4.5;
  }
  function afterFin() {
    if (run.fin === 'end') { stop(); return; }
    run.fin = null; run.li++; run.si = 0; run.strugTold = false;
    startStep();
  }
  function skip() {
    if (!run) return;
    if (run.fin) { afterFin(); return; }
    if (run.next) { run.pause = 0; return; }
    if (G.Audio && G.Audio.ui) G.Audio.ui('ui');
    stepDone(run.step.info ? '' : 'Paso saltado');
    run.pause = 0.5;
  }
  function tick(dt) {
    const T = run.T;
    if (run.fin) {
      run.pause -= dt;
      if (run.pause <= 0) afterFin();
      return;
    }
    if (run.next) {
      run.pause -= dt;
      if (run.pause <= 0) { run.next = false; next(); }
      return;
    }
    T.t += dt;
    observe(T, dt);
    // con la mochila abierta (ocupa la derecha), el panel se va a la izquierda
    if (box) box.classList.toggle('side', !!(G.Backpack && G.Backpack.isOpen));
    // el aparato cambió (tocaste la pantalla, cogiste el mando): los controles se vuelven a escribir
    if (dev() !== run.dev) show(run.step);
    const st = run.step;
    if (st.info) { if (T.t >= st.info) stepDone(''); return; }
    if (st.check && st.check(T)) { stepDone(st.ok || '¡Bien!'); return; }
    // atascado: a los 75 s se sigue solo (con el mando no hay botón para saltar)
    if (T.t > 75) stepDone('Seguimos');
  }

  // ================= Arranque y fin =================
  // h: { player, spawn(kind, o) → zombi, clear(list), toast(t, k), playing() }
  function begin(lessonId, h) {
    host = h;
    stop(true);
    const li = Math.max(0, LESSONS.findIndex((l) => l.id === lessonId));
    run = { li, si: 0, all: [], fin: null, next: false, pause: 0 };
    host.player.tutoSafe = true;
    document.body.classList.add('tuto');
    // los golpes y disparos que matan (para saber si fue a la cabeza)
    if (G.Combat && !G.Combat._tuHit) {
      const orig = G.Combat.onHit;
      G.Combat._tuHit = orig || (() => {});
      G.Combat.onHit = function (res, crit) {
        if (run && run.T && res === 'kill') { run.T.kills++; if (crit) run.T.crits++; }
        return G.Combat._tuHit.apply(this, arguments);
      };
    }
    startStep();
  }
  function stop(quiet) {
    if (G.Combat && G.Combat._tuHit) { G.Combat.onHit = G.Combat._tuHit; G.Combat._tuHit = null; }
    if (host && host.player) host.player.tutoSafe = false;
    document.body.classList.remove('tuto');
    hide();
    run = null;             // (los enemigos que queden, se quedan: sigues en el modo libre)
  }
  function update(dt) {
    if (!run) return;
    try { tick(dt); } catch (e) {
      console.error('Tutorial:', e);
      if (host && host.toast) host.toast('El entrenamiento tuvo un problema: sigues en el modo libre', 'warn');
      stop();
    }
  }
  // te tumbaron (en el entrenamiento no se muere): te levantas y lo dice
  let savedT = 0;
  function saved() {
    const now = performance.now();
    if (now - savedT < 6000) return;
    savedT = now;
    if (host && host.toast) host.toast('En el entrenamiento no mueres: levántate y sigue', 'warn');
  }

  G.Tutorial = {
    LESSONS, GUIDES, isDone, allDone, begin, stop, update, saved, skip,
    get active() { return !!run; },
    // (para las pruebas: en qué lección y paso va)
    get _state() { return run ? { li: run.li, si: run.si, fin: run.fin, next: run.next, mine: run.T ? run.T.mine : [] } : null; }
  };
})(window.Game = window.Game || {});
