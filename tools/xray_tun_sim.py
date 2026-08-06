#!/usr/bin/env python3
"""
Run Xray with the exact tools/config.json (v2rayN export) — no rewriting.

Uses v2rayN's xray.exe + geosite.dat/geoip.dat by default (our repo geosite
lacks code IR, which made the exact config fail to start).

Admin:
  python tools/xray_tun_sim.py
  python tools/xray_tun_sim.py --keep-alive
  python tools/xray_tun_sim.py --xray D:\\path\\to\\xray.exe
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = Path(__file__).resolve().parent / "config.json"

V2RAYN_ROOT = Path(r"C:\Portables\v2rayN-windows-64")
V2RAYN_XRAY = V2RAYN_ROOT / "bin" / "xray" / "xray.exe"
V2RAYN_GEO_DIR = V2RAYN_ROOT / "bin"

DEFAULT_XRAY_CANDIDATES = [
    REPO_ROOT / "src-tauri" / "bin" / "xray-x86_64-pc-windows-msvc.exe",
    REPO_ROOT / "src-tauri" / "target" / "debug" / "xray.exe",
    REPO_ROOT / "src-tauri" / "target" / "release" / "xray.exe",
    V2RAYN_XRAY,
]
WINTUN_CANDIDATES = [
    V2RAYN_ROOT / "bin" / "xray" / "wintun.dll",
    V2RAYN_ROOT / "bin" / "wintun.dll",
    REPO_ROOT / "src-tauri" / "bin" / "wintun.dll",
]
GEO_SRC_DIRS = [
    V2RAYN_GEO_DIR,
    REPO_ROOT / "src-tauri" / "bin",
]


def is_admin() -> bool:
    if os.name != "nt":
        return os.geteuid() == 0  # type: ignore[attr-defined]
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def find_first(paths: list[Path]) -> Path | None:
    for p in paths:
        if p.is_file():
            return p
    return None


def resolve_xray(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit)
        if not p.is_file():
            raise FileNotFoundError(p)
        return p.resolve()
    env = os.environ.get("XRAY_PATH")
    if env and Path(env).is_file():
        return Path(env).resolve()
    found = find_first(DEFAULT_XRAY_CANDIDATES)
    if found:
        return found.resolve()
    raise FileNotFoundError("xray.exe not found; pass --xray PATH")


def ensure_sidecar_files(xray_path: Path) -> None:
    """Put wintun.dll + geosite.dat + geoip.dat next to the chosen xray.exe."""
    # wintun
    wintun_dst = xray_path.parent / "wintun.dll"
    if not wintun_dst.is_file():
        src = find_first(WINTUN_CANDIDATES)
        if src:
            shutil.copy2(src, wintun_dst)
            print(f"[ok] copied wintun.dll -> {wintun_dst}")
        else:
            raise FileNotFoundError("wintun.dll not found")
    else:
        print(f"[ok] wintun.dll already at {wintun_dst}")

    # Prefer v2rayN geo (has geosite:ir). Always refresh from best source if IR missing risk.
    for name in ("geoip.dat", "geosite.dat"):
        dst = xray_path.parent / name
        src = None
        for d in GEO_SRC_DIRS:
            candidate = d / name
            if candidate.is_file():
                src = candidate
                break
        if src is None:
            print(f"[warn] missing source for {name}")
            continue
        # Always use v2rayN geo when available (repo geosite lacks IR).
        if src.resolve() != dst.resolve():
            shutil.copy2(src, dst)
            print(f"[ok] copied {name} from {src} -> {dst}")
        else:
            print(f"[ok] {name} already at {dst}")


def remove_tun_device() -> None:
    if os.name != "nt":
        return
    script = r"""
$names = @('xray_tun')
foreach ($n in $names) {
  try {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $sum = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($n))
    $guid = New-Object Guid(,$sum)
    $id = 'SWD\Wintun\{' + $guid.ToString() + '}'
    & "$env:SystemRoot\System32\pnputil.exe" /remove-device $id 2>$null | Out-Null
  } catch {}
}
"""
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    print("[ok] remove_tun_device done")


def socks_port_from_config(cfg: dict) -> int:
    for inbound in cfg.get("inbounds", []):
        if inbound.get("protocol") in ("mixed", "socks", "http"):
            return int(inbound.get("port") or 10808)
    return 10808


def has_tun(cfg: dict) -> bool:
    return any(i.get("protocol") == "tun" for i in cfg.get("inbounds", []))


def wait_socks(port: int, timeout_s: float = 15.0) -> bool:
    deadline = time.time() + timeout_s
    greeting = bytes([0x05, 0x01, 0x00])
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.4) as s:
                s.sendall(greeting)
                resp = s.recv(2)
                if len(resp) == 2 and resp[0] == 0x05:
                    return True
        except OSError:
            pass
        time.sleep(0.15)
    return False


def socks5_http_get(port: int, url: str, timeout: float = 12.0) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = parsed.hostname or ""
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    port_dst = parsed.port or 80
    if parsed.scheme != "http":
        raise ValueError("only http:// for this probe")

    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as s:
        s.settimeout(timeout)
        s.sendall(bytes([0x05, 0x01, 0x00]))
        if s.recv(2) != bytes([0x05, 0x00]):
            raise RuntimeError("SOCKS auth rejected")
        req = (
            bytes([0x05, 0x01, 0x00, 0x03, len(host)])
            + host.encode()
            + struct.pack("!H", port_dst)
        )
        s.sendall(req)
        hdr = s.recv(4)
        if len(hdr) < 4 or hdr[1] != 0x00:
            raise RuntimeError(f"SOCKS connect failed: {hdr!r}")
        atyp = hdr[3]
        if atyp == 0x01:
            s.recv(6)
        elif atyp == 0x03:
            ln = s.recv(1)[0]
            s.recv(ln + 2)
        elif atyp == 0x04:
            s.recv(18)
        s.sendall(
            f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode()
        )
        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
    text = data.decode("utf-8", errors="replace")
    return text.split("\r\n\r\n", 1)[1].strip()


def direct_http_get(url: str, timeout: float = 8.0) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "xray-tun-sim/exact"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace").strip()


def tun_ipv4() -> str | None:
    if os.name != "nt":
        return None
    script = (
        "(Get-NetIPAddress -InterfaceAlias 'xray_tun' -AddressFamily IPv4 "
        "-ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty IPAddress)"
    )
    out = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        check=False,
    )
    ip = (out.stdout or "").strip()
    return ip or None


def print_adapter_status() -> None:
    if os.name != "nt":
        return
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-NetIPAddress -InterfaceAlias 'xray_tun' -ErrorAction SilentlyContinue "
            "| Format-Table InterfaceAlias,IPAddress,PrefixLength -AutoSize; "
            "Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue "
            "| Select-Object InterfaceAlias,NextHop,RouteMetric "
            "| Format-Table -AutoSize",
        ],
        check=False,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Run exact tools/config.json with Xray")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--xray", help="Path to xray.exe (default: v2rayN's xray if present)")
    ap.add_argument("--keep-alive", action="store_true")
    args = ap.parse_args()

    cfg_path = Path(args.config).resolve()
    if not cfg_path.is_file():
        print(f"ERROR: config not found: {cfg_path}", file=sys.stderr)
        return 2

    with cfg_path.open(encoding="utf-8") as f:
        cfg = json.load(f)

    tun_mode = has_tun(cfg)
    port = socks_port_from_config(cfg)

    print("=== xray_tun_sim (EXACT config.json) ===")
    print(f"config={cfg_path}")
    print(f"tun_mode={tun_mode}  socks_port={port}")
    if tun_mode:
        tun = next(i for i in cfg["inbounds"] if i.get("protocol") == "tun")
        print(f"tun settings={json.dumps(tun.get('settings'), ensure_ascii=False)}")

    if tun_mode and not is_admin():
        print("ERROR: run as Administrator", file=sys.stderr)
        return 2

    xray = resolve_xray(args.xray)
    print(f"xray={xray}")
    ensure_sidecar_files(xray)

    work = Path(tempfile.gettempdir()) / "v2ray_test_configs"
    work.mkdir(parents=True, exist_ok=True)
    run_cfg = work / "python_tun_sim.json"
    shutil.copy2(cfg_path, run_cfg)
    print(f"run_config={run_cfg} (byte-copy of source)")

    if tun_mode:
        print("[warn] close v2rayN first — same adapter name xray_tun")
        remove_tun_device()
        time.sleep(0.3)

    try:
        baseline = direct_http_get("http://api.ipify.org")
        print(f"[probe] direct IP before start: {baseline}")
    except Exception as e:
        print(f"[probe] direct IP failed: {e}")
        baseline = None

    # cwd = xray dir so relative assets resolve like v2rayN
    proc = subprocess.Popen(
        [str(xray), "run", "-config", str(run_cfg)],
        cwd=str(xray.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(f"[ok] xray pid={proc.pid}")

    def _shutdown(*_):
        print("\n[stop] killing xray...")
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        if tun_mode:
            remove_tun_device()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _shutdown)

    assert proc.stdout is not None
    deadline_logs = time.time() + 5.0
    while time.time() < deadline_logs:
        if proc.poll() is not None:
            print(proc.stdout.read() or "")
            print(f"ERROR: xray exited early: {proc.returncode}", file=sys.stderr)
            if tun_mode:
                remove_tun_device()
            return 1
        line = proc.stdout.readline()
        if line:
            print(f"[XRAY] {line.rstrip()}")
        else:
            time.sleep(0.05)

    if not wait_socks(port, timeout_s=15.0):
        print("ERROR: SOCKS never ready", file=sys.stderr)
        while True:
            line = proc.stdout.readline()
            if not line:
                break
            print(f"[XRAY] {line.rstrip()}")
        proc.kill()
        if tun_mode:
            remove_tun_device()
        return 1
    print(f"[ok] socks ready on 127.0.0.1:{port}")

    try:
        via_socks = socks5_http_get(port, "http://api.ipify.org")
        print(f"[probe] IP via mixed SOCKS: {via_socks}")
        if baseline and via_socks == baseline:
            print("[warn] SOCKS IP == direct IP")
        else:
            print("[ok] SOCKS path changed public IP")
    except Exception as e:
        print(f"[fail] SOCKS ipify: {e}")
        via_socks = None

    if tun_mode:
        time.sleep(2.0)
        print(f"[tun] adapter IPv4: {tun_ipv4()}")
        print_adapter_status()
        try:
            via_system = direct_http_get("http://api.ipify.org", timeout=12.0)
            print(f"[probe] system IP after TUN: {via_system}")
            if baseline and via_system == baseline:
                print("[fail] system IP unchanged — TUN not capturing")
            elif via_socks and via_system == via_socks:
                print("[ok] system IP matches SOCKS — TUN works")
            else:
                print("[info] system IP changed; compare with SOCKS")
        except Exception as e:
            print(f"[fail] system ipify after TUN: {e}")

    if args.keep_alive:
        print("Xray running — Ctrl+C to stop.")
        while proc.poll() is None:
            line = proc.stdout.readline()
            if line:
                print(f"[XRAY] {line.rstrip()}")
            else:
                time.sleep(0.2)
        if tun_mode:
            remove_tun_device()
        return proc.returncode or 0

    print("[stop] probes done — stopping xray")
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
    if tun_mode:
        time.sleep(0.25)
        remove_tun_device()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
