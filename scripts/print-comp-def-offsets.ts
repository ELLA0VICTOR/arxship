import { getCompDefAccOffset } from "@arcium-hq/client";

function toU32LE(bytes: Uint8Array): number {
  return ((bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0);
}

for (const circuit of ["init_match_state", "submit_fleet", "fire_shot"]) {
  console.log(`${circuit}: ${toU32LE(getCompDefAccOffset(circuit))}`);
}
