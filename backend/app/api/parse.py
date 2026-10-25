from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from pathlib import Path
import shutil
import json
import os
import re
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

from app.services.yosys_service import YosysService
from app.services.sv_parser import SVParser
from app.services.schematic_service import build_schematic

class ParseRequest(BaseModel):
    design_file: str

class NetlistRequest(BaseModel):
    design_file: str
    top_module: Optional[str] = None

class ProjectScanRequest(BaseModel):
    project_path: str

class FileAnalysisRequest(BaseModel):
    file_path: str

router = APIRouter()

uploads_dir = Path(__file__).parent.parent.parent.parent / "uploads"
uploads_dir.mkdir(exist_ok=True)

yosys_service = YosysService()
sv_parser = SVParser()

@router.post("/scan-project")
async def scan_vivado_project(request: ProjectScanRequest):
    """
    Scan Vivado project directory and find all SystemVerilog files
    """
    project_path = Path(request.project_path)
    
    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path not found")
    
    sv_files = []
    hdl_files = []
    constraints_files = []
    
    # Scan for SystemVerilog and Verilog files
    for file_path in project_path.rglob("*"):
        if file_path.is_file():
            suffix = file_path.suffix.lower()
            if suffix in ['.sv', '.svh']:
                sv_files.append({
                    "name": file_path.name,
                    "path": str(file_path),
                    "relative_path": str(file_path.relative_to(project_path)),
                    "size": file_path.stat().st_size
                })
            elif suffix in ['.v', '.vh']:
                hdl_files.append({
                    "name": file_path.name,
                    "path": str(file_path),
                    "relative_path": str(file_path.relative_to(project_path)),
                    "size": file_path.stat().st_size
                })
            elif suffix in ['.xdc', '.sdc', '.ucf']:
                constraints_files.append({
                    "name": file_path.name,
                    "path": str(file_path),
                    "relative_path": str(file_path.relative_to(project_path)),
                    "size": file_path.stat().st_size
                })
    
    # Try to find Xilinx project file (.xpr)
    xpr_files = list(project_path.rglob("*.xpr"))
    project_info = None
    if xpr_files:
        xpr_file = xpr_files[0]
        project_info = {
            "name": xpr_file.stem,
            "path": str(xpr_file),
            "relative_path": str(xpr_file.relative_to(project_path))
        }
    
    return {
        "project_path": str(project_path),
        "project_info": project_info,
        "sv_files": sv_files,
        "hdl_files": hdl_files,
        "constraints_files": constraints_files,
        "total_files": len(sv_files) + len(hdl_files) + len(constraints_files)
    }

@router.post("/analyze-file")
async def analyze_file(request: FileAnalysisRequest):
    """
    Analyze a single SystemVerilog file for modules, interfaces, etc.
    """
    file_path = Path(request.file_path)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    try:
        content = file_path.read_text()
        
        # Extract modules
        module_pattern = r'\bmodule\s+(\w+)\s*(?:#\([^)]*\))?\s*(?:\([^)]*\))?\s*;'
        modules = re.findall(module_pattern, content)
        
        # Extract interfaces
        interface_pattern = r'\binterface\s+(\w+)'
        interfaces = re.findall(interface_pattern, content)
        
        # Extract packages
        package_pattern = r'\bpackage\s+(\w+)'
        packages = re.findall(package_pattern, content)
        
        # Extract parameters
        param_pattern = r'\bparameter\s+(?:\w+\s+)?(\w+)\s*='
        parameters = re.findall(param_pattern, content)
        
        # Count lines
        lines = content.split('\n')
        line_count = len(lines)
        comment_lines = len([l for l in lines if l.strip().startswith('//') or '/*' in l or '*/' in l])
        code_lines = line_count - comment_lines
        
        return {
            "file_path": str(file_path),
            "file_name": file_path.name,
            "modules": modules,
            "interfaces": interfaces,
            "packages": packages,
            "parameters": parameters,
            "line_count": line_count,
            "comment_lines": comment_lines,
            "code_lines": code_lines,
            "file_size": file_path.stat().st_size
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/dependency-graph")
async def generate_dependency_graph(request: ProjectScanRequest):
    """
    Generate module dependency graph from project files
    """
    project_path = Path(request.project_path)
    
    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project path not found")
    
    nodes = []
    edges = []
    module_map = {}
    
    for file_path in project_path.rglob("*.sv"):
        if file_path.is_file():
            try:
                content = file_path.read_text()
                
                # Find module definitions
                module_pattern = r'\bmodule\s+(\w+)'
                modules = re.findall(module_pattern, content)
                
                for module in modules:
                    if module not in module_map:
                        module_map[module] = {
                            "id": module,
                            "label": module,
                            "file": str(file_path.relative_to(project_path))
                        }
                        nodes.append(module_map[module])
                
                # Find module instantiations
                inst_pattern = r'\b(\w+)\s+\w+\s*\('
                instantiations = re.findall(inst_pattern, content)
                
                for inst_module in instantiations:
                    if inst_module in module_map:
                        for module in modules:
                            edges.append({
                                "from": module,
                                "to": inst_module,
                                "type": "instantiation"
                            })
            except Exception:
                continue
    
    return {
        "nodes": nodes,
        "edges": edges,
        "node_count": len(nodes),
        "edge_count": len(edges)
    }

@router.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    """
    Upload SystemVerilog design and testbench files
    """
    uploaded_files = []
    
    for file in files:
        file_path = uploads_dir / file.filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        uploaded_files.append({
            "filename": file.filename,
            "path": str(file_path),
            "size": file_path.stat().st_size
        })
    
    return {"uploaded_files": uploaded_files, "count": len(uploaded_files)}

@router.post("/netlist")
async def generate_netlist(request: NetlistRequest):
    """
    Generate JSON netlist from SystemVerilog using Yosys
    """
    design_path = uploads_dir / request.design_file
    
    if not design_path.exists():
        raise HTTPException(status_code=404, detail="Design file not found")
    
    try:
        netlist = yosys_service.generate_netlist(str(design_path), request.top_module)
        return {"netlist": netlist, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SchematicRequest(BaseModel):
    design_files: List[str]
    top_module: Optional[str] = None
    flatten: bool = False
    synthesize: bool = False

# Small Yosys-format netlist so the schematic viewer can be tried without Yosys installed
_DEMO_NETLIST = {"modules": {"demo_counter": {
    "attributes": {"top": 1},
    "ports": {
        "clk": {"direction": "input", "bits": [2]},
        "rst": {"direction": "input", "bits": [3]},
        "en": {"direction": "input", "bits": [4]},
        "count": {"direction": "output", "bits": [5, 6, 7, 8]}},
    "cells": {
        "$add1": {"type": "$add", "parameters": {"A_WIDTH": 4, "B_WIDTH": 4, "Y_WIDTH": 4},
                  "port_directions": {"A": "input", "B": "input", "Y": "output"},
                  "connections": {"A": [5, 6, 7, 8], "B": ["1", "0", "0", "0"], "Y": [9, 10, 11, 12]}},
        "$mux1": {"type": "$mux", "parameters": {"WIDTH": 4},
                  "port_directions": {"A": "input", "B": "input", "S": "input", "Y": "output"},
                  "connections": {"A": [5, 6, 7, 8], "B": [9, 10, 11, 12], "S": [4], "Y": [13, 14, 15, 16]}},
        "count_reg": {"type": "$adff", "parameters": {"WIDTH": 4},
                      "port_directions": {"CLK": "input", "ARST": "input", "D": "input", "Q": "output"},
                      "connections": {"CLK": [2], "ARST": [3], "D": [13, 14, 15, 16], "Q": [5, 6, 7, 8]}}},
    "netnames": {
        "clk": {"bits": [2]}, "rst": {"bits": [3]}, "en": {"bits": [4]},
        "count": {"bits": [5, 6, 7, 8]}, "next": {"bits": [9, 10, 11, 12]},
        "d": {"bits": [13, 14, 15, 16]}}}}}

@router.post("/schematic")
async def generate_schematic(request: SchematicRequest):
    """
    Synthesize design with Yosys and return a schematic graph (nodes, pins, nets)
    """
    paths = []
    for name in request.design_files:
        p = uploads_dir / name
        if not p.exists():
            p = Path(name)
        if not p.exists():
            raise HTTPException(status_code=404, detail=f"Design file not found: {name}")
        paths.append(str(p))
    try:
        netlist = yosys_service.generate_netlist(
            paths, request.top_module, flatten=request.flatten, synthesize=request.synthesize
        )
        return {"schematic": build_schematic(netlist, request.top_module), "success": True}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schematic generation failed: {e}")

@router.get("/schematic/demo")
async def demo_schematic():
    return {"schematic": build_schematic(_DEMO_NETLIST), "success": True}

@router.get("/tools")
async def tool_status():
    """Report which external EDA tools are available"""
    import shutil
    return {t: bool(shutil.which(t)) for t in ("yosys", "iverilog", "verilator", "vvp")}

@router.post("/parse")
async def parse_sv(request: ParseRequest):
    """
    Parse SystemVerilog file and extract module information
    """
    design_path = uploads_dir / request.design_file
    
    if not design_path.exists():
        raise HTTPException(status_code=404, detail="Design file not found")
    
    try:
        parsed = sv_parser.parse_file(str(design_path))
        return {"parsed": parsed, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
