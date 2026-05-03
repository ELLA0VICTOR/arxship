import { useEffect, useMemo, useRef, useState } from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import {
  Anchor,
  Crosshair,
  RefreshCw,
  Satellite,
  Shield,
  Skull,
  Swords,
  Waves,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Progress,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/8bit'
import { cellsToMask, countCells, maskHasCell, shortAddress, statusLabel } from './utils/board'
import { encryptFleet } from './utils/arciumApi'
import {
  createGame,
  connection,
  fetchGames,
  fireShot,
  hasShot,
  joinGame,
  playerIndexFor,
  PROGRAM_ID,
  submitFleet,
  waitForGameChange,
} from './utils/programClient'

const TABS = [
  { id: 'waiting', label: 'Open Seas', match: (game) => ['initializing', 'waitingForOpponent'].includes(game.status) },
  { id: 'setup', label: 'Fleet Setup', match: (game) => game.status === 'fleetSetup' },
  { id: 'active', label: 'Battle Live', match: (game) => game.status === 'active' },
  { id: 'finished', label: 'Aftermath', match: (game) => ['finished', 'cancelled'].includes(game.status) },
]

const NAV_ITEMS = [
  { href: '#intel', label: 'Intel' },
  { href: '#matches', label: 'Matches' },
  { href: '#protocol', label: 'Protocol' },
]

function cellName(cell) {
  const row = Math.floor(cell / 5)
  const col = cell % 5
  return `${String.fromCharCode(65 + row)}${col + 1}`
}

function Board({ mode, selectedCells = [], shotsMask = 0n, disabledCells = 0n, onCellClick, ownFleetMask = 0n }) {
  return (
    <div className="border border-white/18 bg-black">
      <div className="grid grid-cols-[34px_repeat(5,minmax(0,1fr))] border-b border-white/12 text-center text-[10px] uppercase tracking-[0.18em] text-white/45">
        <div />
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="border-l border-white/12 py-2">{col + 1}</div>
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="grid grid-cols-[34px_repeat(5,minmax(0,1fr))] border-b border-white/12 last:border-b-0">
          <div className="grid place-items-center border-r border-white/12 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
            {String.fromCharCode(65 + row)}
          </div>
          {Array.from({ length: 5 }).map((__, col) => {
            const cell = row * 5 + col
            const selected = selectedCells.includes(cell)
            const wasShot = maskHasCell(shotsMask, cell)
            const disabled = maskHasCell(disabledCells, cell)
            const ownShip = maskHasCell(ownFleetMask, cell)
            const interactive = Boolean(onCellClick) && !disabled

            return (
              <TooltipProvider key={cell}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={!interactive}
                      onClick={() => onCellClick?.(cell)}
                      className={[
                        'relative grid aspect-square min-h-12 place-items-center border-r border-white/12 text-xs font-bold text-white/76 transition last:border-r-0 hover:bg-white/10 disabled:cursor-default',
                        selected ? 'bg-white text-black hover:bg-white' : '',
                        ownShip ? 'bg-white/16 text-white' : '',
                        wasShot ? 'bg-white/26 text-white' : '',
                        mode === 'target' && !wasShot ? 'hover:text-white' : '',
                      ].join(' ')}
                    >
                      <span>{wasShot ? 'X' : selected || ownShip ? 'S' : cellName(cell)}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {cellName(cell)} {wasShot ? 'already scanned' : mode === 'fleet' ? 'hide ship here' : 'target cell'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function StatusText({ game }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-white">
      <span className="h-2 w-2 bg-white" />
      {statusLabel(game.status)}
    </span>
  )
}

function GamePanel({ game, walletAddress, onRefresh }) {
  const wallet = useWallet()
  const playerIndex = playerIndexFor(game, walletAddress)
  const opponentIndex = playerIndex === 1 ? 2 : 1
  const [busy, setBusy] = useState('')
  const [fleetCells, setFleetCells] = useState([])
  const [targetCell, setTargetCell] = useState(null)
  const [message, setMessage] = useState('')
  const localFleetKey = walletAddress ? `arxship:fleet:${game.id}:${walletAddress}` : ''
  const ownFleetMask = useMemo(() => {
    if (!localFleetKey) return 0n
    return BigInt(localStorage.getItem(localFleetKey) || 0)
  }, [localFleetKey, game.p1Ready, game.p2Ready])

  const myReady = playerIndex === 1 ? game.p1Ready : playerIndex === 2 ? game.p2Ready : false
  const isMyTurn = game.status === 'active' && playerIndex === game.currentTurn
  const isChainSettling = game.pendingAction !== 0
  const myShots = playerIndex ? (playerIndex === 1 ? game.p1Shots : game.p2Shots) : 0n
  const opponentShots = opponentIndex === 1 ? game.p1Shots : game.p2Shots
  const winnerAddress = game.winner === 1 ? game.creator : game.winner === 2 ? game.opponent : null

  function toggleFleet(cell) {
    setFleetCells((current) => {
      if (current.includes(cell)) return current.filter((item) => item !== cell)
      if (current.length >= 3) return current
      return [...current, cell]
    })
  }

  async function run(label, action) {
    try {
      setBusy(label)
      setMessage('')
      await action()
      await onRefresh()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <article className="border-t border-white/18 py-8 first:border-t-0">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-7">
          <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="mb-3 text-[10px] uppercase tracking-[0.26em] text-white/42">Match / {game.gameId}</div>
              <h3 className="font-pixel text-xl leading-8 text-white">{game.callsign || 'Unnamed Sector'}</h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58">
                {shortAddress(game.creator)} {game.opponent ? `versus ${shortAddress(game.opponent)}` : 'awaiting rival captain'}
              </p>
            </div>
            <StatusText game={game} />
          </header>

          <div className="grid border-y border-white/14 md:grid-cols-4">
            <MiniStat label="Role" value={playerIndex ? `Player ${playerIndex}` : 'Spectator'} />
            <MiniStat label="Turn" value={game.currentTurn ? `Player ${game.currentTurn}` : '-'} />
            <MiniStat label="Last Scan" value={game.lastShooter ? `${cellName(game.lastCell)} ${game.lastHit ? 'Hit' : 'Miss'}` : 'None'} />
            <MiniStat label="Winner" value={winnerAddress ? shortAddress(winnerAddress) : 'Hidden'} />
          </div>

          {game.status === 'waitingForOpponent' && (
            <ActionPanel icon={Anchor} title="Open challenge" description="A second wallet can join this match. Fleet positions stay empty until both players enter setup.">
              {playerIndex === 0 ? (
                <Button disabled={!wallet.connected || busy} onClick={() => run('Joining', () => joinGame(wallet, game.id))}>
                  {busy === 'Joining' ? <Spinner /> : <Swords className="h-4 w-4" />} Join Battle
                </Button>
              ) : (
                <p className="text-sm text-white/58">Share this match with another wallet to begin fleet setup.</p>
              )}
            </ActionPanel>
          )}

          {game.status === 'finished' && (
            <ActionPanel icon={Skull} title="Match resolved" description="The final winner is public. Fleet layouts remain hidden after the battle.">
              <div className="font-pixel text-lg text-white">
                Winner: {winnerAddress ? shortAddress(winnerAddress) : `Player ${game.winner}`}
              </div>
            </ActionPanel>
          )}

          {message && <div className="border-l-2 border-white bg-white/8 p-4 text-sm leading-6 text-white">{message}</div>}
          {isChainSettling && (
            <div className="border-l-2 border-white/40 bg-white/5 p-4 text-sm leading-6 text-white/58">
              Arcium computation is settling on-chain. Hold position until the callback lands.
            </div>
          )}
          {busy && <div className="text-xs uppercase tracking-[0.24em] text-white/70">{busy}...</div>}
        </div>

        <div className="space-y-5">
          {game.status === 'fleetSetup' && playerIndex > 0 && (
            <>
              <SectionHeader eyebrow="Private Setup" title="Hide your fleet" description="Pick exactly 3 cells. The fleet mask is encrypted before it touches the chain." />
              <Board mode="fleet" selectedCells={fleetCells} onCellClick={myReady || busy || isChainSettling ? undefined : toggleFleet} ownFleetMask={ownFleetMask} />
              <div className="space-y-4 border-t border-white/14 pt-5">
                <MiniStat label="Ships Selected" value={`${fleetCells.length}/3`} compact />
                <Progress value={(fleetCells.length / 3) * 100} variant="retro" className="h-4" progressBg="bg-white" />
                <Button
                  className="w-full"
                  disabled={myReady || isChainSettling || fleetCells.length !== 3 || busy}
                  onClick={() =>
                    run('Encrypting Fleet', async () => {
                      const fleetMask = cellsToMask(fleetCells)
                      const encrypted = await encryptFleet(fleetMask)
                      await submitFleet(wallet, game.id, encrypted)
                      localStorage.setItem(localFleetKey, fleetMask.toString())
                      await waitForGameChange(game.id, (next) => (playerIndex === 1 ? next.p1Ready : next.p2Ready), 24, 2000)
                    })
                  }
                >
                  {busy === 'Encrypting Fleet' ? <Spinner /> : <Shield className="h-4 w-4" />} {myReady ? 'Fleet Locked' : isChainSettling ? 'MPC Settling' : 'Encrypt Fleet'}
                </Button>
              </div>
            </>
          )}

          {game.status === 'active' && playerIndex > 0 && (
            <>
              <SectionHeader
                eyebrow="Targeting"
                title={isMyTurn ? 'Your scan window is open' : 'Enemy scan in progress'}
                description="Shots are public. Arcium privately checks the hidden fleet and reveals only hit or miss."
              />
              <Board
                mode="target"
                selectedCells={targetCell === null ? [] : [targetCell]}
                shotsMask={myShots}
                disabledCells={myShots}
                onCellClick={isMyTurn && !busy && !isChainSettling ? setTargetCell : undefined}
              />
              <div className="space-y-4 border-t border-white/14 pt-5">
                <div className="grid grid-cols-2 border-y border-white/14">
                  <MiniStat label="Target" value={targetCell === null ? 'Select' : cellName(targetCell)} compact />
                  <MiniStat label="Enemy Shots" value={countCells(opponentShots).toString()} compact />
                </div>
                <Button
                  className="w-full"
                  disabled={!isMyTurn || isChainSettling || targetCell === null || hasShot(game, playerIndex, targetCell) || busy}
                  onClick={() =>
                    run('Firing', async () => {
                      await fireShot(wallet, game.id, targetCell)
                      await waitForGameChange(game.id, (next) => next.lastCell === targetCell && next.pendingAction === 0, 30, 2000)
                      setTargetCell(null)
                    })
                  }
                >
                  {busy === 'Firing' ? <Spinner /> : <Crosshair className="h-4 w-4" />} {isChainSettling ? 'MPC Settling' : 'Fire Private Scan'}
                </Button>
              </div>
            </>
          )}

          {(game.status === 'waitingForOpponent' || playerIndex === 0) && game.status !== 'finished' && (
            <div className="border border-white/12 p-6 text-sm leading-7 text-white/52">
              {playerIndex === 0
                ? 'Spectator mode. Connect as one of the two players to manage fleets or fire scans.'
                : 'Waiting for the opposing captain. The private board unlocks when both players are present.'}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function MiniStat({ label, value, compact = false }) {
  return (
    <div className={['border-white/14 p-4 md:border-r md:last:border-r-0', compact ? 'border-r last:border-r-0' : ''].join(' ')}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/42">{label}</div>
      <div className="mt-2 truncate text-base font-black text-white">{value}</div>
    </div>
  )
}

function SectionHeader({ eyebrow, title, description }) {
  return (
    <div className="border-b border-white/14 pb-4">
      <div className="text-[10px] uppercase tracking-[0.26em] text-white/42">{eyebrow}</div>
      <h4 className="mt-2 font-pixel text-sm text-white">{title}</h4>
      <p className="mt-3 text-sm leading-6 text-white/56">{description}</p>
    </div>
  )
}

function ActionPanel({ icon: Icon, title, description, children }) {
  return (
    <div className="border-y border-white/14 py-5">
      <div className="mb-5 flex gap-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center border border-white/24 bg-white text-black">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="font-black uppercase tracking-[0.16em] text-white">{title}</div>
          <p className="mt-2 text-sm leading-6 text-white/58">{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function CreateGameDialog({ onCreate, busy }) {
  const [callsign, setCallsign] = useState('Ghost Fleet')

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="lg">
          <Waves className="h-4 w-4" /> Create Match
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Launch a hidden fleet match</DialogTitle>
          <DialogDescription>
            ArxShip creates an onchain game account, then initializes private match state inside Arcium.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="callsign">Match Callsign</Label>
            <Input id="callsign" value={callsign} maxLength={64} onChange={(event) => setCallsign(event.target.value)} />
          </div>
          <Button disabled={busy || !callsign.trim()} onClick={() => onCreate(callsign.trim())}>
            {busy ? <Spinner /> : <Satellite className="h-4 w-4" />} Initialize Match
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function HeaderMetric({ label, value }) {
  return (
    <div className="border-l border-white/18 px-5 py-4 first:border-l-0">
      <div className="text-[10px] uppercase tracking-[0.24em] text-white/42">{label}</div>
      <div className="mt-2 truncate text-sm font-black text-white">{value}</div>
    </div>
  )
}

export default function App() {
  const wallet = useWallet()
  const walletAddress = wallet.publicKey?.toBase58()
  const [games, setGames] = useState([])
  const [activeTab, setActiveTab] = useState('waiting')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const hasLoaded = useRef(false)
  const refreshInFlight = useRef(false)

  async function refreshGames({ silent = hasLoaded.current } = {}) {
    if (refreshInFlight.current) return

    try {
      refreshInFlight.current = true
      if (silent) {
        setSyncing(true)
      } else {
        setLoading(true)
        setNotice('')
      }
      const nextGames = await fetchGames()
      setGames(nextGames)
      hasLoaded.current = true
    } catch (error) {
      if (silent) {
        console.warn('Silent match sync failed:', error)
      } else {
        setNotice(error.message)
      }
    } finally {
      refreshInFlight.current = false
      if (silent) {
        setSyncing(false)
      } else {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    let subscriptionId = null
    let debounceId = null
    let closed = false

    refreshGames({ silent: false })

    function scheduleSilentRefresh() {
      window.clearTimeout(debounceId)
      debounceId = window.setTimeout(() => refreshGames({ silent: true }), 700)
    }

    try {
      const listener = connection.onProgramAccountChange(PROGRAM_ID, scheduleSilentRefresh, 'confirmed')
      Promise.resolve(listener)
        .then((id) => {
          if (closed) {
            connection.removeProgramAccountChangeListener(id).catch(() => {})
          } else {
            subscriptionId = id
          }
        })
        .catch((error) => {
          console.warn('Program account subscription unavailable, using fallback sync only:', error)
        })
    } catch (error) {
      console.warn('Program account subscription unavailable, using fallback sync only:', error)
    }

    const fallbackId = window.setInterval(() => refreshGames({ silent: true }), 45000)

    return () => {
      closed = true
      window.clearTimeout(debounceId)
      window.clearInterval(fallbackId)
      if (subscriptionId !== null) {
        connection.removeProgramAccountChangeListener(subscriptionId).catch(() => {})
      }
    }
  }, [])

  const counts = useMemo(() => {
    return Object.fromEntries(TABS.map((tab) => [tab.id, games.filter(tab.match).length]))
  }, [games])

  async function handleCreate(callsign) {
    if (!wallet.connected) {
      setNotice('Connect your wallet first.')
      return
    }

    try {
      setBusy(true)
      await createGame(wallet, callsign)
      await refreshGames()
      setActiveTab('waiting')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setBusy(false)
    }
  }

  const activeGames = games.filter(TABS.find((tab) => tab.id === activeTab)?.match || (() => false))

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="pointer-events-none fixed inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:64px_64px]" />
      <div className="relative mx-auto min-h-screen max-w-[1500px] border-x border-white/12">
        <CommandNav walletAddress={walletAddress} counts={counts} />

        <header id="intel" className="border-b border-white/18">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_460px]">
            <section className="px-5 py-10 md:px-8 lg:py-16">
              <div className="mb-7 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.28em] text-white/44">
                <span>Arcium encrypted gameplay</span>
                <span className="hidden text-white/20 sm:inline">/</span>
                <span>Solana devnet</span>
              </div>
              <h1 className="max-w-4xl font-pixel text-4xl leading-tight text-white md:text-6xl">
                Private fleet warfare, fully onchain.
              </h1>
              <p className="mt-7 max-w-3xl text-base leading-8 text-white/64 md:text-lg">
                ArxShip is a two-player strategy game where fleets stay hidden, shots stay public,
                and Arcium reveals only the rule-required hit, miss, and winner.
              </p>
              <div className="mt-9 grid max-w-4xl border-y border-white/16 md:grid-cols-3">
                <HeroMetric label="Board" value="5 x 5" />
                <HeroMetric label="Ships" value="3 Hidden" />
                <HeroMetric label="Reveal" value="Hit / Miss" />
              </div>
            </section>

            <aside className="border-t border-white/18 p-5 md:p-8 lg:border-l lg:border-t-0">
              <div className="mb-5 flex items-center justify-between border-b border-white/14 pb-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.26em] text-white/42">Tactical Screen</div>
                  <div className="mt-2 font-pixel text-sm text-white">Sector A-25</div>
                </div>
                <div className="h-3 w-3 animate-pulse bg-white" />
              </div>
              <SignalBoard />
              <div className="mt-5 grid grid-cols-2 border border-white/14">
                <HeaderMetric label="Wallet" value={walletAddress ? shortAddress(walletAddress) : 'Offline'} />
                <HeaderMetric label="Network" value="Devnet" />
              </div>
            </aside>
          </div>
        </header>

        <section id="protocol" className="grid border-b border-white/18 md:grid-cols-3">
          <FeatureLine title="Hidden State" text="Fleet masks remain encrypted in MXE-owned state." />
          <FeatureLine title="Public Rules" text="Shots, turns, hit/miss, and winners are visible." />
          <FeatureLine title="No Trust UI" text="Solana enforces turns while Arcium resolves private outcomes." />
        </section>

        <section id="matches" className="px-5 py-7 md:px-8">
          <div className="flex flex-col gap-5 border-b border-white/18 pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/42">Battle Board</div>
              <h2 className="mt-3 font-pixel text-xl text-white">Live Match Control</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58">
                Create, join, lock fleets, and resolve shots from a single professional command surface.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {syncing && !loading && (
                <div className="flex items-center border border-white/14 px-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/44">
                  Syncing chain
                </div>
              )}
              <Button variant="secondary" onClick={() => refreshGames({ silent: false })} disabled={loading}>
                {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
              </Button>
              <CreateGameDialog onCreate={handleCreate} busy={busy} />
            </div>
          </div>

          {notice && <div className="mt-6 border-l-2 border-white bg-white/8 p-4 text-sm leading-6 text-white">{notice}</div>}

          <nav className="mt-7 flex flex-wrap border-b border-white/18">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'border-b-2 px-0 py-4 pr-8 text-left text-xs font-black uppercase tracking-[0.2em] transition md:pr-12',
                  activeTab === tab.id ? 'border-white text-white' : 'border-transparent text-white/38 hover:text-white/78',
                ].join(' ')}
              >
                {tab.label} <span className="ml-2 text-white/38">{counts[tab.id] || 0}</span>
              </button>
            ))}
          </nav>

          <section className="min-h-[360px]">
            {loading && !games.length ? (
              <div className="flex items-center gap-3 border-b border-white/18 py-10 text-white/70">
                <Spinner /> Loading encrypted waters...
              </div>
            ) : activeGames.length ? (
              activeGames.map((game) => (
                <GamePanel key={game.id} game={game} walletAddress={walletAddress} onRefresh={refreshGames} />
              ))
            ) : (
              <div className="border-b border-white/18 py-16 text-center text-sm uppercase tracking-[0.2em] text-white/42">
                No matches in this sector yet.
              </div>
            )}
          </section>
        </section>

        <footer className="border-t border-white/18 px-5 py-7 md:px-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="font-pixel text-sm text-white">ArxShip</div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/54">
                Built as a private Solana strategy game: public gameplay rules, encrypted fleet state,
                and minimal reveals powered by Arcium.
              </p>
            </div>
            <div className="grid gap-2 text-left text-[10px] uppercase tracking-[0.22em] text-white/44 sm:text-right">
              <span>Program {shortAddress(PROGRAM_ID.toBase58())}</span>
              <span>Arcium MXE ready / circuit URLs pending upload</span>
            </div>
          </div>
        </footer>
      </div>
    </main>
  )
}

function CommandNav({ walletAddress, counts }) {
  const liveCount = (counts.setup || 0) + (counts.active || 0)

  return (
    <nav className="sticky top-0 z-30 border-b border-white/18 bg-black/95 px-5 py-4 backdrop-blur md:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <a href="#intel" className="group flex items-center gap-4">
          <span className="grid h-10 w-10 place-items-center border border-white bg-white font-black text-black transition group-hover:bg-black group-hover:text-white">
            AX
          </span>
          <span>
            <span className="block font-pixel text-sm text-white">ArxShip</span>
            <span className="mt-1 block text-[10px] uppercase tracking-[0.24em] text-white/40">Private naval tactics</span>
          </span>
        </a>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-6 border-y border-white/12 py-3 lg:border-y-0 lg:py-0">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-xs font-black uppercase tracking-[0.22em] text-white/52 transition hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[auto_auto] sm:items-center">
            <div className="hidden border-l border-white/14 pl-5 text-[10px] uppercase tracking-[0.22em] text-white/46 sm:block">
              Live Ops <span className="text-white">{liveCount}</span>
            </div>
            <WalletMultiButton className="!h-11 !rounded-none !border !border-white !bg-white !px-5 !font-black !uppercase !tracking-[0.14em] !text-black hover:!bg-black hover:!text-white" />
          </div>

          <div className="text-[10px] uppercase tracking-[0.22em] text-white/38 lg:hidden">
            Wallet: {walletAddress ? shortAddress(walletAddress) : 'Offline'}
          </div>
        </div>
      </div>
    </nav>
  )
}

function HeroMetric({ label, value }) {
  return (
    <div className="border-b border-white/14 p-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="text-[10px] uppercase tracking-[0.24em] text-white/42">{label}</div>
      <div className="mt-2 font-black text-white">{value}</div>
    </div>
  )
}

function SignalBoard() {
  const markers = new Map([
    [2, 'S'],
    [8, 'X'],
    [11, 'S'],
    [17, '?'],
    [22, 'S'],
  ])

  return (
    <div className="border border-white/16">
      <div className="grid grid-cols-[32px_repeat(5,minmax(0,1fr))] border-b border-white/12 text-center text-[10px] uppercase tracking-[0.18em] text-white/36">
        <div />
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="border-l border-white/12 py-2">{col + 1}</div>
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="grid grid-cols-[32px_repeat(5,minmax(0,1fr))] border-b border-white/12 last:border-b-0">
          <div className="grid place-items-center border-r border-white/12 text-[10px] font-black uppercase tracking-[0.18em] text-white/36">
            {String.fromCharCode(65 + row)}
          </div>
          {Array.from({ length: 5 }).map((__, col) => {
            const cell = row * 5 + col
            const marker = markers.get(cell)

            return (
              <div
                key={cell}
                className={[
                  'grid aspect-square min-h-12 place-items-center border-r border-white/12 text-xs font-black last:border-r-0',
                  marker === 'S' ? 'bg-white text-black' : marker ? 'bg-white/14 text-white' : 'text-white/20',
                ].join(' ')}
              >
                {marker || '.'}
              </div>
            )
          })}
        </div>
      ))}
      <div className="border-t border-white/12 p-4 text-xs leading-6 text-white/48">
        UI principle: show only the tactical signal players need right now. The board stays readable, the secrets stay encrypted.
      </div>
    </div>
  )
}

function FeatureLine({ title, text }) {
  return (
    <div className="border-b border-white/12 px-5 py-6 last:border-b-0 md:border-b-0 md:border-r md:px-8 md:last:border-r-0">
      <div className="font-pixel text-xs text-white">{title}</div>
      <p className="mt-3 text-sm leading-6 text-white/55">{text}</p>
    </div>
  )
}
