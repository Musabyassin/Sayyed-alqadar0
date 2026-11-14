/* وحدة تحكم الهاتف: الاتصال والانضمام والردهة. شاشات اللعب في play-game.js */
(() => {
'use strict';
const $ = (s, r) => (r || document).querySelector(s), esc = Board.esc, COLORS = GameData.COLORS;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
const qCode = (new URLSearchParams(location.search).get('c') || '').replace(/\D/g, '').slice(0, 4);
let room = null; try { room = JSON.parse(store.get('sa_room') || 'null'); } catch (e) { room = null; }
const App = window.App = { st: null, lobby: null, me: null, tab: 'board', room, root: $('#root'), $, esc, store, lastSeq: null, chat: [], chatUnread: 0, speedV: store.get('sa_speed') || 'normal' };
try { if (store.get('sa_mute') === '1') Sfx.setMuted(true); } catch (e) { /* ignore */ }

function send(o) { return net.send(o); }
function toast(m) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; const box = $('#toasts'); box.appendChild(t);
  while (box.children.length > 2) box.firstChild.remove(); setTimeout(() => t.remove(), 2600);
}
function modal(html, cls) { const m = $('#modal'); m.className = 'overlay' + (cls ? ' ' + cls : ''); m.innerHTML = `<div class="sheet${cls ? ' ' + cls : ''}" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; m.className = 'overlay'; App.modalKey = null; }
Object.assign(App, { send, toast, modal, closeModal });

const net = Net.connect({
  onOpen() { if (App.room) send({ t: 'join', code: App.room.code, token: App.room.token, name: store.get('sa_name') || 'لاعب', spectator: App.room.spectator || undefined }); },
  onStatus(s) { $('#conn').hidden = s === 'open'; },
  onMsg(m) {
    if (m.t === 'joined') {
      if (m.spectator) { App.spectator = true; App.pendingRejoin = !!m.pending; App.me = null; App.room = { code: m.code, spectator: true }; store.set('sa_room', JSON.stringify(App.room)); store.set('sa_name', m.name); toast(m.pending ? 'أُرسل طلب عودتك إلى المضيف — بانتظار موافقته' : 'دخلت كمشاهد — اللعبة بدأت بالفعل'); }
      else { App.spectator = false; App.pendingRejoin = false; App.room = { code: m.code, token: m.token }; store.set('sa_room', JSON.stringify(App.room)); store.set('sa_name', m.name); App.me = m.id; }
    }
    else if (m.t === 'lobby') { App.lobby = m; App.st = null; App.me = m.me === undefined ? null : m.me; }
    else if (m.t === 'state') {
      App.st = m; App.lobby = null; App.me = m.me === undefined ? null : m.me; App.spectator = !!m.spectator; App.pendingRejoin = !!m.pending;
      const seq = m.prompt ? m.prompt.seq : null;
      if (seq && seq !== App.lastSeq) { try { if (store.get('sa_vib') !== '0') navigator.vibrate && navigator.vibrate(m.prompt.kind === 'roll' ? [120, 60, 120] : 90); } catch (e) { /* ignore */ } }
      App.lastSeq = seq;
    }
    else if (m.t === 'chatHist') { App.chat = Array.isArray(m.list) ? m.list.slice(-50) : []; if (App.st) render(); return; }
    else if (m.t === 'ev') { if (m.e.e === 'chat') { if (App.onChat) App.onChat(m.e); } else if (m.e.e === 'sfx') { if (!(App.st && App.st.tv)) Sfx.play(m.e.n); } else if (m.e.e === 'toast') toast(m.e.m); return; }
    else if (m.t === 'tradeResult') { App.tradeBusy = false; toast(m.ok ? 'تمت الصفقة' : m.why || 'لم تتم الصفقة'); if (m.ok && App.resetTrade) App.resetTrade(); }
    else if (m.t === 'err') { toast(m.m); if (m.fatal) { App.room = null; store.del('sa_room'); App.st = null; App.lobby = null; } }
    else if (m.t === 'kicked') { App.room = null; store.del('sa_room'); App.st = null; App.lobby = null; toast(m.m || 'تم إخراجك من الغرفة'); }
    else return;
    render();
  },
});
['click', 'touchstart'].forEach((ev) => addEventListener(ev, () => Sfx.unlock(), { once: true }));

let raf = 0;
function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
App.render = render;
function paint() {
  const inGame = !!App.st, inLobby = !!App.lobby;
  $('#tabs').hidden = !inGame;
  if (inGame && App.renderGame) App.renderGame();
  else if (inLobby) renderLobby();
  else renderJoin();
}

function renderJoin() {
  closeModal();
  const nm = store.get('sa_name') || '';
  if (App.joinKey === 'join') { const c = $('#code'); if (c && document.activeElement === c) return; if (document.activeElement && document.activeElement.id === 'name') return; }
  App.joinKey = 'join';
  App.root.innerHTML = `<div class="join"><h1>سيد العقار</h1><p class="muted">أدخل كود الغرفة الظاهر على الشاشة، أو أنشئ غرفة جديدة وادعُ أصدقاءك بالكود.</p>
    <div class="card"><label class="f">كود الغرفة<input type="text" id="code" class="codein" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" value="${esc(qCode)}" placeholder="0000"></label>
    <label class="f">اسمك<input type="text" id="name" maxlength="14" autocomplete="nickname" value="${esc(nm)}" placeholder="اكتب اسمك"></label>
    <button class="btn primary" id="join">انضمام</button></div>
    <div class="card"><b>ستلعب عن بعد مع أصدقاء؟</b><span class="muted">أنشئ غرفة بدون تلفاز، وسيظهر لك الكود لمشاركته. تظهر اللوحة على هاتفك.</span><button class="btn" id="create">إنشاء غرفة جديدة</button></div></div>`;
  const name = () => ($('#name').value.trim() || '').slice(0, 14);
  $('#join').onclick = () => {
    const code = $('#code').value.replace(/\D/g, '');
    if (code.length !== 4) return toast('أدخل كود من 4 أرقام');
    if (!name()) return toast('اكتب اسمك أولاً');
    store.set('sa_name', name()); send({ t: 'join', code, name: name() });
  };
  $('#create').onclick = () => { if (!name()) return toast('اكتب اسمك أولاً'); store.set('sa_name', name()); send({ t: 'create', role: 'phone', name: name() }); };
  $('#code').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); if (e.target.value.length === 4 && name()) $('#join').focus(); };
}

function renderLobby() {
  App.joinKey = null; closeModal();
  const L = App.lobby, me = L.players[L.me], host = !!(me && me.host), full = L.players.length >= 6;
  const link = `${location.origin}/play/?c=${L.code}`;
  App.root.innerHTML = `<div class="join"><h1>الردهة</h1><div class="card"><div class="muted" style="text-align:center">كود الغرفة</div><div class="bigcode">${esc(L.code)}</div>
    <input type="text" id="link" readonly value="${esc(link)}" dir="ltr" style="font-size:13px;height:42px"><button class="btn sm" id="copy" style="width:100%">نسخ رابط الدعوة</button></div>
    <div class="card"><b>اللاعبون (${L.players.length} من 6)</b><div class="plist">${L.players.map((p) => `<div class="pitem"><span class="pawn" style="background:${COLORS[p.id]}"></span>${esc(p.name)}${p.id === L.me ? ' (أنت)' : ''}<small>${p.bot ? 'آلي' : p.host ? 'المضيف' : p.connected ? '' : 'غير متصل'}</small>${host && p.id !== L.me ? `<button class="btn sm" data-kick="${p.id}" aria-label="إزالة ${esc(p.name)}">إزالة</button>` : ''}</div>`).join('')}</div>
    ${host ? `<button class="btn" id="bot" ${full ? 'disabled' : ''}>إضافة لاعب آلي</button>
      <div class="opts"><label>الرصيد الابتدائي <select id="cash">${[1000, 1500, 2000, 3000].map((v) => `<option ${v === L.cfg.cash ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>سرعة اللعبة <select id="spd">${[['slow', 'بطيئة'], ['normal', 'عادية'], ['fast', 'سريعة'], ['turbo', 'خاطفة']].map(([v, l]) => `<option value="${v}" ${v === App.speedV ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label><input type="checkbox" id="jack" ${L.cfg.jackpot ? 'checked' : ''}> جائزة الوقوف المجاني</label></div>
      <button class="btn primary" id="start" ${L.players.length < 2 ? 'disabled' : ''}>ابدأ اللعبة</button>
      ${L.players.length < 2 ? '<span class="muted">يلزم لاعبان على الأقل. أضف لاعباً آلياً أو انتظر صديقاً.</span>' : ''}`
    : '<div class="muted" style="text-align:center;padding:8px">بانتظار المضيف ليبدأ اللعبة...</div>'}</div>
    <button class="btn" id="leave">مغادرة الغرفة</button></div>`;
  $('#copy').onclick = () => { const i = $('#link'); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('تم النسخ'), () => { try { document.execCommand('copy'); toast('تم النسخ'); } catch (e) { toast('انسخ الرابط يدوياً'); } }); };
  $('#leave').onclick = () => { send({ t: 'leave' }); App.room = null; store.del('sa_room'); App.lobby = null; render(); };
  document.querySelectorAll('[data-kick]').forEach((b) => { b.onclick = () => send({ t: 'kick', id: +b.dataset.kick }); });
  if (host) {
    $('#bot').onclick = () => send({ t: 'addBot' });
    $('#start').onclick = () => send({ t: 'start' });
    const cfg = () => send({ t: 'cfg', cash: +$('#cash').value, jackpot: $('#jack').checked });
    $('#cash').onchange = cfg; $('#jack').onchange = cfg;
    $('#spd').onchange = () => { App.speedV = $('#spd').value; store.set('sa_speed', App.speedV); send({ t: 'speed', v: App.speedV }); };
  }
}
render();
/* تحديث تلقائي: إن تغيّر رقم إصدار الموقع يعيد الهاتف تحميل الصفحة ليظهر
   أي تحديث دون انتظار إعادة فتح التطبيق (الجلسة تُستأنف برمزها المحفوظ). */
let appVer = null;
async function checkVersion() {
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    const j = await r.json();
    if (appVer === null) { appVer = j.v; return; }
    if (j.v !== appVer) { toast('تحديث جديد — جارٍ تحديث الصفحة...'); setTimeout(() => location.reload(), 1200); }
  } catch (e) { /* بلا اتصال: يعيد المحاولة في الجولة التالية */ }
}
checkVersion(); setInterval(checkVersion, 30000);
})();
