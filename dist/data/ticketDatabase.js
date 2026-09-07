import { getDBPool } from './database.js';
export async function initTicketDatabase() {
    const pool = getDBPool();
    if (!pool) {
        console.warn('[DB TICKET] Koneksi MySQL tidak aktif, fallback ke memory/store.');
        return;
    }
    try {
        const connection = await pool.getConnection();
        try {
            // 1. Table users
            await connection.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(36) PRIMARY KEY,
          phone_number VARCHAR(30) UNIQUE NOT NULL,
          name VARCHAR(100) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_users_phone (phone_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
            // 2. Table admins
            await connection.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id VARCHAR(36) PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          role ENUM('ADMIN', 'SUPERVISOR', 'AGENT') DEFAULT 'AGENT',
          is_active BOOLEAN DEFAULT TRUE,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
            // 3. Table tickets
            await connection.query(`
        CREATE TABLE IF NOT EXISTS tickets (
          id VARCHAR(36) PRIMARY KEY,
          ticket_number VARCHAR(30) UNIQUE NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          status ENUM('WAITING', 'ASSIGNED', 'ACTIVE', 'PENDING', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'WAITING',
          mode ENUM('BOT', 'HUMAN') NOT NULL DEFAULT 'HUMAN',
          assigned_to VARCHAR(36) NULL,
          assigned_at DATETIME NULL,
          resolved_at DATETIME NULL,
          closed_at DATETIME NULL,
          closed_by_type ENUM('USER', 'ADMIN', 'SYSTEM') NULL,
          closed_by_id VARCHAR(36) NULL,
          close_reason VARCHAR(255) NULL,
          last_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          unread_admin_count INT NOT NULL DEFAULT 0,
          unread_user_count INT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tickets_status (status),
          INDEX idx_tickets_assigned_to (assigned_to),
          INDEX idx_tickets_user_id (user_id),
          INDEX idx_tickets_created_at (created_at),
          INDEX idx_tickets_last_message_at (last_message_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
            // 4. Table messages
            await connection.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id VARCHAR(36) PRIMARY KEY,
          ticket_id VARCHAR(36) NOT NULL,
          sender_type ENUM('USER', 'BOT', 'ADMIN', 'SYSTEM') NOT NULL,
          sender_id VARCHAR(36) NOT NULL,
          message TEXT NOT NULL,
          message_type ENUM('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'LOCATION', 'BUTTON', 'SYSTEM_EVENT') NOT NULL DEFAULT 'TEXT',
          external_message_id VARCHAR(100) NULL,
          metadata JSON NULL,
          read_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_messages_ticket_id (ticket_id),
          INDEX idx_messages_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
            // 5. Table ticket_assignments
            await connection.query(`
        CREATE TABLE IF NOT EXISTS ticket_assignments (
          id VARCHAR(36) PRIMARY KEY,
          ticket_id VARCHAR(36) NOT NULL,
          admin_id VARCHAR(36) NOT NULL,
          assigned_by VARCHAR(36) NOT NULL,
          assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          released_at DATETIME NULL,
          release_reason VARCHAR(255) NULL,
          INDEX idx_assign_ticket (ticket_id),
          INDEX idx_assign_admin (admin_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
            // 6. Table ticket_events (Audit Log)
            await connection.query(`
        CREATE TABLE IF NOT EXISTS ticket_events (
          id VARCHAR(36) PRIMARY KEY,
          ticket_id VARCHAR(36) NOT NULL,
          actor_type ENUM('USER', 'ADMIN', 'SYSTEM') NOT NULL,
          actor_id VARCHAR(36) NOT NULL,
          action VARCHAR(50) NOT NULL,
          old_value JSON NULL,
          new_value JSON NULL,
          metadata JSON NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_events_ticket_id (ticket_id),
          INDEX idx_events_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
            // 7. Table settings
            await connection.query(`
        CREATE TABLE IF NOT EXISTS settings (
          setting_key VARCHAR(50) PRIMARY KEY,
          setting_value TEXT NOT NULL,
          description VARCHAR(255) NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
            // Seed default settings jika belum ada
            const defaultSettings = [
                ['auto_close_inactive_minutes', '30', 'Batas durasi tidak aktif sebelum tiket RESOLVED/PENDING ditutup otomatis oleh sistem (menit)'],
                ['resolved_grace_period_minutes', '60', 'Masa tenggang saat tiket RESOLVED dapat diaktifkan kembali jika user membalas (menit)'],
                ['max_assigned_tickets_per_admin', '10', 'Batas maksimal tiket aktif yang dapat ditangani oleh satu admin'],
                ['template_waiting', '🎫 *Tiket Bantuan Customer Service Dibuat*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nNomor Tiket: *#{ticket_number}*\nStatus: *Menunggu Petugas (WAITING)*\n\nPermintaan Anda telah kami terima. Petugas Customer Service BPS Kab. Bangka akan segera bergabung dalam obrolan ini.\n\n_Ketik #selesai kapan saja jika Anda ingin membatalkan dan kembali ke asisten bot otomatis._', 'Template pesan saat tiket baru dibuat menunggu admin'],
                ['template_assigned', '💬 *Customer Service Terhubung*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCustomer Service *{admin_name}* telah mengambil tiket Anda (*#{ticket_number}*) dan siap melayani.\n\nSilakan sampaikan pertanyaan atau kendala Anda secara rinci.', 'Template pesan saat tiket diambil admin (terhubung)'],
                ['template_pending', '⏳ *Status Tiket Ditunda (PENDING)*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nTiket *#{ticket_number}* saat ini berstatus PENDING.\n{reason}\n\nPetugas kami sedang menindaklanjuti permintaan Anda. Mohon ditunggu.', 'Template pesan saat status tiket diubah ke PENDING'],
                ['template_resolved', '✅ *Konsultasi Selesai (Tiket #{ticket_number})*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCustomer Service telah menandai percakapan ini selesai.\n\nTerima kasih telah berkonsultasi dengan Layanan PST BPS Kab. Bangka. Layanan asisten bot otomatis kini telah aktif kembali. Silakan ketik *menu* jika membutuhkan informasi lainnya.', 'Template pesan saat tiket diselesaikan (selesai)'],
                ['template_closed', '🔒 *Percakapan Ditutup*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPercakapan untuk Tiket *#{ticket_number}* telah ditutup.\n\nTerima kasih telah menghubungi Layanan BPS Kab. Bangka. Asisten bot otomatis kini telah aktif kembali. Silakan ketik *menu* jika ingin memulai interaksi baru.', 'Template pesan saat tiket ditutup permanen'],
                ['template_admin_message', '{message}', 'Format template pesan chat admin ke customer (gunakan {message} dan opsional {admin_name})']
            ];
            for (const [k, v, d] of defaultSettings) {
                await connection.query(`INSERT IGNORE INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?)`, [k, v, d]);
            }
            // Seed default admin jika belum ada
            const [adminRows] = await connection.query('SELECT COUNT(*) as cnt FROM admins');
            if (adminRows[0]?.cnt === 0) {
                await connection.query(`INSERT INTO admins (id, username, name, email, role, is_active) VALUES (?, ?, ?, ?, ?, ?)`, [
                    'admin-bps-1',
                    'admin_pelayanan',
                    'Admin Pelayanan BPS Bangka',
                    'pelayanan@bps-bangka.go.id',
                    'ADMIN',
                    true
                ]);
                await connection.query(`INSERT INTO admins (id, username, name, email, role, is_active) VALUES (?, ?, ?, ?, ?, ?)`, [
                    'admin-bps-2',
                    'cs_sapa',
                    'Customer Service SAPA',
                    'cs@bps-bangka.go.id',
                    'AGENT',
                    true
                ]);
                console.log('[DB TICKET] Berhasil membuat akun admin CS default.');
            }
            console.log('[DB TICKET] Seluruh skema tabel Customer Service & Ticketing berhasil diinisialisasi di MySQL/TiDB.');
        }
        finally {
            connection.release();
        }
    }
    catch (err) {
        console.error('[DB TICKET ERROR] Gagal menginisialisasi tabel tiket:', err.message);
    }
}
