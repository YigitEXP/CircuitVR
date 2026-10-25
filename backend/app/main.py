from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os

from app.api import parse, simulate, analyze, workspace

app = FastAPI(
    title="CircuitVR — SystemVerilog · Verilog · VHDL RTL & Edge AI IDE",
    description="Interactive circuit visualization, simulation, and RTL optimization platform",
    version="2.1.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

# Mount static files for uploads (use /tmp on Vercel read-only serverless environment)
if os.environ.get("VERCEL"):
    uploads_dir = Path("/tmp/circuitvr_uploads")
else:
    uploads_dir = PROJECT_ROOT / "uploads"
try:
    uploads_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")
except OSError:
    pass

# Include API routers
app.include_router(workspace.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(parse.router, prefix="/api/parse", tags=["parse"])
app.include_router(simulate.router, prefix="/api/simulate", tags=["simulate"])
app.include_router(analyze.router, prefix="/api/analyze", tags=["analyze"])

# Mount compiled React/Vite frontend assets so FastAPI preset on Vercel serves the full SPA
if (FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "2.1.0"}


@app.get("/favicon.svg", include_in_schema=False)
async def favicon():
    fav = FRONTEND_DIST / "favicon.svg"
    if not fav.is_file():
        fav = PROJECT_ROOT / "frontend" / "public" / "favicon.svg"
    if fav.is_file():
        return FileResponse(str(fav), media_type="image/svg+xml")
    return JSONResponse({"detail": "Not found"}, status_code=404)


@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
async def serve_spa_root():
    index_file = FRONTEND_DIST / "index.html"
    if index_file.is_file():
        return FileResponse(str(index_file), media_type="text/html")
    return {"message": "CircuitVR API is running", "version": "2.1.0"}
