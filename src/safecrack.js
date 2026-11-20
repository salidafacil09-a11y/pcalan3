// Minijuegos para abrir la caja fuerte del saqueo (en vez de esperar quieta 6 segundos). Uno al azar:
//  · La rueda: la aguja gira y hay que tocar Recoger cuando pasa por la marca, tres números (cada uno en sentido
//    contrario y algo más deprisa). Fallar suena: un golpe metálico que los Escorpiones pueden oír, y la marca cambia.
//  · Los pernos: cuatro pernos; un indicador sube y baja por cada uno y hay que tocar Recoger cuando está en la
//    franja (cinco). Fallar suena y el último perno que habías encajado se vuelve a caer.
// Y para forzar la puerta de una celda (rescue.js), otros dos:
//  · La palanca: la barra entre los barrotes. Cada toque empuja; la fuerza cae sola. Hay que tenerla dentro de la
//    franja (que se mueve un poco) hasta llenar la barra de abajo. Si te pasas, la palanca salta: suena y pierdes algo.
//  · La cizalla: la cadena del candado corre entre las cuchillas; hay que cortar cuando pasa el eslabón oxidado
//    (tres cortes, cada vez más deprisa). Fallar suena contra el hierro y el oxidado se aleja.
// Y para forzar una cerradura vieja (las paradas de Retorno, calm.js), la ganzúa:
//  · La horquilla se mueve con el joystick (o ← →) por debajo del bombín; al tocar Girar, el bombín gira tanto como
//    cerca estés del punto bueno (escondido). Si gira del todo, salta esa guarda y queda la siguiente (dos). Si no,
//    la horquilla se queda temblando y vuelve; cada cuatro intentos fallidos se dobla y coges otra (sin ruido).
// Y para arrancar el generador de las paradas, el tirón:
//  · La cuerda del arranque: la marca va y viene por la barra (el pistón subiendo y bajando) y hay que tirar cuando
//    pasa por la franja de compresión. Tres tirones buenos y arranca; cada uno, la franja más estrecha y la marca
//    más rápida. Un tirón a destiempo ahoga el motor: se pierde el último bueno (sin ruido: no hay nadie).
// Y para las radios de las paradas, el dial:
//  · La aguja recorre la banda con el joystick (o ← →). Cerca de una emisora la estática baja y lo que dice se va
//    entendiendo (las letras dejan de ser ruido); al tocar Fijar con la señal limpia, se queda en esa (result: cuál).
//    Fijar en la estática no pasa nada: suena a nada.
// El juego sigue mientras tanto (no se pausa): si te mueves, te pegan o te alejas, se corta (lo decide el modo).
(function (G) {
  'use strict';
  const TAU = Math.PI * 2;
  let A = null, cv = null, ctx = null, box = null, txt = null;

  function el() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'crack';
    box.className = 'hidden';
    cv = document.createElement('canvas');
    cv.width = 360; cv.height = 360;
    txt = document.createElement('div');
    txt.className = 'crack-tx';
    box.appendChild(cv); box.appendChild(txt);
    document.body.appendChild(box);
    ctx = cv.getContext('2d');
  }

  // tier: dificultad (0 a 1): más rápida y con la marca más estrecha. noise(r): ha sonado (radio en m)
  function start(o) {
    el();
    const pool = o.kinds || ['dial', 'pins'];
    const kind = o.kind || pool[Math.floor(Math.random() * pool.length)], k = Math.max(0, Math.min(1, o.tier || 0));
    A = { kind, k, noise: o.noise || (() => {}), t: 0, done: false, flash: 0, flashOk: false, msgT: 0 };
    if (kind === 'dial') {
      A.n = 0; A.need = 3; A.ang = Math.random() * TAU; A.dir = 1; A.sp = 2.1 + 0.8 * k;
      A.w = 0.62 - 0.2 * k; A.set = [];
      newMark();
    } else if (kind === 'pins') {
      A.n = 0; A.need = 5; A.y = 0; A.v = 1; A.sp = 0.95 + 0.4 * k;
      A.band = [0.68, 0.68 + (0.2 - 0.06 * k)];
      A.lo = 0.1;
    } else if (kind === 'pick') {
      // ang: la horquilla (-1 a 1); sweet: el punto bueno; turn: lo que gira el bombín (0 a 1); tryT: girando
      A.n = 0; A.need = 2; A.ang = 0; A.sweet = sweetPick(); A.turn = 0; A.tryT = -1; A.max = 0; A.fails = 0; A.tol = 0.11 - 0.03 * k;
    } else if (kind === 'pull') {
      // pos: la marca (0 a 1, va y viene); z0, w: la franja; rpm: lo que suena el motor (se pinta)
      A.n = 0; A.need = 3; A.pos = 0; A.dir = 1; A.sp = 0.85 + 0.3 * k; A.w = 0.2 - 0.04 * k; A.z0 = 0.55 + Math.random() * 0.2; A.rpm = 0; A.pullT = 0;
    } else if (kind === 'radio') {
      // pos: la aguja (0 a 1 en la banda); st: las emisoras { p (0 a 1), tease }; clear: lo limpia que se oye (0 a 1)
      A.st = (o.stations || []).map((q) => (typeof q === 'number' ? { p: q } : q));
      A.band = o.band || [3, 30]; A.unit = o.unit || 'MHz'; A.w = 0.045; A.clear = 0; A.near = -1;
      A.pos = 0.5;
      for (let t = 0; t < 12; t++) { const c = 0.06 + Math.random() * 0.88; if (!A.st.some((q) => Math.abs(q.p - c) < 0.12)) { A.pos = c; break; } }
    } else if (kind === 'pry') {
      // p: la fuerza (0 a 1); prog: lo que lleva cediendo la puerta (0 a 1); la franja, de alto zw
      A.p = 0.2; A.prog = 0; A.zw = 0.24 - 0.07 * k; A.need = 2.2 + 0.9 * k; A.fall = 0.3 + 0.16 * k; A.zc = 0.66;
    } else {
      // cut: pos, el eslabón que está entre las cuchillas (en eslabones); rust, el oxidado; w, cuánto se perdona
      A.n = 0; A.need = 3; A.pos = 0; A.sp = 1.55 + 0.6 * k; A.w = 0.42 - 0.12 * k; A.rust = 3 + Math.floor(Math.random() * 3);
    }
    box.classList.remove('hidden');
    txt.textContent = {
      dial: 'La rueda: toca Recoger cuando la aguja pase por la marca',
      pins: 'Los pernos: toca Recoger cuando el indicador esté en la franja',
      pry: 'La palanca: toca para hacer fuerza y mantenla en la franja. Si te pasas, salta',
      cut: 'La cizalla: corta cuando el eslabón oxidado pase entre las cuchillas',
      pick: 'La ganzúa: mueve la horquilla (joystick o ← →) y toca Girar. Cuanto más cerca, más gira',
      pull: 'El arranque: tira de la cuerda cuando la marca pase por la franja',
      radio: 'La radio: gira el dial (joystick o ← →) hasta que se oiga claro y toca Fijar'
    }[kind];
    A.msgT = 2.2;
    draw();
    return A;
  }
  function sweetPick() { return (Math.random() * 2 - 1) * 0.8; }
  function newMark() {
    // la marca, lejos de donde está la aguja (que dé tiempo a verla venir)
    A.mark = A.ang + A.dir * (3 + Math.random() * 2.2);
  }
  function stop() {
    A = null;
    if (box) box.classList.add('hidden');
  }

  function press() {
    if (!A || A.done || A.hold > 0) return;
    if (A.kind === 'radio') {
      if (A.clear >= 0.66 && A.near >= 0) {
        A.done = true; A.result = A.near; A.flash = 0.3; A.flashOk = true;
        txt.textContent = 'Sintonizada'; A.msgT = 9;
        if (G.Audio) G.Audio.play('slide', { vol: 0.25 });
      } else {
        A.flash = 0.3; A.flashOk = false; A.hold = 0.3;
        txt.textContent = A.clear > 0.25 ? 'Casi: un poco más fino' : 'Solo estática. Gira el dial hasta que se oiga algo'; A.msgT = 1.5;
      }
      draw();
      return;
    }
    if (A.kind === 'pull') {
      A.pullT = 0.35;
      if (A.pos >= A.z0 && A.pos <= A.z0 + A.w) {
        A.n++; A.flash = 0.3; A.flashOk = true; A.hold = 0.75; A.rpm = Math.min(1, A.rpm + 0.4);
        if (G.Audio) { G.Audio.play('slide', { vol: 0.55 }); setTimeout(() => G.Audio && G.Audio.play('hitBlunt', { vol: 0.3 }), 180); }
        if (A.n >= A.need) { A.done = true; txt.textContent = '¡Arranca!'; A.msgT = 9; }
        else { A.sp *= 1.18; A.w *= 0.85; A.z0 = 0.15 + Math.random() * (0.8 - A.w); txt.textContent = A.n === 1 ? 'Tose... otra vez' : 'Casi... una más'; A.msgT = 1.3; }
      } else {
        A.flash = 0.35; A.flashOk = false; A.hold = 0.5;
        if (A.n > 0) A.n--;
        A.rpm = Math.max(0, A.rpm - 0.3);
        if (G.Audio) G.Audio.play('slide', { vol: 0.3 });
        txt.textContent = 'A destiempo: se ahoga'; A.msgT = 1.3;
      }
      draw();
      return;
    }
    if (A.kind === 'pick') {
      if (A.tryT >= 0) return;
      // cuánto gira: del todo si estás en el punto; si no, menos cuanto más lejos
      const d = Math.abs(A.ang - A.sweet);
      A.max = d <= A.tol ? 1 : Math.max(0.04, 0.85 * (1 - (d - A.tol) / 0.75));
      A.tryT = 0;
      if (G.Audio) G.Audio.play('slide', { vol: 0.16 });
      return;
    }
    if (A.kind === 'pry') {
      A.p += 0.13;
      if (A.p > 0.97) {
        // se pasó: la palanca salta de los barrotes
        A.p = 0.25; A.prog = Math.max(0, A.prog - 0.3);
        miss();
      } else if (G.Audio) G.Audio.play('slide', { vol: 0.22 });
      draw();
      return;
    }
    if (A.kind === 'cut') {
      if (Math.abs(A.pos - A.rust) <= A.w / 2) {
        A.n++; A.flash = 0.3; A.flashOk = true; A.hold = 0.5;
        if (G.Audio) G.Audio.play('hitBlunt', { vol: 0.35 });
        if (A.n >= A.need) A.done = true;
        else { A.sp *= 1.18; A.rust = Math.ceil(A.pos) + 3 + Math.floor(Math.random() * 3); }
      } else { miss(); A.hold = 0.4; }               // (fallar traba la cizalla un momento: aporrear no sirve)
      draw();
      return;
    }
    if (A.kind === 'dial') {
      const d = Math.abs(((A.ang - A.mark) % TAU + TAU * 1.5) % TAU - Math.PI);
      if (d <= A.w / 2) {
        A.set.push(A.mark); A.n++; A.flash = 0.25; A.flashOk = true; A.hold = 0.45;
        if (G.Audio) G.Audio.play('slide', { vol: 0.5 });
        if (A.n >= A.need) A.done = true;
        else { A.dir = -A.dir; A.sp *= 1.15; newMark(); }
      } else miss();
    } else {
      if (A.y >= A.band[0] && A.y <= A.band[1]) {
        A.n++; A.flash = 0.25; A.flashOk = true; A.y = 0; A.v = 1; A.hold = 0.4;
        if (G.Audio) G.Audio.play('slide', { vol: 0.5 });
        if (A.n >= A.need) A.done = true;
        else A.sp *= 1.12;
      } else {
        miss();
        if (A.n > 0) A.n--;              // (el último que habías encajado se cae)
      }
    }
    draw();
  }
  function miss() {
    A.flash = 0.35; A.flashOk = false;
    if (G.Audio) G.Audio.play('hitBlunt', { vol: 0.7 });
    A.noise(9);
    if (A.kind === 'dial') newMark();
    if (A.kind === 'cut') A.rust = Math.ceil(A.pos) + 2 + Math.floor(Math.random() * 3);
    txt.textContent = A.kind === 'pry' ? 'Saltó la palanca... más suave' : 'Ha sonado... con calma';
    A.msgT = 1.4;
  }

  // devuelve 'done' al abrirla
  function update(dt) {
    if (!A) return null;
    A.t += dt;
    if (A.flash > 0) A.flash -= dt;
    if (A.msgT > 0) {
      A.msgT -= dt;
      if (A.msgT <= 0) txt.textContent = A.kind === 'dial' ? 'Número ' + Math.min(A.need, A.n + 1) + ' de ' + A.need
        : (A.kind === 'pins' ? 'Perno ' + Math.min(A.need, A.n + 1) + ' de ' + A.need
          : (A.kind === 'cut' ? 'Corte ' + Math.min(A.need, A.n + 1) + ' de ' + A.need : (A.kind === 'pick' ? 'Guarda ' + Math.min(A.need, A.n + 1) + ' de ' + A.need + ' · mueve la horquilla y gira'
            : (A.kind === 'pull' ? 'Tirón ' + Math.min(A.need, A.n + 1) + ' de ' + A.need + ' · tira en la franja' : (A.kind === 'radio' ? 'Gira el dial · toca Fijar cuando se oiga claro' : 'Mantén la fuerza en la franja')))));
    }
    if (A.kind === 'pull') { if (A.pullT > 0) A.pullT -= dt; A.rpm = Math.max(A.done ? 1 : 0, A.rpm - dt * 0.08); }
    if (A.done) { if ((A.kind === 'pull' || A.kind === 'radio') && (A.doneT = (A.doneT || 0) + dt) < 0.6) { draw(); return null; } return 'done'; }
    // (tras encajar uno, un respiro: el mecanismo asienta)
    if (A.hold > 0) { A.hold -= dt; draw(); return null; }
    if (A.kind === 'radio') {
      // la aguja, con el joystick (o las flechas): despacio, que sea fino
      const mx = G.Input && G.Input.move ? G.Input.move.x : 0;
      A.pos = Math.max(0, Math.min(1, A.pos + mx * Math.abs(mx) * dt * 0.2));
      let best = -1, bd = 9;
      A.st.forEach((q, i) => { const d = Math.abs(q.p - A.pos); if (d < bd) { bd = d; best = i; } });
      const want = best >= 0 && bd < A.w ? Math.pow(1 - bd / A.w, 1.5) : 0;
      A.clear += (want - A.clear) * Math.min(1, dt * 7);
      A.near = want > 0 ? best : -1;
      draw();
      return null;
    }
    if (A.kind === 'pick') {
      // la horquilla: con el joystick (o las flechas), solo mientras no gira
      const mx = G.Input && G.Input.move ? G.Input.move.x : 0;
      if (A.tryT < 0) { A.ang = Math.max(-1, Math.min(1, A.ang + mx * dt * 0.75)); A.turn = Math.max(0, A.turn - dt * 3); }
      else {
        A.tryT += dt;
        if (A.tryT < 0.45) A.turn = A.max * Math.min(1, A.tryT / 0.4);
        else if (A.max >= 1) {
          // salta la guarda
          A.n++; A.flash = 0.3; A.flashOk = true; A.tryT = -1; A.turn = 0; A.hold = 0.5; A.fails = 0;
          if (G.Audio) G.Audio.play('hitBlunt', { vol: 0.3 });
          if (A.n >= A.need) A.done = true;
          else { A.sweet = sweetPick(); txt.textContent = 'Una guarda menos. Queda otra'; A.msgT = 1.6; }
        } else if (A.tryT > 0.95) {
          A.tryT = -1; A.fails++;
          if (A.fails >= 4) { A.fails = 0; A.hold = 0.8; A.flash = 0.35; A.flashOk = false; txt.textContent = 'Se dobla la horquilla. Coges otra'; A.msgT = 1.6; if (G.Audio) G.Audio.play('ring', { vol: 0.25 }); }
        }
      }
      draw();
      return null;
    }
    if (A.kind === 'pry') {
      // la fuerza cae sola (más cuanto más arriba); la franja sube y baja despacio
      A.p = Math.max(0, A.p - A.fall * dt * (0.6 + A.p));
      A.zc = 0.64 + 0.1 * Math.sin(A.t * (0.8 + 0.5 * A.k));
      const inZ = Math.abs(A.p - A.zc) <= A.zw / 2;
      A.prog = Math.max(0, Math.min(1, A.prog + (inZ ? dt / A.need : -dt * 0.18)));
      A.inZ = inZ;
      if (A.prog >= 1) { A.done = true; if (G.Audio) G.Audio.play('doorOpen', { vol: 0.5 }); }
    } else if (A.kind === 'pull') {
      // va y viene (más despacio en los extremos, como un pistón)
      A.ph = (A.ph || 0) + A.sp * dt * Math.PI;
      A.pos = 0.5 - 0.5 * Math.cos(A.ph);
    } else if (A.kind === 'cut') A.pos += A.sp * dt;
    else if (A.kind === 'dial') A.ang += A.dir * A.sp * dt;
    else {
      A.y += A.v * A.sp * dt;
      if (A.y >= 1) { A.y = 1; A.v = -1; }
      if (A.y <= 0) { A.y = 0; A.v = 1; }
    }
    draw();
    return null;
  }

  function draw() {
    if (!A || !ctx) return;
    const W = cv.width, H = cv.height, c = ctx;
    c.clearRect(0, 0, W, H);
    const ok = A.flash > 0 ? (A.flashOk ? '#7fd48a' : '#e0402e') : null;
    if (A.kind === 'radio') {
      // el frontal de la radio: la escala con sus números, la aguja, la lectura, el medidor de señal y lo que se oye
      const x0 = 34, x1 = W - 34, bw = x1 - x0, top = 40;
      c.fillStyle = 'rgba(20,22,26,0.86)'; c.fillRect(14, top - 22, W - 28, 300);
      c.fillStyle = '#d8c890'; c.fillRect(x0 - 8, top, bw + 16, 74);
      c.strokeStyle = '#3a3226'; c.fillStyle = '#3a3226'; c.lineWidth = 1.5; c.font = '700 12px Arial, sans-serif'; c.textAlign = 'center';
      const lo = A.band[0], hi = A.band[1], span = hi - lo, stp = span > 12 ? 5 : (span > 4 ? 1 : 0.5);
      for (let v = Math.ceil(lo / stp) * stp; v <= hi + 1e-6; v += stp) {
        const px = x0 + bw * (v - lo) / span;
        c.beginPath(); c.moveTo(px, top + 8); c.lineTo(px, top + 30); c.stroke();
        c.fillText(String(Math.round(v * 10) / 10).replace('.', ','), px, top + 46);
      }
      for (let k = 0; k <= 50; k++) { const px = x0 + bw * k / 50; c.beginPath(); c.moveTo(px, top + 8); c.lineTo(px, top + 16); c.stroke(); }
      const nx = x0 + bw * A.pos;
      c.strokeStyle = ok || '#c8281e'; c.lineWidth = 3; c.beginPath(); c.moveTo(nx, top + 2); c.lineTo(nx, top + 72); c.stroke();
      // la lectura
      const f = lo + span * A.pos;
      c.fillStyle = '#0e1a10'; c.fillRect(W / 2 - 92, top + 90, 184, 40);
      c.fillStyle = A.clear > 0.66 ? '#7fd48a' : '#c8e4a8'; c.font = '700 24px "Courier New", monospace';
      c.fillText(f.toFixed(2).replace('.', ',') + ' ' + A.unit, W / 2, top + 118);
      // la señal (barras)
      for (let k = 0; k < 10; k++) { c.fillStyle = k / 10 < A.clear ? (k > 6 ? '#7fd48a' : '#e8c46a') : 'rgba(255,255,255,0.12)'; c.fillRect(W / 2 - 75 + k * 15, top + 168 - k * 2.4, 10, 8 + k * 2.4); }
      // lo que se oye: las letras salen de la estática cuanto más limpio
      const q = A.near >= 0 ? A.st[A.near] : null, tease = q && q.tease ? q.tease : '';
      const NZ = '#%&*~-=+:;!?/\\|';
      let line = '';
      if (tease) for (let i = 0; i < tease.length; i++) { const ch = tease[i]; line += ch === ' ' || Math.random() < A.clear * 1.15 - 0.1 ? ch : NZ[Math.floor(Math.random() * NZ.length)]; }
      else for (let i = 0; i < 26; i++) line += Math.random() < 0.5 ? ' ' : NZ[Math.floor(Math.random() * NZ.length)];
      c.fillStyle = tease ? 'rgba(235,230,210,' + (0.35 + A.clear * 0.65).toFixed(2) + ')' : 'rgba(200,200,190,0.35)'; c.font = '700 15px "Courier New", monospace';
      c.fillText(line.slice(0, 34), W / 2, top + 200);
      if (line.length > 34) c.fillText(line.slice(34, 68), W / 2, top + 222);
      // la estática (puntos)
      c.fillStyle = 'rgba(220,220,210,0.5)';
      for (let k = 0; k < 60 * (1 - A.clear); k++) c.fillRect(x0 + Math.random() * bw, top + 140 + Math.random() * 100, 2, 2);
    } else if (A.kind === 'pick') {
      // el bombín de frente (gira con el intento) y, debajo, la horquilla en su arco
      const cx = W / 2, cy = H / 2 - 30, R = 96;
      c.fillStyle = 'rgba(20,22,26,0.82)'; c.beginPath(); c.arc(cx, cy + 20, R + 70, 0, TAU); c.fill();
      c.fillStyle = '#8a7a52'; c.beginPath(); c.arc(cx, cy, R + 14, 0, TAU); c.fill();
      c.fillStyle = ok || '#b8a26a'; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
      c.save(); c.translate(cx, cy); c.rotate(A.turn * Math.PI / 2 * (A.tryT >= 0 && A.max < 1 && A.tryT > 0.45 ? 1 + Math.sin(A.t * 60) * 0.03 : 1));
      c.fillStyle = '#2a2420'; c.fillRect(-8, -R * 0.7, 16, R * 1.1); c.beginPath(); c.arc(0, -R * 0.7, 14, 0, TAU); c.fill();
      c.restore();
      // el arco de la horquilla (de -80° a 80° bajo el bombín)
      c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 3;
      c.beginPath(); c.arc(cx, cy, R + 40, Math.PI / 2 + 1.4, Math.PI / 2 - 1.4, true); c.stroke();
      const a = Math.PI / 2 - A.ang * 1.4;
      c.strokeStyle = '#d8dce0'; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (R + 58), cy + Math.sin(a) * (R + 58)); c.lineTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18); c.stroke();
      for (let i = 0; i < A.need; i++) { c.fillStyle = i < A.n ? '#7fd48a' : 'rgba(255,255,255,0.25)'; c.beginPath(); c.arc(cx + (i - (A.need - 1) / 2) * 26, cy + R + 84, 7, 0, TAU); c.fill(); }
    } else if (A.kind === 'pull') {
      // el generador de lado: la barra del pistón (horizontal), la franja, la marca y la empuñadura de la cuerda
      const x0 = 40, x1 = W - 40, cy = H / 2 - 20, bw = x1 - x0;
      c.fillStyle = 'rgba(20,22,26,0.82)'; c.fillRect(16, cy - 112, W - 32, 232);
      // el motor: un bloque con aletas
      c.fillStyle = '#5a5e60'; c.fillRect(W / 2 - 70, cy - 98, 140, 52);
      c.fillStyle = '#44484a'; for (let i = 0; i < 7; i++) c.fillRect(W / 2 - 64 + i * 19, cy - 104, 9, 64);
      // las revoluciones (una aguja): suben con cada tirón bueno
      const ga = Math.PI * (1.15 + 0.7 * A.rpm + (A.done ? Math.sin(A.t * 40) * 0.03 : 0));
      c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 3; c.beginPath(); c.arc(W / 2, cy - 54, 36, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
      c.strokeStyle = A.done ? '#7fd48a' : '#e8c46a'; c.lineWidth = 4; c.beginPath(); c.moveTo(W / 2, cy - 54); c.lineTo(W / 2 + Math.cos(ga) * 32, cy - 54 + Math.sin(ga) * 32); c.stroke();
      // la barra
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(x0, cy, bw, 34);
      c.fillStyle = 'rgba(232,196,106,0.4)'; c.fillRect(x0 + bw * A.z0, cy, bw * A.w, 34);
      c.strokeStyle = '#e8c46a'; c.lineWidth = 2; c.strokeRect(x0 + bw * A.z0, cy, bw * A.w, 34);
      const mx = x0 + bw * A.pos;
      c.fillStyle = ok || '#fff'; c.fillRect(mx - 4, cy - 8, 8, 50);
      // la cuerda y la empuñadura (se estira al tirar)
      const hx = W / 2 + (A.pullT > 0 ? 60 * Math.sin(A.pullT / 0.35 * Math.PI) : 0), hy = cy + 86;
      c.strokeStyle = '#c8bca0'; c.lineWidth = 3; c.beginPath(); c.moveTo(W / 2, cy - 46); c.lineTo(hx, hy - 8); c.stroke();
      c.fillStyle = '#2a2a2a'; c.fillRect(hx - 26, hy - 10, 52, 16);
      for (let i = 0; i < A.need; i++) { c.fillStyle = i < A.n ? '#7fd48a' : 'rgba(255,255,255,0.25)'; c.beginPath(); c.arc(W / 2 + (i - (A.need - 1) / 2) * 26 + 110, hy - 2, 7, 0, TAU); c.fill(); }
    } else if (A.kind === 'pry') {
      // la barra de la fuerza (vertical), con su franja, y debajo lo que va cediendo la puerta
      const bx = W / 2 - 34, bw = 68, top = 24, hh = H - 104;
      c.fillStyle = 'rgba(20,22,26,0.82)'; c.fillRect(bx - 70, top - 14, bw + 140, hh + 92);
      // los barrotes, detrás
      c.fillStyle = 'rgba(150,154,160,0.35)';
      for (const x of [bx - 50, bx - 26, bx + bw + 14, bx + bw + 38]) c.fillRect(x, top, 10, hh);
      c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(bx, top, bw, hh);
      const zy0 = top + hh * (1 - (A.zc + A.zw / 2)), zh = hh * A.zw;
      c.fillStyle = A.inZ ? 'rgba(127,212,138,0.45)' : 'rgba(232,196,106,0.4)'; c.fillRect(bx, zy0, bw, zh);
      c.strokeStyle = A.inZ ? '#7fd48a' : '#e8c46a'; c.lineWidth = 2; c.strokeRect(bx, zy0, bw, zh);
      c.fillStyle = 'rgba(224,64,46,0.55)'; c.fillRect(bx, top, bw, hh * 0.03);            // (arriba del todo: salta)
      const py = top + hh * (1 - A.p);
      c.fillStyle = ok || '#fff'; c.fillRect(bx - 8, py - 5, bw + 16, 10);
      // la palanca, inclinada según la fuerza
      c.save(); c.translate(bx + bw / 2, top + hh + 4); c.rotate(-0.25 - A.p * 0.6);
      c.fillStyle = '#b8923a'; c.fillRect(-4, -4, 70, 8); c.restore();
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(bx - 50, top + hh + 34, bw + 100, 14);
      c.fillStyle = '#7fd48a'; c.fillRect(bx - 50, top + hh + 34, (bw + 100) * A.prog, 14);
    } else if (A.kind === 'cut') {
      // la cadena corre de derecha a izquierda; las cuchillas, en el centro
      const cx = W / 2, cy = H / 2 - 10, L = 62;
      c.fillStyle = 'rgba(20,22,26,0.82)'; c.fillRect(10, cy - 92, W - 20, 200);
      c.save(); c.beginPath(); c.rect(10, cy - 92, W - 20, 200); c.clip();
      for (let i = Math.floor(A.pos) - 4; i <= Math.floor(A.pos) + 4; i++) {
        const x = cx + (i - A.pos) * L, rust = i === A.rust;
        c.strokeStyle = rust ? '#b8642e' : '#9aa0a8'; c.lineWidth = rust ? 9 : 8;
        c.beginPath();
        if (i % 2) c.ellipse(x, cy, L * 0.55, 15, 0, 0, TAU); else c.ellipse(x, cy, L * 0.55, 5, 0, 0, TAU);
        c.stroke();
        if (rust) { c.fillStyle = 'rgba(184,100,46,0.5)'; for (let k = 0; k < 5; k++) c.fillRect(x - 20 + k * 9, cy - 3 + (k % 2) * 6, 4, 4); }
      }
      c.restore();
      // la franja buena (alrededor de las cuchillas) y las cuchillas
      c.fillStyle = 'rgba(232,196,106,0.18)'; c.fillRect(cx - A.w / 2 * L, cy - 40, A.w * L, 80);
      c.fillStyle = ok || '#e8e4dc';
      c.beginPath(); c.moveTo(cx - 22, cy - 78); c.lineTo(cx + 22, cy - 78); c.lineTo(cx, cy - 26); c.fill();
      c.beginPath(); c.moveTo(cx - 22, cy + 78); c.lineTo(cx + 22, cy + 78); c.lineTo(cx, cy + 26); c.fill();
      for (let i = 0; i < A.need; i++) { c.fillStyle = i < A.n ? '#7fd48a' : 'rgba(255,255,255,0.25)'; c.beginPath(); c.arc(cx + (i - (A.need - 1) / 2) * 26, cy + 96, 7, 0, TAU); c.fill(); }
    } else if (A.kind === 'dial') {
      const cx = W / 2, cy = H / 2, R = W * 0.42;
      // la rueda: acero oscuro con muescas
      c.fillStyle = 'rgba(20,22,26,0.82)'; c.beginPath(); c.arc(cx, cy, R + 14, 0, TAU); c.fill();
      c.strokeStyle = ok || '#8a9098'; c.lineWidth = 5; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
      c.strokeStyle = 'rgba(200,205,210,0.5)'; c.lineWidth = 2;
      for (let i = 0; i < 40; i++) { const a = i / 40 * TAU, r0 = R - (i % 5 ? 8 : 16); c.beginPath(); c.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); c.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); c.stroke(); }
      // la marca
      c.strokeStyle = '#e8c46a'; c.lineWidth = 14;
      c.beginPath(); c.arc(cx, cy, R - 4, A.mark - A.w / 2 - Math.PI / 2, A.mark + A.w / 2 - Math.PI / 2); c.stroke();
      // la aguja
      c.strokeStyle = '#fff'; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(A.ang) * (R - 12), cy - Math.cos(A.ang) * (R - 12)); c.stroke();
      c.fillStyle = '#b8923a'; c.beginPath(); c.arc(cx, cy, 16, 0, TAU); c.fill();
      // los números ya puestos
      for (let i = 0; i < A.need; i++) { c.fillStyle = i < A.n ? '#7fd48a' : 'rgba(255,255,255,0.25)'; c.beginPath(); c.arc(cx + (i - (A.need - 1) / 2) * 26, cy + R * 0.5, 7, 0, TAU); c.fill(); }
    } else {
      // los pernos: una columna por perno; el que toca, con su indicador y su franja
      const n = A.need, pw = 52, gap = 22, x0 = (W - (n * pw + (n - 1) * gap)) / 2, top = 40, hh = H - 90;
      c.fillStyle = 'rgba(20,22,26,0.82)'; c.fillRect(x0 - 18, top - 18, n * pw + (n - 1) * gap + 36, hh + 36);
      for (let i = 0; i < n; i++) {
        const x = x0 + i * (pw + gap), cur = i === A.n;
        c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x, top, pw, hh);
        if (i < A.n) {
          // encajado: arriba, verde
          c.fillStyle = '#7fd48a'; c.fillRect(x + 6, top + hh * (1 - A.band[1]), pw - 12, hh * (A.band[1] - A.band[0]));
        } else if (cur) {
          c.fillStyle = 'rgba(232,196,106,0.45)'; c.fillRect(x, top + hh * (1 - A.band[1]), pw, hh * (A.band[1] - A.band[0]));
          c.strokeStyle = '#e8c46a'; c.lineWidth = 2; c.strokeRect(x, top + hh * (1 - A.band[1]), pw, hh * (A.band[1] - A.band[0]));
          c.fillStyle = ok || '#fff'; c.fillRect(x + 4, top + hh * (1 - A.y) - 5, pw - 8, 10);
        } else { c.fillStyle = 'rgba(200,205,210,0.35)'; c.fillRect(x + 6, top + hh - 28, pw - 12, 22); }
      }
    }
  }

  G.SafeCrack = { start, stop, press, update, get state() { return A; }, get active() { return !!A; }, get label() { return A ? ({ pins: 'Encajar', dial: 'Girar', pry: 'Palanca', cut: 'Cortar', pick: 'Girar', pull: 'Tirar', radio: 'Fijar' }[A.kind] || 'Girar') : 'Girar'; } };
})(window.Game = window.Game || {});
