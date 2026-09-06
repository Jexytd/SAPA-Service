import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_FILE = path.resolve(__dirname, '../../db.json');
export var DataStatus;
(function (DataStatus) {
    DataStatus["DRAFT"] = "DRAFT";
    DataStatus["REVIEW"] = "REVIEW";
    DataStatus["PUBLISHED"] = "PUBLISHED";
    DataStatus["ARCHIVED"] = "ARCHIVED";
})(DataStatus || (DataStatus = {}));
export var UserRole;
(function (UserRole) {
    UserRole["DATA_ENTRY"] = "DATA_ENTRY";
    UserRole["REVIEWER"] = "REVIEWER";
})(UserRole || (UserRole = {}));
export var PeriodType;
(function (PeriodType) {
    PeriodType["YEARLY"] = "YEARLY";
    PeriodType["QUARTERLY"] = "QUARTERLY";
    PeriodType["MONTHLY"] = "MONTHLY";
})(PeriodType || (PeriodType = {}));
export var AuditAction;
(function (AuditAction) {
    AuditAction["CREATE"] = "CREATE";
    AuditAction["UPDATE"] = "UPDATE";
    AuditAction["DELETE"] = "DELETE";
    AuditAction["STATUS_CHANGE"] = "STATUS_CHANGE";
    AuditAction["SUBMIT_REVIEW"] = "SUBMIT_REVIEW";
    AuditAction["APPROVE"] = "APPROVE";
    AuditAction["REJECT"] = "REJECT";
    AuditAction["PUBLISH"] = "PUBLISH";
    AuditAction["ARCHIVE"] = "ARCHIVE";
})(AuditAction || (AuditAction = {}));
const DEFAULT_USERS = [
    { id: 'user-1', name: 'Ahmad Fauzi', email: 'ahmad.fauzi@bps.go.id', role: UserRole.DATA_ENTRY, created_at: '2025-01-01T00:00:00Z' },
    { id: 'user-2', name: 'Siti Nurhaliza', email: 'siti.nurhaliza@bps.go.id', role: UserRole.REVIEWER, created_at: '2025-01-01T00:00:00Z' },
    { id: 'user-3', name: 'Budi Santoso', email: 'budi.santoso@bps.go.id', role: UserRole.DATA_ENTRY, created_at: '2025-03-15T00:00:00Z' },
];
let globalStore = null;
export function loadBackendStore() {
    if (globalStore)
        return globalStore;
    if (fs.existsSync(STORE_FILE)) {
        try {
            const content = fs.readFileSync(STORE_FILE, 'utf-8');
            globalStore = JSON.parse(content);
            if (globalStore && Array.isArray(globalStore.datasets)) {
                if (!Array.isArray(globalStore.deleted_dataset_ids)) {
                    globalStore.deleted_dataset_ids = [];
                }
                return globalStore;
            }
        }
        catch (err) {
            console.warn('[WARN] Gagal membaca db_store.json, menggunakan inisialisasi default:', err);
        }
    }
    globalStore = {
        datasets: [],
        records: [],
        users: [...DEFAULT_USERS],
        reviews: [],
        auditLogs: [],
        categories: [],
        deleted_dataset_ids: [],
    };
    saveBackendStore(globalStore);
    return globalStore;
}
export function saveBackendStore(store) {
    try {
        globalStore = store;
        fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
        return true;
    }
    catch (err) {
        console.error('[ERROR] Gagal menyimpan backend store ke disk:', err);
        return false;
    }
}
/**
 * Menghasilkan dictionary FAQ yang teragregasi secara langsung dari dataset & rekaman aktif di db.json.
 */
export function getFAQDataFromStore() {
    const store = loadBackendStore();
    const faq = {};
    const publishedDs = store.datasets.filter(d => d.status === DataStatus.PUBLISHED && !d.is_deleted);
    for (const ds of publishedDs) {
        const recs = store.records
            .filter(r => r.dataset_id === ds.id && r.status === DataStatus.PUBLISHED && !r.is_deleted && r.value !== null)
            .sort((a, b) => b.period.localeCompare(a.period));
        if (recs.length === 0)
            continue;
        const lines = recs.map(r => {
            const valStr = typeof r.value === 'number' ? r.value.toLocaleString('id-ID') : r.value;
            const noteStr = r.notes ? ` _(${r.notes})_` : '';
            return `• *Tahun ${r.period} (${r.indicator}):* *${valStr} ${r.unit || ds.unit}*${noteStr}`;
        });
        const keyName = ds.name.trim();
        const keyCategory = ds.category.trim();
        const faqBody = `📊 *DATA RESMI: ${ds.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n\n📁 *Kategori:* ${ds.category}\n🏢 *Sumber Data:* ${ds.source || 'BPS Kabupaten Bangka'}\n💡 _Data resmi ini terupdate secara real-time dari Katalog SAPA BPS 1901._`;
        faq[keyName] = faqBody.replace(/\n/g, '<br>');
        if (keyCategory && keyCategory !== keyName) {
            faq[keyCategory] = faqBody.replace(/\n/g, '<br>');
        }
    }
    // Tambahkan FAQ custom / template tambahan jika ada
    if (Array.isArray(store.customFaqs)) {
        for (const cf of store.customFaqs) {
            if (cf.pertanyaan && cf.jawaban) {
                faq[cf.pertanyaan.trim()] = cf.jawaban;
            }
        }
    }
    return faq;
}
export function syncDataToFAQ(_datasetName, _indicator, _year, _value, _unit) {
    // Seluruh data kini terkelola dan tersinkronisasi otomatis via db.json
}
export function syncAllPublishedToFAQ() {
    return true;
}
