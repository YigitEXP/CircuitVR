import re
from pathlib import Path
from typing import Dict, Any, List

class AnalysisService:
    def __init__(self):
        self.lut_patterns = {
            'and': 1,
            'or': 1,
            'xor': 1,
            'nand': 1,
            'nor': 1,
            'not': 1,
            'mux': 2,
            'dff': 1,
            'adder': 4
        }
    
    def estimate_resources(self, design_path: str, target_fpga: str = "xilinx") -> Dict[str, Any]:
        """
        Estimate resource utilization based on parsed design
        """
        with open(design_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Count logic elements (simplified estimation)
        and_count = len(re.findall(r'\band\b', content, re.IGNORECASE))
        or_count = len(re.findall(r'\bor\b', content, re.IGNORECASE))
        xor_count = len(re.findall(r'\bxor\b', content, re.IGNORECASE))
        mux_count = len(re.findall(r'\?', content))  # Ternary operators
        
        # Estimate flip-flops (reg declarations with clock edge)
        ff_count = len(re.findall(r'always\s*@\s*\([^)]*posedge', content))
        
        # Estimate LUTs based on logic complexity
        estimated_luts = (and_count + or_count + xor_count) * self.lut_patterns['and'] + mux_count * self.lut_patterns['mux']
        estimated_ff = ff_count * self.lut_patterns['dff']
        
        # Estimate DSP blocks (multipliers)
        mult_count = len(re.findall(r'\*', content))
        estimated_dsp = mult_count // 18  # Rough estimation
        
        # Estimate BRAM (large arrays)
        array_count = len(re.findall(r'\w+\s*\[\d+:\d+\]', content))
        estimated_bram = array_count // 10  # Rough estimation
        
        return {
            "target_fpga": target_fpga,
            "estimated_luts": estimated_luts,
            "estimated_ff": estimated_ff,
            "estimated_dsp": estimated_dsp,
            "estimated_bram": estimated_bram,
            "logic_elements": {
                "and_gates": and_count,
                "or_gates": or_count,
                "xor_gates": xor_count,
                "multiplexers": mux_count,
                "flip_flops": ff_count
            },
            "note": "These are rough estimates. For accurate results, use vendor synthesis tools."
        }
    
    def analyze_timing(self, design_path: str) -> Dict[str, Any]:
        """
        Analyze timing and identify potential critical paths
        """
        with open(design_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Count logic depth (simplified)
        always_blocks = len(re.findall(r'always\s*@', content))
        comb_assignments = len(re.findall(r'assign\s+', content))
        
        # Identify potential timing issues
        warnings = []
        
        # Long combinatorial chains
        if comb_assignments > 20:
            warnings.append({
                "type": "combinatorial_depth",
                "severity": "warning",
                "message": f"High combinatorial logic depth detected ({comb_assignments} assignments). Consider pipelining."
            })
        
        # Multiple clock domains
        clock_signals = re.findall(r'input\s+\w*\s*clock\w*', content, re.IGNORECASE)
        if len(clock_signals) > 1:
            warnings.append({
                "type": "multiple_clocks",
                "severity": "info",
                "message": "Multiple clock domains detected. Ensure proper CDC (Clock Domain Crossing)."
            })
        
        # Async reset
        async_reset = re.search(r'always\s*@\s*\([^)]*negedge\s+\w*reset\w*', content, re.IGNORECASE)
        if async_reset:
            warnings.append({
                "type": "async_reset",
                "severity": "info",
                "message": "Asynchronous reset detected. Ensure proper recovery/removal timing."
            })
        
        return {
            "estimated_max_frequency": "100 MHz",  # Placeholder
            "critical_path_delay": "10 ns",  # Placeholder
            "warnings": warnings,
            "always_blocks": always_blocks,
            "combinatorial_assignments": comb_assignments,
            "note": "For accurate timing analysis, use vendor timing analyzer (Vivado, Quartus, etc.)"
        }
    
    def lint_analysis(self, design_path: str) -> Dict[str, Any]:
        """
        Run lint analysis on SystemVerilog code
        """
        with open(design_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        issues = []
        
        # Check for common issues
        if 'wire' in content and 'reg' not in content:
            issues.append({
                "type": "warning",
                "message": "Design uses wire but no reg declarations"
            })
        
        # 1. Incomplete port declarations
        incomplete_ports = re.findall(r'module\s+\w+\s*\([^)]*\)\s*;', content)
        for port_decl in incomplete_ports:
            if 'input' not in port_decl and 'output' not in port_decl:
                issues.append({
                    "type": "warning",
                    "line": self._find_line(content, port_decl),
                    "message": "Module port declaration missing input/output direction"
                })
        
        # 2. Uninitialized signals
        uninitialized_regs = re.findall(r'reg\s+\w+\s*;', content)
        for reg in uninitialized_regs:
            issues.append({
                "type": "warning",
                "message": f"Potential uninitialized register: {reg}",
                "suggestion": "Initialize registers in reset logic"
            })
        
        # 3. Latches
        incomplete_if = re.findall(r'if\s*\([^)]+\)\s*[^{]*;(?!\s*else)', content, re.MULTILINE)
        if incomplete_if:
            issues.append({
                "type": "error",
                "message": f"Potential latch inference detected ({len(incomplete_if)} incomplete if statements)",
                "suggestion": "Add else branches to avoid latch inference"
            })
        
        # 4. Non-synthesizable constructs
        non_synthesizable = ['initial', 'real', 'time', 'delay #']
        for construct in non_synthesizable:
            if construct in content:
                issues.append({
                    "type": "warning",
                    "message": f"Non-synthesizable construct found: {construct}",
                    "suggestion": "Remove or replace with synthesizable equivalent"
                })
        
        # 5. Width mismatches
        assignments = re.findall(r'(\w+)\s*=\s*(\w+)', content)
        for lhs, rhs in assignments:
            # Simplified check - in production, parse actual widths
            pass
        
        return {
            "total_issues": len(issues),
            "errors": len([i for i in issues if i["type"] == "error"]),
            "warnings": len([i for i in issues if i["type"] == "warning"]),
            "issues": issues,
            "note": "For comprehensive linting, use SVLint or Verilator --lint-only"
        }
    
    def _find_line(self, content: str, pattern: str) -> int:
        """Find line number of a pattern in content"""
        lines = content.split('\n')
        for i, line in enumerate(lines, 1):
            if pattern in line:
                return i
        return 0
    
    def estimate_power(self, design_path: str, target_fpga: str = "xilinx") -> Dict[str, Any]:
        """
        Estimate power consumption (placeholder)
        """
        with open(design_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Placeholder power estimation
        dynamic_power = 0.1  # W
        static_power = 0.05  # W
        total_power = dynamic_power + static_power
        
        return {
            "target_fpga": target_fpga,
            "dynamic_power_w": dynamic_power,
            "static_power_w": static_power,
            "total_power_w": total_power
        }
    
    def analyze_coverage(self, design_path: str) -> Dict[str, Any]:
        """
        Analyze test coverage (placeholder)
        """
        return {
            "line_coverage": 0.0,
            "branch_coverage": 0.0,
            "statement_coverage": 0.0,
            "message": "Coverage analysis not implemented yet"
        }
