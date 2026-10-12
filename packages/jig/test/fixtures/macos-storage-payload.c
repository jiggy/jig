// Finite storage fixture: one detached child, at most 32 bytes, ten-second alarm.
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  alarm(10);
  if (argc != 4) return 1;
  int denied = open(argv[3], O_RDONLY);
  if (denied >= 0 || errno != EPERM) return 2;
  int output = open(argv[2], O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (output < 0 || write(output, "captured-output", 15) != 15) return 3;
  if (close(output)) return 4;
  pid_t child = fork();
  if (child < 0) return 5;
  if (!child) {
    alarm(8);
    if (setsid() < 0) _exit(6);
    sleep(3);
    int file = open(argv[2], O_WRONLY | O_APPEND);
    if (file >= 0) { (void)write(file, "late", 4); close(file); }
    _exit(0);
  }
  if (!strcmp(argv[1], "waiting")) sleep(6);
  return 0;
}
