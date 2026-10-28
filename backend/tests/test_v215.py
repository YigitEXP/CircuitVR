"""Automated Verification & Regression Test Suite for CircuitVR V 2.15."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import workspace_service as ws
from app.services.edge_ai_service import analyze_edge_ai, inspect_workspace_rtl
from app.services.fsm_service import extract_workspace_fsms
from app.services.optimizer_service import (
    analyze_optimizations,
    apply_optimization_autofix,
    insert_ignore_pragma,
)
from app.services.schematic_service import build_schematic


class TestCircuitVRV215(unittest.TestCase):
    def test_security_path_traversal_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            with self.assertRaises(PermissionError):
                ws.resolve_in(root, "../../outside.sv")

    def test_optimizer_autofix_and_ignore_pragma_and_seclinter(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            rtl_dir = root / "rtl"
            rtl_dir.mkdir()
            sv_file = rtl_dir / "sec_demo.sv"
            code = """module sec_demo (
    input logic clk,
    input logic rst_n,
    input logic [31:0] cnt,
    output logic y,
    output logic osc
);
    assign osc = ~osc;
    always @(posedge clk) begin
        if (cnt == 32'hdeadbeef) begin
            y = 1'b1;
        end
    end
endmodule
"""
            sv_file.write_text(code, encoding="utf-8")
            rep = analyze_optimizations(root, [str(sv_file)])
            rule_ids = {s["rule_id"] for s in rep["suggestions"]}
            self.assertIn("OPT-SEC-COMBLOOP", rule_ids)
            self.assertIn("OPT-SEC-TRIGGER", rule_ids)
            self.assertIn("OPT-SV-ALWAYS", rule_ids)
            self.assertIn("OPT-BLOCKING", rule_ids)

            # Test Auto-Fix on OPT-BLOCKING
            blk_sug = next(s for s in rep["suggestions"] if s["rule_id"] == "OPT-BLOCKING")
            patched_res = apply_optimization_autofix(code, blk_sug["line"], blk_sug["before"], blk_sug["after"])
            self.assertTrue(patched_res["applied"])
            self.assertIn("y <= 1'b1;", patched_res["content"])

            # Test // circuitvr-ignore pragma suppression
            ign_res = insert_ignore_pragma(patched_res["content"], blk_sug["line"], "OPT-SEC-TRIGGER", is_vhdl=False)
            self.assertTrue(ign_res["applied"])
            sv_file.write_text(ign_res["content"], encoding="utf-8")
            rep_after = analyze_optimizations(root, [str(sv_file)])
            after_ids = {s["rule_id"] for s in rep_after["suggestions"]}
            self.assertNotIn("OPT-BLOCKING", after_ids)

    def test_fsm_extractor_and_dead_state_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            rtl_dir = root / "rtl"
            rtl_dir.mkdir()
            fsm_file = rtl_dir / "ctrl_fsm.sv"
            fsm_file.write_text(
                """module ctrl_fsm (input logic clk, input logic rst_n, input logic go);
    typedef enum logic [1:0] {IDLE, RUN, DONE, GHOST_TROJAN} state_t;
    state_t state;
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) state <= IDLE;
        else begin
            case (state)
                IDLE: if (go) state <= RUN;
                RUN: state <= DONE;
                DONE: state <= IDLE;
                GHOST_TROJAN: state <= IDLE;
            endcase
        end
    end
endmodule
""",
                encoding="utf-8",
            )
            fsm_rep = extract_workspace_fsms(root, [str(fsm_file)])
            self.assertEqual(fsm_rep["total_fsms"], 1)
            fsm = fsm_rep["fsms"][0]
            self.assertEqual(fsm["reset_state"], "IDLE")
            self.assertIn("GHOST_TROJAN", fsm["dead_states"])
            self.assertFalse(fsm["has_safe_default"])

    def test_critical_path_dag_and_edge_ai_pareto(self):
        dummy_netlist = {
            "modules": {
                "top": {
                    "ports": {
                        "a": {"direction": "input", "bits": [2]},
                        "y": {"direction": "output", "bits": [4]},
                    },
                    "cells": {
                        "c1": {"type": "$not", "port_directions": {"A": "input", "Y": "output"}, "connections": {"A": [2], "Y": [3]}, "parameters": {}},
                        "c2": {"type": "$not", "port_directions": {"A": "input", "Y": "output"}, "connections": {"A": [3], "Y": [4]}, "parameters": {}},
                    },
                }
            }
        }
        schem = build_schematic(dummy_netlist, "top")
        self.assertIn("critical_path", schem)
        self.assertEqual(schem["critical_path"]["depth"], 2)
        self.assertGreater(schem["critical_path"]["fmax_mhz"], 0)

        ai = analyze_edge_ai({"weights": [-0.125, 0.375, 0.875, 0.375, -0.125], "int_bits": 2, "frac_bits": 6})
        self.assertTrue(len(ai["pareto_front"]) >= 5)
        self.assertTrue(any(p["recommended"] for p in ai["pareto_front"]))

        insp = inspect_workspace_rtl("module my_fir #(parameter DATA_W=12, parameter FRAC_W=8) (input clk, input signed [11:0] sample_in, output signed [11:0] y_out); endmodule", "rtl/my_fir.sv")
        self.assertEqual(insp["module_name"], "my_fir")
        self.assertEqual(insp["data_w"], 12)
        self.assertEqual(insp["frac_bits"], 8)


if __name__ == "__main__":
    unittest.main()
