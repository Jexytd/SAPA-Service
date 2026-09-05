import dotenv from 'dotenv';
import { createWebServer } from './web/server.js';
import { loadBackendStore, DataStatus } from './data/dbStore.js';

dotenv.config();
const INITIAL_PORT = parseInt(process.env.PORT || '8000', 10);

console.clear();
console.log('===========================================================');
console.log('   SAPA BPS KAB. BANGKA - [1] SERVER NLP & REST API (API ONLY)');
console.log('===========================================================\n');

const store = loadBackendStore();
const publishedCount = store.datasets.filter(d => d.status === DataStatus.PUBLISHED).length;
console.log(`[OK] Mesin NLP aktif dengan ${store.datasets.length} dataset (${publishedCount} terpublikasi) dan ${store.records.length} rekaman data statistik resmi dari db.json.`);

const app = createWebServer();

function startServer(port: number) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[INFO] REST API Endpoint       : http://localhost:${port}/api/faqs`);
    console.log(`[INFO] Status NLP & REST API   : AKTIF & SIAP MENERIMA REQUEST (Port ${port} - Headless API)\n`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[WARN] Port ${port} sedang dipakai oleh proses lain. Beralih ke port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[ERROR SERVER]', err);
    }
  });
}

startServer(INITIAL_PORT);
