<template>
  <div class="throttle-container" ref="containerRef">
    <div class="throttle-track">
      <div class="throttle-track-bg" />

      <div
        v-for="g in gates" :key="g.name"
        class="throttle-gate"
        :style="{ bottom: toPercent(g.value) + '%' }"
      >
        <div class="gate-line" :class="g.class" />
        <div class="gate-label">{{ g.name }}</div>
      </div>

      <div class="throttle-fill" :style="{ height: toPercent(tla) + '%' }" />

      <div
        class="throttle-knob"
        :style="{ bottom: `calc(${toPercent(tla)}% - 18px)` }"
        @mousedown="onMouseDown"
        @touchstart.prevent="onTouchStart"
      >
        <div class="knob-top" />
        <div class="knob-body" />
        <div class="knob-label">TLA {{ tla.toFixed(0) }}%</div>
      </div>
    </div>

    <div class="throttle-scale">
      <div v-for="tick in scaleTicks" :key="tick" class="scale-row">
        <div class="scale-line" :class="{ major: tick % 25 === 0 }" />
        <div class="scale-text" v-if="tick % 25 === 0">{{ tick }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
// ============================================================
// ThrottleLever.vue - 推力杆 (油门杆) 模拟控件
// 垂直拖动设置 TLA (Thrust Lever Angle) 0~100%
// 支持鼠标拖动 + 触摸拖动 + 刻度点击跳转
// ============================================================
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const emit = defineEmits(['update:modelValue'])
const props = defineProps({
  modelValue: { type: Number, default: 0 }
})

const tla = ref(props.modelValue)
const containerRef = ref(null)
let dragging = false

const gates = [
  { name: 'CUTOFF', value: 0,   class: 'gate-cut' },
  { name: 'IDLE',   value: 15,  class: 'gate-idle' },
  { name: 'CLB',    value: 70,  class: 'gate-clb' },
  { name: 'MCT',    value: 85,  class: 'gate-mct' },
  { name: 'TOGA',   value: 95,  class: 'gate-toga' }
]

const scaleTicks = computed(() => {
  const arr = []
  for (let i = 0; i <= 100; i += 5) arr.push(i)
  return arr
})

function toPercent(v) {
  return Math.max(0, Math.min(100, v))
}

function setFromClientY(clientY) {
  const el = containerRef.value?.querySelector('.throttle-track')
  if (!el) return
  const rect = el.getBoundingClientRect()
  const ratio = 1 - (clientY - rect.top) / rect.height
  const v = Math.max(0, Math.min(100, ratio * 100))
  // 卡入 gate 附近 (±2%)
  tla.value = Math.round(v * 2) / 2
  emit('update:modelValue', tla.value)
}

function onMouseDown(e) {
  dragging = true
  setFromClientY(e.clientY)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}
function onMouseMove(e) {
  if (!dragging) return
  setFromClientY(e.clientY)
}
function onMouseUp() {
  dragging = false
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

function onTouchStart(e) {
  const t = e.touches[0]
  dragging = true
  setFromClientY(t.clientY)
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onTouchEnd)
}
function onTouchMove(e) {
  if (!dragging) return
  e.preventDefault()
  setFromClientY(e.touches[0].clientY)
}
function onTouchEnd() {
  dragging = false
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
}

function onTrackClick(e) {
  if (dragging) return
  setFromClientY(e.clientY)
}

onMounted(() => {
  const track = containerRef.value?.querySelector('.throttle-track')
  track && track.addEventListener('click', onTrackClick)
})
onBeforeUnmount(() => {
  const track = containerRef.value?.querySelector('.throttle-track')
  track && track.removeEventListener('click', onTrackClick)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
})
</script>

<style scoped>
.throttle-container {
  display: flex;
  gap: 10px;
  align-items: stretch;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}

.throttle-track {
  position: relative;
  width: 70px;
  height: 420px;
  background: linear-gradient(180deg, #0f1420 0%, #1a2033 100%);
  border-radius: 10px;
  border: 2px solid #2a3350;
  overflow: hidden;
  box-shadow:
    inset 0 0 20px rgba(0,0,0,0.6),
    0 6px 24px rgba(0,0,0,0.5);
  cursor: pointer;
}

.throttle-track-bg {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(
      0deg,
      transparent 0,
      transparent 10px,
      rgba(255,255,255,0.02) 10px,
      rgba(255,255,255,0.02) 11px
    );
}

.throttle-fill {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  background: linear-gradient(180deg, #44ffaa 0%, #1fa768 60%, #0e5a3a 100%);
  box-shadow: 0 0 24px rgba(68, 255, 170, 0.5);
  transition: height 40ms linear;
  opacity: 0.4;
}

.throttle-gate {
  position: absolute;
  left: 0; right: 0;
  display: flex;
  align-items: center;
  pointer-events: none;
  z-index: 2;
}
.gate-line {
  width: 100%;
  height: 2px;
  background: #445070;
}
.gate-line.gate-idle  { background: #66c9ff; }
.gate-line.gate-clb   { background: #66ff99; }
.gate-line.gate-mct   { background: #ffcc44; }
.gate-line.gate-toga  { background: #ff5566; }
.gate-line.gate-cut   { background: #8890a8; height: 3px; }
.gate-label {
  position: absolute;
  right: -2px;
  transform: translateX(100%);
  padding: 0 6px;
  font-size: 10px;
  font-weight: 700;
  color: #aab4cc;
  background: rgba(10,14,24,0.7);
  border-radius: 3px;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.throttle-knob {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 60px;
  height: 40px;
  z-index: 3;
  cursor: grab;
  transition: bottom 30ms linear;
}
.throttle-knob:active { cursor: grabbing; }

.knob-top {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 10px;
  background: linear-gradient(180deg, #f0f4ff, #a0aac8);
  border-radius: 6px 6px 0 0;
  border: 1px solid #3a4560;
  border-bottom: none;
}
.knob-body {
  position: absolute;
  top: 9px; left: 0; right: 0; bottom: 0;
  background:
    repeating-linear-gradient(
      90deg,
      #3a4360 0 3px,
      #2a3148 3px 6px
    );
  border: 1px solid #1a1f30;
  border-radius: 0 0 6px 6px;
  box-shadow: 0 4px 10px rgba(0,0,0,0.6);
}
.knob-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px;
  font-weight: 800;
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
  letter-spacing: 0.5px;
}

/* 右侧刻度 */
.throttle-scale {
  width: 40px;
  display: flex;
  flex-direction: column-reverse;
  justify-content: space-between;
  padding: 2px 0;
}
.scale-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
}
.scale-line {
  width: 8px;
  height: 1px;
  background: #3a4560;
}
.scale-line.major {
  width: 14px;
  height: 2px;
  background: #6a7594;
}
.scale-text {
  font-size: 10px;
  font-family: 'Consolas', monospace;
  color: #7a84a0;
  font-weight: 600;
}
</style>
