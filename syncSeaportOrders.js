/**
 * syncSeaportOrders.js — ApeChain On-Chain Seaport Sync
 *
 * Notes:
 * - Make sure APECHAIN_RPC and FROM_BLOCK are set in .env
 * - This script queries OrderFulfilled and OrderCancelled events and posts simplified payloads to BACKEND_URL /order
 */

import { ethers } from "ethers";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL;
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const SEAPORT_CONTRACT_ADDRESS = process.env.SEAPORT_CONTRACT_ADDRESS;
const APECHAIN_RPC = process.env.APECHAIN_RPC || "https://rpc.apechain.com";

if (!BACKEND_URL || !NFT_CONTRACT_ADDRESS || !SEAPORT_CONTRACT_ADDRESS) {
  console.error("❌ Missing environment variables (BACKEND_URL, NFT_CONTRACT_ADDRESS, SEAPORT_CONTRACT_ADDRESS)");
  process.exit(1);
}

const provider = new ethers.providers.JsonRpcProvider(APECHAIN_RPC);

// Minimal ABI for OrderFulfilled and OrderCancelled — adapt if your Seaport deploy uses different types
const seaportABI = [
  "event OrderFulfilled(bytes32 indexed orderHash,address indexed offerer,address indexed fulfiller,bytes orderDetails)",
  "event OrderCancelled(bytes32 indexed orderHash,address indexed offerer)"
];

// Fallback ABI attempt: some Seaport builds include a richer OrderFulfilled signature
const altABI = [
  "event OrderFulfilled(bytes32 indexed orderHash,address indexed offerer,address indexed fulfiller,address recipient,address paymentToken,uint256 amount,uint256[] tokenIds)",
  "event OrderCancelled(bytes32 indexed orderHash,address indexed offerer)"
];

// Try primary ABI, if fail will try alt ABI
let seaportContract;
try {
  seaportContract = new ethers.Contract(SEAPORT_CONTRACT_ADDRESS, seaportABI, provider);
} catch (e) {
  seaportContract = new ethers.Contract(SEAPORT_CONTRACT_ADDRESS, altABI, provider);
}

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
    const data = await res.json().catch(() => null);
    return data && data.success === true;
  } catch (e) {
    console.log("❌ Backend error:", e.message);
    return false;
  }
}

async function main() {
  console.log("🚀 On-chain Seaport Sync başladı...");

  const fromBlock = process.env.FROM_BLOCK ? parseInt(process.env.FROM_BLOCK) : 0;
  const toBlock = await provider.getBlockNumber();

  console.log(`🔎 Scanning blocks ${fromBlock} → ${toBlock}`);

  // Try OrderFulfilled filter (works with primary ABI)
  try {
    const fulfilledFilter = seaportContract.filters.OrderFulfilled();
    const fulfilledEvents = await seaportContract.queryFilter(fulfilledFilter, fromBlock, toBlock);

    for (const ev of fulfilledEvents) {
      // Try to extract common fields; event structure varies by implementation
      const args = ev.args || {};
      const orderHash = args.orderHash ? args.orderHash.toString() : null;
      const offerer = args.offerer ? args.offerer.toLowerCase() : null;
      const fulfiller = args.fulfiller ? args.fulfiller.toLowerCase() : null;

      // If the event contains orderDetails bytes, we can't decode easily here — send minimal payload
      const payload = {
        tokenId: null,
        price: null,
        sellerAddress: offerer,
        buyerAddress: fulfiller,
        seaportOrder: { orderHash },
        orderHash: orderHash,
        image: null,
        nftContract: NFT_CONTRACT_ADDRESS,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS,
        status: "fulfilled",
        onChainBlock: ev.blockNumber
      };

      const sent = await postOrderEvent(payload);
      console.log(sent ? `✅ Fulfilled sent: ${orderHash}` : `❌ Fulfilled failed: ${orderHash}`);
    }
  } catch (e) {
    console.warn("OrderFulfilled primary ABI processing failed:", e.message);
  }

  // Try alternative richer event signature
  try {
    const altContract = new ethers.Contract(SEAPORT_CONTRACT_ADDRESS, altABI, provider);
    const fulfilledFilterAlt = altContract.filters.OrderFulfilled();
    const fulfilledEventsAlt = await altContract.queryFilter(fulfilledFilterAlt, fromBlock, toBlock);

    for (const ev of fulfilledEventsAlt) {
      const args = ev.args || {};
      const orderHash = args.orderHash ? args.orderHash.toString() : null;
      const offerer = args.offerer ? args.offerer.toLowerCase() : null;
      const fulfiller = args.fulfiller ? args.fulfiller.toLowerCase() : null;
      const price = args.amount ? ethers.utils.formatEther(args.amount) : null;
      const tokenIds = args.tokenIds ? args.tokenIds.map(t => t.toString()).join(",") : null;

      const payload = {
        tokenId: tokenIds,
        price: price,
        sellerAddress: offerer,
        buyerAddress: fulfiller,
        seaportOrder: { orderHash },
        orderHash: orderHash,
        image: null,
        nftContract: NFT_CONTRACT_ADDRESS,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS,
        status: "fulfilled",
        onChainBlock: ev.blockNumber
      };

      const sent = await postOrderEvent(payload);
      console.log(sent ? `✅ Fulfilled sent (alt): ${orderHash}` : `❌ Fulfilled failed (alt): ${orderHash}`);
    }
  } catch (e) {
    console.warn("OrderFulfilled alt ABI processing failed:", e.message);
  }

  // OrderCancelled
  try {
    const cancelledFilter = seaportContract.filters.OrderCancelled();
    const cancelledEvents = await seaportContract.queryFilter(cancelledFilter, fromBlock, toBlock);

    for (const ev of cancelledEvents) {
      const args = ev.args || {};
      const orderHash = args.orderHash ? args.orderHash.toString() : null;
      const offerer = args.offerer ? args.offerer.toLowerCase() : null;

      const payload = {
        tokenId: null,
        price: null,
        sellerAddress: offerer,
        seaportOrder: { orderHash },
        orderHash: orderHash,
        nftContract: NFT_CONTRACT_ADDRESS,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS,
        status: "cancelled",
        onChainBlock: ev.blockNumber
      };

      const sent = await postOrderEvent(payload);
      console.log(sent ? `✅ Cancelled sent: ${orderHash}` : `❌ Cancelled failed: ${orderHash}`);
    }
  } catch (e) {
    console.warn("OrderCancelled processing failed:", e.message);
  }

  console.log("🎉 On-chain Seaport Sync tamamlandı!");
}

main().catch(err => {
  console.error("💀 Fatal error:", err);
  process.exit(1);
});