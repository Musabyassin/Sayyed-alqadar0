'use strict';
/* اختبار كلمة السر الثانية للشات (من متغير بيئة SECRET_CHAT_WORD2):
   الكلمة هنا وهمية للاختبار فقط — الكلمة الحقيقية لا تظهر في أي ملف
   بالمستودع. يتحقق أن كتابتها وحدها لا تُبث ولا تُسجَّل وتضيف 100
   لكاتبها مع تنبيه خاص، وأنها داخل جملة رسالة عادية. */
process.env.AUTO_DELAY = '600'; process.env.AUTO_FAST = '100';
process.env.SECRET_CHAT_WORD2 = 'testword22'; // كلمة وهمية للاختبار فقط
const WebSocket = require('ws');
const { server } = require('../server.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) fails.push(name); }
(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const mk = () => {
    const c = { ws: null, code: null, id: null, state: null, evs: [] };
    c.open = () => new Promise((res) => {
      c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      c.ws.on('open', res);
      c.ws.on('message', (d) => {
        const m = JSON.parse(d);
        if (m.t === 'created') c.code = m.code;
        if (m.t === 'joined') { c.id = m.id; c.code = m.code; }
        if (m.t === 'state') c.state = m;
        if (m.t === 'ev') c.evs.push(m.e);
      });
    });
    c.send = (o) => c.ws.send(JSON.stringify(o));
    return c;
  };
  const a = mk(), b = mk(); await a.open(); await b.open();
  a.send({ t: 'create', role: 'phone', name: 'أحمد' }); await sleep(150);
  b.send({ t: 'join', code: a.code, name: 'سارة' }); await sleep(150);
  a.send({ t: 'start' }); await sleep(400);
  check('game started', !!(a.state && a.state.s && !a.state.s.over));
  const money0 = a.state.s.players[a.id].money;
  a.evs.length = 0; b.evs.length = 0;
  a.send({ t: 'chat', m: 'testword22' }); await sleep(400);
  check('word alone is not broadcast', !b.evs.some((e) => e.e === 'chat' && String(e.m).includes('testword22')));
  check('private +100 toast to sender', !!a.evs.find((e) => e.e === 'toast' && String(e.m).includes('+100')));
  check('money +100', a.state.s.players[a.id].money === money0 + 100);
  await sleep(600); // تجاوز حد مكافحة الإغراق (500ms)
  b.evs.length = 0;
  a.send({ t: 'chat', m: 'أحب testword22 كثيرا' }); await sleep(400);
  check('word in a sentence is a normal message', b.evs.some((e) => e.e === 'chat' && String(e.m).includes('testword22')));
  a.ws.close(); b.ws.close(); server.close();
  console.log(fails.length ? 'SECRET2-FAIL' : 'SECRET2-PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
