@echo off
chcp 65001 >nul
title Mini Empire
cd /d "%~dp0"
echo.
echo ===== Mini Empire baslatiliyor =====
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. https://nodejs.org adresinden "LTS" surumunu kurun, sonra bu dosyayi tekrar calistirin.
  pause & exit /b 1
)

where psql >nul 2>nul
if errorlevel 1 (
  for /d %%D in ("C:\Program Files\PostgreSQL\*") do if exist "%%D\bin\psql.exe" set "PATH=%PATH%;%%D\bin"
)
where psql >nul 2>nul
if errorlevel 1 (
  echo [HATA] PostgreSQL bulunamadi. https://www.postgresql.org/download/windows/ adresinden kurun.
  pause & exit /b 1
)

if not exist ".env" (
  echo Ilk kurulum: veritabani olusturuluyor. PostgreSQL kurarken belirlediginiz "postgres" sifresi 3 kez sorulacak.
  psql -U postgres -c "CREATE USER mini WITH PASSWORD 'mini_dev_password' CREATEDB;"
  psql -U postgres -c "CREATE DATABASE mini_empire OWNER mini;"
  psql -U postgres -c "CREATE DATABASE mini_empire_test OWNER mini;"
  (
    echo DATABASE_URL=postgres://mini:mini_dev_password@localhost:5432/mini_empire
    echo TEST_DATABASE_URL=postgres://mini:mini_dev_password@localhost:5432/mini_empire_test
    echo PORT=3000
  ) > .env
  echo .env dosyasi olusturuldu.
)

if not exist "node_modules" (
  echo Paketler yukleniyor, birkac dakika surebilir...
  call npm install
  if errorlevel 1 ( echo [HATA] npm install basarisiz. & pause & exit /b 1 )
)

call npm run migrate
if errorlevel 1 ( echo [HATA] Veritabanina baglanilamadi. .env dosyasini kontrol edin. & pause & exit /b 1 )

echo.
echo Oyun aciliyor: http://localhost:5173   (kapatmak icin bu pencerede Ctrl+C)
start "" cmd /c "timeout /t 8 >nul & start http://localhost:5173"
call npm run dev
pause
