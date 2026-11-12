/* رسم اللوحة والنرد وصك الملكية، مشترك بين التلفاز والهاتف. */
(function (root) {
  const D = root.GameData, SQ = D.SQ, GC = D.GC;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = {
    rail: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="14" height="13" rx="3"/><rect x="7.5" y="6" width="9" height="4" rx="1" fill="var(--cell)"/><circle cx="9" cy="19.5" r="1.8"/><circle cx="15" cy="19.5" r="1.8"/></svg>',
    util: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 10-13h-6z"/></svg>',
    chance: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">?</text></svg>',
    chest: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18M12 8v12M5 8a7 5 0 0 1 14 0"/></svg>',
    tax: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 15l6-6"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/></svg>',
    jail: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M12 3v18M16 3v18"/></svg>',
    park: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">P</text></svg>',
    go: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 12H5M11 6l-6 6 6 6"/></svg>',
    gotojail: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M16 3v18M3 12h18"/></svg>',
  };
  function cellPos(i) {
    if (i <= 10) return { r: 11, c: 11 - i, s: i === 0 || i === 10 ? 'x' : 'b' };
    if (i < 20) return { r: 21 - i, c: 1, s: 'l' };
    if (i <= 30) return { r: 1, c: i - 19, s: i === 20 || i === 30 ? 'x' : 't' };
    return { r: i - 29, c: 11, s: 'r' };
  }
  function cellHTML(i, S) {
    const s = SQ[i], pos = cellPos(i), corner = pos.s === 'x', sp = ['chance', 'chest', 'tax'].includes(s.t);
    const h = S.houses[i] || 0;
    let band = '', inner = '';
    if (s.t === 'prop') {
      band = `<div class="band" style="background:${GC[s.g]}">${h === 5 ? '<span class="hs ht"></span>' : '<span class="hs"></span>'.repeat(h)}</div>`;
      inner = `<div class="nm">${s.n}</div><div class="pr">${s.p}</div><div class="rn">${rentText(i, S)}</div>`;
    } else if (s.t === 'rail' || s.t === 'util') inner = `${ICON[s.t]}<div class="nm">${s.n}</div><div class="pr">${s.p}</div><div class="rn">${rentText(i, S)}</div>`;
    else if (s.t === 'tax') inner = `${ICON.tax}<div class="nm">${s.n}</div><div class="pr">${s.v}</div>`;
    else inner = `${ICON[s.t]}<div class="nm">${s.n}</div>`;
    const o = S.owner[i];
    /* مالك العقار: إطار صلب بلون اللاعب حول المربع كله فقط — بلا أي دائرة.
       عنصر مستقل فوق الشريط والنص (الظل الداخلي كان الشريط يغطيه من جهة)،
       والدائرة الحمراء في وسط المربع ليست شارة مالك بل قطعة اللاعب الواقف عليه. */
    const fr = o !== undefined ? `<span class="ofr" style="border-color:${S.players[o].color}" title="${esc(S.players[o].name)}"></span>` : '';
    /* قطعة اللاعب على اللوحة: سيارة صغيرة بلون اللاعب (SVG ملوّن بلونه). */
    const carSVG = (p) => `<svg viewBox="0 0 26 14" aria-hidden="true"><path d="M3 11 V7.5 Q3 6 4.5 6 H8 L10 3 Q10.4 2.4 11.2 2.4 H15.6 Q16.4 2.4 16.8 3 L18.6 6 H22 Q23 6 23 7 V11 Q23 11.6 22.4 11.6 H3.6 Q3 11.6 3 11 Z" fill="${p.color}" stroke="rgba(0,0,0,.45)" stroke-width=".7"/><path d="M11.2 3.6 H15.2 L16.4 5.2 H10.6 Z" fill="rgba(255,255,255,.9)"/><circle cx="8" cy="11.4" r="1.9" fill="#1c1c1c" stroke="#fff" stroke-width=".6"/><circle cx="18.5" cy="11.4" r="1.9" fill="#1c1c1c" stroke="#fff" stroke-width=".6"/></svg>`;
    const tks = S.players.filter((p) => !p.bankrupt && p.pos === i).map((p) => `<span class="pawn ${p.id === S.cur ? 'me' : ''} ${p.inJail ? 'jailed' : ''}" title="${esc(p.name)}">${carSVG(p)}</span>`).join('');
    const extra = i === 20 && S.opt.jackpot && S.pot > 0 ? `<div class="pr">${S.pot}</div>` : '';
    return `<div class="cell s-${pos.s} ${corner ? 'corner' : ''} ${sp ? 'sp' : ''} ${S.mort[i] ? 'mg' : ''}" data-i="${i}" style="grid-row:${pos.r};grid-column:${pos.c};">${band}<div class="body">${inner}${extra}</div>${fr}<div class="tk">${tks}</div></div>`;
  }
  /* الإيجار الحالي الذي سيُخصم فعلياً لو وقف خصم على هذا المربع الآن.
     يطابق منطق calcRent في محرك الخادم (ما عدا مضاعفات بطاقات الفرصة المؤقتة).
     للمرافق يعتمد الإيجار على رمية النرد فيُعرض كمضاعف. */
  const RAIL_RENT = [25, 50, 100, 200];
  function rentText(i, S) {
    const s = SQ[i];
    if (!S || !['prop', 'rail', 'util'].includes(s.t)) return '';
    const o = S.owner[i];
    if (o !== undefined && S.mort[i]) return 'مرهون · لا إيجار';
    if (s.t === 'prop') {
      const h = S.houses[i] || 0;
      if (h > 0) return `إيجار ${s.r[h]}`;
      const full = o !== undefined && (D.GROUPS[s.g] || []).every((j) => S.owner[j] === o);
      return `إيجار ${s.r[0] * (full ? 2 : 1)}`;
    }
    if (s.t === 'rail') {
      if (o === undefined) return `إيجار ${RAIL_RENT[0]}`;
      const n = (D.RAILS || []).filter((j) => S.owner[j] === o).length;
      return `إيجار ${RAIL_RENT[Math.max(0, n - 1)]}`;
    }
    if (o === undefined) return 'إيجار 4× النرد';
    const n = (D.UTILS || []).filter((j) => S.owner[j] === o).length;
    return `إيجار ${n === 2 ? 10 : 4}× النرد`;
  }

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const die = (n, roll) => `<div class="die ${roll ? 'roll' : ''}">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => `<i class="${PIPS[n].includes(k) ? 'on' : ''}"></i>`).join('')}</div>`;
  const diceHTML = (S) => `<div class="dice">${S.rolling ? die(1 + Math.floor(Math.random() * 6), true) + die(1 + Math.floor(Math.random() * 6), true) : die(S.dice[0]) + die(S.dice[1])}</div>`;

  /* لوحة المعلومات في وسط اللوحة: رقائق بكل لاعب — لونه واسمه ونقوده وعدد عقاراته */
  const centerInfo = (S) => `<div class="cinfo">${S.players.map((p) => { const n = Object.keys(S.owner).filter((i) => S.owner[i] === p.id).length; return `<span class="chip2 ${p.id === S.cur && !p.bankrupt ? 'cur' : ''} ${p.bankrupt ? 'bk' : ''}"><span class="pawn" style="background:${p.color}"></span>${esc(p.name)}<b>${p.bankrupt ? 'مفلس' : Number(p.money).toLocaleString('en-US')}</b><small>${n} عقار</small></span>`; }).join('')}</div>`;

  /* يرسم اللوحة كاملة داخل el، والوسط من centerHTML */
  function render(el, S, centerHTML) {
    el.classList.add('board');
    el.innerHTML = SQ.map((_, i) => cellHTML(i, S)).join('') + `<div class="center">${centerHTML || ''}</div>`;
  }
  function deedHTML(i, S) {
    const s = SQ[i], o = S && S.owner[i] !== undefined ? S.players[S.owner[i]] : null, h = S ? S.houses[i] || 0 : 0;
    let head = '', rows = '', note = '';
    if (s.t === 'prop') {
      head = `<div class="dh" style="background:${GC[s.g]}"><small>صك ملكية</small><b>${s.n}</b></div>`;
      rows = [['الإيجار', s.r[0]], ['مجموعة كاملة بلا مبانٍ', s.r[0] * 2], ['مع بيت واحد', s.r[1]], ['مع بيتين', s.r[2]], ['مع 3 بيوت', s.r[3]], ['مع 4 بيوت', s.r[4]], ['مع فندق', s.r[5]]].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
      note = `السعر ${s.p} · تكلفة البيت أو الفندق ${s.h} · قيمة الرهن ${s.p / 2}`;
    } else if (s.t === 'rail') {
      head = `<div class="dh" style="background:#59627a"><small>صك ملكية</small><b>${s.n}</b></div>`;
      rows = [1, 2, 3, 4].map((n, k) => `<tr><td>${n} ${n === 1 ? 'قطار' : 'قطارات'} مملوكة</td><td>${[25, 50, 100, 200][k]}</td></tr>`).join('');
      note = 'السعر 200 · قيمة الرهن 100';
    } else if (s.t === 'util') {
      head = `<div class="dh" style="background:#7a9a98"><small>صك ملكية</small><b>${s.n}</b></div>`;
      rows = '<tr><td>خدمة واحدة مملوكة</td><td>4 × الرمية</td></tr><tr><td>خدمتان مملوكتان</td><td>10 × الرمية</td></tr>';
      note = 'السعر 150 · قيمة الرهن 75';
    } else {
      head = `<div class="dh" style="background:var(--surface2)"><b>${s.n}</b></div>`;
      note = s.t === 'tax' ? `ادفع ${s.v} للبنك` : '';
    }
    const own = ['prop', 'rail', 'util'].includes(s.t) ? `<div class="dn">${o ? `المالك: <b>${esc(o.name)}</b>${S.mort[i] ? ' (مرهون)' : ''}${h ? ` · المباني: ${h === 5 ? 'فندق' : h}` : ''}` : 'غير مملوك'}</div>` : '';
    return `<div class="deed">${head}${rows ? `<table class="rt">${rows}</table>` : ''}${note ? `<div class="dn">${note}</div>` : ''}${own}</div>`;
  }
  root.Board = { render, deedHTML, diceHTML, rentText, centerInfo, esc, SQ, GC };
})(typeof self !== 'undefined' ? self : this);
