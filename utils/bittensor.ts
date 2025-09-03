import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { CONFIG } from '../config/environment';
import { subtensorClient } from '../validator/api';

// Helper function for exponential backoff delay
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const MAX_RETRIES = CONFIG.PERFORMANCE.MAX_RETRIES;
const INITIAL_RETRY_DELAY = CONFIG.PERFORMANCE.INITIAL_RETRY_DELAY_MS;
const MAX_RETRY_DELAY = CONFIG.PERFORMANCE.MAX_RETRY_DELAY_MS;
const BATCH = CONFIG.PERFORMANCE.HOTKEY_BATCH_SIZE;

// Helper function to fetch a single UID's hotkey with retry logic
const fetchSingleHotkey = async (api: ApiPromise, netuid: number, uid: number): Promise<[string | null, string | null]> => {
    let lastError: any = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const acc: any = await api.query.subtensorModule.keys(netuid, uid);
            return [acc.toString(), null];
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
                await sleep(delay);
            }
        }
    }
    return [null, `Failed to fetch hotkey for UID ${uid} after ${MAX_RETRIES + 1} attempts: ${lastError?.message || 'Unknown error'}`];
};

export async function getHotkeyToUidMap(
  wsUrl: string,
  netuid: number
): Promise<[Record<string, number>, string | null]> {
  try {
    // Initialize the singleton client if needed
    await subtensorClient.initialize(wsUrl);
    const api = subtensorClient.getAPI();
    
    console.log('Fetching hotkey-to-UID map from chain...');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const totalBn = await api.query.subtensorModule.subnetworkN(netuid);
    const total = (totalBn as any).toNumber?.() ?? Number(totalBn);
    if (total === 0) {
      return [{}, null];
    }
    const hotkeyToUid: Record<string, number> = {};
    const failedUIDs: number[] = [];
    for (let start = 0; start < total; start += BATCH) {
      const batchEnd = Math.min(start + BATCH, total);
      const tasks: Promise<void>[] = [];
      for (let uid = start; uid < batchEnd; uid++) {
        tasks.push(
          (async () => {
            const [hotkey, error] = await fetchSingleHotkey(api, netuid, uid);
            if (hotkey) {
              hotkeyToUid[hotkey] = uid;
            } else {
              failedUIDs.push(uid);
              console.error(`Failed to fetch hotkey for UID ${uid}:`, error);
            }
          })()
        );
      }
      await Promise.all(tasks);
    }
    
    if (failedUIDs.length > 0) {
      return [hotkeyToUid, `${failedUIDs.length} UIDs failed to fetch`];
    }
    return [hotkeyToUid, null];
  } catch (error: any) {
    return [{}, `Failed to fetch hotkey/uid map: ${error.message}`];
  }
}

export async function getSubnetAlphaPrices(
  wsUrl: string,
  filterNetuids?: number[]
): Promise<[Record<number, number>, string | null]> {
  try {
    // Initialize the singleton client if needed
    await subtensorClient.initialize(wsUrl);
    const api = subtensorClient.getAPI();
    
    // Call runtime API to get all subnet dynamic info
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const allInfo: any = await api.call.subnetInfoRuntimeApi.getAllDynamicInfo();

    // Convert to JSON to safely traverse
    const json = allInfo?.toJSON?.() ?? allInfo;
    if (!Array.isArray(json)) {
      return [{}, 'Unexpected response format from getAllDynamicInfo'];
    }

    const allowSet = filterNetuids && filterNetuids.length ? new Set(filterNetuids) : null;
    const result: Record<number, number> = {};

    for (const item of json as any[]) {
      // Expect fields: netuid, taoIn, alphaIn
      const netuid = Number(item?.netuid);
      if (!Number.isFinite(netuid)) continue;
      if (allowSet && !allowSet.has(netuid)) continue;

      // Parse big numeric fields robustly
      const taoInRaw = item?.taoIn;
      const alphaInRaw = item?.alphaIn;

      let taoIn = 0n;
      let alphaIn = 0n;
      try { taoIn = BigInt(typeof taoInRaw === 'string' ? taoInRaw.replace(/,/g, '') : taoInRaw ?? 0); } catch {}
      try { alphaIn = BigInt(typeof alphaInRaw === 'string' ? alphaInRaw.replace(/,/g, '') : alphaInRaw ?? 0); } catch {}

      if (alphaIn === 0n) {
        // Avoid division by zero; set price 0
        result[netuid] = 0;
        continue;
      }

      // Compute floating price as taoIn / alphaIn with maximum precision
      // Scale by 1e18 to preserve precision, then divide
      const SCALE = 1e18;
      const scaledTaoIn = taoIn * BigInt(SCALE);
      const price = Number(scaledTaoIn / alphaIn) / SCALE;
      if (Number.isFinite(price)) {
        console.log("netuid: price", netuid, price);
        result[netuid] = price;
      } else {
        result[netuid] = 0;
      }
    }

    return [result, null];
  } catch (error: any) {
    return [{}, `Failed to fetch subnet alpha prices: ${error?.message || String(error)}`];
  }
}
