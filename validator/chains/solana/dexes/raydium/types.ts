import { PublicKey } from "@solana/web3.js";

/**
 * Decoded stake record from the Solana program
 */
export interface DecodedStakeRecord {
  nftMint: PublicKey;
  owner: PublicKey;
  poolId: PublicKey;
  personalPositionStatePda: PublicKey;
  stakeTime: bigint;
  hotkey: string;
  stakeRecordPda: PublicKey;
}

/**
 * Summary of stakes grouped by hotkey
 */
export interface HotkeyStakesSummary {
  hotkey: string;
  stakeCount: number;
  stakes: DecodedStakeRecord[];
} 