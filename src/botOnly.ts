import dotenv from 'dotenv';
import { startWhatsAppBot } from './bot/whatsapp.js';

dotenv.config();

console.clear();
console.log('===========================================================');
console.log('   SAPA BPS KAB. BANGKA - [2] BOT WHATSAPP CONNECTOR       ');
console.log('===========================================================\n');

console.log('[INFO] Menghubungkan ke WhatsApp Multi-Device...');
startWhatsAppBot().catch(err => {
  console.error('[FATAL BOT ERROR]', err);
});
