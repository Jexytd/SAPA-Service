import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processUserMessage } from '../nlp/matcher.js';
import {
  getBotStatus,
  resetWhatsAppAuth,
  requestPairing,
  suspendBot,
  resumeBot,
  getSuspendedSessions,
  isChatSuspended,
  refreshQRCode
} from '../bot/whatsapp.js';
import {
  loadBackendStore,
  saveBackendStore,
  getFAQDataFromStore,
  syncDataToFAQ,
  syncAllPublishedToFAQ,
  DataStatus,
  AuditAction,
  Dataset,
  DataRecord,
  ReviewRequest,
  AuditLog,
  Category,
  User
} from '../data/dbStore.js';
import { createTicketRouter } from '../routes/ticketRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebServer(): express.Express {
  const app = express();

  // ============================================================
  // 0. CORS & MIDDLEWARE CONFIGURATION
  // ============================================================
  const allowedOriginsEnv = process.env.FRONTEND_URL || '*';
  const allowedOrigins = allowedOriginsEnv.split(',').map(s => s.trim().toLowerCase());

  app.use(cors({
    origin: (origin, callback) => {
      // Izinkan request tanpa origin (seperti curl, mobile app, atau server-to-server)
      if (!origin || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      const originLower = origin.toLowerCase();
      if (allowedOrigins.includes(originLower)) {
        return callback(null, true);
      }
      // Izinkan subdomain vercel / ngrok jika origin cocok
      try {
        const originUrl = new URL(origin);
        const match = allowedOrigins.some(ao => {
          if (ao.startsWith('http')) {
            return new URL(ao).hostname === originUrl.hostname;
          }
          return originUrl.hostname.endsWith(ao.replace(/^\*\./, ''));
        });
        if (match) return callback(null, true);
      } catch {}
      // Default: izinkan untuk menjamin frontend hosting dapat berkomunikasi
      callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-user-id', 'ngrok-skip-browser-warning'],
    credentials: true
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Middleware kompatibilitas: Otomatis memetakan /api/backend/* ke /api/* jika dipanggil langsung dari hosting
  app.use((req, res, next) => {
    if (req.url.startsWith('/api/backend/')) {
      req.url = req.url.replace('/api/backend/', '/api/');
    }
    next();
  });

  // Mount Customer Service & Ticketing API router
  app.use('/api', createTicketRouter());

  // Helper generator ID
  const uid = () => Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

  // Middleware pengaman API key untuk endpoint sensitif (opsional jika API_KEY diatur di .env)
  const requireApiKey = (req: Request, res: Response, next: express.NextFunction) => {
    const configuredKey = process.env.API_KEY;
    if (!configuredKey) return next();
    const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (providedKey === configuredKey) return next();
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Akses ditolak. Kunci API tidak valid atau belum disertakan di header x-api-key.'
    });
  };

  // ============================================================
  // HEALTH CHECK ENDPOINT
  // ============================================================
  app.get('/health', (req: Request, res: Response) => {
    const bot = getBotStatus();
    res.json({
      status: 'ok',
      service: 'SAPA BPS WhatsApp Backend',
      port: process.env.PORT || '8000',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      botState: bot.state,
      botMode: bot.mode,
      activeSuspendedChatsCount: bot.activeSuspendedChatsCount,
      phoneNumber: bot.phoneNumber || null
    });
  });

  // ============================================================
  // BOT MANAGEMENT & CHAT ADMIN PELAYANAN (SUSPEND & RESUME)
  // ============================================================

  // GET /api/bot/status - Mendapatkan status bot, mode aktif/suspend, dan daftar chat pelayanan
  app.get('/api/bot/status', (req: Request, res: Response) => {
    const bot = getBotStatus();
    res.json({
      success: true,
      data: bot
    });
  });

  // POST /api/bot/suspend - Menjeda bot otomatis untuk chat spesifik (admin takeover) atau global
  app.post('/api/bot/suspend', (req: Request, res: Response) => {
    const { phone, reason, suspended_by, suspendedBy } = req.body;
    const result = suspendBot({ phone, reason, suspendedBy: suspendedBy || suspended_by });
    res.json({
      success: true,
      status: 'SUSPENDED',
      message: phone
        ? `Bot untuk nomor ${phone} berhasil di-suspend (Mode chat langsung dengan admin/pelayanan aktif)`
        : 'Bot berhasil di-suspend secara global',
      result
    });
  });

  // POST /api/bot/resume - Mengaktifkan kembali bot otomatis
  app.post('/api/bot/resume', (req: Request, res: Response) => {
    const { phone } = req.body;
    const result = resumeBot(phone);
    res.json({
      success: true,
      status: 'ACTIVE',
      message: phone
        ? `Bot untuk nomor ${phone} berhasil di-resume (Asisten otomatis aktif kembali)`
        : 'Bot berhasil di-resume secara global (Asisten otomatis aktif kembali)',
      result
    });
  });

  // GET /api/bot/sessions - Menampilkan semua sesi chat yang sedang ditangani admin
  app.get('/api/bot/sessions', (req: Request, res: Response) => {
    const sessions = getSuspendedSessions();
    res.json({
      success: true,
      count: sessions.length,
      data: sessions
    });
  });

  // GET /api/bot/sessions/:phone - Cek status satu nomor (apakah sedang di-suspend / chat admin)
  app.get('/api/bot/sessions/:phone', (req: Request, res: Response) => {
    const phone = String(req.params.phone || '');
    const suspended = isChatSuspended(phone);
    res.json({
      success: true,
      phone,
      isSuspended: suspended,
      status: suspended ? 'SUSPENDED' : 'ACTIVE'
    });
  });

  // POST /api/bot/pairing-code - Meminta pairing code 8-digit
  app.post('/api/bot/pairing-code', async (req: Request, res: Response) => {
    const { phone } = req.body;
    if (!phone) {
      res.status(400).json({ success: false, message: 'Nomor WhatsApp wajib diisi' });
      return;
    }
    try {
      const code = await requestPairing(phone);
      if (code) {
        res.json({ success: true, code, message: 'Pairing code berhasil didapatkan' });
      } else {
        res.status(400).json({ success: false, message: 'Bot sudah terhubung atau pairing belum siap' });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Gagal meminta pairing code' });
    }
  });

  // POST /api/bot/reset & /api/bot/logout - Reset sesi / putus koneksi bot
  app.post(['/api/bot/reset', '/api/bot/logout'], async (req: Request, res: Response) => {
    try {
      await resetWhatsAppAuth();
      res.json({ success: true, message: 'Sesi WhatsApp berhasil di-reset' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Gagal mereset sesi WhatsApp' });
    }
  });

  // POST /api/bot/refresh-qr - Memperbarui QR Code baru secara manual
  app.post('/api/bot/refresh-qr', async (req: Request, res: Response) => {
    try {
      const reason = req.body?.reason || 'Penyegaran QR Code diminta oleh pengguna';
      await refreshQRCode(reason);
      res.json({
        success: true,
        message: 'Proses penyegaran QR Code telah dipicu. QR code baru akan tersedia dalam beberapa saat.',
        data: getBotStatus()
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Gagal menyegarkan QR Code' });
    }
  });

  // ============================================================
  // 1. DATASETS REST API
  // ============================================================

  // GET /api/datasets
  app.get('/api/datasets', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const { category, search, status } = req.query;

    let list = [...store.datasets];

    if (status) {
      list = list.filter(d => d.status === status);
    }
    if (category) {
      const cat = String(category).toLowerCase();
      list = list.filter(d => d.category.toLowerCase().includes(cat));
    }
    if (search) {
      const q = String(search).toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.code.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        (d.description && d.description.toLowerCase().includes(q))
      );
    }

    // Update count
    list = list.map(d => ({
      ...d,
      record_count: store.records.filter(r => r.dataset_id === d.id && !r.is_deleted).length
    }));

    res.json({ success: true, data: list, count: list.length });
  });

  // GET /api/datasets/:id
  app.get('/api/datasets/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const dataset = store.datasets.find(d => d.id === req.params.id);
    if (!dataset) {
      res.status(404).json({ success: false, error: 'Dataset tidak ditemukan.' });
      return;
    }
    const count = store.records.filter(r => r.dataset_id === dataset.id && !r.is_deleted).length;
    res.json({ success: true, data: { ...dataset, record_count: count } });
  });

  // POST /api/datasets
  app.post('/api/datasets', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const body = req.body;

    if (!body.name || !body.code || !body.category) {
      res.status(400).json({ success: false, error: 'Nama, kode, dan kategori dataset wajib diisi.' });
      return;
    }

    const now = new Date().toISOString();
    const targetId = body.id || `ds-${uid()}`;
    const existingIdx = store.datasets.findIndex(d => d.id === targetId || d.code.trim().toUpperCase() === body.code.trim().toUpperCase());

    const newDataset: Dataset = {
      id: existingIdx !== -1 ? store.datasets[existingIdx].id : targetId,
      code: body.code.trim().toUpperCase(),
      name: body.name.trim(),
      category: body.category.trim(),
      description: body.description || '',
      definition: body.definition || '',
      geographic_scope: body.geographic_scope || 'Kabupaten Bangka',
      unit: body.unit || '',
      source: body.source || 'BPS Kabupaten Bangka',
      period_type: body.period_type || 'YEARLY',
      status: body.status || DataStatus.DRAFT,
      created_by: body.created_by || 'user-1',
      updated_by: body.updated_by || 'user-1',
      created_at: existingIdx !== -1 ? store.datasets[existingIdx].created_at : now,
      updated_at: now,
      record_count: existingIdx !== -1 ? store.datasets[existingIdx].record_count || 0 : 0
    };

    if (existingIdx !== -1) {
      store.datasets[existingIdx] = newDataset;
    } else {
      store.datasets.unshift(newDataset);
    }

    // Audit log
    store.auditLogs.unshift({
      id: `log-${uid()}`,
      entity_type: 'dataset',
      entity_id: newDataset.id,
      entity_name: newDataset.name,
      action: existingIdx !== -1 ? AuditAction.UPDATE : AuditAction.CREATE,
      changes: [{ field: 'status', old_value: null, new_value: newDataset.status }],
      user_id: newDataset.created_by,
      user_name: store.users.find(u => u.id === newDataset.created_by)?.name || 'Admin',
      created_at: now
    });

    saveBackendStore(store);
    res.status(existingIdx !== -1 ? 200 : 201).json({ success: true, data: newDataset });
  });

  // PUT /api/datasets/:id
  app.put('/api/datasets/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const idx = store.datasets.findIndex(d => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Dataset tidak ditemukan.' });
      return;
    }

    const existing = store.datasets[idx];
    const body = req.body;
    const now = new Date().toISOString();

    const updated: Dataset = {
      ...existing,
      ...body,
      id: existing.id,
      updated_at: now,
    };

    store.datasets[idx] = updated;

    // Audit log
    store.auditLogs.unshift({
      id: `log-${uid()}`,
      entity_type: 'dataset',
      entity_id: updated.id,
      entity_name: updated.name,
      action: AuditAction.UPDATE,
      changes: [{ field: 'updated', old_value: existing.updated_at, new_value: now }],
      user_id: body.updated_by || 'user-1',
      user_name: store.users.find(u => u.id === body.updated_by)?.name || 'Petugas',
      created_at: now
    });

    saveBackendStore(store);
    res.json({ success: true, data: updated });
  });

  // DELETE /api/datasets/:id
  app.delete('/api/datasets/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const idx = store.datasets.findIndex(d => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Dataset tidak ditemukan.' });
      return;
    }

    const deleted = store.datasets.splice(idx, 1)[0];
    // soft delete associated records
    store.records.forEach(r => {
      if (r.dataset_id === deleted.id) r.is_deleted = true;
    });

    saveBackendStore(store);
    res.json({ success: true, message: 'Dataset berhasil dihapus.' });
  });

  // ============================================================
  // 2. DATA RECORDS REST API
  // ============================================================

  // GET /api/records
  app.get('/api/records', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const { dataset_id, period, region, indicator, status } = req.query;

    let list = store.records.filter(r => !r.is_deleted);

    if (dataset_id) {
      list = list.filter(r => r.dataset_id === dataset_id);
    }
    if (period) {
      list = list.filter(r => r.period === String(period));
    }
    if (region) {
      list = list.filter(r => r.region.toLowerCase().includes(String(region).toLowerCase()));
    }
    if (indicator) {
      list = list.filter(r => r.indicator.toLowerCase().includes(String(indicator).toLowerCase()));
    }
    if (status) {
      list = list.filter(r => r.status === status);
    }

    res.json({ success: true, data: list, count: list.length });
  });

  // GET /api/records/:id
  app.get('/api/records/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const record = store.records.find(r => r.id === req.params.id && !r.is_deleted);
    if (!record) {
      res.status(404).json({ success: false, error: 'Record tidak ditemukan.' });
      return;
    }
    res.json({ success: true, data: record });
  });

  // POST /api/records
  app.post('/api/records', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const body = req.body;
    const now = new Date().toISOString();

    const targetId = body.id || `rec-${uid()}`;
    const existingIdx = store.records.findIndex(r => r.id === targetId);

    const newRecord: DataRecord = {
      id: targetId,
      dataset_id: body.dataset_id,
      indicator: body.indicator || '',
      region: body.region || 'Kabupaten Bangka',
      period: String(body.period || new Date().getFullYear()),
      value: body.value !== undefined ? (body.value === null ? null : Number(body.value)) : null,
      unit: body.unit || '',
      notes: body.notes || '',
      source: body.source || 'BPS Kabupaten Bangka',
      status: body.status || DataStatus.DRAFT,
      created_by: body.created_by || 'user-1',
      updated_by: body.updated_by || 'user-1',
      created_at: existingIdx !== -1 ? store.records[existingIdx].created_at : now,
      updated_at: now,
      is_deleted: false
    };

    if (existingIdx !== -1) {
      store.records[existingIdx] = newRecord;
    } else {
      store.records.push(newRecord);
    }
    saveBackendStore(store);

    // Jika langsung dipublish, sinkronkan ke FAQ CSV
    if (newRecord.status === DataStatus.PUBLISHED) {
      const parentDs = store.datasets.find(d => d.id === newRecord.dataset_id);
      if (parentDs) {
        syncDataToFAQ(parentDs.category, newRecord.indicator, newRecord.period, newRecord.value ?? '-', newRecord.unit);
      }
    }

    res.status(existingIdx !== -1 ? 200 : 201).json({ success: true, data: newRecord });
  });

  // PUT /api/records/:id
  app.put('/api/records/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const idx = store.records.findIndex(r => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Record tidak ditemukan.' });
      return;
    }

    const existing = store.records[idx];
    const body = req.body;
    const now = new Date().toISOString();

    const updated: DataRecord = {
      ...existing,
      ...body,
      id: existing.id,
      value: body.value !== undefined ? (body.value === null ? null : Number(body.value)) : existing.value,
      updated_at: now
    };

    store.records[idx] = updated;
    saveBackendStore(store);

    if (updated.status === DataStatus.PUBLISHED) {
      const parentDs = store.datasets.find(d => d.id === updated.dataset_id);
      if (parentDs) {
        syncDataToFAQ(parentDs.category, updated.indicator, updated.period, updated.value ?? '-', updated.unit);
      }
    }

    res.json({ success: true, data: updated });
  });

  // DELETE /api/records/:id
  app.delete('/api/records/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const record = store.records.find(r => r.id === req.params.id);
    if (!record) {
      res.status(404).json({ success: false, error: 'Record tidak ditemukan.' });
      return;
    }

    record.is_deleted = true;
    record.updated_at = new Date().toISOString();
    saveBackendStore(store);

    res.json({ success: true, message: 'Record berhasil dihapus.' });
  });

  // POST /api/records/bulk
  app.post('/api/records/bulk', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const { dataset_id, records } = req.body;

    if (!Array.isArray(records)) {
      res.status(400).json({ success: false, error: 'Format records harus array.' });
      return;
    }

    const now = new Date().toISOString();
    const processed: DataRecord[] = [];

    for (const item of records) {
      if (item.id) {
        const existingIdx = store.records.findIndex(r => r.id === item.id);
        if (existingIdx !== -1) {
          store.records[existingIdx] = {
            ...store.records[existingIdx],
            ...item,
            updated_at: now
          };
          processed.push(store.records[existingIdx]);
          continue;
        }
      }

      const newRec: DataRecord = {
        id: item.id || `rec-${uid()}`,
        dataset_id: item.dataset_id || dataset_id,
        indicator: item.indicator || '',
        region: item.region || 'Kabupaten Bangka',
        period: String(item.period || new Date().getFullYear()),
        value: item.value !== undefined ? (item.value === null ? null : Number(item.value)) : null,
        unit: item.unit || '',
        notes: item.notes || '',
        source: item.source || 'BPS Kabupaten Bangka',
        status: item.status || DataStatus.DRAFT,
        created_by: item.created_by || 'user-1',
        updated_by: item.updated_by || 'user-1',
        created_at: now,
        updated_at: now,
        is_deleted: false
      };
      store.records.push(newRec);
      processed.push(newRec);
    }

    saveBackendStore(store);
    res.json({ success: true, data: processed, count: processed.length });
  });

  // ============================================================
  // 3. REVIEWS & AUDIT LOGS REST API
  // ============================================================

  // GET /api/reviews
  app.get('/api/reviews', (req: Request, res: Response) => {
    const store = loadBackendStore();
    res.json({ success: true, data: store.reviews });
  });

  // POST /api/reviews (submit review)
  app.post('/api/reviews', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const body = req.body;
    const now = new Date().toISOString();

    const parentDs = store.datasets.find(d => d.id === body.dataset_id);
    const newRev: ReviewRequest = {
      id: `rev-${uid()}`,
      dataset_id: body.dataset_id,
      dataset_name: parentDs?.name || body.dataset_name || 'Dataset BPS',
      record_ids: body.record_ids || [],
      description: body.description || 'Pengajuan review dan verifikasi data statistik.',
      submitted_by: body.submitted_by || 'user-1',
      submitted_by_name: store.users.find(u => u.id === body.submitted_by)?.name || 'Ahmad Fauzi',
      submitted_at: now,
      status: 'PENDING'
    };

    // Update dataset status to REVIEW
    if (parentDs) {
      parentDs.status = DataStatus.REVIEW;
      parentDs.updated_at = now;
    }

    // Update record status
    if (newRev.record_ids.length > 0) {
      store.records.forEach(r => {
        if (newRev.record_ids.includes(r.id)) {
          r.status = DataStatus.REVIEW;
          r.updated_at = now;
        }
      });
    }

    store.reviews.unshift(newRev);

    store.auditLogs.unshift({
      id: `log-${uid()}`,
      entity_type: 'dataset',
      entity_id: newRev.dataset_id,
      entity_name: newRev.dataset_name,
      action: AuditAction.SUBMIT_REVIEW,
      changes: [{ field: 'status', old_value: 'DRAFT', new_value: 'REVIEW' }],
      user_id: newRev.submitted_by,
      user_name: newRev.submitted_by_name,
      reason: newRev.description,
      created_at: now
    });

    saveBackendStore(store);
    res.status(201).json({ success: true, data: newRev });
  });

  // POST /api/reviews/:id/approve
  app.post('/api/reviews/:id/approve', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const rev = store.reviews.find(r => r.id === req.params.id);
    if (!rev) {
      res.status(404).json({ success: false, error: 'Permintaan review tidak ditemukan.' });
      return;
    }

    const { reviewer_id } = req.body;
    const now = new Date().toISOString();
    const reviewerName = store.users.find(u => u.id === reviewer_id)?.name || 'Siti Nurhaliza';

    rev.status = 'APPROVED';
    rev.reviewed_by = reviewer_id || 'user-2';
    rev.reviewed_by_name = reviewerName;
    rev.reviewed_at = now;

    // Publish dataset and records
    const ds = store.datasets.find(d => d.id === rev.dataset_id);
    if (ds) {
      ds.status = DataStatus.PUBLISHED;
      ds.updated_at = now;
    }

    store.records.forEach(r => {
      if (r.dataset_id === rev.dataset_id && (rev.record_ids.length === 0 || rev.record_ids.includes(r.id))) {
        r.status = DataStatus.PUBLISHED;
        r.updated_at = now;
        // Sync to FAQ CSV
        if (ds) {
          syncDataToFAQ(ds.category, r.indicator, r.period, r.value ?? '-', r.unit);
        }
      }
    });

    store.auditLogs.unshift({
      id: `log-${uid()}`,
      entity_type: 'dataset',
      entity_id: rev.dataset_id,
      entity_name: rev.dataset_name,
      action: AuditAction.APPROVE,
      changes: [{ field: 'status', old_value: 'REVIEW', new_value: 'PUBLISHED' }],
      user_id: rev.reviewed_by || 'user-2',
      user_name: rev.reviewed_by_name || 'Siti Nurhaliza',
      reason: 'Data diverifikasi & disetujui untuk publikasi.',
      created_at: now
    });

    saveBackendStore(store);
    res.json({ success: true, data: rev, message: 'Data berhasil disetujui dan dipublikasikan.' });
  });

  // POST /api/reviews/:id/reject
  app.post('/api/reviews/:id/reject', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const rev = store.reviews.find(r => r.id === req.params.id);
    if (!rev) {
      res.status(404).json({ success: false, error: 'Permintaan review tidak ditemukan.' });
      return;
    }

    const { reviewer_id, reason } = req.body;
    const now = new Date().toISOString();
    const reviewerName = store.users.find(u => u.id === reviewer_id)?.name || 'Siti Nurhaliza';

    rev.status = 'REJECTED';
    rev.reviewed_by = reviewer_id || 'user-2';
    rev.reviewed_by_name = reviewerName;
    rev.reviewed_at = now;
    rev.reject_reason = reason || 'Perlu perbaikan data statistik.';

    const ds = store.datasets.find(d => d.id === rev.dataset_id);
    if (ds) {
      ds.status = DataStatus.DRAFT;
      ds.updated_at = now;
    }

    store.records.forEach(r => {
      if (r.dataset_id === rev.dataset_id && (rev.record_ids.length === 0 || rev.record_ids.includes(r.id))) {
        r.status = DataStatus.DRAFT;
        r.updated_at = now;
      }
    });

    store.auditLogs.unshift({
      id: `log-${uid()}`,
      entity_type: 'dataset',
      entity_id: rev.dataset_id,
      entity_name: rev.dataset_name,
      action: AuditAction.REJECT,
      changes: [{ field: 'status', old_value: 'REVIEW', new_value: 'DRAFT' }],
      user_id: rev.reviewed_by || 'user-2',
      user_name: rev.reviewed_by_name || 'Siti Nurhaliza',
      reason: rev.reject_reason,
      created_at: now
    });

    saveBackendStore(store);
    res.json({ success: true, data: rev, message: 'Review ditolak, status dikembalikan ke Draft.' });
  });

  // GET /api/reviews/:id
  app.get('/api/reviews/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const rev = store.reviews.find(r => r.id === req.params.id);
    if (!rev) {
      res.status(404).json({ success: false, error: 'Permintaan review tidak ditemukan.' });
      return;
    }
    res.json({ success: true, data: rev });
  });

  // DELETE /api/reviews/:id
  app.delete('/api/reviews/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const idx = store.reviews.findIndex(r => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Permintaan review tidak ditemukan.' });
      return;
    }
    store.reviews.splice(idx, 1);
    saveBackendStore(store);
    res.json({ success: true, message: 'Permintaan review berhasil dihapus.' });
  });

  // GET /api/audit-logs
  app.get('/api/audit-logs', (req: Request, res: Response) => {
    const store = loadBackendStore();
    res.json({ success: true, data: store.auditLogs });
  });

  // POST /api/audit-logs
  app.post('/api/audit-logs', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const body = req.body;
    const now = new Date().toISOString();

    const log: AuditLog = {
      id: body.id || `log-${uid()}`,
      entity_type: body.entity_type || 'dataset',
      entity_id: body.entity_id || '',
      entity_name: body.entity_name || '',
      action: body.action || AuditAction.UPDATE,
      changes: body.changes || [],
      user_id: body.user_id || 'user-1',
      user_name: body.user_name || store.users.find(u => u.id === body.user_id)?.name || 'Petugas',
      reason: body.reason,
      created_at: now
    };

    store.auditLogs.unshift(log);
    saveBackendStore(store);
    res.status(201).json({ success: true, data: log });
  });

  // DELETE /api/audit-logs
  app.delete('/api/audit-logs', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const { id } = req.query;
    if (id) {
      const idx = store.auditLogs.findIndex(l => l.id === id);
      if (idx !== -1) {
        store.auditLogs.splice(idx, 1);
        saveBackendStore(store);
        return res.json({ success: true, message: 'Log berhasil dihapus.' });
      }
      return res.status(404).json({ success: false, error: 'Log tidak ditemukan.' });
    }
    // Clear all if no ID specified
    store.auditLogs = [];
    saveBackendStore(store);
    res.json({ success: true, message: 'Seluruh riwayat audit log berhasil dibersihkan.' });
  });

  // ============================================================
  // 4. USERS & CATEGORIES & DASHBOARD SUMMARY & STORE SYNC
  // ============================================================

  // GET /api/users
  app.get('/api/users', (req: Request, res: Response) => {
    const store = loadBackendStore();
    res.json({ success: true, data: store.users });
  });

  // GET /api/users/:id
  app.get('/api/users/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const user = store.users.find(u => u.id === req.params.id);
    if (!user) {
      res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
      return;
    }
    res.json({ success: true, data: user });
  });

  // POST /api/users
  app.post('/api/users', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const body = req.body;
    if (!body.name || !body.email) {
      res.status(400).json({ success: false, error: 'Nama dan email pengguna wajib diisi.' });
      return;
    }
    const targetId = body.id || `user-${uid()}`;
    const existingIdx = store.users.findIndex(u => u.id === targetId || u.email.toLowerCase() === body.email.toLowerCase());
    const newUser = {
      id: existingIdx !== -1 ? store.users[existingIdx].id : targetId,
      name: body.name.trim(),
      email: body.email.trim(),
      role: body.role || 'DATA_ENTRY',
      created_at: existingIdx !== -1 ? store.users[existingIdx].created_at : new Date().toISOString(),
    };
    if (existingIdx !== -1) {
      store.users[existingIdx] = newUser as any;
    } else {
      store.users.push(newUser as any);
    }
    saveBackendStore(store);
    res.status(existingIdx !== -1 ? 200 : 201).json({ success: true, data: newUser });
  });

  // PUT /api/users/:id
  app.put('/api/users/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const idx = store.users.findIndex(u => u.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
      return;
    }
    store.users[idx] = { ...store.users[idx], ...req.body, id: store.users[idx].id };
    saveBackendStore(store);
    res.json({ success: true, data: store.users[idx] });
  });

  // DELETE /api/users/:id
  app.delete('/api/users/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const idx = store.users.findIndex(u => u.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
      return;
    }
    store.users.splice(idx, 1);
    saveBackendStore(store);
    res.json({ success: true, message: 'User berhasil dihapus.' });
  });

  // GET /api/categories
  app.get('/api/categories', (req: Request, res: Response) => {
    const store = loadBackendStore();
    // Sertakan jumlah dataset aktif per kategori
    const listWithCount = store.categories.map(c => ({
      ...c,
      dataset_count: store.datasets.filter(d => d.category.toLowerCase().trim() === c.name.toLowerCase().trim()).length
    }));
    res.json({ success: true, data: listWithCount });
  });

  // GET /api/categories/:id
  app.get('/api/categories/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const cat = store.categories.find(c => c.id === req.params.id);
    if (!cat) {
      res.status(404).json({ success: false, error: 'Kategori tidak ditemukan.' });
      return;
    }
    res.json({ success: true, data: cat });
  });

  // POST /api/categories
  app.post('/api/categories', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const body = req.body;
    if (!body.name) {
      res.status(400).json({ success: false, error: 'Nama kategori wajib diisi.' });
      return;
    }
    const targetId = body.id || `cat-${uid()}`;
    const existingIdx = store.categories.findIndex(c => c.id === targetId || c.name.toLowerCase() === body.name.toLowerCase());
    const newCat = {
      id: existingIdx !== -1 ? store.categories[existingIdx].id : targetId,
      name: body.name.trim(),
      code: body.code ? body.code.trim().toUpperCase() : body.name.slice(0, 4).toUpperCase(),
      description: body.description || ''
    };
    if (existingIdx !== -1) {
      store.categories[existingIdx] = newCat;
    } else {
      store.categories.push(newCat);
    }
    saveBackendStore(store);
    res.status(existingIdx !== -1 ? 200 : 201).json({ success: true, data: newCat });
  });

  // PUT /api/categories/:id
  app.put('/api/categories/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const idx = store.categories.findIndex(c => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Kategori tidak ditemukan.' });
      return;
    }
    const oldName = store.categories[idx].name;
    const updated = {
      ...store.categories[idx],
      ...req.body,
      id: store.categories[idx].id,
      name: req.body.name ? req.body.name.trim() : store.categories[idx].name
    };
    store.categories[idx] = updated;

    // Jika nama kategori berubah, perbarui juga category pada dataset terkait
    if (req.body.name && req.body.name.trim() !== oldName) {
      store.datasets.forEach(d => {
        if (d.category === oldName) d.category = req.body.name.trim();
      });
    }

    saveBackendStore(store);
    res.json({ success: true, data: updated });
  });

  // DELETE /api/categories/:id
  app.delete('/api/categories/:id', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const idx = store.categories.findIndex(c => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Kategori tidak ditemukan.' });
      return;
    }
    store.categories.splice(idx, 1);
    saveBackendStore(store);
    res.json({ success: true, message: 'Kategori berhasil dihapus.' });
  });

  // GET /api/sync/store (Ambil snapshot lengkap database backend)
  app.get('/api/sync/store', (req: Request, res: Response) => {
    const store = loadBackendStore();
    res.json({
      success: true,
      data: {
        datasets: store.datasets,
        records: store.records.filter(r => !r.is_deleted),
        categories: store.categories,
        users: store.users,
        reviews: store.reviews,
        auditLogs: store.auditLogs,
      }
    });
  });

  // POST /api/sync/store (Sinkronisasi snapshot database dua arah dengan frontend)
  app.post('/api/sync/store', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const {
      datasets,
      records,
      categories,
      users,
      reviews,
      auditLogs,
      deleted_dataset_ids,
      deleted_record_ids
    } = req.body;
    let modified = false;

    // 1. Tangani Penghapusan Dataset yang diminta frontend
    if (Array.isArray(deleted_dataset_ids) && deleted_dataset_ids.length > 0) {
      const delDsSet = new Set(deleted_dataset_ids);
      const prevCount = store.datasets.length;
      store.datasets = store.datasets.filter(d => !delDsSet.has(d.id));
      if (store.datasets.length !== prevCount) modified = true;
      // Soft-delete records milik dataset yang dihapus
      store.records.forEach(r => {
        if (delDsSet.has(r.dataset_id) && !r.is_deleted) {
          r.is_deleted = true;
          modified = true;
        }
      });
    }

    // 2. Tangani Penghapusan Record yang diminta frontend
    if (Array.isArray(deleted_record_ids) && deleted_record_ids.length > 0) {
      const delRecSet = new Set(deleted_record_ids);
      store.records.forEach(r => {
        if (delRecSet.has(r.id) && !r.is_deleted) {
          r.is_deleted = true;
          modified = true;
        }
      });
    }

    // Merge Categories
    if (Array.isArray(categories)) {
      for (const c of categories) {
        const cNameLower = (c.name || '').toLowerCase().trim();
        const existingCat = store.categories.find(sc => sc.id === c.id || sc.name.toLowerCase().trim() === cNameLower);
        if (!existingCat) {
          store.categories.push(c);
          modified = true;
        }
      }
    }

    // Merge Users
    if (Array.isArray(users)) {
      for (const u of users) {
        const uEmailLower = (u.email || '').toLowerCase().trim();
        const existingUser = store.users.find(su => su.id === u.id || su.email.toLowerCase().trim() === uEmailLower);
        if (!existingUser) {
          store.users.push(u);
          modified = true;
        }
      }
    }

    // Merge Datasets
    if (Array.isArray(datasets)) {
      for (const ds of datasets) {
        if (!ds.id) continue;
        const existingIdx = store.datasets.findIndex(sd => sd.id === ds.id || sd.code.toUpperCase() === ds.code.toUpperCase());
        if (existingIdx === -1) {
          store.datasets.push(ds);
          modified = true;
        } else {
          // If frontend has newer updated_at
          if (ds.updated_at && (!store.datasets[existingIdx].updated_at || new Date(ds.updated_at) > new Date(store.datasets[existingIdx].updated_at))) {
            store.datasets[existingIdx] = { ...store.datasets[existingIdx], ...ds };
            modified = true;
          }
        }
      }
    }

    // Merge Records
    if (Array.isArray(records)) {
      for (const rec of records) {
        if (!rec.id) continue;
        const existingIdx = store.records.findIndex(sr => sr.id === rec.id);
        if (existingIdx === -1) {
          store.records.push(rec);
          modified = true;
        } else {
          if (rec.updated_at && (!store.records[existingIdx].updated_at || new Date(rec.updated_at) > new Date(store.records[existingIdx].updated_at))) {
            store.records[existingIdx] = { ...store.records[existingIdx], ...rec };
            modified = true;
          }
        }
      }
    }

    // Merge Reviews
    if (Array.isArray(reviews)) {
      for (const rev of reviews) {
        if (!rev.id) continue;
        const revIdx = store.reviews.findIndex(sr => sr.id === rev.id);
        if (revIdx === -1) {
          store.reviews.push(rev);
          modified = true;
        } else if (rev.status !== store.reviews[revIdx].status) {
          store.reviews[revIdx] = { ...store.reviews[revIdx], ...rev };
          modified = true;
        }
      }
    }

    // Merge AuditLogs
    if (Array.isArray(auditLogs)) {
      for (const log of auditLogs) {
        if (!log.id) continue;
        if (!store.auditLogs.some(sl => sl.id === log.id)) {
          store.auditLogs.push(log);
          modified = true;
        }
      }
    }

    // Update dataset record_count counts
    store.datasets.forEach(d => {
      d.record_count = store.records.filter(r => r.dataset_id === d.id && !r.is_deleted).length;
    });

    if (modified) {
      saveBackendStore(store);
    }
    syncAllPublishedToFAQ();

    res.json({
      success: true,
      message: 'Database backend berhasil disinkronkan.',
      data: {
        datasets: store.datasets,
        records: store.records.filter(r => !r.is_deleted),
        categories: store.categories,
        users: store.users,
        reviews: store.reviews,
        auditLogs: store.auditLogs,
      }
    });
  });

  // GET /api/dashboard/summary
  app.get('/api/dashboard/summary', (req: Request, res: Response) => {
    const store = loadBackendStore();
    const activeRecords = store.records.filter(r => !r.is_deleted);
    const summary = {
      total_datasets: store.datasets.length,
      published_records: activeRecords.filter(r => r.status === DataStatus.PUBLISHED).length,
      draft_records: activeRecords.filter(r => r.status === DataStatus.DRAFT).length,
      pending_review: store.reviews.filter(r => r.status === 'PENDING').length
    };
    res.json({ success: true, data: summary });
  });

  // ============================================================
  // 5. BOT WHATSAPP & AI CHAT INTEGRATION
  // ============================================================

  // GET /api/bot/status
  app.get('/api/bot/status', (req: Request, res: Response) => {
    const status = getBotStatus();
    res.json({
      success: true,
      data: {
        ...status,
        serverTime: new Date().toISOString()
      }
    });
  });

  // POST /api/bot/reset - Memaksa pembersihan sesi lama dan memicu QR baru
  app.post('/api/bot/reset', async (req: Request, res: Response) => {
    try {
      await resetWhatsAppAuth();
      res.json({ success: true, message: 'Sesi WhatsApp berhasil direset. Silakan tunggu QR code baru.' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Gagal reset sesi' });
    }
  });

  // POST /api/bot/logout - Memutuskan sambungan host dan memicu QR baru untuk login ulang
  app.post('/api/bot/logout', async (req: Request, res: Response) => {
    try {
      await resetWhatsAppAuth();
      res.json({ success: true, message: 'Sambungan host berhasil diputuskan. Menyiapkan QR code baru...' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Gagal logout' });
    }
  });

  // POST /api/bot/pairing-code - Meminta kode 8-digit untuk login tanpa scan kamera
  app.post('/api/bot/pairing-code', async (req: Request, res: Response) => {
    const { phone } = req.body;
    if (!phone) {
      res.status(400).json({ success: false, message: 'Nomor telepon wajib diisi' });
      return;
    }
    try {
      const code = await requestPairing(phone);
      if (code) {
        res.json({ success: true, code });
      } else {
        res.status(400).json({ success: false, message: 'Bot sudah terhubung atau socket belum siap. Coba refresh halaman.' });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Gagal meminta pairing code' });
    }
  });



  // POST /api/chat & /chat
  const handleChat = async (req: Request, res: Response) => {
    const message = req.body.message || '';
    const sessionId = req.body.sessionId || String(req.ip || 'web-client');
    if (!message.trim()) {
      res.json({ success: false, response: 'Silakan ketik pertanyaan atau topik statistik resmi BPS.' });
      return;
    }
    const reply = await processUserMessage(message, undefined, sessionId);
    res.json({ success: true, response: reply });
  };

  app.post('/api/chat', handleChat);
  app.post('/chat', handleChat);

  app.post('/webhook/whatsapp', async (req: Request, res: Response) => {
    const message = req.body.message || '';
    const sessionId = req.body.sessionId || String(req.ip || 'webhook-client');
    const reply = await processUserMessage(message, undefined, sessionId);
    res.json({ status: 'success', response: reply });
  });

  // ============================================================
  // 6. FAQ & STATS REST API (Powered by db.json)
  // ============================================================

  app.get('/api/faqs', (req: Request, res: Response) => {
    const data = getFAQDataFromStore();
    const list = Object.entries(data).map(([pertanyaan, jawaban]) => ({
      pertanyaan,
      jawaban
    }));
    res.json(list);
  });

  // POST /api/faqs/save - Menyimpan atau memperbarui FAQ
  app.post('/api/faqs/save', (req: Request, res: Response) => {
    const { pertanyaan, jawaban, old_pertanyaan } = req.body;
    if (!pertanyaan || !jawaban) {
      res.status(400).json({ status: 'error', message: 'Pertanyaan dan jawaban wajib diisi' });
      return;
    }
    const store = loadBackendStore();
    if (!Array.isArray(store.customFaqs)) store.customFaqs = [];

    const now = new Date().toISOString();
    const existingIndex = store.customFaqs.findIndex(f => 
      f.pertanyaan.toLowerCase() === (old_pertanyaan || pertanyaan).toLowerCase()
    );

    if (existingIndex >= 0) {
      store.customFaqs[existingIndex].pertanyaan = pertanyaan.trim();
      store.customFaqs[existingIndex].jawaban = jawaban.trim();
      store.customFaqs[existingIndex].updated_at = now;
    } else {
      store.customFaqs.push({
        id: 'faq-' + Date.now(),
        pertanyaan: pertanyaan.trim(),
        jawaban: jawaban.trim(),
        created_at: now,
        updated_at: now
      });
    }

    saveBackendStore(store);
    res.json({ status: 'success', message: 'FAQ berhasil disimpan' });
  });

  // POST /api/faqs/delete - Menghapus FAQ
  app.post('/api/faqs/delete', (req: Request, res: Response) => {
    const { pertanyaan } = req.body;
    if (!pertanyaan) {
      res.status(400).json({ status: 'error', message: 'Pertanyaan wajib disertakan' });
      return;
    }
    const store = loadBackendStore();
    if (Array.isArray(store.customFaqs)) {
      store.customFaqs = store.customFaqs.filter(f => 
        f.pertanyaan.toLowerCase() !== pertanyaan.toLowerCase()
      );
      saveBackendStore(store);
    }
    res.json({ status: 'success', message: 'FAQ berhasil dihapus' });
  });

  app.get('/api/download-json', (req: Request, res: Response) => {
    const STORE_FILE = path.resolve(__dirname, '../../db.json');
    if (fs.existsSync(STORE_FILE)) {
      res.download(STORE_FILE, 'db.json');
    } else {
      res.status(404).json({ status: 'error', message: 'File database db.json belum tersedia' });
    }
  });

  // ============================================================
  // 7. REST API ROOT & STATUS (API ONLY - NO UI)
  // ============================================================

  app.get('/', (req: Request, res: Response) => {
    res.json({
      service: 'SAPA BPS REST API Backend',
      status: 'online',
      version: '2.1.0',
      description: 'API-only headless backend service for SAPA BPS Kab. Bangka',
      endpoints: {
        health: '/health',
        datasets: '/api/datasets',
        records: '/api/records',
        faqs: '/api/faqs',
        reviews: '/api/reviews',
        users: '/api/users',
        auditLogs: '/api/audit-logs',
        tickets: '/api/tickets',
        csEvents: '/api/cs/events',
        csAdmins: '/api/cs/admins',
        csSettings: '/api/cs/settings',
        wsEndpoint: '/ws/cs'
      }
    });
  });

  return app;
}
