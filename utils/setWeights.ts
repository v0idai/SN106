import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { CONFIG } from '../config/environment';
import { subtensorClient } from '../validator/api';
import fs from 'fs';
import path from 'path';

export async function setWeightsOnSubtensor(
  wsUrl: string,
  hotkeyUri: string,
  netuid: number,
  weights: Record<string, number>,
  addressToUid: Record<string, number>
): Promise<void> {
  try {
    // Initialize the singleton client if needed
    await subtensorClient.initialize(wsUrl);
    const api = subtensorClient.getAPI();
    
    const keyring = new Keyring({ type: 'sr25519' });
    const hotkey = keyring.addFromUri(hotkeyUri);

    // Map addresses to UIDs; filter unknown addresses
    const entries = Object.entries(weights).filter(([addr]) => addressToUid[addr] !== undefined);
    let uids = entries.map(([addr]) => addressToUid[addr]);
    let floatWeights = entries.map(([_, w]) => (isFinite(w) && w > 0 ? w : 0));
    const burnPercentage = 50;

    // Burn mechanism: we will apply this after establishing base miner weights

    // Handle empty weights: fallback to uniform
    if (uids.length === 0) {
      // Fallback: use all UIDs in addressToUid
      uids = Object.values(addressToUid);
      if (uids.length === 0) {
        throw new Error('No UIDs available for weight submission.');
      }
      const uniform = 1 / uids.length;
      floatWeights = Array(uids.length).fill(uniform);
      console.warn(`No miner weights found, using uniform weight ${uniform} for all ${uids.length} UIDs.`);
    }

    // If all float weights zero/invalid, use uniform over selected UIDs 
    const sumFloat = floatWeights.reduce((a, b) => a + b, 0);
    if (!sumFloat || sumFloat <= 0 || !isFinite(sumFloat)) {
      const uniform = 1 / uids.length;
      floatWeights = Array(uids.length).fill(uniform);
    }
    // Note: With burn mechanism active, weights should already sum to 1.0 (burn + miners)

    // Scale to u16 (0..65535) with exact burn to UID 0 and largest-remainder to miners
    const burnUid = 0;
    let burnIdx = uids.indexOf(burnUid);
    if (burnIdx === -1) {
      // Ensure burn UID exists (user notes it always does, this is defensive)
      uids.unshift(burnUid);
      floatWeights.unshift(0);
      burnIdx = 0;
    }

    const burnProportion = burnPercentage / 100;
    const minerProportion = 1 - burnProportion;

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
    let allocatedToMiners = minerFloors.reduce((a, b) => a + b, 0);
    let minerRemainder = minerTotalInt - allocatedToMiners; // >= 0

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
    minerIndices.forEach((uidIdx, j) => {
      scaled[uidIdx] = minerFloors[j];
    });

    let totalScaled = scaled.reduce((a, b) => a + b, 0);
    if (totalScaled !== 65535) {
      let delta = 65535 - totalScaled; // positive => need to add, negative => need to remove
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
            scaled[uidIdx] += 1;
            delta -= 1;
            k += 1;
          }
        } else {
          scaled[burnIdx] += delta;
          delta = 0;
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
            if (scaled[uidIdx] > 0) {
              scaled[uidIdx] -= 1;
              remaining -= 1;
            }
            t += 1;
            if (t > minersCount * 2 && remaining > 0) break;
          }
        }
        if (remaining > 0) {
          const take = Math.min(remaining, scaled[burnIdx]);
          scaled[burnIdx] -= take;
          remaining -= take;
        }
      }
      totalScaled = scaled.reduce((a, b) => a + b, 0);
    }

    // Get current block number as version key
    const header = await api.rpc.chain.getHeader();
    const versionKey = header.number.toNumber();

    console.log('Setting weights on network...');
    console.log('UIDs:', uids);
    console.log('Scaled weights:', scaled);
    console.log('Scaled weights sum:', scaled.reduce((a, b) => a + b, 0), 'count:', scaled.length);
    const burnUnits = scaled[uids.indexOf(0)];
    if (burnUnits !== undefined) {
      console.log(`Burn UID 0 units: ${burnUnits} (~${((burnUnits / 65535) * 100).toFixed(4)}%), target: ${burnPercentage}%`);
    }
    console.log('Version key:', versionKey);

    // Submit extrinsic
    const tx = api.tx.subtensorModule.setWeights(netuid, uids, scaled, versionKey);
    const hash = await tx.signAndSend(hotkey);
    console.log('Weights set with tx hash:', hash.toHex());
    
    // Save weight details to JSON file after successful transaction
    await saveWeightDetails(uids, scaled, hash.toHex(), versionKey);
    
  } catch (err) {
    console.error('Error submitting weights:', err);
    throw err;
  }
}

/**
 * Save weight details to JSON file after successful transaction
 */
async function saveWeightDetails(
  uids: number[],
  weights: number[],
  txHash: string,
  versionKey: number
): Promise<void> {
  try {
    // Create weights directory if it doesn't exist
    const weightsDir = path.join(process.cwd(), 'weights');
    if (!fs.existsSync(weightsDir)) {
      fs.mkdirSync(weightsDir, { recursive: true });
    }

    // Create weight details object in UID: WEIGHT format
    const weightDetails: Record<string, number> = {};
    for (let i = 0; i < uids.length; i++) {
      weightDetails[uids[i].toString()] = weights[i];
    }

    // Create the complete record
    const weightRecord = {
      timestamp: new Date().toISOString(),
      txHash: txHash,
      versionKey: versionKey,
      weights: weightDetails
    };

    // Use a single filename for all weight records
    const filename = 'weights_history.json';
    const filepath = path.join(weightsDir, filename);

    // Read existing data or initialize empty array
    let existingData: any[] = [];
    if (fs.existsSync(filepath)) {
      try {
        const fileContent = fs.readFileSync(filepath, 'utf8');
        existingData = JSON.parse(fileContent);
        if (!Array.isArray(existingData)) {
          existingData = [];
        }
      } catch (parseError) {
        console.warn('Error parsing existing weights file, starting fresh:', parseError);
        existingData = [];
      }
    }

    // Append new record
    existingData.push(weightRecord);

    // Write updated data back to file
    fs.writeFileSync(filepath, JSON.stringify(existingData, null, 2));
    console.log(`Weight details appended to: ${filepath}`);
    console.log(`Total weight records: ${existingData.length}`);

  } catch (error) {
    console.error('Error saving weight details:', error);
    // Don't throw error - this shouldn't fail the weight submission
  }
}