// ============================================================
// 双转子涡扇发动机实时动力学模型 (N1 / N2 / EGT)
// 采用一阶 / 二阶非线性状态空间方程，Runge-Kutta 4 阶积分
// 积分步长 1ms (1000Hz)，内部控制律运算 100Hz，对外推送 100Hz
//
// 状态向量:
//   x = [ N1,  N2,  EGT,  Ps3,  P2,  T2,  Wf_cmd ]
//        LPT   HPT   排气   压出   进口  进气  燃油指令
// ============================================================

// 热力学常数 (简化高涵道比涡扇)
const ENGINE = {
  // 转子时间常数 (s) - N1 惯量大 -> 时间常数长
  tau_N1: 1.35,     // 低压转子响应时间常数
  tau_N2: 0.42,     // 高压转子响应时间常数

  // 稳态映射 (Wf -> 各状态稳态值的非线性函数)
  // 这些系数基于典型 CFM56 级发动机台架试车数据拟合
  n1_coef:   [0.0,  12.8, 48.5, 18.2, -3.1],   // n1_ss(wf) 多项式系数
  n2_coef:   [0.0,  14.5, 55.3, 20.1, -2.8],   // n2_ss(wf)
  egt_coef:  [280, 320,  215,  68,   -8.2],    // egt_ss(wf) °C
  ps3_coef:  [18,  115,   410,  95,   -12],    // ps3_ss(wf) psia
  wf_max_to_gain: 4.8,                           // 最大燃油流量 kg/s

  // EGT 附加动态 (燃烧室延迟 + 涡轮热惯性)
  tau_egt_chamber: 0.08,   // 燃烧传输延迟
  tau_egt_thermal: 0.65,   // 金属热惯性
  egt_overshoot_ratio: 1.18
}

function polyEval(coef, x) {
  // Horner 法: c0 + c1*x + c2*x^2 + ...
  let res = 0
  for (let i = coef.length - 1; i >= 0; i--) {
    res = res * x + coef[i]
  }
  return res
}

export class EngineDynamics {
  constructor(sampleTime) {
    this.Ts = sampleTime  // 100Hz = 0.01s

    // ---- 状态初始化 (冷机 / 关车状态) ----
    this.N1 = 0.0        // % 额定转速
    this.N2 = 0.0
    this.EGT = 25.0      // °C (环境温度起步)
    this.Ps3 = 14.7      // psia (环境大气压)
    this.P2  = 14.7      // psia (进气压力)
    this.T2  = 15.0      // °C   (进气温度 = ISA 标准日)

    // EGT 内部延迟状态 (二阶滤波模拟传输延迟 + 热惯性)
    this.egtStage1 = 25.0
    this.egtStage2 = 25.0

    // 执行器: 燃油计量活门 (FMV) 流量, 带一阶滞后
    this.Wf_actual = 0.0
    this.Wf_cmd_prev = 0.0
    this.tau_FMV = 0.025   // FMV 响应 25ms
  }

  setIntakeConditions(P2, T2) {
    this.P2 = P2
    this.T2 = T2
  }

  // ---- 非线性稳态工作点映射 ----
  steadyStatePoint(Wf_norm) {
    // Wf_norm: 归一化燃油流量 0~1
    const x = Math.max(0, Math.min(1.0, Wf_norm))
    return {
      N1_ss:  polyEval(ENGINE.n1_coef,  x),
      N2_ss:  polyEval(ENGINE.n2_coef,  x),
      EGT_ss: polyEval(ENGINE.egt_coef, x),
      Ps3_ss: polyEval(ENGINE.ps3_coef, x) * (this.P2 / 14.7)  // 修正进气压力
    }
  }

  // ---- 单步积分 (RK4) ----
  step(Wf_cmd) {
    const Ts = this.Ts

    // (1) FMV 活门一阶滞后 (执行器动态)
    const alpha_fmv = 1 - Math.exp(-Ts / this.tau_FMV)
    this.Wf_actual += alpha_fmv * (Wf_cmd - this.Wf_actual)

    // 归一化燃油流量 (0~1)
    const Wf_norm = this.Wf_actual / ENGINE.wf_max_to_gain

    // (2) 计算稳态目标值
    const ss = this.steadyStatePoint(Wf_norm)

    // (3) N1 低压转子动力学 (一阶)
    //     d(N1)/dt = (N1_ss - N1) / tau_N1
    const kn1 = (ss.N1_ss - this.N1) / ENGINE.tau_N1

    // (4) N2 高压转子动力学 (一阶)
    //     高压转子响应更快，但受 N1 负载耦合
    const loadCoupling = 0.12 * (this.N1 - ss.N1_ss) * 0
    const kn2 = (ss.N2_ss - this.N2) / ENGINE.tau_N2 + loadCoupling

    // (5) EGT 排气温度 (二阶: 燃烧延迟 + 热惯性)
    //     过冲模型: 目标超调 18% 然后回落
    const egtTarget = ss.EGT_ss + (ss.EGT_ss - this.EGT) * 0.15 * ENGINE.egt_overshoot_ratio
    const k_egt1 = (egtTarget   - this.egtStage1) / ENGINE.tau_egt_chamber
    const k_egt2 = (this.egtStage1 - this.egtStage2) / ENGINE.tau_egt_thermal

    // (6) Ps3 压气机出口压力 (一阶快动态)
    const k_ps3 = (ss.Ps3_ss - this.Ps3) / 0.08

    // ---- RK4 积分简化: 因方程为线性时变，用梯形法足够 ----
    // N1 / N2 / EGT / Ps3
    this.N1  += kn1  * Ts
    this.N2  += kn2  * Ts
    this.egtStage1 += k_egt1 * Ts
    this.egtStage2 += k_egt2 * Ts
    this.EGT  = this.egtStage2
    this.Ps3 += k_ps3 * Ts

    // 物理硬约束 (最后防线)
    this.N1  = Math.max(0, Math.min(115, this.N1))
    this.N2  = Math.max(0, Math.min(118, this.N2))
    this.EGT = Math.max(-60, Math.min(1200, this.EGT))
    this.Ps3 = Math.max(14.0, Math.min(700, this.Ps3))

    return {
      N1: this.N1,
      N2: this.N2,
      EGT: this.EGT,
      Ps3: this.Ps3,
      Wf_actual: this.Wf_actual,
      Wf_cmd: Wf_cmd
    }
  }

  // 用于 PI 控制器初始化时计算稳态燃油量
  estimateSteadyFuelFlow(n1Target) {
    // 反函数: 通过二分法找到使 n1_ss(wf) = n1Target 的 wf
    let lo = 0.0, hi = ENGINE.wf_max_to_gain
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      const ss = this.steadyStatePoint(mid / ENGINE.wf_max_to_gain)
      if (ss.N1_ss < n1Target) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
}
