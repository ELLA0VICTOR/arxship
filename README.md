# ArxShip

ArxShip is a private onchain fleet battle built on Solana with Arcium encrypted compute.

Two players join a 5x5 naval grid, privately submit three hidden ship positions, then take turns firing public shots. Arcium computes whether each shot is a hit or miss without revealing either player's fleet layout. Only rule-required information becomes public: the shot coordinate, hit/miss result, turn state, and winner.

## Why Arcium Matters

Normal onchain games struggle with hidden information. If ship positions are stored plainly, the game is broken before the first turn. ArxShip keeps fleet masks encrypted inside Arcium MXE state:

- Player fleets are encrypted with x25519 + Rescue before submission.
- The Solana program stores only ciphertext and public game state.
- Arcium privately computes fleet placement validity and shot resolution.
- The chain receives only safe public outputs: accepted fleet, hit/miss, and winner.

## Current Program

```txt
Program ID: 8LCtkMQAaFKDJ7aVRWaiuKdxgTZ5qEA5psdggvvdbvtS
Cluster offset: 456
MXE Account: 5wMALDajH3CMNNsygiqNsVM96Y6hukmS1SsJ4acW8b2X
Address LUT: 4FuNLXWgjKV7TWdJYLV33ZiZugeezhHmkwzWNyG3W7Nu
IDL Account: JwYZZKLTesq3orcfQJX2zVrJEx3MjSKXmKQNpTVS785
```

## Project Repo Structure

```txt
arxship/
|- programs/arxship/        Anchor Solana program for match state and game rules
|- encrypted-ixs/           Arcis circuits for private fleet setup and shot checks
|- api/                     Express API for MXE pubkeys, encryption, and account helpers
|- src/                     Vite React frontend
|  |- components/           Reusable UI components
|  |- lib/                  Shared utility helpers
|  |- utils/                Solana and Arcium client helpers
|  `- App.jsx              Main game interface
|- public/                  Static frontend assets
|  `- idl/arxship.json     Anchor IDL consumed by the frontend
|- scripts/                 Computation definition setup and inspection scripts
|- artifacts/               Local deployment/reference artifacts
|- Anchor.toml              Anchor workspace configuration
|- Arcium.toml              Arcium circuit and deployment configuration
|- Cargo.toml               Rust workspace configuration
|- package.json             Frontend scripts and dependencies
|- .env.example             Frontend environment template
`- README.md
```

Generated folders such as `target/`, `build/`, `dist/`, `dist-scripts/`, and `node_modules/` are intentionally ignored and can be recreated locally.

## Local Setup

Install frontend dependencies:

```bash
npm install
```

Install API dependencies:

```bash
npm --prefix api install
```

Create env files:

```bash
cp .env.example .env
cp api/.env.example api/.env
```

## Build

Frontend:

```bash
npm run build
```

Arcium + Anchor:

```bash
arcium build
```

After a successful build, copy the generated IDL:

```bash
cp target/idl/arxship.json public/idl/arxship.json
```

## Run Locally

Terminal 1:

```bash
npm run api:dev
```

Terminal 2:

```bash
npm run dev
```

## Devnet Deployment Flow

1. Build the program and circuits:

```bash
arcium build
```

2. Upload these circuit files to Supabase or GitHub releases:

```txt
build/init_match_state.arcis
build/submit_fleet.arcis
build/fire_shot.arcis
```

3. Update the offchain circuit URLs in:

```txt
programs/arxship/src/lib.rs
```

4. Rebuild after URL changes:

```bash
arcium build
```

5. Deploy and initialize MXE:

```bash
RPC_URL="https://api.devnet.solana.com"

arcium deploy \
  -k ~/.config/solana/id.json \
  -o 456 \
  -r 4 \
  -p target/deploy/arxship-keypair.json \
  -n arxship \
  -u "$RPC_URL"
```

6. Initialize computation definitions:

```bash
export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"

npm run init:comp-defs
```

7. Verify MXE:

```bash
solana program show 8LCtkMQAaFKDJ7aVRWaiuKdxgTZ5qEA5psdggvvdbvtS -u devnet
arcium mxe-info 8LCtkMQAaFKDJ7aVRWaiuKdxgTZ5qEA5psdggvvdbvtS -u devnet
```

## Game Rules

- Board size is 5x5.
- Each player hides exactly 3 single-cell ships.
- Players alternate turns.
- Shot coordinates are public.
- Hit/miss is revealed by Arcium.
- Hidden fleets remain private even after the game ends.

## Interface

The frontend uses a black and white command interface with compact panels, clear turn state, and wallet-first actions. Shared UI components live under `src/components/ui/8bit` so game screens stay consistent across desktop and mobile.
