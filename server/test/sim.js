'use strict';
/* اختبار شامل: خادم حقيقي + عملاء WebSocket (تلفاز + 2 لاعبان بشريان + 2 آليان) حتى نهاية المباراة */
process.env.AUTO_DELAY = '600'; process.env.AUTO_FAST = '100';
const WebSocket = require('ws');
const { server } = require('../server.js');
const SQ = require('../../public/shared/data.js').SQ;

let port, errs = [], stats = { prompts: 0, trades: 0, builds: 0, tradeOk: 0, reconnect: 0, events: 0, autoplayed: 0 };
const T0 = Date.now();
function client(role) {
  const c = { ws: null, token: null, id: null, state: null, code: null, log: [] };
  c.open = () => new Promise((res) => { c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); c.ws.on('open', res); c.ws.on('message', (d) => c.on(JSON.parse(d))); });
  c.send = (o) => c.ws.readyState === 1 && c.ws.send(JSON.stringify(o));
  c.on = (m) => {
    if (m.t === 'err') errs.push(role + ': ' + m.m);
    if (m.t === 'created') c.code = m.code;
    if (m.t === 'joined') { c.token = m.token; c.id = m.id; c.code = m.code; }
    if (m.t === 'ev') stats.events++;
    if (m.t === 'tradeResult') { stats.trades++; if (m.ok) stats.tradeOk++; }
    if (m.t === 'state') { c.state = m; if (role === 'human') c.play(m); }
    if (m.t === 'lobby') c.lobby = m;
  };
  c.busy = false;
  c.play = (m) => {
    const s = m.s;
    if (s.trade && s.trade.to === m.me) { c.send({ t: 'tradeReply', ok: Math.random() < 0.5 }); return; }
    if (!m.prompt || c.busy) return;
    const p = m.prompt, me = s.players[m.me]; stats.prompts++;
    const key = p.seq;
    if (c.last === key) return; c.last = key;
    setTimeout(() => {
      if (p.kind === 'roll') c.send({ t: 'ans', v: 'roll' });
      else if (p.kind === 'buy') c.send({ t: 'ans', v: me.money >= p.price ? 'buy' : 'auction' });
      else if (p.kind === 'jail') c.send({ t: 'ans', v: 'roll' });
      else if (p.kind === 'bid') c.send({ t: 'ans', v: Math.random() < 0.5 && me.money > p.cur + 60 ? 10 : 0 });
      else if (p.kind === 'debt') { const mg = m.manage.find((x) => x.s) || m.manage.find((x) => x.m); if (mg) c.send({ t: 'act', a: mg.s ? 'sell' : 'mort', i: mg.i }); else c.send({ t: 'ans', v: 'bankrupt' }); c.last = null; }
      else if (p.kind === 'end') {
        const b = m.manage.find((x) => x.b);
        if (b && me.money > 300) { c.send({ t: 'act', a: 'build', i: b.i }); stats.builds++; }
        const other = s.players.find((q) => q.id !== m.me && !q.bankrupt);
        if (other && stats.trades < 6 && Math.random() < 0.3 && m.tradable.length) c.send({ t: 'trade', to: other.id, give: [m.tradable[0]], get: [], gc: 0, rc: 150 });
        setTimeout(() => c.send({ t: 'ans', v: 'end' }), 30);
      }
    }, 5);
  };
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => server.listen(0, r)); port = server.address().port;
  const tv = client('tv'); await tv.open(); tv.send({ t: 'create', role: 'tv' }); await sleep(100);
  const code = tv.code; console.log('room code', code);
  const a = client('human'), b = client('human'); await a.open(); await b.open();
  a.send({ t: 'join', code, name: 'أحمد' }); b.send({ t: 'join', code, name: 'سارة' }); await sleep(100);
  a.send({ t: 'addBot' }); a.send({ t: 'addBot' }); a.send({ t: 'cfg', cash: 2000, jackpot: true }); a.send({ t: 'speed', v: 'turbo' }); await sleep(100);
  console.log('lobby players', a.lobby.players.map((p) => p.name + (p.bot ? '(bot)' : '')).join(', '), 'host', a.lobby.players.filter((p) => p.host).map((p) => p.name));
  // غير المضيف لا يستطيع البدء
  b.send({ t: 'start' }); await sleep(50); if (tv.state) errs.push('non-host started game');
  a.send({ t: 'start' });
  // قطع اتصال لاعب وإعادته بالرمز
  let dropped = false;
  const iv = setInterval(async () => {
    const st = tv.state; if (!st) return;
    if (!dropped && st.s.turnNo > 15) {
      dropped = true; const tok = b.token; b.ws.close(); await sleep(1500);
      const nb = client('human'); await nb.open(); nb.send({ t: 'join', code, token: tok, name: 'سارة' }); await sleep(50); Object.assign(b, nb); b.id = nb.id; stats.reconnect++;
      // الحالة الجديدة تصل عبر nb؛ نستخدم nb للعب
      global.__nb = nb;
    }
    if (st.s.over || Date.now() - T0 > 100000) {
      clearInterval(iv);
      const s = st.s;
      console.log('turns', s.turnNo, 'over', s.over, 'winner', s.players[s.winner] && s.players[s.winner].name, 'money', s.players.map((p) => p.name + ':' + p.money + (p.bankrupt ? 'X' : '')).join(' '));
      console.log('stats', JSON.stringify(stats), 'houses', s.houseBank, s.hotelBank);
      // ما بعد النهاية: العودة إلى الردهة
      a.send({ t: 'again' }); await sleep(150);
      console.log('after again phase', a.lobby && a.lobby.phase, 'players', a.lobby && a.lobby.players.length);
      console.log('errors', errs.slice(0, 6)); process.exit(errs.length ? 1 : (s.over ? 0 : 2));
    }
  }, 300);
})();
