import dotenv from 'dotenv';
import { createWebServer } from './web/server.js';
import { startWhatsAppBot } from './bot/whatsapp.js';
import { loadBackendStore, DataStatus } from './data/dbStore.js';
import { initTicketDatabase } from './data/ticketDatabase.js';
import { realtimeHub } from './services/realtimeHub.js';
import { autoCloseWorker } from './services/autoCloseWorker.js';
dotenv.config();
const INITIAL_PORT = parseInt(process.env.PORT || '8000', 10);
async function bootstrap() {
    console.clear();
    console.log('===========================================================');
    console.log('    SAPA BPS KAB. BANGKA - UNIFIED BOT & REST API (API ONLY)  ');
    console.log('===========================================================\n');
    // 1. Inisialisasi Database Ticketing & Customer Service
    await initTicketDatabase();
    // 2. Load Data Statistik dari db.json
    const store = loadBackendStore();
    const publishedCount = store.datasets.filter(d => d.status === DataStatus.PUBLISHED).length;
    console.log(`[INFO] Berhasil memuat ${store.datasets.length} dataset (${publishedCount} terpublikasi) dan ${store.records.length} rekaman data statistik resmi dari db.json BPS Kab. Bangka.`);
    // 3. Jalankan Express REST API Server (CRUD & Bot Gateway)
    const app = createWebServer();
    function startServer(port) {
        const server = app.listen(port, () => {
            console.log(`[INFO] REST API Endpoint       : http://localhost:${port}/api/faqs`);
            console.log(`[INFO] CS Ticketing Endpoint   : http://localhost:${port}/api/tickets`);
            console.log(`[INFO] WebSocket CS Hub        : ws://localhost:${port}/ws/cs`);
            console.log(`[INFO] Server aktif di port ${port} (Headless API Only - No UI)...\n`);
            // Inisialisasi WebSocket & Auto-Close Worker
            realtimeHub.init(server);
            autoCloseWorker.start(60 * 1000); // Check every 60 seconds
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`[WARN] Port ${port} sedang dipakai oleh proses lain. Beralih ke port ${port + 1}...`);
                startServer(port + 1);
            }
            else {
                console.error('[ERROR SERVER]', err);
            }
        });
    }
    startServer(INITIAL_PORT);
    // 3. Jalankan WhatsApp Baileys Bot
    console.log('[INFO] Memulai konektor WhatsApp Multi-Device...');
    await startWhatsAppBot();
}
bootstrap().catch(err => {
    console.error('[FATAL BOOTSTRAP ERROR]', err);
});
