export const useChatUtils = () => {
  
  /**
   * Format a timestamp for display in chat
   */
  function formatChatTime(dateString) {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) {
      return 'Just now'
    } else if (diffMins < 60) {
      return `${diffMins}m ago`
    } else if (diffHours < 24) {
      return `${diffHours}h ago`
    } else if (diffDays < 7) {
      return `${diffDays}d ago`
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }
  }

  /**
   * Format a timestamp for chat display:
   * - Today: HH:mm
   * - Yesterday: ddd h:mmA (e.g. Thu 6.52pm)
   * - Last week: d/M (e.g. 8/8)
   * - Else: yyyy/M/d
   */
  function formatChatDisplayTime(dateString) {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffDays = Math.floor(diffMs / 86400000)

    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    
    const pad = n => n.toString().padStart(2, '0')
    
    const hour12 = date.getHours() % 12 || 12
    const min = pad(date.getMinutes())
    const ampm = date.getHours() < 12 ? 'am' : 'pm'
    const timeStr = hour12 + '.' + min + ampm

    if (date.toDateString() === now.toDateString()) {
      
      return timeStr
    }
    
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) {
      
      return days[date.getDay()] + ' ' + timeStr
    }
    
    if (diffDays < 7) {
      
      return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + timeStr
    }
    
    return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate() + ' ' + timeStr
  }

  /**
   * Format a full date for detailed views
   */
  function formatFullDate(dateString) {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    })
  }

  /**
   * Get avatar URL with fallback
   */
  function getAvatarUrl(avatarPath, apiPath) {
    if (!avatarPath) return '/favicon-32x32.png'
    
    if (avatarPath.startsWith('http')) return avatarPath
    
    return `${apiPath}/files/${avatarPath}`
  }

  /**
   * Validate message content
   */
  function validateMessage(content) {
    if (!content || typeof content !== 'string') {
      return { valid: false, error: 'Message content is required' }
    }

    const trimmed = content.trim()
    if (trimmed.length === 0) {
      return { valid: false, error: 'Message cannot be empty' }
    }

    if (trimmed.length > 1000) {
      return { valid: false, error: 'Message is too long (max 1000 characters)' }
    }

    return { valid: true, content: trimmed }
  }

  /**
   * Generate a temporary message ID for optimistic updates
   */
  function generateTempId() {
    return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Check if user is mentioned in message
   */
  function isUserMentioned(message, userId) {
    if (!message || !userId) return false
    
    const mentionPattern = new RegExp(`@${userId}\\b`, 'i')
    return mentionPattern.test(message)
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  /**
   * Parse simple text formatting (basic markdown-like)
   */
  function parseMessageFormat(text) {
    if (!text) return ''
    
    let formatted = escapeHtml(text)
    
    
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    
    
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>')
    
    
    formatted = formatted.replace(/`(.*?)`/g, '<code class="bg-base-200 px-1 rounded text-sm">$1</code>')
    
    
    const urlRegex = /(https?:\/\/[^\s]+)/g
    formatted = formatted.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" class="link link-primary">$1</a>')
    
    return formatted
  }

  /**
   * Check if two messages should be grouped (same sender, close in time)
   */
  function shouldGroupMessages(prevMessage, currentMessage) {
    if (!prevMessage || !currentMessage) return false
    
    
    if (prevMessage.sender.id !== currentMessage.sender.id) return false
    
    
    const timeDiff = new Date(currentMessage.created) - new Date(prevMessage.created)
    if (timeDiff > 5 * 60 * 1000) return false
    
    return true
  }

  /**
   * Get user display name with fallback
   */
  function getUserDisplayName(user, currentUserId) {
    if (!user) return 'Unknown User'
    
    if (user.id === currentUserId) return 'You'
    
    return user.name || user.email || `User ${user.id.slice(0, 8)}`
  }

  /**
   * Copy text to clipboard with fallback
   */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        return true
      } else {
        
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        
        const success = document.execCommand('copy')
        document.body.removeChild(textArea)
        return success
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      return false
    }
  }

  /**
   * Debounce function for typing indicators
   */
  function debounce(func, delay) {
    let timeoutId
    return (...args) => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => func.apply(this, args), delay)
    }
  }

  return {
    formatChatTime,
    formatChatDisplayTime,
    formatFullDate,
    getAvatarUrl,
    validateMessage,
    generateTempId,
    isUserMentioned,
    escapeHtml,
    parseMessageFormat,
    shouldGroupMessages,
    getUserDisplayName,
    copyToClipboard,
    debounce
  }
}
