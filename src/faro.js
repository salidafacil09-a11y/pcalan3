(function (G) {
  'use strict';

  // El jefe del faro (el otro jefe final de Retorno): el Aguijón, el líder de los Escorpiones, atrincherado en la torre
  // del Faro de Oceanside al caer la tarde (mapa faro_jefe). Es una pelea de cobertura, contra gente:
  //
  //  · La linterna del faro, inclinada hacia la meseta, la barre de lado a lado. Lo que el haz ilumina, el tirador del
  //    balcón lo ve: te apunta (un láser rojo, algo más de un segundo) y dispara. Se le esquiva rompiendo la línea de
  //    visión (una pared, un coche pegado), corriendo de lado en el último instante o rodando. Pegado al pie de la
  //    torre no te ve, y agachado en la hierba alta el haz no te descubre. Al tirador no se le puede disparar: está
  //    a veinte metros.
  //  · El generador de la linterna está detrás de la caseta de la sirena (a cubierto de la torre). Cortarle el cable
  //    (el minijuego de la cizalla) apaga el faro para el resto de la pelea; el tirador, a ciegas, baja y sale por la
  //    puerta como uno más.
  //  · La guardia: un grupo en el corte del camino y otro en la plazoleta. Cuando quedan pocos (o te plantas en la
  //    puerta), el Aguijón sale de la torre con su escolta. Lleva casco y chaleco: nada lo mata de un tiro (ver
  //    Human.takeHit, boss), no se le aturde ni se le remata. Con dos tercios y con un tercio de la vida pide
  //    refuerzos, que entran por la verja y suben por el camino.
  //  · Cae el Aguijón y los que quedan huyen: jefe derrotado (G.Mode.faroWin).
  //
  // Lo llama main.js (begin al empezar el enfrentamiento, update cada fotograma) y lo para G.Mode.stop

  const U = G.Util;
  const el = (id) => document.getElementById(id);
  const RANGE = 46, BLIND = 6.2;            // hasta dónde llega el haz (m) y el hueco al pie de la torre, donde no te ve
  const BEAM_W = 0.42, BEAM_HALF = 0.115;   // la linterna: rad/s (dos haces: pasa uno cada 7,5 s) y medio ancho del haz (rad)
  const TILT = 0.4;                         // lo que se inclinan los haces hacia el suelo (rad)
  const AIM_T = 1.25, LOCK_T = 0.18;        // lo que tarda en disparar desde que te apunta, y cuánto antes fija el tiro
  const COOL = 3.2, TRACK_T = 5;            // entre tiro y tiro; y cuánto te sigue (a la vista) después de que el haz te encuentre
  const SN_DMG = 32, HIT_R = 0.85;          // lo que quita un tiro del balcón y a qué distancia de la línea te da
  const LEADER_HP = 3;                      // el Aguijón: tres veces lo que aguanta un líder (para golpes y explosiones)
  const GUARD_A = ['pistolero', 'explorador', 'carronero'], GUARD_B = ['escopetero', 'pistolero', 'bruto', 'arquero'];
  const ESCORT = ['lider', 'bruto', 'pistolero'];
  const WAVES = [['explorador', 'carronero', 'pistolero'], ['escopetero', 'arquero', 'explorador']];
  const MAX_ALIVE = 5;                      // los refuerzos esperan si hay más que estos en pie (el móvil)
  const CUT_T = 3;                          // cortar el cable sin el minijuego (por si acaso)
  const SAFE_R = 24;                        // nadie aparece a menos de esto de ti (los refuerzos), y la guardia del camino empieza lejos
  const DOOR_R = 6;                         // los que salen de la torre esperan a que no estés pegada a la puerta

  let S = null, scene = null;
  const _a = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null, _b = _a ? new THREE.Vector3() : null, _up = _a ? new THREE.Vector3(0, 1, 0) : null, _d = _a ? new THREE.Vector3() : null;

  function msg(t, k) { if (G.Mode && G.Mode.onMessage) G.Mode.onMessage(t, k || 'bad'); }
  function play(name, o) { if (G.Audio) G.Audio.play(name, o); }
  function title(a, b) {
    const t = el('m-title');
    if (!t) return;
    t.innerHTML = '<b>' + a + '</b><span>' + b + '</span>';
    t.classList.remove('hidden', 'out');
    setTimeout(() => { if (S) t.classList.add('out'); }, 7000);
  }
  function say(h, text) { if (h && h.alive && G.Humans && G.Humans.Voice) G.Humans.Voice.say(h, text, { prio: 4 }); }
  function enlist(h) { const L = G.Mode && G.Mode.list; if (L && L.indexOf(h) < 0) L.push(h); }
  const up = (sq) => (sq ? sq.members.filter((h) => h.alive && !h.gone && !h.spared) : []);
  function allUp() { let n = 0; for (const sq of S.squads) n += up(sq).length; return n; }

  // un grupo de Escorpiones (ya activos: patrullan su zona y van a por ti si te ven u oyen)
  function squad(roles, at, o) {
    if (!G.Humans) return null;
    const sq = G.Humans.spawnSquad(Object.assign({ roles, at, active: true, diff: 1, noRetreat: true, noBeg: true, entry: at }, o || {}));
    for (const h of sq.members) enlist(h);
    S.squads.push(sq);
    return sq;
  }

  // ---------- la linterna: los haces (los del mapa, inclinados), la mancha de luz en el suelo, el láser y el tirador ----------
  function buildFx() {
    if (typeof THREE === 'undefined' || !scene) return null;
    const T = S.T, g = new THREE.Group();
    // la mancha de luz que barre la meseta: dos sectores opuestos, de BLIND a RANGE (o hasta el borde de la meseta:
    // sus vértices se recolocan cada fotograma, ver spotAt)
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(36), 3));
    const sm = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    sm.toneMapped = false;
    const spot = new THREE.Mesh(sg, sm);
    spot.position.set(T.x, T.g + 0.07, T.z); spot.renderOrder = 2; spot.frustumCulled = false;
    g.add(spot);
    // el láser del tirador (un cilindro fino, rojo)
    const lm = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    lm.toneMapped = false;
    const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5, 1, true), lm);
    laser.visible = false; laser.frustumCulled = false; laser.renderOrder = 4;
    g.add(laser);
    // el tirador en el balcón: una silueta oscura con el rifle hacia fuera
    const fm = new THREE.MeshBasicMaterial({ color: 0x1b1716 });
    const fig = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.95, 0.3), fm); body.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), fm); head.position.y = 1.55;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.05), fm); gun.position.set(0.12, 1.28, 0.55); gun.rotation.x = 0.35;
    fig.add(body); fig.add(head); fig.add(gun);
    g.add(fig);
    scene.add(g);
    // los haces del mapa, a mano: inclinados hacia la meseta
    const LH = G.Maps && G.Maps.lighthouseFx;
    if (LH) { LH.manual = true; for (const b of LH.beams.children) b.rotation.z = -TILT; }
    return { g, spot, laser, fig, LH, mats: [sm, lm, fm] };
  }
  // la mancha del suelo para el ángulo a de la linterna: cada sector llega hasta RANGE o hasta donde acaba la meseta
  // (el murete del acantilado y las vallas), para que no quede luz flotando sobre el mar
  const EDGE = { x0: 4.2, z0: 4.2, x1: 60.8, z1: 55.7 };
  function spotAt(a) {
    const F = S.fx;
    if (!F) return;
    const T = S.T, p = F.spot.geometry.attributes.position, A = p.array;
    let i = 0;
    for (const s of [0, Math.PI]) {
      const cx = Math.cos(a + s), cz = -Math.sin(a + s);
      let r1 = RANGE;
      if (cx > 1e-4) r1 = Math.min(r1, (EDGE.x1 - T.x) / cx); else if (cx < -1e-4) r1 = Math.min(r1, (EDGE.x0 - T.x) / cx);
      if (cz > 1e-4) r1 = Math.min(r1, (EDGE.z1 - T.z) / cz); else if (cz < -1e-4) r1 = Math.min(r1, (EDGE.z0 - T.z) / cz);
      r1 = Math.max(BLIND, r1);
      const c = (r, da) => { A[i++] = r * Math.cos(a + s + da); A[i++] = 0; A[i++] = -r * Math.sin(a + s + da); };
      c(BLIND, -BEAM_HALF); c(r1, -BEAM_HALF); c(r1, BEAM_HALF); c(BLIND, -BEAM_HALF); c(r1, BEAM_HALF); c(BLIND, BEAM_HALF);
    }
    p.needsUpdate = true;
  }
  function disposeFx() {
    const F = S && S.fx;
    if (!F) return;
    if (F.g.parent) F.g.parent.remove(F.g);
    F.g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const m of F.mats) m.dispose();
    if (F.LH) F.LH.manual = false;
    S.fx = null;
  }
  // de dónde dispara (el balcón, hacia ti) y la altura de tu pecho
  function chestY(P) { return P.bodyY ? P.bodyY(false) : P.y + (P.elev || 0) + (P.stance === 'prone' ? 0.3 : (P.stance === 'crouch' ? 0.85 : 1.25)); }
  function muzzle(P, out) {
    const T = S.T, dx = P.pos.x - T.x, dz = P.pos.z - T.z, d = Math.hypot(dx, dz) || 1;
    out.x = T.x + dx / d * 2.5; out.z = T.z + dz / d * 2.5; out.y = T.y;
    return out;
  }
  // ¿te ve desde el balcón? Ni lejos ni al pie de la torre, y sin nada que tape la línea (las paredes, siempre; un
  // coche o unos sacos, solo si estás pegado a ellos: la línea baja de veinte metros)
  function sees(P) {
    const T = S.T, dx = P.pos.x - T.x, dz = P.pos.z - T.z, d = Math.hypot(dx, dz);
    if (d > RANGE || d < BLIND || (P.lv || 0) !== 0) return false;
    const py = chestY(P), k = 4.7 / d;                  // (la línea empieza fuera de la torre, que es maciza)
    return G.World.coverHit(T.x + dx * k, T.z + dz * k, T.y + (py - T.y) * k, P.pos.x, P.pos.z, py, 0, false) < 0;
  }
  // ¿te da el haz? (cualquiera de los dos, que van opuestos)
  function inBeam(P) {
    const T = S.T, dx = P.pos.x - T.x, dz = P.pos.z - T.z, d = Math.hypot(dx, dz);
    const a = Math.atan2(-dz, dx), w = BEAM_HALF + Math.atan(0.7 / Math.max(1, d));
    return Math.abs(U.angleDiff(a, S.beam)) < w || Math.abs(U.angleDiff(a, S.beam + Math.PI)) < w;
  }
  function hidden(P) { return P.stance !== 'stand' && G.World.tallAt && G.World.tallAt(P.pos.x, P.pos.z, 0); }
  // distancia de un punto al segmento a-b (3D)
  function segDist(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, l2 = abx * abx + aby * aby + abz * abz || 1;
    const t = U.clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2, 0, 1.15);
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
  }
  function hurt(player) {
    if (player.dead || player.bossKill) return false;
    if (G.Combat && G.Combat.execSafe && G.Combat.execSafe(player)) return false;        // (rematando: no te alcanzan)
    const T = S.T, cause = 'El tirador del faro te alcanzó.';
    player.damage(SN_DMG, cause);
    if (G.Combat && G.Combat.stats) G.Combat.stats.hurt += SN_DMG;
    const side = U.angleDiff(Math.atan2(T.x - player.pos.x, T.z - player.pos.z), player.facing) > 0 ? 1 : -1;
    if (G.Camera && G.Camera.hurtFx) G.Camera.hurtFx(1, side);
    play('hitFlesh', { vol: 0.8 });
    if (player.health <= 0 && !player.dead) player.die(cause);
    return true;
  }
  function fire(player) {
    const sn = S.sn, A = sn.aim, P = { x: player.pos.x, y: chestY(player), z: player.pos.z };
    const hit = !player.dead && !player.dodging && segDist(P, A.from, A.to) < HIT_R && sees(player);
    sn.shots++;
    if (_a && G.Guns && G.Guns.tracer) G.Guns.tracer(_a.set(A.from.x, A.from.y, A.from.z), _b.set(hit ? P.x : A.to.x, hit ? P.y : A.to.y - 1.1, hit ? P.z : A.to.z));
    if (_a && G.Humans && G.Humans.flash) G.Humans.flash(_a.set(A.from.x, A.from.y, A.from.z), 1.4);
    play('rifle', { x: S.T.x, z: S.T.z, lv: 0, vol: 1.5 });
    if (hit && hurt(player)) { sn.hits++; if (sn.hits === 1) msg('¡Te dio el tirador del faro! Cúbrete o apágale la luz', 'bad'); }
    sn.aim = null; sn.cd = COOL;
  }
  function sniper(dt, player) {
    const sn = S.sn, F = S.fx, see = !player.dead && sees(player);
    sn.cd -= dt;
    // el haz te encuentra: te sigue un rato (mientras te vea) y la guardia viene a mirar
    if (see && inBeam(player) && !hidden(player)) {
      if (sn.track <= 0) {
        if (!sn.found++) msg('El haz del faro te ha encontrado: el tirador te busca', 'bad');
        for (const sq of S.squads) if (sq.suspect && sq !== S.boss) sq.suspect(player.pos.x, player.pos.z, 0, 4);
      }
      sn.track = TRACK_T;
    } else sn.track -= dt * (see ? 1 : 2.5);
    if (sn.aim) {
      const A = sn.aim;
      A.t += dt;
      if (A.t < AIM_T - LOCK_T) {
        // todavía te sigue: si te pierde, lo deja
        if (!see) { sn.aim = null; sn.cd = 1.0; }
        else { muzzle(player, A.from); A.to.x = player.pos.x; A.to.y = chestY(player); A.to.z = player.pos.z; }
      } else if (!A.locked) { A.locked = true; play('bClick', { vol: 1.3 }); }
      if (sn.aim && A.t >= AIM_T) fire(player);
    } else if (sn.track > 0 && sn.cd <= 0 && see) {
      sn.aim = { t: 0, locked: false, from: muzzle(player, { x: 0, y: 0, z: 0 }), to: { x: player.pos.x, y: chestY(player), z: player.pos.z } };
      play('bClick', { vol: 0.9 });
      if (sn.warn++ < 2) msg('El tirador del faro te apunta: ¡a cubierto!', 'warn');
    }
    if (!F) return;
    // el láser
    const A = sn.aim;
    F.laser.visible = !!A;
    if (A) {
      _a.set(A.from.x, A.from.y, A.from.z); _b.set(A.to.x, A.to.y, A.to.z);
      const len = _a.distanceTo(_b) || 1;
      F.laser.position.copy(_a).add(_b).multiplyScalar(0.5);
      F.laser.quaternion.setFromUnitVectors(_up, _d.copy(_b).sub(_a).multiplyScalar(1 / len));
      F.laser.scale.set(A.locked ? 2.2 : 1, len, A.locked ? 2.2 : 1);
      F.laser.material.opacity = A.locked ? 0.95 : 0.35 + 0.3 * Math.abs(Math.sin(A.t * 14));
    }
    // la silueta del balcón se pone del lado por el que andas
    const T = S.T, want = Math.atan2(player.pos.x - T.x, player.pos.z - T.z);
    sn.face += U.angleDiff(want, sn.face) * Math.min(1, dt * 2.2);
    F.fig.position.set(T.x + Math.sin(sn.face) * 2.25, T.y - 1.33, T.z + Math.cos(sn.face) * 2.25);
    F.fig.rotation.y = sn.face;
  }

  // ---------- el generador ----------
  function powerOff(player) {
    if (!S.power) return;
    S.power = false; S.sn.aim = null; S.sn.track = 0;
    const F = S.fx;
    if (F) {
      F.spot.visible = false; F.laser.visible = false; F.fig.visible = false;
      if (F.LH) { F.LH.beams.visible = false; if (F.LH.mat && F.LH.mat.color) F.LH.mat.color.setHex(0x2c2a26); }
    }
    play('doorClose', { x: S.gen.x, z: S.gen.z, lv: 0, vol: 1.4 });
    G.World.emit(S.gen.x, S.gen.z, 16, 0);
    msg('El faro se apaga: el tirador ya no te ve', 'good');
    if (!S.boss && G.Mode && G.Mode.chal) G.Mode.chal('faro_apagon');
    // la guardia de la plazoleta va a ver qué pasó, y el tirador baja
    if (S.plaza && S.plaza.suspect) S.plaza.suspect(S.gen.x, S.gen.z, 0, 3);
    S.downT = 4.5;
  }
  const atDoor = (player) => Math.hypot(player.pos.x - S.door.x, player.pos.z - S.door.z) < DOOR_R;
  function sniperDown(player) {
    if (atDoor(player)) { S.downT = 1; return; }          // (pegada a la puerta: sale cuando te apartes)
    const sq = squad(['tirador'], S.door, { face: Math.PI, diff: 1.15 });
    if (!sq) return;
    if (sq.suspect) sq.suspect(S.gen.x, S.gen.z, 0, 3);
    play('doorKick', { x: S.door.x, z: S.door.z, lv: 0, vol: 1.2 });
    if (G.Refugio && G.Refugio.ping) G.Refugio.ping(S.door.x, S.door.z, 'escorpion', 5);
    msg('El tirador baja del faro', 'warn');
    say(sq.members[0], '¿Quién coño ha cortado la luz? ¡Encontradlo!');
  }
  function cutUpdate(dt, player) {
    const C = S.crack;
    if (!C) return;
    const d = Math.hypot(S.gen.px - player.pos.x, S.gen.pz - player.pos.z);
    const stopIt = () => { S.crack = null; if (G.SafeCrack) G.SafeCrack.stop(); if (G.Mode && G.Mode.setTimer) G.Mode.setTimer(null); };
    if (d > 2.2 || (player.speedNow || 0) > 0.9 || (player.blow && player.blow.t < 0.3) || player.struggle || player.dead) {
      stopIt(); msg('Se cortó: vuelve a empezar', 'warn');
      return;
    }
    C.t += dt;
    const done = G.SafeCrack && G.SafeCrack.active ? G.SafeCrack.update(dt) === 'done' : C.t >= CUT_T;
    if (!(G.SafeCrack && G.SafeCrack.active) && G.Mode && G.Mode.setTimer) G.Mode.setTimer('CORTANDO EL CABLE', Math.max(0, CUT_T - C.t));
    if (done) { stopIt(); powerOff(player); }
  }

  // ---------- el Aguijón ----------
  function bossOut(player) {
    const sq = squad(ESCORT, S.door, { face: Math.PI, diff: 1.15 });
    if (!sq) return;
    S.boss = sq;
    const L = sq.leader || sq.members[0];
    S.leader = L;
    L.boss = true; L.name = 'El Aguijón';
    L.hp *= LEADER_HP; L.hpMax = L.hp;
    const r0 = L.R;
    L.R = Object.assign({}, r0, { react: [r0.react[0] * 0.7, r0.react[1] * 0.7], sight: r0.sight * 1.2, acc: Math.min(0.6, (r0.acc || 0.4) * 1.3) });
    if (L.pers) { L.pers.alert = 1; L.pers.brave = 1; }
    if (sq.know) sq.know(player, false);
    play('doorKick', { x: S.door.x, z: S.door.z, lv: 0, vol: 1.6 }); play('doorBreak', { x: S.door.x, z: S.door.z, lv: 0, vol: 1.2 });
    if (G.Refugio && G.Refugio.ping) G.Refugio.ping(S.door.x, S.door.z, 'escorpion', 6);
    msg('¡El Aguijón sale del faro!', 'bad');
    setTimeout(() => { if (S) say(L, '¿Así que eres tú quien anda matando a los míos? Bien. Me ahorras el viaje.'); }, 900);
    title('EL AGUIJÓN', 'LÍDER DE LOS ESCORPIONES · CASCO Y CHALECO: NADA LO MATA DE UN TIRO');
  }
  function wave(player) {
    const k = S.waveN++, roles = WAVES[k % WAVES.length];
    // por la verja si estás lejos de ella; si no, por el aparcamiento o saltando la valla de las tumbas: siempre por donde
    // más lejos estés (nunca a menos de SAFE_R si se puede)
    const far = (p) => Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
    const C = [S.gate, S.park, S.west].filter(Boolean);
    const at = far(S.gate) >= SAFE_R ? S.gate : C.reduce((a, b) => (far(b) > far(a) ? b : a));
    const sq = squad(roles, at, { face: 0, diff: 1 + k * 0.1 });
    if (!sq) return;
    if (sq.suspect) sq.suspect(player.pos.x, player.pos.z, 0, 5);
    if (G.Refugio && G.Refugio.ping) G.Refugio.ping(at.x, at.z, 'escorpion', 6);
    msg('¡Refuerzos de los Escorpiones! Suben por el camino', 'bad');
  }
  function win(player) {
    S.phase = 'won'; S.winT = 2.8;
    S.sn.aim = null;
    if (S.fx) S.fx.laser.visible = false;
    // sin su líder, los que quedan huyen por donde puedan
    for (const sq of S.squads) {
      sq.noRetreat = false;
      for (const h of up(sq)) { if (h === S.leader || h.state === 'beg') continue; h.exit = { x: S.gate.x, z: S.gate.z }; h.enter('flee', 0); }
    }
    msg('El Aguijón ha caído: los que quedan huyen', 'good');
  }

  const Faro = {
    begin(sc, player, type) {
      this.stop();
      scene = sc;
      const mp = G.Maps && G.Maps.get(G.World.layout);
      if (!mp || !mp.faroBoss || type !== 'jefe') return false;
      const L = mp.lighthouse, W = G.World, gy = W.terrainAt ? W.terrainAt(L.x, L.z) : 0;
      const LH = G.Maps.lighthouseFx;
      S = {
        t: 0, phase: 'guards', power: true, beam: 2.4, squads: [], boss: null, leader: null, waveN: 0, waveAt: [0.66, 0.33], waveT: 0, barT: 0,
        // T: la torre (g: el suelo; y: la altura del rifle en el balcón)
        T: { x: L.x, z: L.z, g: gy, y: (LH ? LH.y : gy + L.y) - 0.2 },
        gen: mp.gen, door: mp.door, gate: mp.gate, park: mp.park, west: mp.west,
        sn: { cd: 6, track: 0, aim: null, hits: 0, shots: 0, found: 0, warn: 0, face: Math.PI },
        crack: null, downT: 0, hintT: 0, hints: 0, fx: null, guards0: 0
      };
      S.fx = buildFx();
      // entras por la verja, mirando camino abajo
      player.facing = 0; if (G.Camera) G.Camera.yaw = 0;
      // la guardia: el corte del camino y la plazoleta de la torre
      if (G.Humans && G.Humans.prepare) G.Humans.prepare(ESCORT.concat(['tirador'], WAVES[0], WAVES[1]));
      S.road = squad(GUARD_A, { x: 40.5, z: 24.2 }, { face: 0, zone: { x0: 31, z0: 18, x1: 47, z1: 31 }, guard: { x: 40.5, z: 24.2 } });
      S.plaza = squad(GUARD_B, { x: 48.5, z: 39.6 }, { face: Math.PI, zone: { x0: 40, z0: 30, x1: 58, z1: 55 }, guard: { x: S.door.x, z: S.door.z } });
      S.guards0 = allUp();
      // el generador: cortarle el cable apaga la linterna
      if (G.Props && S.gen) G.Props.add({
        x: S.gen.px, z: S.gen.pz, label: 'Cortar el cable del faro', reach: 1.8, kind: 'station', id: 'faro_gen',
        off: () => !S || !S.power || !!S.crack || S.phase === 'won',
        use: (pl) => this.cut(pl),
        dispose() { }
      });
      title('FARO DE OCEANSIDE', 'JEFE FINAL · ACABA CON EL AGUIJÓN, EL LÍDER DE LOS ESCORPIONES');
      if (G.Mode) G.Mode.fighting = true;
      return true;
    },
    // el cable del generador: la cizalla (o, sin el minijuego, unos segundos quieto)
    cut(player) {
      if (!S || !S.power || S.crack) return null;
      S.crack = { t: 0 };
      if (G.SafeCrack) G.SafeCrack.start({ kinds: ['cut'], tier: 0.5, noise: (r) => G.World.emit(S.gen.x, S.gen.z, r, 0) });
      return 'Cortando el cable... no te muevas';
    },
    get active() { return !!S; },
    // para la pantalla de puntaje y la de muerte
    get result() {
      if (!S) return null;
      const L = S.leader;
      return { out: !!S.boss, hp: L ? Math.max(0, L.hp / L.hpMax) : 1, dark: !S.power, snHits: S.sn.hits, snShots: S.sn.shots, guards: allUp(), won: S.phase === 'won' };
    },
    get dbg() { return S; },
    update(dt, player) {
      if (!S || !G.Mode || !G.Mode.active || G.Mode.phase !== 'explore') { if (S && S.fx) S.fx.laser.visible = false; return; }
      S.t += dt;
      // la linterna gira (y con ella, los haces del mapa y la mancha del suelo)
      if (S.power) {
        S.beam = (S.beam + dt * BEAM_W) % (Math.PI * 2);
        if (S.fx) { spotAt(S.beam); if (S.fx.LH) S.fx.LH.beams.rotation.y = S.beam; }
      }
      if (S.phase === 'won') {
        S.winT -= dt;
        if (S.winT <= 0) { const r = this.result; S.phase = 'end'; G.Mode.faroWin(r); }
        return;
      }
      if (S.phase === 'end') return;
      if (S.power) sniper(dt, player);
      cutUpdate(dt, player);
      if (S.downT > 0) { S.downT -= dt; if (S.downT <= 0) sniperDown(player); }
      // los avisos del principio
      S.hintT += dt;
      if (S.hints === 0 && S.hintT > 2.5) { S.hints = 1; msg('El haz del faro barre la meseta: lo que ilumina, el tirador del balcón lo ve', 'warn'); }
      else if (S.hints === 1 && S.hintT > 9 && S.power) {
        S.hints = 2; msg('El generador de la linterna está al este, detrás de la caseta de la sirena', 'warn');
        if (G.Refugio && G.Refugio.ping && S.gen) G.Refugio.ping(S.gen.x, S.gen.z, 'chest', 9, 'GENERADOR');
      }
      const L = S.leader;
      if (!S.boss) {
        // la guardia: cuando quedan pocos, cuando te plantas en la puerta o si esto se alarga, sale el Aguijón
        // (si estás pegada a la puerta, espera a que te apartes: no sale encima de ti)
        const n = allUp(), dDoor = Math.hypot(player.pos.x - S.door.x, player.pos.z - S.door.z);
        if ((n <= 1 || (dDoor < 12 && n <= 4) || S.t > 330) && (dDoor >= DOOR_R || S.t > 400)) bossOut(player);
      } else if (L) {
        if (!L.alive) { win(player); if (G.Mode.bossBar) G.Mode.bossBar('El Aguijón', 0); return; }
        // los refuerzos: con dos tercios y con un tercio de la vida (esperan si hay demasiados en pie)
        const k = L.hp / L.hpMax;
        if (S.waveAt.length && k <= S.waveAt[0]) {
          S.waveT += dt;
          if (S.waveT > 1.5 && allUp() <= MAX_ALIVE) {
            S.waveAt.shift(); S.waveT = 0;
            say(L, S.waveN ? '¡Todos al faro! ¡Lo quiero muerto ya!' : '¡Arriba todo el mundo! ¡Al faro!');
            wave(player);
          }
        }
      }
      // la barra de arriba: la guardia y, luego, la vida del Aguijón
      S.barT -= dt;
      if (S.barT <= 0 && G.Mode.bossBar) {
        S.barT = 0.2;
        if (S.boss && L) G.Mode.bossBar('El Aguijón' + (allUp() > 1 ? ' · escolta: ' + (allUp() - 1) : ''), Math.max(0, L.hp / L.hpMax));
        else { const n = allUp(); G.Mode.bossBar('Guardia del faro · ' + n + ' en pie' + (S.power ? '' : ' · faro apagado'), n / Math.max(1, S.guards0)); }
      }
    },
    stop() {
      if (!S) return;
      if (S.crack && G.SafeCrack) G.SafeCrack.stop();
      disposeFx();
      const p = G.Props && G.Props.list.find((q) => q.id === 'faro_gen');
      if (p) G.Props.remove(p);
      S = null;
    }
  };
  G.Faro = Faro;
})(window.Game = window.Game || {});
