// ============================================================
// FADEC 主控制闭环 (Full Authority Digital Engine Control)
//
// 控制架构 (100Hz 主循环):
//   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
//   │ TLA 解算 │───▶│  PI + LL │───▶│ Wf 限幅  │───▶│ 发动机   │
//   │ (输入)   │    │ (控制律) │    │ (安全层) │    │ (被控对象)│
//   └──────────┘    └──────────┘    └──────────┘    └────┬─────┘
//        ▲                                               │ N1,N2
//        │                                               ▼
//        └──────────────── 反馈回路 ◀────────────────────┘
//
// 对外 WebSocket 接口:
//   入站 (client -> server):  { type:'tla', value: 0~100 }
//   出站 (server -> client):  100Hz 遥测帧 (N1, N2, EGT, Ps3, Wf, ...)
// ============================================================

import { solveTLA } from './tla-solver.js'
import { PIController } from './pi-controller.js'
import { FuelFlowLimiter } from './fuel-limiter.js'
import { EngineDynamics } from './engine-dynamics.js'

export class FADECLoop {
  constructor() {
    this.Fs = 100                   // 控制频率 Hz
    this.Ts = 1 / this.Fs           // 0.01s = 10ms

    // 飞行员 TLA 推力杆指令 (0~100%)
    this.tla = 0.0
    this.tlaFiltered = 0.0
    this.tlaSlewRate = 40           // 最大推/收油门速率 %/s

    // 模块实例化
    this.engine = new EngineDynamics(this.Ts)

    this.pi = new PIController({
      Kp: 0.045,                    // 比例增益 (kg/s per % N1)
      Ki: 0.18,                     // 积分增益
      sampleTime: this.Ts,
      leadTime: 0.16,               // 超前补偿 (加快响应)
      lagTime:  0.48,               // 滞后滤波 (抑制高频噪声)
      bias: 0.85,                   // 初始稳态偏置
      outMin: 0.0,                  // 硬限 (限幅器前)
      outMax: 6.5
    })

    this.limiter = new FuelFlowLimiter()

    // 调度状态
    this.frameCount = 0
    this.lastTick = process.hrtime.bigint()

    // 遥测缓存
    this.telem = {
      tla: 0, tlaDesired: 0,
      n1: 0, n1Desired: 0, n1Error: 0,
      n2: 0, egt: 0, ps3: 0, t2: 15,
      wfRaw: 0, wfCmd: 0, wfActual: 0,
      wfMin: 0, wfMax: 0,
      saturation: 'none',
      loopTime_us: 0,
      timestamp: 0
    }
  }

  setTLA(percent) {
    this.tla = Math.max(0, Math.min(100, percent))
  }

  // ---- 单个控制周期执行 ----
  tick() {
    const t0 = process.hrtime.bigint()

    // (1) TLA 速率限制 (防止飞行员猛推导致瞬态超调)
    const maxDelta = this.tlaSlewRate * this.Ts
    const delta = this.tla - this.tlaFiltered
    if (Math.abs(delta) > maxDelta) {
      this.tlaFiltered += Math.sign(delta) * maxDelta
    } else {
      this.tlaFiltered = this.tla
    }

    // (2) 推力杆 -> 期望 N1
    const n1Desired = solveTLA(this.tlaFiltered)

    // (3) 当前传感器反馈 (发动机模型输出)
    const n1Measured = this.engine.N1
    const ps3 = this.engine.Ps3
    const t2  = this.engine.T2

    // (4) PI + 超前-滞后控制律
    const satState = this.limiter.getSaturationState()
    const wfRaw = this.pi.step(n1Desired, n1Measured, satState)

    // (5) Wf 动态边界限幅 (安全关键)
    const limitResult = this.limiter.limit(wfRaw, ps3, t2)
    const wfCmd = limitResult.wfCmd

    // (6) 下发给发动机 (被控对象积分)
    const eng = this.engine.step(wfCmd)

    // ---- 遥测打包 ----
    const t1 = process.hrtime.bigint()
    this.frameCount++
    this.telem = {
      tla: this.tlaFiltered,
      tlaRaw: this.tla,
      n1Desired,
      n1: eng.N1,
      n1Error: n1Desired - eng.N1,
      n2: eng.N2,
      egt: eng.EGT,
      ps3: eng.Ps3,
      t2: this.engine.T2,
      p2:  this.engine.P2,
      wfRaw,
      wfCmd,
      wfActual: eng.Wf_actual,
      wfMin: limitResult.wfMin,
      wfMax: limitResult.wfMax,
      saturation: limitResult.saturation,
      workerReady: limitResult.workerReady,
      workerLatency_us: limitResult.workerLatency_us,
      loopTime_us: Number(t1 - t0) / 1e3,
      timestamp: Date.now() + this.frameCount / this.Fs * 1000
    }

    return this.telem
  }

  start(onTick) {
    this._interval = setInterval(() => {
      this.tick()
      onTick && onTick(this.telem)
    }, this.Ts * 1000)

    // Node.js 高精度定时校正 (避免 setInterval 漂移)
    this._interval.unref && this._interval.unref()
  }

  stop() {
    this._interval && clearInterval(this._interval)
  }
}
