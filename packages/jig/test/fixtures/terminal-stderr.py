"""Run a real command with terminal stderr and separately captured stdout."""
import errno
import json
import os
import pty
import subprocess
import sys
import threading

master, slave = pty.openpty()
chunks = []


def consume():
    while True:
        try:
            chunk = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not chunk:
            break
        chunks.append(chunk)


reader = threading.Thread(target=consume)
reader.start()
process = subprocess.Popen(sys.argv[1:], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=slave, env=dict(os.environ, NO_COLOR="1", TERM="dumb"))
os.close(slave)
try:
    stdout, _ = process.communicate(timeout=120)
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    reader.join(timeout=10)
    os.close(master)
print(json.dumps({"code": process.returncode, "stdout": stdout.decode(),
                  "stderr": b"".join(chunks).decode().replace("\r\n", "\n")}))
