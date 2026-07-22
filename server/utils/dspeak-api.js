import webpush from 'web-push'
import { ICE_SERVERS } from '../const/ice-servers'
import { broadcastToChannel } from './dspeak-realtime'
import { pocketBaseError, usePocketBaseAdmin } from './pocketbase'

function requireUser(event) {
  const userId = getHeader(event, 'authorization')
  if (!userId) throw createError({ statusCode: 403, statusMessage: 'Not Authorized' })
  return userId
}

function requireValue(value, message) {
  if (!value) throw createError({ statusCode: 400, statusMessage: message })
  return value
}

function ensureMember(room, userId) {
  if (!Array.isArray(room.members) || !room.members.map(String).includes(String(userId))) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied to this room' })
  }
}

function avatarPath(user, authPrefix = false) {
  if (!user?.id || !user?.avatar) return null
  return `${authPrefix ? 'auth/' : ''}assets/avatar?userId=${user.id}&fileName=${user.avatar}`
}

function presentUser(user, authPrefix = false) {
  if (!user) return null
  return { ...user, avatar: avatarPath(user, authPrefix) }
}

function presentChannel(channel) {
  return {
    id: channel.id,
    name: channel.name,
    desc: channel.desc,
    isMedia: channel.isMedia,
    audio_bitrate: channel.audio_bitrate,
    inRoom: channel.inRoom || [],
    created: channel.created,
    updated: channel.updated,
    owner: presentUser(channel.expand?.owner, true),
    room: channel.room
  }
}

async function parseBody(event) {
  const type = getHeader(event, 'content-type') || ''
  if (type.includes('multipart/form-data')) {
    const form = await readFormData(event)
    return Object.fromEntries(form.entries())
  }
  return await readBody(event) || {}
}

async function roomDetails(pb, room) {
  const channels = await pb.collection('dspeak_rooms_channels').getFullList({
    filter: `room = '${room.id}'`,
    expand: 'owner',
    sort: 'created'
  })
  return {
    id: room.id,
    name: room.name,
    desc: room.desc,
    created: room.created,
    updated: room.updated,
    picture: room.picture ? `room/profile?id=${room.id}` : null,
    owner: presentUser(room.expand?.owner),
    members: (room.expand?.members || []).map(member => presentUser(member)),
    channels: channels.map(presentChannel)
  }
}

async function broadcastParticipantChange(pb, roomId) {
  const channels = await pb.collection('dspeak_rooms_channels').getFullList({ filter: `room = '${roomId}'` })
  for (const channel of channels) broadcastToChannel(channel.id, { type: 'participant_change' })
}

async function handleRooms(event, suffix) {
  const pb = await usePocketBaseAdmin()
  const method = event.method
  const query = getQuery(event)

  if (suffix === 'profile' && method === 'GET') {
    const id = requireValue(query.id, 'Room ID is required')
    const room = await pb.collection('dspeak_rooms').getOne(id)
    if (!room.picture) throw createError({ statusCode: 404, statusMessage: 'Image not found' })
    const response = await fetch(pb.files.getURL(room, room.picture))
    if (!response.ok) throw createError({ statusCode: response.status, statusMessage: 'Failed to fetch room image' })
    setHeader(event, 'Cache-Control', 'public, max-age=604800')
    setHeader(event, 'Content-Type', response.headers.get('content-type') || 'image/jpeg')
    return sendWebResponse(event, response)
  }

  if (suffix === 'details' && method === 'GET') {
    const room = await pb.collection('dspeak_rooms').getOne(requireValue(query.id, 'Room ID is required'), { expand: 'owner,members' })
    return roomDetails(pb, room)
  }

  const userId = requireUser(event)

  if (!suffix && method === 'GET') {
    const rooms = await pb.collection('dspeak_rooms').getFullList({
      filter: `owner = '${userId}' || members ~ '${userId}'`,
      expand: 'owner,members'
    })
    return Promise.all(rooms.map(room => roomDetails(pb, room)))
  }

  const body = await parseBody(event)

  if (!suffix && method === 'POST') {
    requireValue(body.name, 'Name is required for creating new room.')
    const room = await pb.collection('dspeak_rooms').create({
      name: body.name,
      desc: body.desc || '',
      owner: userId,
      members: [userId],
      channels: [],
      ...(body.picture instanceof File && body.picture.size ? { picture: body.picture } : {})
    })
    const general = await pb.collection('dspeak_rooms_channels').create({
      name: 'general', desc: 'General chat channel', isMedia: false,
      audio_bitrate: null, inRoom: [], owner: userId, room: room.id
    })
    const voice = await pb.collection('dspeak_rooms_channels').create({
      name: 'voice', desc: 'Voice and video channel', isMedia: true,
      audio_bitrate: 64, inRoom: [], owner: userId, room: room.id
    })
    await pb.collection('dspeak_rooms').update(room.id, { channels: [general.id, voice.id] })
    setResponseStatus(event, 201)
    return room
  }

  if (!suffix && method === 'PUT') {
    const room = await pb.collection('dspeak_rooms').getOne(requireValue(body.roomId, 'Room ID is required to edit a room.'))
    if (String(room.owner) !== String(userId)) throw createError({ statusCode: 403, statusMessage: 'Only the owner can edit this room.' })
    const update = {}
    if (body.name) update.name = body.name
    if (body.desc !== undefined) update.desc = body.desc
    if (body.picture instanceof File && body.picture.size) update.picture = body.picture
    return pb.collection('dspeak_rooms').update(room.id, update)
  }

  if (!suffix && method === 'DELETE') {
    const room = await pb.collection('dspeak_rooms').getOne(requireValue(body.roomId, 'Room ID is required to delete a room.'))
    if (String(room.owner) !== String(userId)) throw createError({ statusCode: 403, statusMessage: 'Only the owner can delete this room.' })
    const channels = await pb.collection('dspeak_rooms_channels').getFullList({ filter: `room = '${room.id}'` })
    for (const channel of channels) {
      const messages = await pb.collection('dspeak_messages').getFullList({ filter: `room_channel = '${channel.id}'` })
      for (const message of messages) await pb.collection('dspeak_messages').delete(message.id)
      await pb.collection('dspeak_rooms_channels').delete(channel.id)
    }
    await pb.collection('dspeak_rooms').delete(room.id)
    return { message: 'Room deleted successfully.' }
  }

  if ((suffix === 'join' || suffix === 'leave') && method === 'POST') {
    const room = await pb.collection('dspeak_rooms').getOne(requireValue(body.roomId, `Room ID is required to ${suffix} a room.`))
    const members = (room.members || []).map(String)
    if (suffix === 'join') {
      if (!members.includes(String(userId))) await pb.collection('dspeak_rooms').update(room.id, { members: [...members, userId] })
    } else {
      if (String(room.owner) === String(userId) && members.length === 1) {
        throw createError({ statusCode: 400, statusMessage: 'Unable to leave this room, since you are the only member' })
      }
      await pb.collection('dspeak_rooms').update(room.id, { members: members.filter(id => id !== String(userId)) })
    }
    await broadcastParticipantChange(pb, room.id)
    return { message: `Successfully ${suffix === 'join' ? 'joined' : 'left'} the room.` }
  }

  throw createError({ statusCode: 404, statusMessage: 'Room endpoint not found' })
}

async function handleChannels(event, suffix) {
  const pb = await usePocketBaseAdmin()
  const userId = requireUser(event)
  const method = event.method
  const query = getQuery(event)

  if (suffix === 'details' && method === 'GET') {
    const channel = await pb.collection('dspeak_rooms_channels').getOne(requireValue(query.id, 'Channel ID is required'), { expand: 'owner' })
    ensureMember(await pb.collection('dspeak_rooms').getOne(channel.room), userId)
    return presentChannel(channel)
  }

  if (!suffix && method === 'GET') {
    const roomId = requireValue(query.roomId, 'Room ID is required')
    ensureMember(await pb.collection('dspeak_rooms').getOne(roomId), userId)
    const channels = await pb.collection('dspeak_rooms_channels').getFullList({ filter: `room = '${roomId}'`, expand: 'owner', sort: 'created' })
    return channels.map(presentChannel)
  }

  const body = await parseBody(event)

  if (!suffix && method === 'POST') {
    requireValue(body.roomId, 'Room ID and name are required for creating new channel')
    requireValue(body.name, 'Room ID and name are required for creating new channel')
    ensureMember(await pb.collection('dspeak_rooms').getOne(body.roomId), userId)
    setResponseStatus(event, 201)
    return pb.collection('dspeak_rooms_channels').create({
      name: body.name,
      desc: body.desc || '',
      isMedia: Boolean(body.isMedia),
      audio_bitrate: body.isMedia ? (body.audio_bitrate || 64) : null,
      inRoom: [], owner: userId, room: body.roomId
    })
  }

  if (!suffix && method === 'PUT') {
    const channel = await pb.collection('dspeak_rooms_channels').getOne(requireValue(body.channelId, 'Channel ID is required to edit a channel'))
    const room = await pb.collection('dspeak_rooms').getOne(channel.room)
    ensureMember(room, userId)
    if (String(channel.owner) !== String(userId) && String(room.owner) !== String(userId)) {
      throw createError({ statusCode: 403, statusMessage: 'Only the channel owner or room owner can edit this channel' })
    }
    const update = {}
    if (body.name) update.name = body.name
    if (body.desc !== undefined) update.desc = body.desc
    if (body.audio_bitrate && channel.isMedia) update.audio_bitrate = body.audio_bitrate
    const result = await pb.collection('dspeak_rooms_channels').update(channel.id, update)
    broadcastToChannel(channel.id, { type: 'channel_updated', data: result })
    return result
  }

  if (!suffix && method === 'DELETE') {
    const channel = await pb.collection('dspeak_rooms_channels').getOne(requireValue(body.channelId, 'Channel ID is required to delete a channel'))
    const room = await pb.collection('dspeak_rooms').getOne(channel.room)
    ensureMember(room, userId)
    if (String(channel.owner) !== String(userId) && String(room.owner) !== String(userId)) {
      throw createError({ statusCode: 403, statusMessage: 'Only the channel owner or room owner can delete this channel' })
    }
    const channels = await pb.collection('dspeak_rooms_channels').getFullList({ filter: `room = '${channel.room}'` })
    if (channels.length === 1) throw createError({ statusCode: 400, statusMessage: 'Cannot delete the last channel in a room' })
    broadcastToChannel(channel.id, { type: 'channel_deleted', data: { channelId: channel.id } })
    await pb.collection('dspeak_rooms_channels').delete(channel.id)
    return { message: 'Channel deleted successfully' }
  }

  if ((suffix === 'join' || suffix === 'leave') && method === 'POST') {
    const channel = await pb.collection('dspeak_rooms_channels').getOne(requireValue(body.channelId, `Channel ID is required to ${suffix} a channel`))
    ensureMember(await pb.collection('dspeak_rooms').getOne(channel.room), userId)
    const members = (channel.inRoom || []).map(String)
    const inRoom = suffix === 'join'
      ? (members.includes(String(userId)) ? members : [...members, userId])
      : members.filter(id => id !== String(userId))
    await pb.collection('dspeak_rooms_channels').update(channel.id, { inRoom })
    broadcastToChannel(channel.id, { type: 'currentlyInChannel', inRoom })
    return { message: `Successfully ${suffix === 'join' ? 'joined' : 'left'} the channel` }
  }

  throw createError({ statusCode: 404, statusMessage: 'Channel endpoint not found' })
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBKEY || useRuntimeConfig().pocketbase.vapidPublicKey
  const privateKey = process.env.VAPID_PRIVKEY || useRuntimeConfig().pocketbase.vapidPrivateKey
  if (publicKey && privateKey) webpush.setVapidDetails('mailto:darrell.cristanto@gmail.com', publicKey, privateKey)
  return Boolean(publicKey && privateKey)
}

async function sendPush(pb, room, channel, message, userId) {
  if (!configureWebPush()) return
  const members = (room.members || []).map(String)
  if (!members.length) return
  const subscriptions = await pb.collection('dspeak_webpush_global').getFullList({
    filter: members.map(id => `user = '${id}'`).join(' || ')
  })
  const payload = JSON.stringify({
    title: `New message in ${room.name} - ${channel.name}`,
    body: `${message.expand?.sender?.name || message.expand?.sender?.id || 'Someone'}: ${message.content}`,
    data: { roomId: room.id, channelId: channel.id, senderId: userId }
  })
  await Promise.allSettled(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.keys.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }
      }, payload)
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await pb.collection('dspeak_webpush_global').delete(subscription.id)
      }
    }
  }))
}

async function handleChat(event, suffix) {
  if (!suffix && event.method === 'GET') return 'DSpeak Chat'
  if (suffix === 'socket' && event.method === 'GET') throw createError({ statusCode: 426, statusMessage: 'Upgrade Required' })
  const pb = await usePocketBaseAdmin()
  const userId = requireUser(event)

  if (suffix === 'unread' && event.method === 'GET') {
    const rooms = await pb.collection('dspeak_rooms').getFullList({ filter: `members ~ '${userId}'` })
    if (!rooms.length) return []
    const channels = await pb.collection('dspeak_rooms_channels').getFullList({
      filter: rooms.map(room => `room = '${room.id}'`).join(' || ')
    })
    return Promise.all(channels.map(async channel => {
      const messages = await pb.collection('dspeak_messages').getFullList({ filter: `room_channel = '${channel.id}'`, fields: 'id,read_by' })
      return {
        channelId: channel.id,
        roomId: channel.room,
        unreadCount: messages.filter(message => !(message.read_by || []).map(String).includes(String(userId))).length
      }
    }))
  }

  if (suffix === 'messages' && event.method === 'GET') {
    const channelId = requireValue(getQuery(event).channelId, 'Channel ID is required')
    const channel = await pb.collection('dspeak_rooms_channels').getOne(channelId)
    ensureMember(await pb.collection('dspeak_rooms').getOne(channel.room), userId)
    const messages = await pb.collection('dspeak_messages').getFullList({ filter: `room_channel = '${channelId}'`, sort: 'created', expand: 'sender,read_by' })
    return messages.map(message => ({
      id: message.id, content: message.content, room_channel: message.room_channel,
      sender: presentUser(message.expand?.sender, true), created: message.created,
      updated: message.updated, read_by: (message.expand?.read_by || []).map(user => presentUser(user))
    }))
  }

  const body = await parseBody(event)

  if (suffix === 'message' && event.method === 'POST') {
    requireValue(body.channelId, 'Channel ID and content are required')
    requireValue(body.content, 'Channel ID and content are required')
    const channel = await pb.collection('dspeak_rooms_channels').getOne(body.channelId)
    const room = await pb.collection('dspeak_rooms').getOne(channel.room)
    ensureMember(room, userId)
    if (channel.isMedia) throw createError({ statusCode: 400, statusMessage: 'Cannot send text messages to a media channel' })
    const created = await pb.collection('dspeak_messages').create({ content: body.content, room_channel: channel.id, sender: userId, read_by: [userId] })
    const message = await pb.collection('dspeak_messages').getOne(created.id, { expand: 'sender' })
    const result = {
      id: message.id, content: message.content, room_channel: message.room_channel,
      sender: presentUser(message.expand?.sender, true), created: message.created,
      read_by: message.read_by || []
    }
    broadcastToChannel(channel.id, { type: 'new_message', data: result })
    sendPush(pb, room, channel, message, userId).catch(error => console.error('[Push]', error))
    setResponseStatus(event, 201)
    return result
  }

  if (suffix === 'read' && event.method === 'POST') {
    const ids = Array.isArray(body.messageIds) ? body.messageIds : (body.messageId ? [body.messageId] : [])
    requireValue(ids.length, 'At least one message ID is required')
    const results = []
    for (const messageId of ids) {
      try {
        const message = await pb.collection('dspeak_messages').getOne(messageId)
        const channel = await pb.collection('dspeak_rooms_channels').getOne(message.room_channel)
        ensureMember(await pb.collection('dspeak_rooms').getOne(channel.room), userId)
        const readers = (message.read_by || []).map(String)
        if (!readers.includes(String(userId))) {
          const readBy = [...readers, userId]
          await pb.collection('dspeak_messages').update(message.id, { read_by: readBy })
          broadcastToChannel(channel.id, { type: 'message_updated', data: { id: message.id, read_by: readBy } })
          results.push({ messageId, status: 'marked_as_read' })
        } else results.push({ messageId, status: 'already_read' })
      } catch (error) {
        results.push({ messageId, status: 'error', error: pocketBaseError(error) })
      }
    }
    return { results }
  }

  if (suffix === 'subscribe/global') {
    const existing = await pb.collection('dspeak_webpush_global').getFullList({ filter: `user = '${userId}'` })
    if (event.method === 'GET') return { hasSubscription: existing.length > 0, subscription: existing[0] ? { id: existing[0].id, created: existing[0].created, updated: existing[0].updated } : null }
    if (event.method === 'DELETE') {
      for (const subscription of existing) await pb.collection('dspeak_webpush_global').delete(subscription.id)
      return { success: true, message: 'Global subscription deleted' }
    }
    if (event.method === 'POST') {
      const subscription = requireValue(body.subscription, 'Subscription is required')
      const data = { keys: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }
      if (existing[0]) await pb.collection('dspeak_webpush_global').update(existing[0].id, data)
      else await pb.collection('dspeak_webpush_global').create({ user: userId, ...data })
      setResponseStatus(event, 201)
      return { success: true, message: 'Global subscription updated' }
    }
  }

  if (suffix === 'subscribe' && event.method === 'POST') {
    requireValue(body.roomId, 'Room ID and subscription are required')
    requireValue(body.subscription, 'Room ID and subscription are required')
    const existing = await pb.collection('dspeak_webpush').getFullList({ filter: `room = '${body.roomId}' && user = '${userId}'` })
    if (!existing.length) await pb.collection('dspeak_webpush').create({
      room: body.roomId, user: userId,
      keys: { endpoint: body.subscription.endpoint, p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth }
    })
    setResponseStatus(event, 201)
    return { success: true }
  }

  throw createError({ statusCode: 404, statusMessage: 'Chat endpoint not found' })
}

export async function handleDspeakApi(event) {
  const path = String(getRouterParam(event, 'path') || '').replace(/^\/+|\/+$/g, '')
  const [domain = '', ...rest] = path.split('/')
  const suffix = rest.join('/')

  try {
    if (!domain && event.method === 'GET') return 'DSpeak ready.'
    if (domain === 'config' && event.method === 'GET') return ICE_SERVERS
    if (domain === 'room') return await handleRooms(event, suffix)
    if (domain === 'channel') return await handleChannels(event, suffix)
    if (domain === 'chat') return await handleChat(event, suffix)
    throw createError({ statusCode: 404, statusMessage: 'DSpeak endpoint not found' })
  } catch (error) {
    if (error?.statusCode) throw error
    console.error('[DSpeak API]', error)
    throw createError({ statusCode: error?.status || 500, statusMessage: error?.message || 'Internal Server Error', data: pocketBaseError(error) })
  }
}
