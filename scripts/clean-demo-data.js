import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../db.json');

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// 1. Identifikasi dataset demo / dummy / test yang harus dihapus secara tuntas
const demoDatasetIds = [
  '1788506148149-oczhi4r', // INFL-001 (inflasi di bangka - dummy test)
  '1788419349379-uhpbiiy', // JUML-001 (Jumlah Umat - dummy test)
  'ds-7',                  // GDI-001 (Indeks Pembangunan Gender - DEMO / SAMPLE DATA)
  'ds-8',                  // EDU-001 (Angka Partisipasi Sekolah - DEMO / SAMPLE DATA)
];

const deletedSet = new Set(demoDatasetIds);

// 2. Perbarui deleted_dataset_ids agar sinkronisasi antarmuka tidak menghidupkan kembali dataset demo
const allDeletedIds = new Set([
  ...(db.deleted_dataset_ids || []),
  ...demoDatasetIds,
  '1788507642508-yjmkv49',
  '1788507655664-d3gfavc',
  'ds-rs89e24mtmn02tv'
]);
db.deleted_dataset_ids = Array.from(allDeletedIds);

// 3. Filter datasets (hapus dataset demo)
db.datasets = db.datasets.filter(d => !deletedSet.has(d.id));

// 4. Hapus kategori yang sudah tidak memiliki dataset aktif (cat-7: IPG dan kategori uji coba)
const activeCategoryCodes = new Set(db.datasets.map(d => d.code.split('-')[0]));
const activeCategoryNames = new Set(db.datasets.map(d => d.category));

db.categories = db.categories.filter(c => {
  if (c.id === 'cat-99' || c.id === 'cat-7') return false;
  if (c.code === 'GDI') return false;
  return true;
});

// 5. Filter records: hapus records dari dataset demo dan records bertanda DEMO / Test / Uji Coba
const recordsToRemove = new Set([
  'rec-pop-2020',
  'rec-pop-2021',
  'rec-pop-2022',
  'rec-pop-2023',
  'rec-pop-2024',
  'rec-pop-2025',
  'rec-gdi-2021',
  'rec-gdi-2022',
  'rec-gdi-2023',
  'rec-29',
  'rec-30',
  'rec-31',
  'rec-32',
  'rec-33',
  'rec-34',
  'rec-94uozy0mtmmp2pr',
  'rec-u39c0lxmtmmrbao',
  'rec-rpwme6ymtmn02u5',
  '1788495901347-eke7xvr',
  '1788495901347-pujk9xl',
  '1788495901347-ehx9s7b',
  '1788495901347-20jutbo'
]);

db.records = db.records.filter(r => {
  if (deletedSet.has(r.dataset_id)) return false;
  if (recordsToRemove.has(r.id)) return false;
  if (r.notes && r.notes.includes('DEMO')) return false;
  if (r.indicator && r.indicator.includes('Test')) return false;
  if (r.indicator && r.indicator.includes('Uji Coba')) return false;
  return true;
});

// 6. Kembalikan data proyeksi 2025 pada rec-5 (POP-001) ke angka resmi BPS (346.069 jiwa)
const rec5 = db.records.find(r => r.id === 'rec-5');
if (rec5) {
  rec5.value = 346069;
  rec5.notes = 'Proyeksi SP2020';
  rec5.status = 'PUBLISHED';
  rec5.is_deleted = false;
}

// 7. Hitung ulang record_count untuk seluruh dataset yang tersisa
db.datasets.forEach(d => {
  d.record_count = db.records.filter(r => r.dataset_id === d.id && !r.is_deleted).length;
});

// 8. Bersihkan customFaqs uji coba
db.customFaqs = [];

// 9. Bersihkan reviews uji coba yang mengacu pada data tidak valid
db.reviews = [];

// 10. Bersihkan auditLogs yang merujuk pada entitas demo / uji coba
const demoEntityIds = new Set([...demoDatasetIds, ...recordsToRemove, 'cat-99', 'cat-7']);
db.auditLogs = (db.auditLogs || []).filter(log => !demoEntityIds.has(log.entity_id));

// 11. Simpan kembali db.json dengan format JSON yang rapi
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');

console.log('=== PEMBERSIHAN DATA DEMO TUNTAS ===');
console.log('Jumlah Kategori Tersisa :', db.categories.length);
console.log('Jumlah Dataset Tersisa  :', db.datasets.length);
console.log('Jumlah Records Tersisa  :', db.records.length);
console.log('Tombstone IDs Terdaftar :', db.deleted_dataset_ids);
