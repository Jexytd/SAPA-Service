import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { INFLASI_REDIRECT_CARD } from '../data/csvLoader.js';
import { processUserMessage } from '../nlp/matcher.js';
import { botProcessStartTime } from './whatsapp.js';
import { getDynamicMenuItems } from '../nlp/menu.js';
import { ticketService } from '../services/ticketService.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_JSON_PATH = path.resolve(__dirname, '../../db.json');
// Cache ID pesan yang dikirim oleh bot untuk mencegah looping
const botSentMessageIds = new Set();
function extractMessageText(msg) {
    const m = msg.message?.ephemeralMessage?.message
        || msg.message?.viewOnceMessage?.message
        || msg.message?.documentWithCaptionMessage?.message
        || msg.message;
    return m?.conversation
        || m?.extendedTextMessage?.text
        || m?.imageMessage?.caption
        || m?.videoMessage?.caption
        || '';
}
export async function handleIncomingMessages(sock, messages) {
    const myNumber = (sock.user?.id || '').split(':')[0].split('@')[0];
    const myLid = (sock.user?.lid || '').split(':')[0].split('@')[0];
    for (const msg of messages) {
        if (!msg.key)
            continue;
        const jid = msg.key.remoteJid;
        if (!jid)
            continue;
        // 1. FILTER KEAMANAN MUTLAK:
        // Abaikan pesan grup (@g.us), status/story (@broadcast), dan saluran/newsletter (@newsletter)
        // Bot TIDAK AKAN PERNAH membalas ke dalam grup apa pun!
        if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) {
            continue;
        }
        // 2. CEK APAKAH INI PESAN YANG DIKIRIM OLEH BOT SENDIRI
        if (msg.key.id && botSentMessageIds.has(msg.key.id)) {
            continue;
        }
        // 3. FILTER ANTI-SPAM PESAN KADALUWARSA / SAAT BOT MATI (OFFLINE BACKLOG)
        // Mencegah bot membalas pesan lama yang menumpuk saat komputer/bot dimatikan.
        const rawTimestamp = msg.messageTimestamp;
        const msgTimestamp = typeof rawTimestamp === 'number'
            ? rawTimestamp
            : (typeof rawTimestamp === 'object' && rawTimestamp?.low ? rawTimestamp.low : Number(rawTimestamp) || 0);
        const nowSec = Math.floor(Date.now() / 1000);
        const maxAgeSec = parseInt(process.env.MAX_MESSAGE_AGE_SECONDS || '120', 10);
        const ageInSeconds = nowSec - msgTimestamp;
        // Jika pesan dikirim sebelum bot menyala ATAU usianya melebihi toleransi maxAgeSec:
        if (msgTimestamp > 0 && maxAgeSec > 0 && (msgTimestamp < (botProcessStartTime - 10) || ageInSeconds > maxAgeSec)) {
            const senderPhone = (jid || '').split(':')[0].split('@')[0];
            const sentTimeStr = new Date(msgTimestamp * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
            console.log(`[ABAIKAN PESAN LAMA] Dari: ${senderPhone} | Terkirim: ${sentTimeStr} (${ageInSeconds} detik lalu). Dilewati karena masuk saat bot offline/mati.`);
            continue;
        }
        // 4. DETEKSI PENGUJIAN SENDIRI (Self-Chat / Message Yourself)
        const remoteNumber = jid.split(':')[0].split('@')[0];
        const isSelfChat = !!((myNumber && remoteNumber === myNumber) ||
            (myLid && remoteNumber === myLid) ||
            jid.includes(myNumber));
        // ============================================================
        // MODE CHAT PRIBADI: TERBUKA UNTUK CHAT PRIBADI (UMUM & PENGUJIAN)
        // ============================================================
        // Terbuka untuk semua chat pribadi (1-on-1).
        // Jika suatu saat ingin mengunci kembali hanya untuk nomor sendiri, set ONLY_SELF_TEST_MODE=true di .env
        const ONLY_SELF_TEST_MODE = process.env.ONLY_SELF_TEST_MODE === 'true';
        if (ONLY_SELF_TEST_MODE && !isSelfChat) {
            continue;
        }
        // Jika pesan dari kita sendiri (fromMe) tapi BUKAN chat ke diri sendiri (misal kita lagi chat dengan orang lain),
        // maka abaikan agar bot tidak ikut campur di obrolan pribadi Anda dengan orang lain.
        if (msg.key.fromMe && !isSelfChat) {
            continue;
        }
        const text = extractMessageText(msg);
        // Jika pesan mengandung format output khas bot, abaikan untuk mencegah self-reply loop
        if (text.includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━') ||
            text.includes('📌 *Layanan Informasi') ||
            text.includes('📊 *Berikut File Data Statistik')) {
            continue;
        }
        const isImage = !!(msg.message?.imageMessage || msg.message?.ephemeralMessage?.message?.imageMessage);
        let imageBase64 = undefined;
        if (isImage) {
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                imageBase64 = buffer.toString('base64');
                console.log(`[GAMBAR DITERIMA] Mengirim ke AI untuk analisis...`);
            }
            catch (err) {
                console.warn('[WARN DOWNLOAD MEDIA]', err?.message);
            }
        }
        if (!text.trim() && !isImage)
            continue;
        const cleanMsg = text.trim().toLowerCase();
        console.log(`\n-----------------------------------------------------------`);
        console.log(`[WHATSAPP MASUK] ${isSelfChat ? '⭐ (PENGUJIAN NOMOR SENDIRI)' : '👤 (DARI PENGGUNA LAIN)'}`);
        console.log(` Dari Nomor : ${remoteNumber}`);
        console.log(` Pesan      : "${text}" ${isImage ? '[Ada Gambar]' : ''}`);
        console.log(`-----------------------------------------------------------`);
        // Helper untuk mengirim pesan & mencatat ID agar tidak looping
        const safeSendMessage = async (targetJid, content, options) => {
            try {
                const sent = await sock.sendMessage(targetJid, content, options);
                if (sent?.key?.id) {
                    botSentMessageIds.add(sent.key.id);
                    if (botSentMessageIds.size > 1000) {
                        const firstKey = botSentMessageIds.values().next().value;
                        if (firstKey)
                            botSentMessageIds.delete(firstKey);
                    }
                }
                return sent;
            }
            catch (sendErr) {
                console.error('[ERROR KIRIM PESAN KE WHATSAPP]', sendErr?.message || sendErr);
                return null;
            }
        };
        const sendOpts = isSelfChat ? {} : { quoted: msg };
        // ============================================================
        // 0. INTEGRASI CUSTOMER SERVICE & TICKETING MANAGEMENT
        // ============================================================
        const activeTicket = await ticketService.getActiveTicketByPhone(remoteNumber);
        // KASUS A: Pengguna sedang berada dalam tiket aktif (mode HUMAN)
        if (activeTicket && activeTicket.mode === 'HUMAN') {
            // 1. Cek apakah user ingin menutup percakapan (User-initiated Close)
            const USER_CLOSE_TRIGGERS = [
                '#selesai', '#tutup', '/selesai', '/close', 'akhiri percakapan',
                'akhiri chat', 'selesai chat', 'tutup tiket', '🔴 akhiri percakapan',
                'selesai', 'keluar cs'
            ];
            if (USER_CLOSE_TRIGGERS.some(t => cleanMsg === t || (cleanMsg.length <= 25 && cleanMsg.includes(t)))) {
                await ticketService.closeTicket(activeTicket.id, 'USER', activeTicket.user_id, 'Diakhiri oleh pengguna melalui WhatsApp');
                await safeSendMessage(jid, {
                    text: `🔒 *Percakapan Customer Service Diakhiri*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nSesi percakapan Anda untuk Tiket *#${activeTicket.ticket_number}* telah ditutup.\n\nTerima kasih telah menghubungi Layanan BPS Kab. Bangka. Asisten bot otomatis kini telah aktif kembali.\n\nSilakan ketik *menu* untuk melihat informasi data statistik resmi.`
                }, sendOpts);
                console.log(`[CS TICKET CLOSED BY USER] Tiket #${activeTicket.ticket_number} ditutup oleh ${remoteNumber}.`);
                continue;
            }
            // 2. Simpan pesan pengguna ke tiket CS
            await ticketService.addMessage(activeTicket.id, 'USER', activeTicket.user_id, text, isImage ? 'IMAGE' : 'TEXT', msg.key?.id, imageBase64 ? { hasImage: true } : undefined);
            console.log(`[CS INBOX] Pesan dari ${remoteNumber} diteruskan ke tiket #${activeTicket.ticket_number} (Status: ${activeTicket.status}). Bot tidak membalas.`);
            continue;
        }
        // KASUS B: Pengguna meminta bantuan Customer Service / Hubungi Petugas PST BPS / Hubungi Admin
        // 1. Frasa spesifik yang memicu tiket CS
        const CS_PHRASES = [
            'hubungi petugas pst bps', 'hubungi petugas pst', 'hubungi petugas bps', 'hubungi petugas',
            'petugas pst bps', 'petugas pst', 'hubungi admin', 'hubungi cs', 'customer service',
            'bantuan cs', 'admin cs', 'bicara dengan admin', 'bicara dengan petugas', 'chat admin',
            'chat petugas', 'bantuan manusia', 'mau bicara dengan orang', 'konsultasi pst',
            'konsultasi petugas', 'layanan pst', 'kontak petugas', 'tiket cs', 'buat tiket',
            '🔴 hubungi admin'
        ];
        // 2. Keyword tunggal / command pendek
        const CS_EXACT_KEYWORDS = [
            'cs', '#cs', '/cs', 'operator', 'petugas', 'admin', 'pst'
        ];
        // 3. Pengecekan nomor menu dinamis untuk opsi 'Hubungi Petugas PST BPS'
        let isPSTMenuNumber = false;
        if (/^\d+$/.test(cleanMsg)) {
            const selectedNum = parseInt(cleanMsg, 10);
            const menuItems = getDynamicMenuItems();
            const matchedMenuItem = menuItems.find(m => m.number === selectedNum);
            if (matchedMenuItem && (matchedMenuItem.label.toLowerCase().includes('petugas') ||
                matchedMenuItem.label.toLowerCase().includes('pst'))) {
                isPSTMenuNumber = true;
            }
        }
        const isCSRequest = isPSTMenuNumber ||
            CS_PHRASES.some(phrase => cleanMsg === phrase || cleanMsg.includes(phrase)) ||
            CS_EXACT_KEYWORDS.some(kw => {
                if (cleanMsg === kw)
                    return true;
                const regex = new RegExp(`(^|[\\s.,!?])${kw}([\\s.,!?]|$)`, 'i');
                return regex.test(cleanMsg) && cleanMsg.length <= 30;
            });
        if (isCSRequest) {
            try {
                const { ticket, isNew } = await ticketService.createTicket(remoteNumber, msg.pushName || undefined, text, msg.key?.id);
                if (isNew) {
                    await safeSendMessage(jid, {
                        text: `🎫 *Tiket Bantuan Customer Service Dibuat*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nNomor Tiket: *#${ticket.ticket_number}*\nStatus: *Menunggu Petugas (WAITING)*\n\nPermintaan Anda telah kami terima. Petugas Customer Service BPS Kab. Bangka akan segera bergabung dalam obrolan ini.\n\n_Ketik #selesai kapan saja jika Anda ingin membatalkan dan kembali ke asisten bot otomatis._`
                    }, sendOpts);
                    console.log(`[CS TICKET CREATED] Tiket #${ticket.ticket_number} dibuat untuk ${remoteNumber}.`);
                }
                else {
                    await safeSendMessage(jid, {
                        text: `ℹ️ *Tiket Customer Service Sedang Berjalan*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nAnda telah memiliki tiket aktif *#${ticket.ticket_number}* dengan status *${ticket.status}*.\n\nSilakan sampaikan pertanyaan atau kendala Anda di sini, petugas kami akan segera membalasnya.\n\n_Ketik #selesai untuk mengakhiri sesi CS._`
                    }, sendOpts);
                }
            }
            catch (err) {
                console.error('[ERROR BUAT TIKET CS]', err?.message || err);
                await safeSendMessage(jid, {
                    text: `⚠️ *Layanan Tiket Bantuan CS Sedang Mengalami Kendala Teknis*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nMohon maaf, sistem tiket saat ini mengalami gangguan koneksi database. Silakan coba kembali beberapa saat lagi, atau hubungi kontak kantor BPS Kab. Bangka di (0717) 92492.`
                }, sendOpts);
            }
            continue;
        }
        // 1. Proteksi Mutlak Data Inflasi: Jangan sampai AI berhalusinasi / mengarang data
        const INFLASI_TRIGGERS = ['infla', 'inflasi', 'inflansi', 'ihk', 'indeks harga konsumen', 'laju inflasi', 'defla', 'deflasi'];
        if (INFLASI_TRIGGERS.some(k => cleanMsg.includes(k))) {
            try {
                await sock.sendPresenceUpdate('composing', jid);
                await safeSendMessage(jid, { text: INFLASI_REDIRECT_CARD }, sendOpts);
                console.log(`[INFLASI DIALIHKAN] -> Mengarahkan ${remoteNumber} ke BPS Kota Pangkalpinang.`);
                continue;
            }
            catch (err) {
                console.error('[ERROR KIRIM PESAN INFLASI]', err?.message);
            }
        }
        // 2. Trigger Kirim File Dokumen Statistik (db.json)
        const DATA_TRIGGERS = ['kirim data', 'file data', 'download data', 'unduh data', 'minta data', 'kirim json', 'db.json', 'unduh json', 'file json', 'kirim file'];
        if (DATA_TRIGGERS.includes(cleanMsg) && !isImage) {
            try {
                await sock.sendPresenceUpdate('composing', jid);
                if (fs.existsSync(DB_JSON_PATH)) {
                    await safeSendMessage(jid, {
                        document: fs.readFileSync(DB_JSON_PATH),
                        mimetype: 'application/json',
                        fileName: 'data_statistik_bps_bangka.json',
                        caption: '📊 *Berikut File Database Data Statistik BPS Kab. Bangka (Live db.json).*'
                    }, sendOpts);
                    console.log(`[FILE DATA DITERIMA & TERKIRIM] -> Ke: ${remoteNumber}`);
                    continue;
                }
            }
            catch (err) {
                console.error('[ERROR KIRIM FILE DATA]', err?.message);
            }
        }
        // 3. Balasan Teks / Analisis Gambar Cerdas (Qwen2-VL & NLP)
        try {
            await sock.sendPresenceUpdate('composing', jid);
            const reply = await processUserMessage(text, imageBase64, remoteNumber);
            const res = await safeSendMessage(jid, { text: reply }, sendOpts);
            if (res) {
                console.log(`[BALASAN TERKIRIM] -> "${reply.substring(0, 80).replace(/\n/g, ' ')}..."\n`);
            }
        }
        catch (err) {
            console.error('[ERROR KIRIM PESAN]', err?.message);
        }
    }
}
