import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let pool: mysql.Pool | null = null;

export function getDBPool(): mysql.Pool | null {
  if (pool) return pool;

  const host = process.env.DB_HOST || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com';
  const port = parseInt(process.env.DB_PORT || '4000', 10);
  const user = process.env.DB_USER || '7GtMRc9PHdyS3Hw.root';
  const password = process.env.DB_PASSWORD || 'n23eyfIZyDJl3Wl1';
  const database = process.env.DB_NAME || 'sapa_bangka';

  try {
    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      ssl: {
        rejectUnauthorized: false
      }
    });
    return pool;
  } catch (err) {
    console.warn('[WARN] Gagal membuat koneksi database MySQL, fallback ke CSV mode.');
    return null;
  }
}
