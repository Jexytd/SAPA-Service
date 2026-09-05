import { WASocket, proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { INFLASI_REDIRECT_CARD } from '../data/csvLoader.js';
import { processUserMessage } from '../nlp/matcher.js';
import { isChatSuspended, resumeBot } from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_JSON_PATH = path.resolve(__dirname, '../../db.json');

// Cache ID pesan yang dikirim oleh bot untuk mencegah looping
const botSentMessageIds = new Set<string>();

function extractMessageText(msg: any): string {
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

export async function handleIncomingMessages(sock: WASocket, messages: any[]) {
  const myNumber = (sock.user?.id || '').split(':')[0].split('@')[0];
  const myLid = ((sock.user as any)?.lid || '').split(':')[0].split('@')[0];

  for (const msg of messages) {
    if (!msg.key) continue;
    const jid = msg.key.remoteJid;
    if (!jid) continue;

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

    // 3. DETEKSI PENGUJIAN SENDIRI (Self-Chat / Message Yourself)
    const remoteNumber = jid.split(':')[0].split('@')[0];
    const isSelfChat = !!(
      (myNumber && remoteNumber === myNumber) ||
      (myLid && remoteNumber === myLid) ||
      jid.includes(myNumber)
    );

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
    if (
      text.includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━') ||
      text.includes('📌 *Layanan Informasi') ||
      text.includes('📊 *Berikut File Data Statistik')
    ) {
      continue;
    }

    const isImage = !!(msg.message?.imageMessage || msg.message?.ephemeralMessage?.message?.imageMessage);
    let imageBase64: string | undefined = undefined;

    if (isImage) {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        imageBase64 = buffer.toString('base64');
        console.log(`[GAMBAR DITERIMA] Mengirim ke AI untuk analisis...`);
      } catch (err: any) {
        console.warn('[WARN DOWNLOAD MEDIA]', err?.message);
      }
    }

    if (!text.trim() && !isImage) continue;
    const cleanMsg = text.trim().toLowerCase();

    console.log(`\n-----------------------------------------------------------`);
    console.log(`[WHATSAPP MASUK] ${isSelfChat ? '⭐ (PENGUJIAN NOMOR SENDIRI)' : '👤 (DARI PENGGUNA LAIN)'}`);
    console.log(` Dari Nomor : ${remoteNumber}`);
    console.log(` Pesan      : "${text}" ${isImage ? '[Ada Gambar]' : ''}`);
    console.log(`-----------------------------------------------------------`);

    // Helper untuk mengirim pesan & mencatat ID agar tidak looping
    const safeSendMessage = async (targetJid: string, content: any, options?: any) => {
      try {
        const sent = await sock.sendMessage(targetJid, content, options);
        if (sent?.key?.id) {
          botSentMessageIds.add(sent.key.id);
          if (botSentMessageIds.size > 1000) {
            const firstKey = botSentMessageIds.values().next().value;
            if (firstKey) botSentMessageIds.delete(firstKey);
          }
        }
        return sent;
      } catch (sendErr: any) {
        console.error('[ERROR KIRIM PESAN KE WHATSAPP]', sendErr?.message || sendErr);
        return null;
      }
    };

    const sendOpts = isSelfChat ? {} : { quoted: msg };

    // 0. CEK STATUS SUSPEND (MODE CHAT DENGAN ADMIN / PELAYANAN)
    const isSuspended = isChatSuspended(remoteNumber);

    // Jika sedang di-suspend dan pengguna/admin ingin mengaktifkan kembali bot:
    const RESUME_TRIGGERS = ['#resume', '#bot', '/resume', '/bot', 'aktifkan bot', 'kembali ke bot', 'resume bot'];
    if (isSuspended && RESUME_TRIGGERS.includes(cleanMsg)) {
      resumeBot(remoteNumber);
      await safeSendMessage(jid, {
        text: '🤖 *SAPA Bot Diaktifkan Kembali*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nLayanan asisten otomatis telah aktif kembali. Silakan ketik *menu* atau ajukan pertanyaan Anda seputar data statistik BPS Kab. Bangka.'
      }, sendOpts);
      console.log(`[BOT RESUMED] -> Sesi chat untuk ${remoteNumber} kembali aktif.`);
      continue;
    }

    // Jika chat dalam status SUSPEND, jangan balas otomatis agar admin leluasa berinteraksi
    if (isSuspended) {
      console.log(`[MODE ADMIN/PELAYANAN - BOT SUSPENDED] -> Tidak membalas otomatis untuk ${remoteNumber} (Chat ditangani admin).`);
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
      } catch (err: any) {
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
      } catch (err: any) {
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
    } catch (err: any) {
      console.error('[ERROR KIRIM PESAN]', err?.message);
    }
  }
}
