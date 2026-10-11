# XAU/USD Signal Unified Realtime — Forex & Gold Analytics

Sistem notifikasi otomatis Telegram & Web Dashboard Real-Time untuk analisis berita ekonomi high-impact USD (*Forex Factory, Investing.com, Nasdaq, Google News*) dan sinyal trading fundamental **XAU/USD (Gold / Emas)**.

---

## 🌟 Fitur Utama

1. 🌐 **Unified Realtime Feed System**
   - Menggabungkan rilis kalender ekonomi (*Forex Factory*) dan headline berita pasar (*Investing.com, Google News Gold/Fed*) dalam 1 aliran terpadu tanpa pemisahan kaku.
   - Pengecekan otomatis (**1-Minute Polling**) dengan fitur deduplikasi notifikasi otomatis untuk mencegah pesan ganda.
   - Perekaman status kesehatan & log kegagalan scraper (*Scraper Health Logger*) secara real-time dengan mekanisme auto-fallback.

2. ⏰ **Konversi Waktu Presisi WIB (Asia/Jakarta)**
   - Menangani secara presisi penyesuaian zona waktu *Eastern Time* (ET/EDT) dari Forex Factory dan *GMT/UTC* dari RSS Feeds ke **Waktu Indonesia Barat (WIB / UTC+7)**.

3. 🧠 **Signal Engine Fundamental XAU/USD & Logika Korelasi**
   - **Pre-Release Analysis**: Menganalisis ekspektasi pasar (`Forecast` vs `Previous`) sebelum data rilis (`Actual` = `-`).
   - **Post-Release Analysis**: Menganalisis dampak riil (`Actual` vs `Forecast`) setelah rilis data.
   - **Penanganan Indikator Normal vs Inverted**:
     - *Normal* (NFP, CPI, GDP, Retail Sales, ISM PMI, dll): Data membaik $\rightarrow$ USD Menguat $\rightarrow$ Sinyal **SELL XAU/USD** 🔴.
     - *Inverted* (Unemployment Claims, Jobless Claims, Defisit Trade Balance, dll): Data memburuk (angka naik) $\rightarrow$ USD Melemah $\rightarrow$ Sinyal **BUY XAU/USD** 🟢.

4. 🖼️ **Card Signal Image & Telegram Digest**
   - Notifikasi Telegram otomatis berupa **Gambar Card Visual Elegan** (dibuat via `@napi-rs/canvas`) untuk rilis kalender ekonomi.
   - **Headline Digest** ringkas yang memuat rangkuman berita pasar ber-sinyal tegas **BUY** atau **SELL**.

5. 💻 **Web Dashboard Realtime (Express + SSE Stream)**
   - Akses melalui browser pada `http://localhost:3000`.
   - **TradingView Embed Chart XAU/USD Gold** interaktif berbasis zona waktu WIB.
   - Real-time zero-delay broadcast menggunakan **Server-Sent Events (SSE)**.
   - Ringkasan statistik sinyal harian (Total Berita, Sinyal BUY, Sinyal SELL).
   - Filter interaktif berdasarkan waktu (Hari Ini WIB / Terbaru), sumber berita, dan tingkat impact (High / Medium).
   - Modal **Scraper Health & Error Logs** live di navbar.

6. 🗄️ **Supabase Database Integration**
   - Data berita & kalender ekonomi otomatis disinkronisasikan (*upsert*) ke database **Supabase** secara real-time untuk penyimpanan historis yang cepat dan stabil.

7. 🛡️ **Filter Berita & Noise Removal**
   - Sistem menapis otomatis berita yang tidak relevan (seperti crypto, saham individu, berita olahraga "Gold medal", pasangan mata uang non-USD) sehingga notifikasi fokus 100% pada XAU/USD & fundamental USD/Emas.

---

## 🗂️ Struktur Direktori Proyek

```text
bot script notif/
├── src/
│   ├── index.js                  # Entry point (Express Web Server, SSE Stream, Polling & Telegram Handlers)
│   ├── bot/
│   │   └── telegram.js           # Client wrapper Telegram Bot API
│   ├── engine/
│   │   └── signalEngine.js       # Engine analisis korelasi fundamental (Inverted/Normal, Pre/Post Release)
│   ├── formatter/
│   │   ├── imageGenerator.js     # Pembuat Card Notifikasi Visual (@napi-rs/canvas)
│   │   └── messageFormatter.js   # Formatter teks Telegram, summary harian/mingguan & digest
│   ├── scheduler/
│   │   └── cronJob.js            # Runner scheduler (node-schedule)
│   ├── scraper/
│   │   ├── forexFactory.js       # Scraper Forex Factory (High & Medium Impact USD)
│   │   ├── investing.js          # Scraper Investing.com RSS Feed
│   │   ├── apifyCalendar.js      # Scraper Apify Client
│   │   ├── puppeteerScraper.js   # Stealth Puppeteer Web Scraper
│   │   ├── rapidApiCalendar.js   # RapidAPI Calendar Integration
│   │   ├── unifiedFeed.js        # Engine agregasi terpadu berita & kalender
│   │   └── parser.js             # Numeric parser (K, M, B, %) & Konversi ET/GMT to WIB
│   ├── services/
│   │   ├── groqAnalyzer.js       # Groq AI Fundamental News Analyzer (Opsional)
│   │   └── supabaseService.js    # Client database Supabase Integration
│   └── utils/
│       ├── config.js             # Environment Variables Loader
│       ├── logger.js             # Winston-style Logger
│       ├── newsFilter.js         # Relevance Filter XAU/USD vs Noise
│       └── scrapeLogger.js       # Health Monitor Scraper & Error Tracking
├── public/                       # Web Dashboard Frontend (HTML, CSS, JS)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── test/
│   └── test-parser.js            # Automated Test Suite (Unit Test Parser & Signal Engine)
├── .env.example                  # Template variabel lingkungan
├── Procfile                      # Deployment configuration (Heroku/VPS)
├── railway.json                  # Deployment configuration (Railway)
├── supabase_schema.sql           # Skrip DDL SQL untuk Supabase Database
└── README.md                     # Dokumentasi Sistem & Panduan Pemasangan
```

---

## 🚀 Perintah Bot Telegram

| Perintah | Fungsi & Deskripsi |
|---|---|
| `/start` | Sambutan & daftar perintah bot |
| `/check` | Mengambil berita & sinyal terpadu real-time secara instan |
| `/today` | Menampilkan jadwal rilis berita & kalender ekonomi hari ini (WIB) |
| `/weekly` atau `/week` | Menampilkan jadwal lengkap kalender ekonomi minggu ini (WIB) |
| `/logs` | Cek status kesehatan scraper & 5 log error terakhir |
| `/status` | Cek status bot, uptime server, dan jadwal polling berikutnya |
| `/help` | Panduan bantuan penggunaan bot |

---

## 🛠️ Panduan Instalasi & Setup

### 1. Prasyarat Sistem
- **Node.js**: v18.x atau v20.x (disarankan Node.js v20+)
- **npm**: v9.x ke atas

### 2. Install Dependencies
```bash
# Masuk ke direktori proyek
cd "bot script notif"

# Install seluruh package
npm install
```

### 3. Setup Konfigurasi Environment Variables (`.env`)
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
Buka file `.env` lalu sesuaikan kredensial Anda:
```env
# Configuration Server
PORT=3000
NODE_ENV=development
TIMEZONE=Asia/Jakarta

# Configuration Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here

# Supabase Database Integration (Opsional tapi Disarankan)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_anon_key

# Groq AI Fundamental Analysis (Opsional)
GROQ_API_KEY=gsk_your_groq_api_key

# RapidAPI / Apify Token (Opsional)
RAPIDAPI_KEY=your_rapidapi_key
APIFY_API_TOKEN=your_apify_token
```

### 4. Setup Database Supabase
1. Buat proyek baru di [Supabase](https://supabase.com).
2. Buka menu **SQL Editor** pada Supabase Dashboard.
3. Jalankan query dari file [supabase_schema.sql](file:///c:/Users/julyi/Downloads/bot%20script%20notif/supabase_schema.sql).
4. Salin `SUPABASE_URL` dan `SUPABASE_KEY` ke dalam file `.env`.

### 5. Jalankan Automated Test Suite
Pastikan parser, konversi waktu, filter berita, dan logika sinyal berfungsi normal:
```bash
npm test
```

### 6. Menjalankan Application & Bot
```bash
# Menjalankan Server & Bot Telegram
npm start

# Mode Development
npm run dev
```

---

## 💻 Cara Menggunakan Web Dashboard

1. Setelah menjalankan `npm start`, buka browser dan navigasi ke:
   `http://localhost:3000`
2. **Fitur Dashboard**:
   - 📈 **Realtime TradingView Chart**: Visualisasi pergerakan harga Gold (XAU/USD) dalam zona waktu WIB.
   - ⚡ **Zero-Delay SSE Broadcast**: Notifikasi & berita baru yang masuk akan langsung memperbarui tampilan tanpa perlu refresh halaman.
   - 📊 **Signal Counter**: Menampilkan total kejadian, jumlah sinyal **BUY**, dan sinyal **SELL**.
   - 🔍 **Multi-Filter**: Saring berita berdasarkan rentang waktu, sumber berita, dan tingkat impact.
   - 🏥 **Scraper Logs Modal**: Klik tombol **Scraper Logs** di bagian atas untuk memeriksa status kesehatan setiap scraper dan daftar error log.

---

## 🧠 Logika Korelasi Fundamental XAU/USD

Emas (XAU/USD) berelasi terbalik (*inverse correlation*) dengan mata uang US Dollar (USD):

```text
1. Indikator Normal (NFP, CPI, GDP, Retail Sales, ISM PMI, dll):
   - Actual / Forecast > Base (Data Membaik) ➔ USD Menguat ➔ REKOMENDASI SELL XAU/USD 🔴
   - Actual / Forecast < Base (Data Memburuk) ➔ USD Melemah ➔ REKOMENDASI BUY XAU/USD 🟢

2. Indikator Inverted (Unemployment Claims, Jobless Claims, Trade Deficit, dll):
   - Actual / Forecast > Base (Pengangguran Naik/Memburuk) ➔ USD Melemah ➔ REKOMENDASI BUY XAU/USD 🟢
   - Actual / Forecast < Base (Pengangguran Turun/Membaik) ➔ USD Menguat ➔ REKOMENDASI SELL XAU/USD 🔴
```

---

## ☁️ Panduan Deployment (Railway / VPS)

Proyek ini telah dikonfigurasi untuk kemudahan deployment menggunakan `Procfile` dan `railway.json`:

### Deploy ke Railway
1. Push repository Anda ke GitHub.
2. Buat proyek baru di [Railway](https://railway.app) dan hubungkan repository GitHub.
3. Atur **Environment Variables** di dashboard Railway sesuai dengan file `.env`.
4. Railway akan otomatis menjalankan `npm start`.

---

## ⚠️ Disclaimer

> Notifikasi, sinyal, dan analisis yang dihasilkan oleh sistem ini bersifat **Analisis Fundamental & Sentimen Pasar** sebagai alat bantu referensi trading. Keputusan eksekusi transaksi sepenuhnya berada di tangan masing-masing trader. Selalu terapkan manajemen risiko (*Risk Management*) dengan disiplin.
