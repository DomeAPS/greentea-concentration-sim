/* =========================================================
 * model.js — แบบจำลองทางวิทยาศาสตร์ (ไม่มีโค้ดหน้าจอ)
 * ความเข้มข้นร้อยละโดยมวลต่อปริมาตร (% w/v)
 *   = มวลตัวละลาย (g) ÷ ปริมาตรสารละลายสุดท้าย (mL) × 100
 * ========================================================= */
const TeaModel = (() => {
  /** สูตรอ้างอิง: น้ำตาล 20 g ในเครื่องดื่มปริมาตรสุดท้าย 200 mL */
  const REFERENCE = Object.freeze({ sugar: 20, volume: 200 });

  /** ขั้นที่ 1 ใช้ปริมาตรเครื่องดื่มสุดท้ายคงที่ */
  const STAGE1_VOLUME = 200;

  /** ระดับหวาน (สัดส่วนเทียบสูตรอ้างอิง) ที่ให้เลือก */
  const SWEET_LEVELS = Object.freeze([25, 50, 100]);

  /**
   * สมมติฐานสำหรับ "ประมาณ" ปริมาณน้ำที่ใช้จริง:
   * ของแข็งที่ละลาย 1 g ทำให้ปริมาตรสารละลายเพิ่มประมาณ 0.6 mL
   * (ใกล้เคียงน้ำตาลทราย ~0.62 mL/g) ใช้กับผงชาด้วยเพื่อความง่าย
   */
  const DISSOLVED_VOLUME_PER_GRAM = 0.6;

  /** % มวลต่อปริมาตร */
  function percentWV(massG, volumeMl) {
    if (!(volumeMl > 0)) return 0;
    return (massG / volumeMl) * 100;
  }

  /** ระดับหวานเทียบสูตรอ้างอิง (%) — ไม่ใช่ความเข้มข้น */
  function sweetLevelOf(sugarG, volumeMl = STAGE1_VOLUME) {
    const refSugarAtVolume = REFERENCE.sugar * (volumeMl / REFERENCE.volume);
    return (sugarG / refSugarAtVolume) * 100;
  }

  /** มวลน้ำตาลของระดับหวาน (%) สำหรับปริมาตรที่กำหนด */
  function sugarForLevel(levelPct, volumeMl = STAGE1_VOLUME) {
    return REFERENCE.sugar * (volumeMl / REFERENCE.volume) * (levelPct / 100);
  }

  /** ประมาณปริมาตรน้ำที่ต้องเติม (ค่าประมาณในแบบจำลองเท่านั้น) */
  function approxWater(volumeMl, totalSoluteG) {
    return Math.max(0, volumeMl - totalSoluteG * DISSOLVED_VOLUME_PER_GRAM);
  }

  /**
   * ขยายสูตร: ปริมาณใหม่ = ปริมาณในสูตรฐาน × (ปริมาตรแก้วใหม่ ÷ ปริมาตรสูตรฐาน)
   * @param {{sugar:number, tea:number, volume:number}} base
   * @param {number} newVolume
   */
  function scaleRecipe(base, newVolume) {
    const factor = newVolume / base.volume;
    const sugar = base.sugar * factor;
    const tea = base.tea * factor;
    return {
      volume: newVolume,
      factor,
      sugar,
      tea,
      water: approxWater(newVolume, sugar + tea),
      sugarPct: percentWV(sugar, newVolume),
      teaPct: percentWV(tea, newVolume),
    };
  }

  /** สรุปสูตรหนึ่งสูตร */
  function describe(sugar, tea, volume) {
    return {
      sugar,
      tea,
      volume,
      sugarPct: percentWV(sugar, volume),
      teaPct: percentWV(tea, volume),
      level: sweetLevelOf(sugar, volume),
      water: approxWater(volume, sugar + tea),
    };
  }

  return {
    REFERENCE,
    STAGE1_VOLUME,
    SWEET_LEVELS,
    DISSOLVED_VOLUME_PER_GRAM,
    percentWV,
    sweetLevelOf,
    sugarForLevel,
    approxWater,
    scaleRecipe,
    describe,
  };
})();
