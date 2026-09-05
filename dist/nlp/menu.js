import { loadBackendStore, DataStatus } from '../data/dbStore.js';
export function formatMenuNumber(num) {
    return `${num}.`;
}
/**
 * Menghasilkan daftar item menu secara dinamis:
 * 1. Setiap dataset berstatus PUBLISHED otomatis masuk ke daftar pilihan nomor.
 * 2. Menggunakan penomoran desimal biasa (1., 2., 3., ... 11., 12.) agar rapi untuk banyak dataset (>10).
 * 3. Opsi layanan (Apa saja layanan BPS & Hubungi Petugas) SELALU berada di 2 nomor terbawah.
 */
export function getDynamicMenuItems() {
    let publishedDatasets = [];
    try {
        const store = loadBackendStore();
        publishedDatasets = store.datasets.filter((d) => {
            if (d.status !== DataStatus.PUBLISHED)
                return false;
            const recCount = store.records.filter((r) => r.dataset_id === d.id && r.status === DataStatus.PUBLISHED && !r.is_deleted && r.value !== null).length;
            return recCount > 0;
        });
    }
    catch (e) {
        console.warn('[WARN] Gagal memuat backend store untuk menu dinamis:', e);
    }
    const items = [];
    const seenLabels = new Set();
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
    }
    else {
        const defaultTopics = [
            "Jumlah Penduduk",
            "Data Kemiskinan",
            "Pertumbuhan Ekonomi",
            "Indeks Pembangunan Manusia (IPM)",
            "Tenaga Kerja",
            "Produk Domestik Regional Bruto (PDRB)",
            "Indeks Pembangunan Gender (IPG)",
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
    // 2 Keyword layanan SELALU berada di 2 posisi TERBAWAH
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
    return items;
}
export function generateDynamicMenu(faqData) {
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
    const lastNum = menuItems[menuItems.length - 1]?.number || 10;
    return (`📋 *MENU UTAMA LAYANAN DATA SAPA BPS*\n` +
        `🏛️ *BPS KABUPATEN BANGKA*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Silakan pilih topik informasi statistik resmi BPS Kab. Bangka berikut:\n\n` +
        lines.join('\n') +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 _Balas dengan angka *1* - *${lastNum}*, ketik pertanyaan langsung (misal: "IPM 2024"), atau ketik *petugas* untuk konsultasi PST._`);
}
export function getFriendlyGreeting(faqData) {
    return (`Halo! Selamat datang di layanan *SAPA BPS Kab. Bangka* 😊\n` +
        `Sistem Asisten & Pelayanan Statistik Terpadu BPS Kabupaten Bangka.\n\n` +
        generateDynamicMenu(faqData));
}
export function formatPrettyResponse(topic, content) {
    const cleanContent = content.replace(/<br\s*\/?>/gi, '\n');
    return (`📌 *${topic}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${cleanContent}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 _Ketik *menu* untuk melihat topik data lainnya, atau ketik *petugas* jika butuh data lanjutan._`);
}
export function getFAQByIndex(indexNum, faqData) {
    const menuItems = getDynamicMenuItems();
    const matched = menuItems.find((m) => m.number === indexNum);
    if (matched) {
        if (faqData && faqData[matched.label]) {
            return { topic: matched.label, answer: faqData[matched.label] };
        }
        if (matched.datasetCategory && faqData && faqData[matched.datasetCategory]) {
            return { topic: matched.datasetCategory, answer: faqData[matched.datasetCategory] };
        }
    }
    const keys = Object.keys(faqData || {});
    if (indexNum >= 1 && indexNum <= keys.length) {
        const topic = keys[indexNum - 1];
        return { topic, answer: faqData[topic] };
    }
    return null;
}
