import axios from 'axios';
import dotenv from 'dotenv';
import { loadBackendStore, DataStatus } from '../data/dbStore.js';

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'groq/compound-mini';

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
`;

/**
 * Membangun konteks dinamis dari data yang diinput melalui website admin.
 * Membaca semua PUBLISHED records dari dbStore dan mengformatnya
 * menjadi string yang bisa diinjeksi ke system prompt AI.
 */
export function buildDynamicContext(): string {
  try {
    const store = loadBackendStore();
    const publishedDatasets = store.datasets.filter(d => d.status === DataStatus.PUBLISHED);

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

  // 1. Prioritas Utama: Jika GROQ_API_KEY ada, gunakan Groq Cloud API
  if (GROQ_API_KEY && GROQ_API_KEY.startsWith('gsk_')) {
    try {
      const response = await axios.post(
        GROQ_API_URL,
        {
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          max_tokens: 600
        },
        {
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
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
