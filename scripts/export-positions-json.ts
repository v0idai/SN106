import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/environment';
import { getHotkeyToUidMap, getSubnetAlphaPrices } from '../utils/bittensor';
import { getAllNFTPositions, getCurrentTickPerPool } from '../validator/chains';
import { calculatePoolWeightsWithReservedPools } from '../utils/poolWeights';
import { calculatePoolwiseNFTEmissions } from '../validator/calculations/emissions';
import { subtensorClient } from '../validator/api';

async function main() {
  // Simple CLI args parsing
  const args = process.argv.slice(2);
  let minerFilter: string | null = null;
  let outPathArg: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--miner' && i + 1 < args.length) {
      minerFilter = args[i + 1];
      i++;
    } else if (a === '--out' && i + 1 < args.length) {
      outPathArg = args[i + 1];
      i++;
    }
  }

  const wsUrl = CONFIG.SUBTENSOR.WS_URL;
  const netuid = CONFIG.SUBTENSOR.NETUID;

  await subtensorClient.initialize(wsUrl);

  // Resolve hotkeys to fetch
  const [hotkeyToUid] = await getHotkeyToUidMap(wsUrl, netuid);
  const allHotkeys = Object.keys(hotkeyToUid || {});
  const targetHotkeys = minerFilter ? [minerFilter] : allHotkeys;

  if (targetHotkeys.length === 0) {
    console.error('No hotkeys found on-chain to fetch positions for.');
    process.exit(1);
  }

  // Gather NFT positions and tick data
  const positions = await getAllNFTPositions(targetHotkeys);
  const currentTickPerPool = await getCurrentTickPerPool();

  // Compute pool weights to enable per-NFT emissions (score, emission)
  const filteredSubnetIds = [...new Set(Object.values(currentTickPerPool).map(p => p.subnetId))];
  const [subnetAlphaPrices] = await getSubnetAlphaPrices(wsUrl, filteredSubnetIds);
  const { poolWeights } = calculatePoolWeightsWithReservedPools(
    positions,
    currentTickPerPool,
    subnetAlphaPrices,
    filteredSubnetIds,
    0.25
  );

  const nftEmissions = calculatePoolwiseNFTEmissions(positions, currentTickPerPool, poolWeights, 1.0);

  // Build export items
  const items = nftEmissions.map(nft => {
    const tick = currentTickPerPool[nft.pool]?.tick;
    const currentTick = typeof tick === 'number' ? tick : NaN;
    const inRange = Number.isFinite(currentTick) && nft.tickLower <= currentTick && currentTick <= nft.tickUpper;
    return {
      miner: nft.miner,
      chain: nft.chain,
      pool: nft.pool,
      tokenId: nft.tokenId,
      tickLower: nft.tickLower,
      tickUpper: nft.tickUpper,
      liquidity: nft.liquidity,
      currentTick,
      inRange,
      score: nft.score,
      emission: nft.emission,
    };
  });

  const output = {
    timestamp: new Date().toISOString(),
    count: items.length,
    minerFilter: minerFilter || 'ALL',
    items,
  };

  // Determine output path
  const outDir = outPathArg ? path.dirname(outPathArg) : path.join(process.cwd(), 'exports');
  const baseName = outPathArg ? path.basename(outPathArg) : `nft_positions_${Date.now()}.json`;
  const outPath = path.join(outDir, baseName);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`Exported ${items.length} NFT positions to: ${outPath}`);
}

main().catch(err => {
  console.error('Error exporting NFT positions:', err);
  process.exit(1);
});


