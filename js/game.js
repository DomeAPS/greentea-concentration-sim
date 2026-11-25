/* =========================================================
 * game.js — มาสคอต “น้องมัทฉะ” และเอฟเฟกต์ (กระดาษสี สั่น เด้ง)
 * (ไม่มีตรรกะวิทยาศาสตร์ — app.js เป็นผู้เรียกใช้)
 * ========================================================= */
const TeaGame = (() => {
  const $ = (s, root = document) => root.querySelector(s);
  const STORE_KEY = 'greentea-game-v1';
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- ความคืบหน้าที่จำไว้ (เช่น เคยเปิดโหมดเปรียบเทียบ) ---------------- */
  let flags = {};
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (d && d.flags && typeof d.flags === 'object') flags = d.flags;
    } catch (_) { /* ไม่มี storage ก็ใช้งานได้ */ }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ flags })); } catch (_) { /* ignore */ }
  }
  const flag = (name) => { if (!flags[name]) { flags[name] = 1; save(); } };
  const hasFlag = (name) => !!flags[name];

  /* ---------------- มาสคอต ---------------- */
  let moodTimer, sayTimer, baseMsg = '', baseAction = null;
  function mood(m, ms = 2400) {
    const el = $('#guide');
    el.dataset.mood = m;
    clearTimeout(moodTimer);
    if (m !== 'idle') moodTimer = setTimeout(() => { el.dataset.mood = 'idle'; }, ms);
  }
  function paintBubble(msg, action) {
    $('#guide-text').innerHTML = msg;
    const btn = $('#guide-action');
    btn.hidden = !action;
    if (action) { btn.textContent = action.label; btn.dataset.goto = action.goto; }
  }
  /** ข้อความประจำสถานการณ์ (เปลี่ยนตามความคืบหน้า) */
  function setBase(msg, action = null) {
    if (msg === baseMsg && JSON.stringify(action) === JSON.stringify(baseAction)) return;
    baseMsg = msg; baseAction = action;
    if (!sayTimer) { paintBubble(msg, action); pop($('#guide-bubble')); }
  }
  /** ข้อความชั่วคราว (ชม/ให้กำลังใจ) แล้วกลับไปข้อความประจำ */
  function say(msg, ms = 4500) {
    clearTimeout(sayTimer);
    paintBubble(msg, null);
    pop($('#guide-bubble'));
    sayTimer = setTimeout(() => { sayTimer = null; paintBubble(baseMsg, baseAction); }, ms);
  }

  /* ---------------- เอฟเฟกต์ ---------------- */
  function restartAnim(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  const pop = (el) => restartAnim(el, 'pop');
  const shake = (el) => restartAnim(el, 'shake');

  const CONFETTI_COLORS = ['#5b8c2a', '#8fbf5a', '#b9741e', '#f0c27a', '#2f85ad', '#e7d36f'];
  function confetti(n = 70) {
    if (reduceMotion()) return;
    const fx = $('#fx');
    const w = window.innerWidth;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'confetti';
      p.style.left = `${Math.random() * w}px`;
      p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      p.style.setProperty('--dx', `${(Math.random() - .5) * 220}px`);
      p.style.setProperty('--rot', `${(Math.random() - .5) * 1080}deg`);
      p.style.animationDelay = `${Math.random() * .35}s`;
      p.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
      if (i % 3 === 0) p.style.borderRadius = '50%';
      fx.appendChild(p);
      setTimeout(() => p.remove(), 3400);
    }
  }

  function init() { load(); }

  return { init, flag, hasFlag, mood, say, setBase, shake, pop, confetti };
})();
