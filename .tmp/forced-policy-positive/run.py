#!/usr/bin/env python3
"""Experiment only. No MDM installation, native model call, or product qualification."""
import hashlib, json, os, pathlib, secrets, shutil, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parent
DEADLINE = time.monotonic() + 120
records = []
current_phase = 'precondition'
case = {}

class Failure(Exception):
    def __init__(self, phase, status, result=None):
        self.fields = {'phase': phase, 'status': status}
        if result is not None:
            self.fields.update(exitCode=result.returncode, stdoutBytes=len(result.stdout),
                               stderrBytes=len(result.stderr))

def run(arguments, phase, *, cleanup=False):
    global current_phase
    current_phase = phase
    remaining = 10 if cleanup else min(10, DEADLINE - time.monotonic())
    if remaining <= 0:
        raise Failure(phase, 'work_deadline')
    try:
        return subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True,
                              timeout=remaining)
    except subprocess.TimeoutExpired:
        raise Failure(phase, 'command_timeout') from None
    except OSError:
        raise Failure(phase, 'command_start_failed') from None

def expected(result, phase, code=0, *, stdout=False):
    if result.returncode != code:
        raise Failure(phase, 'unexpected_exit', result)
    if result.stderr or (result.stdout and not stdout):
        raise Failure(phase, 'unexpected_output', result)
    return result

try:
    if not (os.uname().sysname == 'Darwin' and os.uname().machine == 'arm64' and os.getuid() > 0
            and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_OS') == 'macOS'
            and os.environ.get('JIG_DISPOSABLE_MAC_POLICY_DIAGNOSTIC') == '1'):
        raise Failure('precondition', 'disposable_host_opt_in_required')
    package = pathlib.Path(sys.argv[1]).resolve(strict=True)
    helper = package / 'support/macos-codex-preferences-universal'
    manifest = json.loads((package / 'support/macos-native-build.json').read_text())
    if helper.is_symlink() or not helper.is_file() or not os.access(helper, os.X_OK):
        raise Failure('precondition', 'actual_helper_required')
    for relative in ('support/macos-codex-preferences-universal', 'support/macos-codex-preferences.m'):
        if hashlib.sha256((package / relative).read_bytes()).hexdigest() != manifest['sha256'][relative]:
            raise Failure('precondition', 'native_asset_identity_changed')
    scratch = pathlib.Path(tempfile.mkdtemp(prefix='jig-forced-policy-'))
    reader = scratch / 'reader'
    expected(run(['/usr/bin/clang', '-O2', '-Wall', '-Wextra', '-Werror',
                  '-Wno-deprecated-declarations', '-fobjc-arc', '-framework', 'Foundation',
                  str(ROOT / 'read-policy.m'), '-o', str(reader)], 'compile'), 'compile')
    provision = ['/usr/bin/sudo', '-n', sys.executable, str(ROOT / 'policy-file.py')]
    expected(run([str(reader), 'absent', '-', '-'], 'absent_before_baseline'), 'absent_before_baseline')
    expected(run([str(helper)], 'ordinary_helper_before'), 'ordinary_helper_before')
    for lane in ('global', 'user'):
        for key in ('config_toml_base64', 'requirements_toml_base64'):
            case = {'lane': lane, 'key': key}
            expected(run([str(reader), 'absent', '-', '-'], 'absent_before_case'), 'absent_before_case')
            token = secrets.token_hex(24)
            result = expected(run([*provision, 'create', lane, key, token], 'provision'),
                              'provision', stdout=True)
            try:
                record = json.loads(result.stdout)
            except (ValueError, UnicodeError):
                raise Failure('provision', 'invalid_ownership_record') from None
            recognized = False
            observed = None
            try:
                for _ in range(5):
                    observed = run([str(reader), 'forced', key, token], 'verify_forced')
                    if observed.returncode == 0 and not observed.stdout and not observed.stderr:
                        recognized = True
                        break
                    time.sleep(min(.25, max(0, DEADLINE - time.monotonic())))
                if recognized:
                    expected(run([str(helper)], 'helper_refusal'), 'helper_refusal', code=71)
                records.append({'lane': lane, 'key': key, 'frameworkForced': recognized,
                                'helperRefusal71': recognized, 'readerExitCode': observed.returncode,
                                'readerStdoutBytes': len(observed.stdout),
                                'readerStderrBytes': len(observed.stderr)})
            finally:
                # Cleanup uses its separate ten-second allowance and exact retained identity.
                expected(run([*provision, 'cleanup', json.dumps(record)], 'cleanup', cleanup=True),
                         'cleanup')
            expected(run([str(reader), 'absent', '-', '-'], 'absent_after_case'), 'absent_after_case')
            expected(run([str(helper)], 'ordinary_helper_after'), 'ordinary_helper_after')
            if not recognized:
                break
    print(json.dumps({'kind': 'experimental-forced-policy-control/1', 'observations': records,
                      'mdmDeliveryQualified': False, 'modelCalls': 0}))
    shutil.rmtree(scratch)
    if {row['key'] for row in records if row['frameworkForced']} != {'config_toml_base64', 'requirements_toml_base64'}:
        sys.exit(77)
except Exception as error:
    fields = error.fields if isinstance(error, Failure) else {
        'phase': current_phase, 'status': 'diagnostic_input_or_command_failed'}
    print(json.dumps({'kind': 'experimental-forced-policy-control/1', 'failed': True,
                      **case, **fields, 'mdmDeliveryQualified': False}), file=sys.stderr)
    sys.exit(1)
