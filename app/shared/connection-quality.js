export function getConnectionQualityBars(rttMs) {
  if (rttMs == null || rttMs === '') return 0
  const rtt = Number(rttMs)
  if (!Number.isFinite(rtt) || rtt < 0) return 0
  if (rtt < 20) return 5
  if (rtt <= 50) return 4
  if (rtt <= 100) return 3
  if (rtt <= 150) return 2
  return 1
}

export function getConnectionQualityLabel(bars) {
  if (bars === 5) return 'Excellent'
  if (bars === 4) return 'Very good'
  if (bars === 3) return 'Good'
  if (bars === 2) return 'Fair'
  if (bars === 1) return 'Poor'
  return 'Waiting for statistics'
}
