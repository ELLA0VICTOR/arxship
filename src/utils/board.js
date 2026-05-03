export const BOARD_SIZE = 5
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE
export const SHIPS_PER_PLAYER = 3

export function cellToMask(cell) {
  return 1n << BigInt(cell)
}

export function cellsToMask(cells) {
  return cells.reduce((mask, cell) => mask | cellToMask(cell), 0n)
}

export function maskHasCell(mask, cell) {
  return (BigInt(mask || 0) & cellToMask(cell)) !== 0n
}

export function countCells(mask) {
  let count = 0
  const value = BigInt(mask || 0)
  for (let cell = 0; cell < BOARD_CELLS; cell += 1) {
    if (maskHasCell(value, cell)) count += 1
  }
  return count
}

export function shortAddress(address) {
  if (!address) return 'Unassigned'
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

export function statusLabel(status) {
  const key = typeof status === 'string' ? status : Object.keys(status || {})[0]
  const labels = {
    initializing: 'Initializing',
    waitingForOpponent: 'Waiting',
    fleetSetup: 'Fleet Setup',
    active: 'Live Battle',
    finished: 'Finished',
    cancelled: 'Cancelled',
  }
  return labels[key] || 'Unknown'
}

export function parseStatus(status) {
  if (!status) return 'unknown'
  if (typeof status === 'string') return status
  return Object.keys(status)[0] || 'unknown'
}
