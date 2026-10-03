// Trusted pre-exec boundary. The independent guardian owns limits and cleanup.
// FD 3: bounded profile, FD 4: admission byte, FD 5: readiness then exit frames.
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <mach/mach.h>
#include <mach-o/dyld.h>
#include <poll.h>
#include <sandbox.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;
static double now(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t)) _exit(70);
  return t.tv_sec + t.tv_nsec / 1e9;
}
static int receive(int fd, void *buffer, size_t length, double deadline) {
  size_t offset = 0;
  while (offset < length) {
    double remaining = deadline - now();
    if (remaining <= 0) return -1;
    struct pollfd event = {.fd = fd, .events = POLLIN};
    int ready = poll(&event, 1, (int)(remaining * 1000) + 1);
    if (ready < 0 && errno == EINTR) continue;
    if (ready <= 0 || (event.revents & (POLLERR | POLLNVAL))) return -1;
    ssize_t count = read(fd, (char *)buffer + offset, length - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return -1;
    offset += count;
  }
  return 0;
}
static int enter(char **argv, size_t length) {
  const double deadline = now() + 10;
  char profile[32769];
  if (receive(3, profile, length, deadline)) return 71;
  if (memchr(profile, 0, length)) return 72;
  profile[length] = 0;
  close(3);
  if (chdir(argv[3])) return 73;
  struct rlimit files = {1024, 1024};
  if (setrlimit(RLIMIT_NOFILE, &files)) return 74;
  // Read the native PID version before narrowing process-information access.
  unsigned char unique[56] = {0};
  if (proc_pidinfo(getpid(), 17, 0, unique, sizeof(unique)) != sizeof(unique)) return 75;
  char *error = NULL;
  int result = sandbox_init(profile, 0, &error);
  if (error) sandbox_free_error(error);
  memset(profile, 0, sizeof(profile));
  if (result) return 76;
  uint32_t ready[4] = {0x4a49474d, (uint32_t)getpid(), 0, 0};
  memcpy(&ready[2], unique + 32, sizeof(uint32_t));
  if (write(5, ready, sizeof(ready)) != sizeof(ready)) return 77;
  close(5);
  char permission = 0;
  if (receive(4, &permission, 1, deadline) || permission != 'A') return 78;
  close(4);
  // All private handoffs are closed before the first untrusted instruction.
  execve(argv[5], argv + 5, environ);
  return 79;
}
static int launch(char **argv) {
  int (*registered)(posix_spawnattr_t *, mach_port_t *, uint32_t) =
      dlsym(RTLD_DEFAULT, "posix_spawnattr_set_registered_ports_np");
  if (!registered) return 80;
  posix_spawnattr_t attributes;
  posix_spawn_file_actions_t files;
  if (posix_spawnattr_init(&attributes)) return 81;
  if (posix_spawn_file_actions_init(&files)) {
    posix_spawnattr_destroy(&attributes);
    return 82;
  }
  int result = 83;
  mach_port_t ports[3] = {MACH_PORT_NULL, MACH_PORT_NULL, MACH_PORT_NULL};
  if (registered(&attributes, ports, 3) ||
      (!strcmp(argv[4], "closed") && posix_spawnattr_setspecialport_np(
          &attributes, MACH_PORT_NULL, TASK_BOOTSTRAP_PORT)) ||
      // EXC_MASK_ALL omits crash and corpse notifications in this SDK.
      posix_spawnattr_setexceptionports_np(&attributes,
          EXC_MASK_ALL | EXC_MASK_CRASH | EXC_MASK_CORPSE_NOTIFY,
          MACH_PORT_NULL, EXCEPTION_DEFAULT, THREAD_STATE_NONE) ||
      posix_spawnattr_setflags(&attributes, POSIX_SPAWN_CLOEXEC_DEFAULT)) goto done;
  // dup2(fd, fd) explicitly preserves only these six descriptors.
  for (int fd = 0; fd <= 5; fd++)
    if (fcntl(fd, F_GETFD) < 0 || posix_spawn_file_actions_adddup2(&files, fd, fd)) goto done;
  char executable[4096];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size)) goto done;
  argv[1] = "--entry";
  pid_t child;
  result = posix_spawn(&child, executable, &files, &attributes, argv, environ);
  if (result) { result = 84; goto done; }
  // Only the pre-exec child retains the profile and continuation. The trusted
  // parent retains FD 5 to report waitpid evidence after the child closes it.
  close(3);
  close(4);
  int status;
  while (waitpid(child, &status, 0) < 0) {
    if (errno == EINTR) continue;
    result = 85;
    goto done;
  }
  if (!WIFEXITED(status) && !WIFSIGNALED(status)) { result = 86; goto done; }
  uint32_t terminal[4] = {0x4a494758, (uint32_t)child,
      WIFEXITED(status) ? (uint32_t)WEXITSTATUS(status) : UINT32_MAX,
      WIFSIGNALED(status) ? (uint32_t)WTERMSIG(status) : 0};
  // Report the child's actual termination; do not manufacture a second crash
  // by raising its signal in the trusted parent.
  result = write(5, terminal, sizeof(terminal)) == sizeof(terminal) ? 0 : 87;
  close(5);
done:
  posix_spawn_file_actions_destroy(&files);
  posix_spawnattr_destroy(&attributes);
  return result;
}
int main(int argc, char **argv) {
  struct rlimit core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &core)) return 64;
  if (getuid() == 0 || getuid() != geteuid() || getgid() != getegid()) return 65;
  if (argc < 6 || argv[3][0] != '/' || argv[5][0] != '/' ||
      (strcmp(argv[4], "closed") && strcmp(argv[4], "dns"))) return 66;
  char *end;
  errno = 0;
  unsigned long length = strtoul(argv[2], &end, 10);
  if (errno || !argv[2][0] || *end || length == 0 || length > 32768) return 67;
  if (!strcmp(argv[1], "--launch")) return launch(argv);
  // A refused child has already lost inherited Mach services. Do not run C
  // library teardown against that deliberately closed bootstrap context.
  if (!strcmp(argv[1], "--entry")) _exit(enter(argv, length));
  return 68;
}
