// ============================================================
// FADEC 后端服务入口
// - 启动 HTTP 基础服务
// - 挂载 WebSocket (ws) 服务监听 8080 端口
// - 启动 FADEC 100Hz 主控制循环
// - 对所有已连接客户端以 100Hz 广播遥测帧
// - 接收客户端 TLA 推力杆指令
// ============================================================

import { WebSocketServer } from 'ws'
import { FADECLoop } from './control/fadec-loop.js'

const PORT = 8080

const wss = new WebSocketServer({ port: PORT, perMessageDeflate: false })
const fadec = new FADECLoop()

// 客户端广播队列
const clients = new Set()

// 序列化缓存 (重用 Buffer 减少 GC 压力)
let broadcastBuf = null

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress
  console.log(`[FADEC] 客户端已连接: ${ip} | 当前连接数: ${clients.size + 1}`)
  clients.add(ws)

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'tla' && typeof msg.value === 'number') {
        fadec.setTLA(msg.value)
      }
      // 回显确认 (低优先级，不阻碍主循环)
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'ack', ok: true, ts: Date.now() }))
      }
    } catch (e) {
      console.error('[FADEC] 消息解析错误:', e.message)
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    console.log(`[FADEC] 客户端已断开 | 当前连接数: ${clients.size}`)
  })

  ws.on('error', (err) => {
    console.error('[FADEC] WebSocket 错误:', err.message)
    clients.delete(ws)
  })
})

// ---- 启动 100Hz FADEC 主循环 ----
console.log(`[FADEC] 启动主控制循环 @ ${fadec.Fs}Hz, Ts=${fadec.Ts * 1000}ms`)
fadec.start((telem) => {
  // 编码遥测帧 (每个周期只序列化一次)
  broadcastBuf = JSON.stringify(telem)

  if (clients.size === 0) return

  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(broadcastBuf, (err) => {
        if (err) { /* 静默丢弃发送错误 */ }
      })
    }
  }
})

console.log(`[FADEC] WebSocket 服务已就绪: ws://0.0.0.0:${PORT}`)
console.log(`[FADEC] 控制律: TLA 解算 -> PI+超前滞后 -> Wf 限幅 -> 发动机动力学`)
console.log(`[FADEC] 遥测输出: N1, N2, EGT, Ps3, Wf  @ 100Hz`)

// ---- 进程信号优雅关闭 ----
process.on('SIGINT', () => {
  console.log('\n[FADEC] 收到 SIGINT，关闭控制循环...')
  fadec.stop()
  wss.close()
  process.exit(0)
})
