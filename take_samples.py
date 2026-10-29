import os
import sys
import time
import subprocess
import requests
from pathlib import Path
from playwright.sync_api import sync_playwright

FPGA_ORNEK_DIR = Path(r"C:\Users\ygttc\OneDrive\Masaüstü\Develop\fpga-ornek")
SV_KODLAR_DIR = FPGA_ORNEK_DIR / "SV_Kodlar"
MEM_FILE = FPGA_ORNEK_DIR / "ecg_anomaly.mem"
SAMPLES_DIR_1 = FPGA_ORNEK_DIR / "samples"
SAMPLES_DIR_2 = Path(__file__).resolve().parent / "samples"

SAMPLES_DIR_1.mkdir(parents=True, exist_ok=True)
SAMPLES_DIR_2.mkdir(parents=True, exist_ok=True)

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 8000
BASE_URL = f"http://127.0.0.1:{PORT}"

def save_both(page, filename: str):
    p1 = SAMPLES_DIR_1 / filename
    p2 = SAMPLES_DIR_2 / filename
    page.screenshot(path=str(p1), full_page=False)
    page.screenshot(path=str(p2), full_page=False)
    print(f"[OK] Saved: {filename} -> {p1}")

def wait_for_server(timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=1)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False

def main():
    server_proc = None
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=1)
        if r.status_code == 200:
            print("Server already running on port 8000")
    except Exception:
        print("Starting FastAPI backend server...")
        env = os.environ.copy()
        env["PYTHONPATH"] = str(Path(__file__).resolve().parent / "backend")
        server_proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", str(PORT)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        if not wait_for_server(15):
            print("Failed to start FastAPI server")
            if server_proc:
                server_proc.kill()
            return 1

    print("Server ready! Starting Playwright with Chrome...")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=CHROME_PATH,
            headless=True,
            args=["--disable-web-security", "--no-sandbox", "--disable-gpu"]
        )
        context = browser.new_context(
            viewport={"width": 1600, "height": 960},
            device_scale_factor=1.25  # Crisp HD screenshot
        )
        page = context.new_page()

        # Step 1: Open app & set workspace in localStorage with onboarding suppressed
        page.goto(BASE_URL)
        page.wait_for_timeout(1000)

        target_ws = str(SV_KODLAR_DIR).replace("\\", "/")
        page.evaluate(f"""() => {{
            localStorage.setItem('circuitvr_hide_onboarding', '1');
            localStorage.setItem('cvr.onboardingDone', '1');
            localStorage.setItem('cvr.lastPath', '{target_ws}');
            localStorage.setItem('cvr.lang', 'tr');
        }}""")
        page.reload()
        page.wait_for_timeout(3000)

        # Dismiss any leftover modal if present
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        print("Workspace loaded:", target_ws)

        # SCREENSHOT 1: Code Editor with edge_ai_cnn1d.sv
        try:
            sv_item = page.locator("button:has-text('edge_ai_cnn1d.sv')").first
            if sv_item.is_visible():
                sv_item.click()
                page.wait_for_timeout(1000)
        except Exception as e:
            print("File selection note:", e)
        save_both(page, "01_code_editor_edge_ai.png")

        # SCREENSHOT 2: Schematic View
        print("Capturing Schematic Viewer...")
        try:
            # Click Schematic button in TopBar to generate netlist
            schem_top_btn = page.locator("header button:has-text('Şematik')").first
            if schem_top_btn.is_visible():
                schem_top_btn.click()
                page.wait_for_timeout(3500)
            else:
                page.locator("nav button:has-text('Şematik')").first.click()
                page.wait_for_timeout(2500)

            # Hover over a cell to trigger smart tooltip
            nodes = page.locator(".react-flow__node")
            if nodes.count() > 0:
                nodes.first.hover()
                page.wait_for_timeout(800)
            save_both(page, "02_schematic_interactive_viewer.png")
        except Exception as e:
            print("Schematic error:", e)

        # SCREENSHOT 3: Analysis / FSM View
        print("Capturing Analysis / FSM...")
        try:
            page.locator("nav button:has-text('Analiz')").first.click()
            page.wait_for_timeout(3000)
            save_both(page, "03_fsm_optimization_analysis.png")
        except Exception as e:
            print("Analysis error:", e)

        # SCREENSHOT 4: Simulation & Waveform View
        print("Capturing Waveform Viewer...")
        try:
            # Click Simulate in TopBar
            sim_btn = page.locator("header button:has-text('Simüle Et')").first
            if sim_btn.is_visible():
                sim_btn.click()
                page.wait_for_timeout(4000)
            else:
                page.locator("nav button:has-text('Waveform')").first.click()
                page.wait_for_timeout(2000)
            save_both(page, "04_waveform_biosignal_spike.png")
        except Exception as e:
            print("Waveform error:", e)

        # SCREENSHOT 5: Edge AI Lab
        print("Capturing Edge AI Lab...")
        try:
            page.locator("nav button:has-text('Edge AI Lab')").first.click()
            page.wait_for_timeout(2000)

            # Upload ecg_anomaly.mem using hidden file input
            file_input = page.locator("input[type='file'][accept*='.mem']").first
            if not file_input.is_visible() and file_input.count() > 0:
                file_input.set_input_files(str(MEM_FILE))
                page.wait_for_timeout(2500)

            save_both(page, "05_edge_ai_studio_overview.png")

            # SCREENSHOT 6: Maximized Pareto Curve Modal
            print("Capturing Maximized Pareto Modal...")
            pareto_max_btn = page.locator("button[title*='Maximize'], button[title*='Büyüt']").first
            if pareto_max_btn.is_visible():
                pareto_max_btn.click()
                page.wait_for_timeout(1200)
                save_both(page, "06_pareto_design_space_maximized.png")
                # Close modal by clicking X button
                close_btn = page.locator(".fixed.z-50 button:has(svg)").first
                if close_btn.is_visible():
                    close_btn.click()
                else:
                    page.keyboard.press("Escape")
                page.wait_for_timeout(1000)

            # SCREENSHOT 7: Maximized Biosignal Waveform Modal
            print("Capturing Maximized Biosignal Waveform Modal...")
            max_btns = page.locator("button[title*='Maximize'], button[title*='Büyüt']")
            if max_btns.count() >= 2:
                max_btns.nth(1).click()
                page.wait_for_timeout(1200)
                save_both(page, "07_biosignal_anomaly_waveform_maximized.png")
                close_btn = page.locator(".fixed.z-50 button:has(svg)").first
                if close_btn.is_visible():
                    close_btn.click()
                else:
                    page.keyboard.press("Escape")
                page.wait_for_timeout(600)

        except Exception as e:
            print("Edge AI error:", e)

        browser.close()
        print("All screenshots successfully captured!")

    if server_proc:
        server_proc.kill()
    return 0

if __name__ == "__main__":
    sys.exit(main())
