#!/usr/bin/env python3
"""Provisioning-only operation, restricted to a disposable Apple ARM CI guest."""
import hashlib, json, os, pathlib, plistlib, pwd, re, stat, sys

BASE = pathlib.Path('/Library/Managed Preferences')
KEYS = ('config_toml_base64', 'requirements_toml_base64')

def require(condition):
    if not condition:
        raise RuntimeError('managed-policy fixture ownership refusal')

def directory(path):
    value = os.lstat(path)
    require(stat.S_ISDIR(value.st_mode) and value.st_uid == 0 and not value.st_mode & 0o022)
    return value

def identity(value):
    return [value.st_dev, value.st_ino]

def context(lane, key, token):
    require(os.getuid() == 0 and os.uname().sysname == 'Darwin' and os.uname().machine == 'arm64')
    require(lane in ('global', 'user') and key in KEYS and re.fullmatch('[0-9a-f]{48}', token))
    uid = int(os.environ['SUDO_UID'])
    user = os.environ['SUDO_USER']
    require(uid > 0 and pwd.getpwuid(uid).pw_name == user and re.fullmatch('[A-Za-z0-9_.-]+', user))
    targets = [BASE / 'com.openai.codex.plist', BASE / user / 'com.openai.codex.plist']
    path = targets[lane == 'user']
    body = plistlib.dumps({key: token}, fmt=plistlib.FMT_XML, sort_keys=True)
    return path, targets, body

def create(lane, key, token):
    path, targets, body = context(lane, key, token)
    # Reject every preexisting Codex policy leaf, including dangling symlinks.
    require(all(not os.path.lexists(item) for item in targets))
    directory('/Library')
    made = []
    fd = None
    owned = None
    try:
        for parent in (BASE, path.parent):
            if not os.path.lexists(parent):
                os.mkdir(parent, 0o755)
                made.append([str(parent), identity(directory(parent))])
            else:
                directory(parent)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        owned = identity(os.fstat(fd))
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as stream:
            fd = None
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        return {'lane': lane, 'key': key, 'token': token, 'file': owned, 'directories': made}
    except BaseException:
        if fd is not None:
            os.close(fd)
        if owned is not None and os.path.lexists(path) and identity(os.lstat(path)) == owned:
            os.unlink(path)
        for name, expected in reversed(made):
            if identity(directory(name)) == expected:
                os.rmdir(name)
        raise

def cleanup(record):
    path, _, body = context(record['lane'], record['key'], record['token'])
    directory(BASE)
    directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_nlink == 1)
        require(identity(value) == record['file'] and value.st_size == len(body))
        require(os.read(fd, len(body) + 1) == body)
        require(identity(os.lstat(path)) == record['file'])
        os.unlink(path)
    finally:
        os.close(fd)
    for name, expected in reversed(record['directories']):
        require(name in (str(BASE), str(path.parent)) and identity(directory(name)) == expected)
        os.rmdir(name)

try:
    operation = sys.argv[1]
    if operation == 'create' and len(sys.argv) == 5:
        print(json.dumps(create(*sys.argv[2:])))
    elif operation == 'cleanup' and len(sys.argv) == 3:
        cleanup(json.loads(sys.argv[2]))
    else:
        raise RuntimeError('invalid diagnostic operation')
except BaseException:
    print('managed-policy provisioning or exact cleanup failed', file=sys.stderr)
    sys.exit(1)
