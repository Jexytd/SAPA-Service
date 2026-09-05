import { Router, Request, Response } from 'express';
import { ticketService } from '../services/ticketService.js';
import { realtimeHub } from '../services/realtimeHub.js';
import { getWhatsAppSocket } from '../bot/whatsapp.js';

export function createTicketRouter(): Router {
  const router = Router();

  const getParam = (param: any): string => String(Array.isArray(param) ? param[0] : param || '');

  // 1. GET /api/cs/events - Realtime SSE Stream Endpoint
  router.get('/cs/events', (req: Request, res: Response) => {
    realtimeHub.registerSSE(res);
  });

  // 2. GET /api/cs/admins - Daftar Admin CS yang aktif
  router.get('/cs/admins', async (req: Request, res: Response) => {
    try {
      const admins = await ticketService.getAdmins();
      res.json({ success: true, data: admins });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. GET /api/cs/settings - Konfigurasi Customer Service
  router.get('/cs/settings', async (req: Request, res: Response) => {
    try {
      const settings = await ticketService.getSettings();
      res.json({ success: true, data: settings });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. PUT /api/cs/settings - Update konfigurasi Customer Service
  router.put('/cs/settings', async (req: Request, res: Response) => {
    try {
      const { settings } = req.body;
      if (typeof settings === 'object') {
        for (const [k, v] of Object.entries(settings)) {
          await ticketService.updateSetting(k, String(v));
        }
      }
      const updated = await ticketService.getSettings();
      res.json({ success: true, message: 'Pengaturan berhasil diperbarui', data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. POST /api/tickets - Buat tiket baru secara manual/programatik
  router.post('/tickets', async (req: Request, res: Response) => {
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
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. GET /api/tickets - Daftar tiket dengan filter status, admin, search, pagination
  router.get('/tickets', async (req: Request, res: Response) => {
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
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. GET /api/tickets/:id - Detail lengkap tiket beserta riwayat pesan
  router.get('/tickets/:id', async (req: Request, res: Response) => {
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
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8. POST /api/tickets/:id/assign - Ambil Tiket (Protected by Concurrency Locking)
  router.post('/tickets/:id/assign', async (req: Request, res: Response) => {
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
      const sock = getWhatsAppSocket();
      const ticket = result.ticket;
      if (sock && ticket && ticket.user_phone) {
        const jid = `${ticket.user_phone}@s.whatsapp.net`;
        const adminName = ticket.admin_name || 'Petugas CS';
        sock.sendMessage(jid, {
          text: `💬 *Customer Service Terhubung*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCustomer Service *${adminName}* telah mengambil tiket Anda (*#${ticket.ticket_number}*) dan siap melayani.\n\nSilakan sampaikan pertanyaan atau kendala Anda secara rinci.`
        }).catch(() => {});
      }

      res.json({
        success: true,
        message: 'Tiket berhasil diambil',
        data: result.ticket
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 9. POST /api/tickets/:id/messages - Admin kirim pesan ke WhatsApp User
  router.post('/tickets/:id/messages', async (req: Request, res: Response) => {
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

      // 1. Simpan pesan ke database
      const msg = await ticketService.addMessage(
        ticketId,
        'ADMIN',
        adminId,
        message,
        messageType || 'TEXT'
      );

      // 2. Kirim pesan secara langsung ke WhatsApp Pengguna
      const sock = getWhatsAppSocket();
      if (sock && ticket.user_phone) {
        const jid = `${ticket.user_phone}@s.whatsapp.net`;
        const adminName = ticket.admin_name || 'Customer Service';
        const formattedMsg = `*${adminName} (CS BPS Bangka):*\n${message}\n\n_Ketik #selesai untuk mengakhiri sesi CS._`;

        const sent = await sock.sendMessage(jid, { text: formattedMsg });
        if (sent?.key?.id) {
          msg.external_message_id = sent.key.id;
        }
      }

      res.status(201).json({
        success: true,
        message: 'Pesan berhasil dikirim ke pengguna',
        data: msg
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 10. POST /api/tickets/:id/pending - Set status PENDING
  router.post('/tickets/:id/pending', async (req: Request, res: Response) => {
    try {
      const ticketId = getParam(req.params.id);
      const { adminId, reason } = req.body;
      if (!adminId) {
        return res.status(400).json({ success: false, error: 'adminId wajib disertakan' });
      }

      const updated = await ticketService.setPending(ticketId, adminId, reason);
      res.json({ success: true, message: 'Status tiket diubah menjadi PENDING', data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 11. POST /api/tickets/:id/resolve - Set status RESOLVED
  router.post('/tickets/:id/resolve', async (req: Request, res: Response) => {
    try {
      const ticketId = getParam(req.params.id);
      const { adminId, notes } = req.body;
      if (!adminId) {
        return res.status(400).json({ success: false, error: 'adminId wajib disertakan' });
      }

      const updated = await ticketService.resolveTicket(ticketId, adminId, notes);

      // Kirim info ke user bahwa masalah dianggap selesai
      const sock = getWhatsAppSocket();
      if (sock && updated.user_phone) {
        const jid = `${updated.user_phone}@s.whatsapp.net`;
        sock.sendMessage(jid, {
          text: `✅ *Konsultasi Selesai (Tiket #${updated.ticket_number})*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCustomer Service telah menandai percakapan ini selesai.\n\nJika masih ada yang ingin ditanyakan, Anda dapat membalas pesan ini langsung. Jika sudah tidak ada pertanyaan, ketik *#selesai* untuk mengakhiri sesi.`
        }).catch(() => {});
      }

      res.json({ success: true, message: 'Tiket berhasil diselesaikan', data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 12. POST /api/tickets/:id/close - Tutup Tiket secara permanen
  router.post('/tickets/:id/close', async (req: Request, res: Response) => {
    try {
      const ticketId = getParam(req.params.id);
      const { closedByType, closedById, closeReason } = req.body;

      const updated = await ticketService.closeTicket(
        ticketId, 
        closedByType || 'ADMIN', 
        closedById, 
        closeReason || 'Ditutup oleh admin pelayanan'
      );

      // Kirim konfirmasi penutupan ke WhatsApp user
      const sock = getWhatsAppSocket();
      if (sock && updated.user_phone) {
        const jid = `${updated.user_phone}@s.whatsapp.net`;
        sock.sendMessage(jid, {
          text: `🔒 *Percakapan Ditutup*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPercakapan untuk Tiket *#${updated.ticket_number}* telah ditutup.\n\nTerima kasih telah menghubungi Layanan BPS Kab. Bangka. Asisten bot otomatis kini telah aktif kembali. Silakan ketik *menu* jika ingin memulai interaksi baru.`
        }).catch(() => {});
      }

      res.json({ success: true, message: 'Tiket berhasil ditutup', data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 13. POST /api/tickets/:id/release - Lepaskan tiket kembali ke WAITING
  router.post('/tickets/:id/release', async (req: Request, res: Response) => {
    try {
      const ticketId = getParam(req.params.id);
      const { adminId, reason } = req.body;
      if (!adminId) {
        return res.status(400).json({ success: false, error: 'adminId wajib disertakan' });
      }

      const updated = await ticketService.releaseTicket(ticketId, adminId, reason);
      res.json({ success: true, message: 'Tiket berhasil dilepas kembali ke status Waiting', data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 14. POST /api/tickets/:id/transfer - Alihkan tiket ke admin lain
  router.post('/tickets/:id/transfer', async (req: Request, res: Response) => {
    try {
      const ticketId = getParam(req.params.id);
      const { fromAdminId, toAdminId, reason } = req.body;
      if (!fromAdminId || !toAdminId) {
        return res.status(400).json({ success: false, error: 'fromAdminId dan toAdminId wajib disertakan' });
      }

      const updated = await ticketService.transferTicket(ticketId, fromAdminId, toAdminId, reason);
      res.json({ success: true, message: 'Tiket berhasil dialihkan', data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 15. GET /api/tickets/:id/history - Riwayat audit log
  router.get('/tickets/:id/history', async (req: Request, res: Response) => {
    try {
      const ticketId = getParam(req.params.id);
      const events = await ticketService.getTicketEvents(ticketId);
      res.json({ success: true, data: events });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 16. POST /api/tickets/:id/read - Tandai pesan telah dibaca
  router.post('/tickets/:id/read', async (req: Request, res: Response) => {
    try {
      const ticketId = getParam(req.params.id);
      const { reader } = req.body; // 'ADMIN' | 'USER'
      await ticketService.markMessagesAsRead(ticketId, reader === 'USER' ? 'USER' : 'ADMIN');
      res.json({ success: true, message: 'Pesan telah ditandai sebagai dibaca' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
