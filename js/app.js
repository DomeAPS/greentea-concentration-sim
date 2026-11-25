/* =========================================================
 * app.js — สถานะ การควบคุม และการแสดงผล
 * ========================================================= */
(() => {
  const M = TeaModel;
  const V = TeaVisuals;
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
  const SUGAR_MAX = 30, TEA_MAX = 12;

  const state = {
    step: 1,
    sugar: M.sugarForLevel(50),
    tea: 4,
    saved: [],
    baseId: null,
    cups: DEFAULT_CUPS.map((c) => ({ ...c })),
    showWork: false,
    compare: false,
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.saved)) state.saved = data.saved.filter((r) => Number.isFinite(r.sugar) && Number.isFinite(r.tea));
      if (Array.isArray(data.cups) && data.cups.length === 3) {
        state.cups = DEFAULT_CUPS.map((c, i) => ({ ...c, volume: clamp(Number(data.cups[i]) || c.volume, CUP_MIN, CUP_MAX) }));
      }
      if (data.baseId) state.baseId = data.baseId;
    } catch (_) { /* ไม่มี storage ก็ใช้งานได้ปกติ */ }
  }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        saved: state.saved,
        cups: state.cups.map((c) => c.volume),
        baseId: state.baseId,
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* =========================================================
   * ขั้นที่ 1
   * ========================================================= */
  let scene1;

  function levelLabel(level) {
    const hit = M.SWEET_LEVELS.find((l) => Math.abs(l - level) < 1e-9);
    return hit ? `หวาน ${hit}%` : `กำหนดเอง (${fmt(level, 1)}%)`;
  }

  function setSugar(v) { state.sugar = clamp(v, 0, SUGAR_MAX); renderStage1(); }
  function setTea(v) { state.tea = clamp(v, 0, TEA_MAX); renderStage1(); }

  function renderStage1(fromInput) {
    const vol = M.STAGE1_VOLUME;
    const r = M.describe(state.sugar, state.tea, vol);

    // sync inputs (ไม่เขียนทับช่องที่กำลังพิมพ์)
    if (fromInput !== 'sugar-num') $('#sugar-num').value = state.sugar;
    if (fromInput !== 'tea-num') $('#tea-num').value = state.tea;
    $('#sugar-range').value = state.sugar;
    $('#tea-range').value = state.tea;
    setRangeFill($('#sugar-range'), state.sugar / SUGAR_MAX);
    setRangeFill($('#tea-range'), state.tea / TEA_MAX);

    $$('.level-btn').forEach((b) => {
      const on = Math.abs(M.sugarForLevel(Number(b.dataset.level)) - state.sugar) < 1e-9;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });

    // ผลลัพธ์
    $('#r-sugar').textContent = fmt(r.sugarPct);
    $('#r-tea').textContent = fmt(r.teaPct);
    $('#r-sugar-sub').textContent = `= น้ำตาล ${fmt(r.sugarPct)} กรัม ในเครื่องดื่ม 100 มิลลิลิตร`;
    $('#r-tea-sub').textContent = `= ผงชา ${fmt(r.teaPct)} กรัม ในเครื่องดื่ม 100 มิลลิลิตร`;
    $('#r-level').textContent = `${fmt(r.level, 1)}%`;
    $('#r-level-conc').textContent = `${fmt(r.sugarPct)}% (มวล/ปริมาตร)`;
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
        <p class="work-title">ความเข้มข้นน้ำตาล</p>
        <p>= (มวลน้ำตาล ÷ ปริมาตรเครื่องดื่ม) × 100</p>
        <p>= (<b>${fmt(state.sugar)} g</b> ÷ <b>${vol} mL</b>) × 100</p>
        <p>= ${fmt(state.sugar / vol, 4)} × 100</p>
        <p class="work-ans">= ${fmt(r.sugarPct)} % (มวล/ปริมาตร)</p>
      </div>
      <div class="work-block tea">
        <p class="work-title">ความเข้มข้นผงชา</p>
        <p>= (มวลผงชา ÷ ปริมาตรเครื่องดื่ม) × 100</p>
        <p>= (<b>${fmt(state.tea)} g</b> ÷ <b>${vol} mL</b>) × 100</p>
        <p>= ${fmt(state.tea / vol, 4)} × 100</p>
        <p class="work-ans">= ${fmt(r.teaPct)} % (มวล/ปริมาตร)</p>
      </div>
      <div class="work-block level">
        <p class="work-title">ระดับหวาน (เทียบสูตรอ้างอิง ไม่ใช่ความเข้มข้น)</p>
        <p>= (มวลน้ำตาล ÷ น้ำตาลในสูตรอ้างอิง) × 100</p>
        <p>= (${fmt(state.sugar)} g ÷ ${M.REFERENCE.sugar} g) × 100 = <b>${fmt(r.level, 1)}%</b></p>
      </div>`;

    scene1.update(r.sugarPct, r.teaPct);
  }

  function setRangeFill(input, frac) {
    input.style.setProperty('--fill', `${clamp(frac, 0, 1) * 100}%`);
  }

  function saveRecipe() {
    const vol = M.STAGE1_VOLUME;
    const dup = state.saved.find((s) => Math.abs(s.sugar - state.sugar) < 1e-9 && Math.abs(s.tea - state.tea) < 1e-9);
    if (dup) {
      toast('มีสูตรนี้ในตารางแล้ว ลองเปลี่ยนระดับหวานหรือปริมาณผงชา');
      flashRow(dup.id);
      return;
    }
    if (state.saved.length >= 12) { toast('บันทึกได้สูงสุด 12 สูตร ลบสูตรเก่าก่อนนะ'); return; }
    const level = M.sweetLevelOf(state.sugar, vol);
    const rec = {
      id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      label: levelLabel(level),
      level,
      sugar: state.sugar,
      tea: state.tea,
      volume: vol,
    };
    state.saved.push(rec);
    if (!state.baseId) state.baseId = rec.id;
    persist();
    renderSaved();
    flashRow(rec.id);
    toast(`บันทึก “${rec.label}” แล้ว`);
  }

  function flashRow(id) {
    const row = $(`#saved-body tr[data-id="${id}"]`);
    if (!row) return;
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }

  function renderSaved() {
    const body = $('#saved-body');
    const sorted = [...state.saved].sort((a, b) => a.sugar - b.sugar || a.tea - b.tea);
    const maxPct = Math.max(10, ...sorted.map((s) => M.percentWV(s.sugar, s.volume)));
    body.innerHTML = sorted.map((s) => {
      const sp = M.percentWV(s.sugar, s.volume);
      const tp = M.percentWV(s.tea, s.volume);
      return `<tr data-id="${s.id}">
        <td><span class="swatch" style="background:${V.liquidColor(tp)}"></span>${esc(s.label)}</td>
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

    const shown = state.compare ? naive : rows;
    V.renderStage2(svg, shown);
    $('#stage2-title').textContent = state.compare ? 'แก้ว 3 ขนาด · ใส่ส่วนผสมเท่าเดิม' : 'แก้ว 3 ขนาด · ขยายสูตรแล้ว';
    const allSame = shown.every((r) => Math.abs(r.sugarPct - baseSugarPct) < 1e-6 && Math.abs(r.teaPct - baseTeaPct) < 1e-6);
    const badge = $('#stage2-badge');
    badge.textContent = allSame ? 'ความเข้มข้นเท่ากันทุกแก้ว ✓' : 'ความเข้มข้นไม่เท่ากัน!';
    badge.classList.toggle('warn', !allSame);

    $('#cup-cards').innerHTML = shown.map((r, i) => `
      <div class="cup-card">
        <span class="cup-chip size-${i}">${['S', 'M', 'L'][i]}</span>
        <div><b>${r.name}</b> <small>${fmt(r.volume, 0)} mL</small></div>
        <div class="cc-row"><span class="lg-dot sugar"></span>น้ำตาล <b>${fmt(r.sugar)} g</b> → ${fmt(r.sugarPct)}%</div>
        <div class="cc-row"><span class="lg-dot tea"></span>ผงชา <b>${fmt(r.tea)} g</b> → ${fmt(r.teaPct)}%</div>
      </div>`).join('');

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
    $('#scale-body').innerHTML = rows.map((r, i) => {
      const ok = Math.abs(r.sugarPct - baseSugarPct) < 1e-6 && Math.abs(r.teaPct - baseTeaPct) < 1e-6;
      return `<tr>
        <td><span class="cup-chip size-${i}">${['S', 'M', 'L'][i]}</span> ${r.name}</td>
        <td>${fmt(r.volume, 0)}</td>
        <td>× ${fmt(r.factor, 3)}</td>
        <td class="num-strong">${fmt(r.sugar)}</td>
        <td class="num-strong">${fmt(r.tea)}</td>
        <td>เติมจนครบ <b>${fmt(r.volume, 0)} mL</b><br><small class="muted">(ใช้น้ำจริง ≈ ${fmt(r.water, 0)} mL)</small></td>
        <td>${fmt(r.sugarPct)}% ${ok ? '<span class="ok">✓ เท่าเดิม</span>' : ''}</td>
        <td>${fmt(r.teaPct)}% ${ok ? '<span class="ok">✓ เท่าเดิม</span>' : ''}</td>
        ${state.compare ? `<td class="col-naive">${fmt(naive[i].sugarPct)}% ${naive[i].sugarPct < baseSugarPct - 1e-9 ? '<span class="down">จางลง</span>' : naive[i].sugarPct > baseSugarPct + 1e-9 ? '<span class="down">เข้มขึ้น</span>' : ''}</td>` : ''}
      </tr>`;
    }).join('');

    // วิธีคำนวณ
    const work = $('#work2');
    work.hidden = !state.showWork;
    if (state.showWork) {
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
  }

  /* =========================================================
   * คำถามชวนคิด
   * ========================================================= */
  const QUESTIONS = {
    1: [
      { q: 'ถ้าเพิ่มน้ำตาลเป็น 2 เท่า แต่ปริมาตรเครื่องดื่มยังเป็น 200 มิลลิลิตร ความเข้มข้นน้ำตาลจะเป็นอย่างไร?',
        a: 'ความเข้มข้นเพิ่มเป็น 2 เท่า เพราะปริมาตรสารละลายเท่าเดิม แต่มวลตัวละลายเพิ่มขึ้น 2 เท่า ลองเทียบระดับหวาน 50% (5%) กับ 100% (10%)' },
      { q: '“ระดับหวาน 50%” หมายความว่าน้ำตาลเข้มข้น 50% ใช่หรือไม่?',
        a: 'ไม่ใช่ ระดับหวาน 50% คือใช้น้ำตาลครึ่งหนึ่งของสูตรอ้างอิง = 10 กรัม ความเข้มข้นจริงคือ (10 ÷ 200) × 100 = 5% (มวล/ปริมาตร)' },
      { q: 'ปรับผงชาอย่างเดียว ความเข้มข้นน้ำตาลเปลี่ยนหรือไม่? เพราะอะไร?',
        a: 'ไม่เปลี่ยน (ในแบบจำลองนี้) เพราะเราเติมน้ำจนได้ปริมาตรสุดท้าย 200 มิลลิลิตรเสมอ มวลน้ำตาลและปริมาตรสารละลายจึงเท่าเดิม' },
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
    $$('.level-btn').forEach((b) => b.addEventListener('click', () => setSugar(M.sugarForLevel(Number(b.dataset.level)))));

    // ผงชา
    $('#tea-range').addEventListener('input', (e) => setTea(Number(e.target.value)));
    $('#tea-num').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) { state.tea = clamp(v, 0, TEA_MAX); renderStage1('tea-num'); }
    });
    $('#tea-num').addEventListener('change', () => renderStage1());

    $('#save-btn').addEventListener('click', saveRecipe);

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
    $('#show-work').addEventListener('change', (e) => { state.showWork = e.target.checked; renderStage2(); });
    $('#compare-noscale').addEventListener('change', (e) => { state.compare = e.target.checked; renderStage2(); });

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
  renderQuestions();
  bindEvents();
  renderStage1();
  renderSaved();
  goStep(1);
})();
