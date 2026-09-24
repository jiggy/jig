// Finite native fixture: no loops, descendants, credentials or external effects.
#include <errno.h>
#include <fcntl.h>
#include <mach/mach.h>
#include <stdio.h>
#include <signal.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc == 2 && !strcmp(argv[1], "--inherited-control")) {
    char value[23] = {0};
    return read(200, value, 23) == 23 && !memcmp(value, "synthetic-private-value", 23) ? 0 : 10;
  }
  if (argc == 2 && !strcmp(argv[1], "--crash-control")) { raise(SIGABRT); return 11; }
  if (argc != 3) return 1;
  for (int fd = 3; fd <= 5; fd++)
    if (fcntl(fd, F_GETFD) != -1 || errno != EBADF) return 2;
  if (fcntl(200, F_GETFD) != -1 || errno != EBADF) return 3;
  mach_port_array_t ports = NULL;
  mach_msg_type_number_t count = 0;
  if (mach_ports_lookup(mach_task_self(), &ports, &count) != KERN_SUCCESS) return 4;
  for (unsigned i = 0; i < count; i++) if (ports[i] != MACH_PORT_NULL) return 5;
  if (ports) vm_deallocate(mach_task_self(), (vm_address_t)ports, count * sizeof(*ports));
  mach_port_t bootstrap = MACH_PORT_NULL;
  if (task_get_special_port(mach_task_self(), TASK_BOOTSTRAP_PORT, &bootstrap) != KERN_SUCCESS ||
      bootstrap != MACH_PORT_NULL) return 6;
  exception_mask_t masks[EXC_TYPES_COUNT];
  mach_port_t handlers[EXC_TYPES_COUNT];
  exception_behavior_t behaviors[EXC_TYPES_COUNT];
  thread_state_flavor_t flavors[EXC_TYPES_COUNT];
  count = EXC_TYPES_COUNT;
  if (task_get_exception_ports(mach_task_self(),
      EXC_MASK_ALL | EXC_MASK_CRASH | EXC_MASK_CORPSE_NOTIFY,
      masks, &count, handlers, behaviors, flavors) != KERN_SUCCESS) return 12;
  for (unsigned i = 0; i < count; i++) if (handlers[i] != MACH_PORT_NULL) return 13;
  int forbidden = open(argv[2], O_RDONLY);
  if (forbidden >= 0) { close(forbidden); return 7; }
  int marker = open(argv[1], O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (marker < 0) return 8;
  int wrote = write(marker, "executed", 8) == 8;
  close(marker);
  if (!wrote) return 9;
  puts("native boundary passed");
  return 0;
}
