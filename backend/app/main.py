from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import shutil
import os

from app.api import parse, simulate, analyze, workspace

app = FastAPI(
    title="CircuitVR - SystemVerilog Analysis Platform",
    description="Interactive circuit visualization and analysis for SystemVerilog designs",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for uploads
uploads_dir = Path(__file__).parent.parent.parent / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Include routers
app.include_router(workspace.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(parse.router, prefix="/api/parse", tags=["parse"])
app.include_router(simulate.router, prefix="/api/simulate", tags=["simulate"])
app.include_router(analyze.router, prefix="/api/analyze", tags=["analyze"])

@app.get("/")
async def root():
    return {"message": "CircuitVR API is running", "version": "1.0.0"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
