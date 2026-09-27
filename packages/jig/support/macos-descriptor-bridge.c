#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

// Capture errno before returning through the FFI/runtime boundary. Darwin ARM64
// also requires the SDK compiler to hand off variadic libc arguments.
static int checked(int result) { return result < 0 ? -errno : result; }
int jig_openat(int directory, const char *name, int flags, unsigned int mode) {
  return checked(openat(directory, name, flags, (mode_t)mode));
}
int jig_fcntl(int descriptor, int command, uint64_t argument) {
  return checked(fcntl(descriptor, command, argument));
}
int jig_fstatat(int directory, const char *name, struct stat *buffer, int flags) {
  return checked(fstatat(directory, name, buffer, flags));
}
int jig_fstatfs(int descriptor, struct statfs *buffer) {
  return checked(fstatfs(descriptor, buffer));
}
DIR *jig_fdopendir(int descriptor, int *error) {
  DIR *result = fdopendir(descriptor);
  *error = result ? 0 : errno;
  return result;
}
struct dirent *jig_readdir(DIR *directory, int *error) {
  errno = 0;
  struct dirent *result = readdir(directory);
  *error = result ? 0 : errno;
  return result;
}
int jig_closedir(DIR *directory) { return checked(closedir(directory)); }
int jig_mkdirat(int directory, const char *name, unsigned int mode) {
  return checked(mkdirat(directory, name, (mode_t)mode));
}
int jig_unlinkat(int directory, const char *name, int flags) {
  return checked(unlinkat(directory, name, flags));
}
int jig_renameatx_np(int source, const char *old, int target, const char *next, unsigned int flags) {
  return checked(renameatx_np(source, old, target, next, flags));
}
int64_t jig_readlinkat(int directory, const char *name, char *buffer, uint64_t size) {
  ssize_t result = readlinkat(directory, name, buffer, (size_t)size);
  return result < 0 ? -errno : result;
}
int jig_linkat(int source, const char *old, int target, const char *next, int flags) {
  return checked(linkat(source, old, target, next, flags));
}
int jig_symlinkat(const char *value, int directory, const char *name) {
  return checked(symlinkat(value, directory, name));
}
