import { describe, it, before } from 'node:test';
import assert from 'assert';
import fs from 'fs';
import path from 'path';

import { calculatePoolwiseNFTEmissions } from '../validator/calculations/emissions';
import { calculateEmissionsAndRewards, normalizeWeights } from '../validator/calculations/emissions';
import { calculatePoolWeightsWithReservedPools } from '../utils/poolWeights';

type PoolTickData = { tick: number; subnetId: number };

type ExportedItem = {
  miner: string;
  chain: string;
  pool: string;
  tokenId: string | number;
  tickLower: number;
  tickUpper: number;
  liquidity: number;
  currentTick: number;
  inRange: boolean;
  score: number;
  emission: number;
};

describe('Weight calculation edge cases using exported JSON', () => {
  let items: ExportedItem[];
  let currentTickPerPool: Record<string, PoolTickData>;

  before(() => {
    const exportPath = path.join(process.cwd(), 'exports');
    const files = fs.readdirSync(exportPath).filter(f => f.endsWith('.json'));
    assert.ok(files.length > 0, 'No exported positions JSON found in exports/');
    // Use the most recent file
    const latest = files.map(f => ({ f, m: fs.statSync(path.join(exportPath, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0].f;
    const json = JSON.parse(fs.readFileSync(path.join(exportPath, latest), 'utf8'));
    items = json.items as ExportedItem[];
    assert.ok(items.length > 0, 'Exported items should be non-empty');

    // Build currentTickPerPool map from JSON entries
    currentTickPerPool = {};
    const poolToTick = new Map<string, number>();
    for (const it of items) {
      if (!poolToTick.has(it.pool)) poolToTick.set(it.pool, it.currentTick);
    }
    // Use subnetId 0 by default; not used in emissions but required by pool weighting
    poolToTick.forEach((tick, pool) => {
      currentTickPerPool[pool] = { tick, subnetId: 0 };
    });
  });

  it('zeroes scores for out-of-range positions', () => {
    const outOfRange = items.filter(i => i.inRange === false);
    assert.ok(outOfRange.length > 0, 'Expected some out-of-range items in exported data');
    // Verify exported score is 0 for each
    for (const it of outOfRange) {
      assert.strictEqual(it.score, 0, `Out-of-range position must have score 0: ${it.tokenId}`);
      assert.strictEqual(it.emission, 0, `Out-of-range position must have emission 0: ${it.tokenId}`);
    }
  });

  it('emits > 0 for in-range positions with liquidity', () => {
    const inRangeWithLiq = items.find(i => i.inRange && i.liquidity > 0 && i.emission > 0);
    assert.ok(inRangeWithLiq, 'Expected at least one in-range position with positive emission');
  });

  it('pool-wise emissions sum to pool weights per pool', () => {
    // Reconstruct minimal positions list for calculation input
    const positions = items.map(i => ({
      miner: i.miner,
      chain: i.chain,
      pool: i.pool,
      tokenId: i.tokenId,
      tickLower: i.tickLower,
      tickUpper: i.tickUpper,
      liquidity: i.liquidity,
    }));

    // Build pseudo alpha map with equal alpha to avoid 0 allocations
    const subnetIds = [0];
    const alphaPrices: Record<number, number> = { 0: 1 };
    const { poolWeights } = calculatePoolWeightsWithReservedPools(
      positions,
      currentTickPerPool,
      alphaPrices,
      subnetIds,
      0 // no reserved share in this reconstruction
    );

    const nftEmissions = calculatePoolwiseNFTEmissions(positions, currentTickPerPool, poolWeights, 1.0);
    const byPool: Record<string, number> = {};
    for (const n of nftEmissions) {
      byPool[n.pool] = (byPool[n.pool] || 0) + n.emission;
    }
    // Each pool should sum close to its weight (within small epsilon)
    const EPS = 1e-9;
    for (const [pool, w] of Object.entries(poolWeights)) {
      const sum = byPool[pool] || 0;
      assert.ok(Math.abs(sum - w) < 1e-6 + EPS, `Pool ${pool} emissions ${sum} should ~= weight ${w}`);
    }
  });

  it('submission scaling allocates exact burn and sums to 65535', () => {
    // Local copy of scaling helper (do not import or modify production file)
    function scaleMinerWeightsToU16WithBurn(
      uids: number[],
      floatWeights: number[],
      burnUid: number,
      burnPercentage: number
    ): number[] {
      let burnIdx = uids.indexOf(burnUid);
      if (burnIdx === -1) {
        uids.unshift(burnUid);
        floatWeights.unshift(0);
        burnIdx = 0;
      }
      const burnProportion = burnPercentage / 100;
      const minerIndices = uids.map((_, i) => i).filter(i => i !== burnIdx);
      const minersCount = minerIndices.length;
      const minerWeightsSum = minerIndices.reduce((acc, i) => acc + (isFinite(floatWeights[i]) && floatWeights[i] > 0 ? floatWeights[i] : 0), 0);
      const desiredBurnInt = Math.round(burnProportion * 65535);
      const minerTotalInt = 65535 - desiredBurnInt;
      const minerFloatTargets: number[] = minerIndices.map(i => {
        if (minerTotalInt <= 0) return 0;
        if (minerWeightsSum <= 0 || !isFinite(minerWeightsSum)) return minerTotalInt / Math.max(minersCount, 1);
        return (floatWeights[i] / minerWeightsSum) * minerTotalInt;
      });
      const minerFloors = minerFloatTargets.map(v => Math.floor(v));
      const allocatedToMiners = minerFloors.reduce((a, b) => a + b, 0);
      let minerRemainder = minerTotalInt - allocatedToMiners;
      if (minerRemainder > 0) {
        const order = minerFloatTargets
          .map((v, idx) => ({ idx, frac: v - Math.floor(v) }))
          .sort((a, b) => b.frac - a.frac)
          .map(x => x.idx);
        for (let k = 0; k < minerRemainder && k < order.length; k++) {
          minerFloors[order[k]] += 1;
        }
      }
      const scaled: number[] = new Array(uids.length).fill(0);
      scaled[burnIdx] = desiredBurnInt;
      minerIndices.forEach((uidIdx, j) => { scaled[uidIdx] = minerFloors[j]; });
      let totalScaled = scaled.reduce((a, b) => a + b, 0);
      if (totalScaled !== 65535) {
        let delta = 65535 - totalScaled;
        if (delta > 0) {
          if (minersCount > 0) {
            const order2 = minerFloatTargets
              .map((v, idx) => ({ idx, v }))
              .sort((a, b) => b.v - a.v)
              .map(x => x.idx);
            let k = 0;
            while (delta > 0 && minersCount > 0) {
              const mIdx = order2[k % minersCount];
              const uidIdx = minerIndices[mIdx];
              scaled[uidIdx] += 1; delta -= 1; k += 1;
            }
          } else {
            scaled[burnIdx] += delta; delta = 0;
          }
        } else if (delta < 0) {
          let remaining = -delta;
          if (minersCount > 0) {
            const order3 = minerIndices
              .map((uidIdx, j) => ({ j, weight: scaled[uidIdx] }))
              .sort((a, b) => b.weight - a.weight)
              .map(x => x.j);
            let t = 0;
            while (remaining > 0 && minersCount > 0) {
              const j = order3[t % minersCount];
              const uidIdx = minerIndices[j];
              if (scaled[uidIdx] > 0) { scaled[uidIdx] -= 1; remaining -= 1; }
              t += 1; if (t > minersCount * 2 && remaining > 0) break;
            }
          }
          if (remaining > 0) {
            const take = Math.min(remaining, scaled[burnIdx]);
            scaled[burnIdx] -= take; remaining -= take;
          }
        }
      }
      return scaled;
    }
    // Fake per-miner float weights from exported emissions
    const minerWeights: Record<string, number> = {};
    for (const it of items) {
      minerWeights[it.miner] = (minerWeights[it.miner] || 0) + it.emission;
    }
    const entries = Object.entries(minerWeights).filter(([, w]) => isFinite(w) && w > 0);
    const addressToUid: Record<string, number> = {};
    entries.forEach(([hotkey], idx) => { addressToUid[hotkey] = idx + 1; });

    const uids = entries.map(([hotkey]) => addressToUid[hotkey]);
    const floats = entries.map(([, w]) => w);
    const burnUid = 0;
    const burnPct = 50;

    const scaled = scaleMinerWeightsToU16WithBurn([...uids], [...floats], burnUid, burnPct);
    const sum = scaled.reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, 65535, 'Scaled weights must sum to 65535');
    const desiredBurn = Math.round((burnPct / 100) * 65535);
    const burnUnits = scaled.find(v => v === desiredBurn);
    assert.ok(typeof burnUnits === 'number', 'Scaled array must contain exact burn allocation');
  });

  it('scaling handles various burn percentages (0, 15, 23, 50, 100)', () => {
    function scaleMinerWeightsToU16WithBurn(
      uids: number[],
      floatWeights: number[],
      burnUid: number,
      burnPercentage: number
    ): number[] {
      let burnIdx = uids.indexOf(burnUid);
      if (burnIdx === -1) {
        uids.unshift(burnUid);
        floatWeights.unshift(0);
        burnIdx = 0;
      }
      const burnProportion = burnPercentage / 100;
      const minerIndices = uids.map((_, i) => i).filter(i => i !== burnIdx);
      const minersCount = minerIndices.length;
      const minerWeightsSum = minerIndices.reduce((acc, i) => acc + (isFinite(floatWeights[i]) && floatWeights[i] > 0 ? floatWeights[i] : 0), 0);
      const desiredBurnInt = Math.round(burnProportion * 65535);
      const minerTotalInt = 65535 - desiredBurnInt;
      const minerFloatTargets: number[] = minerIndices.map(i => {
        if (minerTotalInt <= 0) return 0;
        if (minerWeightsSum <= 0 || !isFinite(minerWeightsSum)) return minerTotalInt / Math.max(minersCount, 1);
        return (floatWeights[i] / minerWeightsSum) * minerTotalInt;
      });
      const minerFloors = minerFloatTargets.map(v => Math.floor(v));
      const allocatedToMiners = minerFloors.reduce((a, b) => a + b, 0);
      let minerRemainder = minerTotalInt - allocatedToMiners;
      if (minerRemainder > 0) {
        const order = minerFloatTargets
          .map((v, idx) => ({ idx, frac: v - Math.floor(v) }))
          .sort((a, b) => b.frac - a.frac)
          .map(x => x.idx);
        for (let k = 0; k < minerRemainder && k < order.length; k++) {
          minerFloors[order[k]] += 1;
        }
      }
      const scaled: number[] = new Array(uids.length).fill(0);
      scaled[burnIdx] = desiredBurnInt;
      minerIndices.forEach((uidIdx, j) => { scaled[uidIdx] = minerFloors[j]; });
      let totalScaled = scaled.reduce((a, b) => a + b, 0);
      if (totalScaled !== 65535) {
        let delta = 65535 - totalScaled;
        if (delta > 0) {
          if (minersCount > 0) {
            const order2 = minerFloatTargets
              .map((v, idx) => ({ idx, v }))
              .sort((a, b) => b.v - a.v)
              .map(x => x.idx);
            let k = 0;
            while (delta > 0 && minersCount > 0) {
              const mIdx = order2[k % minersCount];
              const uidIdx = minerIndices[mIdx];
              scaled[uidIdx] += 1; delta -= 1; k += 1;
            }
          } else {
            scaled[burnIdx] += delta; delta = 0;
          }
        } else if (delta < 0) {
          let remaining = -delta;
          if (minersCount > 0) {
            const order3 = minerIndices
              .map((uidIdx, j) => ({ j, weight: scaled[uidIdx] }))
              .sort((a, b) => b.weight - a.weight)
              .map(x => x.j);
            let t = 0;
            while (remaining > 0 && minersCount > 0) {
              const j = order3[t % minersCount];
              const uidIdx = minerIndices[j];
              if (scaled[uidIdx] > 0) { scaled[uidIdx] -= 1; remaining -= 1; }
              t += 1; if (t > minersCount * 2 && remaining > 0) break;
            }
          }
          if (remaining > 0) {
            const take = Math.min(remaining, scaled[burnIdx]);
            scaled[burnIdx] -= take; remaining -= take;
          }
        }
      }
      return scaled;
    }

    const entries = Object.entries(items.reduce<Record<string, number>>((acc, it) => {
      acc[it.miner] = (acc[it.miner] || 0) + it.emission; return acc;
    }, {})).filter(([, w]) => isFinite(w) && w > 0);
    const addressToUid: Record<string, number> = {};
    entries.forEach(([hotkey], idx) => { addressToUid[hotkey] = idx + 1; });
    const uids = entries.map(([hotkey]) => addressToUid[hotkey]);
    const floats = entries.map(([, w]) => w);

    [0, 15, 23, 50, 100].forEach(burnPct => {
      const scaled = scaleMinerWeightsToU16WithBurn([...uids], [...floats], 0, burnPct);
      const sum = scaled.reduce((a, b) => a + b, 0);
      assert.strictEqual(sum, 65535, `Sum must be 65535 for burn ${burnPct}`);
      const desiredBurn = Math.round((burnPct / 100) * 65535);
      assert.ok(scaled.includes(desiredBurn), `Scaled must contain desired burn ${desiredBurn} for burn ${burnPct}`);
      if (burnPct === 100) {
        // All to burn, others must be zero
        const others = scaled.filter((_, i) => i !== 0);
        assert.ok(others.every(v => v === 0), 'All miner weights must be 0 at 100% burn');
      }
      if (burnPct === 0) {
        // No burn, burn units should be 0
        assert.ok(scaled[0] === 0, 'Burn UID should be 0 when burnPct=0');
      }
    });
  });

  it('uniform fallback is needed when everyone is out-of-range (simulated)', () => {
    // Simulate all out-of-range by shifting ticks far outside ranges
    const shiftedTicks: Record<string, PoolTickData> = {};
    for (const [pool, data] of Object.entries(currentTickPerPool)) {
      shiftedTicks[pool] = { tick: data.tick + 10_000_000, subnetId: data.subnetId };
    }

    const positions = items.map(i => ({
      miner: i.miner,
      chain: i.chain,
      pool: i.pool,
      tokenId: i.tokenId,
      tickLower: i.tickLower,
      tickUpper: i.tickUpper,
      liquidity: i.liquidity,
    }));

    const subnetIds = [0];
    const alphaPrices: Record<number, number> = { 0: 1 };
    const { poolWeights } = calculatePoolWeightsWithReservedPools(
      positions,
      shiftedTicks,
      alphaPrices,
      subnetIds,
      0
    );
    const nftEmissions = calculatePoolwiseNFTEmissions(positions, shiftedTicks, poolWeights, 1.0);
    const positive = nftEmissions.some(n => n.emission > 0);
    assert.strictEqual(positive, false, 'All emissions should be 0 when every position is out-of-range');
  });

  it('boundary ticks at lower/upper edges are counted in-range', () => {
    const pool = 'synthetic:boundary';
    const tick = 100;
    const ticks: Record<string, PoolTickData> = { [pool]: { tick, subnetId: 0 } };
    const positions = [
      { miner: 'm1', chain: 'solana', pool, tokenId: 'a', tickLower: 100, tickUpper: 110, liquidity: 1000 }, // lower edge
      { miner: 'm2', chain: 'solana', pool, tokenId: 'b', tickLower: 90,  tickUpper: 100, liquidity: 1000 }, // upper edge
      { miner: 'm3', chain: 'solana', pool, tokenId: 'c', tickLower: 101, tickUpper: 110, liquidity: 1000 }, // out of range
      { miner: 'm4', chain: 'solana', pool, tokenId: 'd', tickLower: 90,  tickUpper: 99,  liquidity: 1000 }, // out of range
    ];
    const poolWeights = { [pool]: 1 } as Record<string, number>;
    const out = calculatePoolwiseNFTEmissions(positions as any, ticks, poolWeights, 1.0);
    const byId = Object.fromEntries(out.map(x => [x.tokenId, x]));
    assert.ok((byId['a']?.emission || 0) > 0, 'lower-edge should emit');
    assert.ok((byId['b']?.emission || 0) > 0, 'upper-edge should emit');
    assert.strictEqual(byId['c']?.emission || 0, 0, 'above range should emit 0');
    assert.strictEqual(byId['d']?.emission || 0, 0, 'below range should emit 0');
  });

  it('liquidity=0 yields zero emission even if in-range', () => {
    const pool = 'synthetic:zero-liq';
    const tick = 1000;
    const ticks: Record<string, PoolTickData> = { [pool]: { tick, subnetId: 0 } };
    const positions = [
      { miner: 'm1', chain: 'solana', pool, tokenId: 'z', tickLower: 900, tickUpper: 1100, liquidity: 0 },
    ];
    const poolWeights = { [pool]: 1 } as Record<string, number>;
    const out = calculatePoolwiseNFTEmissions(positions as any, ticks, poolWeights, 1.0);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].emission, 0);
    assert.strictEqual(out[0].score, 0);
  });

  it('missing tick data makes positions out-of-range (zero emission)', () => {
    const pool = 'synthetic:missing-tick';
    const ticks: Record<string, PoolTickData> = {}; // no tick for pool
    const positions = [
      { miner: 'm1', chain: 'solana', pool, tokenId: 'x', tickLower: 1, tickUpper: 2, liquidity: 100 },
    ];
    const poolWeights = { [pool]: 1 } as Record<string, number>;
    const out = calculatePoolwiseNFTEmissions(positions as any, ticks, poolWeights, 1.0);
    // When tick missing, emissions function falls back to 0 currentTick; this is out-of-range, so zero
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].emission, 0);
    assert.strictEqual(out[0].score, 0);
  });

  it('pool weight distribution with reserved subnet 0 and alpha-weighted others', () => {
    const ticks: Record<string, PoolTickData> = {
      'p0a': { tick: 0, subnetId: 0 },
      'p0b': { tick: 0, subnetId: 0 },
      'p1a': { tick: 0, subnetId: 1 },
      'p1b': { tick: 0, subnetId: 1 },
      'p1c': { tick: 0, subnetId: 1 },
      'p2a': { tick: 0, subnetId: 2 },
    };
    const positions = Object.keys(ticks).map(pool => ({
      miner: 'm', chain: 'solana', pool, tokenId: pool, tickLower: -10, tickUpper: 10, liquidity: 1,
    }));
    const alphas = { 0: 0, 1: 2, 2: 1 } as Record<number, number>;
    const { poolWeights } = calculatePoolWeightsWithReservedPools(positions as any, ticks, alphas, [0,1,2], 0.25);
    const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < 1e-6 + eps;
    // Subnet 0: 0.25 split equally across 2 pools => 0.125 each
    assert.ok(near(poolWeights['p0a'], 0.125));
    assert.ok(near(poolWeights['p0b'], 0.125));
    // Remaining 0.75 split: subnet1 gets 0.5 across 3 => ~0.1666667 each
    assert.ok(near(poolWeights['p1a'], 0.5 / 3));
    assert.ok(near(poolWeights['p1b'], 0.5 / 3));
    assert.ok(near(poolWeights['p1c'], 0.5 / 3));
    // Subnet2 gets 0.25 across 1 => 0.25
    assert.ok(near(poolWeights['p2a'], 0.25));
  });

  it('no subnet-0 pools -> reserved share is zero; weights only on non-zero subnets', () => {
    const ticks: Record<string, PoolTickData> = {
      'p1a': { tick: 0, subnetId: 1 },
      'p1b': { tick: 0, subnetId: 1 },
      'p2a': { tick: 0, subnetId: 2 },
    };
    const positions = Object.keys(ticks).map(pool => ({ miner: 'm', chain: 'solana', pool, tokenId: pool, tickLower: -1, tickUpper: 1, liquidity: 1 }));
    const alphas = { 1: 2, 2: 1 } as Record<number, number>;
    const { poolWeights } = calculatePoolWeightsWithReservedPools(positions as any, ticks, alphas, [1,2], 0.25);
    const sumZeroSubnet = Object.entries(poolWeights).filter(([p]) => p.startsWith('p0')).reduce((a,[,v])=>a+v,0);
    assert.strictEqual(sumZeroSubnet, 0);
    const total = Object.values(poolWeights).reduce((a,b)=>a+b,0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });

  it('reserved share is clipped to [0,1] when subnet-0 pools exist', () => {
    const ticks: Record<string, PoolTickData> = {
      'z0': { tick: 0, subnetId: 0 },
      'n1': { tick: 0, subnetId: 1 },
    };
    const positions = Object.keys(ticks).map(pool => ({ miner: 'm', chain: 'solana', pool, tokenId: pool, tickLower: -1, tickUpper: 1, liquidity: 1 }));
    const alphas = { 0: 0, 1: 1 } as Record<number, number>;
    // Negative reserved share => treated as 0
    let r = calculatePoolWeightsWithReservedPools(positions as any, ticks, alphas, [0,1], -0.5).poolWeights;
    const totalNeg = Object.values(r).reduce((a,b)=>a+b,0);
    assert.ok(Math.abs(totalNeg - 1) < 1e-9);
    // >1 reserved share => treated as 1 so non-zero pools get 0
    r = calculatePoolWeightsWithReservedPools(positions as any, ticks, alphas, [0,1], 1.5).poolWeights;
    const nzSum = Object.entries(r).filter(([p]) => p === 'n1').reduce((a,[,v])=>a+v,0);
    assert.strictEqual(nzSum, 0);
  });

  it('when alpha for non-zero subnets is all zero, remaining share splits equally among non-zero pools', () => {
    const ticks: Record<string, PoolTickData> = {
      'p0a': { tick: 0, subnetId: 0 },
      'p1a': { tick: 0, subnetId: 1 },
      'p1b': { tick: 0, subnetId: 1 },
      'p2a': { tick: 0, subnetId: 2 },
    };
    const positions = Object.keys(ticks).map(pool => ({
      miner: 'm', chain: 'solana', pool, tokenId: pool, tickLower: -10, tickUpper: 10, liquidity: 1,
    }));
    const alphas = { 0: 0, 1: 0, 2: 0 } as Record<number, number>;
    const { poolWeights } = calculatePoolWeightsWithReservedPools(positions as any, ticks, alphas, [0,1,2], 0.25);
    const nonZeroPools = ['p1a', 'p1b', 'p2a'];
    const remaining = 0.75; // after reserving 0.25 for subnet 0
    const per = remaining / nonZeroPools.length;
    nonZeroPools.forEach(p => assert.ok(Math.abs(poolWeights[p] - per) < 1e-6));
  });

  it('normalizeWeights rounds with largest remainder and sums to 1.0', () => {
    const input = { a: 0.33334, b: 0.33333, c: 0.33333 };
    const out = normalizeWeights(input);
    const sum = Object.values(out).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9);
    // Ensure values are multiples of 1e-4
    Object.values(out).forEach(v => {
      const x = Math.round(v * 10000);
      assert.strictEqual(v, x / 10000);
    });
  });

  it('aggregate per-miner emissions sums NFT emissions correctly', () => {
    const pool = 'synthetic:agg';
    const ticks: Record<string, PoolTickData> = { [pool]: { tick: 0, subnetId: 0 } };
    const positions = [
      { miner: 'm1', chain: 'solana', pool, tokenId: 't1', tickLower: -1, tickUpper: 1, liquidity: 100 },
      { miner: 'm1', chain: 'solana', pool, tokenId: 't2', tickLower: -1, tickUpper: 1, liquidity: 100 },
      { miner: 'm2', chain: 'solana', pool, tokenId: 't3', tickLower: -1, tickUpper: 1, liquidity: 200 },
    ];
    const nft = calculatePoolwiseNFTEmissions(positions as any, ticks, { [pool]: 1 }, 1.0);
    const miners = calculateEmissionsAndRewards(positions as any, ticks, 1.0);
    const expectedM1 = nft.filter(x => x.miner === 'm1').reduce((a, b) => a + b.emission, 0);
    const expectedM2 = nft.filter(x => x.miner === 'm2').reduce((a, b) => a + b.emission, 0);
    assert.ok(Math.abs((miners['m1'] || 0) - expectedM1) < 1e-12);
    assert.ok(Math.abs((miners['m2'] || 0) - expectedM2) < 1e-12);
  });

  it('cross-zero ranges behave normally (negative to positive ticks)', () => {
    const pool = 'synthetic:cross-zero';
    const ticks: Record<string, PoolTickData> = { [pool]: { tick: -5, subnetId: 0 } };
    const positions = [
      { miner: 'm1', chain: 'solana', pool, tokenId: 'tN', tickLower: -10, tickUpper: 0, liquidity: 1000 },
      { miner: 'm2', chain: 'solana', pool, tokenId: 'tP', tickLower: 0, tickUpper: 10, liquidity: 1000 },
    ];
    const out = calculatePoolwiseNFTEmissions(positions as any, ticks, { [pool]: 1 }, 1.0);
    const byId = Object.fromEntries(out.map(x => [x.tokenId, x.emission]));
    assert.ok((byId['tN'] || 0) > 0, 'negative-side range should emit');
    assert.strictEqual(byId['tP'] || 0, 0, 'positive-side range (not containing -5) should not emit');
  });

  it('score increases with liquidity (all else equal)', () => {
    const pool = 'synthetic:liq';
    const ticks: Record<string, PoolTickData> = { [pool]: { tick: 500, subnetId: 0 } };
    const positions = [
      { miner: 'm1', chain: 'solana', pool, tokenId: 'low',  tickLower: 400, tickUpper: 600, liquidity: 100 },
      { miner: 'm2', chain: 'solana', pool, tokenId: 'high', tickLower: 400, tickUpper: 600, liquidity: 1000 },
    ];
    const out = calculatePoolwiseNFTEmissions(positions as any, ticks, { [pool]: 1 }, 1.0);
    const byId = Object.fromEntries(out.map(x => [x.tokenId, x.score]));
    assert.ok(byId['high'] > byId['low']);
  });

  it('narrower ranges score higher when centered equally', () => {
    const pool = 'synthetic:width';
    const ticks: Record<string, PoolTickData> = { [pool]: { tick: 1000, subnetId: 0 } };
    const positions = [
      { miner: 'm1', chain: 'solana', pool, tokenId: 'wide',   tickLower: 800,  tickUpper: 1200, liquidity: 1000 },
      { miner: 'm2', chain: 'solana', pool, tokenId: 'narrow', tickLower: 990,  tickUpper: 1010, liquidity: 1000 },
    ];
    const out = calculatePoolwiseNFTEmissions(positions as any, ticks, { [pool]: 1 }, 1.0);
    const byId = Object.fromEntries(out.map(x => [x.tokenId, x.score]));
    assert.ok(byId['narrow'] > byId['wide']);
  });
});


