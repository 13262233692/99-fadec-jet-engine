// ============================================================
// TLA 推力杆解算器 (Thrust Lever Angle -> N1 Desired)
// 将飞行员推力杆角度 (0-100%) 非线性映射为期望 N1 转速 (%)
// ============================================================

// 实际涡扇发动机推力杆特性曲线数据点
// 地面慢车 ~22% N1, 起飞推力 ~100% N1, 中间有多个非线性拐点
const TLA_N1_CALIBRATION = [
  { tla: 0,   n1: 18.0 },   // 切断位 / 关车
  { tla: 5,   n1: 20.0 },   // 启动区
  { tla: 15,  n1: 24.0 },   // 地面慢车 Ground Idle
  { tla: 25,  n1: 35.0 },   // 空中慢车过渡
  { tla: 40,  n1: 55.0 },   // 慢车至巡航过渡
  { tla: 55,  n1: 72.0 },   // 经济巡航
  { tla: 70,  n1: 85.0 },   // 爬升推力
  { tla: 85,  n1: 94.0 },   // 最大连续推力 MCT
  { tla: 95,  n1: 99.0 },   // 起飞推力 TOGA 前段
  { tla: 100, n1: 102.5 }   // 全推力 / 复飞 (含 2.5% 超温裕度)
]

export function solveTLA(tlaPercent) {
  const tla = Math.max(0, Math.min(100, tlaPercent))

  for (let i = 0; i < TLA_N1_CALIBRATION.length - 1; i++) {
    const p0 = TLA_N1_CALIBRATION[i]
    const p1 = TLA_N1_CALIBRATION[i + 1]
    if (tla >= p0.tla && tla <= p1.tla) {
      const ratio = (tla - p0.tla) / (p1.tla - p0.tla)
      return p0.n1 + (p1.n1 - p0.n1) * ratio
    }
  }
  return TLA_N1_CALIBRATION[TLA_N1_CALIBRATION.length - 1].n1
}
