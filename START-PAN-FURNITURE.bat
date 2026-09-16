@echo off
title PAN Furniture - Website Server
color 0E
echo ============================================
echo   PAN FURNITURE - Website Server
echo ============================================
echo.
echo   Website: http://localhost:3000
echo   Admin:   http://localhost:3000/admin
echo.
echo   Huwag isara ang window na ito habang
echo   ginagamit ang website.
echo ============================================
echo.

cd /d "%~dp0"

REM AYUSIN: puwersahin ang development mode (kung production, nagsisira
REM ang Tailwind at cache kada refresh)
set NODE_ENV=development

REM Patayin ang lumang server sa port 3000 (iwas double)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

REM Linisin ang build cache (iwas corrupted .next na nagra-crash sa refresh)
if exist ".next" rmdir /s /q ".next"

REM Install dependencies kung wala pa (unang beses lang)
if not exist "node_modules" (
  echo Installing dependencies... please wait...
  call npm install
)

REM Buksan ang browser pagkatapos ng ilang segundo
start "" cmd /c "timeout /t 8 >nul & start http://localhost:3000"

REM Patakbuhin ang dev server (auto-reload kada edit)
call npm run dev
pause
