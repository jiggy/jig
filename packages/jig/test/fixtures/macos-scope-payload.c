// Bounded supervision fixture: at most two descendants, 12 MiB, 400 ms CPU.
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
static double cpu(void) { struct timespec t; clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &t); return t.tv_sec + t.tv_nsec / 1e9; }
int main(int argc, char **argv) {
  alarm(10);
  if (argc == 4 && !strcmp(argv[1], "file-only")) {
    char cwd[4096];
    if (!getcwd(cwd, sizeof(cwd)) || strcmp(cwd, "/")) return 10;
    int readable = open(argv[0], O_RDONLY);
    if (readable < 0) return 11;
    close(readable);
    int write_attempt = open(argv[2], O_CREAT | O_EXCL | O_WRONLY, 0600);
    if (write_attempt >= 0) { close(write_attempt); return 12; }
    if (errno != EACCES && errno != EPERM) return 13;
    int control_attempt = open(argv[3], O_RDONLY);
    if (control_attempt >= 0) { close(control_attempt); return 14; }
    if (errno != EACCES && errno != EPERM) return 15;
    return write(STDOUT_FILENO, "file-only-sandbox-proved\n", 25) == 25 ? 0 : 16;
  }
  if (argc != 3) return 1;
  int marker = open(argv[2], O_CREAT | O_EXCL | O_WRONLY, 0600);
  if (marker < 0) return 2;
  close(marker);
  if (!strcmp(argv[1], "echo")) {
    char bytes[4096];ssize_t n=read(STDIN_FILENO,bytes,sizeof(bytes));
    if(n<=0||write(STDOUT_FILENO,bytes,(size_t)n)!=n)return 6;
    if(write(STDERR_FILENO,"native-stderr\n",14)!=14)return 7;
    return 0;
  }
  if (!strcmp(argv[1], "flood")) {
    char bytes[4096];memset(bytes,'x',sizeof(bytes));
    for(int i=0;i<512;i++)if(write(STDOUT_FILENO,bytes,sizeof(bytes))<0)return 5;
    sleep(3);return 0;
  }
  if (!strcmp(argv[1], "cpu")) {
    double start = cpu();volatile unsigned long long v=1;
    while(cpu()-start < .4) for(int i=0;i<10000;i++) v=v*6364136223846793005ULL+1;
    return 0;
  }
  if (!strcmp(argv[1], "memory")) {
    size_t size=12*1024*1024;volatile char *bytes=malloc(size);if(!bytes)return 3;
    for(size_t i=0;i<size;i+=4096)bytes[i]=1;
    usleep(300000);free((void*)bytes);return 0;
  }
  if (!strcmp(argv[1], "processes") || !strcmp(argv[1], "orphan") || !strcmp(argv[1], "recovery")) {
    int children=!strcmp(argv[1], "orphan")?1:2;
    for(int i=0;i<children;i++){pid_t p=fork();if(p<0)return 4;if(!p){alarm(9);setsid();sleep(!strcmp(argv[1], "recovery")?8:3);_exit(0);}}
    if(children==1)return 0;
  }
  if (!strcmp(argv[1], "crash")) raise(SIGABRT);
  sleep(!strcmp(argv[1], "recovery")?8:3);return 0;
}
