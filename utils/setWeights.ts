import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { CONFIG } from '../config/environment';
import { subtensorClient } from '../validator/api';
import fs from 'fs';
import path from 'path';

export async function setWeightsOnSubtensor(
  wsUrl: string,
  hotkeyMnemonic: string,
  netuid: number,
  weights: Record<string, number>,
  addressToUid: Record<string, number>
): Promise<void> {
  try {
    // Initialize the singleton client if needed
    await subtensorClient.initialize(wsUrl);
    const api = subtensorClient.getAPI();
    
    const keyring = new Keyring({ type: 'sr25519' });
    const hotkey = keyring.addFromUri(hotkeyMnemonic);

    // Map addresses to UIDs; filter unknown addresses
    const entries = Object.entries(weights).filter(([addr]) => addressToUid[addr] !== undefined);
    let uids = entries.map(([addr]) => addressToUid[addr]);
    let floatWeights = entries.map(([_, w]) => (isFinite(w) && w > 0 ? w : 0));

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
    } else {
      // Normalize to sum 1.0 prior to scaling
      floatWeights = floatWeights.map(w => (w > 0 && isFinite(w) ? w / sumFloat : 0));
    }

    // Scale to u16 (0..65535) and ensure sum == 65535
    let scaled = floatWeights.map(w => Math.round(w * 65535));
    const totalScaled = scaled.reduce((a, b) => a + b, 0);
    if (totalScaled === 0) {
      throw new Error('All scaled weights are zero.');
    }
    if (totalScaled !== 65535) {
      scaled = scaled.map(w => Math.round((w * 65535) / totalScaled));
    }

    // Get current block number as version key
    const header = await api.rpc.chain.getHeader();
    const versionKey = header.number.toNumber();

    console.log('Setting weights on network...');
    console.log('UIDs:', uids);
    console.log('Scaled weights:', scaled);
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