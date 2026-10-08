// Qualified Intel 23E224 fixture: frame the owned PID before releasing exec.
// Its pre-exec version is spawn evidence; the interposer supplies the live
// post-exec version used for independent observation and audited cleanup.
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <mach/mach.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static int identity(pid_t pid, uint32_t *version) {
  unsigned char unique[56] = {0};
  errno = 0;
  int size = proc_pidinfo(pid, 17, 0, unique, (int)sizeof(unique));
  if (size == (int)sizeof(unique)) {
    memcpy(version, unique + 32, sizeof(*version));
    return 1;
  }
  return errno == ESRCH ? 0 : -1;
}

static int stateOrKill(const char *operation, const char *pidText, const char *versionText) {
  char *end;
  errno = 0;
  unsigned long pidValue = strtoul(pidText, &end, 10);
  if (errno || !*pidText || *end || pidValue <= 1 || pidValue > INT32_MAX) return 70;
  errno = 0;
  unsigned long versionValue = strtoul(versionText, &end, 10);
  if (errno || !*versionText || *end || versionValue == 0 || versionValue > UINT32_MAX) return 70;
  pid_t pid = (pid_t)pidValue;
  uint32_t version;
  int observed = identity(pid, &version);
  if (observed < 0) return 70;
  if (observed == 0 || version != versionValue) return 0;
  if (!strcmp(operation, "state")) return 1;
  // A recycled PID cannot receive the cleanup signal.
  audit_token_t token = {{0}};
  token.val[5] = (uint32_t)pid;
  token.val[7] = (uint32_t)versionValue;
  if (proc_signal_with_audittoken(&token, SIGKILL) && errno != ESRCH) return 70;
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 4 || getuid() == 0 || getuid() != geteuid()) return 70;
  if (!strcmp(argv[1], "state") || !strcmp(argv[1], "kill"))
    return stateOrKill(argv[1], argv[2], argv[3]);
  if (strcmp(argv[1], "owner") || argv[2][0] != '/' || argv[3][0] != '/') return 70;
  struct sigaction action = {.sa_handler = SIG_DFL};
  sigemptyset(&action.sa_mask);
  sigset_t alarmSignal;
  sigemptyset(&alarmSignal);
  sigaddset(&alarmSignal, SIGALRM);
  if (sigaction(SIGALRM, &action, NULL) || sigprocmask(SIG_UNBLOCK, &alarmSignal, NULL)) return 70;
  alarm(8);
  int gate[2];
  if (pipe(gate)) return 70;
  pid_t child = fork();
  if (child < 0) return 70;
  if (child == 0) {
    close(gate[1]);
    char admitted = 0;
    if (read(gate[0], &admitted, 1) != 1 || admitted != 'A') _exit(70);
    close(gate[0]);
    if (dup2(STDOUT_FILENO, 3) < 0) _exit(70);
    int ignored = open("/dev/null", O_RDWR);
    if (ignored < 0) _exit(70);
    for (int fd = 0; fd <= 2; fd++) if (dup2(ignored, fd) < 0) _exit(70);
    if (ignored > 3) close(ignored);
    action.sa_handler = SIG_IGN;
    if (sigaction(SIGALRM, &action, NULL) || sigprocmask(SIG_BLOCK, &alarmSignal, NULL) ||
        setenv("DYLD_INSERT_LIBRARIES", argv[3], 1) ||
        setenv("JIG_OBSERVER_FIXTURE_MODE", "block", 1)) _exit(70);
    execl(argv[2], argv[2], (char *)NULL);
    _exit(70);
  }
  close(gate[0]);
  uint32_t version;
  if (identity(child, &version) != 1) return 70;
  uint32_t frame[4] = {0x4a4f5350, (uint32_t)child, version, (uint32_t)getpid()};
  if (write(STDOUT_FILENO, frame, sizeof(frame)) != sizeof(frame) || write(gate[1], "A", 1) != 1)
    return 70;
  close(gate[1]);
  int status;
  while (waitpid(child, &status, 0) < 0) if (errno != EINTR) return 70;
  return WIFEXITED(status) ? WEXITSTATUS(status) : 72;
}
