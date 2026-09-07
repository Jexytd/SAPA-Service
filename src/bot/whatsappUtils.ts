import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getWhatsAppSocket } from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_DIR = path.resolve(__dirname, '../../auth_info');

export interface WhatsAppTargetInfo {
  phone: string;
  primaryJid: string;
  fallbackJid?: string;
}

/**
 * Memetakan nomor telepon atau WhatsApp ID (termasuk WhatsApp Multi-Device LID)
 * ke JID WhatsApp yang valid untuk pengiriman pesan.
 */
export function resolveWhatsAppTarget(phoneOrJid: string): WhatsAppTargetInfo {
  if (!phoneOrJid) {
    return { phone: '', primaryJid: '' };
  }

  const trimmed = phoneOrJid.trim();
  const clean = trimmed.replace(/[^0-9]/g, '');

  // 1. Jika formatnya sudah memiliki domain (@lid)
  if (trimmed.endsWith('@lid')) {
    const lidId = trimmed.split('@')[0].split(':')[0];
    try {
      const lidMappingPath = path.resolve(AUTH_DIR, `lid-mapping-${lidId}_reverse.json`);
      if (fs.existsSync(lidMappingPath)) {
        const realPhone = JSON.parse(fs.readFileSync(lidMappingPath, 'utf8'));
        if (realPhone) {
          let realClean = String(realPhone).replace(/[^0-9]/g, '');
          if (realClean.startsWith('0')) realClean = '62' + realClean.slice(1);
          return {
            phone: realClean,
            primaryJid: `${realClean}@s.whatsapp.net`,
            fallbackJid: `${lidId}@lid`
          };
        }
      }
    } catch {}
    return {
      phone: lidId,
      primaryJid: `${lidId}@lid`
    };
  }

  // 2. Jika formatnya sudah @s.whatsapp.net
  if (trimmed.endsWith('@s.whatsapp.net')) {
    const phonePart = trimmed.split('@')[0].split(':')[0];
    let normalized = phonePart.replace(/[^0-9]/g, '');
    if (normalized.startsWith('0')) normalized = '62' + normalized.slice(1);
    let fallbackLid: string | undefined = undefined;
    try {
      const forwardMappingPath = path.resolve(AUTH_DIR, `lid-mapping-${normalized}.json`);
      if (fs.existsSync(forwardMappingPath)) {
        const mappedLid = JSON.parse(fs.readFileSync(forwardMappingPath, 'utf8'));
        if (mappedLid) fallbackLid = `${String(mappedLid).replace(/[^0-9]/g, '')}@lid`;
      }
    } catch {}
    return {
      phone: normalized,
      primaryJid: `${normalized}@s.whatsapp.net`,
      fallbackJid: fallbackLid
    };
  }

  // 3. Cek apakah clean ID memiliki reverse mapping LID di auth_info (LID -> Phone)
  try {
    const lidMappingPath = path.resolve(AUTH_DIR, `lid-mapping-${clean}_reverse.json`);
    if (fs.existsSync(lidMappingPath)) {
      const realPhone = JSON.parse(fs.readFileSync(lidMappingPath, 'utf8'));
      if (realPhone) {
        let realClean = String(realPhone).replace(/[^0-9]/g, '');
        if (realClean.startsWith('0')) realClean = '62' + realClean.slice(1);
        return {
          phone: realClean,
          primaryJid: `${realClean}@s.whatsapp.net`,
          fallbackJid: `${clean}@lid`
        };
      }
    }
  } catch {}

  // 4. Jika 14+ digit dan bukan awalan 62 atau 0, merupakan WhatsApp LID
  if (clean.length >= 14 && !clean.startsWith('62') && !clean.startsWith('0')) {
    return {
      phone: clean,
      primaryJid: `${clean}@lid`
    };
  }

  // 5. Format nomor HP standar (Indonesia) & cek forward mapping (Phone -> LID)
  let num = clean;
  if (num.startsWith('0')) {
    num = '62' + num.slice(1);
  }
  let fallbackLid: string | undefined = undefined;
  try {
    const forwardMappingPath = path.resolve(AUTH_DIR, `lid-mapping-${num}.json`);
    if (fs.existsSync(forwardMappingPath)) {
      const mappedLid = JSON.parse(fs.readFileSync(forwardMappingPath, 'utf8'));
      if (mappedLid) fallbackLid = `${String(mappedLid).replace(/[^0-9]/g, '')}@lid`;
    }
  } catch {}

  return {
    phone: num,
    primaryJid: `${num}@s.whatsapp.net`,
    fallbackJid: fallbackLid
  };
}

/**
 * Helper pengiriman pesan WhatsApp tangguh dengan fallback otomatis antara Phone JID dan LID.
 */
export async function sendWhatsAppMessageSafe(
  phoneOrJid: string,
  content: any,
  options?: any
): Promise<any> {
  const sock = getWhatsAppSocket();
  if (!sock) {
    console.warn(`[WARN WA SEND] Socket WhatsApp belum terhubung/tersedia saat mengirim ke ${phoneOrJid}.`);
    return null;
  }

  const target = resolveWhatsAppTarget(phoneOrJid);
  if (!target.primaryJid) {
    console.warn(`[WARN WA SEND] Target JID tidak valid untuk: ${phoneOrJid}`);
    return null;
  }

  try {
    const result = await sock.sendMessage(target.primaryJid, content, options);
    console.log(`[WA SEND SUCCESS] Pesan terkirim ke ${target.primaryJid} (${target.phone})`);
    return result;
  } catch (primaryErr: any) {
    console.warn(`[WARN WA SEND PRIMARY FAILED] Gagal kirim ke ${target.primaryJid}:`, primaryErr?.message || primaryErr);
    if (target.fallbackJid && target.fallbackJid !== target.primaryJid) {
      try {
        console.log(`[WA SEND RETRY FALLBACK] Mencoba fallback ke ${target.fallbackJid}...`);
        const fallbackResult = await sock.sendMessage(target.fallbackJid, content, options);
        console.log(`[WA SEND SUCCESS FALLBACK] Pesan terkirim ke fallback ${target.fallbackJid}`);
        return fallbackResult;
      } catch (fallbackErr: any) {
        console.error(`[ERROR WA SEND FALLBACK FAILED] Gagal kirim ke fallback ${target.fallbackJid}:`, fallbackErr?.message || fallbackErr);
        throw fallbackErr;
      }
    }
    throw primaryErr;
  }
}
