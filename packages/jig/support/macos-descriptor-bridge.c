#include <fcntl.h>
#include <stdint.h>
#include <sys/types.h>

// Darwin ARM64 places variadic arguments on the stack. Bun FFI calls these
// fixed signatures; the SDK compiler performs the libc variadic handoff.
int jig_openat(int directory, const char *name, int flags, unsigned int mode) {
  return openat(directory, name, flags, (mode_t)mode);
}

int jig_fcntl(int descriptor, int command, uint64_t argument) {
  return fcntl(descriptor, command, argument);
}
