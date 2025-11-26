import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const UNISWAP_V3_POSITION_MANAGER_ADDRESS = '0x1238536071E1c677A632429e3655c799b22cDA52';
const SEPOLIA_RPC_URL = "https://eth-sepolia.g.alchemy.com/v2/oBo8WP5c2qSMk6IbupL1fc9DwdFFOW9w";
const TOKEN_ID = 202987;

async function getClaimableFees(
    provider: ethers.Provider,
    positionManagerAddress: string,
    tokenId: number
) {
    const positionManager = new ethers.Contract(
        positionManagerAddress,
        [
            {
                name: "collect",
                type: "function",
                inputs: [
                    {
                        name: "params",
                        type: "tuple",
                        components: [
                            { name: "tokenId", type: "uint256" },
                            { name: "recipient", type: "address" },
                            { name: "amount0Max", type: "uint128" },
                            { name: "amount1Max", type: "uint128" },
                        ],
                    },
                ],
                outputs: [
                    { name: "amount0", type: "uint256" },
                    { name: "amount1", type: "uint256" },
                ],
            },
            {
                name: "ownerOf",
                type: "function",
                inputs: [{ name: "tokenId", type: "uint256" }],
                outputs: [{ name: "", type: "address" }],
                stateMutability: "view"
            }
        ],
        provider
    );

    try {
        // First get the owner of the position
        const owner = await positionManager.ownerOf(tokenId);
        console.log(`Position ${tokenId} owner: ${owner}`);

        const [amount0, amount1] = await positionManager.collect.staticCall(
            {
                tokenId: tokenId,
                recipient: owner, // Send to owner
                amount0Max: BigInt("0xffffffffffffffffffffffffffffffff"), // MaxUint128
                amount1Max: BigInt("0xffffffffffffffffffffffffffffffff"), // MaxUint128
            },
            { from: owner } // Simulate call from owner
        );

        return { amount0, amount1 };
    } catch (error) {
        console.error("Error getting claimable fees:", error);
        throw error;
    }
}

async function main() {
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);

    console.log("Fetching fees for Token ID:", TOKEN_ID);

    try {
        const fees = await getClaimableFees(
            provider,
            UNISWAP_V3_POSITION_MANAGER_ADDRESS,
            TOKEN_ID
        );

        console.log("Amount0 fees:", fees.amount0.toString());
        console.log("Amount1 fees:", fees.amount1.toString());
    } catch (error) {
        console.error("Failed to fetch fees:", error);
    }
}

main();