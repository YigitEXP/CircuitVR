"""Edge AI & Biosignal (1D-CNN / DSP) Hardware Co-Design Service.

Solves the top pain points of FPGA / Edge AI hardware engineers:
1. Fixed-Point Quantization Explorer (Qm.n) with SQNR (dB), MSE, Clipping & Float-vs-Fixed visualization.
2. Automatic Binary-Point & MAC Accumulator Bit-Growth Calculator (preventing overflow/truncation bugs).
3. Hardware Roofline & FPGA Silicon Estimator (DSP48 cliff, LUTs, FFs, Latency in ns/us, Throughput).
4. Dual Workflow:
   - Mode A (Preset Templates): Test with ready-made Biomedical 1D-CNN / FIR templates (conv1d_biosignal).
   - Mode B (Custom RTL & Custom Model): Auto-detect the user's own workspace RTL (.sv/.v/.vhd) ports,
     bit-widths, and weights, import custom Python/PyTorch/CSV/JSON weights & signals, and generate a
     Golden Testbench wired directly to the user's own RTL module (or synthesize a custom-named RTL core).
"""
import math
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


PRESET_KERNELS: Dict[str, Dict[str, Any]] = {
    "ecg_qrs_1dcnn": {
        "name": "ECG QRS & Arrhythmia 1D-CNN Kernel (7-Tap Bandpass + Derivative)",
        "stimulus": "ecg",
        "weights": [-0.125, -0.25, 0.375, 0.875, 0.375, -0.25, -0.125],
        "bias": 0.0,
        "activation": "relu",
        "threshold": 0.45,
        "int_bits": 2,
        "frac_bits": 6,
    },
    "eeg_spike_1dcnn": {
        "name": "EEG Seizure Spike-Wave 1D-CNN Feature Extractor (5-Tap)",
        "stimulus": "eeg",
        "weights": [-0.1875, 0.3125, 0.75, 0.3125, -0.1875],
        "bias": 0.03125,
        "activation": "leaky_relu",
        "threshold": 0.40,
        "int_bits": 2,
        "frac_bits": 6,
    },
    "lowpass_denoise_fir": {
        "name": "Biosignal 50/60Hz Motion Artifact Denoising Filter (5-Tap Smooth)",
        "stimulus": "ecg",
        "weights": [0.09375, 0.21875, 0.375, 0.21875, 0.09375],
        "bias": 0.0,
        "activation": "none",
        "threshold": 0.50,
        "int_bits": 2,
        "frac_bits": 6,
    },
}


def _generate_biosignal(kind: str, n: int = 64, custom_signal: Optional[List[float]] = None) -> List[float]:
    """Generate a 64-sample physiological signal or normalize user-supplied custom signal samples."""
    if kind == "custom" and custom_signal and len(custom_signal) >= 4:
        cleaned = [round(max(-127.0, min(127.0, float(v))), 5) for v in custom_signal[:256]]
        return cleaned

    samples: List[float] = []
    for i in range(n):
        t = i / float(n)
        noise = 0.04 * math.sin(2.0 * math.pi * 11.0 * t)
        if kind == "eeg":
            alpha = 0.18 * math.sin(2.0 * math.pi * 4.0 * t)
            spike1 = 0.82 * math.exp(-((i - 25) ** 2) / 3.5) - 0.35 * math.exp(-((i - 29) ** 2) / 6.0)
            spike2 = 0.76 * math.exp(-((i - 48) ** 2) / 3.0) - 0.30 * math.exp(-((i - 52) ** 2) / 5.5)
            val = alpha + spike1 + spike2 + noise
        elif kind == "sine_noise":
            val = 0.55 * math.sin(2.0 * math.pi * 2.0 * t) + 0.18 * math.sin(2.0 * math.pi * 15.0 * t)
        else:
            p1 = 0.12 * math.exp(-((i - 12) ** 2) / 4.0)
            q1 = -0.15 * math.exp(-((i - 16) ** 2) / 1.5)
            r1 = 0.85 * math.exp(-((i - 18) ** 2) / 1.8)
            s1 = -0.22 * math.exp(-((i - 20) ** 2) / 1.8)
            t1 = 0.20 * math.exp(-((i - 26) ** 2) / 6.0)

            q2 = -0.20 * math.exp(-((i - 42) ** 2) / 1.8)
            r2 = 0.94 * math.exp(-((i - 44) ** 2) / 2.2)
            s2 = -0.28 * math.exp(-((i - 47) ** 2) / 2.2)
            t2 = 0.24 * math.exp(-((i - 53) ** 2) / 6.5)
            val = p1 + q1 + r1 + s1 + t1 + q2 + r2 + s2 + t2 + noise
        samples.append(round(max(-0.98, min(0.98, val)), 5))
    return samples


def _quantize_val(val: float, int_bits: int, frac_bits: int, rounding: str = "round") -> Tuple[int, float, bool]:
    total_bits = int_bits + frac_bits
    scale = 1 << frac_bits
    q_min = -(1 << (total_bits - 1))
    q_max = (1 << (total_bits - 1)) - 1
    scaled = val * scale
    raw_int = int(round(scaled)) if rounding == "round" else int(math.floor(scaled))
    clipped = raw_int < q_min or raw_int > q_max
    q_int = max(q_min, min(q_max, raw_int))
    return q_int, q_int / float(scale), clipped


def _sqnr_db(orig: List[float], quant: List[float]) -> float:
    sig_pow = sum(x * x for x in orig) / max(len(orig), 1)
    err_pow = sum((a - b) ** 2 for a, b in zip(orig, quant)) / max(len(orig), 1)
    if err_pow <= 1e-15:
        return 99.9
    if sig_pow <= 1e-15:
        return 0.0
    return round(max(0.0, min(99.9, 10.0 * math.log10(sig_pow / err_pow))), 2)


def _apply_activation_float(x: float, act: str) -> float:
    if act == "relu":
        return max(0.0, x)
    if act == "leaky_relu":
        return x if x >= 0.0 else x * 0.125
    if act == "sigmoid_lut":
        return max(0.0, min(1.0, 0.5 + 0.25 * x))
    return x


def _apply_activation_fixed(q_val: int, act: str, frac_bits: int, q_min: int, q_max: int) -> int:
    if act == "relu":
        return max(0, q_val)
    if act == "leaky_relu":
        return q_val if q_val >= 0 else (q_val >> 3)
    if act == "sigmoid_lut":
        half = 1 << (frac_bits - 1) if frac_bits >= 1 else 1
        approx = half + (q_val >> 2)
        return max(0, min(q_max, approx))
    return max(q_min, min(q_max, q_val))


def _sv_signed_lit(q_int: int, width: int) -> str:
    if q_int < 0:
        return f"-{width}'sd{abs(q_int)}"
    return f"{width}'sd{q_int}"


def inspect_workspace_rtl(text: str, rel_path: str = "rtl/top.sv") -> Dict[str, Any]:
    """Parse a user's existing SV/Verilog/VHDL file to extract module name, ports, Qm.n bit-widths, and weights."""
    clean = re.sub(r"//[^\n]*", "", text)
    clean = re.sub(r"/\*.*?\*/", "", clean, flags=re.S)
    ext = Path(rel_path).suffix.lower()

    is_vhdl = ext in {".vhd", ".vhdl"}
    module_name = Path(rel_path).stem
    params: Dict[str, int] = {}

    if is_vhdl:
        clean_vhd = re.sub(r"--[^\n]*", "", text)
        m_ent = re.search(r"\bentity\s+([a-zA-Z_]\w*)\s+is\b", clean_vhd, re.I)
        if m_ent:
            module_name = m_ent.group(1)
        for gm in re.finditer(r"([a-zA-Z_]\w*)\s*:\s*(?:integer|natural|positive)\s*:=\s*(\d+)", clean_vhd, re.I):
            params[gm.group(1).upper()] = int(gm.group(2))
    else:
        m_mod = re.search(r"\bmodule\s+([a-zA-Z_]\w*)", clean)
        if m_mod:
            module_name = m_mod.group(1)
        for pm in re.finditer(r"\b(?:parameter|localparam)\b[^;=]*?\b([a-zA-Z_]\w*)\s*=\s*(\d+)\b", clean):
            params[pm.group(1).upper()] = int(pm.group(2))

    data_w = (
        params.get("DATA_W")
        or params.get("WIDTH")
        or params.get("DATA_WIDTH")
        or params.get("N")
        or 8
    )
    frac_w = (
        params.get("FRAC_W")
        or params.get("FRAC_BITS")
        or params.get("Q_FRAC")
        or max(2, min(6, data_w - 2))
    )
    int_w = max(1, data_w - frac_w)

    # Parse ports
    inputs: List[Dict[str, Any]] = []
    outputs: List[Dict[str, Any]] = []

    if is_vhdl:
        clean_vhd = re.sub(r"--[^\n]*", "", text)
        for pm in re.finditer(
            r"([a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)*)\s*:\s*(in|out|inout)\s+([^;)\r\n]+)",
            clean_vhd,
            re.I,
        ):
            names = [n.strip() for n in pm.group(1).split(",") if n.strip()]
            direction = pm.group(2).lower()
            t_str = pm.group(3)
            w = 1
            m_vec = re.search(r"\(\s*([a-zA-Z0-9_]+)\s*(?:-\s*1)?\s+downto\s+0\s*\)", t_str, re.I)
            if m_vec:
                tok = m_vec.group(1)
                if tok.isdigit():
                    w = int(tok) + (0 if "- 1" in m_vec.group(0) or "-1" in m_vec.group(0) else 1)
                else:
                    w = params.get(tok.upper(), data_w)
            for n in names:
                item = {"name": n, "width": w}
                if direction == "in":
                    inputs.append(item)
                else:
                    outputs.append(item)
    else:
        for pm in re.finditer(
            r"\b(input|output|inout)\b\s*(?:wire|reg|logic)?\s*(?:signed|unsigned)?\s*(?:\[\s*([^:\]]+)\s*:\s*0\s*\])?\s*([a-zA-Z_]\w*)",
            clean,
        ):
            direction = pm.group(1)
            msb = (pm.group(2) or "").strip()
            name = pm.group(3)
            w = 1
            if msb:
                m_param = re.match(r"([a-zA-Z_]\w*)\s*-\s*1", msb)
                if m_param:
                    w = params.get(m_param.group(1).upper(), data_w)
                elif msb.isdigit():
                    w = int(msb) + 1
                else:
                    w = data_w
            item = {"name": name, "width": w}
            if direction == "input":
                inputs.append(item)
            elif direction == "output":
                outputs.append(item)

    clk_port = next((p["name"] for p in inputs if re.search(r"clk|clock", p["name"], re.I)), None)
    rst_port = next((p["name"] for p in inputs if re.search(r"rst|reset", p["name"], re.I)), None)
    rst_active_low = bool(rst_port and re.search(r"_n$|neg|n$", rst_port, re.I))
    valid_in_port = next(
        (p["name"] for p in inputs if p["width"] == 1 and re.search(r"valid|en|start|ce|stb", p["name"], re.I)),
        None,
    )
    vec_inputs = [
        p for p in inputs
        if p["name"] not in {clk_port, rst_port, valid_in_port} and p["width"] > 1
    ]
    if not vec_inputs:
        vec_inputs = [p for p in inputs if p["name"] not in {clk_port, rst_port, valid_in_port}]

    if vec_inputs and "DATA_W" not in params and "WIDTH" not in params:
        data_w = vec_inputs[0]["width"]
        frac_w = min(frac_w, max(1, data_w - 1))
        int_w = max(1, data_w - frac_w)

    valid_out_port = next(
        (p["name"] for p in outputs if p["width"] == 1 and re.search(r"valid|done|ready", p["name"], re.I)),
        None,
    )
    flag_out_port = next(
        (p["name"] for p in outputs if p["width"] == 1 and p["name"] != valid_out_port),
        None,
    )
    vec_outputs = [p for p in outputs if p["width"] > 1]
    data_out_port = vec_outputs[0]["name"] if vec_outputs else (outputs[0]["name"] if outputs else "feature_out")

    # Extract any fixed-point or float weights defined in the RTL (e.g., W_0, W_1, COEFF_0, TAP_0)
    scale = float(1 << frac_w)
    extracted_weights: List[Tuple[int, float]] = []
    for wm in re.finditer(
        r"\b(?:W|WEIGHT|COEFF|TAP|KERNEL|B|H)_?(\d+)\s*=\s*([+-]?)\s*(?:\d+'s?d)?(\d+(?:\.\d+)?)",
        clean,
        re.I,
    ):
        idx = int(wm.group(1))
        sign = -1.0 if wm.group(2) == "-" else 1.0
        raw_str = wm.group(3)
        if "." in raw_str:
            val_f = sign * float(raw_str)
        else:
            val_f = round((sign * int(raw_str)) / scale, 6)
        extracted_weights.append((idx, val_f))

    extracted_weights.sort(key=lambda x: x[0])
    weights_list = [w for _, w in extracted_weights[:16]]
    has_rtl_weights = len(weights_list) > 0

    return {
        "file": rel_path,
        "module_name": module_name,
        "is_vhdl": is_vhdl,
        "data_w": data_w,
        "int_bits": int_w,
        "frac_bits": frac_w,
        "clk_port": clk_port,
        "rst_port": rst_port,
        "rst_active_low": rst_active_low,
        "valid_in_port": valid_in_port,
        "data_in_ports": [p["name"] for p in vec_inputs],
        "valid_out_port": valid_out_port,
        "data_out_port": data_out_port,
        "flag_out_port": flag_out_port,
        "has_rtl_weights": has_rtl_weights,
        "detected_weights": weights_list,
        "summary_tr": (
            f"'{rel_path}' içindeki `{module_name}` modülü algılandı: "
            f"Q{int_w}.{frac_w} ({data_w}-bit), "
            f"Giriş: {', '.join(p['name'] for p in vec_inputs) or 'yok'}, "
            f"Çıkış: {data_out_port}"
            + (f", {len(weights_list)} adet gömülü ağırlık (W_0..W_{len(weights_list)-1}) okundu." if has_rtl_weights else " (Genel RTL modülü — dışarıdan model/sinyal ile test edilebilir).")
        ),
        "summary_en": (
            f"Detected module `{module_name}` in '{rel_path}': "
            f"Q{int_w}.{frac_w} ({data_w}-bit), "
            f"Inputs: {', '.join(p['name'] for p in vec_inputs) or 'none'}, "
            f"Output: {data_out_port}"
            + (f", extracted {len(weights_list)} embedded weights." if has_rtl_weights else " (General RTL module — ready for custom Golden TB).")
        ),
    }


def analyze_edge_ai(cfg: Dict[str, Any]) -> Dict[str, Any]:
    weights: List[float] = [float(x) for x in cfg.get("weights", PRESET_KERNELS["ecg_qrs_1dcnn"]["weights"])][:16]
    if not weights:
        weights = [0.5, -0.25, 0.5]
    bias: float = float(cfg.get("bias", 0.0))
    int_bits = max(1, min(16, int(cfg.get("int_bits", 2))))
    frac_bits = max(1, min(24, int(cfg.get("frac_bits", 6))))
    rounding = str(cfg.get("rounding", "round"))
    stimulus = str(cfg.get("stimulus", "ecg"))
    custom_signal = cfg.get("custom_signal")
    activation = str(cfg.get("activation", "relu"))
    threshold = float(cfg.get("threshold", 0.45))
    clock_mhz = max(1.0, min(1000.0, float(cfg.get("clock_mhz", 100.0))))
    reuse_factor = max(1, min(16, int(cfg.get("reuse_factor", 1))))

    total_bits = int_bits + frac_bits
    scale = 1 << frac_bits
    q_min = -(1 << (total_bits - 1))
    q_max = (1 << (total_bits - 1)) - 1
    min_real = q_min / float(scale)
    max_real = q_max / float(scale)
    lsb_step = 1.0 / float(scale)

    # 1. Quantize weights & bias
    q_weights_info: List[Dict[str, Any]] = []
    q_weights_int: List[int] = []
    q_weights_float: List[float] = []
    clipped_count = 0

    for idx, w in enumerate(weights):
        qi, qf, clip = _quantize_val(w, int_bits, frac_bits, rounding)
        if clip:
            clipped_count += 1
        q_weights_int.append(qi)
        q_weights_float.append(qf)
        twos = (qi + (1 << total_bits)) % (1 << total_bits)
        q_weights_info.append({
            "index": idx,
            "float_val": round(w, 6),
            "quant_float": round(qf, 6),
            "quant_int": qi,
            "abs_err": round(abs(w - qf), 6),
            "clipped": clip,
            "hex": f"0x{twos:0{(total_bits + 3) // 4}X}",
            "sv_lit": _sv_signed_lit(qi, total_bits),
        })

    bias_int, bias_qf, _ = _quantize_val(bias, int_bits, frac_bits, rounding)
    thresh_int, thresh_qf, _ = _quantize_val(threshold, int_bits, frac_bits, rounding)

    weight_sqnr = _sqnr_db(weights, q_weights_float)
    weight_mse = round(sum((a - b) ** 2 for a, b in zip(weights, q_weights_float)) / len(weights), 8)
    weight_max_err = round(max(abs(a - b) for a, b in zip(weights, q_weights_float)), 6)

    # 2. Exact MAC Bit-Growth Calculation
    k_len = len(weights)
    prod_int_bits = 2 * int_bits
    prod_frac_bits = 2 * frac_bits
    prod_width = 2 * total_bits
    guard_bits = max(1, math.ceil(math.log2(max(k_len + 1, 2))))
    acc_int_bits = prod_int_bits + guard_bits
    acc_frac_bits = prod_frac_bits
    acc_width = prod_width + guard_bits

    # 3. Run Bit-Exact Biosignal 1D-CNN Emulation vs FP64 Reference
    sig_float = _generate_biosignal(stimulus, n=64, custom_signal=custom_signal)
    sig_q_int: List[int] = []
    sig_q_float: List[float] = []
    for s in sig_float:
        si, sf, _ = _quantize_val(s, int_bits, frac_bits, rounding)
        sig_q_int.append(si)
        sig_q_float.append(round(sf, 5))

    out_fp_list: List[float] = []
    out_fx_float_list: List[float] = []
    out_fx_int_list: List[int] = []
    anomalies: List[int] = []

    win_fp = [0.0] * k_len
    win_fx = [0] * k_len
    bias_acc_shifted = bias_int << frac_bits
    round_offset = (1 << (frac_bits - 1)) if (rounding == "round" and frac_bits > 0) else 0

    for t_idx in range(len(sig_float)):
        win_fp = [sig_float[t_idx]] + win_fp[:-1]
        win_fx = [sig_q_int[t_idx]] + win_fx[:-1]

        acc_fp = sum(win_fp[j] * weights[j] for j in range(k_len)) + bias
        y_fp = _apply_activation_float(acc_fp, activation)
        out_fp_list.append(round(y_fp, 5))

        acc_fx = sum(win_fx[j] * q_weights_int[j] for j in range(k_len)) + bias_acc_shifted
        shifted = (acc_fx + round_offset) >> frac_bits
        sat = max(q_min, min(q_max, shifted))
        y_fx_int = _apply_activation_fixed(sat, activation, frac_bits, q_min, q_max)
        out_fx_int_list.append(y_fx_int)
        out_fx_float_list.append(round(y_fx_int / float(scale), 5))
        if y_fx_int >= thresh_int:
            anomalies.append(t_idx)

    inference_sqnr = _sqnr_db(out_fp_list, out_fx_float_list)

    # 4. Hardware Roofline & FPGA Silicon Resource Estimate
    parallel_pes = max(1, math.ceil(k_len / float(reuse_factor)))
    cycles_per_sample = reuse_factor
    latency_ns = round((cycles_per_sample / clock_mhz) * 1000.0, 2)
    throughput_msps = round(clock_mhz / float(cycles_per_sample), 2)
    gops = round((2.0 * k_len * throughput_msps) / 1000.0, 3)

    if total_bits <= 6:
        dsp_blocks = 0
        mult_lut_each = total_bits * total_bits * 2
        dsp_note = f"Q{int_bits}.{frac_bits} ({total_bits}-bit) eşik altı olduğu için çarpıcılar tamamen LUT dokusunda sentezlenir (0 DSP48)."
    elif total_bits <= 18:
        dsp_blocks = parallel_pes
        mult_lut_each = 12
        dsp_note = f"Q{int_bits}.{frac_bits} ({total_bits}-bit) Xilinx DSP48E1/E2 (25x18) sınırları içinde: paralel PE başına 1 DSP48 kullanılır."
    else:
        dsp_blocks = parallel_pes * 2
        mult_lut_each = 28
        dsp_note = f"Q{int_bits}.{frac_bits} ({total_bits}-bit > 18-bit) DSP48 çarpan sınırını (DSP Cliff) aşıyor! Çarpan başına 2 kaskad DSP48 harcanır."

    est_luts = k_len * mult_lut_each + acc_width * 3 + (64 if activation == "sigmoid_lut" else 16)
    est_ffs = k_len * total_bits + acc_width + total_bits + 4

    # 5. Pareto Bit-Width Auto-Search (4-bit to 16-bit candidates)
    candidates = [(2, 3), (2, 4), (2, 6), (2, 8), (3, 9), (3, 11), (4, 12)]
    pareto_front: List[Dict[str, Any]] = []
    rec_chosen = False
    for cm, cn in candidates:
        cw = cm + cn
        cscale = 1 << cn
        cq_min = -(1 << (cw - 1))
        cq_max = (1 << (cw - 1)) - 1
        cw_int: List[int] = []
        cw_flt: List[float] = []
        c_clip = 0
        for w in weights:
            qi, qf, cl = _quantize_val(w, cm, cn, rounding)
            if cl:
                c_clip += 1
            cw_int.append(qi)
            cw_flt.append(qf)
        cb_int, _, _ = _quantize_val(bias, cm, cn, rounding)
        c_w_sqnr = _sqnr_db(weights, cw_flt)
        c_win_fx = [0] * k_len
        c_out_fx: List[float] = []
        c_round = (1 << (cn - 1)) if (rounding == "round" and cn > 0) else 0
        for s in sig_float:
            si, _, _ = _quantize_val(s, cm, cn, rounding)
            c_win_fx = [si] + c_win_fx[:-1]
            c_acc = sum(c_win_fx[j] * cw_int[j] for j in range(k_len)) + (cb_int << cn)
            c_sh = (c_acc + c_round) >> cn
            c_sat = max(cq_min, min(cq_max, c_sh))
            c_y = _apply_activation_fixed(c_sat, activation, cn, cq_min, cq_max)
            c_out_fx.append(c_y / float(cscale))
        c_inf_sqnr = _sqnr_db(out_fp_list, c_out_fx)
        c_dsp = 0 if cw <= 6 else (parallel_pes if cw <= 18 else parallel_pes * 2)
        c_mult_lut = cw * cw * 2 if cw <= 6 else (12 if cw <= 18 else 28)
        c_acc_w = 2 * cw + guard_bits
        c_luts = k_len * c_mult_lut + c_acc_w * 3 + 16
        is_rec = (not rec_chosen) and (c_clip == 0) and (c_inf_sqnr >= 30.0)
        if is_rec:
            rec_chosen = True
        pareto_front.append({
            "q_format": f"Q{cm}.{cn}",
            "int_bits": cm,
            "frac_bits": cn,
            "total_bits": cw,
            "weight_sqnr_db": c_w_sqnr,
            "inference_sqnr_db": c_inf_sqnr,
            "dsp_blocks": c_dsp,
            "est_luts": c_luts,
            "clipped": c_clip,
            "recommended": is_rec,
        })

    return {
        "q_format": f"Q{int_bits}.{frac_bits}",
        "total_bits": total_bits,
        "int_bits": int_bits,
        "frac_bits": frac_bits,
        "scale": scale,
        "min_real": round(min_real, 6),
        "max_real": round(max_real, 6),
        "lsb_step": round(lsb_step, 6),
        "weight_sqnr_db": weight_sqnr,
        "inference_sqnr_db": inference_sqnr,
        "weight_mse": weight_mse,
        "weight_max_err": weight_max_err,
        "clipped_weights": clipped_count,
        "weights_table": q_weights_info,
        "bias_int": bias_int,
        "bias_float": round(bias_qf, 6),
        "threshold_int": thresh_int,
        "threshold_float": round(thresh_qf, 6),
        "pareto_front": pareto_front,
        "bit_growth": {
            "input_q": f"Q{int_bits}.{frac_bits} ({total_bits}-bit)",
            "weight_q": f"Q{int_bits}.{frac_bits} ({total_bits}-bit)",
            "product_q": f"Q{prod_int_bits}.{prod_frac_bits} ({prod_width}-bit)",
            "guard_bits": guard_bits,
            "acc_q": f"Q{acc_int_bits}.{acc_frac_bits} ({acc_width}-bit)",
            "acc_width": acc_width,
            "prod_width": prod_width,
            "shift_right": frac_bits,
            "formula": f"W_acc = 2*{total_bits} + ceil(log2({k_len}+1)) = {acc_width} bit (Shift >>> {frac_bits})",
        },
        "roofline": {
            "taps": k_len,
            "parallel_pes": parallel_pes,
            "reuse_factor": reuse_factor,
            "clock_mhz": clock_mhz,
            "cycles_per_sample": cycles_per_sample,
            "latency_ns": latency_ns,
            "throughput_msps": throughput_msps,
            "gops": gops,
            "dsp_blocks": dsp_blocks,
            "est_luts": est_luts,
            "est_ffs": est_ffs,
            "dsp_note": dsp_note,
        },
        "series": {
            "stimulus": stimulus,
            "input_float": sig_float,
            "input_q_float": sig_q_float,
            "input_q_int": sig_q_int,
            "output_fp": out_fp_list,
            "output_fx_float": out_fx_float_list,
            "output_fx_int": out_fx_int_list,
            "anomaly_indices": anomalies,
        },
    }


def _generate_tb_for_custom_rtl(
    analysis: Dict[str, Any],
    detected: Dict[str, Any],
) -> Tuple[str, str]:
    """Generate a Golden Testbench specifically wired to the user's own RTL module and ports."""
    mod_name = detected["module_name"]
    tb_mod = f"tb_{mod_name}"
    w_bits = detected.get("data_w") or analysis["total_bits"]
    clk_p = detected.get("clk_port")
    rst_p = detected.get("rst_port")
    rst_low = detected.get("rst_active_low", True)
    valid_in_p = detected.get("valid_in_port")
    data_in_ports = detected.get("data_in_ports") or ["sample_in"]
    valid_out_p = detected.get("valid_out_port")
    data_out_p = detected.get("data_out_port") or "feature_out"
    flag_out_p = detected.get("flag_out_port")

    in_q_ints = analysis["series"]["input_q_int"]
    out_fx_ints = analysis["series"]["output_fx_int"]
    n_samples = len(in_q_ints)

    stim_lines = "\n".join(
        f"        stim_in[{idx}] = {_sv_signed_lit(v, w_bits)}; golden_out[{idx}] = {_sv_signed_lit(out_fx_ints[idx], w_bits)};"
        for idx, v in enumerate(in_q_ints)
    )

    port_conns: List[str] = []
    if clk_p:
        port_conns.append(f"        .{clk_p}(clk)")
    if rst_p:
        port_conns.append(f"        .{rst_p}({'rst_n' if rst_low else 'rst'})")
    if valid_in_p:
        port_conns.append(f"        .{valid_in_p}(valid_in)")
    for idx, inp in enumerate(data_in_ports):
        if idx == 0:
            port_conns.append(f"        .{inp}(sample_in)")
        else:
            port_conns.append(f"        .{inp}('0)")
    if valid_out_p:
        port_conns.append(f"        .{valid_out_p}(valid_out)")
    if data_out_p:
        port_conns.append(f"        .{data_out_p}(feature_out)")
    if flag_out_p and flag_out_p != data_out_p:
        port_conns.append(f"        .{flag_out_p}(anomaly_flag)")

    port_map_str = ",\n".join(port_conns)

    tb_code = f"""// ============================================================================
// Custom RTL Bit-Exact Golden Biosignal ({analysis['series']['stimulus'].upper()}) Testbench
// Target User Module : {mod_name} ({detected.get('file', 'rtl')})
// Fixed-Point Format : {analysis['q_format']} ({w_bits}-bit)
// ============================================================================
`timescale 1ns/1ps

module {tb_mod};
    localparam int DATA_W = {w_bits};
    localparam int N_VEC  = {n_samples};

    logic                     clk = 1'b0;
    logic                     rst_n = 1'b0;
    logic                     rst = 1'b1;
    logic                     valid_in = 1'b0;
    logic signed [DATA_W-1:0] sample_in = '0;
    logic                     valid_out;
    logic signed [DATA_W-1:0] feature_out;
    logic signed [DATA_W-1:0] golden_expected = '0;
    logic                     anomaly_flag;

    logic signed [DATA_W-1:0] stim_in    [0:N_VEC-1];
    logic signed [DATA_W-1:0] golden_out [0:N_VEC-1];
    int err_count = 0;

    {mod_name} dut (
{port_map_str}
    );

    always #5 clk = ~clk;

    initial begin
{stim_lines}

        #12;
        rst_n = 1'b1;
        rst   = 1'b0;
        for (int i = 0; i < N_VEC; i++) begin
            @(negedge clk);
            valid_in        = 1'b1;
            sample_in       = stim_in[i];
            golden_expected = golden_out[i];
            @(posedge clk);
            #1;
            if (feature_out !== golden_expected) begin
                $display("[USER-RTL vs GOLDEN] sample=%0d: RTL=%0d, Golden=%0d", i, feature_out, golden_expected);
                err_count++;
            end
        end
        @(negedge clk);
        valid_in = 1'b0;
        #20;
        $display("============================================================");
        $display(" User Module ({mod_name}) Co-Sim Complete: %0d/%0d Bit-Exact Matches (Errors: %0d)", N_VEC - err_count, N_VEC, err_count);
        $display("============================================================");
        $finish;
    end
endmodule
"""
    return tb_mod, tb_code


def generate_edge_ai_rtl(cfg: Dict[str, Any], detected_rtl: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Generate either:
    - Custom TB only (`target_mode == 'custom_tb_only'`) wired to the user's existing RTL module, OR
    - Full synthesizable 1D-CNN/DSP RTL + Golden TB (`target_mode == 'preset'` or `'custom_rtl_and_tb'`).
    """
    analysis = analyze_edge_ai(cfg)
    target_mode = str(cfg.get("target_mode", "preset"))

    if target_mode == "custom_tb_only" and detected_rtl:
        tb_mod, tb_code = _generate_tb_for_custom_rtl(analysis, detected_rtl)
        return {
            "target_mode": "custom_tb_only",
            "rtl_file": detected_rtl["file"],
            "tb_file": f"tb/{tb_mod}.sv",
            "top_module": detected_rtl["module_name"],
            "tb_module": tb_mod,
            "rtl_code": "",
            "tb_code": tb_code,
            "analysis": analysis,
        }

    raw_mod_name = str(cfg.get("module_name") or "").strip()
    mod_name = re.sub(r"[^a-zA-Z0-9_]", "_", raw_mod_name) if raw_mod_name else "conv1d_biosignal"
    if not re.match(r"^[a-zA-Z_]", mod_name):
        mod_name = f"cnn_{mod_name}"
    tb_mod = f"tb_{mod_name}"

    w_bits = analysis["total_bits"]
    f_bits = analysis["frac_bits"]
    i_bits = analysis["int_bits"]
    bg = analysis["bit_growth"]
    acc_w = bg["acc_width"]
    w_table = analysis["weights_table"]
    k_len = len(w_table)
    act = str(cfg.get("activation", "relu"))
    rounding = str(cfg.get("rounding", "round"))

    q_min = -(1 << (w_bits - 1))
    q_max = (1 << (w_bits - 1)) - 1
    bias_scaled = analysis["bias_int"] << f_bits
    round_const = (1 << (f_bits - 1)) if (rounding == "round" and f_bits > 0) else 0
    thresh_int = analysis["threshold_int"]

    weight_assigns = "\n".join(
        f"    localparam signed [{w_bits-1}:0] W_{idx} = {item['sv_lit']}; // float={item['float_val']} -> quant={item['quant_float']}"
        for idx, item in enumerate(w_table)
    )

    shift_lines = ["            x_win[0] <= sample_in;"] + [
        f"            x_win[{idx}] <= x_win[{idx-1}];"
        for idx in range(1, max(1, k_len - 1))
    ]
    shift_chain = "\n".join(shift_lines)

    tap_terms = ["(sample_in * W_0)"] + [
        f"(x_win[{idx-1}] * W_{idx})"
        for idx in range(1, k_len)
    ]
    mult_terms = " + ".join(tap_terms)

    if act == "relu":
        act_logic = f"        y_act = (y_sat < 0) ? {w_bits}'sd0 : y_sat;"
    elif act == "leaky_relu":
        act_logic = f"        y_act = (y_sat < 0) ? (y_sat >>> 3) : y_sat;"
    elif act == "sigmoid_lut":
        half = 1 << (f_bits - 1) if f_bits >= 1 else 1
        act_logic = (
            f"        if ((({w_bits}'sd{half}) + (y_sat >>> 2)) > {w_bits}'sd{q_max}) y_act = {w_bits}'sd{q_max};\n"
            f"        else if ((({w_bits}'sd{half}) + (y_sat >>> 2)) < 0) y_act = {w_bits}'sd0;\n"
            f"        else y_act = ({w_bits}'sd{half}) + (y_sat >>> 2);"
        )
    else:
        act_logic = "        y_act = y_sat;"

    rtl_code = f"""// ============================================================================
// Auto-Generated by CircuitVR Edge AI & Biosignal Co-Design Studio
// Module       : {mod_name} ({k_len}-Tap 1D-CNN / DSP Streaming Accelerator)
// Fixed-Point  : Q{i_bits}.{f_bits} ({w_bits}-bit signed, scale=2^{f_bits}={1 << f_bits})
// Accumulator  : {bg['acc_q']} ({bg['formula']})
// Activation   : {act.upper()} | Anomaly Threshold: {analysis['threshold_float']} ({thresh_int})
// ============================================================================
`timescale 1ns/1ps

module {mod_name} #(
    parameter int DATA_W = {w_bits},
    parameter int FRAC_W = {f_bits},
    parameter int ACC_W  = {acc_w}
) (
    input  logic                     clk,
    input  logic                     rst_n,
    input  logic                     valid_in,
    input  logic signed [DATA_W-1:0] sample_in,
    output logic                     valid_out,
    output logic signed [DATA_W-1:0] feature_out,
    output logic                     anomaly_flag
);

    // Quantized Q{i_bits}.{f_bits} Kernel Weights (SQNR = {analysis['weight_sqnr_db']} dB)
{weight_assigns}
    localparam signed [ACC_W-1:0] BIAS_SCALED = {_sv_signed_lit(bias_scaled, acc_w)};
    localparam signed [ACC_W-1:0] ROUND_CONST = {_sv_signed_lit(round_const, acc_w)};
    localparam signed [ACC_W-1:0] SAT_MAX_EXT = {_sv_signed_lit(q_max, acc_w)};
    localparam signed [ACC_W-1:0] SAT_MIN_EXT = {_sv_signed_lit(q_min, acc_w)};
    localparam signed [DATA_W-1:0] SAT_MAX    = {_sv_signed_lit(q_max, w_bits)};
    localparam signed [DATA_W-1:0] SAT_MIN    = {_sv_signed_lit(q_min, w_bits)};
    localparam signed [DATA_W-1:0] THRESH_VAL = {_sv_signed_lit(thresh_int, w_bits)};

    // Sliding Window Shift Register ({k_len} Taps)
    logic signed [DATA_W-1:0] x_win [0:{max(0, k_len-2)}];

    // Guard-Extended MAC & Re-Quantization Signals
    logic signed [ACC_W-1:0]  mac_sum;
    logic signed [ACC_W-1:0]  mac_shifted;
    logic signed [DATA_W-1:0] y_sat;
    logic signed [DATA_W-1:0] y_act;

    always_comb begin
        mac_sum     = {mult_terms} + BIAS_SCALED;
        mac_shifted = (mac_sum + ROUND_CONST) >>> FRAC_W;
        if (mac_shifted > SAT_MAX_EXT)
            y_sat = SAT_MAX;
        else if (mac_shifted < SAT_MIN_EXT)
            y_sat = SAT_MIN;
        else
            y_sat = mac_shifted[DATA_W-1:0];

{act_logic}
    end

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (int k = 0; k < {max(1, k_len-1)}; k++) begin
                x_win[k] <= '0;
            end
            valid_out    <= 1'b0;
            feature_out  <= '0;
            anomaly_flag <= 1'b0;
        end else if (valid_in) begin
{shift_chain}
            valid_out    <= 1'b1;
            feature_out  <= y_act;
            anomaly_flag <= (y_act >= THRESH_VAL);
        end else begin
            valid_out <= 1'b0;
        end
    end

endmodule
"""

    in_q_ints = analysis["series"]["input_q_int"]
    out_fx_ints = analysis["series"]["output_fx_int"]
    n_samples = len(in_q_ints)

    stim_lines = "\n".join(
        f"        stim_in[{idx}] = {_sv_signed_lit(v, w_bits)}; golden_out[{idx}] = {_sv_signed_lit(out_fx_ints[idx], w_bits)};"
        for idx, v in enumerate(in_q_ints)
    )

    tb_code = f"""// ============================================================================
// Bit-Exact Golden Biosignal ({analysis['series']['stimulus'].upper()}) Verification Testbench
// Verifies 0-bit discrepancy between Python Fixed-Point Model & Hardware RTL
// ============================================================================
`timescale 1ns/1ps

module {tb_mod};
    localparam int DATA_W = {w_bits};
    localparam int N_VEC  = {n_samples};

    logic                     clk = 1'b0;
    logic                     rst_n = 1'b0;
    logic                     valid_in = 1'b0;
    logic signed [DATA_W-1:0] sample_in = '0;
    logic                     valid_out;
    logic signed [DATA_W-1:0] feature_out;
    logic signed [DATA_W-1:0] golden_expected = '0;
    logic                     anomaly_flag;

    logic signed [DATA_W-1:0] stim_in    [0:N_VEC-1];
    logic signed [DATA_W-1:0] golden_out [0:N_VEC-1];
    int err_count = 0;

    {mod_name} dut (
        .clk(clk),
        .rst_n(rst_n),
        .valid_in(valid_in),
        .sample_in(sample_in),
        .valid_out(valid_out),
        .feature_out(feature_out),
        .anomaly_flag(anomaly_flag)
    );

    always #5 clk = ~clk;

    initial begin
{stim_lines}

        #12 rst_n = 1'b1;
        for (int i = 0; i < N_VEC; i++) begin
            @(negedge clk);
            valid_in        = 1'b1;
            sample_in       = stim_in[i];
            golden_expected = golden_out[i];
            @(posedge clk);
            #1;
            if (feature_out !== golden_expected) begin
                $display("[MISMATCH] sample=%0d: RTL=%0d, Golden=%0d", i, feature_out, golden_expected);
                err_count++;
            end
        end
        @(negedge clk);
        valid_in = 1'b0;
        #20;
        $display("============================================================");
        $display(" Edge AI Co-Sim Complete: %0d/%0d Bit-Exact Matches (Errors: %0d)", N_VEC - err_count, N_VEC, err_count);
        $display("============================================================");
        $finish;
    end
endmodule
"""

    return {
        "target_mode": target_mode,
        "rtl_file": f"rtl/{mod_name}.sv",
        "tb_file": f"tb/{tb_mod}.sv",
        "top_module": mod_name,
        "tb_module": tb_mod,
        "rtl_code": rtl_code,
        "tb_code": tb_code,
        "analysis": analysis,
    }
