<template>
  <canvas
    ref="canvasRef"
    :width="size"
    :height="size"
    :style="{ width: size + 'px', height: size + 'px' }"
  />
</template>

<script setup>
// ============================================================
// Gauge.vue - 高性能航空圆形仪表盘
// 特性:
//   - 原生 Canvas 抗锯齿渲染
//   - 支持 N1(0~110%)、N2(0~115%)、EGT(0~1000°C) 三种量程
//   - 细刻度 + 粗刻度 + 红区 (Redline) + 绿区 (正常范围)
//   - 指针为三角形航空仪表造型，带半透明阴影 (anti-alias)
//   - requestAnimationFrame 驱动，不阻塞 WS 接收线程
//   - 指针值做一阶滞后平滑 (视觉流畅度 >= 100Hz 效果)
// ============================================================
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  label:      { type: String, required: true },
  unit:       { type: String, required: true },
  value:      { type: Number, required: true },
  min:        { type: Number, default: 0 },
  max:        { type: Number, default: 100 },
  greenStart: { type: Number, default: 0 },
  greenEnd:   { type: Number, default: 0 },
  yellowStart:{ type: Number, default: 0 },
  yellowEnd:  { type: Number, default: 0 },
  redStart:   { type: Number, default: 0 },
  redEnd:     { type: Number, default: 0 },
  majorStep:  { type: Number, default: 10 },
  minorStep:  { type: Number, default: 2 },
  size:       { type: Number, default: 280 },
  digits:     { type: Number, default: 1 }
})

const canvasRef = ref(null)
let ctx = null
let displayValue = 0
let rafId = null

function mapToAngle(v) {
  // 映射到 225° ~ -45° (顺时针扫过 270°)
  const clamped = Math.max(props.min, Math.min(props.max, v))
  const ratio = (clamped - props.min) / (props.max - props.min)
  const startDeg = 225  // 左下起点
  const sweepDeg = -270 // 顺时针扫过 270 度到右下
  return (startDeg + sweepDeg * ratio) * Math.PI / 180
}

function draw() {
  if (!ctx) return
  const S = props.size
  const cx = S / 2
  const cy = S / 2
  const R = S * 0.44

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 清屏 (透明背景)
  ctx.clearRect(0, 0, S, S)

  // ---- (1) 外圈金属环 ----
  const grd = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.18)
  grd.addColorStop(0, '#1a1f2e')
  grd.addColorStop(0.6, '#2a3145')
  grd.addColorStop(1, '#0b0e18')
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2)
  ctx.fill()

  // 内环表盘底
  const dialGrd = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.0)
  dialGrd.addColorStop(0, '#151928')
  dialGrd.addColorStop(1, '#0a0d18')
  ctx.fillStyle = dialGrd
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.0, 0, Math.PI * 2)
  ctx.fill()

  // ---- (2) 色区环 (红/黄/绿) ----
  function drawArcBand(startVal, endVal, color, width = 10, innerRatio = 0.82) {
    if (startVal === endVal) return
    const a0 = mapToAngle(startVal)
    const a1 = mapToAngle(endVal)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'butt'
    ctx.beginPath()
    ctx.arc(cx, cy, R * innerRatio, Math.min(a0, a1), Math.max(a0, a1), false)
    ctx.stroke()
  }
  drawArcBand(props.greenStart,  props.greenEnd,  'rgba(60, 220, 120, 0.85)',  9, 0.82)
  drawArcBand(props.yellowStart, props.yellowEnd, 'rgba(255, 200, 60, 0.90)',  9, 0.82)
  drawArcBand(props.redStart,    props.redEnd,    'rgba(255, 70, 80,  0.95)',  9, 0.82)

  // ---- (3) 细刻度 ----
  const tickR = R * 0.74
  const minorColor = '#5a6480'
  const majorColor = '#c8d0e0'
  for (let v = props.min; v <= props.max + 1e-9; v += props.minorStep) {
    const a = mapToAngle(v)
    const isMajor = Math.abs(v % props.majorStep) < 1e-6 || Math.abs((v + props.minorStep) % props.majorStep) < 1e-6
    const len = isMajor ? 14 : 6
    const color = isMajor ? majorColor : minorColor
    const lw = isMajor ? 2.0 : 1.0
    const rIn = tickR - len
    const rOut = tickR
    const x1 = cx + Math.cos(a) * rIn
    const y1 = cy + Math.sin(a) * rIn
    const x2 = cx + Math.cos(a) * rOut
    const y2 = cy + Math.sin(a) * rOut
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()

    // ---- (4) 主刻度数字 ----
    if (isMajor) {
      const txR = tickR - 32
      const tx = cx + Math.cos(a) * txR
      const ty = cy + Math.sin(a) * txR
      ctx.fillStyle = '#e8ecf5'
      ctx.font = `bold ${Math.round(S * 0.045)}px 'Consolas', monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(v.toFixed(0), tx, ty)
    }
  }

  // ---- (5) 标题标签 ----
  ctx.fillStyle = '#9aa4bc'
  ctx.font = `600 ${Math.round(S * 0.055)}px 'Segoe UI', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(props.label, cx, cy - R * 0.38)

  // ---- (6) 当前数值显示 (下方大数字) ----
  const valueStr = displayValue.toFixed(props.digits)
  const numFontSize = Math.round(S * 0.13)

  // 数值颜色 (红区变红)
  let numColor = '#ffffff'
  if (displayValue >= props.redStart && props.redEnd > props.redStart) numColor = '#ff6677'
  else if (displayValue >= props.yellowStart && props.yellowEnd > props.yellowStart) numColor = '#ffdd66'
  else if (displayValue >= props.greenStart && displayValue <= props.greenEnd) numColor = '#7fffc0'

  // 数字阴影
  ctx.shadowColor = 'rgba(0,0,0,0.8)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 2
  ctx.fillStyle = numColor
  ctx.font = `bold ${numFontSize}px 'Consolas', monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(valueStr, cx, cy + R * 0.42)
  ctx.shadowBlur = 0

  // 单位文字
  ctx.fillStyle = '#8892a8'
  ctx.font = `500 ${Math.round(S * 0.038)}px 'Segoe UI', sans-serif`
  ctx.fillText(props.unit, cx, cy + R * 0.60)

  // ---- (7) 指针 (航空三角造型) ----
  const needleA = mapToAngle(displayValue)
  const perpA = needleA + Math.PI / 2
  const needleLen = R * 0.78
  const needleTail = -R * 0.12
  const needleW = R * 0.035

  // 指针阴影
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.7)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 3

  // 指针主体 (渐变)
  const nGrd = ctx.createLinearGradient(
    cx + Math.cos(needleA) * needleTail,
    cy + Math.sin(needleA) * needleTail,
    cx + Math.cos(needleA) * needleLen,
    cy + Math.sin(needleA) * needleLen
  )
  nGrd.addColorStop(0, '#fafafa')
  nGrd.addColorStop(0.6, '#ffffff')
  nGrd.addColorStop(1, '#ffdd33')
  ctx.fillStyle = nGrd

  ctx.beginPath()
  ctx.moveTo(
    cx + Math.cos(needleA) * needleLen,
    cy + Math.sin(needleA) * needleLen
  )
  ctx.lineTo(
    cx + Math.cos(perpA) * needleW + Math.cos(needleA) * needleTail,
    cy + Math.sin(perpA) * needleW + Math.sin(needleA) * needleTail
  )
  ctx.lineTo(
    cx - Math.cos(perpA) * needleW + Math.cos(needleA) * needleTail,
    cy - Math.sin(perpA) * needleW + Math.sin(needleA) * needleTail
  )
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // 指针描边
  ctx.strokeStyle = 'rgba(40,50,70,0.9)'
  ctx.lineWidth = 1.0
  ctx.stroke()

  // ---- (8) 中心轴帽 ----
  const capR = R * 0.11
  const capGrd = ctx.createRadialGradient(cx, cy, capR * 0.2, cx, cy, capR)
  capGrd.addColorStop(0, '#d4d9e5')
  capGrd.addColorStop(0.6, '#8890a4')
  capGrd.addColorStop(1, '#2a3148')
  ctx.fillStyle = capGrd
  ctx.beginPath()
  ctx.arc(cx, cy, capR, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#1a1f30'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function renderLoop() {
  // 一阶滞后平滑 (τ≈60ms，视觉上无滞后但无抖动)
  const alpha = 0.18
  displayValue += alpha * (props.value - displayValue)

  draw()
  rafId = requestAnimationFrame(renderLoop)
}

onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  // 设备像素比适配 (高 DPI 屏幕)
  const dpr = window.devicePixelRatio || 1
  if (dpr !== 1) {
    const cssS = props.size
    canvasRef.value.width = cssS * dpr
    canvasRef.value.height = cssS * dpr
    canvasRef.value.style.width = cssS + 'px'
    canvasRef.value.style.height = cssS + 'px'
    ctx.scale(dpr, dpr)
  }
  displayValue = props.value
  renderLoop()
})

onBeforeUnmount(() => {
  rafId && cancelAnimationFrame(rafId)
})
</script>
