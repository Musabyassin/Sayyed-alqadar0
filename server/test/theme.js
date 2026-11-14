'use strict';
/* اختبار خيار الخلفية الخضراء الفاتحة (رسالة theme من المضيف):
   الغرفة تبدأ داكنة، والمضيف يفعّلها في الردهة فتصل الجميع (لاعبون
   وعرض التلفاز)، وغير المضيف لا يستطيع تغييرها، وتعمل أيضاً أثناء اللعب. */
process.env.AUTO_DELAY = '600'; process.env.AUTO_FAST = '100';
const WebSocket = require('ws');
const { server } = require('../server.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) fails.push(name); }
(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const mk = () => {
    const c = { ws: null, code: null, id: null, lobby: null, state: null };
    c.open = () => new Promise((res) => {
      c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      c.ws.on('open', res);
      c.ws.on('message', (d) => {
        const m = JSON.parse(d);
        if (m.t === 'created') c.code = m.code;
        if (m.t === 'joined') { c.id = m.id; c.code = m.code; }
        if (m.t === 'lobby') c.lobby = m;
        if (m.t === 'state') c.state = m;
      });
    });
    c.send = (o) => c.ws.send(JSON.stringify(o));
    return c;
  };
  const tv = mk(), a = mk(), b = mk();
  await tv.open(); await a.open(); await b.open();
  tv.send({ t: 'create', role: 'tv' }); await sleep(150);
  a.send({ t: 'join', code: tv.code, name: 'أحمد' }); await sleep(120);
  b.send({ t: 'join', code: tv.code, name: 'سارة' }); await sleep(150);
  check('room starts dark', a.lobby && a.lobby.cfg.greenBg === false);
  a.send({ t: 'theme', green: true }); await sleep(300);
  check('host enables green in lobby', a.lobby.cfg.greenBg === true);
  check('other player receives it', b.lobby.cfg.greenBg === true);
  check('tv display receives it', tv.lobby.cfg.greenBg === true);
  b.send({ t: 'theme', green: false }); await sleep(300);
  check('non-host cannot change it', a.lobby.cfg.greenBg === true);
  a.send({ t: 'start' }); await sleep(400);
  check('green survives into the game', a.state && a.state.greenBg === true);
  a.send({ t: 'theme', green: false }); await sleep(300);
  check('host can switch it off mid-game', a.state.greenBg === false);
  tv.ws.close(); a.ws.close(); b.ws.close(); server.close();
  console.log(fails.length ? 'THEME-FAIL' : 'THEME-PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
