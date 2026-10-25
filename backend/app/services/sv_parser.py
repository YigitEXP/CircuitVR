import re
from pathlib import Path
from typing import Dict, List, Any, Optional

class SVParser:
    def __init__(self):
        self.module_pattern = re.compile(r'module\s+(\w+)\s*(?:#\s*\([^)]*\))?\s*\(([^)]*)\)\s*;')
        self.port_pattern = re.compile(r'(input|output|inout)\s+(?:wire\s+)?(?:\[(\d+):(\d+)\]\s+)?(\w+)')
        self.signal_pattern = re.compile(r'(wire|reg|logic)\s+(?:\[(\d+):(\d+)\]\s+)?(\w+)')
        self.assignment_pattern = re.compile(r'assign\s+(\w+)\s*=\s*([^;]+);')
        self.always_pattern = re.compile(r'always\s*(?:@\s*\([^)]*\))?\s*begin')
        self.end_pattern = re.compile(r'endmodule|end')
    
    def parse_file(self, file_path: str) -> Dict[str, Any]:
        """
        Parse SystemVerilog file and extract module information
        """
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        modules = self._extract_modules(content)
        
        return {
            "file": file_path,
            "modules": modules,
            "total_modules": len(modules)
        }
    
    def _extract_modules(self, content: str) -> List[Dict[str, Any]]:
        """
        Extract all modules from SystemVerilog content
        """
        modules = []
        module_matches = self.module_pattern.finditer(content)
        
        for match in module_matches:
            module_name = match.group(1)
            ports_str = match.group(2)
            
            # Find module end position
            start_pos = match.start()
            end_pos = self._find_module_end(content, start_pos)
            module_content = content[start_pos:end_pos]
            
            ports = self._parse_ports(ports_str)
            signals = self._extract_signals(module_content)
            assignments = self._extract_assignments(module_content)
            always_blocks = self._count_always_blocks(module_content)
            
            modules.append({
                "name": module_name,
                "ports": ports,
                "signals": signals,
                "assignments": assignments,
                "always_blocks": always_blocks,
                "line_count": module_content.count('\n')
            })
        
        return modules
    
    def _find_module_end(self, content: str, start_pos: int) -> int:
        """
        Find the end of a module (endmodule keyword)
        """
        search_content = content[start_pos:]
        end_match = self.end_pattern.search(search_content)
        if end_match:
            return start_pos + end_match.end()
        return len(content)
    
    def _parse_ports(self, ports_str: str) -> List[Dict[str, Any]]:
        """
        Parse module ports
        """
        ports = []
        if not ports_str.strip():
            return ports
        
        for port in ports_str.split(','):
            port = port.strip()
            if port:
                ports.append({
                    "name": port,
                    "direction": "unknown"  # Will be determined from declaration
                })
        
        return ports
    
    def _extract_signals(self, content: str) -> List[Dict[str, Any]]:
        """
        Extract signal declarations
        """
        signals = []
        
        # Extract input/output/inout declarations
        for match in self.port_pattern.finditer(content):
            direction = match.group(1)
            msb = match.group(2)
            lsb = match.group(3)
            name = match.group(4)
            
            width = 1
            if msb is not None:
                width = int(msb) - int(lsb) + 1
            
            signals.append({
                "name": name,
                "type": direction,
                "width": width,
                "msb": int(msb) if msb else None,
                "lsb": int(lsb) if lsb else None
            })
        
        # Extract wire/reg/logic declarations
        for match in self.signal_pattern.finditer(content):
            sig_type = match.group(1)
            msb = match.group(2)
            lsb = match.group(3)
            name = match.group(4)
            
            width = 1
            if msb is not None:
                width = int(msb) - int(lsb) + 1
            
            signals.append({
                "name": name,
                "type": sig_type,
                "width": width,
                "msb": int(msb) if msb else None,
                "lsb": int(lsb) if lsb else None
            })
        
        return signals
    
    def _extract_assignments(self, content: str) -> List[Dict[str, str]]:
        """
        Extract continuous assignments
        """
        assignments = []
        
        for match in self.assignment_pattern.finditer(content):
            lhs = match.group(1)
            rhs = match.group(2).strip()
            
            assignments.append({
                "lhs": lhs,
                "rhs": rhs
            })
        
        return assignments
    
    def _count_always_blocks(self, content: str) -> int:
        """
        Count always blocks
        """
        return len(self.always_pattern.findall(content))
