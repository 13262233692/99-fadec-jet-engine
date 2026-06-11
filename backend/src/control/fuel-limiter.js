// ============================================================
// Min/Max 动态边界限幅器 (Fuel Flow Boundary Limiter)
// 这是保护发动机免于压气机失速或富油超温的最后一道安全屏障
// 所有燃油指令必须经过此模块后方可下发给 FMV
//
// 限幅逻辑参考真实涡扇发动机 FADEC 保护表:
//   Wf_min(Ps3, T2) : 贫油熄火边界 (防止压缩机喘振 / 火焰熄灭)
//   Wf_max(Ps3, T2) : 富油超温边界 (防止 EGT 超限 / 涡轮叶片烧毁)
// ============================================================

// Ps3 (压气机出口压力, psia) 对应各工作阶段典型值:
//   慢车: 30~50  |  巡航: 180~250  |  起飞: 400~520
const Wf_MIN_TABLE = [
  { ps3: 20,  t2: -40, wf: 0.045 }, { ps3: 20,  t2: 15, wf: 0.055 }, { ps3: 20,  t2: 50, wf: 0.065 },
  { ps3: 60,  t2: -40, wf: 0.110 }, { ps3: 60,  t2: 15, wf: 0.140 }, { ps3: 60,  t2: 50, wf: 0.170 },
  { ps3: 150, t2: -40, wf: 0.260 }, { ps3: 150, t2: 15, wf: 0.330 }, { ps3: 150, t2: 50, wf: 0.410 },
  { ps3: 300, t2: -40, wf: 0.510 }, { ps3: 300, t2: 15, wf: 0.640 }, { ps3: 300, t2: 50, wf: 0.790 },
  { ps3: 450, t2: -40, wf: 0.760 }, { ps3: 450, t2: 15, wf: 0.950 }, { ps3: 450, t2: 50, wf: 1.170 },
  { ps3: 550, t2: -40, wf: 0.920 }, { ps3: 550, t2: 15, wf: 1.150 }, { ps3: 550, t2: 50, wf: 1.410 }
]

const Wf_MAX_TABLE = [
  { ps3: 20,  t2: -40, wf: 0.130 }, { ps3: 20,  t2: 15, wf: 0.160 }, { ps3: 20,  t2: 50, wf: 0.195 },
  { ps3: 60,  t2: -40, wf: 0.390 }, { ps3: 60,  t2: 15, wf: 0.470 }, { ps3: 60,  t2: 50, wf: 0.570 },
  { ps3: 150, t2: -40, wf: 1.020 }, { ps3: 150, t2: 15, wf: 1.250 }, { ps3: 150, t2: 50, wf: 1.510 },
  { ps3: 300, t2: -40, wf: 2.180 }, { ps3: 300, t2: 15, wf: 2.630 }, { ps3: 300, t2: 50, wf: 3.150 },
  { ps3: 450, t2: -40, wf: 3.420 }, { ps3: 450, t2: 15, wf: 4.100 }, { ps3: 450, t2: 50, wf: 4.880 },
  { ps3: 550, t2: -40, wf: 4.280 }, { ps3: 550, t2: 15, wf: 5.090 }, { ps3: 550, t2: 50, wf: 6.040 }
]

function bilinearInterpolate(table, ps3, t2) {
  const ps3Sorted = [...new Set(table.map(r => r.ps3))].sort((a, b) => a - b)
  const t2Sorted  = [...new Set(table.map(r => r.t2))].sort((a, b) => a - b)

  const ps3Clamped = Math.max(ps3Sorted[0], Math.min(ps3Sorted[ps3Sorted.length - 1], ps3))
  const t2Clamped  = Math.max(t2Sorted[0],  Math.min(t2Sorted[t2Sorted.length - 1],   t2))

  let i0 = 0, i1 = ps3Sorted.length - 1
  for (let i = 0; i < ps3Sorted.length - 1; i++) {
    if (ps3Clamped >= ps3Sorted[i] && ps3Clamped <= ps3Sorted[i + 1]) {
      i0 = i; i1 = i + 1; break
    }
  }
  let j0 = 0, j1 = t2Sorted.length - 1
  for (let j = 0; j < t2Sorted.length - 1; j++) {
    if (t2Clamped >= t2Sorted[j] && t2Clamped <= t2Sorted[j + 1]) {
      j0 = j; j1 = j + 1; break
    }
  }

  const lookup = (p, t) => table.find(r => r.ps3 === p && r.t2 === t)?.wf ?? 0

  const ps3_0 = ps3Sorted[i0], ps3_1 = ps3Sorted[i1]
  const t2_0  = t2Sorted[j0],  t2_1  = t2Sorted[j1]
  const wf_00 = lookup(ps3_0, t2_0)
  const wf_01 = lookup(ps3_0, t2_1)
  const wf_10 = lookup(ps3_1, t2_0)
  const wf_11 = lookup(ps3_1, t2_1)

  const rx = (ps3_1 - ps3_0) === 0 ? 0 : (ps3Clamped - ps3_0) / (ps3_1 - ps3_0)
  const ry = (t2_1 - t2_0) === 0 ? 0 : (t2Clamped - t2_0) / (t2_1 - t2_0)

  const wf_0 = wf_00 * (1 - rx) + wf_10 * rx
  const wf_1 = wf_01 * (1 - rx) + wf_11 * rx
  return wf_0 * (1 - ry) + wf_1 * ry
}

export class FuelFlowLimiter {
  constructor() {
    // 限幅历史状态，供 PI 调节器做抗积分饱和反馈
    this.saturationState = 'none' // 'none' | 'hi' | 'lo'
  }

  computeLimits(ps3, t2) {
    const wfMin = bilinearInterpolate(Wf_MIN_TABLE, ps3, t2)
    const wfMax = bilinearInterpolate(Wf_MAX_TABLE, ps3, t2)
    return { wfMin, wfMax }
  }

  limit(wfRaw, ps3, t2) {
    const { wfMin, wfMax } = this.computeLimits(ps3, t2)

    let wfLimited = wfRaw
    if (wfRaw > wfMax) {
      wfLimited = wfMax
      this.saturationState = 'hi'
    } else if (wfRaw < wfMin) {
      wfLimited = wfMin
      this.saturationState = 'lo'
    } else {
      this.saturationState = 'none'
    }

    return {
      wfCmd: wfLimited,
      wfMin,
      wfMax,
      saturation: this.saturationState
    }
  }

  getSaturationState() {
    return this.saturationState
  }
}
