import Fuse from 'fuse.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFAQData, PST_CONTACT_CARD, INFLASI_REDIRECT_CARD } from '../data/csvLoader.js';
import { getFriendlyGreeting, generateDynamicMenu, formatPrettyResponse, getFAQByIndex, getDynamicMenuItems } from './menu.js';
import { queryQwenAI } from './llmFallback.js';
import { loadBackendStore, DataStatus } from '../data/dbStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_JSON_PATH = path.resolve(__dirname, '../data/kb_bps_bangka_2025.json');

let kbData: any = null;
function loadKBJson(): any {
  if (kbData) return kbData;
  try {
    if (fs.existsSync(KB_JSON_PATH)) {
      kbData = JSON.parse(fs.readFileSync(KB_JSON_PATH, 'utf-8'));
      return kbData;
    }
  } catch (e) {}
  return null;
}

function fmtNum(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(Number(val))) return '-';
  const rounded = Number(val).toFixed(2).replace(/\.00$/, '').replace(/(\.[0-9])0$/, '$1');
  return rounded.replace('.', ',');
}

const LOKASI_ORDERED = [
  { term: "bangka barat", name: "Bangka Barat" },
  { term: "bangka selatan", name: "Bangka Selatan" },
  { term: "bangka tengah", name: "Bangka Tengah" },
  { term: "pangkal pinang", name: "Pangkal Pinang" },
  { term: "pangkalpinang", name: "Pangkal Pinang" },
  { term: "belitung timur", name: "Belitung Timur" },
  { term: "belitung", name: "Belitung" },
  { term: "bangka", name: "Bangka" }
];

function extractLocations(text: string): string[] {
  let remaining = text;
  const result: string[] = [];
  for (const loc of LOKASI_ORDERED) {
    if (remaining.includes(loc.term)) {
      if (!result.includes(loc.name)) {
        result.push(loc.name);
      }
      remaining = remaining.replace(new RegExp(loc.term, 'gi'), ' ');
    }
  }
  return result;
}

function extractYears(text: string): string[] {
  const yearsSet = new Set<string>();
  const rangeMatch = text.match(/\b(202[0-5])\s*(?:sampai|hingga|s\/d|-|to)\s*(202[0-5])\b/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    const [minY, maxY] = start <= end ? [start, end] : [end, start];
    for (let y = minY; y <= maxY; y++) {
      yearsSet.add(y.toString());
    }
  }

  const allMatches = text.matchAll(/\b(202[0-5])\b/g);
  for (const m of allMatches) {
    yearsSet.add(m[1]);
  }

  return Array.from(yearsSet).sort();
}

// EKSTRAKSI PRESISI DARI DATABASE RESMI BPS (ZERO HALLUCINATION & TIDAK MELENCENG)
function tryExtractGranularKB(rawMessage: string): string | null {
  const kb = loadKBJson();
  if (!kb) return null;

  const msgLower = rawMessage.toLowerCase();
  const years = extractYears(msgLower);
  const matchedLocations = extractLocations(msgLower);

  // 1. IPG (Indeks Pembangunan Gender)
  if (msgLower.includes('ipg') || msgLower.includes('gender') || msgLower.includes('pembangunan gender')) {
    const ipgData = kb["7"]?.per_tahun;
    if (ipgData) {
      const targetYears = years.length > 0 ? years : ["2020", "2021", "2022", "2023", "2024", "2025"];
      const lines: string[] = [];
      for (const y of targetYears) {
        if (ipgData[y] !== undefined) {
          lines.push(`• *Tahun ${y}:* *${fmtNum(ipgData[y])}*`);
        }
      }
      if (lines.length > 0) {
        let diffNote = '';
        if (targetYears.includes('2024') && targetYears.includes('2025') && ipgData['2024'] && ipgData['2025']) {
          const diff = ipgData['2025'] - ipgData['2024'];
          diffNote = `\n\n💡 *Analisis:* IPG Kab. Bangka tahun 2025 mengalami kenaikan sebesar *${fmtNum(diff)} poin* dibanding tahun 2024.`;
        }
        return formatPrettyResponse(
          `Indeks Pembangunan Gender (IPG) Kab. Bangka (${targetYears.join(' & ')})`,
          `⚖️ *Rincian Data IPG Resmi BPS:*\n\n${lines.join('\n')}${diffNote}\n\n💡 _Catatan: IPG mengukur kesetaraan pencapaian antara perempuan dan laki-laki (skala mendekati 100 menunjukkan kesetaraan gender yang semakin baik)._`
        );
      }
    }
  }

  // 2. IPM (Indeks Pembangunan Manusia)
  if (msgLower.includes('ipm') || msgLower.includes('pembangunan manusia')) {
    const ipmData = kb["4"]?.per_tahun;
    if (ipmData && years.length > 0) {
      const lines: string[] = [];
      for (const y of years) {
        if (ipmData[y]) {
          const uhhVal = ipmData[y].uhh ?? ipmData[y].uhh_tahun;
          const rlsVal = ipmData[y].rls ?? ipmData[y].rls_tahun;
          const hlsVal = ipmData[y].hls ?? ipmData[y].hls_tahun;
          const pengeluaranVal = ipmData[y].pengeluaran_ribu_rp ? (ipmData[y].pengeluaran_ribu_rp * 1000).toLocaleString('id-ID') : '-';

          lines.push(
            `📅 *Tahun ${y}:*\n` +
            `  - Skor IPM: *${fmtNum(ipmData[y].ipm)}*\n` +
            `  - Umur Harapan Hidup (UHH): *${fmtNum(uhhVal)} tahun*\n` +
            `  - Rata-Rata Lama Sekolah (RLS): *${fmtNum(rlsVal)} tahun*\n` +
            `  - Harapan Lama Sekolah (HLS): *${fmtNum(hlsVal)} tahun*\n` +
            `  - Pengeluaran per Kapita: *Rp${pengeluaranVal},- / tahun*`
          );
        }
      }
      if (lines.length > 0) {
        return formatPrettyResponse(
          `Indeks Pembangunan Manusia (IPM) Kab. Bangka (${years.join(' & ')})`,
          `📊 *Rincian Perkembangan IPM:*\n\n${lines.join('\n\n')}`
        );
      }
    }
  }

  // 3. Dimensi Pendidikan (RLS & HLS)
  if (msgLower.includes('pendidikan') || msgLower.includes('sekolah') || msgLower.includes('rls') || msgLower.includes('hls')) {
    const pendData = kb["8"]?.per_tahun;
    if (pendData && years.length > 0) {
      const lines: string[] = [];
      for (const y of years) {
        if (pendData[y]) {
          lines.push(`• *Tahun ${y}:* HLS *${fmtNum(pendData[y].hls_tahun)} tahun* | RLS *${fmtNum(pendData[y].rls_tahun)} tahun*`);
        }
      }
      if (lines.length > 0) {
        return formatPrettyResponse(
          `Dimensi Pendidikan Kab. Bangka (${years.join(' & ')})`,
          `📚 *Rincian Indikator Pendidikan (HLS & RLS):*\n\n${lines.join('\n')}\n\n💡 _RLS = Rata-Rata Lama Sekolah | HLS = Harapan Lama Sekolah._`
        );
      }
    }
  }

  // 4. Ketenagakerjaan (TPT & TPAK)
  if (msgLower.includes('kerja') || msgLower.includes('tenaga') || msgLower.includes('pengangguran') || msgLower.includes('tpt') || msgLower.includes('tpak')) {
    const rawData = kb["5"]?.per_tahun;
    if (rawData && years.length > 0) {
      const isSpecificTPT = msgLower.includes('tpt') || msgLower.includes('pengangguran') || msgLower.includes('nganggur');
      const isSpecificTPAK = msgLower.includes('tpak') || msgLower.includes('angkatan kerja');

      const lines: string[] = [];
      for (const y of years) {
        if (rawData[y]) {
          if (isSpecificTPT && !isSpecificTPAK) {
            lines.push(`• *Tahun ${y}:* TPT *${fmtNum(rawData[y].tpt_persen)}%* (TPAK: ${fmtNum(rawData[y].tpak_persen)}%)`);
          } else if (isSpecificTPAK && !isSpecificTPT) {
            lines.push(`• *Tahun ${y}:* TPAK *${fmtNum(rawData[y].tpak_persen)}%* (TPT: ${fmtNum(rawData[y].tpt_persen)}%)`);
          } else {
            lines.push(`📅 *Tahun ${y}:*\n  - TPAK: *${fmtNum(rawData[y].tpak_persen)}%*\n  - TPT: *${fmtNum(rawData[y].tpt_persen)}%*`);
          }
        }
      }

      if (lines.length > 0) {
        let title = `Data Ketenagakerjaan Kab. Bangka (${years.join(' & ')})`;
        if (isSpecificTPT && !isSpecificTPAK) title = `Tren Tingkat Pengangguran Terbuka (TPT) Kab. Bangka (${years.join(' & ')})`;
        if (isSpecificTPAK && !isSpecificTPT) title = `Tren Tingkat Partisipasi Angkatan Kerja (TPAK) Kab. Bangka (${years.join(' & ')})`;

        let comparisonNote = '';
        if (years.length >= 2 && isSpecificTPT) {
          const firstY = years[0];
          const lastY = years[years.length - 1];
          if (rawData[firstY] && rawData[lastY]) {
            const diff = rawData[lastY].tpt_persen - rawData[firstY].tpt_persen;
            const status = diff < 0 ? `turun sebesar *${fmtNum(Math.abs(diff))}%*` : `naik sebesar *${fmtNum(diff)}%*`;
            comparisonNote = `\n\n💡 *Analisis Tren:* Tingkat Pengangguran Terbuka (TPT) dari tahun ${firstY} ke ${lastY} mengalami ${status}.`;
          }
        }

        return formatPrettyResponse(title, `📊 *Rincian Data yang Anda Minta:*\n\n${lines.join('\n\n')}${comparisonNote}`);
      }
    }
  }

  // 5. Kemiskinan
  if (msgLower.includes('miskin') || msgLower.includes('kemiskinan') || msgLower.includes('garis kemiskinan') || msgLower.includes('p1') || msgLower.includes('p2')) {
    const rawData = kb["2"]?.per_tahun;
    const lokasiData = kb["2"]?.per_lokasi_2025;

    if (matchedLocations.length > 0 && lokasiData) {
      const lines: string[] = [];
      for (const loc of matchedLocations) {
        if (lokasiData[loc] !== undefined) {
          lines.push(`• *${loc}:* *${fmtNum(lokasiData[loc])}%*`);
        }
      }
      if (lines.length > 0) {
        return formatPrettyResponse(
          `Persentase Penduduk Miskin Se-Babel (2025)`,
          `📍 *Data Wilayah yang Anda Minta (Tahun 2025):*\n\n${lines.join('\n')}\n\n💡 _Rata-rata Kab. Bangka berada di angka *4,71%*._`
        );
      }
    }

    if (years.length > 0 && rawData) {
      const lines: string[] = [];
      for (const y of years) {
        if (rawData[y]) {
          lines.push(
            `📅 *Tahun ${y}:*\n` +
            `  - Penduduk Miskin: *${fmtNum(rawData[y].jumlah_ribu_jiwa)} ribu jiwa* (${fmtNum(rawData[y].persentase)}%)\n` +
            `  - Garis Kemiskinan: *Rp${rawData[y].garis_kemiskinan_rp?.toLocaleString('id-ID')}/kapita/bulan*\n` +
            `  - Indeks P1: *${fmtNum(rawData[y].p1)}* | P2: *${fmtNum(rawData[y].p2)}*`
          );
        }
      }
      if (lines.length > 0) {
        return formatPrettyResponse(
          `Data Kemiskinan Kab. Bangka (${years.join(' & ')})`,
          `📊 *Rincian Data Kemiskinan:*\n\n${lines.join('\n\n')}`
        );
      }
    }
  }

  // 6. Pertumbuhan Ekonomi
  if (msgLower.includes('pertumbuhan ekonomi') || msgLower.includes('laju pertumbuhan') || (msgLower.includes('ekonomi') && (years.length > 0 || msgLower.includes('triwulan')))) {
    const rawEko = kb["3"]?.per_tahun;
    const rawTW = kb["3"]?.triwulan_2025;
    const lines: string[] = [];

    if (years.length > 0 && rawEko) {
      for (const y of years) {
        if (rawEko[y] !== undefined) {
          const val = rawEko[y]?.laju_persen !== undefined ? rawEko[y].laju_persen : rawEko[y];
          const ket = rawEko[y]?.keterangan ? ` _(${rawEko[y].keterangan})_` : '';
          lines.push(`• *Tahun ${y}:* *${fmtNum(val)}%*${ket}`);
        }
      }
    }
    if (msgLower.includes('triwulan') || msgLower.includes('tw')) {
      if (rawTW) {
        lines.push(`• *Triwulan I 2025:* *${fmtNum(rawTW["Triwulan I"]?.pertumbuhan_y_on_y_persen)}%*`);
        lines.push(`• *Triwulan II 2025:* *${fmtNum(rawTW["Triwulan II"]?.pertumbuhan_y_on_y_persen)}%*`);
        lines.push(`• *Triwulan III 2025:* *${fmtNum(rawTW["Triwulan III"]?.pertumbuhan_y_on_y_persen)}%*`);
      }
    }
    if (lines.length > 0) {
      return formatPrettyResponse(
        `Laju Pertumbuhan Ekonomi Kab. Bangka`,
        `📈 *Data Pertumbuhan Ekonomi Resmi BPS:*\n\n${lines.join('\n')}\n\n🏭 _Sektor Tertinggi 2024: Informasi & Komunikasi (10,64%), Jasa Pendidikan (10,56%), Jasa Lainnya (8,39%)._`
      );
    }
  }

  // 7. Jumlah Penduduk - Baca langsung dari database website SAPA BPS
  if (msgLower.includes('jumlah penduduk') || msgLower.includes('populasi') || msgLower.includes('total penduduk') || msgLower.includes('banyak penduduk')) {
    const livePenduduk = getPublishedDatasetResponse('Jumlah Penduduk', years);
    if (livePenduduk) return livePenduduk;
  }

  return null;
}

/**
 * Format data resmi yang diambil langsung dari database website SAPA BPS (db_store.json).
 * Menjamin 100% data yang diinput / dikoreksi typo di website langsung terpakai di WA Bot!
 */
export function getPublishedDatasetResponse(datasetQuery: string, specifiedYears: string[] = []): string | null {
  try {
    const store = loadBackendStore();
    const publishedDatasets = store.datasets.filter(d => d.status === DataStatus.PUBLISHED);
    if (publishedDatasets.length === 0) return null;

    // Filter kandidat yang memiliki data riil (record count > 0) terlebih dahulu
    const datasetsWithRecords = publishedDatasets.map(d => ({
      dataset: d,
      records: store.records.filter(
        r => r.dataset_id === d.id && r.status === DataStatus.PUBLISHED && !r.is_deleted && r.value !== null
      )
    })).filter(item => item.records.length > 0);

    if (datasetsWithRecords.length === 0) return null;

    const queryLower = datasetQuery.trim().toLowerCase();

    // 1. Cari exact match ID / code / name / category
    let matchedItem = datasetsWithRecords.find(item =>
      item.dataset.id.toLowerCase() === queryLower ||
      item.dataset.code.toLowerCase() === queryLower ||
      item.dataset.name.toLowerCase() === queryLower ||
      item.dataset.category.toLowerCase() === queryLower
    );

    if (!matchedItem) {
      // 2. Pencarian kata kunci tematik
      matchedItem = datasetsWithRecords.find(item => {
        const d = item.dataset;
        const nameLower = d.name.toLowerCase();
        const catLower = d.category.toLowerCase();
        const descLower = (d.description || '').toLowerCase();
        const fullText = `${nameLower} ${catLower} ${descLower}`;

        if (queryLower.includes('penduduk') || queryLower.includes('populasi') || queryLower.includes('jiwa')) {
          return catLower.includes('penduduk') || nameLower.includes('penduduk');
        }
        if (queryLower.includes('miskin') || queryLower.includes('kemiskinan')) {
          return catLower.includes('kemiskinan') || nameLower.includes('kemiskinan');
        }
        if (queryLower.includes('pertumbuhan ekonomi') || (queryLower.includes('ekonomi') && !queryLower.includes('pdrb'))) {
          return catLower.includes('pertumbuhan ekonomi') || nameLower.includes('pertumbuhan ekonomi');
        }
        if (queryLower.includes('ipm') || queryLower.includes('manusia')) {
          return catLower.includes('ipm') || nameLower.includes('ipm');
        }
        if (queryLower.includes('tpt') || queryLower.includes('pengangguran') || queryLower.includes('tenaga kerja') || queryLower.includes('kerja')) {
          return catLower.includes('tenaga kerja') || nameLower.includes('tenaga kerja');
        }
        if (queryLower.includes('pdrb') || queryLower.includes('bruto')) {
          return catLower.includes('pdrb') || nameLower.includes('pdrb');
        }
        if (queryLower.includes('ipg') || queryLower.includes('gender')) {
          return catLower.includes('gender') || nameLower.includes('gender') || catLower.includes('ipg') || nameLower.includes('ipg');
        }
        if (queryLower.includes('pendidikan') || queryLower.includes('rls') || queryLower.includes('hls') || queryLower.includes('sekolah')) {
          return catLower.includes('pendidikan') || nameLower.includes('pendidikan') || nameLower.includes('sekolah');
        }
        return fullText.includes(queryLower) || queryLower.includes(nameLower) || queryLower.includes(catLower);
      });
    }

    if (!matchedItem) return null;

    const matchedDs = matchedItem.dataset;
    let records = matchedItem.records;

    // URUTKAN DARI TAHUN/PERIODE TERBARU KE TERLAMA (Descending)
    records.sort((a, b) => b.period.localeCompare(a.period));

    const latest = records[0];
    const latestVal = latest.value !== null && latest.value !== undefined
      ? (typeof latest.value === 'number' ? latest.value.toLocaleString('id-ID') : latest.value)
      : '-';

    // Jika user spesifik menanyakan tahun tertentu (misal 2025):
    let filteredRecords = records;
    if (specifiedYears.length > 0) {
      const matchedYears = records.filter(r => specifiedYears.includes(r.period));
      if (matchedYears.length > 0) {
        filteredRecords = matchedYears;
      }
    }

    if (filteredRecords.length === 1) {
      const r = filteredRecords[0];
      const val = r.value !== null && r.value !== undefined ? (typeof r.value === 'number' ? r.value.toLocaleString('id-ID') : r.value) : '-';
      const notesLine = r.notes ? `\n• *Catatan Metodologi:* ${r.notes}` : '';
      return formatPrettyResponse(
        `${matchedDs.name} (Tahun ${r.period})`,
        `⭐ *DATA RESMI TERBARU DARI DATABASE SAPA BPS:*\n\n` +
        `• *Indikator:* ${r.indicator}\n` +
        `• *Periode:* Tahun ${r.period}\n` +
        `• *Nilai Realisasi:* *${val} ${r.unit || matchedDs.unit}*` +
        `${notesLine}\n` +
        `• *Wilayah:* ${r.region}\n\n` +
        `🏢 *Sumber Data:* ${matchedDs.source || 'BPS Kabupaten Bangka'}\n` +
        `💡 _Data ini tersinkronisasi langsung secara real-time dari website SAPA BPS Kab. Bangka._`
      );
    }

    // Jika menampilkan deret waktu / multi-tahun (selalu urut dari tahun terbaru ke terlama):
    const historyLines = filteredRecords.map(r => {
      const val = r.value !== null && r.value !== undefined ? (typeof r.value === 'number' ? r.value.toLocaleString('id-ID') : r.value) : '-';
      const noteStr = r.notes ? ` _(${r.notes})_` : '';
      return `• *Tahun ${r.period}:* *${val} ${r.unit || matchedDs.unit}*${noteStr}`;
    });

    const periodsLabel = filteredRecords.map(r => r.period).join(', ');

    return formatPrettyResponse(
      `${matchedDs.name}`,
      `📊 *Data Resmi Sistem SAPA BPS Kab. Bangka*\n\n` +
      `⭐ *REALISASI TERBARU (Tahun ${latest.period}):*\n` +
      `👉 *${latestVal} ${latest.unit || matchedDs.unit}*\n` +
      (latest.notes ? `_Catatan: ${latest.notes}_\n\n` : '\n') +
      `📈 *Rincian Perkembangan Historis (${periodsLabel}):*\n` +
      `${historyLines.join('\n')}\n\n` +
      `📁 *Kategori:* ${matchedDs.category}\n` +
      `🏢 *Sumber Data:* ${matchedDs.source || 'BPS Kabupaten Bangka'}\n` +
      `💡 _Data ini terupdate secara real-time langsung dari Katalog Dataset SAPA BPS._`
    );
  } catch (e) {
    console.error('[ERR getPublishedDatasetResponse]', e);
    return null;
  }
}

function tryMatchWebsiteData(rawMessage: string): string | null {
  const msgLower = rawMessage.toLowerCase();
  const years = extractYears(msgLower);

  // Periksa langsung ke fungsi getPublishedDatasetResponse
  const directMatch = getPublishedDatasetResponse(msgLower, years);
  if (directMatch) return directMatch;

  return null;
}

export function findExactFAQMatch(userMessage: string, faqData: Record<string, string>): string | null {
  const origLower = userMessage.trim().toLowerCase();
  for (const key of Object.keys(faqData)) {
    if (origLower === key.toLowerCase()) {
      return key;
    }
  }
  return null;
}

interface PendingSubmenu {
  category: string;
  datasets: { id: string; name: string; code: string }[];
  timestamp: number;
}

const pendingSubmenuSessions = new Map<string, PendingSubmenu>();

export async function processUserMessage(
  rawMessage: string,
  imageBase64?: string,
  sessionId: string = 'default'
): Promise<string> {
  const message = rawMessage.trim();

  // 1. Gambar / Foto dari WhatsApp -> Ditangani langsung oleh Qwen2-VL Multimodal
  if (imageBase64) {
    const aiVision = await queryQwenAI(message || 'Jelaskan gambar/dokumen ini terkait statistik BPS', imageBase64);
    if (aiVision) {
      return formatPrettyResponse('Analisis Gambar / Dokumen BPS', aiVision);
    }
    return 'Maaf, model AI belum dapat memproses gambar ini. Silakan hubungi petugas PST BPS.';
  }

  if (!message) return 'Mohon sampaikan pertanyaan Anda seputar data statistik BPS.';

  const msgClean = message.toLowerCase();
  const faqData = loadFAQData();

  // 1.5. Cek apakah sesi ini sedang menunggu pemilihan sub-dataset (kategori dengan > 1 dataset)
  const pending = pendingSubmenuSessions.get(sessionId);
  if (pending) {
    if (Date.now() - pending.timestamp > 15 * 60 * 1000) {
      pendingSubmenuSessions.delete(sessionId);
    } else {
      if (['menu', 'batal', 'kembali', 'exit', 'keluar', 'p'].includes(msgClean)) {
        pendingSubmenuSessions.delete(sessionId);
        return generateDynamicMenu(faqData);
      }

      if (/^\d+$/.test(msgClean)) {
        const subNum = parseInt(msgClean, 10);
        if (subNum >= 1 && subNum <= pending.datasets.length) {
          const chosen = pending.datasets[subNum - 1];
          pendingSubmenuSessions.delete(sessionId);
          const liveData = getPublishedDatasetResponse(chosen.id);
          if (liveData) return liveData;
        } else {
          return (
            `⚠️ Pilihan nomor *${subNum}* tidak tersedia.\n\n` +
            `Silakan balas dengan angka *1* sampai *${pending.datasets.length}*, atau ketik *menu* untuk kembali ke Menu Utama.`
          );
        }
      } else {
        // Jika pengguna mengetik kata kunci lain, bersihkan status submenu dan teruskan ke pencarian biasa
        pendingSubmenuSessions.delete(sessionId);
      }
    }
  }

  // 2. PROTEKSI DATA INFLASI / IHK: Dilarang keras halusinasi/mengarang data
  const INFLASI_KEYWORDS = ["infla", "inflasi", "inflansi", "ihk", "indeks harga konsumen", "laju inflasi", "defla", "deflasi"];
  if (INFLASI_KEYWORDS.some(k => msgClean.includes(k))) {
    console.log(`[INFO BLOCKED] Pertanyaan Inflasi terdeteksi: "${message}". Mengalihkan resmi ke BPS Kota Pangkalpinang.`);
    return INFLASI_REDIRECT_CARD;
  }

  // 3. Trigger Kontak Petugas PST Langsung
  const PST_TRIGGERS = ["petugas", "admin", "konsultasi", "pst", "skripsi", "penelitian", "kontak", "kantor", "cs", "telepon", "hubungi", "10"];
  if (PST_TRIGGERS.some(pt => msgClean === pt || msgClean.split(' ').includes(pt))) {
    return PST_CONTACT_CARD;
  }

  // 4. Sapaan Ramah Singkat (Greetings) & Menu SAPA BPS
  const GREETINGS = [
    "halo", "hai", "hello", "helo", "hallo", "hay", "hi", "p",
    "assalamualaikum", "assalamu'alaikum", "assalam", "ass", "askum",
    "selamat pagi", "selamat siang", "selamat sore", "selamat malam",
    "pagi", "siang", "sore", "malam",
    "sapa", "sapa bps", "sapa-bps", "sapabps", "bps",
    "tes", "test", "ping", "start", "mulai", "buka"
  ];
  const isGreeting = GREETINGS.some(g => msgClean === g || msgClean.startsWith(g + ' ') || msgClean.endsWith(' ' + g)) ||
    msgClean.includes('sapa bps') || msgClean.includes('sapabps');
  if (isGreeting) {
    return getFriendlyGreeting(faqData);
  }

  // 5. Menu Utama
  const MENU_TRIGGERS = [
    "menu", "bantuan", "help", "info", "daftar", "pilihan", "list", "topik",
    "menu sapa", "menu sapa bps", "menu bps", "lihat menu", "buka menu", "tampilkan menu", "layanan"
  ];
  const isMenuTrigger = MENU_TRIGGERS.some(m => msgClean === m || msgClean.startsWith(m + ' ') || msgClean.endsWith(' ' + m) || msgClean === 'menu');
  if (isMenuTrigger) {
    return generateDynamicMenu(faqData);
  }

  // 6. Input Pilihan Nomor Menu Dinamis
  if (/^\d+$/.test(msgClean)) {
    const num = parseInt(msgClean, 10);
    const menuItems = getDynamicMenuItems();
    const matchedItem = menuItems.find((m) => m.number === num);

    if (matchedItem) {
      if (matchedItem.type === 'service') {
        if (matchedItem.label.includes('Petugas') || matchedItem.label.includes('PST')) {
          return PST_CONTACT_CARD;
        }
        if (faqData && faqData[matchedItem.label]) {
          return formatPrettyResponse(matchedItem.label, faqData[matchedItem.label]);
        }
        return formatPrettyResponse(
          'Layanan BPS Kabupaten Bangka',
          'Layanan BPS Kabupaten Bangka mencakup:\n1. Konsultasi Statistik Terpadu (PST)\n2. Permintaan Data Mikro dan Publikasi Resmi BPS\n3. Rekomendasi Kegiatan Statistik (Romantik)\n4. Layanan Pengaduan & Informasi Publik\n\nHubungi petugas kami untuk layanan tatap muka atau daring.'
        );
      }

      // Tipe 'dataset': Cek apakah kategori ini memiliki LEBIH DARI 1 DATASET TERBITAN
      const store = loadBackendStore();
      const targetCategory = (matchedItem.datasetCategory || matchedItem.label).trim().toLowerCase();
      const categoryDatasets = store.datasets.filter((d) => {
        if (d.status !== DataStatus.PUBLISHED) return false;
        const recCount = store.records.filter((r) => r.dataset_id === d.id && r.status === DataStatus.PUBLISHED && !r.is_deleted && r.value !== null).length;
        if (recCount === 0) return false;
        return (
          d.category.trim().toLowerCase() === targetCategory ||
          d.name.trim().toLowerCase().includes(targetCategory)
        );
      });

      if (categoryDatasets.length > 1) {
        pendingSubmenuSessions.set(sessionId, {
          category: matchedItem.label,
          datasets: categoryDatasets.map((d) => ({ id: d.id, name: d.name, code: d.code })),
          timestamp: Date.now(),
        });

        const lines = categoryDatasets.map((d, i) => `${i + 1}. *${d.name}* (${d.code})`);
        return (
          `📊 *PILIHAN DATASET: ${matchedItem.label.toUpperCase()}*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Terdapat *${categoryDatasets.length} dataset statistik resmi* dalam kategori ini. Silakan balas dengan nomor dataset yang ingin Anda lihat lebih rinci:\n\n` +
          lines.join('\n') +
          `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💡 _Balas dengan angka *1* - *${categoryDatasets.length}* untuk melihat data rinci, atau ketik *menu* untuk kembali ke Menu Utama._`
        );
      }

      // Jika hanya ada 1 dataset, langsung jawab data resminya
      const liveData = getPublishedDatasetResponse(matchedItem.datasetId || matchedItem.datasetCategory || matchedItem.datasetName || matchedItem.label);
      if (liveData) {
        console.log(`[MENU LIVE DATA MATCH] Menu ${num} (${matchedItem.label}) dijawab dengan data dinamis website.`);
        return liveData;
      }

      const item = getFAQByIndex(num, faqData);
      if (item) {
        return formatPrettyResponse(item.topic, item.answer);
      }
    }

    return `Maaf, pilihan nomor *${num}* belum tersedia.\n\n${generateDynamicMenu(faqData)}`;
  }

  // 7. LOOKUP DATA DARI WEBSITE ADMIN (Prioritas Utama: Data Terkini yang diinput/diedit via web)
  const websiteDataResult = tryMatchWebsiteData(message);
  if (websiteDataResult) {
    console.log(`[WEBSITE DATA MATCH] Mengembalikan data terbaru dari website admin untuk: "${message}"`);
    return websiteDataResult;
  }

  // 7.5. EKSTRAKSI PRESISI DATABASE SEKUNDER / STATIS (Jika belum terdaftar di website admin)
  const granularDbResult = tryExtractGranularKB(message);
  if (granularDbResult) {
    console.log(`[DATABASE EXACT MATCH] Mengembalikan data presisi resmi untuk: "${message}"`);
    return granularDbResult;
  }

  // 8. Pencocokan Topik FAQ Langsung
  const exactTopic = findExactFAQMatch(message, faqData);
  if (exactTopic && faqData[exactTopic]) {
    return formatPrettyResponse(exactTopic, faqData[exactTopic]);
  }

  // 9. PERANGKAI KATA AI (QWEN2-VL BIONIC) UNTUK PERTANYAAN RAMAH & PERCAKAPAN UMUM
  console.log(`[AI LANGUAGE POLISHER] Meminta Qwen2-VL merangkai kalimat ramah untuk: "${message}"`);
  const qwenAnswer = await queryQwenAI(message);
  if (qwenAnswer && qwenAnswer.length > 5) {
    if (qwenAnswer.includes('📌') || qwenAnswer.includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━')) {
      return qwenAnswer;
    }
    return formatPrettyResponse('Informasi Data BPS Kab. Bangka', qwenAnswer);
  }

  return (
    `Mohon maaf, saat ini data untuk pertanyaan *"${message}"* belum dapat ditemukan di sistem kami.\n\n` +
    `💡 _Ketik *menu* untuk melihat daftar topik resmi, atau ketik *petugas* untuk berkonsultasi langsung dengan petugas PST BPS Kab. Bangka._`
  );
}

