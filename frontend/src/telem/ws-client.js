// ============================================================
// WebSocket 遥测数据接收层 (100Hz)
// - 自动断线重连 (指数退避)
// - 数据帧去抖与平滑
// - 暴露响应式 telem 对象与 sendTLA 方法
// ============================================================

import { reactive } from 'vue'

export const telem = reactive({
  connected: false,
  latencyMs: 0,
  frameRate: 0,

  tla: 0,
  tlaRaw: 0,
  n1Desired: 0,
  n1: 0,
  n1Error: 0,
  n2: 0,
  egt: 0,
  ps3: 0,
  t2: 15,
  p2: 14.7,
  wfRaw: 0,
  wfCmd: 0,
  wfActual: 0,
  wfMin: 0,
  wfMax: 0,
  saturation: 'none',
  loopTime_us: 0,
  timestamp: 0
})

let ws = null
let reconnectTimer = null
let reconnectAttempts = 0
let frameCount = 0
let fpsTimer = 0
let lastSendTime = 0

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = location.hostname || 'localhost'
  const url = `${proto}//${host}:8080`

  try {
    ws = new WebSocket(url)
  } catch (e) {
    scheduleReconnect()
    return
  }

  ws.onopen = () => {
    telem.connected = true
    reconnectAttempts = 0
    console.log('[TELEM] WebSocket 已连接:', url)
  }

  ws.onmessage = (ev) => {
    // 帧率统计 (每秒)
    frameCount++
    const now = performance.now()
    if (now - fpsTimer >= 1000) {
      telem.frameRate = Math.round(frameCount * 1000 / (now - fpsTimer))
      frameCount = 0
      fpsTimer = now
    }

    // 延迟估算
    telem.latencyMs = Math.round((now - lastSendTime) / 2)

    try {
      const d = JSON.parse(ev.data)
      if (typeof d === 'object' && d !== null && 'n1' in d) {
        Object.assign(telem, d)
      }
    } catch (e) {
      // 忽略 ack 或其他非 JSON 帧
    }
  }

  ws.onerror = (ev) => {
    console.warn('[TELEM] WebSocket 错误')
  }

  ws.onclose = () => {
    telem.connected = false
    console.warn('[TELEM] 连接断开，准备重连...')
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectAttempts++
  const delay = Math.min(1000 * Math.pow(1.6, reconnectAttempts - 1), 10000)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

export function sendTLA(percent) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  lastSendTime = performance.now()
  ws.send(JSON.stringify({ type: 'tla', value: percent }))
}

connect()
