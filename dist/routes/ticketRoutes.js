import { Router } from 'express';
import { ticketService } from '../services/ticketService.js';
import { realtimeHub } from '../services/realtimeHub.js';
import { getWhatsAppSocket, sendWhatsAppMessageSafe } from '../bot/whatsapp.js';
import { getGroqApiKey, getGroqModel, setGroqConfig, maskApiKey, testGroqApiKey, GROQ_API_URL } from '../nlp/llmFallback.js';
export function createTicketRouter() {
    const router = Router();
    const getParam = (param) => String(Array.isArray(param) ? param[0] : param || '');
    // 1. GET /api/cs/events - Realtime SSE Stream Endpoint
    router.get('/cs/events', (req, res) => {
        realtimeHub.registerSSE(res);
    });
    // 2. GET /api/cs/admins - Daftar Admin CS yang aktif
    router.get('/cs/admins', async (req, res) => {
        try {
            const admins = await ticketService.getAdmins();
            res.json({ success: true, data: admins });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // 3. GET /api/cs/settings - Konfigurasi Customer Service
    router.get('/cs/settings', async (req, res) => {
        try {
            const settings = await ticketService.getSettings();
            res.json({ success: true, data: settings });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // 4. PUT /api/cs/settings - Update konfigurasi Customer Service
    router.put('/cs/settings', async (req, res) => {
        try {
            const payload = (req.body && typeof req.body.settings === 'object') ? req.body.settings : req.body;
            if (typeof payload === 'object' && payload !== null) {
                let newGroqKey = undefined;
                let newGroqModel = undefined;
                for (const [k, v] of Object.entries(payload)) {
                    await ticketService.updateSetting(k, String(v));
                    if (k === 'groq_api_key')
                        newGroqKey = String(v);
                    if (k === 'groq_model')
                        newGroqModel = String(v);
                }
                if (newGroqKey !== undefined || newGroqModel !== undefined) {
                    await setGroqConfig(newGroqKey, newGroqModel);
                }
            }
            const updated = await ticketService.getSettings();
            res.json({ success: true, message: 'Pengaturan berhasil diperbarui', data: updated });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // ============================================================
    // GROQ API CONFIGURATION (DINAMIS TANPA COMMIT GITHUB)
    // ============================================================
    // Helper GET konfigurasi Groq API aktif
    const handleGetGroqConfig = async (req, res) => {
        try {
            const apiKey = await getGroqApiKey();
            const model = await getGroqModel();
            res.json({
                success: true,
                data: {
                    isConfigured: Boolean(apiKey && apiKey.length > 5),
                    apiKeyMasked: maskApiKey(apiKey),
                    model: model,
                    apiUrl: GROQ_API_URL
                }
            });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    };
    // Helper POST / PUT ubah token & model Groq API
    const handleSetGroqConfig = async (req, res) => {
        try {
            const { apiKey, model, testBeforeSave, force } = req.body || {};
            if (apiKey === undefined && model === undefined) {
                return res.status(400).json({
                    success: false,
                    error: 'Parameter apiKey atau model wajib disertakan dalam request body'
                });
            }
            if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('gsk_') && !force) {
                return res.status(400).json({
                    success: false,
                    error: 'Format Groq API Key tidak valid. Groq API Key resmi harus diawali dengan "gsk_". Tambahkan force: true jika tetap ingin menyimpan tanpa validasi format.'
                });
            }
            // Validasi koneksi langsung ke Groq Cloud jika diminta
            if (testBeforeSave && apiKey) {
                const testResult = await testGroqApiKey(apiKey, model);
                if (!testResult.valid && !force) {
                    return res.status(400).json({
                        success: false,
                        error: `Gagal memvalidasi token Groq ke server Groq Cloud: ${testResult.message}`,
                        details: testResult
                    });
                }
            }
            const result = await setGroqConfig(apiKey, model);
            const activeKey = await getGroqApiKey();
            const activeModel = await getGroqModel();
            res.json({
                success: true,
                message: result.message,
                data: {
                    isConfigured: Boolean(activeKey && activeKey.length > 5),
                    apiKeyMasked: maskApiKey(activeKey),
                    model: activeModel
                }
            });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    };
    // Helper uji coba koneksi token Groq ke server Groq Cloud
    const handleTestGroqConfig = async (req, res) => {
        try {
            const { apiKey, model } = req.body || {};
            const testResult = await testGroqApiKey(apiKey, model);
            res.status(testResult.valid ? 200 : 400).json({
                success: testResult.valid,
                message: testResult.message,
                data: testResult
            });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    };
    router.get('/groq-config', handleGetGroqConfig);
    router.get('/cs/groq-config', handleGetGroqConfig);
    router.post('/groq-config', handleSetGroqConfig);
    router.post('/cs/groq-config', handleSetGroqConfig);
    router.put('/groq-config', handleSetGroqConfig);
    router.put('/cs/groq-config', handleSetGroqConfig);
    router.post('/groq-config/test', handleTestGroqConfig);
    router.post('/cs/groq-config/test', handleTestGroqConfig);
    // 5. POST /api/tickets - Buat tiket baru secara manual/programatik
    router.post('/tickets', async (req, res) => {
        try {
            const { phone, name, message } = req.body;
            if (!phone) {
                return res.status(400).json({ success: false, error: 'Nomor telepon/WhatsApp wajib diisi' });
            }
            const result = await ticketService.createTicket(phone, name, message);
            res.status(result.isNew ? 201 : 200).json({
                success: true,
                isNew: result.isNew,
                message: result.isNew ? 'Tiket baru berhasil dibuat' : 'Tiket aktif sudah ada untuk nomor ini',
                data: result.ticket
            });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // 6. GET /api/tickets - Daftar tiket dengan filter status, admin, search, pagination
    router.get('/tickets', async (req, res) => {
        try {
            const status = req.query.status ? String(req.query.status) : undefined;
            const adminId = req.query.adminId ? String(req.query.adminId) : undefined;
            const search = req.query.search ? String(req.query.search) : undefined;
            const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
            const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
            const result = await ticketService.getTickets({ status, adminId, search, limit, offset });
            res.json({
                success: true,
                total: result.total,
                count: result.tickets.length,
                limit,
                offset,
                data: result.tickets
            });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // 7. GET /api/tickets/:id - Detail lengkap tiket beserta riwayat pesan
    router.get('/tickets/:id', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const ticket = await ticketService.getTicketById(ticketId);
            if (!ticket) {
                return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan' });
            }
            const messages = await ticketService.getMessages(ticketId, 200);
            const events = await ticketService.getTicketEvents(ticketId);
            res.json({
                success: true,
                data: {
                    ticket,
                    messages,
                    events
                }
            });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // 8. POST /api/tickets/:id/assign - Ambil Tiket (Protected by Concurrency Locking)
    router.post('/tickets/:id/assign', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const { adminId, assignedBy } = req.body;
            if (!adminId) {
                return res.status(400).json({ success: false, error: 'adminId wajib disertakan' });
            }
            const result = await ticketService.assignTicket(ticketId, adminId, assignedBy);
            if (!result.success) {
                return res.status(409).json({ success: false, error: result.error });
            }
            // Notifikasi ke WhatsApp User bahwa CS telah mengambil tiket
            const ticket = result.ticket;
            if (ticket && ticket.user_phone) {
                const adminName = ticket.admin_name || 'Petugas CS';
                ticketService.getTemplate('template_assigned', {
                    ticket_number: ticket.ticket_number,
                    admin_name: adminName,
                    user_name: ticket.user_name || 'Pengguna'
                }).then(welcomeText => {
                    sendWhatsAppMessageSafe(ticket.user_phone, { text: welcomeText }).then(() => {
                        console.log(`[WA NOTIF] Notifikasi CS terhubung terkirim ke ${ticket.user_phone} (Tiket #${ticket.ticket_number})`);
                    }).catch((waErr) => {
                        console.error(`[ERROR WA NOTIF] Gagal mengirim pesan CS terhubung ke ${ticket.user_phone}:`, waErr?.message || waErr);
                    });
                });
            }
            else {
                const sock = getWhatsAppSocket();
                if (!sock) {
                    console.warn(`[WARN WA NOTIF] WhatsApp bot belum terhubung/login, pesan notifikasi tiket #${ticket?.ticket_number} belum dapat dikirim.`);
                }
                else if (!ticket?.user_phone) {
                    console.warn(`[WARN WA NOTIF] Nomor telepon pengguna tidak ditemukan pada tiket #${ticket?.ticket_number}.`);
                }
            }
            res.json({
                success: true,
                message: 'Tiket berhasil diambil',
                data: result.ticket
            });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // 9. POST /api/tickets/:id/messages - Admin kirim pesan ke WhatsApp User
    router.post('/tickets/:id/messages', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const { adminId, message, messageType } = req.body;
            if (!adminId || !message) {
                return res.status(400).json({ success: false, error: 'adminId dan message wajib diisi' });
            }
            const ticket = await ticketService.getTicketById(ticketId);
            if (!ticket) {
                return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan' });
            }
            if (ticket.status === 'CLOSED') {
                return res.status(400).json({ success: false, error: 'Tiket sudah ditutup, tidak dapat mengirim pesan' });
            }
            // 1. Format pesan menggunakan template (default: murni isi pesan tanpa prefix admin)
            const formattedMsg = await ticketService.getTemplate('template_admin_message', {
                message,
                admin_name: ticket.admin_name || 'Customer Service'
            });
            let externalMessageId = undefined;
            if (ticket.user_phone) {
                try {
                    const sent = await sendWhatsAppMessageSafe(ticket.user_phone, { text: formattedMsg });
                    if (sent?.key?.id) {
                        externalMessageId = sent.key.id;
                    }
                }
                catch (waErr) {
                    console.error(`[ERROR WA SEND MESSAGE] Gagal kirim balasan admin ke ${ticket.user_phone}:`, waErr?.message || waErr);
                }
            }
            // 2. Simpan pesan ke database beserta externalMessageId jika ada
            const msg = await ticketService.addMessage(ticketId, 'ADMIN', adminId, message, messageType || 'TEXT', externalMessageId);
            res.status(201).json({
                success: true,
                message: 'Pesan berhasil dikirim ke pengguna',
                data: msg
            });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // 10. POST /api/tickets/:id/pending - Set status PENDING
    router.post('/tickets/:id/pending', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const { adminId, reason } = req.body;
            if (!adminId) {
                return res.status(400).json({ success: false, error: 'adminId wajib disertakan' });
            }
            const updated = await ticketService.setPending(ticketId, adminId, reason);
            // Kirim notifikasi ke WhatsApp User jika tiket di-pending
            if (updated.user_phone) {
                ticketService.getTemplate('template_pending', {
                    ticket_number: updated.ticket_number,
                    reason: reason ? `Alasan: ${reason}` : '',
                    admin_name: updated.admin_name || 'Petugas CS'
                }).then(pendingText => {
                    sendWhatsAppMessageSafe(updated.user_phone, { text: pendingText }).catch(() => { });
                });
            }
            res.json({ success: true, message: 'Status tiket diubah menjadi PENDING', data: updated });
        }
        catch (err) {
            res.status(400).json({ success: false, error: err.message });
        }
    });
    // 11. POST /api/tickets/:id/resolve - Set status RESOLVED
    router.post('/tickets/:id/resolve', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const { adminId, notes } = req.body;
            if (!adminId) {
                return res.status(400).json({ success: false, error: 'adminId wajib disertakan' });
            }
            const updated = await ticketService.resolveTicket(ticketId, adminId, notes);
            // Kirim info ke user bahwa masalah dianggap selesai menggunakan template_resolved
            if (updated.user_phone) {
                const resolveText = await ticketService.getTemplate('template_resolved', {
                    ticket_number: updated.ticket_number,
                    notes: notes || '',
                    admin_name: updated.admin_name || 'Petugas CS'
                });
                sendWhatsAppMessageSafe(updated.user_phone, { text: resolveText }).catch((err) => {
                    console.error(`[ERROR WA NOTIF RESOLVE] Gagal kirim info resolve ke ${updated.user_phone}:`, err?.message || err);
                });
            }
            res.json({ success: true, message: 'Tiket berhasil diselesaikan', data: updated });
        }
        catch (err) {
            res.status(400).json({ success: false, error: err.message });
        }
    });
    // 12. POST /api/tickets/:id/close - Tutup Tiket secara permanen
    router.post('/tickets/:id/close', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const { closedByType, closedById, closeReason } = req.body;
            const updated = await ticketService.closeTicket(ticketId, closedByType || 'ADMIN', closedById, closeReason || 'Ditutup oleh admin pelayanan');
            // Kirim konfirmasi penutupan ke WhatsApp user menggunakan template_closed
            if (updated.user_phone) {
                const closeText = await ticketService.getTemplate('template_closed', {
                    ticket_number: updated.ticket_number,
                    reason: closeReason || '',
                    closed_by: closedByType || 'ADMIN'
                });
                sendWhatsAppMessageSafe(updated.user_phone, { text: closeText }).catch((err) => {
                    console.error(`[ERROR WA NOTIF CLOSE] Gagal kirim info close ke ${updated.user_phone}:`, err?.message || err);
                });
            }
            res.json({ success: true, message: 'Tiket berhasil ditutup', data: updated });
        }
        catch (err) {
            res.status(400).json({ success: false, error: err.message });
        }
    });
    // 13. POST /api/tickets/:id/release - Lepaskan tiket kembali ke WAITING
    router.post('/tickets/:id/release', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const { adminId, reason } = req.body;
            if (!adminId) {
                return res.status(400).json({ success: false, error: 'adminId wajib disertakan' });
            }
            const updated = await ticketService.releaseTicket(ticketId, adminId, reason);
            res.json({ success: true, message: 'Tiket berhasil dilepas kembali ke status Waiting', data: updated });
        }
        catch (err) {
            res.status(400).json({ success: false, error: err.message });
        }
    });
    // 14. POST /api/tickets/:id/transfer - Alihkan tiket ke admin lain
    router.post('/tickets/:id/transfer', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const { fromAdminId, toAdminId, reason } = req.body;
            if (!fromAdminId || !toAdminId) {
                return res.status(400).json({ success: false, error: 'fromAdminId dan toAdminId wajib disertakan' });
            }
            const updated = await ticketService.transferTicket(ticketId, fromAdminId, toAdminId, reason);
            res.json({ success: true, message: 'Tiket berhasil dialihkan', data: updated });
        }
        catch (err) {
            res.status(400).json({ success: false, error: err.message });
        }
    });
    // 15. GET /api/tickets/:id/history - Riwayat audit log
    router.get('/tickets/:id/history', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const events = await ticketService.getTicketEvents(ticketId);
            res.json({ success: true, data: events });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    // 16. POST /api/tickets/:id/read - Tandai pesan telah dibaca
    router.post('/tickets/:id/read', async (req, res) => {
        try {
            const ticketId = getParam(req.params.id);
            const { reader } = req.body; // 'ADMIN' | 'USER'
            await ticketService.markMessagesAsRead(ticketId, reader === 'USER' ? 'USER' : 'ADMIN');
            res.json({ success: true, message: 'Pesan telah ditandai sebagai dibaca' });
        }
        catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    return router;
}
