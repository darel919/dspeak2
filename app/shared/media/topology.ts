/**
 * @file Topology types and session input types
 * Shared between browser, native, and hybrid implementations.
 */

/**
 * @typedef {'p2p'|'sfu'} TopologyType
 */

/**
 * @typedef {Object} JoinSessionInput
 * @property {string} roomId - Room identifier
 * @property {string} channelId - Channel identifier
 * @property {string} participantId - Local participant identifier
 * @property {Object} iceServers - ICE servers from server
 * @property {TopologyType} topology - Initial topology
 * @property {Object} [serverRtpCapabilities] - Router RTP capabilities (SFU mode)
 * @property {string} [sessionId] - Session identifier for reconnection
 */

/**
 * @typedef {Object} ScreenShareOptions
 * @property {string} [sourceId] - Screen source identifier
 * @property {boolean} [includeSystemAudio=true] - Capture system audio
 * @property {boolean} [includeMicrophone=false] - Also capture microphone
 * @property {Object} [videoConstraints] - Video constraints
 */

/**
 * @typedef {Object} MediaSignalMessage
 * @property {string} type - Message type (offer, answer, ice-candidate, etc.)
 * @property {string} [targetParticipantId] - Target for P2P
 * @property {string} [source] - Source identifier (screen, camera, microphone)
 * @property {string} [mediaKind] - Media kind (video, audio)
 * @property {Object} [payload] - Message payload
 * @property {number} [epoch] - Topology epoch
 */

/**
 * @typedef {Object} IceServerConfig
 * @property {string[]} urls - STUN/TURN URLs
 * @property {string} [username] - TURN username
 * @property {string} [credential] - TURN credential
 */

/**
 * @typedef {Object} TopologyTransition
 * @property {'p2p'|'sfu'} from - Source topology
 * @property {'p2p'|'sfu'} to - Target topology
 * @property {number} epoch - Transition epoch
 * @property {number} timestamp - Transition timestamp
 */

export const TopologyType = {
  P2P: "p2p",
  SFU: "sfu",
};

export const DefaultScreenShareOptions = {
  includeSystemAudio: true,
  includeMicrophone: false,
};
