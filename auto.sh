#!/bin/bash

# CircuitVR - Auto Start/Stop Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "$1" in
    start)
        echo "🚀 Starting CircuitVR..."
        
        # Check if Docker is installed
        if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
            echo "📦 Using Docker Compose..."
            docker-compose up --build -d
            echo "✅ CircuitVR started with Docker!"
            echo "🌐 Frontend: http://localhost:3000"
            echo "🔧 Backend: http://localhost:8000"
            echo "📚 API Docs: http://localhost:8000/docs"
        else
            echo "⚠️  Docker not found. Starting locally..."
            
            # Start Backend
            echo "🔧 Starting Backend..."
            cd backend
            if [ ! -d "venv" ]; then
                python3 -m venv venv
                source venv/bin/activate
                pip install -r requirements.txt
            else
                source venv/bin/activate
            fi
            python3 setup_tools.py
            uvicorn app.main:app --host 0.0.0.0 --port 8000 > ../backend.log 2>&1 &
            BACKEND_PID=$!
            echo $BACKEND_PID > ../backend.pid
            cd ..
            
            # Start Frontend
            echo "🎨 Starting Frontend..."
            cd frontend
            if [ ! -d "node_modules" ]; then
                npm install
            fi
            npm run dev > ../frontend.log 2>&1 &
            FRONTEND_PID=$!
            echo $FRONTEND_PID > ../frontend.pid
            cd ..
            
            echo "✅ CircuitVR started locally!"
            echo "🌐 Frontend: http://localhost:3000"
            echo "🔧 Backend: http://localhost:8000"
            echo "📚 API Docs: http://localhost:8000/docs"
            echo "📝 Logs: backend.log, frontend.log"
        fi
        ;;
        
    stop)
        echo "🛑 Stopping CircuitVR..."
        
        # Stop Docker if running
        if command -v docker-compose &> /dev/null; then
            docker-compose down
        fi
        
        # Stop local processes
        if [ -f "backend.pid" ]; then
            kill $(cat backend.pid) 2>/dev/null
            rm backend.pid
            echo "✅ Backend stopped"
        fi
        
        if [ -f "frontend.pid" ]; then
            kill $(cat frontend.pid) 2>/dev/null
            rm frontend.pid
            echo "✅ Frontend stopped"
        fi
        
        # Kill any remaining processes on ports
        lsof -ti:8000 | xargs kill -9 2>/dev/null
        lsof -ti:3000 | xargs kill -9 2>/dev/null
        
        echo "✅ CircuitVR stopped!"
        ;;
        
    restart)
        echo "🔄 Restarting CircuitVR..."
        $0 stop
        sleep 2
        $0 start
        ;;
        
    status)
        echo "📊 CircuitVR Status:"
        
        # Check Docker
        if command -v docker-compose &> /dev/null; then
            docker-compose ps
        fi
        
        # Check local processes
        if [ -f "backend.pid" ]; then
            if ps -p $(cat backend.pid) > /dev/null; then
                echo "✅ Backend running (PID: $(cat backend.pid))"
            else
                echo "❌ Backend not running"
            fi
        else
            echo "❌ Backend not running"
        fi
        
        if [ -f "frontend.pid" ]; then
            if ps -p $(cat frontend.pid) > /dev/null; then
                echo "✅ Frontend running (PID: $(cat frontend.pid))"
            else
                echo "❌ Frontend not running"
            fi
        else
            echo "❌ Frontend not running"
        fi
        
        # Check ports
        if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "✅ Port 8000 (Backend) is in use"
        else
            echo "❌ Port 8000 (Backend) is free"
        fi
        
        if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "✅ Port 3000 (Frontend) is in use"
        else
            echo "❌ Port 3000 (Frontend) is free"
        fi
        ;;
        
    logs)
        echo "📝 Showing logs..."
        if [ -f "backend.log" ]; then
            echo "=== Backend Logs ==="
            tail -f backend.log
        fi
        if [ -f "frontend.log" ]; then
            echo "=== Frontend Logs ==="
            tail -f frontend.log
        fi
        ;;
        
    *)
        echo "CircuitVR - Auto Start/Stop Script"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start   - Start CircuitVR (Docker or local)"
        echo "  stop    - Stop CircuitVR"
        echo "  restart - Restart CircuitVR"
        echo "  status  - Show CircuitVR status"
        echo "  logs    - Show logs (tail -f)"
        echo ""
        exit 1
        ;;
esac
