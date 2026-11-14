/* شاشات اللعب على الهاتف: الإجراء، الأملاك، الصفقة، اللوحة، السجل */
(() => {
'use strict';
const { $, esc, send, toast, modal, closeModal } = App;
const SQ = GameData.SQ, GC = GameData.GC, GROUPS = GameData.GROUPS, COLORS = GameData.COLORS;
const fmt = (n) => Number(n).toLocaleString('en-US');
let tab = 'board', sentSeq = null, lastAutoSeq = null;
const tf = { to: null, give: new Set(), get: new Set(), gc: 0, rc: 0 };
App.resetTrade = () => { tf.give.clear(); tf.get.clear(); tf.gc = 0; tf.rc = 0; App.counterCtx = null; App.counterSent = null; };
const ownedOf = (S, id) => Object.keys(S.owner).map(Number).filter((i) => S.owner[i] === id).sort((a, b) => a - b);
const tradableOf = (S, id) => ownedOf(S, id).filter((i) => !SQ[i].g || !GROUPS[SQ[i].g].some((j) => (S.houses[j] || 0) > 0));
const colorOf = (i) => (SQ[i].g ? GC[SQ[i].g] : SQ[i].t === 'rail' ? '#59627a' : '#7a9a98');
const names = (arr) => arr.map((i) => SQ[i].n).join('، ') || 'لا عقارات';
const ICONS = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/></svg>',
  props: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/></svg>',
  trade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h14l-3-3M20 16H6l3 3"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="8" y="8" width="8" height="8"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 6h14M5 12h14M5 18h9"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="3"/></svg>',
};
const TABS = [['board', 'اللوحة'], ['props', 'أملاكي'], ['trade', 'صفقة'], ['chat', 'شات'], ['log', 'السجل'], ['gear', 'إعدادات']];

function ans(v) {
  const p = App.st.prompt; if (!p || sentSeq === p.seq) return;
  sentSeq = p.seq; send({ t: 'ans', v });
  setTimeout(() => { if (sentSeq === p.seq) { sentSeq = null; App.render(); } }, 900);
}

/* رمي النرد بهزّ الهاتف (اختياري من الإعدادات): يعمل فقط عندما يحين طلب الرمي فعلاً */
let lastAcc = null, lastShakeAt = 0;
window.addEventListener('devicemotion', (e) => {
  if (!App.st || App.store.get('sa_shake') !== '1') return;
  const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
  const now = Date.now();
  if (lastAcc) {
    const d = Math.abs(a.x - lastAcc.x) + Math.abs(a.y - lastAcc.y) + Math.abs(a.z - lastAcc.z);
    if (d > 55 && now - lastShakeAt > 1000) {
      lastShakeAt = now;
      const st = App.st;
      if (st.prompt && st.prompt.kind === 'roll' && st.s.cur === st.me && !st.s.over) {
        try { if (App.store.get('sa_vib') !== '0') navigator.vibrate && navigator.vibrate(60); } catch (err) { /* ignore */ }
        ans('roll');
      }
    }
  }
  lastAcc = { x: a.x, y: a.y, z: a.z };
});
window.addEventListener('resize', () => { fitBoard(); });

/* ----- أقسام العرض ----- */
function propsHTML(st, withHint) {
  const S = st.s, can = !!st.prompt;
  if (!st.manage.length) return '<div class="muted" style="text-align:center;padding:14px">لا تملك عقارات بعد.</div>';
  const rows = st.manage.map((m) => {
    const s = SQ[m.i], state = m.mg ? 'مرهون' : s.t === 'prop' ? (m.h === 5 ? 'فندق' : m.h ? `${m.h} بيوت` : 'بلا مبانٍ') : '';
    const bt = [];
    if (s.t === 'prop') { bt.push(`<button class="btn sm" data-act="build" data-i="${m.i}" ${can && m.b ? '' : 'disabled'}>بناء ${s.h}</button>`); bt.push(`<button class="btn sm" data-act="sell" data-i="${m.i}" ${can && m.s ? '' : 'disabled'}>بيع مبنى</button>`); }
    bt.push(m.mg ? `<button class="btn sm" data-act="unmort" data-i="${m.i}" ${can && m.u ? '' : 'disabled'}>فك الرهن ${m.uc}</button>` : `<button class="btn sm" data-act="mort" data-i="${m.i}" ${can && m.m ? '' : 'disabled'}>رهن ${s.p / 2}</button>`);
    bt.push(`<button class="btn sm danger" data-act="sellprop" data-i="${m.i}" ${can && m.sp ? '' : 'disabled'}>بيع العقار للبنك ${m.spv}</button>`);
    return `<div class="prop"><div class="h"><span class="chip" style="background:${colorOf(m.i)}"></span>${esc(s.n)}<span class="st">${state}</span></div><div class="muted" style="font-size:12.5px">${Board.rentText(m.i, S)} — هذا ما يُخصم من الخصم إذا وقف هنا</div><div class="bt">${bt.join('')}</div></div>`;
  }).join('');
  return `${withHint && !can ? '<div class="muted" style="font-size:13px">أزرار الإدارة تعمل في دورك فقط.</div>' : ''}<div style="display:grid;gap:8px">${rows}</div><div class="muted" style="font-size:12px">البيوت المتاحة: ${S.houseBank} · الفنادق المتاحة: ${S.hotelBank}</div>`;
}
function tradeView(st) {
  const S = st.s, me = st.me, can = !App.tradeBusy && !App.counterSent && (!!st.prompt || !!App.counterCtx);
  const others = S.players.filter((q) => q.id !== me && !q.bankrupt);
  if (!others.length) return '<div class="card muted">لا يوجد لاعبون للتبادل معهم.</div>';
  if (tf.to == null || !others.some((q) => q.id === tf.to)) { tf.to = others[0].id; tf.give.clear(); tf.get.clear(); }
  const mine = tradableOf(S, me), theirs = tradableOf(S, tf.to), meP = S.players[me], toP = S.players[tf.to];
  tf.give.forEach((i) => { if (!mine.includes(i)) tf.give.delete(i); }); tf.get.forEach((i) => { if (!theirs.includes(i)) tf.get.delete(i); });
  const list = (arr, set, key) => arr.map((i) => `<label class="pk"><input type="checkbox" data-${key}="${i}" ${set.has(i) ? 'checked' : ''}><span class="pawn" style="background:${colorOf(i)};border-radius:4px;width:13px;height:13px"></span>${esc(SQ[i].n)}${S.mort[i] ? ' (مرهون)' : ''}</label>`).join('') || '<span class="muted" style="font-size:13px">لا عقارات قابلة للتبادل</span>';
  let head = '';
  if (App.counterCtx) { const cp = S.players[App.counterCtx.from]; head = `<div class="focus-note">🤝 تفاوض مع ${esc(cp ? cp.name : '')}: الشروط التالية هي عرضه معكوسة عليك — عدّلها ثم أرسل عرضك المضاد، وله أن يقبل أو يرفض أو يفاوض من جديد.</div><button class="btn" id="tcancel">إلغاء المفاوضة</button>`; }
  else if (App.counterSent) { const cp = S.players[App.counterSent.to]; head = `<div class="focus-note">أرسلت عرضك المضاد إلى ${esc(cp ? cp.name : '')} — بانتظار ردّه.</div>`; }
  const btnLabel = App.counterSent || App.tradeBusy ? 'بانتظار الرد...' : App.counterCtx ? '🤝 أرسل العرض المضاد' : 'اعرض الصفقة';
  return `${head}<div class="card"><label class="f">الطرف الآخر<select id="tto">${others.map((q) => `<option value="${q.id}" ${q.id === tf.to ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select></label>
    <div class="tg"><div class="tcol"><b>تعطي</b>${list(mine, tf.give, 'give')}<label class="f">نقد<input type="number" id="tgc" min="0" max="${meP.money}" value="${tf.gc}" inputmode="numeric"></label></div>
    <div class="tcol"><b>تأخذ من ${esc(toP.name)}</b>${list(theirs, tf.get, 'get')}<label class="f">نقد<input type="number" id="trc" min="0" max="${toP.money}" value="${tf.rc}" inputmode="numeric"></label></div></div>
    <button class="btn primary" id="tgo" ${can ? '' : 'disabled'}>${btnLabel}</button>${st.prompt || App.counterCtx || App.counterSent ? '' : '<span class="muted" style="font-size:13px">الصفقات متاحة في دورك فقط.</span>'}</div>`;
}
/* ----- وسط لوحة الهاتف: كل المعلومات والقرارات داخل اللوحة نفسها ----- */
function centerCardsHTML(st) {
  const S = st.s;
  const propName = (i) => { const h = S.houses[i] || 0; return `${esc(SQ[i].n)}${S.mort[i] ? ' (مرهون)' : h === 5 ? ' (فندق)' : h ? ` (${h})` : ''}`; };
  return `<div class="ccards">${S.players.map((p) => { const own = ownedOf(S, p.id); const kick = st.host && st.me != null && p.id !== st.me && !p.bankrupt && !S.over ? `<button class="ckick ${App.kickArm === p.id ? 'armed' : ''}" data-kick="${p.id}">${App.kickArm === p.id ? 'متأكد؟ اضغط للطرد' : 'طرد'}</button>` : ''; return `<div class="ccard ${p.id === S.cur && !p.bankrupt ? 'cur' : ''} ${p.bankrupt ? 'bk' : ''}"><div class="ph"><span class="pawn" style="background:${p.color}"></span><span class="pname">${esc(p.name)}${p.id === st.me ? ' (أنت)' : ''}${p.inJail ? ' · سجن' : ''}</span><span class="money">${p.bankrupt ? 'مفلس' : fmt(p.money)}</span></div><div class="pn">${own.length ? own.map(propName).join('، ') : 'لا عقارات بعد'}</div>${kick}</div>`; }).join('')}</div>`;
}
function centerDecisionHTML(st) {
  const S = st.s, me = S.players[st.me], p = st.prompt;
  if (S.over) { const w = S.players[S.winner]; return `<div class="cact"><div class="cwin">${S.winner === st.me ? '🏆 مبروك، فزت!' : `الفائز: ${esc(w.name)}`}</div><div class="crow2">${st.host ? '<button class="cbtn pri" data-new="1">لعبة جديدة</button>' : ''}<button class="cbtn" data-leave="1">مغادرة</button></div></div>`; }
  if (st.me == null) return `<div class="cact"><div class="cnote">${App.pendingRejoin ? '⏳ طلب عودتك عند المضيف — بانتظار موافقته لتعود إلى اللعب' : '👁 أنت مشاهد في هذه اللعبة — بدأت قبل انضمامك'}</div></div>`;
  if (me.bankrupt) return '<div class="cact"><div class="cnote">خرجت من اللعبة — تابع اللوحة حتى النهاية</div></div>';
  if (!p) { const pend = S.pending, w = pend ? S.players[pend.pid] : null; return w ? `<div class="cact"><div class="cnote">بانتظار ${esc(w.name)}...</div></div>` : ''; }
  const dis = sentSeq === p.seq;
  const b = (v, label, cls, off) => `<button class="cbtn ${cls || ''}" data-ans="${v}" ${off || dis ? 'disabled' : ''}>${label}</button>`;
  if (p.kind === 'roll') return `<div class="cact">${b('roll', 'ارمِ النرد 🎲', 'pri')}</div>`;
  if (p.kind === 'end') return `<div class="cact">${b('end', 'إنهاء الدور ✓', 'pri')}</div>`;
  if (p.kind === 'buy') return `<div class="cact"><div class="cq">تشتري ${esc(SQ[p.idx].n)} بـ ${p.price}؟</div><div class="crow2">${b('buy', 'اشترِ', 'pri', me.money < p.price)}${b('auction', 'مزاد')}</div><div class="cnote">المس المربع لعرض صك الملكية كاملاً</div></div>`;
  if (p.kind === 'jail') return `<div class="cact"><div class="cq">أنت في السجن</div><div class="crow2">${b('pay', 'ادفع 50', '', me.money < 50)}${b('card', 'بطاقة الخروج', '', !me.jc)}${b('roll', 'ارمِ النرد', 'pri')}</div></div>`;
  if (p.kind === 'bid') { const hi = p.high != null ? S.players[p.high] : null; return `<div class="cact"><div class="cq">مزاد ${esc(SQ[p.idx].n)}: <b>${p.cur}</b>${hi ? ` · الأعلى ${esc(hi.name)}` : ''}</div><div class="crow2">${[10, 50, 100].map((n) => b(n, `+${n}`, 'pri', me.money < p.cur + n)).join('')}${b(0, 'انسحب')}</div></div>`; }
  if (p.kind === 'debt') return `<div class="cact"><div class="cq bad">عليك دفع ${fmt(p.need)} — رصيدك ${fmt(me.money)}</div><div class="crow2">${b('pay', `ادفع ${fmt(p.need)}`, 'pri', me.money < p.need)}${b('bankrupt', 'إفلاس', 'dgr')}</div><div class="cnote">اجمع المبلغ من تبويب «أملاكي»: بيع مبانٍ أو رهن أو بيع للبنك</div></div>`;
  return '';
}
function centerHTMLPhone(st) {
  const S = st.s, cur = S.players[S.cur], f = S.focus;
  let h = `<h1 class="ctitle">سيد العقار</h1><div class="turn"><span class="pawn" style="background:${cur.color}"></span><span>دور ${esc(cur.name)}</span></div>${Board.diceHTML(S)}${centerCardsHTML(st)}`;
  if (f && f.k === 'card') h += `<div class="cnote">${esc(S.players[f.pid].name)} سحب ${f.type === 'chance' ? 'فرصة' : 'صندوق المجتمع'}: ${esc(f.text)}</div>`;
  return h + `${centerDecisionHTML(st)}<div class="msg">${esc(S.log[0] || '')}</div>`;
}
const orientMode = () => App.store.get('sa_orient') || 'auto';
/* تنسيق واحد لكل الاتجاهات: اللوحة وحدها على الشاشة وكل المعلومات والقرارات في وسطها */
function boardView(st) {
  return `<div class="boardwrap fit o-${orientMode()}"><div class="bdbox"><div id="bd"></div></div></div>`;
}
function paintBoard(st) {
  Board.render($('#bd'), st.s, centerHTMLPhone(st));
  fitBoard();
}
/* اللوحة بمقاس الشاشة تماماً في الوضعين: الأصغر من العرض المتاح والارتفاع المتاح */
function fitBoard() {
  const wrap = $('.boardwrap'), bd = $('#bd'); if (!wrap || !bd) return;
  const box = bd.parentElement;
  const hdr = $('#hdr'), tabs = $('#tabs');
  const wide = window.innerWidth > window.innerHeight && window.innerHeight <= 540;
  const avail = window.innerHeight - (hdr ? hdr.offsetHeight : 0) - (!wide && tabs && !tabs.hidden ? tabs.offsetHeight : 0) - (wide ? 8 : 2);
  wrap.style.height = Math.max(190, avail) + 'px';
  bd.classList.toggle('wide', wide);
  /* مربعة دائماً (aspect-ratio في CSS): المقاس = الأصغر من العرض والارتفاع المتاحين */
  bd.style.height = ''; bd.style.width = Math.max(100, Math.min(box.clientWidth, box.clientHeight)) + 'px';
}
function logView(S) { return `<div class="card"><div class="log">${S.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div></div>`; }

/* ----- الإعدادات ----- */
function settingsView(st) {
  const snd = App.store.get('sa_mute') !== '1', vib = App.store.get('sa_vib') !== '0', shk = App.store.get('sa_shake') === '1';
  const spd = App.speedV || 'normal';
  return `<div class="card"><b>إعدادات اللعبة</b>
  <div class="opts" style="display:grid;gap:12px">
    <label><input type="checkbox" id="set-snd" ${snd ? 'checked' : ''}> المؤثرات الصوتية</label>
    <label><input type="checkbox" id="set-vib" ${vib ? 'checked' : ''}> اهتزاز الهاتف عند حلول دوري</label>
    <label><input type="checkbox" id="set-shake" ${shk ? 'checked' : ''}> رمي النرد بهزّ الهاتف — هزّ هاتفك عندما يحين رميك</label>
  </div>
  <label class="f">اتجاه عرض شاشة اللوحة<select id="set-orient">${[['auto', 'تلقائي (حسب وضع الجهاز)'], ['portrait', 'عمودي Portrait'], ['landscape', 'أفقي Landscape']].map(([v, l]) => `<option value="${v}" ${(App.store.get('sa_orient') || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  ${st.host ? `<label class="f">سرعة اللعبة (أنت المضيف — تنطبق على الجميع فوراً)<select id="set-speed"><option value="slow" ${spd === 'slow' ? 'selected' : ''}>بطيئة</option><option value="normal" ${spd === 'normal' ? 'selected' : ''}>عادية</option><option value="fast" ${spd === 'fast' ? 'selected' : ''}>سريعة</option><option value="turbo" ${spd === 'turbo' ? 'selected' : ''}>خاطفة (بدون انتظار)</option></select></label>` : '<div class="muted" style="font-size:13px">سرعة اللعبة يضبطها المضيف من إعداداته.</div>'}
  <div class="muted" style="font-size:13px">الرصيد الابتدائي وجائزة الوقوف المجاني يضبطهما المضيف من الردهة قبل بدء اللعبة.</div>
  <div class="muted">غرفة <bdi dir="ltr">${esc(st.code)}</bdi></div>
  <button class="btn danger" data-leave="1">مغادرة الغرفة</button></div>`;
}

/* ----- الشات الكتابي: خانة منفصلة ----- */
const chatLine = (c, me) => `<div class="cm2 ${c.id === me ? 'mine' : ''}"><b style="color:${COLORS[c.id] || 'var(--ink)'}">${esc(c.n)}${c.id === me ? ' (أنت)' : ''}:</b>${esc(c.m)}</div>`;
function chatView(st) {
  const list = App.chat.length ? App.chat.map((c) => chatLine(c, st.me)).join('') : '<div class="muted" style="text-align:center;padding:12px">لا رسائل بعد. اكتب أول رسالة!</div>';
  if (st.me == null) return `<div class="card"><b>شات الغرفة</b><div class="cmsg" id="cmsg">${list}</div><div class="muted" style="font-size:13px;text-align:center">المشاهدون يتابعون فقط ولا يستطيعون الكتابة.</div></div>`;
  return `<div class="card"><b>شات الغرفة</b><div class="cmsg" id="cmsg">${list}</div><div class="crow"><input type="text" id="cin" maxlength="300" placeholder="اكتب رسالة للاعبين..." autocomplete="off"><button class="btn primary" id="csend">إرسال</button></div></div>`;
}
function sendChat() {
  const inp = $('#cin'); if (!inp) return;
  const text = inp.value.replace(/\s+/g, ' ').trim(); if (!text) return;
  send({ t: 'chat', m: text }); inp.value = ''; inp.focus();
}
App.onChat = (e) => {
  App.chat.push({ id: e.id, n: e.n, m: e.m }); if (App.chat.length > 80) App.chat.splice(0, App.chat.length - 80);
  const box = $('#cmsg');
  if (tab === 'chat' && box) { box.insertAdjacentHTML('beforeend', chatLine({ id: e.id, n: e.n, m: e.m }, App.st ? App.st.me : -1)); box.scrollTop = box.scrollHeight; }
  else { App.chatUnread = (App.chatUnread || 0) + 1; App.render(); }
};

/* ----- الرسم الرئيسي ----- */
App.renderGame = function renderGame() {
  const st = App.st, S = st.s, me = st.me != null ? S.players[st.me] : null;
  if (!$('#hdr')) {
    App.root.innerHTML = '<div class="top" id="hdr"></div><div id="view"></div>';
    $('#view').addEventListener('click', onViewClick);
    $('#view').addEventListener('change', onViewChange);
    $('#view').addEventListener('input', onViewInput);
    $('#view').addEventListener('keydown', (e) => { if (e.target.id === 'cin' && e.key === 'Enter') { e.preventDefault(); sendChat(); } });
  }
  $('#hdr').innerHTML = me ? `<span class="pawn" style="background:${me.color}"></span><b>${esc(me.name)}</b><span class="code">غرفة ${esc(st.code)}</span><span class="money">${fmt(me.money)}</span>` : `<span class="pawn" style="background:#8a97ad"></span><b>مشاهد</b><span class="code">غرفة ${esc(st.code)}</span><span class="money">👁</span>`;
  const p = st.prompt;
  if (p && p.seq !== lastAutoSeq) { lastAutoSeq = p.seq; if (['roll', 'buy', 'bid', 'jail', 'debt'].includes(p.kind)) tab = 'board'; }
  if (S.over) tab = 'board';
  const myTabs = me ? TABS : TABS.filter(([k]) => ['board', 'chat', 'log'].includes(k));
  if (!myTabs.some(([k]) => k === tab)) tab = 'board';
  $('#tabs').innerHTML = myTabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${ICONS[k]}${l}${k === 'board' && p && tab !== 'board' ? '<span class="dot"></span>' : ''}${k === 'chat' && App.chatUnread > 0 && tab !== 'chat' ? '<span class="dot"></span>' : ''}</button>`).join('');
  const v = $('#view'), ae = document.activeElement;
  const typing = ae && v.contains(ae) && ((tab === 'trade' && (ae.tagName === 'INPUT' && ae.type !== 'checkbox' || ae.tagName === 'SELECT')) || (tab === 'chat' && ae.id === 'cin'));
  if (!typing) {
    if (tab === 'props') v.innerHTML = `<div class="card"><b>أملاكي</b>${propsHTML(st, true)}</div>`;
    else if (tab === 'trade') v.innerHTML = tradeView(st);
    else if (tab === 'gear') v.innerHTML = settingsView(st);
    else if (tab === 'chat') { v.innerHTML = chatView(st); const box = $('#cmsg'); if (box) box.scrollTop = box.scrollHeight; }
    else if (tab === 'log') v.innerHTML = logView(S);
    else { v.innerHTML = boardView(st); paintBoard(st); }
  } else if (tab === 'board') paintBoard(st);
  /* عرض صفقة واردة (مع خيار المفاوضة بعرض مضاد) */
  const inc = S.trade && S.trade.to === st.me ? S.trade : null;
  if (!S.trade) App.counterSent = null;
  if (!inc) { App.tradeDismiss = null; App.counterCtx = null; }
  if (inc && App.counterSent) App.counterSent = null;
  if (inc) {
    const key = 'tin' + JSON.stringify(inc);
    if (App.modalKey !== key && App.tradeDismiss !== key) {
      App.modalKey = key; const from = S.players[inc.from];
      modal(`<h2>${inc.counter ? 'عرض مضاد' : 'عرض صفقة'} من ${esc(from.name)}</h2><div class="card" style="margin:0"><div><b>يعطيك:</b> ${esc(names(inc.give))}${inc.gc ? ` + ${fmt(inc.gc)} نقداً` : ''}</div><div><b>ويأخذ منك:</b> ${esc(names(inc.get))}${inc.rc ? ` + ${fmt(inc.rc)} نقداً` : ''}</div></div><div class="row"><button class="btn" data-tr="0">ارفض</button><button class="btn" data-tr="2">🤝 مفاوضة</button><button class="btn primary" data-tr="1">اقبل</button></div>`, 'trade');
    }
  } else if (App.modalKey && App.modalKey.startsWith('tin')) closeModal();
  /* طلب عودة لاعب خرج من اللعبة: قرار المضيف (لا يزاحم نافذة صفقة مفتوحة) */
  const rj = st.host ? st.rejoin : null;
  if (!rj) App.rejoinDismiss = null;
  if (rj && !inc) {
    const key = 'rejoin' + rj.id + ':' + rj.name;
    if (App.modalKey !== key && App.rejoinDismiss !== key) {
      App.modalKey = key;
      modal(`<h2>🔔 طلب عودة إلى اللعبة</h2><div class="card" style="margin:0"><b>${esc(rj.name)}</b> خرج من اللعبة ويطلب العودة إلى اللعب.</div><div class="row"><button class="btn" data-rj="0">رفض</button><button class="btn" data-rj="later">لاحقاً</button><button class="btn primary" data-rj="1">إرجاع للعب</button></div>`);
    }
  } else if (App.modalKey && App.modalKey.startsWith('rejoin')) closeModal();
};

function onViewClick(e) {
  const t = e.target;
  let el = t.closest('[data-ans]'); if (el) return ans(el.dataset.ans === '' ? '' : (isNaN(el.dataset.ans) ? el.dataset.ans : Number(el.dataset.ans)));
  el = t.closest('[data-kick]'); if (el) {
    /* طرد المضيف أثناء اللعب: نقرة أولى للتأكيد وثانية للتنفيذ */
    const id = +el.dataset.kick;
    if (App.kickArm !== id) { App.kickArm = id; App.render(); setTimeout(() => { if (App.kickArm === id) { App.kickArm = null; App.render(); } }, 2800); return; }
    App.kickArm = null; send({ t: 'kick', id }); return;
  }
  el = t.closest('[data-act]'); if (el) {
    /* بيع العقار للبنك لا رجعة فيه: أول نقرة للتأكيد والثانية للتنفيذ */
    if (el.dataset.act === 'sellprop' && el.dataset.armed !== '1') {
      el.dataset.armed = '1'; el.textContent = 'متأكد؟ اضغط مجدداً للبيع للبنك'; el.classList.remove('danger'); el.classList.add('primary');
      setTimeout(() => { if (el.isConnected) App.render(); }, 2800);
      return;
    }
    return send({ t: 'act', a: el.dataset.act, i: +el.dataset.i });
  }
  if (t.closest('[data-new]')) return send({ t: 'again' });
  if (t.closest('[data-leave]')) { send({ t: 'leave' }); App.room = null; App.store.del('sa_room'); App.st = null; App.lobby = null; App.render(); return; }
  if (t.closest('#tcancel')) { App.counterCtx = null; App.resetTrade(); App.render(); return; }
  if (t.closest('#tgo')) {
    const gc = Math.max(0, Math.floor(tf.gc) || 0), rc = Math.max(0, Math.floor(tf.rc) || 0);
    if (App.counterCtx) {
      send({ t: 'tradeReply', counter: true, terms: { give: [...tf.give], get: [...tf.get], gc, rc } });
      App.counterSent = { to: tf.to }; App.counterCtx = null; toast('أُرسل عرضك المضاد'); App.render(); return;
    }
    send({ t: 'trade', to: tf.to, give: [...tf.give], get: [...tf.get], gc, rc });
    App.tradeBusy = true; App.render(); return;
  }
  if (t.closest('#csend')) { sendChat(); return; }

  const cell = t.closest('#bd .cell');
  if (cell) { const i = +cell.dataset.i; App.modalKey = 'deed'; modal(`<div class="deedwrap" style="max-width:100%">${Board.deedHTML(i, App.st.s)}</div><button class="btn" data-close="1">إغلاق</button>`); }
}
function onViewChange(e) {
  const t = e.target;
  if (t.id === 'set-snd') { App.store.set('sa_mute', t.checked ? '0' : '1'); Sfx.setMuted(!t.checked); return; }
  if (t.id === 'set-vib') { App.store.set('sa_vib', t.checked ? '1' : '0'); return; }
  if (t.id === 'set-shake') {
    if (t.checked && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().then((r) => {
        if (r === 'granted') { App.store.set('sa_shake', '1'); toast('هزّ الهاتف مفعّل'); }
        else { t.checked = false; App.store.set('sa_shake', '0'); toast('يلزم السماح بحسّاس الحركة من المتصفح'); }
      }).catch(() => { t.checked = false; });
    } else App.store.set('sa_shake', t.checked ? '1' : '0');
    return;
  }
  if (t.id === 'set-speed') { App.speedV = t.value; App.store.set('sa_speed', t.value); send({ t: 'speed', v: t.value }); return; }
  if (t.id === 'set-orient') { App.store.set('sa_orient', t.value); App.render(); return; }
  if (t.id === 'tto') { tf.to = +t.value; tf.get.clear(); if (App.counterCtx && App.counterCtx.from !== tf.to) App.counterCtx = null; App.render(); }
  else if (t.dataset.give !== undefined) { (t.checked ? tf.give.add(+t.dataset.give) : tf.give.delete(+t.dataset.give)); }
  else if (t.dataset.get !== undefined) { (t.checked ? tf.get.add(+t.dataset.get) : tf.get.delete(+t.dataset.get)); }
}
function onViewInput(e) { if (e.target.id === 'tgc') tf.gc = +e.target.value || 0; else if (e.target.id === 'trc') tf.rc = +e.target.value || 0; }
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; if (tab === 'chat') App.chatUnread = 0; App.render(); window.scrollTo(0, 0); } });
$('#modal').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) { if (e.target.id === 'modal' && App.modalKey === 'deed') closeModal(); return; }
  if (b.dataset.close) closeModal();
  else if (b.dataset.rj !== undefined) {
    if (b.dataset.rj === 'later') App.rejoinDismiss = App.modalKey;
    else send({ t: 'rejoinReply', ok: b.dataset.rj === '1' });
    closeModal(); App.modalKey = null; App.render();
  }
  else if (b.dataset.tr === '2') {
    const S = App.st.s, inc = S.trade && S.trade.to === App.st.me ? S.trade : null;
    if (inc) {
      App.tradeDismiss = 'tin' + JSON.stringify(inc);
      App.counterCtx = { from: inc.from };
      tf.to = inc.from; tf.give = new Set(inc.get); tf.get = new Set(inc.give); tf.gc = inc.rc; tf.rc = inc.gc;
      tab = 'trade'; toast('عدّل شروط العرض المضاد ثم أرسله');
    }
    closeModal(); App.modalKey = null; App.render();
  }
  else if (b.dataset.tr !== undefined) { send({ t: 'tradeReply', ok: b.dataset.tr === '1' }); const S = App.st.s, k = S.trade && S.trade.to === App.st.me ? 'tin' + JSON.stringify(S.trade) : 'tin-done'; closeModal(); App.modalKey = k; }
});
})();
