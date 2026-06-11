// ============================================================
// 高精度 PI 调节器 (带抗积分饱和 Anti-Windup)
// 控制对象: N1 低压转子转速 -> 燃油流量 (Fuel Flow, Wf)
//
// 控制架构:
//   e_n1 = N1_desired - N1_measured
//   u = Kp * e + Ki * ∫e dt    (PI 主通道)
//   u_corrected = LeadLag(u)   (超前-滞后相位补偿)
//   Wf_cmd = u_corrected + Wf_bias  (叠加稳态偏置量)
// ============================================================

import { LeadLagCompensator } from './lead-lag.js'

export class PIController {
  constructor(config) {
    this.Kp = config.Kp            // 比例增益 (kg/s per % N1)
    this.Ki = config.Ki            // 积分增益 (kg/s per % N1 * s)
    this.Ts = config.sampleTime    // 采样周期 (s)
    this.outMin = config.outMin    // 输出下限 (防熄火)
    this.outMax = config.outMax    // 输出上限 (防超温)

    // 稳态燃油偏置 (N1~60% 时典型巡航流量)
    this.bias = config.bias || 0.85

    // 积分状态
    this.integrator = 0
    this.prevError = 0

    // 超前-滞后补偿网络 (典型值: T_alpha=0.15s, T_beta=0.45s)
    this.leadLag = new LeadLagCompensator(
      config.leadTime || 0.15,
      config.lagTime || 0.45,
      this.Ts
    )
  }

  reset(n1Measured, wfSteady) {
    this.integrator = 0
    this.prevError = 0
    this.bias = wfSteady
    this.leadLag.reset(wfSteady)
  }

  step(n1Desired, n1Measured, limiterState) {
    const error = n1Desired - n1Measured

    // ------ 比例项 ------
    const pTerm = this.Kp * error

    // ------ 积分项 (带抗积分饱和 Back-Calculation) ------
    let iCandidate = this.integrator + this.Ki * this.Ts * error

    // 如当前输出已被限幅器截断，停止同向积分
    if (limiterState === 'hi' && error > 0) {
      // 饱和高限 + 正误差 -> 冻结积分
    } else if (limiterState === 'lo' && error < 0) {
      // 饱和低限 + 负误差 -> 冻结积分
    } else {
      this.integrator = iCandidate
    }

    // ------ PI 合成 ------
    const piOut = pTerm + this.integrator

    // ------ 超前-滞后相位补偿 ------
    const compensated = this.leadLag.step(piOut)

    // ------ 叠加稳态偏置，得到原始燃油指令 ------
    const wfRaw = compensated + this.bias

    this.prevError = error
    return wfRaw
  }
}
