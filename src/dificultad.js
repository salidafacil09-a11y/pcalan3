(function (G) {
  'use strict';

  // Dificultad. Se elige después del personaje (Retorno y modo libre) y, de momento, solo cambia cuánto aguantan
  // los enemigos: infectados, Escorpiones y el jefe. Difícil es el juego tal como era hasta ahora.
  //   hp: lo que aguantan respecto de Difícil. Con los tiros que van por número (rifle, revólver y flechas: ver
  //   stkShots en zombie.js) también baja: hacen falta los de Difícil por hp, redondeado hacia arriba.
  // El temblante nunca baja de 4 tiros de rifle mejorado a la cabeza (regla de todos los modos): TEMB_MIN.
  // La partida diaria y el modo historia van siempre en Difícil. La carrera guarda la suya (Continuar la respeta).
  const LV = {
    facil: { name: 'Fácil', hp: 0.6, desc: 'Los enemigos aguantan bastante menos: caen con menos golpes y menos balas.' },
    normal: { name: 'Normal', hp: 0.8, desc: 'Los enemigos aguantan algo menos que en Difícil.' },
    dificil: { name: 'Difícil', hp: 1, desc: 'El juego tal como es: los enemigos aguantan todo lo que tienen que aguantar.' }
  };
  const ORDER = ['facil', 'normal', 'dificil'];
  const TEMB_MIN = 0.76;
  const KEY = 'ceniza.dificultad';       // la última elegida (el selector empieza en ella)
  let cur = 'dificil';

  G.Diff = {
    LV, ORDER,
    get cur() { return cur; },
    set(id) { cur = LV[id] ? id : 'dificil'; },
    name(id) { return (LV[id || cur] || LV.dificil).name; },
    // cuánto aguanta un enemigo (temb: el temblante, sin el jefe hongomorfo)
    hpMul(temb) { const k = (LV[cur] || LV.dificil).hp; return temb ? Math.max(TEMB_MIN, k) : k; },
    last() { try { const v = localStorage.getItem(KEY); return LV[v] ? v : 'normal'; } catch (e) { return 'normal'; } },
    remember(id) { try { if (LV[id]) localStorage.setItem(KEY, id); } catch (e) { /* nada */ } }
  };
})(window.Game = window.Game || {});
