const API_BASE_URL = import.meta.env.VITE_ARCIUM_API_URL || 'http://localhost:4100/api/arcium'

async function request(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, options)
  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data.success) {
    throw new Error(data.error || `Request failed: ${response.status}`)
  }

  return data
}

export async function getArciumAccounts(computationOffset, circuitName) {
  const params = new URLSearchParams({
    computationOffset: computationOffset.toString(),
    circuitName,
  })
  const data = await request(`/accounts?${params.toString()}`)
  return data.accounts
}

export async function encryptFleet(fleetMask) {
  const data = await request('/encrypt-fleet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fleetMask: fleetMask.toString() }),
  })
  return data.encrypted
}
