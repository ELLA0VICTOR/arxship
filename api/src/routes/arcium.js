import express from "express";
import anchor from "@coral-xyz/anchor";
import { randomBytes } from "node:crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  RescueCipher,
  getArciumProgram,
  getArciumProgramId,
  getClockAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
  x25519,
} from "@arcium-hq/client";

const router = express.Router();
const { AnchorProvider, BN, Wallet } = anchor;

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "8LCtkMQAaFKDJ7aVRWaiuKdxgTZ5qEA5psdggvvdbvtS");
const CLUSTER_OFFSET = Number(process.env.CLUSTER_OFFSET || 456);
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const CIRCUITS = new Set(["init_match_state", "submit_fleet", "fire_shot"]);

function toU32LE(bytes) {
  return ((bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0);
}

function compDefOffset(circuitName) {
  if (!CIRCUITS.has(circuitName)) {
    throw new Error(`Unknown circuit name: ${circuitName}`);
  }
  return toU32LE(getCompDefAccOffset(circuitName));
}

function buildProvider() {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(Keypair.generate());
  return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

function extractMxeX25519Pubkey(mxe) {
  const utility = mxe?.utilityPubkeys ?? mxe?.utility_pubkeys;
  const variant = utility?.set ?? utility?.unset ?? utility;
  const keyRecord = variant?.[0] ?? variant?.["0"] ?? variant;
  const x25519Pubkey = keyRecord?.x25519Pubkey ?? keyRecord?.x25519_pubkey;
  if (!x25519Pubkey) {
    throw new Error("MXE utility pubkeys not initialized yet");
  }
  return x25519Pubkey;
}

function randomNonce16() {
  return new Uint8Array(randomBytes(16));
}

function countFleetCells(mask) {
  let count = 0;
  for (let i = 0; i < 25; i += 1) {
    if ((mask & (1n << BigInt(i))) !== 0n) {
      count += 1;
    }
  }
  return count;
}

router.get("/accounts", async (req, res) => {
  try {
    const computationOffsetRaw = req.query.computationOffset;
    const circuitName = String(req.query.circuitName || "");

    if (!computationOffsetRaw) {
      return res.status(400).json({ success: false, error: "Missing computationOffset" });
    }

    const computationOffsetString = String(computationOffsetRaw);
    if (!/^\d+$/.test(computationOffsetString)) {
      return res.status(400).json({ success: false, error: "Invalid computationOffset" });
    }

    const offset = compDefOffset(circuitName);
    const computationOffset = new BN(computationOffsetString);

    res.json({
      success: true,
      accounts: {
        arciumProgram: getArciumProgramId().toBase58(),
        mxeAccount: getMXEAccAddress(PROGRAM_ID).toBase58(),
        mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET).toBase58(),
        executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET).toBase58(),
        clusterAccount: getClusterAccAddress(CLUSTER_OFFSET).toBase58(),
        compDefAccount: getCompDefAccAddress(PROGRAM_ID, offset).toBase58(),
        computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset).toBase58(),
        poolAccount: getFeePoolAccAddress().toBase58(),
        clockAccount: getClockAccAddress().toBase58(),
        clusterOffset: CLUSTER_OFFSET,
        compDefOffset: offset,
        programId: PROGRAM_ID.toBase58(),
      },
    });
  } catch (error) {
    console.error("Failed to derive Arcium accounts:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/mxe-pubkey", async (_req, res) => {
  try {
    const provider = buildProvider();
    const arciumProgram = getArciumProgram(provider);
    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    const mxe = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const publicKey = extractMxeX25519Pubkey(mxe);

    res.json({
      success: true,
      publicKey: Array.from(publicKey),
      programId: PROGRAM_ID.toBase58(),
      clusterOffset: CLUSTER_OFFSET,
      mxeAccount: mxeAccount.toBase58(),
    });
  } catch (error) {
    console.error("Failed to fetch MXE public key:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      hint: "Deploy and initialize the MXE before encrypting fleets.",
    });
  }
});

router.post("/encrypt-fleet", async (req, res) => {
  try {
    const rawFleetMask = req.body?.fleetMask;
    const fleetMask = BigInt(rawFleetMask ?? -1);

    if (fleetMask < 0n || fleetMask >= (1n << 25n)) {
      return res.status(400).json({ success: false, error: "Fleet mask must fit the 5x5 board" });
    }

    if (countFleetCells(fleetMask) !== 3) {
      return res.status(400).json({
        success: false,
        error: "Fleet must contain exactly 3 hidden ships",
      });
    }

    const provider = buildProvider();
    const arciumProgram = getArciumProgram(provider);
    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    const mxe = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const mxePublicKey = new Uint8Array(extractMxeX25519Pubkey(mxe));

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const nonce = randomNonce16();
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);
    const ciphertext = cipher.encrypt([fleetMask], nonce);

    res.json({
      success: true,
      encrypted: {
        encryptedFleet: ciphertext[0],
        x25519PublicKey: Array.from(publicKey),
        nonce: Array.from(nonce),
        metadata: {
          algorithm: "x25519-Rescue",
          sdk: "@arcium-hq/client",
          programId: PROGRAM_ID.toBase58(),
          clusterOffset: CLUSTER_OFFSET,
          mxeAccount: mxeAccount.toBase58(),
        },
      },
    });
  } catch (error) {
    console.error("Failed to encrypt fleet:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
