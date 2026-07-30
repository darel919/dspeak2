/**
 * @file MediaEngine contract types and interfaces
 * Shared between browser, native, and hybrid implementations.
 */

/**
 * @typedef {'connecting'|'connected'|'reconnecting'|'disconnected'|'failed'} MediaEngineState
 */

/**
 * @typedef {'microphone'|'camera'|'screenVideo'|'screenAudio'|'p2p'|'sfu'|'receiveVideo'|'receiveAudio'} MediaCapability
 */

/**
 * @typedef {'browser'|'native'|'hybrid'} MediaBackend
 */

/**
 * @typedef {Object} MediaEngineCapabilities
 * @property {'browser'|'native'|'hybrid'} microphone - Backend handling microphone
 * @property {'browser'|'native'|'hybrid'} camera - Backend handling camera
 * @property {'browser'|'native'|'hybrid'} screenVideo - Backend handling screen video
 * @property {'browser'|'native'|'hybrid'} screenAudio - Backend handling screen audio
 * @property {'browser'|'native'|'hybrid'} p2p - Backend handling P2P transport
 * @property {'browser'|'native'|'hybrid'} sfu - Backend handling SFU transport
 * @property {'browser'|'native'|'hybrid'} receiveVideo - Backend handling incoming video
 * @property {'browser'|'native'|'hybrid'} receiveAudio - Backend handling incoming audio
 */

/**
 * @typedef {Object} MediaEngineConfig
 * @property {Object} [iceServers] - ICE server configuration
 * @property {Function} sendSignaling - Function to send signaling messages
 * @property {Function} [onLocalTrack] - Called when local track is created
 * @property {Function} [onRemoteTrack] - Called when remote track is received
 * @property {Function} [onRemoteTrackEnded] - Called when remote track ends
 * @property {Function} [onStateChange] - Called when engine state changes
 * @property {Function} [onError] - Called when an error occurs
 * @property {Function} [onStats] - Called with stats updates
 */

/**
 * @typedef {Object} JoinSessionInput
 * @property {string} roomId - Room identifier
 * @property {string} channelId - Channel identifier
 * @property {string} participantId - Local participant identifier
 * @property {Object} iceServers - ICE servers from server
 * @property {'p2p'|'sfu'} topology - Initial topology
 * @property {Object} [serverRtpCapabilities] - Router RTP capabilities (SFU mode)
 */

/**
 * @typedef {Object} ScreenShareOptions
 * @property {string} [sourceId] - Screen source identifier
 * @property {boolean} [includeSystemAudio] - Capture system audio
 * @property {boolean} [includeMicrophone] - Also capture microphone
 * @property {Object} [videoConstraints] - Video constraints
 */

/**
 * @typedef {Object} MediaSignalMessage
 * @property {string} type - Message type
 * @property {string} [targetParticipantId] - Target for P2P
 * @property {string} [source] - Source identifier
 * @property {string} [mediaKind] - Media kind
 * @property {Object} [payload] - Message payload
 */

/**
 * @typedef {Object} MediaDeviceInfo
 * @property {string} deviceId - Device identifier
 * @property {string} label - Device label
 * @property {'audioinput'|'videoinput'|'audiooutput'} kind - Device kind
 * @property {string} groupId - Device group ID
 */

/**
 * @typedef {Object} MediaStats
 * @property {'p2p'|'sfu'} [topology]
 * @property {'browser'|'native'|'hybrid'} [engine]
 * @property {number} [rttMs]
 * @property {number} [jitterMs]
 * @property {number} [packetLossPct]
 * @property {number} [availableOutgoingBitrate]
 * @property {number} [availableIncomingBitrate]
 * @property {'host'|'srflx'|'relay'|'prflx'} [selectedCandidateType]
 * @property {'udp'|'tcp'} [selectedTransport]
 * @property {number} [audioSendBitrate]
 * @property {number} [audioRecvBitrate]
 * @property {number} [videoSendBitrate]
 * @property {number} [videoRecvBitrate]
 * @property {string} [encoder]
 * @property {string} [decoder]
 */

/**
 * @typedef {Object} MediaEngineEventMap
 * @property {(state: MediaEngineState) => void} state
 * @property {(track: MediaStreamTrack, kind: 'microphone'|'camera'|'screenVideo'|'screenAudio') => void} 'local-track'
 * @property {(track: MediaStreamTrack, kind: 'video'|'audio', source: string) => void} 'remote-track'
 * @property {(track: MediaStreamTrack) => void} 'remote-track-ended'
 * @property {(sourceId: string) => void} 'screen-share-ended'
 * @property {(stats: MediaStats) => void} stats
 * @property {(error: Error) => void} error
 * @property {(devices: MediaDeviceInfo[]) => void} 'device-change'
 * @property {(state: 'granted'|'denied'|'prompt', kind: string) => void} permission
 */

export const MediaEngineEventNames = [
  "state",
  "local-track",
  "remote-track",
  "remote-track-ended",
  "screen-share-ended",
  "stats",
  "error",
  "device-change",
  "permission",
];

/**
 * @interface MediaEngine
 */
export class MediaEngine {
  /**
   * @param {MediaEngineConfig} config
   * @returns {Promise<void>}
   */
  async initialize(config) {
    throw new Error("Not implemented");
  }

  /**
   * @param {JoinSessionInput} input
   * @returns {Promise<void>}
   */
  async joinSession(input) {
    throw new Error("Not implemented");
  }

  /**
   * @returns {Promise<void>}
   */
  async leaveSession() {
    throw new Error("Not implemented");
  }

  /**
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setMicrophoneEnabled(enabled) {
    throw new Error("Not implemented");
  }

  /**
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setCameraEnabled(enabled) {
    throw new Error("Not implemented");
  }

  /**
   * @param {ScreenShareOptions} options
   * @returns {Promise<void>}
   */
  async startScreenShare(options) {
    throw new Error("Not implemented");
  }

  /**
   * @returns {Promise<void>}
   */
  async stopScreenShare() {
    throw new Error("Not implemented");
  }

  /**
   * @param {MediaSignalMessage} message
   * @returns {Promise<void>}
   */
  async handleSignal(message) {
    throw new Error("Not implemented");
  }

  /**
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async getDevices() {
    throw new Error("Not implemented");
  }

  /**
   * @returns {Promise<MediaStats>}
   */
  async getStats() {
    throw new Error("Not implemented");
  }

  /**
   * @param {string} event
   * @param {Function} callback
   * @returns {() => void} Unsubscribe function
   */
  on(event, callback) {
    throw new Error("Not implemented");
  }

  /**
   * @returns {MediaEngineCapabilities}
   */
  getCapabilities() {
    throw new Error("Not implemented");
  }

  /**
   * @returns {Promise<void>}
   */
  async shutdown() {
    throw new Error("Not implemented");
  }

  /**
   * @returns {MediaEngineState}
   */
  getState() {
    throw new Error("Not implemented");
  }

  /**
   * @returns {boolean}
   */
  isScreenSharing() {
    throw new Error("Not implemented");
  }

  /**
   * @returns {boolean}
   */
  isMicrophoneEnabled() {
    throw new Error("Not implemented");
  }

  /**
   * @returns {boolean}
   */
  isCameraEnabled() {
    throw new Error("Not implemented");
  }
}

export default MediaEngine;
