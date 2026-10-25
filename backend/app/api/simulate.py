from fastapi import APIRouter, HTTPException, UploadFile, File
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List
import json
import re

from app.services.simulation_service import SimulationService

router = APIRouter()

uploads_dir = Path(__file__).parent.parent.parent.parent / "uploads"

simulation_service = SimulationService()

class SimulationRequest(BaseModel):
    testbench_file: str
    design_file: str
    top_module: Optional[str] = None
    simulation_time: Optional[str] = "100ns"
    wave_format: Optional[str] = "vcd"

class WaveformRequest(BaseModel):
    vcd_file: str
    signals: Optional[List[str]] = None
    time_range: Optional[dict] = None

@router.post("/run")
async def run_simulation(req: SimulationRequest):
    """
    Run simulation using Verilator/Icarus and generate VCD
    """
    tb_path = uploads_dir / req.testbench_file
    design_path = uploads_dir / req.design_file
    
    if not tb_path.exists():
        raise HTTPException(status_code=404, detail="Testbench file not found")
    if not design_path.exists():
        raise HTTPException(status_code=404, detail="Design file not found")
    
    try:
        result = simulation_service.run_simulation(
            str(tb_path), 
            str(design_path), 
            req.top_module,
            req.simulation_time
        )
        return {"result": result, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/waveform-data")
async def get_waveform_data(req: WaveformRequest):
    """
    Get waveform data with optional signal filtering
    """
    vcd_path = uploads_dir / req.vcd_file
    
    if not vcd_path.exists():
        raise HTTPException(status_code=404, detail="VCD file not found")
    
    try:
        vcd_data = simulation_service.parse_vcd(str(vcd_path))
        
        # Filter signals if specified
        if req.signals:
            filtered_signals = [s for s in vcd_data.get("signals", []) if s.get("name") in req.signals]
            vcd_data["signals"] = filtered_signals
        
        # Filter time range if specified
        if req.time_range:
            start_time = req.time_range.get("start", 0)
            end_time = req.time_range.get("end", float("inf"))
            for signal in vcd_data.get("signals", []):
                signal["transitions"] = [
                    t for t in signal.get("transitions", [])
                    if start_time <= t.get("time", 0) <= end_time
                ]
        
        return {"vcd_data": vcd_data, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/compare-waveforms")
async def compare_waveforms(vcd_file1: str, vcd_file2: str):
    """
    Compare two VCD waveforms and show differences
    """
    vcd_path1 = uploads_dir / vcd_file1
    vcd_path2 = uploads_dir / vcd_file2
    
    if not vcd_path1.exists():
        raise HTTPException(status_code=404, detail="First VCD file not found")
    if not vcd_path2.exists():
        raise HTTPException(status_code=404, detail="Second VCD file not found")
    
    try:
        vcd_data1 = simulation_service.parse_vcd(str(vcd_path1))
        vcd_data2 = simulation_service.parse_vcd(str(vcd_path2))
        
        differences = []
        
        # Compare signals
        signals1 = {s["name"]: s for s in vcd_data1.get("signals", [])}
        signals2 = {s["name"]: s for s in vcd_data2.get("signals", [])}
        
        all_signals = set(signals1.keys()) | set(signals2.keys())
        
        for signal_name in all_signals:
            if signal_name not in signals1:
                differences.append({"signal": signal_name, "type": "missing_in_first"})
            elif signal_name not in signals2:
                differences.append({"signal": signal_name, "type": "missing_in_second"})
            else:
                # Compare transitions (simplified)
                trans1 = signals1[signal_name].get("transitions", [])
                trans2 = signals2[signal_name].get("transitions", [])
                if trans1 != trans2:
                    differences.append({
                        "signal": signal_name,
                        "type": "different_transitions",
                        "count_first": len(trans1),
                        "count_second": len(trans2)
                    })
        
        return {
            "differences": differences,
            "total_differences": len(differences),
            "signals_first": len(signals1),
            "signals_second": len(signals2)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/vcd/{filename}")
async def get_vcd_data(filename: str):
    """
    Get parsed VCD waveform data
    """
    vcd_path = uploads_dir / filename
    
    if not vcd_path.exists():
        raise HTTPException(status_code=404, detail="VCD file not found")
    
    try:
        vcd_data = simulation_service.parse_vcd(str(vcd_path))
        return {"vcd_data": vcd_data, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
