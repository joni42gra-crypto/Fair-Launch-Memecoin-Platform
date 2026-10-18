#!/usr/bin/env python3
"""Preflight the exact io_uring features required by Agave 3.1.10."""

import ctypes
import os
import platform
import sys


def fail(message: str) -> None:
    print(f"io_uring preflight failed: {message}", file=sys.stderr)
    raise SystemExit(1)


if sys.platform != "linux":
    fail("Agave 3.1.10 local validator requires Linux.")

if platform.machine().lower() not in {"x86_64", "amd64", "aarch64", "arm64"}:
    fail(f"unsupported architecture for this preflight: {platform.machine()}")

# Linux UAPI: io_uring_setup is syscall 425 on x86_64 and arm64.
params = ctypes.create_string_buffer(120)  # struct io_uring_params
libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long
ring_fd = libc.syscall(
    ctypes.c_long(425),
    ctypes.c_uint(1),
    ctypes.byref(params),
)
if ring_fd < 0:
    error_number = ctypes.get_errno()
    fail(f"io_uring_setup is unavailable: {os.strerror(error_number)} (errno {error_number})")

try:
    # struct io_uring_params.features follows six u32 fields at byte offset 20.
    features = int.from_bytes(params.raw[20:24], byteorder="little")
    required = {
        "IORING_FEAT_NODROP": 1 << 1,
        "IORING_FEAT_SQPOLL_NONFIXED": 1 << 7,
    }
    missing = [name for name, bit in required.items() if not features & bit]
    if missing:
        fail(f"kernel lacks Agave-required features: {', '.join(missing)}")
finally:
    os.close(ring_fd)

print("io_uring_setup, IORING_FEAT_NODROP, and IORING_FEAT_SQPOLL_NONFIXED are available.")
