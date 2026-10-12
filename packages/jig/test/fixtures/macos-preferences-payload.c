#include <CoreFoundation/CoreFoundation.h>
#include <errno.h>
#include <fcntl.h>
#include <mach/mach.h>
#include <servers/bootstrap.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/sysctl.h>
#include <unistd.h>

static CFStringRef string(const char *text) {
  return CFStringCreateWithBytes(NULL, (const UInt8 *)text, strlen(text), kCFStringEncodingUTF8, false);
}
int main(int argc, char **argv) {
  if (argc != 6) return 1;
  CFStringRef domain = string("com.openai.codex"), key = string(argv[1]);
  CFStringRef other = string(argv[2]), canary = string(argv[3]);
  CFStringRef domains[] = {domain, other, kCFPreferencesAnyApplication};
  char unrelatedShm[32];
  snprintf(unrelatedShm, sizeof(unrelatedShm), "jig.%.16s", argv[3] + 12);
  if (!strcmp(argv[4], "absent") || !strcmp(argv[4], "seed") || !strcmp(argv[4], "cleanup") || !strcmp(argv[4], "verify")) {
    for (int i = 0; i < 3; i++) {
      CFPropertyListRef current = CFPreferencesCopyValue(canary, domains[i], kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
      if (!strcmp(argv[4], "absent")) { if (current) return 3; }
      else if (!strcmp(argv[4], "verify")) { if (!current || !CFEqual(current, CFSTR("owned-initial-canary"))) return 5; }
      else {
        CFPreferencesSetValue(canary, !strcmp(argv[4], "seed") ? CFSTR("owned-initial-canary") : NULL,
                              domains[i], kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        if (!CFPreferencesSynchronize(domains[i], kCFPreferencesCurrentUser, kCFPreferencesAnyHost)) return 4;
      }
      if (current) CFRelease(current);
    }
    if (!strcmp(argv[4], "seed")) {
      int fd = shm_open(unrelatedShm, O_CREAT | O_EXCL | O_RDWR, 0600);
      if (fd < 0 || ftruncate(fd, 64)) return 7;
      close(fd);
    } else if (!strcmp(argv[4], "cleanup")) {
      if (shm_unlink(unrelatedShm) && errno != ENOENT) return 8;
    } else {
      int fd = shm_open(unrelatedShm, O_RDONLY, 0);
      if ((!strcmp(argv[4], "absent") && fd >= 0) || (!strcmp(argv[4], "verify") && fd < 0)) return 9;
      if (fd >= 0) close(fd);
    }
    return 0;
  }
  if (!strcmp(argv[4], "host")) {
    CFPropertyListRef value = CFPreferencesCopyAppValue(key, domain);
    if (!value) return 2;
    CFRelease(value);
    return 0;
  }
  if (strcmp(argv[4], "payload")) return 6;
  for (int fd = 3; fd <= 5; fd++) if (fcntl(fd, F_GETFD) != -1 || errno != EBADF) return 40;
  if (fcntl(200, F_GETFD) != -1 || errno != EBADF) return 41;
  mach_port_array_t inherited = NULL;
  mach_msg_type_number_t count = 0;
  if (mach_ports_lookup(mach_task_self(), &inherited, &count) != KERN_SUCCESS) return 42;
  for (unsigned i = 0; i < count; i++) if (inherited[i] != MACH_PORT_NULL) return 43;
  if (inherited) vm_deallocate(mach_task_self(), (vm_address_t)inherited, count * sizeof(*inherited));
  exception_mask_t masks[EXC_TYPES_COUNT]; mach_port_t handlers[EXC_TYPES_COUNT];
  exception_behavior_t behaviors[EXC_TYPES_COUNT]; thread_state_flavor_t flavors[EXC_TYPES_COUNT];
  count = EXC_TYPES_COUNT;
  if (task_get_exception_ports(mach_task_self(), EXC_MASK_ALL | EXC_MASK_CRASH | EXC_MASK_CORPSE_NOTIFY,
      masks, &count, handlers, behaviors, flavors) != KERN_SUCCESS) return 44;
  for (unsigned i = 0; i < count; i++) if (handlers[i] != MACH_PORT_NULL) return 45;
  char data[131072]; size_t length = sizeof(data);
  int mib[3] = {CTL_KERN, KERN_PROCARGS2, atoi(argv[5])};
  if (sysctl(mib, 3, data, &length, NULL, 0) != -1 || errno != EPERM) return 46;
  // Existing populated host preferences supply an independent positive control.
  if (CFPreferencesCopyAppValue(key, domain)) return 10;
  for (CFIndex i = 0; i < 3; i++) {
    CFStringRef selected = domains[i];
    if (CFPreferencesCopyValue(key, selected, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)) return 11;
    CFArrayRef keys = CFPreferencesCopyKeyList(selected, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    if (keys && CFArrayGetCount(keys)) return 12;
    if (keys) CFRelease(keys);
    CFPreferencesSetAppValue(canary, CFSTR("owned-synthetic-value"), selected);
    (void)CFPreferencesAppSynchronize(selected);
    CFPreferencesSetAppValue(canary, NULL, selected);
    (void)CFPreferencesAppSynchronize(selected);
  }
  char uidName[128];
  snprintf(uidName, sizeof(uidName), "apple.cfprefs.%uv1", getuid());
  const char *names[] = {"apple.cfprefs.daemonv1", uidName};
  for (int i = 0; i < 2; i++) {
    int fd = shm_open(names[i], O_RDONLY, 0);
    if (fd < 0) return 20;
    void *page = mmap(NULL, 16384, PROT_READ, MAP_SHARED, fd, 0);
    if (page == MAP_FAILED) return 21;
    munmap(page, 16384);
    if (mmap(NULL, 16384, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0) != MAP_FAILED) return 22;
    close(fd);
    fd = shm_open(names[i], O_RDWR, 0);
    if (fd >= 0) return 23;
  }
  if (shm_open(unrelatedShm, O_RDONLY, 0) >= 0) return 24;
  mach_port_t service = MACH_PORT_NULL;
  if (bootstrap_look_up(bootstrap_port, "com.apple.cfprefsd.agent", &service) != KERN_SUCCESS) return 30;
  mach_port_deallocate(mach_task_self(), service);
  const char *denied[] = {"com.apple.SystemConfiguration.DNSConfiguration", "com.apple.system.logger", "com.apple.notifyd", "com.apple.securityd"};
  for (int i = 0; i < 4; i++) {
    if (bootstrap_look_up(bootstrap_port, denied[i], &service) == KERN_SUCCESS) return 31;
  }
  puts("preference values and writes denied; notification reads only");
  return 0;
}
