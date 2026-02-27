import { Connection, PublicKey } from "@solana/web3.js";

// ---- Utility bigint helpers ----

function readBigUInt128LE(buf: Buffer, offset = 0): bigint {
    const lo = buf.readBigUInt64LE(offset);
    const hi = buf.readBigUInt64LE(offset + 8);
    return (hi << BigInt(64)) | lo;
}

function readPubkey(buf: Buffer, offset: number) {
    return new PublicKey(buf.slice(offset, offset + 32));
}

// ---- PDA Calculators ----

function getPositionPDA(nftMint: PublicKey) {
    // Change Raydium CLMM program ID if mainnet
    const PROGRAM_ID = new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
    return PublicKey.findProgramAddressSync([Buffer.from("position"), nftMint.toBuffer()], PROGRAM_ID)[0];
}

const TICK_ARRAY_SIZE = 60;

function getTickArrayStartIndex(tickIndex: number, tickSpacing: number) {
    const ticksInArray = TICK_ARRAY_SIZE * tickSpacing;
    let start = Math.floor(tickIndex / ticksInArray);
    if (tickIndex < 0 && tickIndex % ticksInArray !== 0) {
        start -= 1;
    }
    return start * ticksInArray;
}

function getTickArrayPDA(pool: PublicKey, startTickIndex: number) {
    const PROGRAM_ID = new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(startTickIndex, 0); // Raydium uses BE for tick array start index seeds
    return PublicKey.findProgramAddressSync([Buffer.from("tick_array"), pool.toBuffer(), buf], PROGRAM_ID)[0];
}

// ---- Decode accounts ----

function decodePool(buf: Buffer) {
    let o = 0;
    o += 8; // disc
    o += 1 + 32 + 32 // bump + ammconfig + owner
    const tokenMint0 = readPubkey(buf, o); o += 32;
    const tokenMint1 = readPubkey(buf, o); o += 32;
    o += 32 + 32 + 32 // vault0 + vault1 + obskey
    const decimals0 = buf.readUInt8(o); o += 1;
    const decimals1 = buf.readUInt8(o); o += 1;
    const tickSpacing = buf.readUInt16LE(o); o += 2;
    o += 16 + 16;
    const tickCurrent = buf.readInt32LE(o); o += 4;
    o += 2 + 2;
    const feeGrowthGlobal0 = readBigUInt128LE(buf, o); o += 16;
    const feeGrowthGlobal1 = readBigUInt128LE(buf, o); o += 16;
    return { tokenMint0, tokenMint1, decimals0, decimals1, tickCurrent, tickSpacing, feeGrowthGlobal0, feeGrowthGlobal1 };
}

function decodeTick(buf: Buffer, offset: number) {
    let o = offset;
    // TickState layout:
    // tick: i32 (4)
    // liquidityNet: i128 (16)
    // liquidityGross: u128 (16)
    // feeGrowthOutside0: u128 (16)
    // feeGrowthOutside1: u128 (16)
    // rewardGrowthsOutside: u128[3] (16 * 3 = 48)
    // padding: u32[13] (4 * 13 = 52)
    // Total TickState size: 4 + 16 + 16 + 16 + 16 + 48 + 52 = 168 bytes

    const tick = buf.readInt32LE(o); o += 4;
    const liquidityNet = readBigUInt128LE(buf, o); o += 16;
    const liquidityGross = readBigUInt128LE(buf, o); o += 16;
    const feeGrowthOutside0 = readBigUInt128LE(buf, o); o += 16;
    const feeGrowthOutside1 = readBigUInt128LE(buf, o); o += 16;

    return { tick, liquidityNet, liquidityGross, feeGrowthOutside0, feeGrowthOutside1 };
}

function decodeTickArray(buf: Buffer) {
    let o = 8; // discriminator
    const poolId = readPubkey(buf, o); o += 32;
    const startTickIndex = buf.readInt32LE(o); o += 4;

    // ticks: [TickState; 60]
    const ticks: any[] = [];
    const TICK_STATE_SIZE = 168; // Calculated above

    for (let i = 0; i < TICK_ARRAY_SIZE; i++) {
        ticks.push(decodeTick(buf, o));
        o += TICK_STATE_SIZE;
    }

    return { poolId, startTickIndex, ticks };
}

function decodePersonalPosition(buf: Buffer) {
    let o = 8 + 1; // disc + bump
    o += 32; // nftmint
    const poolId = readPubkey(buf, o); o += 32;
    const tickLower = buf.readInt32LE(o); o += 4;
    const tickUpper = buf.readInt32LE(o); o += 4;
    const liquidity = readBigUInt128LE(buf, o); o += 16;
    const feeGrowthInside0Last = readBigUInt128LE(buf, o); o += 16;
    const feeGrowthInside1Last = readBigUInt128LE(buf, o); o += 16;
    const tokenFeesOwed0 = buf.readBigUInt64LE(o); o += 8;
    const tokenFeesOwed1 = buf.readBigUInt64LE(o); o += 8;
    return { poolId, tickLower, tickUpper, liquidity, feeGrowthInside0Last, feeGrowthInside1Last, tokenFeesOwed0, tokenFeesOwed1 };
}

// ---- Core fee math ----

function feeGrowthInside(
    feeGrowthGlobal: bigint,
    tickLower: any,
    tickUpper: any,
    tickCurrent: number,
    feeGrowthOutsideKey: keyof typeof tickLower
) {
    // clone names for clarity
    const feeGrowthOutsideLower = tickLower[feeGrowthOutsideKey]; // u128
    const feeGrowthOutsideUpper = tickUpper[feeGrowthOutsideKey]; // u128

    let feeBelow: bigint;
    if (tickCurrent >= tickLower.tick) {
        feeBelow = feeGrowthOutsideLower;
    } else {
        feeBelow = feeGrowthGlobal - feeGrowthOutsideLower;
    }

    let feeAbove: bigint;
    if (tickCurrent < tickUpper.tick) {
        feeAbove = feeGrowthOutsideUpper;
    } else {
        feeAbove = feeGrowthGlobal - feeGrowthOutsideUpper;
    }

    return feeGrowthGlobal - feeBelow - feeAbove;
}

// ---- Main script ----

async function main() {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const nftMint = new PublicKey("DpdSdSBX8jriyyMG5raFtyqKygwne16HbHGpGWEjmW3M");

    // Fetch accounts
    const posPDA = getPositionPDA(nftMint);
    const posAcc = await connection.getAccountInfo(posPDA);
    if (!posAcc) throw new Error("Position not found");

    const pos = decodePersonalPosition(posAcc.data);
    const poolAcc = await connection.getAccountInfo(pos.poolId);
    if (!poolAcc) throw new Error("Pool not found");

    const pool = decodePool(poolAcc.data);

    const tickLowerStartIndex = getTickArrayStartIndex(pos.tickLower, pool.tickSpacing);
    const tickUpperStartIndex = getTickArrayStartIndex(pos.tickUpper, pool.tickSpacing);

    const tickLowerArrayPDA = getTickArrayPDA(pos.poolId, tickLowerStartIndex);
    const tickUpperArrayPDA = getTickArrayPDA(pos.poolId, tickUpperStartIndex);

    const [tickLowerArrayAcc, tickUpperArrayAcc] = await Promise.all([
        connection.getAccountInfo(tickLowerArrayPDA),
        connection.getAccountInfo(tickUpperArrayPDA),
    ]);

    if (!tickLowerArrayAcc || !tickUpperArrayAcc) throw new Error("Tick array accounts not found");

    const tickLowerArray = decodeTickArray(tickLowerArrayAcc.data);
    const tickUpperArray = decodeTickArray(tickUpperArrayAcc.data);

    // Find the specific ticks in the arrays
    const tickLower = tickLowerArray.ticks.find(t => t.tick === pos.tickLower);
    const tickUpper = tickUpperArray.ticks.find(t => t.tick === pos.tickUpper);

    if (!tickLower || !tickUpper) throw new Error("Specific ticks not found in arrays");

    // Calculate fee growth inside
    const feeGrowthInside0 = feeGrowthInside(pool.feeGrowthGlobal0, tickLower, tickUpper, pool.tickCurrent, "feeGrowthOutside0");
    const feeGrowthInside1 = feeGrowthInside(pool.feeGrowthGlobal1, tickLower, tickUpper, pool.tickCurrent, "feeGrowthOutside1");

    // Compute pending fees
    const Q64 = BigInt(2) ** BigInt(64);
    const pendingFees0 = Number(pos.tokenFeesOwed0 + (pos.liquidity * (feeGrowthInside0 - pos.feeGrowthInside0Last)) / Q64) / Math.pow(10, pool.decimals0);
    const pendingFees1 = Number(pos.tokenFeesOwed1 + (pos.liquidity * (feeGrowthInside1 - pos.feeGrowthInside1Last)) / Q64) / Math.pow(10, pool.decimals1);

    // Output
    console.log(`== Raydium CLMM fees for NFT position ==`);
    console.log(`Pool: ${pos.poolId.toBase58()}`);
    console.log(`Tick range: [${pos.tickLower}, ${pos.tickUpper}], Current: ${pool.tickCurrent}`);
    console.log(`Token0 (${pool.tokenMint0.toBase58()}): ${pendingFees0}`);
    console.log(`Token1 (${pool.tokenMint1.toBase58()}): ${pendingFees1}`);
}

main().catch(e => { console.error(e); process.exit(1); });
