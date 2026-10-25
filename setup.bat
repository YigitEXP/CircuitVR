@echo off
chcp 65001 >nul
title CircuitVR - Otomatik Kurulum Sihirbazi (Setup)
cd /d "%~dp0"

echo ============================================================
echo   CircuitVR - Tam Otomatik Kurulum (Python + Node + EDA)
echo ============================================================
echo.

REM 1. Python kontrolu
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Python bulunamadi. Winget ile Python 3.12 kuruluyor...
    winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
)

REM 2. Node.js kontrolu
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js bulunamadi. Winget ile Node.js LTS kuruluyor...
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
)

REM 3. Backend Python ortami ve paketleri
echo.
echo [1/3] Backend Python paketleri kuruluyor...
cd backend
if not exist venv (
    python -m venv venv
)
call venv\Scripts\activate
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt

REM 4. Otomatik EDA araclari (Yosys, Icarus Verilog, Verilator)
echo.
echo [2/3] EDA Arac Zinciri (Yosys, Icarus Verilog, Verilator) kontrol ediliyor ve kuruluyor...
python setup_tools.py
cd ..

REM 5. Frontend Node paketleri
echo.
echo [3/3] Frontend arayuz paketleri (npm) kuruluyor...
cd frontend
call npm install --no-audit --no-fund
cd ..

echo.
echo ============================================================
echo   Kurulum basariyla tamamlandi! Uygulama baslatiliyor...
echo ============================================================
call run_local.bat
