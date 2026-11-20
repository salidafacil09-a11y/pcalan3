(function (G) {
  'use strict';

  // Mapas de los enfrentamientos (inspirados en los de los vídeos de referencia, con diseño propio).
  // Cada mapa se describe una vez con primitivas en coordenadas del mundo (suelo, muros, edificios,
  // contenedores, muebles, vehículos, árboles, hierba alta, charcos) y World los aplica chunk a chunk.
  // Los mapas no dependen del modo: cualquier enfrentamiento (asalto o caza) puede tocar en cualquiera.
  //
  // Contenedores de carga: ocupan casillas enteras (2 de ancho, 6 o 12 de largo). Sus costados son aristas
  // CONT (tapan la vista y el paso como una pared) y su techo es transitable (deck): se puede trepar a uno
  // de una altura y, desde arriba, a los de encima. Los abiertos se pueden recorrer por dentro.

  const U = G.Util;
  const MAPS = {};
  const LEVEL_H = 2.6;           // alto de un contenedor

  // ---------- Constructor de primitivas ----------
  function maker() {
    const P = { ground: [], edges: [], blds: [], furn: [], conts: [], obj: [], tall: [], occ: new Map() };
    const key = (x, z) => x + ',' + z;
    const occ = (x0, z0, x1, z1, v) => { for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) P.occ.set(key(x, z), v || 1); };
    const free = (x0, z0, x1, z1) => { for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (P.occ.has(key(x, z))) return false; return true; };
    // lo sólido ya puesto (muebles, vehículos, contenedores) y los troncos de los árboles: así nada se pisa
    const solids = [], trunks = [], facades = [];
    const overlaps = (a) => solids.some((b) => a.x0 < b.x1 - 0.03 && a.x1 > b.x0 + 0.03 && a.z0 < b.z1 - 0.03 && a.z1 > b.z0 + 0.03) ||
      trunks.some(([tx, tz]) => tx > a.x0 - 0.4 && tx < a.x1 + 0.4 && tz > a.z0 - 0.4 && tz < a.z1 + 0.4);
    // Carriles de paso (map.lanes: [x0, z0, x1, z1]): lo sólido que caiga encima se corre al borde más cercano
    // (hasta 3,5 m) y, si no cabe, no se pone. Así las calles y los caminos principales quedan transitables
    const inLane = (a, m0) => { const m1 = m0 || 0; return (api.lanes || []).find((L) => a.x0 < L[2] - m1 && a.x1 > L[0] + m1 && a.z0 < L[3] - m1 && a.z1 > L[1] + m1); };
    const outOfLane = (f) => {
      for (let k = 0; k < 3; k++) {
        const L = inLane(f);
        if (!L) return true;
        const alongX = (L[2] - L[0]) >= (L[3] - L[1]);       // carril a lo largo de x: se corre en z
        const lo = alongX ? (L[1] - 0.05) - f.z1 : (L[0] - 0.05) - f.x1, hi = alongX ? (L[3] + 0.05) - f.z0 : (L[2] + 0.05) - f.x0;
        const d = Math.abs(lo) < Math.abs(hi) ? lo : hi;
        if (Math.abs(d) > 3.5) return false;
        if (alongX) { f.z0 += d; f.z1 += d; } else { f.x0 += d; f.x1 += d; }
      }
      return !inLane(f);
    };
    const api = {
      P, occ, free, lanes: [],
      ground(x0, z0, x1, z1, g) { P.ground.push([x0, z0, x1, z1, g]); },
      // muro a lo largo de x en la línea z (casillas x0..x1-1) o a lo largo de z en la línea x
      wallN(x0, x1, z, e) { for (let x = x0; x < x1; x++) P.edges.push(['N', x, z, e]); },
      wallW(z0, z1, x, e) { for (let z = z0; z < z1; z++) P.edges.push(['W', x, z, e]); },
      edge(o, x, z, e) { P.edges.push([o, x, z, e]); },
      building(id, ox, oz, w, h, front, post) { P.blds.push({ id, ox, oz, front, post }); occ(ox - 1, oz - 1, ox + w + 1, oz + h + 1, 'b'); },
      // mueble centrado en (x, z), con el frente hacia (fx, fz); ex: más campos (col, open...)
      put(type, x, z, fx, fz, ex) {
        const t = G.Furniture.T[type], along = Math.abs(fz) > 0.5;
        const hw = (along ? t.w : t.d) / 2, hd = (along ? t.d : t.w) / 2;
        const f = Object.assign({ type, lv: 0, x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd, y: 0, h: t.h, fx, fz, solid: !t.deco, cont: null }, ex || {});
        // (fuera de los carriles de paso; ex.keep: puesto a propósito, se queda)
        if (!t.deco && !t.flat && !(ex && ex.keep) && !outOfLane(f)) return null;
        // si pisa algo que ya está, se corre un poco hacia un lado libre (y si no cabe en ningún sitio cerca, no se pone)
        if (!t.deco && !t.flat && overlaps(f)) {
          let ok = false;
          for (const d of [0.3, 0.55, 0.8, 1.1, 1.5, 2.0]) {
            for (let k = 0; k < 8 && !ok; k++) {
              const a = k * Math.PI / 4, dx = Math.round(Math.sin(a) * d * 100) / 100, dz = Math.round(Math.cos(a) * d * 100) / 100;
              const g = { x0: f.x0 + dx, x1: f.x1 + dx, z0: f.z0 + dz, z1: f.z1 + dz };
              if (!overlaps(g)) { Object.assign(f, g); ok = true; }
            }
            if (ok) break;
          }
          if (!ok) return null;
          if (!(ex && ex.keep) && inLane(f)) return null;
        }
        if (!t.deco && !t.flat) solids.push({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 });
        if (type === 'fachada') facades.push({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 });
        P.furn.push(f);
        if (!t.flat) occ(Math.floor(f.x0), Math.floor(f.z0), Math.ceil(f.x1), Math.ceil(f.z1), 'f');
        return f;
      },
      // ¿cabe un mueble ahí (con un margen libre alrededor)?
      fits(type, x, z, fx, fz, m) {
        const t = G.Furniture.T[type], along = Math.abs(fz) > 0.5;
        const hw = (along ? t.w : t.d) / 2, hd = (along ? t.d : t.w) / 2;
        m = m == null ? 1 : m;
        return free(Math.floor(x - hw) - m, Math.floor(z - hd) - m, Math.ceil(x + hw) + m, Math.ceil(z + hd) + m);
      },
      // contenedor: esquina (x, z) de su planta, eje 'x' o 'z', largo 6 o 12, pisos apilados (1 a 3)
      // o: { open: true (solo de un piso: puertas abiertas en el extremo final), cols: [colores por piso] }
      cont(x, z, axis, len, levels, o) {
        o = o || {};
        const w = axis === 'x' ? len : 2, d = axis === 'x' ? 2 : len;
        P.conts.push({ x, z, axis, len, levels: o.open ? 1 : levels, open: o.open || false, cols: o.cols || null, w, d, lod: o.lod || 0 });
        solids.push({ x0: x, x1: x + w, z0: z, z1: z + d });
        occ(x, z, x + w, z + d, 'c');
      },
      tree(x, z, pine) {
        if (inLane({ x0: x - 0.2, x1: x + 1.2, z0: z - 0.2, z1: z + 1.2 })) return;
        // (no encima de un mueble, ni pegado a una casa o a una fachada del horizonte: la copa se metería dentro)
        if (solids.some((b) => x + 0.5 > b.x0 - 0.35 && x + 0.5 < b.x1 + 0.35 && z + 0.5 > b.z0 - 0.35 && z + 0.5 < b.z1 + 0.35)) return;
        if (facades.some((b) => x + 0.5 > b.x0 - 1.6 && x + 0.5 < b.x1 + 1.6 && z + 0.5 > b.z0 - 1.6 && z + 0.5 < b.z1 + 1.6)) return;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (P.occ.get(key(x + dx, z + dz)) === 'b') return;
        P.obj.push([x, z, pine ? 2 : 1]); occ(x, z, x + 1, z + 1, 't'); trunks.push([x + 0.5, z + 0.5]);
      },
      bush(x, z) {
        if (inLane({ x0: x, x1: x + 1, z0: z, z1: z + 1 })) return;
        // (no dentro de un mueble ni de una casa)
        if (solids.some((b) => x + 0.5 > b.x0 - 0.2 && x + 0.5 < b.x1 + 0.2 && z + 0.5 > b.z0 - 0.2 && z + 0.5 < b.z1 + 0.2)) return;
        if (P.occ.get(key(x, z)) === 'b') return;
        P.obj.push([x, z, 4]);
      },
      pole(x, z) { if (inLane({ x0: x, x1: x + 1, z0: z, z1: z + 1 })) return; P.obj.push([x, z, 3]); occ(x, z, x + 1, z + 1, 't'); trunks.push([x + 0.5, z + 0.5]); },
      tall(x0, z0, x1, z1) { P.tall.push(['r', x0, z0, x1, z1]); },
      tallCircle(x, z, r) { P.tall.push(['c', x, z, r]); },
      puddle(x, z, w, d) { P.furn.push({ type: 'charco', lv: 0, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y: 0, h: 0.01, fx: 0, fz: 1, solid: false, cont: null }); }
    };
    return api;
  }

  // Porches y terrazas al aire (abiertos abajo, con barandilla arriba) y dos salidas como mínimo en cada
  // habitación: si le falta, se abre un hueco en una pared (hacia fuera en la planta baja, si no hacia otra
  // habitación). Así nunca te quedas encerrada
  function fixBuilding(c, bb, li, E, inC) {
    const bi = c.buildings.indexOf(bb) + 1, bp = bb.bp, floors = bb.floors || 1;
    for (const r of bb.rooms) if (r.type === 'terraza' || r.type === 'ruina') { r.on = false; r.noLamp = true; }
    const passable = (e, lv, out) => e === E.NONE || e === E.ARCH || e === E.DOOR || e === E.DOOR_OPEN || e === E.DOOR_BROKEN || e === E.GATE ||
      (!lv && out && (e === E.WIN || e === E.WIN_OPEN || e === E.WIN_BROKEN));
    for (let lv = 0; lv < floors; lv++) {
      const L = lv ? c.up : c;
      if (!L) continue;
      const base = bp.rooms.length;
      const typeOf = (r) => (lv ? bp.up.rooms[r - 1 - base] : bp.rooms[r - 1]) || { type: '' };
      const roomAt = (x, z) => (inC(x, z) && L.bld[li(x, z)] === bi ? L.rm[li(x, z)] : 0);
      const stair = (x, z) => inC(x, z) && c.stairMap && c.stairMap[li(x, z)];
      const sides = (x, z) => [
        { i: li(x, z), arr: L.eN, nx: x, nz: z - 1 }, { i: inC(x, z + 1) ? li(x, z + 1) : -1, arr: L.eN, nx: x, nz: z + 1 },
        { i: li(x, z), arr: L.eW, nx: x - 1, nz: z }, { i: inC(x + 1, z) ? li(x + 1, z) : -1, arr: L.eW, nx: x + 1, nz: z }];
      const rooms = new Map();
      for (let z = bb.z0; z < bb.z0 + bb.h; z++) for (let x = bb.x0; x < bb.x0 + bb.w; x++) {
        const r = roomAt(x, z);
        if (r) { if (!rooms.has(r)) rooms.set(r, []); rooms.get(r).push([x, z]); }
      }
      // porches y terrazas: al aire
      for (const [r, tl] of rooms) {
        const t = typeOf(r).type;
        if (t !== 'porche' && t !== 'terraza') continue;
        for (const [x, z] of tl) for (const sd of sides(x, z)) {
          if (sd.i < 0 || roomAt(sd.nx, sd.nz)) continue;
          sd.arr[sd.i] = lv ? E.RAIL : E.NONE;
        }
      }
      // dos salidas por habitación
      for (const [r, tl] of rooms) {
        if (typeOf(r).type === 'escalera') continue;
        if (typeOf(r).type === 'celda' && bb.kind === 'capitolio') continue;      // (las celdas del capitolio tienen una sola entrada: la de su bloque)
        for (let it = 0; it < 4; it++) {
          let n = 0; const nb = new Set(); const cand = [];
          for (const [x, z] of tl) for (const sd of sides(x, z)) {
            if (sd.i < 0) continue;
            const r2 = roomAt(sd.nx, sd.nz);
            if (r2 === r) continue;
            const e = sd.arr[sd.i];
            if (passable(e, lv, !r2)) { n++; nb.add(r2); }
            else if (e === E.WALL && (r2 || !lv) && !stair(x, z) && !stair(sd.nx, sd.nz)) cand.push({ sd, r2, x, z });
          }
          if (n >= 2 && (nb.size >= 2 || (!lv && nb.has(0)))) break;
          if (!cand.length) break;
          const cx = tl.reduce((a, q) => a + q[0], 0) / tl.length, cz = tl.reduce((a, q) => a + q[1], 0) / tl.length;
          const score = (q) => (nb.has(q.r2) ? 10 : 0) + (!lv && q.r2 === 0 ? -2 : 0) + Math.hypot(q.x - cx, q.z - cz) * 0.3;
          cand.sort((a, b) => score(a) - score(b));
          const q = cand[0];
          q.sd.arr[q.sd.i] = E.ARCH;
        }
      }
    }
  }

  function prims(id) {
    const m = MAPS[id];
    const vk = G.Quality && G.Quality.vegK ? G.Quality.vegK : 1;
    if (m.P && m.wild && !m.boss && m.Pveg !== vk) m.P = null;          // (cambió la vegetación: se rehace)
    if (!m.P) {
      m.Pveg = vk;
      const api = maker();
      api.lanes = m.lanes || [];
      m.build(api, U.mulberry32(m.seed || 7));
      if (m.wild && !m.boss) rewild(api, m, U.mulberry32((m.seed || 7) + 404));          // (en los del jefe, no: nada que le estorbe)
      // Opciones > Vegetación: fuera de la zona de juego (donde no se llega) quedan menos árboles, también los del
      // propio mapa; dentro solo se quitan los que añadió la naturaleza (los del mapa son coberturas pensadas)
      if (vk < 1 && !m.boss) {
        const B = m.bounds, out = (x, z) => (B ? x < B[0] || z < B[1] || x > B[2] || z > B[3] : x < m.min || z < m.min || x >= m.max || z >= m.max);
        api.P.obj = api.P.obj.filter((o) => !((o[2] === 1 || o[2] === 2) && out(o[0] + 0.5, o[1] + 0.5) && G.World.hash(o[0], o[1], 911) > vk));
      }
      m.P = api.P;
    }
    return m.P;
  }

  // ---------- Treinta años después ----------
  // En los mapas con naturaleza («wild»), los árboles han ido ganando terreno: arboledas en los jardines, los
  // solares y los bordes, y un bosque cerrado fuera de la valla que tapa el horizonte. Solo donde sobra sitio:
  // nunca en los caminos de paso, ni pegados a casas, muebles, coches o contenedores, ni cerca del punto de
  // salida; cada árbol nuevo deja libre un cuadrado de 5 x 5 m a su alrededor (no corta pasillos)
  function rewild(M, m, rng) {
    const P = M.P, F = G.World.F;
    const groundAt = (x, z) => {
      for (let i = P.ground.length - 1; i >= 0; i--) { const g = P.ground[i]; if (x >= g[0] && z >= g[1] && x < g[2] && z < g[3]) return g[4]; }
      return F.GRASS;
    };
    const sp = m.spawn, B = m.bounds, lo = m.min, hi = m.max;
    const inside = (x, z) => (B ? x >= B[0] && z >= B[1] && x <= B[2] && z <= B[3] : x >= lo && z >= lo && x < hi && z < hi);
    const nearSpawn = (x, z) => Math.hypot(x + 0.5 - sp.x, z + 0.5 - sp.z) < 6;
    const keep = (m.keepClear || []);
    // (lo que el modo usa en el mapa: el panel, los chasqueadores encadenados, las hogueras, las banderas y las
    // puertas de las celdas; ahí no crece nada que estorbe)
    const pts = [];
    if (m.board) pts.push([m.board.x, m.board.z, 2.5]);
    for (const c of m.clickers || []) pts.push([c.x, c.z, (c.r || 1.5) + 2]);
    for (const f of m.fires || []) pts.push(f.length >= 4 ? [f[0], f[2], 2.5] : [f[0], f[1], 2.5]);
    for (const f of m.flags || []) pts.push([f[0], f[1], 2]);
    for (const c of m.cells || []) if (c.door) pts.push([c.door.x, c.door.z, 3.5]);
    const kept = (x, z) => keep.some((k) => x >= k[0] && z >= k[1] && x < k[2] && z < k[3]) || pts.some((q) => Math.hypot(x + 0.5 - q[0], z + 0.5 - q[1]) < q[2]);
    const W = m.wild;
    // dentro: en la hierba (y en la tierra si no es arena), con huecos grandes alrededor
    const step = 4;
    let n = 0;
    for (let z = (lo | 0) + 1; z < hi - 1; z += step) {
      for (let x = (lo | 0) + 1; x < hi - 1; x += step) {
        const jx = x + Math.floor(rng() * step), jz = z + Math.floor(rng() * step);
        if (!inside(jx, jz) || nearSpawn(jx, jz) || kept(jx, jz)) continue;
        const g = groundAt(jx, jz);
        if (g !== F.GRASS && !(g === F.DIRT && !m.sandDirt)) continue;
        // arboledas: el ruido decide dónde hay bosquecillo y dónde claro
        const k = G.World.vnoise(jx / 9, jz / 9, 707);
        if (rng() > W * (k > 0.55 ? 0.75 : 0.18)) continue;
        if (G.World.hash(jx, jz, 909) > m.Pveg) continue;                                          // (Opciones > Vegetación)
        if (!M.free(jx - 2, jz - 2, jx + 3, jz + 3)) continue;
        M.tree(jx, jz, m.winter ? rng() < 0.6 : rng() < 0.22);
        n++;
      }
    }
    // fuera de la valla: bosque cerrado (no se llega; tapa el horizonte con copas grandes)
    if (m.forest !== false) {
      const X0 = Math.floor((B ? B[0] : lo) / 32) * 32, X1 = Math.ceil((B ? B[2] : hi) / 32) * 32;
      const Z0 = Math.floor((B ? B[1] : lo) / 32) * 32, Z1 = Math.ceil((B ? B[3] : hi) / 32) * 32;
      for (let z = Z0; z < Z1; z += 3) {
        for (let x = X0; x < X1; x += 3) {
          const jx = x + Math.floor(rng() * 3), jz = z + Math.floor(rng() * 3);
          // (a dos metros y medio del borde de dentro como poco, y lejos del punto de salida)
          const ex = B ? Math.max(B[0] - jx, jx - B[2], 0) : Math.max(lo - jx, jx - hi, 0), ez = B ? Math.max(B[1] - jz, jz - B[3], 0) : Math.max(lo - jz, jz - hi, 0);
          if (Math.hypot(ex, ez) < 2.5) continue;
          if (Math.hypot(jx + 0.5 - sp.x, jz + 0.5 - sp.z) < 9 || kept(jx, jz)) continue;
          const seaZ = m.seaZ || (m.skyline && m.skyline.beach ? 89.6 : null);
          if (seaZ && jz > seaZ - 26) continue;                                 // (no en la playa ni en el mar)
          const g = groundAt(jx, jz);
          if (g === F.ROAD || g === F.SIDEWALK || (g === F.DIRT && m.sandDirt)) continue;
          if (rng() > 0.55 + W * 0.4) continue;
          if (G.World.hash(jx, jz, 909) > m.Pveg) continue;                                        // (Opciones > Vegetación)
          if (!M.free(jx, jz, jx + 1, jz + 1)) continue;
          M.tree(jx, jz, m.winter ? rng() < 0.75 : rng() < 0.45);
          if (rng() < 0.5) M.bush(jx + (rng() < 0.5 ? 1 : -1), jz);
        }
      }
    }
    return n;
  }

  // ---------- Aplicar a un chunk ----------
  // phase 'base': suelo, muros, edificios, contenedores (aristas y techos), árboles e hierba alta
  // phase 'props': muebles, vehículos y los modelos de los contenedores (después de amueblar los edificios)
  function apply(id, c, cx, cz, rng, W, phase) {
    const P = prims(id), CS = G.World.CS, E = G.World.E;
    const X0 = cx * CS, Z0 = cz * CS;
    const inC = (x, z) => x >= X0 && z >= Z0 && x < X0 + CS && z < Z0 + CS;
    const li = (x, z) => (z - Z0) * CS + (x - X0);
    if (phase === 'base') {
      for (const [x0, z0, x1, z1, g] of P.ground) {
        for (let z = Math.max(z0, Z0); z < Math.min(z1, Z0 + CS); z++) for (let x = Math.max(x0, X0); x < Math.min(x1, X0 + CS); x++) c.ground[li(x, z)] = g;
      }
      // contenedores: costados (aristas) y techos transitables
      for (const k of P.conts) {
        const x1 = k.x + k.w, z1 = k.z + k.d;
        const deckH = k.open ? 0 : Math.round(k.levels * LEVEL_H * 10);
        for (let z = k.z; z < z1; z++) {
          for (let x = k.x; x < x1; x++) {
            if (!inC(x, z)) continue;
            if (deckH) { if (!c.deck) c.deck = new Uint8Array(CS * CS); c.deck[li(x, z)] = Math.max(c.deck[li(x, z)], deckH); }
            else { if (!c.croof) c.croof = new Uint8Array(CS * CS); c.croof[li(x, z)] = Math.round(LEVEL_H * 10); }   // abierto: techo por dentro
            c.tall[li(x, z)] = 0;
          }
        }
        // abierto: las puertas del extremo final (o de los dos extremos: un túnel que se cruza)
        const endA = k.open === 'both', endB = !!k.open;
        for (let x = k.x; x < x1; x++) {
          if (inC(x, k.z) && !(k.axis === 'z' && endA)) c.eN[li(x, k.z)] = E.CONT;
          if (inC(x, z1) && !(k.axis === 'z' && endB)) c.eN[li(x, z1)] = E.CONT;
        }
        for (let z = k.z; z < z1; z++) {
          if (inC(k.x, z) && !(k.axis === 'x' && endA)) c.eW[li(k.x, z)] = E.CONT;
          if (inC(x1, z) && !(k.axis === 'x' && endB)) c.eW[li(x1, z)] = E.CONT;
        }
      }
      for (const [o, x, z, e] of P.edges) {
        if (!inC(x, z)) continue;
        (o === 'N' ? c.eN : c.eW)[li(x, z)] = e;
      }
      for (const b of P.blds) {
        if (!inC(b.ox, b.oz)) continue;
        const bb = W.placeBuilding(b.id, b.ox - X0, b.oz - Z0, b.front);
        // en los mapas no hay puertas: los huecos quedan abiertos. Salvo en el salón recreativo (jefe final): ahí
        // las puertas están (abiertas al empezar), porque el hongomorfo no cabe por ellas
        const keep = !!(bb.bp && bb.bp.def && bb.bp.def.breakable);
        const to = keep ? E.DOOR_OPEN : E.ARCH;
        for (let z = bb.z0; z <= bb.z0 + bb.h; z++) {
          for (let x = bb.x0; x <= bb.x0 + bb.w; x++) {
            if (!inC(x, z)) continue;
            const i = li(x, z);
            if (c.eN[i] === E.DOOR || c.eN[i] === E.DOOR_OPEN || c.eN[i] === E.DOOR_BROKEN) c.eN[i] = to;
            if (c.eW[i] === E.DOOR || c.eW[i] === E.DOOR_OPEN || c.eW[i] === E.DOOR_BROKEN) c.eW[i] = to;
          }
        }
        if (b.post) b.post(c, bb, (x, z) => li(x, z), E);
        if (MAPS[id].escape2) fixBuilding(c, bb, li, E, inC);
        // con relieve: el suelo alrededor, a la altura de la base (una casilla) y una de transición
        if (MAPS[id].height) {
          const R1 = CS + 1;
          for (let z = bb.oz - 2; z <= bb.oz + bb.h + 2; z++) for (let x = bb.ox - 2; x <= bb.ox + bb.w + 2; x++) {
            if (x < 0 || z < 0 || x > CS || z > CS) continue;
            const dd = Math.max(bb.ox - x, x - (bb.ox + bb.w), bb.oz - z, z - (bb.oz + bb.h), 0), i = z * R1 + x;
            if (dd <= 1) c.th[i] = bb.baseY - 0.05; else c.th[i] = (c.th[i] + bb.baseY - 0.05) / 2;
          }
        }
      }
      for (const [x, z, o] of P.obj) if (inC(x, z)) { c.obj[li(x, z)] = o; c.tall[li(x, z)] = 0; }
      for (let z = Z0; z < Z0 + CS; z++) {
        for (let x = X0; x < X0 + CS; x++) {
          const i = li(x, z);
          if (c.bld[i] || c.ground[i] === G.World.F.ROAD) continue;
          if (c.deck && c.deck[i]) continue;
          for (const t of P.tall) {
            const hit = t[0] === 'r' ? (x >= t[1] && z >= t[2] && x < t[3] && z < t[4]) : Math.hypot(x + 0.5 - t[1], z + 0.5 - t[2]) < t[3];
            if (hit) { if (MAPS[id].tallGrass && c.ground[i] !== G.World.F.SIDEWALK) c.tall[i] = 1; break; }   // (solo en los mapas que la piden)
          }
        }
      }
      return;
    }
    // ----- muebles, vehículos y contenedores -----
    for (const f of P.furn) {
      const cxm = (f.x0 + f.x1) / 2, czm = (f.z0 + f.z1) / 2;
      if (!inC(Math.floor(cxm), Math.floor(czm))) continue;
      const g = Object.assign({}, f, { seed: Math.floor(rng() * 1e9) });
      if (G.Furniture.T[f.type].vehicle) g.vehicle = true;
      // sobre el relieve del mapa (lo de dentro de un edificio, a la altura de su suelo)
      if (MAPS[id].height) {
        const lx = cxm - X0, lz = czm - Z0, R1 = CS + 1, ix = Math.min(CS - 1, Math.floor(lx)), iz = Math.min(CS - 1, Math.floor(lz)), tx = lx - ix, tz = lz - iz;
        const a = c.th[iz * R1 + ix], b = c.th[iz * R1 + ix + 1], d = c.th[(iz + 1) * R1 + ix], e = c.th[(iz + 1) * R1 + ix + 1];
        const bi = c.bld[li(Math.floor(cxm), Math.floor(czm))];
        g.y = bi ? c.buildings[bi - 1].baseY - 0.04 : (a + (b - a) * tx) * (1 - tz) + (d + (e - d) * tx) * tz;
        if (f.yOff) g.y += f.yOff;                 // (algo encima de otra cosa: un coche sobre otro)
      }
      c.furn.push(g);
    }
    for (const k of P.conts) {
      const cxm = k.x + k.w / 2, czm = k.z + k.d / 2;
      if (!inC(Math.floor(cxm), Math.floor(czm))) continue;
      for (let l = 0; l < k.levels; l++) {
        const type = k.len >= 12 ? 'cont12' : 'cont6';
        const along = k.axis === 'z';          // el largo va en z: el frente mira a x
        c.furn.push({
          type, lv: 0, x0: k.x + 0.03, x1: k.x + k.w - 0.03, z0: k.z + 0.03, z1: k.z + k.d - 0.03, y: l * LEVEL_H, h: LEVEL_H,
          fx: along ? 1 : 0, fz: along ? 0 : 1, solid: false, cont: null, seed: Math.floor(rng() * 1e9),
          col: k.cols ? k.cols[l % k.cols.length] : undefined, open: l === 0 ? k.open : false, lod: k.lod
        });
      }
    }
  }

  // =====================================================================================================
  // Terminal de carga: un patio de contenedores apilados (de uno a tres de alto) con callejones y algún
  // contenedor abierto que se cruza como un túnel. Un solo interior, grande y alto: la nave del taller al
  // noroeste (donde se empieza), con un taller y un almacén al fondo, sin puertas. Montacargas, camionetas,
  // tanques, palés, lonas, barreras de hormigón, charcos y hierba alta. Valla de alambre con espino y, detrás,
  // pilas altas de contenedores y galpones que tapan la vista (como en el vídeo)
  // =====================================================================================================
  MAPS.terminal = {
    wild: 0.5, name: 'Terminal de carga', min: 6, max: 46, spawn: { x: 16.5, z: 21.5 }, seed: 4242, fence: 'chain',
    // carriles de paso que quedan siempre libres (calles y aceras principales)
    lanes: [[6, 20.5, 46, 22.5], [28.5, 6, 31.5, 46], [6, 34.6, 46, 36.4]],
    board: { x: 14.2, z: 19.15, fx: 0, fz: 1 },        // modo libre: el panel de los mapas (contra la nave)
    // luz: cielo cubierto, gris azulado, con algo de neblina (como en el vídeo)
    mood: { sky: 0x939ea4, fog: 0.8, hemi: [0xc2cace, 0x4c4a40, 0.74], sun: [0xe6ecee, 0.62],
      ground: { 0: [0x5a6a3c, 0x6e7646], 3: [0x5e5444, 0x6a604c], 1: [0x4a4b4c, 0x535352] } },
    skyline: { col: 0x7d888e, h: [8, 26], cranes: [0.7, 1.1, 4.2], towers: [0.25] },
    build(M, rng) {
      const F = G.World.F;
      // Recinto de 40 x 40 m (más recogido: el combate se mantiene cerca). Una calle principal este-oeste
      // delante de la nave, una calle norte-sur y una transversal al sur; entre ellas, patios de contenedores
      M.ground(0, 0, 64, 64, F.DIRT);
      M.ground(6, 6, 28, 20, F.ROAD);          // explanada de la nave
      M.ground(6, 20, 46, 23, F.ROAD);         // calle principal
      M.ground(28, 6, 32, 46, F.ROAD);         // calle norte-sur
      M.ground(6, 34, 46, 37, F.ROAD);         // calle del sur
      for (const [x0, z0, x1, z1] of [[33, 7, 46, 20], [7, 24, 28, 34], [32, 24, 46, 34], [7, 37, 28, 46], [32, 37, 46, 46]]) M.ground(x0, z0, x1, z1, F.GRASS);

      // la nave del taller: grande (20 x 12) y alta (6 m), con dos portones abiertos al sur, uno al este y huecos
      // sin puertas hacia el taller y el almacén del fondo
      M.building('nave_t', 7, 7, 20, 12, 'S', (c, b, li, E2) => {
        for (const x of [9, 10, 11, 12, 16, 17, 18, 19]) c.eN[li(x, 19)] = E2.GATE;
        for (const z of [9, 10, 11]) c.eW[li(27, z)] = E2.GATE;
        for (const z of [8, 9, 10, 14, 15, 16, 17]) c.eW[li(21, z)] = E2.ARCH;
        for (const x of [23, 24]) c.eN[li(x, 13)] = E2.ARCH;
      });
      M.put('persiana', 13.0, 6.92, 0, -1); M.put('persiana', 21.5, 6.92, 0, -1); M.put('persiana', 6.92, 13.5, -1, 0);

      // ----- vehículos (antes que los contenedores: estos no se les echan encima) -----
      M.put('montacargas', 29.5, 21.5, 1, 0);
      M.put('camioneta', 39.5, 21.5, -1, 0);
      M.put('coche', 30.0, 13.5, 0, 1);
      M.put('montacargas', 30.0, 30.5, 0, 1);
      M.put('camioneta', 30.0, 42.0, 0, -1);
      M.put('montacargas', 21.5, 35.5, 1, 0);
      M.put('coche', 40.0, 35.5, -1, 0);
      // barreras de hormigón y tanques junto al inicio (como en la entrada del vídeo)
      M.put('barrera', 9.0, 22.5, 0, 1); M.put('barrera', 11.2, 22.5, 0, 1);
      M.put('ibc', 23.5, 21.5, 0, 1); M.put('ibc', 24.8, 21.5, 0, 1);

      // ----- patios de contenedores -----
      // Cada contenedor va SUELTO: nunca pegado a otro ni por los costados ni por los extremos (al menos 2 m
      // libres alrededor), así se ve entero y por encima no hay rendijas por las que colarse. Se apilan solo
      // en vertical (de uno a tres de alto). Filas separadas por callejones de 3 m
      const pickLv = () => { const r = rng(); return r < 0.45 ? 1 : (r < 0.85 ? 2 : 3); };
      const fill = (x0, z0, x1, z1, ax) => {
        const across0 = ax === 'x' ? z0 : x0, across1 = ax === 'x' ? z1 : x1;
        const along0 = ax === 'x' ? x0 : z0, along1 = ax === 'x' ? x1 : z1;
        for (let r = across0; r + 2 <= across1; r += 5) {
          let a = along0 + Math.floor(rng() * 2);
          while (a + 6 <= along1) {
            if (rng() < 0.1) { a += 3; continue; }                       // hueco más ancho
            const len = along1 - a >= 12 && rng() < 0.35 ? 12 : 6;
            const op = len === 6 && rng() < 0.15 ? (rng() < 0.5 ? 'both' : true) : false;
            const w = ax === 'x' ? len : 2, d = ax === 'x' ? 2 : len;
            const cx = ax === 'x' ? a : r, cz = ax === 'x' ? r : a;
            // 2 casillas libres alrededor
            if (M.free(cx - 2, cz - 2, cx + w + 2, cz + d + 2)) {
              M.cont(cx, cz, ax, len, op ? 1 : pickLv(), { open: op });
              a += len + 2 + (rng() < 0.3 ? 1 : 0);
            } else a += 1;
          }
        }
      };
      fill(33, 7, 46, 20, 'x');
      fill(7, 24, 28, 34, 'x');
      fill(33, 24, 46, 34, 'z');
      fill(7, 37, 28, 46, 'z');
      fill(33, 37, 46, 46, 'x');

      // ----- fuera de la valla: pilas altas de contenedores y galpones que tapan la vista -----
      // (aquí sí van en fila, pegados: no se puede llegar)
      const ring = (x0, z0, x1, z1, ax, lo, hi) => {
        const along0 = ax === 'x' ? x0 : z0, along1 = ax === 'x' ? x1 : z1, r = ax === 'x' ? z0 : x0;
        for (let a = along0; a + 6 <= along1;) {
          const len = along1 - a >= 12 && rng() < 0.5 ? 12 : 6;
          const lv = lo + Math.floor(rng() * (hi - lo + 1));
          if (ax === 'x') M.cont(a, r, 'x', len, lv, { lod: 1 }); else M.cont(r, a, 'z', len, lv, { lod: 1 });
          a += len;
        }
      };
      ring(0, 1, 33, 3, 'x', 3, 4); ring(4, 3, 33, 5, 'x', 2, 3);
      ring(47, 1, 59, 3, 'x', 3, 4);
      M.put('galpon', 40.0, 2.5, 0, 1);
      ring(4, 47, 48, 49, 'x', 2, 3); ring(0, 49, 56, 51, 'x', 3, 4);
      ring(1, 5, 3, 47, 'z', 3, 4); ring(3, 6, 5, 46, 'z', 2, 3);
      ring(49, 3, 51, 49, 'z', 3, 4); ring(47, 6, 49, 46, 'z', 2, 3);

      // ----- dentro de la nave: palés con cajas y bultos en el centro -----
      M.put('palets', 12.5, 12.5, 1, 0); M.put('lona', 15.0, 12.5, 0, 1); M.put('palets', 17.5, 14.5, 0, 1);
      M.put('bidones', 12.5, 15.5, 1, 0);

      // ----- cosas sueltas por el patio (donde quepan) -----
      const scatter = (type, n, m) => {
        for (let k = 0, tries = 0; k < n && tries < 400; tries++) {
          const x = 8 + Math.floor(rng() * 36) + 0.5, z = 8 + Math.floor(rng() * 36) + 0.5;
          const fx = rng() < 0.5 ? 1 : 0, fz = fx ? 0 : 1;
          if (!M.fits(type, x, z, fx, fz, m)) continue;
          M.put(type, x, z, fx, fz);
          k++;
        }
      };
      M.put('lona', 28.2, 18.0, 1, 0);
      // (menos que antes y solo donde sobra sitio: los callejones entre contenedores quedan libres para pasar)
      scatter('ibc', 3, 2); scatter('palets', 4, 2); scatter('lona', 3, 2); scatter('barrera', 3, 2);
      scatter('bidones', 3, 2); scatter('tubo', 1, 2); scatter('bloques', 2, 2);
      for (let k = 0, tries = 0; k < 11 && tries < 300; tries++) {
        const x = 8 + rng() * 36, z = 8 + rng() * 36;
        if (!M.free(Math.floor(x - 1.5), Math.floor(z - 1), Math.ceil(x + 1.5), Math.ceil(z + 1))) continue;
        M.puddle(x, z, 2 + rng() * 3, 1.5 + rng() * 2); k++;
      }
      for (let k = 0; k < 22; k++) M.tallCircle(8 + rng() * 36, 8 + rng() * 36, 1.8 + rng() * 3.0);
      for (const [x, z] of [[7, 21], [45, 7], [45, 22], [7, 45], [45, 45], [27, 45], [45, 33], [7, 34]]) if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, true);
      for (const [x, z] of [[28, 7], [32, 9], [32, 23], [32, 38], [27, 24]]) if (M.free(x, z, x + 1, z + 1)) M.pole(x, z);
    }
  };
  // (fachadas viejas: el color de las paredes y del tejado, y el desgaste)
  const paint = (sid, roof) => (c, b) => { b.siding = sid; if (roof) b.roofColor = roof; b.worn = true; };


  // =====================================================================================================
  // Supermercado (48 x 48): un súper grande abandonado con el techo hundido por partes. Por los agujeros entró
  // la nieve: montones debajo y una capa por el suelo, vigas y planchas caídas y el aire acondicionado del techo
  // en medio de la fruta. Se empieza en el almacén de atrás (oscuro). Sala de ventas: vitrinas refrigeradas en
  // la pared del fondo, pasillos de góndolas vacías (alguna caída), la zona de fruta con fruteros de madera y
  // cajas, una zona de arcones congeladores tapados de nieve y las cajas registradoras delante. Fuera, el
  // aparcamiento nevado con coches, carritos y farolas, y un callejón de carga detrás. Edificios y pinos tapan
  // el horizonte
  // =====================================================================================================
  MAPS.super = {
    wild: 0.3, winter: true, name: 'Supermercado', min: 2, max: 50, spawn: { x: 8.5, z: 10.5 }, seed: 5150, fence: 'chain', escape2: true,
    // carriles de paso que quedan siempre libres (calles y aceras principales)
    lanes: [[2, 30.3, 50, 32.7], [2, 4.2, 34, 5.8]],
    board: { x: 6.0, z: 31.3, fx: 0, fz: 1 },             // modo libre: el panel de los mapas (en la acera de delante)
    // luz: invierno, cielo blanco grisáceo y neblina fría (dentro, la luz entra por el techo roto)
    mood: { sky: 0x9aa2a8, fog: 1.15, hemi: [0xb4bcc4, 0x40444a, 0.58], sun: [0xdfe6ee, 0.36],
      ground: { 0: [0xdfe3e6, 0xe9ecee], 1: [0x55595e, 0x5f6368], 2: [0x9ea2a6, 0xa8acb0], 3: [0x7a7670, 0x847f78] } },
    skyline: { col: 0x8a9298, h: [8, 22] },
    build(M, rng) {
      const F = G.World.F;
      const R = (a, b) => a + rng() * (b - a);
      M.ground(0, 0, 64, 64, F.GRASS);                 // (la hierba aquí es nieve)
      M.ground(2, 33, 50, 50, F.ROAD);                 // aparcamiento
      M.ground(2, 30, 50, 33, F.SIDEWALK);             // acera delante del súper
      M.ground(2, 2, 34, 8, F.ROAD);                   // callejón de carga
      // ---- el edificio: dos mitades unidas en x = 32 ----
      const front = (c, b, li, E2) => {
        b.worn = true;
        for (const r of b.rooms) if (r.type === 'super') r.on = rng() < 0.3;
        // escaparate: ventanas en la fachada de la sala (sin tocar las puertas ni lo de al lado)
        const z = b.z0 + b.h;
        for (let x = b.x0 + 1; x < b.x0 + b.w - 1; x++) {
          const e = c.eN[li(x, z)], l = c.eN[li(x - 1, z)], r = c.eN[li(x + 1, z)];
          const isDoor = (q) => q === E2.DOOR || q === E2.ARCH || q === E2.DOOR_OPEN;
          if (e === E2.WALL && !isDoor(l) && !isDoor(r) && (x - b.x0) % 3 !== 0) c.eN[li(x, z)] = E2.WIN_OPEN;
        }
      };
      M.building('super_w', 4, 8, 28, 22, 'S', front);
      M.building('super_e', 32, 8, 14, 22, 'S', (c, b, li, E2) => {
        front(c, b, li, E2);
        // la pared que da a la otra mitad: abierta en la sala; en el almacén, un hueco a la cámara
        for (let z = 13; z < 30; z++) c.eW[li(32, z)] = E2.NONE;
        c.eW[li(32, 10)] = E2.NONE;
      });

      // ---- sala de ventas ----
      // vitrinas refrigeradas en la pared del fondo (sin tapar las puertas del almacén)
      for (const x of [5.2, 7.3, 13.0, 15.1, 22.0, 24.1, 30.1, 34.0, 36.1, 42.2, 44.3]) M.put('vitrina', x, 13.5, 0, 1);
      // pasillos de góndolas (bajo el primer agujero del techo, caídas)
      for (const z of [16.5, 22.6]) { M.put('gondola', 7.0, z, 1, 0); M.put('gondola', 10.4, z, 1, 0); M.put('gondola', 13.8, z, 1, 0); }
      M.put('gondola', 7.0, 19.55, 1, 0);
      M.put('gondola_caida', 10.6, 19.6, 1, 0);          // (una sola caída: el pasillo del otro lado queda libre)
      for (const z of [16.2, 19.4, 22.6]) M.put('gondola', 45.35, z, -1, 0);
      for (const [x, z] of [[8.7, 19.5], [12.1, 17.0], [27.0, 19.0], [40.0, 23.5]]) M.put('cartel_colgante', x, z, 1, 0, { hang: 3.7 });
      // agujero 1: nieve y vigas sobre los pasillos
      M.put('nieve', 12.5, 19.2, 0, 1, { x0: 9.0, x1: 16.0, z0: 16.4, z1: 22.4 });
      M.put('monton_nieve', 12.4, 18.9, 0, 1, { x0: 11.6, x1: 13.2, z0: 18.2, z1: 19.6, h: 0.55 });
      // zona de fruta: fruteros y cajas; agujero 2 con el aire acondicionado caído encima
      for (const [x, z] of [[18.8, 16.8], [22.6, 16.8], [26.4, 16.8], [18.8, 20.0]]) M.put('frutero', x, z, 0, 1);
      M.put('frutero', 29.6, 20.4, 1, 0);
      for (const [x, z] of [[29.0, 24.6]]) M.put('cajas_fruta', x, z, 0, 1);
      M.put('nieve', 23.0, 23.0, 0, 1, { x0: 19.0, x1: 27.5, z0: 20.6, z1: 26.6 });
      M.put('aire_caido', 22.6, 22.6, 0, 1);
      M.put('monton_nieve', 25.4, 24.4, 0, 1, { x0: 24.0, x1: 27.0, z0: 23.3, z1: 25.5, h: 0.6 });
      M.put('vigas', 21.4, 22.6, 0, 1, { x0: 20.4, x1: 22.6, z0: 22.0, z1: 23.2, h: 1.0 });
      M.put('escombro_grande', 26.8, 21.6, 0, 1);
      // zona de congeladores (lado este), con el tercer agujero
      M.put('nieve', 38.5, 21.5, 0, 1, { x0: 33.0, x1: 44.0, z0: 15.0, z1: 28.0 });
      M.put('monton_nieve', 37.5, 18.5, 0, 1, { x0: 36.0, x1: 39.2, z0: 17.2, z1: 19.8, h: 0.8 });
      for (const [x, z, fx, fz] of [[34.2, 24.4, 0, 1], [37.2, 24.4, 0, 1], [41.6, 17.2, 1, 0], [42.8, 21.6, 0, 1], [40.4, 26.4, 0, 1], [34.6, 16.4, 0, 1]]) M.put('congelador', x, z, fx, fz);
      M.put('vigas', 39.6, 21.0, 1, 0, { x0: 38.8, x1: 40.4, z0: 19.4, z1: 22.4, h: 1.2 });
      // cajas registradoras delante (sin tapar las tres entradas)
      for (const x of [6.2, 15.0, 18.4, 21.8, 29.0, 33.4, 43.2]) M.put('caja_reg', x, 27.6, 0, 1);
      for (const [x, z] of [[26.6, 25.4], [41.0, 25.6]]) M.put('carrito', x, z, R(-1, 1) < 0 ? 1 : -1, 0);
      M.put('escombros', 30.4, 22.0, 0, 1, { x0: 29.6, x1: 31.2, z0: 21.4, z1: 22.6 });

      // ---- fuera: aparcamiento nevado ----
      for (const [t, x, z, fx, fz] of [['coche', 8, 37.5, 0, 1], ['coche', 14.5, 38.0, 0, -1], ['camioneta', 26, 38.2, 0, -1], ['coche', 33.0, 44.6, 1, 0], ['coche', 45.0, 38.0, 0, 1], ['camion', 40.0, 46.0, 1, 0]]) M.put(t, x, z, fx, fz, t === 'coche' ? { col: U.pick(rng, [0x6a7480, 0x8a3a30, 0x4a5a4a, 0xb8b4a8]) } : null);
      for (const [x, z] of [[18.0, 35.2], [19.2, 41.0], [30.4, 36.0], [47.2, 35.0], [11.0, 33.8]]) M.put('carrito', x, z, 0, rng() < 0.5 ? 1 : -1);
      for (const [x, z] of [[12, 41], [28, 41], [44, 41]]) M.pole(x, z);
      for (const [x, z, w, d, h] of [[5.5, 46.5, 3.4, 2.4, 0.7], [22.0, 46.8, 4.0, 2.2, 0.6], [48.0, 43.0, 2.4, 3.6, 0.8], [3.4, 31.6, 2.6, 2.0, 0.5]]) M.put('monton_nieve', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h });
      for (let k = 0; k < 14; k++) { const x = R(4, 48), z = R(34, 48), w = R(2, 5), d = R(1.2, 3); M.put('nieve', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }); }
      // ---- callejón de carga (detrás) ----
      M.put('cubos', 16.0, 3.4, 0, 1); M.put('cubos', 18.0, 3.4, 0, 1); M.put('palets', 6.4, 4.0, 0, 1); M.put('palets', 7.8, 4.2, 0, 1);
      M.put('camioneta', 27.0, 4.6, 1, 0, { col: 0x9a9890 }); M.put('bidones', 22.2, 3.2, 0, 1);
      M.put('monton_nieve', 12.0, 4.0, 0, 1, { x0: 10.6, x1: 13.4, z0: 2.9, z1: 5.1, h: 0.5 });
      // ---- fuera de la valla: edificios y pinos que tapan el horizonte ----
      M.put('fachada', 18.0, 0.0, 0, 1, { x0: 2.0, x1: 34.0, z0: -1.8, z1: 1.8, h: 12.5, style: 1 });
      M.put('fachada', 0.0, 30.0, 1, 0, { x0: -1.8, x1: 1.8, z0: 6.0, z1: 54.0, h: 14.0, style: 0 });
      M.put('fachada', 53.4, 16.0, -1, 0, { x0: 51.6, x1: 55.2, z0: 2.0, z1: 30.0, h: 11.0, style: 2 });
      M.put('fachada', 22.0, 53.4, 0, -1, { x0: 8.0, x1: 36.0, z0: 51.6, z1: 55.2, h: 10.0, style: 1 });
      for (let a = 0; a < 64; a += 2) for (const off of [52, 55, 58]) {
        const j = Math.floor(rng() * 2);
        for (const [x, z] of [[off + j, a], [a + 1, off + j]]) if (x >= 0 && z >= 0 && x < 64 && z < 64 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, true);
      }
    }
  };

  // =====================================================================================================
  // Asentamiento en la playa (inspirado en la pantalla de inicio): la playa al sur con el bote varado y una
  // balsa, palmeras y rocas; al oeste un montículo de tierra y arena seca; árboles, arbustos y hierba de
  // otoño; y en el centro el asentamiento de los Escorpiones, cerrado por un muro pero con un portón que da a la
  // playa. Dentro: el museo (vestíbulo enorme con un esqueleto de dinosaurio y dos salas detrás: dormitorio y
  // armería) y un patio amplio con terrazas a distinta altura (huerto al oeste, tiendas y contenedores apilados
  // al este), la sala de vigilancia en el medio, una hoguera encendida, banderas con el escorpión y todo
  // ordenado: viven aquí y se nota que acaban de estar. A lo lejos, el faro (en el horizonte, como en el
  // inicio). El mar, las llamas, el humo, las banderas y el faro los pone G.Maps.decor / skyline
  // =====================================================================================================
  // La montaña del este de la playa: sube desde el muro (x 77) hasta pasado el borde, con crestas y barrancos;
  // al acercarse al mar se corre hacia el este y cae en un cabo de roca. También cierra un poco la esquina norte
  function playaMount(x, z) {
    const V = G.World.vnoise, C = U.clamp;
    const x0 = 78 + C((z - 60) / 24, 0, 1) * 8;               // el pie de la montaña (se va al este junto al mar)
    const t = C((x - x0) / 14, 0, 1);
    const north = C((x - 58) / 20, 0, 1) * C((7 - z) / 7, 0, 1);
    if (t <= 0 && north <= 0) return 0;
    const ridge = V(x / 9, z / 9, 711), gully = V(x / 4.5, z / 4.5, 712) - 0.5, wave = 0.75 + 0.5 * V(z / 13, 1.7, 713);
    let h = 1.2 + Math.pow(t, 1.25) * 9.5 * wave + ridge * 2.2 * t + gully * 0.9 * t;
    h += Math.max(0, x - x0 - 14) * 0.7 * wave;                  // (pasado el borde sigue subiendo: la cumbre)
    h = Math.max(h, 1.2 + north * (3.2 + ridge * 1.5));
    // al mar: el cabo baja en acantilado
    h *= C((91 - z) / 5, 0, 1);
    return h;
  }
  MAPS.playa = {
    wild: 0.6, sandDirt: true, name: 'Asentamiento en la playa', min: 4, max: 92, bounds: [20.05, 8.05, 75.95, 89.4],
    // (donde salen los enemigos: dentro del asentamiento, no en la playa ni fuera)
    play: [[21, 9, 75, 61]], enemyMul: 1.5, spawn: { x: 48.5, z: 82.5 }, seed: 6161, fence: 'none', tallGrass: true, escape2: true, autumn: true,     // (enemyMul: grande, la mitad más de enemigos)
    board: { x: 50.5, z: 80.0, fx: 0, fz: -1 },
    // atardecer cálido (como la pantalla de inicio): cielo anaranjado, sol bajo, la niebla lejos
    wallCol: 0xa09482,            // muro del asentamiento: hormigón viejo, tostado
    mood: { sky: 0xf4d6bc, fog: 1.3, hemi: [0xf2c8a0, 0x5a4a3a, 0.74], sun: [0xffc48a, 1.0],
      ground: { 0: [0x7c7546, 0x88804c], 1: [0x5e5a52, 0x67625a], 2: [0xa69c8a, 0xb2a894], 3: [0xc8ac82, 0xd4b88e] } },
    skyline: { beach: true, col: 0x8c7f7c },
    // dónde van las banderas (x, z, hacia dónde ondean), las hogueras y barriles encendidos y los estandartes
    flags: [[37.2, 63.2, 0], [46.8, 63.2, 0], [35.6, 31.8, 0], [60.4, 31.8, 0], [22.6, 59.4, 1, 1.3], [73.4, 59.4, 1, 1.3], [48.6, 71.0, 2, 1.3], [52.6, 41.4, 3]],
    fires: [[40.5, 53.5, 1], [24.5, 25.5, 0], [70.5, 46.5, 0]],
    banners: [[38.0, 30.06], [48.0, 30.06], [58.0, 30.06]],
    // el tablón de la entrada: los que llegaron del asentamiento de Oceanside (el mapa del mismo nombre)
    murals: [{ kind: 'board', text: 'LLEGADOS DE OCEANSIDE\nDormitorio: sala oeste\nArmas: a la armería\nNadie duerme fuera', x: 36.445, z: 58.6, y: 1.45, w: 2.25, h: 1.1, ry: Math.PI / 2 }],
    // relieve: el patio (1 m) por encima de la playa; terrazas al oeste (2,2 m) y al este (1,8 m) con rampas; el
    // montículo al noroeste; el camino de entrada al oeste (llano); al este, la montaña que rodea el
    // asentamiento por fuera y baja hasta el mar en un cabo de roca; la playa baja hasta el agua (z 89,6)
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 6, z / 6, 701) - 0.5, n2 = V(x / 15, z / 15, 702) - 0.5;
      const C = U.clamp;
      const mt = playaMount(x, z);
      if (z >= 66) {
        const s = C((89.5 - z) / 23, 0, 1);
        const dune = Math.max(0, 1 - Math.abs(z - 69) / 3) * (0.5 + n2) * 0.8;
        return Math.max(0, s * 0.95 + (z < 87 ? n * 0.18 + dune : 0), mt);
      }
      if (x >= 20 && x <= 76 && z >= 8 && z <= 62) {
        let h = 1.0;
        // terraza oeste (rampa en z 46 a 50) y terraza este (rampa en z 46 a 50)
        const rw = z > 46 && z < 50 ? 5 : 0.9, re = z > 46 && z < 50 ? 5 : 0.9;
        h += 1.2 * C((32 - x) / rw, 0, 1) * (z >= 30 ? 1 : 0);
        h += 0.8 * C((x - 66) / re, 0, 1) * (z >= 30 ? 1 : 0);
        // rampa del portón hacia la playa
        if (z > 60) h = U.lerp(h, 0.95, C((z - 60) / 2, 0, 1));
        return h;
      }
      if (z > 62) return Math.max(U.lerp(1.0, 0.95, C((z - 62) / 4, 0, 1)) + n * 0.1, mt);
      if (x < 20) {
        // el montículo (al noroeste del camino) y el camino de la entrada oeste, llano
        const d = Math.hypot(x - 9, z - 45);
        const mound = 1.0 + Math.max(0, 1 - d / 17) * 4.6 * (0.8 + n2 * 0.6) + n * 0.5;
        const road = C((Math.abs(z - 22) - 3.2) / 3, 0, 1);
        return U.lerp(1.0 + n * 0.08, Math.max(mound, 1.0 + n * 0.35), road);
      }
      if (x > 76) return Math.max(1.2 + n * 0.3, mt);
      return 1.1 + n * 0.3;
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E;
      const R = (a, b) => a + rng() * (b - a);
      M.ground(0, 0, 96, 96, F.GRASS);
      M.ground(0, 64, 96, 96, F.DIRT);                    // playa
      M.ground(5, 32, 17, 58, F.DIRT);                    // el montículo: tierra y arena seca
      M.ground(0, 19, 20, 25, F.ROAD);                    // el camino de la entrada oeste (la de verdad del museo)
      M.ground(20, 8, 34, 30, F.ROAD); M.ground(62, 8, 76, 30, F.ROAD);    // patios de servicio (tierra apisonada)
      M.ground(32, 30, 66, 62, F.SIDEWALK);               // el patio: losas de piedra
      M.ground(38, 62, 46, 66, F.SIDEWALK);               // la salida del portón

      // ---- el museo (fondo del asentamiento) y la sala de vigilancia (en el medio del patio) ----
      M.building('museo', 34, 8, 28, 22, 'S');
      M.building('vigilancia', 45, 42, 6, 5, 'S', (c, b, li, E2) => {
        // ventanas a los cuatro lados (salvo la puerta)
        for (let x = 45; x < 51; x++) for (const z of [42, 47]) { const i = li(x, z); if (c.eN[i] === E2.WALL) c.eN[i] = E2.WIN; }
        for (let z = 42; z < 47; z++) for (const x of [45, 51]) { const i = li(x, z); if (c.eW[i] === E2.WALL) c.eW[i] = E2.WIN; }
      });

      // ---- el muro del asentamiento, con el portón a la playa y un tramo caído al este ----
      M.wallN(20, 34, 8, E.WALL); M.wallN(62, 76, 8, E.WALL);
      M.wallW(8, 19, 20, E.WALL); M.wallW(19, 25, 20, E.WALL); M.wallW(25, 62, 20, E.WALL);      // (z 19 a 25: la entrada oeste, tapiada de verdad)
      // la playa, cerrada a los lados por dos muros que bajan hasta el agua (no se rodea el asentamiento por fuera)
      M.wallW(62, 89, 20, E.WALL); M.wallW(62, 89, 76, E.WALL);
      M.wallW(8, 50, 76, E.WALL); M.wallW(53, 62, 76, E.WALL);
      M.wallN(20, 38, 62, E.WALL); M.wallN(46, 76, 62, E.WALL);
      M.put('escombro_grande', 77.4, 51.5, 1, 0); M.put('escombro_grande', 74.6, 51.0, 0, 1);
      // portón: barricadas a los lados, sacos terreros y dos torres de vigilancia en las esquinas
      M.put('sacos', 36.6, 64.0, 0, 1, { x0: 35.2, x1: 38.0, z0: 63.7, z1: 64.3, h: 0.85 });
      M.put('sacos', 47.4, 64.0, 0, 1, { x0: 46.0, x1: 48.8, z0: 63.7, z1: 64.3, h: 0.85 });
      M.put('tarima', 22.6, 59.4, 0, -1); M.put('tarima', 73.4, 59.4, 0, -1);
      M.put('tarima', 21.8, 10.2, 0, 1);

      // ---- la entrada oeste (la principal del museo, la del camino): cerrada a cal y canto. Los Escorpiones la
      // taparon con un camión cruzado, coches (uno encima de otro), barricadas y sacos, para que solo se entre
      // por la playa, donde se ve venir a cualquiera ----
      M.put('pilar', 20.0, 18.6, 1, 0); M.put('pilar', 20.0, 25.4, 1, 0);
      M.put('arco', 20.0, 22.0, 1, 0);
      for (const z of [19.9, 22.0, 24.1]) M.put('barricada', 20.55, z, 1, 0);
      M.put('sacos', 21.35, 22.0, 1, 0, { x0: 21.05, x1: 21.65, z0: 19.2, z1: 24.8, h: 0.85 });
      M.put('camion', 15.4, 22.0, 0, 1, { col: 0x7a6a52 });
      const car = M.put('coche', 18.3, 20.6, 0.2, 1, { col: 0x5a3a32 });
      if (car) M.P.furn.push(Object.assign({}, car, { type: 'coche', fx: -0.3, fz: 1, solid: false, yOff: 1.42, col: 0x3e4a52, x0: car.x0 + 0.1, x1: car.x1 + 0.1 }));
      M.put('coche', 17.4, 26.9, 1, 0.15, { col: 0x6a6e62 });
      M.put('barricada', 18.2, 17.6, 0, 1); M.put('barricada', 18.3, 24.0, 1, 0);
      M.put('neumaticos', 12.4, 18.6, 0, 1); M.put('neumaticos', 12.6, 25.6, 0, 1);
      M.put('senal', 11.6, 25.2, 1, 0);
      M.put('coche', 6.6, 21.4, 1, 0.2, { col: 0x8a8f86 });            // otro, abandonado en el camino
      M.put('escombros', 9.8, 23.6, 0, 1, { x0: 9.0, x1: 10.6, z0: 23.0, z1: 24.2 });
      M.put('barrera', 3.2, 23.6, 1, 0);
      M.puddle(10.5, 20.4, 1.8, 1.1);

      // ---- dentro del museo ----
      // vestíbulo (z 17 a 30): el esqueleto en el centro, pedestales y vitrinas; el comedor al este y la
      // recepción junto a la entrada
      M.put('esqueleto', 48.0, 23.0, 0, 1);
      for (const [x, z] of [[41.5, 20.0], [41.5, 26.0], [54.5, 20.0], [54.5, 26.0]]) M.put('pedestal', x, z, 0, 1);
      M.put('vitrina', 34.5, 20.5, 1, 0); M.put('vitrina', 34.5, 24.5, 1, 0);
      M.put('cuadro', 34.08, 27.5, 1, 0); M.put('cuadro', 61.92, 19.5, -1, 0); M.put('cuadro', 61.92, 27.5, -1, 0);
      M.put('mesa_campo', 58.6, 23.2, 1, 0); M.put('mesa_campo', 58.6, 26.0, 1, 0);
      M.put('banco_parque', 57.0, 23.2, 1, 0); M.put('banco_parque', 57.0, 26.0, 1, 0);
      M.put('mostrador', 37.6, 28.4, 0, -1);
      // sala oeste (dormitorio): sacos de dormir en dos filas, ordenados
      for (let k = 0; k < 6; k++) { M.put('saco_dormir', 35.6 + k * 2.0, 10.2, 0, 1); M.put('saco_dormir', 35.6 + k * 2.0, 15.2, 0, -1); }
      M.put('cajas', 46.6, 12.6, -1, 0);
      // sala este (armería y almacén): armeros, estanterías, cajas y el tablero con el mapa de la zona
      M.put('armero', 51.0, 8.5, 0, 1); M.put('armero', 53.4, 8.5, 0, 1);
      M.put('estanteria', 58.0, 8.6, 0, 1); M.put('estanteria', 61.4, 11.5, -1, 0);
      M.put('tablero', 55.0, 13.8, 0, 1);
      M.put('cajas', 60.6, 15.6, -1, 0); M.put('bidones', 50.2, 15.8, 0, -1);
      // pórtico: columnas (sin tapar las dos puertas)
      for (const x of [37.0, 45.0, 49.0, 52.0, 59.0]) M.put('columna', x, 31.2, 0, 1);

      // ---- patio de servicio oeste (almacén ordenado) y este (vehículos) ----
      for (let k = 0; k < 4; k++) { M.put('palets', 22.4 + k * 1.5, 10.6, 0, 1); M.put('cajas', 22.4 + k * 1.5, 13.0, 0, 1); }
      M.put('bidones', 30.6, 10.4, 0, 1); M.put('bidones', 30.6, 12.2, 0, 1);
      M.put('lona', 27.6, 18.0, 0, 1); M.put('barril_fuego', 24.5, 25.5, 0, 1); M.put('tablas', 30.4, 22.6, 1, 0);
      M.put('camioneta', 69.0, 13.0, 0, 1, { col: 0x5a4a3a }); M.put('coche', 69.2, 22.6, 0, -1, { col: 0x3a4a5a });
      M.put('bidones', 74.6, 12.0, -1, 0); M.put('ibc', 74.6, 16.6, -1, 0);

      // ---- terraza oeste: el huerto, un tendedero y el muro de contención con su rampa ----
      for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) M.put('jardinera', 23.6 + k * 4.0, 34.0 + r * 3.0, 0, 1);
      M.put('tendedero', 25.6, 50.0, 0, 1);
      M.put('tendedero', 25.6, 54.6, 0, 1);
      M.put('muro_bajo', 32.15, 38.0, 1, 0, { x0: 32.0, x1: 32.3, z0: 30.4, z1: 45.6, h: 0.8 });
      M.put('muro_bajo', 32.15, 56.0, 1, 0, { x0: 32.0, x1: 32.3, z0: 50.4, z1: 61.6, h: 0.8 });
      M.put('banco_parque', 29.6, 58.6, 0, -1);
      M.put('cartel_madera', 36.4, 58.6, 1, 0);

      // ---- terraza este: contenedores apilados (se suben), tiendas en fila y el taller ----
      M.cont(71, 31, 'z', 6, 2, { cols: [0x6a3a2e, 0x2e4a5a] });
      M.cont(74, 31, 'z', 6, 1, { cols: [0x4a5a3a] });
      for (const [x, z] of [[68.6, 52.0], [72.4, 52.0], [68.6, 57.4], [72.4, 57.4]]) M.put('tienda', x, z, 0, -1);
      M.put('barril_fuego', 70.5, 46.5, 0, 1); M.put('mesa_campo', 70.6, 42.0, 0, 1);
      M.put('muro_bajo', 65.85, 38.0, 1, 0, { x0: 65.7, x1: 66.0, z0: 30.4, z1: 45.6, h: 0.6 });
      M.put('muro_bajo', 65.85, 56.0, 1, 0, { x0: 65.7, x1: 66.0, z0: 50.4, z1: 61.6, h: 0.6 });

      // ---- el patio: la hoguera con bancos, una mesa, sacos alrededor de la sala de vigilancia, palmeras en
      // jardineras y farolas ----
      M.put('fogata_viva', 40.5, 53.5, 0, 1);
      M.put('banco_parque', 40.5, 51.6, 0, 1); M.put('banco_parque', 40.5, 55.4, 0, -1); M.put('banco_parque', 38.4, 53.5, 1, 0);
      M.put('mesa_campo', 35.6, 49.0, 0, 1);
      M.put('sacos', 43.9, 44.5, 1, 0, { x0: 43.6, x1: 44.2, z0: 42.6, z1: 46.4, h: 0.85 });
      M.put('sacos', 52.1, 44.5, 1, 0, { x0: 51.8, x1: 52.4, z0: 42.6, z1: 46.4, h: 0.85 });
      M.put('consola', 48.0, 42.55, 0, 1);
      M.put('palmera', 34.6, 36.6, 0, 1); M.put('palmera', 63.4, 36.6, 0, 1); M.put('palmera', 56.0, 57.6, 0, 1);
      M.put('carrito', 60.2, 50.0, 0, 1); M.put('cajas', 62.6, 33.2, 0, 1); M.put('cajas', 63.8, 33.2, 0, 1);
      for (const [x, z] of [[36, 43], [60, 43], [44, 60], [56, 32]]) M.pole(x, z);

      // ---- la playa: el bote varado, la balsa en la orilla, palmeras, rocas, troncos y dunas con hierba ----
      M.put('bote', 55.0, 80.6, 0.86, -0.5);
      M.put('balsa', 63.0, 86.4, 1, 0);
      for (const [x, z] of [[30, 70], [35.5, 75.5], [70, 68], [78.5, 76], [24, 80], [86, 70], [12, 72]]) M.put('palmera', x + 0.5, z + 0.5, 0, 1);
      for (const [x, z, w, d] of [[20, 84, 2.2, 1.6], [84, 82, 2.6, 1.8], [9, 76, 1.8, 1.4], [90, 88, 2.0, 1.6], [42, 87, 1.4, 1.1]]) M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.6 + rng() * 0.8 });
      M.put('arbol_caido', 38.0, 83.0, 1, 0);
      M.put('tarima', 48.6, 71.0, 0, 1); M.put('sacos', 52.0, 70.4, 0, 1, { x0: 50.8, x1: 53.2, z0: 70.1, z1: 70.7, h: 0.85 });
      M.tall(6, 65, 28, 71); M.tall(66, 64, 90, 69); M.tall(14, 74, 20, 80);

      // ---- el montículo (oeste) y la ladera (este): hierba seca, arbustos y árboles de otoño ----
      M.tall(5, 6, 19, 17); M.tall(5, 28, 19, 62); M.tall(78, 30, 86, 60);
      for (let k = 0; k < 16; k++) { const x = Math.floor(R(5, 18)), z = Math.floor(R(8, 62)); if (z >= 17 && z <= 27) continue; if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, false); }
      // ---- la montaña del este (rodea el asentamiento por fuera y baja al mar en un cabo): peñas y
      // afloramientos de roca, pinos arriba y árboles de otoño abajo, arbustos, troncos caídos, un
      // desprendimiento junto al muro caído y el viejo sendero con su cartel ----
      for (const [x, z, w, d, h] of [[83, 12, 3.4, 2.6, 2.4], [88, 22, 4.0, 3.0, 3.0], [81.5, 33, 2.6, 2.2, 1.8], [89, 40, 3.6, 3.0, 2.8],
        [84, 47, 3.0, 2.4, 2.2], [90, 56, 4.2, 3.2, 3.2], [85, 63, 3.2, 2.6, 2.6], [88.5, 72, 3.6, 3.0, 3.0], [90.5, 80, 3.0, 2.6, 2.4],
        [80.5, 4.5, 3.0, 2.4, 2.0], [70, 3.2, 2.6, 2.0, 1.6], [91, 6, 3.0, 2.6, 2.6]]) {
        M.put('pena', x, z, rng() < 0.5 ? 1 : -1, 0.3, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h });
      }
      for (let k = 0; k < 14; k++) { const x = R(79, 91), z = R(6, 84), w = R(1.0, 1.9), d = R(0.8, 1.5); M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.5 + rng() * 0.8 }); }
      M.put('escombros', 79.8, 47.6, 1, 0, { x0: 78.8, x1: 80.8, z0: 46.6, z1: 48.6 });
      M.put('arbol_caido', 84.0, 28.0, 0.3, 1); M.put('arbol_caido', 82.5, 56.6, 1, 0.2);
      M.put('senal', 79.4, 40.6, -1, 0);                                     // «peligro: desprendimientos»
      for (let k = 0; k < 34; k++) {
        const x = Math.floor(R(79, 91)), z = Math.floor(R(2, 70));
        if (z > 62 && x < 82) continue;
        if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, x > 85 ? rng() < 0.7 : rng() < 0.15);
      }
      for (let k = 0; k < 8; k++) { const x = Math.floor(R(60, 79)), z = Math.floor(R(0, 3)); if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.4); }
      // arriba (pasado el borde): un pinar cerrado en la cresta
      for (let z = 1; z < 78; z += 2) for (const x of [92, 94]) if (rng() < 0.8) M.tree(x + (z % 4 ? 1 : 0), z, rng() < 0.8);
      for (let x = 6; x < 90; x += 4) { const z = 4 + Math.floor(rng() * 3); if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.25); }
      for (let k = 0; k < 22; k++) { const z = Math.floor(R(8, 64)); if (z < 17 || z > 27) M.bush(Math.floor(R(5, 19)), z); }
      for (let k = 0; k < 30; k++) M.bush(Math.floor(R(78, 92)), Math.floor(R(2, 76)));
      for (const [x, z] of [[23, 44], [29, 32], [70, 37], [64, 59]]) M.tree(x, z, false);
      for (const [x, z, w, d] of [[11, 27, 2.4, 1.8], [16, 50, 1.8, 1.4], [7, 58, 2.0, 1.6]]) M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.8 + rng() * 1.0 });
    }
  };

  // =====================================================================================================
  // Asentamiento de Oceanside (80 x 80): un pueblo de la costa de California (calles residenciales que bajan
  // a la playa, casas bajas de colores, la carretera de la costa con la vía del tren y sus eucaliptos, el
  // paseo junto al mar con su murito, las torres de los socorristas y el muelle largo). Fue el primer hogar de
  // los Escorpiones: el parque de bomberos era su cuartel, el solar de al lado el patio de la comunidad, y
  // cerraron el pueblo con barricadas como harían después en el museo de la playa. Se fueron todos juntos y
  // en orden (el portón del este quedó abierto, en dirección a la costa), pero hace meses: banderas
  // desteñidas a media asta, mesas con polvo y hojas, tiendas caídas, el huerto seco, la hierba crecida, las
  // casas marcadas con la cruz de "registrada", el tablón de guardias con nombres tachados, las tumbas de los
  // que no llegaron a irse y, en el murito de la playa, «AL MUSEO →». El faro que se ve desde la playa del
  // museo se ve aquí también, más allá, por el este: es la misma costa.
  // Norte: la vía (fuera) y la carretera de la costa (z 10 a 15). Calles hacia el mar en x 31 a 35 y 61 a 65,
  // la calle del medio en z 33 a 37 y el paseo marítimo en z 59 a 63. El mar, al sur (z 73)
  // =====================================================================================================
  const OSEA = 73.2;
  MAPS.oceanside = {
    wild: 0.7, sandDirt: true, name: 'Asentamiento de Oceanside', min: 0, max: 80, bounds: [3.05, 9.05, 76.95, 71.0],
    // (los enemigos salen en el pueblo, no en la arena)
    play: [[4, 10, 76, 63]], enemyMul: 1.3, spawn: { x: 16.5, z: 67.5 }, seed: 7373, fence: 'chain', perimeter: false, tallGrass: true, escape2: true,
    // carriles de paso que quedan siempre libres: la carretera, las dos calles al mar, la del medio, el paseo y
    // las dos bajadas a la playa
    lanes: [[5, 11.4, 75, 13.6], [5, 34.0, 75, 36.0], [5, 60.0, 75, 62.0], [32.0, 16, 34.0, 58], [62.0, 16, 64.0, 58], [32.4, 62.6, 34.4, 69], [62.4, 62.6, 64.4, 69]],
    board: { x: 13.0, z: 65.6, fx: 0, fz: 1 },
    seaZ: OSEA,
    // la bruma del mar de la mañana: cielo gris azulado claro, sol suave, todo un poco lavado
    mood: { sky: 0xcdd6da, fog: 1.05, hemi: [0xdfe6e8, 0x6a6652, 0.8], sun: [0xfff0d6, 0.85],
      ground: { 0: [0x8a8a54, 0x96955c], 1: [0x4c4d50, 0x56575a], 2: [0xb2ab9e, 0xbdb6a8], 3: [0xd4c29c, 0xdfcda6] } },
    // horizonte: lomas secas y eucaliptos hacia tierra; el faro, por el este (entre este pueblo y el museo)
    skyline: { beach: true, hills: [0xb8b6aa, 0x8a8a70], trees: [0x7a8a6a, 0x6a7a5e, 0x8a9474, 0x5e6a52], cape: 1.0 },
    flagFade: true,
    flags: [[13.6, 16.8, 0, 0, 1], [25.5, 67.3, 1, 1.5], [75.2, 16.2, 2, 0, 1], [67.6, 17.6, 3, 1.3]],
    // pintadas y tablones escritos
    murals: [
      { kind: 'scorp', x: 14.91, z: 22.0, y: 1.55, w: 1.8, h: 1.8, ry: -Math.PI / 2, col: '#c4862c' },          // pared de los bomberos
      { kind: 'scorp', x: 18.0, z: 64.24, y: 0.5, w: 0.8, h: 0.8, col: '#b8392c' },                            // murito de la playa
      { kind: 'text', text: 'ESCORPIONES', x: 21.6, z: 64.24, y: 0.5, w: 5.2, h: 0.75, col: '#b8392c' },
      { kind: 'text', text: 'AL MUSEO  →', x: 54.0, z: 64.24, y: 0.5, w: 4.6, h: 0.72, col: '#e2ded2', wear: 0.6 },
      { kind: 'scorp', x: 24.5, z: 65.22, y: 2.35, w: 1.3, h: 1.3, ry: Math.PI, at: [24.5, 67.0], col: '#c4862c' },   // la torre de socorrista
      // las casas registradas: fecha · quién · peligros · muertos
      { kind: 'x', text: '14·III|ESC|INF|2', x: 7.4, z: 56.1, y: 1.6, w: 1.1, h: 1.1, col: '#d0662a' },
      { kind: 'x', text: '2·IV|ESC|—|0', x: 27.55, z: 56.1, y: 1.6, w: 1.1, h: 1.1, col: '#d0662a' },
      { kind: 'x', text: '9·IV|ESC|AGUA|0', x: 43.55, z: 56.1, y: 1.6, w: 1.1, h: 1.1, col: '#d0662a' },
      { kind: 'x', text: '21·IV|ESC|INF|1', x: 66.91, z: 48.5, y: 1.6, w: 1.1, h: 1.1, ry: -Math.PI / 2, col: '#d0662a' },
      // tablones: las guardias (patio), los que se quedaron (tumbas), el control de la carretera y el último aviso
      { kind: 'board', text: 'GUARDIAS — SEMANA 31\nNorte: Bauti / Chelo\nPlaya: Iñaki / La Rubia\n~Portón: Don Ramiro\nRadio: Sole\nDE NOCHE NO SALE NADIE', x: 5.245, z: 23.0, y: 1.45, w: 2.25, h: 1.1, ry: Math.PI / 2 },
      { kind: 'board', text: 'LOS NUESTROS\nDon Ramiro\nLa Flaca\nNene Ortiz\nChelo\n+ uno sin nombre', x: 17.445, z: 41.6, y: 1.45, w: 2.25, h: 1.1, ry: Math.PI / 2 },
      { kind: 'board', text: 'CONTROL NORTE\nArmas a la vista\nNadie entra solo\nNadie sale solo', x: 38.0, z: 16.555, y: 1.45, w: 2.25, h: 1.1, ry: Math.PI },
      { kind: 'board', text: 'ÚLTIMO GRUPO\nSale al amanecer\nNo dejen nada\nque sirva', x: 73.555, z: 16.8, y: 1.45, w: 2.25, h: 1.1, ry: -Math.PI / 2 }
    ],
    // el muelle (el primer tramo, caído: no se llega desde la arena)
    pier: { x: 47.5, w: 5, h: 4.4, z0: 71.8, z1: 146, gap: 8 },
    // relieve: el pueblo, llano (1 m); al norte, el terraplén de la vía; al sur, la playa baja desde el murito
    // hasta el agua
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 6, z / 6, 811) - 0.5, n2 = V(x / 14, z / 14, 812) - 0.5, C = U.clamp;
      if (z > 64) {
        if (z < 65) return U.lerp(1.0, 0.55, z - 64);
        const t = C((z - 65) / (OSEA - 65), 0, 1), dune = (z < 71 ? Math.max(0, n2) * 0.25 + n * 0.06 : 0) * (1 - t);
        return Math.max(0, 0.55 * (1 - t) + dune);
      }
      if (z < 9) return 1.0 + 0.7 * C(1 - Math.abs(z - 5) / 4, 0, 1) + n * 0.08;          // el terraplén de la vía
      if (x < 3 || x > 77) return 1.0 + Math.max(0, n) * 0.2;
      return 1.0;
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E, FE = E.FENCE;
      const R = (a, b) => a + rng() * (b - a);
      const car = () => U.pick(rng, [0x8a8f86, 0x5a6a7a, 0x7a5a3a, 0x3e4a52, 0x9a9a92, 0x6a3a32, 0xc8c2b0, 0x4a5a4a]);
      M.ground(0, 0, 80, 80, F.GRASS);
      M.ground(0, 0, 80, 9, F.DIRT);                       // la vía del tren (balasto y tierra)
      M.ground(0, 64, 80, 80, F.DIRT);                     // la playa
      // calles: aceras primero y la calzada encima
      M.ground(0, 9, 80, 10, F.SIDEWALK); M.ground(0, 15, 80, 16, F.SIDEWALK);
      M.ground(30, 16, 36, 58, F.SIDEWALK); M.ground(60, 16, 66, 58, F.SIDEWALK);
      M.ground(0, 32, 80, 38, F.SIDEWALK); M.ground(0, 58, 80, 64, F.SIDEWALK);
      M.ground(0, 10, 80, 15, F.ROAD); M.ground(31, 16, 35, 58, F.ROAD); M.ground(61, 16, 65, 58, F.ROAD);
      M.ground(0, 33, 80, 37, F.ROAD); M.ground(0, 59, 80, 63, F.ROAD);
      M.ground(15, 16, 29, 18, F.SIDEWALK);                // la explanada del parque de bomberos
      M.ground(36, 16, 60, 19, F.ROAD);                    // el aparcamiento de las tiendas
      M.ground(36, 27, 60, 32, F.ROAD);                    // el patio de carga de detrás (el almacén de la comunidad)
      M.ground(4, 16, 14, 31, F.DIRT);                     // el patio comunal: tierra pisada
      M.ground(17, 39, 28, 46, F.DIRT);                    // las tumbas

      // ---- el límite: la valla de la vía al norte y vallas de tablas a los lados (las calles, con barricadas) ----
      M.wallN(3, 77, 9, FE);
      M.wallW(16, 32, 3, FE); M.wallW(38, 58, 3, FE); M.wallW(16, 32, 77, FE); M.wallW(38, 58, 77, FE);

      // ---- edificios (ninguno cruza el borde de un trozo del mundo: x 32 y 64, z 32 y 64) ----
      // el parque de bomberos (el cuartel de los Escorpiones): los portones de la cochera abiertos de par en par
      // y un solo camión dentro (el otro se lo llevaron)
      M.building('bomberos', 15, 18, 13, 12, 'N', (c, b, li, E2) => {
        paint(0xa04a3a, 0x4a3a34)(c, b); b.trucks = 1;
        const bi = c.buildings.indexOf(b) + 1, Z = b.z0;
        const coch = (x) => x >= b.x0 && x < b.x0 + b.w && c.bld[li(x, Z)] === bi && c.rm[li(x, Z)] === 1;
        for (let x = b.x0; x < b.x0 + b.w; x++) {
          if (!coch(x) || c.eN[li(x, Z)] !== E2.ARCH) continue;
          for (const k of [-1, 0, 1]) if (coch(x + k)) c.eN[li(x + k, Z)] = E2.GATE;
        }
      });
      M.building('tienda1', 37, 19, 12, 9, 'N', (c, b) => { paint(0xe6dccb, 0x3a5a6a)(c, b); b.sign = ['SURF · ALQUILER', '#2a6a8a']; });
      M.building('tienda2', 50, 19, 10, 8, 'N', (c, b) => { paint(0xdcb48c, 0x8a3a2a)(c, b); b.sign = ['TAQUERÍA LA OLA', '#b0442a']; });
      M.building('casa4', 68, 20, 8, 8, 'N', paint(0xa8bccc, 0x4a4f56));
      M.building('casa1', 5, 47, 10, 9, 'S', paint(0xd8c8a4, 0x9a5a3e));
      M.building('casa3', 17, 48, 12, 8, 'S', paint(0x9cbcbc, 0x4e5258));
      M.building('casa5', 37, 47, 10, 9, 'S', paint(0xe4dcca, 0x8a4a34));
      M.building('bar_a', 49, 45, 10, 11, 'S', paint(0xe8e4dc, 0x5e5c58));
      M.building('casa2', 67, 41, 9, 11, 'W', paint(0xc4a08a, 0x6a4a3a));
      M.building('cabana', 68, 52, 6, 6, 'S', paint(0x7a8a8a, 0x4a4a46));

      // ---- el murito del paseo (con las dos bajadas a la playa) ----
      for (const [x0, x1] of [[3.2, 31.0], [35.0, 62.0], [66.0, 76.8]]) M.put('muro_bajo', (x0 + x1) / 2, 64.0, 0, 1, { x0, x1, z0: 63.85, z1: 64.15, h: 0.9, keep: true });

      // ---- la carretera de la costa: el cierre del oeste (el camión cruzado, como en el museo), sacos junto a
      // la valla de la vía y, al este, el portón abierto: las barricadas apartadas a los lados ----
      M.put('camion', 4.4, 12.7, 0, 1, { col: 0x6a5a4a, keep: true });
      M.put('barricada', 6.2, 10.1, 1, 0, { keep: true }); M.put('barricada', 6.2, 15.1, 1, 0, { keep: true });
      for (const [x0, x1] of [[6.5, 12.5], [24.0, 29.0], [40.0, 46.0], [66.0, 72.0]]) M.put('sacos', (x0 + x1) / 2, 9.5, 0, 1, { x0, x1, z0: 9.2, z1: 9.8, h: 0.85, old: true });
      M.put('barricada', 74.2, 10.25, 0, 1); M.put('barricada', 74.6, 14.75, 0, 1);
      M.put('sacos', 76.4, 10.3, 1, 0, { x0: 76.1, x1: 76.7, z0: 9.4, z1: 11.2, h: 0.85, old: true });
      M.put('sacos', 76.4, 14.7, 1, 0, { x0: 76.1, x1: 76.7, z0: 13.8, z1: 15.6, h: 0.85, old: true });
      M.put('cartel_madera', 73.6, 16.8, -1, 0);
      // coches arrimados a los bordillos (la calzada, despejada)
      M.put('coche', 22.0, 10.6, 1, 0, { col: car() }); M.put('coche', 45.5, 14.4, -1, 0, { col: car() });
      M.put('camioneta', 57.0, 10.6, 1, 0, { col: 0x7a5a3a }); M.put('coche', 27.5, 14.4, -1, 0, { col: 0x3a3632 });
      M.put('semaforo', 30.4, 15.5, 0, 1); M.put('senal', 66.4, 15.5, 0, 1); M.put('senal', 29.6, 9.6, 0, -1);
      M.puddle(36, 12.6, 2.4, 1.2); M.puddle(63, 11.8, 1.6, 1.0);
      // el control de la calle de los bomberos
      M.put('sacos', 30.8, 16.7, 0, 1, { x0: 30.2, x1: 31.4, z0: 16.4, z1: 17.0, h: 0.85, old: true });
      M.put('sacos', 35.2, 16.7, 0, 1, { x0: 34.6, x1: 35.8, z0: 16.4, z1: 17.0, h: 0.85, old: true });
      M.put('cartel_madera', 38.0, 16.6, 0, -1);

      // ---- el patio comunal (al lado del cuartel): mesas con polvo, la fogata fría, el tendedero, las tiendas
      // caídas, el depósito de agua y el tablón de las guardias. Sacos a lo largo de la carretera, con la entrada ----
      M.put('sacos', 5.9, 16.5, 0, 1, { x0: 4.2, x1: 7.6, z0: 16.2, z1: 16.8, h: 0.85, old: true });
      M.put('sacos', 11.9, 16.5, 0, 1, { x0: 10.0, x1: 13.8, z0: 16.2, z1: 16.8, h: 0.85, old: true });
      M.put('cartel_madera', 5.2, 23.0, 1, 0);
      M.put('mesa_campo', 9.0, 21.6, 0, 1, { old: true }); M.put('mesa_campo', 9.0, 24.6, 0, 1, { old: true });
      M.put('banco_parque', 9.0, 20.4, 0, 1); M.put('banco_parque', 9.0, 25.8, 0, -1);
      M.put('fogata', 10.4, 28.6, 0, 1); M.put('banco_parque', 10.4, 27.0, 0, 1); M.put('banco_parque', 8.3, 28.6, 1, 0);
      M.put('tendedero', 6.0, 30.3, 0, 1, { old: true });
      M.put('tienda', 12.2, 19.8, -1, 0, { old: true }); M.put('refugio_lona', 12.4, 23.8, 0, 1);
      M.put('ibc', 4.8, 27.6, 1, 0); M.put('cajas', 13.3, 30.4, 0, 1);
      M.tall(4, 27, 8, 30); M.tall(11, 30, 14, 31);
      // en el cuartel: la mancha de aceite donde estaba el otro camión, la mesa del mapa, sacos de dormir
      M.puddle(25.6, 23.4, 2.0, 3.2);
      M.put('mesa_mapa', 25.6, 27.9, 0, -1); M.put('saco_dormir', 21.0, 28.6, 1, 0); M.put('cajas', 27.2, 19.0, 0, 1);
      M.put('cubos', 17.0, 30.7, 0, -1); M.put('hidrante', 14.6, 17.4, 0, 1);

      // ---- las tiendas: el aparcamiento delante y el almacén de la comunidad detrás (palés y agua, casi vacío) ----
      M.put('coche', 41.0, 17.6, 1, 0, { col: car() }); M.put('carrito', 46.6, 17.8, 0.7, 0.7); M.put('papelera', 49.6, 18.6, 0, 1);
      M.put('palets', 39.6, 28.6, 0, 1); M.put('palets', 41.0, 28.6, 0, 1); M.put('ibc', 43.6, 28.7, 0, 1);
      M.put('lona', 47.6, 29.0, 0, 1); M.put('cubos', 52.6, 28.6, 0, 1); M.put('bidones', 56.6, 28.6, 0, 1);
      M.puddle(50, 30.6, 2.2, 1.1);

      // ---- la esquina del noreste: la casa azul con su puesto de vigilancia y el cobertizo ----
      M.put('tarima', 67.6, 17.6, 0, 1); M.put('buzon', 71.6, 18.8, 0, 1);
      M.put('cobertizo', 71.6, 29.9, 0, -1); M.put('jardinera', 68.2, 30.3, 0, 1);
      M.tall(66, 28, 76, 31);

      // ---- las calles al mar y la del medio: coches arrimados, una ambulancia, señales y farolas ----
      M.put('coche', 31.5, 25.0, 0, 1, { col: car() }); M.put('coche', 34.6, 46.0, 0, -1, { col: car() });
      M.put('camioneta', 12.0, 33.7, 1, 0, { col: 0x5a6a5a }); M.put('coche', 47.0, 36.4, -1, 0, { col: car() });
      M.put('coche', 70.5, 33.6, 1, 0, { col: car() }); M.put('ambulancia', 64.9, 26.5, 0, 1); M.put('coche', 61.4, 50.5, 0, -1, { col: car() });
      M.put('coche', 4.4, 35.0, 0, 1, { col: 0x3a3632, keep: true }); M.put('barricada', 5.6, 32.7, 1, 0, { keep: true });
      M.put('barricada', 75.0, 33.1, 0, 1); M.put('sacos', 76.4, 36.4, 1, 0, { x0: 76.1, x1: 76.7, z0: 35.6, z1: 37.6, h: 0.85, old: true });
      M.put('senal', 30.4, 37.5, 1, 0); M.put('senal', 65.6, 32.4, -1, 0); M.put('hidrante', 35.5, 44.0, 0, 1);
      M.puddle(48, 34.4, 2.6, 1.2); M.puddle(32.6, 52, 1.2, 2.2);
      for (const [x, z] of [[30, 21], [30, 50], [35, 40], [60, 22], [65, 46], [16, 15], [44, 15], [70, 9], [20, 63], [50, 63], [8, 37], [56, 32]]) M.pole(x, z);

      // ---- las casas de la playa (al sur): huerto seco, las tumbas, el taller, buzones, agaves y palmeras ----
      for (const [x, z] of [[6.6, 40.2], [6.6, 43.0], [10.6, 40.2], [10.6, 43.0]]) M.put('jardinera', x, z, 0, 1);
      M.put('ibc', 13.6, 39.4, 0, 1); M.tall(4, 44, 9, 46);
      for (let k = 0; k < 5; k++) M.put('tumba', 19.5 + k * 1.4, 43.0, 0, 1);
      M.put('cartel_madera', 17.4, 41.6, 1, 0); M.put('banco_parque', 22.3, 39.7, 0, 1);
      M.tall(17, 44, 28, 47); M.tree(27, 40, false);
      M.put('coche', 41.5, 41.2, 1, 0, { col: 0x6a5a4a }); M.put('neumaticos', 45.6, 39.3, 0, 1); M.put('tablas', 38.4, 43.8, 1, 0);
      M.put('banco', 52.0, 39.0, 0, 1); M.put('bidones', 55.6, 39.0, 0, 1); M.put('lona', 49.2, 42.4, 0, 1);
      M.tall(36, 38, 48, 40);
      // los jardines de delante (dan al paseo y al mar)
      M.put('buzon', 10.2, 57.5, 0, 1); M.put('buzon', 22.8, 57.5, 0, 1); M.put('buzon', 42.0, 57.5, 0, 1); M.put('buzon', 54.0, 57.5, 0, 1);
      for (const [x, z] of [[6.8, 56.9], [26.0, 56.9], [38.6, 56.9], [75.0, 56.6], [66.8, 39.4], [58.6, 56.9]]) M.put('agave', x, z, 0, 1);
      for (const [x, z] of [[15.9, 57.0], [59.2, 46.0], [74.6, 53.6]]) M.put('palmera', x, z, 0, 1);
      M.put('surf', 13.2, 57.0, 0, 1); M.put('surf', 45.2, 57.3, 0, 1);
      for (const [x0, z0, x1, z1] of [[17.4, 56.2, 21.4, 57.7], [43.5, 56.2, 46.6, 57.7], [69.0, 38.4, 74.5, 39.8], [30.2, 38.4, 30.9, 45.0]]) M.put('planta_hielo', (x0 + x1) / 2, (z0 + z1) / 2, 0, 1, { x0, x1, z0, z1 });
      M.put('coche', 12.0, 59.4, 1, 0, { col: car() }); M.put('coche', 68.0, 59.4, -1, 0, { col: car() });
      M.put('barricada', 75.6, 60.0, 1, 0); M.put('sacos', 76.4, 61.8, 1, 0, { x0: 76.1, x1: 76.7, z0: 61.0, z1: 62.8, h: 0.85, old: true });

      // ---- la playa: dos torres de socorrista (una fue puesto de guardia), tablas de surf, aros de fuego,
      // tiendas caídas, palmeras sobre el murito, uña de gato en el talud y las rocas del espigón ----
      M.put('socorrista', 24.5, 67.0, 0, 1, { used: true, col: 0x8fb4c4 }); M.put('socorrista', 58.5, 66.8, 0, 1, { col: 0x9cc0cc });
      M.put('surf', 55.4, 65.8, 0, 1);
      for (const [x, z] of [[36.8, 67.6], [43.0, 68.4], [69.2, 67.4]]) M.put('aro_fuego', x, z, 0, 1);
      M.put('tienda', 19.6, 66.8, 0, 1, { old: true }); M.put('lona', 28.6, 66.4, 0, 1); M.put('tablas', 21.0, 66.0, 0, 1);
      for (const x of [8, 29, 40, 51, 67, 72]) M.put('palmera', x + 0.5, 65.6, 0, 1);
      for (const [x0, x1] of [[4.5, 7.4], [9.2, 12.0], [14.2, 16.4], [36.0, 39.0], [42.0, 46.0], [48.6, 50.0], [65.6, 66.6], [68.4, 71.4], [73.4, 75.6]]) M.put('planta_hielo', (x0 + x1) / 2, 64.9, 0, 1, { x0, x1, z0: 64.35, z1: 65.4 });
      for (const [x, z, w, d, h] of [[4.8, 66.6, 3.0, 2.4, 1.8], [5.0, 69.6, 3.4, 2.6, 1.6], [75.2, 66.4, 3.0, 2.4, 1.8], [75.0, 69.6, 3.2, 2.6, 1.5], [3.6, 72.6, 3.6, 2.8, 1.4], [76.4, 72.8, 3.6, 2.8, 1.3], [2.0, 75.6, 3.0, 2.4, 1.0], [78.0, 75.8, 3.0, 2.4, 1.0]]) {
        M.put('pena', x, z, rng() < 0.5 ? 1 : -1, 0.3, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h, keep: true });
      }
      for (const [x, z] of [[46.0, 66.2], [10.0, 68.8]]) { const w = R(1.0, 1.6), d = R(0.8, 1.2); M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.5 + rng() * 0.4 }); }
      M.tall(4, 65, 10, 67); M.tall(70, 65, 76, 67);

      // ---- árboles del pueblo y, fuera, los eucaliptos de la vía y la arboleda de los lados ----
      for (const [x, z] of [[6, 45], [24, 45], [44, 44], [57, 41], [74, 30], [13, 26], [4, 18], [75, 40], [66, 57]]) M.tree(x, z, false);
      for (const [x, z] of [[16, 46], [25, 46], [36, 56], [66, 54], [72, 38], [50, 44], [4, 31], [13, 31]]) M.bush(x, z);
      for (let x = 0; x < 80; x += 10) M.put('vias', x + 5, 5.0, 0, 1, { x0: x, x1: x + 10, z0: 3.9, z1: 6.1 });
      for (let x = 0; x < 80; x += 3) {
        if (rng() < 0.8) M.tree(x + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2), rng() < 0.15);
        if (rng() < 0.6) M.tree(x + Math.floor(rng() * 2), 7, false);
      }
      for (let z = 16; z < 64; z += 2) {
        if (z >= 32 && z <= 37 || z >= 58) continue;
        for (const x of [0, 1, 78, 79]) if (rng() < 0.55 && M.free(x, z, x + 1, z + 1)) M.tree(x, z + Math.floor(rng() * 2), rng() < 0.2);
      }
    }
  };

  // =====================================================================================================
  // Tres mapas más para Retorno (64 x 64 cada uno: cuatro trozos del mundo; ningún edificio cruza x 32 ni z 32)
  // =====================================================================================================
  // la nave (nave_t) con sus portones abiertos: al sur y al este, y los pasos de dentro
  const naveOpen = (ox, oz) => (c, b, li, E2) => {
    for (const dx of [2, 3, 4, 5, 9, 10, 11, 12]) c.eN[li(ox + dx, oz + 12)] = E2.GATE;
    for (const dz of [2, 3, 4]) c.eW[li(ox + 20, oz + dz)] = E2.GATE;
    for (const dz of [1, 2, 3, 7, 8, 9, 10]) c.eW[li(ox + 14, oz + dz)] = E2.ARCH;
    for (const dx of [16, 17]) c.eN[li(ox + dx, oz + 6)] = E2.ARCH;
  };
  // un tablón escrito sobre un cartel de madera puesto en (x, z) mirando a (fx, fz)
  const boardAt = (x, z, fx, fz, text) => ({ kind: 'board', text, x: x + fx * 0.045, z: z + fz * 0.045, y: 1.45, w: 2.25, h: 1.1, ry: Math.atan2(fx, fz) });

  // -----------------------------------------------------------------------------------------------------
  // Faro de Oceanside: el promontorio del faro que se ve desde todos los mapas de la costa. Una meseta sobre
  // el acantilado (2,4 m), con el mar al sur. Se entra por el norte (el camino de grava y la verja); arriba, la
  // estación de señales y el almacén del aceite; al este, el centro de visitantes con su aparcamiento y la
  // garita de los guardacostas; al suroeste, las casas de los fareros con su huerto, las tumbas y el mirador;
  // y al sureste, la casa grande, la caseta de la sirena y la torre, en su plazoleta. La torre es maciza (la
  // puerta, con cadena): se rodea, no se entra. La luz sigue girando
  // -----------------------------------------------------------------------------------------------------
  const FSEA = 62.5, FTOP = 2.4;
  MAPS.faro = {
    wild: 0.6, sandDirt: true, name: 'Faro de Oceanside', min: 0, max: 64, bounds: [3.05, 4.05, 60.95, 55.6],
    play: [[4, 5, 60, 55]], spawn: { x: 16.5, z: 7.5 }, seed: 4747, fence: 'wood', perimeter: false, tallGrass: true, escape2: true,
    lanes: [[14.4, 4.5, 17.6, 22], [14.4, 22.4, 50, 25.6], [46.4, 26, 49.6, 40]],
    board: { x: 20.5, z: 7.2, fx: 0, fz: 1 },
    seaZ: FSEA,
    // tarde de viento: cielo azul lavado, sol frío, el aire limpio (se ve lejos)
    mood: { sky: 0xb9cad4, fog: 1.25, hemi: [0xd6e2e8, 0x5e6250, 0.82], sun: [0xfff4dc, 0.95],
      ground: { 0: [0x7e8a52, 0x8a965a], 1: [0x55575a, 0x5e6063], 2: [0xb6b0a4, 0xc0baae], 3: [0xc9b88e, 0xd4c398] } },
    // horizonte: lomas hacia tierra; el faro no va en el horizonte (está aquí)
    skyline: { beach: true, hills: [0xb4b8ae, 0x868c74], trees: [0x74866a, 0x66785c, 0x86926e, 0x5a6850], noCape: true },
    lighthouse: { x: 48.5, z: 47.5, y: 22.4 },
    murals: [
      boardAt(20.2, 5.6, 0, 1, 'FARO DE OCEANSIDE\nEn servicio desde 1911\nVisitas: de 10 a 17\nNo subir con viento'),
      boardAt(11.0, 53.4, 0, -1, 'MIRADOR\nNo pasar del murete\nAcantilado: 12 m\n~Catalejo: 1 moneda'),
      boardAt(44.6, 27.4, 1, 0, 'ZONA DE SERVICIO\nSolo personal del faro\nSirena de niebla:\nprotéjase los oídos')
    ],
    // relieve: la meseta, llana; al sur el acantilado y, abajo, las rocas y el agua
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 5, z / 5, 931) - 0.5, n2 = V(x / 14, z / 14, 932) - 0.5, C = U.clamp;
      if (z > 56) {
        const t = C((z - 56) / 4.2, 0, 1);
        return Math.max(-0.5, U.lerp(FTOP, 0.3, Math.pow(t, 0.6)) + (1 - t) * n * 0.25 - Math.max(0, z - 60.5) * 0.3);
      }
      if (x < 3 || x > 61 || z < 4) return FTOP + Math.max(0, n2 + 0.2) * 0.9 + n * 0.1;
      return FTOP;
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E, FE = E.FENCE;
      const car = () => U.pick(rng, [0x8a8f86, 0x5a6a7a, 0x7a5a3a, 0x3e4a52, 0x9a9a92, 0xc8c2b0]);
      M.ground(0, 0, 64, 64, F.GRASS);
      M.ground(0, 57, 64, 64, F.DIRT);                     // el pie del acantilado (roca y arena)
      // el camino de grava: de la verja al cruce, del cruce al aparcamiento y la bajada a la torre
      M.ground(14, 0, 18, 22, F.ROAD); M.ground(14, 22, 51, 26, F.ROAD); M.ground(46, 26, 50, 41, F.ROAD);
      M.ground(36, 18, 58, 22, F.ROAD);                    // el aparcamiento de las visitas
      M.ground(41, 41, 57, 55, F.SIDEWALK);                // la plazoleta de la torre (losas)
      M.ground(5, 52, 17, 55, F.SIDEWALK);                 // el mirador
      M.ground(5, 22, 13, 28, F.DIRT);                     // las tumbas

      // ---- el límite: tablas al norte y a los lados; al sur, el murete del acantilado ----
      M.wallN(3, 14, 4, FE); M.wallN(18, 61, 4, FE);
      M.wallW(4, 56, 3, FE); M.wallW(4, 56, 61, FE);
      for (const [x0, x1] of [[3.2, 22.0], [22.6, 40.4], [41.0, 60.8]]) M.put('muro_bajo', (x0 + x1) / 2, 56.0, 0, 1, { x0, x1, z0: 55.85, z1: 56.15, h: 0.9, keep: true });
      // la verja (abierta, con las barricadas apartadas) y el cartel
      M.put('barricada', 13.2, 5.2, 1, 0, { keep: true }); M.put('barricada', 18.9, 5.0, 1, 0, { keep: true });
      M.put('cartel_madera', 20.2, 5.6, 0, 1); M.put('senal', 13.4, 9.6, 0, 1);
      M.put('coche', 15.0, 13.0, 0, 1, { col: car() }); M.put('camioneta', 17.1, 18.4, 0, -1, { col: 0x6a5a4a });

      // ---- noroeste: la estación de señales (radio) y el almacén del aceite ----
      M.building('oficinas_t', 20, 9, 10, 8, 'S', (c, b) => { paint(0xdcd6c8, 0xa83a2e)(c, b); });
      M.building('cabana', 5, 9, 6, 6, 'E', paint(0xcfc8b8, 0x8a3a2e));
      M.put('bidones', 12.2, 10.4, 0, 1); M.put('bidones', 12.2, 12.0, 0, 1); M.put('ibc', 12.3, 14.2, 1, 0); M.put('cajas', 5.6, 16.6, 0, 1);
      M.put('poste', 24.5, 6.6, 0, 1); M.put('palets', 28.4, 18.6, 0, 1); M.put('lona', 21.6, 18.8, 0, 1);
      // las tumbas de los fareros, mirando al mar
      for (let k = 0; k < 4; k++) M.put('tumba', 6.4 + k * 1.6, 24.8, 0, 1);
      M.put('banco_parque', 9.0, 27.4, 0, -1); M.tall(4, 17, 13, 21); M.tall(4, 28, 12, 32);

      // ---- noreste: el centro de visitantes, el aparcamiento y la garita de los guardacostas ----
      M.building('tienda2', 36, 9, 10, 8, 'S', (c, b) => { paint(0xe6dccb, 0x3a5a6a)(c, b); b.sign = ['CENTRO DE VISITANTES', '#2a5a7a']; });
      M.building('vigilancia', 53, 9, 6, 5, 'S', paint(0xb8bcc0, 0x4a4f56));
      M.put('coche', 39.0, 19.6, 1, 0, { col: car() }); M.put('coche', 45.5, 20.4, -1, 0, { col: car() }); M.put('coche', 55.0, 19.8, 1, 0, { col: 0x3a3632 });
      M.put('parada', 50.0, 16.9, 0, 1); M.put('papelera', 47.6, 17.4, 0, 1); M.put('banco_parque', 33.6, 18.0, 0, 1);
      M.put('kiosco', 49.5, 10.6, 0, 1); M.put('cartel_madera', 44.6, 27.4, 1, 0);
      M.put('sacos', 55.8, 15.4, 0, 1, { x0: 53.8, x1: 57.8, z0: 15.1, z1: 15.7, h: 0.85, old: true });
      M.put('ambulancia', 57.2, 24.0, 0, 1); M.puddle(42, 20.6, 2.2, 1.1); M.tall(52, 27, 60, 31);

      // ---- suroeste: las casas de los fareros, el huerto y el mirador ----
      M.building('casa1', 6, 34, 9, 10, 'E', paint(0xe8e0d0, 0xa83a2e));
      M.building('casa4', 19, 43, 8, 8, 'N', paint(0xdcd4c2, 0x8a3a2e));
      for (const [x, z] of [[18.6, 34.6], [18.6, 37.4], [22.2, 34.6], [22.2, 37.4]]) M.put('jardinera', x, z, 0, 1);
      M.put('tendedero', 25.0, 39.6, 0, 1, { old: true }); M.put('ibc', 16.6, 40.6, 0, 1); M.put('cobertizo', 27.4, 34.6, 0, 1);
      M.put('cubos', 16.8, 33.4, 0, 1); M.put('buzon', 16.4, 30.6, 0, 1); M.put('tablas', 28.6, 44.6, 1, 0);
      M.put('banco_parque', 8.0, 53.0, 0, 1); M.put('banco_parque', 14.0, 53.0, 0, 1); M.put('cartel_madera', 11.0, 53.4, 0, -1);
      M.put('papelera', 16.4, 53.4, 0, 1); M.tall(4, 45, 10, 51); M.tall(24, 30, 30, 33);

      // ---- sureste: la casa grande, la caseta de la sirena y la torre en su plazoleta ----
      M.building('casa5', 33, 33, 10, 9, 'S', paint(0xeae4d6, 0xa83a2e));
      M.building('cabana', 54, 33, 6, 6, 'W', paint(0xd8d2c4, 0x5a5c5e));
      M.put('faro', 48.5, 47.5, 0, -1, { keep: true });
      M.put('banco_parque', 43.0, 53.6, 0, -1); M.put('banco_parque', 54.0, 53.6, 0, -1);
      M.put('pedestal', 44.6, 42.0, 0, 1); M.put('pedestal', 56.0, 42.0, 0, 1);
      M.put('cajas', 53.2, 44.6, 0, 1); M.put('bidones', 55.2, 46.6, 0, 1); M.put('palets', 42.8, 47.6, 0, 1);
      M.put('carrito', 45.2, 43.2, 0.7, 0.7); M.put('maceta', 36.6, 43.4, 0, 1); M.put('buzon', 45.0, 39.6, 0, 1);
      M.put('coche', 51.4, 37.4, 0, 1, { col: car() }); M.puddle(48, 33.6, 1.6, 2.4);
      M.tall(34, 44, 40, 54); M.tall(57, 41, 60, 55);

      // ---- el acantilado y las rocas de abajo (fuera de la zona de juego) ----
      for (let x = 2; x < 63; x += 4.2) {
        const w = 3.0 + rng() * 1.6, d = 2.2 + rng() * 1.2, z = 58.2 + rng() * 1.6;
        M.put('pena', x + rng(), z, rng() < 0.5 ? 1 : -1, 0.3, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 1.4 + rng() * 1.6, keep: true });
      }
      for (const [x, z] of [[9, 61.6], [24, 62.2], [38, 61.4], [52, 62.4], [60, 61.2]]) { const w = 1.4 + rng(), d = 1.0 + rng() * 0.8; M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.5 + rng() * 0.5, keep: true }); }
      for (const [x0, x1] of [[5.0, 9.0], [24.0, 30.0], [35.6, 39.6], [58.0, 60.6]]) M.put('planta_hielo', (x0 + x1) / 2, 55.2, 0, 1, { x0, x1, z0: 54.6, z1: 55.7 });
      for (const [x, z] of [[20.5, 54.2], [31.5, 54.4], [40.2, 55.0], [4.6, 43.6], [59.6, 30.4]]) M.put('agave', x, z, 0, 1);

      // ---- farolas, árboles (pocos: el viento) y los de fuera de la valla ----
      for (const [x, z] of [[13, 15], [19, 27], [33, 21], [45, 30], [51, 40], [58, 23], [29, 53]]) M.pole(x, z);
      for (const [x, z] of [[8, 19], [27, 28], [31, 40], [12, 46], [58, 28], [33, 5], [47, 6], [26, 50]]) M.tree(x, z, rng() < 0.5);
      for (const [x, z] of [[14, 30], [30, 34], [4, 33], [60, 16], [40, 6], [57, 36]]) M.bush(x, z);
      for (let z = 0; z < 56; z += 2) for (const x of [0, 1, 62, 63]) if (rng() < 0.6 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.55);
      for (let x = 2; x < 62; x += 2) for (const z of [0, 1, 2]) if ((x < 13 || x > 18) && rng() < 0.6 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.55);
    }
  };

  // -----------------------------------------------------------------------------------------------------
  // El faro tomado (el segundo jefe final de Retorno, ver faro.js): el mismo mapa al caer la tarde, con los
  // Escorpiones dentro. Su líder está atrincherado en la torre; la linterna del faro, inclinada hacia la meseta,
  // la barre de lado a lado y el tirador del balcón dispara a lo que ilumina. Lo que cambia respecto al mapa de los
  // enfrentamientos: parapetos de sacos y barricadas en el camino y en la plazoleta, una camioneta cruzada, y el
  // generador que alimenta la linterna, detrás de la caseta de la sirena (cortarle el cable apaga el faro).
  // No sale en la lista de mapas (hidden): solo se llega como jefe final o desde el tablero de simulación
  // -----------------------------------------------------------------------------------------------------
  MAPS.faro_jefe = Object.assign({}, MAPS.faro, {
    hidden: true, faroBoss: true, noBoss: true, hour: 19.45, hourFixed: true,
    // el generador (y desde dónde se le corta el cable), la puerta de la torre y la verja por la que se entra
    gen: { x: 55.5, z: 31.5, px: 55.5, pz: 30.55 }, door: { x: 48.5, z: 43.3 }, gate: { x: 16.5, z: 6.6 }, park: { x: 56.5, z: 21.0 }, west: { x: 9.0, z: 29.5 },
    build(M, rng) {
      MAPS.faro.build.call(this, M, rng);
      // el generador, a cubierto de la torre tras la caseta de la sirena, con sus bidones
      M.put('generador', 55.5, 31.5, 0, -1, { keep: true });
      M.put('bidones', 57.6, 31.6, 0, 1, { keep: true });
      // el corte del camino del este: sacos y una barricada (la guardia del camino)
      M.put('sacos', 36.2, 22.9, 0, 1, { x0: 34.6, x1: 37.8, z0: 22.6, z1: 23.2, h: 0.85, keep: true });
      M.put('barricada', 40.6, 25.2, 1, 0, { keep: true });
      M.put('sacos', 30.4, 25.1, 0, 1, { x0: 29.0, x1: 31.8, z0: 24.8, z1: 25.4, h: 0.85, keep: true });
      // la bajada a la torre: una camioneta cruzada y dos parapetos (lo alto tapa del balcón; lo bajo, solo de los de abajo)
      M.put('camioneta', 47.1, 30.6, 0, 1, { col: 0x4a4038, keep: true });
      M.put('sacos', 48.9, 35.6, 0, 1, { x0: 47.6, x1: 50.2, z0: 35.3, z1: 35.9, h: 0.85, keep: true });
      M.put('barricada', 46.9, 38.4, 1, 0, { keep: true });
      // la plazoleta: el parapeto de la puerta y cajas de munición
      M.put('sacos', 48.5, 41.4, 0, 1, { x0: 46.6, x1: 50.4, z0: 41.1, z1: 41.7, h: 0.85, keep: true });
      M.put('cajas', 51.6, 42.6, 0, 1, { keep: true }); M.put('cajas', 45.2, 45.4, 0, 1, { keep: true });
    }
  });

  // -----------------------------------------------------------------------------------------------------
  // Puerto pesquero de Oceanside: el muelle del pueblo, al otro lado de la bahía (el faro se ve al oeste, sobre
  // el agua). Se entra por el norte, por la calle que baja al muelle. Arriba, la tienda de efectos navales, una
  // casa, el bar del puerto (dos plantas y terraza) y la capitanía; en medio, la calle del puerto; abajo, la
  // lonja (una nave alta con los portones abiertos), las casetas de las redes, la fábrica de hielo y la
  // explanada del muelle: contenedores frigoríficos, nasas apiladas, botes, carretillas, el surtidor y un
  // pesquero varado en la rampa. El espigón de madera se cayó en su primer tramo: no se llega
  // -----------------------------------------------------------------------------------------------------
  const PSEA = 59.0, PTOP = 1.2;
  MAPS.puerto = {
    wild: 0.45, sandDirt: true, name: 'Puerto pesquero de Oceanside', min: 0, max: 64, bounds: [3.05, 6.05, 60.95, 54.7],
    play: [[4, 7, 60, 54]], enemyMul: 1.15, spawn: { x: 32.5, z: 9.0 }, seed: 5858, fence: 'chain', perimeter: false, tallGrass: true, escape2: true,
    lanes: [[30.6, 6.5, 33.4, 44], [4, 22.6, 60, 25.4], [4, 50.4, 60, 52.6]],
    board: { x: 35.6, z: 8.2, fx: 0, fz: 1 },
    seaZ: PSEA,
    // amanecer frío en el muelle: cielo gris azulado, algo de bruma, el sol todavía bajo
    mood: { sky: 0xc3ccd2, fog: 0.95, hemi: [0xd8e0e4, 0x5a5c52, 0.8], sun: [0xffe8cc, 0.82],
      ground: { 0: [0x7c8452, 0x88905a], 1: [0x4a4c50, 0x54565a], 2: [0xaaa69c, 0xb4b0a6], 3: [0xc4b490, 0xcebe9a] } },
    // horizonte: lomas y eucaliptos hacia tierra; el faro, al oeste, al otro lado de la bahía
    skyline: { beach: true, hills: [0xb6b8ae, 0x888c74], trees: [0x78886a, 0x687a5c, 0x889272, 0x5c6a52], cape: -1.05 },
    pier: { x: 20.5, w: 5, h: 1.5, z0: 56.6, z1: 120, gap: 8 },
    murals: [
      boardAt(27.2, 28.4, 1, 0, 'LONJA DE OCEANSIDE\nSubasta: 6:00\nHielo y cajas: nave 2\nNo se fía'),
      boardAt(57.6, 44.2, -1, 0, 'CAPITANÍA AVISA\nTemporal del oeste\nAmarren doble\n~Salidas: suspendidas'),
      { kind: 'text', text: 'NO QUEDA NADA', x: 49.0, z: 47.04, y: 1.5, w: 4.4, h: 0.8, col: '#d8d2c4', wear: 0.7 }
    ],
    // relieve: el muelle, llano (1,2 m sobre el agua); el cantil cae a plomo al sur
    height(x, z) {
      const V = G.World.vnoise, n2 = V(x / 14, z / 14, 842) - 0.5, C = U.clamp;
      if (z > 55.4) return U.lerp(PTOP, -0.8, C((z - 55.4) / 0.9, 0, 1));
      if (x < 3 || x > 61 || z < 6) return PTOP + Math.max(0, n2 + 0.15) * 0.8;
      return PTOP;
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E, FE = E.FENCE;
      const car = () => U.pick(rng, [0x8a8f86, 0x5a6a7a, 0x7a5a3a, 0x3e4a52, 0x9a9a92, 0x6a3a32, 0xc8c2b0]);
      M.ground(0, 0, 64, 64, F.GRASS);
      M.ground(0, 56, 64, 64, F.DIRT);
      // calles: aceras primero y la calzada encima. La calle que baja (x 30 a 34) y la del puerto (z 22 a 26)
      M.ground(29, 6, 35, 44, F.SIDEWALK); M.ground(3, 21, 61, 27, F.SIDEWALK);
      M.ground(30, 0, 34, 44, F.ROAD); M.ground(3, 22, 61, 26, F.ROAD);
      // la explanada del muelle (asfalto) con el borde de hormigón
      M.ground(3, 44, 61, 54, F.ROAD); M.ground(3, 54, 61, 56, F.SIDEWALK);
      M.ground(36, 27, 61, 33, F.ROAD);                    // el patio de las casetas

      // ---- el límite: alambre al norte y a los lados; al sur, el cantil ----
      M.wallN(3, 30, 6, FE); M.wallN(34, 61, 6, FE);
      M.wallW(6, 22, 3, FE); M.wallW(26, 55, 3, FE); M.wallW(6, 22, 61, FE); M.wallW(26, 55, 61, FE);
      // las tres calles, cerradas: un camión cruzado, barricadas y sacos
      M.put('barricada', 29.4, 7.0, 0, 1, { keep: true }); M.put('barricada', 34.6, 7.2, 0, 1, { keep: true });
      M.put('camion', 4.6, 24.0, 0, 1, { col: 0x5a6a5a, keep: true });
      M.put('barricada', 59.6, 22.8, 1, 0, { keep: true }); M.put('barricada', 59.8, 25.2, 1, 0, { keep: true });
      M.put('sacos', 60.4, 24.0, 1, 0, { x0: 60.1, x1: 60.7, z0: 23.0, z1: 25.0, h: 0.85, old: true });

      // ---- arriba: efectos navales, una casa, el bar y la capitanía ----
      M.building('tienda1', 6, 11, 12, 9, 'S', (c, b) => { paint(0xdfe4e6, 0x2f5a78)(c, b); b.sign = ['EFECTOS NAVALES', '#2a5a7a']; });
      M.building('casa4', 20, 12, 8, 8, 'S', paint(0xc8d4d0, 0x4a4f56));
      M.building('bar_a', 38, 9, 10, 11, 'S', paint(0xe8dcc0, 0x7a3a2a));
      M.building('oficinas_t', 50, 12, 10, 8, 'S', paint(0xd6d2c6, 0x3a4a5a));
      M.put('coche', 30.9, 15.0, 0, 1, { col: car() }); M.put('coche', 33.2, 36.0, 0, -1, { col: car() });
      M.put('camioneta', 12.0, 22.9, 1, 0, { col: 0x7a5a3a }); M.put('coche', 44.0, 25.2, -1, 0, { col: car() }); M.put('coche', 52.6, 22.8, 1, 0, { col: 0x3a3632 });
      M.put('semaforo', 28.6, 20.6, 0, 1); M.put('senal', 35.4, 27.4, 1, 0); M.put('hidrante', 28.5, 27.6, 0, 1); M.put('parada', 22.0, 20.4, 0, 1);
      M.put('papelera', 36.4, 20.6, 0, 1); M.put('buzon', 19.0, 20.4, 0, 1); M.put('banco_parque', 46.0, 20.6, 0, 1);
      M.put('nasas', 8.0, 9.2, 0, 1); M.put('bote', 14.0, 8.6, 0, 1); M.put('surf', 19.4, 10.6, 0, 1);
      M.put('mesa_campo', 49.2, 9.0, 0, 1, { old: true }); M.put('bidones', 58.6, 9.4, 0, 1); M.put('cajas', 36.4, 12.0, 0, 1);
      M.puddle(32, 19.4, 1.4, 2.4); M.puddle(18, 24.2, 2.6, 1.2); M.tall(20, 7, 28, 10); M.tall(50, 7, 58, 10);

      // ---- abajo, al oeste: la lonja, con su patio de carga ----
      M.building('nave_t', 6, 32, 20, 12, 'S', (c, b, li, E2) => { paint(0xb9c2c6, 0x4a5258)(c, b); naveOpen(6, 32)(c, b, li, E2); });
      M.put('cartel_madera', 27.2, 28.4, 1, 0); M.put('camion', 9.0, 29.0, 1, 0, { col: 0x8a8f86 });
      M.put('montacargas', 19.0, 29.4, 1, 0); M.put('palets', 23.0, 28.8, 0, 1); M.put('palets', 24.6, 28.8, 0, 1);
      M.put('cajas', 9.0, 36.0, 0, 1); M.put('cajas', 9.0, 38.0, 0, 1); M.put('carrito', 14.0, 38.6, 0.7, 0.7); M.put('mesa_campo', 13.0, 34.6, 0, 1, { old: true });
      M.put('congelador', 17.4, 33.2, 0, 1); M.put('bidones', 24.0, 36.0, 0, 1); M.put('palets', 22.4, 42.4, 0, 1); M.put('ibc', 28.2, 34.0, 1, 0);

      // ---- abajo, al este: las casetas de las redes y la fábrica de hielo ----
      M.building('cabana', 36, 34, 6, 6, 'N', paint(0x9cbcbc, 0x4e5258));
      M.building('cabana', 43, 34, 6, 6, 'N', paint(0xd8c8a4, 0x9a5a3e));
      M.building('tienda2', 50, 34, 10, 8, 'N', (c, b) => { paint(0xe2e6e8, 0x3a6a7a)(c, b); b.sign = ['HIELO · CEBO', '#2a6a7a']; });
      M.put('nasas', 38.4, 31.6, 0, 1); M.put('nasas', 41.0, 31.8, 0, 1); M.put('tendedero', 46.6, 31.4, 0, 1, { old: true });
      M.put('bote', 54.0, 30.4, 1, 0); M.put('neumaticos', 58.8, 31.6, 0, 1); M.put('tablas', 43.2, 41.2, 1, 0); M.put('cubos', 50.4, 41.4, 0, 1);
      M.put('cartel_madera', 57.6, 44.2, -1, 0);

      // ---- la explanada del muelle (el paso de z 50,4 a 52,6 queda libre) ----
      M.cont(46, 45, 'x', 6, 2, { cols: [0xd8d4c8, 0x4a6a8a] }); M.cont(54, 45, 'x', 6, 1, { cols: [0x9a4a32] });
      M.cont(5, 46, 'z', 6, 1, { open: true, cols: [0x5f7a3a] });
      M.put('barco', 40.0, 47.8, 1, 0, { keep: true });
      M.put('bote', 14.0, 47.4, 1, 0); M.put('bote', 30.2, 53.6, 1, 0); M.put('balsa', 57.0, 53.4, 0, 1);
      for (const [x, z] of [[10.4, 46.6], [12.4, 48.6], [20.0, 46.2], [22.2, 46.4], [27.4, 48.8], [43.4, 53.6], [50.0, 53.8]]) M.put('nasas', x, z, rng() < 0.5 ? 1 : 0, rng() < 0.5 ? 1 : 0.4);
      for (let x = 6; x < 60; x += 6) M.put('noray', x + 0.5, 55.0, 0, 1, { keep: true });
      M.put('surtidor', 31.0, 46.4, 0, 1); M.put('ibc', 29.2, 45.6, 0, 1); M.put('bidones', 32.8, 45.4, 0, 1);
      M.put('montacargas', 25.0, 53.8, 1, 0); M.put('palets', 17.2, 49.0, 0, 1); M.put('cajas', 45.6, 48.8, 0, 1); M.put('lona', 53.0, 49.0, 0, 1);
      M.put('camioneta', 8.6, 53.4, 1, 0, { col: 0x5a6a7a }); M.put('carrito', 47.6, 53.4, 0.7, 0.7); M.put('barrera', 36.4, 53.9, 1, 0); M.put('barrera', 40.6, 53.9, 1, 0);
      M.puddle(24, 51.4, 2.8, 1.3); M.puddle(44, 51.6, 2.2, 1.0); M.puddle(12, 51.8, 1.8, 0.9);

      // ---- farolas, algún árbol y los de fuera ----
      for (const [x, z] of [[29, 12], [35, 30], [29, 40], [10, 21], [48, 27], [16, 44], [40, 44], [58, 44]]) M.pole(x, z);
      for (const [x, z] of [[4, 8], [27, 8], [36, 7], [4, 28], [28, 30]]) M.tree(x, z, false);
      for (const [x, z] of [[18, 8], [47, 21], [5, 20], [59, 20]]) M.bush(x, z);
      for (const [x, z] of [[5.0, 31.0], [36.6, 42.2], [59.4, 28.6]]) M.put('palmera', x, z, 0, 1);
      for (let z = 0; z < 54; z += 2) for (const x of [0, 1, 62, 63]) if ((z < 21 || z > 27) && rng() < 0.6 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.3);
      for (let x = 2; x < 62; x += 2) for (const z of [1, 3]) if ((x < 29 || x > 35) && rng() < 0.65 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.3);
    }
  };

  // -----------------------------------------------------------------------------------------------------
  // Aserradero Pino Alto: tierra adentro, un claro en el bosque de pinos, con niebla. Se entra por el sur, por
  // la pista de los camiones. En el centro, el patio de los troncos: pilas en filas (cobertura y pasillos),
  // camiones a medio cargar y carretillas. Al norte, la nave de la sierra (alta, con los portones abiertos) y la
  // oficina; al este, las cabañas de los leñadores; al suroeste, la casa del capataz y, al sureste, el comedor.
  // Alrededor, tocones, árboles caídos y el bosque, que ya se está comiendo el claro
  // -----------------------------------------------------------------------------------------------------
  MAPS.aserradero = {
    wild: 1, name: 'Aserradero Pino Alto', min: 4, max: 60, spawn: { x: 32.5, z: 56.0 }, seed: 6969, fence: 'chain', tallGrass: true, escape2: true,
    lanes: [[30.6, 22, 34.4, 59], [13, 34.6, 51, 37.4]],
    keepClear: [[12, 21, 52, 50], [29, 50, 36, 60]],
    board: { x: 36.6, z: 56.4, fx: 0, fz: -1 },
    // niebla de bosque: verde gris, el sol apenas pasa, se ve poco a lo lejos
    mood: { sky: 0xa8b4a8, fog: 0.62, hemi: [0xc2ccc0, 0x3e4632, 0.74], sun: [0xe8ecd8, 0.6],
      ground: { 0: [0x4e6636, 0x5e763e], 3: [0x5c4e3c, 0x685842], 1: [0x45474a, 0x505255], 2: [0x86867e, 0x92918a] } },
    skyline: { col: 0x566650, h: [3, 6] },
    // relieve: el patio y los edificios, llanos; alrededor, lomas suaves
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 761) - 0.5, n2 = V(x / 17, z / 17, 762) - 0.5;
      const d = Math.max(8 - x, x - 56, 6 - z, z - 58, 0);
      const k = U.clamp(d / 5, 0, 1);
      return k * Math.max(0, 0.5 + n * 0.9 + n2 * 1.6);
    },
    build(M, rng) {
      const F = G.World.F;
      M.ground(0, 0, 64, 64, F.GRASS);
      M.ground(12, 21, 52, 50, F.DIRT);                    // el patio de los troncos
      M.ground(29, 50, 36, 64, F.DIRT);                    // la pista de los camiones
      M.ground(5, 20, 12, 23, F.DIRT); M.ground(27, 20, 39, 22, F.DIRT);

      // ---- norte: la nave de la sierra y la oficina ----
      M.building('nave_t', 6, 8, 20, 12, 'S', (c, b, li, E2) => { paint(0x8a7a62, 0x5a5248)(c, b); naveOpen(6, 8)(c, b, li, E2); });
      M.building('oficinas_t', 40, 9, 10, 8, 'S', paint(0x9a8a6a, 0x4a4a42));
      M.building('cabana', 53, 10, 6, 6, 'W', paint(0x7a6a52, 0x3e3a34));
      M.put('tablas', 9.0, 12.0, 1, 0); M.put('tablas', 9.0, 14.0, 1, 0); M.put('palets', 16.0, 10.2, 0, 1); M.put('mesa', 13.0, 15.4, 0, 1);
      M.put('cajas', 23.0, 10.4, 0, 1); M.put('bidones', 24.4, 17.6, 0, 1); M.put('montacargas', 30.0, 15.0, 0, 1);
      M.put('troncos', 33.0, 10.6, 0, 1); M.put('ibc', 37.6, 10.4, 0, 1); M.put('lona', 36.4, 18.4, 0, 1); M.put('cubos', 51.4, 18.6, 0, 1);

      // ---- el patio: las pilas de troncos en filas (los pasillos del centro quedan libres) ----
      for (const [x, z, al] of [[17, 25.4, 1], [24, 25.6, 1], [41, 25.4, 1], [48, 25.8, 1], [16.4, 30.4, 1], [25, 30.6, 1], [40.4, 30.2, 1], [47.6, 31.0, 1],
        [17.2, 40.6, 1], [24.6, 41.0, 1], [41, 40.4, 1], [47.8, 41.2, 1], [16.6, 46.0, 1], [25.2, 46.4, 1], [40.6, 46.2, 1]]) {
        const W2 = 4.4 + rng() * 1.2, D2 = 2.0 + rng() * 0.8;
        M.put('troncos', x, z, 0, 1, { x0: x - W2 / 2, x1: x + W2 / 2, z0: z - D2 / 2, z1: z + D2 / 2, h: 1.3 + rng() * 0.7 });
      }
      M.put('camion', 37.0, 28.0, 0, 1, { col: 0x6a5a4a }); M.put('camion', 28.0, 44.0, 0, -1, { col: 0x5a6a5a });
      M.put('montacargas', 21.0, 35.6, 1, 0); M.put('montacargas', 44.6, 36.4, -1, 0); M.put('camioneta', 48.0, 46.6, 1, 0, { col: 0x7a5a3a });
      M.put('tablas', 14.0, 33.4, 1, 0); M.put('palets', 50.0, 34.0, 0, 1); M.put('bidones', 13.4, 48.4, 0, 1); M.put('neumaticos', 36.6, 47.6, 0, 1);
      M.puddle(32.4, 30, 2.2, 3.0); M.puddle(22, 37.6, 2.6, 1.2); M.puddle(43, 34.4, 2.0, 1.0); M.puddle(33, 46, 1.6, 2.4);

      // ---- este: las cabañas de los leñadores; suroeste: la casa del capataz; sureste: el comedor ----
      M.building('cabana', 53, 22, 6, 6, 'W', paint(0x7c6c54, 0x3e3a34));
      M.building('cabana', 53, 34, 6, 6, 'W', paint(0x86745a, 0x44403a));
      M.building('cabana', 53, 43, 6, 6, 'W', paint(0x74644e, 0x3a3630));
      M.building('casa4', 5, 42, 8, 8, 'E', paint(0x8e7c60, 0x4a4238));
      M.building('tienda2', 39, 51, 10, 8, 'N', (c, b) => { paint(0x94846a, 0x4e463c)(c, b); b.sign = ['COMEDOR', '#6a4a2a']; });
      M.put('fogata', 55.6, 30.8, 0, 1); M.put('banco_parque', 55.6, 29.4, 0, 1); M.put('tendedero', 55.6, 41.6, 0, 1, { old: true });
      M.put('mesa_campo', 51.0, 53.0, 1, 0, { old: true }); M.put('cubos', 37.6, 52.4, 0, 1); M.put('cobertizo', 9.0, 53.6, 0, -1);
      M.put('coche', 10.0, 39.4, 1, 0, { col: 0x3a3632 }); M.put('jardinera', 6.0, 36.6, 0, 1); M.put('ibc', 14.6, 44.6, 1, 0);
      M.put('barricada', 29.6, 58.6, 0, 1, { keep: true }); M.put('barricada', 35.6, 58.4, 0, 1, { keep: true }); M.put('senal', 36.6, 52.0, 0, 1);

      // ---- tocones y árboles caídos en el borde del claro; hierba alta y el bosque ----
      for (const [x, z] of [[8.6, 24.6], [10.2, 28.4], [7.4, 31.6], [9.6, 33.6], [20.6, 52.6], [24.4, 55.2], [17.2, 56.4], [46.0, 20.4], [50.6, 20.0], [27.6, 5.6], [33.4, 6.4], [52.0, 56.6]]) M.put('tocon', x, z, 0, 1);
      M.put('arbol_caido', 22.0, 54.0, 1, 0.3); M.put('arbol_caido', 8.6, 26.6, 0.2, 1); M.put('arbol_caido', 48.6, 18.0, 1, -0.2);
      M.tall(5, 23, 11, 34); M.tall(14, 51, 28, 59); M.tall(27, 4, 39, 8); M.tall(44, 18, 53, 21);
      for (const [x, z] of [[5, 5], [28, 6], [36, 5], [51, 6], [58, 18], [5, 22], [6, 30], [58, 30], [5, 56], [16, 53], [26, 57], [50, 57], [57, 52], [45, 5], [38, 21]]) M.tree(x, z, true);
      for (const [x, z] of [[12, 52], [27, 52], [37, 58], [58, 40], [4, 38], [30, 4]]) M.bush(x, z);
      for (const [x, z] of [[13, 23], [51, 23], [13, 49], [36, 49], [28, 21]]) M.pole(x, z);
    }
  };

  // =====================================================================================================
  // Paradas de Retorno (descansos jugables, ver calm.js): sitios tranquilos del camino, sin enemigos, con algo que
  // resolver. No salen en la lista de mapas (hidden). Lo que usa G.Calm va en «calm»: dónde se colocan las piezas de
  // cada acertijo (la escalera, los escondites de la llave, el fardo del árbol, el baúl...) y por dónde se sigue.
  // =====================================================================================================
  // La granja del manzano: una granja al caer la tarde, con la casa de dos plantas atrancada, el granero, la huerta
  // con su espantapájaros y el manzanar. Se entra por la cancela del sur
  MAPS.calma_granja = {
    wild: 0.55, name: 'La granja del manzano', hidden: true, calm: true, noBoss: true, hour: 18.15, hourFixed: true,
    min: 0, max: 56, bounds: [6.05, 6.05, 49.95, 49.6], play: [[7, 7, 49, 49]], spawn: { x: 28.0, z: 46.8 }, seed: 3131,
    fence: 'wood', perimeter: false, tallGrass: true,
    lanes: [[26.6, 21, 29.4, 50]],
    keepClear: [[9, 8, 41, 30], [25, 28, 32, 50], [28, 28, 37, 38], [9, 29, 22, 43], [36, 28, 49, 48]],
    // tarde dorada: el sol bajo y cálido, el aire limpio
    mood: { sky: 0xd9c7a8, fog: 1.15, hemi: [0xf2e2c8, 0x56503c, 0.78], sun: [0xffd6a0, 1.05],
      ground: { 0: [0x6c8644, 0x7a944c], 3: [0x7c6648, 0x88724e], 1: [0x4a4c4e, 0x545658], 2: [0x9a968c, 0xa4a096] } },
    skyline: { col: 0x6a7656, h: [3, 6] },
    calm: {
      puzzles: [
        { type: 'ladder', house: { x0: 13, z0: 11, x1: 23, z1: 20, win: { x: 24.2, z: 13.6 } },
          ladders: [[37.4, 18.8, 1, 0], [29.2, 24.6, 1, 0], [44.6, 42.4, 0, 1]],
          chest: { label: 'Abrir el arcón del dormitorio', head: 'El arcón del dormitorio', out: { monedas: 5, piezas: 20, items: { venda: 1 }, balas: 1 },
            text: 'Debajo de las mantas: una caja de munición, vendas y el dinero de la familia, atado con una goma.' } },
        { type: 'keyhunt', keyName: 'la llave de la bodega',
          hides: { caseta: [25.4, 23.0, 0], pozo: [21.0, 26.0, 0], espantapajaros: [14.6, 36.4, 0], buzon: [30.4, 44.6, 0] },
          clue: { x: 21.9, z: 21.35, label: 'Leer la nota del banco', title: 'Una nota, sujeta con una piedra',
            text: 'Ruth:\nHe cambiado el candado de la bodega. La llave {where}\nNo se la des a nadie, ni a los del escorpión aunque pregunten bonito.\nLas conservas buenas están al fondo, detrás de las patatas.\n— Celso' },
          target: { kind: 'cellar', x: 11.2, z: 15.6, face: -Math.PI / 2, name: 'la bodega', look: 'La trampilla de la bodega' },
          reward: { head: 'La bodega', out: { suplementos: 30, piezas: 15, items: { molotov: 1 } },
            text: 'En los escalones de la bodega: conservas, una botella de alcohol preparada y las herramientas del abuelo.' } },
        { type: 'rope', x: 42.5, z: 35.5, hx: 43.9, hz: 35.9, y: 3.4, fell: 'El fardo ha caído',
          near: 'En el manzano grande cuelga un fardo, muy alto. La cuerda está gastada: un disparo bastaría',
          reward: { head: 'El fardo del manzano', out: { monedas: 3, balas: 1.5, items: { mina: 1 } }, text: 'Lo que alguien colgó del manzano para que no lo encontraran: munición y una mina hecha a mano.' } }
      ],
      lore: [[31.0, 32.6, 'granja_1'], [34.4, 15.6, 'granja_2']],
      rest: { x: 32.6, z: 34.6 },
      exit: { x: 28.0, z: 48.6 }
    },
    // relieve: la granja llana; fuera de la valla, lomas suaves con bosque
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 771) - 0.5, n2 = V(x / 17, z / 17, 772) - 0.5;
      const d = Math.max(7 - x, x - 49, 7 - z, z - 49, 0);
      const k = U.clamp(d / 5, 0, 1);
      // (el manzanar, apenas ondulado)
      const orch = x > 37 && z > 29 ? Math.max(0, n2) * 0.25 : 0;
      return k * Math.max(0, 0.6 + n * 0.9 + n2 * 1.8) + orch;
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E, FE = E.FENCE;
      M.ground(0, 0, 56, 56, F.GRASS);
      M.ground(12, 20, 41, 29, F.DIRT);                  // el patio, entre la casa, el granero y el pozo
      M.ground(26, 29, 30, 56, F.DIRT);                  // el camino de la cancela
      M.ground(9, 30, 22, 43, F.DIRT);                   // la huerta (tierra removida)

      // ---- la valla de tablas (la cancela, al sur) ----
      M.wallN(6, 26, 50, FE); M.wallN(30, 50, 50, FE); M.wallN(6, 50, 6, FE);
      M.wallW(6, 50, 6, FE); M.wallW(6, 50, 50, FE);
      M.put('poste', 26.0, 50.0, 0, 1, { keep: true }); M.put('poste', 30.0, 50.0, 0, 1, { keep: true });
      M.put('buzon', 30.4, 44.6, 0, 1, { keep: true });

      // ---- la casa (dos plantas, atrancada por dentro) y el granero ----
      M.building('casa5', 13, 11, 10, 9, 'S', paint(0xd8ccb2, 0x7a3a2e));
      M.building('cabana', 32, 10, 6, 6, 'S', paint(0x8a3e32, 0x4a4038));
      M.put('banco_parque', 22.2, 21.4, 0, 1);
      M.put('tendedero', 27.6, 15.0, 1, 0, { old: true });
      // (los escondites de la llave de la bodega: el pozo, la caseta del perro, el espantapájaros y el buzón)
      M.put('pozo', 21.0, 26.0, 0, 1, { keep: true }); M.put('caseta_perro', 25.4, 23.0, 0, 1, { keep: true });
      M.put('espantapajaros', 14.6, 36.4, 0, 1, { keep: true });
      M.put('cubos', 38.8, 13.6, 1, 0); M.put('palets', 31.0, 18.6, 0, 1); M.put('bidones', 39.0, 16.4, 0, 1);
      M.put('troncos', 31.2, 22.2, 0, 1, { x0: 29.4, x1: 33.0, z0: 21.4, z1: 23.0, h: 1.2 });
      M.put('camioneta', 37.0, 24.0, -1, 0, { col: 0x7a4a32 });
      M.put('tocon', 33.6, 25.8, 0, 1);

      // ---- la huerta: bancales y el espantapájaros ----
      for (const [x, z] of [[11.4, 31.6], [15.0, 31.6], [18.6, 31.6], [11.4, 34.0], [18.6, 34.0], [11.4, 39.6], [15.0, 39.6], [18.6, 39.6]]) M.put('jardinera', x, z, 0, 1, { old: true });

      // ---- el fuego: un banco y dos tocones bajo el nogal, mirando al manzanar ----
      M.put('fogata', 32.6, 34.6, 0, 1); M.put('banco_parque', 32.6, 33.0, 0, 1);
      M.put('tocon', 31.0, 35.8, 0, 1); M.put('tocon', 34.2, 35.8, 0, 1);
      M.tree(34, 30, false);

      // ---- el manzanar (uno de ellos, con un fardo colgado de una rama) ----
      for (const [x, z] of [[38, 30], [46, 30], [38, 35], [42, 35], [46, 35], [38, 40], [42, 40], [46, 40], [38, 45], [42, 45], [46, 45]]) M.tree(x, z, false);

      // ---- prados y bosque ----
      M.tall(7, 22, 12, 30); M.tall(22, 31, 26, 49); M.tall(7, 43, 22, 49); M.tall(41, 7, 49, 27); M.tall(31, 38, 36, 49);
      for (const [x, z] of [[9, 9], [9, 20], [26, 8], [44, 8], [48, 20], [8, 46], [23, 46]]) M.tree(x, z, rng() < 0.3);
      for (const [x, z] of [[24, 29], [36, 47], [10, 44], [48, 26], [12, 22]]) M.bush(x, z);
      M.put('arbol_caido', 15.6, 46.6, 1, 0.2); M.put('tocon', 44.2, 26.8, 0, 1); M.put('tocon', 8.8, 27.4, 0, 1);
      // fuera de la valla: el bosque cerrado
      for (let z = 0; z < 56; z += 2) for (const x of [0, 2, 52, 54]) if (rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.45);
      for (let x = 2; x < 54; x += 2) for (const z of [0, 2, 52, 54]) if (rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.45);
    }
  };

  // La casa del pescador: una cabaña en la costa de Oceanside al amanecer, con la caseta de la barca, el muelle de
  // tablas y el mar en calma (el faro se ve al otro lado de la bahía). Se llega por el sendero del noroeste
  MAPS.calma_pescador = {
    wild: 0.5, sandDirt: true, name: 'La casa del pescador', hidden: true, calm: true, noBoss: true, hour: 6.75, hourFixed: true,
    min: 0, max: 56, bounds: [6.05, 6.05, 49.95, 44.8], play: [[7, 7, 49, 44]], spawn: { x: 12.5, z: 9.4 }, seed: 2626,
    fence: 'wood', perimeter: false, tallGrass: true,
    lanes: [[11, 6, 14.5, 20], [11, 18, 30, 21.5]],
    keepClear: [[14, 17, 42, 44], [10, 6, 16, 22]],
    seaZ: 46.0,
    // amanecer: cielo rosado y frío, el mar quieto, una bruma muy ligera
    mood: { sky: 0xd8c4c0, fog: 1.0, hemi: [0xe6dce0, 0x585a52, 0.78], sun: [0xffd8bc, 0.85],
      ground: { 0: [0x748652, 0x80925a], 1: [0x4c4e50, 0x56585a], 2: [0xaaa69c, 0xb4b0a6], 3: [0xc8b892, 0xd2c29c] } },
    skyline: { beach: true, hills: [0xb8b4b0, 0x8a8a76], trees: [0x76866a, 0x66785c, 0x86926e, 0x5a6850], cape: -0.8 },
    // (con un cartel, el mapa lleva el mar: ver beachDecor)
    murals: [boardAt(35.0, 30.0, 0, 1, 'CASETA DE A. REYES\nRedes · cebo · nasas\nNo se presta la barca\n~Ni la caña')],
    calm: {
      deco: [{ kind: 'dock', x: 43.2, z0: 44.6, z1: 56, y: 0.72 }],
      puzzles: [
        { type: 'pick', id: 'cabin', bld: { x0: 18, z0: 20, x1: 24, z1: 26 },
          near: 'La cabaña está cerrada con llave. La cerradura es vieja: con una horquilla se podría forzar', opened: 'Clic. La cerradura cede: la cabaña está abierta',
          chest: { label: 'Abrir la alacena', head: 'La alacena', out: { suplementos: 25, items: { venda: 1 }, monedas: 2 }, text: 'Latas de sardinas, un botiquín de barco y unas monedas en un bote de café.' } },
        { type: 'combo', box: { x: 40.2, z: 33.8, face: -Math.PI / 2, style: 'baul' },
          readLabel: 'Leer la nota del baúl', openLabel: 'Abrir el candado del baúl', near: 'Un baúl con candado de combinación y una nota clavada en la tapa',
          names: ['la barca', 'el poste', 'la foto'],
          note: { title: 'Clavada en la tapa del baúl', text: 'Inés:\nLe he puesto un candado nuevo al baúl, que el de antes lo abría cualquiera. Para que no se te olvide:\n— La primera cifra es la de la barca (la Rosa).\n— La segunda la grabé en el primer poste del muelle.\n— La tercera, detrás de tu foto con el pez grande, en la caja de lata de casa.\n— Papá' },
          clues: [
            { x: 26.6, z: 39.4, px: 27.7, pz: 39.1, fx: 27.35, fz: 39.1, reach: 2.2, label: 'Mirar la barca', say: 'En el costado, con pintura blanca: ROSA {d}', hull: [1.3, 0.72, 3.4],
              decal: { lines: ['ROSA', '{d}'], size: 46, font: 'Arial, sans-serif', w: 0.9, h: 0.45, x: 27.32, y: 0.44, z: 38.9, ry: Math.PI / 2 } },
            { x: 42.0, z: 44.6, px: 41.6, pz: 44.6, fx: 41.8, fz: 44.6, reach: 1.7, label: 'Mirar el poste del muelle', say: 'Grabado a navaja en la madera del poste: un {d}', post: true,
              decal: { lines: ['{d}'], size: 96, col: '#2a2018', tw: 128, th: 128, w: 0.16, h: 0.16, x: 41.865, y: 0.95, z: 44.6, ry: -Math.PI / 2, opa: 0.8 } },
            { kind: 'in', inside: 'cabin', label: 'Mirar la caja de las fotos', title: 'Una caja de lata con fotos', text: 'La de arriba: Inés de niña, mojada hasta las orejas, con un pez casi tan grande como ella.\nDetrás, a lápiz: «{d}»' }
          ],
          reward: { head: 'El baúl de Anselmo', out: { monedas: 6, piezas: 25, balas: 1 }, text: 'Dentro, envueltos en hule: los ahorros de Anselmo y piezas de recambio del motor de la barca.' } },
        { type: 'power', cans: [[16.4, 23.6], [39.0, 26.6], [29.0, 41.0]], gen: { x: 31.0, z: 31.6 },
          bulbs: [[37.6, 30.6, 2.4], [42.3, 48.6, 2.0, 0.72]],
          target: { kind: 'winch', winch: { x: 38.8, z: 43.2 }, cage: { x0: 39.4, z0: 51.5, x1: 40.4, z1: 43.9 }, cableTo: 'El cable va al generador de la caseta' },
          reward: { head: 'La jaula hundida', out: { monedas: 4, piezas: 20, items: { molotov: 1 }, balas: 1 }, text: 'Un bidón estanco: lo que Anselmo no quería que encontrara nadie.' } }
      ],
      lore: [[25.8, 34.4, 'pesc_1'], [44.6, 28.6, 'pesc_2']],
      rest: { x: 24.6, z: 36.4 },
      exit: { x: 12.6, z: 7.4 }
    },
    // relieve: la explanada, algo ondulada; al sur baja despacio por la playa hasta el agua (z 46)
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 6, z / 6, 851) - 0.5, n2 = V(x / 15, z / 15, 852) - 0.5, C = U.clamp;
      const top = 0.9 + n2 * 0.25;
      if (z > 45.5) return U.lerp(0.25, -0.85, C((z - 45.5) / 2.5, 0, 1));
      if (z > 38) return U.lerp(top, 0.25, U.smooth((z - 38) / 7.5)) + n * 0.06;
      const d = Math.max(7 - x, x - 49, 7 - z, 0);
      return top + C(d / 5, 0, 1) * Math.max(0, 0.5 + n * 0.8 + n2 * 1.4);
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E, FE = E.FENCE;
      M.ground(0, 0, 56, 56, F.GRASS);
      M.ground(0, 38, 56, 56, F.DIRT);                   // la arena
      M.ground(11, 0, 15, 21, F.DIRT); M.ground(11, 18, 32, 22, F.DIRT);     // el sendero
      M.ground(17, 26, 40, 33, F.DIRT);                  // delante de la cabaña y de la caseta

      // ---- el borde: tablas al norte y a los lados; al sur, el mar ----
      M.wallN(6, 11, 6, FE); M.wallN(15, 50, 6, FE);
      M.wallW(6, 38, 6, FE); M.wallW(6, 38, 50, FE);
      M.put('poste', 11.0, 6.0, 0, 1, { keep: true }); M.put('poste', 15.0, 6.0, 0, 1, { keep: true });

      // ---- la cabaña (cerrada con llave) y la caseta de la barca ----
      M.building('cabana', 18, 20, 6, 6, 'S', paint(0xb8ae9a, 0x5a4a3e));
      M.building('cabana', 32, 24, 6, 6, 'S', paint(0x7c8e96, 0x3e4448));
      M.put('troncos', 16.0, 25.0, 0, 1, { x0: 14.8, x1: 17.2, z0: 24.2, z1: 25.8, h: 1.0 });
      M.put('tendedero', 27.4, 23.2, 1, 0, { old: true });
      M.put('generador', 31.0, 31.6, 0, 1, { keep: true });
      M.put('lona', 40.4, 32.4, -1, 0); M.put('nasas', 35.4, 36.6, 0, 1); M.put('nasas', 36.8, 35.2, 1, 0);
      M.put('cubos', 30.0, 24.2, 0, 1); M.put('palets', 39.6, 29.4, 0, 1);

      // ---- la playa: la barca volcada, el fuego, rocas y el arranque del muelle ----
      M.put('bote', 26.6, 39.4, 1, 0);
      M.put('fogata', 24.6, 36.4, 0, 1); M.put('tocon', 23.2, 37.4, 0, 1); M.put('tocon', 26.0, 37.6, 0, 1);
      M.put('noray', 44.6, 43.4, 0, 1, { keep: true });
      for (const [x, z, w, d] of [[13.4, 42.4, 1.6, 1.1], [17.6, 43.0, 1.2, 0.9], [46.6, 41.6, 1.8, 1.2], [8.6, 40.4, 1.4, 1.0], [48.4, 38.6, 1.2, 1.0]]) M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.5 + rng() * 0.5 });
      for (const [x, z] of [[10.6, 37.2], [44.6, 37.0], [20.4, 41.2], [33.4, 40.4]]) M.put('agave', x, z, 0, 1);

      // ---- árboles: pinos y eucaliptos hacia tierra, el bosque por fuera ----
      M.tall(7, 7, 11, 18); M.tall(41, 8, 49, 22); M.tall(7, 26, 14, 36); M.tall(43, 30, 49, 36);
      for (const [x, z] of [[8, 12], [17, 9], [25, 8], [34, 9], [44, 12], [47, 24], [8, 22], [12, 30], [45, 30], [29, 13]]) M.tree(x, z, rng() < 0.6);
      for (const [x, z] of [[15, 29], [42, 25], [21, 14], [38, 12]]) M.bush(x, z);
      for (let z = 0; z < 38; z += 2) for (const x of [0, 2, 52, 54]) if (rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.6);
      for (let x = 2; x < 54; x += 2) for (const z of [0, 2]) if ((x < 10 || x > 16) && rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.6);
    }
  };

  // El camping del embalse: un camping a la orilla de un embalse, a media mañana. Las tiendas abandonadas, la caseta
  // del guarda (cerrada con llave), el tablón, la torre del socorrista y tres barcas en la arena. Se entra por el norte
  MAPS.calma_lago = {
    wild: 0.5, sandDirt: true, name: 'El camping del embalse', hidden: true, calm: true, noBoss: true, hour: 10.4, hourFixed: true,
    min: 0, max: 56, bounds: [6.05, 6.05, 49.95, 44.8], play: [[7, 7, 49, 44]], spawn: { x: 28.0, z: 8.8 }, seed: 5151,
    fence: 'wood', perimeter: false, tallGrass: true,
    lanes: [[26.5, 6, 29.5, 18]],
    keepClear: [[12, 9, 46, 44]],
    seaZ: 45.5,
    // mañana clara: luz blanca, el agua quieta, verde por todas partes
    mood: { sky: 0xc8d4d8, fog: 1.1, hemi: [0xe4ece8, 0x52584a, 0.8], sun: [0xfff0d8, 1.0],
      ground: { 0: [0x6a8a48, 0x76964e], 1: [0x4c4e50, 0x56585a], 2: [0xaaa69c, 0xb4b0a6], 3: [0xc4b490, 0xcebe9a] } },
    skyline: { beach: true, hills: [0x9aa4a0, 0x7a8670], trees: [0x5e7650, 0x50684a, 0x6a7c56, 0x48603e], cape: 0.6 },
    murals: [boardAt(30.6, 18.6, 0, 1, 'CAMPING EL EMBALSE\nNo hacer fuego fuera\nde las zonas marcadas\n~Prohibido bañarse sin socorrista')],
    calm: {
      deco: [{ kind: 'dock', x: 30.0, z0: 43.4, z1: 54, y: 0.72 }],
      puzzles: [
        { type: 'keyhunt', keyName: 'la llave de la caseta',
          hides: { nevera: [23.0, 25.6, 0.3], tienda: [11.5, 22.5, 0], lena: [9.6, 31.5, 0], mesa: [35.5, 34.5, 0] },
          clue: { x: 31.25, z: 18.68, y: 1.12, wall: true, ry: 0, fx: 31.0, fz: 19.6, label: 'Leer la nota del tablón', title: 'Clavada en el tablón',
            text: 'Para el turno de mañana:\nLa llave de la caseta {where}\nSi no vuelvo, quedaos lo que haya dentro. Y no dejéis la puerta abierta, que entran los zorros.\n— Germán' },
          target: { kind: 'door', id: 'caseta', bld: { x0: 34, z0: 10, x1: 40, z1: 16 }, near: 'La caseta del guarda está cerrada con llave. En el tablón hay una nota clavada' },
          reward: { label: 'Abrir la taquilla del guarda', head: 'La taquilla del guarda', out: { monedas: 4, piezas: 20, balas: 1 },
            text: 'La escopeta no está, pero sí su munición, la caja del camping y las herramientas de mantenimiento.' } },
        { type: 'combo', box: { x: 39.0, z: 38.4, face: -Math.PI / 2, style: 'baul' },
          readLabel: 'Leer la nota de la caja', openLabel: 'Abrir el candado de la caja', near: 'La caja de la torre del socorrista, con un candado de combinación',
          names: ['la verde', 'la roja', 'la azul'],
          note: { title: 'Pegada en la caja', text: 'Socorristas:\nLa combinación del candado es la de las barcas, en este orden: la de la franja verde, la de la roja y la de la azul.\nNo la apuntéis en ningún otro sitio, que nos conocemos.\n— Marga' },
          clues: [
            { x: 15.5, z: 39.0, px: 16.6, pz: 38.7, fx: 16.25, fz: 38.7, reach: 2.2, label: 'Mirar la barca de la franja verde', say: 'Pintado en el costado, sobre la franja verde: un {d}', hull: [1.3, 0.72, 3.4],
              decal: { lines: ['{d}'], size: 84, tw: 256, th: 128, bg: '#2e7a3e', w: 0.7, h: 0.35, x: 16.22, y: 0.44, z: 38.5, ry: Math.PI / 2 } },
            { x: 21.0, z: 39.8, px: 22.1, pz: 39.5, fx: 21.75, fz: 39.5, reach: 2.2, label: 'Mirar la barca de la franja roja', say: 'Pintado en el costado, sobre la franja roja: un {d}', hull: [1.3, 0.72, 3.4],
              decal: { lines: ['{d}'], size: 84, tw: 256, th: 128, bg: '#a8321e', w: 0.7, h: 0.35, x: 21.72, y: 0.44, z: 39.3, ry: Math.PI / 2 } },
            { x: 46.6, z: 38.8, px: 47.7, pz: 38.5, fx: 47.35, fz: 38.5, reach: 2.2, label: 'Mirar la barca de la franja azul', say: 'Pintado en el costado, sobre la franja azul: un {d}', hull: [1.3, 0.72, 3.4],
              decal: { lines: ['{d}'], size: 84, tw: 256, th: 128, bg: '#2a5a9a', w: 0.7, h: 0.35, x: 47.32, y: 0.44, z: 38.3, ry: Math.PI / 2 } }
          ],
          reward: { head: 'La caja del socorrista', out: { suplementos: 30, monedas: 3, items: { venda: 2 } }, text: 'El botiquín de la torre, sin estrenar, y el bote de las propinas del verano.' } },
        { type: 'rope', x: 17.5, z: 28.5, hx: 18.9, hz: 28.7, y: 3.6, bag: 'mochila', openLabel: 'Abrir la mochila', lookLabel: 'Mirar la mochila colgada', fell: 'La mochila ha caído',
          near: 'De una rama alta cuelga una mochila: así guardan la comida los campistas, lejos de los animales. La cuerda no aguantaría un disparo',
          reward: { head: 'La mochila del árbol', out: { suplementos: 20, monedas: 2, items: { venda: 1 } }, text: 'Comida en lata, un mechero y unas vendas: la despensa de alguien que pensaba volver.' } }
      ],
      lore: [[25.3, 19.5, 'lago_1'], [21.2, 24.5, 'lago_2']],
      rest: { x: 27.5, z: 29.0 },
      exit: { x: 28.0, z: 7.2 }
    },
    // relieve: la explanada del camping; al sur baja despacio hasta el agua (z 45,5)
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 6, z / 6, 951) - 0.5, n2 = V(x / 15, z / 15, 952) - 0.5, C = U.clamp;
      const top = 0.8 + n2 * 0.2;
      if (z > 45) return U.lerp(0.25, -0.9, C((z - 45) / 2.5, 0, 1));
      if (z > 37) return U.lerp(top, 0.25, U.smooth((z - 37) / 8)) + n * 0.05;
      const d = Math.max(7 - x, x - 49, 7 - z, 0);
      return top + C(d / 5, 0, 1) * Math.max(0, 0.5 + n * 0.8 + n2 * 1.4);
    },
    build(M, rng) {
      const F = G.World.F, FE = G.World.E.FENCE;
      M.ground(0, 0, 56, 56, F.GRASS);
      M.ground(0, 37, 56, 56, F.DIRT);                   // la arena de la orilla
      M.ground(26, 0, 30, 20, F.DIRT); M.ground(22, 18, 40, 22, F.DIRT);     // el camino y la explanada de la caseta
      M.ground(24, 26, 31, 32, F.DIRT);                  // el fuego
      // ---- el borde: tablas al norte (con la entrada) y a los lados; al sur, el agua ----
      M.wallN(6, 26, 6, FE); M.wallN(30, 50, 6, FE);
      M.wallW(6, 37, 6, FE); M.wallW(6, 37, 50, FE);
      M.put('poste', 26.0, 6.0, 0, 1, { keep: true }); M.put('poste', 30.0, 6.0, 0, 1, { keep: true });
      // ---- la caseta del guarda, el tablón y un banco ----
      M.building('cabana', 34, 10, 6, 6, 'S', paint(0x7a6a4e, 0x3e4a3a));
      M.put('cartel_madera', 30.6, 18.6, 0, 1, { keep: true });
      M.put('banco_parque', 25.0, 19.6, 0, 1, { keep: true });
      M.put('cubos', 41.4, 12.0, -1, 0); M.put('bidones', 41.6, 14.6, -1, 0);
      // ---- las tiendas (una sola, junto al pino) y las mesas ----
      M.put('tienda', 15.5, 14.5, 0, 1, { keep: true }); M.put('tienda', 20.5, 13.0, 1, 0, { keep: true, old: true });
      M.put('tienda', 11.5, 22.5, 0, 1, { keep: true });
      M.tree(9, 24, true);
      M.put('mesa_campo', 21.5, 24.5, 0, 1, { keep: true, old: true });
      M.put('mesa_campo', 35.5, 34.5, 0, 1, { keep: true, old: true });
      M.put('saco_dormir', 17.8, 18.4, 1, 0.3);
      M.put('troncos', 9.6, 31.5, 0, 1, { x0: 8.4, x1: 10.8, z0: 30.7, z1: 32.3, h: 1.1, keep: true });
      // ---- el fuego (un banco y dos tocones) y el árbol de la mochila ----
      M.put('fogata', 27.5, 29.0, 0, 1); M.put('banco_parque', 27.5, 27.4, 0, 1, { keep: true });
      M.put('tocon', 26.0, 30.3, 0, 1); M.put('tocon', 29.0, 30.3, 0, 1);
      M.tree(17, 28, false);
      // ---- la orilla: la torre del socorrista, tres barcas y el embarcadero ----
      M.put('socorrista', 41.5, 38.8, 0, 1, { keep: true });
      M.put('bote', 15.5, 39.0, 1, 0, { keep: true }); M.put('bote', 21.0, 39.8, 1, 0, { keep: true }); M.put('bote', 46.6, 38.8, 1, 0, { keep: true });
      M.put('noray', 31.6, 43.2, 0, 1, { keep: true });
      for (const [x, z, w, d] of [[9.6, 41.4, 1.4, 1.0], [12.2, 43.0, 1.0, 0.8], [36.4, 42.4, 1.2, 0.9]]) M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.4 + rng() * 0.4 });
      // ---- árboles: pinos hacia tierra, el bosque por fuera ----
      M.tall(7, 7, 13, 12); M.tall(42, 18, 49, 30); M.tall(7, 33, 13, 37); M.tall(36, 22, 42, 30);
      for (const [x, z] of [[8, 9], [12, 8], [22, 8], [33, 7], [44, 8], [47, 15], [46, 22], [8, 15], [8, 28], [44, 30], [33, 23], [14, 34]]) M.tree(x, z, rng() < 0.65);
      for (const [x, z] of [[24, 15], [31, 24], [40, 31], [13, 27], [44, 18]]) M.bush(x, z);
      for (let z = 0; z < 38; z += 2) for (const x of [0, 2, 52, 54]) if (rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.6);
      for (let x = 2; x < 54; x += 2) for (const z of [0, 2]) if ((x < 24 || x > 32) && rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.6);
    }
  };

  // La gasolinera de la nacional: una gasolinera en una carretera vacía, a mediodía. La tienda (la puerta es
  // automática: hace falta el generador), el taller (cerrado con llave), la marquesina con los surtidores y el
  // cartel de precios junto a la carretera. Se llega por la carretera, desde el oeste
  MAPS.calma_gasolinera = {
    wild: 0.45, name: 'La gasolinera de la nacional', hidden: true, calm: true, noBoss: true, hour: 13.6, hourFixed: true,
    min: 0, max: 56, bounds: [6.05, 6.05, 49.95, 49.95], play: [[7, 7, 49, 49]], spawn: { x: 9.0, z: 36.0 }, seed: 6161,
    fence: 'wood', perimeter: false, tallGrass: true,
    lanes: [[0, 33, 56, 39]],
    keepClear: [[12, 10, 47, 33], [0, 32, 56, 40]],
    // mediodía de secano: luz dura y blanca, el aire caliente
    mood: { sky: 0xe2dccc, fog: 1.2, hemi: [0xf4ecda, 0x5e5644, 0.82], sun: [0xfff2d8, 1.15],
      ground: { 0: [0x8a8a52, 0x96945a], 1: [0x55534e, 0x5e5c56], 2: [0xa8a294, 0xb2ac9e], 3: [0x9a8a64, 0xa4946c] } },
    skyline: { col: 0x8a8670, h: [2, 5] },
    murals: [boardAt(45.2, 20.6, 0, 1, 'TALLER MECÁNICO\nRuedas · aceite · chapa\n~Pregunte en la tienda')],
    calm: {
      puzzles: [
        { type: 'pick', id: 'taller', bld: { x0: 34, z0: 13, x1: 42, z1: 19 },
          near: 'El taller está cerrado con llave. La cerradura es vieja: con una horquilla se podría forzar', opened: 'Clic. La puerta del taller se abre',
          chest: { label: 'Abrir el armario de herramientas', head: 'El armario del taller', out: { piezas: 30, monedas: 2, items: { molotov: 1 } },
            text: 'Llaves, un gato, una garrafa con un trapo metido en la boca... y la caja chica del taller.' } },
        { type: 'power', cans: [[36.6, 30.0], [11.6, 25.4], [44.4, 22.2]], gen: { x: 17.4, z: 16.0 },
          bulbs: [[18.6, 21.2, 2.8], [22.6, 25.0, 3.4]],
          target: { kind: 'door', id: 'tienda', bld: { x0: 20, z0: 12, x1: 30, z1: 20 }, near: 'La puerta de la tienda es automática y no hay corriente. Detrás hay un generador',
            opened: 'Con un zumbido, la puerta automática de la tienda se abre' },
          reward: { label: 'Abrir la caja registradora', head: 'La tienda', out: { suplementos: 35, monedas: 5, items: { venda: 1 } },
            text: 'Detrás del mostrador: bebidas, chocolatinas, un botiquín de coche y la recaudación del último día.' } },
        { type: 'rope', x: 13.6, z: 32.8, hx: 13.95, hz: 31.5, y: 2.6, rope: 0.9, bag: 'mochila', openLabel: 'Abrir la bolsa', lookLabel: 'Mirar la bolsa colgada', fell: 'La bolsa ha caído',
          near: 'Del cartel de precios cuelga una bolsa de deporte, atada con una cuerda fina. Un disparo bastaría',
          reward: { head: 'La bolsa del cartel', out: { monedas: 3, balas: 1.5 }, text: 'Alguien la colgó ahí para recogerla al volver: munición y unas monedas.' } }
      ],
      lore: [[32.9, 21.15, 'gas_1'], [45.3, 23.5, 'gas_2']],
      rest: { x: 45.5, z: 26.2 },
      exit: { x: 7.2, z: 36.0 }
    },
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 1071) - 0.5, n2 = V(x / 17, z / 17, 1072) - 0.5;
      const d = Math.max(7 - x, x - 49, 7 - z, z - 49, 0);
      const k = U.clamp(d / 5, 0, 1);
      // (los campos de detrás, apenas ondulados)
      const fld = z > 41 ? Math.max(0, n2) * 0.3 : 0;
      return k * Math.max(0, 0.5 + n * 0.9 + n2 * 1.6) + fld;
    },
    build(M, rng) {
      const F = G.World.F, FE = G.World.E.FENCE;
      M.ground(0, 0, 56, 56, F.GRASS);
      M.ground(0, 33, 56, 39, F.ROAD);                    // la carretera
      M.ground(14, 20, 44, 33, F.ROAD);                   // la explanada de la gasolinera
      M.ground(14, 8, 46, 20, F.DIRT);                    // detrás
      M.ground(42, 20, 49, 30, F.DIRT);
      // ---- el borde: tablas, con la carretera abierta a los dos lados ----
      M.wallN(6, 50, 6, FE); M.wallN(6, 50, 50, FE);
      M.wallW(6, 33, 6, FE); M.wallW(39, 50, 6, FE); M.wallW(6, 33, 50, FE); M.wallW(39, 50, 50, FE);
      // ---- la tienda (puerta automática), el taller y el generador ----
      M.building('tienda2', 20, 12, 10, 8, 'S', (c, b) => { paint(0xe8e4dc, 0x3a3a3a)(c, b); b.sign = ['TIENDA 24 H', '#b8302a']; });
      M.building('local_a', 34, 13, 8, 6, 'S', (c, b) => { paint(0xc8c0b0, 0x4a4a4a)(c, b); b.sign = ['TALLER', '#3a3a3a']; });
      M.put('generador', 17.4, 16.0, 0, 1, { keep: true });
      M.put('cartel_madera', 45.2, 20.6, 0, 1, { keep: true, col: 0xc8c0b0 });
      M.put('neumaticos', 43.2, 14.2, 0, 1); M.put('neumaticos', 43.2, 15.4, 0, 1); M.put('neumaticos', 44.3, 14.8, 0, 1);
      M.put('bidones', 32.6, 13.6, 0, 1); M.put('palets', 15.4, 12.6, 0, 1);
      // ---- la marquesina, los surtidores, el cartel de precios y un banco ----
      M.put('marquesina', 27.0, 27.5, 0, 1, { x0: 22.5, x1: 31.5, z0: 24.8, z1: 30.2, keep: true });
      M.put('surtidor', 25.0, 27.5, 1, 0, { keep: true }); M.put('surtidor', 29.0, 27.5, 1, 0, { keep: true });
      M.put('cartel_precios', 13.5, 31.4, 0, 1, { keep: true });
      M.put('banco_parque', 32.6, 21.2, 0, 1, { keep: true }); M.put('papelera', 34.4, 21.0, 0, 1);
      // ---- coches que se quedaron (uno en la explanada, dos en la carretera) ----
      M.put('coche', 38.0, 28.0, 0, 1, { keep: true });
      M.put('camioneta', 19.0, 36.2, 1, 0, { keep: true, col: 0x5a6a7a });
      M.put('coche', 41.0, 34.9, -1, 0.12, { keep: true });
      // ---- el descanso: un fuego detrás del taller, una mesa y tocones ----
      M.put('fogata', 45.5, 26.2, 0, 1); M.put('mesa_campo', 45.5, 23.5, 0, 1, { keep: true, old: true });
      M.put('tocon', 44.0, 27.6, 0, 1); M.put('tocon', 47.0, 27.6, 0, 1);
      // ---- postes de la luz a lo largo de la carretera; campos y árboles ----
      for (const x of [10, 24, 46]) M.pole(x, 40);
      M.tall(7, 41, 49, 49); M.tall(7, 7, 13, 30); M.tall(44, 7, 49, 18);
      for (const [x, z] of [[9, 9], [12, 18], [30, 8], [47, 10], [9, 27], [47, 31], [16, 45], [30, 46], [41, 44]]) M.tree(x, z, rng() < 0.3);
      for (const [x, z] of [[17, 10], [33, 9], [11, 22], [48, 20]]) M.bush(x, z);
      for (let z = 0; z < 56; z += 2) for (const x of [0, 2, 52, 54]) if ((z < 31 || z > 40) && rng() < 0.6 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.3);
      for (let x = 2; x < 54; x += 2) for (const z of [0, 2, 52, 54]) if (rng() < 0.6 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.3);
    }
  };

  // La ermita del cerro: una ermita blanca con su espadaña, el cementerio pequeño (con su muro), la fuente y la casa
  // del ermitaño (dos plantas, atrancada). Al caer la tarde. Se entra por la cancela del sur
  MAPS.calma_ermita = {
    wild: 0.5, name: 'La ermita del cerro', hidden: true, calm: true, noBoss: true, hour: 17.7, hourFixed: true,
    min: 0, max: 56, bounds: [6.05, 6.05, 49.95, 49.6], play: [[7, 7, 49, 49]], spawn: { x: 28.0, z: 46.8 }, seed: 7171,
    fence: 'wood', perimeter: false, tallGrass: true,
    lanes: [[26.5, 16, 29.5, 50]],
    keepClear: [[9, 8, 46, 44]],
    // la tarde cae: oro sobre cal, sombras largas
    mood: { sky: 0xe2c8a0, fog: 1.2, hemi: [0xf4dcc0, 0x5a4e3c, 0.76], sun: [0xffcc8a, 1.05],
      ground: { 0: [0x7e8a4a, 0x8a9452], 1: [0x4c4a48, 0x565452], 2: [0xb0a894, 0xbab29e], 3: [0x8a7454, 0x947e5a] } },
    skyline: { col: 0x8a8a6a, h: [3, 7] },
    calm: {
      deco: [{ kind: 'bell', x: 24.82, z: 13.0, h: 3.0, ry: -Math.PI / 2 }],
      puzzles: [
        { type: 'ladder', house: { x0: 35, z0: 33, x1: 44, z1: 43, win: { x: 34.0, z: 36.5 } },
          ladders: [[31.5, 29.5, 1, 0], [46.8, 45.5, 0, 1], [36.0, 46.5, 1, 0]],
          near: 'La casa del ermitaño está atrancada por dentro y las ventanas de abajo, claveteadas. Arriba, una se quedó abierta...',
          chest: { label: 'Abrir el arcón del ermitaño', head: 'El arcón del ermitaño', out: { monedas: 4, piezas: 20, balas: 1 },
            text: 'Mantas, un rosario y, debajo de todo, una caja de munición que no pega mucho con un ermitaño.' } },
        { type: 'keyhunt', keyName: 'la llave de la ermita',
          hides: { jarron: [13.5, 28.0, 0], fuente: [31.0, 22.0, 0], maceta: [26.4, 16.7, 0], banco: [20.5, 41.0, 0] },
          clue: { x: 29.9, z: 16.16, y: 1.45, wall: true, ry: 0, fx: 29.9, fz: 16.9, label: 'Leer la nota de la puerta', title: 'Clavada junto a la puerta',
            text: 'Tomás:\nMe voy al valle con los Herrero, que están malos. La llave de la ermita {where}\nCierra al salir. Y no le des de comer al gato, que luego no se va.\n— Don Julián' },
          target: { kind: 'door', id: 'ermita', bld: { x0: 25, z0: 10, x1: 31, z1: 16 }, near: 'La ermita está cerrada con llave. Junto a la puerta hay una nota clavada' },
          reward: { label: 'Abrir el arcón de la sacristía', head: 'La sacristía', out: { suplementos: 25, monedas: 3, items: { venda: 2 } },
            text: 'Velas, las vendas de la última colecta y el vino de misa, que no se lo han bebido ni los del escorpión.' } },
        { type: 'combo', box: { inside: 'ermita', style: 'baul' },
          readLabel: 'Leer la nota del cepillo', openLabel: 'Abrir el candado del cepillo', near: 'El cepillo de las limosnas, con un candado de combinación y una nota',
          names: ['Manuel', 'Rosario', 'el padre Ignacio'],
          note: { title: 'Pegada en el cepillo', text: 'Para quien venga a ayudar:\nLa combinación es la de los difuntos de la primera fila del cementerio: el último número del año en que murió cada uno. Primero Manuel, luego Rosario y luego el padre Ignacio.\nLo que hay dentro es para quien lo necesite.\n— Don Julián' },
          clues: [
            { x: 12.6, z: 19.4, ry: 0, stone: ['MANUEL ORTIZ', '1931 – 199{d}'], label: 'Leer la lápida de Manuel', say: 'MANUEL ORTIZ, 1931 – 199{d}. El último número: {d}' },
            { x: 15.6, z: 19.4, ry: 0, stone: ['ROSARIO VIDAL', '1940 – 200{d}'], label: 'Leer la lápida de Rosario', say: 'ROSARIO VIDAL, 1940 – 200{d}. El último número: {d}' },
            { x: 18.6, z: 19.4, ry: 0, stone: ['P. IGNACIO SALAS', '1922 – 198{d}'], label: 'Leer la lápida del padre Ignacio', say: 'P. IGNACIO SALAS, 1922 – 198{d}. El último número: {d}' }
          ],
          reward: { head: 'El cepillo de las limosnas', out: { monedas: 7, piezas: 10 }, text: 'Las limosnas de todo un año y un sobre con piezas de un reloj que nadie vino a arreglar.' } }
      ],
      lore: [[24.3, 36.25, 'ermita_1'], [21.0, 13.5, 'ermita_2']],
      rest: { x: 24.0, z: 38.0 },
      exit: { x: 28.0, z: 48.6 }
    },
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 1171) - 0.5, n2 = V(x / 17, z / 17, 1172) - 0.5;
      const d = Math.max(7 - x, x - 49, 7 - z, z - 49, 0);
      const k = U.clamp(d / 5, 0, 1);
      return k * Math.max(0, 0.7 + n * 1.0 + n2 * 2.0);
    },
    build(M, rng) {
      const F = G.World.F, FE = G.World.E.FENCE;
      M.ground(0, 0, 56, 56, F.GRASS);
      M.ground(26, 16, 30, 56, F.DIRT);                   // el camino de la cancela a la ermita
      M.ground(22, 16, 34, 21, F.DIRT);                   // la explanada de la puerta
      M.ground(10, 18, 21, 30, F.DIRT);                   // el cementerio
      M.ground(21, 35, 27, 41, F.DIRT);                   // el fuego
      // ---- la valla (la cancela, al sur) ----
      M.wallN(6, 26, 50, FE); M.wallN(30, 50, 50, FE); M.wallN(6, 50, 6, FE);
      M.wallW(6, 50, 6, FE); M.wallW(6, 50, 50, FE);
      M.put('poste', 26.0, 50.0, 0, 1, { keep: true }); M.put('poste', 30.0, 50.0, 0, 1, { keep: true });
      // ---- la ermita (cerrada con llave) y la casa del ermitaño (atrancada) ----
      M.building('cabana', 25, 10, 6, 6, 'S', paint(0xece6da, 0x9a4a32));
      M.building('casa7', 35, 33, 9, 10, 'S', paint(0xd8ccb2, 0x7a3a2e));
      M.put('mesa_campo', 21.0, 13.5, 0, 1, { keep: true, old: true });
      M.put('fuente', 31.0, 22.0, 0, 1, { keep: true });
      // ---- el cementerio: el muro bajo (la entrada, al este), las tumbas y los cipreses ----
      M.put('muro_bajo', 15.5, 18.0, 0, 1, { x0: 10, x1: 21, z0: 17.85, z1: 18.15, keep: true });
      M.put('muro_bajo', 15.5, 30.0, 0, 1, { x0: 10, x1: 21, z0: 29.85, z1: 30.15, keep: true });
      M.put('muro_bajo', 10.0, 24.0, 1, 0, { x0: 9.85, x1: 10.15, z0: 18, z1: 30, keep: true });
      M.put('muro_bajo', 21.0, 20.5, 1, 0, { x0: 20.85, x1: 21.15, z0: 18, z1: 23, keep: true });
      M.put('muro_bajo', 21.0, 27.5, 1, 0, { x0: 20.85, x1: 21.15, z0: 25, z1: 30, keep: true });
      for (const [x, z] of [[13.5, 26.6], [16.5, 26.4], [19.0, 26.8]]) M.put('tumba', x, z, 0, 1, { keep: true });
      M.tree(11, 28, true); M.tree(19, 22, true);
      // ---- el banco que mira al valle, el fuego y unos olivos ----
      M.put('banco_parque', 20.5, 41.0, 0, 1, { keep: true });
      M.put('fogata', 24.0, 38.0, 0, 1); M.put('banco_parque', 24.0, 36.3, 0, -1, { keep: true });
      M.put('tocon', 22.4, 39.4, 0, 1); M.put('tocon', 25.6, 39.4, 0, 1);
      M.tall(7, 32, 20, 37); M.tall(45, 30, 49, 49); M.tall(7, 7, 22, 12); M.tall(44, 8, 49, 22);
      for (const [x, z] of [[14, 9], [33, 8], [44, 10], [9, 35], [15, 44], [47, 30], [40, 24], [35, 18], [45, 26]]) M.tree(x, z, rng() < 0.2);
      for (const [x, z] of [[23, 23], [33, 31], [12, 40], [45, 20]]) M.bush(x, z);
      for (let z = 0; z < 56; z += 2) for (const x of [0, 2, 52, 54]) if (rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.45);
      for (let x = 2; x < 54; x += 2) for (const z of [0, 2, 52, 54]) if (rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.45);
    }
  };

  // El apeadero de Valdecina: un apeadero de pueblo por la mañana. El andén con su reloj parado y la grúa de agua, el
  // edificio de viajeros, el almacén (portón eléctrico: hace falta el generador), la consigna (cerrada con llave),
  // un vagón olvidado en la vía muerta y, al otro lado de las vías, la casa del jefe de estación (atrancada).
  // Se llega a pie por la vía, desde el este
  MAPS.calma_estacion = {
    wild: 0.5, name: 'El apeadero de Valdecina', hidden: true, calm: true, noBoss: true, hour: 8.3, hourFixed: true,
    min: 0, max: 56, bounds: [6.05, 6.05, 49.95, 49.95], play: [[7, 7, 49, 49]], spawn: { x: 47.0, z: 23.4 }, seed: 8181,
    fence: 'wood', perimeter: false, tallGrass: true,
    lanes: [[0, 25.9, 56, 28.1], [12, 21, 50, 25.6]],
    keepClear: [[8, 10, 46, 30], [22, 30, 46, 46]],
    // mañana fresca: luz baja y limpia, algo de neblina
    mood: { sky: 0xd4d0c8, fog: 1.0, hemi: [0xe8e4dc, 0x50504a, 0.78], sun: [0xffe4c4, 0.95],
      ground: { 0: [0x6e8248, 0x7a8c50], 1: [0x4c4c4a, 0x565654], 2: [0xa09a8e, 0xaaa498], 3: [0x7e6c52, 0x88765a] } },
    skyline: { col: 0x7a8466, h: [3, 6] },
    murals: [boardAt(26.0, 20.0, 0, 1, 'VALDECINA\nApeadero · 412 m\n~Regionales: 7:42 · 13:15 · 19:30')],
    calm: {
      deco: [{ kind: 'crane', x: 23.0, z: 24.9, ry: Math.PI }, { kind: 'clock', x: 33.5, z: 22.4 }],
      puzzles: [
        { type: 'power', cans: [[21.0, 31.2], [42.6, 19.4], [8.6, 22.6]], gen: { x: 18.8, z: 20.4 },
          bulbs: [[12.6, 21.4, 3.0], [24.2, 21.4, 3.0]],
          target: { kind: 'door', id: 'almacen', bld: { x0: 9, z0: 13, x1: 17, z1: 19 }, near: 'El almacén de mercancías tiene la puerta eléctrica, y no hay corriente. Al lado hay un generador',
            opened: 'Con un zumbido, la puerta del almacén se abre' },
          reward: { label: 'Abrir las cajas del almacén', head: 'El almacén de mercancías', out: { suplementos: 30, piezas: 25 },
            text: 'Cajas de conservas que no llegaron a cargarse y repuestos de la vía.' } },
        { type: 'pick', id: 'consigna', bld: { x0: 34, z0: 14, x1: 40, z1: 19 },
          near: 'La consigna está cerrada con llave. La cerradura es vieja: con una horquilla se podría forzar', opened: 'Clic. La consigna está abierta',
          chest: { label: 'Abrir la maleta olvidada', head: 'La consigna', out: { monedas: 6, items: { venda: 1 }, balas: 1 },
            text: 'Maletas que nadie vino a buscar. En una, munición, vendas y un sobre con dinero.' } },
        { type: 'ladder', house: { x0: 33, z0: 33, x1: 44, z1: 42, win: { x: 45.0, z: 37.5 } },
          ladders: [[27.5, 37.0, 0, 1], [46.5, 45.5, 1, 0], [30.0, 45.5, 1, 0]],
          near: 'La casa del jefe de estación está atrancada por dentro y las ventanas de abajo, claveteadas. Arriba hay una ventana abierta...',
          chest: { label: 'Abrir el arcón del jefe de estación', head: 'El arcón del jefe', out: { monedas: 4, piezas: 15, items: { molotov: 1 } },
            text: 'La gorra de jefe de estación, un farol y, debajo, lo que guardaba para un mal día.' } }
      ],
      lore: [[28.3, 22.35, 'est_1'], [18.3, 38.6, 'est_2']],
      rest: { x: 18.0, z: 40.4 },
      exit: { x: 48.6, z: 23.4 }
    },
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 1271) - 0.5, n2 = V(x / 17, z / 17, 1272) - 0.5;
      const d = Math.max(7 - x, x - 49, 7 - z, z - 49, 0);
      const k = U.clamp(d / 5, 0, 1);
      return k * Math.max(0, 0.5 + n * 0.9 + n2 * 1.6);
    },
    build(M, rng) {
      const F = G.World.F, FE = G.World.E.FENCE;
      M.ground(0, 0, 56, 56, F.GRASS);
      M.ground(0, 25, 56, 33, F.DIRT);                    // el balasto de las vías
      M.ground(12, 20, 46, 25, F.SIDEWALK);               // el andén
      M.ground(8, 10, 44, 20, F.DIRT);                    // detrás de los edificios
      M.ground(16, 36, 22, 43, F.DIRT);                   // el fuego
      // ---- el borde: tablas, con la vía abierta a los dos lados ----
      M.wallN(6, 50, 6, FE); M.wallN(6, 50, 50, FE);
      M.wallW(6, 25, 6, FE); M.wallW(33, 50, 6, FE); M.wallW(6, 22, 50, FE); M.wallW(33, 50, 50, FE);
      // ---- las vías: la principal y la vía muerta (con el vagón) ----
      for (let x = 2; x < 56; x += 4) M.put('vias', x, 27.0, 0, 1, { x0: x - 2, x1: x + 2, z0: 25.9, z1: 28.1 });
      for (let x = 8; x < 32; x += 4) M.put('vias', x, 31.2, 0, 1, { x0: x - 2, x1: x + 2, z0: 30.1, z1: 32.3 });
      M.cont(10, 30.2, 'x', 12, 1, { open: true, cols: [0x6a3a2e] });
      // ---- el edificio de viajeros, la consigna (cerrada) y el almacén (puerta eléctrica) ----
      M.building('tienda1', 20, 11, 12, 9, 'S', (c, b) => { paint(0xe8d8b8, 0x8a4a34)(c, b); b.sign = ['VALDECINA', '#2a4a6a']; });
      M.building('local_b', 34, 14, 6, 5, 'S', (c, b) => { paint(0xd8c8a8, 0x6a4a3a)(c, b); b.sign = ['CONSIGNA', '#5a3a2a']; });
      M.building('local_a', 9, 13, 8, 6, 'S', (c, b) => { paint(0x9a8a72, 0x4a4a46)(c, b); b.sign = ['MERCANCÍAS', '#4a4a3a']; });
      M.put('generador', 18.8, 20.4, 0, 1, { keep: true });
      M.put('cartel_madera', 26.0, 20.0, 0, 1, { keep: true, col: 0x3a5a7a });
      M.put('banco_parque', 28.0, 22.4, 0, 1, { keep: true }); M.put('banco_parque', 37.0, 22.4, 0, 1, { keep: true });
      M.put('papelera', 31.0, 21.6, 0, 1);
      M.put('cajas', 41.8, 16.2, 0, 1); M.put('palets', 42.6, 18.2, 0, 1);
      // ---- al otro lado: la casa del jefe de estación (atrancada) y el fuego ----
      M.building('casa6', 33, 33, 11, 9, 'N', paint(0xd8ccb2, 0x7a3a2e));
      M.put('fogata', 18.0, 40.4, 0, 1); M.put('banco_parque', 18.0, 38.6, 0, 1, { keep: true });
      M.put('tocon', 16.5, 41.8, 0, 1); M.put('tocon', 19.5, 41.8, 0, 1);
      M.put('tendedero', 27.5, 41.0, 0, 1, { old: true });
      // ---- postes de la línea, campos y árboles ----
      for (const x of [12, 30, 44]) M.pole(x, 29);
      M.tall(7, 34, 15, 49); M.tall(23, 44, 49, 49); M.tall(43, 7, 49, 20); M.tall(7, 7, 18, 11);
      for (const [x, z] of [[8, 9], [19, 8], [33, 8], [44, 9], [9, 36], [12, 46], [46, 32], [47, 47], [25, 46], [8, 21]]) M.tree(x, z, rng() < 0.4);
      for (const [x, z] of [[24, 40], [44, 30], [14, 34], [41, 11]]) M.bush(x, z);
      for (let z = 0; z < 56; z += 2) for (const x of [0, 2, 52, 54]) if ((z < 24 || z > 34) && rng() < 0.65 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.4);
      for (let x = 2; x < 54; x += 2) for (const z of [0, 2, 52, 54]) if (rng() < 0.65 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.4);
    }
  };

  // -----------------------------------------------------------------------------------------------------
  // El escondite de la costa (descanso; si no vas con la Trece ni con Grimes): el escondite de los Supervivientes, el
  // mismo cuarto que el refugio de la Trece, visto desde fuera al anochecer. Un edificio precario de bloques sobre
  // la playa, con la ventana medio tapada mirando al faro. Dentro, lo que dejó ella: el mapa de la costa clavado en
  // la pared, sangre seca, la radio sin batería, las latas de la estantería (mejor no tocarlas) y, en el cuarto del
  // fondo (cerrado con llave), un escorpión muerto atado a una silla. Se entra por el norte
  // -----------------------------------------------------------------------------------------------------
  MAPS.calma_escondite = {
    wild: 0.6, sandDirt: true, name: 'El escondite de la costa', hidden: true, calm: true, noBoss: true, hour: 19.1, hourFixed: true,
    min: 0, max: 56, bounds: [6.05, 6.05, 49.95, 44.8], play: [[7, 7, 49, 44]], spawn: { x: 14.5, z: 9.4 }, seed: 1313,
    fence: 'wood', perimeter: false, tallGrass: true,
    lanes: [[13, 6, 16.5, 30], [13, 28, 30, 31.5]],
    keepClear: [[12, 6, 17, 31], [13, 29, 31, 33], [30, 36, 44, 44]],
    seaZ: 46.0,
    // anochecer: el cielo malva y frío, la bruma del mar subiendo, el sol ya casi en el agua
    mood: { sky: 0x8a8292, fog: 0.86, hemi: [0xb0a8b8, 0x3c3c3a, 0.6], sun: [0xffa878, 0.5],
      ground: { 0: [0x5e6e48, 0x687850], 1: [0x464648, 0x4e4e50], 2: [0x9a968e, 0xa4a098], 3: [0xb8aa88, 0xc2b492] } },
    skyline: { beach: true, hills: [0x8e8a90, 0x6a6a5e], trees: [0x56664e, 0x4e5e48, 0x667254, 0x46543e], cape: -0.8 },
    murals: [boardAt(15.6, 27.6, 0, -1, 'NO HAY NADA\nQUE LLEVARSE.\nSIGUE\nANDANDO.')],
    calm: {
      deco: [
        { kind: 'wallmap', x: 29.925, z: 37.5, y: 1.62, ry: -Math.PI / 2 },
        { kind: 'planks', x: 25.0, z: 41.93, y: 1.5, w: 2.1 },
        { kind: 'blood', floor: [[22.4, 38.6, 1.2], [20.8, 38.0, 0.6], [19.7, 37.6, 0.45], [17.6, 37.6, 0.5], [24.6, 36.4, 0.4]], wall: [[19.075, 1.05, 36.4, Math.PI / 2], [27.6, 1.2, 41.925, Math.PI]] },
        { kind: 'tins', x: 28.6, z: 33.42, ry: 0, n: 6, label: 'Mirar las latas de arriba', say: 'Latas con clavos asomando por la tapa y una mecha corta. Mejor no tocarlas: la nota decía que explotan con mirarlas' },
        { kind: 'cans', a: [21.4, 31.4], b: [27.8, 31.4] },
        { kind: 'tied', x: 16.4, z: 37.5, ry: Math.PI / 2, role: 'carronero', near: 'Hay alguien en la silla. No se mueve. Lleva el escorpión pintado en la chaqueta',
          out: { monedas: 3, balas: 1 }, head: 'Lo que llevaba encima', text: 'En los bolsillos, unas monedas y una caja de balas. Y un papel con una sola palabra escrita muchas veces, cada vez con peor letra: «Capitolio».' }
      ],
      puzzles: [
        // la llave del cuarto del fondo: una nota para Grimes dice dónde la dejó
        { type: 'keyhunt', keyName: 'la llave del cuarto', hides: { saco: [21.0, 39.6, 0], lata: [20.0, 33.62], bota: [23.4, 34.3, 0.6] },
          clue: { x: 29.45, z: 37.95, fx: 28.4, fz: 37.95, label: 'Leer la nota doblada', title: 'Una nota doblada: «Para G.»',
            text: 'G.:\nSi llegas y no estoy, no me esperes. La llave del cuarto {where}\nLo que hay dentro del cuarto es para ti. A lo de la silla no le mires mucho.\n— E.' },
          target: { kind: 'door', id: 'cuarto', bld: { x0: 14, z0: 33, x1: 30, z1: 42 }, rect: [14, 33, 19, 42],
            near: 'La puerta del cuarto del fondo está cerrada con llave. Por debajo sale un olor que no te gusta', opened: 'La llave gira. La puerta del cuarto se abre despacio' },
          reward: { label: 'Abrir la caja del cuarto', head: 'Lo que guardaba la Trece', out: { monedas: 5, items: { clavos: 2, polvo: 1, trapo: 2 }, balas: 1 },
            text: 'Clavos, polvo reactivo y trapos: lo de fabricar sus bombas de clavos. Y una caja de munición sin abrir.' } },
        // la radio: sin batería (la de algún coche); en el dial, la frecuencia de los Supervivientes
        { type: 'radio', id: 'radio', at: { x: 27.0, z: 41.2, ry: Math.PI }, band: [3, 30],
          near: 'Una radio de onda corta junto a la ventana, con el dial apagado',
          battery: { spots: [[34.6, 31.7], [11.4, 36.2], [38.6, 37.4]], hint: 'No tiene batería. Habrá que buscarle una: la de algún coche, quizá', took: 'Una batería de coche. Pesa, pero aún tiene carga', connected: 'Pinzas a los bornes. El dial se ilumina: hay corriente' },
          stations: [
            { f: 7.2, title: 'Radio · 7,20 MHz', tease: 'PERMANEZCAN EN SUS DOMICILIOS', text: 'Una voz automática, de hace treinta años, que nadie ha apagado:\n«...permanezcan en sus domicilios. Los centros de acogida de la zona de Oceanside están completos. Repetimos: permanezcan en sus domicilios. Los centros de...»' },
            { f: 14.7, target: true, title: 'Radio · 14,70 MHz', tease: 'GRIMES. SOY EIRA. SI OYES ESTO', text: 'Entre la estática, una voz de mujer, grabada. Joven y cansada. Se repite cada minuto:\n«Grimes. Soy Eira. Si oyes esto, sigo viva.\nEstoy en el escondite de la costa, el de la ventana que da al faro. He dejado lo de siempre {where}. Para ti, o para quien venga de los nuestros.\nTe voy a encontrar. Aunque tenga que abrir el Capitolio con los dientes.\nGrimes. Soy Eira. Si oyes esto...»' },
            { f: 22.35, title: 'Radio · 22,35 MHz', tease: 'UN PIANO, SIEMPRE LA MISMA PIEZA', text: 'Música. Un piano lento, siempre la misma pieza, que se corta a la mitad y vuelve a empezar.\nAlguien, en algún sitio, dejó un disco puesto y una emisora encendida, y nunca volvió a apagarla.' }
          ],
          hides: { piedra: [31.4, 27.4, 0.3], barca: [41.5, 41.8], nasas: [45.2, 38.2] },
          reward: { head: 'Lo de siempre', out: { monedas: 4, items: { molotov: 1, venda_d: 1 }, suplementos: 15 }, text: 'Un paquete envuelto en plástico: vendas limpias, un cóctel ya preparado y unos cuantos suplementos. Y una foto vieja de un grupo de gente sonriendo; en medio, un hombre alto.' } }
      ],
      lore: [[21.5, 41.4, 'trece_1'], [23.0, 40.6, 'trece_2'], [14.6, 33.72, 'trece_3'], [29.6, 37.4, 'trece_mapa', { nopaper: true, label: 'Mirar el mapa de la pared', px: 28.35, pz: 37.0, reach: 1.6 }]],
      rest: { x: 36.0, z: 40.4 },
      exit: { x: 14.6, z: 7.4 }
    },
    // relieve: la explanada, algo ondulada; al sur baja hasta el agua (z 46)
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 6, z / 6, 861) - 0.5, n2 = V(x / 15, z / 15, 862) - 0.5, C = U.clamp;
      const top = 0.9 + n2 * 0.25;
      if (z > 45.5) return U.lerp(0.25, -0.85, C((z - 45.5) / 2.5, 0, 1));
      if (z > 42.6) return U.lerp(top, 0.25, U.smooth((z - 42.6) / 3.2)) + n * 0.05;
      const d = Math.max(7 - x, x - 49, 7 - z, 0);
      return top + C(d / 5, 0, 1) * Math.max(0, 0.5 + n * 0.8 + n2 * 1.4);
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E, FE = E.FENCE;
      M.ground(0, 0, 56, 56, F.GRASS);
      M.ground(0, 42, 56, 56, F.DIRT);                   // la arena
      M.ground(13, 0, 16, 31, F.DIRT); M.ground(13, 29, 30, 32, F.DIRT);     // el sendero
      M.ground(30, 30, 40, 34, F.DIRT);                  // donde está la camioneta

      // ---- el borde: tablas viejas al norte y a los lados (con huecos); al sur, el mar ----
      M.wallN(6, 12, 6, FE); M.wallN(18, 30, 6, FE); M.wallN(34, 50, 6, FE);
      M.wallW(6, 20, 6, FE); M.wallW(24, 40, 6, FE); M.wallW(6, 40, 50, FE);
      M.put('poste', 12.0, 6.0, 0, 1, { keep: true }); M.put('poste', 17.0, 6.0, 0, 1, { keep: true });

      // ---- el escondite: el trastero al oeste (el cuarto del fondo) y la sala; la ventana, al sur (al mar) ----
      M.building('escondite_c', 14, 33, 16, 9, 'S', (c, b, li, E2) => {
        b.siding = 0x5a5248; b.roofColor = 0x3e3a36; b.worn = true;
        for (const x of [24, 25]) c.eN[li(x, 42)] = E2.WIN;
        if (b.rooms) for (const r of b.rooms) r.on = true;          // (una bombilla en cada cuarto)
      });
      // dentro: lo mismo que en su refugio (el mapa, sacos de dormir, palés, bidones, cajas...) y la radio en la mesa
      M.put('mesa', 29.5, 37.5, -1, 0, { keep: true });          // (su mapa no está en la mesa: está clavado en la pared)
      M.put('mesa', 27.0, 41.2, 0, -1, { keep: true });
      M.put('saco_dormir', 21.0, 39.6, 0, 1, { keep: true });
      M.put('palets', 21.5, 41.4, 0, -1, { keep: true });
      M.put('bidones', 29.3, 41.3, -1, 0, { keep: true });
      M.put('cajas', 20.0, 33.62, 0, 1, { keep: true });
      M.put('estante', 28.6, 33.42, 0, 1, { keep: true });
      M.put('armero', 22.6, 33.3, 0, 1, { keep: true });
      // el cuarto del fondo: la silla (el de la silla lo pone la parada) y unas cajas
      M.put('silla', 16.4, 37.5, 1, 0, { keep: true });
      M.put('cajas', 14.6, 33.72, 0, 1, { keep: true });
      M.put('cajas', 14.6, 41.3, 0, -1, { keep: true });

      // ---- fuera: la camioneta (sin batería), leña, el fuego de la playa, la barca volcada y las nasas ----
      M.put('camioneta', 36.4, 31.8, 1, 0, { col: 0x3e4440, keep: true });
      M.put('troncos', 11.4, 38.8, 0, 1, { x0: 10.2, x1: 12.6, z0: 38.1, z1: 39.5, h: 0.9 });
      M.put('arbol_caido', 34.2, 25.8, 1, 0);
      M.put('fogata', 36.0, 40.4, 0, 1); M.put('tocon', 34.6, 41.4, 0, 1); M.put('tocon', 37.4, 41.6, 0, 1);
      M.put('bote', 41.5, 41.8, 1, 0);
      M.put('nasas', 45.2, 38.2, 0, 1); M.put('lona', 40.6, 34.6, -1, 0);
      for (const [x, z, w, d] of [[13.4, 43.4, 1.6, 1.1], [18.6, 44.0, 1.2, 0.9], [47.0, 41.6, 1.8, 1.2], [8.6, 41.4, 1.4, 1.0], [48.4, 38.6, 1.2, 1.0]]) M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.5 + rng() * 0.5 });
      for (const [x, z] of [[10.6, 35.2], [44.6, 33.0], [26.4, 44.0], [33.4, 43.4]]) M.put('agave', x, z, 0, 1);

      // ---- pinos: muchos, apretados (un sitio para no ser visto) ----
      M.tall(7, 7, 12, 20); M.tall(40, 8, 49, 24); M.tall(7, 24, 12, 34); M.tall(42, 26, 49, 34); M.tall(18, 12, 38, 26);
      for (const [x, z] of [[8, 12], [19, 9], [26, 8], [34, 9], [44, 12], [47, 24], [8, 22], [10, 30], [45, 29], [22, 15], [28, 19], [36, 14], [24, 24], [31, 22], [40, 20]]) M.tree(x, z, rng() < 0.8);
      for (const [x, z] of [[17, 22], [42, 25], [21, 18], [38, 12], [11, 26]]) M.bush(x, z);
      for (let z = 0; z < 42; z += 2) for (const x of [0, 2, 52, 54]) if (rng() < 0.75 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.75);
      for (let x = 2; x < 54; x += 2) for (const z of [0, 2]) if ((x < 11 || x > 17) && rng() < 0.75 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.75);
    }
  };

  // -----------------------------------------------------------------------------------------------------
  // El refugio abandonado (descanso; si vas con la Trece o con Grimes): el refugio de antes del grupo de Di' Arco, el
  // mismo cuarto de hormigón que su refugio, pero con la persiana de entrada y medio vacío. Se mudaron sin prisa y
  // dejaron lo que no cabía: la tragamonedas, el mapa, el cofre con candado y el trastero cerrado. La hierba lo va
  // tapando todo. Por la tarde, sin nadie. Se entra por el norte, por el camino de tierra
  // -----------------------------------------------------------------------------------------------------
  MAPS.calma_refugio = {
    wild: 0.6, name: 'El refugio abandonado', hidden: true, calm: true, noBoss: true, hour: 16.6, hourFixed: true,
    min: 0, max: 56, bounds: [6.05, 6.05, 49.95, 49.95], play: [[7, 7, 49, 49]], spawn: { x: 30.0, z: 8.8 }, seed: 2424,
    fence: 'wood', perimeter: false, tallGrass: true,
    lanes: [[28.5, 6, 31.5, 34], [21, 29.6, 32, 33]],
    keepClear: [[28, 6, 32, 34], [20, 29, 33, 34]],
    // tarde de otoño: luz baja y cálida, el aire quieto
    mood: { sky: 0xc4ccd0, fog: 1.1, hemi: [0xe8e0d0, 0x5a5a48, 0.86], sun: [0xffdcae, 1.0],
      ground: { 0: [0x7a8a4e, 0x86965a], 1: [0x55575a, 0x5e6063], 2: [0xb0aa9c, 0xbab4a6], 3: [0xa8946a, 0xb29e74] } },
    skyline: { col: 0x7c8670, h: [3, 6] },
    murals: [boardAt(33.4, 16.0, -1, 0, 'REFUGIO\nSE HA MUDADO.\nNO QUEDA NADA.\n~(mentira)')],
    calm: {
      deco: [
        { kind: 'tins', x: 27.6, z: 28.7, ry: Math.PI, n: 4, label: 'Mirar las latas del estante', say: 'Latas de melocotón en almíbar, vacías y apiladas con cuidado. En una, a rotulador: «B. 47»' }
      ],
      puzzles: [
        // la persiana: la caja de fusibles, el fusible que falta y el esquema de Tomás
        { type: 'fuses', id: 'refugio', bld: { x0: 14, z0: 20, x1: 30, z1: 29 }, box: { x: 27.8, z: 29.12, face: 0 },
          labels: ['PERSIANA', 'LUCES', 'BOMBA', 'RADIO'], doorLabel: 'La persiana del refugio',
          locked: 'La persiana del refugio, bajada y con candado por dentro. Sin corriente no sube. Al lado hay una caja de fusibles',
          near: 'La persiana está bajada. Al lado, una caja de fusibles con la tapa medio abierta', opened: 'Zumbido, un golpe seco y la persiana sube a trompicones. Dentro huele a cerrado',
          fuse: [[38.4, 26.2], [36.6, 31.4], [12.2, 26.4]],
          diagram: { x: 33.6, z: 30.4, label: 'Leer el papel de la mesa', title: 'Un esquema a lápiz, con letra de Tomás', text: 'Si vuelve a saltar la persiana, NO toquéis los cables al tuntún, que la última vez Booster casi se queda sin cejas.\nCada cable, a su borne:', foot: 'El fusible gordo va en el medio. Hay uno de repuesto por ahí fuera, si nadie lo ha perdido.\n— Tomás' },
          reward: null },
        // el cofre del refugio, con candado: las cifras, repartidas por dentro
        { type: 'combo', box: { x: 19.6, z: 27.0, face: Math.PI / 2 },
          readLabel: 'Leer la nota del cofre', openLabel: 'Abrir el candado del cofre', near: 'El cofre de las recompensas, con un candado de combinación y una nota en la tapa',
          names: ['la pizarra', 'la tragamonedas', 'la caja de Tomás'],
          note: { title: 'Pegada en la tapa del cofre', text: 'Lo que no cabía en la furgoneta. El candado, el de siempre:\n— La primera: los días sin incidentes de la pizarra (Booster no la ha borrado, ¿verdad, Booster?).\n— La segunda: lo que marcó la tragamonedas la última vez que pagó.\n— La tercera la tiene Tomás apuntada en su caja, porque no se acuerda de nada.\n— V.' },
          clues: [
            { x: 22.2, z: 20.4, px: 22.2, pz: 21.2, fx: 22.2, fz: 20.2, reach: 1.7, label: 'Mirar la pizarra', say: 'En la pizarra, con tiza: DÍAS SIN INCIDENTES: {d}. Debajo, con otra letra: «Booster, deja de borrarlo»', hull: [1.5, 1.0, 0.1], hy: 1.1, hz: 20.13,
              decal: { lines: ['DÍAS SIN', 'INCIDENTES:', '{d}'], size: 30, font: '"Comic Sans MS", cursive', col: '#e8e8dc', bg: '#2e4438', tw: 256, th: 192, w: 1.4, h: 1.0, x: 22.2, y: 1.6, z: 20.075 } },
            { x: 27.6, z: 20.38, px: 27.6, pz: 21.4, fx: 27.6, fz: 20.4, reach: 1.7, label: 'Mirar la tragamonedas', say: 'La pantalla rota se quedó congelada: tres {d} en los rodillos. Lo último que pagó', hull: [0.8, 1.95, 0.7] },
            { kind: 'in', inside: 'refugio', label: 'Mirar la caja de Tomás', title: 'Una caja con «TOMÁS» escrito a rotulador', text: 'Tornillos, un destornillador sin punta y, pegado por dentro de la tapa, un papel:\n«Cofre: tercera cifra, {d}. Las otras dos, preguntar a Vera (que se acuerda de todo).»' }
          ],
          reward: { head: 'El cofre del refugio', out: { monedas: 8, piezas: 30, suplementos: 20 }, text: 'Monedas, piezas de armas y un bote de suplementos con una etiqueta: «PARA ARCO. NO TOCAR».' } },
        // el trastero, cerrado (la cerradura es vieja)
        { type: 'pick', id: 'trastero', bld: { x0: 14, z0: 20, x1: 30, z1: 29 }, rect: [14, 20, 19, 29],
          near: 'La puerta del trastero está cerrada con llave. La cerradura es vieja: con una horquilla se podría forzar', opened: 'Clic. La puerta del trastero se abre',
          chest: { label: 'Abrir la caja del trastero', head: 'El escondite de Booster', out: { balas: 1, monedas: 3, items: { alcohol: 1, chocolatina: 1 } }, text: 'Una caja de munición, una botella de alcohol y, debajo de todo, una lata de melocotón con una nota: «Es mía. — B.»' } }
      ],
      lore: [[23.6, 20.5, 'ref_1'], [29.6, 26.0, 'ref_2'], [20.0, 20.5, 'ref_3']],
      rest: { x: 36.4, z: 14.2 },
      exit: { x: 30.0, z: 7.0 }
    },
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 871) - 0.5, n2 = V(x / 16, z / 16, 872) - 0.5, C = U.clamp;
      const top = 0.6 + n2 * 0.3;
      const d = Math.max(7 - x, x - 49, 7 - z, z - 49, 0);
      return top + C(d / 5, 0, 1) * Math.max(0, 0.5 + n * 0.8 + n2 * 1.4);
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E, FE = E.FENCE;
      M.ground(0, 0, 56, 56, F.GRASS);
      M.ground(28, 0, 32, 34, F.DIRT); M.ground(20, 29, 33, 34, F.DIRT);       // el camino y la explanada de la persiana
      M.ground(13, 19, 31, 30, F.CONCRETE);

      // ---- el borde: tablas al norte y a los lados; árboles por fuera ----
      M.wallN(6, 28, 6, FE); M.wallN(32, 50, 6, FE);
      M.wallW(6, 50, 6, FE); M.wallW(6, 50, 50, FE); M.wallN(6, 50, 50, FE);
      M.put('poste', 28.0, 6.0, 0, 1, { keep: true }); M.put('poste', 32.0, 6.0, 0, 1, { keep: true });

      // ---- el refugio: el trastero al oeste y la sala; la persiana al sur ----
      M.building('refugio_c', 14, 20, 16, 9, 'S', (c, b) => {
        b.siding = 0x6a6258; b.roofColor = 0x4a4640; b.worn = true;
        if (b.rooms) for (const r of b.rooms) r.on = r.type === 'taller';          // (la luz de la sala, con la persiana)
      });
      // dentro: como lo dejaron (sin el comercio ni el banco de fabricar: se los llevaron)
      M.put('mesa_mapa', 24.5, 20.47, 0, 1, { keep: true });
      M.put('tragamonedas', 27.6, 20.38, 0, 1, { keep: true });
      M.put('cajas', 20.0, 20.5, 0, 1, { keep: true }); M.put('cajas', 29.5, 20.5, 0, 1, { keep: true });
      M.put('banco_mej', 29.58, 23.0, -1, 0, { keep: true });
      M.put('banco', 29.63, 26.0, -1, 0, { keep: true });
      M.put('sofa', 21.8, 28.5, 0, -1, { keep: true });
      M.put('estante', 27.6, 28.7, 0, -1, { keep: true });
      M.put('maleza', 25.4, 27.2, 0, 1);
      // el trastero: cajas, hongos y escombros
      M.put('cajas', 14.5, 20.5, 0, 1, { keep: true });
      M.put('hongos', 15.6, 22.6, 0, 1); M.put('escombros', 17.2, 27.4, 0, 1);

      // ---- fuera: la mesa del esquema, el coche oxidado, el cobertizo, las cajas, el fuego ----
      M.put('mesa_campo', 33.6, 30.4, 0, 1, { keep: true });
      M.put('coche', 36.6, 31.4, 1, 0, { col: 0x7a5a3a, keep: true });
      M.put('cobertizo', 38.4, 24.6, 0, 1, { keep: true });
      M.put('cajas', 12.2, 26.4, 1, 0, { keep: true });
      M.put('enredadera', 14.0, 24.0, -1, 0); M.put('enredadera', 22.0, 19.85, 0, -1);
      M.put('fogata', 36.4, 14.2, 0, 1); M.put('tocon', 35.0, 15.4, 0, 1); M.put('tocon', 37.8, 15.4, 0, 1);
      M.put('arbol_caido', 42.0, 40.0, 1, 0);
      M.put('neumaticos', 33.2, 25.4, 0, 1);

      // ---- campo y árboles: la hierba alta lo rodea todo ----
      M.tall(7, 7, 26, 18); M.tall(33, 34, 49, 49); M.tall(7, 31, 27, 49); M.tall(40, 7, 49, 30);
      for (const [x, z] of [[9, 9], [20, 8], [40, 9], [46, 16], [8, 30], [12, 44], [24, 46], [46, 44], [44, 24], [10, 16], [34, 44], [20, 38]]) M.tree(x, z, rng() < 0.4);
      for (const [x, z] of [[18, 34], [41, 18], [12, 22], [34, 38]]) M.bush(x, z);
      for (let z = 0; z < 56; z += 2) for (const x of [0, 2, 52, 54]) if (rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.4);
      for (let x = 2; x < 54; x += 2) for (const z of [0, 2, 52, 54]) if ((x < 27 || x > 33 || z > 40) && rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.4);
    }
  };

  // -----------------------------------------------------------------------------------------------------
  // El faro, al alba (la parada secreta: tres hojas de la bitácora en una carrera): el mapa del faro al amanecer,
  // sin nadie. Los Escorpiones han salido de caza y la luz sigue girando. Lo de Ismael: el generador junto
  // a la estación de señales (para la emisora), su voz grabada en la frecuencia de socorro, la llave de su casa y la
  // última hoja de la bitácora. Y la caseta de la sirena, con la persiana eléctrica y su caja de fusibles
  // -----------------------------------------------------------------------------------------------------
  MAPS.calma_faro = Object.assign({}, MAPS.faro, {
    name: 'El faro, al alba', hidden: true, calm: true, noBoss: true, hour: 6.45, hourFixed: true, board: undefined,
    // el alba: cielo frío, el mar oscuro, la primera luz por el este
    mood: { sky: 0x7c88a2, fog: 0.95, hemi: [0x9ca8c4, 0x383c46, 0.62], sun: [0xffbc94, 0.42],
      ground: { 0: [0x5e6a48, 0x687452], 1: [0x45474c, 0x4e5054], 2: [0x8e8a84, 0x98948e], 3: [0x9e9070, 0xa89a7a] } },
    calm: {
      puzzles: [
        { type: 'bld', id: 'senales', bld: { x0: 20, z0: 9, x1: 30, z1: 17 } },
        // el generador de la estación de señales: sin gasolina
        { type: 'power', id: 'power', cans: [[12.4, 13.2], [29.6, 19.8], [34.8, 17.2]], gen: { x: 32.4, z: 12.6, face: -Math.PI / 2 },
          target: { kind: 'none', opened: 'El generador arranca. En la estación de señales se enciende una luz verde', near: 'Un generador junto a la estación de señales, frío y con el depósito seco' } },
        // la emisora: la voz de Ismael, en la frecuencia de socorro; dice dónde dejó la llave de su casa
        { type: 'radio', id: 'radio', need: 'power', needMsg: 'La emisora está muerta: el cable sale hacia el generador de fuera', at: { inside: 'senales' }, band: [1.6, 4.0],
          near: 'La emisora de la estación de señales', heardSay: 'La voz de Ismael dice dónde dejó la llave de su casa',
          stations: [
            { f: 2.18, target: true, title: 'Radio · 2,18 MHz', tease: 'AQUÍ ISMAEL FERRER, FARERO DE OCEANSIDE', text: 'Una voz de hombre mayor, grabada, con el mar detrás:\n«Aquí Ismael Ferrer, farero de Oceanside. Si me oyes, es que has seguido mis hojas.\nNo subas a la torre: la puerta tiene cadena y arriba no hay nada que puedas salvar.\nLa llave de mi casa, la pequeña, la de los fareros, {where} Dentro está lo que guardé para el que llegara. Cógelo y vete antes de que vuelvan.\nY apaga la luz si un día puedes. Yo no he sido capaz.»' },
            { f: 2.67, title: 'Radio · 2,67 MHz', tease: 'BOLETÍN DEL MAR: VIENTO DEL OESTE', text: 'Un boletín del tiempo grabado hace treinta años, que alguien dejó en bucle:\n«...viento del oeste, fuerza cuatro, rolando a noroeste. Mar de fondo. Visibilidad buena. Próximo boletín a las...»' },
            { f: 3.35, title: 'Radio · 3,35 MHz', tease: '¿EL VIEJO SIGUE ARRIBA?', text: 'Dos voces, en directo, con mucho ruido:\n«—¿El viejo sigue arriba?\n—Sí. No ha bajado en toda la noche.\n—Pues que siga. Mientras la luz gire, siguen viniendo.\n—¿Y cuando se muera?\n—Pues aprendes tú a darle cuerda. Corto.»' }
          ],
          hides: { jarron: [9.6, 25.7, 0, 'está en el jarrón de las tumbas de los fareros. Los que hubo antes que yo me la guardarán bien.'], buzon: [16.4, 30.6, 0, 'está en el buzón del huerto, entre cartas que ya no va a leer nadie.'], cobertizo: [27.4, 34.6, 0] },
          key: true, keyName: 'la llave de la casa de Ismael',
          door: { id: 'casa', bld: { x0: 19, z0: 43, x1: 27, z1: 51 }, near: 'La casa pequeña de los fareros, cerrada con llave. La de Ismael', locked: 'Cerrada con llave. La de Ismael tiene que estar por aquí: su emisora decía dónde', opened: 'La llave de Ismael entra a la primera' },
          reward: { label: 'Abrir el arcón de Ismael', head: 'Lo que guardó Ismael', out: { monedas: 14, piezas: 45, suplementos: 40, items: { molotov: 1, venda_d: 1 }, balas: 2 },
            text: 'Monedas, piezas y medicinas: lo que el Aguijón le pagaba por encender la luz. Ismael no gastó nada.' } },
        // la caseta de la sirena: la persiana eléctrica y su caja de fusibles
        { type: 'fuses', id: 'sirena', bld: { x0: 54, z0: 33, x1: 60, z1: 39 }, box: { x: 53.88, z: 34.5, face: -Math.PI / 2 },
          labels: ['SIRENA', 'PERSIANA', 'LINTERNA', 'BALIZAS'], doorLabel: 'La persiana de la caseta',
          near: 'La caseta de la sirena tiene la persiana bajada. Al lado, una caja de fusibles abierta... y un hueco vacío', opened: 'La persiana de la caseta sube con un chirrido que se oye en toda la meseta. Nadie viene',
          fuse: [[53.2, 44.6], [55.2, 46.6], [42.8, 47.6]],
          diagram: { x: 44.7, z: 27.4, y: 1.05, wall: true, ry: Math.PI / 2, fx: 45.4, fz: 27.4, label: 'Leer el papel del cartel', title: 'Una hoja clavada en el cartel, con letra de Ismael', text: 'Para los de la sirena, que lo rompen todo:\nCada cable, a su borne.', foot: 'El fusible gordo, en el medio. Y no toquéis la LINTERNA, que se para el faro.\n— I. F.' },
          reward: { label: 'Abrir el armario de la caseta', head: 'La caseta de la sirena', out: { balas: 2, monedas: 4, items: { molotov: 1, humo: 1 } }, text: 'Lo que los Escorpiones guardan junto a la sirena: munición, un cóctel ya preparado y una bomba de humo.' } }
      ],
      lore: [[0, 0, 'faro_1', { inside: 'senales' }], [0, 0, 'bit_7', { inside: 'casa' }]],
      rest: { x: 27.0, z: 29.6 },
      exit: { x: 16.5, z: 6.6 }
    },
    build(M, rng) {
      MAPS.faro.build.call(this, M, rng);
      // el generador de la estación de señales y el fuego de los Escorpiones (aún caliente)
      M.put('generador', 32.4, 12.6, -1, 0, { keep: true });
      M.put('fogata', 27.0, 29.6, 0, 1, { keep: true }); M.put('tocon', 25.6, 30.8, 0, 1); M.put('tocon', 28.4, 30.8, 0, 1);
    }
  });

  // =====================================================================================================
  // Modo supervivencia (G.Surv, en beta): las zonas son mapas de siempre, sin los acertijos de las paradas y con una
  // luz neutra (la hora la elige quien juega al descansar). El escondite de la Trece (el centro: su refugio, donde
  // vuelve a dormir), la casa del pescador y el faro (con el fuego de los Escorpiones); el asentamiento de Oceanside
  // es el de los enfrentamientos tal cual. Además, la galería (el paso entre dos zonas, con la reja y sus dos
  // manivelas en medio) y el camino de la costa (donde te salen al paso en un viaje)
  // =====================================================================================================
  // ---- la persiana de la garita (G.Surv la pone: el taller con la persiana y sus dos manivelas) ----
  // En la garita, la boca en (gx, gz), mirando al oeste (al bosque); al final del camino del escondite, la misma en
  // (ex, ez). Los edificios de al lado (el pedacito de la garita que se ve desde el camino) son iguales en los dos
  // mapas, respecto a la boca: [u0, w0, u1, w1] (u hacia dentro, +x; w a lo largo, z), frente (x), altura y estilo
  const GP = { gx: 22, gz: 46, ex: 112, ez: 16 };
  const GPIECE = [[0, -14, 4, -6, -1, 13, 1], [4, -14, 8, -6, 1, 13, 1], [0, 6, 4, 10, -1, 10, 3], [4, 6, 8, 10, 1, 10, 3]];
  function gPiece(M, ox, oz) {
    for (const [a, b, c, d, fx, h, st] of GPIECE) M.put('fachada', ox + (a + c) / 2, oz + (b + d) / 2, fx, 0, { x0: ox + a, x1: ox + c, z0: oz + b, z1: oz + d, h, style: st, simple: true, keep: true, solid: true });
  }
  // el final del camino del bosque, delante de la persiana (en los dos mapas): las peñas a los dos lados (delante
  // de la boca, más abiertas: ahí está la manivela) desde x0 hasta la boca (ox); end: cerrado en x0 (la garita: ahí
  // no sigue el camino)
  function gTrail(M, rng, ox, oz, x0, end) {
    const pena = (a, b, w0, w1) => {
      // (en trozos de unos 2,6 m, partidos en los bordes de los trozos del mundo: cada trozo choca solo con lo suyo)
      const cuts = [a];
      for (let c = Math.ceil(a / 32) * 32; c < b; c += 32) if (c > a + 0.3) cuts.push(c);
      cuts.push(b);
      const segs = [];
      for (let i = 0; i < cuts.length - 1; i++) { const p = cuts[i], q = cuts[i + 1], n = Math.max(1, Math.round((q - p) / 2.6)); for (let k = 0; k < n; k++) segs.push([p + (q - p) * k / n, p + (q - p) * (k + 1) / n]); }
      for (const [u0, u1] of segs) {
        for (const e of [-1, 1]) {
          const z0 = e < 0 ? oz - w1 : oz + w0, z1 = e < 0 ? oz - w0 : oz + w1;
          M.put('pena', (u0 + u1) / 2, (z0 + z1) / 2, 0, 1, { x0: u0, x1: u1, z0, z1, h: 2.6 + rng() * 2.0, keep: true });
        }
      }
    };
    const wA = ox - 7.4, wB = ox - 6.5;
    if (x0 < wA) pena(x0, wA, 2.65, 6.0);
    pena(wA, wB, 2.65, 8.0);                 // (el hombro: donde se abre)
    pena(wB, ox, 5.0, 8.0);
    if (end) M.put('pena', x0 - 0.7, oz, 0, 1, { x0: x0 - 1.4, x1: x0, z0: oz - 2.65, z1: oz + 2.65, h: 3.4, keep: true });
    M.ground(Math.max(0, x0 - 1), oz - 2, wA, oz + 3, G.World.F.DIRT); M.ground(wA, oz - 4, ox, oz + 5, G.World.F.DIRT);
    M.tall(Math.max(0, x0), oz - 3, ox - 1, oz - 2); M.tall(Math.max(0, x0), oz + 2, ox - 1, oz + 3);
    M.puddle(ox - 3.2, oz + 1.2, 1.2, 0.9);
  }
  // una fila de fachadas (los bloques del prólogo, treinta años después: con lo verde de las simples) en la franja
  // x0..x1 · z0..z1, con el frente hacia (fx, fz): en trozos de 5 a 11 m (sin pasar de un trozo del mundo), cada
  // uno con su altura (de hs[0] a hs[1], de planta en planta)
  function facRow(M, rng, x0, z0, x1, z1, fx, fz, hs, st) {
    const alongX = fz !== 0, a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1;
    let a = a0;
    while (a < a1 - 0.01) {
      let b = Math.min(a1, a + 5 + Math.floor(rng() * 7));
      if (a1 - b < 3) b = a1;
      const cb = (Math.floor(a / 32 + 1e-6) + 1) * 32;
      if (b > cb + 1e-6) b = cb;
      const h = hs[0] + Math.floor(rng() * (Math.floor((hs[1] - hs[0]) / 3) + 1)) * 3;
      const r = alongX ? [a, z0, b, z1] : [x0, a, x1, b];
      M.put('fachada', (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, fx, fz, { x0: r[0], x1: r[2], z0: r[1], z1: r[3], h, style: st != null ? st : Math.floor(rng() * 4), simple: true, keep: true, solid: true });
      a = b;
    }
  }
  // El escondite, con el camino del bosque hacia la garita: sale por el hueco de la valla del este (x 50, z 14-18) y
  // va entre peñas y pinos hasta la persiana del taller (x 112), donde empiezan los edificios de la garita. La niebla
  // se espesa según se avanza (G.Surv: la de la zona)
  MAPS.sv_escondite = Object.assign({}, MAPS.calma_escondite, {
    name: 'El escondite de la Trece', calm: true, hour: undefined, hourFixed: false,
    mood: { sky: 0xbac4ca, fog: 0.95, hemi: [0xd2d8da, 0x4a4c44, 0.74], sun: [0xfff0d8, 0.82], ground: MAPS.calma_escondite.mood.ground },
    max: 128, bounds: [6.05, 6.05, 120.5, 44.8],
    lanes: MAPS.calma_escondite.lanes.concat([[49, 14.6, 105, 17.4]]),
    keepClear: MAPS.calma_escondite.keepClear.concat([[48, 11, 121, 22]]),
    // el relieve: el del escondite y, al este, el monte; el camino, por el fondo (bajando un poco hasta la garita) y,
    // al final, llano (el taller y los edificios)
    height(x, z) {
      const base = MAPS.calma_escondite.height(x, z);
      if (x < 45) return base;
      const C = U.clamp, n = G.World.vnoise(x / 5, z / 5, 871) - 0.5;
      const floor = U.lerp(0.9, 0.05, U.smooth(C((x - 50) / 50, 0, 1)));
      const end = C((x - 100) / 6, 0, 1), wide = U.lerp(6.2, 8.5, end);
      const bank = U.smooth(C((Math.abs(z - GP.ez) - wide) / 6, 0, 1)) * (1.8 + n * 1.6) * (1 - end);
      const v = U.lerp(base, floor + bank, U.smooth(C((x - 45) / 6, 0, 1)));
      return U.lerp(v, base, C((z - 34) / 8, 0, 1));
    },
    build(M, rng) {
      const F = G.World.F;
      // (lo del escondite, sin los árboles del camino y con el hueco en la valla)
      const inTrail = (x, z) => x > 48.5 && z > 8 && z < 24;
      const M2 = Object.assign(Object.create(M), {
        tree: (x, z, pine) => { if (!inTrail(x, z)) M.tree(x, z, pine); },
        wallW: (z0, z1, x, e) => {
          if (x !== 50) return M.wallW(z0, z1, x, e);
          if (z0 < 14) M.wallW(z0, Math.min(z1, 14), x, e);
          if (z1 > 18) M.wallW(Math.max(z0, 18), z1, x, e);
        }
      });
      MAPS.calma_escondite.build(M2, rng);
      M.ground(56, 0, 128, 56, F.GRASS);
      // las peñas del camino (antes que los árboles: si no, se apartan de ellos); bajo el taller, hormigón
      gTrail(M, rng, GP.ex, GP.ez, 50, false);
      M.ground(GP.ex, GP.ez - 6, GP.ex + 8, GP.ez + 6, F.CONCRETE);
      M.ground(48, GP.ez - 2, 52, GP.ez + 2, F.DIRT);
      // el pedacito de la garita: la fila de edificios donde acaba el bosque (y, detrás del taller, uno más alto)
      gPiece(M, GP.ex, GP.ez);
      for (const [z0, z1, h, st] of [[26, 33, 16, 0], [33, 39, 12, 2], [39, 44, 15, 1]]) M.put('fachada', GP.ex + 2.5, (z0 + z1) / 2, -1, 0, { x0: GP.ex, x1: GP.ex + 5, z0, z1, h, style: st, simple: true, keep: true, solid: true });
      M.put('fachada', GP.ex + 12, GP.ez, -1, 0, { x0: GP.ex + 9, x1: GP.ex + 15, z0: GP.ez - 10, z1: GP.ez + 10, h: 18, style: 2, simple: true, keep: true, solid: true });
      // el bosque, a los dos lados (encima de las peñas y detrás)
      for (let x = 51; x < GP.ex - 1; x += 3) {
        for (const [z0, z1] of [[1, 9.6], [22.6, 34]]) for (let z = z0; z < z1; z += 3.1) {
          if (rng() > 0.6) continue;
          const tx = Math.floor(x + rng() * 2), tz = Math.floor(z + rng() * 2);
          if (tx < GP.ex - 2 && M.free(tx, tz, tx + 1, tz + 1)) M.tree(tx, tz, rng() < 0.7);
        }
      }
      M.puddle(70, GP.ez + 0.6, 1.6, 1.0); M.puddle(88, GP.ez - 0.8, 1.2, 1.4);
    }
  });
  MAPS.sv_pescador = Object.assign({}, MAPS.calma_pescador, {
    name: 'La casa del pescador', calm: false, hour: undefined, hourFixed: false,
    mood: { sky: 0xc6d0d6, fog: 1.0, hemi: [0xdce2e4, 0x585a52, 0.78], sun: [0xfff2dc, 0.86], ground: MAPS.calma_pescador.mood.ground }
  });
  MAPS.sv_faro = Object.assign({}, MAPS.calma_faro, {
    name: 'Faro de Oceanside', calm: false, hour: undefined, hourFixed: false, mood: MAPS.faro.mood
  });
  // la galería: hormigón, humedad y tres bombillas que nadie apaga. 4 x 30, de sur (z 1) a norte (z 31: dentro de un
  // mismo trozo del mundo); la reja, en medio (z 16). Según qué paso es (G.Surv.pasoKind): las vías del tren, la arena que entra del mar o las rocas
  // del cabo
  MAPS.sv_paso = {
    wild: 0, name: 'La galería', hidden: true, noBoss: true, min: 0, max: 40, bounds: [8.05, 1.05, 11.95, 30.95], play: [[8, 1, 12, 31]],
    spawn: { x: 10, z: 3.2 }, seed: 909, fence: 'none', perimeter: false,
    mood: { sky: 0x0c0c0e, fog: 0.42, hemi: [0x5a5a52, 0x1a1a18, 0.32], sun: [0x2a2824, 0.04],
      ground: { 0: [0x34362e, 0x3a3c34], 1: [0x3a3a3a, 0x404040], 2: [0x4a4842, 0x524f48], 3: [0x4e4636, 0x564e3c] } },
    skyline: { col: 0x141412, h: [2, 3] },
    build(M, rng) {
      const F = G.World.F, kind = (G.Surv && G.Surv.pasoKind) || 'via';
      M.ground(0, 0, 40, 40, F.DIRT);
      M.building(kind === 'subte' ? 'subte_s' : 'tunel_s', 8, 1, 4, 30, 'S', (c, b) => {
        // tres bombillas a lo largo (la del medio, sobre la reja)
        const r0 = b.rooms && b.rooms[0];
        if (r0) { r0.on = true; if (r0.light) for (const dz of [-10, 10]) b.rooms.push(Object.assign({}, r0, { light: { x: r0.light.x, y: r0.light.y, z: r0.light.z + dz }, on: true, tiles: 0, extra: true })); }
      });
      // por el suelo: charcos, cascotes y, según el paso, las vías, la arena o las piedras (contra las paredes)
      M.puddle(9.6, 6.5, 1.4, 1.0); M.puddle(10.6, 22.5, 1.2, 1.6); M.puddle(9.4, 27.5, 1.0, 0.8);
      M.put('escombros', 8.9, 10.0, 0, 1, { x0: 8.2, x1: 9.6, z0: 9.4, z1: 10.6 });
      M.put('escombros', 11.1, 20.5, 0, 1, { x0: 10.4, x1: 11.8, z0: 19.8, z1: 21.2 });
      if (kind === 'via') { for (let z = 1; z < 29; z += 4) M.put('vias', 10.0, z + 2, 0, 1, { x0: 9.0, x1: 11.0, z0: z, z1: z + 4 }); }
      else if (kind === 'subte') {
        // el túnel del subte: las vías por el medio, los bancos del andén y las papeleras contra los azulejos
        for (let z = 1; z < 29; z += 4) M.put('vias', 10.0, z + 2, 0, 1, { x0: 9.0, x1: 11.0, z0: z, z1: z + 4 });
        M.put('banco_parque', 8.45, 7.0, 1, 0, { keep: true }); M.put('banco_parque', 11.55, 25.0, -1, 0, { keep: true });
        M.put('papelera', 8.35, 21.5, 1, 0, { keep: true }); M.put('papelera', 11.65, 9.5, -1, 0, { keep: true });
      }
      else if (kind === 'playa') { M.put('cesped', 10.0, 3.5, 0, 1, { x0: 8.2, x1: 11.8, z0: 1.2, z1: 5.6 }); M.put('tablas', 11.4, 11.0, 0, 1, { x0: 11.0, x1: 11.8, z0: 10.0, z1: 12.0, h: 0.3 }); }
      else { M.put('roca', 8.7, 24.5, 0, 1, { x0: 8.2, x1: 9.3, z0: 24.0, z1: 25.0, h: 0.6 }); M.put('roca', 11.3, 6.5, 0, 1, { x0: 10.8, x1: 11.8, z0: 6.0, z1: 7.0, h: 0.5 }); }
    }
  };
  // el camino de la costa: una carretera vieja entre pinos, con coches parados y un árbol caído. Se entra por el
  // oeste (x 6) y se sale por el este (x 66); los que te salen al paso, por delante y desde los lados
  MAPS.sv_camino = {
    wild: 0.7, name: 'El camino de la costa', hidden: true, noBoss: true, min: 0, max: 72, bounds: [3.05, 5.05, 68.95, 22.95], play: [[4, 6, 68, 22]],
    spawn: { x: 7.0, z: 14.0 }, seed: 6161, fence: 'none', perimeter: false, tallGrass: true,
    lanes: [[3, 12.2, 69, 15.8]],
    mood: { sky: 0xc8d0d4, fog: 0.9, hemi: [0xdce2e4, 0x5a5a4c, 0.78], sun: [0xfff0d6, 0.85],
      ground: { 0: [0x7a8650, 0x86925a], 1: [0x4c4d50, 0x56575a], 2: [0xb2ab9e, 0xbdb6a8], 3: [0x8a7a5a, 0x948462] } },
    skyline: { col: 0x6a7660, h: [3, 6] },
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 6, z / 6, 611) - 0.5;
      const d = Math.max(9 - z, z - 19, 0);
      return U.clamp(d / 4, 0, 1) * Math.max(0, 0.4 + n * 0.9);
    },
    build(M, rng) {
      const F = G.World.F;
      const car = () => U.pick(rng, [0x8a8f86, 0x5a6a7a, 0x7a5a3a, 0x3e4a52, 0x9a9a92]);
      M.ground(0, 0, 72, 28, F.GRASS);
      M.ground(0, 12, 72, 16, F.ROAD);
      M.ground(0, 11, 72, 12, F.DIRT); M.ground(0, 16, 72, 17, F.DIRT);           // (las cunetas)
      // coches parados (desde hace años), una barricada vieja y el árbol caído a un lado
      M.put('coche', 18.0, 12.9, 1, 0, { col: car() }); M.put('camioneta', 31.0, 15.0, -1, 0, { col: car() });
      M.put('coche', 46.5, 13.0, 1, 0.1, { col: car() }); M.put('coche', 55.0, 15.2, -1, 0, { col: 0x3a3632 });
      M.put('barricada', 39.0, 11.2, 1, 0); M.put('arbol_caido', 25.0, 18.6, 1, 0);
      M.puddle(24, 13.6, 2.0, 1.0); M.puddle(50, 14.6, 1.6, 0.9);
      M.put('senal', 9.0, 11.0, 0, 1); M.put('senal', 62.0, 17.0, 0, -1);
      // pinos y matas a los dos lados (el bosque cierra el paso)
      for (let x = 2; x < 70; x += 2) {
        for (const z of [6, 8]) if (rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.8);
        for (const z of [19, 21]) if (rng() < 0.7 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.8);
      }
      for (const [x, z] of [[13, 9.5], [36, 18.5], [52, 9.4], [60, 18.6], [28, 9.4]]) M.bush(x, z);
      M.tall(4, 9, 68, 11); M.tall(4, 17, 68, 19);
    }
  };

  // el sendero: el paso al aire libre entre dos zonas de la costa (hacia el pescador, por las rocas de la playa;
  // hacia el faro, por el camino del acantilado). El mismo pasillo que la galería (4 x 30, de sur a norte) entre
  // peñas, con el portón de troncos y sus dos manivelas en medio (lo pone G.Surv)
  MAPS.sv_sendero = {
    wild: 0.7, name: 'El sendero', hidden: true, noBoss: true, min: 0, max: 40, bounds: [8.05, 1.05, 11.95, 30.95], play: [[8, 1, 12, 31]],
    spawn: { x: 10, z: 3.2 }, seed: 919, fence: 'none', perimeter: false, tallGrass: true,
    mood: { sky: 0xc4ccd0, fog: 0.85, hemi: [0xd8dee0, 0x585a4c, 0.78], sun: [0xfff0d8, 0.85],
      ground: { 0: [0x6e7c4c, 0x788656], 1: [0x4c4d50, 0x56575a], 2: [0x9a968c, 0xa4a096], 3: [0xa89a74, 0xb2a47e] } },
    skyline: { beach: true, hills: [0xa8aca2, 0x80846e], trees: [0x66785a, 0x5a6c50, 0x748462, 0x4e5e46], cape: 0.4 },
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 3, z / 3, 977) - 0.5, d = Math.max(8 - x, x - 12, 0);
      return U.clamp(d / 2.5, 0, 1) * (1.6 + n * 1.4);
    },
    build(M, rng) {
      const F = G.World.F, kind = (G.Surv && G.Surv.pasoKind) || 'rocas';
      M.ground(0, 0, 40, 40, F.GRASS);
      M.ground(8, 0, 12, 40, kind === 'rocas' ? F.DIRT : F.DIRT);
      // las peñas a los dos lados (por encima de la cabeza: no se ve más allá que el monte)
      for (let z = 0.5; z < 31; z += 2.7) for (const [x0, x1] of [[4.6, 7.95], [12.05, 15.4]]) {
        const h = 2.4 + rng() * 2.2;
        M.put('pena', (x0 + x1) / 2, z + 1.25, 0, 1, { x0, x1, z0: z, z1: z + 2.6, h, keep: true });
      }
      for (let z = 0; z < 32; z += 2) for (const x of [1, 3, 17, 19]) if (rng() < 0.7) M.tree(x, z, rng() < 0.75);
      // (hacia la garita, el bosque: más árboles, también encima de las peñas, que tapan el cielo)
      if (kind === 'bosque') for (let z = 1; z < 31; z += 3.4) for (const x of [5.6, 14.4]) if (rng() < 0.8) M.tree(x + (rng() - 0.5) * 0.8, z + rng(), rng() < 0.85);
      // por el camino: matas, piedras sueltas y, hacia el pescador, la arena; hacia el faro, la hierba alta del cabo
      for (const [x, z] of [[8.6, 7.0], [11.4, 12.5], [8.5, 24.0], [11.5, 28.0]]) M.put('roca', x, z, 0, 1, { x0: x - 0.35, x1: x + 0.35, z0: z - 0.3, z1: z + 0.3, h: 0.35 + rng() * 0.2, keep: true });
      if (kind === 'rocas') { M.ground(8, 0, 12, 9, F.SAND || F.DIRT); M.put('agave', 11.3, 4.0, 0, 1, { keep: true }); M.put('agave', 8.7, 27.0, 0, 1, { keep: true }); }
      else if (kind === 'bosque') { M.tall(8, 1, 12, 12); M.tall(8, 19, 12, 31); M.puddle(10.2, 15.0, 1.0, 1.4); }
      else { M.tall(8, 2, 12, 9); M.tall(8, 22, 12, 30); }
    }
  };

  // la garita del depósito: el depósito municipal del prólogo, treinta años después (el de HUIDA.depot, aquí en
  // GARITA.ox/oz). La nave, con los coches requisados oxidándose; la garita del vigilante, donde duerme la Trece
  // cuando pasa (un colchón y poco más); detrás, el patio y la reja que Grimes reventó con el coche aquella noche
  // (sigue en el suelo: la pone G.Surv). Alrededor, la ciudad de aquella noche: los mismos bloques del prólogo, con
  // treinta años de hierba encima, cerrando la explanada, los patios y las calles. Cinco caminos: al sur, la
  // carretera de la ciudad (el coche de la Trece); al norte, al oeste, al este y la pista del sureste, cortados de
  // momento. Y al oeste, el taller de la persiana (lo pone G.Surv), por el que se llega del bosque del escondite
  const GARITA = { ox: 40, oz: 36 };
  function garitaDepot() {
    const D = HUIDA.depot, dx = GARITA.ox - D.ox, dz = GARITA.oz - D.oz;
    return { dx, dz, w: D.w, h: D.h, door: { x: D.door.x + dx, z: D.door.z + dz }, exit: [D.exit[0] + dx, D.exit[1] + dx], hallX: D.hall.x0 + dx,
      guard: { x0: D.guard.x0 + dx, x1: D.guard.x1 + dx, z0: D.guard.z0 + dz, z1: D.guard.z1 + dz } };
  }
  MAPS.sv_garita = {
    wild: 0.6, name: 'La garita del depósito', hidden: true, noBoss: true, min: 0, max: 96, bounds: [4.05, 4.05, 91.95, 91.95], play: [[6, 6, 90, 90]],
    spawn: { x: 43.0, z: 38.6 }, seed: 2052, fence: 'none', perimeter: false, tallGrass: true, wallCol: 0x5a5650,
    lanes: [[52, 4, 54, 92], [4, 27.6, 92, 29.4]],
    keepClear: [[9, 38, 31, 54], [30, 42, 36, 50]],
    // lo que se pisa (ahí salen los infectados y lo que se encuentra): la explanada, la nave, los patios y las calles
    walk: [[30, 20, 74, 36], [40, 36, 62, 54], [30, 36, 40, 56], [62, 36, 74, 55], [40, 54, 62, 62], [62, 55, 92, 61], [49, 4, 57, 20], [4, 24, 30, 32], [74, 24, 92, 32], [49, 62, 57, 92]],
    mood: { sky: 0xbcc6c8, fog: 0.9, hemi: [0xd4dcdc, 0x525448, 0.76], sun: [0xfff0d8, 0.84],
      ground: { 0: [0x66764a, 0x708254], 1: [0x4a4b4e, 0x535457], 2: [0x9e988c, 0xa8a296], 3: [0x7a6c52, 0x84765c] } },
    skyline: { col: 0x80868a, h: [12, 30] },
    build(M, rng) {
      const F = G.World.F, D = garitaDepot(), ox = GARITA.ox, oz = GARITA.oz;
      const put = (t, x, z, fx, fz, ex) => M.put(t, x, z, fx, fz, Object.assign({ keep: true }, ex || {}));
      const rust = () => U.pick(rng, [0x6a4a34, 0x5a5048, 0x7a5a3a, 0x4a4640, 0x6e5e4a, 0x5a5e58]);
      const sx = (x) => x + D.dx, sz = (z) => z + D.dz;
      const row = (x0, z0, x1, z1, fx, fz, hs, st) => facRow(M, rng, x0, z0, x1, z1, fx, fz, hs, st);
      M.ground(0, 0, 96, 96, F.GRASS);
      // la explanada (delante), el patio (detrás), las calles (acera y calzada) y la pista del sureste
      M.ground(30, 20, 74, 36, F.CONCRETE);
      M.ground(40, 54, 62, 62, F.CONCRETE);
      for (const [z0, z1] of [[4, 20], [62, 92]]) { M.ground(49, z0, 57, z1, F.SIDEWALK); M.ground(50, z0, 56, z1, F.ROAD); }
      for (const [x0, x1] of [[4, 30], [74, 92]]) { M.ground(x0, 24, x1, 32, F.SIDEWALK); M.ground(x0, 25, x1, 31, F.ROAD); }
      M.ground(62, 55, 92, 61, F.DIRT);
      // el depósito: las mismas paredes que aquella noche (la puerta de la explanada abierta, el hueco de la reja)
      M.building('deposito_v', ox, oz, D.w, D.h, 'N', (c, b, li, E2) => {
        if (b.rooms) for (const r of b.rooms) r.on = false;
        b.worn = true;
        for (let x = b.x0; x < b.x0 + b.w; x++) { c.eN[li(x, b.z0)] = E2.WALL; c.eN[li(x, b.z0 + b.h)] = E2.WALL; }
        c.eN[li(D.door.x, D.door.z)] = E2.DOOR_OPEN;
        for (let x = D.exit[0]; x < D.exit[1]; x++) c.eN[li(x, b.z0 + b.h)] = E2.ARCH;
        for (let z = b.z0; z < b.z0 + b.h; z++) c.eW[li(D.hallX, z)] = E2.WALL;
        c.eW[li(D.hallX, 139 + D.dz)] = E2.ARCH; c.eW[li(D.hallX, 147 + D.dz)] = E2.ARCH;
        for (let x = D.guard.x0; x < D.guard.x1; x++) c.eN[li(x, D.guard.z1)] = E2.WALL;
      });
      // los bloques de alrededor (las fachadas del prólogo): cada calle y cada patio, cerrados por sus edificios
      row(30, 15, 44, 20, 0, 1, [7, 16]); row(62, 15, 74, 20, 0, 1, [7, 16]);          // la explanada, al norte
      row(25, 15, 30, 24, 1, 0, [10, 16]); row(74, 15, 79, 24, -1, 0, [10, 16]);      // sus esquinas
      row(44, 4, 49, 20, 1, 0, [10, 19]); row(57, 4, 62, 20, -1, 0, [10, 19]); row(44, 0, 62, 4, 0, 1, [13, 19]);   // la calle del norte
      row(4, 19, 25, 24, 0, 1, [7, 13]); row(4, 32, 22, 37, 0, -1, [7, 13]); row(0, 19, 4, 37, 1, 0, [10, 16]);     // la carretera del oeste
      row(79, 19, 92, 24, 0, 1, [7, 13]); row(79, 32, 92, 37, 0, -1, [7, 13]); row(92, 19, 96, 37, -1, 0, [10, 16]); // la del este
      row(74, 32, 79, 55, -1, 0, [7, 13]);                                             // la explanada y el patio del este
      row(79, 50, 92, 55, 0, 1, [7, 10]); row(62, 61, 92, 64, 0, -1, [7, 10]); row(92, 50, 96, 64, -1, 0, [10, 13]);  // la pista
      row(22, 56, 40, 62, 0, -1, [7, 13]);                                             // el patio del oeste, al sur
      row(40, 62, 49, 64, 0, -1, [7, 10]); row(57, 62, 62, 64, 0, -1, [7, 10]);       // el patio de atrás
      row(44, 64, 49, 92, 1, 0, [7, 16]); row(57, 64, 62, 92, -1, 0, [7, 16]); row(44, 92, 62, 96, 0, -1, [10, 16]); // la carretera de la ciudad
      // al oeste del patio, el taller de la persiana (G.Surv) entre dos bloques; y, fuera, el final del camino del
      // bosque (el mismo que en el escondite: ahí se aparece al cruzar)
      gPiece(M, GP.gx, GP.gz);
      gTrail(M, rng, GP.gx, GP.gz, 12, true);
      M.ground(GP.gx, GP.gz - 6, GP.gx + 8, GP.gz + 6, F.CONCRETE);
      for (const [x, z] of [[12, 38], [15, 39], [18, 38], [10, 44], [11, 50], [14, 52], [18, 53], [9, 41], [16, 55]]) if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.7);
      // dentro: los coches requisados que quedaron (el de Grimes no está: se lo llevó), estanterías, neumáticos...
      put('camioneta', sx(112.2), sz(147.5), 0, 1, { col: rust() }); put('coche', sx(122.2), sz(147.8), 0, -1, { col: rust() }); put('coche', sx(121.8), sz(141.2), -1, 0, { col: rust() });
      for (const z of [137.6, 139.6, 143.4, 145.4, 150.6]) put('estanteria', sx(125.62), sz(z), -1, 0);
      put('neumaticos', sx(124.8), sz(152.6), -1, 0); put('bidones', sx(111.0), sz(152.9), 0, -1); put('palets', sx(110.4), sz(140.6), 1, 0); put('cajas', sx(110.3), sz(143.4), 1, 0);
      put('caja_herr', sx(125.2), sz(147.6), -1, 0); put('montacargas', sx(111.4), sz(150.4), 0, -1);
      M.put('porton', sx(117), sz(154.05), 0, -1, { x0: sx(114), x1: sx(120), z0: sz(153.9), z1: sz(154.2), keep: true });
      // la garita: lo del vigilante (revuelto) y lo de la Trece, que duerme aquí cuando pasa: un colchón en el suelo
      put('escritorio', sx(106.4), sz(137.0), 0, 1); put('archivador', sx(104.35), sz(139.4), 1, 0); put('taquilla', sx(104.3), sz(141.2), 1, 0);
      put('silla', 41.4, 38.2, 0.7, 0.7); put('colchon', 43.9, 40.3, 0, 1);
      M.put('radio', sx(106.95), sz(137.0), 0, 1, { y: 0.76, keep: true });
      // fuera: coches viejos en la explanada y en el patio, la barrera de la entrada; en las calles, los de siempre
      put('coche', 35.5, 30.0, 1, 0.1, { col: rust() }); put('camioneta', 68.6, 27.0, 0, 1, { col: rust() }); put('barrera', 46.0, 34.6, 1, 0);
      put('coche', 59.2, 57.6, -0.2, 0.98, { col: rust() });
      put('coche', 55.2, 82.0, 0, -1, { col: rust() }); put('camioneta', 50.8, 88.0, 0.1, 1, { col: rust() });
      put('coche', 41.0, 27.2, 1, 0, { col: rust() }); put('papelera', 31.0, 21.0, 0, 1); put('hidrante', 49.6, 21.0, 0, 1); put('semaforo', 49.6, 23.0, 0, 1); put('semaforo', 56.4, 23.0, 0, 1);
      M.puddle(40, 28, 2.0, 1.2); M.puddle(60, 32, 1.6, 1.0); M.puddle(47, 57.5, 1.4, 1.0); M.puddle(53, 76, 1.8, 1.0); M.puddle(16, 27.5, 1.6, 1.0);
      // los caminos cortados: al norte, un árbol caído y un coche; al oeste, un camión cruzado; al este, árboles
      // caídos y el agua que baja del monte; la pista, rocas que rodaron
      put('arbol_caido', 53.0, 12.0, 0, 1); put('coche', 51.8, 8.6, 0.35, 0.94, { col: rust() }); put('barricada', 53.0, 15.2, 0, 1);
      put('camion', 13.0, 28.5, 1, 0.06, { col: 0x4a4a44 }); put('arbol_caido', 19.0, 28.6, 1, 0);
      put('arbol_caido', 83.0, 28.5, 1, 0); put('arbol_caido', 87.5, 28.5, 0.98, 0.2); M.puddle(80.0, 28.5, 2.6, 2.0); M.puddle(85.4, 27.4, 1.8, 1.4);
      for (const [x, z, w, d] of [[80.0, 57.0, 1.8, 1.4], [81.6, 58.8, 1.4, 1.2], [83.2, 57.4, 1.6, 1.6]]) put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.9 + rng() * 0.5 });
      // treinta años: árboles que salieron entre las losas y en los patios, matas y la hierba alta
      for (const [x, z] of [[32, 22], [71, 22], [32, 33], [72, 33], [33, 41], [37, 50], [65, 39], [71, 47], [66, 52], [86, 58], [70, 58], [51, 72], [55, 85], [8, 26], [88, 30], [54, 6]]) if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.4);
      for (const [x, z] of [[47, 66], [59, 70], [46, 80], [60, 86], [48, 18], [58, 8], [26, 27], [34, 34.5], [72, 34], [76, 26], [64, 62.5], [36, 22], [31, 54], [73, 37]]) M.bush(Math.floor(x), Math.floor(z));
      M.tall(30, 36, 40, 56); M.tall(62, 36, 74, 55); M.tall(62, 55, 92, 61); M.tall(42, 61, 49, 62); M.tall(30, 20, 34, 24); M.tall(70, 20, 74, 24);
    }
  };

  // la avenida de entrada a la ciudad: desde el sur llega la carretera (la de la garita: ahí se deja el coche); al
  // norte, la avenida está cerrada por un muro de coches, camiones y barricadas, y a los dos lados hay edificios (no
  // se entra en ninguno). Por encima se ven las torres del centro. Se pasa por el taller del oeste (la persiana, con
  // su manivela) o bajando al subte, en la acera del este
  MAPS.sv_afueras = {
    wild: 0.55, name: 'La avenida de entrada', hidden: true, noBoss: true, min: 0, max: 64, bounds: [4.05, 13.05, 59.95, 59.95], play: [[5, 14, 59, 59]],
    spawn: { x: 32, z: 55.5 }, seed: 3131, fence: 'none', perimeter: false, tallGrass: true, wallCol: 0x5a564e,
    lanes: [[30.8, 14, 33.2, 60]],
    mood: { sky: 0xbcc4ca, fog: 0.9, hemi: [0xd6dcde, 0x56584e, 0.76], sun: [0xfff0da, 0.82],
      ground: { 0: [0x6e7a4c, 0x788456], 1: [0x4a4b4e, 0x535457], 2: [0xa49e92, 0xaea89c], 3: [0x7a6c52, 0x84765c] } },
    skyline: { col: 0x8c9096, h: [18, 42] },
    build(M, rng) {
      const F = G.World.F;
      const car = () => U.pick(rng, [0x8a8f86, 0x5a6a7a, 0x7a5a3a, 0x3e4a52, 0x9a9a92, 0x6a2a24]);
      const fac = (x0, z0, x1, z1, fx, fz, h, st) => M.put('fachada', (x0 + x1) / 2, (z0 + z1) / 2, fx, fz, { x0, x1, z0, z1, h, style: st, simple: true, keep: true, solid: true });
      M.ground(0, 0, 64, 64, F.SIDEWALK);
      M.ground(26, 0, 38, 64, F.ROAD);
      M.ground(0, 48, 24, 64, F.GRASS); M.ground(44, 48, 64, 64, F.GRASS);
      // los edificios del oeste (mirando a la avenida) y su cierre por el sur. Entre z 15 y 27, el taller con la
      // persiana (el paso a la ciudad: lo pone G.Surv)
      for (const [z0, z1, h] of [[4, 15, 13], [27, 32, 16], [32, 40, 10], [40, 46, 13]]) fac(20, z0, 24, z1, 1, 0, h, Math.floor(rng() * 4));
      fac(4, 46, 24, 50, 0, 1, 10, 2);
      // los del este (dejan sitio en la acera para la boca del subte) y su cierre por el sur
      for (const [z0, z1, h] of [[4, 14, 16], [14, 22, 10], [22, 32, 13], [32, 38, 10], [38, 46, 16]]) fac(42, z0, 46, z1, -1, 0, h, Math.floor(rng() * 4));
      fac(42, 46, 60, 50, 0, 1, 13, 1);
      // al norte, el muro: camiones, un autobús de lado, coches empotrados y barricadas (detrás, más edificios)
      fac(24, 0, 32, 4, 0, 1, 16, 0); fac(32, 0, 42, 4, 0, 1, 13, 3);
      M.put('camion', 28.0, 9.0, 1, 0.12, { col: 0x5a5a52, keep: true }); M.put('camion', 36.5, 7.6, -1, 0.2, { col: 0x3a5a7a, keep: true });
      for (const [x, z, fx, fz] of [[25.4, 11.6, 0.9, 0.4], [30.6, 12.0, -0.8, 0.6], [34.8, 11.4, 1, -0.2], [39.6, 11.8, 0.3, 0.95], [23.0, 9.0, 0, 1], [41.0, 8.6, 0.2, 1]]) M.put('coche', x, z, fx, fz, { col: car(), keep: true });
      for (const x of [26.5, 31.0, 35.5]) M.put('barricada', x, 13.2, 0, -1, { keep: true });
      M.put('barrera', 24.6, 13.6, 0, -1, { keep: true }); M.put('barrera', 39.8, 13.6, 0, -1, { keep: true });
      // por la avenida: coches parados junto a la acera, una camioneta chocada y la parada del autobús
      M.put('coche', 36.6, 18.5, 0, -1, { col: car() }); M.put('coche', 36.6, 30.5, 0, -1, { col: car() });          // (delante del taller, nada) M.put('camioneta_chocada', 29.2, 36.4, 0.6, 0.8);
      M.put('coche', 27.3, 44.0, 0, 1, { col: car() });
      M.put('parada', 24.8, 38.0, 1, 0); M.put('papelera', 24.6, 30.0, 1, 0); M.put('semaforo', 25.0, 47.0, 0, 1); M.put('semaforo', 39.0, 47.0, 0, 1);
      M.put('senal', 39.6, 52.0, 0, 1); M.put('hidrante', 41.0, 18.0, 0, 1);
      M.puddle(31, 27, 2.2, 1.2); M.puddle(34, 41, 1.6, 1.0);
      // al sur: la carretera que viene de Oceanside, la hierba y los árboles
      for (const [x, z] of [[8, 52], [12, 56], [16, 52], [6, 58], [20, 57], [48, 52], [52, 57], [56, 52], [58, 58], [46, 58]]) M.tree(x, z, rng() < 0.5);
      for (const [x, z] of [[18, 54], [50, 55], [10, 55]]) M.bush(x, z);
      M.tall(4, 50, 24, 60); M.tall(44, 50, 60, 60);
    }
  };

  // El centro de la ciudad (128 x 128): manzanas de edificios (no se entra en ninguno: son fachadas), con sus
  // calles; en medio, la plaza con la boca del subte (por donde se llega), la fuente y el fuego para descansar, y
  // un solar con escombros. Se entra en tres kioscos y en tres pisos de arriba (los de abajo están atrancados:
  // hay que encontrar la escalera de mano y subir por una ventana). Cada manzana, dentro de su trozo del mundo
  // un local que solo se abre por delante: los otros tres lados, pared (sin puertas ni ventanas: dan a la manzana)
  function sealBack(c, b, li, E2, front) {
    const x0 = b.x0, z0 = b.z0, x1 = b.x0 + b.w, z1 = b.z0 + b.h, wall = (arr, i) => { if (arr[i] !== E2.WALL) arr[i] = E2.WALL; };
    for (let x = x0; x < x1; x++) { if (front !== 'N') wall(c.eN, li(x, z0)); if (front !== 'S') wall(c.eN, li(x, z1)); }
    for (let z = z0; z < z1; z++) { if (front !== 'W') wall(c.eW, li(x0, z)); if (front !== 'E') wall(c.eW, li(x1, z)); }
  }
  const SVC = (() => {
    const CS = 32, T = ['bbbb', 'bpbb', 'bbsb', 'bbbb'];
    // (los locales de planta baja que se abren a la calle: solo por delante; por detrás y por los lados, cerrados
    // (seal), que no se cuele nadie dentro de la manzana. Cada uno, a 4 m de las esquinas: no pisa otras fachadas)
    const SIGN = { farmacia: ['FARMACIA', '#2f7a4a'], ferreteria: ['FERRETERÍA', '#8a4a22'], lavanderia: ['LAVANDERÍA', '#2a5a8a'], almacen: ['ULTRAMARINOS', '#7a2a24'] };
    const blds = [
      ['bar_a', 72, 38, 'N', 'apto1'], ['bar_b', 15, 74, 'E', 'apto2'], ['bar_a', 102, 76, 'W', 'apto3'],
      ['local_b', 38, 39, 'E', 'kiosco1'], ['local_a', 74, 78, 'S', 'kiosco2'], ['local_b', 45, 102, 'N', 'kiosco3'],
      ['tienda1', 42, 17, 'S', 'farmacia', 1], ['oficinas_t', 18, 43, 'E', 'oficinas', 1], ['tienda2', 75, 50, 'S', 'ferreteria', 1],
      ['policia', 108, 38, 'N', 'policia', 1], ['local_a', 20, 108, 'E', 'lavanderia', 1], ['tienda1', 74, 102, 'N', 'almacen', 1],
      ['oficinas_t', 43, 70, 'N', 'oficinas2', 1]
    ].map(([id, ox, oz, front, role, seal]) => {
      const d = (G.Buildings && G.Buildings.DEFS || []).find((q) => q.id === id) || { w: 10, h: 10 };
      const rot = front === 'E' || front === 'W', w = rot ? d.h : d.w, h = rot ? d.w : d.h;
      return { id, ox, oz, w, h, front, role, seal: !!seal, sign: SIGN[role] || null, rect: [ox, oz, ox + w, oz + h] };
    });
    const blocks = [], open = [];
    for (let cz = 0; cz < 4; cz++) for (let cx = 0; cx < 4; cx++) {
      const x0 = cx === 0 ? 4 : cx * CS + 6, x1 = cx === 3 ? 124 : cx * CS + 26, z0 = cz === 0 ? 4 : cz * CS + 6, z1 = cz === 3 ? 124 : cz * CS + 26;
      const t = T[cz][cx], B = { cx, cz, x0, z0, x1, z1, t, sides: { N: cz > 0, S: cz < 3, W: cx > 0, E: cx < 3 } };
      (t === 'b' ? blocks : open).push(B);
    }
    // las fachadas: por cada lado que da a una calle, una franja de 4 m en trozos de hasta 14 m (sin pisar los
    // edificios de verdad); y los muros de dentro (a 1 m, tapados por las fachadas: que no se vea a través)
    const facs = [], walls = [];
    const hash = (a, b) => { const r = U.mulberry32(a * 7919 + b * 131 + 17); return r(); };
    const cut = (a0, a1, holes) => {
      let segs = [[a0, a1]];
      for (const [h0, h1] of holes) segs = segs.flatMap(([s0, s1]) => (h1 <= s0 || h0 >= s1 ? [[s0, s1]] : [[s0, Math.min(s1, h0)], [Math.max(s0, h1), s1]]).filter(([u, v]) => v - u > 0.01));
      return segs;
    };
    for (const B of blocks) {
      const inB = blds.filter((b) => b.rect[0] < B.x1 && b.rect[2] > B.x0 && b.rect[1] < B.z1 && b.rect[3] > B.z0);
      const side = (o) => {
        const alongX = o === 'N' || o === 'S';
        const a0 = alongX ? B.x0 : B.z0 + (B.sides.N ? 4 : 0), a1 = alongX ? B.x1 : B.z1 - (B.sides.S ? 4 : 0);
        const band = o === 'N' ? [B.z0, B.z0 + 4] : o === 'S' ? [B.z1 - 4, B.z1] : o === 'W' ? [B.x0, B.x0 + 4] : [B.x1 - 4, B.x1];
        const holes = inB.filter((b) => (alongX ? b.rect[1] < band[1] && b.rect[3] > band[0] : b.rect[0] < band[1] && b.rect[2] > band[0])).map((b) => (alongX ? [b.rect[0], b.rect[2]] : [b.rect[1], b.rect[3]]));
        for (const [s0, s1] of cut(a0, a1, holes)) {
          const n = Math.max(1, Math.ceil((s1 - s0) / 14));
          for (let k = 0; k < n; k++) {
            const u0 = s0 + (s1 - s0) * k / n, u1 = s0 + (s1 - s0) * (k + 1) / n, r = hash(Math.round(u0 * 10) + B.cx * 3, B.cz * 5 + 'NSWE'.indexOf(o));
            const h = 7 + Math.floor(r * 4) * 3, st = Math.floor(hash(B.cx + 40, B.cz + 40) * 4);
            if (alongX) facs.push({ x0: u0, x1: u1, z0: band[0], z1: band[1], fx: 0, fz: o === 'N' ? -1 : 1, h, st });
            else facs.push({ x0: band[0], x1: band[1], z0: u0, z1: u1, fx: o === 'W' ? -1 : 1, fz: 0, h, st });
          }
        }
        // el muro de dentro (a 1 m del borde), sin cruzar los edificios
        const wl = o === 'N' ? B.z0 + 1 : o === 'S' ? B.z1 - 1 : o === 'W' ? B.x0 + 1 : B.x1 - 1;
        const wa0 = (alongX ? B.x0 : B.z0) + 1, wa1 = (alongX ? B.x1 : B.z1) - 1;
        const wh = inB.filter((b) => (alongX ? wl >= b.rect[1] && wl <= b.rect[3] : wl >= b.rect[0] && wl <= b.rect[2])).map((b) => (alongX ? [b.rect[0], b.rect[2]] : [b.rect[1], b.rect[3]]));
        for (const [s0, s1] of cut(wa0, wa1, wh)) walls.push([alongX ? 'N' : 'W', Math.ceil(s0), Math.floor(s1), wl]);
      };
      for (const o of ['N', 'S', 'W', 'E']) if (B.sides[o]) side(o);
    }
    // al final de cada calle, contra el borde del mapa: más edificios (que no se vea el vacío)
    for (const c of [32, 64, 96]) for (const [a0, a1] of [[c - 8, c], [c, c + 8]]) {
      const r = hash(c, a0);
      facs.push({ x0: a0, x1: a1, z0: 0, z1: 4, fx: 0, fz: 1, h: 10 + Math.floor(r * 3) * 3, st: Math.floor(r * 4) });
      facs.push({ x0: a0, x1: a1, z0: 124, z1: 128, fx: 0, fz: -1, h: 10 + Math.floor(r * 2) * 3, st: (Math.floor(r * 4) + 1) % 4 });
      facs.push({ x0: 0, x1: 4, z0: a0, z1: a1, fx: 1, fz: 0, h: 13, st: (Math.floor(r * 4) + 2) % 4 });
      // (al este, la calle de z 64 acaba en el taller de la persiana: lo pone G.Surv)
      if (c !== 64) facs.push({ x0: 124, x1: 128, z0: a0, z1: a1, fx: -1, fz: 0, h: 10, st: (Math.floor(r * 4) + 3) % 4 });
    }
    return { blocks, open, blds, facs, walls };
  })();
  MAPS.sv_ciudad = {
    // (bounds: hasta x 127,6 por el este, para el que llega por la persiana del taller: entra desde fuera, por el
    // final de la calle de z 64; por ahí no se llega a ninguna otra parte)
    wild: 0.35, name: 'El centro de la ciudad', hidden: true, noBoss: true, min: 0, max: 128, bounds: [4.05, 4.05, 127.6, 123.95], play: [[4, 4, 124, 124]],
    spawn: { x: 44, z: 51 }, seed: 8181, fence: 'none', perimeter: false, wallCol: 0x5a564e,
    lanes: [[30.8, 4, 33.2, 124], [62.8, 4, 65.2, 124], [94.8, 4, 97.2, 124], [4, 30.8, 124, 33.2], [4, 62.8, 124, 65.2], [4, 94.8, 124, 97.2]],
    mood: { sky: 0xb8c0c6, fog: 0.95, hemi: [0xd2d8da, 0x54564e, 0.74], sun: [0xfff0da, 0.8],
      ground: { 0: [0x6a7648, 0x748252], 1: [0x47484b, 0x505154], 2: [0x9c968a, 0xa6a094], 3: [0x76684e, 0x807258] } },
    skyline: { col: 0x8a8e94, h: [22, 48] },
    plan: SVC,
    build(M, rng) {
      const F = G.World.F, E = G.World.E, P = SVC;
      const car = () => U.pick(rng, [0x8a8f86, 0x5a6a7a, 0x7a5a3a, 0x3e4a52, 0x9a9a92, 0x6a2a24, 0x2a3a4a]);
      M.ground(0, 0, 128, 128, F.SIDEWALK);
      for (const c of [32, 64, 96]) { M.ground(c - 4, 0, c + 4, 128, F.ROAD); M.ground(0, c - 4, 128, c + 4, F.ROAD); }
      // la plaza (hierba entre las losas) y el solar (tierra)
      M.ground(40, 40, 56, 56, F.SIDEWALK); M.ground(38, 54, 46, 58, F.GRASS); M.ground(50, 38, 58, 46, F.GRASS); M.ground(38, 38, 42, 42, F.GRASS);
      M.ground(70, 70, 90, 90, F.DIRT);
      // los edificios de verdad (los kioscos y los pisos) y las fachadas
      for (const b of P.blds) M.building(b.id, b.ox, b.oz, b.w, b.h, b.front, (c, bb, li, E2) => {
        if (bb.rooms) for (const r of bb.rooms) r.on = false;
        if (b.sign) bb.sign = b.sign;
        bb.worn = true;
        if (b.seal) sealBack(c, bb, li, E2, b.front);
      });
      for (const f of P.facs) M.put('fachada', (f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2, f.fx, f.fz, { x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1, h: f.h, style: f.st, simple: true, keep: true, solid: true });
      for (const [o, a0, a1, l] of P.walls) { if (o === 'N') M.wallN(a0, a1, l, E.WALL); else M.wallW(a0, a1, l, E.WALL); }
      // por las calles: coches junto a la acera (y alguno cruzado), semáforos, papeleras, hidrantes y charcos
      for (const c of [32, 64, 96]) for (let a = 8; a < 122; a += 7) {
        if (Math.abs(a - 32) < 6 || Math.abs(a - 64) < 6 || Math.abs(a - 96) < 6) continue;
        const r = rng();
        if (r < 0.32) M.put('coche', c - 2.6, a, 0, 1, { col: car() });
        else if (r < 0.42) M.put('camioneta', c + 2.6, a, 0, -1, { col: car() });
        else if (r < 0.48) M.put('camioneta_chocada', c + (rng() < 0.5 ? 1.6 : -1.6), a, 0.6, 0.8);
        const r2 = rng(), pas = c === 64 && a > 108;          // (el final de la calle del taller, despejado)
        if (r2 < 0.3 && !pas) M.put('coche', a, c + 2.6, 1, 0, { col: car() });
        else if (r2 < 0.38 && !pas) M.put('coche', a, c - 2.6, -1, 0, { col: car() });
        if (rng() < 0.2) M.puddle(c + (rng() - 0.5) * 5, a, 1.4 + rng(), 1.0);
        if (rng() < 0.12) M.put('papelera', c + (rng() < 0.5 ? -5.2 : 5.2), a + 2, 0, 1);
      }
      for (const c of [32, 64, 96]) for (const d of [32, 64, 96]) {
        M.put('semaforo', c - 5.2, d - 5.2, 0, 1); M.put('semaforo', c + 5.2, d + 5.2, 0, -1);
        M.put('paso_cebra', c, d - 5, 1, 0, { x0: c - 3.6, x1: c + 3.6, z0: d - 5.8, z1: d - 4.2, keep: true });
        if (rng() < 0.4) M.put('hidrante', c + 5.3, d - 5.6, 0, 1);
      }
      M.put('camion', 64, 20.0, 0.1, 1, { col: 0x5a5a52 }); M.put('patrulla', 98.6, 66.0, 0.9, 0.3); M.put('barricada', 32.0, 116.0, 1, 0);
      M.put('parada', 37.2, 84.0, -1, 0); M.put('parada', 90.8, 12.0, 1, 0);
      // la plaza: la fuente, bancos, árboles, el puesto de periódicos (el kiosco de verdad lo pone el edificio)
      M.put('fuente', 49.0, 49.0, 0, 1, { keep: true });
      for (const [x, z, fx, fz] of [[49, 45.6, 0, -1], [49, 52.4, 0, 1], [45.6, 49, -1, 0], [52.4, 49, 1, 0]]) M.put('banco_parque', x, z, fx, fz);
      M.put('kiosco', 56.0, 56.0, -1, 0); M.put('papelera', 46.0, 44.0, 0, 1);
      for (const [x, z] of [[39, 55], [43, 57], [51, 39], [55, 42], [39, 39], [56, 51]]) M.tree(x, z, false);
      // el solar: escombros, tablas, palés, un coche quemado y el kiosco de chapa
      M.put('escombro_grande', 80.0, 72.5, 1, 0); M.put('escombro_grande', 86.0, 87.0, 0, 1); M.put('escombros', 77.0, 88.0, 1, 0);
      M.put('tablas', 87.5, 80.0, 0, 1); M.put('palets', 72.4, 86.0, 1, 0); M.put('coche', 84.0, 76.0, 0.3, 0.95, { col: 0x3a3632 });
      for (const [x, z] of [[71, 72], [89, 71], [72, 89]]) M.bush(x, z);
      M.tall(70, 70, 90, 74); M.tall(70, 86, 90, 90);
      // ---- las escenas (lo que se mueve lo pone G.Surv: los infectados, las notas, los pájaros, el humo) ----
      // el choque del cruce del noreste: una patrulla volcada contra una camioneta de los Escorpiones
      M.put('patrulla_volcada', 93.6, 29.6, 1, 0.35, { keep: true });
      M.put('camioneta_chocada', 98.6, 34.6, -0.55, 0.85, { keep: true });
      M.put('cristales', 96.2, 32.2, 0, 1, { x0: 94.6, x1: 97.8, z0: 30.6, z1: 33.8 });
      M.put('papeles', 95.0, 35.4, 0, 1, { x0: 94.4, x1: 95.6, z0: 34.9, z1: 35.9 });
      // el campamento del final de la calle del sur (detrás de la barricada): se fueron al subte
      M.put('barricada', 29.4, 115.6, 1, 0.1, { keep: true }); M.put('barricada', 34.8, 116.2, 1, -0.12, { keep: true });
      M.put('refugio_lona', 31.0, 121.6, 0, -1, { keep: true });
      M.put('saco_dormir', 28.4, 119.4, 0, 1); M.put('saco_dormir', 35.2, 120.2, 1, 0.2);
      M.put('fogata', 32.4, 118.6, 0, 1);
      M.put('mesa_campo', 35.6, 122.6, 1, 0, { keep: true }); M.put('bidones', 27.6, 122.6, 0, 1, { keep: true });
      M.put('cajas', 27.4, 117.6, 0, 1, { keep: true });
      // el atasco de la calle del este (los coches, como los dejaron: en fila, en los dos sentidos)
      for (const [x, z, f] of [[101.5, 93.4, 1], [107.2, 93.2, 1], [112.8, 93.6, 1], [118.4, 93.3, 1], [104.2, 98.6, -1], [109.8, 98.8, -1], [115.6, 98.5, -1], [121.0, 98.7, -1]]) {
        M.put(rng() < 0.25 ? 'camioneta' : 'coche', x, z, f, (rng() - 0.5) * 0.12, { col: car(), keep: true });
      }
      // la patrulla de delante de la comisaría
      M.put('patrulla', 114.0, 34.6, 1, 0, { keep: true });
      // dentro de la comisaría: papeles por el suelo de la recepción
      M.put('papeles', 112.0, 46.5, 0, 1, { x0: 111.2, x1: 112.8, z0: 45.9, z1: 47.1 });
    }
  };

  // =====================================================================================================
  // Red del Capitolio (96 x 96, del tamaño del asentamiento de la playa): el viejo Capitolio de la región, tierra
  // adentro pero aún con aire de costa (luz anaranjada, palmeras y eucaliptos, el mar a lo lejos), convertido por
  // los Escorpiones en un centro de detención. El edificio se levanta sobre un zócalo (1,4 m) con una escalinata
  // delante y la cúpula sobre la rotonda. Dentro: el ala oeste (celdas A y B, el comedor, la cocina y el almacén),
  // el centro (la rotonda donde reparten la comida, la galería de atrás con un chasqueador encadenado, la cámara
  // abandonada con el techo hundido, el archivo, la sala de guardia y las celdas C) y el ala este (celdas D, el
  // dormitorio de los Escorpiones, la perrera con más chasqueadores encadenados y la armería). Tres pasillos
  // cruzan todo de oeste a este y hay salidas a los cuatro lados: siempre más de un camino. Fuera: la plaza con la
  // estatua y el control de la entrada, el huerto donde hacen trabajar a los presos, el aparcamiento y, detrás, el
  // patio de los Escorpiones (contenedores de dormitorio, vehículos, el taller, letrinas y la puerta trasera con
  // otro chasqueador). En vez de banderas, pintadas: el escorpión, avisos y las marcas de los presos. Las celdas son
  // de chatarra soldada (rejas, chapas, tabiques); los datos de cada una (puerta, sitio de los presos) los usa
  // G.Rescue para los presos y el modo Liberación
  // =====================================================================================================
  const CAP_CELLS = [];
  MAPS.capitolio = {
    wild: 0.55, name: 'Red del Capitolio', min: 2, max: 94, bounds: [4.05, 6.05, 91.95, 87.95],
    play: [[6, 8, 90, 86]], enemyMul: 1.3, spawn: { x: 7.6, z: 85.4 }, seed: 4747, fence: 'chain', perimeter: false, tallGrass: true, escape2: true,
    board: { x: 10.0, z: 84.6, fx: 0, fz: -1 },
    lanes: [[46.5, 62, 49.5, 87], [6, 30.4, 90, 32.6], [42.2, 45.2, 53.8, 47.8], [47, 40.2, 49, 53.8]],
    seaZ: 150,
    mood: { sky: 0xf2d2b4, fog: 1.15, hemi: [0xf0c8a4, 0x5a4a3a, 0.72], sun: [0xffc890, 0.95],
      ground: { 0: [0x8a8048, 0x948a50], 1: [0x55524c, 0x5e5a54], 2: [0xb0a690, 0xbab09a], 3: [0x8a7458, 0x96805e] } },
    skyline: { beach: true, hills: [0xc8b0a0, 0x9a8a72], trees: [0x7a8a5a, 0x6a7a4e, 0x9a8a5a, 0x8a7a4a], cape: -0.4 },
    fires: [[49.6, 52.2, 0], [40.5, 20.5, 1], [62.5, 80.5, 2]],     // (0: barril, 1: hoguera, 2: fuego bajo entre las piedras)
    dome: { x: 48, z: 47, r: 6.2 },
    portico: { x0: 39.4, x1: 56.6, z: 59.6 },
    cells: CAP_CELLS,
    // los chasqueadores encadenados (el poste y lo que alcanza la cadena)
    clickers: [{ x: 48.0, z: 37.4, r: 1.7 }, { x: 68.2, z: 53.2, r: 1.6 }, { x: 73.4, z: 53.2, r: 1.6 }, { x: 48.0, z: 30.6, r: 2.0 }],
    // la guarnición del modo Liberación: zona de cada grupo y sus papeles
    garrison: [
      { zone: [6, 36, 90, 58], roles: ['lider', 'pistolero', 'escopetero', 'sigilo', 'saqueador'] },
      { zone: [6, 8, 90, 32], roles: ['tirador', 'bruto', 'explorador', 'carronero'] },
      { zone: [18, 62, 90, 86], roles: ['pistolero', 'arquero', 'explorador', 'carronero'] }
    ],
    murals: [
      { kind: 'text', text: 'PROPIEDAD DE LOS ESCORPIONES', x: 48.0, z: 58.09, y: 3.3, w: 4.6, h: 0.7, col: '#b8392c' },
      { kind: 'scorp', x: 37.5, z: 58.09, y: 2.7, w: 1.6, h: 1.6, col: '#b8392c' },
      { kind: 'scorp', x: 59.5, z: 58.09, y: 2.7, w: 1.6, h: 1.6, col: '#b8392c' },
      { kind: 'text', text: 'CELDAS A', x: 8.6, z: 45.08, y: 2.3, w: 2.2, h: 0.55, col: '#d8d0b8', wear: 0.5 },
      { kind: 'text', text: 'CELDAS B', x: 21.6, z: 45.08, y: 2.3, w: 2.2, h: 0.55, col: '#d8d0b8', wear: 0.5 },
      { kind: 'text', text: 'CELDAS C', x: 56.4, z: 47.92, y: 2.3, w: 2.2, h: 0.55, ry: Math.PI, col: '#d8d0b8', wear: 0.5 },
      { kind: 'text', text: 'CELDAS D', x: 66.6, z: 45.08, y: 2.3, w: 2.2, h: 0.55, col: '#d8d0b8', wear: 0.5 },
      { kind: 'text', text: 'PERRERA\nNO TOCAR LAS CADENAS', x: 74.6, z: 47.92, y: 2.2, w: 2.8, h: 1.0, ry: Math.PI, col: '#c8a02c' },
      { kind: 'text', text: 'TRABAJA O NO COMES', x: 44.4, z: 40.08, y: 3.0, w: 3.4, h: 0.6, col: '#b8392c' },
      { kind: 'scorp', x: 51.6, z: 40.08, y: 3.0, w: 1.4, h: 1.4, col: '#b8392c' },
      { kind: 'text', text: 'IIII IIII IIII IIII\nIIII IIII II', x: 12.5, z: 36.08, y: 1.2, w: 1.5, h: 0.5, col: '#3a3632', wear: 0.3 },
      { kind: 'text', text: 'QUIERO VOLVER\nA CASA', x: 30.0, z: 36.08, y: 1.3, w: 1.4, h: 0.6, col: '#3a3632', wear: 0.3 },
      { kind: 'text', text: 'IIII IIII IIII\nIIII IIII IIII IIII', x: 66.1, z: 36.08, y: 1.2, w: 1.5, h: 0.5, col: '#3a3632', wear: 0.3 },
      // los Supervivientes también dejan su marca (en verde): no olvidan quién mató a su líder
      { kind: 'text', text: 'JUSTICIA\nPARA ANDRÉS', x: 14.0, z: 12.22, y: 1.3, w: 3.0, h: 1.2, col: '#5a8a4a' },
      { kind: 'text', text: 'ASESINOS', x: 72.0, z: 86.6, y: 1.45, w: 2.2, h: 0.6, ry: Math.PI, col: '#5a8a4a', wear: 0.6 },
      { kind: 'scorp', x: 48.0, z: 74.82, y: 0.55, w: 0.7, h: 0.7, col: '#b8392c' },
      { kind: 'board', text: 'PROPIEDAD DE LOS\nESCORPIONES\nFUERA', x: 54.0, z: 86.355, y: 1.45, w: 2.25, h: 1.1, ry: Math.PI, ink: '#8a2a22' }
    ],
    // relieve: el zócalo del Capitolio (1,4 m sobre la plaza y el patio) con taludes; la escalinata de delante,
    // más suave y ancha
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 911) - 0.5, C = U.clamp;
      const d = Math.max(4 - x, x - 92, 33 - z, z - 61, 0);
      const w = (z > 61 && x > 40 && x < 56) ? 4.5 : ((z < 33 && x > 44 && x < 52) ? 3.5 : 2.5);
      const k = C(1 - d / w, 0, 1);
      return 0.2 + 1.4 * k + (k <= 0 ? Math.max(0, n) * 0.25 : 0);
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E, FE = E.FENCE;
      const R = (a, b) => a + rng() * (b - a);
      const car = () => U.pick(rng, [0x8a8f86, 0x5a6a7a, 0x7a5a3a, 0x3e4a52, 0x9a9a92, 0x6a3a32, 0x4a5a4a]);
      M.ground(0, 0, 96, 96, F.GRASS);
      M.ground(4, 6, 92, 33, F.DIRT);                        // el patio de atrás: tierra pisada
      M.ground(4, 33, 92, 61, F.SIDEWALK);                   // el zócalo: losas
      M.ground(46, 61, 50, 88, F.SIDEWALK);                  // el paseo hasta la entrada
      M.ground(42, 70, 54, 78, F.SIDEWALK);                  // la plaza de la estatua
      M.ground(62, 66, 89, 84, F.ROAD);                      // el aparcamiento
      M.ground(10, 66, 34, 80, F.DIRT);                      // el huerto de los presos
      M.ground(70, 6, 92, 30, F.ROAD);                       // el depósito de vehículos

      // ---- el límite: valla de alambre alrededor (con la entrada del sur) ----
      M.wallN(4, 46, 88, FE); M.wallN(50, 92, 88, FE); M.wallN(4, 92, 6, FE);
      M.wallW(6, 88, 4, FE); M.wallW(6, 88, 92, FE);

      // ---- el Capitolio: tres piezas que se juntan en x = 32 y x = 64 (los pasos entre ellas se abren aquí) ----
      const arch = (c, li, E2, x, z) => { const X0 = c.cx * 32, Z0 = c.cz * 32; if (x >= X0 && x < X0 + 32 && z >= Z0 && z < Z0 + 32) c.eW[li(x, z)] = E2.ARCH; };
      M.building('cap_oeste', 6, 36, 26, 22, 'S', paint(0xcfc6b2, 0x6a6e6a));
      M.building('cap_centro', 32, 36, 32, 22, 'S', (c, b, li, E2) => {
        paint(0xcfc6b2, 0x6a6e6a)(c, b);
        for (const z of [45, 46, 47, 52]) arch(c, li, E2, 32, z);          // el pasillo y el almacén del ala oeste
        for (let z = 36; z < 45; z++) c.eW[li(32, z)] = E2.WALL;             // (entre las celdas B y la cámara, pared)
      });
      M.building('cap_este', 64, 36, 26, 22, 'S', (c, b, li, E2) => {
        paint(0xcfc6b2, 0x6a6e6a)(c, b);
        for (const z of [45, 46, 47]) arch(c, li, E2, 64, z);              // el pasillo del centro
        for (let z = 48; z < 58; z++) c.eW[li(64, z)] = E2.WALL;             // (entre las celdas C y la perrera, pared)
      });

      // ---- las celdas: rejas soldadas al frente (con la puerta), tabiques entre una y otra y un colchón dentro ----
      CAP_CELLS.length = 0;
      // una fila de celdas pegadas a una pared: front 'z' (el frente corre a lo largo de x, en la línea z = at) o
      // 'x' (a lo largo de z, en x = at); de a1 a a2 por el frente y hasta back por dentro; out: hacia dónde da la puerta
      const row = (pre, axis, at, a1, a2, back, n, out) => {
        const w = (a2 - a1) / n;
        for (let i = 0; i < n; i++) {
          const s0 = a1 + i * w, s1 = s0 + w, mid = (s0 + s1) / 2, dw = 1.1;
          const id = pre + (i + 1), T = 0.15;
          if (axis === 'z') {
            M.put('reja', (s0 + mid - dw / 2) / 2, at, 0, out, { x0: s0 + 0.06, x1: mid - dw / 2 - 0.02, z0: at - T, z1: at + T, keep: true });
            M.put('reja', (mid + dw / 2 + s1) / 2, at, 0, out, { x0: mid + dw / 2 + 0.02, x1: s1 - 0.06, z0: at - T, z1: at + T, keep: true });
            M.put('reja_puerta', mid, at, 0, out, { x0: mid - dw / 2, x1: mid + dw / 2, z0: at - T, z1: at + T, keep: true, cell: id });
            if (i > 0) M.put('tabique', s0, (at + back) / 2, 1, 0, { x0: s0 - 0.06, x1: s0 + 0.06, z0: Math.min(at, back) + 0.05, z1: Math.max(at, back) - 0.05, keep: true });
            const bz = back + (at > back ? 1.05 : -1.05);
            M.put('colchon', mid + (i % 2 ? 0.6 : -0.6), bz, 0, 1, { keep: true });
            CAP_CELLS.push({ id, door: { x: mid, z: at, fx: 0, fz: out }, area: [s0 + 0.3, Math.min(at, back) + 0.3, s1 - 0.3, Math.max(at, back) - 0.3], spot: { x: mid, z: (at + back) / 2 } });
          } else {
            M.put('reja', at, (s0 + mid - dw / 2) / 2, out, 0, { z0: s0 + 0.06, z1: mid - dw / 2 - 0.02, x0: at - T, x1: at + T, keep: true });
            M.put('reja', at, (mid + dw / 2 + s1) / 2, out, 0, { z0: mid + dw / 2 + 0.02, z1: s1 - 0.06, x0: at - T, x1: at + T, keep: true });
            M.put('reja_puerta', at, mid, out, 0, { z0: mid - dw / 2, z1: mid + dw / 2, x0: at - T, x1: at + T, keep: true, cell: id });
            if (i > 0) M.put('tabique', (at + back) / 2, s0, 0, 1, { z0: s0 - 0.06, z1: s0 + 0.06, x0: Math.min(at, back) + 0.05, x1: Math.max(at, back) - 0.05, keep: true });
            const bx = back + (at > back ? 1.05 : -1.05);
            M.put('colchon', bx, mid + (i % 2 ? 0.6 : -0.6), 1, 0, { keep: true });
            CAP_CELLS.push({ id, door: { x: at, z: mid, fx: out, fz: 0 }, area: [Math.min(at, back) + 0.3, s0 + 0.3, Math.max(at, back) - 0.3, s1 - 0.3], spot: { x: (at + back) / 2, z: mid } });
          }
        }
      };
      row('A', 'z', 40.0, 6.0, 19.0, 36.0, 3, 1);
      row('B', 'z', 40.0, 19.0, 32.0, 36.0, 3, 1);
      row('C', 'x', 60.0, 48.0, 58.0, 64.0, 2, -1);
      row('D', 'z', 40.0, 64.0, 76.0, 36.0, 3, 1);
      // lo de los presos: cubos, mantas y algún plato vacío en los pasillos de las celdas; una mesa de guardia en cada bloque
      M.put('banco_espera', 8.6, 44.3, 0, -1); M.put('cubos', 17.6, 44.2, 0, -1); M.put('mesa_campo', 29.6, 43.8, 0, -1);
      M.put('banco_espera', 55.2, 50.0, 1, 0); M.put('bidones', 55.0, 53.6, 1, 0);
      M.put('mesa_campo', 73.6, 43.8, 0, -1); M.put('cubos', 66.0, 44.2, 0, -1);

      // ---- la rotonda: cuatro columnas, las mesas donde reparten la comida, cajas y agua, un barril con fuego ----
      for (const [x, z] of [[43.6, 41.9], [52.4, 41.9], [43.6, 52.0], [52.4, 52.0]]) M.put('columna', x, z, 0, 1, { keep: true });
      M.put('mesa_campo', 45.0, 49.8, 0, 1); M.put('mesa_campo', 51.0, 49.8, 0, 1);
      M.put('cajas', 44.6, 52.9, 0, -1); M.put('cajas', 51.4, 52.9, 0, -1); M.put('ibc', 44.8, 43.4, 1, 0);
      M.put('barril_fuego', 49.6, 52.2, 0, 1);
      M.put('mesa_mapa', 51.2, 43.6, -1, 0);
      // la galería de atrás (el chasqueador del pasillo) y su puerta al patio
      M.put('poste_cadena', 48.0, 37.4, 0, 1, { keep: true });
      M.put('hongo_pared', 43.0, 36.2, 0, 1, { x0: 42.1, x1: 44.1, z0: 36.06, z1: 36.36 });
      // la cámara abandonada: bancos en filas, cascotes bajo el agujero del techo, hongo y humedad
      for (let r = 0; r < 3; r++) for (const x of [35.2, 38.8]) M.put('banco_espera', x, 41.2 + r * 1.3 - (r > 0 ? 0 : 0), 0, -1, r === 1 && x > 37 ? { keep: true } : null);
      M.put('escombro_grande', 36.6, 39.4, 1, 0); M.put('losa', 37.4, 40.8, 0, 1);
      M.put('hongos', 34.2, 43.6, 0, 1, { x0: 33.0, x1: 35.6, z0: 42.9, z1: 44.4 }); M.put('hongos', 40.4, 37.2, 0, 1, { x0: 39.3, x1: 41.6, z0: 36.4, z1: 38.0 });
      M.put('hongo_pared', 32.2, 38.5, 1, 0, { x0: 32.06, x1: 32.36, z0: 37.4, z1: 39.6 });
      M.put('escombros', 39.5, 43.2, 0, 1, { x0: 38.6, x1: 40.4, z0: 42.6, z1: 43.8 });
      // el archivo: papeles por el suelo y hongo en una esquina
      M.put('escombros', 58.0, 41.6, 0, 1, { x0: 57.2, x1: 58.8, z0: 41.0, z1: 42.2 }); M.put('hongos', 62.6, 37.4, 0, 1, { x0: 61.4, x1: 63.6, z0: 36.6, z1: 38.2 });
      M.put('hongo_pared', 63.8, 41.0, -1, 0, { x0: 63.64, x1: 63.94, z0: 40.0, z1: 42.0 });
      // la sala de guardia: el armero y la mesa de los guardias
      M.put('armero', 33.0, 54.0, 1, 0); M.put('mesa_campo', 37.6, 55.4, 0, -1);
      // el comedor del ala oeste (mesas largas) y el almacén
      M.put('mesa_campo', 9.2, 51.2, 0, 1); M.put('mesa_campo', 9.2, 54.2, 0, 1); M.put('banco_parque', 9.2, 52.6, 0, 1);
      M.put('palets', 24.0, 56.6, 0, 1); M.put('ibc', 26.4, 56.6, 0, 1); M.put('bidones', 29.6, 50.0, -1, 0);
      // la perrera (dos chasqueadores encadenados), la armería y el dormitorio del ala este
      M.put('poste_cadena', 68.2, 53.2, 0, 1, { keep: true }); M.put('poste_cadena', 73.4, 53.2, 0, 1, { keep: true });
      M.put('hongos', 70.8, 56.2, 0, 1, { x0: 69.4, x1: 72.4, z0: 55.4, z1: 57.2 }); M.put('cubos', 76.0, 49.4, -1, 0);
      M.put('armero', 81.0, 57.4, 0, -1); M.put('armero', 84.6, 57.4, 0, -1); M.put('cajas', 88.8, 49.2, -1, 0); M.put('banco', 88.6, 53.0, -1, 0);
      M.put('bidones', 79.0, 49.0, 0, 1);

      // ---- el pórtico y la escalinata: columnas en el borde del zócalo ----
      for (const x of [40.2, 42.9, 45.0, 51.0, 53.1, 55.8]) M.put('columna', x, 59.7, 0, 1, { keep: true });

      // ---- el patio de atrás: contenedores de dormitorio, el depósito de vehículos, el taller, las letrinas,
      // el tendedero y el chasqueador de la puerta trasera ----
      M.cont(8, 10, 'x', 12, 2, { cols: [0x6a3a2e, 0x2e4a5a] });
      M.cont(8, 14, 'x', 12, 1, { open: true, cols: [0x4a5a3a] });
      M.cont(8, 20, 'x', 6, 1, { cols: [0x8a6a3a] });
      M.put('refugio_lona', 24.0, 12.4, 0, 1); M.put('refugio_lona', 27.4, 12.4, 0, 1);
      M.put('fogata_viva', 40.5, 20.5, 0, 1); M.put('banco_parque', 40.5, 18.7, 0, 1); M.put('banco_parque', 40.5, 22.3, 0, -1);
      M.put('tendedero', 30.4, 20.6, 0, 1); M.put('tendedero', 30.4, 24.0, 0, 1);
      M.put('banco', 52.0, 12.0, 0, 1); M.put('palets', 55.4, 12.0, 0, 1); M.put('tablas', 57.8, 14.2, 1, 0); M.put('lona', 50.6, 15.6, 0, 1);
      M.put('cobertizo', 62.0, 9.4, 0, 1); M.put('cobertizo', 65.0, 9.4, 0, 1);
      M.put('camion', 80.0, 15.0, 0, 1, { col: 0x5a5244 }); M.put('camioneta', 74.6, 14.2, 0, 1, { col: 0x5a4a3a });
      M.put('coche', 86.6, 22.6, 0, -1, { col: car() }); M.put('bidones', 88.6, 10.4, -1, 0); M.put('ibc', 88.6, 13.0, -1, 0); M.put('neumaticos', 72.4, 24.6, 0, 1);
      M.put('poste_cadena', 48.0, 30.6, 0, 1, { keep: true });
      M.puddle(34, 16, 2.4, 1.2); M.puddle(68, 26, 2.0, 1.1);
      for (const [x, z] of [[5, 26], [5, 30], [91, 30], [36, 8], [44, 7], [60, 7]]) M.tree(x, z, false);

      // ---- la plaza: el paseo con palmeras, la estatua, el control de la entrada (sacos, barricadas y la torre),
      // el huerto donde trabajan los presos y el aparcamiento ----
      M.put('estatua', 48.0, 74.0, 0, 1, { keep: true });
      for (const [x, z] of [[42.6, 71.0], [53.4, 71.0], [42.6, 77.0], [53.4, 77.0]]) M.put('banco_parque', x, z, x < 48 ? 1 : -1, 0);
      for (const z of [64.5, 68.5, 81.5]) { M.put('palmera', 44.6, z, 0, 1); M.put('palmera', 51.4, z, 0, 1); }
      M.put('barricada', 44.0, 85.6, 0, 1); M.put('barricada', 52.0, 85.6, 0, 1);
      M.put('sacos', 44.0, 84.6, 0, 1, { x0: 42.6, x1: 45.4, z0: 84.3, z1: 84.9, h: 0.85 }); M.put('sacos', 52.0, 84.6, 0, 1, { x0: 50.6, x1: 53.4, z0: 84.3, z1: 84.9, h: 0.85 });
      M.put('tarima', 40.4, 84.6, 0, -1); M.put('cartel_madera', 54.0, 86.4, 0, 1);
      for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) M.put('jardinera', 13.6 + k * 5.0, 69.0 + r * 4.6, 0, 1);
      M.put('tendedero', 14.6, 78.6, 0, 1); M.put('cajas', 31.6, 68.0, 0, 1); M.put('cajas', 31.6, 69.2, 0, 1); M.put('mesa_campo', 28.4, 78.0, 0, -1);
      for (const [x, z] of [[66, 69.2], [72, 69.2], [84, 69.2], [69, 80.8], [81, 80.8]]) M.put('coche', x, z, 0, rng() < 0.5 ? 1 : -1, { col: car() });
      M.put('camioneta', 77.0, 69.4, 0, 1, { col: 0x6a5a4a }); M.put('fogata', 62.5, 80.5, 0, 1);
      M.put('cartel_madera', 72.0, 86.7, 0, -1);
      // la salida (por donde te cuelas y sales en la liberación): un tramo de la valla de alambre derribado, la malla
      // tirada en el suelo hacia fuera y los postes doblados
      M.put('malla_caida', 6.6, 88.55, 0, 1, { x0: 4.9, x1: 8.3, z0: 87.9, z1: 89.2 });
      M.edge('N', 5, 88, G.World.E.NONE); M.edge('N', 6, 88, G.World.E.NONE); M.edge('N', 7, 88, G.World.E.NONE);
      M.tall(5, 62, 10, 87); M.tall(34, 62, 44, 70); M.tall(54, 84, 62, 87); M.tall(86, 62, 91, 87); M.tall(5, 7, 8, 9);
      for (const [x, z] of [[6, 64], [8, 70], [5, 76], [36, 84], [58, 86], [89, 64], [90, 76], [60, 63], [36, 63]]) M.tree(x, z, rng() < 0.2);
      for (const [x, z] of [[9, 83], [11, 86], [6, 80], [38, 72], [58, 72], [90, 84]]) M.bush(x, z);
      M.puddle(47.5, 82, 1.6, 1.0);
      // fuera de la valla: eucaliptos y algún pino (tapan el horizonte en parte)
      for (let a = 0; a < 96; a += 2) for (const off of [0, 2]) {
        const j = Math.floor(rng() * 2);
        for (const [x, z] of [[off + j - 1, a], [94 - off - j, a + 1], [a, off + j - 1], [a + 1, 94 - off - j]]) {
          if (x >= 0 && z >= 0 && x < 96 && z < 96 && (x < 3 || x > 92 || z < 5 || z > 89) && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.3);
        }
      }
    }
  };

  // =====================================================================================================
  // Salón recreativo (solo para el jefe final): un local de máquinas abandonado. Se empieza en el medio de la
  // sala grande (20 x 12, como el interior de la nave de la terminal). Detrás de la pared norte está la
  // trastienda, la guarida del hongomorfo (siempre sale por ese tramo de pared); en cada una de las otras tres
  // paredes, una habitación con puerta (despacho, depósito y vestíbulo), conectadas también entre sí para dar
  // vueltas. El hongomorfo no cabe por las puertas: derriba las paredes. Moqueta con dibujos de neón comida por el hongo, máquinas volcadas,
  // neones en las paredes (algunos rotos, parpadeando) y escombros
  // =====================================================================================================
  const AX = 5, AZ = 8;          // esquina del edificio (entero dentro de un trozo del mundo: x 5 a 31)
  MAPS.arcade = {
    wild: 0.35, name: 'Salón recreativo', boss: true, min: 2, max: 54, spawn: { x: AX + 13, z: AZ + 10.6 }, seed: 777, fence: 'chain',
    skyline: { col: 0x1c1a24, h: [9, 24] },
    // fuera: calle de noche (solo se llega si el hongomorfo tira una de las paredes de fuera); las luces de la
    // calle están en G.Maps.decor
    outLamps: [[18, 37.4, 0xffa04a], [44, 20, 0xffb060], [6, 46, 0xff9a40]],
    board: { x: AX + 13, z: AZ + 15.85, fx: 0, fz: -1 }, // modo libre: el panel de los mapas (pared sur)
    // dentro: penumbra morada; la luz la ponen los neones y las pantallas
    mood: { sky: 0x07060b, fog: 0.55, hemi: [0x8a7ab0, 0x2a2232, 0.9], sun: [0xb4a6d8, 0.05], ground: { 3: [0x2a2630, 0x302b36], 1: [0x232227, 0x28272c], 2: [0x36353a, 0x3d3c42], 0: [0x1f2a1e, 0x253124] } },
    // datos del jefe (coordenadas del mundo): la sala, la guarida, el tramo de pared que se derriba al empezar
    // (aristas N en z = AZ + 4, de x0 a x1 - 1) y por dónde sale el blindado
    arena: { hall: { x0: AX + 3, z0: AZ + 4, x1: AX + 23, z1: AZ + 16 }, lair: { x: AX + 13, z: AZ + 2 },
      breach: { z: AZ + 4, x0: AX + 11, x1: AX + 15 }, nemi: { x: AX + 7, z: AZ + 2 } },
    build(M, rng) {
      const F = G.World.F;
      M.ground(0, 0, 56, 56, F.ROAD);
      // ---- fuera ----
      // calle al sur (z 30..36) con aceras, aparcamiento del otro lado, patio de carga al este, callejones al
      // norte y al oeste y un descampado al sureste
      M.ground(2, 28, 54, 30, F.SIDEWALK); M.ground(2, 36, 54, 38, F.SIDEWALK);
      M.ground(34, 2, 36, 28, F.SIDEWALK);
      M.ground(40, 40, 54, 54, F.DIRT); M.ground(2, 2, 8, 8, F.DIRT);
      M.ground(46, 2, 54, 10, F.GRASS); M.ground(2, 48, 12, 54, F.GRASS);
      // la calle: coches abandonados, uno de policía cruzado y una ambulancia con las puertas abiertas
      M.put('coche', 12.5, 32.4, 1, 0, { col: 0x3a4a5a }); M.put('patrulla', 24.5, 33.6, -0.94, 0.34);
      M.put('coche', 33.0, 34.4, -1, 0, { col: 0x5a2a26 }); M.put('ambulancia', 45.0, 32.6, 1, 0);
      M.put('arbol_caido', 6.0, 33.2, 1, 0);
      M.put('barrera', 18.0, 31.0, 0, 1); M.put('barrera', 39.0, 35.2, 0, 1);
      M.puddle(20, 34.5, 3, 1.4); M.puddle(37, 31.3, 2.2, 1);
      // aparcamiento (z 38..48): coches, carritos tirados y un campamento abandonado
      M.put('coche', 9.0, 41.5, 0, 1, { col: 0x6a6e62 }); M.put('camioneta', 15.5, 42.0, 0, -1, { col: 0x2e3a2c });
      M.put('coche', 27.0, 41.6, 0, 1, { col: 0x4a4038 }); M.put('coche', 33.5, 45.5, 0, -1, { col: 0x26262a });
      M.put('carrito', 21.0, 40.2, 0.7, 0.7); M.put('carrito', 22.4, 44.6, -1, 0); M.put('carrito', 30.4, 39.4, 0, 1);
      M.put('fogata', 20.5, 49.5, 0, 1); M.put('refugio_lona', 15.5, 50.5, 1, 0); M.put('barricada', 25.6, 51.4, 0, 1);
      M.put('tablas', 11.2, 47.2, 0, 1); M.put('bidones', 28.6, 49.4, 0, 1);
      M.puddle(12, 45.5, 2.6, 1.3); M.puddle(30, 43, 2, 1.2);
      // descampado (sureste): montón de cadáveres quemados, escombros y algún árbol seco
      M.put('cadaveres', 47.0, 47.0, 0, 1); M.put('escombro_grande', 42.5, 43.5, 1, 0); M.put('escombro_grande', 51.0, 41.5, 0, 1);
      M.put('lona', 44.0, 51.5, 0, 1); M.put('palets', 50.5, 51.0, 1, 0);
      for (const [x, z] of [[41, 50], [52, 46], [44, 39]]) M.tree(x, z, false);
      // patio de carga (este, x 36..54, z 2..28): camión en el muelle, contenedores, palés y bidones
      M.put('camion', 41.5, 13.0, 0, 1, { col: 0xb8b4a8 }); M.put('montacargas', 38.6, 19.5, 1, 0);
      M.cont(48, 13, 'z', 6, 1); M.cont(48, 21, 'z', 6, 2);
      M.put('palets', 38.4, 5.0, 0, 1); M.put('palets', 40.6, 5.0, 0, 1); M.put('ibc', 44.0, 4.4, 0, 1);
      M.put('bidones', 37.2, 24.6, 1, 0); M.put('tubo', 44.0, 25.4, 1, 0); M.put('bloques', 52.0, 26.0, 0, 1);
      M.put('lona', 44.6, 8.6, 0, 1); M.put('barrera', 52.0, 16.0, 0, 1);
      M.tree(50, 4, false); M.tree(52, 8, true);
      // callejón de atrás (norte, z 2..8) y callejón del oeste (x 2..8): basura, escombros y una barricada
      M.put('cubos', 12.0, 3.4, 0, 1); M.put('cubos', 13.4, 3.4, 0, 1); M.put('bidones', 22.0, 3.0, 1, 0);
      M.put('palets', 27.5, 4.2, 0, 1); M.put('escombro_grande', 18.0, 5.4, 1, 0); M.put('barricada', 31.0, 5.0, 0, 1);
      M.put('cubos', 3.4, 14.0, 1, 0); M.put('tablas', 3.5, 20.0, 1, 0); M.put('valla_rota', 3.4, 25.0, 1, 0, { x0: 3.3, x1: 3.5, z0: 24.1, z1: 25.9 });
      M.put('escombros', 3.4, 10.0, 0, 1, { x0: 2.7, x1: 4.3, z0: 9.4, z1: 10.6 }); M.put('lona', 3.6, 4.0, 0, 1);
      M.puddle(16, 6, 2.4, 1.2); M.puddle(3.5, 17, 1.2, 2.2);
      // farolas (las que siguen encendidas tienen luz: ver outLamps)
      for (const [x, z] of [[17.5, 37], [43.5, 19.5], [5.5, 45.5], [30, 28.5], [8, 28.5], [36, 3]]) M.pole(x, z);
      M.building('arcade_b', AX, AZ, 26, 20, 'S', (c, b, li, E2) => {
        // sin luces del techo: alumbran los neones (G.Maps.decor)
        for (const r of b.rooms) r.on = false;
        // la guarida (trastienda, z AZ a AZ + 4) cerrada por fuera: sin puertas ni huecos al exterior (el hongomorfo
        // sale derribando la pared de la sala; la de fuera la tira él después, si quiere)
        const X0 = c.cx * 32, Z0 = c.cz * 32, inside = (x, z) => x >= X0 && x < X0 + 32 && z >= Z0 && z < Z0 + 32;
        for (let x = AX; x < AX + 26; x++) if (inside(x, AZ)) c.eN[li(x, AZ)] = E2.WALL;
        for (let z = AZ; z < AZ + 4; z++) { if (inside(AX, z)) c.eW[li(AX, z)] = E2.WALL; if (inside(AX + 26, z)) c.eW[li(AX + 26, z)] = E2.WALL; }
      });
      const X = (x) => AX + x, Z = (z) => AZ + z;
      // ---- sala grande (x 3..23, z 4..16) ----
      // máquinas contra la pared norte (a los lados de la brecha), mirando al sur
      for (const x of [3.6, 4.45, 5.3, 6.15, 7.0]) M.put('maquina', X(x), Z(4.45), 0, 1);
      for (const x of [18.0, 18.85, 19.7, 21.55, 22.4]) M.put('maquina', X(x), Z(4.45), 0, 1);
      // contra la pared oeste, mirando al este (con huecos)
      for (const z of [6.2, 7.05, 7.9, 11.2, 12.05, 12.9]) M.put('maquina', X(3.42), Z(z), 1, 0);
      // pinballs contra la pared este
      for (const z of [6.0, 8.0, 12.6]) M.put('pinball', X(22.2), Z(z), -1, 0);
      // grúas y cambiador contra la pared sur
      M.put('grua', X(4.0), Z(15.45), 0, -1); M.put('grua', X(5.1), Z(15.45), 0, -1);
      M.put('cambio', X(21.8), Z(15.7), 0, -1);
      for (const x of [16.6, 17.45, 18.3]) M.put('maquina', X(x), Z(15.55), 0, -1);
      // dos islas de máquinas espalda con espalda
      for (const x of [6.6, 7.45, 8.3]) { M.put('maquina', X(x), Z(9.1), 0, -1); M.put('maquina', X(x), Z(9.9), 0, 1); }
      for (const x of [17.4, 18.25, 19.1]) { M.put('maquina', X(x), Z(9.1), 0, -1); M.put('maquina', X(x), Z(9.9), 0, 1); }
      // hockey en el centro-sur, máquinas volcadas y un sofá destripado
      M.put('hockey', X(13.0), Z(13.6), 1, 0);
      M.put('maquina_rota', X(10.2), Z(6.6), 1, 0); M.put('maquina_rota', X(15.6), Z(12.6), 0, 1);
      M.put('sofa', X(9.5), Z(15.5), 0, -1);
      // hongos sobre la moqueta y escombros
      for (const [x, z, w, d] of [[13, 5.2, 3.2, 1.6], [5.5, 14.2, 2.4, 1.6], [20.6, 13.6, 2.2, 1.8], [11, 10.5, 1.6, 1.2], [16, 6.8, 1.8, 1.2], [4.2, 9.5, 1.4, 1.6]]) M.put('hongos', X(x), Z(z), 0, 1, { x0: X(x) - w / 2, x1: X(x) + w / 2, z0: Z(z) - d / 2, z1: Z(z) + d / 2 });
      for (const [x, z] of [[20.6, 14.2], [9.8, 13.2], [3.9, 5.2]]) M.put('escombros', X(x), Z(z), 0, 1, { x0: X(x) - 0.8, x1: X(x) + 0.8, z0: Z(z) - 0.6, z1: Z(z) + 0.6 });
      M.put('hongo_pared', X(9.0), Z(4.16), 0, 1);            // la mancha de hongo que delata la guarida
      M.put('hongo_pared', X(3.16), Z(14.6), 1, 0);
      // ---- trastienda (guarida, todo el lado norte): hongo por todas partes ----
      M.put('estante', X(4.2), Z(0.3), 0, 1); M.put('cajas', X(6.0), Z(0.6), 0, 1); M.put('cajas', X(20.8), Z(3.2), 0, 1);
      M.put('estante', X(21.8), Z(0.3), 0, 1); M.put('estante', X(1.0), Z(0.3), 0, 1); M.put('cajas', X(25.0), Z(1.0), 0, 1);
      for (const [x, z] of [[9, 1.5], [13, 2.2], [17.5, 1.4], [5, 2.8], [1.6, 2.6], [24.4, 2.8]]) M.put('hongos', X(x), Z(z), 0, 1, { x0: X(x) - 1.2, x1: X(x) + 1.2, z0: Z(z) - 0.8, z1: Z(z) + 0.8 });
      M.put('hongo_pared', X(13), Z(0.16), 0, 1); M.put('hongo_pared', X(9), Z(0.16), 0, 1); M.put('hongo_pared', X(17), Z(0.16), 0, 1);
      // ---- despacho (oeste, x 0..3): puertas a la sala (z 10) y al vestíbulo (z 18) ----
      M.put('escritorio', X(0.75), Z(5.6), 1, 0); M.put('archivador', X(0.35), Z(7.6), 1, 0);
      M.put('archivador', X(0.35), Z(13.2), 1, 0); M.put('cajas', X(0.6), Z(15.2), 0, 1);
      M.put('escombros', X(1.2), Z(12.0), 0, 1, { x0: X(0.6), x1: X(1.8), z0: Z(11.6), z1: Z(12.4) });
      M.put('hongo_pared', X(0.16), Z(10.5), 1, 0);
      // ---- depósito (este, x 23..26): puertas a la sala (z 10) y al vestíbulo (z 18) ----
      M.put('estante', X(25.7), Z(5.6), -1, 0); M.put('estante', X(25.7), Z(7.6), -1, 0);
      M.put('estante', X(25.7), Z(13.0), -1, 0); M.put('cajas', X(25.4), Z(15.2), 0, 1);
      M.put('hongos', X(24.5), Z(9.0), 0, 1, { x0: X(23.6), x1: X(25.4), z0: Z(8.4), z1: Z(9.6) });
      // ---- vestíbulo (sur, z 16..20): puerta a la sala en x 13; mostrador de premios, máquinas y bancos ----
      M.put('mostrador', X(8.4), Z(18.2), 0, -1); M.put('mostrador', X(6.0), Z(18.2), 0, -1);
      M.put('banco_espera', X(17.5), Z(19.5), 0, -1);
      for (const x of [19.8, 20.65]) M.put('maquina', X(x), Z(16.45), 0, 1);
      M.put('grua', X(21.6), Z(19.4), 0, -1);
      M.put('hongos', X(10.8), Z(17.6), 0, 1, { x0: X(9.8), x1: X(11.8), z0: Z(17), z1: Z(18.2) });
    }
  };

  // =====================================================================================================
  // Estación de policía de Oceanside (el final variante): todo interior, abandonada y a oscuras, en cuatro alas
  // (una por trozo del mundo; ver comisaria_b/_e/_s/_d en buildings.js). Unos 59 x 61 m:
  //   noroeste: la sala principal (living de espera) con el agujero del techo; calabozos (cerrados), archivo,
  //             celdas, despacho del comisario, armería (atrancada), recepción y aseos
  //   noreste:  pasillo, garaje de las patrullas, sala de descanso (2.º living) y vestuarios
  //   suroeste: sala de radio, vestíbulo, oficinas de los detectives y depósito de pruebas
  //   sureste:  gimnasio, comedor y sala de reuniones (3.er living)
  // El hongo por las paredes, cadáveres de corredores, maleza y hiedra, charcos, escombros y grafitis. Niebla negra:
  // se ve poco y lo de detrás no se dibuja. Todo en coordenadas del mundo (las alas: x 1-32-60, z 1-32-62)
  // =====================================================================================================
  // La estación en 2020 (lo que solo tiene la limpia): el portón del garaje y la calle de salida, árboles fuera,
  // macetas, dispensadores de agua, la radio de la sala, la pizarra de la sala de reuniones y, fuera de la
  // valla, los edificios de la calle (enteros, con sus tiendas). El norte y el oeste quedan al borde del mapa:
  // ahí se ve el horizonte de la ciudad (skyline)
  function stationClean(M, P) {
    const F = G.World.F;
    // el portón (subido) en la pared este del garaje y la calle que baja por el lado este hasta la entrada
    M.put('porton', 59.85, 6.5, -1, 0, { x0: 59.7, x1: 60.0, z0: 4.0, z1: 9.0, keep: true });
    M.ground(60, 1, 66, 62, F.ROAD);
    M.ground(66, 1, 68, 62, F.GRASS);
    M.ground(56, 62, 70, 70, F.ROAD);
    // árboles: en el césped del lado este y en el patio de la entrada (otoño: alguno con la hoja ya amarilla)
    for (const z of [6, 14, 22, 30, 38, 46, 54]) M.tree(66, z, z === 22 || z === 46);
    M.ground(44, 67, 57, 68, F.GRASS); M.ground(0, 66, 3, 68, F.GRASS);
    for (const x of [45, 50, 55]) M.tree(x, 67, false);
    M.tree(1, 66, true);
    // macetas (en los rincones, sin tapar puertas)
    for (const [x, z] of [[10.7, 7.7], [23.3, 22.3], [24.8, 7.8], [31.2, 16.4], [10.7, 23.7], [10.7, 31.3], [23.3, 33.0], [11.7, 33.0],
      [1.7, 44.8], [23.3, 44.8], [23.3, 61.3], [32.8, 45.8], [59.2, 45.8], [36.7, 15.7], [46.8, 44.2], [1.7, 32.8]]) P('maceta', x, z, 0, 1);
    // desorden de una noche de mucho trabajo: hojas por el suelo, carpetas apiladas y vasos de café en las mesas
    const flat = (t, x, z, w, d, y) => M.put(t, x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y: y || 0, keep: true });
    for (const [x, z, w, d] of [[6.0, 50.5, 1.4, 1.0], [14.2, 54.6, 1.0, 0.8], [18.5, 46.2, 1.2, 0.9], [9.8, 58.8, 0.9, 0.8], [19.5, 25.5, 1.0, 0.8],
      [15.0, 38.0, 0.8, 0.7], [17.8, 15.5, 1.0, 0.8], [29.5, 13.4, 0.9, 0.8], [5.0, 11.0, 1.6, 1.2], [7.5, 15.8, 1.0, 0.8], [34.0, 18.0, 0.8, 0.7], [27.6, 22.6, 0.7, 0.6]]) flat('papeles', x, z, w, d);
    for (const [x, z] of [[8.9, 8.3], [2.2, 13.6], [25.0, 10.5], [3.2, 41.6]]) M.put('carpetas', x, z, 0, 1, { keep: true });
    // encima de los escritorios de las oficinas (a 0,76 m)
    let k = 0;
    for (const z of [48.5, 52.5, 56.5]) for (const x of [4.0, 8.0, 12.0, 16.0, 20.0]) {
      if (z === 52.5 && x === 12.0) continue;
      if (k % 3 === 0) flat('papeles', x - 0.2, z - 0.02, 0.55, 0.45, 0.76);
      if (k % 2 === 0) M.put('vaso', x + 0.42, z + 0.14, 0, 1, { y: 0.76, keep: true });
      if (k % 3 === 1) M.put('carpetas', x + 0.25, z - 0.06, 0, 1, { y: 0.76, keep: true });
      k++;
    }
    // el de Javier, el del jefe, la mesa de la sala de descanso y las del comedor
    M.put('carpetas', 28.4, 9.92, 0, 1, { y: 0.76, keep: true }); M.put('vaso', 27.45, 10.16, 0, 1, { y: 0.76, keep: true });
    flat('papeles', 29.35, 20.85, 0.5, 0.7, 0.76); M.put('vaso', 29.25, 21.5, 0, 1, { y: 0.76, keep: true });
    M.put('vaso', 45.2, 19.4, 0, 1, { y: 0.76, keep: true }); M.put('vaso', 45.95, 19.7, 0, 1, { y: 0.76, keep: true }); flat('papeles', 45.6, 19.5, 0.6, 0.5, 0.76);
    for (const [x, z] of [[49.2, 36.1], [52.8, 35.9], [57.2, 40.6]]) M.put('vaso', x, z, 0, 1, { y: 0.76, keep: true });
    // dispensadores de agua: en el vestíbulo y en las oficinas
    P('dispensador', 23.4, 39.6, -1, 0); P('dispensador', 23.4, 46.2, -1, 0);
    // la radio de la sala principal (en la mesita, entre los sillones): suena con interferencias (ver G.NPCs)
    M.put('radio', 13.7, 12.8, 0, 1, { y: 0.55, keep: true });
    // la pizarra de la sala de reuniones, en la pared sur (los bancos miran hacia ella)
    M.put('pizarra', 46.0, 61.96, 0, -1, { y: 0.95, keep: true });
    // fuera de la valla: los edificios de la calle (al este y al sur), enteros
    M.put('fachada', 71.0, 21.0, -1, 0, { x0: 69.2, x1: 73.0, z0: 4.0, z1: 38.0, h: 12.0, style: 1, clean: true, keep: true });
    M.put('fachada', 71.0, 53.0, -1, 0, { x0: 69.2, x1: 73.0, z0: 40.0, z1: 66.0, h: 15.0, style: 0, clean: true, keep: true });
    M.put('fachada', 17.0, 72.4, 0, -1, { x0: 2.0, x1: 32.0, z0: 70.6, z1: 74.2, h: 13.5, style: 2, clean: true, keep: true });
    M.put('fachada', 50.0, 72.4, 0, -1, { x0: 36.0, x1: 66.0, z0: 70.6, z1: 74.2, h: 11.0, style: 0, clean: true, keep: true });
  }

  // La estación por dentro (alas, puertas y muebles). clean: tal como era en 2020 (el prólogo del modo historia):
  // sin paredes caídas, viga, escombros, hongo, maleza ni charcos, con la luz encendida y la valla entera
  function stationBuild(M, clean) {
      const F = G.World.F, W = G.World;
      M.ground(0, 0, 64, 64, F.CONCRETE);
      M.ground(0, 62, 70, 70, F.ROAD);        // el patio de fuera (la entrada)
      // cada ala: sin luces del techo (no hay corriente) y sus paredes de fuera cerradas; los pasos entre alas, en
      // las paredes que pone cada una (o, al este y al sur, la de al lado)
      const wing = (id, ox, oz, w, h, walls) => M.building(id, ox, oz, w, h, 'S', (c, b, li, E2) => {
        for (const r of b.rooms) r.on = !!clean;          // (abandonada: sin corriente; en 2020, todo encendido)
        // (en 2020, algún fluorescente viejo parpadea: los aseos, las celdas y el depósito)
        if (clean) for (const r of b.rooms) if (r.type === 'aseos' || r.type === 'celda' || r.type === 'calabozo' || r.type === 'cdeposito') r.flicker = true;
        const X0 = c.cx * 32, Z0 = c.cz * 32, inside = (x, z) => x >= X0 && x < X0 + 32 && z >= Z0 && z < Z0 + 32;
        const setN = (x, z, e) => { if (inside(x, z)) c.eN[li(x, z)] = e; }, setW = (x, z, e) => { if (inside(x, z)) c.eW[li(x, z)] = e; };
        walls({ setN, setW, E: E2, c, li, inside });
        // (2020: todas las puertas, cerradas; se abren al pasar, y la de la calle, con llave: no se sale fuera)
        if (clean) {
          for (let z = Z0; z < Z0 + 32; z++) for (let x = X0; x < X0 + 32; x++) {
            const i = li(x, z);
            if (c.eN[i] === E2.DOOR_OPEN) c.eN[i] = E2.DOOR;
            if (c.eW[i] === E2.DOOR_OPEN) c.eW[i] = E2.DOOR;
          }
          if (inside(8, 62)) (c.locked || (c.locked = new Set())).add('N8,62');
        }
      });
      // --- noroeste ---
      wing('comisaria_b', 1, 1, 31, 31, ({ setN, setW, E, c, li, inside }) => {
        for (let x = 1; x < 32; x++) setN(x, 1, E.WALL);
        for (let z = 1; z < 32; z++) setW(1, z, E.WALL);
        if (!clean) for (let z = 19; z < 23; z++) setW(10, z, E.NONE);          // la pared caída de las celdas a la sala
        if (!clean) for (let x = 13; x < 22; x++) setN(x, 23, E.NONE);          // y la de la sala a la recepción
        // la armería: la puerta atrancada (no se abre, no se rompe). En 2020 es la oficina del jefe: abierta
        for (let z = 17; z < 25; z++) {
          if (!inside(24, z)) continue;
          const e = c.eW[li(24, z)];
          if (e !== E.WALL && e !== E.NONE) {
            if (clean) c.eW[li(24, z)] = E.DOOR_OPEN;
            else { c.eW[li(24, z)] = E.DOOR; (c.locked || (c.locked = new Set())).add('W24,' + z); }
          }
        }
      });
      // --- noreste (su pared oeste es la del edificio principal: puertas al despacho y a los aseos) ---
      wing('comisaria_e', 32, 1, 28, 31, ({ setN, setW, E }) => {
        for (let x = 32; x < 60; x++) setN(x, 1, E.WALL);
        for (let z = 1; z < 32; z++) { setW(32, z, E.WALL); setW(60, z, E.WALL); }
        setW(32, 12, E.DOOR_OPEN); setW(32, 28, E.DOOR_OPEN);
        if (!clean) for (let x = 39; x < 48; x++) setN(x, 15, E.NONE);          // la pared caída del garaje a la sala de descanso
        if (clean) for (let z = 4; z < 9; z++) setW(60, z, E.NONE);             // (2020: el portón del garaje, abierto: por ahí salen los patrulleros)
      });
      // --- suroeste (su pared norte da a la principal: la recepción se abre al vestíbulo por la pared caída) ---
      wing('comisaria_s', 1, 32, 31, 30, ({ setN, setW, E }) => {
        for (let x = 1; x < 32; x++) { setN(x, 32, E.WALL); setN(x, 62, E.WALL); }
        setN(8, 62, E.DOOR_OPEN);                                      // la entrada de fuera (ver entry)
        for (let z = 32; z < 62; z++) setW(1, z, E.WALL);
        if (!clean) for (let x = 14; x < 21; x++) setN(x, 32, E.NONE);
        else setN(17, 32, E.DOOR_OPEN);                                // (en 2020: una puerta de la recepción al vestíbulo)
        for (let x = 13; x < 22; x++) setN(x, 44, E.NONE);          // el vestíbulo, abierto a las oficinas
      });
      // --- sureste (al norte, el ala noreste; al oeste, el depósito) ---
      wing('comisaria_d', 32, 32, 28, 30, ({ setN, setW, E }) => {
        for (let x = 32; x < 60; x++) { setN(x, 32, E.WALL); setN(x, 62, E.WALL); }
        for (let z = 32; z < 62; z++) { setW(32, z, E.WALL); setW(60, z, E.WALL); }
        setN(41, 32, E.DOOR_OPEN); setN(55, 32, E.DOOR_OPEN); setW(32, 38, E.DOOR_OPEN); setW(32, 54, E.DOOR_OPEN);
        for (let x = 50; x < 57; x++) setN(x, 45, E.NONE);          // el comedor, abierto a la sala de reuniones
      });
      // ---- muebles (en coordenadas del mundo) ----
      const P = (t, x, z, fx, fz, ex) => M.put(t, x, z, fx, fz, ex);
      const area = (t, x, z, w, d) => M.put(t, x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
      // (hongo, maleza, escombros y charcos: solo en la abandonada)
      const no = () => {};
      const fung = clean ? no : (x, z, w, d) => area('hongos', x, z, w, d), weed = clean ? no : (x, z, w, d) => area('maleza', x, z, w, d), rubble = clean ? no : (x, z, w, d) => area('escombros', x, z, w, d);
      const pud = clean ? no : (x, z, w, d) => M.puddle(x, z, w, d);
      // en la pared: n (pared al norte, mira al sur), s, w, e
      const T = W.WALL_T / 2 + 0.16;
      const wall = (t, x, z, f) => (clean && (t === 'hongo_pared' || t === 'enredadera')) ? null : (f === 'n' ? P(t, x, z + T, 0, 1) : f === 's' ? P(t, x, z - T, 0, -1) : f === 'w' ? P(t, x + T, z, 1, 0) : P(t, x - T, z, -1, 0));
      // sala principal (x 10-24, z 7-23): dos rincones de sillones, el mostrador y, bajo el agujero, la viga caída
      P('sofa', 13.5, 9.8, 0, 1); P('sofa', 11.0, 14.0, 1, 0); P('sillon', 16.0, 13.4, -0.7, -0.7); P('mesita', 13.6, 12.8, 0, 1);
      P('sofa', 20.5, 18.6, 0, -1); P('sillon', 22.6, 16.4, -1, 0); P('mesita', 20.4, 16.8, 0, 1);
      P('mostrador', 20.0, 8.0, 0, 1); P('archivador', 23.4, 7.5, 0, 1);
      if (!clean) M.put('vigas', 17.4, 15.4, 0.8, 0.6, { x0: 16.0, x1: 19.0, z0: 14.9, z1: 15.9, keep: true });
      rubble(17.0, 14.0, 2.4, 2.0); weed(17.2, 13.6, 2.8, 2.4); weed(11.6, 20.6, 2.0, 1.6); weed(23.0, 10.6, 1.6, 2.4);
      fung(14.5, 7.8, 3.0, 1.2); fung(22.4, 21.4, 2.0, 1.4); pud(16.8, 20.0, 2.6, 1.5); pud(19.6, 10.8, 1.8, 1.2);
      wall('hongo_pared', 12.0, 7, 'n'); wall('hongo_pared', 21.5, 7, 'n'); wall('enredadera', 10, 9.0, 'w'); wall('enredadera', 24, 15.0, 'e');
      if (!clean) P('escombro_grande', 22.9, 20.2, -1, 0);                      // contra la puerta atrancada de la armería
      // archivo (x 1-10, z 7-18)
      for (const x of [2.0, 2.9, 3.8, 4.7, 5.6]) P('archivador', x, 7.45, 0, 1);
      P('archivador', 1.45, 10.5, 1, 0); P('archivador', 1.45, 11.4, 1, 0); P('escritorio', 5.5, 14.4, 0, -1); P('estante', 9.6, 8.6, -1, 0);
      rubble(4.0, 10.6, 1.8, 1.2); fung(2.6, 16.4, 2.2, 1.4); pud(7.6, 11.0, 1.4, 1.0); wall('hongo_pared', 1, 14.4, 'w');
      // celdas (x 1-10, z 18-32): tres celdas contra la pared oeste (cerradas, con lo que quedó dentro)
      M.put('reja', 4.2, 25.6, 1, 0, { x0: 4.14, x1: 4.26, z0: 19.6, z1: 31.9 });
      M.put('reja', 2.6, 19.65, 0, 1, { x0: 1.1, x1: 4.2, z0: 19.59, z1: 19.71 });
      M.put('reja', 2.6, 23.8, 0, 1, { x0: 1.1, x1: 4.2, z0: 23.74, z1: 23.86 });
      M.put('reja', 2.6, 27.9, 0, 1, { x0: 1.1, x1: 4.2, z0: 27.84, z1: 27.96 });
      P('colchon', 2.4, 25.8, 0, 1); P('colchon', 2.4, 30.4, 0, 1); fung(2.6, 29.0, 2.0, 1.4);
      P('banco', 8.6, 25.0, -1, 0); weed(7.0, 30.4, 2.0, 1.6); pud(6.4, 21.2, 1.6, 1.0); rubble(9.0, 20.6, 1.2, 3.0); wall('enredadera', 7.0, 32, 's');
      // despacho del comisario (x 24-32, z 7-17)
      P('escritorio', 28.0, 10.0, 0, 1); P('sillon', 28.0, 8.5, 0, 1); P('archivador', 31.5, 8.0, -1, 0); P('estanteria', 31.6, 15.2, -1, 0);
      P('sofa', 26.4, 15.9, 0, -1); weed(29.4, 13.0, 2.0, 1.6); fung(25.4, 8.0, 1.6, 1.0); wall('hongo_pared', 28, 7, 'n');
      // armería (x 24-32, z 17-25): no se entra (lo de dentro, para la historia)
      // (en 2020 es la oficina del jefe: su escritorio mirando a la puerta, archivador, estantería, el sofá de las visitas)
      if (!clean) { P('armero', 31.5, 19.5, -1, 0); P('taquilla', 31.6, 23.4, -1, 0); }
      else {
        M.put('escritorio', 29.4, 21.0, 1, 0, { keep: true }); P('archivador', 31.5, 19.2, -1, 0); P('estanteria', 31.6, 23.8, -1, 0);
        P('sofa', 27.0, 24.45, 0, -1); P('maceta', 31.3, 17.6, 0, 1); M.put('cuadro', 28.0, 17.08, 0, 1);
        M.put('silla', 28.25, 21.0, 1, 0, { keep: true });                    // (la de las visitas: Javier se puede sentar)
      }
      if (!clean) M.put('vigas', 27.4, 21.0, 0, 1, { x0: 25.4, x1: 29.4, z0: 20.4, z1: 21.6, keep: true });
      // recepción (x 10-24, z 23-32)
      P('mostrador', 15.0, 27.6, 0, 1); P('mostrador', 17.6, 27.6, 0, 1); P('banco_espera', 22.6, 31.4, 0, -1); P('taquilla', 23.6, 24.6, -1, 0); P('taquilla', 23.6, 25.2, -1, 0);
      fung(11.4, 30.6, 1.8, 1.2); weed(21.6, 29.0, 2.0, 1.6); pud(13.0, 25.4, 1.8, 1.0);
      // aseos (x 24-32, z 25-32): cubículos contra la pared sur
      for (const x of [26.0, 28.0, 30.0]) { P('inodoro', x, 31.5, 0, -1); M.put('tabique', x + 1.0, 30.9, 1, 0, { x0: x + 0.95, x1: x + 1.05, z0: 29.8, z1: 32 }); }
      P('lavabo', 27.0, 25.4, 0, 1); P('lavabo', 29.0, 25.4, 0, 1); pud(28.0, 27.6, 2.6, 1.2);
      // calabozos (x 1-32, z 1-7): cerrados; hongo por todas partes
      for (const x of [6, 12, 22, 27]) M.put('reja', x, 4.0, 1, 0, { x0: x - 0.06, x1: x + 0.06, z0: 1.2, z1: 5.0 });
      P('colchon', 3.0, 2.6, 1, 0); P('colchon', 20.0, 2.6, 1, 0);
      for (const [x, z] of [[9, 3], [15, 4], [18.5, 2.8], [4, 5.4], [24, 4.4], [29, 3]]) fung(x, z, 2.6, 1.8);
      // ---- noreste ----
      // pasillo (x 32-36, z 1-32)
      weed(34.0, 4.0, 2.4, 2.0); fung(34.0, 15.0, 2.4, 1.6); rubble(34.2, 19.0, 2.0, 1.4); pud(34.0, 25.5, 2.2, 1.4); weed(34.0, 30.6, 2.4, 1.6);
      wall('hongo_pared', 36, 13.0, 'e'); wall('enredadera', 32, 20.0, 'w');
      // garaje (x 36-60, z 1-15)
      if (!clean) { P('patrulla', 42.0, 6.4, 0, 1); P('patrulla', 49.0, 6.0, 0, -1); P('coche', 56.0, 7.0, 0, 1); }
      else {
        // (2020: los patrulleros aparcados mirando al portón, listos para salir; el coche del taller, al fondo)
        // (el de más al sur, el de Alem y Javier: con sitio a los dos lados para abrir las puertas; ver G.Story)
        for (const z of [3.6, 6.6, 10.4]) M.put('patrulla', 46.0, z, 1, 0, { keep: true });
        M.put('coche', 40.5, 12.8, 1, 0, { keep: true });
      }
      P('neumaticos', 38.0, 2.2, 0, 1); P('bidones', 58.8, 2.2, 0, 1); P('estanteria', 45.5, 1.4, 0, 1); P('cajas', 52.5, 1.8, 0, 1);
      weed(38.4, 12.6, 2.6, 2.0); weed(58.0, 12.4, 2.6, 2.4); fung(53.0, 12.6, 2.4, 1.6); pud(45.6, 10.4, 3.0, 1.6); pud(53.4, 4.0, 2.0, 1.2);
      wall('enredadera', 60, 4.0, 'e'); rubble(43.0, 15.4, 5.0, 1.2);
      // sala de descanso (x 36-50, z 15-32): el segundo living
      P('sofa', 41.0, 28.4, 0, -1); P('sofa', 38.0, 27.6, 1, 0); P('sillon', 44.6, 26.0, -1, 0); P('mesita', 41.2, 26.2, 0, 1);
      P('mesa', 45.5, 19.5, 0, 1); P('nevera', 49.5, 30.2, -1, 0); if (!clean) P('maquina_rota', 47.4, 31.5, 0, -1);
      weed(38.4, 17.6, 2.0, 1.6); fung(48.6, 17.0, 1.8, 1.2); pud(42.0, 21.6, 2.0, 1.2); wall('hongo_pared', 43.0, 32, 's');
      // vestuarios (x 50-60, z 15-32)
      for (let k = 0; k < 12; k++) P('taquilla', 59.6, 17.2 + k * 0.6, -1, 0);
      P('banco', 54.5, 20.0, 0, 1); P('banco', 54.5, 25.5, 0, 1); fung(52.0, 29.4, 2.0, 1.4); pud(56.0, 23.0, 1.6, 1.0);
      // ---- suroeste ----
      // sala de radio (x 1-11, z 32-44)
      P('escritorio', 3.6, 34.0, 0, 1); P('escritorio', 7.2, 34.0, 0, 1); P('estanteria', 1.4, 39.5, 1, 0); P('archivador', 10.5, 42.6, -1, 0);
      fung(4.0, 42.4, 2.0, 1.2); weed(8.4, 39.0, 1.6, 1.4); wall('hongo_pared', 1, 36.0, 'w');
      // vestíbulo (x 11-24, z 32-44): la entrada principal, con los bancos de espera
      P('banco_espera', 12.4, 37.0, 1, 0); P('banco_espera', 12.4, 41.0, 1, 0); P('cajas', 22.8, 42.8, -1, 0); if (!clean) P('barricada', 22.4, 34.0, -1, 0);
      fung(17.6, 39.0, 2.4, 1.6); weed(21.0, 37.6, 1.8, 1.4); pud(15.0, 36.4, 2.0, 1.2);
      // oficinas (x 1-24, z 44-62): filas de escritorios
      for (const z of [48.5, 52.5, 56.5]) for (const x of [4.0, 8.0, 12.0, 16.0, 20.0]) if (!(z === 52.5 && x === 12.0)) P('escritorio', x, z, 0, 1);
      P('archivador', 3.0, 61.5, 0, -1); P('archivador', 4.0, 61.5, 0, -1); P('estanteria', 23.6, 59.0, -1, 0);
      fung(12.0, 52.6, 3.0, 1.6); weed(18.0, 60.0, 2.4, 1.6); pud(6.0, 54.4, 2.2, 1.2); rubble(22.0, 48.0, 1.6, 1.2); wall('enredadera', 1, 50.0, 'w');
      // depósito de pruebas (x 24-32, z 32-62): estanterías a los dos lados (sin tapar las puertas)
      for (let z = 33.5; z < 61.5; z += 2.0) {
        if (!(z > 35.5 && z < 40.5) && !(z > 50.5 && z < 55.5)) { P('estanteria', 25.0, z, 1, 0); P('estanteria', 31.0, z, -1, 0); }
      }
      P('cajas', 28.0, 60.6, 0, -1); rubble(28.0, 44.0, 1.6, 1.4); fung(28.0, 34.0, 1.8, 1.2); pud(28.0, 49.0, 1.6, 1.0);
      // ---- sureste ----
      // gimnasio (x 32-46, z 32-45)
      P('banco', 37.0, 36.0, 0, 1); P('banco', 41.5, 36.0, 0, 1); P('colchon', 40.0, 41.0, 0, 1); P('colchon', 42.2, 41.0, 0, 1);
      P('neumaticos', 45.0, 33.4, 0, 1); P('cajas', 33.4, 43.4, 1, 0); fung(35.0, 40.0, 2.0, 1.4); weed(44.4, 43.0, 1.8, 1.4);
      // comedor (x 46-60, z 32-45)
      for (const [x, z] of [[49.0, 36.0], [53.0, 36.0], [49.0, 40.5], [57.0, 40.5]]) P('mesa', x, z, 0, 1);
      P('nevera', 59.5, 33.6, -1, 0); P('encimera', 59.6, 36.6, -1, 0); P('fregadero', 59.6, 38.0, -1, 0);
      fung(53.4, 43.6, 2.0, 1.2); pud(56.0, 37.4, 1.6, 1.0); wall('hongo_pared', 46, 42.0, 'w');
      // sala de reuniones (x 32-60, z 45-62): el tercer living, con la mesa grande y los bancos mirando a la pizarra
      P('mesa_mapa', 46.0, 52.0, 0, 1);
      for (const x of [40.0, 44.0, 48.0, 52.0]) P('banco_espera', x, 57.0, 0, 1);
      P('sofa', 34.6, 59.6, 1, 0); P('sofa', 58.4, 50.0, -1, 0); P('sillon', 58.2, 56.0, -1, 0);
      weed(35.0, 48.0, 2.4, 2.0); fung(52.0, 48.4, 2.6, 1.4); weed(56.0, 60.6, 2.6, 1.6); pud(41.0, 52.0, 2.2, 1.2); rubble(33.6, 52.0, 1.0, 2.2);
      wall('enredadera', 60, 47.6, 'e'); wall('hongo_pared', 40.0, 62, 's');
      // ---- el casillero de armas de la policía (en un rincón distinto cada vez; en 2020 no está) ----
      if (!clean) {
      const lk = MAPS.comisaria.lockers[Math.floor(Math.random() * MAPS.comisaria.lockers.length)];     // (fresh: se rehace al cargar el mapa)
      MAPS.comisaria.lockerAt = lk;
      P('taquilla_pol', lk.x, lk.z, lk.fx, lk.fz);
      }
      // ---- fuera: el patio de la entrada, a oscuras ----
      P('patrulla', 14.2, 65.6, 1, 0); P('papelera', 10.2, 62.7, 0, -1); P('hidrante', 4.2, 63.2, 0, -1);
      if (clean) { P('patrulla', 22.0, 65.6, 1, 0); P('patrulla', 30.0, 65.8, -1, 0); P('coche', 40.0, 66.0, 1, 0); }
      weed(11.6, 67.0, 2.4, 1.6); rubble(6.6, 64.6, 1.4, 1.0); pud(9.0, 66.4, 2.0, 1.2);
      if (clean) stationClean(M, P);
      // la salida (para huir al final): un tramo de la valla de alambre derribado, la malla tirada hacia fuera
      // (por ahí entraron los Escorpiones, siguiéndote). En 2020, la valla entera
      if (!clean) {
        M.put('malla_caida', 4.4, 68.55, 0, 1, { x0: 2.7, x1: 6.1, z0: 67.9, z1: 69.2 });
        M.edge('N', 3, 68, W.E.NONE); M.edge('N', 4, 68, W.E.NONE); M.edge('N', 5, 68, W.E.NONE);
      }
  }

  MAPS.comisaria = {
    name: 'Estación de policía', boss: true, min: 0, max: 68, spawn: { x: 17, z: 19.5 }, seed: 4141, fence: 'chain',
    // la entrada (para la cinemática del final variante): la puerta de las oficinas al patio de fuera, al sur. Se
    // llega desde fuera, se entra y la puerta queda atrancada (ver G.Station)
    entry: { door: { o: 'N', x: 8, z: 62, lv: 0 }, from: { x: 8.5, z: 65.8 }, to: { x: 8.5, z: 59.4 } },
    // el casillero de armas de la policía: escondido en uno de estos rincones (al azar en cada partida)
    lockers: [{ x: 31.6, z: 12.3, fx: -1, fz: 0, hint: 'el despacho del comisario' }, { x: 59.6, z: 10.6, fx: -1, fz: 0, hint: 'el garaje de las patrullas' },
      { x: 29.7, z: 61.6, fx: 0, fz: -1, hint: 'el fondo del depósito de pruebas' }],
    // la huida del final: por la valla derribada del patio (ver G.Station)
    exit: { x: 4.5, z: 67.0 },
    // la armería atrancada (x 24-32, z 17-25): dentro, dos temblantes; su puerta, en la pared oeste (x 24)
    armory: { x0: 24, x1: 32, z0: 17, z1: 25, temb: [{ x: 27.2, z: 18.4 }, { x: 27.4, z: 23.6 }] },
    // la sala del jefe es otra cosa aquí: sin hongomorfo (solo se le oye golpear la pared de los calabozos)
    interior: true, noBoss: true, station: true, fresh: true,
    phantoms: 2,                           // observadores pasivos (se asoman, chasquean y huyen: ver G.Phantoms)
    board: { x: 10.15, z: 9.0, fx: 1, fz: 0 },
    // niebla negra: se ve a unos 12 m y lo de detrás ni se dibuja (mejor para el móvil y para el miedo)
    mood: { sky: 0x010101, fog: 0.5, hemi: [0x56645f, 0x0c0e0d, 0.24], sun: [0x9fb4c0, 0.02] }, blackFog: [2.5, 13],
    arena: { hall: { x0: 10, z0: 7, x1: 24, z1: 23 }, lair: { x: 17, z: 4 }, breach: { z: 7, x0: 15, x1: 19 }, nemi: { x: 5, z: 4 } },
    // cadáveres de corredores: [x, z, giro, de espaldas (1) o boca abajo (-1)] (los pone G.Maps.decor)
    corpses: [[12.6, 16.8, 0.6, 1], [21.0, 13.0, 2.4, -1], [2.6, 21.6, 1.4, 1], [15.5, 29.2, -0.9, -1], [28.5, 21.0, 3.0, 1], [27.0, 29.5, -2.2, -1],
      [26.5, 12.8, 0.2, 1], [8.0, 3.6, 1.9, -1], [34.0, 18.5, 0.3, 1], [44.5, 10.8, 2.0, -1], [42.5, 21.0, -0.6, 1], [55.0, 28.0, 1.1, -1],
      [6.0, 38.5, 2.8, 1], [17.0, 40.0, -1.4, -1], [10.0, 55.0, 0.9, 1], [28.0, 46.0, 1.6, -1], [39.0, 40.5, -2.4, 1], [52.0, 42.0, 0.4, -1],
      [38.0, 57.0, 2.2, 1], [55.5, 55.5, -1.0, -1]],
    // el agujero del techo (luz de luna), la luz de emergencia y los fluorescentes que quedan: [x, z, color, fuerza, roto]
    hole: { x: 17, z: 14 }, alarm: { x: 17, z: 27.5 },
    tubes: [[13.5, 10.5, 0xcfe8d8, 1.25, true], [42.5, 22.0, 0xd8e0c8, 0.9, true], [12.0, 52.0, 0xd0e8dc, 0.9, false], [48.0, 9.0, 0xc8dcd0, 0.8, true]],
    // grafitis: [texto ('|' = otra línea), x, z, pared (n/s/w/e: la cara que se ve; n = pared al norte), alto, ancho, color]
    graffiti: [
      ['NO HAY|RETORNO', 17, 7, 'n', 2.1, 2.6, '#b8261e'], ['OCEANSIDE|MURIÓ', 24, 16.2, 'e', 1.9, 2.4, '#5aa0c8'], ['NO ABRIR|DENTRO HAY|MUERTOS', 24, 22.0, 'e', 1.6, 1.4, '#e8e4d8'],
      ['AYUDA', 6.5, 7, 'n', 1.6, 1.4, '#c8c2b0'], ['IIII IIII IIII II', 1, 30.0, 'w', 1.3, 1.6, '#d8d2c4'], ['¿DÓNDE ESTÁN|LOS POLIS?', 24, 25.2, 'e', 2.0, 2.2, '#e0b030'],
      ['ESCORPIONES', 36, 16.0, 'e', 1.6, 2.4, '#d8d2c4'], ['EL HONGO|LO OYE TODO', 50, 1, 'n', 1.9, 2.4, '#7ad89a'], ['MAMÁ TE QUIERO', 60, 29.5, 'e', 1.4, 2.0, '#d86a9a'],
      ['→ SALIDA ✗', 11, 42.0, 'w', 1.5, 1.6, '#b8261e'], ['ACAB', 12, 62, 's', 1.5, 1.4, '#3a3a3a'], ['NOS DEJARON|AQUÍ', 46, 62, 's', 2.0, 2.4, '#cfcfcf'],
      ['R.I.P.', 60, 38.5, 'e', 1.4, 1.0, '#cfcfcf']
    ],
    damp: [[17, 20, 1.4], [5, 25, 1.6], [20, 10, 1.0], [34, 11, 1.2], [43, 28, 1.4], [17, 37, 1.2], [8, 58, 1.4], [28, 50, 1.2], [53, 50, 1.6]],
    build(M, rng) { stationBuild(M, false); }
  };

  // Modo historia · prólogo: la misma estación el 6 de octubre de 2020 (Seattle), el primer día. Limpia, en uso, con
  // la luz encendida; todavía sin nadie. Javier empieza en su despacho (el del comisario: x 24-32, z 7-17), con su
  // nombre en las puertas. hidden: no sale en ninguna lista de mapas (ni en Retorno ni en el modo libre)
  MAPS.comisaria_2020 = {
    name: 'Estación de policía', hidden: true, story: true, min: 0, max: 68, spawn: { x: 27.6, z: 13.0 }, seed: 2020, fence: 'chain',
    hour: 22.4, hourFixed: true, litInside: true,     // (litInside: dentro, con la luz encendida, se ve iluminado)           // (siempre de noche, nublado: ver sky.js; dentro, la luz funciona)
    skyline: { col: 0x8a9298, h: [10, 30], towers: [1.9, 3.6] },     // (Seattle: edificios altos a lo lejos)
    mood: { sky: 0x9aa2a8, fog: 1.1, hemi: [0xc8d0d6, 0x4a4840, 0.78], sun: [0xe6ecf0, 0.55] },
    // los carteles de las puertas: el despacho de Javier y la oficina del jefe (la armería de la estación abandonada)
    offices: [{ x0: 24, x1: 32, z0: 7, z1: 17, name: 'JAVIER G.', title: 'SHERIFF' }, { x0: 24, x1: 32, z0: 17, z1: 25, name: 'R. WEBB', title: 'JEFE' }],
    build(M, rng) { stationBuild(M, true); }
  };

  // Modo historia · prólogo: un mapa vacío (mientras se conduce: la calle es una escena aparte, G.Road; la estación
  // se descarga entera)
  MAPS.vacio = {
    name: 'Calle', hidden: true, story: true, min: 0, max: 12, spawn: { x: 6, z: 6 }, seed: 1, fence: 'none',
    hour: 22.6, hourFixed: true, mood: { sky: 0x05070a, fog: 0.5, hemi: [0x46506a, 0x0c0b0a, 0.5], sun: [0x8494b8, 0.2] },
    build(M) { M.ground(0, 0, 12, 12, G.World.F.ROAD); }
  };

  // Modo historia · prólogo: el cruce del choque y la huida a pie hasta el depósito municipal de vehículos (Seattle, la
  // noche del 6 de octubre de 2020, sin luz en la ciudad). El cruce: la avenida (norte-sur, x 23-33) y la transversal
  // (este-oeste, z 23-33), con el patrullero volcado en medio y la camioneta que lo embistió empotrada contra la esquina
  // noreste (sus luces y el fuego los pone G.Story). La huida (G.Huida): por la transversal hacia el este, una calle
  // que tuerce hacia el norte (cortada por un camión), un callejón, una plaza con su parque, la avenida del norte (un
  // control policial abandonado y un atasco) y la explanada del depósito: la nave con los coches requisados, la garita
  // del vigilante y, detrás, el patio con la reja de salida. Todo sale de los pasillos por donde se anda
  // (HUIDA.corr): fuera de ellos, bloques de pisos a oscuras (fachadas que no se atraviesan) y, en los huecos, muros.
  // Los locales con escaparate son edificios de verdad, con su sala: de ahí salen infectados
  const HUIDA = {
    N: 160,
    // pasillos: r [x0, z0, x1, z1] con la calzada (road: eje y franja) o p (trazado) con media calzada rw y media acera ww
    corr: [
      { r: [20, 0, 36, 56], road: ['x', 23, 33] },                      // la avenida del choque (norte-sur)
      { r: [0, 20, 20, 36], road: ['z', 23, 33] },                      // la transversal, al oeste (cortada)
      { r: [36, 20, 70, 36], road: ['z', 23, 33] },                     // la transversal, al este: por donde se huye
      { p: [[64, 28], [76, 29.5], [84, 34], [89.5, 41.5], [92.5, 50], [93.5, 60], [93.5, 81]], rw: 4.6, ww: 7.2 },   // la calle que tuerce
      { p: [[92, 66], [100, 66], [106, 66.5], [111, 69.5], [115.5, 74.5]], rw: 0, ww: 2.4, g: 'alley' },             // el callejón
      { r: [112, 72, 136, 97], g: 'plaza' },
      { r: [115, 96, 131, 128], road: ['x', 118, 128] },                // la avenida del norte
      { r: [102, 128, 131, 136], g: 'conc' },                           // la explanada del depósito
      { r: [110, 154, 124, 159], g: 'conc' },                           // el patio de atrás (los de la reja)
      // calles sin salida (de ahí también salen)
      { r: [49, 36, 55, 50], road: ['x', 50, 54] }, { r: [59, 6, 64, 20], road: ['x', 60, 63] },
      { r: [131, 103, 146, 108], road: ['z', 104, 107] }, { r: [101, 112, 115, 117], road: ['z', 113, 116] },
      { r: [136, 83, 150, 88], road: ['z', 84, 87] }
    ],
    park: [118, 79, 130, 90],
    // locales: [plantilla, ox, oz, ancho, fondo (ya girados), frente]
    shops: [['local_a', 38, 14, 8, 6, 'S'], ['local_b', 50, 15, 6, 5, 'S'], ['local_a', 38, 36, 8, 6, 'N'], ['local_b', 57, 36, 6, 5, 'N'],
      ['local_a', 109, 98, 6, 8, 'E'], ['local_a', 109, 119, 6, 8, 'E'], ['local_a', 131, 110, 6, 8, 'W'], ['local_a', 106, 76, 6, 8, 'E'], ['local_a', 136, 74, 6, 8, 'W']],
    // el depósito: la nave (x 109-126), la garita del vigilante (x 104-109, z 136-142) y el trastero; la puerta de la
    // explanada y la salida de atrás (la reja, x 114-120)
    depot: { ox: 104, oz: 136, w: 22, h: 18, door: { x: 116, z: 136 }, exit: [114, 120], hall: { x0: 109, x1: 126, z0: 136, z1: 154 },
      guard: { x0: 104, x1: 109, z0: 136, z1: 142 }, car: { x: 117.0, z: 148.8 }, crate: { x: 113.4, z: 139.0 } },
    // el camino de Alem (de punto a punto en línea recta y libre)
    route: [[30, 30.5], [40, 31], [55, 30.5], [65, 29.6], [75.5, 30.4], [83.5, 34.6], [89, 42], [92.2, 50.5], [93.3, 60], [93.5, 66],
      [100, 66], [106, 66.6], [111, 69.6], [115.3, 74.4], [116.5, 80], [116.5, 91], [120, 96.5], [121, 104], [121, 117], [119.5, 125.5], [116.5, 131]],
    // de dónde salen los corredores (dentro de los locales, al fondo de las calles sin salida, detrás de lo que tapa)
    spawns: [[42, 16.5], [53, 17.2], [42, 39.5], [60, 38.2], [52, 48.4], [61.5, 7.5], [5, 30], [28, 5], [28, 51],
      [72, 22.5], [80, 40.5], [93.5, 85], [86, 58], [98.5, 68.2],
      [108.5, 80], [139, 78], [148.5, 85.5], [113.5, 95.5], [134.5, 95.5], [130, 73.5],
      [112, 102], [112, 123], [134, 114], [144.5, 105.5], [102.5, 114.5], [128.8, 126.5]],
    // incendios (coches que arden): [x, y, z, grande]
    fires: [[58.5, 1.1, 25.2, 0], [88.2, 1.0, 36.2, 0], [93.5, 1.6, 77.6, 1], [131.0, 1.4, 92.5, 1], [125.6, 1.0, 118.2, 0], [74, 1.0, 34.6, 0]]
  };

  // El plano: qué casillas se pisan (mask), su suelo, los edificios, las fachadas y los muros de los huecos
  let huidaP = null;
  function huidaPlan() {
    if (huidaP) return huidaP;
    const H = HUIDA, N = H.N, F = G.World.F;
    const mask = new Uint8Array(N * N), gnd = new Uint8Array(N * N), bld = new Uint8Array(N * N), fm = new Uint8Array(N * N);
    const PRI = {}; PRI[F.ROAD] = 3; PRI[F.SIDEWALK] = 2; PRI[F.CONCRETE] = 1; PRI[F.GRASS] = 2;
    const setT = (x, z, g) => {
      if (x < 0 || z < 0 || x >= N || z >= N) return;
      const i = z * N + x; mask[i] = 1;
      if (!gnd[i] || PRI[g] > PRI[gnd[i] - 1]) gnd[i] = g + 1;
    };
    const segD = (px, pz, a, b) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      const t = l2 ? U.clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / l2, 0, 1) : 0;
      return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
    };
    for (const c of H.corr) {
      if (c.r) {
        const [x0, z0, x1, z1] = c.r;
        for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
          let g = c.g === 'conc' ? F.CONCRETE : F.SIDEWALK;
          if (c.road) { const v = c.road[0] === 'x' ? x : z; if (v >= c.road[1] && v < c.road[2]) g = F.ROAD; }
          setT(x, z, g);
        }
      } else {
        const P = c.p;
        let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
        for (const q of P) { bx0 = Math.min(bx0, q[0]); bz0 = Math.min(bz0, q[1]); bx1 = Math.max(bx1, q[0]); bz1 = Math.max(bz1, q[1]); }
        for (let z = Math.floor(bz0 - c.ww - 1); z <= Math.ceil(bz1 + c.ww + 1); z++) {
          for (let x = Math.floor(bx0 - c.ww - 1); x <= Math.ceil(bx1 + c.ww + 1); x++) {
            let d = 1e9;
            for (let i = 0; i < P.length - 1; i++) d = Math.min(d, segD(x + 0.5, z + 0.5, P[i], P[i + 1]));
            if (d > c.ww) continue;
            setT(x, z, c.g === 'alley' ? F.ROAD : (d <= c.rw ? F.ROAD : F.SIDEWALK));
          }
        }
      }
    }
    { const [x0, z0, x1, z1] = H.park; for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (mask[z * N + x]) gnd[z * N + x] = F.GRASS + 1; }
    // los edificios (locales y depósito): sus casillas no son de la calle
    const markB = (x0, z0, w, h) => { for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) { bld[z * N + x] = 1; mask[z * N + x] = 0; gnd[z * N + x] = 0; } };
    for (const s of H.shops) markB(s[1], s[2], s[3], s[4]);
    markB(H.depot.ox, H.depot.oz, H.depot.w, H.depot.h);
    // distancia (en casillas) a lo que se pisa
    const dist = new Uint8Array(N * N).fill(255), q = new Int32Array(N * N);
    let qa = 0, qb = 0;
    for (let i = 0; i < N * N; i++) if (mask[i]) { dist[i] = 0; q[qb++] = i; }
    while (qa < qb) {
      const i = q[qa++], x = i % N, z = (i / N) | 0, d = dist[i];
      if (d >= 16) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (dist[j] > d + 1) { dist[j] = d + 1; q[qb++] = j; }
      }
    }
    // las fachadas: celdas de 4 x 4 cerca de la calle (recortadas si pisan la calle o un edificio), juntas en
    // bloques de hasta 16 m a lo largo de su frente; la altura y el estilo, por manzana
    const free = (x, z) => x >= 0 && z >= 0 && x < N && z < N && !mask[z * N + x] && !bld[z * N + x];
    const cells = [];
    for (let cz = 0; cz < N; cz += 4) for (let cx = 0; cx < N; cx += 4) {
      let near = false, full = true;
      for (let z = cz; z < cz + 4; z++) for (let x = cx; x < cx + 4; x++) { if (!free(x, z)) full = false; else if (dist[z * N + x] <= 12) near = true; }
      if (!near) continue;
      let x0 = cx, x1 = cx + 4, z0 = cz, z1 = cz + 4;
      const bad = (ax0, az0, ax1, az1) => { let n = 0; for (let z = az0; z < az1; z++) for (let x = ax0; x < ax1; x++) if (!free(x, z)) n++; return n; };
      if (!full) {
        for (let it = 0; it < 8 && bad(x0, z0, x1, z1); it++) {
          const s = [bad(x0, z0, x0 + 1, z1), bad(x1 - 1, z0, x1, z1), bad(x0, z0, x1, z0 + 1), bad(x0, z1 - 1, x1, z1)];
          const k = s.indexOf(Math.max(s[0], s[1], s[2], s[3]));
          if (k === 0) x0++; else if (k === 1) x1--; else if (k === 2) z0++; else z1--;
          if (x1 - x0 < 2 || z1 - z0 < 2) break;
        }
        if (x1 - x0 < 2 || z1 - z0 < 2 || bad(x0, z0, x1, z1)) continue;
      }
      let dmin = 255;
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) dmin = Math.min(dmin, dist[z * N + x]);
      cells.push({ x0, z0, x1, z1, full, dmin, used: false });
    }
    // hacia dónde mira (la calle más cercana desde el centro de cada lado)
    const dirTo = (c) => {
      const cxm = Math.floor((c.x0 + c.x1) / 2), czm = Math.floor((c.z0 + c.z1) / 2);
      let best = [0, 1], bd = 99;
      for (const [fx, fz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        for (let d = 0; d < 18; d++) {
          const sx = fx > 0 ? c.x1 + d : fx < 0 ? c.x0 - 1 - d : cxm, sz = fz > 0 ? c.z1 + d : fz < 0 ? c.z0 - 1 - d : czm;
          if (sx < 0 || sz < 0 || sx >= N || sz >= N) break;
          if (bld[sz * N + sx]) break;
          if (mask[sz * N + sx]) { if (d < bd) { bd = d; best = [fx, fz]; } break; }
        }
      }
      return best;
    };
    for (const c of cells) c.dir = dirTo(c);
    const byKey = new Map();
    for (const c of cells) byKey.set(c.x0 + ',' + c.z0, c);
    const facs = [];
    const blockR = (x, z) => U.mulberry32(((x / 12) | 0) * 7919 + ((z / 12) | 0) * 131 + 5)();
    for (const c of cells) {
      if (c.used) continue;
      c.used = true;
      let r = { x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1 };
      // (las enteras se juntan con sus vecinas del mismo frente, sin pasar de un trozo del mundo)
      if (c.full) {
        const alongX = c.dir[1] !== 0;
        for (let k = 1; k < 4; k++) {
          const nx = alongX ? c.x0 + 4 * k : c.x0, nz = alongX ? c.z0 : c.z0 + 4 * k;
          const n = byKey.get(nx + ',' + nz);
          if (!n || n.used || !n.full || n.dir[0] !== c.dir[0] || n.dir[1] !== c.dir[1]) break;
          if (Math.floor(nx / 32) !== Math.floor(c.x0 / 32) || Math.floor(nz / 32) !== Math.floor(c.z0 / 32)) break;
          n.used = true;
          if (alongX) r.x1 = n.x1; else r.z1 = n.z1;
        }
      }
      const br = blockR(r.x0, r.z0), area = (r.x1 - r.x0) * (r.z1 - r.z0);
      const h = area < 12 ? 3.6 + Math.floor(br * 3) : 7 + Math.floor(br * 4) * 3 + (c.dmin >= 5 ? 3 : 0);
      facs.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, fx: c.dir[0], fz: c.dir[1], h, style: Math.floor(blockR(r.x0 + 40, r.z0 + 40) * 3) });
      for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) fm[z * N + x] = 1;
    }
    // los muros: entre lo que se pisa y lo que no (si ahí no hay una fachada ni un edificio)
    const walls = [];
    const out = (x, z) => x >= 0 && z >= 0 && x < N && z < N && !mask[z * N + x] && !bld[z * N + x] && !fm[z * N + x];
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      if (!mask[z * N + x]) continue;
      if (out(x, z - 1)) walls.push(['N', x, z]);
      if (out(x, z + 1)) walls.push(['N', x, z + 1]);
      if (out(x - 1, z)) walls.push(['W', x, z]);
      if (out(x + 1, z)) walls.push(['W', x + 1, z]);
    }
    // el suelo, por tramos de fila
    const grounds = [];
    for (let z = 0; z < N; z++) {
      let x = 0;
      while (x < N) {
        const g = gnd[z * N + x];
        let e = x + 1;
        while (e < N && gnd[z * N + e] === g) e++;
        if (g) grounds.push([x, z, e, z + 1, g - 1]);
        x = e;
      }
    }
    huidaP = { mask, bld, facs, walls, grounds, N, walk: (x, z) => x >= 0 && z >= 0 && x < N && z < N && !!mask[Math.floor(z) * N + Math.floor(x)] };
    return huidaP;
  }
  // los locales: el escaparate roto (de ahí saltan) y sin luz
  function shopPost(front) {
    return (c, b, li, E) => {
      for (const r of b.rooms) r.on = false;
      const W = b.w, H = b.h;
      if (front === 'S' || front === 'N') {
        const z = front === 'S' ? b.z0 + H : b.z0;
        for (let x = b.x0; x < b.x0 + W; x++) { const i = li(x, z); if (c.eN[i] === E.WIN || c.eN[i] === E.WIN_OPEN) c.eN[i] = E.WIN_BROKEN; }
      } else {
        const x = front === 'E' ? b.x0 + W : b.x0;
        for (let z = b.z0; z < b.z0 + H; z++) { const i = li(x, z); if (c.eW[i] === E.WIN || c.eW[i] === E.WIN_OPEN) c.eW[i] = E.WIN_BROKEN; }
      }
    };
  }
  // el depósito: la puerta de la explanada (abierta: G.Huida la cierra), la salida de atrás (los huecos de la reja),
  // las puertas de la garita y del trastero, y todo a oscuras
  function depotPost(c, b, li, E) {
    const D = HUIDA.depot;
    for (const r of b.rooms) r.on = false;
    for (let x = b.x0; x < b.x0 + b.w; x++) { c.eN[li(x, b.z0)] = E.WALL; c.eN[li(x, b.z0 + b.h)] = E.WALL; }
    c.eN[li(D.door.x, D.door.z)] = E.DOOR_OPEN;
    for (let x = D.exit[0]; x < D.exit[1]; x++) c.eN[li(x, b.z0 + b.h)] = E.ARCH;
    const hx = D.hall.x0;
    for (let z = b.z0; z < b.z0 + b.h; z++) c.eW[li(hx, z)] = E.WALL;
    c.eW[li(hx, 139)] = E.ARCH; c.eW[li(hx, 147)] = E.ARCH;
    for (let x = D.guard.x0; x < D.guard.x1; x++) c.eN[li(x, D.guard.z1)] = E.WALL;
  }
  function huidaBuild(M) {
    const F = G.World.F, E = G.World.E, P = huidaPlan(), H = HUIDA;
    M.ground(0, 0, H.N, H.N, F.CONCRETE);
    for (const g of P.grounds) M.ground(g[0], g[1], g[2], g[3], g[4]);
    for (const [o, x, z] of P.walls) M.edge(o, x, z, E.WALL);
    for (const s of H.shops) M.building(s[0], s[1], s[2], s[3], s[4], s[5], shopPost(s[5]));
    M.building('deposito_v', H.depot.ox, H.depot.oz, H.depot.w, H.depot.h, 'N', depotPost);
    // (los árboles, antes que las fachadas: si no, no se ponen tan cerca de ellas)
    for (const [x, z] of [[22, 6], [22, 44], [33, 14], [33, 50], [8, 33], [44, 21]]) M.tree(x, z, false);
    for (const [x, z] of [[119, 80], [129, 80], [119, 89], [129, 89], [124, 79], [124, 89]]) M.tree(x, z, false);
    for (const f of P.facs) M.put('fachada', (f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2, f.fx, f.fz, { x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1, h: f.h, style: f.style, clean: true, dark: true, keep: true, solid: true });
    const put = (t, x, z, fx, fz, ex) => M.put(t, x, z, fx, fz, Object.assign({ keep: true }, ex || {}));
    const car = (x, z, fx, fz, col, t) => put(t || 'coche', x, z, fx, fz, col != null ? { col } : null);
    // ---- el cruce del choque ----
    for (const [x, z, w, d] of [[28, 21.4, 9, 2.4], [28, 34.6, 9, 2.4], [21.4, 28, 2.4, 9], [34.6, 28, 2.4, 9]]) {
      const al = w > d; M.put('paso_cebra', x, z, al ? 1 : 0, al ? 0 : 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, keep: true });
    }
    M.put('patrulla_volcada', 27.0, 29.6, 0.98, 0.2, { solid: false, keep: true });
    put('camioneta_chocada', 34.4, 23.6, -0.85, -0.53);
    put('cristales', 29.0, 28.0, 1, 0, { x0: 26.0, x1: 32.0, z0: 26.0, z1: 30.0 });
    put('cristales', 24.4, 31.4, 1, 0, { x0: 23.0, x1: 26.0, z0: 30.6, z1: 32.4 });
    put('cristales', 33.0, 25.0, 1, 0, { x0: 31.4, x1: 34.6, z0: 24.0, z1: 26.4 });
    for (const [x, z, fx, fz] of [[21.6, 21.6, 0, 1], [34.4, 34.4, 0, -1], [21.6, 34.4, 1, 0], [34.4, 21.6, -1, 0]]) put('semaforo', x, z, fx, fz);
    for (const [x, z] of [[21.5, 12.0], [34.5, 44.0], [10.0, 21.5], [46.0, 34.5]]) put('hidrante', x, z, 0, 1);
    for (const [x, z] of [[21.6, 17.0], [34.4, 40.0], [14.0, 34.4]]) put('papelera', x, z, 0, 1);
    put('parada', 35.2, 46.0, -1, 0); put('buzon', 21.5, 40.0, 1, 0);
    car(24.3, 8.0, 0, 1, 0x5a6a7a); car(24.3, 14.5, 0, 1, 0x8a3a32); car(31.6, 10.5, 0, -1, 0x3a4a3a, 'camioneta'); car(31.7, 44.0, 0, -1, 0xb8b0a0);
    car(24.3, 47.5, 0, 1, 0x2e3e5a); car(9.0, 24.3, 1, 0, 0x6a5a3a); car(26.0, 51.0, 0.6, 0.8, 0x9a9a92);
    for (const x of [24.5, 27.0, 29.5, 32.0]) { put('barrera', x, 2.2, 0, 1); put('barrera', x, 53.8, 0, -1); }
    put('camion', 4.5, 28.0, 0, 1);
    // ---- la transversal, al este ----
    car(45.5, 32.3, -1, 0, 0x3a3a3a); car(52.0, 24.4, 1, 0, 0x4a5a6a); car(58.5, 25.2, 0.92, 0.38, 0x7a7a72);
    car(63.6, 32.2, -1, 0, 0x2a4a3a, 'camioneta'); car(38.2, 24.3, 1, 0, 0x5a2a2a);
    put('banco_parque', 47.5, 21.0, 0, 1); put('papelera', 56.0, 34.6, 0, -1); put('hidrante', 62.0, 21.4, 0, 1);
    put('parada', 66.0, 34.8, 0, -1); put('cubos', 51.0, 49.0, 0, -1); put('barricada', 52.0, 49.3, 0, -1);
    put('barrera', 61.5, 6.5, 0, 1); put('cubos', 63.0, 8.0, -1, 0);
    // ---- la calle que tuerce ----
    car(74.0, 34.6, -0.95, 0.3, 0x6a5a3a); car(88.2, 36.2, 0.55, 0.83, 0x9a3a2a); car(79.5, 25.6, 1, 0.1, 0x3a4a5a);
    car(96.8, 47.0, 0.1, 1, 0x2e3e5a); car(89.6, 55.5, 0, 1, 0x8a8a82, 'camioneta');
    put('camion', 93.5, 77.6, 1, 0.05, { col: 0x5a5a52 });
    put('cubos', 84.6, 27.2, 1, 0); put('papelera', 96.4, 52.0, -1, 0); put('hidrante', 90.0, 33.4, 0, 1);
    // ---- el callejón ----
    put('cubos', 97.5, 64.2, 0, 1); put('cubos', 108.4, 66.0, 0.5, -0.86); put('palets', 103.0, 68.0, 0, -1); put('bidones', 113.6, 69.8, -0.7, 0.7);
    // ---- la plaza ----
    put('fuente', 124.0, 84.5, 0, 1);
    for (const [x, z, fx, fz] of [[120.0, 80.6, 0, 1], [128.0, 80.6, 0, 1], [120.0, 88.6, 0, -1], [128.0, 88.6, 0, -1]]) put('banco_parque', x, z, fx, fz);
    put('kiosco', 133.0, 76.0, -1, 0); put('camion', 131.0, 92.5, 0.94, 0.34, { col: 0x3a5a7a });
    car(127.0, 74.6, 1, 0, 0x7a2a2a); car(113.8, 85.5, 0, 1, 0x9a9a92);
    // ---- la avenida del norte: el control policial abandonado y el atasco ----
    put('patrulla', 125.0, 111.8, 1, 0.15); put('patrulla', 116.6, 113.2, -1, 0.2);
    for (const x of [127.6, 129.6]) put('barrera', x, 112.4, 0, -1);
    car(125.6, 118.2, 0, 1, 0x5a6a7a); car(126.2, 123.4, -0.2, 0.98, 0x8a8a82, 'camioneta'); car(123.8, 126.6, 0.3, 0.95, 0x6a2a2a);
    car(116.8, 101.0, 0, -1, 0x3a3a3a); car(129.6, 99.5, 0, 1, 0x4a5a3a);
    put('hidrante', 116.0, 109.0, 0, 1); put('papelera', 130.0, 106.0, -1, 0);
    // ---- la explanada del depósito ----
    car(105.5, 131.6, 1, 0, 0x2a3a4a); car(128.2, 131.0, 0, -1, 0x7a7a72); put('barrera', 110.0, 133.5, 1, 0); put('cubos', 124.0, 134.6, 0, -1);
    // ---- dentro del depósito: los coches requisados, estanterías, neumáticos, bidones ----
    const D = H.depot;
    car(D.car.x, D.car.z, 0, 1, 0x2c3e34); car(112.2, 147.5, 0, 1, 0x5a5a52, 'camioneta'); car(122.2, 147.8, 0, -1, 0x6a2a2a); car(121.8, 141.2, -1, 0, 0x9a9a92);
    for (const z of [137.6, 139.6, 143.4, 145.4, 150.6]) put('estanteria', 125.62, z, -1, 0);
    put('neumaticos', 124.8, 152.6, -1, 0); put('bidones', 111.0, 152.9, 0, -1); put('palets', 110.4, 140.6, 1, 0); put('cajas', 110.3, 143.4, 1, 0);
    put('caja_herr', 125.2, 147.6, -1, 0); put('montacargas', 111.4, 150.4, 0, -1);
    // la reja de la salida (del patio no se pasa) y el portón subido
    for (const x of [115, 117, 119]) M.put('reja', x, 154.3, 0, -1, { x0: x - 1, x1: x + 1, z0: 154.24, z1: 154.36, keep: true });
    M.put('porton', 117, 154.05, 0, -1, { x0: 114, x1: 120, z0: 153.9, z1: 154.2, keep: true });
    // la garita del vigilante
    put('escritorio', 106.4, 137.0, 0, 1); put('silla', 106.4, 137.95, 0, -1);
    put('archivador', 104.35, 139.4, 1, 0); put('taquilla', 104.3, 141.2, 1, 0); put('taquilla', 105.4, 141.72, 0, -1);
    M.put('radio', 106.95, 137.0, 0, 1, { y: 0.76, keep: true }); M.put('papeles', 106.0, 137.0, 0, 1, { y: 0.77, x0: 105.8, x1: 106.3, z0: 136.8, z1: 137.2, keep: true });
    M.put('vaso', 105.95, 137.18, 0, 1, { y: 0.76, keep: true }); M.put('carpetas', 104.35, 139.4, 1, 0, { y: 1.3, keep: true });
  }
  MAPS.cruce_2020 = {
    name: 'Cruce', hidden: true, story: true, min: 0, max: 160, spawn: { x: 25.0, z: 33.0 }, seed: 2021, fence: 'chain',
    hour: 22.9, hourFixed: true, wallCol: 0x4a4440,
    mood: { sky: 0x05070a, fog: 0.55, hemi: [0x3e4862, 0x0a0a0a, 0.42], sun: [0x8494b8, 0.16] },
    // el patrullero volcado (para G.Story: dónde está y hacia dónde mira)
    wreck: { x: 27.0, z: 29.6, fx: 0.98, fz: 0.2 },
    huida: HUIDA,
    get plan() { return huidaPlan(); },
    build(M) { huidaBuild(M); }
  };

  // ---------- Estación de policía: grafitis, cadáveres y la poca luz que queda ----------
  // grafiti de espray en un lienzo (letras irregulares, con chorretones de pintura)
  function sprayTex(text, col, seed, font) {
    const rnd = U.mulberry32(seed);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const x = cv.getContext('2d');
    x.font = font || '900 84px Impact, Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const lines = text.split('|');
    lines.forEach((ln, i) => {
      const y = 128 + (i - (lines.length - 1) / 2) * 92;
      x.save(); x.translate(256, y); x.rotate((rnd() - 0.5) * 0.12);
      const fw = x.measureText(ln).width; if (fw > 480) x.scale(480 / fw, 1);   // (que quepa entero)
      x.shadowColor = col; x.shadowBlur = 9; x.fillStyle = col; x.globalAlpha = 0.85;
      x.fillText(ln, 0, 0);
      x.restore();
      // chorretones
      x.fillStyle = col; x.globalAlpha = 0.7;
      const w = Math.min(480, x.measureText(ln).width);
      for (let k = 0; k < 5; k++) { const dx = 256 - w / 2 + rnd() * w, len = 12 + rnd() * 40; x.fillRect(dx, y + 26, 2.5 + rnd() * 2, len); }
    });
    const t = new THREE.CanvasTexture(cv);
    return t;
  }
  function stationDecor(scene, id) {
    const m = MAPS[id], W = G.World;
    decoG = new THREE.Group();
    const H = 3.6, IN = W.WALL_T / 2 + 0.02;
    const plane = (w, h, mat, x, y, z, ry, rx) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); q.position.set(x, y, z); q.rotation.set(rx || 0, ry || 0, 0, 'YXZ'); decoG.add(q); return q; };
    const tube = (x, y, z, w, h, d, mat) => { const q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); q.position.set(x, y, z); decoG.add(q); return q; };
    // grafitis: [texto ('|' = otra línea), x, z, pared (n/s/w/e: la cara que mira hacia dentro), alto, ancho, color]
    const GR = m.graffiti;
    GR.forEach(([t, x, z, f, y, w, col], i) => {
      const mat = new THREE.MeshLambertMaterial({ map: sprayTex(t, col, 77 + i * 13), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const px = x, pz = z;
      if (f === 'n') plane(w, w / 2, mat, px, y, pz + IN, 0);
      else if (f === 's') plane(w, w / 2, mat, px, y, pz - IN, Math.PI);
      else if (f === 'w') plane(w, w / 2, mat, px + IN, y, pz, Math.PI / 2);
      else plane(w, w / 2, mat, px - IN, y, pz, -Math.PI / 2);
    });
    // manchas de humedad en el techo y goteras sobre los charcos (no se ven, pero el techo oscuro sí)
    const damp = new THREE.MeshBasicMaterial({ color: 0x0c0d0b, transparent: true, opacity: 0.55, depthWrite: false });
    for (const [x, z, r] of m.damp) plane(r * 2, r * 1.5, damp, x, H - 0.02, z, 0, Math.PI / 2);
    // el agujero del techo: un parche negro-azulado (el cielo de noche), un haz de luna y su luz
    const hx = m.hole.x, hz = m.hole.z;
    const holeM = new THREE.MeshBasicMaterial({ color: 0x14202c }); holeM.toneMapped = false;
    plane(2.2, 1.7, holeM, hx, H - 0.015, hz, 0, Math.PI / 2);
    const beamM = new THREE.MeshBasicMaterial({ color: 0x9fc0e0, transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); beamM.toneMapped = false;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.5, H, 18, 1, true), beamM);
    beam.position.set(hx, H / 2, hz); decoG.add(beam);
    const moon = new THREE.PointLight(0x9fb8d4, 1.7, 9, 1.4); moon.position.set(hx, H - 0.4, hz); scene.add(moon); decoLights.push(moon);
    // fluorescentes: los que quedan, colgando torcidos; uno de la sala parpadea roto
    const tubes = m.tubes;
    tubes.forEach(([x, z, hex, I, broken], i) => {
      const tm = new THREE.MeshBasicMaterial({ color: hex }); tm.toneMapped = false;
      const t = tube(x, H - 0.28, z, 1.2, 0.05, 0.08, tm); t.rotation.z = i === 0 ? 0.18 : -0.06;
      tube(x - 0.5, H - 0.14, z, 0.01, 0.28, 0.01, new THREE.MeshBasicMaterial({ color: 0x222222 }));
      const l = new THREE.PointLight(hex, I, 11, 1.6); l.position.set(x, H - 0.45, z); scene.add(l); decoLights.push(l);
      const fl = { m: tm, base: new THREE.Color(hex), k: 0.85, sp: 3 + i, ph: i * 2.1, broken };
      decoFlick.push(fl);
      decoAnim.push((tt) => {
        let v = 1;
        if (broken) { const n = Math.sin(tt * 23 + fl.ph) * Math.sin(tt * 7.3 + fl.ph * 2); if (n > 0.55) v = 0.1; else if (n > 0.4) v = 0.5; }
        l.intensity = I * v;
      });
    });
    // luz de emergencia roja (recepción): gira despacio, la única que sigue con batería
    const ax = m.alarm.x, az = m.alarm.z;
    const em = new THREE.MeshBasicMaterial({ color: 0xff2a1a }); em.toneMapped = false;
    tube(ax, H - 0.12, az, 0.22, 0.12, 0.22, em);
    const red = new THREE.PointLight(0xff2a14, 1.5, 10, 1.5); red.position.set(ax, H - 0.4, az); scene.add(red); decoLights.push(red);
    decoAnim.push((tt) => { const v = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(tt * 1.6)), 2); red.intensity = 1.5 * v; em.color.setRGB(v, 0.16 * v, 0.1 * v); });
    // cadáveres de corredores (los modelos de los infectados, caídos y quietos) sobre su charco de sangre seca
    const blood = new THREE.MeshBasicMaterial({ color: 0x2a0a08, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    m.corpses.forEach(([x, z, ry, dir], i) => {
      const look = G.Zombie && G.Zombie.randomLook ? G.Zombie.randomLook() : {};
      look.seed = 9000 + i * 37; look.runner = true; look.fungus = i % 3 ? 1 : 0; look.facePlate = false; look.drag = false; look.armsUp = 0;
      if (G.CharMesh && G.CharMesh.corr) {
        look.mesh = look.female && G.CharMesh.corrf ? 'corrf' : 'corr';
        const nv = G.MESH_VARS && G.MESH_VARS[look.mesh] ? G.MESH_VARS[look.mesh].length : 0;
        look.meshVar = nv ? i % (nv + 1) : 0;
      }
      let h = null;
      try { h = G.Models.createHumanoid(Object.assign({ zombie: true, blood: U.mulberry32(look.seed) }, look)); } catch (e) { h = null; }
      if (!h || !h.root) return;
      G.Models.poseFall(h, 1, dir);
      h.root.position.set(x, W.groundY ? W.groundY(x, z, 0) : 0, z); h.root.rotation.y = ry;
      h.root.traverse((o) => { if (o.isMesh) { o.userData.shared = true; o.castShadow = true; } });
      decoG.add(h.root);
      const b = plane(1.4 + (i % 3) * 0.3, 1.0, blood, x - Math.sin(ry) * 0.2 * dir, 0.012, z - Math.cos(ry) * 0.2 * dir, ry, -Math.PI / 2);
      b.userData.shared = false;
    });
    scene.add(decoG);
  }

  // ---------- Estación en 2020: el cartel con el nombre en las puertas del despacho ----------
  function plateTex(name, title) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 166;
    const x = cv.getContext('2d');
    x.fillStyle = '#2a241d'; x.fillRect(0, 0, 512, 166);
    x.strokeStyle = '#b89a5a'; x.lineWidth = 8; x.strokeRect(10, 10, 492, 146);
    x.strokeStyle = '#6e5a34'; x.lineWidth = 2; x.strokeRect(22, 22, 468, 122);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#e8d6a6';
    x.font = 'bold 66px Georgia, "Times New Roman", serif'; x.fillText(name, 256, 72);
    x.font = 'bold 26px Arial, sans-serif'; x.fillStyle = '#b89a5a'; x.fillText(title.split('').join(' '), 256, 124);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  function officeDecor(scene, id) {
    const m = MAPS[id], W = G.World, E = W.E;
    decoG = new THREE.Group();
    const IN = W.WALL_T / 2 + 0.012;
    const isDoor = (e) => e === E.DOOR || e === E.DOOR_OPEN || e === E.DOOR_BROKEN;
    for (const O of m.offices || []) {
      const mat = new THREE.MeshLambertMaterial({ map: plateTex(O.name, O.title), polygonOffset: true, polygonOffsetFactor: -2 });
      // sobre cada puerta del despacho, del lado de fuera (pared oeste: la sala; pared este: el pasillo)
      for (const [x, side] of [[O.x0, -1], [O.x1, 1]]) {
        for (let z = O.z0; z < O.z1; z++) {
          if (!isDoor(W.eW(x, z, 0))) continue;
          const q = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.214), mat);
          q.position.set(x + side * IN, (W.DOOR_H || 2.1) + 0.24, z + 0.5); q.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
          decoG.add(q);
        }
      }
    }
    scene.add(decoG);
  }

  // ---------- Luces de neón (mapas cerrados) ----------
  // Pantallas de las máquinas, carteles de arriba, tubos de neón por las paredes y el techo y un cartel con el
  // nombre del local; brillan solos (sin luz de escena) y algunos parpadean (están rotos). Tres luces de
  // colores dan el tono a la sala. Se crean al cargar el mapa y se quitan al cambiar
  let LH = null;            // la linterna del faro (mapas con lighthouse): { beams, lamp, mat, x, z, y, manual }
  let decoG = null; const decoLights = [], decoFlick = [], decoMach = [], decoAnim = [];   // decoMach: lo de cada máquina (para destrozarla)
  const neonMat = (hex, op) => { const m = new THREE.MeshBasicMaterial({ color: hex, transparent: op != null, opacity: op == null ? 1 : op, depthWrite: op == null }); m.toneMapped = false; return m; };
  function signTex(text, col) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const x = cv.getContext('2d');
    x.font = 'italic 900 78px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = col; x.shadowBlur = 26; x.fillStyle = col;
    x.fillText(text, 256, 66); x.shadowBlur = 10; x.fillText(text, 256, 66);
    x.shadowBlur = 0; x.fillStyle = '#fff6fb'; x.globalAlpha = 0.55; x.fillText(text, 256, 66);
    return new THREE.CanvasTexture(cv);
  }
  function decor(scene, id) {
    if (decoG) {
      scene.remove(decoG);
      // (los cadáveres comparten mallas y materiales con los infectados: esos no se tiran)
      decoG.traverse((o) => { if (o.isMesh && !o.userData.shared) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      decoG = null;
    }
    for (const l of decoLights) scene.remove(l);
    decoLights.length = 0; decoFlick.length = 0; decoMach.length = 0; decoAnim.length = 0;
    LH = null;
    if (id === 'comisaria') { stationDecor(scene, id); return decoG; }
    if (id === 'comisaria_2020') { officeDecor(scene, id); return decoG; }
    if (MAPS[id] && (MAPS[id].flags || MAPS[id].murals)) { beachDecor(scene, id); return decoG; }
    if (id !== 'arcade') return null;
    const P = prims(id), wallH = 4.2;
    decoG = new THREE.Group();
    const rng = U.mulberry32(1234);
    const SCR = [0x3fe6ff, 0xff3fa4, 0x7dff6a, 0xffd23f, 0x9b7bff];
    const plane = (w, h, mat, x, y, z, ry, rx) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0, 'YXZ'); decoG.add(m); return m; };
    const tube = (x, y, z, w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); decoG.add(m); return m; };
    // pantallas y carteles de cada máquina (las volcadas, apagadas)
    for (const f of P.furn) {
      if (f.type !== 'maquina' && f.type !== 'pinball') continue;
      const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, ry = Math.atan2(f.fx, f.fz);
      const at = (lz, ly) => [cx + f.fx * lz, ly, cz + f.fz * lz];
      const col = SCR[Math.floor(rng() * SCR.length)];
      const dm = { x: cx, z: cz, parts: [], fl: [] };
      decoMach.push(dm);
      if (f.type === 'maquina') {
        const dead = rng() < 0.22;
        const sm = neonMat(dead ? 0x1a1a24 : col);
        const [sx, sy, sz] = at(0.142, 1.37);
        const s = plane(0.56, 0.44, sm, sx, sy, sz, ry);
        if (!dead) { const fl = { m: sm, base: new THREE.Color(col), k: 0.55 + rng() * 0.35, sp: 2 + rng() * 6, ph: rng() * 9, broken: rng() < 0.15 }; decoFlick.push(fl); dm.fl.push(fl); }
        const [mx, my, mz] = at(0.292, 1.79);
        dm.parts.push(s, plane(0.74, 0.1, neonMat(U.shade(SCR[Math.floor(rng() * SCR.length)], 0.9)), mx, my, mz, ry));
        s.renderOrder = 1;
      } else {
        const [bx, by, bz] = at(-0.515, 1.15);
        dm.parts.push(plane(0.62, 0.32, neonMat(col), bx, by, bz, ry));
      }
    }
    // tubos de neón por las paredes de la sala (con huecos y tramos rotos)
    const a = MAPS.arcade.arena.hall;
    // los neones, separados de la cara de la pared (la pared mide WALL_T: su cara queda a WALL_T / 2 de la línea)
    const IN = G.World.WALL_T / 2 + 0.045;
    const pink = neonMat(0xff3fa4), cyan = neonMat(0x3fe6ff), viol = neonMat(0xa05bff), yel = neonMat(0xffe23f);
    // pared sur (mirando al norte): franja rosa y cartel con el nombre
    tube((a.x0 + a.x1) / 2 - 3, 3.55, a.z1 - IN, 12, 0.05, 0.05, pink);
    tube(a.x0 + 5, 0.35, a.z1 - IN, 8.6, 0.04, 0.04, cyan);       // (cortada por la puerta del vestíbulo)
    tube(a.x1 - 4.5, 0.35, a.z1 - IN, 7.4, 0.04, 0.04, cyan);
    const sign = new THREE.MeshBasicMaterial({ map: signTex('GALAXIA', '#ff4fb0'), transparent: true, depthWrite: false }); sign.toneMapped = false;
    plane(4.6, 1.15, sign, (a.x0 + a.x1) / 2 - 1, 2.85, a.z1 - IN - 0.03, Math.PI);
    decoFlick.push({ m: sign, base: new THREE.Color(0xffffff), k: 1, sp: 1.3, ph: 0, broken: true, sign: true });
    // pared oeste: zigzag cian; pared este: ondas violeta; norte: franja amarilla (cortada por la brecha)
    for (let k = 0; k < 7; k++) { const t = tube(a.x0 + IN, 2.9 + (k % 2 ? 0.25 : -0.25), a.z0 + 1.2 + k * 1.4, 0.04, 0.05, 1.45, cyan); t.rotation.x = k % 2 ? 0.35 : -0.35; }
    for (let k = 0; k < 8; k++) { const t = tube(a.x1 - IN, 3.0 + Math.sin(k) * 0.2, a.z0 + 1 + k * 1.3, 0.04, 0.05, 1.32, k === 5 ? neonMat(0x2a1a3a) : viol); t.rotation.x = Math.cos(k) * 0.3; }
    tube(a.x0 + 3.5, 3.4, a.z0 + IN, 5.5, 0.05, 0.04, yel); tube(a.x1 - 3.5, 3.4, a.z0 + IN, 5.5, 0.05, 0.04, yel);
    // techo: dos tubos largos (uno parpadea)
    const ct1 = neonMat(0xd8b0ff), ct2 = neonMat(0x9fe8ff);
    tube((a.x0 + a.x1) / 2, wallH - 0.12, a.z0 + 4, 13, 0.06, 0.06, ct1);
    tube((a.x0 + a.x1) / 2, wallH - 0.12, a.z1 - 4, 13, 0.06, 0.06, ct2);
    decoFlick.push({ m: ct2, base: new THREE.Color(0x9fe8ff), k: 1, sp: 7, ph: 2, broken: true });
    // luces de color: rosa al oeste, cian al este y violeta en el centro (dan el tono a todo)
    for (const [hex, x, z, I] of [[0xff4fa8, a.x0 + 4, (a.z0 + a.z1) / 2, 3.0], [0x47d8ff, a.x1 - 4, (a.z0 + a.z1) / 2, 3.0], [0x9a6bff, (a.x0 + a.x1) / 2, a.z0 + 5, 2.4]]) {
      const l = new THREE.PointLight(hex, I, 17, 1.3);
      l.position.set(x, 3.2, z);
      scene.add(l); decoLights.push(l);
    }
    // fuera: farolas de sodio que aún funcionan (una parpadea) y la luz que se cuela del cartel de la fachada
    for (const [x, z, hex] of MAPS.arcade.outLamps) {
      const l = new THREE.PointLight(hex, 2.2, 15, 1.4);
      l.position.set(x, 4.6, z);
      scene.add(l); decoLights.push(l);
      tube(x, 4.75, z, 0.5, 0.08, 0.22, neonMat(U.shade(hex, 1.2)));
    }
    const fs = new THREE.MeshBasicMaterial({ map: signTex('GALAXIA', '#ff4fb0'), transparent: true, depthWrite: false }); fs.toneMapped = false;
    plane(6.2, 1.55, fs, AX + 13, 3.4, AZ + 20 + 0.09, 0);
    decoFlick.push({ m: fs, base: new THREE.Color(0xffffff), k: 1, sp: 2.1, ph: 1, broken: true, sign: true });
    // la guarida: un resplandor anaranjado sucio que se cuela cuando se abre la pared
    const lg = new THREE.PointLight(0xff9a50, 0.9, 9, 1.6); lg.position.set(MAPS.arcade.arena.lair.x, 2.5, MAPS.arcade.arena.lair.z);
    scene.add(lg); decoLights.push(lg);
    scene.add(decoG);
    return decoG;
  }
  // ---------- Asentamiento en la playa: mar, espuma, banderas, estandartes, fuego y humo ----------
  const SCORP = 'M16 13 Q20 15 19 21 Q16 24 13 21 Q12 15 16 13 Z M16 13 Q16 9 18 7 Q21 5 22 8 Q22 10 20 10 L21 12 M14 22 Q11 24 10 27 L8 26 M10 27 L11 29 M18 22 Q21 24 22 27 L24 26 M22 27 L21 29 M13 16 L9 14 M13 18 L9 18 M13 20 L9 21 M19 16 L23 14 M19 18 L23 18 M19 20 L23 21';
  // la tela con el escorpión (granate oscuro, el emblema en ámbar dentro de un círculo, bordes deshilachados)
  function scorpTex(w, h, fade) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, fade ? '#8a5a4c' : '#6e1e16'); g.addColorStop(1, fade ? '#6e4a40' : '#4a120e');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,200,160,0.05)'; x.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1); }
    const S = Math.min(w, h) * 0.8, ox = (w - S) / 2, oy = (h - S) / 2;
    x.save(); x.translate(ox, oy); x.scale(S / 32, S / 32);
    x.strokeStyle = '#f0a63a'; x.lineWidth = 1.6; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.arc(16, 16, 14, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 1.8; x.stroke(new Path2D(SCORP));
    x.restore();
    // bordes gastados
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) { x.fillRect(w - 2 - Math.random() * 6, Math.random() * h, 8, 2 + Math.random() * 4); x.fillRect(Math.random() * w, h - 2 - Math.random() * 4, 2 + Math.random() * 3, 6); }
    // desteñida por el sol y rota (la dejaron atrás): manchas claras, jirones y agujeros
    if (fade) {
      x.globalCompositeOperation = 'source-atop';
      for (let i = 0; i < 30; i++) { x.fillStyle = 'rgba(230,214,190,' + (0.08 + Math.random() * 0.12) + ')'; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 26, 0, 6.3); x.fill(); }
      x.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(w, Math.random() * h); x.lineTo(w * (0.55 + Math.random() * 0.35), Math.random() * h); x.lineTo(w, Math.random() * h); x.fill(); }
      for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 0, 6.3); x.fill(); }
    }
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function softTex(r, g, b) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0.9)'); gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }
  function beachDecor(scene, id) {
    const m = MAPS[id], W = G.World;
    const ground = (x, z) => (W.terrainAt ? W.terrainAt(x, z) : (m.height ? m.height(x, z) : 0));
    decoG = new THREE.Group();
    // ---- el mar: un plano grande desde la orilla (z 89,6) hacia el sur, con un oleaje suave ----
    const SEA_Z = m.seaZ || 89.6;
    const seaGeo = new THREE.PlaneGeometry(520, 240, 52, 24);
    seaGeo.rotateX(-Math.PI / 2);
    seaGeo.translate(48, 0.14, SEA_Z + 120);
    const sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({ color: 0x46524f, transparent: true, opacity: 0.95 }));
    sea.receiveShadow = true;
    decoG.add(sea);
    const sp = seaGeo.attributes.position, base = Float32Array.from(sp.array);
    decoAnim.push((t) => {
      for (let i = 0; i < sp.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        const k = Math.min(1, (z - SEA_Z) / 6);
        sp.array[i * 3 + 1] = base[i * 3 + 1] + k * (Math.sin(x * 0.21 + t * 1.1) * 0.06 + Math.sin(z * 0.17 - t * 0.8) * 0.07);
      }
      sp.needsUpdate = true;
    });
    // brillos del sol bajo sobre el agua (destellos que aparecen y se van)
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.0, depthWrite: false });
    glintMat.toneMapped = false;
    const glints = [];
    for (let i = 0; i < 40; i++) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(0.5 + Math.random() * 1.6, 0.05), glintMat.clone());
      g.rotation.x = -Math.PI / 2; g.position.set(10 + Math.random() * 80, 0.2, SEA_Z + 3 + Math.random() * 40);
      decoG.add(g); glints.push({ g, ph: Math.random() * 9, sp: 0.6 + Math.random() * 1.5 });
    }
    decoAnim.push((t) => { for (const q of glints) q.g.material.opacity = 0.55 * Math.max(0, Math.sin(t * q.sp + q.ph)) ** 3; });
    // la espuma: tres franjas que suben por la arena y se apagan (las olas)
    const foamMat = new THREE.MeshBasicMaterial({ color: 0xece4d4, transparent: true, opacity: 0.5, depthWrite: false });
    const foams = [];
    for (let k = 0; k < 3; k++) {
      const fg = new THREE.PlaneGeometry(100, 0.5, 50, 1); fg.rotateX(-Math.PI / 2); fg.translate(48, 0, 0);
      const fm = new THREE.Mesh(fg, foamMat.clone()); decoG.add(fm);
      foams.push({ fm, fg, base: Float32Array.from(fg.attributes.position.array), ph: k / 3 });
    }
    decoAnim.push((t) => {
      for (const f of foams) {
        const u = (t * 0.09 + f.ph) % 1, a = Math.sin(Math.PI * u);
        const z = SEA_Z + 0.6 - u * 3.2;
        const P = f.fg.attributes.position;
        for (let i = 0; i < P.count; i++) {
          const x = f.base[i * 3], zz = z + f.base[i * 3 + 2] + Math.sin(x * 0.25 + f.ph * 6) * 0.35;
          P.array[i * 3 + 1] = Math.max(0.16, ground(x, zz) + 0.03); P.array[i * 3 + 2] = zz;
        }
        P.needsUpdate = true;
        f.fm.material.opacity = 0.55 * a;
      }
    });
    // ---- banderas en sus mástiles (ondean) ----
    const tex = scorpTex(256, 160, m.flagFade);
    for (const [x, z, face, off, half] of m.flags || []) {
      const gy = ground(x, z) + (off || 0) - (half ? 1.3 : 0);         // (half: a media asta)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.6, 6), new THREE.MeshLambertMaterial({ color: 0x4a4440 }));
      pole.position.set(x, gy + 2.3 + (half ? 1.3 : 0), z); pole.castShadow = true; decoG.add(pole);
      const fg = new THREE.PlaneGeometry(1.7, 1.06, 12, 4); fg.translate(0.85, 0, 0);
      const fl = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      fl.position.set(x, gy + 3.95, z); fl.rotation.y = (face || 0) * 0.9 + 0.5; fl.castShadow = true;
      decoG.add(fl);
      const fb = Float32Array.from(fg.attributes.position.array), ph = Math.random() * 6;
      decoAnim.push((t) => {
        const P = fg.attributes.position;
        for (let i = 0; i < P.count; i++) { const u = fb[i * 3]; P.array[i * 3 + 2] = Math.sin(u * 3.2 - t * 4.2 + ph) * 0.13 * u; P.array[i * 3 + 1] = fb[i * 3 + 1] - u * u * 0.06; }
        P.needsUpdate = true; fg.computeVertexNormals();
      });
    }
    // estandartes colgados en la fachada del museo
    const btex = scorpTex(128, 256);
    for (const [x, z] of m.banners || []) {
      const bg = new THREE.PlaneGeometry(1.5, 3.0, 2, 6);
      const b = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ map: btex }));
      b.position.set(x, ground(x, z + 1) + 3.1, z + 0.02); decoG.add(b);
      const rod = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.06), new THREE.MeshLambertMaterial({ color: 0x3a3430 }));
      rod.position.set(x, b.position.y + 1.53, z + 0.05); decoG.add(rod);
    }
    // ---- fuego (la hoguera y los barriles): llamas que bailan, luz que tiembla y humo que sube ----
    const smokeT = softTex(120, 112, 104), flameMat = (c) => { const mm = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }); mm.toneMapped = false; return mm; };
    let nl = 0;
    for (let [x, z, big] of m.fires || []) {
      const low = big === 2; big = big === 1;
      const gy = ground(x, z) + (big ? 0.12 : (low ? 0.06 : 0.98));
      const fg = new THREE.Group(); fg.position.set(x, gy, z); decoG.add(fg);
      const cones = [];
      for (let k = 0; k < (big ? 5 : 3); k++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(big ? 0.22 : 0.15, big ? 0.9 : 0.55, 6), flameMat(k % 2 ? 0xffb040 : 0xff6a1a));
        c.position.set((Math.random() - 0.5) * (big ? 0.35 : 0.2), (big ? 0.4 : 0.25), (Math.random() - 0.5) * (big ? 0.35 : 0.2));
        fg.add(c); cones.push({ c, ph: Math.random() * 9 });
      }
      let light = null;
      if (nl < 3) { light = new THREE.PointLight(0xff8a3a, big ? 2.4 : 1.4, big ? 11 : 7, 1.5); light.position.set(x, gy + 0.8, z); scene.add(light); decoLights.push(light); nl++; }
      const puffs = [];
      for (let k = 0; k < 7; k++) {
        const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeT, transparent: true, depthWrite: false, opacity: 0 }));
        decoG.add(sm); puffs.push({ sm, t: k / 7 });
      }
      decoAnim.push((t, dt) => {
        for (const q of cones) { const s = 0.75 + 0.35 * Math.sin(t * 9 + q.ph) * Math.sin(t * 5.3 + q.ph * 2); q.c.scale.set(1, s, 1); }
        if (light) light.intensity = (big ? 2.4 : 1.4) * (0.8 + 0.25 * Math.sin(t * 13) * Math.sin(t * 7.7));
        for (const p of puffs) {
          p.t += (dt || 0.016) * 0.18; if (p.t > 1) p.t -= 1;
          p.sm.position.set(x + Math.sin(p.t * 5 + t * 0.3) * 0.3 + p.t * 0.8, gy + 0.8 + p.t * 4.5, z + p.t * 0.4);
          const s = 0.5 + p.t * 2.2; p.sm.scale.set(s, s, 1);
          p.sm.material.opacity = 0.35 * Math.sin(Math.PI * p.t);
        }
      });
    }
    // farol encendido sobre las mesas del comedor (un punto de luz cálida)
    const lampM = new THREE.MeshBasicMaterial({ color: 0xffd890 }); lampM.toneMapped = false;
    for (const f of prims(id).furn) {
      if (f.type !== 'mesa_campo' || f.old) continue;
      const lx = Math.abs(f.fz) > 0.5 ? (f.x0 + f.x1) / 2 - (f.x1 - f.x0) / 2 + 0.15 : (f.x0 + f.x1) / 2, lz = (f.z0 + f.z1) / 2 + 0.25;
      const lm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.21, 0.11), lampM); lm.position.set(lx, ground(lx, lz) + 0.94, lz);
      decoG.add(lm);
    }
    // pintadas y tablones escritos (Oceanside) y el muelle
    for (const md of m.murals || []) {
      const mat = new THREE.MeshLambertMaterial({ map: muralTex(md), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(md.w, md.h), mat);
      pl.position.set(md.x, (md.at ? ground(md.at[0], md.at[1]) : ground(md.x, md.z)) + md.y, md.z); pl.rotation.y = md.ry || 0;     // (md.at: dónde se mide el suelo)
      pl.renderOrder = 2; decoG.add(pl);
    }
    // el faro del mapa: la linterna encendida y dos haces que giran
    if (m.lighthouse) {
      const L = m.lighthouse, ly = ground(L.x, L.z) + L.y;
      const lm = new THREE.MeshBasicMaterial({ color: 0xfff2c8 }); lm.toneMapped = false;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.7, 12), lm); lamp.position.set(L.x, ly, L.z); decoG.add(lamp);
      const gcv = document.createElement('canvas'); gcv.width = 4; gcv.height = 128;
      const gx = gcv.getContext('2d'), gg = gx.createLinearGradient(0, 0, 0, 128);
      gg.addColorStop(0, 'rgba(255,242,205,0.95)'); gg.addColorStop(0.35, 'rgba(255,242,205,0.35)'); gg.addColorStop(1, 'rgba(255,242,205,0)');
      gx.fillStyle = gg; gx.fillRect(0, 0, 4, 128);
      const gt = new THREE.CanvasTexture(gcv);
      const beams = new THREE.Group(); beams.position.set(L.x, ly, L.z);
      for (const s2 of [0, Math.PI]) {
        const bg = new THREE.ConeGeometry(3.4, 46, 12, 1, true); bg.translate(0, -23, 0); bg.rotateZ(Math.PI / 2);
        const bm = new THREE.MeshBasicMaterial({ map: gt, color: 0xffffff, transparent: true, opacity: 0.22, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); bm.toneMapped = false;
        const beam = new THREE.Mesh(bg, bm); beam.rotation.y = s2; beam.renderOrder = 3; beams.add(beam);
      }
      decoG.add(beams);
      // (el jefe del faro lleva la luz a mano: G.Faro pone manual y gira, inclina o apaga los haces)
      LH = { beams, lamp, mat: lm, x: L.x, z: L.z, y: ly, manual: false };
      decoAnim.push((t) => { if (!LH || !LH.manual) beams.rotation.y = t * 0.7; });
    }
    if (m.pier) decoG.add(pierMesh(m.pier, ground));
    if (m.dome) decoG.add(domeMesh(m, ground));
    scene.add(decoG);
  }

  // ---------- Pintadas (Oceanside) ----------
  // md.kind: 'scorp' (el escorpión estarcido), 'text' (letras con espray; \n separa líneas), 'board' (un tablón
  // escrito a mano: la primera línea es el título, las que empiezan por ~ están tachadas) y 'x' (la cruz de las
  // casas registradas: fecha arriba, quién a la izquierda, peligros a la derecha y muertos abajo, separados por |)
  function muralTex(md) {
    const W = 512, H = Math.max(64, Math.round(512 * md.h / md.w)), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d'), col = md.col || '#b8392c';
    const rnd = U.mulberry32(Math.round(md.x * 131 + md.z * 17));
    x.lineCap = 'round'; x.lineJoin = 'round';
    const drips = (x0, x1, y, n) => { x.fillStyle = col; for (let i = 0; i < n; i++) { const px = x0 + rnd() * (x1 - x0), L = 6 + rnd() * 30; x.fillRect(px, y, 2 + rnd() * 2, L); x.beginPath(); x.arc(px + 1.5, y + L, 2.4, 0, 6.3); x.fill(); } };
    if (md.kind === 'scorp') {
      const S = Math.min(W, H) * 0.92, ox = (W - S) / 2, oy = (H - S) / 2;
      x.save(); x.translate(ox, oy); x.scale(S / 32, S / 32);
      x.strokeStyle = col; x.lineWidth = 1.7; x.beginPath(); x.arc(16, 16, 14, 0, Math.PI * 2); x.stroke();
      x.lineWidth = 2.0; x.stroke(new Path2D(SCORP));
      x.restore();
      drips(ox + S * 0.2, ox + S * 0.8, oy + S * 0.85, 7);
    } else if (md.kind === 'board') {
      const L = md.text.split('\n'), lh = H / (L.length + 0.6);
      x.fillStyle = md.ink || '#2a2420'; x.strokeStyle = md.ink || '#2a2420';
      L.forEach((t, i) => {
        const cross = t[0] === '~', s = cross ? t.slice(1) : t, y = lh * (i + 0.9);
        const fam = 'px "Comic Sans MS", "Segoe Print", cursive, sans-serif';
        let fs = Math.round(lh * (i === 0 ? 0.8 : 0.62));
        x.font = (i === 0 ? '900 ' : '700 ') + fs + fam;
        while (fs > 10 && x.measureText(s).width > W * (i === 0 ? 0.92 : 0.86)) { fs -= 2; x.font = (i === 0 ? '900 ' : '700 ') + fs + fam; }   // (que quepa)
        x.textAlign = i === 0 ? 'center' : 'left';
        const px = i === 0 ? W / 2 : W * 0.08;
        x.save(); x.translate(px, y); x.rotate((rnd() - 0.5) * 0.04); x.fillText(s, 0, 0); x.restore();
        if (cross) { const tw = x.measureText(s).width; x.lineWidth = 3; x.beginPath(); x.moveTo(px - 4, y - lh * 0.2); x.lineTo(px + tw + 4, y - lh * 0.25 + (rnd() - 0.5) * 6); x.stroke(); }
      });
    } else if (md.kind === 'x') {
      const q = (md.text || '').split('|'), c = W / 2, r = Math.min(W, H) * 0.42, cy = H / 2;
      x.strokeStyle = col; x.lineWidth = 14;
      x.beginPath(); x.moveTo(c - r, cy - r); x.lineTo(c + r, cy + r); x.moveTo(c + r, cy - r); x.lineTo(c - r, cy + r); x.stroke();
      x.fillStyle = col; x.font = '900 ' + Math.round(r * 0.36) + 'px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      if (q[0]) x.fillText(q[0], c, cy - r * 0.62); if (q[1]) x.fillText(q[1], c - r * 0.64, cy);
      if (q[2]) x.fillText(q[2], c + r * 0.64, cy); if (q[3]) x.fillText(q[3], c, cy + r * 0.64);
      drips(c - r, c + r, cy + r * 0.9, 5);
    } else {
      const L = md.text.split('\n'), lh = H / (L.length + 0.3);
      x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'middle';
      L.forEach((t, i) => {
        let fs = Math.round(lh * 0.82); x.font = '900 ' + fs + 'px Impact, "Arial Black", Arial, sans-serif';
        while (fs > 10 && x.measureText(t).width > W * 0.94) { fs -= 2; x.font = '900 ' + fs + 'px Impact, "Arial Black", Arial, sans-serif'; }
        const y = lh * (i + 0.65);
        x.save(); x.translate(W / 2, y); x.rotate((rnd() - 0.5) * 0.06); x.shadowColor = col; x.shadowBlur = 5; x.fillText(t, 0, 0); x.restore();
        drips(W * 0.15, W * 0.85, y + fs * 0.32, 3);
      });
    }
    // desgaste: la pintura saltada y comida por el sol y la sal
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 70 * (md.wear == null ? 1 : md.wear); i++) { x.fillStyle = 'rgba(0,0,0,' + (0.25 + rnd() * 0.6) + ')'; x.beginPath(); x.arc(rnd() * W, rnd() * H, 2 + rnd() * 14, 0, 6.3); x.fill(); }
    x.globalCompositeOperation = 'source-over';
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }

  // ---------- La cúpula y el pórtico (Red del Capitolio) ----------
  // Sobre la rotonda: el tambor con columnillas y ventanas, la cúpula (con placas caídas que dejan ver el
  // armazón, manchas de humedad y matas que crecen en las grietas) y la linterna. Delante, el entablamento
  // sobre las columnas del pórtico y el frontón (también pintado)
  function domeMesh(m, ground) {
    const D = m.dome, M = new G.Mesher(), rnd = U.mulberry32(2323);
    const y0 = ground(D.x, D.z) + 4.6, r = D.r, stone = 0xd2ccbc, dk = 0x8a8478;
    M.cyl(D.x, y0 + 0.9, D.z, r + 0.4, r + 0.4, 1.8, stone, 28);
    M.cyl(D.x, y0 + 1.86, D.z, r + 0.6, r + 0.6, 0.14, dk, 28);
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x = D.x + Math.sin(a) * (r + 0.45), z = D.z + Math.cos(a) * (r + 0.45);
      M.box(x, y0 + 0.9, z, 0.22, 1.7, 0.22, 0xe0dacc, a);
      const a2 = a + Math.PI / 16, wx = D.x + Math.sin(a2) * (r + 0.41), wz = D.z + Math.cos(a2) * (r + 0.41);
      M.box(wx, y0 + 0.95, wz, 0.9, 1.0, 0.04, k % 5 === 2 ? 0x6a5a4a : 0x2a2a30, a2);
    }
    // la cúpula: anillos de gajos (un elipsoide); los que faltan dejan ver las costillas
    const rings = 7, segs = 24;
    for (let i = 0; i < rings; i++) {
      const t0 = i / rings, t1 = (i + 1) / rings, a0 = t0 * Math.PI / 2, a1 = t1 * Math.PI / 2;
      const rr0 = Math.cos(a0) * r, rr1 = Math.cos(a1) * r, h0 = Math.sin(a0) * r * 0.8, h1 = Math.sin(a1) * r * 0.8;
      for (let k = 0; k < segs; k++) {
        const b0 = k / segs * Math.PI * 2, b1 = (k + 1) / segs * Math.PI * 2;
        const missing = i > 1 && i < 5 && rnd() < 0.06;
        const col = missing ? 0x1a1816 : (rnd() < 0.12 ? U.shade(stone, 0.75) : (rnd() < 0.08 ? 0x7a8a5a : U.shade(stone, 0.9 + rnd() * 0.15)));
        const P = (rr, h, b) => [D.x + Math.sin(b) * rr, y0 + 1.9 + h, D.z + Math.cos(b) * rr];
        M.quad(P(rr0, h0, b0), P(rr1, h1, b0), P(rr1, h1, b1), P(rr0, h0, b1), col);
      }
    }
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; for (let i = 0; i < 6; i++) { const t = (i + 0.5) / 6 * Math.PI / 2; M.box(D.x + Math.sin(a) * Math.cos(t) * (r + 0.05), y0 + 1.9 + Math.sin(t) * r * 0.8, D.z + Math.cos(a) * Math.cos(t) * (r + 0.05), 0.16, 0.6, 0.16, dk, a); } }
    for (let k = 0; k < 9; k++) { const a = rnd() * Math.PI * 2, t = rnd() * 1.1; M.sphere(D.x + Math.sin(a) * Math.cos(t) * r, y0 + 2.0 + Math.sin(t) * r * 0.8, D.z + Math.cos(a) * Math.cos(t) * r, 0.5 + rnd() * 0.5, 0.25, 0.5 + rnd() * 0.5, U.pick(rnd, [0x5a6a3a, 0x6a7a42, 0x4a5a32]), 1); }
    // la linterna de arriba
    const top = y0 + 1.9 + r * 0.8;
    M.cyl(D.x, top + 0.6, D.z, 1.0, 1.0, 1.2, stone, 12);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; M.box(D.x + Math.sin(a) * 1.01, top + 0.6, D.z + Math.cos(a) * 1.01, 0.3, 0.7, 0.04, 0x2a2a30, a); }
    M.cone(D.x, top + 1.6, D.z, 1.15, 0.9, 0x6a7a6a, 12);
    M.cyl(D.x, top + 2.4, D.z, 0.06, 0.06, 0.8, 0x3a3a3a, 6);
    // el pórtico: entablamento y frontón sobre las columnas
    const pt = m.portico;
    if (pt) {
      const gy = ground((pt.x0 + pt.x1) / 2, pt.z) + 5.2, cx = (pt.x0 + pt.x1) / 2, L = pt.x1 - pt.x0;
      M.box(cx, gy + 0.3, pt.z - 0.1, L, 0.6, 1.4, stone);
      M.box(cx, gy + 0.66, pt.z - 0.1, L + 0.3, 0.12, 1.6, dk);
      const zf = pt.z + 0.55, zb = pt.z - 0.8, H = 2.2;
      M.tri([pt.x0 - 0.15, gy + 0.72, zf], [pt.x1 + 0.15, gy + 0.72, zf], [cx, gy + 0.72 + H, zf], stone);
      M.quad([pt.x0 - 0.15, gy + 0.72, zb], [cx, gy + 0.72 + H, zb], [cx, gy + 0.72 + H, zf], [pt.x0 - 0.15, gy + 0.72, zf], dk);
      M.quad([pt.x1 + 0.15, gy + 0.72, zf], [cx, gy + 0.72 + H, zf], [cx, gy + 0.72 + H, zb], [pt.x1 + 0.15, gy + 0.72, zb], dk);
      M.tri([pt.x0 + 0.6, gy + 0.9, zf + 0.02], [pt.x1 - 0.6, gy + 0.9, zf + 0.02], [cx, gy + 0.72 + H - 0.35, zf + 0.02], U.shade(stone, 0.92));
    }
    const mesh = new THREE.Mesh(M.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  // ---------- El muelle (Oceanside) ----------
  // Muelle de madera largo hacia el mar sobre pilotes, con barandillas, farolas y, al final, el viejo
  // restaurante. El primer tramo se vino abajo (o lo tiraron): quedan los pilotes partidos y tablones colgando,
  // así que no se llega desde la arena
  function pierMesh(pr, ground) {
    const M = new G.Mesher(), x = pr.x, w = pr.w, h = pr.h, z0 = pr.z0, z1 = pr.z1, gap = pr.gap || 9;
    const rnd = U.mulberry32(4171), wood = 0x7a6650, dark = 0x4e4234, rail = 0xc8c2b4;
    for (let z = z0; z <= z1; z += 4) {
      const cut = z < z0 + gap;
      for (const s2 of [-1, 0, 1]) {
        const hh = cut ? 1.2 + rnd() * 1.8 : h + 0.2, yb = Math.min(0, ground(x + s2 * w * 0.45, z)) - 2;
        M.cyl(x + s2 * w * 0.45, yb + (hh - yb) / 2, z, 0.2, 0.17, hh - yb, cut ? 0x3e3428 : dark, 7);
      }
      if (!cut) { M.box(x, h - 0.45, z, w + 0.2, 0.24, 0.24, dark); for (const s2 of [-1, 1]) M.box(x + s2 * w * 0.22, h * 0.45, z, 0.12, 0.12, w * 0.6, dark, Math.PI / 2, undefined, 0, s2 * 0.7); }
    }
    const zs = z0 + gap;
    // el tablero (con algún tablón que falta) y las vigas de debajo
    for (const s2 of [-0.3, 0.3]) M.box(x + s2 * w, h - 0.2, (zs + z1) / 2, 0.22, 0.3, z1 - zs, dark);
    for (let z = zs; z < z1; z += 0.5) { if (rnd() < 0.04) continue; M.box(x, h, z + 0.25, w, 0.1, 0.44, U.shade(wood, 0.85 + rnd() * 0.3)); }
    // el borde roto: tablones que cuelgan hacia la arena
    for (let k = 0; k < 6; k++) { const lx = x - w / 2 + 0.4 + k * (w - 0.8) / 5, L = 1.2 + rnd() * 1.8; M.box(lx, h - L * 0.45, zs - L * 0.32, 0.4, 0.08, L, U.shade(wood, 0.8 + rnd() * 0.3), 0, undefined, -0.9 - rnd() * 0.4, 0); }
    // barandillas y farolas
    for (const s2 of [-1, 1]) {
      const rx = x + s2 * (w / 2 - 0.06);
      for (let z = zs + 0.5; z < z1; z += 2) M.box(rx, h + 0.55, z, 0.1, 1.1, 0.1, rail);
      M.box(rx, h + 1.08, (zs + z1) / 2, 0.08, 0.08, z1 - zs, rail); M.box(rx, h + 0.6, (zs + z1) / 2, 0.05, 0.05, z1 - zs, rail);
      for (let z = zs + 6; z < z1 - 8; z += 12) { M.cyl(rx, h + 2.1, z, 0.07, 0.06, 3.2, 0x2e3438, 6); M.sphere(rx, h + 3.8, z, 0.2, 0.26, 0.2, 0xe8e2cc, 1); }
    }
    // el restaurante del final: casita blanca con tejado rojo y ventanas
    const rz = z1 - 3;
    M.box(x, h + 1.6, rz, w + 2, 3.2, 6, 0xe8e2d6);
    M.box(x, h + 3.35, rz, w + 2.6, 0.3, 6.6, 0xa83a2e);
    for (const s2 of [-1, 1]) for (let k = 0; k < 3; k++) M.box(x + s2 * (w / 2 + 1.01), h + 1.9, rz - 2 + k * 2, 0.02, 1.1, 1.3, 0x2a3036);
    M.box(x, h + 1.9, rz - 3.01, w - 0.6, 1.1, 0.02, 0x2a3036);
    M.box(x, h + 3.9, rz - 3.1, 3.4, 0.8, 0.1, 0xa83a2e);
    const mesh = new THREE.Mesh(M.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  // una máquina destrozada: se apagan (y quitan) su pantalla y su cartel
  function killDecor(x, z) {
    for (let i = decoMach.length - 1; i >= 0; i--) {
      const d = decoMach[i];
      if (Math.hypot(d.x - x, d.z - z) > 0.5) continue;
      for (const p of d.parts) p.visible = false;
      for (const fl of d.fl) { const k = decoFlick.indexOf(fl); if (k >= 0) decoFlick.splice(k, 1); }
      decoMach.splice(i, 1);
    }
  }
  // parpadeo de las pantallas y de los neones rotos
  let decoT = 0;
  function updateDecor(dt) {
    if (!decoG) return;
    decoT += dt;
    for (const f of decoAnim) f(decoT, dt);
    for (const d of decoFlick) {
      let v = d.k + (1 - d.k) * (0.5 + 0.5 * Math.sin(decoT * d.sp + d.ph));
      if (d.broken) { const n = Math.sin(decoT * 23 + d.ph) * Math.sin(decoT * 7.3 + d.ph * 2); if (n > 0.55) v *= 0.12; }
      if (d.sign) d.m.opacity = v; else d.m.color.copy(d.base).multiplyScalar(v);
    }
  }

  // ---------- Horizonte lejano ----------
  // Siluetas de la ciudad (y grúas, torres, árboles) alrededor del mapa, a unos 44 m de la cámara y sin niebla
  // propia: van con la cámara (como un cielo), en tonos que se funden con la neblina del cielo
  let sky = null;
  let skyBeam = null;
  function skyline(scene, id) {
    if (sky) { scene.remove(sky); sky.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); sky = null; skyBeam = null; }
    skyStatic = false;
    const m = id && MAPS[id];
    if (!m || !m.skyline) return null;
    if (m.skyline.beach) return beachSky(scene, m);
    const rng = U.mulberry32((m.seed || 7) + 99);
    const M = new G.Mesher();
    const R = 44, base = -6;
    const col = (k) => U.shade(m.skyline.col, k);
    const at = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];
    // edificios en la distancia (dos capas: lejos más claros)
    for (const [r, k, n] of [[R + 6, 1.1, 46], [R, 0.95, 34]]) {
      for (let i = 0; i < n; i++) {
        const a = (i + rng() * 0.6) / n * Math.PI * 2;
        const [x, z] = at(a, r);
        const h = m.skyline.h[0] + rng() * (m.skyline.h[1] - m.skyline.h[0]);
        const w = 4 + rng() * 7;
        M.box(x, base + h / 2, z, w, h, 3, col(k * (0.92 + rng() * 0.12)), a);
        if (rng() < 0.35) M.box(x + (rng() - 0.5) * 2, base + h + 1.2, z, 1.2, 2.4, 1.2, col(k * 0.95), a);
      }
    }
    // grúas portuarias y una torre (terminal)
    for (const c of m.skyline.cranes || []) {
      const [x, z] = at(c, R - 2);
      const H = 26;
      for (const s of [-1, 1]) M.box(x + Math.cos(c) * s * 2.5, base + H / 2, z - Math.sin(c) * s * 2.5, 0.6, H, 0.6, col(0.8), c);
      M.box(x, base + H, z, 7, 1.2, 1.2, col(0.8), c);
      M.box(x + Math.sin(c) * -5, base + H + 3, z + Math.cos(c) * -5, 0.6, 0.6, 18, col(0.8), c);
      M.box(x, base + H + 4, z, 0.4, 8, 0.4, col(0.8), c);
    }
    for (const t of m.skyline.towers || []) {
      const [x, z] = at(t, R + 2);
      M.box(x, base + 16, z, 4, 32, 4, col(0.88), t);
      M.box(x, base + 33, z, 2.5, 4, 2.5, col(0.86), t);
      M.box(x, base + 37, z, 1, 6, 1, col(0.86), t);
    }
    // copas de árboles entre los edificios: en los mapas con naturaleza, un bosque entero (copas redondas y
    // abetos en punta, en dos filas) que se come la ciudad; si no, unas pocas copas
    const nT = m.wild ? Math.round(50 + 90 * m.wild) : 40;
    for (let i = 0; i < nT; i++) {
      const a = rng() * Math.PI * 2, r = R - 5 + rng() * 9, [x, z] = at(a, r);
      const k = 0.7 + rng() * 0.1 + (r - R) * 0.012;
      if (!m.wild) { M.box(x, base + 6 + rng() * 3, z, 3 + rng() * 3, 6 + rng() * 5, 3, col(0.78), a); continue; }
      const h = 8 + rng() * 9;
      if (rng() < 0.45) {
        M.cyl(x, base + h * 0.3, z, 0.5, 0.4, h * 0.6, col(k * 0.8), 5);
        M.cone(x, base + h * 0.62, z, 2.4 + rng() * 1.6, h * 0.85, col(k * 0.92), 7);
      } else {
        M.cyl(x, base + h * 0.35, z, 0.6, 0.45, h * 0.7, col(k * 0.8), 5);
        for (let j = 0; j < 3; j++) M.sphere(x + (rng() - 0.5) * 3, base + h * (0.72 + rng() * 0.25), z + (rng() - 0.5) * 3, 2.6 + rng() * 1.8, 2.0 + rng() * 1.4, 2.6 + rng() * 1.8, col(k * (0.9 + rng() * 0.1)), 1);
      }
    }
    const mat = hazeMat(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false }));
    sky = new THREE.Mesh(M.build(), mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
    return sky;
  }
  // Luz del horizonte (día y noche, clima: G.Sky): oscurece los montes y edificios lejanos y los tiñe del
  // color del cielo. La linterna y los haces del faro no (de noche se ven más)
  // El horizonte, con bruma: se funde con el color de la niebla (uHaze, ya en el color de salida) en la medida
  // uAmt. Sin tono (toneMapped false) para que el color de la niebla salga exacto
  function hazeMat(mat) {
    const u = { uHaze: { value: new THREE.Color() }, uAmt: { value: 0 } };
    mat.toneMapped = false;
    mat.userData.haze = u;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uHaze = u.uHaze; sh.uniforms.uAmt = u.uAmt;
      sh.fragmentShader = 'uniform vec3 uHaze;\nuniform float uAmt;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, uHaze, uAmt );');
    };
    mat.customProgramCacheKey = () => 'skyhaze';
    return mat;
  }
  const _hz = new THREE.Color();
  function skyTint(k, col, amt, fogCol) {
    if (!sky) return;
    sky.traverse((o) => {
      const m = o.material;
      if (!m || !m.color) return;
      if (m.userData.haze) {
        // (los colores del horizonte, más oscuros de noche, y la bruma: el color de la niebla tal cual se ve)
        m.color.setRGB(k * k * 1.25, k * k * 1.25, k * k * 1.25);
        if (fogCol) m.userData.haze.uHaze.value.copy(_hz.copy(fogCol).convertSRGBToLinear()); else m.userData.haze.uHaze.value.copy(col).convertSRGBToLinear();
        m.userData.haze.uAmt.value = amt;
        return;
      }
      if (m.blending === THREE.AdditiveBlending) { if (m.userData.op0 == null) m.userData.op0 = m.opacity; m.opacity = Math.min(0.9, m.userData.op0 * (1 + (1 - k) * 1.6)); return; }
      if (m.toneMapped === false) return;
      if (!m.userData.c0) m.userData.c0 = m.color.clone();
      m.color.copy(m.userData.c0).lerp(col, amt).multiplyScalar(k * k);          // (k*k: los colores van en lineal)
    });
  }
  let skyStatic = false;          // (el escondite: la costa y el faro quedan quietos, en su sitio)
  function followSky(cam) {
    if (sky && cam && !skyStatic) sky.position.set(cam.position.x, 0, cam.position.z);
    if (skyBeam) { const t = performance.now() / 1000; skyBeam.rotation.y = t * 0.7; }
  }
  // La playa: montes de otoño hacia tierra (norte, este y oeste) y, sobre el mar, el cabo con el faro (el de la
  // pantalla de inicio: torre blanca, linterna roja y la luz que gira)
  function beachSky(scene, m) {
    const rng = U.mulberry32((m.seed || 7) + 99);
    const M = new G.Mesher();
    const R = 48, base = -5;
    const at = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];
    const col = (c, k) => U.shade(c, k);
    // montes: dos capas, la de lejos más clara y rosada (como en el inicio); solo hacia tierra
    const HC = m.skyline.hills || [0xb8a49a, 0x8e8270];
    for (const [r, c, hh, n] of [[R + 8, HC[0], [10, 22], 60], [R, HC[1], [6, 13], 70]]) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI * 0.42 + (i + rng()) / n * Math.PI * 1.16;
        const [x, z] = at(a, r), h = hh[0] + rng() * (hh[1] - hh[0]);
        M.cone(x, base + h / 2, z, 6 + rng() * 6, h, col(c, 0.9 + rng() * 0.15), 6);
      }
    }
    // copas de árboles de otoño delante de los montes
    for (let i = 0; i < 60; i++) {
      const a = Math.PI * 0.45 + rng() * Math.PI * 1.1, [x, z] = at(a, R - 5);
      M.sphere(x, base + 7 + rng() * 2, z, 2 + rng() * 2, 2 + rng() * 1.5, 2 + rng() * 2, U.pick(rng, m.skyline.trees || [0xa87a52, 0xb89262, 0x9a6a4a, 0x8a8058]), 0);
    }
    // (el mapa del faro: el faro está en el propio mapa, no en el horizonte)
    if (m.skyline.noCape) {
      const mesh0 = new THREE.Mesh(M.build(), hazeMat(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false })));
      mesh0.renderOrder = -10; mesh0.frustumCulled = false;
      sky = new THREE.Group(); sky.add(mesh0); sky.frustumCulled = false;
      scene.add(sky);
      return sky;
    }
    // el cabo del faro, sobre el mar al suroeste
    const fa = m.skyline.cape != null ? m.skyline.cape : -0.62, [fx, fz] = at(fa, R + 14);
    for (let k = 0; k < 9; k++) M.sphere(fx + (rng() - 0.5) * 16, base + 2 + rng() * 3, fz + (rng() - 0.5) * 6, 5 + rng() * 5, 3 + rng() * 3, 3 + rng() * 3, col(0x6a5e56, 0.85 + rng() * 0.2), 0);
    // el faro: torre troncocónica blanca con dos franjas rojas, el balcón con barandilla, la linterna de
    // cristal (encendida), la cúpula roja con su remate y, al pie, la casa del farero con tejado a dos aguas
    const ty = base + 6.5, TH = 12;
    M.cyl(fx, ty + TH / 2, fz, 1.35, 0.92, TH, 0xe4dcd0, 14);
    for (const y of [ty + 3.2, ty + 7.6]) M.cyl(fx, y, fz, 1.27 - (y - ty) * 0.036, 1.2 - (y - ty) * 0.036, 1.1, 0xa83a2e, 14);
    for (let k = 0; k < 3; k++) { const r = 1.3 - k * 0.12; M.box(fx - Math.sin(fa) * r, ty + 1.8 + k * 3.6, fz - Math.cos(fa) * r, 0.3, 0.5, 0.1, 0x3a3634, fa); }   // ventanucos
    M.cyl(fx, ty + TH + 0.1, fz, 1.45, 1.45, 0.22, 0x3a3634, 16);
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; M.box(fx + Math.sin(a) * 1.38, ty + TH + 0.55, fz + Math.cos(a) * 1.38, 0.05, 0.7, 0.05, 0x3a3634); }
    M.cyl(fx, ty + TH + 0.88, fz, 1.42, 1.42, 0.05, 0x3a3634, 16);
    M.cyl(fx, ty + TH + 0.35, fz, 0.8, 0.8, 0.3, 0xe4dcd0, 12);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; M.box(fx + Math.sin(a) * 0.74, ty + TH + 1.2, fz + Math.cos(a) * 0.74, 0.06, 1.4, 0.06, 0x2a2624); }
    M.cone(fx, ty + TH + 2.25, fz, 0.92, 0.75, 0xa83a2e, 12);
    M.cyl(fx, ty + TH + 2.75, fz, 0.06, 0.06, 0.5, 0x2a2624, 6);
    M.sphere(fx, ty + TH + 3.05, fz, 0.13, 0.13, 0.13, 0x2a2624, 0);
    // casa del farero
    const hx = fx + Math.cos(fa) * 3.4, hz = fz - Math.sin(fa) * 3.4;
    M.box(hx, ty + 1.2, hz, 4.2, 2.4, 3.0, 0xe8e0d4, -fa);
    for (const s2 of [-1, 1]) M.box(hx, ty + 2.85, hz + s2 * 0.0, 4.5, 0.12, 1.9, 0xa83a2e, -fa, undefined, s2 * 0.62, 0);
    M.box(hx, ty + 3.05, hz, 4.5, 0.6, 0.2, 0x8a2e24, -fa);
    const mat = hazeMat(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false }));
    const mesh = new THREE.Mesh(M.build(), mat);
    mesh.renderOrder = -10; mesh.frustumCulled = false;
    sky = new THREE.Group(); sky.add(mesh);
    // la linterna encendida y dos haces que giran (se desvanecen hacia fuera)
    const lm = new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false, depthWrite: false }); lm.toneMapped = false;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 1.3, 12), lm); lamp.position.set(fx, ty + TH + 1.2, fz); lamp.renderOrder = -9; sky.add(lamp);
    const gcv = document.createElement('canvas'); gcv.width = 4; gcv.height = 128;
    const gx = gcv.getContext('2d'), gg = gx.createLinearGradient(0, 0, 0, 128);
    gg.addColorStop(0, 'rgba(255,242,205,0.95)'); gg.addColorStop(0.35, 'rgba(255,242,205,0.35)'); gg.addColorStop(1, 'rgba(255,242,205,0)');
    gx.fillStyle = gg; gx.fillRect(0, 0, 4, 128);
    const gt = new THREE.CanvasTexture(gcv);
    skyBeam = new THREE.Group(); skyBeam.position.set(fx, ty + TH + 1.2, fz);
    for (const s2 of [0, Math.PI]) {
      const bg = new THREE.ConeGeometry(1.9, 26, 12, 1, true); bg.translate(0, -13, 0); bg.rotateZ(Math.PI / 2);
      const bm = new THREE.MeshBasicMaterial({ map: gt, color: 0xffffff, transparent: true, opacity: 0.32, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); bm.toneMapped = false;
      const beam = new THREE.Mesh(bg, bm); beam.renderOrder = -9; beam.rotation.y = s2; skyBeam.add(beam);
    }
    sky.add(skyBeam);
    sky.frustumCulled = false;
    scene.add(sky);
    return sky;
  }
  // El escondite de los Supervivientes: de noche, por la ventana del fondo (al norte), la costa a oscuras y, sobre
  // el mar, el faro de Oceanside con su luz girando (el mismo de los mapas de la playa)
  function hideoutSky(scene) {
    if (sky) { scene.remove(sky); sky.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); sky = null; skyBeam = null; }
    // (en su sitio: delante de la ventana del escondite, al norte; a menos de 50 m para que se dibuje siempre)
    const W = G.World.refuge, cx0 = W.x0 + 9, cz0 = W.z0;
    const rng = U.mulberry32(1313);
    const M = new G.Mesher();
    const R = 36, base = -4.1, fa = Math.PI, K = 0.37;          // (el pie, bajo la línea del suelo: asoma la parte de arriba, como algo lejano)          // (el escondite está en lo alto: la costa se ve abajo, por la ventana)          // (K: el faro, más chico: se ve lejos)
    const at = (a, r) => [cx0 + Math.sin(a) * r, cz0 + Math.cos(a) * r];
    // el mar (una franja oscura) y la costa: lomas negras azuladas a los lados
    for (let i = 0; i < 40; i++) {
      const a = fa - 0.9 + (i + rng()) / 40 * 1.8, [x, z] = at(a, R + 4), h = 3.6 + rng() * 1.6 + Math.abs(a - fa) * 6;
      if (Math.abs(a - fa) < 0.3) continue;
      M.cone(x, base + h / 2, z, 5 + rng() * 5, h, U.shade(0x1c222c, 0.8 + rng() * 0.4), 6);
    }
    const [sx, sz] = at(fa, R + 4);
    M.box(sx, base + 0.4, sz + 2, 120, 0.2, 12, 0x0c1218);
    // el cabo y el faro
    const [fx, fz] = at(fa - 0.045, R + 2);          // (un poco a un lado: que no lo tape el marco del medio de la ventana)
    for (let k = 0; k < 7; k++) M.sphere(fx + (rng() - 0.5) * 9, base + rng() * 0.6, fz + (rng() - 0.5) * 4, 3 + rng() * 3, 0.8 + rng() * 0.6, 2 + rng() * 2, U.shade(0x1e1a1a, 0.85 + rng() * 0.3), 0);
    const ty = base + 0.4, TH = 12 * K;
    M.cyl(fx, ty + TH / 2, fz, 1.35 * K, 0.92 * K, TH, 0x8a8680, 14);
    for (const y of [ty + 3.2 * K, ty + 7.6 * K]) M.cyl(fx, y, fz, (1.27 - (y - ty) / K * 0.036) * K, (1.2 - (y - ty) / K * 0.036) * K, 1.1 * K, 0x5a2620, 14);
    M.cyl(fx, ty + TH + 0.1 * K, fz, 1.45 * K, 1.45 * K, 0.22 * K, 0x1e1c1a, 16);
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; M.box(fx + Math.sin(a) * 1.38 * K, ty + TH + 0.55 * K, fz + Math.cos(a) * 1.38 * K, 0.05, 0.7 * K, 0.05, 0x1e1c1a); }
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; M.box(fx + Math.sin(a) * 0.74 * K, ty + TH + 1.2 * K, fz + Math.cos(a) * 0.74 * K, 0.05, 1.4 * K, 0.05, 0x161412); }
    M.cone(fx, ty + TH + 2.25 * K, fz, 0.92 * K, 0.75 * K, 0x4a201a, 12);
    // (con profundidad: el suelo de afuera tapa lo que queda por debajo de su borde, como en la realidad)
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    const mesh = new THREE.Mesh(M.build(), mat);
    mesh.frustumCulled = false;
    sky = new THREE.Group(); sky.add(mesh);
    const lm = new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false }); lm.toneMapped = false;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.68 * K, 0.68 * K, 1.3 * K, 12), lm); lamp.position.set(fx, ty + TH + 1.2 * K, fz); sky.add(lamp);
    // el resplandor de la linterna (se ve aunque el faro quede chico a lo lejos)
    const hcv = document.createElement('canvas'); hcv.width = hcv.height = 64;
    const hx = hcv.getContext('2d'), hg = hx.createRadialGradient(32, 32, 0, 32, 32, 32);
    hg.addColorStop(0, 'rgba(255,240,200,1)'); hg.addColorStop(0.25, 'rgba(255,230,180,0.5)'); hg.addColorStop(1, 'rgba(255,230,180,0)');
    hx.fillStyle = hg; hx.fillRect(0, 0, 64, 64);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(hcv), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.material.toneMapped = false; halo.scale.setScalar(4.5); halo.position.copy(lamp.position); halo.renderOrder = 2; sky.add(halo);
    const gcv = document.createElement('canvas'); gcv.width = 4; gcv.height = 128;
    const gx = gcv.getContext('2d'), gg = gx.createLinearGradient(0, 0, 0, 128);
    gg.addColorStop(0, 'rgba(255,242,205,0.95)'); gg.addColorStop(0.35, 'rgba(255,242,205,0.35)'); gg.addColorStop(1, 'rgba(255,242,205,0)');
    gx.fillStyle = gg; gx.fillRect(0, 0, 4, 128);
    const gt = new THREE.CanvasTexture(gcv);
    skyBeam = new THREE.Group(); skyBeam.position.set(fx, ty + TH + 1.2 * K, fz);
    for (const s2 of [0, Math.PI]) {
      const bg = new THREE.ConeGeometry(1.2, 34, 12, 1, true); bg.translate(0, -17, 0); bg.rotateZ(Math.PI / 2);
      const bm = new THREE.MeshBasicMaterial({ map: gt, color: 0xffffff, transparent: true, opacity: 0.45, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); bm.toneMapped = false;
      const beam = new THREE.Mesh(bg, bm); beam.renderOrder = 2; beam.rotation.y = s2; skyBeam.add(beam);
    }
    sky.add(skyBeam);
    sky.frustumCulled = false;
    skyStatic = true;
    scene.add(sky);
    return sky;
  }
  // ---------- Vista previa (modo libre: el panel de los mapas) ----------
  // Un plano visto desde arriba, dibujado con lo que tiene el mapa (suelo, edificios, contenedores, muebles y
  // árboles). 'libre': el campo de pruebas. Se guarda como imagen (data URL)
  const PREV = {};
  function preview(id) {
    if (PREV[id]) return PREV[id];
    if (typeof document === 'undefined') return '';
    const S = 220, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d');
    const F = G.World.F;
    const GC = { [F.GRASS]: '#56693e', [F.ROAD]: '#4a4b4d', [F.SIDEWALK]: '#8e8a80', [F.DIRT]: '#6b5a44' };
    if (id === 'libre' || !MAPS[id]) {
      x.fillStyle = '#5d7d43'; x.fillRect(0, 0, S, S);
      x.strokeStyle = '#d8cfb8'; x.lineWidth = 3; x.strokeRect(14, 14, S - 28, S - 28);
      x.fillStyle = '#c9b48a'; x.fillRect(40, 150, 30, 12); x.fillRect(150, 150, 30, 12); x.fillRect(96, 152, 28, 8);
      x.fillStyle = '#3f5a2f'; for (const [a, b] of [[50, 60], [160, 70], [110, 40], [70, 110]]) { x.beginPath(); x.arc(a, b, 9, 0, 6.3); x.fill(); }
      x.fillStyle = '#bdb6a8'; x.fillRect(60, 80, 46, 30); x.fillRect(130, 100, 40, 26);
    } else {
      const m = MAPS[id], P = prims(id), A = m.min - 1, B = m.max + 1, k = S / (B - A);
      const R = (x0, z0, w, d) => x.fillRect((x0 - A) * k, (z0 - A) * k, w * k, d * k);
      x.fillStyle = '#121014'; x.fillRect(0, 0, S, S);
      for (const [x0, z0, x1, z1, g] of P.ground) { x.fillStyle = GC[g] || '#4a4b4d'; R(x0, z0, x1 - x0, z1 - z0); }
      for (const bd of P.blds) {
        const def = G.Buildings.DEFS.find((d) => d.id === bd.id); if (!def) continue;
        const rot = bd.front === 'E' || bd.front === 'W';
        const w = rot ? def.h : def.w, d = rot ? def.w : def.h;
        x.fillStyle = id === 'arcade' ? '#3a2f55' : '#8c8f8a'; R(bd.ox, bd.oz, w, d);
        if (def.rooms) {
          x.strokeStyle = 'rgba(20,16,24,0.8)'; x.lineWidth = 1.5;
          for (const r of def.rooms) x.strokeRect((bd.ox + r[0] - A) * k, (bd.oz + r[1] - A) * k, r[2] * k, r[3] * k);
        }
      }
      for (const c of P.conts) {
        if (c.lod) continue;
        x.fillStyle = ['#9a4a32', '#3f6a8a', '#5f7a3a', '#a07a2a'][(c.x * 7 + c.z * 3) % 4];
        R(c.x + 0.1, c.z + 0.1, c.w - 0.2, c.d - 0.2);
      }
      for (const f of P.furn) {
        const t = G.Furniture.T[f.type];
        if (!t || f.type === 'charco') continue;
        x.fillStyle = t.vehicle ? '#c9c2b0' : (f.type === 'hongos' ? '#b8865a' : (f.type === 'maquina' || f.type === 'pinball' ? '#d84fa0' : '#9a8a6a'));
        R(f.x0, f.z0, f.x1 - f.x0, f.z1 - f.z0);
      }
      x.fillStyle = '#2f4a26';
      for (const [ox, oz] of P.obj) { x.beginPath(); x.arc((ox + 0.5 - A) * k, (oz + 0.5 - A) * k, 1.6 * k, 0, 6.3); x.fill(); }
      // el punto de inicio
      x.fillStyle = '#ffe9a8'; x.beginPath(); x.arc((m.spawn.x - A) * k, (m.spawn.z - A) * k, 4, 0, 6.3); x.fill();
    }
    PREV[id] = cv.toDataURL('image/png');
    return PREV[id];
  }

  G.Maps = {
    preview,
    skyline, followSky, skyTint, hideoutSky,
    LEVEL_H,
    // (barrio y estación de servicio se quitaron: las carreras guardadas que los tenían van al puerto y al faro)
    get(id) { return MAPS[id] || MAPS[{ barrio: 'puerto', barrio_completo: 'puerto', servicio: 'faro' }[id]] || null; },
    // los mapas de los enfrentamientos normales (sin los exclusivos del jefe) y todos (modo libre)
    list() { return Object.keys(MAPS).filter((k) => !MAPS[k].boss && !MAPS[k].hidden); },
    listAll() { return Object.keys(MAPS).filter((k) => !MAPS[k].hidden); },
    decor, updateDecor, killDecor, get lighthouseFx() { return LH; },
    apply,
    prims
  };
})(window.Game = window.Game || {});
