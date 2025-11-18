/**
 * syncSeaportOrders.js — ApeChain On-Chain Seaport Sync (FINAL CHUNKED VERSION)
 */

import { ethers } from "ethers";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

/* -----------------------------------------------------------
   ENV CHECK
----------------------------------------------------------- */

const BACKEND_URL = process.env.BACKEND_URL;
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const SEAPORT_CONTRACT_ADDRESS = process.env.SEAPORT_CONTRACT_ADDRESS;
const FROM_BLOCK = process.env.FROM_BLOCK ? parseInt(process.env.FROM_BLOCK) : 0;

if (!BACKEND_URL || !NFT_CONTRACT_ADDRESS || !SEAPORT_CONTRACT_ADDRESS) {
  console.error("❌ Missing env variables (BACKEND_URL, NFT_CONTRACT_ADDRESS, SEAPORT_CONTRACT_ADDRESS)");
  process.exit(1);
}

/* -----------------------------------------------------------
   MULTI-RPC FAILOVER
----------------------------------------------------------- */

const RPC_LIST = [
  process.env.APECHAIN_RPC,
  "https://rpc.apechain.com/http",
  "https://apechain.drpc.org",
  "https://33139.rpc.thirdweb.com",
];

let provider = null;

async function initProvider() {
  console.log("🔌 RPC provider test başlanır...");

  for (const rpc of RPC_LIST) {
    if (!rpc) continue;
    try {
      const p = new ethers.providers.JsonRpcProvider(rpc);
      await p.getBlockNumber();
      console.log("✅ RPC işləyir:", rpc);
      provider = p;
      break;
    } catch (e) {
      console.warn("❌ RPC alınmadı:", rpc, "-", e.message);
    }
  }

  if (!provider) {
    console.error("💀 Heç bir RPC işləmədi!");
    process.exit(1);
  }
}

/* -----------------------------------------------------------
   SEAPORT ABI-lər
----------------------------------------------------------- */

const seaportABI = [
  "event OrderFulfilled(bytes32 indexed orderHash,address indexed offerer,address indexed fulfiller,bytes orderDetails)",
  "event OrderCancelled(bytes32 indexed orderHash,address indexed offerer)"
];

const altABI = [
  "event OrderFulfilled(bytes32 indexed orderHash,address indexed offerer,address indexed fulfiller,address recipient,address paymentToken,uint256 amount,uint256[] tokenIds)",
  "event OrderCancelled(bytes32 indexed orderHash,address indexed offerer)"
];

let seaportContractPrimary;
let seaportContractAlt;

/* -----------------------------------------------------------
   BACKEND POST
----------------------------------------------------------- */

async function postOrderEvent(payload) {
  try {
    const res = await fetch(`${BACKEND_URL}/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.log("❌ Backend rejected:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.log("❌ Backend error:", e.message);
    return false;
  }
}

/* -----------------------------------------------------------
   CHUNKED QUERY SYSTEM (DRPC limit fix)
----------------------------------------------------------- */

const CHUNK = 5000;   // DRPC limit: max 10k → biz 5000 götürürük

async function queryInChunks(callback, from, to) {
  let start = from;

  while (start <= to) {
    const end = Math.min(start + CHUNK, to);

    console.log(`🔍 Chunk scan: ${start} → ${end}`);

    try {
      await callback(start, end);
    } catch (e) {
      console.log("⚠️ Chunk error:", e.message);
    }

    start = end + 1;
  }
}

/* -----------------------------------------------------------
   MAIN
----------------------------------------------------------- */

async function main() {
  console.log("🚀 On-chain Seaport Sync başladı...\n");

  await initProvider();
  console.log("🔗 İstifadə olunan RPC:", provider.connection.url);

  seaportContractPrimary = new ethers.Contract(SEAPORT_CONTRACT_ADDRESS, seaportABI, provider);
  seaportContractAlt     = new ethers.Contract(SEAPORT_CONTRACT_ADDRESS, altABI, provider);

  const latestBlock = await provider.getBlockNumber();
  console.log(`🔎 Blok aralığı: ${FROM_BLOCK} → ${latestBlock}\n`);

  /* -----------------------------------------------------------
     PRIMARY ABI — OrderFulfilled
  ----------------------------------------------------------- */

  await queryInChunks(async (start, end) => {
    const filter = seaportContractPrimary.filters.OrderFulfilled();
    const events = await seaportContractPrimary.queryFilter(filter, start, end);

    for (const ev of events) {
      const args = ev.args || {};

      const payload = {
        tokenId: null,
        price: null,
        sellerAddress: args.offerer?.toLowerCase() || null,
        buyerAddress: args.fulfiller?.toLowerCase() || null,
        seaportOrder: { orderHash: args.orderHash },
        orderHash: args.orderHash,
        image: null,
        nftContract: NFT_CONTRACT_ADDRESS,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS,
        status: "fulfilled",
        onChainBlock: ev.blockNumber
      };

      const sent = await postOrderEvent(payload);
      console.log(sent ? `✅ Primary Fulfilled: ${args.orderHash}` : `❌ Fail: ${args.orderHash}`);
    }
  }, FROM_BLOCK, latestBlock);

  /* -----------------------------------------------------------
     ALT ABI — OrderFulfilled
  ----------------------------------------------------------- */

  await queryInChunks(async (start, end) => {
    const filter = seaportContractAlt.filters.OrderFulfilled();
    const events = await seaportContractAlt.queryFilter(filter, start, end);

    for (const ev of events) {
      const args = ev.args || {};

      const payload = {
        tokenId: args.tokenIds ? args.tokenIds[0]?.toString() : null,
        price: args.amount ? ethers.utils.formatEther(args.amount) : null,
        sellerAddress: args.offerer?.toLowerCase() || null,
        buyerAddress: args.fulfiller?.toLowerCase() || null,
        seaportOrder: { orderHash: args.orderHash },
        orderHash: args.orderHash,
        image: null,
        nftContract: NFT_CONTRACT_ADDRESS,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS,
        status: "fulfilled",
        onChainBlock: ev.blockNumber
      };

      const sent = await postOrderEvent(payload);
      console.log(sent ? `✅ Alt Fulfilled: ${args.orderHash}` : `❌ Fail: ${args.orderHash}`);
    }
  }, FROM_BLOCK, latestBlock);

  /* -----------------------------------------------------------
     Cancelled Events
  ----------------------------------------------------------- */

  await queryInChunks(async (start, end) => {
    const filter = seaportContractPrimary.filters.OrderCancelled();
    const events = await seaportContractPrimary.queryFilter(filter, start, end);

    for (const ev of events) {
      const args = ev.args || {};

      const payload = {
        tokenId: null,
        price: null,
        sellerAddress: args.offerer?.toLowerCase() || null,
        seaportOrder: { orderHash: args.orderHash },
        orderHash: args.orderHash,
        nftContract: NFT_CONTRACT_ADDRESS,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS,
        status: "cancelled",
        onChainBlock: ev.blockNumber
      };

      const sent = await postOrderEvent(payload);
      console.log(sent ? `🗑 Cancelled: ${args.orderHash}` : `❌ Fail: ${args.orderHash}`);
    }
  }, FROM_BLOCK, latestBlock);

  console.log("\n🎉 On-chain Seaport Sync tamamlandı!");
}

/* -----------------------------------------------------------
   RUN
----------------------------------------------------------- */

main().catch(err => {
  console.error("💀 Fatal:", err);
  process.exit(1);
});
