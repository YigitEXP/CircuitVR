import subprocess
import tempfile
import os
from pathlib import Path
from typing import Dict, Any, Optional

class SimulationService:
    def __init__(self):
        self.verilator_path = self._find_verilator()
        self.iverilog_path = self._find_iverilog()
    
    def _find_verilator(self) -> Optional[str]:
        """Find Verilator executable"""
        try:
            result = subprocess.run(["verilator", "--version"], capture_output=True, text=True)
            if result.returncode == 0:
                return "verilator"
        except FileNotFoundError:
            pass
        return None
    
    def _find_iverilog(self) -> Optional[str]:
        """Find Icarus Verilog executable"""
        try:
            result = subprocess.run(["iverilog", "-v"], capture_output=True, text=True)
            if result.returncode == 0:
                return "iverilog"
        except FileNotFoundError:
            pass
        return None
    
    def run_simulation(self, tb_path: str, design_path: str, top_module: Optional[str] = None, simulation_time: Optional[str] = None) -> Dict[str, Any]:
        """
        Run simulation using Icarus Verilog and generate VCD
        """
        # Use Icarus Verilog as fallback
        if self.iverilog_path:
            return self._run_with_iverilog(tb_path, design_path, top_module)
        elif self.verilator_path:
            return self._run_with_verilator(tb_path, design_path, top_module)
        else:
            raise RuntimeError("No simulator found. Please install Icarus Verilog or Verilator.")
    
    def _run_with_iverilog(self, tb_path: str, design_path: str, top_module: Optional[str]) -> Dict[str, Any]:
        """
        Run simulation with Icarus Verilog
        """
        output_dir = Path(tb_path).parent
        vvp_output = output_dir / "simulation"
        vcd_output = output_dir / "waveform.vcd"
        
        # Compile
        compile_cmd = [
            self.iverilog_path,
            "-g2012",  # SystemVerilog support
            "-o", str(vvp_output),
            str(design_path),
            str(tb_path)
        ]
        
        result = subprocess.run(compile_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"Icarus compilation failed: {result.stderr}")
        
        # Run simulation
        run_cmd = ["vvp", str(vvp_output)]
        result = subprocess.run(run_cmd, capture_output=True, text=True, cwd=str(output_dir))
        
        return {
            "simulator": "iverilog",
            "log": result.stdout,
            "error": result.stderr,
            "vcd_file": str(vcd_output) if vcd_output.exists() else None,
            "success": result.returncode == 0
        }
    
    def _run_with_verilator(self, tb_path: str, design_path: str, top_module: Optional[str]) -> Dict[str, Any]:
        """
        Run simulation with Verilator
        """
        output_dir = Path(tb_path).parent
        vcd_output = output_dir / "waveform.vcd"
        
        compile_cmd = [
            self.verilator_path,
            "--cc",
            "--exe",
            "--trace",
            str(design_path),
            str(tb_path)
        ]
        
        result = subprocess.run(compile_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"Verilator compilation failed: {result.stderr}")
        
        return {
            "simulator": "verilator",
            "log": result.stdout,
            "error": result.stderr,
            "vcd_file": str(vcd_output) if vcd_output.exists() else None,
            "success": result.returncode == 0
        }
    
    def parse_vcd(self, vcd_path: str) -> Dict[str, Any]:
        """
        Parse VCD file and extract signal data
        """
        # This is a simplified VCD parser
        # For production, consider using pyvcd library
        signals = {}
        time_values = []
        
        try:
            with open(vcd_path, 'r') as f:
                content = f.read()
            
            # Extract signal declarations (simplified)
            # In production, use proper VCD parsing library
            
            return {
                "signals": signals,
                "time_values": time_values,
                "total_time": 0,
                "note": "Full VCD parsing requires pyvcd library"
            }
        except Exception as e:
            raise RuntimeError(f"VCD parsing failed: {str(e)}")
