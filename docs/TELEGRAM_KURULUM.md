# Mini Empire'ı Telegram'da yayınlama (adım adım)

Telegram Mini App'ler bir **HTTPS** adresinden açılır. İki yol var:

* **Yöntem A — Kendi bilgisayarınızdan (en kolay, ücretsiz):** `telegram-baslat.bat` çift tıklanır; oyun, ücretsiz
  bir Cloudflare tüneli üzerinden geçici bir https adresi alır. **Pencere açık kaldığı sürece** oyun Telegram'da çalışır.
* **Yöntem B — İnternette sürekli açık (Render.com):** bilgisayarınız kapalıyken de çalışır. Aşağıdaki 2. bölüm.

## Yöntem A: kendi bilgisayarınızdan
1. **Node.js LTS** kurun (https://nodejs.org) ve bilgisayarı yeniden başlatın. PostgreSQL **gerekmez** —
   oyun kendi gömülü veritabanını kullanır (`data/` klasörü).
2. BotFather'dan bir bot ve token alın (aşağıdaki 1. bölüm). Başka bir programın kullandığı bir botun token'ını
   **kullanmayın**; o program da aynı anda çalışırsa ikisi çakışır. Bu oyun için yeni bir bot açın.
3. Proje klasöründeki **`telegram-baslat.bat`** dosyasına çift tıklayın. İlk seferde token'ı soracak; yapıştırıp Enter'a basın.
4. "HAZIR!" yazısını görünce Telegram'da botunuza `/start` yazın ve **🏰 Oyunu Aç**'a dokunun.

Not: tünel adresi her başlatmada değişir; sunucu bot ayarlarını her açılışta yeni adrese göre kendisi günceller.
Bilgisayar kapanınca veya pencere kapanınca oyun durur, oyuncuların verileri `data/` klasöründe saklı kalır.

## 1. BotFather ile bot oluşturun
1. Telegram'da **@BotFather**'ı açın ve `/newbot` yazın.
2. Botun görünen adını yazın (örn. `Mini Empire`).
3. Kullanıcı adını yazın; `bot` ile bitmeli (örn. `MiniEmpireGameBot`).
4. BotFather size bir **token** verir: `123456789:AA...` gibi. **Kimseyle paylaşmayın**, bir yere kaydedin.

## 2. (Yöntem B) Oyunu internete koyun (Render.com, ücretsiz katman)
1. https://render.com adresinde GitHub hesabınızla kaydolun.
2. **New → Blueprint** seçin, `Mini-empire` deposunu ve `claude/mini-empire-strategy-game-8k1bxl` dalını seçin.
   Render, depodaki `render.yaml` dosyasını okuyup bir web servisi ve bir PostgreSQL veritabanı oluşturur.
3. `TELEGRAM_BOT_TOKEN` sorulduğunda BotFather'dan aldığınız token'ı yapıştırın, **Apply** deyin.
4. Kurulum birkaç dakika sürer. Bitince servisin adresi görünür, örn. `https://mini-empire.onrender.com`.
   Tarayıcıda açıp oyunun geldiğini kontrol edin.

Sunucu açılırken bot ayarlarını kendisi yapar: Telegram'a webhook'u ve sohbet ekranındaki **"Oyna"** menü
butonunu kaydeder. (Adres Render dışında bir yerdeyse `PUBLIC_URL` ortam değişkenine HTTPS adresinizi yazın.)

## 3. Deneyin
1. Telegram'da botunuzu açın ve `/start` yazın.
2. Gelen mesajdaki **🏰 Oyunu Aç** butonuna ya da sol alttaki **Oyna** butonuna dokunun.
3. Oyun Telegram içinde açılır ve Telegram hesabınızla **otomatik giriş** yapılır (şifre gerekmez).

## İsteğe bağlı
- **Mini App bağlantısı** (`t.me/BotAdi/oyun` gibi paylaşılabilir link): BotFather'da `/newapp` → botu seçin →
  başlık, açıklama, 640×360 bir resim → URL olarak Render adresinizi girin → kısa ad (örn. `oyun`).
- **Bot açıklaması ve resmi:** BotFather'da `/setdescription`, `/setuserpic`.
- **Yönetici olmak:** Render panelinde servis → **Shell** sekmesi → `npm run admin:grant -w server -- KULLANICIADI superadmin`
  (Telegram ile girişte kullanıcı adınız Telegram kullanıcı adınızdır; profil ekranında görünür).

## Bilinmesi gerekenler
- Render ücretsiz web servisi 15 dakika kullanılmayınca uyur; ilk açılış ~1 dakika sürebilir. Ücretsiz PostgreSQL
  belirli bir süre sonra silinir — gerçek oyuncularla yayına çıkmadan önce ücretli plana geçin ve yedek alın.
- Güvenlik: oyuncunun Telegram kimliği sunucuda bot token'ı ile imza doğrulanarak kabul edilir; istemcinin
  gönderdiği kullanıcı adı/ID'ye asla güvenilmez.
