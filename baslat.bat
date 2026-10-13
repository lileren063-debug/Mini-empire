@echo off
chcp 65001 >nul
title Mini Empire (bilgisayarda oyna)
cd /d "%~dp0"
echo.
echo ===== Mini Empire baslatiliyor =====
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
echo Oyun aciliyor: http://localhost:5173   (kapatmak icin bu pencerede Ctrl+C)
start "" cmd /c "timeout /t 10 >nul & start http://localhost:5173"
call npm run dev
pause
