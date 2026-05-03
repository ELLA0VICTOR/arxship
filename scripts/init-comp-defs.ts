import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  getArciumProgram,
  getArciumProgramId,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getLookupTableAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";

function toU32LE(bytes: Uint8Array): number {
  return ((bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0);
}

async function run(): Promise<void> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Arxship as anchor.Program;
  const arciumProgram = getArciumProgram(provider);
  const arciumProgramId = getArciumProgramId();

  const mxeAccount = getMXEAccAddress(program.programId);
  const mxe = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutOffset = new BN((mxe as { lutOffsetSlot: BN }).lutOffsetSlot.toString());
  const addressLookupTable = getLookupTableAddress(program.programId, lutOffset);

  const jobs: Array<{ circuit: string; method: string }> = [
    { circuit: "init_match_state", method: "initMatchStateCompDef" },
    { circuit: "submit_fleet", method: "initSubmitFleetCompDef" },
    { circuit: "fire_shot", method: "initFireShotCompDef" },
  ];

  console.log(`Program ID: ${program.programId.toBase58()}`);
  console.log(`MXE Account: ${mxeAccount.toBase58()}`);
  console.log(`Address LUT: ${addressLookupTable.toBase58()}`);

  for (const job of jobs) {
    const compDefOffset = toU32LE(getCompDefAccOffset(job.circuit));
    const compDefAccount = getCompDefAccAddress(program.programId, compDefOffset);

    try {
      const sig = await (program.methods as Record<string, () => any>)[job.method]()
        .accountsStrict({
          payer: provider.wallet.publicKey,
          mxeAccount,
          compDefAccount,
          addressLookupTable,
          lutProgram: anchor.web3.AddressLookupTableProgram.programId,
          arciumProgram: arciumProgramId,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log(`[ok] ${job.circuit}: ${sig}`);
    } catch (err) {
      const msg = String(err);
      if (
        msg.includes("already in use") ||
        msg.includes("AccountAlreadyInitialized") ||
        msg.includes("custom program error: 0x0")
      ) {
        console.log(`[skip] ${job.circuit}: already initialized`);
        continue;
      }

      console.error(`[fail] ${job.circuit}`);
      throw err;
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
