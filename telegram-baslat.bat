@echo off
chcp 65001 >nul
title Mini Empire - Telegram
cd /d "%~dp0"
if not exist "%~dp0package.json" (
  echo [HATA] Dosya ZIP/RAR icinden calistirildi. Once arsivi bir klasore cikartin:
  echo        ZIP dosyasina sag tiklayin - "Tumunu ayikla" veya "Extract Here" - sonra
  echo        cikan Mini-empire klasorunun ICINDEKI bat dosyasina cift tiklayin.
  pause & exit /b 1
)
echo %~dp0 | find /i "\Temp\" >nul && (
  echo [HATA] Dosya gecici klasorden calisiyor ^(arsiv icinden acilmis^). Once arsivi Masaustu gibi bir yere cikartin.
  pause & exit /b 1
)
echo.
echo ===== Mini Empire - Telegram botu baslatiliyor =====
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. https://nodejs.org adresinden "LTS" surumunu kurun, bilgisayari yeniden baslatin.
  pause & exit /b 1
)
if not exist "node_modules" (
  echo Paketler yukleniyor, ilk sefere ozel birkac dakika surebilir...
  call npm install
  if not exist "node_modules" ( echo [HATA] Paket yuklemesi basarisiz. & pause & exit /b 1 )
  if errorlevel 1 ( echo [HATA] Paket yuklemesi basarisiz. Internet baglantinizi kontrol edin. & pause & exit /b 1 )
)
node scripts\telegram.mjs
pause
