import { PublicKey } from "@solana/web3.js";
import { writeFile } from "node:fs/promises";
import { CONFIG } from "../config/environment";
import { logger } from "../utils/logger";
import { withRetry, createConnection } from "../validator/chains/solana/dexes/raydium/utils/common";

type PoolRow = {
  pool_id: string;
  subnet_id: number;
  admin: string;
  is_active: boolean;
  created_at: string; // raw i64 as string
  pool_record_pda: string;
};

function toCsv(rows: PoolRow[]): string {
  const header = ["pool_id", "subnet_id", "admin", "is_active", "created_at", "pool_record_pda"]; 
  const lines = [header.join(",")];
  for (const r of rows) {
    const vals = [
      r.pool_id,
      String(r.subnet_id),
      r.admin,
      String(r.is_active),
      r.created_at,
      r.pool_record_pda,
    ];
    const escaped = vals.map(v => (v.includes(",") ? `"${v.replace(/"/g, '""')}"` : v));
    lines.push(escaped.join(","));
  }
  return lines.join("\n") + "\n";
}

// Local decode copy to avoid exporting internals
function decodePoolRecord(buf: Buffer) {
  if (buf.length < 8) {
    throw new Error("Buffer too short for pool record");
  }

  let offset = 8; // skip discriminator

  const poolId = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;

  const admin = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;

  const isActive = buf[offset] === 1;
  offset += 1;

  const createdAt = buf.readBigInt64LE(offset);
  offset += 8;

  const subnetId = buf[offset];
  offset += 1;

  return { poolId, admin, isActive, createdAt, subnetId };
}

async function main(): Promise<void> {
  const connection = createConnection();
  const programId = CONFIG.SOLANA.PROGRAM_ID;
  const outPath = process.env.OUT || process.argv.find(a => a.startsWith("--out="))?.split("=")[1] || "./solana_pools.csv";
  const activeOnly = (process.env.ACTIVE_ONLY ?? "true").toLowerCase() !== "false";

  logger.info(`🔍 [Solana] Fetching pool records from program ${programId.toBase58()}`);

  const accounts = await withRetry(
    () => connection.getProgramAccounts(programId),
    CONFIG.PERFORMANCE.MAX_RETRIES,
    'getProgramAccounts for pool records'
  );

  logger.info(`[Solana] 📊 Found ${accounts.length} total program accounts`);

  const rows: PoolRow[] = [];

  for (const { account, pubkey } of accounts) {
    try {
      const decoded = decodePoolRecord(account.data);
      if (activeOnly && !decoded.isActive) continue;
      rows.push({
        pool_id: decoded.poolId.toBase58(),
        subnet_id: decoded.subnetId,
        admin: decoded.admin.toBase58(),
        is_active: decoded.isActive,
        created_at: decoded.createdAt.toString(),
        pool_record_pda: pubkey.toBase58(),
      });
    } catch {
      // not a pool record; skip silently
      continue;
    }
  }

  // Sort for stable output
  rows.sort((a, b) => a.pool_id.localeCompare(b.pool_id));

  const csv = toCsv(rows);
  await writeFile(outPath, csv, { encoding: "utf8" });
  logger.info(`[Solana] ✅ Wrote ${rows.length} pools to ${outPath}`);
}

main().then(() => process.exit(0)).catch(err => {
  logger.error("[Solana] ❌ Failed to export pools:", err);
  process.exit(1);
});


