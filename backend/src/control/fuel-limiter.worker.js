// ============================================================
// Fuel Limiter Worker Thread
// 将 Wf 性能表二维插值完全从 Node.js 主线程剥离
// 通信协议 (主线程 -> Worker):
//   { id:number, ps3:number, t2:number }
// 通信协议 (Worker -> 主线程):
//   { id:number, wfMin:number, wfMax:number, cpuTime_us:number }
// ============================================================
import { parentPort, isMainThread, threadId } from 'worker_threads'

if (isMainThread) {
  throw new Error('This module must run as a worker_threads worker')
}

// ---------- 性能表（加载在 Worker 私有 V8 堆中，不与主线程共享 GC 压力） ----------
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

// ---------- 预索引：将表整理成二维数组，消除每拍 find() 的 O(N) 开销 ----------
// 构建查找索引:  ps3_axis[], t2_axis[], grid[ps3_idx][t2_idx] = wf
function buildGrid(table) {
  const ps3Set = [...new Set(table.map(r => r.ps3))].sort((a, b) => a - b)
  const t2Set  = [...new Set(table.map(r => r.t2))].sort((a, b) => a - b)
  const grid = new Float64Array(ps3Set.length * t2Set.length)
  for (let i = 0; i < ps3Set.length; i++) {
    for (let j = 0; j < t2Set.length; j++) {
      const row = table.find(r => r.ps3 === ps3Set[i] && r.t2 === t2Set[j])
      grid[i * t2Set.length + j] = row ? row.wf : 0
    }
  }
  return {
    ps3Axis: new Float64Array(ps3Set),
    t2Axis:  new Float64Array(t2Set),
    grid,
    nPs3: ps3Set.length,
    nT2:  t2Set.length
  }
}

const MIN_GRID = buildGrid(Wf_MIN_TABLE)
const MAX_GRID = buildGrid(Wf_MAX_TABLE)

// ---------- O(1) 网格下标定位（二分查找，网格轴已排序） ----------
function bsearchIndex(arr, value) {
  const n = arr.length
  if (value <= arr[0]) return 0
  if (value >= arr[n - 1]) return n - 2
  let lo = 0, hi = n - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (arr[mid] <= value) lo = mid
    else hi = mid - 1
  }
  return lo
}

// ---------- 高度优化的双线性插值（无临时对象，纯栈变量） ----------
function interpGrid(g, ps3, t2) {
  const i = bsearchIndex(g.ps3Axis, ps3)
  const j = bsearchIndex(g.t2Axis,  t2)

  const ps3_0 = g.ps3Axis[i],     ps3_1 = g.ps3Axis[i + 1]
  const t2_0  = g.t2Axis[j],      t2_1  = g.t2Axis[j + 1]

  // 钳位到物理边界
  const ps3_c = (ps3_1 - ps3_0) === 0 ? 0 : Math.max(0, Math.min(1, (ps3 - ps3_0) / (ps3_1 - ps3_0)))
  const t2_c  = (t2_1  - t2_0)  === 0 ? 0 : Math.max(0, Math.min(1, (t2  - t2_0)  / (t2_1  - t2_0)))

  const stride = g.nT2
  const wf_00 = g.grid[i       * stride + j]
  const wf_01 = g.grid[i       * stride + j + 1]
  const wf_10 = g.grid[(i + 1) * stride + j]
  const wf_11 = g.grid[(i + 1) * stride + j + 1]

  const wf_0 = wf_00 * (1 - ps3_c) + wf_10 * ps3_c
  const wf_1 = wf_01 * (1 - ps3_c) + wf_11 * ps3_c
  return wf_0 * (1 - t2_c) + wf_1 * t2_c
}

// ---------- 消息循环（永不返回，独占 Worker 线程） ----------
let seqCount = 0
parentPort.on('message', (msg) => {
  const t0 = process.hrtime.bigint()
  const ps3 = msg.ps3
  const t2  = msg.t2
  const id  = msg.id

  const wfMin = interpGrid(MIN_GRID, ps3, t2)
  const wfMax = interpGrid(MAX_GRID, ps3, t2)

  const t1 = process.hrtime.bigint()
  seqCount++

  // 仅传 3 个标量数字，无对象深拷贝（V8 Serialization API 高效）
  parentPort.postMessage({
    id,
    wfMin,
    wfMax,
    cpuTime_us: Number(t1 - t0) / 1000,
    workerId: threadId,
    seq: seqCount
  })
})

// 冷启动时立即预执行一次，强制 JIT 编译热点路径，避免首拍解释执行卡顿
;(function warmup() {
  for (let k = 0; k < 5000; k++) {
    const p = 20 + Math.random() * 530
    const t = -40 + Math.random() * 90
    interpGrid(MIN_GRID, p, t)
    interpGrid(MAX_GRID, p, t)
  }
  parentPort.postMessage({
    id: -1,
    wfMin: 0,
    wfMax: 0,
    cpuTime_us: 0,
    workerId: threadId,
    seq: 0,
    warmup: true
  })
})()
