import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { handleIncomingMessages } from './handlers.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_DIR = path.resolve(__dirname, '../../auth_info');
const QR_LIFETIME_MS = 5 * 60 * 1000; // 5 menit auto-reset QR Code
let reconnectTimeout = null;
let qrRefreshTimeout = null;
let currentSocket = null;
let globalBotMode = 'ACTIVE';
let globalSuspendedInfo = {};
const suspendedSessions = new Map();
let botStatus = {
    state: 'disconnected',
    qr: null,
    isScanning: false,
    lastError: null,
};
function scheduleQRRefresh() {
    if (qrRefreshTimeout) {
        clearTimeout(qrRefreshTimeout);
        qrRefreshTimeout = null;
    }
    botStatus.qrExpiresAt = Date.now() + QR_LIFETIME_MS;
    qrRefreshTimeout = setTimeout(() => {
        if (botStatus.state !== 'connected' && !botStatus.isScanning) {
            console.log('\n[INFO] QR Code telah aktif selama 5 menit tanpa penautan. Mereset sesi untuk memperbarui QR Code baru...');
            refreshQRCode('QR Code kadaluarsa setelah 5 menit. Memperbarui QR Code baru...');
        }
    }, QR_LIFETIME_MS);
}
export async function refreshQRCode(reason) {
    try {
        if (qrRefreshTimeout) {
            clearTimeout(qrRefreshTimeout);
            qrRefreshTimeout = null;
        }
        if (botStatus.state === 'connected')
            return;
        // Jangan reset jika WhatsApp HP sedang aktif melakukan handshake/scanning
        if (botStatus.isScanning) {
            console.log('[INFO] Barcode sedang di-scan oleh WhatsApp. Menunda pembaruan QR Code agar proses otorisasi tidak terputus.');
            return;
        }
        botStatus.state = 'connecting';
        botStatus.isScanning = false;
        botStatus.scanDetectedAt = undefined;
        botStatus.scanMessage = undefined;
        if (reason) {
            botStatus.lastError = {
                title: 'Pembaruan QR Code Otomatis',
                message: reason,
                timestamp: new Date().toISOString(),
                suggestedAction: 'Silakan scan QR code terbaru yang baru saja diperbarui.'
            };
        }
        if (currentSocket) {
            try {
                currentSocket.ev.removeAllListeners('connection.update');
                currentSocket.ev.removeAllListeners('creds.update');
                currentSocket.ev.removeAllListeners('messages.upsert');
                currentSocket.end(undefined);
            }
            catch { }
            currentSocket = null;
        }
        // Bersihkan auth_info jika belum terhubung
        if (fs.existsSync(AUTH_DIR)) {
            try {
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            }
            catch { }
        }
        setTimeout(() => {
            startWhatsAppBot();
        }, 1000);
    }
    catch (err) {
        console.error('[ERROR] Gagal refresh QR code:', err?.message || err);
    }
}
export function getBotMode() {
    return globalBotMode;
}
export function isChatSuspended(phone) {
    if (globalBotMode === 'SUSPENDED')
        return true;
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    return suspendedSessions.has(cleanPhone);
}
export function suspendBot(options) {
    const now = new Date().toISOString();
    if (options?.phone) {
        const cleanPhone = options.phone.replace(/[^0-9]/g, '');
        const session = {
            phone: cleanPhone,
            status: 'SUSPENDED',
            suspendedAt: now,
            suspendedBy: options.suspendedBy || 'admin',
            reason: options.reason || 'Chat diambil alih oleh admin / pelayanan'
        };
        suspendedSessions.set(cleanPhone, session);
        console.log(`[BOT STATUS] Chat session untuk ${cleanPhone} di-SUSPEND (mode pelayanan admin).`);
        return { mode: 'CHAT_SUSPENDED', session };
    }
    else {
        globalBotMode = 'SUSPENDED';
        globalSuspendedInfo = {
            suspendedAt: now,
            reason: options?.reason || 'Bot di-suspend secara global oleh admin',
            suspendedBy: options?.suspendedBy || 'admin'
        };
        console.log(`[BOT STATUS] Bot di-SUSPEND secara global.`);
        return { mode: 'GLOBAL_SUSPENDED', ...globalSuspendedInfo };
    }
}
export function resumeBot(phone) {
    const now = new Date().toISOString();
    if (phone) {
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        const existed = suspendedSessions.delete(cleanPhone);
        console.log(`[BOT STATUS] Chat session untuk ${cleanPhone} di-RESUME (bot kembali aktif).`);
        return { mode: 'CHAT_RESUMED', phone: cleanPhone, resumed: existed, resumedAt: now };
    }
    else {
        globalBotMode = 'ACTIVE';
        globalSuspendedInfo = {};
        console.log(`[BOT STATUS] Bot di-RESUME secara global (kembali aktif).`);
        return { mode: 'GLOBAL_RESUMED', resumedAt: now };
    }
}
export function getSuspendedSessions() {
    return Array.from(suspendedSessions.values());
}
export function getBotStatus() {
    return {
        ...botStatus,
        mode: globalBotMode,
        suspendedAt: globalSuspendedInfo.suspendedAt,
        suspendedReason: globalSuspendedInfo.reason,
        activeSuspendedChatsCount: suspendedSessions.size,
        suspendedSessions: Array.from(suspendedSessions.values()),
        qrLifetimeMs: QR_LIFETIME_MS,
        serverTime: new Date().toISOString()
    };
}
export function getWhatsAppSocket() {
    return currentSocket;
}
export async function requestPairing(phoneNumber) {
    if (!currentSocket)
        return null;
    let cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('08')) {
        cleanPhone = '628' + cleanPhone.slice(2);
    }
    try {
        if (!currentSocket.authState.creds.registered) {
            const code = await currentSocket.requestPairingCode(cleanPhone);
            return code;
        }
        return null;
    }
    catch (err) {
        console.error('[PAIRING ERROR]', err);
        throw err;
    }
}
export async function resetWhatsAppAuth() {
    try {
        if (currentSocket) {
            try {
                currentSocket.end(undefined);
            }
            catch { }
            currentSocket = null;
        }
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        if (fs.existsSync(AUTH_DIR)) {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        }
        botStatus.state = 'connecting';
        botStatus.qr = null;
        botStatus.qrUpdatedAt = undefined;
        botStatus.phoneNumber = undefined;
        console.log('[RESET] auth_info dihapus. Memulai ulang bot WhatsApp untuk QR baru...');
        setTimeout(() => {
            startWhatsAppBot();
        }, 1000);
    }
    catch (err) {
        console.error('[ERROR] Gagal reset auth WhatsApp:', err);
    }
}
let hasPrintedQR = false;
export async function startWhatsAppBot() {
    // Tutup socket sebelumnya jika masih aktif agar tidak terjadi konflik 2 koneksi bersamaan
    if (currentSocket) {
        try {
            currentSocket.ev.removeAllListeners('connection.update');
            currentSocket.ev.removeAllListeners('creds.update');
            currentSocket.ev.removeAllListeners('messages.upsert');
            currentSocket.end(undefined);
        }
        catch { }
        currentSocket = null;
    }
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version = [2, 3000, 1043857760];
    try {
        const fetched = await fetchLatestBaileysVersion();
        if (fetched?.version)
            version = fetched.version;
    }
    catch (e) { }
    botStatus.state = 'connecting';
    hasPrintedQR = false;
    const logger = pino({ level: 'silent' });
    const sock = makeWASocket({
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        printQRInTerminal: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
    });
    currentSocket = sock;
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        // 1. QR Code Baru Diterima dari WhatsApp
        if (qr) {
            botStatus.state = 'qr_ready';
            botStatus.qr = qr;
            botStatus.qrUpdatedAt = Date.now();
            botStatus.isScanning = false;
            botStatus.scanDetectedAt = undefined;
            botStatus.scanMessage = undefined;
            scheduleQRRefresh();
            if (!hasPrintedQR) {
                hasPrintedQR = true;
                console.log('\n===========================================================');
                console.log('       SCAN QR CODE DI BAWAH INI DENGAN WHATSAPP           ');
                console.log('===========================================================\n');
                qrcode.generate(qr, { small: true });
                console.log('\n[PETUNJUK] Buka WhatsApp di HP > Perangkat Tertaut > Tautkan Perangkat.\n');
            }
        }
        // 2. Status Sedang Connecting / Handshake
        if (connection === 'connecting') {
            // Jika QR code sudah ada, jangan hilangkan QR code; tandai status scanning
            if (botStatus.qr && botStatus.state !== 'connected') {
                botStatus.state = 'scanning';
                botStatus.isScanning = true;
                botStatus.scanDetectedAt = new Date().toISOString();
                botStatus.scanMessage = 'QR Code terdeteksi sedang di-scan oleh WhatsApp. Memproses otorisasi perangkat...';
                console.log('\n[SCAN DETECTED] Barcode sedang di-scan/digunakan oleh WhatsApp. Memproses otorisasi...');
            }
            else if (botStatus.state !== 'qr_ready' && !botStatus.qr) {
                botStatus.state = 'connecting';
            }
        }
        // 3. Status Terhubung (Login Berhasil)
        if (connection === 'open') {
            botStatus.state = 'connected';
            botStatus.qr = null;
            botStatus.qrUpdatedAt = undefined;
            botStatus.qrExpiresAt = undefined;
            botStatus.isScanning = false;
            botStatus.scanDetectedAt = undefined;
            botStatus.scanMessage = undefined;
            botStatus.lastError = null;
            hasPrintedQR = false;
            botStatus.connectedAt = new Date().toISOString();
            if (qrRefreshTimeout) {
                clearTimeout(qrRefreshTimeout);
                qrRefreshTimeout = null;
            }
            if (sock.user?.id) {
                botStatus.phoneNumber = sock.user.id.split(':')[0];
            }
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            console.log('\n' + '='.repeat(59));
            console.log(' [OK] BOT WHATSAPP SAPA BPS KAB. BANGKA AKTIF & TERHUBUNG! ');
            console.log('='.repeat(59));
            console.log(' [STATUS] Siap menerima dan membalas pesan secara otomatis.');
            console.log(' [TIPS] Coba kirim pesan "halo" atau "menu" ke nomor bot ini.\n');
        }
        // 4. Status Terputus / Gagal Menautkan Perangkat
        if (connection === 'close') {
            const err = lastDisconnect?.error;
            const statusCode = (err instanceof Boom)
                ? err.output.statusCode
                : (err?.output?.statusCode || err?.statusCode || 0);
            const rawMessage = err?.message || '';
            // KASUS KHUSUS 1: Restart Stream (Kode 515 / DisconnectReason.restartRequired)
            // Ini adalah tahapan NORMAL dari Baileys saat QR selesai di-scan oleh HP.
            // WhatsApp server meminta socket ditutup dan dibuka kembali dengan kredensial yang baru disimpan di auth_info.
            // PENTING: JANGAN hapus auth_info dan JANGAN anggap ini sebagai error!
            if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                console.log('\n[INFO] WhatsApp memerlukan restart stream (515) untuk menyelesaikan handshake.');
                console.log('[INFO] Menyambungkan kembali dengan kredensial tersimpan untuk finalisasi login...');
                botStatus.state = 'scanning';
                botStatus.isScanning = true;
                botStatus.scanMessage = 'Kredensial diterima. Sedang menyelesaikan otorisasi perangkat WhatsApp...';
                if (!reconnectTimeout) {
                    reconnectTimeout = setTimeout(() => {
                        reconnectTimeout = null;
                        startWhatsAppBot();
                    }, 800);
                }
                return;
            }
            botStatus.state = 'disconnected';
            const wasScanning = botStatus.isScanning;
            botStatus.isScanning = false;
            botStatus.scanDetectedAt = undefined;
            botStatus.scanMessage = undefined;
            // Pemetaan pesan kesalahan ramah untuk pop-up gagal di WhatsApp HP
            let errorTitle = 'Gagal Menautkan Perangkat';
            let friendlyMsg = 'Koneksi ke WhatsApp terputus atau gagal menautkan perangkat.';
            let action = 'Silakan scan ulang QR code baru yang muncul di layar.';
            if (statusCode === 408) {
                errorTitle = 'Waktu Scan Barcode Habis (408)';
                friendlyMsg = 'Waktu scan QR Code telah habis atau koneksi time out sebelum otorisasi selesai.';
                action = 'Silakan scan QR Code terbaru yang telah disegarkan.';
            }
            else if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
                errorTitle = 'Otorisasi Ditolak / Dikeluarkan (401)';
                friendlyMsg = 'Sesi login ditolak oleh WhatsApp atau perangkat telah dikeluarkan.';
                action = 'Sistem telah membersihkan sesi lama. Silakan scan QR code baru.';
            }
            else if (statusCode === 440) {
                errorTitle = 'Sesi Ditimpa (440)';
                friendlyMsg = 'Koneksi ditimpa karena terdapat sesi penautan perangkat lain yang aktif bersamaan.';
                action = 'Tutup aplikasi WhatsApp di HP sebentar, lalu coba scan kembali.';
            }
            else if (statusCode === 405) {
                errorTitle = 'Metode Ditolak (405)';
                friendlyMsg = 'Metode penautan perangkat ditolak oleh server WhatsApp.';
                action = 'Gunakan opsi Pairing Code dengan nomor HP sebagai alternatif.';
            }
            else if (wasScanning) {
                errorTitle = 'Gagal Menautkan Perangkat di HP';
                friendlyMsg = `WhatsApp di HP gagal menyelesaikan penautan perangkat (${rawMessage || `Error ${statusCode}`}).`;
                action = 'Pastikan HP dan server terhubung ke internet stabil, lalu scan ulang QR code baru.';
            }
            botStatus.lastError = {
                code: statusCode,
                title: errorTitle,
                message: friendlyMsg,
                rawMessage: rawMessage,
                timestamp: new Date().toISOString(),
                suggestedAction: action
            };
            console.warn(`\n[PAIRING INFO] ${errorTitle}: ${friendlyMsg} (${statusCode || 'Unknown'})`);
            // HANYA bersihkan auth_info jika benar-benar LOGGED OUT (401)
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log(`[INFO] Sesi WhatsApp telah logout/dikeluarkan dari HP. Membersihkan auth_info...`);
                try {
                    if (fs.existsSync(AUTH_DIR)) {
                        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    }
                }
                catch (cleanErr) { }
                botStatus.qr = null;
                botStatus.phoneNumber = undefined;
            }
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;
            if (shouldReconnect && !reconnectTimeout) {
                reconnectTimeout = setTimeout(() => {
                    reconnectTimeout = null;
                    startWhatsAppBot();
                }, 2500);
            }
        }
    });
    sock.ev.on('creds.update', (creds) => {
        saveCreds();
        // Deteksi saat kredensial enkripsi baru mulai masuk dari HP yang sedang men-scan
        if (botStatus.state !== 'connected' && botStatus.qr) {
            botStatus.state = 'scanning';
            botStatus.isScanning = true;
            botStatus.scanDetectedAt = new Date().toISOString();
            botStatus.scanMessage = 'Kunci otorisasi diterima dari HP. Sedang menyelesaikan verifikasi perangkat...';
        }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Filter hanya pesan pribadi (abaikan grup @g.us, status/broadcast @broadcast, dan channel @newsletter)
        const privateMessages = messages.filter(msg => {
            const jid = msg.key?.remoteJid;
            if (!jid)
                return false;
            return !jid.endsWith('@g.us') && !jid.endsWith('@broadcast') && !jid.endsWith('@newsletter');
        });
        if (privateMessages.length === 0)
            return;
        await handleIncomingMessages(sock, privateMessages);
    });
    return sock;
}
