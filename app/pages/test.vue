<template>
  <div>
    <h1>Mediasoup Test</h1>
    <div>
      <button @click="connect">Connect</button>
      <button @click="startAudio" :disabled="!connected">Start Audio</button>
      <button @click="listenAudio" :disabled="!connected">Listen</button>
    </div>
    <div>
      <p>Status: {{ status }}</p>
      <audio ref="remoteAudio" autoplay></audio>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
let Device: any
let device: any
let recvTransport: any
let consumer: any

const ws = ref<WebSocket | null>(null)
const connected = ref(false)
const status = ref('Disconnected')
const transportParams = ref<any>(null)
const dtlsParams = ref<any>(null)
const producerId = ref<string | null>(null)
const rtpCapabilities = ref<any>(null)
const remoteAudio = ref<HTMLAudioElement | null>(null)

onMounted(async () => {
  // Dynamically import mediasoup-client for POC
  Device = (await import('mediasoup-client')).Device
})

function connect() {
  ws.value = new WebSocket('ws://localhost:8425/socket')
  ws.value.onopen = () => {
    connected.value = true
    status.value = 'Connected'
    ws.value?.send(JSON.stringify({ type: 'create-transport' }))
  }
  ws.value.onmessage = async (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'transport-params') {
      transportParams.value = msg.data
      status.value = 'Transport created'
      // Get rtpCapabilities from server (should be sent separately in real app)
      ws.value?.send(JSON.stringify({ type: 'get-rtp-capabilities' }))
    }
    if (msg.type === 'rtp-capabilities') {
            // Defensive assignment: ensure plain object and avoid Vue Proxy
            try {
              console.log('Raw rtpCapabilities from backend:', msg.data)
              const plainRtpCapabilities = JSON.parse(JSON.stringify(msg.data))
              console.log('Sanitized rtpCapabilities:', plainRtpCapabilities)
              device = new Device()
              await device.load({ routerRtpCapabilities: plainRtpCapabilities })
              console.log('Device loaded successfully')
              rtpCapabilities.value = plainRtpCapabilities // assign to ref after loading
            } catch (err) {
              console.error('Error loading Device with rtpCapabilities:', err, msg.data)
              status.value = 'Device load error'
            }
    }
    if (msg.type === 'producer-id') {
      producerId.value = msg.data.id
      status.value = 'Audio produced'
    }
    if (msg.type === 'consumer-params') {
        status.value = 'Receiving audio'
        // Setup mediasoup-client consumer
        if (device && transportParams.value) {
          if (!recvTransport) {
            recvTransport = device.createRecvTransport({
              id: transportParams.value.id,
              iceParameters: transportParams.value.iceParameters,
              iceCandidates: transportParams.value.iceCandidates,
              dtlsParameters: transportParams.value.dtlsParameters,
              sctpParameters: transportParams.value.sctpParameters || undefined
            })
            // Add connect event handler for DTLS negotiation
            recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
              ws.value?.send(JSON.stringify({ type: 'connect-transport', data: { dtlsParameters } }))
              callback()
            })
          }
          consumer = await recvTransport.consume({
            id: msg.data.id,
            producerId: msg.data.producerId,
            kind: msg.data.kind,
            rtpParameters: msg.data.rtpParameters
          })
          const stream = new MediaStream()
          stream.addTrack(consumer.track)
          if (remoteAudio.value) remoteAudio.value.srcObject = stream
            if (remoteAudio.value) {
              remoteAudio.value.muted = false
              remoteAudio.value.play().catch(e => console.log('Audio play error:', e))
              console.log('Attached stream:', stream, 'Track enabled:', consumer.track.enabled)
            }
        }
    }
  }
  ws.value.onclose = () => {
    connected.value = false
    status.value = 'Disconnected'
  }
}

async function startAudio() {
  if (!device || !connected.value || !transportParams.value) return
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  })
  const track = stream.getAudioTracks()[0]
  let sendTransport = recvTransport
  if (!sendTransport) {
    sendTransport = device.createSendTransport({
      id: transportParams.value.id,
      iceParameters: transportParams.value.iceParameters,
      iceCandidates: transportParams.value.iceCandidates,
      dtlsParameters: transportParams.value.dtlsParameters,
      sctpParameters: transportParams.value.sctpParameters || undefined
    })
    sendTransport.on('connect', (
      { dtlsParameters }: { dtlsParameters: any },
      callback: () => void,
      errback: (error: Error) => void
    ) => {
      ws.value?.send(JSON.stringify({ type: 'connect-transport', data: { dtlsParameters } }))
      callback()
    })
    sendTransport.on('produce', (
      {
        kind,
        rtpParameters,
        appData
      }: { kind: string; rtpParameters: any; appData: any },
      callback: (params: { id: string }) => void,
      errback: (error: Error) => void
    ) => {
      ws.value?.send(
        JSON.stringify({ type: 'produce', data: { kind, rtpParameters, appData } })
      )
      // For POC, respond with a dummy id (in real app, backend should reply with id)
      callback({ id: 'audio-producer-id' })
    })
  }
  const producer = await sendTransport.produce({ track })
  status.value = 'Audio started'
}

function listenAudio() {
  ws.value?.send(JSON.stringify({ type: 'consume', data: { rtpCapabilities: rtpCapabilities.value || {} } }))
  status.value = 'Requested to consume audio'
}
</script>

<style scoped>
div {
  margin: 1em;
}
button {
  margin-right: 1em;
}
</style>
