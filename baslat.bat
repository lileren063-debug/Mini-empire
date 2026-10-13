@echo off
chcp 65001 >nul
title Mini Empire (bilgisayarda oyna)
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
echo ===== Mini Empire baslatiliyor =====
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. https://nodejs.org adresinden "LTS" surumunu kurun, bilgisayari yeniden baslatin.
  pause & exit /b 1
)
rem Paketler eksikse (ilk kurulum ya da yarim kalmis kurulum) yeniden yukle.
set NEED_INSTALL=0
if not exist "node_modules\vite\package.json" set NEED_INSTALL=1
if not exist "node_modules\tsx\package.json" set NEED_INSTALL=1
if not exist "node_modules\@electric-sql\pglite\package.json" set NEED_INSTALL=1
if "%NEED_INSTALL%"=="1" (
  echo Paketler yukleniyor, ilk sefere ozel birkac dakika surebilir...
  set NODE_ENV=
  call npm install --include=dev --no-audit --no-fund
)
if not exist "node_modules\vite\package.json" (
  echo.
  echo [HATA] Paketler yuklenemedi. Internet baglantinizi kontrol edip bu dosyayi tekrar calistirin.
  echo        Sorun devam ederse yukaridaki kirmizi/npm error satirlarini gonderin.
  pause & exit /b 1
)
echo Oyun aciliyor: http://localhost:5173   (kapatmak icin bu pencerede Ctrl+C)
start "" cmd /c "timeout /t 10 >nul & start http://localhost:5173"
call npm run dev
pause
