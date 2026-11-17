#!/usr/bin/env python3
"""Experiment only. No MDM installation, native model call, or product qualification."""
import hashlib, json, os, pathlib, secrets, shutil, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parent
DEADLINE = time.monotonic() + 120
records = []

def call(arguments, *, check=False):
    remaining = DEADLINE - time.monotonic()
    if remaining <= 0:
        raise RuntimeError('diagnostic deadline expired')
    result = subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True,
                            timeout=min(10, remaining), text=True)
    if check and (result.returncode or result.stderr):
        raise RuntimeError('diagnostic operation failed')
    return result

try:
    if not (os.uname().sysname == 'Darwin' and os.uname().machine == 'arm64' and os.getuid() > 0
            and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_OS') == 'macOS'
            and os.environ.get('JIG_DISPOSABLE_MAC_POLICY_DIAGNOSTIC') == '1'):
        raise RuntimeError('explicit disposable hosted ARM Mac opt-in required')
    package = pathlib.Path(sys.argv[1]).resolve(strict=True)
    helper = package / 'support/macos-codex-preferences-universal'
    manifest = json.loads((package / 'support/macos-native-build.json').read_text())
    if helper.is_symlink() or not helper.is_file() or not os.access(helper, os.X_OK):
        raise RuntimeError('actual shipped helper executable required')
    for relative in ('support/macos-codex-preferences-universal', 'support/macos-codex-preferences.m'):
        if hashlib.sha256((package / relative).read_bytes()).hexdigest() != manifest['sha256'][relative]:
            raise RuntimeError('helper source or binary differs from native asset manifest')
    scratch = pathlib.Path(tempfile.mkdtemp(prefix='jig-forced-policy-'))
    reader = scratch / 'reader'
    call(['/usr/bin/clang', '-O2', '-Wall', '-Wextra', '-Werror', '-fobjc-arc',
          '-framework', 'Foundation', str(ROOT / 'read-policy.m'), '-o', str(reader)], check=True)
    provision = ['/usr/bin/sudo', '-n', sys.executable, str(ROOT / 'policy-file.py')]
    call([str(reader), 'absent', '-', '-'], check=True)
    initial = call([str(helper)])
    if initial.returncode != 0 or initial.stdout or initial.stderr:
        raise RuntimeError('ordinary shipped helper baseline did not pass')
    for lane in ('global', 'user'):
        for key in ('config_toml_base64', 'requirements_toml_base64'):
            call([str(reader), 'absent', '-', '-'], check=True)
            token = secrets.token_hex(24)
            result = call([*provision, 'create', lane, key, token], check=True)
            record = json.loads(result.stdout)
            recognized = False
            try:
                for _ in range(5):
                    observed = call([str(reader), 'forced', key, token])
                    if observed.returncode == 0 and not observed.stdout and not observed.stderr:
                        recognized = True
                        break
                    time.sleep(min(.25, max(0, DEADLINE - time.monotonic())))
                if recognized:
                    observed = call([str(helper)])
                    if observed.returncode != 71 or observed.stdout or observed.stderr:
                        raise RuntimeError('actual forced-policy helper refusal did not pass')
                records.append({'lane': lane, 'key': key, 'frameworkForced': recognized,
                                'helperRefusal71': recognized})
            finally:
                # Clean only the root-created inode and exact retained fixture bytes.
                # If ownership changed, preserve it and fail. Never reset caches or policy.
                cleanup = subprocess.run([*provision, 'cleanup', json.dumps(record)],
                                         stdin=subprocess.DEVNULL, capture_output=True,
                                         timeout=10, text=True)
                if cleanup.returncode or cleanup.stdout or cleanup.stderr:
                    raise RuntimeError('exact fixture policy cleanup unconfirmed')
            call([str(reader), 'absent', '-', '-'], check=True)
            after = call([str(helper)])
            if after.returncode or after.stdout or after.stderr:
                raise RuntimeError('post-cleanup ordinary observation did not pass')
            if not recognized:
                break
    print(json.dumps({'kind': 'experimental-forced-policy-control/1', 'observations': records,
                      'mdmDeliveryQualified': False, 'modelCalls': 0}))
    shutil.rmtree(scratch)
    if {row['key'] for row in records if row['frameworkForced']} != {'config_toml_base64', 'requirements_toml_base64'}:
        sys.exit(77)  # An inconclusive setup is not a passing qualification.
except Exception as error:
    print(json.dumps({'kind': 'experimental-forced-policy-control/1', 'failed': True,
                      'phase': str(error) if type(error) is RuntimeError else 'diagnostic command or input failed',
                      'mdmDeliveryQualified': False}), file=sys.stderr)
    sys.exit(1)
