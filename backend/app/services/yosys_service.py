import subprocess
import json
import tempfile
import os
from pathlib import Path
from typing import Optional, Dict, Any, List, Union

class YosysService:
    def __init__(self):
        # Resolved lazily so the API can start (and report a clear error) without Yosys installed
        self._yosys_path: Optional[str] = None

    @property
    def yosys_path(self) -> str:
        if self._yosys_path is None:
            self._yosys_path = self._find_yosys()
        return self._yosys_path

    def is_available(self) -> bool:
        try:
            self._find_yosys()
            return True
        except RuntimeError:
            return False

    def _find_yosys(self) -> str:
        """Find Yosys executable (PATH + common install folders)"""
        from app.services.eda_service import find_tool, OSS_URL
        found = find_tool("yosys")
        if found:
            return found
        raise RuntimeError(f"Yosys bulunamadı. Lütfen OSS CAD Suite kurun: {OSS_URL}")

    def generate_netlist(
        self,
        design_path: Union[str, List[str]],
        top_module: Optional[str] = None,
        flatten: bool = False,
        synthesize: bool = False,
    ) -> Dict[str, Any]:
        """
        Generate JSON netlist from SystemVerilog using Yosys.

        design_path: one file or a list of files (design + dependencies)
        flatten:     inline module hierarchy into a single module
        synthesize:  run generic `synth` (gate-level) instead of only `proc`
        """
        from app.services.vhdl_service import is_vhdl, stage_vhdl_files
        raw_files = [design_path] if isinstance(design_path, str) else list(design_path)
        stage_dir = None
        if any(is_vhdl(f) for f in raw_files):
            stage_dir = Path(tempfile.mkdtemp(prefix="cvr_vhdl_"))
            files = stage_vhdl_files(stage_dir, raw_files)
        else:
            files = raw_files
        out_fd, out_path = tempfile.mkstemp(suffix=".json")
        os.close(out_fd)

        cmds = [f'read_verilog -sv "{Path(f).as_posix()}"' for f in files]
        if top_module:
            cmds.append(f"hierarchy -check -top {top_module}")
        else:
            cmds.append("hierarchy -auto-top")
        cmds.append("proc")
        if flatten:
            cmds.append("flatten")
        if synthesize:
            cmds.append("synth -run coarse")
        cmds += ["opt_clean", f'write_json "{Path(out_path).as_posix()}"']

        try:
            result = subprocess.run(
                [self.yosys_path, "-q", "-p", "; ".join(cmds)],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode != 0:
                raise RuntimeError(f"Yosys error: {(result.stderr or result.stdout).strip()}")
            with open(out_path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except subprocess.TimeoutExpired:
            raise RuntimeError("Yosys timed out after 120s")
        finally:
            if os.path.exists(out_path):
                os.unlink(out_path)
