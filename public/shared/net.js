/* اتصال WebSocket مع إعادة اتصال تلقائية، ومؤثرات صوتية. */
(function (root) {
  function connect(h) {
    let ws = null, closed = false, tries = 0, pingT = null, retryT = null;
    function open() {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      try { ws = new WebSocket(url); } catch (e) { return retry(); }
      ws.onopen = () => { tries = 0; h.onStatus && h.onStatus('open'); h.onOpen && h.onOpen(); clearInterval(pingT); pingT = setInterval(() => send({ t: 'ping' }), 20000); };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } h.onMsg(m); };
      ws.onclose = () => { clearInterval(pingT); h.onStatus && h.onStatus('closed'); if (!closed) retry(); };
      ws.onerror = () => {};
    }
    function retry() { tries++; clearTimeout(retryT); retryT = setTimeout(open, Math.min(5000, 400 * tries)); h.onStatus && h.onStatus('retry'); }
    function send(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; }
    function close() { closed = true; clearInterval(pingT); clearTimeout(retryT); try { ws.close(); } catch (e) { /* ignore */ } }
    open();
    return { send, close };
  }

  let ac = null, muted = false, noiseBuf = null;
  function ctx() {
    try { ac = ac || new (root.AudioContext || root.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; } catch (e) { return null; }
  }
  function beep(f, d, type, v, w) {
    if (muted) return;
    const c = ctx(); if (!c) return;
    try {
      const o = c.createOscillator(), g = c.createGain(); o.type = type || 'sine'; o.frequency.value = f;
      const t = c.currentTime + (w || 0); g.gain.setValueAtTime(v || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d);
    } catch (e) { /* ignore */ }
  }
  /* دفعة ضجيج قصيرة عبر مرشح — قرقعة نرد، طرقات، خشخشة بطاقة، هبوط */
  function noise(d, v, w, freq) {
    if (muted) return;
    const c = ctx(); if (!c) return;
    try {
      if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
      const src = c.createBufferSource(); src.buffer = noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.9;
      const g = c.createGain(); const t = c.currentTime + (w || 0);
      g.gain.setValueAtTime(v || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      src.connect(f); f.connect(g); g.connect(c.destination); src.start(t); src.stop(t + d + 0.02);
    } catch (e) { /* ignore */ }
  }
  const SFX = {
    /* رمي النرد: قرقعة نرد حقيقية */
    roll() { for (let i = 0; i < 7; i++) { noise(0.035, 0.05, i * 0.07, 900 + Math.random() * 1600); beep(160 + Math.random() * 140, 0.04, 'square', 0.025, i * 0.07); } },
    /* خطوة القطعة: طقطقة إيقاعية */
    step() { noise(0.03, 0.06, 0, 2400); beep(520 + (Math.random() < 0.5 ? 0 : 130), 0.05, 'triangle', 0.04); },
    /* هبوط النرد بعد الرمي */
    land() { noise(0.09, 0.09, 0, 300); beep(95, 0.12, 'sine', 0.09); },
    /* شراء عقار: نغمة صاعدة مشرقة مع لمعة */
    buy() { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.14, 'triangle', 0.06, i * 0.07)); beep(1568, 0.2, 'sine', 0.03, 0.28); },
    /* استلام مال: شلال عملات */
    cash() { [988, 1319, 1568].forEach((f, i) => beep(f, 0.09, 'sine', 0.05, i * 0.06)); },
    /* دفع مال: عملات هابطة */
    pay() { [660, 520, 392].forEach((f, i) => beep(f, 0.12, 'sawtooth', 0.03, i * 0.09)); },
    /* المرور بالانطلاق: صعود احتفالي */
    go() { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.1, 'triangle', 0.06, i * 0.06)); },
    /* بناء بيت/فندق: طرقتا مطرقة ثم صعود */
    build() { noise(0.05, 0.09, 0, 500); noise(0.05, 0.09, 0.12, 500); beep(392, 0.1, 'triangle', 0.05, 0.2); beep(523, 0.14, 'triangle', 0.05, 0.3); },
    /* إتمام صفقة: مصافحة — نداء ورد */
    trade() { beep(523, 0.12, 'triangle', 0.06); beep(659, 0.12, 'triangle', 0.06, 0.12); beep(784, 0.12, 'triangle', 0.06, 0.3); beep(1046, 0.18, 'triangle', 0.06, 0.42); },
    /* رفض صفقة: طنين منخفض */
    deny() { beep(150, 0.12, 'sawtooth', 0.05); beep(130, 0.16, 'sawtooth', 0.05, 0.13); },
    /* سحب بطاقة فرصة/صندوق: خشخشة ثم نغمة */
    card() { noise(0.22, 0.05, 0, 1800); beep(880, 0.1, 'triangle', 0.05, 0.18); beep(1175, 0.14, 'triangle', 0.05, 0.28); },
    /* السجن: صرير باب ثم هبوط */
    jail() { noise(0.12, 0.1, 0, 350); beep(110, 0.3, 'square', 0.05); beep(220, 0.2, 'square', 0.04, 0.05); beep(160, 0.3, 'square', 0.04, 0.25); },
    /* إفلاس: لحن هابط حزين */
    bankrupt() { [392, 330, 262, 196].forEach((f, i) => beep(f, 0.22, 'triangle', 0.06, i * 0.18)); },
    /* حلّ دورك: رنين تنبيه لطيف */
    turn() { beep(880, 0.12, 'sine', 0.05); beep(1175, 0.18, 'sine', 0.05, 0.12); },
    /* بداية اللعبة: افتتاحية صاعدة */
    start() { [392, 523, 659, 784].forEach((f, i) => beep(f, 0.16, 'triangle', 0.06, i * 0.1)); beep(1046, 0.3, 'triangle', 0.07, 0.4); beep(1319, 0.3, 'sine', 0.04, 0.4); },
    /* الفوز: فانفار كامل */
    win() { [523, 659, 784, 1046, 784, 1046, 1319].forEach((f, i) => beep(f, 0.2, 'triangle', 0.07, i * 0.13)); beep(1568, 0.4, 'sine', 0.05, 0.9); },
  };
  root.Net = { connect };
  root.Sfx = { play(n) { if (SFX[n]) SFX[n](); }, names() { return Object.keys(SFX); }, setMuted(v) { muted = !!v; }, get muted() { return muted; }, unlock() { ctx(); } };
})(typeof self !== 'undefined' ? self : this);
