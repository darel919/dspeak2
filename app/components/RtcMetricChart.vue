<template>
  <div class="rtc-chart" :aria-label="`${label} history`" role="img">
    <div class="rtc-chart-y-axis" aria-hidden="true">
      <span>{{ formatAxisValue(axisMax) }}</span>
      <span>{{ formatAxisValue(axisMax / 2) }}</span>
      <span>{{ formatAxisValue(0) }}</span>
    </div>
    <svg viewBox="0 0 420 100" preserveAspectRatio="none">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.28" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      <line v-for="line in 3" :key="line" x1="0" :y1="(line - 1) * 46 + 4" x2="420" :y2="(line - 1) * 46 + 4" class="rtc-chart-grid" />
      <path v-if="areaPath" :d="areaPath" :fill="`url(#${gradientId})`" />
      <polyline v-if="points" :points="points" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>
    <div v-if="!points" class="rtc-chart-empty">Waiting for samples</div>
    <div class="rtc-chart-axis"><span>{{ startLabel }}</span><span>60 second window</span><span>{{ endLabel }}</span></div>
  </div>
</template>

<script setup>
const props = defineProps({
  label: { type: String, required: true },
  samples: { type: Array, default: () => [] },
  unit: { type: String, default: '' },
  suggestedMax: { type: Number, default: 0 },
  windowSeconds: { type: Number, default: 60 }
})

const gradientId = `rtc-gradient-${Math.random().toString(36).slice(2)}`
const usableSamples = computed(() => props.samples.filter(sample => Number.isFinite(sample.value)))
const endTimestamp = computed(() => props.samples.at(-1)?.timestamp || Date.now())
const startTimestamp = computed(() => endTimestamp.value - props.windowSeconds * 1000)
const axisMax = computed(() => {
  const observed = Math.max(0, ...usableSamples.value.map(sample => sample.value))
  const raw = Math.max(props.suggestedMax, observed * 1.15, 1)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  return Math.ceil(raw / magnitude) * magnitude
})
const points = computed(() => {
  if (!usableSamples.value.length) return ''
  return usableSamples.value.map((sample) => {
    const x = Math.max(0, Math.min(420, (sample.timestamp - startTimestamp.value) * 420 / (props.windowSeconds * 1000)))
    const y = 96 - Math.max(0, sample.value) * 92 / axisMax.value
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
})
const areaPath = computed(() => points.value ? `M 0 96 L ${points.value.replaceAll(' ', ' L ')} L 420 96 Z` : '')
const formatTimestamp = timestamp => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const startLabel = computed(() => formatTimestamp(startTimestamp.value))
const endLabel = computed(() => formatTimestamp(endTimestamp.value))
function formatAxisValue(value) {
  const formatted = value >= 100 ? Math.round(value) : Number(value.toFixed(1))
  return props.unit ? `${formatted} ${props.unit}` : String(formatted)
}
</script>

<style scoped>
.rtc-chart { position: relative; height: 9rem; padding-left: 3.25rem; color: var(--color-primary); }
.rtc-chart svg { width: 100%; height: 7rem; overflow: visible; }
.rtc-chart-grid { stroke: currentColor; stroke-opacity: .09; vector-effect: non-scaling-stroke; }
.rtc-chart-y-axis { position: absolute; inset: 0 auto 2rem 0; display: flex; width: 3rem; flex-direction: column; justify-content: space-between; color: color-mix(in oklab, var(--color-base-content) 58%, transparent); font-size: .6rem; text-align: right; }
.rtc-chart-axis { display: flex; justify-content: space-between; gap: .5rem; color: color-mix(in oklab, var(--color-base-content) 58%, transparent); font-size: .6rem; }
.rtc-chart-axis span:nth-child(2) { text-align: center; }
.rtc-chart-empty { position: absolute; inset: 2.7rem 0 auto; text-align: center; color: color-mix(in oklab, currentColor 45%, transparent); font-size: .75rem; }
</style>
