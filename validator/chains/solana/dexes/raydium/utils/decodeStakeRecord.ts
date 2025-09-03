import { PublicKey } from "@solana/web3.js";

// ===== Helper: Decode StakeRecord Account Data =====
export function decodeStakeRecord(buf: Buffer) {
  if (buf.length < 8) {
    throw new Error("Buffer too short for stake record");
  }

  // Anchor discriminator: 8 bytes
  let offset = 8;
  
  // nft_mint: Pubkey (32 bytes)
  const nftMint = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // owner: Pubkey (32 bytes)
  const owner = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // pool_id: Pubkey (32 bytes)
  const poolId = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // personal_position_state_pda: Pubkey (32 bytes)
  const personalPositionStatePda = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // stake_time: i64 (8 bytes)
  const stakeTime = buf.readBigInt64LE(offset);
  offset += 8;
  
  // hotkey: String (4 bytes length + string data)
  const hotkeyLen = buf.readUInt32LE(offset);
  offset += 4;
  const hotkey = buf.slice(offset, offset + hotkeyLen).toString("utf-8");

  return {
    nftMint,
    owner,
    poolId,
    personalPositionStatePda,
    stakeTime,
    hotkey
  };
}
