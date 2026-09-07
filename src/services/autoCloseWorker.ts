import { getDBPool } from '../data/database.js';
import { ticketService } from './ticketService.js';
import { sendWhatsAppMessageSafe } from '../bot/whatsapp.js';

class AutoCloseWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  public start(intervalMs: number = 60 * 1000) {
    if (this.timer) return;
    console.log('[AUTO-CLOSE WORKER] Memulai background worker auto-close tiket...');
    
    // Jalankan satu kali di awal, lalu jadwalkan per interval
    this.sweep();
    this.timer = setInterval(() => {
      this.sweep();
    }, intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[AUTO-CLOSE WORKER] Background worker dihentikan.');
    }
  }

  public async sweep() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const pool = getDBPool();
      if (!pool) return;

      // 1. Ambil pengaturan durasi auto-close
      const settings = await ticketService.getSettings();
      const autoCloseMinutes = parseInt(settings.auto_close_inactive_minutes || '30', 10);

      if (autoCloseMinutes <= 0) return; // Dinonaktifkan jika 0

      // 2. Cari tiket dengan status RESOLVED atau PENDING yang melampaui batas waktu
      const [candidates]: any = await pool.query(`
        SELECT t.*, u.phone_number as user_phone
        FROM tickets t
        JOIN users u ON t.user_id = u.id
        WHERE t.status IN ('RESOLVED', 'PENDING')
          AND TIMESTAMPDIFF(MINUTE, t.last_message_at, NOW()) >= ?
      `, [autoCloseMinutes]);

      if (candidates.length > 0) {
        console.log(`[AUTO-CLOSE WORKER] Menemukan ${candidates.length} tiket tidak aktif yang perlu ditutup otomatis.`);
      }

      for (const t of candidates) {
        try {
          console.log(`[AUTO-CLOSE] Menutup tiket ${t.ticket_number} (Status: ${t.status}) karena tidak ada aktivitas selama ${autoCloseMinutes} menit.`);
          
          await ticketService.closeTicket(t.id, 'SYSTEM', 'system_worker', 'INACTIVITY');

          // Kirim pemberitahuan ke WhatsApp pengguna
          if (t.user_phone) {
            await sendWhatsAppMessageSafe(t.user_phone, {
              text: `🤖 *Sesi Percakapan Ditutup Otomatis*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nTiket *#${t.ticket_number}* telah ditutup otomatis oleh sistem karena tidak ada aktivitas baru selama lebih dari ${autoCloseMinutes} menit.\n\nLayanan asisten otomatis SAPA BPS telah aktif kembali. Silakan ketik *menu* jika Anda membutuhkan informasi statistik lainnya.`
            }).catch(() => {});
          }
        } catch (itemErr: any) {
          console.error(`[AUTO-CLOSE ERROR] Gagal menutup tiket ${t.id}:`, itemErr.message);
        }
      }
    } catch (err: any) {
      console.warn('[AUTO-CLOSE WORKER ERROR]', err.message);
    } finally {
      this.isRunning = false;
    }
  }
}

export const autoCloseWorker = new AutoCloseWorker();
