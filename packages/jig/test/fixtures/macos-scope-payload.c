// Bounded supervision fixture: at most two descendants, 12 MiB, 400 ms CPU.
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
  if (argc != 3) return 1;
  int marker = open(argv[2], O_CREAT | O_EXCL | O_WRONLY, 0600);
  if (marker < 0) return 2;
  close(marker);
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
