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

Comp definition offsets:

```txt
init_match_state: 1200228507
submit_fleet:    2742476098
fire_shot:       1177767981
```

Initialized computation definitions:

```txt
init_match_state: qAnQPCXoYATaKLgv53sM9a7SG1PvfoFrUV42epQfQ4AvbHeDNEiLtpJS8ivEs8vnFF4mNPchPVJmT5BY1u3XK3x
submit_fleet:    4n4ojV9uBpsdkMZQfCKcA1p4R74xp6MDbfjSyChism75rLyKtcjNeg5VyoZqzTUkSgxmVTPyBoCo2YkPZCYeJ7cq
fire_shot:       122dBMvRGd4E9eeAxgvF6SKtMLpmJpt7eCLTvKh1hNW1HGFAywUnDLPByEvLf8iydTABBLBxmxc1p54HmsUKAADh
```

## Repo Layout

```txt
programs/arxship/       Anchor Solana program
encrypted-ixs/          Arcis encrypted instructions
api/                    Node API for MXE pubkey, encryption, and Arcium account derivation
src/                    Vite React frontend
public/idl/arxship.json Generated Anchor IDL used by the frontend
build/*.arcis           Generated circuit files to upload for offchain comp defs
scripts/                Comp-def initialization helpers
```

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

## Notes

The frontend currently uses a black and white 8-bit command interface inspired by 8bitcn/shadcn patterns. The generated 8bitcn registry command had a JavaScript parser issue in this starter, so the UI components are local shadcn-style components under `src/components/ui/8bit`, with the official generated `Progress` component retained and normalized into the same design system.
