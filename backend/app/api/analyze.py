from fastapi import APIRouter, HTTPException
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import re

from app.services.analysis_service import AnalysisService

router = APIRouter()

uploads_dir = Path(__file__).parent.parent.parent.parent / "uploads"

analysis_service = AnalysisService()

class AnalysisRequest(BaseModel):
    design_file: str
    target_fpga: str = "xilinx"

class CodeQualityRequest(BaseModel):
    file_path: str
    check_style: bool = True
    check_naming: bool = True
    check_complexity: bool = True

class TimingAnalysisRequest(BaseModel):
    design_file: str
    clock_period: Optional[float] = None
    target_fpga: str = "xilinx"

@router.post("/resources")
async def analyze_resources(req: AnalysisRequest):
    """
    Analyze resource utilization (LUT, FF, DSP, BRAM)
    """
    design_path = uploads_dir / req.design_file
    
    if not design_path.exists():
        raise HTTPException(status_code=404, detail="Design file not found")
    
    try:
        resources = analysis_service.estimate_resources(str(design_path), req.target_fpga)
        return {"resources": resources, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/timing")
async def analyze_timing(req: AnalysisRequest):
    """
    Analyze timing and critical path
    """
    design_path = uploads_dir / req.design_file
    
    if not design_path.exists():
        raise HTTPException(status_code=404, detail="Design file not found")
    
    try:
        timing = analysis_service.analyze_timing(str(design_path))
        return {"timing": timing, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/code-quality")
async def analyze_code_quality(req: CodeQualityRequest):
    """
    Analyze code quality, naming conventions, complexity
    """
    file_path = Path(req.file_path)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    try:
        content = file_path.read_text()
        lines = content.split('\n')
        
        issues = []
        warnings = []
        suggestions = []
        
        # Check line length
        for i, line in enumerate(lines):
            if len(line) > 120:
                issues.append({
                    "line": i + 1,
                    "type": "line_too_long",
                    "message": f"Line exceeds 120 characters ({len(line)} chars)"
                })
        
        # Check naming conventions (basic)
        if req.check_naming:
            # Module names should be lowercase with underscores
            module_pattern = r'\bmodule\s+([A-Z][a-zA-Z0-9_]*)'
            bad_modules = re.findall(module_pattern, content)
            for module in bad_modules:
                warnings.append({
                    "type": "naming_convention",
                    "message": f"Module '{module}' should use lowercase_with_underscores"
                })
        
        # Check for TODO/FIXME comments
        for i, line in enumerate(lines):
            if 'TODO' in line.upper():
                suggestions.append({
                    "line": i + 1,
                    "type": "todo_found",
                    "message": "TODO comment found"
                })
            if 'FIXME' in line.upper():
                issues.append({
                    "line": i + 1,
                    "type": "fixme_found",
                    "message": "FIXME comment found - needs attention"
                })
        
        # Calculate complexity (simplified)
        complexity_score = 0
        for line in lines:
            if 'if' in line or 'case' in line or 'for' in line or 'while' in line:
                complexity_score += 1
        
        return {
            "file_path": str(file_path),
            "issues": issues,
            "warnings": warnings,
            "suggestions": suggestions,
            "complexity_score": complexity_score,
            "total_lines": len(lines)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/power-analysis")
async def analyze_power(req: AnalysisRequest):
    """
    Estimate power consumption (placeholder)
    """
    design_path = uploads_dir / req.design_file
    
    if not design_path.exists():
        raise HTTPException(status_code=404, detail="Design file not found")
    
    try:
        # Placeholder for power analysis
        power_estimate = analysis_service.estimate_power(str(design_path), req.target_fpga)
        return {"power_estimate": power_estimate, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/test-coverage")
async def analyze_test_coverage(req: AnalysisRequest):
    """
    Analyze test coverage (placeholder)
    """
    design_path = uploads_dir / req.design_file
    
    if not design_path.exists():
        raise HTTPException(status_code=404, detail="Design file not found")
    
    try:
        # Placeholder for test coverage analysis
        coverage = analysis_service.analyze_coverage(str(design_path))
        return {"coverage": coverage, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
