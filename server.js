import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { nanoid } from 'nanoid';
import postgres from 'postgres';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// Supabase/Postgres bağlantısı
const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:Xais123@db.iucrntwbicyivafwplgx.supabase.co:5432/postgres";

const sql = postgres(connectionString, { ssl: { rejectUnauthorized: false } });

const app = express();
app.use(helmet());
app.use(express.json({ limit: '5mb' }));
app.use(cors({ origin: '*' }));

const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NFT_CONTRACT_ADDRESS =
  process.env.NFT_CONTRACT_ADDRESS ||
  "0x54a88333F6e7540eA982261301309048aC431eD5";

const SEAPORT_CONTRACT_ADDRESS =
  process.env.SEAPORT_CONTRACT_ADDRESS ||
  "0x0000000000000068F116a894984e2DB1123eB395";

// Frontend faylları
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) app.use(express.static(distPath));
else app.use(express.static(__dirname));

app.get('/', (req, res) => {
  const indexFile = fs.existsSync(path.join(distPath, 'index.html'))
    ? path.join(distPath, 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexFile);
});

app.get('/api/status', (req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// Yeni order əlavə etmək
app.post('/order', async (req, res) => {
  try {
    const { tokenId, price, sellerAddress, seaportOrder, orderHash, image } =
      req.body;

    if (!tokenId || (!price && price !== 0) || !sellerAddress || !seaportOrder)
      return res
        .status(400)
        .json({ success: false, error: 'Missing parameters' });

    const id = nanoid();
    const createdAt = new Date().toISOString();
    const seaportOrderJSON =
      typeof seaportOrder === 'string'
        ? seaportOrder
        : JSON.stringify(seaportOrder);

    await sql`
      INSERT INTO orders (
        id, tokenId, price, nftContract, marketplaceContract,
        seller, seaportOrder, orderHash, onChain,
        status, image, createdAt
      )
      VALUES (
        ${id}, ${tokenId.toString()}, ${price},
        ${NFT_CONTRACT_ADDRESS}, ${SEAPORT_CONTRACT_ADDRESS},
        ${sellerAddress.toLowerCase()}, ${seaportOrderJSON}, ${orderHash || null},
        FALSE, 'active', ${image || null}, ${createdAt}
      )
    `;

    res.json({
      success: true,
      order: { id, tokenId, price, seller: sellerAddress, createdAt }
    });
  } catch (e) {
    console.error('POST /order error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Orders siyahısı (pagination + optional seller filter)
app.get('/orders', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '12', 10)));
    const offset = (page - 1) * limit;
    const sellerAddr = req.query.address
      ? req.query.address.toLowerCase()
      : null;

    let rows;
    if (sellerAddr) {
      rows = await sql`
        SELECT * FROM orders
        WHERE seller = ${sellerAddr}
        ORDER BY "createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      rows = await sql`
        SELECT * FROM orders
        ORDER BY "createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const orders = rows.map((r) => {
      const copy = { ...r };
      if (copy.seaportOrder) {
        try {
          copy.seaportOrder =
            typeof copy.seaportOrder === 'string'
              ? JSON.parse(copy.seaportOrder)
              : copy.seaportOrder;
        } catch {}
      }
      return copy;
    });

    res.json({ success: true, orders });
  } catch (e) {
    console.error('GET /orders error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// NFT alındıqdan sonra backend-ə bildiriş
app.post('/buy', async (req, res) => {
  try {
    const { orderHash, buyerAddress } = req.body;
    if (!orderHash || !buyerAddress) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing orderHash or buyerAddress' });
    }

    // buyerAddress = SQL-dəki column adı ilə uyğun olacaq!
    const updated = await sql`
      UPDATE orders
      SET onChain = TRUE,
          buyerAddress = ${buyerAddress.toLowerCase()},
          status = 'sold',
          updatedAt = NOW()
      WHERE orderHash = ${orderHash}
      RETURNING *;
    `;

    if (!updated || updated.length === 0) {
      return res.status(404).json({ success: false, error: 'Order tapılmadı' });
    }

    res.json({ success: true, order: updated[0] });
  } catch (e) {
    console.error('POST /buy error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Backend dinləyir
app.listen(PORT, () => console.log(`🚀 Backend ${PORT}-də işləyir`));
