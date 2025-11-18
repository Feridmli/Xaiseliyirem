// main.js
import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://xaiseliyirem.onrender.com";
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT || "0x54a88333F6e7540eA982261301309048aC431eD5";
const SEAPORT_CONTRACT_ADDRESS = import.meta.env.VITE_SEAPORT_CONTRACT || "0x0000000000000068F116a894984e2DB1123eB395";
const APECHAIN_ID = 33139; // decimal
const APECHAIN_ID_HEX = "0x8173"; // hex(33139)

let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

let currentPage = 1;
const PAGE_SIZE = 12;

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");
const pageIndicator = document.getElementById("pageIndicator");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

function notify(msg, timeout = 4000) {
  noticeDiv.textContent = msg;
  if (timeout > 0) setTimeout(() => { if (noticeDiv.textContent === msg) noticeDiv.textContent = ""; }, timeout);
}

async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask/Vişual Ethereum provider tapılmadı!");

    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    userAddress = (await signer.getAddress()).toLowerCase();

    const network = await provider.getNetwork();
    if (network.chainId !== APECHAIN_ID) {
      try {
        await provider.send("wallet_addEthereumChain", [{
          chainId: APECHAIN_ID_HEX,
          chainName: "ApeChain Mainnet",
          nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
          rpcUrls: ["https://rpc.apechain.com"],
          blockExplorerUrls: ["https://apescan.io"]
        }]);
        notify("Şəbəkə əlavə edildi. Xahiş olunur cüzdanı yenidən qoşun.");
        return;
      } catch (e) { console.warn("Şəbəkə əlavə etmə uğursuz oldu:", e); }
    }

    seaport = new Seaport(signer, { contractAddress: SEAPORT_CONTRACT_ADDRESS });

    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = userAddress.slice(0,6) + "..." + userAddress.slice(-4);

    await loadOrders(currentPage);
  } catch (err) {
    console.error("Wallet connect error:", err);
    alert("Cüzdan qoşularkən xəta oldu. Konsolu yoxla.");
  }
}

connectBtn.onclick = connectWallet;
disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";
  notify("Cüzdan ayırıldı", 2000);
};

// Pagination
prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; loadOrders(currentPage); } };
nextBtn.onclick = () => { currentPage++; loadOrders(currentPage); };

// Load Orders
async function loadOrders(page = 1) {
  try {
    pageIndicator.textContent = page;
    marketplaceDiv.innerHTML = "<p style='opacity:.7'>Yüklənir...</p>";

    const res = await fetch(`${BACKEND_URL}/orders?page=${page}&limit=${PAGE_SIZE}`);
    if (!res.ok) { marketplaceDiv.innerHTML = "<p>Xəta: serverdən məlumat gəlmədi.</p>"; return; }
    const data = await res.json();
    if (!data.success) { marketplaceDiv.innerHTML = "<p>Xəta: serverdən məlumat gəlmədi.</p>"; return; }

    const orders = data.orders || [];
    if (!orders.length) { marketplaceDiv.innerHTML = "<p>Bu səhifədə satışda NFT yoxdur.</p>"; return; }

    marketplaceDiv.innerHTML = "";
    for (const o of orders) {
      const tokenId = o.tokenId ?? o.tokenid ?? o.token_id ?? (o.token ? o.token : "unknown");
      const price = o.price ?? o.list_price ?? parseOrderPrice(o) ?? '—';
      const image = o.image ?? (o.metadata && o.metadata.image) ?? o.image_url ?? 'https://ipfs.io/ipfs/QmExampleNFTImage/1.png';

      const card = document.createElement("div");
      card.className = "nft-card";
      card.innerHTML = `
        <img src="${image}" alt="NFT image" onerror="this.src='https://ipfs.io/ipfs/QmExampleNFTImage/1.png'">
        <h4>Bear #${tokenId}</h4>
        <p class="price">Qiymət: ${price} APE</p>
        <div class="nft-actions">
          <div style="display:flex;gap:8px;">
            <button class="wallet-btn buy-btn" data-token="${tokenId}" data-orderid="${o.id || ''}">Buy</button>
            <button class="wallet-btn list-btn" data-token="${tokenId}">List</button>
          </div>
        </div>
      `;
      marketplaceDiv.appendChild(card);

      const buyBtn = card.querySelector(".buy-btn");
      buyBtn.onclick = async (ev) => {
        ev.target.disabled = true;
        try { await buyNFT(o); } catch (e) { console.error("buy handler error:", e); }
        finally { ev.target.disabled = false; }
      };

      const listBtn = card.querySelector(".list-btn");
      listBtn.onclick = async (ev) => {
        ev.target.disabled = true;
        try { await listNFT(tokenId); } catch (e) { console.error("list handler error:", e); }
        finally { ev.target.disabled = false; }
      };
    }
  } catch (err) { console.error("loadOrders error:", err); marketplaceDiv.innerHTML = "<p>Xəta baş verdi (konsolu yoxla).</p>"; }
}

function parseOrderPrice(o) {
  try {
    const so = o.seaportOrder || o.seaportorder || o.seaport_order || (o.seaportOrderJSON ? JSON.parse(o.seaportOrderJSON) : null);
    const params = (so && (so.parameters || so.order || so));
    const cons = params && params.consideration ? params.consideration : (params && params.consideration ? params.consideration : null);
    if (cons && cons.length > 0) {
      const amount = cons[0].endAmount ?? cons[0].startAmount ?? cons[0].amount ?? null;
      if (amount) {
        let amt = amount;
        if (typeof amount === "object" && (amount.toString || amount.value)) { amt = amount.toString ? amount.toString() : amount.value; }
        const bn = ethers.BigNumber.from(amt.toString());
        return ethers.utils.formatEther(bn);
      }
    }
  } catch (e) {}
  return null;
}

// ------------------ Buy NFT ------------------
async function buyNFT(orderRecord) {
  if (!seaport || !signer) return alert("Əvvəlcə cüzdanı qoşun!");

  notify("Transaksiya hazırlanır...");
  
  const order = orderRecord.seaportOrder || orderRecord.seaportorder || orderRecord.seaport_order;
  let parsedOrder = order;

  if (!order && orderRecord.seaportOrderJSON) {
    try { parsedOrder = JSON.parse(orderRecord.seaportOrderJSON); } catch (e) { parsedOrder = null; }
  }
  if (!parsedOrder) { alert("Order məlumatı tapılmadı."); return; }

  try {
    const buyerAddr = await signer.getAddress();
    notify("Seaport-ə əməliyyat göndərilir...");

    const result = await seaport.fulfillOrder({ order: parsedOrder, accountAddress: buyerAddr });
    const exec = result.executeAllActions || result.execute || null;
    if (!exec) { 
      notify("NFT alındı!"); 
      await loadOrders(currentPage); 
      return; 
    }

    const txResponse = await exec();
    if (txResponse && typeof txResponse.wait === "function") await txResponse.wait();

    notify("NFT uğurla alındı ✅");

    // ---------------------- Backend /buy endpoint-ə POST ----------------------
    if (orderRecord.orderHash) {
      try {
        await fetch(`${BACKEND_URL}/buy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderHash: orderRecord.orderHash,
            buyerAddress: buyerAddr
          })
        });
      } catch (e) { console.error("Backend /buy error:", e); }
    }

    await loadOrders(currentPage);
  } catch (err) { 
    console.error("buyNFT error:", err); 
    alert("Alış zamanı xəta: " + (err.message || String(err))); 
  }
}

// ------------------ Listing (create order) ------------------
async function listNFT(tokenId) {
  if (!seaport || !signer) return alert("Əvvəlcə cüzdanı qoşun!");

  try {
    const seller = await signer.getAddress();
    notify("Sahibliyiniz yoxlanılır...");

    const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, [
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function isApprovedForAll(address owner, address operator) view returns (bool)",
      "function setApprovalForAll(address operator, bool _approved)"
    ], signer);

    let ownerOnChain;
    try { ownerOnChain = (await nftContract.ownerOf(tokenId)).toLowerCase(); }
    catch (e) { alert("Token sahibliyi tapılmadı (ownerOf xətası)."); console.error(e); return; }

    if (ownerOnChain !== seller.toLowerCase()) { alert("Bu token-senin deyil. Yalnız sahibi list edə bilər."); return; }

    let priceStr = prompt("NFT-ni neçə APE-ə list etmək istəyirsən? (məs. 1.5)");
    if (!priceStr) return notify("Listing ləğv edildi.", 2500);
    priceStr = priceStr.trim();
    if (isNaN(Number(priceStr))) { alert("Qiymət rəqəm olmalıdır."); return; }
    const priceWei = ethers.utils.parseEther(priceStr);

    notify("Approve yoxlanılır...");
    const approved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
    if (!approved) {
      notify("Seaport-ə approve göndərilir...");
      const tx = await nftContract.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
      await tx.wait();
    }

    notify("Seaport order yaradılır və imzalanır...");
    const offerItem = { itemType: 2, token: NFT_CONTRACT_ADDRESS, identifier: tokenId.toString() };
    const considerationItem = { amount: priceWei.toString(), recipient: seller };

    const createRequest = {
      offer: [offerItem],
      consideration: [considerationItem],
      endTime: Math.floor(Date.now() / 1000 + (60 * 60 * 24 * 30)).toString(),
    };

    const orderResult = await seaport.createOrder(createRequest, seller);
    const exec = orderResult.executeAllActions || orderResult.execute || null;
    if (!exec) { console.error("createOrder returned unexpected:", orderResult); alert("Order imzalanması mümkün olmadı. Konsolu yoxla."); return; }

    const signed = await exec();
    let signedOrder = signed;
    if (signed && signed.order) signedOrder = signed.order;
    if (signed && signed.parameters) signedOrder = signed;

    const orderHash = signedOrder ? (signedOrder.orderHash || (signedOrder.parameters && signedOrder.parameters.orderHash) || null) : null;

    notify("Order backend-ə göndərilir...");
    const postBody = {
      tokenId: tokenId.toString(),
      price: priceStr,
      sellerAddress: seller,
      seaportOrder: signedOrder,
      orderHash: orderHash,
      image: null
    };

    const r = await fetch(`${BACKEND_URL}/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postBody)
    });

    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.success) { console.error("Backend qaytardı:", await r.text().catch(() => "no text")); alert("Server order-u qəbul etmədi, konsolu yoxla."); return; }

    notify(`NFT #${tokenId} uğurla list olundu — ${priceStr} APE`);
    await loadOrders(currentPage);

  } catch (err) { console.error("listNFT error:", err); alert("Listing zamanı xəta: " + (err.message || String(err))); }
}

// expose functions to window for HTML buttons
window.buyNFT = buyNFT;
window.loadOrders = loadOrders;
window.listNFT = listNFT;
