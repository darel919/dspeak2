# Voice controls

The microphone and deafen controls remain available in the top bar whenever a
user is signed in. Outside a voice channel, they set the state that will be
applied on the next join.

dSpeak restores the last saved microphone and deafen state before starting
media production. A saved unmuted state starts microphone production as part of
joining. A saved deafen state joins without remote audio and with the
microphone muted.

Deafening always mutes the microphone. Turning the microphone on also
undeafens, so the two controls cannot leave the local participant in a
contradictory state. The active state is sent to the other participants after
the voice connection finishes joining.
