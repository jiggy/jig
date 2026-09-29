// Two finite writers attempt at most 24 MiB in a shared 16 MiB volume.
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
struct result { size_t bytes; int error; };
int main(int argc, char **argv) {
  if (argc != 3) return 1;
  alarm(8);
  errno = 0;
  int backing = open(argv[2], O_WRONLY);
  if (backing >= 0) { close(backing); return 2; }
  if (errno != EPERM && errno != EACCES) return 3;
  int pipes[2][2]; pid_t children[2];
  for (int i=0; i<2; i++) if (pipe(pipes[i])) return 4;
  for (int i=0; i<2; i++) {
    children[i]=fork(); if (children[i]<0) return 5;
    if (!children[i]) {
      alarm(5);
      for (int j=0; j<2; j++) { close(pipes[j][0]); if(j!=i)close(pipes[j][1]); }
      char path[1024]; snprintf(path,sizeof(path),"%s/writer-%d",argv[1],i);
      int fd=open(path,O_WRONLY|O_CREAT|O_EXCL,0600);
      struct result result={0,0};
      if (fd<0) result.error=errno;
      else {
        char block[65536]; memset(block,0x5a,sizeof(block));
        for (int j=0; j<192; j++) {
          ssize_t n=write(fd,block,sizeof(block));
          if(n<0) {result.error=errno;break;}
          result.bytes+=(size_t)n;
          if(n!=sizeof(block)){result.error=ENOSPC;break;}
        }
        if(fsync(fd) && !result.error) result.error=errno;
        close(fd);
      }
      int ok=write(pipes[i][1],&result,sizeof(result))==sizeof(result);
      close(pipes[i][1]); _exit(ok?0:6);
    }
  }
  size_t total=0; int full=0;
  for(int i=0;i<2;i++) {
    close(pipes[i][1]); struct result result={0,0};
    ssize_t n=read(pipes[i][0],&result,sizeof(result)); close(pipes[i][0]);
    int status=0; if(waitpid(children[i],&status,0)!=children[i] ||
      n!=sizeof(result) || !WIFEXITED(status) || WEXITSTATUS(status)) return 7;
    if(result.error && result.error!=ENOSPC) return 8;
    total+=result.bytes; full|=result.error==ENOSPC;
  }
  if(!full || total==0 || total>=16777216) return 9;
  printf("{\"backingDenied\":true,\"full\":true,\"reaped\":2,\"bytes\":%zu}\n",total);
  return 0;
}
