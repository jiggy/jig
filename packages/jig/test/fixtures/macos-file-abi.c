#include <dirent.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
_Static_assert(sizeof(struct stat) == 144, "stat ABI changed");
_Static_assert(F_GETPATH == 50, "descriptor path command changed");
_Static_assert(offsetof(struct stat, st_mode) == 4, "stat mode ABI changed");
_Static_assert(offsetof(struct stat, st_ino) == 8, "stat inode ABI changed");
_Static_assert(offsetof(struct stat, st_atimespec) == 32, "stat time ABI changed");
_Static_assert(offsetof(struct stat, st_size) == 96, "stat size ABI changed");
_Static_assert(offsetof(struct stat, st_blksize) == 112, "stat block ABI changed");
_Static_assert(offsetof(struct dirent, d_reclen) == 16, "dirent length ABI changed");
_Static_assert(offsetof(struct dirent, d_namlen) == 18, "dirent name length ABI changed");
_Static_assert(offsetof(struct dirent, d_type) == 20, "dirent type ABI changed");
_Static_assert(offsetof(struct dirent, d_name) == 21, "dirent name ABI changed");
int main(void) {
  struct stat s;
  if(fstatat(AT_FDCWD,".",&s,AT_SYMLINK_NOFOLLOW))return 1;
  int fd=open(".",O_RDONLY|O_DIRECTORY);if(fd<0)return 2;
  DIR *d=fdopendir(fd);if(!d){close(fd);return 2;}
  if(!readdir(d)){closedir(d);return 3;}
  closedir(d);
  puts("{\"statBytes\":144,\"directoryNameOffset\":21}");
  return 0;
}
