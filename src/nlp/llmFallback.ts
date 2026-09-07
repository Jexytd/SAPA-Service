import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadBackendStore, DataStatus } from '../data/dbStore.js';
import { getDBPool } from '../data/database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../../.env');

export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

let activeGroqApiKey: string = process.env.GROQ_API_KEY || '';
let activeGroqModel: string = process.env.GROQ_MODEL || 'groq/compound-mini';
let isGroqConfigInitialized = false;

/**
 * Sinkronisasi update langsung ke file .env di disk agar persist saat server direstart
 */
export function updateEnvFile(key: string, value: string): void {
  try {
    if (!fs.existsSync(ENV_PATH)) return;
    let content = fs.readFileSync(ENV_PATH, 'utf-8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}\n`;
    }
    fs.writeFileSync(ENV_PATH, content, 'utf-8');
  } catch (err: any) {
    console.warn('[WARN] Gagal memperbarui file .env:', err?.message);
  }
}

/**
 * Memuat konfigurasi Groq API dari tabel MySQL settings saat startup
 */
export async function initGroqConfigFromDB(): Promise<void> {
  try {
    const pool = getDBPool();
    if (!pool) return;
    const [rows]: any = await pool.query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('groq_api_key', 'groq_model')"
    );
    for (const r of rows) {
      if (r.setting_key === 'groq_api_key' && r.setting_value) {
        activeGroqApiKey = r.setting_value.trim();
        process.env.GROQ_API_KEY = activeGroqApiKey;
      }
      if (r.setting_key === 'groq_model' && r.setting_value) {
        activeGroqModel = r.setting_value.trim();
        process.env.GROQ_MODEL = activeGroqModel;
      }
    }
    isGroqConfigInitialized = true;
  } catch (err: any) {
    console.warn('[WARN] Gagal memuat konfigurasi Groq dari database:', err?.message);
  }
}

/**
 * Mengambil token Groq API aktif (Prioritas: Database > Runtime Cache > .env)
 */
export async function getGroqApiKey(): Promise<string> {
  if (!isGroqConfigInitialized) {
    await initGroqConfigFromDB();
  }
  return activeGroqApiKey || process.env.GROQ_API_KEY || '';
}

/**
 * Mengambil model Groq aktif
 */
export async function getGroqModel(): Promise<string> {
  if (!isGroqConfigInitialized) {
    await initGroqConfigFromDB();
  }
  return activeGroqModel || process.env.GROQ_MODEL || 'groq/compound-mini';
}

/**
 * Mengubah token / model Groq API secara dinamis tanpa perlu commit GitHub
 */
export async function setGroqConfig(apiKey?: string, model?: string): Promise<{ success: boolean; message: string }> {
  if (apiKey !== undefined && apiKey !== null) {
    activeGroqApiKey = apiKey.trim();
    process.env.GROQ_API_KEY = activeGroqApiKey;
    updateEnvFile('GROQ_API_KEY', activeGroqApiKey);
  }

  if (model !== undefined && model !== null && model.trim()) {
    activeGroqModel = model.trim();
    process.env.GROQ_MODEL = activeGroqModel;
    updateEnvFile('GROQ_MODEL', activeGroqModel);
  }

  isGroqConfigInitialized = true;

  try {
    const pool = getDBPool();
    if (pool) {
      if (apiKey !== undefined && apiKey !== null) {
        await pool.query(
          'INSERT INTO settings (setting_key, setting_value, description, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP',
          ['groq_api_key', activeGroqApiKey, 'Token API Groq Cloud untuk fallback LLM AI SAPA']
        );
      }
      if (model !== undefined && model !== null && model.trim()) {
        await pool.query(
          'INSERT INTO settings (setting_key, setting_value, description, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP',
          ['groq_model', activeGroqModel, 'Model LLM Groq Cloud yang digunakan']
        );
      }
    }
  } catch (err: any) {
    console.warn('[WARN] Gagal menyimpan setting groq ke database:', err?.message);
  }

  return { success: true, message: 'Token Groq API berhasil diperbarui secara dinamis tanpa commit GitHub.' };
}

/**
 * Helper sensor kunci API agar aman ditampilkan di UI
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

/**
 * Uji koneksi kunci Groq API ke server Groq Cloud
 */
export async function testGroqApiKey(keyToTest?: string, modelToTest?: string): Promise<{
  valid: boolean;
  message: string;
  latencyMs?: number;
  error?: string;
  responseSnippet?: string;
}> {
  const key = keyToTest || await getGroqApiKey();
  const model = modelToTest || await getGroqModel();

  if (!key) {
    return { valid: false, message: 'Kunci API Groq kosong / belum diatur', error: 'API key is empty' };
  }

  if (!key.startsWith('gsk_')) {
    return { valid: false, message: 'Format Kunci API Groq tidak valid (harus diawali "gsk_")', error: 'Invalid key prefix' };
  }

  const startTime = Date.now();
  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: model,
        messages: [{ role: 'user', content: 'Tes koneksi singkat. Jawab OK.' }],
        max_tokens: 10,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    const latencyMs = Date.now() - startTime;
    const snippet = response.data?.choices?.[0]?.message?.content?.trim() || 'OK';
    return {
      valid: true,
      message: `Koneksi ke Groq Cloud API berhasil (${latencyMs}ms)`,
      latencyMs,
      responseSnippet: snippet
    };
  } catch (err: any) {
    const errMsg = err?.response?.data?.error?.message || err?.message || 'Gagal menghubungi Groq API';
    return {
      valid: false,
      message: `Uji koneksi Groq gagal: ${errMsg}`,
      error: errMsg
    };
  }
}

const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || 'http://127.0.0.1:1234/v1/chat/completions';
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen2-vl-2b-instruct';

export const BPS_KNOWLEDGE_CONTEXT = `
DATA RESMI STATISTIK BPS KABUPATEN BANGKA (SUMBER RESMI: INDIKATOR MAKRO 2025):

[TOPIK 1: JUMLAH PENDUDUK KABUPATEN BANGKA]
- Total Penduduk (Proyeksi SP2020 Tahun 2025): 346.069 jiwa.

[TOPIK 2: KEMISKINAN KABUPATEN BANGKA & SE-BABEL]
- Kabupaten Bangka (2025): Persentase 4,71% (16,58 ribu jiwa), Garis Kemiskinan Rp734.575/kapita/bulan, P1 = 0,51, P2 = 0,09.
- Historis Kab. Bangka: 2024 (4,24% / 14,76 ribu jiwa), 2023 (4,32% / 14,87 ribu jiwa), 2022 (4,26% / 14,50 ribu jiwa).
- Persentase Kemiskinan 7 Kab/Kota Se-Babel 2025: Bangka Barat (2,92%), Bangka Selatan (4,17%), Pangkal Pinang (4,50%), Bangka (4,71%), Belitung (6,44%), Belitung Timur (6,69%), Bangka Tengah (6,70%).
- Catatan Wilayah: Di Babel TIDAK ADA kabupaten bernama 'Bangka Timur' (yang ada adalah Belitung Timur: 6,69%).

[TOPIK 3: LAJU PERTUMBUHAN EKONOMI]
- Tahunan: 2021 (7,46%), 2022 (4,86%), 2023 (4,42%), 2024 (-0,44%).
- Triwulanan 2025 (y-on-y): Triwulan I (5,28%), Triwulan II (4,14%), Triwulan III (5,19%).
- Sektor Pertumbuhan Tertinggi 2024: Informasi & Komunikasi (10,64%), Jasa Pendidikan (10,56%), Jasa Lainnya (8,39%).

[TOPIK 4: INDEKS PEMBANGUNAN MANUSIA (IPM)]
- IPM 2025: 75,38 (naik 0,96%), UHH 73,56 tahun, RLS 8,77 tahun, HLS 13,13 tahun, Pengeluaran per kapita Rp13.411.000,-/tahun.
- Historis IPM: 2024 (74,66), 2023 (74,34), 2022 (73,62), 2021 (73,13).
- PERHATIAN: IPM berbeda dengan IPG. Jangan sampai tertukar!

[TOPIK 5: KETENAGAKERJAAN (TPAK & TPT / PENGANGGURAN)]
- Tahun 2025: TPAK 67,93%, Tingkat Pengangguran Terbuka (TPT) 4,75%.
- Tren TPT (Pengangguran): 2021 (5,97%), 2022 (5,39%), 2023 (5,03%), 2024 (4,91%), 2025 (4,75%).

[TOPIK 6: PDRB & PERTANIAN]
- PDRB ADHB: 2024 (Rp20.003,49 M), 2023 (Rp19.279,60 M), 2022 (Rp17.956,28 M), 2021 (Rp16.166,01 M).
- Triwulanan 2025: TW I (Rp5.112,05 M), TW II (Rp5.461,29 M), TW III (Rp5.498,78 M).
- Produksi Padi 2025: 7.949 ton GKG (Luas panen 2.979 ha).

[TOPIK 7: INDEKS PEMBANGUNAN GENDER (IPG)]
- Angka IPG: 2025 (89,36), 2024 (89,07), 2023 (89,24), 2022 (88,84), 2021 (88,36), 2020 (88,48).
- Makna: Mengukur rasio pencapaian IPM antara perempuan dan laki-laki (mendekati 100 artinya kesetaraan gender semakin merata).

[TOPIK 8: DIMENSI PENDIDIKAN (RLS & HLS 2021-2025)]
- Harapan Lama Sekolah (HLS, tahun): 2021 (12,78), 2022 (12,80), 2023 (13,11), 2024 (13,12), 2025 (13,13).
- Rata-Rata Lama Sekolah (RLS, tahun): 2021 (8,25), 2022 (8,27), 2023 (8,32), 2024 (8,45), 2025 (8,77).

[TOPIK 9: PENGALIHAN INFLASI & IHK (KOTA PANGKALPINANG)]
- BPS Kab. Bangka TIDAK menghitung atau merilis inflasi secara mandiri. Kabupaten Bangka BUKAN kota penghitung IHK.
- DILARANG MENGARANG ANGKA INFLASI. Arahkan pengguna ke BPS Kota Pangkalpinang (https://pangkalpinangkota.bps.go.id).

[TOPIK 10: LAYANAN & KONTAK RESMI PST BPS KAB. BANGKA]
- Layanan: PST, Publikasi (bangkakab.bps.go.id), Romantik, Konsultasi Sektoral.
- Kontak: Jl. Ahmad Yani Jalur Dua Sungailiat, Telp (0717) 92492, Email bps1901@bps.go.id.

[TOPIK 11: PORTAL VISUALISASI DATA BPS KAB BANGKA (GARDA)]
- Portal GARDA (Galeri & Visualisasi Data): Dashboard interaktif, grafik indikator makro, infografis dan ringkasan eksekutif resmi BPS Kabupaten Bangka.
- Tautan portal: https://s.bps.go.id/GARDABANGKA dan website https://bangkakab.bps.go.id.
`;

/**
 * Membangun konteks dinamis dari data yang diinput melalui website admin.
 * Membaca semua PUBLISHED records dari dbStore dan mengformatnya
 * menjadi string yang bisa diinjeksi ke system prompt AI.
 */
export function buildDynamicContext(): string {
  try {
    const store = loadBackendStore();
    const publishedDatasets = store.datasets.filter(d => d.status === DataStatus.PUBLISHED && !d.is_deleted);

    if (publishedDatasets.length === 0) return '';

    const sections: string[] = [];

    for (const ds of publishedDatasets) {
      const records = store.records.filter(
        r => r.dataset_id === ds.id && r.status === DataStatus.PUBLISHED && !r.is_deleted
      );

      if (records.length === 0) continue;

      // Group records by period, sorted
      const sorted = [...records].sort((a, b) => a.period.localeCompare(b.period));
      const lines = sorted.map(r => {
        const val = r.value !== null && r.value !== undefined ? r.value : '-';
        const noteStr = r.notes ? ` (${r.notes})` : '';
        return `  - ${r.indicator} ${r.period} [${r.region}]: ${val} ${r.unit}${noteStr}`;
      });

      sections.push(`[DATASET: ${ds.name} (${ds.code}) — Kategori: ${ds.category}]\n${lines.join('\n')}`);
    }

    if (sections.length === 0) return '';

    return `\n\n[DATA TERBARU YANG DIINPUT MELALUI WEBSITE ADMIN SAPA BPS]\n` +
      `(Data berikut adalah data resmi yang telah diverifikasi dan dipublikasikan melalui sistem manajemen data website):\n\n` +
      sections.join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Menghasilkan system prompt dinamis yang menggabungkan
 * knowledge base statis + data terbaru dari website admin.
 */
export function getSystemPrompt(): string {
  const dynamicCtx = buildDynamicContext();

  return (
    `Anda adalah asisten AI resmi SAPA BPS (Badan Pusat Statistik) Kabupaten Bangka, Provinsi Kepulauan Bangka Belitung.\n\n` +
    `BATASAN DOMAIN MUTLAK (OUT-OF-DOMAIN REFUSAL):\n` +
    `1. Anda HANYA DAN KHUSUS melayani pertanyaan yang berkaitan langsung dengan DATA STATISTIK RESMI, INDIKATOR DAERAH, dan LAYANAN BPS KABUPATEN BANGKA (seperti Kependudukan, Kemiskinan, Pertumbuhan Ekonomi, IPM, IPG, Pendidikan, Ketenagakerjaan, PDRB, Pertanian, Publikasi, dan Layanan PST).\n` +
    `2. JIKA PENGGUNA MENANYAKAN HAL YANG TIDAK ADA HUBUNGANNYA SAMA SEKALI DENGAN BPS ATAU DATA STATISTIK KABUPATEN BANGKA (contoh: resep makanan/masakan, percintaan/curhat, teknologi/coding, resep obat/medis umum, tugas sekolah/kuliah umum non-BPS, ramalan, gosip, olahraga/sepakbola, politik umum, dsb):\n` +
    `   - ANDA DILARANG KERAS MEMPROSES ATAU MEMBERIKAN JAWABAN TENTANG HAL TERSEBUT.\n` +
    `   - Wajib tolak secara sopan, tegas, dan profesional dengan format berikut:\n` +
    `     📌 *Layanan Informasi BPS Kab. Bangka*\n` +
    `     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `     Mohon maaf, sebagai asisten virtual resmi BPS Kabupaten Bangka, saya *hanya dapat melayani pertanyaan seputar data statistik, indikator makro daerah, dan layanan resmi Badan Pusat Statistik Kabupaten Bangka*.\n\n` +
    `     Silakan ajukan pertanyaan terkait data resmi Kabupaten Bangka (seperti IPM, Kemiskinan, Ketenagakerjaan, Pertumbuhan Ekonomi, IPG, Pendidikan, atau Jumlah Penduduk).\n` +
    `     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `     💡 _Ketik *menu* untuk melihat topik data resmi yang tersedia, atau ketik *petugas* untuk bantuan langsung._\n\n` +
    `3. JIKA PERTANYAAN RELEVAN DENGAN STATISTIK BPS BANGKA:\n` +
    `   - Gunakan data 100% PERSIS dari DATA RESMI STATISTIK BPS KABUPATEN BANGKA di bawah ini:\n` +
    `   ----------------------------------------\n` +
    `   ${BPS_KNOWLEDGE_CONTEXT}${dynamicCtx}\n` +
    `   ----------------------------------------\n` +
    `   - Dilarang mengarang fakta atau angka. Format selalu diawali 📌 *[Judul]*, gunakan garis ━━━━━━━━━━━━━━━━━━━━━━━━━━━━, gunakan bullet point •, dan akhiri ajakan ketik menu/petugas.`
  );
}

export async function queryAI(userPrompt: string, imageBase64?: string): Promise<string | null> {
  const systemPrompt = getSystemPrompt();
  const apiKey = await getGroqApiKey();
  const model = await getGroqModel();

  // 1. Prioritas Utama: Jika apiKey ada dan diawali gsk_, gunakan Groq Cloud API
  if (apiKey && apiKey.startsWith('gsk_')) {
    try {
      const response = await axios.post(
        GROQ_API_URL,
        {
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          max_tokens: 600
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content.trim();
      }
    } catch (err: any) {
      console.warn('[WARN GROQ]', err?.response?.data || err?.message);
    }
  }

  // 2. Fallback: Local AI (Bionic / llama-server di port 1234)
  try {
    const userContent: any[] = [];
    if (imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
      });
    }
    userContent.push({
      type: 'text',
      text: userPrompt || 'Jelaskan isi gambar/dokumen ini terkait data statistik BPS.'
    });

    const response = await axios.post(
      LOCAL_LLM_URL,
      {
        model: LOCAL_LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: imageBase64 ? userContent : userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 600
      },
      { timeout: 35000 }
    );

    if (response.data?.choices?.[0]?.message?.content) {
      return response.data.choices[0].message.content.trim();
    }
  } catch (err: any) {
    console.warn('[ERROR LOCAL AI]', err?.message);
  }

  return null;
}

// Alias untuk backward compatibility
export const queryQwenAI = queryAI;

export async function generateFallbackResponse(userMessage: string, imageBase64?: string): Promise<string> {
  const aiAnswer = await queryAI(userMessage, imageBase64);
  if (aiAnswer && aiAnswer.length > 10) {
    return aiAnswer;
  }

  return (
    `Mohon maaf, saat ini data untuk pertanyaan *"${userMessage}"* belum tersedia di sistem kami.\n\n` +
    `💡 _Ketik *menu* untuk melihat daftar data statistik resmi, atau ketik *petugas* untuk berkonsultasi langsung dengan tim Pelayanan Statistik Terpadu (PST) BPS Kab. Bangka._`
  );
}
