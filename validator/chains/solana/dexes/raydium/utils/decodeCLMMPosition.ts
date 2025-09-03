import { PublicKey } from "@solana/web3.js";

// ===== Helper: Decode CLMM Position Data =====
export function decodeCLMMPosition(buf: Buffer) {
  if (buf.length < 177) {
    throw new Error(`Buffer too short. Expected at least 177 bytes, got ${buf.length}`);
  }

  function readBigUInt128LE(b: Buffer) {
    if (b.length !== 16) throw new Error("Expected 16 bytes for u128");
    const lo = b.readBigUInt64LE(0);
    const hi = b.readBigUInt64LE(8);
    return (hi << BigInt(64) | lo).toString();
  }

  return {
    bump: buf.readUInt8(8),
    nft_mint: new PublicKey(buf.slice(9, 41)),
    pool_id: new PublicKey(buf.slice(41, 73)),
    tick_lower_index: buf.readInt32LE(73),
    tick_upper_index: buf.readInt32LE(77),
    liquidity: readBigUInt128LE(buf.slice(81, 97)),
    // ... other fields omitted for brevity
  };
}
