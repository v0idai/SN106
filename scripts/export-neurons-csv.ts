import { subtensorClient } from "../validator/api";
import { CONFIG } from "../config/environment";
import { logger } from "../utils/logger";
import fs from "fs-extra";

type ColdkeyToHotkeys = Record<string, string[]>;

// Small sleep helper for backoff
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function getTotalUids(netuid: number): Promise<number> {
  const api = subtensorClient.getAPI();
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const totalBn: any = await api.query.subtensorModule.subnetworkN(netuid);
  const total = (totalBn as any).toNumber?.() ?? Number(totalBn);
  return Number.isFinite(total) ? total : 0;
}

async function getHotkeyForUid(netuid: number, uid: number): Promise<string | null> {
  const api = subtensorClient.getAPI();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const acc: any = await api.query.subtensorModule.keys(netuid, uid);
      const hotkey = acc?.toString?.() ?? String(acc);
      return hotkey || null;
    } catch (error) {
      if (attempt < 2) await sleep(250 * (attempt + 1));
      else throw error;
    }
  }
  return null;
}

async function getColdkeyForHotkey(hotkey: string): Promise<string | null> {
  const api = subtensorClient.getAPI();

  const tryFns: Array<() => Promise<any>> = [
    // Common storage naming across pallet versions
    () => (api.query as any).subtensorModule.owners?.(hotkey),
    () => (api.query as any).subtensorModule.owner?.(hotkey),
    () => (api.query as any).subtensorModule.hotkeyOwner?.(hotkey),
    () => (api.query as any).subtensorModule.hotkeyOwners?.(hotkey),
  ].filter(Boolean) as Array<() => Promise<any>>;

  for (const fn of tryFns) {
    try {
      const res: any = await fn();
      if (!res) continue;

      // Handle Option<AccountId> types
      if (typeof res.isSome === "boolean") {
        if (res.isSome) {
          const unwrapped = res.unwrap?.() ?? res;
          const v = unwrapped?.toString?.() ?? String(unwrapped);
          if (v && v !== "None" && v !== "") return v;
        }
        continue;
      }

      const v = res?.toString?.() ?? String(res);
      if (v && v !== "None" && v !== "") return v;
    } catch {
      // Try next possible storage name
      continue;
    }
  }
  return null;
}

function toCsv(rows: Array<{ coldkey: string; hotkeys: string[] }>): string {
  const header = ["coldkey", "hotkeys"]; // hotkeys as JSON array string
  const lines = [header.join(",")];
  for (const row of rows) {
    const hotkeysJson = JSON.stringify(row.hotkeys);
    const escapedCold = row.coldkey.includes(",") ? `"${row.coldkey.replace(/"/g, '""')}"` : row.coldkey;
    const escapedHotkeys = hotkeysJson.includes(",") ? `"${hotkeysJson.replace(/"/g, '""')}"` : hotkeysJson;
    lines.push(`${escapedCold},${escapedHotkeys}`);
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const wsUrl = process.env.SUBTENSOR_WS_URL || CONFIG.SUBTENSOR.WS_URL;
  const netuid = Number(process.env.NETUID ?? CONFIG.SUBTENSOR.NETUID);
  const outPath = process.env.OUT || process.argv.find(a => a.startsWith("--out="))?.split("=")[1] || "./neurons.csv";

  logger.info(`Connecting to Subtensor at ${wsUrl}`);
  await subtensorClient.initialize(wsUrl);

  logger.info(`Fetching subnet size for netuid=${netuid}`);
  const total = await getTotalUids(netuid);
  logger.info(`Total UIDs in subnet ${netuid}: ${total}`);

  const BATCH = 12;
  const hotkeys: string[] = [];
  for (let start = 0; start < total; start += BATCH) {
    const end = Math.min(start + BATCH, total);
    const tasks: Promise<void>[] = [];
    for (let uid = start; uid < end; uid++) {
      tasks.push(
        (async () => {
          const hk = await getHotkeyForUid(netuid, uid);
          if (hk) hotkeys.push(hk);
        })()
      );
    }
    await Promise.all(tasks);
  }

  logger.info(`Fetched ${hotkeys.length} hotkeys. Resolving owners (coldkeys)...`);
  const coldToHot: Map<string, Set<string>> = new Map();

  // Resolve coldkeys in batches
  const OWNER_BATCH = 24;
  for (let start = 0; start < hotkeys.length; start += OWNER_BATCH) {
    const end = Math.min(start + OWNER_BATCH, hotkeys.length);
    const slice = hotkeys.slice(start, end);
    const tasks = slice.map(hk => getColdkeyForHotkey(hk).then(cold => ({ hk, cold })));
    const results = await Promise.all(tasks);
    for (const { hk, cold } of results) {
      if (!cold) continue;
      let set = coldToHot.get(cold);
      if (!set) {
        set = new Set();
        coldToHot.set(cold, set);
      }
      set.add(hk);
    }
  }

  const rows: Array<{ coldkey: string; hotkeys: string[] }> = [];
  for (const [cold, set] of coldToHot) {
    rows.push({ coldkey: cold, hotkeys: Array.from(set).sort() });
  }
  rows.sort((a, b) => a.coldkey.localeCompare(b.coldkey));

  const csv = toCsv(rows);
  await fs.writeFile(outPath, csv, { encoding: "utf8" });
  logger.info(`Wrote CSV with ${rows.length} coldkeys to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error("Failed to export neurons to CSV:", err);
    process.exit(1);
  });


