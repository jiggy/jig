"""Ordinary installed TUI refusal with missing Core, before execution or raw input."""
import errno
import os
import pty
import selectors
import signal
import subprocess
import sys
import time

master, slave = pty.openpty()
child = None
selector = selectors.DefaultSelector()
data = bytearray()
try:
    os.set_blocking(master, False)
    selector.register(master, selectors.EVENT_READ)
    # Keep the PTY session owner alive until attributes have been measured.
    # On Darwin the parent's slave can cease to support tcgetattr after its
    # last session process exits, despite the retained file descriptor.
    owner = '''
import os, subprocess, sys, termios
before = termios.tcgetattr(0)
child = subprocess.Popen(sys.argv[1:])
code = child.wait()
assert termios.tcgetattr(0) == before
os.write(2, b'\\nREFUSAL_OWNER_INPUT_RESTORED\\n')
sys.exit(code if code >= 0 else 128-code)
'''
    child = subprocess.Popen(
        [sys.executable, '-c', owner, sys.argv[1], 'run', 'flow:flows/unused', '--display', 'tui'],
        stdin=slave, stderr=slave, stdout=subprocess.DEVNULL,
        env=dict(os.environ, TERM='xterm-256color', NO_COLOR='1'),
        start_new_session=True,
    )
    deadline = time.monotonic() + 30
    while child.poll() is None or selector.get_map():
        if time.monotonic() >= deadline:
            raise TimeoutError('Installed TUI refusal timed out')
        for key, _ in selector.select(0.05):
            try:
                chunk = os.read(key.fd, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                chunk = b''
            if chunk:
                data.extend(chunk)
                if len(data) > 256 * 1024:
                    raise AssertionError('TUI refusal exceeded diagnostic bound')
            else:
                selector.unregister(master)
        if child.poll() is not None:
            # The parent's retained slave means EOF is not a completion signal.
            while True:
                try:
                    chunk = os.read(master, 65536)
                except BlockingIOError:
                    break
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > 256 * 1024:
                    raise AssertionError('TUI refusal exceeded diagnostic bound')
            break
    assert child.wait(timeout=1) != 0
    assert b'JIG_TUI_UNAVAILABLE' in data
    assert b'No Flow was started' in data
    assert b'\x1b[?1049h' not in data
    assert b'REFUSAL_OWNER_INPUT_RESTORED' in data
    print('{"passed":true,"checks":["missing-support","pre-dispatch","no-screen","input-restored"]}')
finally:
    if child is not None and child.poll() is None:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=5)
    selector.close()
    os.close(master)
    os.close(slave)
