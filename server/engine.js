'use strict';
/* محرك اللعبة على الخادم. كل القرارات تُتخذ هنا، والهواتف تُرسل الأوامر فقط. */
const D = require('../public/shared/data.js');
const { SQ, GROUPS, RAILS, UTILS, COLORS, CHANCE, CHEST } = D;

const rnd6 = () => 1 + Math.floor(Math.random() * 6);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const grp = (g) => GROUPS[g] || [];

class Game {
  constructor(cfg, io) {
    this.io = io;
    this.dead = false;
    this.speed = cfg.speed == null ? 1.6 : cfg.speed;
    this.pend = null;
    this.chanceDeck = shuffle(CHANCE.map((x) => ({ ...x })));
    this.chestDeck = shuffle(CHEST.map((x) => ({ ...x })));
    this.S = {
      players: cfg.players.map((q, i) => ({ id: i, name: q.name, bot: !!q.bot, color: COLORS[i], money: cfg.cash, pos: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false })),
      owner: {}, houses: {}, mort: {}, cur: 0, dice: [1, 1], rolling: false,
      houseBank: 32, hotelBank: 12, pot: 0, log: [], focus: null, turnNo: 0,
      over: false, winner: null, standings: null, pending: null, trade: null,
      opt: { jackpot: !!cfg.jackpot, cash: cfg.cash },
    };
  }

  /* ---------- أدوات عامة ---------- */
  sleep(ms) { return new Promise((res) => { if (this.dead) return; const t = ms * this.speed; if (t <= 0) setImmediate(res); else setTimeout(res, t); }); }
  sync() { if (!this.dead) this.io.update(); }
  event(e) { if (!this.dead) this.io.event(e); }
  sfx(n) { this.event({ e: 'sfx', n }); }
  toast(m) { this.event({ e: 'toast', m }); }
  log(m) { this.S.log.unshift(m); if (this.S.log.length > 60) this.S.log.pop(); }
  get cur() { return this.S.players[this.S.cur]; }
  alive() { return this.S.players.filter((p) => !p.bankrupt); }
  owned(p) { return Object.keys(this.S.owner).map(Number).filter((i) => this.S.owner[i] === p.id).sort((a, b) => a - b); }
  hs(i) { return this.S.houses[i] || 0; }
  ownsGroup(p, g) { return grp(g).every((i) => this.S.owner[i] === p.id); }
  worth(p) { return p.money + this.owned(p).reduce((a, i) => a + (this.S.mort[i] ? SQ[i].p / 2 : SQ[i].p) + this.hs(i) * (SQ[i].h || 0), 0); }
  stop() { this.dead = true; this.pend = null; }

  snapshot() {
    const S = this.S;
    return { ...S, players: S.players.map((p) => { const { jailCards, ...r } = p; return { ...r, jc: jailCards.length }; }), log: S.log.slice(0, 30) };
  }

  /* ---------- البناء والرهن ---------- */
  canBuild(p, i) {
    const s = SQ[i]; if (s.t !== 'prop' || this.S.owner[i] !== p.id || !this.ownsGroup(p, s.g)) return false;
    if (grp(s.g).some((j) => this.S.mort[j])) return false;
    const h = this.hs(i); if (h >= 5) return false;
    if (grp(s.g).some((j) => this.hs(j) < h)) return false;
    if (p.money < s.h) return false;
    return h < 4 ? this.S.houseBank > 0 : this.S.hotelBank > 0;
  }
  build(p, i) { const s = SQ[i], h = this.hs(i); p.money -= s.h; if (h < 4) this.S.houseBank--; else { this.S.hotelBank--; this.S.houseBank += 4; } this.S.houses[i] = h + 1; this.sfx('buy'); }
  canSell(p, i) { const s = SQ[i]; if (s.t !== 'prop' || this.S.owner[i] !== p.id) return false; const h = this.hs(i); return h > 0 && !grp(s.g).some((j) => this.hs(j) > h); }
  sell(p, i) {
    const s = SQ[i], h = this.hs(i);
    if (h === 5) { const k = Math.min(4, this.S.houseBank); this.S.houseBank -= k; this.S.hotelBank++; this.S.houses[i] = k; p.money += (s.h / 2) * (5 - k); }
    else { this.S.houseBank++; this.S.houses[i] = h - 1; p.money += s.h / 2; }
    this.sfx('cash');
  }
  canMort(p, i) { const s = SQ[i]; if (this.S.owner[i] !== p.id || this.S.mort[i]) return false; if (s.g && grp(s.g).some((j) => this.hs(j) > 0)) return false; return true; }
  mort(p, i) { this.S.mort[i] = true; p.money += SQ[i].p / 2; this.sfx('cash'); }
  unmortCost(i) { return Math.ceil((SQ[i].p / 2) * 1.1); }
  canUnmort(p, i) { return this.S.owner[i] === p.id && this.S.mort[i] && p.money >= this.unmortCost(i); }
  unmort(p, i) { p.money -= this.unmortCost(i); this.S.mort[i] = false; this.sfx('buy'); }

  manageInfo(p) {
    return this.owned(p).map((i) => ({ i, h: this.hs(i), mg: !!this.S.mort[i], b: this.canBuild(p, i), s: this.canSell(p, i), m: this.canMort(p, i), u: this.canUnmort(p, i), uc: this.unmortCost(i) }));
  }

  /* أمر إدارة أملاك من هاتف اللاعب (مسموح أثناء أي سؤال موجه إليه) */
  act(pid, a, i) {
    const pe = this.pend; if (!pe || pe.pid !== pid) return false;
    const p = this.S.players[pid]; i = Number(i); if (!(i >= 0 && i < 40)) return false;
    let ok = false;
    if (a === 'build' && this.canBuild(p, i)) { this.build(p, i); ok = true; }
    else if (a === 'sell' && this.canSell(p, i)) { this.sell(p, i); ok = true; }
    else if (a === 'mort' && this.canMort(p, i)) { this.mort(p, i); ok = true; }
    else if (a === 'unmort' && this.canUnmort(p, i)) { this.unmort(p, i); ok = true; }
    if (ok) this.sync();
    return ok;
  }

  calcRent(i, dice, o2 = {}) {
    const s = SQ[i], o = this.S.players[this.S.owner[i]];
    if (s.t === 'prop') { const h = this.hs(i); if (h > 0) return s.r[h]; return this.ownsGroup(o, s.g) ? s.r[0] * 2 : s.r[0]; }
    if (s.t === 'rail') { const n = RAILS.filter((j) => this.S.owner[j] === o.id).length; return [25, 50, 100, 200][n - 1] * (o2.rail2 ? 2 : 1); }
    const n = UTILS.filter((j) => this.S.owner[j] === o.id).length;
    return dice * (o2.util10 ? 10 : n === 2 ? 10 : 4);
  }

  /* ---------- الأسئلة الموجهة للاعبين ---------- */
  ask(p, spec) {
    if (p.bot) return this.sleep(spec.kind === 'bid' ? 250 : 500).then(() => this.botAnswer(p, spec));
    return new Promise((resolve) => {
      spec = { ...spec, seq: (this.seq = (this.seq || 0) + 1) };
      this.pend = { pid: p.id, spec, resolve };
      this.S.pending = { pid: p.id, kind: spec.kind };
      this.sync();
      this.io.pendingStarted(p.id);
    });
  }
  validate(spec, v, p) {
    switch (spec.kind) {
      case 'roll': return v === 'roll' ? 'roll' : undefined;
      case 'end': return v === 'end' ? 'end' : undefined;
      case 'buy': if (v === 'buy') return p.money >= spec.price ? 'buy' : undefined; return v === 'auction' ? 'auction' : undefined;
      case 'jail': if (v === 'pay') return p.money >= 50 ? 'pay' : undefined; if (v === 'card') return p.jailCards.length ? 'card' : undefined; return v === 'roll' ? 'roll' : undefined;
      case 'bid': { const n = Number(v); if (n === 0) return 0; if ([10, 50, 100].includes(n) && p.money >= spec.cur + n) return n; return undefined; }
      case 'debt': if (v === 'bankrupt') return 'bankrupt'; return v === 'pay' && p.money >= spec.need ? 'pay' : undefined;
      default: return undefined;
    }
  }
  answer(pid, v) {
    const pe = this.pend; if (!pe || pe.pid !== pid) return false;
    const n = this.validate(pe.spec, v, this.S.players[pid]); if (n === undefined) return false;
    this.pend = null; this.S.pending = null; pe.resolve(n); return true;
  }
  autoPlay(pid) { const pe = this.pend; if (!pe || pe.pid !== pid) return false; const p = this.S.players[pid]; return this.answer(pid, this.botAnswer(p, pe.spec, true)); }

  /* ---------- ذكاء اللاعب الآلي ---------- */
  completes(p, i) { const g = SQ[i].g; return g && grp(g).every((j) => j === i || this.S.owner[j] === p.id); }
  blocksOther(p, i) { const g = SQ[i].g; if (!g) return false; const rest = grp(g).filter((j) => j !== i); const o = this.S.owner[rest[0]]; return o !== undefined && o !== p.id && rest.every((j) => this.S.owner[j] === o); }
  botWantsBuy(p, i) { const s = SQ[i], after = p.money - s.p; if (this.completes(p, i)) return true; if (s.t === 'rail') return after >= 80; if (s.t === 'util') return after >= 180; return after >= (this.S.turnNo < 25 ? 60 : 160); }
  botBid(q, idx, bid) { const s = SQ[idx]; let v = s.p * 0.85; if (this.completes(q, idx)) v = s.p * 1.3; else if (this.blocksOther(q, idx)) v = s.p * 1.15; const mx = Math.min(v, q.money - 10); if (bid + 10 > mx) return 0; return bid + 20 <= mx && Math.random() < 0.4 ? 20 : 10; }
  botRaise(p, need) {
    let g = 0;
    while (p.money < need && g++ < 300) {
      const sl = this.owned(p).filter((i) => this.canSell(p, i)).sort((a, b) => this.hs(b) - this.hs(a)); if (sl.length) { this.sell(p, sl[0]); continue; }
      const mo = this.owned(p).filter((i) => this.canMort(p, i)).sort((a, b) => SQ[a].p - SQ[b].p); if (mo.length) { this.mort(p, mo[0]); continue; }
      break;
    }
  }
  botManage(p) {
    this.owned(p).forEach((i) => { if (this.S.mort[i] && p.money - this.unmortCost(i) >= 500) this.unmort(p, i); });
    let g = 0, did = true;
    while (did && g++ < 40) {
      did = false;
      const c = this.owned(p).filter((i) => this.canBuild(p, i) && p.money - SQ[i].h >= 250).sort((a, b) => this.hs(a) - this.hs(b) || SQ[b].p - SQ[a].p);
      if (c.length) { this.build(p, c[0]); this.log(`${p.name} بنى في ${SQ[c[0]].n}`); did = true; }
    }
  }
  botAnswer(p, spec, fallback) {
    switch (spec.kind) {
      case 'roll': return 'roll';
      case 'end': this.botManage(p); return 'end';
      case 'buy': return p.money >= spec.price && this.botWantsBuy(p, spec.idx) ? 'buy' : 'auction';
      case 'jail': if (p.jailCards.length) return 'card'; return p.money >= 500 ? 'pay' : 'roll';
      case 'bid': return this.botBid(p, spec.idx, spec.cur);
      case 'debt': this.botRaise(p, spec.need); return p.money >= spec.need ? 'pay' : 'bankrupt';
      default: return null;
    }
  }

  /* ---------- الصفقات ---------- */
  tradable(p) { return this.owned(p).filter((i) => !SQ[i].g || !grp(SQ[i].g).some((j) => this.hs(j) > 0)); }
  fees(g) { return g.reduce((n, i) => n + (this.S.mort[i] ? Math.ceil(SQ[i].p * 0.05) : 0), 0); }
  tradeCheck(a, b, give, get, gc, rc) {
    if (!a || !b || a === b || a.bankrupt || b.bankrupt) return 'طرف غير صالح';
    const ok = (arr, p) => Array.isArray(arr) && new Set(arr).size === arr.length && arr.every((i) => Number.isInteger(i) && this.tradable(p).includes(i));
    if (!ok(give, a) || !ok(get, b)) return 'عقار غير قابل للتبادل';
    if (!(Number.isInteger(gc) && gc >= 0 && Number.isInteger(rc) && rc >= 0)) return 'مبلغ غير صالح';
    if (!give.length && !get.length && !gc && !rc) return 'الصفقة فارغة';
    if (a.money - gc + rc - this.fees(get) < 0 || b.money - rc + gc - this.fees(give) < 0) return 'الرصيد لا يكفي';
    return null;
  }
  evalTrade(bot, hum, give, get, gc, rc) {
    const bb = new Set(this.owned(bot)), hb = new Set(this.owned(hum)), ba = new Set(bb), ha = new Set(hb);
    give.forEach((i) => { ha.delete(i); ba.add(i); }); get.forEach((i) => { ba.delete(i); ha.add(i); });
    const full = (set, g) => grp(g).every((i) => set.has(i));
    let sc = gc - rc;
    give.forEach((i) => { const s = SQ[i]; sc += s.p * (this.S.mort[i] ? 0.6 : 1); if (s.g && full(ba, s.g) && !full(bb, s.g)) sc += s.p * 0.9; });
    get.forEach((i) => { const s = SQ[i]; sc -= s.p * (this.S.mort[i] ? 0.6 : 1) * 1.05; if (s.g) { if (full(bb, s.g) && !full(ba, s.g)) sc -= s.p * 1.2; if (full(ha, s.g) && !full(hb, s.g)) sc -= s.p; } });
    return sc;
  }
  execTrade(a, b, ag, bg, ac, bc) {
    const fee = (i) => (this.S.mort[i] ? Math.ceil(SQ[i].p * 0.05) : 0);
    ag.forEach((i) => { this.S.owner[i] = b.id; b.money -= fee(i); });
    bg.forEach((i) => { this.S.owner[i] = a.id; a.money -= fee(i); });
    a.money += bc - ac; b.money += ac - bc;
    this.sfx('buy'); this.log(`صفقة بين ${a.name} و${b.name}`); this.toast('تمت الصفقة');
  }
  /* يعيد {ok, why} */
  async trade(pid, toId, give, get, gc, rc) {
    if (this.S.trade) return { ok: false, why: 'توجد صفقة قيد الانتظار' };
    const pe = this.pend; if (!pe || pe.pid !== pid) return { ok: false, why: 'ليس دورك' };
    const a = this.S.players[pid], b = this.S.players[toId];
    let err = this.tradeCheck(a, b, give, get, gc, rc); if (err) return { ok: false, why: err };
    let ok;
    if (b.bot) { ok = this.evalTrade(b, a, give, get, gc, rc) >= 10; await this.sleep(700); }
    else {
      this.S.trade = { from: pid, to: toId, give, get, gc, rc }; this.sync();
      ok = await this.io.askTrade(toId, this.S.trade);
      this.S.trade = null;
    }
    if (this.dead) return { ok: false, why: 'انتهت اللعبة' };
    if (ok) { err = this.tradeCheck(a, b, give, get, gc, rc); if (err) ok = false; else this.execTrade(a, b, give, get, gc, rc); }
    else this.log(`${b.name} رفض صفقة ${a.name}`);
    this.sync();
    return { ok, why: ok ? null : 'رفض ' + b.name + ' الصفقة' };
  }

  /* ---------- سير اللعب ---------- */
  async animateDice(d) { this.S.rolling = true; this.sfx('roll'); this.sync(); await this.sleep(700); this.S.dice = d; this.S.rolling = false; this.sync(); }
  async rollFor(p, skipAsk) {
    if (!skipAsk) await this.ask(p, { kind: 'roll' }); else if (p.bot) await this.sleep(400);
    const d = [rnd6(), rnd6()];
    await this.animateDice(d);
    this.log(`${p.name} رمى ${d[0]} و ${d[1]}`); this.sync(); await this.sleep(300);
    return d;
  }
  async stepForward(p, n, delay = 130) {
    for (let i = 0; i < n; i++) {
      p.pos = (p.pos + 1) % 40;
      if (p.pos === 0) { p.money += 200; this.sfx('cash'); this.toast(`${p.name} مرّ بالانطلاق: +200`); this.log(`${p.name} استلم 200 من الانطلاق`); } else this.sfx('step');
      this.sync(); await this.sleep(delay);
    }
  }
  advanceTo(p, t, delay) { return this.stepForward(p, (t - p.pos + 40) % 40, delay); }
  async moveBack(p, n) { for (let i = 0; i < n; i++) { p.pos = (p.pos + 39) % 40; this.sfx('step'); this.sync(); await this.sleep(130); } }
  async sendToJail(p) { p.pos = 10; p.inJail = true; p.jailTurns = 0; this.sfx('jail'); this.log(`${p.name} دخل السجن`); this.toast(`${p.name} في السجن`); this.sync(); await this.sleep(600); }
  checkWin() { if (this.alive().length === 1) this.S.over = true; }

  async charge(p, amt, to, why) {
    if (amt <= 0) return true;
    if (p.money < amt) {
      if (p.bot) this.botRaise(p, amt);
      else { const r = await this.ask(p, { kind: 'debt', need: amt, why, to: to ? to.id : null }); if (r === 'bankrupt') { await this.bankrupt(p, to); return false; } }
    }
    if (p.money < amt) { await this.bankrupt(p, to); return false; }
    p.money -= amt;
    if (to) to.money += amt; else if (this.S.opt.jackpot && why === 'tax') this.S.pot += amt;
    this.sfx('pay'); this.toast(to ? `${p.name} دفع ${amt} إلى ${to.name}` : `${p.name} دفع ${amt}`);
    this.sync(); await this.sleep(400);
    return true;
  }
  async bankrupt(p, to) {
    this.owned(p).forEach((i) => {
      const h = this.hs(i);
      if (h) { if (h === 5) this.S.hotelBank++; else this.S.houseBank += h; p.money += Math.floor((SQ[i].h / 2) * h); this.S.houses[i] = 0; }
    });
    p.jailCards.forEach((c) => this[c.type + 'Deck'].push(c.card)); p.jailCards = [];
    const props = this.owned(p);
    if (to) { to.money += p.money; props.forEach((i) => { this.S.owner[i] = to.id; }); }
    else props.forEach((i) => { delete this.S.owner[i]; this.S.mort[i] = false; });
    p.money = 0; p.bankrupt = true;
    this.log(`${p.name} أعلن إفلاسه${to ? ` لصالح ${to.name}` : ''}`);
    this.sfx('jail'); this.toast(`${p.name} أفلس`);
    this.checkWin(); this.sync(); await this.sleep(1500);
  }

  /* ---------- الوصول إلى المربعات ---------- */
  async offerBuy(p, idx) {
    const sq = SQ[idx];
    this.S.focus = { k: 'deed', i: idx, pid: p.id }; this.sync();
    const r = await this.ask(p, { kind: 'buy', idx, price: sq.p });
    this.S.focus = null;
    if (r === 'buy') {
      p.money -= sq.p; this.S.owner[idx] = p.id;
      this.log(`${p.name} اشترى ${sq.n} بـ ${sq.p}`); this.toast(`${p.name} اشترى ${sq.n}`); this.sfx('buy'); this.sync(); await this.sleep(500);
    } else { this.log(`${sq.n} يُعرض في مزاد`); await this.auction(idx, p); }
  }
  async auction(idx, starter) {
    const S = this.S, n = S.players.length, order = []; let k = starter.id;
    for (let c = 0; c < n; c++) { k = (k + 1) % n; if (!S.players[k].bankrupt) order.push(S.players[k]); }
    const out = new Set(); let bid = 0, high = null, ptr = 0, g = 0;
    while (g++ < 600) {
      const left = order.filter((q) => !out.has(q.id));
      if (high && left.length === 1) break; if (!high && left.length === 0) break;
      const q = order[ptr++ % order.length]; if (out.has(q.id) || q === high) continue;
      S.focus = { k: 'auction', i: idx, bid, high: high ? high.id : null, turn: q.id }; this.sync();
      const inc = await this.ask(q, { kind: 'bid', idx, cur: bid, high: high ? high.id : null });
      if (inc > 0 && q.money >= bid + inc) { bid += inc; high = q; this.toast(`${q.name} يعرض ${bid}`); this.sfx('step'); this.log(`${q.name} يعرض ${bid} على ${SQ[idx].n}`); }
      else { out.add(q.id); this.log(`${q.name} انسحب من المزاد`); }
    }
    S.focus = null;
    if (high) { high.money -= bid; S.owner[idx] = high.id; this.log(`${high.name} فاز بـ ${SQ[idx].n} بـ ${bid}`); this.toast(`${high.name} فاز بالمزاد: ${bid}`); this.sfx('buy'); }
    else this.log('لم يزايد أحد، يبقى العقار للبنك');
    this.sync(); await this.sleep(500);
  }
  async landProp(p, sq, tot, o2) {
    const i = p.pos, o = this.S.owner[i];
    if (o === undefined) { await this.offerBuy(p, i); return; }
    if (o === p.id) { this.log(`${p.name} وقف على ملكه`); return; }
    if (this.S.mort[i]) { this.log(`${sq.n} مرهون، لا إيجار`); return; }
    let dice = tot;
    if (sq.t === 'util' && o2.util10) { const d = [rnd6(), rnd6()]; await this.animateDice(d); dice = d[0] + d[1]; }
    const rent = this.calcRent(i, dice, o2), owner = this.S.players[o];
    this.log(`${p.name} يدفع إيجار ${rent} إلى ${owner.name} (${sq.n})`);
    await this.charge(p, rent, owner, 'rent');
  }
  async land(p, tot, o2 = {}) {
    const sq = SQ[p.pos]; this.sync(); await this.sleep(300);
    if (sq.t === 'prop' || sq.t === 'rail' || sq.t === 'util') return this.landProp(p, sq, tot, o2);
    if (sq.t === 'tax') { this.log(`${p.name} يدفع ${sq.n} ${sq.v}`); await this.charge(p, sq.v, null, 'tax'); return; }
    if (sq.t === 'chance' || sq.t === 'chest') return this.drawCard(p, sq.t);
    if (sq.t === 'gotojail') return this.sendToJail(p);
    if (sq.t === 'park' && this.S.opt.jackpot && this.S.pot > 0) { p.money += this.S.pot; this.toast(`${p.name} نال جائزة الوقوف: ${this.S.pot}`); this.log(`${p.name} استلم ${this.S.pot} من الوقوف المجاني`); this.S.pot = 0; this.sfx('cash'); this.sync(); }
  }
  async drawCard(p, type) {
    const deck = this[type + 'Deck'], c = deck.shift();
    if (c.k === 'jailcard') p.jailCards.push({ type, card: c }); else deck.push(c);
    this.log(`${p.name} سحب بطاقة: ${c.t}`);
    this.S.focus = { k: 'card', type, text: c.t, pid: p.id }; this.sync();
    await this.sleep(3200);
    this.S.focus = null; this.sync();
    await this.applyCard(p, c);
  }
  async applyCard(p, c) {
    const others = () => this.S.players.filter((q) => !q.bankrupt && q !== p);
    switch (c.k) {
      case 'collect': p.money += c.v; this.sfx('cash'); this.toast(`${p.name} +${c.v}`); this.sync(); break;
      case 'pay': await this.charge(p, c.v, null, 'card'); break;
      case 'goto': await this.advanceTo(p, c.v, 70); await this.land(p, 0); break;
      case 'nearRail': { const t = RAILS.find((r) => r > p.pos) ?? RAILS[0]; await this.advanceTo(p, t, 70); await this.land(p, 0, { rail2: true }); break; }
      case 'nearUtil': { const t = UTILS.find((r) => r > p.pos) ?? UTILS[0]; await this.advanceTo(p, t, 70); await this.land(p, 0, { util10: true }); break; }
      case 'back': await this.moveBack(p, 3); await this.land(p, 0); break;
      case 'jail': await this.sendToJail(p); break;
      case 'repair': { let h = 0, H = 0; this.owned(p).forEach((i) => { const n = this.hs(i); if (n === 5) H++; else h += n; }); await this.charge(p, h * c.h + H * c.H, null, 'card'); break; }
      case 'payAll': for (const q of others()) { if (p.bankrupt) break; await this.charge(p, c.v, q, 'card'); } break;
      case 'collectAll': for (const q of others()) { if (q.bankrupt) continue; await this.charge(q, c.v, p, 'card'); } break;
      default: break;
    }
  }
  useCard(p) { const c = p.jailCards.pop(); this[c.type + 'Deck'].push(c.card); this.log(`${p.name} استخدم بطاقة الخروج من السجن`); }

  async takeTurn(p) {
    const S = this.S; S.turnNo++; let doubles = 0;
    for (;;) {
      this.sync(); let skip = false;
      if (p.inJail) {
        const a = await this.ask(p, { kind: 'jail' });
        if (a === 'pay') { if (!(await this.charge(p, 50, null, 'jail'))) return; p.inJail = false; p.jailTurns = 0; this.log(`${p.name} دفع 50 وخرج من السجن`); }
        else if (a === 'card') { this.useCard(p); p.inJail = false; p.jailTurns = 0; }
        else skip = true;
      }
      const d = await this.rollFor(p, skip), dbl = d[0] === d[1], tot = d[0] + d[1];
      if (p.inJail) {
        if (dbl) { p.inJail = false; p.jailTurns = 0; this.log(`${p.name} رمى رقمين متشابهين وخرج من السجن`); await this.stepForward(p, tot); await this.land(p, tot); }
        else {
          p.jailTurns++;
          if (p.jailTurns >= 3) { this.log(`${p.name} دفع 50 بعد ثلاث محاولات`); if (!(await this.charge(p, 50, null, 'jail'))) return; p.inJail = false; p.jailTurns = 0; await this.stepForward(p, tot); await this.land(p, tot); }
          else this.log(`${p.name} يبقى في السجن`);
        }
        break;
      }
      if (dbl) { doubles++; if (doubles >= 3) { this.log(`${p.name} رمى ثلاث مرات متتالية`); await this.sendToJail(p); break; } }
      await this.stepForward(p, tot); await this.land(p, tot);
      if (p.bankrupt || S.over) return;
      if (p.inJail) break;
      if (dbl) { this.log(`${p.name} يلعب مرة أخرى`); this.toast('رقمان متشابهان: رمية إضافية'); continue; }
      break;
    }
    if (p.bankrupt || S.over) return;
    await this.ask(p, { kind: 'end' });
    this.sync(); if (p.bot) await this.sleep(300);
  }

  async run() {
    const S = this.S; this.log('بدأت اللعبة'); this.sync();
    while (!this.dead && !S.over) {
      const p = this.cur;
      if (!p.bankrupt) await this.takeTurn(p);
      if (this.dead || S.over) break;
      do { S.cur = (S.cur + 1) % S.players.length; } while (S.players[S.cur].bankrupt);
      this.sync();
    }
    if (this.dead) return;
    const w = this.alive()[0];
    S.winner = w ? w.id : null;
    S.standings = [...S.players].sort((a, b) => this.worth(b) - this.worth(a)).map((p) => ({ id: p.id, worth: this.worth(p), bankrupt: p.bankrupt }));
    S.focus = { k: 'win', pid: S.winner }; this.log(`فاز ${w.name}!`); this.sfx('win'); this.sync();
  }
}

module.exports = { Game, SQ };
