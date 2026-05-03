import { AnchorProvider, BN, Program } from '@coral-xyz/anchor'
import { PublicKey, SystemProgram, clusterApiUrl, Connection } from '@solana/web3.js'
import { getArciumAccounts } from './arciumApi'
import { maskHasCell, parseStatus } from './board'

export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID || '8LCtkMQAaFKDJ7aVRWaiuKdxgTZ5qEA5psdggvvdbvtS'
)

export const connection = new Connection(import.meta.env.VITE_RPC_URL || clusterApiUrl('devnet'), {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 90000,
})

let cachedIdl = null

function u64LeBuffer(value) {
  const bn = BN.isBN(value) ? value : new BN(value.toString())
  return bn.toArrayLike(Buffer, 'le', 8)
}

function u128FromLeBytes(bytes) {
  let out = 0n
  for (let i = 0; i < bytes.length; i += 1) {
    out += BigInt(bytes[i]) << (8n * BigInt(i))
  }
  return new BN(out.toString())
}

function publicKeyMap(accounts) {
  return Object.fromEntries(Object.entries(accounts).map(([key, value]) => [key, new PublicKey(value)]))
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function errorText(error) {
  return [
    error?.name,
    error?.message,
    error?.toString?.(),
    error?.error?.message,
    error?.error?.toString?.(),
    Array.isArray(error?.logs) ? error.logs.join('\n') : '',
    Array.isArray(error?.simulationResponse?.logs) ? error.simulationResponse.logs.join('\n') : '',
    Array.isArray(error?.error?.logs) ? error.error.logs.join('\n') : '',
    Array.isArray(error?.error?.simulationResponse?.logs) ? error.error.simulationResponse.logs.join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function isAlreadyProcessedError(error) {
  return /already been processed/i.test(errorText(error))
}

function readableErrorSummary(error) {
  const text = errorText(error)
  const anchorMessage = text.match(/Error Message:\s*([^\n]+)/i)
  if (anchorMessage?.[1]) return anchorMessage[1].trim()

  const anchorCode = text.match(/Error Code:\s*([A-Za-z0-9_]+)/i)
  if (anchorCode?.[1]) return anchorCode[1].trim()

  if (/unexpected error/i.test(text) && /WalletSignTransactionError/i.test(text)) {
    return 'The wallet could not sign this transaction. If an Arcium action is settling, wait for the callback and try again.'
  }

  return error?.message || 'Unexpected transaction error'
}

async function assertSimulationPasses(builder, actionLabel) {
  try {
    await builder.simulate()
  } catch (error) {
    const text = errorText(error)
    console.error(`${actionLabel} preflight simulation failed:`, error)
    throw new Error(`${actionLabel} is not ready: ${readableErrorSummary(error)}${text ? `\n\n${text}` : ''}`)
  }
}

async function waitForAccount(publicKey, attempts = 8, delayMs = 1200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const account = await connection.getAccountInfo(publicKey, 'confirmed')
    if (account) return account
    if (attempt < attempts - 1) await sleep(delayMs)
  }

  return null
}

async function loadIdl() {
  if (cachedIdl) return cachedIdl

  const response = await fetch('/idl/arxship.json')
  if (!response.ok) {
    throw new Error('ArxShip IDL not found. Run arcium build, then copy target/idl/arxship.json to public/idl/arxship.json.')
  }

  const idl = await response.json()
  cachedIdl = {
    ...idl,
    address: PROGRAM_ID.toBase58(),
  }
  return cachedIdl
}

function providerFor(wallet) {
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
}

async function programFor(wallet) {
  return new Program(await loadIdl(), providerFor(wallet))
}

async function readonlyProgram() {
  const wallet = {
    publicKey: PublicKey.default,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  }
  return programFor(wallet)
}

export function getGamePda(creator, gameId) {
  const creatorKey = new PublicKey(creator)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('game'), creatorKey.toBuffer(), u64LeBuffer(gameId)],
    PROGRAM_ID
  )[0]
}

function normalizeGame(publicKey, account) {
  const status = parseStatus(account.status)
  const creator = account.creator.toBase58()
  const opponent = account.opponent?.toBase58?.() || PublicKey.default.toBase58()

  return {
    id: publicKey.toBase58(),
    publicKey,
    gameId: account.gameId?.toString?.() || '0',
    callsign: account.callsign,
    creator,
    opponent: opponent === PublicKey.default.toBase58() ? null : opponent,
    status,
    currentTurn: Number(account.currentTurn || 0),
    p1Ready: Boolean(account.p1Ready),
    p2Ready: Boolean(account.p2Ready),
    p1Shots: BigInt(account.p1Shots?.toString?.() || 0),
    p2Shots: BigInt(account.p2Shots?.toString?.() || 0),
    pendingAction: Number(account.pendingAction || 0),
    lastShooter: Number(account.lastShooter || 0),
    lastCell: Number(account.lastCell || 0),
    lastHit: Boolean(account.lastHit),
    winner: Number(account.winner || 0),
    shipsPerPlayer: Number(account.shipsPerPlayer || 3),
    createdAt: Number(account.createdAt?.toString?.() || 0) * 1000,
  }
}

export async function fetchGames() {
  const program = await readonlyProgram()
  const games = await program.account.game.all()
  return games
    .map(({ publicKey, account }) => normalizeGame(publicKey, account))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function createGame(wallet, callsign) {
  const program = await programFor(wallet)
  const gameId = new BN(Date.now())
  const computationOffset = new BN(Date.now() + 17)
  const game = getGamePda(wallet.publicKey, gameId)
  const arcium = publicKeyMap(await getArciumAccounts(computationOffset, 'init_match_state'))
  const signPdaAccount = PublicKey.findProgramAddressSync([Buffer.from('ArciumSignerAccount')], PROGRAM_ID)[0]

  try {
    const signature = await program.methods
      .createGame(gameId, computationOffset, callsign)
      .accountsStrict({
        creator: wallet.publicKey,
        game,
        signPdaAccount,
        mxeAccount: arcium.mxeAccount,
        mempoolAccount: arcium.mempoolAccount,
        executingPool: arcium.executingPool,
        computationAccount: arcium.computationAccount,
        compDefAccount: arcium.compDefAccount,
        clusterAccount: arcium.clusterAccount,
        poolAccount: arcium.poolAccount,
        clockAccount: arcium.clockAccount,
        systemProgram: SystemProgram.programId,
        arciumProgram: arcium.arciumProgram,
      })
      .rpc()

    return { signature, game: game.toBase58(), gameId: gameId.toString() }
  } catch (error) {
    if (isAlreadyProcessedError(error) && (await waitForAccount(game))) {
      console.warn('Create match returned an already-processed error, but the game account exists on-chain. Recovering as success.')
      return {
        signature: 'already-processed',
        recovered: true,
        game: game.toBase58(),
        gameId: gameId.toString(),
      }
    }

    throw error
  }
}

export async function joinGame(wallet, gameAddress) {
  const program = await programFor(wallet)
  return program.methods
    .joinGame()
    .accountsStrict({
      opponent: wallet.publicKey,
      game: new PublicKey(gameAddress),
    })
    .rpc()
}

export async function submitFleet(wallet, gameAddress, encryptedFleet) {
  const program = await programFor(wallet)
  const computationOffset = new BN(Date.now())
  const arcium = publicKeyMap(await getArciumAccounts(computationOffset, 'submit_fleet'))
  const signPdaAccount = PublicKey.findProgramAddressSync([Buffer.from('ArciumSignerAccount')], PROGRAM_ID)[0]

  try {
    const builder = program.methods
      .submitFleet(
        computationOffset,
        Uint8Array.from(encryptedFleet.encryptedFleet),
        Uint8Array.from(encryptedFleet.x25519PublicKey),
        u128FromLeBytes(encryptedFleet.nonce)
      )
      .accountsStrict({
        player: wallet.publicKey,
        game: new PublicKey(gameAddress),
        signPdaAccount,
        mxeAccount: arcium.mxeAccount,
        mempoolAccount: arcium.mempoolAccount,
        executingPool: arcium.executingPool,
        computationAccount: arcium.computationAccount,
        compDefAccount: arcium.compDefAccount,
        clusterAccount: arcium.clusterAccount,
        poolAccount: arcium.poolAccount,
        clockAccount: arcium.clockAccount,
        systemProgram: SystemProgram.programId,
        arciumProgram: arcium.arciumProgram,
      })

    await assertSimulationPasses(builder, 'Encrypt fleet')
    const signature = await builder.rpc()

    return { signature, computationOffset: computationOffset.toString() }
  } catch (error) {
    if (isAlreadyProcessedError(error) && (await waitForAccount(arcium.computationAccount))) {
      console.warn('Submit fleet returned an already-processed error, but the Arcium computation account exists on-chain. Recovering as success.')
      return {
        signature: 'already-processed',
        recovered: true,
        computationOffset: computationOffset.toString(),
      }
    }

    throw error
  }
}

export async function fireShot(wallet, gameAddress, cell) {
  const program = await programFor(wallet)
  const computationOffset = new BN(Date.now())
  const arcium = publicKeyMap(await getArciumAccounts(computationOffset, 'fire_shot'))
  const signPdaAccount = PublicKey.findProgramAddressSync([Buffer.from('ArciumSignerAccount')], PROGRAM_ID)[0]

  try {
    const builder = program.methods
      .fireShot(computationOffset, cell)
      .accountsStrict({
        player: wallet.publicKey,
        game: new PublicKey(gameAddress),
        signPdaAccount,
        mxeAccount: arcium.mxeAccount,
        mempoolAccount: arcium.mempoolAccount,
        executingPool: arcium.executingPool,
        computationAccount: arcium.computationAccount,
        compDefAccount: arcium.compDefAccount,
        clusterAccount: arcium.clusterAccount,
        poolAccount: arcium.poolAccount,
        clockAccount: arcium.clockAccount,
        systemProgram: SystemProgram.programId,
        arciumProgram: arcium.arciumProgram,
      })

    await assertSimulationPasses(builder, 'Fire shot')
    const signature = await builder.rpc()

    return { signature, computationOffset: computationOffset.toString() }
  } catch (error) {
    if (isAlreadyProcessedError(error) && (await waitForAccount(arcium.computationAccount))) {
      console.warn('Fire shot returned an already-processed error, but the Arcium computation account exists on-chain. Recovering as success.')
      return {
        signature: 'already-processed',
        recovered: true,
        computationOffset: computationOffset.toString(),
      }
    }

    throw error
  }
}

export async function waitForGameChange(gameAddress, predicate, attempts = 30, delayMs = 1800) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const games = await fetchGames()
    const game = games.find((item) => item.id === gameAddress)
    if (game && predicate(game)) return game
    if (attempt < attempts - 1) await sleep(delayMs)
  }
  return null
}

export function playerIndexFor(game, walletAddress) {
  if (!game || !walletAddress) return 0
  if (game.creator === walletAddress) return 1
  if (game.opponent === walletAddress) return 2
  return 0
}

export function playerShotMask(game, playerIndex) {
  if (!game) return 0n
  return playerIndex === 1 ? game.p1Shots : game.p2Shots
}

export function hasShot(game, playerIndex, cell) {
  return maskHasCell(playerShotMask(game, playerIndex), cell)
}
