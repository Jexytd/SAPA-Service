import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FAQItem {
  pertanyaan: string;
  jawaban: string;
}

export const INFLASI_REDIRECT_CARD = 
`📌 *Informasi Data Inflasi / IHK*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mohon maaf, *BPS Kabupaten Bangka tidak menghitung atau merilis angka Inflasi secara mandiri*.

📊 *Ketentuan Statistik Resmi BPS:*
Di Pulau Bangka, pemantauan inflasi dan penghitungan Indeks Harga Konsumen (IHK) dihitung dan dirilis secara resmi oleh *BPS Kota Pangkalpinang* serta *BPS Provinsi Kepulauan Bangka Belitung*.

🏛️ *Rujukan Data Inflasi Resmi:*
Untuk mengakses publikasi dan rilis resmi data inflasi terkini, Anda dapat mengunjungi layanan BPS berikut:
• *Website BPS Kota Pangkalpinang:* https://pangkalpinangkota.bps.go.id
• *Website BPS Provinsi Kep. Babel:* https://babel.bps.go.id
• *PST BPS Pangkalpinang:* Komplek Perkantoran Pemkot Pangkalpinang

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Ketik *menu* untuk melihat topik data resmi Kab. Bangka, atau ketik *petugas* jika butuh data lanjutan._`;

export const PST_CONTACT_CARD = 
`🏛️ *LAYANAN KONSULTASI STATISTIK TERPADU (PST)*
*Badan Pusat Statistik Kabupaten Bangka*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏢 *Alamat Kantor:*
Jl. Ahmad Yani Jalur Dua, Sungailiat, Kab. Bangka

⏰ *Jam Layanan:*
Senin – Jumat (08.00 – 15.30 WIB)

📞 *Kontak Resmi Petugas:*
• *Telepon / Fax:* (0717) 92492
• *WhatsApp PST:* https://wa.me/6281234567890
• *Email:* bps1901@bps.go.id
• *Website Resmi:* http://bangkakab.bps.go.id

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Silakan hubungi kontak di atas pada jam kerja untuk dilayani oleh petugas kami._`;

export const DEFAULT_FAQ_DATA: Record<string, string> = {
  "Jumlah Penduduk": "Jumlah Penduduk Kabupaten Bangka tahun 2025 tercatat sebanyak *346.069 jiwa*.<br><br>📊 *Sumber:* Proyeksi Penduduk 2020-2035 Hasil SP2020 BPS.",
  "Data Kemiskinan": "📊 *DATA KEMISKINAN KABUPATEN BANGKA*<br><br>📍 *Kabupaten Bangka (2025):*<br>• Jumlah Penduduk Miskin: *16,58 ribu jiwa*<br>• Persentase Kemiskinan: *4,71%*<br>• Garis Kemiskinan: *Rp734.575 / kapita / bulan*<br>• Indeks Kedalaman (P1): *0,51* | Keparahan (P2): *0,09*<br><br>📍 *Perbandingan Kab/Kota Se-Babel (2025):*<br>1. Bangka Barat: *2,92%*<br>2. Bangka Selatan: *4,17%*<br>3. Pangkal Pinang: *4,50%*<br>4. Bangka: *4,71%*<br>5. Belitung: *6,44%*<br>6. Belitung Timur: *6,69%*<br>7. Bangka Tengah: *6,70%*<br><br>💡 _Tersedia juga data historis 2022-2024. Ketik tahun misal: *kemiskinan 2023*._",
  "Pertumbuhan Ekonomi": "📊 *LAJU PERTUMBUHAN EKONOMI KAB. BANGKA*<br><br>📈 *Pertumbuhan Tahunan:*<br>• 2021: *7,46%*<br>• 2022: *4,86%*<br>• 2023*: *4,42%* *(Angka Sementara)*<br>• 2024**: *-0,44%* *(Angka Sangat Sementara)*<br><br>📈 *Pertumbuhan Triwulanan 2025*** (y-on-y):*<br>• Triwulan I: *5,28%*<br>• Triwulan II: *4,14%*<br>• Triwulan III: *5,19%*<br><br>🏭 *Sektor Tertinggi 2024:* Informasi & Komunikasi (*10,64%*), Jasa Pendidikan (*10,56%*), Jasa Lainnya (*8,39%*).",
  "Indeks Pembangunan Manusia (IPM)": "📊 *INDEKS PEMBANGUNAN MANUSIA (IPM) KAB. BANGKA*<br><br>🌟 *Tahun 2025:* IPM *75,38* *(Naik 0,96% dari 2024)*<br>• Umur Harapan Hidup (UHH): *73,56 tahun*<br>• Rata-rata Lama Sekolah (RLS): *8,77 tahun*<br>• Harapan Lama Sekolah (HLS): *13,13 tahun*<br>• Pengeluaran per Kapita: *Rp 13.411.000,- / tahun*<br><br>📈 *Perkembangan IPM Sebelumnya:*<br>• 2024: *74,66* | UHH: 73,24 | RLS: 8,45 | HLS: 13,12<br>• 2023: *74,34* | UHH: 73,03 | RLS: 8,32 | HLS: 13,11<br>• 2022: *73,62* | 2021: *73,13*",
  "Tenaga Kerja": "📊 *DATA KETENAGAKERJAAN KAB. BANGKA (2021-2025)*<br><br>💼 *Tahun 2025:*<br>• Tingkat Partisipasi Angkatan Kerja (TPAK): *67,93%*<br>• Tingkat Pengangguran Terbuka (TPT): *4,75%*<br><br>📉 *Tren TPT (Pengangguran):*<br>• 2021: TPAK 62,68% | TPT 5,97%<br>• 2022: TPAK 68,81% | TPT 5,39%<br>• 2023: TPAK 67,46% | TPT 5,03%<br>• 2024: TPAK 67,92% | TPT 4,91%<br>• 2025: TPAK 67,93% | TPT 4,75%",
  "Produk Domestik Regional Bruto (PDRB)": "📊 *PDRB KABUPATEN BANGKA*<br><br>💰 *Tahunan (Miliar Rupiah):*<br>• 2024**: ADHB *Rp 20.003,49 M* | ADHK *Rp 11.702,39 M*<br>• 2023*: ADHB *Rp 19.279,60 M* | ADHK *Rp 11.753,74 M*<br>• 2022: ADHB *Rp 17.956,28 M* | ADHK *Rp 11.255,79 M*<br>• 2021: ADHB *Rp 16.166,01 M* | ADHK *Rp 10.733,86 M*<br><br>💰 *Triwulanan 2025*** (Miliar Rupiah):*<br>• Triwulan I: ADHB *Rp 5.112,05 M* | ADHK *Rp 2.911,99 M*<br>• Triwulan II: ADHB *Rp 5.461,29 M* | ADHK *Rp 3.078,58 M*<br>• Triwulan III: ADHB *Rp 5.498,78 M* | ADHK *Rp 3.077,85 M*<br><br>🌾 *Tambahan Produksi Padi 2025:* *7.949 ton GKG* (Luas Panen *2.979 ha* - naik 60,78%).",
  "Pertanian dan Perkebunan": "🌾 *DATA PERTANIAN DAN PERKEBUNAN KAB. BANGKA*<br><br>🌾 *Komoditas Padi (Tahun 2025):*<br>• Luas Panen Padi: *2.979 hektar* (naik 59,99% / +1.117 ha dari tahun 2024 sebesar 1.862 ha)<br>• Produksi Padi: *7.949 ton GKG* (naik 60,78% / +3.005 ton GKG dari tahun 2024 sebesar 4.944 ton GKG)<br><br>💡 _Sumber: Data Statistik Pertanian BPS Kabupaten Bangka._",
  "Dimensi Pendidikan (RLS & HLS)": "📚 *DIMENSI PENDIDIKAN KABUPATEN BANGKA (2021-2025)*<br><br>📖 *Harapan Lama Sekolah (HLS, tahun):*<br>• 2021: *12,78 tahun*<br>• 2022: *12,80 tahun*<br>• 2023: *13,11 tahun*<br>• 2024: *13,12 tahun*<br>• 2025: *13,13 tahun*<br><br>🎓 *Rata-Rata Lama Sekolah (RLS, tahun):*<br>• 2021: *8,25 tahun*<br>• 2022: *8,27 tahun*<br>• 2023: *8,32 tahun*<br>• 2024: *8,45 tahun*<br>• 2025: *8,77 tahun*<br><br>💡 *Definisi Resmi BPS:*<br>• *RLS:* Jumlah tahun yang dijalani penduduk usia 25 tahun ke atas dalam pendidikan formal.<br>• *HLS:* Lama sekolah yang diharapkan dirasakan anak usia 7 tahun ke atas di masa mendatang.",
  "Apa saja layanan BPS?": "🏢 *LAYANAN RESMI BPS KABUPATEN BANGKA*<br><br>1. *Pelayanan Statistik Terpadu (PST):* Permintaan data & konsultasi statistik bagi masyarakat, mahasiswa/peneliti, dan instansi pemerintah.<br>2. *Publikasi Statistik:* Akses buku statistik & Berita Resmi Statistik (BRS) melalui portal bangkakab.bps.go.id.<br>3. *Rekomendasi Kegiatan Statistik:* Evaluasi rancangan survei (ROMANTIK).<br>4. *Konsultasi Statistik Sektoral:* Bimbingan teknis statistik bagi OPD / instansi pemerintah daerah.<br><br>💡 Untuk konsultasi langsung, silakan ketik *10* atau ketik *petugas*.",
  "Hubungi Petugas PST BPS": PST_CONTACT_CARD
};

import { getFAQDataFromStore } from './dbStore.js';

export function loadFAQData(): Record<string, string> {
  try {
    const storeFaq = getFAQDataFromStore();
    return { ...DEFAULT_FAQ_DATA, ...storeFaq };
  } catch (err) {
    return { ...DEFAULT_FAQ_DATA };
  }
}

export function saveFAQData(_data: Record<string, string>): boolean {
  return true;
}
