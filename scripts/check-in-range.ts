import { getAllNFTPositions, getCurrentTickPerPool } from '../validator/chains';
import { CONFIG } from '../config/environment';

async function main() {
  const miner = process.argv[2];
  if (!miner) {
    console.error('Usage: npx tsx scripts/check-in-range.ts <miner_hotkey>');
    process.exit(1);
  }

  // Ensure Solana is enabled by CONFIG (returns only 'solana' currently)
  const positions = await getAllNFTPositions([miner]);
  const currentTickPerPool = await getCurrentTickPerPool();

  const minePositions = positions.filter(p => p.miner === miner);
  if (minePositions.length === 0) {
    console.log(`No positions found for miner ${miner}`);
    return;
  }

  const results = minePositions.map(p => {
    const tickData = currentTickPerPool[p.pool];
    const currentTick = tickData?.tick ?? NaN;
    const inRange = Number.isFinite(currentTick) && p.tickLower <= currentTick && currentTick <= p.tickUpper;
    return {
      miner: p.miner,
      chain: p.chain,
      pool: p.pool,
      tokenId: p.tokenId,
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      liquidity: p.liquidity,
      currentTick,
      inRange,
    };
  });

  const allInRange = results.every(r => r.inRange);
  console.log(JSON.stringify({ allInRange, count: results.length, items: results }, null, 2));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});


