/* =========================================================
 * visuals.js — วาดแก้วชาและ "มุมมองขยาย" ด้วย SVG
 * ========================================================= */
const TeaVisuals = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------- สี ---------- */
  const WATER_RGB = [232, 242, 226];  // น้ำร้อนใส ๆ
  const MATCHA_RGB = [84, 132, 38];   // ชาเขียวเข้ม
  const TEA_PCT_FOR_FULL_COLOR = 5;   // ผงชา 5% w/v = สีเข้มสุดในภาพ

  function mix(a, b, t) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
  }
  /** สีของเหลวตามความเข้มข้นผงชา (ความเข้มข้นเท่ากัน = สีเท่ากัน) */
  function liquidColor(teaPct) {
    const t = Math.min(Math.max(teaPct / TEA_PCT_FOR_FULL_COLOR, 0), 1);
    const eased = 1 - Math.pow(1 - t, 1.6);
    const [r, g, b] = mix(WATER_RGB, MATCHA_RGB, eased);
    return `rgb(${r},${g},${b})`;
  }
  function liquidColorLight(teaPct) {
    const t = Math.min(Math.max(teaPct / TEA_PCT_FOR_FULL_COLOR, 0), 1);
    const [r, g, b] = mix([246, 250, 243], [196, 222, 164], t);
    return `rgb(${r},${g},${b})`;
  }

  /* ---------- ตำแหน่งจุดแบบสุ่มคงที่ (ไม่กระโดดเมื่อปรับค่า) ---------- */
  function seeded(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pointsInCircle(n, radius, seed) {
    const rand = seeded(seed);
    const pts = [];
    while (pts.length < n) {
      const r = radius * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  }
  const MAX_DOTS = 160;
  const SUGAR_PTS = pointsInCircle(MAX_DOTS, 1, 11);
  const TEA_PTS = pointsInCircle(MAX_DOTS, 1, 97);

  /** จำนวนจุดในมุมมองขยาย ∝ ความเข้มข้น */
  const DOTS_PER_PCT_SUGAR = 6;
  const DOTS_PER_PCT_TEA = 8;
  function dotCounts(sugarPct, teaPct) {
    return {
      sugar: Math.min(MAX_DOTS, Math.round(sugarPct * DOTS_PER_PCT_SUGAR)),
      tea: Math.min(MAX_DOTS, Math.round(teaPct * DOTS_PER_PCT_TEA)),
    };
  }

  /* ---------- เรขาคณิตแก้ว (กรวยตัด) ---------- */
  /**
   * หาความสูงของของเหลวเมื่อเติมได้ "สัดส่วน f ของความจุ"
   * แก้วเป็นกรวยตัด รัศมีเปลี่ยนเชิงเส้นตามความสูง
   * V(h) ∝ r(h)^3 − r0^3  →  r(h)^3 = r0^3 + f (R^3 − r0^3)
   */
  function heightForFraction(f, H, r0, R) {
    const rh = Math.cbrt(r0 ** 3 + f * (R ** 3 - r0 ** 3));
    return ((rh - r0) / (R - r0)) * H;
  }

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  /**
   * สร้างแก้ว 1 ใบ
   * @returns {{group, setLiquid(color)}}
   */
  function buildGlass(parent, opt) {
    const { cx, baseY, scale = 1, volume, capacity, marks = [], uid } = opt;
    const H = 250 * scale, R = 92 * scale, r0 = 66 * scale;
    const topY = baseY - H;
    const g = el('g', { class: 'glass' }, parent);

    const clipId = `clip-${uid}`;
    const defs = el('defs', {}, g);
    const clip = el('clipPath', { id: clipId }, defs);
    el('polygon', {
      points: `${cx - R},${topY} ${cx + R},${topY} ${cx + r0},${baseY} ${cx - r0},${baseY}`,
    }, clip);

    // เงา
    el('ellipse', { cx, cy: baseY + 10 * scale, rx: r0 * 1.35, ry: 9 * scale, class: 'glass-shadow' }, g);

    // ของเหลว
    const fill = volume / capacity;
    const h = heightForFraction(fill, H, r0, R);
    const liquidTop = baseY - h;
    const liquid = el('rect', {
      x: cx - R - 2, y: liquidTop, width: 2 * R + 4, height: h + 2,
      'clip-path': `url(#${clipId})`, class: 'liquid',
    }, g);
    // ผิวหน้าของเหลว
    const rAtTop = r0 + (R - r0) * (h / H);
    const surface = el('ellipse', {
      cx, cy: liquidTop, rx: rAtTop - 1, ry: 6 * scale, class: 'liquid-surface',
    }, g);

    // ตัวแก้ว
    el('polygon', {
      points: `${cx - R},${topY} ${cx + R},${topY} ${cx + r0},${baseY} ${cx - r0},${baseY}`,
      class: 'glass-body',
    }, g);
    el('ellipse', { cx, cy: topY, rx: R, ry: 7 * scale, class: 'glass-rim' }, g);
    // ฐานแก้วหนา
    el('path', {
      d: `M${cx - r0},${baseY} L${cx + r0},${baseY} L${cx + r0 - 3 * scale},${baseY + 9 * scale} L${cx - r0 + 3 * scale},${baseY + 9 * scale} Z`,
      class: 'glass-base',
    }, g);
    // แสงสะท้อน
    el('path', {
      d: `M${cx - R + 16 * scale},${topY + 18 * scale} L${cx - r0 + 12 * scale},${baseY - 16 * scale}`,
      class: 'glass-shine', 'stroke-width': 7 * scale,
    }, g);

    // ขีดบอกปริมาตร (คำนวณจากรูปทรงกรวยตัดจริง)
    marks.forEach((m) => {
      const mh = heightForFraction(m / capacity, H, r0, R);
      const y = baseY - mh;
      const rx = r0 + (R - r0) * (mh / H);
      el('line', { x1: cx + rx - 16 * scale, x2: cx + rx - 2, y1: y, y2: y, class: 'mark' }, g);
      const t = el('text', { x: cx + rx + 6, y: y + 4, class: 'mark-label' }, g);
      t.textContent = `${m} mL`;
    });

    return {
      group: g,
      liquidTop,
      topY,
      R,
      setLiquid(color) {
        liquid.style.fill = color;
        surface.style.fill = color;
      },
    };
  }

  function buildSteam(parent, cx, topY, scale = 1) {
    const g = el('g', { class: 'steam' }, parent);
    [-26, 0, 26].forEach((dx, i) => {
      const x = cx + dx * scale;
      el('path', {
        d: `M${x},${topY - 8} c-10,-14 10,-22 0,-36 c-10,-14 10,-22 0,-36`,
        class: `steam-line s${i}`,
      }, g);
    });
    return g;
  }

  /**
   * มุมมองขยาย: วงกลมที่แสดงจุดแทนอนุภาคน้ำตาล/ผงชา
   * สร้างจุดล่วงหน้าแล้วเปิด/ปิดตามจำนวน (ภาพนิ่ง ไม่กระโดด)
   */
  function buildMagnifier(parent, { cx, cy, r, uid, sugarR = 3.6, teaR = 2.8 }) {
    const g = el('g', { class: 'magnifier' }, parent);
    const clipId = `mclip-${uid}`;
    const defs = el('defs', {}, g);
    const clip = el('clipPath', { id: clipId }, defs);
    el('circle', { cx, cy, r }, clip);

    const bg = el('circle', { cx, cy, r, class: 'mag-bg' }, g);
    const dots = el('g', { 'clip-path': `url(#${clipId})` }, g);
    const inner = r - 6;
    const sugarDots = SUGAR_PTS.map(([x, y]) =>
      el('circle', { cx: cx + x * inner, cy: cy + y * inner, r: sugarR, class: 'dot-sugar' }, dots));
    const teaDots = TEA_PTS.map(([x, y]) =>
      el('circle', { cx: cx + x * inner, cy: cy + y * inner, r: teaR, class: 'dot-tea' }, dots));
    el('circle', { cx, cy, r, class: 'mag-ring' }, g);

    return {
      group: g,
      update(sugarPct, teaPct) {
        const n = dotCounts(sugarPct, teaPct);
        bg.style.fill = liquidColorLight(teaPct);
        sugarDots.forEach((d, i) => d.classList.toggle('off', i >= n.sugar));
        teaDots.forEach((d, i) => d.classList.toggle('off', i >= n.tea));
      },
    };
  }

  /* ---------- ฉากขั้นที่ 1 ---------- */
  function createStage1(svg) {
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 540 420');
    // โต๊ะไม้
    el('rect', { x: 0, y: 372, width: 540, height: 48, class: 'counter' }, svg);
    el('rect', { x: 0, y: 372, width: 540, height: 5, class: 'counter-edge' }, svg);

    const glass = buildGlass(svg, {
      cx: 170, baseY: 362, scale: 1, volume: 100, capacity: 120,
      marks: [25, 50, 75, 100], uid: 's1',
    });
    buildSteam(svg, 170, glass.topY, 1);

    // เส้นโยงจากแก้วไปมุมมองขยาย
    el('line', { x1: 205, y1: 230, x2: 368, y2: 175, class: 'mag-link' }, svg);
    el('circle', { cx: 205, cy: 230, r: 9, class: 'mag-spot' }, svg);
    const mag = buildMagnifier(svg, { cx: 440, cy: 160, r: 82, uid: 's1' });
    const cap = el('text', { x: 440, y: 268, class: 'mag-caption', 'text-anchor': 'middle' }, svg);
    cap.textContent = 'มุมมองขยาย (จำลอง)';

    return {
      update(sugarPct, teaPct) {
        glass.setLiquid(liquidColor(teaPct));
        mag.update(sugarPct, teaPct);
      },
    };
  }

  /* ---------- ฉากขั้นที่ 2 ---------- */
  /**
   * @param {SVGElement} svg
   * @param {Array<{name, volume, sugar, tea, sugarPct, teaPct}>} cups
   */
  function renderStage2(svg, cups) {
    svg.innerHTML = '';
    const W = 600, Hh = 470;
    svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
    el('rect', { x: 0, y: 300, width: W, height: 40, class: 'counter' }, svg);
    el('rect', { x: 0, y: 300, width: W, height: 5, class: 'counter-edge' }, svg);

    const maxV = Math.max(...cups.map((c) => c.volume), 1);
    const slot = W / cups.length;
    cups.forEach((c, i) => {
      const cx = slot * i + slot / 2;
      // ขนาดแก้วจริงขยายแบบ 3 มิติ: สเกลเชิงเส้น ∝ รากที่สามของปริมาตร
      const scale = 0.78 * Math.cbrt(c.volume / maxV);
      const glass = buildGlass(svg, {
        cx, baseY: 292, scale, volume: c.volume, capacity: c.volume / 0.86,
        marks: [], uid: `s2-${i}`,
      });
      glass.setLiquid(liquidColor(c.teaPct));

      const vol = el('text', { x: cx, y: glass.topY - 14, class: 'cup-vol', 'text-anchor': 'middle' }, svg);
      vol.textContent = `${fmt(c.volume, 0)} mL`;
      const name = el('text', { x: cx, y: 326, class: 'cup-name', 'text-anchor': 'middle' }, svg);
      name.textContent = c.name;

      const mag = buildMagnifier(svg, { cx, cy: 398, r: 52, uid: `s2-${i}`, sugarR: 2.6, teaR: 2.1 });
      mag.update(c.sugarPct, c.teaPct);
    });
  }

  function fmt(n, d = 2) {
    return Number(n.toFixed(d)).toLocaleString('th-TH', { maximumFractionDigits: d });
  }

  return { createStage1, renderStage2, liquidColor, dotCounts };
})();
