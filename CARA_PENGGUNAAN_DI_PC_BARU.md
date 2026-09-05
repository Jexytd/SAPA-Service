# Panduan Memasang SAPA-Service & Auto-Start di PC Baru

Panduan ini digunakan ketika folder `SAPA-Service` dipindahkan ke PC lain (Windows) agar service WhatsApp bot dan tunnel Ngrok otomatis berjalan setiap kali komputer dinyalakan / login.

---

## 1. Persiapan di PC Baru

Pastikan hal-hal berikut sudah terpasang di PC baru:
1. **Node.js (LTS)**:
   - Unduh dan install dari [https://nodejs.org/](https://nodejs.org/).
   - Centang opsi default agar `npm` otomatis masuk ke system PATH.
2. **File Proyek**:
   - Salin seluruh folder `SAPA-Service` ke PC baru (misalnya diletakkan di `C:\BPS SAPA\SAPA-Service` atau `Desktop`).
   - Pastikan file `ngrok.exe` ikut terbawa di dalam folder ini.
3. **File `.env`**:
   - Pastikan file `.env` sudah ada di dalam folder.
   - Contoh isi `.env`:
     ```env
     PORT=8000
     API_KEY=UmlkaG9UYW1hbU5hdWZhbF9Qb2xtYW4=
     NGROK_DOMAIN=footless-aptitude-caloric.ngrok-free.dev
     # (Opsional) Jika ngrok di PC baru belum login authtoken:
     # NGROK_AUTHTOKEN=token_ngrok_anda
     ```

---

## 2. File Script yang Disediakan

| File Script | Fungsi |
|---|---|
| `install_autostart.bat` | **(Cukup dijalankan sekali)** Mendaftarkan auto-start mode **Silent / Hidden** ke Windows Startup agar service & ngrok otomatis berjalan di latar belakang tanpa jendela Command Prompt saat Windows login. |
| `start_bps.bat` | Menjalankan SAPA Service Backend dan Ngrok Tunnel di latar belakang (Hidden) tanpa command prompt. |
| `start_bps.vbs` | Launcher VBScript tanpa popup / kedipan konsol sama sekali. |
| `status_bps.bat` | Memeriksa apakah Backend dan Ngrok sedang aktif di background, menampilkan PID dan potongan log terakhir. |
| `stop_bps.bat` | Menghentikan service backend dan ngrok yang sedang berjalan di background. |
| `uninstall_autostart.bat` | Menghapus auto-start dari Windows Startup jika tidak ingin dijalankan otomatis lagi. |

---

## 3. Langkah Pemasangan (Sekali Saja di PC Baru)

1. Buka folder `SAPA-Service` di PC baru melalui Windows Explorer.
2. Klik dua kali file **`install_autostart.bat`**.
3. Script akan otomatis:
   - Membuat shortcut auto-start di folder Windows Startup:
     `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`
   - Menghubungkannya ke launcher silent (`start_bps.vbs`).
4. Saat ditanya apakah ingin langsung menjalankan service sekarang (`Y/N`), ketik **Y** lalu tekan **Enter**.
5. Service akan langsung berjalan di latar belakang (hidden). Anda tidak akan melihat jendela Command Prompt yang mengganggu layar.
6. Untuk memastikan service sudah berjalan, klik dua kali file **`status_bps.bat`**.
7. Log output WhatsApp Bot, REST API, dan Ngrok tersimpan otomatis di folder `logs\`:
   - `logs\service.log`: Berisi log WhatsApp Bot & REST API.
   - `logs\ngrok.log`: Berisi status koneksi dan URL publik ngrok.
   - `logs\launcher.log`: Riwayat waktu start background service.

---

## 4. Cara Kerja Auto-Start

- Setiap kali Windows dinyalakan dan Anda masuk ke akun Windows (login), sistem Windows akan otomatis mengeksekusi shortcut di folder Startup.
- Script akan mengecek dependensi (`npm install` otomatis jika pertama kali), membaca port dan domain dari `.env`, kemudian menjalankan backend dan ngrok.
- **Penting**: Biarkan kedua jendela terminal terminimalkan (jangan di-close tanda silang `X`) agar WhatsApp bot dan API tetap aktif melayani permintaan.
