<template>
  <div class="fadec-panel">
    <!-- 顶部状态栏 -->
    <header class="top-bar">
      <div class="title-block">
        <div class="title-icon">⚙️</div>
        <div>
          <h1>FADEC 全权限数字发动机控制</h1>
          <p class="subtitle">High-Bypass Turbofan · Dual Spool · 100Hz Control Loop</p>
        </div>
      </div>
      <div class="status-block">
        <div class="status-item" :class="{ ok: telem.connected }">
          <span class="dot" />
          <span>{{ telem.connected ? 'CONTROL LINK ACTIVE' : 'LINK DOWN' }}</span>
        </div>
        <div class="status-item">
          <span class="stat-label">FRAME RATE</span>
          <span class="stat-value mono">{{ telem.frameRate }} Hz</span>
        </div>
        <div class="status-item">
          <span class="stat-label">LOOP TIME</span>
          <span class="stat-value mono">{{ telem.loopTime_us.toFixed(1) }} µs</span>
        </div>
        <div class="status-item">
          <span class="stat-label">SAT</span>
          <span class="stat-value sat" :class="telem.saturation">
            {{ satText }}
          </span>
        </div>

        <!-- 喘振主警报灯 (爆闪) -->
        <div
          class="alarm-big"
          :class="{
            'alarm-critical': telem.surgeStatus === 'critical',
            'alarm-warn': telem.surgeStatus === 'warn',
            'alarm-vbv-on': telem.vbvActive
          }"
        >
          <div class="alarm-icon" />
          <span>{{ alarmText }}</span>
        </div>
      </div>
    </header>

    <!-- 主体区域 -->
    <main class="main-body">
      <!-- 左侧: 推力杆 + 发动机示意图 -->
      <aside class="left-panel">
        <div class="panel-card throttle-card">
          <h3 class="card-title">🚀 推力杆 TLA</h3>
          <div class="throttle-wrap">
            <ThrottleLever v-model="tlaLocal" />
          </div>
          <div class="tla-info">
            <div class="info-row">
              <span class="info-label">TLA</span>
              <span class="info-value mono">{{ tlaLocal.toFixed(1) }}%</span>
            </div>
            <div class="info-row">
              <span class="info-label">N1 Desired</span>
              <span class="info-value mono accent">{{ telem.n1Desired.toFixed(2) }}%</span>
            </div>
            <div class="info-row">
              <span class="info-label">ΔN1</span>
              <span class="info-value mono" :class="errClass">
                {{ telem.n1Error >= 0 ? '+' : '' }}{{ telem.n1Error.toFixed(2) }}%
              </span>
            </div>
          </div>
        </div>

        <!-- 喘振主动防护面板 -->
        <div class="panel-card surge-card" :class="{ 'panel-critical': telem.surgeStatus === 'critical' }">
          <h3 class="card-title">🌪️ 压气机喘振防护</h3>

          <div class="surge-margin-wrap">
            <div class="surge-margin-bar">
              <div
                class="surge-fill"
                :class="surgeFillClass"
                :style="{ height: Math.min(100, telem.surgeMargin / 30 * 100) + '%' }"
              />
              <div class="surge-mark mark-warn" style="bottom: 40%" title="警告线 12%"></div>
              <div class="surge-mark mark-crit" style="bottom: 16.6%" title="危险线 5%"></div>
            </div>
            <div class="surge-margin-info">
              <div class="margin-big mono" :class="surgeTextClass">
                {{ telem.surgeMargin?.toFixed?.(1) ?? '--' }}
              </div>
              <div class="margin-label">喘振裕度 %</div>
              <div class="margin-status" :class="statusClass">
                {{ statusText }}
              </div>
            </div>
          </div>

          <div class="vbv-vsv-row">
            <div class="vbv-indicator" :class="{ active: telem.vbvActive }">
              <div class="vbv-light" />
              <div class="vbv-text">
                <div class="vbv-title">VBV 放气活门</div>
                <div class="vbv-value mono">{{ telem.vbvActive ? 'OPEN' : 'CLOSED' }}</div>
                <div class="vbv-detail mono">{{ (telem.vbvPosition * 100).toFixed(0) }}%</div>
              </div>
            </div>
            <div class="vsv-indicator" :class="{ active: telem.vsvAngle > 0.5 }">
              <div class="vsv-light" />
              <div class="vsv-text">
                <div class="vsv-title">VSV 静子叶片</div>
                <div class="vsv-value mono">{{ telem.vsvAngle > 0.5 ? 'ACT' : 'NOM' }}</div>
                <div class="vsv-detail mono">{{ telem.vsvAngle?.toFixed?.(1) ?? '0' }}°</div>
              </div>
            </div>
          </div>

          <div class="shake-info">
            <div class="shake-row">
              <span class="shake-label">抖振强度</span>
              <div class="shake-bar-track">
                <div
                  class="shake-bar-fill"
                  :style="{ width: Math.min(100, telem.shakeNorm * 3) + '%' }"
                />
              </div>
              <span class="shake-val mono">{{ telem.shakeNorm?.toFixed?.(1) ?? '0' }}</span>
            </div>
            <div class="shake-row">
              <span class="shake-label">dPs3/dt</span>
              <span class="shake-val mono">{{ telem.dPs3dt?.toFixed?.(1) ?? '0' }} psia/s</span>
            </div>
            <div class="shake-row">
              <span class="shake-label">dN2/dt</span>
              <span class="shake-val mono">{{ telem.dN2dt?.toFixed?.(1) ?? '0' }} %/s</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 中央: 三大主仪表 -->
      <section class="center-panel">
        <div class="gauges-row">
          <div class="gauge-wrap">
            <Gauge
              label="N1 LP ROTOR"
              unit="% RPM"
              :value="telem.n1"
              :min="0" :max="110"
              :green-start="24" :green-end="85"
              :yellow-start="85" :yellow-end="97"
              :red-start="97" :red-end="110"
              :major-step="10" :minor-step="2"
              :size="300"
              :digits="2"
            />
            <div class="gauge-sub">
              <span>LOW PRESSURE TURBINE</span>
              <span class="mono highlight">{{ telem.n1.toFixed(2) }}%</span>
            </div>
          </div>

          <div class="gauge-wrap">
            <Gauge
              label="EGT EXHAUST"
              unit="°C"
              :value="telem.egt"
              :min="0" :max="1000"
              :green-start="200" :green-end="700"
              :yellow-start="700" :yellow-end="880"
              :red-start="880" :red-end="1000"
              :major-step="100" :minor-step="20"
              :size="300"
              :digits="1"
            />
            <div class="gauge-sub">
              <span>EXHAUST GAS TEMP</span>
              <span class="mono egt-val">{{ telem.egt.toFixed(1) }}°C</span>
            </div>
          </div>

          <div class="gauge-wrap">
            <Gauge
              label="N2 HP ROTOR"
              unit="% RPM"
              :value="telem.n2"
              :min="0" :max="118"
              :green-start="25" :green-end="88"
              :yellow-start="88" :yellow-end="102"
              :red-start="102" :red-end="118"
              :major-step="10" :minor-step="2"
              :size="300"
              :digits="2"
            />
            <div class="gauge-sub">
              <span>HIGH PRESSURE TURBINE</span>
              <span class="mono highlight">{{ telem.n2.toFixed(2) }}%</span>
            </div>
          </div>
        </div>

        <!-- 燃油计量与压力子面板 -->
        <div class="sub-panels">
          <div class="panel-card fuel-card">
            <h3 class="card-title">⛽ FUEL METERING VALVE</h3>
            <div class="bars">
              <div class="bar-row">
                <span class="bar-label">Wf 实际流量</span>
                <div class="bar-track">
                  <div
                    class="bar-fill bar-wf"
                    :style="{ width: Math.min(100, telem.wfActual / 5 * 100) + '%' }"
                  />
                  <div
                    class="bar-limit bar-min"
                    :style="{ left: Math.min(98, telem.wfMin / 5 * 100) + '%' }"
                    title="Wf Min (防熄火)"
                  />
                  <div
                    class="bar-limit bar-max"
                    :style="{ left: Math.min(98, telem.wfMax / 5 * 100) + '%' }"
                    title="Wf Max (防超温)"
                  />
                </div>
                <span class="bar-value mono">{{ telem.wfActual.toFixed(3) }} kg/s</span>
              </div>
              <div class="bar-row">
                <span class="bar-label">Wf 指令 (限幅后)</span>
                <div class="bar-track">
                  <div
                    class="bar-fill bar-cmd"
                    :style="{ width: Math.min(100, telem.wfCmd / 5 * 100) + '%' }"
                  />
                </div>
                <span class="bar-value mono">{{ telem.wfCmd.toFixed(3) }} kg/s</span>
              </div>
              <div class="mini-grid">
                <div class="mini-item">
                  <span class="mini-label">Wf 下限</span>
                  <span class="mini-value mono lo">{{ telem.wfMin.toFixed(3) }}</span>
                </div>
                <div class="mini-item">
                  <span class="mini-label">Wf 上限</span>
                  <span class="mini-value mono hi">{{ telem.wfMax.toFixed(3) }}</span>
                </div>
                <div class="mini-item">
                  <span class="mini-label">Wf 原始</span>
                  <span class="mini-value mono">{{ telem.wfRaw.toFixed(3) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="panel-card press-card">
            <h3 class="card-title">🌡️ PRESSURE & TEMPERATURE</h3>
            <div class="press-grid">
              <div class="press-item">
                <div class="press-label">Ps3 压气机出口</div>
                <div class="press-value mono">{{ telem.ps3.toFixed(1) }}<span>psia</span></div>
                <div class="press-bar">
                  <div class="press-fill ps3" :style="{ width: Math.min(100, telem.ps3/550*100) + '%' }" />
                </div>
              </div>
              <div class="press-item">
                <div class="press-label">P2 进气压力</div>
                <div class="press-value mono">{{ telem.p2.toFixed(2) }}<span>psia</span></div>
                <div class="press-bar">
                  <div class="press-fill p2" :style="{ width: (telem.p2/14.7*50) + '%' }" />
                </div>
              </div>
              <div class="press-item">
                <div class="press-label">T2 进气温度</div>
                <div class="press-value mono">{{ telem.t2.toFixed(1) }}<span>°C</span></div>
                <div class="press-bar">
                  <div class="press-fill t2" :style="{ width: ((telem.t2+50)/120*100) + '%' }" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="bottom-bar">
      <span class="mono">CONTROL: TLA → N1des → PI+LeadLag → WfLimiter(Ps3,T2) → FMV → Engine Dynamics</span>
      <span class="mono">TELEMETRY: 100Hz WebSocket · Canvas Anti-Alias Gauges · RK4 Engine Model</span>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import Gauge from './components/Gauge.vue'
import ThrottleLever from './components/ThrottleLever.vue'
import { telem, sendTLA } from './telem/ws-client.js'

// 本地 TLA 值 (油门杆位置)
const tlaLocal = ref(0)

// 当用户拖动推力杆时，发送给后端
watch(tlaLocal, (v) => {
  sendTLA(v)
}, { immediate: false })

// 状态文字
const satText = computed(() => {
  switch (telem.saturation) {
    case 'hi':   return 'HIGH LIMIT'
    case 'lo':   return 'LOW LIMIT'
    default:     return 'NORMAL'
  }
})

const errClass = computed(() => {
  const e = Math.abs(telem.n1Error)
  if (e > 2) return 'err-bad'
  if (e > 0.5) return 'err-warn'
  return 'err-ok'
})

// ---- 喘振防护计算属性 ----
const alarmText = computed(() => {
  if (telem.surgeStatus === 'critical') return 'SURGE CRITICAL'
  if (telem.surgeStatus === 'warn') return 'SURGE WARNING'
  if (telem.vbvActive) return 'VBV ACTIVE'
  return 'MARGIN OK'
})

const surgeFillClass = computed(() => {
  if (telem.surgeStatus === 'critical') return 'fill-critical'
  if (telem.surgeStatus === 'warn') return 'fill-warn'
  return 'fill-safe'
})

const surgeTextClass = computed(() => {
  if (telem.surgeStatus === 'critical') return 'text-critical'
  if (telem.surgeStatus === 'warn') return 'text-warn'
  return 'text-safe'
})

const statusClass = computed(() => {
  if (telem.surgeStatus === 'critical') return 'stat-critical'
  if (telem.surgeStatus === 'warn') return 'stat-warn'
  return 'stat-safe'
})

const statusText = computed(() => {
  switch (telem.surgeStatus) {
    case 'critical': return '危险逼近喘振'
    case 'warn':     return '警告裕度低'
    default:         return '安全裕度充足'
  }
})
</script>

<style>
.fadec-panel {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse at top, #141a2e 0%, #0a0d18 60%),
    linear-gradient(180deg, #0a0d18 0%, #05070d 100%);
  color: #e0e6f2;
  font-family: 'Segoe UI', 'PingFang SC', sans-serif;
  overflow: hidden;
}
.mono { font-family: 'Consolas', 'Courier New', monospace; }
.accent { color: #59e9ff; }
.highlight { color: #7fffd8; }
.egt-val { color: #ffc366; }

/* ===== 顶部栏 ===== */
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 24px;
  background: linear-gradient(180deg, rgba(30,40,68,0.95), rgba(15,20,36,0.85));
  border-bottom: 2px solid #1e2848;
  box-shadow: 0 2px 20px rgba(0,0,0,0.5);
}
.title-block {
  display: flex;
  align-items: center;
  gap: 14px;
}
.title-icon { font-size: 32px; filter: drop-shadow(0 0 8px rgba(100,200,255,0.4)); }
.title-block h1 {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
  background: linear-gradient(90deg, #8fd4ff, #c2ffda);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  margin: 0;
}
.subtitle {
  font-size: 11px;
  color: #6a7694;
  letter-spacing: 1px;
  margin: 2px 0 0 0;
}
.status-block {
  display: flex;
  gap: 20px;
  align-items: center;
}
.status-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 11px;
  gap: 2px;
}
.status-item .dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #ff4455;
  box-shadow: 0 0 8px #ff4455;
  margin-right: 6px;
  display: inline-block;
  vertical-align: middle;
}
.status-item.ok .dot { background: #44ff88; box-shadow: 0 0 10px #44ff88; }
.status-item.ok > span:last-child { color: #8bffaa; }
.stat-label { color: #6a7694; letter-spacing: 0.8px; font-size: 10px; }
.stat-value { color: #e0e6f2; font-size: 14px; font-weight: 600; }
.stat-value.sat { font-size: 12px; }
.stat-value.sat.hi { color: #ff6677; }
.stat-value.sat.lo { color: #ffc444; }
.stat-value.sat.none { color: #7fffa0; }

/* ===== 主体 ===== */
.main-body {
  flex: 1;
  display: flex;
  gap: 18px;
  padding: 18px 24px;
  overflow: hidden;
}

/* 左侧面板 */
.left-panel {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-card {
  background: linear-gradient(180deg, rgba(25,32,54,0.9), rgba(15,20,36,0.95));
  border: 1px solid #263152;
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04);
}
.card-title {
  margin: 0 0 12px 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.2px;
  color: #a0b0d0;
  padding-bottom: 8px;
  border-bottom: 1px solid #1f2946;
}

.throttle-card .throttle-wrap {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}
.tla-info {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #1f2946;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  align-items: baseline;
}
.info-label { color: #6a7694; letter-spacing: 0.5px; }
.info-value { color: #e0e6f2; font-size: 13px; font-weight: 700; }
.info-value.accent { color: #59e9ff; }
.info-value.err-ok { color: #7fffa0; }
.info-value.err-warn { color: #ffc444; }
.info-value.err-bad { color: #ff6677; }

/* 中央面板 */
.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.gauges-row {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 8px 0;
}
.gauge-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.gauge-sub {
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 0 16px;
  font-size: 10px;
  letter-spacing: 0.8px;
  color: #7a84a0;
}

/* 子面板 */
.sub-panels {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.bars { display: flex; flex-direction: column; gap: 10px; }
.bar-row {
  display: grid;
  grid-template-columns: 120px 1fr 110px;
  align-items: center;
  gap: 10px;
}
.bar-label {
  font-size: 11px;
  color: #9aa4bc;
  letter-spacing: 0.3px;
}
.bar-track {
  position: relative;
  height: 18px;
  background: linear-gradient(180deg, #0c1020, #161d32);
  border: 1px solid #263152;
  border-radius: 4px;
  overflow: visible;
}
.bar-fill {
  position: absolute;
  top: 2px; left: 2px; bottom: 2px;
  border-radius: 3px;
  transition: width 20ms linear;
}
.bar-wf {
  background: linear-gradient(180deg, #59e9ff 0%, #2a8aff 100%);
  box-shadow: 0 0 10px rgba(89,233,255,0.5);
}
.bar-cmd {
  background: linear-gradient(180deg, #7fffd8 0%, #22cc88 100%);
  box-shadow: 0 0 10px rgba(127,255,216,0.5);
}
.bar-limit {
  position: absolute;
  top: -2px;
  width: 2px;
  height: 22px;
  z-index: 2;
}
.bar-limit.bar-min { background: #ffc444; box-shadow: 0 0 6px #ffc444; }
.bar-limit.bar-max { background: #ff5566; box-shadow: 0 0 6px #ff5566; }
.bar-value {
  font-size: 12px;
  color: #e0e6f2;
  font-weight: 600;
  text-align: right;
}

.mini-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 10px 4px 0;
  border-top: 1px dashed #263152;
  margin-top: 4px;
}
.mini-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.mini-label {
  font-size: 10px;
  color: #6a7694;
  letter-spacing: 0.5px;
}
.mini-value {
  font-size: 13px;
  font-weight: 700;
  color: #e0e6f2;
}
.mini-value.lo { color: #ffc444; }
.mini-value.hi { color: #ff6677; }

/* 压力温度卡片 */
.press-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.press-item {
  display: grid;
  grid-template-columns: 110px 1fr 1fr;
  align-items: center;
  gap: 10px;
}
.press-label {
  font-size: 11px;
  color: #9aa4bc;
  letter-spacing: 0.3px;
}
.press-value {
  font-size: 18px;
  font-weight: 700;
  color: #e0e6f2;
}
.press-value span {
  font-size: 11px;
  color: #6a7694;
  margin-left: 4px;
  font-weight: 500;
}
.press-bar {
  height: 10px;
  background: linear-gradient(180deg, #0c1020, #161d32);
  border: 1px solid #263152;
  border-radius: 3px;
  overflow: hidden;
}
.press-fill {
  height: 100%;
  transition: width 20ms linear;
}
.press-fill.ps3 { background: linear-gradient(90deg, #44ff88, #22cc66); }
.press-fill.p2  { background: linear-gradient(90deg, #59e9ff, #2a8aff); }
.press-fill.t2  { background: linear-gradient(90deg, #59e9ff, #ff8855, #ff5566); }

/* 底栏 */
.bottom-bar {
  display: flex;
  justify-content: space-between;
  padding: 6px 24px;
  background: linear-gradient(180deg, rgba(15,20,36,0.85), rgba(8,10,18,0.95));
  border-top: 1px solid #1e2848;
  font-size: 10px;
  color: #5a6480;
  letter-spacing: 1px;
}

/* ===== 顶部大警报灯 ===== */
.alarm-big {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 6px;
  background: rgba(20, 28, 50, 0.6);
  border: 1px solid #2a3658;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #6a7694;
  transition: all 80ms linear;
}
.alarm-icon {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #3a4560;
  box-shadow: 0 0 4px rgba(0,0,0,0.5);
}

/* 警告状态 (黄色慢闪) */
.alarm-big.alarm-warn {
  color: #ffc444;
  border-color: #ffc444;
  background: rgba(255, 196, 68, 0.12);
}
.alarm-big.alarm-warn .alarm-icon {
  background: #ffc444;
  box-shadow: 0 0 12px #ffc444;
  animation: blink-warn 1.2s ease-in-out infinite;
}
@keyframes blink-warn {
  0%, 100% { opacity: 1; box-shadow: 0 0 12px #ffc444; }
  50%      { opacity: 0.4; box-shadow: 0 0 4px #ffc444; }
}

/* 危险状态 (红色爆闪 - 极快频率) */
.alarm-big.alarm-critical {
  color: #ff5566;
  border-color: #ff5566;
  background: rgba(255, 85, 102, 0.18);
  animation: flash-critical-bg 0.25s ease-in-out infinite;
}
.alarm-big.alarm-critical .alarm-icon {
  background: #ff5566;
  box-shadow: 0 0 20px #ff5566, 0 0 40px #ff5566;
  animation: flash-critical 0.2s ease-in-out infinite;
}
@keyframes flash-critical {
  0%, 100% { opacity: 1; transform: scale(1.2); box-shadow: 0 0 24px #ff5566, 0 0 48px #ff5566; }
  50%      { opacity: 0.3; transform: scale(0.8); box-shadow: 0 0 4px #ff5566; }
}
@keyframes flash-critical-bg {
  0%, 100% { background: rgba(255, 85, 102, 0.25); }
  50%      { background: rgba(255, 85, 102, 0.05); }
}

/* VBV 激活状态 (青色) */
.alarm-big.alarm-vbv-on:not(.alarm-warn):not(.alarm-critical) {
  color: #59e9ff;
  border-color: #59e9ff;
  background: rgba(89, 233, 255, 0.1);
}
.alarm-big.alarm-vbv-on:not(.alarm-warn):not(.alarm-critical) .alarm-icon {
  background: #59e9ff;
  box-shadow: 0 0 10px #59e9ff;
  animation: pulse-cyan 0.8s ease-in-out infinite;
}
@keyframes pulse-cyan {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.6; }
}

/* ===== 喘振防护面板 ===== */
.surge-card {
  margin-top: 0;
  transition: all 100ms linear;
}
.surge-card.panel-critical {
  border-color: #ff5566;
  box-shadow: 0 0 24px rgba(255, 85, 102, 0.4), inset 0 0 20px rgba(255, 85, 102, 0.1);
  animation: panel-critical-pulse 0.4s ease-in-out infinite;
}
@keyframes panel-critical-pulse {
  0%, 100% { box-shadow: 0 0 24px rgba(255, 85, 102, 0.4), inset 0 0 20px rgba(255, 85, 102, 0.1); }
  50%      { box-shadow: 0 0 48px rgba(255, 85, 102, 0.7), inset 0 0 30px rgba(255, 85, 102, 0.2); }
}

.surge-margin-wrap {
  display: flex;
  gap: 14px;
  align-items: stretch;
  margin-bottom: 12px;
}
.surge-margin-bar {
  position: relative;
  width: 32px;
  height: 130px;
  background: linear-gradient(180deg, #0a0f1c, #151c30);
  border: 1px solid #263152;
  border-radius: 4px;
  overflow: hidden;
}
.surge-fill {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  transition: height 40ms linear;
  border-radius: 3px 3px 0 0;
}
.surge-fill.fill-safe {
  background: linear-gradient(180deg, #7fffd8 0%, #22cc88 100%);
  box-shadow: 0 0 12px rgba(127, 255, 216, 0.5);
}
.surge-fill.fill-warn {
  background: linear-gradient(180deg, #ffdd66 0%, #ff9933 100%);
  box-shadow: 0 0 14px rgba(255, 200, 80, 0.6);
}
.surge-fill.fill-critical {
  background: linear-gradient(180deg, #ff7788 0%, #dd3344 100%);
  box-shadow: 0 0 18px rgba(255, 70, 90, 0.8);
  animation: surge-fill-flash 0.25s ease-in-out infinite;
}
@keyframes surge-fill-flash {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}
.surge-mark {
  position: absolute;
  left: 0; right: 0;
  height: 2px;
  z-index: 2;
}
.surge-mark.mark-warn { background: #ffc444; box-shadow: 0 0 4px #ffc444; }
.surge-mark.mark-crit { background: #ff5566; box-shadow: 0 0 6px #ff5566; }

.surge-margin-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}
.margin-big {
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
}
.margin-big.text-safe { color: #7fffd8; text-shadow: 0 0 10px rgba(127,255,216,0.4); }
.margin-big.text-warn { color: #ffc444; text-shadow: 0 0 10px rgba(255,196,68,0.5); }
.margin-big.text-critical {
  color: #ff5566;
  text-shadow: 0 0 16px rgba(255,85,102,0.8);
  animation: text-critical-flash 0.2s ease-in-out infinite;
}
@keyframes text-critical-flash {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}
.margin-label {
  font-size: 10px;
  color: #6a7694;
  letter-spacing: 0.8px;
}
.margin-status {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.margin-status.stat-safe { color: #7fffa0; }
.margin-status.stat-warn { color: #ffc444; }
.margin-status.stat-critical { color: #ff5566; }

/* VBV/VSV 指示灯 */
.vbv-vsv-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}
.vbv-indicator, .vsv-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: rgba(12, 18, 32, 0.8);
  border: 1px solid #263152;
  border-radius: 6px;
  transition: all 80ms linear;
}
.vbv-light, .vsv-light {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #3a4560;
  flex-shrink: 0;
}

.vbv-indicator.active {
  border-color: #59e9ff;
  background: rgba(89, 233, 255, 0.1);
}
.vbv-indicator.active .vbv-light {
  background: #59e9ff;
  box-shadow: 0 0 12px #59e9ff;
  animation: blink-vbv 0.6s ease-in-out infinite;
}
@keyframes blink-vbv {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}
.vsv-indicator.active {
  border-color: #a888ff;
  background: rgba(168, 136, 255, 0.1);
}
.vsv-indicator.active .vsv-light {
  background: #a888ff;
  box-shadow: 0 0 12px #a888ff;
  animation: blink-vsv 0.8s ease-in-out infinite;
}
@keyframes blink-vsv {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}

.vbv-title, .vsv-title {
  font-size: 10px;
  color: #8892ac;
  letter-spacing: 0.5px;
}
.vbv-value, .vsv-value {
  font-size: 12px;
  font-weight: 800;
  color: #c0c8dc;
}
.vbv-detail, .vsv-detail {
  font-size: 10px;
  color: #6a7694;
}
.vbv-indicator.active .vbv-value { color: #59e9ff; }
.vsv-indicator.active .vsv-value { color: #a888ff; }

/* 抖振信息 */
.shake-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px dashed #263152;
}
.shake-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10px;
}
.shake-label {
  color: #6a7694;
  letter-spacing: 0.3px;
  flex-shrink: 0;
  width: 60px;
}
.shake-bar-track {
  flex: 1;
  height: 6px;
  background: linear-gradient(180deg, #0c1020, #161d32);
  border: 1px solid #263152;
  border-radius: 3px;
  overflow: hidden;
}
.shake-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #59e9ff, #a888ff, #ff5566);
  transition: width 20ms linear;
}
.shake-val {
  color: #a0aac4;
  font-size: 10px;
  width: 60px;
  text-align: right;
}
</style>
