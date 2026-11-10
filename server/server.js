'use strict';
/* خادم سيد العقار: غرف بكود، WebSocket، وتقديم صفحات التلفاز والهاتف. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { Game } = require('./engine.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_ROOMS = 300;
const AUTO_DELAY = Number(process.env.AUTO_DELAY) || 20000, AUTO_FAST = Number(process.env.AUTO_FAST) || 2500;
const NAMES = ['سلطان', 'نورة', 'فهد', 'ريم', 'خالد', 'لينا'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const rooms = new Map();

/* ---------- HTTP ---------- */
function origin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (url.pathname === '/qr') {
      const c = (url.searchParams.get('c') || '').replace(/\D/g, '').slice(0, 6);
      const svg = await QRCode.toString(`${origin(req)}/play/?c=${c}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/tv' || p === '/play') { res.writeHead(302, { Location: p + '/' + url.search }); return res.end(); }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('غير موجود'); }
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
      res.end(buf);
    });
  } catch (e) { res.writeHead(500); res.end('error'); }
});

/* ---------- الغرف ---------- */
function newCode() { for (let i = 0; i < 50; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!rooms.has(c)) return c; } return null; }
function newRoom() {
  if (rooms.size >= MAX_ROOMS) return null;
  const code = newCode(); if (!code) return null;
  const room = { code, phase: 'lobby', members: [], displays: new Set(), hostDisplays: new Set(), cfg: { cash: 1500, jackpot: false, speed: 1.6 }, game: null, last: Date.now(), trade: null, timers: new Map(), bcast: null, chat: [], chatAt: new Map() };
  rooms.set(code, room); return room;
}
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const humans = (room) => room.members.filter((m) => !m.bot);
function ensureHost(room) { const hs = humans(room); if (hs.some((m) => m.host)) return; const n = hs.find((m) => m.ws) || hs[0]; if (n) n.host = true; }

function lobbyMsg(room) {
  return { t: 'lobby', code: room.code, phase: room.phase, cfg: room.cfg, players: room.members.map((m, i) => ({ id: i, name: m.name, bot: m.bot, host: !!m.host, connected: m.bot || !!m.ws })) };
}
function stateFor(room, m) {
  const g = room.game, snap = g.snapshot();
  snap.players.forEach((p, i) => { const mm = room.members[i]; p.connected = mm.bot || !!mm.ws; p.host = !!mm.host; });
  const out = { t: 'state', s: snap, code: room.code, tv: room.displays.size };
  if (m) {
    const p = g.S.players[room.members.indexOf(m)];
    out.me = p.id; out.host = !!m.host;
    out.prompt = g.pend && g.pend.pid === p.id ? g.pend.spec : null;
    out.manage = g.manageInfo(p);
    out.tradable = g.tradable(p);
  }
  return out;
}
function broadcast(room) {
  room.bcast = null;
  if (room.phase === 'lobby' || !room.game) {
    const msg = lobbyMsg(room);
    room.members.forEach((m) => send(m.ws, { ...msg, me: room.members.indexOf(m), host: !!m.host }));
    room.displays.forEach((ws) => send(ws, msg));
    return;
  }
  const base = stateFor(room, null);
  room.displays.forEach((ws) => { if (ws.readyState === 1) ws.send(JSON.stringify({ ...base, canBoard: room.hostDisplays.has(ws) })); });
  room.members.forEach((m) => { if (m.ws) send(m.ws, stateFor(room, m)); });
}
function schedule(room) { if (!room.bcast) room.bcast = setTimeout(() => broadcast(room), 25); }
function emit(room, e) { const j = JSON.stringify({ t: 'ev', e }); room.displays.forEach((ws) => ws.readyState === 1 && ws.send(j)); room.members.forEach((m) => m.ws && m.ws.readyState === 1 && m.ws.send(j)); }

function armAuto(room, pid) {
  const m = room.members[pid]; if (!m || m.bot) return;
  clearTimeout(room.timers.get(pid));
  if (m.ws) return;
  const t = setTimeout(() => { if (room.game && !m.ws) { m.auto = true; room.game.autoPlay(pid); } }, m.auto ? AUTO_FAST : AUTO_DELAY);
  room.timers.set(pid, t);
}
function startGame(room) {
  const cfg = room.cfg;
  const io = {
    update: () => schedule(room),
    event: (e) => emit(room, e),
    pendingStarted: (pid) => armAuto(room, pid),
    askTrade: (toId, offer) => new Promise((resolve) => {
      const m = room.members[toId];
      if (!m || !m.ws || m.auto) return resolve(false);
      const t = setTimeout(() => { if (room.trade) { room.trade = null; resolve(false); } }, 60000);
      room.trade = { toId, resolve: (ok) => { clearTimeout(t); room.trade = null; resolve(ok); } };
    }),
  };
  room.phase = 'playing';
  room.members.forEach((m) => { m.auto = false; });
  room.game = new Game({ players: room.members.map((m) => ({ name: m.name, bot: m.bot })), cash: cfg.cash, jackpot: cfg.jackpot, speed: cfg.speed }, io);
  room.game.run().catch((e) => { console.error('game error', e); emit(room, { e: 'toast', m: 'حدث خطأ في اللعبة' }); });
  broadcast(room);
}
function resetToLobby(room) {
  if (room.game) room.game.stop(); room.game = null; room.phase = 'lobby';
  room.members = room.members.filter((m) => m.bot || m.ws);
  room.timers.forEach((t) => clearTimeout(t)); room.timers.clear();
  ensureHost(room); broadcast(room);
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const hits = new Map();
setInterval(() => hits.clear(), 60000);

function attach(ws, room, member) {
  ws.room = room; ws.member = member || null;
  if (member) {
    if (member.ws && member.ws !== ws) { try { member.ws.close(4000, 'replaced'); } catch (e) { /* ignore */ } }
    member.ws = ws; member.auto = false; clearTimeout(member.drop); clearTimeout(room.timers.get(room.members.indexOf(member)));
  } else room.displays.add(ws);
}
function join(ws, room, msg) {
  const name = String(msg.name || '').trim().slice(0, 14) || 'لاعب';
  let m = msg.token && room.members.find((x) => !x.bot && x.token === msg.token);
  if (!m && room.phase === 'playing') m = room.members.find((x) => !x.bot && !x.ws && x.name === name);
  if (!m) {
    if (room.phase !== 'lobby') return send(ws, { t: 'err', m: 'اللعبة بدأت بالفعل' });
    if (room.members.length >= 6) return send(ws, { t: 'err', m: 'الغرفة ممتلئة (6 لاعبين)' });
    let nm = name, k = 2; while (room.members.some((x) => x.name === nm)) nm = `${name} ${k++}`;
    m = { name: nm, bot: false, token: crypto.randomBytes(12).toString('hex'), ws: null, host: false };
    room.members.push(m);
  }
  attach(ws, room, m); ensureHost(room);
  send(ws, { t: 'joined', code: room.code, token: m.token, id: room.members.indexOf(m), name: m.name });
  broadcast(room);
}

wss.on('connection', (ws, req) => {
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const room = ws.room, m = ws.member;
    if (room) room.last = Date.now();
    switch (msg.t) {
      case 'ping': return send(ws, { t: 'pong' });
      case 'create': {
        let r = msg.resume && rooms.get(String(msg.resume));
        if (!r) r = newRoom();
        if (!r) return send(ws, { t: 'err', m: 'الخادم ممتلئ حالياً، حاول لاحقاً' });
        if (msg.role === 'tv') { attach(ws, r, null); r.hostDisplays.add(ws); send(ws, { t: 'created', code: r.code }); send(ws, { t: 'chatHist', list: r.chat }); broadcast(r); }
        else { join(ws, r, msg); send(ws, { t: 'chatHist', list: r.chat }); }
        return;
      }
      case 'watch': { const r = rooms.get(String(msg.code)); if (!r) return send(ws, { t: 'err', m: 'كود الغرفة غير صحيح', fatal: true }); attach(ws, r, null); send(ws, { t: 'created', code: r.code }); send(ws, { t: 'chatHist', list: r.chat }); broadcast(r); return; }
      case 'join': {
        const n = (hits.get(ip) || 0) + 1; hits.set(ip, n); if (n > 40) return send(ws, { t: 'err', m: 'محاولات كثيرة، انتظر قليلاً' });
        const r = rooms.get(String(msg.code || '').trim());
        if (!r) return send(ws, { t: 'err', m: 'كود الغرفة غير صحيح', fatal: true });
        return join(ws, r, msg);
      }
      default: break;
    }
    /* أزرار اللوحة الرئيسية: شاشة العرض التي أنشأت الغرفة فقط تستطيع رمي النرد
       أو إنهاء الدور نيابة عن اللاعب صاحب الانتظار. المحرك نفسه يتحقق أن القيمة
       تطابق نوع الانتظار الحالي (roll/end)، فلا يمكن استخدامها لأي قرار آخر. */
    if (msg.t === 'boardAns') {
      if (room && room.hostDisplays.has(ws) && room.game && room.game.pend && (msg.v === 'roll' || msg.v === 'end')) room.game.answer(room.game.pend.pid, msg.v);
      return;
    }
    if (!room || !m) return;
    const g = room.game;
    switch (msg.t) {
      case 'chat': {
        /* كلمة الشات السرية: كتابة «قصب» وحدها لا تظهر لأحد (لا بث ولا سجل)،
           وتضيف 500 لكاتبها فقط أثناء اللعبة، مع تنبيه خاص يصله وحده. */
        if (String(msg.m || '').trim() === 'قصب') {
          const idx = room.members.indexOf(m), gg = room.game;
          let added = false;
          if (gg && room.phase === 'playing') { const p = gg.S.players[idx]; if (p && !p.bankrupt) { p.money += 500; added = true; schedule(room); } }
          send(ws, { t: 'ev', e: { e: 'toast', m: added ? '🌿 +500 لك' : '🌿 تعمل أثناء اللعبة فقط' } });
          return;
        }
        const text = String(msg.m || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!text) return;
        const now = Date.now(), lastAt = room.chatAt.get(m) || 0;
        if (now - lastAt < 500) return; /* حد بسيط ضد الإغراق */
        room.chatAt.set(m, now);
        const entry = { id: room.members.indexOf(m), n: m.name, m: text, ts: now };
        room.chat.push(entry); if (room.chat.length > 50) room.chat.splice(0, room.chat.length - 50);
        emit(room, { e: 'chat', ...entry });
        return;
      }
      case 'cfg': if (m.host && room.phase === 'lobby') { room.cfg.cash = [1000, 1500, 2000, 3000].includes(msg.cash) ? msg.cash : 1500; room.cfg.jackpot = !!msg.jackpot; broadcast(room); } return;
      case 'speed': if (m.host) { room.cfg.speed = msg.v === 'slow' ? 2.6 : msg.v === 'fast' ? 0.8 : msg.v === 'turbo' ? 0 : 1.6; if (g) g.speed = room.cfg.speed; broadcast(room); } return;
      case 'addBot': if (m.host && room.phase === 'lobby' && room.members.length < 6) { const used = new Set(room.members.map((x) => x.name)); const nm = NAMES.find((x) => !used.has(x)) || 'آلي ' + room.members.length; room.members.push({ name: nm, bot: true, ws: null }); broadcast(room); } return;
      case 'kick': if (m.host && room.phase === 'lobby') { const t = room.members[Number(msg.id)]; if (t && t !== m) { room.members.splice(room.members.indexOf(t), 1); if (t.ws) { send(t.ws, { t: 'kicked' }); t.ws.room = null; t.ws.member = null; } broadcast(room); } } return;
      case 'start': if (m.host && room.phase === 'lobby' && room.members.length >= 2) startGame(room); return;
      case 'again': if (m.host && g && g.S.over) resetToLobby(room); return;
      case 'ans': if (g) { g.answer(room.members.indexOf(m), msg.v); } return;
      case 'act': if (g) g.act(room.members.indexOf(m), msg.a, msg.i); return;
      case 'trade': if (g) { g.trade(room.members.indexOf(m), Number(msg.to), msg.give, msg.get, Number(msg.gc) | 0, Number(msg.rc) | 0).then((r) => send(ws, { t: 'tradeResult', ...r })).catch(() => {}); } return;
      case 'tradeReply': if (room.trade && room.trade.toId === room.members.indexOf(m)) room.trade.resolve(!!msg.ok); return;
      case 'leave': leave(ws); return;
      default: return;
    }
  });
  ws.on('close', () => leave(ws, true));
  ws.on('error', () => {});
});
function leave(ws, dropped) {
  const room = ws.room, m = ws.member; if (!room) return;
  room.displays.delete(ws); room.hostDisplays.delete(ws);
  if (m && m.ws === ws) {
    m.ws = null;
    const idx = room.members.indexOf(m);
    if (room.phase === 'lobby') {
      const rm = () => { if (!m.ws && room.phase === 'lobby') { const i = room.members.indexOf(m); if (i >= 0) room.members.splice(i, 1); ensureHost(room); broadcast(room); } };
      if (dropped) m.drop = setTimeout(rm, 30000); else rm();
    } else {
      if (m.host) { m.host = false; ensureHost(room); }
      if (room.game) armAuto(room, idx);
      if (room.trade && room.trade.toId === idx) room.trade.resolve(false);
    }
  }
  if (!dropped) { ws.room = null; ws.member = null; }
  schedule(room);
}
setInterval(() => { wss.clients.forEach((ws) => { if (!ws.alive) return ws.terminate(); ws.alive = false; try { ws.ping(); } catch (e) { /* ignore */ } }); }, 25000);
setInterval(() => {
  const now = Date.now();
  rooms.forEach((r, c) => {
    const live = r.displays.size + r.members.filter((m) => m.ws).length;
    if (!live && now - r.last > 30 * 60000) { if (r.game) r.game.stop(); rooms.delete(c); }
  });
}, 5 * 60000);

if (require.main === module) server.listen(PORT, () => {
  console.log(`سيد العقار يعمل على المنفذ ${PORT}`);
  const os = require('os');
  Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).forEach((n) => console.log(`  التلفاز:  http://${n.address}:${PORT}/tv/\n  الهاتف:   http://${n.address}:${PORT}/play/`));
});
module.exports = { server, rooms };
