// ============================================================
// 超前-滞后补偿网络 (Lead-Lag Compensator)
// 用于补偿 N1/N2 转速传感器延迟及燃油执行机构相位滞后
//
// 传递函数 (s 域):  G(s) = (1 + T_alpha * s) / (1 + T_beta * s)
// 双线性变换离散化 (Tustin):  z = (2/s + 1) / (2/s - 1)
// ============================================================

export class LeadLagCompensator {
  constructor(leadTimeConstant, lagTimeConstant, sampleTime) {
    this.T_alpha = leadTimeConstant   // 超前时间常数 (s)
    this.T_beta = lagTimeConstant     // 滞后时间常数 (s)
    this.Ts = sampleTime              // 采样周期 (s)

    // 离散化系数计算
    const Ts = this.Ts
    const Tα = this.T_alpha
    const Tβ = this.T_beta

    this.b0 =  (2 * Tα + Ts) / (2 * Tβ + Ts)
    this.b1 =  (Ts - 2 * Tα) / (2 * Tβ + Ts)
    this.a1 =  (Ts - 2 * Tβ) / (2 * Tβ + Ts)

    this.x_prev = 0  // 上一拍输入
    this.y_prev = 0  // 上一拍输出
  }

  reset(initialValue = 0) {
    this.x_prev = initialValue
    this.y_prev = initialValue
  }

  step(input) {
    const y = this.b0 * input + this.b1 * this.x_prev - this.a1 * this.y_prev
    this.x_prev = input
    this.y_prev = y
    return y
  }
}
