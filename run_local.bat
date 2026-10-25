@echo off
chcp 65001 >nul
REM CircuitVR - Docker'siz yerel baslatici (ilk calistirmada tum araclari otomatik kurar)
cd /d "%~dp0"

REM --- Backend ---
cd backend
if not exist venv (
    python -m venv venv
    call venv\Scripts\activate
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate
)
REM Eksik EDA araclarini (Yosys, Icarus, Verilator) otomatik kontrol et ve kur
python setup_tools.py
start "CircuitVR Backend" cmd /k "uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
cd ..

REM --- Frontend ---
cd frontend
if not exist node_modules\elkjs (
    call npm install --no-audit --no-fund --prefer-offline
)
start "CircuitVR Frontend" cmd /k "npm run dev"
cd ..

echo.
echo Frontend: http://localhost:3000   (sag altta surum rozetini kontrol edin)
echo Backend : http://localhost:8000
timeout /t 5 /nobreak >nul
start http://localhost:3000
