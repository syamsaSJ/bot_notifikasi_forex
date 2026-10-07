# 🤖 Bot XAU/USD Signal Unified Realtime — Forex & Gold Analytics

Sistem notifikasi otomatis & Web Dashboard realtime berita ekonomi high-impact USD (Forex Factory & Nasdaq) dan headline sentimen pasar (Investing.com, InvestingLive, Google News Gold/Fed) beserta analisis korelasi fundamental XAU/USD (Gold).

## ✨ Fitur Utama Baru

- 🌐 **Unified Realtime News Feed**: Seluruh rilis kalender ekonomi & headline berita pasar digabungkan dalam 1 aliran terpadu tanpa pemisahan kaku.
- ⏰ **Konversi Waktu Presisi WIB (Asia/Jakarta)**: Fix penanganan timezone GMT/UTC pada RSS Feeds & Eastern Time (ET) pada ForexFactory.
- 📋 **Scraping Error & Health Logging**: Perekaman log kegagalan scraping secara realtime yang dapat diakses melalui Web Dashboard dan Telegram Bot (`/logs`).
- ⚡ **1-Minute Realtime Polling**: Bot dan dashboard mengecek pembaharuan rilis berita setiap 1 menit secara otomatis.
- 🖼️ **Card Notifikasi & Headline Digest**: Notifikasi Telegram otomatis berupa gambar Card Elegan (untuk rilis kalender) dan Digest Ringkas (untuk berita pasar ber-sinyal BUY/SELL).

---

## 🚀 Perintah Bot Telegram

| Perintah | Fungsi |
|----------|--------|
| `/start` | Sambutan & daftar perintah |
| `/check` | Ambil berita & sinyal terpadu realtime secara instan |
| `/today` | Lihat jadwal rilis berita ekonomi hari ini (WIB) |
| `/logs`  | Cek status kesehatan scraper & 5 log error terakhir |
| `/status`| Cek status server bot & jadwal next polling |
| `/help`  | Panduan penggunaan |

---

## 💻 Web Dashboard Realtime

Server Dashboard berjalan di `http://localhost:3000`:
- **Chart Realtime XAU/USD Gold** (TradingView Embed WIB)
- **Ringkasan Sinyal Harian** (Jumlah rekomendasi BUY, SELL, Total Berita)
- **Filter Fleksibel**: Filter berdasarkan Waktu (Hari Ini WIB / Semua Terbaru), Sumber Data, dan Tingkat Impact (High / Medium)
- **Scraper Logs Modal**: Klik tombol "Scraper Logs" di header untuk melihat status kesehatan tiap scraper & log error.

---

## 🛠️ Cara Menjalankan

```bash
# 1. Install dependencies
npm install

# 2. Setup file environment
cp .env.example .env
# Edit .env dengan TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID

# 3. Uji Coba Parser & Logger
npm test

# 4. Jalankan Server & Bot
npm start
```

---

## 🧠 Logika Korelasi Fundamental XAU/USD

```
Indikator Normal (NFP, CPI, GDP, Retail Sales, dll):
  Actual / Forecast > Base → USD Menguat → REKOMENDASI SELL XAU/USD
  Actual / Forecast < Base → USD Melemah → REKOMENDASI BUY XAU/USD

Indikator Inverted (Unemployment Claims, Jobless Claims, Trade Balance Deficit, dll):
  Actual / Forecast > Base → USD Melemah → REKOMENDASI BUY XAU/USD
  Actual / Forecast < Base → USD Menguat → REKOMENDASI SELL XAU/USD
```

---

## ⚠️ Disclaimer

> Notifikasi & sinyal yang dihasilkan bersifat **Analisis Fundamental & Sentimen Pasar** sebagai referensi pendukung trading. Gunakan manajemen risiko yang bijak.
