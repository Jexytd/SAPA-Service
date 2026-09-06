import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_FILE = path.resolve(__dirname, '../../db.json');

export enum DataStatus {
  DRAFT = 'DRAFT',
  REVIEW = 'REVIEW',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export enum UserRole {
  DATA_ENTRY = 'DATA_ENTRY',
  REVIEWER = 'REVIEWER',
}

export enum PeriodType {
  YEARLY = 'YEARLY',
  QUARTERLY = 'QUARTERLY',
  MONTHLY = 'MONTHLY',
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  STATUS_CHANGE = 'STATUS_CHANGE',
  SUBMIT_REVIEW = 'SUBMIT_REVIEW',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  PUBLISH = 'PUBLISH',
  ARCHIVE = 'ARCHIVE',
}

export interface Dataset {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  definition: string;
  geographic_scope: string;
  unit: string;
  source: string;
  period_type: PeriodType;
  status: DataStatus;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  record_count?: number;
  is_deleted?: boolean;
}

export interface DataRecord {
  id: string;
  dataset_id: string;
  indicator: string;
  region: string;
  period: string;
  value: number | null;
  unit: string;
  notes: string;
  source: string;
  status: DataStatus;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

export interface AuditChange {
  field: string;
  old_value: string | number | null;
  new_value: string | number | null;
}

export interface AuditLog {
  id: string;
  entity_type: 'dataset' | 'record';
  entity_id: string;
  entity_name: string;
  action: AuditAction;
  changes: AuditChange[];
  user_id: string;
  user_name: string;
  reason?: string;
  created_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface ReviewRequest {
  id: string;
  dataset_id: string;
  dataset_name: string;
  record_ids: string[];
  description: string;
  submitted_by: string;
  submitted_by_name: string;
  submitted_at: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewed_by?: string;
  reviewed_by_name?: string;
  reviewed_at?: string;
  reject_reason?: string;
}

export interface Category {
  id: string;
  name: string;
  code: string;
  description: string;
}

export interface CustomFAQ {
  id: string;
  pertanyaan: string;
  jawaban: string;
  created_at: string;
  updated_at: string;
}

export interface BackendStore {
  datasets: Dataset[];
  records: DataRecord[];
  users: User[];
  reviews: ReviewRequest[];
  auditLogs: AuditLog[];
  categories: Category[];
  customFaqs?: CustomFAQ[];
  deleted_dataset_ids?: string[];
}

const DEFAULT_USERS: User[] = [
  { id: 'user-1', name: 'Ahmad Fauzi', email: 'ahmad.fauzi@bps.go.id', role: UserRole.DATA_ENTRY, created_at: '2025-01-01T00:00:00Z' },
  { id: 'user-2', name: 'Siti Nurhaliza', email: 'siti.nurhaliza@bps.go.id', role: UserRole.REVIEWER, created_at: '2025-01-01T00:00:00Z' },
  { id: 'user-3', name: 'Budi Santoso', email: 'budi.santoso@bps.go.id', role: UserRole.DATA_ENTRY, created_at: '2025-03-15T00:00:00Z' },
];

let globalStore: BackendStore | null = null;

export function loadBackendStore(): BackendStore {
  if (globalStore) return globalStore;

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
    } catch (err) {
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

export function saveBackendStore(store: BackendStore): boolean {
  try {
    globalStore = store;
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[ERROR] Gagal menyimpan backend store ke disk:', err);
    return false;
  }
}

/**
 * Menghasilkan dictionary FAQ yang teragregasi secara langsung dari dataset & rekaman aktif di db.json.
 */
export function getFAQDataFromStore(): Record<string, string> {
  const store = loadBackendStore();
  const faq: Record<string, string> = {};

  const publishedDs = store.datasets.filter(d => d.status === DataStatus.PUBLISHED && !d.is_deleted);

  for (const ds of publishedDs) {
    const recs = store.records
      .filter(r => r.dataset_id === ds.id && r.status === DataStatus.PUBLISHED && !r.is_deleted && r.value !== null)
      .sort((a, b) => b.period.localeCompare(a.period));

    if (recs.length === 0) continue;

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

export function syncDataToFAQ(_datasetName: string, _indicator: string, _year: string, _value: string | number, _unit: string) {
  // Seluruh data kini terkelola dan tersinkronisasi otomatis via db.json
}

export function syncAllPublishedToFAQ(): boolean {
  return true;
}
