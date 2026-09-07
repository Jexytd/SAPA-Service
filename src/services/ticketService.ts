import { getDBPool } from '../data/database.js';
import { realtimeHub } from './realtimeHub.js';
import { resolveWhatsAppTarget } from '../bot/whatsappUtils.js';
import crypto from 'crypto';

export type TicketStatus = 'WAITING' | 'ASSIGNED' | 'ACTIVE' | 'PENDING' | 'RESOLVED' | 'CLOSED';
export type ConversationMode = 'BOT' | 'HUMAN';
export type SenderType = 'USER' | 'BOT' | 'ADMIN' | 'SYSTEM';
export type MessageType = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'LOCATION' | 'BUTTON' | 'SYSTEM_EVENT';
export type ClosedByType = 'USER' | 'ADMIN' | 'SYSTEM';

export interface User {
  id: string;
  phone_number: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Admin {
  id: string;
  username: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'AGENT';
  is_active: boolean;
  created_at: string;
}

export interface Ticket {
  id: string;
  ticket_number: string;
  user_id: string;
  user_phone?: string;
  user_name?: string;
  status: TicketStatus;
  mode: ConversationMode;
  assigned_to: string | null;
  admin_name?: string | null;
  assigned_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  closed_by_type: ClosedByType | null;
  closed_by_id: string | null;
  close_reason: string | null;
  last_message_at: string;
  unread_admin_count: number;
  unread_user_count: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  ticket_id: string;
  sender_type: SenderType;
  sender_id: string;
  sender_name?: string;
  message: string;
  message_type: MessageType;
  external_message_id: string | null;
  metadata: any;
  read_at: string | null;
  created_at: string;
}

/**
 * Helper untuk menghasilkan string datetime Waktu Indonesia Barat (WIB / UTC+7)
 * Format MySQL DATETIME: YYYY-MM-DD HH:mm:ss
 */
export function getWIBDateTime(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d).replace('T', ' ');
  } catch {
    const wib = new Date(d.getTime() + 7 * 3600 * 1000);
    return wib.toISOString().slice(0, 19).replace('T', ' ');
  }
}

/**
 * Helper untuk menghasilkan kode tanggal YYYYMMDD dalam WIB (untuk prefix nomor tiket)
 */
export function getWIBDateCode(d: Date = new Date()): string {
  return getWIBDateTime(d).slice(0, 10).replace(/-/g, '');
}

export class TicketService {
  private static instance: TicketService;

  public static getInstance(): TicketService {
    if (!TicketService.instance) {
      TicketService.instance = new TicketService();
    }
    return TicketService.instance;
  }

  // Helper generator UUID
  private uuid(): string {
    return crypto.randomUUID();
  }

  // 1. CARI ATAU BUAT USER DARI NOMOR WHATSAPP
  public async findOrCreateUser(phoneNumber: string, name?: string): Promise<User> {
    const pool = getDBPool();
    if (!pool) throw new Error('Database pool tidak tersedia');

    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const target = resolveWhatsAppTarget(phoneNumber);
    const canonicalPhone = target.phone || cleanPhone;

    const candidates = Array.from(new Set([cleanPhone, canonicalPhone, phoneNumber].filter(Boolean)));
    const placeholders = candidates.map(() => '?').join(', ');
    const [rows]: any = await pool.query(`SELECT * FROM users WHERE phone_number IN (${placeholders})`, candidates);

    if (rows.length > 0) {
      // Jika di DB tercatat LID namun sekarang sudah terpetakan nomor telepon aslinya, perbarui ke nomor asli
      if (canonicalPhone && rows[0].phone_number !== canonicalPhone && canonicalPhone.length <= 13) {
        await pool.query('UPDATE users SET phone_number = ? WHERE id = ?', [canonicalPhone, rows[0].id]);
        rows[0].phone_number = canonicalPhone;
      }
      if (name && rows[0].name !== name) {
        await pool.query('UPDATE users SET name = ? WHERE id = ?', [name, rows[0].id]);
        rows[0].name = name;
      }
      return rows[0] as User;
    }

    const nowStr = getWIBDateTime();
    const newUser: User = {
      id: this.uuid(),
      phone_number: canonicalPhone,
      name: name || `Pengguna WhatsApp (${canonicalPhone.slice(-4)})`,
      created_at: nowStr,
      updated_at: nowStr
    };

    await pool.query(
      'INSERT INTO users (id, phone_number, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [newUser.id, newUser.phone_number, newUser.name, newUser.created_at, newUser.updated_at]
    );

    return newUser;
  }

  // 2. CEK TIKET AKTIF PENGGUNA (WAITING, ASSIGNED, ACTIVE, PENDING, RESOLVED)
  public async getActiveTicketByPhone(phoneNumber: string): Promise<Ticket | null> {
    const pool = getDBPool();
    if (!pool) return null;

    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const target = resolveWhatsAppTarget(phoneNumber);
    const candidates = Array.from(new Set([
      cleanPhone,
      target.phone,
      target.primaryJid?.split('@')[0],
      target.fallbackJid ? target.fallbackJid.split('@')[0] : ''
    ].filter(Boolean)));

    if (candidates.length === 0) return null;

    const placeholders = candidates.map(() => '?').join(', ');
    const [rows]: any = await pool.query(`
      SELECT t.*, u.phone_number as user_phone, u.name as user_name, a.name as admin_name
      FROM tickets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN admins a ON t.assigned_to = a.id
      WHERE u.phone_number IN (${placeholders}) AND t.status IN ('WAITING', 'ASSIGNED', 'ACTIVE', 'PENDING', 'RESOLVED')
      ORDER BY t.created_at DESC LIMIT 1
    `, candidates);

    return rows.length > 0 ? (rows[0] as Ticket) : null;
  }

  // 3. GENERATE NOMOR TIKET UNIK (TK-YYYYMMDD-XXXX dalam WIB)
  private async generateTicketNumber(): Promise<string> {
    const pool = getDBPool();
    const dateStr = getWIBDateCode(); // 20260907 dalam WIB
    const prefix = `TK-${dateStr}-`;

    if (pool) {
      const [rows]: any = await pool.query(
        `SELECT COUNT(*) as cnt FROM tickets WHERE ticket_number LIKE ?`,
        [`${prefix}%`]
      );
      const nextSeq = (rows[0]?.cnt || 0) + 1;
      return `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }

    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${random}`;
  }

  // 4. MEMBUAT TIKET PERCAKAPAN BARU (REQUEST CS DARI BOT)
  public async createTicket(
    phoneNumber: string, 
    userName?: string, 
    initialMessage?: string,
    externalMessageId?: string
  ): Promise<{ ticket: Ticket; isNew: boolean }> {
    const pool = getDBPool();
    if (!pool) throw new Error('Database pool tidak tersedia');

    const user = await this.findOrCreateUser(phoneNumber, userName);
    const existing = await this.getActiveTicketByPhone(phoneNumber);

    if (existing) {
      return { ticket: existing, isNew: false };
    }

    const ticketNumber = await this.generateTicketNumber();
    const ticketId = this.uuid();
    const nowStr = getWIBDateTime();

    await pool.query(`
      INSERT INTO tickets (
        id, ticket_number, user_id, status, mode, last_message_at, unread_admin_count, created_at, updated_at
      ) VALUES (?, ?, ?, 'WAITING', 'HUMAN', ?, 1, ?, ?)
    `, [ticketId, ticketNumber, user.id, nowStr, nowStr, nowStr]);

    // Simpan pesan awal jika ada
    if (initialMessage) {
      const msgId = this.uuid();
      await pool.query(`
        INSERT INTO messages (
          id, ticket_id, sender_type, sender_id, message, message_type, external_message_id, created_at
        ) VALUES (?, ?, 'USER', ?, ?, 'TEXT', ?, ?)
      `, [msgId, ticketId, user.id, initialMessage, externalMessageId || null, nowStr]);
    }

    // Catat audit event
    await this.recordEvent(ticketId, 'USER', user.id, 'ticket_created', null, {
      status: 'WAITING',
      mode: 'HUMAN',
      ticket_number: ticketNumber
    });

    const ticket = await this.getTicketById(ticketId);
    if (!ticket) throw new Error('Gagal memuat tiket yang baru dibuat');

    // Broadcast ke Realtime Dashboard
    realtimeHub.broadcast('ticket.created', { ticket });

    return { ticket, isNew: true };
  }

  // 5. AMBIL TIKET OLEH ADMIN (DENGAN CONCURRENCY LOCKING)
  public async assignTicket(
    ticketId: string, 
    adminId: string, 
    assignedBy?: string
  ): Promise<{ success: boolean; ticket?: Ticket; error?: string }> {
    const pool = getDBPool();
    if (!pool) return { success: false, error: 'Database tidak tersedia' };

    // Validasi Admin Aktif
    const [adminRows]: any = await pool.query('SELECT * FROM admins WHERE id = ? AND is_active = 1', [adminId]);
    if (adminRows.length === 0) {
      return { success: false, error: 'Admin CS tidak ditemukan atau tidak aktif' };
    }
    const admin = adminRows[0] as Admin;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const nowStr = getWIBDateTime();
      // ATOMIC UPDATE DENGAN ROW-LOCKING: Hanya berhasil jika status masih WAITING dan belum di-assign
      const [updateResult]: any = await connection.query(`
        UPDATE tickets 
        SET status = 'ASSIGNED', 
            assigned_to = ?, 
            assigned_at = ?, 
            updated_at = ?
        WHERE id = ? AND status = 'WAITING' AND (assigned_to IS NULL OR assigned_to = '')
      `, [adminId, nowStr, nowStr, ticketId]);

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        // Cek siapa yang mengambil
        const [currentTicket]: any = await connection.query(`
          SELECT t.*, a.name as admin_name 
          FROM tickets t 
          LEFT JOIN admins a ON t.assigned_to = a.id 
          WHERE t.id = ?
        `, [ticketId]);

        const holder = currentTicket[0]?.admin_name || 'admin lain';
        return { 
          success: false, 
          error: `Gagal mengambil tiket. Tiket ini sudah diambil oleh ${holder} atau status telah berubah.` 
        };
      }

      // Catat ke ticket_assignments
      const assignId = this.uuid();
      await connection.query(`
        INSERT INTO ticket_assignments (id, ticket_id, admin_id, assigned_by, assigned_at)
        VALUES (?, ?, ?, ?, ?)
      `, [assignId, ticketId, adminId, assignedBy || adminId, nowStr]);

      // Catat audit event
      await this.recordEventWithConn(connection, ticketId, 'ADMIN', adminId, 'ticket_assigned', { status: 'WAITING' }, { status: 'ASSIGNED', assigned_to: adminId });

      await connection.commit();

      const ticket = await this.getTicketById(ticketId);

      // Broadcast Realtime ke semua Admin Dashboard
      realtimeHub.broadcast('ticket.assigned', { ticket, admin });

      return { success: true, ticket: ticket || undefined };
    } catch (err: any) {
      await connection.rollback();
      return { success: false, error: err.message };
    } finally {
      connection.release();
    }
  }

  // 6. KIRIM PESAN KE TIKET (USER / ADMIN / BOT / SYSTEM)
  public async addMessage(
    ticketId: string,
    senderType: SenderType,
    senderId: string,
    messageText: string,
    messageType: MessageType = 'TEXT',
    externalMessageId?: string,
    metadata?: any
  ): Promise<Message> {
    const pool = getDBPool();
    if (!pool) throw new Error('Database pool tidak tersedia');

    const msgId = this.uuid();
    const nowStr = getWIBDateTime();

    await pool.query(`
      INSERT INTO messages (
        id, ticket_id, sender_type, sender_id, message, message_type, external_message_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      msgId, 
      ticketId, 
      senderType, 
      senderId, 
      messageText, 
      messageType, 
      externalMessageId || null, 
      metadata ? JSON.stringify(metadata) : null, 
      nowStr
    ]);

    // Transisi status otomatis saat pesan dikirim:
    const ticket = await this.getTicketById(ticketId);
    if (!ticket) throw new Error('Tiket tidak ditemukan');

    let newStatus = ticket.status;

    if (senderType === 'ADMIN') {
      // Jika tiket masih ASSIGNED, beralih ke ACTIVE saat admin mengirim pesan pertama
      if (ticket.status === 'ASSIGNED') {
        newStatus = 'ACTIVE';
      }
      await pool.query(`
        UPDATE tickets 
        SET status = ?, last_message_at = ?, unread_user_count = unread_user_count + 1, updated_at = ?
        WHERE id = ?
      `, [newStatus, nowStr, nowStr, ticketId]);
    } else if (senderType === 'USER') {
      // Jika user membalas saat PENDING atau RESOLVED, beralih kembali ke ACTIVE
      if (ticket.status === 'PENDING' || ticket.status === 'RESOLVED') {
        newStatus = 'ACTIVE';
      }
      await pool.query(`
        UPDATE tickets 
        SET status = ?, last_message_at = ?, unread_admin_count = unread_admin_count + 1, updated_at = ?
        WHERE id = ?
      `, [newStatus, nowStr, nowStr, ticketId]);
    } else {
      await pool.query(`UPDATE tickets SET last_message_at = ?, updated_at = ? WHERE id = ?`, [nowStr, nowStr, ticketId]);
    }

    if (newStatus !== ticket.status) {
      await this.recordEvent(ticketId, senderType, senderId, 'ticket_status_changed', { status: ticket.status }, { status: newStatus });
      realtimeHub.broadcast('ticket.status_changed', { 
        ticketId, 
        oldStatus: ticket.status, 
        newStatus, 
        ticket: await this.getTicketById(ticketId) 
      });
    }

    const message: Message = {
      id: msgId,
      ticket_id: ticketId,
      sender_type: senderType,
      sender_id: senderId,
      message: messageText,
      message_type: messageType,
      external_message_id: externalMessageId || null,
      metadata: metadata || null,
      read_at: null,
      created_at: nowStr
    };

    // Broadcast pesan realtime ke Dashboard
    realtimeHub.broadcast('ticket.message', { ticketId, message });

    return message;
  }

  // 7. SET TIKET KE STATUS PENDING
  public async setPending(ticketId: string, adminId: string, reason?: string): Promise<Ticket> {
    const pool = getDBPool();
    if (!pool) throw new Error('Database pool tidak tersedia');

    const ticket = await this.getTicketById(ticketId);
    if (!ticket) throw new Error('Tiket tidak ditemukan');

    if (!['ACTIVE', 'ASSIGNED'].includes(ticket.status)) {
      throw new Error(`Tidak dapat mengubah ke PENDING dari status '${ticket.status}'`);
    }

    const nowStr = getWIBDateTime();
    await pool.query(`
      UPDATE tickets SET status = 'PENDING', updated_at = ? WHERE id = ?
    `, [nowStr, ticketId]);

    await this.recordEvent(ticketId, 'ADMIN', adminId, 'ticket_status_changed', { status: ticket.status }, { status: 'PENDING', reason });

    const updated = await this.getTicketById(ticketId);
    realtimeHub.broadcast('ticket.status_changed', { ticketId, oldStatus: ticket.status, newStatus: 'PENDING', ticket: updated });
    return updated!;
  }

  // 8. SELESAIKAN TIKET (RESOLVE)
  public async resolveTicket(ticketId: string, adminId: string, notes?: string): Promise<Ticket> {
    const pool = getDBPool();
    if (!pool) throw new Error('Database pool tidak tersedia');

    const ticket = await this.getTicketById(ticketId);
    if (!ticket) throw new Error('Tiket tidak ditemukan');

    if (!['ACTIVE', 'PENDING', 'ASSIGNED'].includes(ticket.status)) {
      throw new Error(`Tidak dapat mengubah ke RESOLVED dari status '${ticket.status}'`);
    }

    const nowStr = getWIBDateTime();
    await pool.query(`
      UPDATE tickets SET status = 'RESOLVED', resolved_at = ?, updated_at = ? WHERE id = ?
    `, [nowStr, nowStr, ticketId]);

    await this.recordEvent(ticketId, 'ADMIN', adminId, 'ticket_resolved', { status: ticket.status }, { status: 'RESOLVED', notes });

    const updated = await this.getTicketById(ticketId);
    realtimeHub.broadcast('ticket.status_changed', { ticketId, oldStatus: ticket.status, newStatus: 'RESOLVED', ticket: updated });
    return updated!;
  }

  // 9. TUTUP TIKET SECARA PERMANEN (USER / ADMIN / SYSTEM)
  public async closeTicket(
    ticketId: string, 
    closedByType: ClosedByType, 
    closedById?: string, 
    closeReason?: string
  ): Promise<Ticket> {
    const pool = getDBPool();
    if (!pool) throw new Error('Database pool tidak tersedia');

    const ticket = await this.getTicketById(ticketId);
    if (!ticket) throw new Error('Tiket tidak ditemukan');

    if (ticket.status === 'CLOSED') {
      return ticket; // Sudah tertutup
    }

    const nowStr = getWIBDateTime();
    await pool.query(`
      UPDATE tickets 
      SET status = 'CLOSED', 
          mode = 'BOT', 
          closed_at = ?, 
          closed_by_type = ?, 
          closed_by_id = ?, 
          close_reason = ?,
          unread_admin_count = 0,
          unread_user_count = 0,
          updated_at = ?
      WHERE id = ?
    `, [nowStr, closedByType, closedById || null, closeReason || null, nowStr, ticketId]);

    const eventAction = closedByType === 'SYSTEM' ? 'ticket_auto_closed' : 'ticket_closed';
    await this.recordEvent(ticketId, closedByType, closedById || 'system', eventAction, { status: ticket.status, mode: ticket.mode }, {
      status: 'CLOSED',
      mode: 'BOT',
      closed_by_type: closedByType,
      close_reason: closeReason
    });

    const updated = await this.getTicketById(ticketId);
    realtimeHub.broadcast('ticket.closed', { ticketId, closedByType, closeReason, ticket: updated });
    return updated!;
  }

  // 10. LEPAS TIKET (RELEASE KEMBALI KE WAITING)
  public async releaseTicket(ticketId: string, adminId: string, reason?: string): Promise<Ticket> {
    const pool = getDBPool();
    if (!pool) throw new Error('Database pool tidak tersedia');

    const ticket = await this.getTicketById(ticketId);
    if (!ticket) throw new Error('Tiket tidak ditemukan');

    const nowStr = getWIBDateTime();

    await pool.query(`
      UPDATE tickets 
      SET status = 'WAITING', assigned_to = NULL, assigned_at = NULL, updated_at = ?
      WHERE id = ?
    `, [nowStr, ticketId]);

    // Update assignment
    await pool.query(`
      UPDATE ticket_assignments 
      SET released_at = ?, release_reason = ?
      WHERE ticket_id = ? AND admin_id = ? AND released_at IS NULL
    `, [nowStr, reason || 'Dilepas oleh admin', ticketId, adminId]);

    await this.recordEvent(ticketId, 'ADMIN', adminId, 'ticket_unassigned', { assigned_to: adminId, status: ticket.status }, { status: 'WAITING', reason });

    const updated = await this.getTicketById(ticketId);
    realtimeHub.broadcast('ticket.released', { ticketId, ticket: updated });
    return updated!;
  }

  // 11. ALIKHAN TIKET KE ADMIN LAIN (TRANSFER)
  public async transferTicket(ticketId: string, fromAdminId: string, toAdminId: string, reason?: string): Promise<Ticket> {
    const pool = getDBPool();
    if (!pool) throw new Error('Database pool tidak tersedia');

    const [adminRows]: any = await pool.query('SELECT * FROM admins WHERE id = ? AND is_active = 1', [toAdminId]);
    if (adminRows.length === 0) throw new Error('Admin tujuan tidak ditemukan atau tidak aktif');
    const toAdmin = adminRows[0] as Admin;

    const nowStr = getWIBDateTime();

    // Tutup assignment sebelumnya
    await pool.query(`
      UPDATE ticket_assignments 
      SET released_at = ?, release_reason = ?
      WHERE ticket_id = ? AND admin_id = ? AND released_at IS NULL
    `, [nowStr, `Dialihkan ke ${toAdmin.name}`, ticketId, fromAdminId]);

    // Buat assignment baru
    const assignId = this.uuid();
    await pool.query(`
      INSERT INTO ticket_assignments (id, ticket_id, admin_id, assigned_by, assigned_at)
      VALUES (?, ?, ?, ?, ?)
    `, [assignId, ticketId, toAdminId, fromAdminId, nowStr]);

    await pool.query(`
      UPDATE tickets 
      SET assigned_to = ?, assigned_at = ?, status = 'ASSIGNED', updated_at = ?
      WHERE id = ?
    `, [toAdminId, nowStr, nowStr, ticketId]);

    await this.recordEvent(ticketId, 'ADMIN', fromAdminId, 'ticket_transferred', { assigned_to: fromAdminId }, { assigned_to: toAdminId, reason });

    const updated = await this.getTicketById(ticketId);
    realtimeHub.broadcast('ticket.transferred', { ticketId, fromAdminId, toAdmin, ticket: updated });
    return updated!;
  }

  // 12. QUERY LIST TIKET DENGAN FILTER LENGKAP & PAGINATION
  public async getTickets(filter: {
    status?: string;
    adminId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ tickets: Ticket[]; total: number }> {
    const pool = getDBPool();
    if (!pool) return { tickets: [], total: 0 };

    const limit = filter.limit || 50;
    const offset = filter.offset || 0;

    let whereSql = '1=1';
    const params: any[] = [];

    if (filter.status && filter.status !== 'ALL') {
      whereSql += ' AND t.status = ?';
      params.push(filter.status);
    }

    if (filter.adminId) {
      if (filter.adminId === 'UNASSIGNED') {
        whereSql += ' AND (t.assigned_to IS NULL OR t.assigned_to = "")';
      } else {
        whereSql += ' AND t.assigned_to = ?';
        params.push(filter.adminId);
      }
    }

    if (filter.search) {
      whereSql += ' AND (t.ticket_number LIKE ? OR u.phone_number LIKE ? OR u.name LIKE ?)';
      const s = `%${filter.search}%`;
      params.push(s, s, s);
    }

    const [countRows]: any = await pool.query(`
      SELECT COUNT(*) as total
      FROM tickets t
      JOIN users u ON t.user_id = u.id
      WHERE ${whereSql}
    `, params);

    const total = countRows[0]?.total || 0;

    const [rows]: any = await pool.query(`
      SELECT t.*, u.phone_number as user_phone, u.name as user_name, a.name as admin_name
      FROM tickets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN admins a ON t.assigned_to = a.id
      WHERE ${whereSql}
      ORDER BY t.last_message_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    return { tickets: rows as Ticket[], total };
  }

  // 13. DETAIL TIKET BY ID
  public async getTicketById(ticketId: string): Promise<Ticket | null> {
    const pool = getDBPool();
    if (!pool) return null;

    const [rows]: any = await pool.query(`
      SELECT t.*, u.phone_number as user_phone, u.name as user_name, a.name as admin_name
      FROM tickets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN admins a ON t.assigned_to = a.id
      WHERE t.id = ?
    `, [ticketId]);

    return rows.length > 0 ? (rows[0] as Ticket) : null;
  }

  // 14. AMBIL DAFTAR PESAN PERCAKAPAN
  public async getMessages(ticketId: string, limit: number = 100): Promise<Message[]> {
    const pool = getDBPool();
    if (!pool) return [];

    const [rows]: any = await pool.query(`
      SELECT m.*, 
        CASE 
          WHEN m.sender_type = 'ADMIN' THEN a.name
          WHEN m.sender_type = 'USER' THEN u.name
          WHEN m.sender_type = 'BOT' THEN 'SAPA Bot'
          ELSE 'Sistem'
        END as sender_name
      FROM messages m
      JOIN tickets t ON m.ticket_id = t.id
      LEFT JOIN admins a ON m.sender_id = a.id
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.ticket_id = ?
      ORDER BY m.created_at ASC
      LIMIT ?
    `, [ticketId, limit]);

    return rows.map((r: any) => ({
      ...r,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata
    }));
  }

  // 15. TANDAI PESAN TELAH DIBACA (MARK AS READ)
  public async markMessagesAsRead(ticketId: string, reader: 'ADMIN' | 'USER'): Promise<void> {
    const pool = getDBPool();
    if (!pool) return;

    if (reader === 'ADMIN') {
      await pool.query(`
        UPDATE tickets SET unread_admin_count = 0 WHERE id = ?
      `, [ticketId]);
      await pool.query(`
        UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE ticket_id = ? AND sender_type = 'USER' AND read_at IS NULL
      `, [ticketId]);
    } else {
      await pool.query(`
        UPDATE tickets SET unread_user_count = 0 WHERE id = ?
      `, [ticketId]);
      await pool.query(`
        UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE ticket_id = ? AND sender_type = 'ADMIN' AND read_at IS NULL
      `, [ticketId]);
    }
  }

  // 16. AMBIL AUDIT LOG PERISTIWA TIKET
  public async getTicketEvents(ticketId: string): Promise<any[]> {
    const pool = getDBPool();
    if (!pool) return [];

    const [rows]: any = await pool.query(`
      SELECT e.*, 
        CASE 
          WHEN e.actor_type = 'ADMIN' THEN a.name
          WHEN e.actor_type = 'USER' THEN u.name
          ELSE 'Sistem Otomatis'
        END as actor_name
      FROM ticket_events e
      LEFT JOIN admins a ON e.actor_id = a.id
      LEFT JOIN users u ON e.actor_id = u.id
      WHERE e.ticket_id = ?
      ORDER BY e.created_at ASC
    `, [ticketId]);

    return rows.map((r: any) => ({
      ...r,
      old_value: typeof r.old_value === 'string' ? JSON.parse(r.old_value) : r.old_value,
      new_value: typeof r.new_value === 'string' ? JSON.parse(r.new_value) : r.new_value,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata
    }));
  }

  // 17. DAFTAR ADMIN CS
  public async getAdmins(): Promise<Admin[]> {
    const pool = getDBPool();
    if (!pool) return [];
    const [rows]: any = await pool.query('SELECT id, username, name, email, role, is_active, created_at FROM admins WHERE is_active = 1');
    return rows as Admin[];
  }

  // 18. PENGATURAN CUSTOMER SERVICE
  public async getSettings(): Promise<Record<string, string>> {
    const pool = getDBPool();
    if (!pool) return { auto_close_inactive_minutes: '30' };

    const [rows]: any = await pool.query('SELECT setting_key, setting_value FROM settings');
    const res: Record<string, string> = {};
    for (const r of rows) {
      res[r.setting_key] = r.setting_value;
    }
    return res;
  }

  public async updateSetting(key: string, value: string): Promise<void> {
    const pool = getDBPool();
    if (!pool) return;
    await pool.query('UPDATE settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [value, key]);
  }

  // Helper pencatatan Audit Log
  private async recordEvent(
    ticketId: string, 
    actorType: string, 
    actorId: string, 
    action: string, 
    oldVal: any, 
    newVal: any,
    metadata?: any
  ): Promise<void> {
    const pool = getDBPool();
    if (!pool) return;
    const id = this.uuid();
    const nowStr = getWIBDateTime();
    await pool.query(`
      INSERT INTO ticket_events (id, ticket_id, actor_type, actor_id, action, old_value, new_value, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, 
      ticketId, 
      actorType, 
      actorId, 
      action, 
      oldVal ? JSON.stringify(oldVal) : null, 
      newVal ? JSON.stringify(newVal) : null,
      metadata ? JSON.stringify(metadata) : null,
      nowStr
    ]);
  }

  private async recordEventWithConn(
    connection: any,
    ticketId: string, 
    actorType: string, 
    actorId: string, 
    action: string, 
    oldVal: any, 
    newVal: any,
    metadata?: any
  ): Promise<void> {
    const id = this.uuid();
    const nowStr = getWIBDateTime();
    await connection.query(`
      INSERT INTO ticket_events (id, ticket_id, actor_type, actor_id, action, old_value, new_value, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, 
      ticketId, 
      actorType, 
      actorId, 
      action, 
      oldVal ? JSON.stringify(oldVal) : null, 
      newVal ? JSON.stringify(newVal) : null,
      metadata ? JSON.stringify(metadata) : null,
      nowStr
    ]);
  }
}

export const ticketService = TicketService.getInstance();
