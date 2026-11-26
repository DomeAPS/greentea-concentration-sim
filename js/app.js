/* =========================================================
 * app.js — สถานะ การควบคุม และการแสดงผล
 * ========================================================= */
(() => {
  const M = TeaModel;
  const V = TeaVisuals;
  const G = TeaGame;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  /* ---------------- รูปแบบตัวเลข ---------------- */
  function fmt(n, d = 2) {
    if (!Number.isFinite(n)) return '–';
    return Number(n.toFixed(d)).toLocaleString('th-TH', { maximumFractionDigits: d });
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- สถานะ ---------------- */
  const STORE_KEY = 'greentea-sim-v1';
  const DEFAULT_CUPS = [
    { name: 'แก้วเล็ก', volume: 200 },
    { name: 'แก้วกลาง', volume: 300 },
    { name: 'แก้วใหญ่', volume: 400 },
  ];
  const CUP_MIN = 50, CUP_MAX = 1000;
  const SUGAR_MAX = 15;

  const state = {
    step: 1,
    target: null,        // ระดับหวานเป้าหมายที่นักเรียนเลือก (ต้องเลือกก่อนปรับส่วนผสม)
    sugar: 0,
    tea: M.STAGE1_TEA,  // ด่าน 1: ผงชาเท่ากันทุกสูตร (ตัวแปรควบคุม)
    saved: [],
    baseId: null,
    cups: DEFAULT_CUPS.map((c) => ({ ...c })),
    showWork: false,
    compare: false,
    mode: 'auto',        // 'auto' = คำนวณอัตโนมัติ, 'practice' = ฝึกคิดเอง
    modeLocked: false,   // ครูล็อกโหมดผ่านลิงก์ ?mode=practice&lock=1
    p1: null,            // สถานะการฝึกขั้นที่ 1 (ดู resetP1)
    p2: null,            // สถานะการฝึกขั้นที่ 2 (ดู resetP2)
  };

  /* ---------------- ตรวจคำตอบ: ตัวช่วย ---------------- */
  /** แปลงข้อความที่นักเรียนพิมพ์เป็นตัวเลข (รับทั้ง 2.5 และ 2,5) — ช่องว่างได้ NaN */
  function readNum(s) {
    const t = String(s ?? '').trim().replace(/\s+/g, '').replace(',', '.');
    return t === '' ? NaN : Number(t);
  }
  const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;
  /** ยอมรับคำตอบที่ปัดเศษเป็นทศนิยม 1–2 ตำแหน่ง */
  const ANS_TOL = 0.051;
  const isPractice = () => state.mode === 'practice';

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (Array.isArray(data.saved)) state.saved = data.saved.filter((r) => Number.isFinite(r.sugar) && Number.isFinite(r.tea));
      if (Array.isArray(data.cups) && data.cups.length === 3) {
        state.cups = DEFAULT_CUPS.map((c, i) => ({ ...c, volume: clamp(Number(data.cups[i]) || c.volume, CUP_MIN, CUP_MAX) }));
      }
      if (data.baseId) state.baseId = data.baseId;
      if (data.mode === 'auto' || data.mode === 'practice') state.mode = data.mode;
    } catch (_) { /* ไม่มี storage ก็ใช้งานได้ปกติ */ }

    // ลิงก์จากครูมาก่อนค่าที่จำไว้: ?mode=practice (และ &lock=1 เพื่อซ่อนปุ่มสลับ)
    try {
      const q = new URLSearchParams(location.search);
      const m = q.get('mode');
      if (m === 'auto' || m === 'practice') {
        state.mode = m;
        state.modeLocked = q.get('lock') === '1';
      }
    } catch (_) { /* ignore */ }
  }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        saved: state.saved,
        cups: state.cups.map((c) => c.volume),
        baseId: state.baseId,
        mode: state.modeLocked ? undefined : state.mode,
      }));
    } catch (_) { /* ignore */ }
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function roundHalf(v) { return Math.round(v * 2) / 2; }

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* =========================================================
   * Stepper
   * ========================================================= */
  function goStep(n) {
    state.step = n;
    $$('.step-btn').forEach((b) => {
      const on = Number(b.dataset.step) === n;
      b.setAttribute('aria-selected', on);
      b.classList.toggle('active', on);
    });
    $('#step1').hidden = n !== 1;
    $('#step2').hidden = n !== 2;
    $('.stepper').classList.toggle('at-2', n === 2);
    if (n === 2) renderStage2();
    renderQuest();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* =========================================================
   * กระดานภารกิจ + มาสคอต
   * ========================================================= */
  const hasLevel = (l) => state.saved.some((s) => Math.abs(s.level - l) < 1e-9);
  const level1Done = () => M.SWEET_LEVELS.every(hasLevel);

  const nextLevel = () => M.SWEET_LEVELS.find((l) => !hasLevel(l));

  /** ขั้นตอนของโจทย์ด่าน 1 สำหรับระดับหวานที่กำลังทำ
   *  ปริมาณน้ำตาลให้นักเรียน “คาดคะเน” เอง — ระบบไม่กำหนด/ไม่ตรวจว่าถูกหรือผิด
   *  สิ่งที่ตรวจคือการคำนวณความเข้มข้นจากปริมาณที่นักเรียนเลือก */
  function stage1Steps() {
    const T = state.target ?? nextLevel();
    if (T == null) return M.SWEET_LEVELS.map((l) => ({ text: `บันทึกสูตรหวาน ${l}% แล้ว`, done: true }));
    const chosen = state.target === T;
    const sugarDone = chosen && state.sugar > 0;
    const calcDone = sugarDone && (isPractice() ? p1Solved() : true);
    return [
      { text: `เลือกระดับความหวาน <b>${T}%</b> <small>(เริ่มจาก 25% → 50% → 100%)</small>`, done: chosen },
      { text: `ปรับ<b>น้ำตาล</b>ตามที่คิดว่าได้หวาน ${T}% <small>(คาดคะเนเอง)</small>`, done: sugarDone },
      { text: isPractice()
        ? 'เลือก<b>สูตร</b>และตั้งสมการหา<b>ความเข้มข้นของน้ำตาล</b>ใต้แก้ว แล้วกด “ส่งคำตอบ” <small>(ผงชาใช้เท่าเดิม — ตัวแปรควบคุม)</small>'
        : 'ดูผล<b>ความเข้มข้นของน้ำตาล</b>ใต้แก้วชาเขียว <small>(ผงชาใช้เท่าเดิม — ตัวแปรควบคุม)</small>', done: calcDone },
      { text: `กด <b>“บันทึกสูตร”</b> แล้วทำระดับหวานถัดไป`, done: hasLevel(T) },
    ];
  }

  function questItems(step) {
    if (step === 1) return stage1Steps();
    const p2done = isPractice()
      ? !!state.p2 && (state.p2.revealed || state.p2.ok.every(Boolean))
      : G.hasFlag('work2');
    return [
      { text: 'เลือกสูตรฐานจากด่าน 1', done: state.saved.length > 0 },
      { text: isPractice() ? 'คำนวณส่วนผสมให้ครบ 3 แก้ว' : 'เปิดดูวิธีคำนวณแก้ว 3 ขนาด', done: state.saved.length > 0 && p2done },
      { text: 'ลองเปรียบเทียบ “ถ้าใส่ส่วนผสมเท่าเดิม”', done: G.hasFlag('compare') },
    ];
  }

  function guideMessage() {
    if (state.step === 1) {
      if (level1Done()) return { msg: 'สุดยอด! ได้สูตรมาตรฐานครบ 3 ระดับแล้ว 🎉 ต่อไปช่วยขยายสูตรให้แก้ว <b>เล็ก กลาง ใหญ่</b> กัน', action: { label: 'ไปด่าน 2 →', goto: 2 } };
      const next = nextLevel();
      if (state.target == null) {
        return { msg: state.saved.length === 0
          ? `ร้านเราใกล้เปิดแล้ว! ☀️ เริ่มจากเลือก <b>หวาน ${next}%</b> ในกล่อง “เลือกระดับความหวาน” ก่อนนะ`
          : `เก่งมาก! ต่อไปเลือก <b>หวาน ${next}%</b> แล้วปรับส่วนผสมใหม่` };
      }
      const T = state.target;
      if (state.sugar <= 0) {
        return { msg: `หวาน ${T}% ควรใส่น้ำตาลกี่กรัมดีนะ? 🤔 ลอง<b>คาดคะเน</b>แล้วปรับแถบน้ำตาลเองได้เลย` };
      }
      if (p1Locked()) return { msg: 'เลือก<b>สูตร</b>และตั้งสมการหาความเข้มข้นของน้ำตาลใต้แก้วให้ถูก แล้วค่อยกดบันทึกสูตรนะ ✏️' };
      return { msg: `พร้อมแล้ว! กด <b>“บันทึกสูตร”</b> เก็บสูตรหวาน ${T}% ไว้ได้เลย` };
    }
    if (!state.saved.length) return { msg: 'ยังไม่มีสูตรเลย กลับไปด่าน 1 ทดลองและบันทึกสูตรก่อนนะ', action: { label: '← กลับด่าน 1', goto: 1 } };
    const items = questItems(2);
    if (!items[1].done) {
      return { msg: isPractice()
        ? 'ลูกค้าสั่งแก้วกลางกับแก้วใหญ่! 🥤 รสชาติต้องเท่าเดิม ช่วยเติม<b>ตัวคูณ น้ำตาล และผงชา</b>ในตารางหน่อย'
        : 'ลูกค้าสั่งแก้วหลายขนาด! 🥤 เปิด <b>“แสดงวิธีคำนวณ”</b> ดูว่าแต่ละแก้วต้องใช้ส่วนผสมเท่าไร' };
    }
    if (!items[2].done) return { msg: 'ทุกแก้วเข้มข้นเท่ากันแล้ว ✓ ลองเปิด <b>“เปรียบเทียบ”</b> ดูสิว่าถ้าใส่ส่วนผสมเท่าเดิมจะเกิดอะไรขึ้น' };
    return { msg: 'ร้านพร้อมเปิดแล้ว! 🎉 ลองตอบ<b>คำถามชวนคิด</b>ด้านล่าง หรือเปลี่ยนขนาดแก้วเป็นโจทย์ใหม่' };
  }

  function renderQuest() {
    const step = state.step;
    const items = questItems(step);
    const current = items.findIndex((i) => !i.done);
    $('#quest-level').textContent = `ด่าน ${step}`;
    if (step === 1) {
      const T = state.target ?? nextLevel();
      const savedN = M.SWEET_LEVELS.filter(hasLevel).length;
      $('#quest-title').textContent = T == null ? 'ได้สูตรมาตรฐานครบ 3 ระดับแล้ว!' : `ทำสูตรหวาน ${T}% (เครื่องดื่ม ${M.STAGE1_VOLUME} cm³)`;
      $('#quest-count').innerHTML = M.SWEET_LEVELS.map((l) =>
        `<span class="lv-chip ${hasLevel(l) ? 'done' : l === T ? 'now' : ''}">${hasLevel(l) ? '★' : '☆'} ${l}%</span>`).join('');
      $('#quest-fill').style.width = `${(savedN / M.SWEET_LEVELS.length) * 100}%`;
    } else {
      const done = items.filter((i) => i.done).length;
      $('#quest-title').textContent = 'ขยายสูตรให้แก้ว 3 ขนาด รสชาติเท่าเดิม';
      $('#quest-count').textContent = `${done}/${items.length}`;
      $('#quest-fill').style.width = `${(done / items.length) * 100}%`;
    }
    $('#quest-list').innerHTML = items.map((i, n) =>
      `<li class="${i.done ? 'done' : n === current ? 'current' : ''}"><span class="qi-check" aria-hidden="true">${i.done ? '✓' : n + 1}</span><span>${i.text}</span><span class="sr-only">${i.done ? ' (สำเร็จ)' : n === current ? ' (ขั้นปัจจุบัน)' : ''}</span></li>`).join('');

    // สถานะด่านบน stepper
    $('#tab-1').classList.toggle('cleared', level1Done());
    $('#tab-2').classList.toggle('locked', state.saved.length === 0);
    $('#tab-2').classList.toggle('cleared', questItems(2).every((i) => i.done) && state.saved.length > 0);

    const g = guideMessage();
    G.setBase(g.msg, g.action || null);
  }

  /* =========================================================
   * ขั้นที่ 1
   * ========================================================= */
  let scene1;

  function setSugar(v) { state.sugar = clamp(v, 0, SUGAR_MAX); renderStage1(); }

  /**
   * เลือกระดับหวานเป้าหมาย (ขั้นแรกเสมอ)
   * ไม่ตั้งปริมาณน้ำตาลให้ — นักเรียนคาดคะเนปริมาณเอง ทั้งโหมดอัตโนมัติและโหมดฝึกคิด
   */
  function setTarget(level) {
    state.target = level;
    renderStage1();
    G.say(`หวาน ${level}% ควรใส่น้ำตาลกี่กรัมดีนะ? 🤔 ลองคาดคะเนแล้วปรับแถบน้ำตาลเอง`, 5000);
  }

  function renderStage1(fromInput) {
    const vol = M.STAGE1_VOLUME;
    const r = M.describe(state.sugar, state.tea, vol);

    // sync inputs (ไม่เขียนทับช่องที่กำลังพิมพ์)
    if (fromInput !== 'sugar-num') $('#sugar-num').value = state.sugar;
    $('#sugar-range').value = state.sugar;
    setRangeFill($('#sugar-range'), state.sugar / SUGAR_MAX);
    $('#tea-fixed').textContent = fmt(state.tea);
    $('#tea-fixed-text').textContent = fmt(state.tea);

    // 1) ระดับหวานเป้าหมาย — ต้องเลือกก่อนจึงปรับส่วนผสมได้
    const T = state.target;
    $$('.level-btn').forEach((b) => {
      const l = Number(b.dataset.level);
      const on = l === T;
      b.classList.toggle('active', on);
      b.classList.toggle('saved', hasLevel(l));
      b.setAttribute('aria-pressed', on);
    });
    const noTarget = T == null;
    $('#ingredients-card').classList.toggle('is-locked', noTarget);
    $('#ing-locked').hidden = !noTarget;
    ['#sugar-num', '#sugar-range'].forEach((s) => { $(s).disabled = noTarget; });
    $('#target-card').classList.toggle('is-current', noTarget);
    $('#target-note').innerHTML = noTarget
      ? `👉 เริ่มจาก <b>หวาน ${nextLevel() ?? 25}%</b>`
      : `🎯 เป้าหมาย: <b>หวาน ${T}%</b> — คาดคะเนเองว่าควรใส่น้ำตาลกี่กรัม แล้วปรับในขั้นที่ 2`;
    $('#sugar-goal').textContent = noTarget ? '' : `(หวาน ${T}% ควรใส่กี่กรัม?)`;

    // โหมดฝึกคิด: ถ้าส่วนผสมเปลี่ยน ให้เริ่มโจทย์ใหม่
    syncP1();
    const locked = p1Locked();

    // ผลลัพธ์ (ซ่อนตัวเลขความเข้มข้นจนกว่านักเรียนจะคำนวณถูก)
    $('#r-sugar').textContent = locked ? '?' : fmt(r.sugarPct);
    $('#r-tea').textContent = fmt(r.teaPct); // ผงชาเป็นตัวแปรควบคุม แสดงได้เสมอ
    $('#r-sugar-sub').textContent = locked ? '' : `= น้ำตาล ${fmt(r.sugarPct)} กรัม ในเครื่องดื่ม 100 มิลลิลิตร`;
    $('#r-tea-sub').textContent = `= ผงชา ${fmt(r.teaPct)} กรัม ในเครื่องดื่ม 100 มิลลิลิตร`;
    $('#r-level').textContent = T == null ? '–' : `${T}%`;
    $('#r-level-conc').textContent = locked ? '?' : `${fmt(r.sugarPct)}% (มวล/ปริมาตร)`;
    $('#r-locked').hidden = !locked;
    $('#gauges1').hidden = locked;
    $('#water-approx').textContent = fmt(r.water, 1);

    $('#rs-sugar').textContent = fmt(state.sugar);
    $('#rs-tea').textContent = fmt(state.tea);
    $('#g-sugar').style.width = `${Math.min(r.sugarPct / 15, 1) * 100}%`;
    $('#g-tea').style.width = `${Math.min(r.teaPct / 6, 1) * 100}%`;
    $('#g-sugar-val').textContent = `${fmt(r.sugarPct)}%`;
    $('#g-tea-val').textContent = `${fmt(r.teaPct)}%`;

    // วิธีคำนวณ
    $('#work1').innerHTML = `
      <div class="work-block sugar">
        <p class="work-title">ความเข้มข้นของน้ำตาล</p>
        <p>สูตร: <b>ร้อยละโดยมวลต่อปริมาตร (% w/v)</b> = มวลตัวละลาย (g) ÷ ปริมาตรสารละลาย (cm³) × 100</p>
        <div class="eq eq-static">
          <span class="frac-show"><span>${fmt(state.sugar)} g</span><span>${vol} cm³</span></span>
          <span class="eq-sym">× 100 =</span>
          <b class="work-ans">${fmt(r.sugarPct)} %</b>
        </div>
      </div>
      <p class="muted work-note">ผงชา ${fmt(state.tea)} g เท่ากันทุกสูตร (ตัวแปรควบคุม) → ความเข้มข้นผงชา ${fmt(r.teaPct)}% คงที่</p>`;
    $('#work1').hidden = locked;
    $('#practice1').hidden = !isPractice();
    $('#calc1-tag').textContent = !isPractice() ? 'คำนวณอัตโนมัติ'
      : state.p1.revealed ? 'ดูเฉลยแล้ว' : p1Solved() ? 'คิดเองถูกต้อง ✓' : 'ฝึกคิดเอง';
    $('#calc1-tag').className = `mode-tag ${isPractice() ? (p1Solved() ? 'done' : 'practice') : ''}`;
    renderP1();

    scene1.update(r.sugarPct, r.teaPct);
    renderQuest();
  }

  /* =========================================================
   * โหมดฝึกคิดเอง — ขั้นที่ 1
   * นักเรียนคาดคะเนปริมาณน้ำตาลเอง (ระบบไม่ตรวจ) แล้ว
   * เลือกสูตรความเข้มข้นที่ถูกชนิดและตั้งสมการ  ▢/▢ × 100 = ▢ %  ให้ถูกต้อง
   * ========================================================= */
  const P1_FIELDS = ['m', 'v', 'ans'];
  /** ชนิดของความเข้มข้นให้เลือก — น้ำตาล (g) ในเครื่องดื่ม (mL) ต้องใช้ % w/v */
  const CONC_TYPES = [
    { id: 'ww', top: 'w', bot: 'w', name: 'ร้อยละโดยมวล', formula: 'มวลตัวละลาย (g) ÷ มวลสารละลาย (g) × 100' },
    { id: 'wv', top: 'w', bot: 'v', name: 'ร้อยละโดยมวลต่อปริมาตร', formula: 'มวลตัวละลาย (g) ÷ ปริมาตรสารละลาย (cm³) × 100' },
    { id: 'vv', top: 'v', bot: 'v', name: 'ร้อยละโดยปริมาตร', formula: 'ปริมาตรตัวละลาย (cm³) ÷ ปริมาตรสารละลาย (cm³) × 100' },
  ];
  const CORRECT_TYPE = 'wv';
  const typeLabel = (t) => `% <span class="mini-frac"><span>${t.top}</span><span>${t.bot}</span></span>`;

  function resetP1(key) {
    state.p1 = {
      key, attempts: 0, revealed: false, type: null, hintOpen: false,
      ok: { sugar: false }, fb: {},
    };
    $$('#p1-rows input').forEach((i) => { i.value = ''; });
  }
  const p1Key = () => `${state.target}|${state.sugar}|${state.tea}`;
  function syncP1() {
    const key = p1Key();
    if (!state.p1 || state.p1.key !== key) resetP1(key);
  }
  const p1Solved = () => state.p1.revealed || state.p1.ok.sugar;
  const p1Locked = () => isPractice() && !p1Solved();

  function buildPractice1() {
    const box = (f, label, cls = '') =>
      `<input type="text" inputmode="decimal" autocomplete="off" class="pf-in ${cls}" data-f="${f}" aria-label="${label}">`;
    $('#p1-rows').innerHTML = `
      <div class="pf-row sugar eq-box" data-solute="sugar">
        <p class="pf-title">ความเข้มข้นของน้ำตาล <span class="pf-status"></span></p>
        <p class="pf-target-line" id="p1-target-line"></p>
        <div class="eq-toolbar">
          <span class="eq-label">สูตร</span>
          <div class="type-group" role="radiogroup" aria-label="ชนิดของความเข้มข้น">
            ${CONC_TYPES.map((t) => `<button type="button" class="type-btn" role="radio" aria-checked="false" data-type="${t.id}" aria-label="${t.name}" title="${t.name}">${typeLabel(t)}</button>`).join('')}
          </div>
          <button type="button" class="btn-round ghost" id="p1-clear" aria-label="ล้างคำตอบ" title="ล้างคำตอบ">⟲</button>
        </div>
        <p class="eq-formula" id="p1-formula"></p>
        <div class="eq">
          <div class="frac-in">
            ${box('m', 'ตัวเศษ (บน)')}
            <span class="frac-bar" aria-hidden="true"></span>
            ${box('v', 'ตัวส่วน (ล่าง)')}
          </div>
          <span class="eq-sym">× 100 =</span>
          ${box('ans', 'คำตอบ (%)', 'wide')}
          <span class="eq-sym">%</span>
        </div>
        <p class="pf-fb" aria-live="polite"></p>
      </div>`;
  }

  /** วิเคราะห์สมการความเข้มข้นน้ำตาล คืนค่า { ok, field?, msg } พร้อมคำอธิบายข้อผิดพลาดที่พบบ่อย */
  function diagnoseSugarEq(v, r) {
    const vol = M.STAGE1_VOLUME;
    const mass = state.sugar;
    const pct = r.sugarPct;

    if (!state.p1.type) return { ok: false, field: 'type', msg: 'เลือกสูตร (ชนิดของความเข้มข้น) ก่อนนะ' };
    if (state.p1.type !== CORRECT_TYPE) {
      return { ok: false, field: 'type', msg: 'สูตรยังไม่ถูกชนิด — น้ำตาลวัดเป็น “มวล (g)” ส่วนเครื่องดื่มวัดเป็น “ปริมาตร (cm³)” จึงใช้ร้อยละโดยมวลต่อปริมาตร' };
    }
    const empty = P1_FIELDS.find((f) => !Number.isFinite(v[f]));
    if (empty) return { ok: false, field: empty, msg: 'กรอกตัวเลขให้ครบทุกช่องก่อนนะ' };

    if (near(v.m, vol) && near(v.v, mass) && mass !== vol) {
      return { ok: false, field: 'm', msg: 'ตั้งสมการกลับด้าน: ตัวเศษ (บน) คือ “มวลตัวละลาย” ตัวส่วน (ล่าง) คือ “ปริมาตรสารละลาย”' };
    }
    if (!near(v.m, mass)) {
      let msg = 'ตัวเศษ (บน) คือมวลของน้ำตาล (กรัม) ดูได้จากแถบสูตรใต้แก้ว';
      if (near(v.m, state.tea) && state.tea !== mass) msg = 'ตัวเศษใส่มวลของผงชา แต่ข้อนี้หาความเข้มข้นของน้ำตาล';
      else if (near(v.m, state.sugar + state.tea)) msg = 'ใช้มวลรวมของน้ำตาลและผงชา — ให้ใช้มวลของน้ำตาลอย่างเดียว';
      return { ok: false, field: 'm', msg };
    }
    if (!near(v.v, vol)) {
      let msg = 'ตัวส่วน (ล่าง) คือปริมาตรเครื่องดื่มสุดท้าย ดูได้จากป้ายบนโต๊ะชงชา';
      if (near(v.v, r.water, 0.6)) msg = 'ใช้ปริมาตรน้ำที่เติม — ต้องใช้ปริมาตรสารละลายสุดท้าย (เครื่องดื่มทั้งแก้ว)';
      else if (near(v.v, mass + vol)) msg = 'ตัวส่วนคือปริมาตรเครื่องดื่มทั้งแก้ว (เติมน้ำจนครบแล้ว) ไม่ต้องบวกมวลน้ำตาลเพิ่ม';
      return { ok: false, field: 'v', msg };
    }
    if (near(v.ans, pct, ANS_TOL)) return { ok: true, msg: 'ถูกต้อง! เลือกสูตรและตั้งสมการถูกต้อง' };

    let msg = `ตั้งสมการถูกแล้ว แต่คิดเลขยังคลาดเคลื่อน ลองหาร ${fmt(mass)} ÷ ${vol} ก่อน แล้วค่อยคูณ 100`;
    if (near(v.ans, pct / 100, 0.0006) && pct !== 0) msg = 'เหมือนยังไม่ได้คูณ 100 ในขั้นสุดท้าย';
    else if (state.target != null && near(v.ans, state.target, ANS_TOL) && !near(state.target, pct, ANS_TOL)) {
      msg = 'นั่นคือ “ระดับหวาน” ที่เลือก ไม่ใช่ความเข้มข้น — คำนวณจากมวลน้ำตาลและปริมาตรเครื่องดื่ม';
    }
    return { ok: false, field: 'ans', msg };
  }

  function readP1() {
    const row = $('#p1-rows [data-solute="sugar"]');
    const vals = {};
    P1_FIELDS.forEach((f) => { vals[f] = readNum($(`[data-f="${f}"]`, row).value); });
    return vals;
  }

  function checkP1() {
    if (state.target == null) { toast('เลือกระดับความหวานก่อนนะ'); $('.level-btn').focus(); return; }
    if (state.sugar <= 0) { toast('ใส่น้ำตาลตามที่คาดคะเนก่อนนะ'); $('#sugar-num').focus(); return; }
    const r = M.describe(state.sugar, state.tea, M.STAGE1_VOLUME);
    const firstTry = state.p1.attempts === 0;
    let firstBad = null;

    if (!state.p1.ok.sugar) {
      const d = diagnoseSugarEq(readP1(), r);
      state.p1.ok.sugar = d.ok;
      state.p1.fb.sugar = d;
      if (!d.ok && !firstBad) {
        const row = $('#p1-rows [data-solute="sugar"]');
        firstBad = d.field === 'type' ? $('.type-btn', row) : $(`[data-f="${d.field}"]`, row);
      }
    }
    if (firstBad) state.p1.attempts += 1;
    renderStage1();

    // ปฏิกิริยาของมาสคอต
    if (firstBad) {
      G.mood('sad');
      $$('#p1-rows .pf-row:not(.is-ok)').forEach((row) => G.shake(row));
      G.say(state.p1.attempts >= 2
        ? 'ไม่เป็นไรนะ กดปุ่ม 💡 ดูคำใบ้ หรือกด <b>“แสดงคำตอบ”</b> ก็ได้ 💪'
        : 'เกือบแล้ว! อ่านข้อความสีแดงดูนะว่าพลาดตรงไหน 🤔');
      firstBad.focus();
    } else {
      G.mood('happy', 3000);
      G.say(firstTry ? 'ว้าว! ถูกตั้งแต่ครั้งแรกเลย ⚡ กด <b>“บันทึกสูตร”</b> ได้เลย' : 'ถูกต้องแล้ว! 🎉 กด <b>“บันทึกสูตร”</b> ได้เลย');
      G.confetti(40);
    }
  }

  function revealP1() {
    if (state.target == null) return;
    if (!state.p1.ok.sugar) {
      const r = M.describe(state.sugar, state.tea, M.STAGE1_VOLUME);
      const row = $('#p1-rows [data-solute="sugar"]');
      const ans = { m: state.sugar, v: M.STAGE1_VOLUME, ans: r.sugarPct };
      P1_FIELDS.forEach((f) => { $(`[data-f="${f}"]`, row).value = fmt(ans[f]).replace(/,/g, ''); });
      state.p1.type = CORRECT_TYPE;
      state.p1.fb.sugar = { ok: false, revealed: true, msg: 'เฉลย — ใช้ร้อยละโดยมวลต่อปริมาตร (% w/v) ดูวิธีคำนวณด้านล่าง' };
    }
    state.p1.revealed = true;
    G.mood('think');
    G.say('ดูคำตอบแล้วลองทำความเข้าใจทีละบรรทัดนะ แล้วไปทำระดับหวานถัดไป 📖');
    renderStage1();
  }

  function paintRow(row, ok, revealed, fb) {
    row.classList.toggle('is-ok', ok);
    row.classList.toggle('is-revealed', !ok && revealed);
    $('.pf-status', row).textContent = ok ? '✓ ถูกต้อง' : revealed ? 'เฉลย' : '';
    const el = $('.pf-fb', row);
    el.textContent = fb ? (fb.ok ? `✓ ${fb.msg}` : fb.revealed ? fb.msg : `✗ ${fb.msg}`) : '';
    el.className = `pf-fb ${fb ? (fb.ok ? 'ok' : fb.revealed ? 'info' : 'bad') : ''}`;
  }

  function renderP1() {
    if (!isPractice()) return;
    const p = state.p1;

    $('#p1-target-line').innerHTML = state.target == null
      ? 'ยังไม่ได้เลือกระดับความหวาน'
      : `สูตร <b>หวาน ${state.target}%</b> ของคุณ · ใส่น้ำตาล <b>${fmt(state.sugar)} g</b> ในเครื่องดื่ม <b>${M.STAGE1_VOLUME} cm³</b>`;

    // สมการความเข้มข้น
    const row = $('#p1-rows [data-solute="sugar"]');
    const fb = p.fb.sugar;
    const done = p.ok.sugar || p.revealed;
    $$('.type-btn', row).forEach((b) => {
      const on = b.dataset.type === p.type;
      b.setAttribute('aria-checked', on);
      b.classList.toggle('active', on);
      b.classList.toggle('bad', on && !!fb && !fb.ok && !fb.revealed && fb.field === 'type');
      b.disabled = done;
    });
    const t = CONC_TYPES.find((x) => x.id === p.type);
    $('#p1-formula').innerHTML = t
      ? `<b>${t.name} (${typeLabel(t)})</b> = ${t.formula}`
      : '<span class="muted">เลือกชนิดของความเข้มข้นที่เหมาะกับโจทย์นี้</span>';
    $$('input', row).forEach((i) => {
      i.disabled = done;
      i.classList.toggle('bad', !!fb && !fb.ok && !fb.revealed && fb.field === i.dataset.f);
    });
    $('#p1-clear').disabled = done;
    paintRow(row, p.ok.sugar, p.revealed, fb);

    // ปุ่ม: ส่งคำตอบ / แสดงคำตอบ / 💡
    const solved = p1Solved();
    const vals = readP1();
    const filled = !!p.type && P1_FIELDS.every((f) => Number.isFinite(vals[f]));
    $('#p1-check').disabled = solved || state.target == null || state.sugar <= 0 || !filled;
    $('#p1-reveal').disabled = solved || p.attempts < 1;
    $('#p1-hint-btn').disabled = solved;
    $('#p1-hint-btn').setAttribute('aria-expanded', p.hintOpen && !solved);

    const hints = [
      `💡 น้ำตาลวัดเป็น <b>กรัม (มวล)</b> และเครื่องดื่มวัดเป็น <b>cm³ (ปริมาตร)</b> — เลือกสูตรที่เป็น “มวลต่อปริมาตร”`,
      `💡 <b>สูตร:</b> % w/v = มวลตัวละลาย (g) ÷ ปริมาตรสารละลาย (cm³) × 100`,
      `💡 <b>แทนค่า:</b> ตัวเศษ = มวลน้ำตาลที่ใส่ (g) · ตัวส่วน = ปริมาตรเครื่องดื่มทั้งแก้ว ${M.STAGE1_VOLUME} cm³`,
    ];
    const hint = $('#p1-hint');
    hint.hidden = solved || !p.hintOpen;
    hint.innerHTML = hints.slice(0, Math.min(hints.length, p.attempts + 1)).join('<br>');
  }

  function setRangeFill(input, frac) {
    input.style.setProperty('--fill', `${clamp(frac, 0, 1) * 100}%`);
  }

  function saveRecipe() {
    const vol = M.STAGE1_VOLUME;
    if (state.target == null) {
      toast('เลือกระดับความหวานก่อน แล้วจึงปรับส่วนผสม');
      $('#target-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
      G.shake($('#target-card'));
      return;
    }
    if (state.sugar <= 0) {
      toast('ใส่น้ำตาลตามที่คาดคะเนก่อนบันทึกสูตรนะ');
      $('#sugar-num').focus();
      return;
    }
    if (p1Locked()) {
      toast('โหมดฝึกคิดเอง: ตั้งสมการหาความเข้มข้นของน้ำตาลให้ถูกก่อน แล้วค่อยบันทึกสูตร');
      const first = $$('#p1-rows input').find((i) => !i.disabled && i.value.trim() === '') || $$('#p1-rows input').find((i) => !i.disabled);
      if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); first.focus({ preventScroll: true }); }
      return;
    }
    // ระดับหวานคือ “ป้าย” ที่นักเรียนเลือก ปริมาณน้ำตาลเป็นค่าที่นักเรียนคาดคะเนเอง
    const level = state.target;
    const old = state.saved.find((s) => Math.abs(s.level - level) < 1e-9);
    if (old) {
      state.saved = state.saved.filter((s) => s !== old);
      if (state.baseId === old.id) state.baseId = null;
    }
    const rec = {
      id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      label: `หวาน ${level}%`,
      level,
      sugar: state.sugar,
      tea: state.tea,
      volume: vol,
      how: !isPractice() ? 'auto' : state.p1.revealed ? 'revealed' : 'self',
    };
    state.saved.push(rec);
    if (!state.baseId) state.baseId = rec.id;
    persist();
    // เริ่มสูตรถัดไป: ต้องเลือกระดับหวานใหม่ และคิดปริมาณน้ำตาลใหม่ (ผงชาคงที่ — ตัวแปรควบคุม)
    state.target = null;
    state.sugar = 0;
    renderStage1();
    renderSaved();
    flashRow(rec.id);
    toast(old ? `บันทึก “${rec.label}” แทนสูตรเดิมแล้ว` : `บันทึก “${rec.label}” แล้ว`);

    G.mood('happy');
    const nl = nextLevel();
    if (nl != null) G.say(`บันทึกสูตรหวาน ${fmt(level, 0)}% แล้ว! 🍵 ต่อไปเลือก <b>หวาน ${nl}%</b> แล้วคิดปริมาณน้ำตาลใหม่นะ`);
    if (level1Done()) {
      G.say('ภารกิจด่าน 1 สำเร็จ! 🏆 ได้สูตรมาตรฐานครบ 3 ระดับแล้ว');
      G.confetti();
    }
  }

  function flashRow(id) {
    const row = $(`#saved-body tr[data-id="${id}"]`);
    if (!row) return;
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }

  const HOW_TAG = {
    self: ' <span class="how-tag self" title="นักเรียนคำนวณเองถูกต้อง">✏️ คิดเอง</span>',
    revealed: ' <span class="how-tag revealed" title="ดูเฉลยก่อนบันทึก">👀 ดูเฉลย</span>',
  };

  function renderSaved() {
    const body = $('#saved-body');
    const sorted = [...state.saved].sort((a, b) => a.level - b.level || a.sugar - b.sugar);
    const maxPct = Math.max(10, ...sorted.map((s) => M.percentWV(s.sugar, s.volume)));
    body.innerHTML = sorted.map((s) => {
      const sp = M.percentWV(s.sugar, s.volume);
      const tp = M.percentWV(s.tea, s.volume);
      return `<tr data-id="${s.id}">
        <td><span class="swatch" style="background:${V.liquidColor(tp)}"></span>${esc(s.label)}${HOW_TAG[s.how] || ''}</td>
        <td>${fmt(s.level, 1)}%</td>
        <td>${fmt(s.sugar)}</td>
        <td>${fmt(s.tea)}</td>
        <td>${s.volume}</td>
        <td><div class="cell-bar"><b>${fmt(sp)}%</b><span class="bar sugar" style="width:${(sp / maxPct) * 100}%"></span></div></td>
        <td>${fmt(tp)}%</td>
        <td class="actions">
          <button type="button" class="btn btn-sm btn-soft" data-use="${s.id}">ใช้เป็นสูตรฐาน →</button>
          <button type="button" class="btn btn-sm btn-icon" data-del="${s.id}" aria-label="ลบสูตร ${esc(s.label)}">✕</button>
        </td>
      </tr>`;
    }).join('');
    $('#saved-empty').hidden = state.saved.length > 0;

    // checklist 25 / 50 / 100
    $('#checklist').innerHTML = M.SWEET_LEVELS.map((l) => {
      const done = state.saved.some((s) => Math.abs(s.level - l) < 1e-9);
      return `<span class="check ${done ? 'done' : ''}">${done ? '✓' : '○'} ${l}%</span>`;
    }).join('');
    renderQuest();
  }

  /* =========================================================
   * ขั้นที่ 2
   * ========================================================= */
  function getBase() {
    return state.saved.find((s) => s.id === state.baseId) || state.saved[0] || null;
  }

  function buildCupControls() {
    $('#cup-controls').innerHTML = state.cups.map((c, i) => `
      <div class="cup-ctrl">
        <div class="ing-head">
          <span class="cup-chip size-${i}">${['S', 'M', 'L'][i]}</span>
          <label for="cup-range-${i}">${c.name}</label>
          <span class="ing-value"><input type="number" id="cup-num-${i}" data-cup="${i}" min="${CUP_MIN}" max="${CUP_MAX}" step="10" inputmode="numeric" aria-label="ปริมาตร${c.name} (มิลลิลิตร)"> mL</span>
        </div>
        <input type="range" id="cup-range-${i}" data-cup="${i}" min="${CUP_MIN}" max="${CUP_MAX}" step="10">
      </div>`).join('');
    syncCupInputs();
  }

  function syncCupInputs(except) {
    state.cups.forEach((c, i) => {
      const num = $(`#cup-num-${i}`), rng = $(`#cup-range-${i}`);
      if (num && num.id !== except) num.value = c.volume;
      if (rng) { rng.value = c.volume; setRangeFill(rng, (c.volume - CUP_MIN) / (CUP_MAX - CUP_MIN)); }
    });
  }

  function renderBaseSelect() {
    const has = state.saved.length > 0;
    $('#base-empty').hidden = has;
    $('#base-pick').hidden = !has;
    $('#show-work').disabled = !has;
    $('#compare-noscale').disabled = !has;
    if (!has) return;
    const base = getBase();
    state.baseId = base.id;
    const sel = $('#base-select');
    sel.innerHTML = [...state.saved].sort((a, b) => a.sugar - b.sugar).map((s) =>
      `<option value="${s.id}" ${s.id === base.id ? 'selected' : ''}>${esc(s.label)} — น้ำตาล ${fmt(s.sugar)} g, ผงชา ${fmt(s.tea)} g / ${s.volume} mL</option>`).join('');
    const sp = M.percentWV(base.sugar, base.volume), tp = M.percentWV(base.tea, base.volume);
    $('#base-summary').innerHTML = `
      <div><span>น้ำตาล</span><b>${fmt(base.sugar)} g</b></div>
      <div><span>ผงชา</span><b>${fmt(base.tea)} g</b></div>
      <div><span>ปริมาตรสุดท้าย</span><b>${base.volume} mL</b></div>
      <div class="hl sugar"><span>น้ำตาลเข้มข้น</span><b>${fmt(sp)}%</b></div>
      <div class="hl tea"><span>ผงชาเข้มข้น</span><b>${fmt(tp)}%</b></div>`;
  }

  function renderStage2() {
    renderBaseSelect();
    const base = getBase();
    const svg = $('#scene2');

    if (!base) {
      svg.innerHTML = '';
      $('#scale-head').innerHTML = '';
      $('#scale-body').innerHTML = `<tr><td class="empty-cell">บันทึกสูตรในขั้นที่ 1 ก่อน แล้วตารางจะคำนวณให้ทันที</td></tr>`;
      $('#cup-cards').innerHTML = '';
      $('#work2').hidden = true;
      $('#practice2').hidden = true;
      renderQuest();
      return;
    }

    const baseSugarPct = M.percentWV(base.sugar, base.volume);
    const baseTeaPct = M.percentWV(base.tea, base.volume);
    const rows = state.cups.map((c) => ({ ...c, ...M.scaleRecipe(base, c.volume) }));
    // กรณีเปรียบเทียบ: ใส่น้ำตาล/ผงชาเท่าสูตรฐานทุกแก้ว
    const naive = state.cups.map((c) => ({
      ...c,
      sugar: base.sugar, tea: base.tea,
      sugarPct: M.percentWV(base.sugar, c.volume),
      teaPct: M.percentWV(base.tea, c.volume),
    }));

    syncP2(base);
    const p = state.p2;
    const practice = isPractice() && !p.revealed;
    // แถวที่ยังต้องให้นักเรียนคำนวณเอง (ซ่อนคำตอบ)
    const hideRow = (i) => practice && !p.ok[i];

    const shown = state.compare ? naive : rows;
    V.renderStage2(svg, shown);
    $('#stage2-title').textContent = state.compare ? 'แก้ว 3 ขนาด · ใส่ส่วนผสมเท่าเดิม' : 'แก้ว 3 ขนาด · ขยายสูตรแล้ว';
    const allSame = shown.every((r) => Math.abs(r.sugarPct - baseSugarPct) < 1e-6 && Math.abs(r.teaPct - baseTeaPct) < 1e-6);
    const badge = $('#stage2-badge');
    badge.textContent = allSame ? 'ความเข้มข้นเท่ากันทุกแก้ว ✓' : 'ความเข้มข้นไม่เท่ากัน!';
    badge.classList.toggle('warn', !allSame);

    $('#cup-cards').innerHTML = shown.map((r, i) => {
      const h = !state.compare && hideRow(i);
      return `
      <div class="cup-card">
        <span class="cup-chip size-${i}">${['S', 'M', 'L'][i]}</span>
        <div><b>${r.name}</b> <small>${fmt(r.volume, 0)} mL</small></div>
        <div class="cc-row"><span class="lg-dot sugar"></span>น้ำตาล <b>${h ? '?' : fmt(r.sugar)} g</b> → ${h ? '?' : fmt(r.sugarPct)}%</div>
        <div class="cc-row"><span class="lg-dot tea"></span>ผงชา <b>${h ? '?' : fmt(r.tea)} g</b> → ${h ? '?' : fmt(r.teaPct)}%</div>
      </div>`;
    }).join('');

    // ตาราง
    $('#scale-head').innerHTML = `<tr>
      <th>ขนาดแก้ว</th>
      <th>ปริมาตรเครื่องดื่ม<br><small>(มิลลิลิตร)</small></th>
      <th>ตัวคูณ<br><small>(ใหม่ ÷ ฐาน)</small></th>
      <th>น้ำตาลที่ต้องใช้<br><small>(กรัม)</small></th>
      <th>ผงชาที่ต้องใช้<br><small>(กรัม)</small></th>
      <th>น้ำร้อน<br><small>(เติมจนครบปริมาตรสุดท้าย)</small></th>
      <th>ความเข้มข้นน้ำตาล<br><small>หลังขยายสูตร</small></th>
      <th>ความเข้มข้นผงชา<br><small>หลังขยายสูตร</small></th>
      ${state.compare ? '<th class="col-naive">ถ้าใส่น้ำตาลเท่าเดิม<br><small>(' + fmt(base.sugar) + ' g)</small></th>' : ''}
    </tr>`;
    const inCell = (i, f, label, cls = '') => {
      const fb = p.fb[i];
      const bad = fb && !fb.ok && fb.field === f ? ' bad' : '';
      return `<input type="text" inputmode="decimal" autocomplete="off" class="pf-in cell-in ${cls}${bad}"
        data-row="${i}" data-f="${f}" value="${esc(p.inputs[i][f] || '')}" aria-label="${label}">`;
    };
    $('#scale-body').innerHTML = rows.map((r, i) => {
      const ok = Math.abs(r.sugarPct - baseSugarPct) < 1e-6 && Math.abs(r.teaPct - baseTeaPct) < 1e-6;
      const h = hideRow(i);
      const mark = practice && p.ok[i] ? ' <span class="ok">✓ คิดเอง</span>' : '';
      return `<tr class="${h ? 'row-practice' : ''}">
        <td><span class="cup-chip size-${i}">${['S', 'M', 'L'][i]}</span> ${r.name}</td>
        <td>${fmt(r.volume, 0)}</td>
        <td>${h ? `× ${inCell(i, 'f', `ตัวคูณ ${r.name}`, 'narrow')}` : `× ${fmt(r.factor, 3)}`}</td>
        <td class="num-strong">${h ? inCell(i, 's', `น้ำตาล ${r.name} (กรัม)`) : fmt(r.sugar) + mark}</td>
        <td class="num-strong">${h ? inCell(i, 't', `ผงชา ${r.name} (กรัม)`) : fmt(r.tea)}</td>
        <td>เติมจนครบ <b>${fmt(r.volume, 0)} mL</b>${h ? '' : `<br><small class="muted">(ใช้น้ำจริง ≈ ${fmt(r.water, 0)} mL)</small>`}</td>
        <td>${h ? '?' : `${fmt(r.sugarPct)}% ${ok ? '<span class="ok">✓ เท่าเดิม</span>' : ''}`}</td>
        <td>${h ? '?' : `${fmt(r.teaPct)}% ${ok ? '<span class="ok">✓ เท่าเดิม</span>' : ''}`}</td>
        ${state.compare ? `<td class="col-naive">${fmt(naive[i].sugarPct)}% ${naive[i].sugarPct < baseSugarPct - 1e-9 ? '<span class="down">จางลง</span>' : naive[i].sugarPct > baseSugarPct + 1e-9 ? '<span class="down">เข้มขึ้น</span>' : ''}</td>` : ''}
      </tr>`;
    }).join('');

    renderP2();

    // วิธีคำนวณ (โหมดฝึก: เปิดได้เมื่อทำถูกครบหรือดูเฉลยแล้ว)
    const workLocked = isPractice() && !p2Solved();
    $('#show-work').disabled = workLocked;
    $('#work-lock-note').hidden = !workLocked;
    const work = $('#work2');
    const showWork = state.showWork && !workLocked;
    work.hidden = !showWork;
    if (showWork) {
      work.innerHTML = rows.map((r, i) => `
        <div class="work-card">
          <h3><span class="cup-chip size-${i}">${['S', 'M', 'L'][i]}</span> ${r.name} (${fmt(r.volume, 0)} mL)</h3>
          <p><b>ตัวคูณ</b> = ${fmt(r.volume, 0)} ÷ ${base.volume} = <b>${fmt(r.factor, 4)}</b></p>
          <p><b>น้ำตาล</b> = ${fmt(base.sugar)} g × ${fmt(r.factor, 4)} = <b>${fmt(r.sugar)} g</b></p>
          <p><b>ผงชา</b> = ${fmt(base.tea)} g × ${fmt(r.factor, 4)} = <b>${fmt(r.tea)} g</b></p>
          <p><b>น้ำร้อน</b>: เติมจนได้ปริมาตรสุดท้าย ${fmt(r.volume, 0)} mL</p>
          <div class="check-box">
            <p class="work-title">ตรวจสอบความเข้มข้น</p>
            <p>น้ำตาล = (${fmt(r.sugar)} ÷ ${fmt(r.volume, 0)}) × 100 = <b>${fmt(r.sugarPct)}%</b></p>
            <p>ผงชา = (${fmt(r.tea)} ÷ ${fmt(r.volume, 0)}) × 100 = <b>${fmt(r.teaPct)}%</b></p>
            <p class="ok">✓ เท่ากับสูตรฐาน (${fmt(baseSugarPct)}% และ ${fmt(baseTeaPct)}%)</p>
          </div>
          ${state.compare ? `<p class="naive-note">ถ้าใส่น้ำตาลเท่าเดิม ${fmt(base.sugar)} g: (${fmt(base.sugar)} ÷ ${fmt(r.volume, 0)}) × 100 = <b>${fmt(naive[i].sugarPct)}%</b></p>` : ''}
        </div>`).join('');
    }
    renderQuest();
  }

  /* =========================================================
   * โหมดฝึกคิดเอง — ขั้นที่ 2
   * ========================================================= */
  const P2_FIELDS = ['f', 's', 't'];

  function syncP2(base) {
    const key = `${base.id}|${base.sugar}|${base.tea}|${state.cups.map((c) => c.volume).join(',')}`;
    if (state.p2 && state.p2.key === key) return;
    state.p2 = {
      key, attempts: 0, revealed: false,
      inputs: state.cups.map(() => ({})),
      ok: state.cups.map(() => false),
      fb: state.cups.map(() => null),
    };
  }
  const p2Solved = () => !!state.p2 && (state.p2.revealed || state.p2.ok.every(Boolean));

  /** วิเคราะห์คำตอบหนึ่งแก้ว คืนค่า { ok, field?, msg } */
  function diagnoseP2(base, cup, v) {
    const F = cup.volume / base.volume;
    const empty = P2_FIELDS.find((f) => !Number.isFinite(v[f]));
    if (empty) return { ok: false, field: empty, msg: 'กรอกตัวคูณ น้ำตาล และผงชาให้ครบ' };

    if (!near(v.f, F, 0.006)) {
      let msg = `ตัวคูณ = ปริมาตรแก้วใหม่ ÷ ปริมาตรสูตรฐาน (${base.volume} mL)`;
      if (near(v.f, base.volume / cup.volume, 0.006)) msg = 'ตัวคูณกลับด้าน — ต้องเป็น “ปริมาตรแก้วใหม่ ÷ ปริมาตรสูตรฐาน”';
      else if (near(v.f, cup.volume - base.volume)) msg = 'ตัวคูณได้จากการหาร ไม่ใช่การลบ';
      return { ok: false, field: 'f', msg };
    }
    const check = (f, baseMass, name) => {
      const want = baseMass * F;
      if (near(v[f], want, ANS_TOL)) return null;
      let msg = `${name} = ${name}ในสูตรฐาน (${fmt(baseMass)} g) × ตัวคูณ`;
      if (near(v[f], baseMass) && !near(F, 1)) msg = `ใส่${name}เท่าสูตรฐาน — แก้วขนาดต่างกัน ความเข้มข้นจะเปลี่ยน ต้องคูณด้วยตัวคูณ`;
      else if (near(v[f], baseMass + (cup.volume - base.volume), ANS_TOL)) msg = `ใช้การบวกเพิ่มตามปริมาตร — ต้องคูณ${name}ด้วยตัวคูณ`;
      return { ok: false, field: f, msg };
    };
    return check('s', base.sugar, 'น้ำตาล') || check('t', base.tea, 'ผงชา') || { ok: true, msg: 'ถูกต้อง' };
  }

  function checkP2() {
    const base = getBase();
    if (!base) return;
    const p = state.p2;
    let anyBad = false;
    state.cups.forEach((c, i) => {
      if (p.ok[i]) return;
      const vals = {};
      P2_FIELDS.forEach((f) => { vals[f] = readNum(p.inputs[i][f]); });
      const d = diagnoseP2(base, c, vals);
      p.ok[i] = d.ok;
      p.fb[i] = d;
      if (!d.ok) anyBad = true;
    });
    if (anyBad) p.attempts += 1;
    renderStage2();

    if (anyBad) {
      G.mood('sad');
      $$('#scale-body tr.row-practice').forEach((row) => G.shake(row));
      G.say('บางแก้วยังไม่ถูก ดูข้อความสีแดงใต้ตารางนะ 🤔');
      const bad = $('#scale-body .pf-in.bad');
      if (bad) bad.focus();
    } else {
      G.mood('happy', 3000);
      G.say('ถูกครบทุกแก้ว! 🎉 เปิด “แสดงวิธีคำนวณ” เพื่อตรวจความเข้มข้นได้');
      G.confetti();
      renderQuest();
    }
  }

  function renderP2() {
    const box = $('#practice2');
    box.hidden = !isPractice();
    if (!isPractice() || !state.p2) return;
    const p = state.p2;
    const solved = p2Solved();
    $('#p2-fb').innerHTML = state.cups.map((c, i) => {
      const fb = p.fb[i];
      if (p.ok[i]) return `<li class="ok-line"><span class="cup-chip size-${i}">${['S', 'M', 'L'][i]}</span> ✓ ${esc(c.name)}: ถูกต้อง</li>`;
      if (p.revealed) return `<li class="info-line"><span class="cup-chip size-${i}">${['S', 'M', 'L'][i]}</span> ${esc(c.name)}: แสดงเฉลยในตารางแล้ว</li>`;
      if (!fb) return '';
      return `<li class="bad-line"><span class="cup-chip size-${i}">${['S', 'M', 'L'][i]}</span> ✗ ${esc(c.name)}: ${esc(fb.msg)}</li>`;
    }).join('');
    const hint = $('#p2-hint');
    hint.hidden = solved || p.attempts < 1;
    hint.innerHTML = '💡 <b>ทบทวน:</b> ตัวคูณ = ปริมาตรแก้วใหม่ ÷ ปริมาตรสูตรฐาน แล้วนำตัวคูณไปคูณทั้งน้ำตาลและผงชา';
    $('#p2-reveal').hidden = solved || p.attempts < 2;
    $('#p2-check').hidden = solved;
    $('#p2-clear').hidden = solved;
  }

  /* =========================================================
   * สลับโหมด
   * ========================================================= */
  function setMode(mode) {
    if (state.modeLocked) return;
    state.mode = mode;
    persist();
    renderMode();
    renderStage1();
    if (state.step === 2) renderStage2();
    toast(mode === 'practice' ? '✏️ โหมดฝึกคิดเอง: คำนวณเองแล้วกดตรวจคำตอบ' : '⚡ โหมดคำนวณอัตโนมัติ');
  }
  function renderMode() {
    $$('#mode-switch [data-mode]').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === state.mode));
    $('#mode-switch').hidden = state.modeLocked;
    $('#mode-locked').hidden = !state.modeLocked;
    $('#mode-locked').innerHTML = `${state.mode === 'practice' ? '✏️ โหมดฝึกคิดเอง' : '⚡ โหมดคำนวณอัตโนมัติ'} <small>(ครูกำหนด)</small>`;
    document.body.dataset.mode = state.mode;
  }

  /* =========================================================
   * คำถามชวนคิด
   * ========================================================= */
  const QUESTIONS = {
    1: [
      { q: 'ถ้าเพิ่มน้ำตาลเป็น 2 เท่า แต่ปริมาตรเครื่องดื่มยังเป็น 100 มิลลิลิตร ความเข้มข้นน้ำตาลจะเป็นอย่างไร?',
        a: 'ความเข้มข้นเพิ่มเป็น 2 เท่า เพราะปริมาตรสารละลายเท่าเดิม แต่มวลตัวละลายเพิ่มขึ้น 2 เท่า ลองเทียบความเข้มข้นในตารางบันทึกสูตรของตัวเองดู' },
      { q: '“ระดับหวาน 50%” หมายความว่าน้ำตาลเข้มข้น 50% ใช่หรือไม่?',
        a: 'ไม่ใช่ ระดับหวานเป็นสัดส่วนเทียบกับสูตรอ้างอิง ส่วนความเข้มข้นคำนวณจาก (มวลน้ำตาล ÷ ปริมาตรเครื่องดื่ม) × 100 เช่น ถ้าใส่น้ำตาล 5 กรัม ในเครื่องดื่ม 100 cm³ ความเข้มข้นคือ (5 ÷ 100) × 100 = 5% (มวล/ปริมาตร)' },
      { q: 'ทำไมด่านนี้ต้องใช้ผงชาเท่ากันทุกสูตร?',
        a: 'เพราะผงชาเป็นตัวแปรควบคุม ถ้าใช้ผงชาเท่ากันและปริมาตรเครื่องดื่มเท่ากัน (100 cm³) ความแตกต่างของความหวานจะเกิดจากปริมาณน้ำตาล (ตัวแปรต้น) เพียงอย่างเดียว จึงสรุปผลได้อย่างยุติธรรม' },
    ],
    2: [
      { q: 'ถ้าเพิ่มขนาดแก้วเป็น 2 เท่า แต่ใส่น้ำตาลเท่าเดิม ความเข้มข้นจะเป็นอย่างไร?',
        a: 'ความเข้มข้นลดลงเหลือครึ่งหนึ่ง เพราะมวลน้ำตาลเท่าเดิมแต่ปริมาตรสารละลายเพิ่มเป็น 2 เท่า ลองเปิดสวิตช์ “เปรียบเทียบ: ถ้าใส่ส่วนผสมเท่าเดิม” แล้วตั้งแก้วใหญ่เป็น 400 mL' },
      { q: 'ทำไมต้องคูณทั้งน้ำตาลและผงชาด้วยตัวคูณเดียวกัน?',
        a: 'เพื่อให้อัตราส่วน มวลตัวละลาย : ปริมาตรสารละลาย คงที่ทุกตัวละลาย ถ้าคูณไม่เท่ากัน รสชาติ (ความเข้มข้น) ของน้ำตาลหรือชาจะเปลี่ยนไป' },
      { q: 'สูตรฐานคือน้ำตาล 10 กรัม ต่อ 200 มิลลิลิตร แก้ว 500 มิลลิลิตรต้องใช้น้ำตาลกี่กรัม?',
        a: 'ตัวคูณ = 500 ÷ 200 = 2.5 ดังนั้นน้ำตาล = 10 × 2.5 = 25 กรัม ตรวจสอบ: (25 ÷ 500) × 100 = 5% เท่าเดิม' },
    ],
  };

  function renderQuestions() {
    $$('.questions').forEach((box) => {
      const list = QUESTIONS[box.dataset.group] || [];
      box.innerHTML = list.map((it, i) => `
        <div class="q">
          <p class="q-text"><span class="q-num">${i + 1}</span>${esc(it.q)}</p>
          <button type="button" class="btn btn-sm btn-ghost q-toggle" aria-expanded="false">ดูแนวคำตอบ</button>
          <p class="q-answer" hidden>${esc(it.a)}</p>
        </div>`).join('');
    });
  }

  /* =========================================================
   * พิมพ์สรุปผล (รวมด่าน 1 + ด่าน 2)
   * ========================================================= */
  const HOW_TEXT = { auto: 'คำนวณอัตโนมัติ', self: '✏️ คิดเองถูกต้อง', revealed: '👀 ดูเฉลย' };
  const writeLines = (n) => `<div class="pr-lines">${'<span></span>'.repeat(n)}</div>`;

  function buildReport() {
    const now = new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });
    const modeText = isPractice() ? '✏️ ฝึกคิดเอง' : '⚡ คำนวณอัตโนมัติ';

    /* ---- ด่าน 1 ---- */
    const sorted = [...state.saved].sort((a, b) => a.level - b.level || a.sugar - b.sugar);
    const doneLevels = M.SWEET_LEVELS.filter((l) => state.saved.some((s) => Math.abs(s.level - l) < 1e-9));
    const s1Rows = sorted.map((s) => `<tr>
        <td>${esc(s.label)}</td>
        <td>${fmt(s.sugar)}</td><td>${fmt(s.tea)}</td><td>${s.volume}</td>
        <td><b>${fmt(M.percentWV(s.sugar, s.volume))}%</b></td>
        <td>${fmt(M.percentWV(s.tea, s.volume))}%</td>
        <td>${HOW_TEXT[s.how] || '–'}</td></tr>`).join('');
    const s1Table = sorted.length
      ? `<table class="pr-table"><thead><tr>
          <th>สูตร</th><th>น้ำตาล (g)</th><th>ผงชา (g)</th><th>ปริมาตรสุดท้าย (mL)</th>
          <th>ความเข้มข้นน้ำตาล<br>(% มวล/ปริมาตร)</th><th>ความเข้มข้นผงชา<br>(% มวล/ปริมาตร)</th><th>วิธีได้คำตอบ</th>
        </tr></thead><tbody>${s1Rows}</tbody></table>`
      : '<p class="pr-empty">ยังไม่ได้บันทึกสูตรในด่าน 1</p>';

    /* ---- ด่าน 2 ---- */
    const base = getBase();
    let s2 = '<p class="pr-empty">ยังไม่มีสูตรฐาน (ต้องบันทึกสูตรในด่าน 1 ก่อน)</p>';
    if (base) {
      syncP2(base);
      const p = state.p2;
      const practice = isPractice() && !p.revealed;
      const rows = state.cups.map((c, i) => {
        const r = M.scaleRecipe(base, c.volume);
        let f, sg, te, sp, tp, status;
        if (practice && !p.ok[i]) {
          // ยังไม่ถูก: แสดงคำตอบที่นักเรียนกรอกไว้ (ถ้ามี)
          const v = p.inputs[i] || {};
          const show = (x) => (String(x ?? '').trim() === '' ? '……' : esc(x));
          f = show(v.f); sg = show(v.s); te = show(v.t);
          sp = tp = '……';
          status = p.fb[i] ? '✗ ยังไม่ถูก' : 'ยังไม่ได้ตรวจ';
        } else {
          f = fmt(r.factor, 3); sg = fmt(r.sugar); te = fmt(r.tea);
          sp = `<b>${fmt(r.sugarPct)}%</b>`; tp = `${fmt(r.teaPct)}%`;
          status = !isPractice() ? 'คำนวณอัตโนมัติ' : p.ok[i] ? '✏️ คิดเองถูกต้อง' : '👀 ดูเฉลย';
        }
        return `<tr><td>${esc(c.name)}</td><td>${c.volume}</td><td>${f}</td><td>${sg}</td><td>${te}</td><td>${sp}</td><td>${tp}</td><td>${status}</td></tr>`;
      }).join('');
      s2 = `
        <p class="pr-base">สูตรฐาน: <b>${esc(base.label)}</b> — น้ำตาล ${fmt(base.sugar)} g, ผงชา ${fmt(base.tea)} g
          ในปริมาตรสุดท้าย ${base.volume} mL
          (น้ำตาลเข้มข้น ${fmt(M.percentWV(base.sugar, base.volume))}%, ผงชาเข้มข้น ${fmt(M.percentWV(base.tea, base.volume))}%)</p>
        <p class="pr-formula">ปริมาณส่วนผสมใหม่ = ปริมาณในสูตรฐาน × (ปริมาตรแก้วใหม่ ÷ ปริมาตรสูตรฐาน)</p>
        <table class="pr-table"><thead><tr>
          <th>แก้ว</th><th>ปริมาตร (mL)</th><th>ตัวคูณ</th><th>น้ำตาล (g)</th><th>ผงชา (g)</th>
          <th>ความเข้มข้นน้ำตาล<br>(% มวล/ปริมาตร)</th><th>ความเข้มข้นผงชา<br>(% มวล/ปริมาตร)</th><th>วิธีได้คำตอบ</th>
        </tr></thead><tbody>${rows}</tbody></table>`;
    }

    /* ---- คำถามชวนคิด (เว้นบรรทัดให้เขียนตอบ) ---- */
    const qs = (g) => QUESTIONS[g].map((it, i) => `
      <div class="pr-q"><p><b>${i + 1}.</b> ${esc(it.q)}</p>${writeLines(2)}</div>`).join('');

    $('#print-report').innerHTML = `
      <header class="pr-head">
        <h1>สรุปผลการทดลอง: ร้านชาเขียวนักวิทย์</h1>
        <p>ความเข้มข้นของสารละลาย (ร้อยละโดยมวลต่อปริมาตร) · โหมด: ${modeText} · พิมพ์เมื่อ ${esc(now)}</p>
        <div class="pr-id">
          <span>ชื่อ–สกุล <i class="w-lg"></i></span>
          <span>ชั้น <i></i></span>
          <span>เลขที่ <i></i></span>
        </div>
      </header>

      <section class="pr-sec">
        <h2>ด่าน 1 · ทดลองสูตร <small>(บันทึกครบ ${doneLevels.length}/${M.SWEET_LEVELS.length} ระดับ)</small></h2>
        <p class="pr-vars"><b>ตัวแปรต้น:</b> ปริมาณน้ำตาล · <b>ตัวแปรตาม:</b> ความเข้มข้นของน้ำตาล ·
          <b>ตัวแปรควบคุม:</b> ผงชาเขียว ${M.STAGE1_TEA} กรัม และปริมาตรเครื่องดื่ม ${M.STAGE1_VOLUME} cm³</p>
        ${s1Table}
        <h3>คำถามชวนคิด</h3>
        ${qs(1)}
      </section>

      <section class="pr-sec">
        <h2>ด่าน 2 · ขยายสูตร</h2>
        ${s2}
        <h3>คำถามชวนคิด</h3>
        ${qs(2)}
      </section>

      <section class="pr-sec">
        <h2>สรุปผลการทดลอง</h2>
        ${writeLines(4)}
      </section>`;
  }

  function printReport() {
    if (!state.saved.length) toast('ยังไม่มีสูตรที่บันทึก — สรุปผลจะมีเฉพาะหัวข้อและคำถาม');
    buildReport();
    window.print();
  }

  /* =========================================================
   * Events
   * ========================================================= */
  function bindEvents() {
    $$('.step-btn').forEach((b) => b.addEventListener('click', () => goStep(Number(b.dataset.step))));
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-goto]');
      if (go) goStep(Number(go.dataset.goto));
    });

    // น้ำตาล
    $('#sugar-range').addEventListener('input', (e) => setSugar(Number(e.target.value)));
    $('#sugar-num').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) { state.sugar = clamp(v, 0, SUGAR_MAX); renderStage1('sugar-num'); }
    });
    $('#sugar-num').addEventListener('change', () => renderStage1());
    $$('.level-btn').forEach((b) => b.addEventListener('click', () => setTarget(Number(b.dataset.level))));

    $('#save-btn').addEventListener('click', saveRecipe);
    $('#print-btn').addEventListener('click', printReport);
    // Ctrl+P / เมนูพิมพ์ของเบราว์เซอร์ ก็ได้สรุปผลล่าสุดเช่นกัน
    window.addEventListener('beforeprint', buildReport);

    // สลับโหมด
    $$('#mode-switch [data-mode]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.mode !== state.mode) setMode(b.dataset.mode);
    }));

    // ฝึกคิดเอง ขั้นที่ 1
    $('#p1-check').addEventListener('click', checkP1);
    $('#p1-reveal').addEventListener('click', revealP1);
    $('#p1-hint-btn').addEventListener('click', () => { state.p1.hintOpen = !state.p1.hintOpen; renderP1(); });
    $('#p1-rows').addEventListener('click', (e) => {
      if (e.target.closest('#p1-clear')) {
        // ล้างสมการ (คงจำนวนครั้งที่ตอบและสถานะคำใบ้ไว้)
        const { hintOpen, attempts } = state.p1;
        resetP1(state.p1.key);
        Object.assign(state.p1, { hintOpen, attempts });
        renderStage1();
        return;
      }
      const tb = e.target.closest('.type-btn');
      if (tb && !tb.disabled) { state.p1.type = tb.dataset.type; renderP1(); }
    });
    $('#p1-rows').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input') && !$('#p1-check').disabled) { e.preventDefault(); checkP1(); }
    });
    $('#p1-rows').addEventListener('input', (e) => { e.target.classList.remove('bad'); renderP1(); });

    // ฝึกคิดเอง ขั้นที่ 2
    $('#scale-body').addEventListener('input', (e) => {
      const t = e.target;
      if (!t.matches('.cell-in')) return;
      state.p2.inputs[Number(t.dataset.row)][t.dataset.f] = t.value;
      t.classList.remove('bad');
    });
    $('#scale-body').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.cell-in')) { e.preventDefault(); checkP2(); }
    });
    $('#p2-check').addEventListener('click', checkP2);
    $('#p2-reveal').addEventListener('click', () => {
      state.p2.revealed = true;
      G.mood('think');
      G.say('ดูเฉลยในตารางแล้วลองเปลี่ยนขนาดแก้วเป็นโจทย์ใหม่ได้นะ 📖');
      renderStage2();
    });
    $('#p2-clear').addEventListener('click', () => {
      const p = state.p2;
      p.inputs = state.cups.map(() => ({}));
      p.fb = state.cups.map((_, i) => (p.ok[i] ? p.fb[i] : null));
      renderStage2();
    });

    // ตารางบันทึก
    $('#saved-body').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      const use = e.target.closest('[data-use]');
      if (del) {
        state.saved = state.saved.filter((s) => s.id !== del.dataset.del);
        if (state.baseId === del.dataset.del) state.baseId = state.saved[0]?.id || null;
        persist(); renderSaved();
      } else if (use) {
        state.baseId = use.dataset.use; persist(); goStep(2);
      }
    });

    // ขั้นที่ 2
    $('#base-select').addEventListener('change', (e) => { state.baseId = e.target.value; persist(); renderStage2(); });
    $('#cup-controls').addEventListener('input', (e) => {
      const i = e.target.dataset.cup;
      if (i === undefined) return;
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      state.cups[i].volume = e.target.type === 'range' ? v : clamp(v, CUP_MIN, CUP_MAX);
      syncCupInputs(e.target.type === 'number' ? e.target.id : undefined);
      persist(); renderStage2();
    });
    $('#cup-controls').addEventListener('change', () => syncCupInputs());
    $('#reset-cups').addEventListener('click', () => {
      state.cups = DEFAULT_CUPS.map((c) => ({ ...c }));
      syncCupInputs(); persist(); renderStage2();
    });
    $('#show-work').addEventListener('change', (e) => {
      state.showWork = e.target.checked;
      if (state.showWork) G.flag('work2');
      renderStage2();
    });
    $('#compare-noscale').addEventListener('change', (e) => {
      state.compare = e.target.checked;
      if (state.compare) {
        G.flag('compare');
        G.mood('think');
        G.say('สังเกตไหม? ใส่ส่วนผสมเท่าเดิมในแก้วใหญ่ สีจะจางลงและจุดในวงกลมจะห่างกันขึ้น 🔍', 6000);
      }
      renderStage2();
    });

    // คำถาม
    document.addEventListener('click', (e) => {
      const t = e.target.closest('.q-toggle');
      if (!t) return;
      const ans = t.nextElementSibling;
      ans.hidden = !ans.hidden;
      t.setAttribute('aria-expanded', !ans.hidden);
      t.textContent = ans.hidden ? 'ดูแนวคำตอบ' : 'ซ่อนคำตอบ';
    });
  }

  /* ---------------- เริ่มต้น ---------------- */
  load();
  scene1 = V.createStage1($('#scene1'));
  buildCupControls();
  buildPractice1();
  G.init();
  renderMode();
  renderQuestions();
  bindEvents();
  renderStage1();
  renderSaved();
  goStep(1);
})();
