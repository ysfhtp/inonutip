# İnönü Üniversitesi Tıp Fakültesi Dönem I Ders Programı (v3.2.4)

İnönü Üniversitesi Tıp Fakültesi Dönem I (2026-2027) Türkçe ve İngilizce eğitim programı, canlı yemekhane menüleri, sınav ve geçme hesaplayıcısı, büyük boyutlu ders PDF'leri önbelleklemesi, anlık site kilit/açma özelliği ve Cloud SQL / Supabase bulut senkronizasyonunu destekleyen modern Progressive Web App (PWA).

## 🚀 Özellikler
- **Ders Programı & Takvim:** Türkçe ve İngilizce Dönem I müfredatı, MBU ve LAB grupları filtreleme, akıllı gün/hafta geçişleri ve iCal dışa aktarma.
- **Yemekhane Menüleri:** Canlı İnönü Üniversitesi yemekhane entegrasyonu, özel diyet menüleri ve günlük/haftalık görünüm.
- **Sınav & Geçme Hesaplayıcı:** Ara sınav, kurul sonu, pratik sınav ve yıl sonu final geçme hesaplamaları.
- **Ders PDF Yönetimi:** Büyük PDF dosyalarının (60 MB+) Supabase Storage / PostgreSQL chunked depolama ile yönetimi ve çevrimdışı önbellekleme.
- **Anlık Site Kilit / Açma:** Admin panelinden yapılan site kilit durumunun sayfa yenilemeye gerek kalmadan tüm cihazlarda anında güncellenmesi (SSE & Realtime).
- **Google ile Giriş & Not Yedekleme:** Firebase Auth ve Cloud SQL entegrasyonu ile kişisel ders notlarının cihazlar arası güvenli senkronizasyonu.

---

## 📦 Kurulum & Geliştirme

Gereksinimler: **Node.js 20+** veya **Bun**.

1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

2. Ortam değişkenlerini ayarlayın (`.env.example` dosyasını `.env` olarak kopyalayın):
   ```bash
   cp .env.example .env
   ```

3. Geliştirme sunucusunu başlatın:
   ```bash
   npm run dev
   ```

4. Üretim derlemesi (Build):
   ```bash
   npm run build
   ```

---

## 🌐 GitHub ve Bulut Dağıtımı (Deployment)

Bu proje hem **GitHub Pages** (statik ön yüz dağıtımı) hem de **Google Cloud Run / Render / Railway** (tam yığın Node.js + Cloud SQL arka ucu) üzerinde çalışacak şekilde tasarlanmıştır.

### GitHub Pages Dağıtımı
Proje kök dizinindeki `.github/workflows/deploy.yml` dosyası, `main` veya `master` dalına yapılan her push işleminde otomatik olarak GitHub Pages derlemesini gerçekleştirir.
- GitHub Deposu Ayarları -> **Secrets and variables** -> **Actions** bölümünden aşağıdaki değişkenleri tanımlayabilirsiniz:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

### Node.js + Cloud SQL Backend Dağıtımı
Tam yığın sunucu modunu (`server.ts` + Drizzle ORM + Cloud SQL PostgreSQL) çalıştırmak için:
- Ortam değişkenleri:
  - `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (isteğe bağlı Supabase senkronizasyonu için)
  - `PORT=3000`
- Başlatma komutu:
  ```bash
  npm start
  ```
