export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },

  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:openrelay.metered.ca:80' },
  { urls: 'stun:stun.nextcloud.com:443' },
  { urls: 'stun:relay.webwormhole.io:3478' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  { urls: 'stun:stunserver.stunprotocol.org:3478' },
  { urls: 'stun:stun.sipgate.net:3478' },
  { urls: 'stun:stun.iptel.org:3478' },
  { urls: 'stun:stun.ekiga.net:3478' },
  { urls: 'stun:stun.ideasip.com:3478' },
  { urls: 'stun:stun.voip.blackberry.com:3478' },
  { urls: 'stun:stun.voip.aebc.com:3478' },
  { urls: 'stun:stun.voipbuster.com:3478' },
  { urls: 'stun:stun.voipstunt.com:3478' },
  { urls: 'stun:stun.voipzoom.com:3478' },
  { urls: 'stun:stun.callwithus.com:3478' },
  { urls: 'stun:stun.counterpath.com:3478' },
  { urls: 'stun:stun.12connect.com:3478' },
  { urls: 'stun:stun.3cx.com:3478' },
  { urls: 'stun:stun.flashdance.cx:3478' },
  { urls: 'stun:stun.rixtelecom.se:3478' },
  { urls: 'stun:stun.sipnet.net:3478' },
  { urls: 'stun:stun.sipnet.ru:3478' },
  { urls: 'stun:stun.schlund.de:3478' },
  { urls: 'stun:stun.t-online.de:3478' },
  { urls: 'stun:stun.freeswitch.org:3478' },

  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },

  {
    urls: [
      'turn:stun.evan-brass.net',
      'turn:stun.evan-brass.net?transport=tcp',
      'stun:stun.evan-brass.net'
    ],
    username: 'guest',
    credential: 'password'
  },

  {
    urls: [
      'turn:freeturn.net:3478?transport=udp',
      'turn:freeturn.net:3478?transport=tcp',
      'turn:freeturn.net:5349?transport=tcp'
    ],
    username: 'free',
    credential: 'free'
  }
]