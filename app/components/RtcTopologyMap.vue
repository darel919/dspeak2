<template>
  <section class="rounded-lg border border-base-content/20 bg-base-300/30 p-2" aria-labelledby="rtc-topology-title">
    <div class="mb-2 flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div id="rtc-topology-title" class="font-semibold">Network topology</div>
        <div class="text-[11px] text-base-content/60" aria-live="polite">{{ summary }}</div>
      </div>
      <span class="badge badge-sm shrink-0 whitespace-nowrap" :class="badgeClass">{{ topology.label }}</span>
    </div>
    <svg viewBox="0 0 320 190" class="h-auto w-full" role="img" :aria-label="summary">
      <line v-for="edge in renderedEdges" :key="edge.key" :x1="edge.from.x" :y1="edge.from.y" :x2="edge.to.x" :y2="edge.to.y" class="topology-edge" :class="[`edge-${edge.state}`, edge.state === 'active' ? 'edge-flowing' : '']" />
      <g v-for="node in renderedNodes" :key="node.id" class="cursor-pointer outline-none" role="button" tabindex="0" :aria-label="nodeLabel(node)" @click="selectNode(node.id)" @keydown.enter.prevent="selectNode(node.id)" @keydown.space.prevent="selectNode(node.id)">
        <circle :cx="node.x" :cy="node.y" r="21" class="node-ring" :class="[`node-${node.health}`, node.role === 'local' ? 'node-local' : '']" />
        <foreignObject :x="node.x - 12" :y="node.y - 12" width="24" height="24" class="pointer-events-none"><Icon :name="nodeIcon(node)" class="size-6" /></foreignObject>
        <text :x="node.x" :y="node.y + 34" text-anchor="middle" class="fill-current text-[10px]">{{ nodeTitle(node) }}</text>
      </g>
    </svg>
    <div v-if="selectedDetail" class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 rounded bg-base-200 p-2 font-mono text-[10px]">
      <div class="text-base-content/60">Role</div><div>{{ selectedDetail.role }}</div>
      <div class="text-base-content/60">Health</div><div>{{ selectedDetail.health }}</div>
      <template v-if="selectedEdges.length">
        <div class="text-base-content/60">RTT</div><div>{{ formatMs(selectedEdges[0].rtt) }}</div>
        <div class="text-base-content/60">Protocol</div><div>{{ selectedEdges[0].network || '-' }}</div>
        <div class="text-base-content/60">Candidate</div><div>{{ selectedEdges[0].candidateType || '-' }}</div>
        <div class="text-base-content/60">Packet loss</div><div>{{ formatLoss(selectedEdges[0].packetLoss) }}</div>
        <div class="text-base-content/60">Local outgoing estimate</div><div>{{ formatBitrate(selectedEdges[0].bitrate) }}</div>
      </template>
    </div>
  </section>
</template>

<script setup>
const props = defineProps({
  topology: { type: Object, default: () => ({ mode: 'idle', label: 'Waiting', participantCount: 0 }) },
  nodes: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] }
})
const selectedNode = ref(null)
const summary = computed(() => {
  const count = Number(props.topology.participantCount) || props.nodes.filter(node => node.role === 'local' || node.role === 'peer').length
  const reason = props.topology.reason ? `, ${String(props.topology.reason).replaceAll('-', ' ')}` : ''
  return `${props.topology.label || 'Connecting'} with ${count} device${count === 1 ? '' : 's'}${reason}`
})
const badgeClass = computed(() => {
  if (props.topology.mode === 'p2p-direct' || props.topology.mode === 'p2p-mesh') return 'badge-success'
  if (props.topology.mode === 'sfu') return 'badge-info'
  if (props.topology.mode === 'switching' || props.topology.mode === 'probing') return 'badge-warning'
  return 'badge-ghost'
})
const renderedNodes = computed(() => {
  const participants = props.nodes.filter(node => node.role === 'local' || node.role === 'peer')
  const infrastructure = props.nodes.filter(node => node.role !== 'local' && node.role !== 'peer')
  const result = participants.map((node, index) => {
    const angle = participants.length === 1
      ? -Math.PI / 2
      : participants.length === 2
        ? Math.PI + Math.PI * index
        : -Math.PI / 2 + Math.PI * 2 * index / participants.length
    return { ...node, x: 160 + Math.cos(angle) * 108, y: 92 + Math.sin(angle) * 58 }
  })
  for (const node of infrastructure) result.push({ ...node, x: node.role === 'ipv4-fallback' ? 238 : 160, y: 92 })
  return result
})
const renderedEdges = computed(() => props.edges.flatMap((edge, index) => {
  const from = renderedNodes.value.find(node => node.id === edge.from)
  const to = renderedNodes.value.find(node => node.id === edge.to)
  return from && to ? [{ ...edge, from, to, key: `${edge.from}:${edge.to}:${index}` }] : []
}))
const selectedDetail = computed(() => renderedNodes.value.find(node => node.id === selectedNode.value) || null)
const selectedEdges = computed(() => props.edges.filter(edge => edge.from === selectedNode.value || edge.to === selectedNode.value))
function selectNode(id) { selectedNode.value = selectedNode.value === id ? null : id }
function nodeIcon(node) { return node.role === 'sfu' ? 'lucide:server' : node.role === 'ipv4-fallback' ? 'lucide:waypoints' : 'lucide:monitor' }
function nodeTitle(node) { return node.role === 'local' ? 'You' : node.role === 'sfu' ? 'SFU' : node.role === 'ipv4-fallback' ? 'IPv4' : `Peer ${Number(node.index) + 1}` }
function nodeLabel(node) { return `${nodeTitle(node)}, ${node.health || 'unknown'}; activate for connection details` }
function formatMs(value) { return Number.isFinite(Number(value)) ? `${Number(value).toFixed(0)} ms` : '-' }
function formatBitrate(value) { return Number.isFinite(Number(value)) ? `${(Number(value) / 1000).toFixed(1)} Kbps` : '-' }
function formatLoss(value) { return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : '-' }
</script>

<style scoped>
.topology-edge { stroke: color-mix(in oklab, currentColor 35%, transparent); stroke-width: 2; stroke-linecap: round; }
.edge-probing, .edge-draining { stroke-dasharray: 7 7; }
.edge-active { stroke: var(--color-success); stroke-dasharray: 3 10; }
.edge-degraded { stroke: var(--color-warning); stroke-dasharray: 4 6; }
.edge-failed { stroke: var(--color-error); }
.edge-flowing { animation: packet-flow 1.1s linear infinite; }
.node-ring { fill: var(--color-base-200); stroke: color-mix(in oklab, currentColor 35%, transparent); stroke-width: 2; }
.node-local { fill: color-mix(in oklab, var(--color-primary) 18%, var(--color-base-200)); stroke: var(--color-primary); }
.node-degraded { stroke: var(--color-warning); }
.node-failed { stroke: var(--color-error); }
@keyframes packet-flow { to { stroke-dashoffset: -26; } }
@media (prefers-reduced-motion: reduce) { .edge-flowing { animation: none; stroke-dasharray: none; } }
</style>
