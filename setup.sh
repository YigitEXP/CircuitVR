#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================================"
echo "  CircuitVR - Automated Full Setup (Python + Node + EDA)"
echo "============================================================"

echo "[1/3] Setting up Python backend environment..."
cd backend
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip --quiet
pip install -r requirements.txt

echo "[2/3] Checking & auto-installing EDA Toolchain (Yosys, Icarus Verilog, Verilator)..."
python3 setup_tools.py
cd ..

echo "[3/3] Installing Frontend dependencies (npm)..."
cd frontend
npm install --no-audit --no-fund
cd ..

echo "============================================================"
echo "  Setup complete! Starting CircuitVR..."
echo "============================================================"
./auto.sh start
