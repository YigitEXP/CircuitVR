@echo off
REM CircuitVR - Auto Start/Stop Script for Windows

cd /d "%~dp0"

if "%1"=="" goto usage
if "%1"=="start" goto start
if "%1"=="stop" goto stop
if "%1"=="restart" goto restart
if "%1"=="status" goto status
if "%1"=="logs" goto logs
goto usage

:start
echo 🚀 Starting CircuitVR...

REM Check if Docker is available
docker --version >nul 2>&1
if %errorlevel%==0 (
    echo 📦 Using Docker Compose...
    docker-compose up --build -d
    echo ✅ CircuitVR started with Docker!
    echo 🌐 Frontend: http://localhost:3000
    echo 🔧 Backend: http://localhost:8000
    echo 📚 API Docs: http://localhost:8000/docs
) else (
    echo ⚠️  Docker not found. Starting locally...
    
    REM Start Backend
    echo 🔧 Starting Backend...
    cd backend
    if not exist venv (
        python -m venv venv
        call venv\Scripts\activate
        pip install -r requirements.txt
    ) else (
        call venv\Scripts\activate
    )
    python setup_tools.py
    start "CircuitVR Backend" cmd /k "uvicorn app.main:app --host 0.0.0.0 --port 8000"
    cd ..
    
    REM Start Frontend
    echo 🎨 Starting Frontend...
    cd frontend
    if not exist node_modules (
        call npm install
    )
    start "CircuitVR Frontend" cmd /k "npm run dev"
    cd ..
    
    echo ✅ CircuitVR started locally!
    echo 🌐 Frontend: http://localhost:3000
    echo 🔧 Backend: http://localhost:8000
    echo 📚 API Docs: http://localhost:8000/docs
)
goto end

:stop
echo 🛑 Stopping CircuitVR...

REM Stop Docker if available
docker --version >nul 2>&1
if %errorlevel%==0 (
    docker-compose down
)

REM Kill processes on ports
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000') do (
    taskkill /F /PID %%a 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    taskkill /F /PID %%a 2>nul
)

echo ✅ CircuitVR stopped!
goto end

:restart
echo 🔄 Restarting CircuitVR...
call %0 stop
timeout /t 2 /nobreak >nul
call %0 start
goto end

:status
echo 📊 CircuitVR Status:

REM Check ports
netstat -aon | findstr :8000 >nul
if %errorlevel%==0 (
    echo ✅ Port 8000 (Backend) is in use
) else (
    echo ❌ Port 8000 (Backend) is free
)

netstat -aon | findstr :3000 >nul
if %errorlevel%==0 (
    echo ✅ Port 3000 (Frontend) is in use
) else (
    echo ❌ Port 3000 (Frontend) is free
)

REM Check Docker
docker --version >nul 2>&1
if %errorlevel%==0 (
    docker-compose ps
)
goto end

:logs
echo 📝 Logs are displayed in the terminal windows.
echo For Docker logs, run: docker-compose logs -f
goto end

:usage
echo CircuitVR - Auto Start/Stop Script
echo.
echo Usage: %0 {start^|stop^|restart^|status^|logs}
echo.
echo Commands:
echo   start   - Start CircuitVR (Docker or local)
echo   stop    - Stop CircuitVR
echo   restart - Restart CircuitVR
echo   status  - Show CircuitVR status
echo   logs    - Show logs info
echo.
goto end

:end
