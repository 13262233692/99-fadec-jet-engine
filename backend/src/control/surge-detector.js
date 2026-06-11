// ============================================================
// 压气机喘振监测算子 (Compressor Surge Detection)
//
// 核心原理:
//   喘振 (Surge) 是压气机气流分离导致的轴向振荡，
//   表现为 Ps3 压力剧烈波动 + N2 转速抖动 + 流量反向。
//
// 监测方法 (双维度融合):
//   [1] 稳态喘振裕度 (Static Margin)
//       - 在压气机特性图 (Ps3 vs Corrected N2) 上，
//         计算当前工作点到喘振线的归一化距离。
//
//   [2] 动态喘振先兆 (Dynamic Precursor)
//       - 实时计算 d(Ps3)/dt 和 d(N2)/dt 的高频微导数
//       - 检测特征抖动频率 (典型 8~25Hz)
//       - 抖振幅度超过阈值 → 逼近喘振临界点
//
// 输出:
//   surgeMargin : 0~100% (>15% 安全, 5~15% 警告, <5% 危险)
//   status      : 'safe' | 'warn' | 'critical'
//   vbvTrigger  : 是否触发 VBV/VSV 自动保护
// ============================================================

// 喘振边界线 (Surge Line) - 基于典型高压压气机台架试验数据
// 坐标: 修正转速 N2_c (%)  vs  压比 πc (Ps3/P2)
// 喘振线是压气机特性图上的一条上凸抛物线
const SURGE_LINE_POINTS = [
  { n2c: 50,  pr: 3.8 },
  { n2c: 60,  pr: 6.2 },
  { n2c: 70,  pr: 9.5 },
  { n2c: 80,  pr: 13.8 },
  { n2c: 90,  pr: 18.5 },
  { n2c: 95,  pr: 21.2 },
  { n2c: 100, pr: 24.0 },
  { n2c: 105, pr: 26.5 },
  { n2c: 110, pr: 28.8 }
]

// 失速线 (Stall Line) - 比喘振线稍低，但仍属于不稳定区
// 喘振裕度 = (Surge PR - Operating PR) / Operating PR × 100%

export class SurgeDetector {
  constructor(sampleTime) {
    this.Ts = sampleTime
    this.Fs = 1 / sampleTime

    // ---- 历史缓存 (用于微导数与抖动检测) ----
    this.historyLen = Math.round(0.25 / sampleTime)  // 250ms 窗口
    this.n2History = new Float64Array(this.historyLen)
    this.ps3History = new Float64Array(this.historyLen)
    this.historyIdx = 0
    this.historyFilled = false

    // ---- 微导数状态 ----
    this.dN2dt = 0       // %/s
    this.dPs3dt = 0      // psia/s
    this.ddPs3dt2 = 0    // 二阶导数 psia/s²

    // ---- 抖振检测 ----
    // 带通滤波: 8~25Hz (典型喘振先兆频率范围)
    this.bandpassState = { n2: 0, ps3: 0 }
    this.shakeAmplitude = 0  // 抖振归一化幅度 0~1
    this.shakeFrequency = 0  // 抖振主频 Hz

    // ---- 输出状态 ----
    this.surgeMargin = 100.0   // 喘振裕度 %
    this.status = 'safe'       // safe | warn | critical
    this.vbvTriggered = false  // VBV/VSV 是否已触发
    this.vbvActive = false     // VBV 当前是否开启
    this.vsvAngle = 0          // VSV 角度调整 (度)

    // ---- 阈值 ----
    this.MARGIN_WARN = 12.0     // % 裕度以下触发警告
    this.MARGIN_CRIT = 5.0      // % 裕度以下触发危险
    this.SHAKE_TRIGGER = 0.25   // 抖振幅度阈值 (触发 VBV)
    this.MARGIN_TRIGGER = 8.0   // 裕度阈值 (触发 VBV)

    // 带通滤波系数 (二阶 Butterworth 简化版)
    this._initBandpass()
  }

  _initBandpass() {
    // 中心频率 ~15Hz, 带宽约 8~22Hz
    const fc = 15
    const bw = 14
    const w0 = 2 * Math.PI * fc / this.Fs
    const alpha = Math.sin(w0) * Math.sinh(Math.log(2) / 2 * bw * w0 / Math.sin(w0))

    this._bp = {
      a0: 1 + alpha,
      b0: alpha,
      b1: 0,
      b2: -alpha,
      a1: -2 * Math.cos(w0),
      a2: 1 - alpha
    }
    this._bp_x1 = 0; this._bp_x2 = 0
    this._bp_y1 = 0; this._bp_y2 = 0
  }

  // 二阶带通滤波 (针对 Ps3 信号)
  _bandpass(input) {
    const bp = this._bp
    const out = (bp.b0 / bp.a0) * input
              + (bp.b1 / bp.a0) * this._bp_x1
              + (bp.b2 / bp.a0) * this._bp_x2
              - (bp.a1 / bp.a0) * this._bp_y1
              - (bp.a2 / bp.a0) * this._bp_y2
    this._bp_x2 = this._bp_x1
    this._bp_x1 = input
    this._bp_y2 = this._bp_y1
    this._bp_y1 = out
    return out
  }

  // 计算喘振线上的压比 (给定修正 N2)
  _surgePressureRatio(n2c) {
    const n = Math.max(50, Math.min(110, n2c))
    for (let i = 0; i < SURGE_LINE_POINTS.length - 1; i++) {
      const p0 = SURGE_LINE_POINTS[i]
      const p1 = SURGE_LINE_POINTS[i + 1]
      if (n >= p0.n2c && n <= p1.n2c) {
        const r = (n - p0.n2c) / (p1.n2c - p0.n2c)
        return p0.pr + (p1.pr - p0.pr) * r
      }
    }
    return SURGE_LINE_POINTS[SURGE_LINE_POINTS.length - 1].pr
  }

  // 主计算函数：每拍调用
  step(n2, ps3, p2, t2) {
    // (1) 修正转速 (Corrected Speed)
    //     N2_c = N2 / sqrt(T2 / T_ref)   T_ref = 288.15K = 15°C
    const t2K = t2 + 273.15
    const theta = t2K / 288.15
    const n2c = n2 / Math.sqrt(theta)

    // (2) 当前工作压比
    const pr = ps3 / p2

    // (3) 喘振线上的压比 (同修正转速下)
    const prSurge = this._surgePressureRatio(n2c)

    // (4) 稳态喘振裕度 (%)
    //     经典定义: SM = (PR_surge - PR_op) / PR_op × 100
    const marginStatic = Math.max(0, (prSurge - pr) / pr * 100)

    // (5) 写入环形历史缓存
    this.ps3History[this.historyIdx] = ps3
    this.n2History[this.historyIdx] = n2
    this.historyIdx = (this.historyIdx + 1) % this.historyLen
    if (this.historyIdx === 0) this.historyFilled = true

    // (6) 一阶微导数 (中心差分 3 点)
    const hlen = this.historyLen
    const prev2 = (this.historyIdx - 2 + hlen) % hlen
    const prev1 = (this.historyIdx - 1 + hlen) % hlen
    if (this.historyFilled) {
      // dPs3/dt = (ps3[k] - ps3[k-2]) / (2*Ts)
      this.dPs3dt = (ps3 - this.ps3History[prev2]) / (2 * this.Ts)
      this.dN2dt  = (n2  - this.n2History[prev2])  / (2 * this.Ts)
    } else {
      this.dPs3dt = 0
      this.dN2dt = 0
    }

    // (7) Ps3 带通滤波 + 抖振幅度 (RMS 包络)
    const bpOut = this._bandpass(ps3)
    // 包络检测 (峰值整流 + 低通)
    const envAlpha = 1 - Math.exp(-2 * Math.PI * 2 / this.Fs)  // 2Hz 包络低通
    const envelope = Math.abs(bpOut)
    this.shakeAmplitude = this.shakeAmplitude * (1 - envAlpha) + envelope * envAlpha

    // 抖振归一化 (以 Ps3 直流分量为基准)
    const ps3Dc = Math.max(20, ps3)
    const shakeNorm = (this.shakeAmplitude / ps3Dc) * 1000  // 千分比

    // (8) 综合喘振裕度: 稳态裕度 - 动态抖动惩罚
    //     抖振越强，等效裕度越低 (先兆提前量)
    const shakePenalty = shakeNorm * 2.5  // 抖振千分比 × 系数 = 裕度惩罚%
    const effectiveMargin = Math.max(0, marginStatic - shakePenalty)

    this.surgeMargin = effectiveMargin
    this.marginStatic = marginStatic
    this.shakeNorm = shakeNorm
    this.n2c = n2c
    this.pr = pr
    this.prSurge = prSurge

    // (9) 状态分级
    if (effectiveMargin <= this.MARGIN_CRIT) {
      this.status = 'critical'
    } else if (effectiveMargin <= this.MARGIN_WARN) {
      this.status = 'warn'
    } else {
      this.status = 'safe'
    }

    // (10) VBV/VSV 自动触发判定
    //      条件: 裕度 < 触发阈值  或  抖振 > 触发阈值  且  当前未触发
    const shouldTrigger = (effectiveMargin < this.MARGIN_TRIGGER) || (shakeNorm > 30)
    if (shouldTrigger && !this.vbvTriggered) {
      this.vbvTriggered = true
      this.vbvActive = true
      this._triggerTimestamp = Date.now()
      // VSV 角度: 喘振越近，开角越大 (0 ~ 12°)
      this.vsvAngle = Math.min(12, (this.MARGIN_TRIGGER - effectiveMargin) * 1.5 + 4)
    }

    // 恢复逻辑: 裕度回升到安全范围且持续一段时间后自动复位
    if (this.vbvTriggered && effectiveMargin > this.MARGIN_WARN + 5) {
      // 逐渐关闭 VBV/VSV (模拟作动器延迟)
      this.vsvAngle *= 0.95
      if (this.vsvAngle < 0.3) {
        this.vsvAngle = 0
        this.vbvActive = false
        this.vbvTriggered = false
      }
    }

    return {
      surgeMargin: this.surgeMargin,
      marginStatic,
      status: this.status,
      vbvActive: this.vbvActive,
      vsvAngle: this.vsvAngle,
      shakeNorm: this.shakeNorm,
      dPs3dt: this.dPs3dt,
      dN2dt: this.dN2dt,
      n2c,
      pr,
      prSurge
    }
  }

  // 手动重置 (用于发动机重启)
  reset() {
    this.vbvTriggered = false
    this.vbvActive = false
    this.vsvAngle = 0
    this.status = 'safe'
    this.shakeAmplitude = 0
    this.historyIdx = 0
    this.historyFilled = false
    this._bp_x1 = 0; this._bp_x2 = 0
    this._bp_y1 = 0; this._bp_y2 = 0
  }
}
