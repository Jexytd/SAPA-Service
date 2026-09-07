import { loadBackendStore, DataStatus } from '../data/dbStore.js';

export interface DynamicMenuItem {
  number: number;
  label: string;
  type: 'dataset' | 'service';
  datasetId?: string;
  datasetName?: string;
  datasetCategory?: string;
  extraDesc?: string;
}

export interface ParsedMenuItem {
  number: number;
  label: string;
  extraDesc?: string;
  rawLine: string;
}

export function formatMenuNumber(num: number): string {
  return `${num}.`;
}

/**
 * Parsing teks baris menu bernomor (misal: "1. *Jumlah Penduduk*", "11. Portal Visualisasi Data BPS Kab Bangka (GARDA)")
 */
export function parseMenuLines(menuText: string): ParsedMenuItem[] {
  const items: ParsedMenuItem[] = [];
  if (!menuText) return items;

  const lines = menuText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // Cocokkan baris yang diawali angka dan titik / kurung tutup
    const match = trimmed.match(/^(\d+)[\.\)]\s*(.+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      const rest = match[2].trim();
      let label = rest;
      let extraDesc: string | undefined = undefined;

      // Cek apakah ada pemisah dash/colon untuk tautan atau deskripsi tambahan
      const sepMatch = rest.match(/^([^*_—–:\n\r]+?)(?:\s*[*_])?\s*[-–—:]\s*(.+)$/);
      if (sepMatch) {
        label = sepMatch[1].replace(/[*_~`]/g, '').trim();
        extraDesc = sepMatch[2].trim();
      } else {
        label = rest.replace(/[*_~`]/g, '').trim();
      }

      if (label) {
        items.push({
          number: num,
          label,
          extraDesc,
          rawLine: trimmed,
        });
      }
    }
  }
  return items;
}

/**
 * Menghasilkan daftar item menu secara dinamis:
 * 1. Jika pengguna telah menyetel template manual "Menu Utama", gunakan penomoran dari template tersebut.
 * 2. Jika default dinamis, setiap dataset berstatus PUBLISHED otomatis masuk ke daftar pilihan nomor.
 * 3. Opsi layanan berada di posisi terbawah.
 */
export function getDynamicMenuItems(faqData?: Record<string, string>): DynamicMenuItem[] {
  // 1. Jika ada custom Menu Utama dari template manual, parse langsung nomor-nomornya
  if (faqData) {
    const custom = faqData['Menu Utama'] || faqData['menu utama'] || faqData['MENU UTAMA'];
    if (custom && custom.trim()) {
      const cleanCustom = custom.replace(/<br\s*\/?>/gi, '\n');
      const parsed = parseMenuLines(cleanCustom);
      if (parsed.length > 0) {
        return parsed.map((p) => {
          const lower = p.label.toLowerCase();
          const isService =
            lower.includes('layanan') ||
            lower.includes('petugas') ||
            lower.includes('pst') ||
            lower.includes('admin') ||
            lower.includes('hubungi') ||
            lower.includes('portal') ||
            lower.includes('garda') ||
            lower.includes('aplikasi') ||
            lower.includes('website');
          return {
            number: p.number,
            label: p.label,
            type: isService ? 'service' : 'dataset',
            extraDesc: p.extraDesc,
          };
        });
      }
    }
  }

  // 2. Fallback: generate dinamis dari dataset aktif di store
  let publishedDatasets: { id: string; name: string; category: string }[] = [];
  try {
    const store = loadBackendStore();
    publishedDatasets = store.datasets.filter((d) => {
      if (d.status !== DataStatus.PUBLISHED || d.is_deleted) return false;
      const recCount = store.records.filter((r) => r.dataset_id === d.id && r.status === DataStatus.PUBLISHED && !r.is_deleted && r.value !== null).length;
      return recCount > 0;
    });
  } catch (e) {
    console.warn('[WARN] Gagal memuat backend store untuk menu dinamis:', e);
  }

  const items: DynamicMenuItem[] = [];
  const seenLabels = new Set<string>();
  let currentNum = 1;

  if (publishedDatasets.length > 0) {
    publishedDatasets.forEach((ds) => {
      const label = ds.category || ds.name;
      const lower = label.trim().toLowerCase();
      if (!seenLabels.has(lower)) {
        seenLabels.add(lower);
        items.push({
          number: currentNum++,
          label,
          type: 'dataset',
          datasetId: ds.id,
          datasetName: ds.name,
          datasetCategory: ds.category,
        });
      }
    });
  } else {
    const defaultTopics = [
      "Jumlah Penduduk",
      "Data Kemiskinan",
      "Pertumbuhan Ekonomi",
      "Indeks Pembangunan Manusia (IPM)",
      "Tenaga Kerja",
      "Produk Domestik Regional Bruto (PDRB)",
      "Pertanian dan Perkebunan",
      "Dimensi Pendidikan (RLS & HLS)",
    ];
    defaultTopics.forEach((topic) => {
      const lower = topic.trim().toLowerCase();
      if (!seenLabels.has(lower)) {
        seenLabels.add(lower);
        items.push({
          number: currentNum++,
          label: topic,
          type: 'dataset',
          datasetName: topic,
        });
      }
    });
  }

  // Tambahkan FAQ custom dari store (selain Menu Utama) jika ada
  try {
    const store = loadBackendStore();
    if (Array.isArray(store.customFaqs)) {
      for (const cf of store.customFaqs) {
        const p = (cf.pertanyaan || '').trim();
        const pLower = p.toLowerCase();
        if (!p || pLower === 'menu utama' || seenLabels.has(pLower)) continue;
        seenLabels.add(pLower);
        items.push({
          number: currentNum++,
          label: p,
          type: 'service',
        });
      }
    }
  } catch {}

  // 3 Layanan & Portal tambahan SELALU berada di posisi TERBAWAH
  items.push({
    number: currentNum++,
    label: 'Apa saja layanan BPS?',
    type: 'service',
  });

  items.push({
    number: currentNum++,
    label: 'Hubungi Petugas PST BPS',
    type: 'service',
  });

  items.push({
    number: currentNum++,
    label: 'Portal visualisasi data BPS Kab Bangka (GARDA)',
    type: 'service',
  });

  return items;
}

export function generateDynamicMenu(faqData?: Record<string, string>): string {
  if (faqData) {
    const custom = faqData['Menu Utama'] || faqData['menu utama'] || faqData['MENU UTAMA'];
    if (custom && custom.trim()) {
      return custom.replace(/<br\s*\/?>/gi, '\n');
    }
  }

  const menuItems = getDynamicMenuItems();

  const lines = menuItems.map((item) => {
    return `${item.number}. *${item.label}*`;
  });

  const lastNum = menuItems[menuItems.length - 1]?.number || 11;

  return (
    `📋 *MENU UTAMA LAYANAN DATA SAPA BPS*\n` +
    `🏛️ *BPS KABUPATEN BANGKA*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Silakan pilih topik informasi statistik resmi BPS Kab. Bangka berikut:\n\n` +
    lines.join('\n') +
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 _Balas dengan angka *1* - *${lastNum}*, ketik pertanyaan langsung (misal: "IPM 2024"), atau ketik *petugas* untuk konsultasi PST._`
  );
}

export function getFriendlyGreeting(faqData?: Record<string, string>): string {
  return (
    `Halo! Selamat datang di layanan *SAPA BPS Kab. Bangka* 📊\n` +
    `Sistem Asisten & Pelayanan Statistik Terpadu BPS Kabupaten Bangka.\n\n` +
    generateDynamicMenu(faqData)
  );
}

export function formatPrettyResponse(topic: string, content: string): string {
  const cleanContent = content.replace(/<br\s*\/?>/gi, '\n');
  return (
    `📌 *${topic}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${cleanContent}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 _Ketik *menu* untuk melihat topik data lainnya, atau ketik *petugas* jika butuh data lanjutan._`
  );
}

/**
 * Pencarian jawaban FAQ berbasis kecocokan fleksibel (Exact, Acronym dalam kurung, Substring, dan Token)
 */
export function findFaqResponseByLabel(label: string, faqData?: Record<string, string>): { topic: string; answer: string } | null {
  if (!faqData || !label) return null;

  // 1. Exact match
  if (faqData[label]) {
    return { topic: label, answer: faqData[label] };
  }

  const labelClean = label.trim().toLowerCase();
  const keys = Object.keys(faqData);

  // 2. Case-insensitive exact match
  const exactKey = keys.find(k => k.trim().toLowerCase() === labelClean);
  if (exactKey) {
    return { topic: exactKey, answer: faqData[exactKey] };
  }

  // 3. Match acronym in parentheses, e.g. "Portal Visualisasi Data BPS Kab Bangka (GARDA)" -> "GARDA"
  const parenMatch = label.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const acronym = parenMatch[1].trim().toLowerCase();
    const acronymKey = keys.find(k => {
      const kLower = k.trim().toLowerCase();
      return kLower === acronym || kLower.includes(acronym) || acronym.includes(kLower);
    });
    if (acronymKey) {
      return { topic: acronymKey, answer: faqData[acronymKey] };
    }
  }

  // 4. Substring match: key contains label or label contains key (minimal 3 karakter)
  const substringKey = keys.find(k => {
    const kLower = k.trim().toLowerCase();
    if (kLower.length < 3 || kLower === 'menu utama') return false;
    return labelClean.includes(kLower) || kLower.includes(labelClean);
  });
  if (substringKey) {
    return { topic: substringKey, answer: faqData[substringKey] };
  }

  // 5. Token overlap match (e.g. kata kunci "visualisasi", "garda", dsb.)
  const labelTokens = labelClean.split(/[\s,()/-]+/).filter(t => t.length >= 3 && !['bps', 'kab', 'bangka', 'dan', 'atau', 'data', 'untuk'].includes(t));
  let bestKey: string | null = null;
  let maxMatches = 0;
  for (const k of keys) {
    const kLower = k.trim().toLowerCase();
    if (kLower === 'menu utama') continue;
    let matches = 0;
    for (const token of labelTokens) {
      if (kLower.includes(token)) matches++;
    }
    if (matches > maxMatches) {
      maxMatches = matches;
      bestKey = k;
    }
  }

  if (bestKey && maxMatches > 0) {
    return { topic: bestKey, answer: faqData[bestKey] };
  }

  return null;
}

export function getFAQByIndex(indexNum: number, faqData: Record<string, string>): { topic: string; answer: string } | null {
  const menuItems = getDynamicMenuItems(faqData);
  const matched = menuItems.find((m) => m.number === indexNum);
  if (matched) {
    const res = findFaqResponseByLabel(matched.label, faqData);
    if (res) return res;

    if (matched.datasetCategory) {
      const catRes = findFaqResponseByLabel(matched.datasetCategory, faqData);
      if (catRes) return catRes;
    }
    if (matched.extraDesc) {
      return { topic: matched.label, answer: matched.extraDesc };
    }
  }

  return null;
}
