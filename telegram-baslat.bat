@echo off
chcp 65001 >nul
title Mini Empire - Telegram
cd /d "%~dp0"
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
  if errorlevel 1 ( echo [HATA] Paket yuklemesi basarisiz. Internet baglantinizi kontrol edin. & pause & exit /b 1 )
)
node scripts\telegram.mjs
pause
