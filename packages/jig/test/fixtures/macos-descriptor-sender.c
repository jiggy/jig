#include <sys/socket.h>
#include <sys/un.h>
#include <sys/uio.h>
#include <sys/param.h>
#include <fcntl.h>
#include <libproc.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

_Static_assert(sizeof(struct msghdr) == 48, "msghdr ABI changed");
_Static_assert(offsetof(struct msghdr, msg_iov) == 16, "iov ABI changed");
_Static_assert(offsetof(struct msghdr, msg_iovlen) == 24, "iov count ABI changed");
_Static_assert(offsetof(struct msghdr, msg_control) == 32, "control ABI changed");
_Static_assert(offsetof(struct msghdr, msg_controllen) == 40, "control count ABI changed");
_Static_assert(offsetof(struct msghdr, msg_flags) == 44, "flags ABI changed");
_Static_assert(sizeof(struct iovec) == 16, "iovec ABI changed");
_Static_assert(sizeof(struct cmsghdr) == 12, "cmsghdr ABI changed");
_Static_assert(CMSG_SPACE(sizeof(int)) == 16, "cmsg alignment changed");
_Static_assert(sizeof(struct sockaddr_un) == 106, "sockaddr ABI changed");
_Static_assert(MCLBYTES == 2048, "control mbuf qualification changed");
_Static_assert(MSG_NOSIGNAL == 0x80000, "signal flag changed");

int main(int argc, char **argv) {
  alarm(5);
  if (argc != 4) return 10;
  const char *mode = argv[2];
  unsigned char identity[56] = {0};
  if (proc_pidinfo(getpid(), 17, 0, identity, sizeof(identity)) != sizeof(identity)) return 11;
  uint32_t version = 0;
  memcpy(&version, identity + 32, sizeof(version));
  printf("{\"pid\":%d,\"version\":%u}\n", getpid(), version);
  fflush(stdout);
  int input = open(argv[3], strcmp(mode, "writable") == 0 ? O_RDWR : O_RDONLY);
  int channel = socket(AF_UNIX, SOCK_STREAM, 0);
  if (input < 0 || channel < 0) return 12;
  struct sockaddr_un address = {0};
  address.sun_family = AF_UNIX;
  if (strlen(argv[1]) >= sizeof(address.sun_path)) return 13;
  strcpy(address.sun_path, argv[1]);
  address.sun_len = (unsigned char)(offsetof(struct sockaddr_un, sun_path) + strlen(argv[1]) + 1);
  if (connect(channel, (struct sockaddr *)&address, address.sun_len)) return 14;
  unsigned char body[9] = {'J','F','D','1',1,0,0,0,'X'};
  size_t count = strcmp(mode, "many") == 0 ? 65 : 1;
  unsigned char control[CMSG_SPACE(65 * sizeof(int))] = {0};
  struct cmsghdr *header = (struct cmsghdr *)(void *)control;
  header->cmsg_level = SOL_SOCKET;
  header->cmsg_type = SCM_RIGHTS;
  header->cmsg_len = CMSG_LEN(count * sizeof(int));
  for (size_t i = 0; i < count; i++) memcpy(CMSG_DATA(header) + i * sizeof(int), &input, sizeof(input));
  if (strcmp(mode, "magic") == 0) body[0] = 'X';
  if (strcmp(mode, "count") == 0) body[4] = 2;
  size_t length = strcmp(mode, "trailing") == 0 ? 9 : strcmp(mode, "short") == 0 ? 4 : strcmp(mode, "split") == 0 ? 2 : 8;
  struct iovec vector = {.iov_base = body, .iov_len = length};
  struct msghdr message = {.msg_iov = &vector, .msg_iovlen = 1, .msg_control = control, .msg_controllen = (socklen_t)CMSG_SPACE(count * sizeof(int))};
  if (sendmsg(channel, &message, MSG_NOSIGNAL) != (ssize_t)length) return 15;
  if (strcmp(mode, "split") == 0) {
    usleep(20000);
    if (send(channel, body + 2, 6, MSG_NOSIGNAL) != 6) return 16;
  }
  if (strcmp(mode, "stall") != 0 && shutdown(channel, SHUT_WR)) return 17;
  unsigned char ack = 0;
  ssize_t received = recv(channel, &ack, 1, 0);
  close(channel);
  close(input);
  int accepted = received == 1 && ack == 'A';
  int valid = strcmp(mode, "valid") == 0 || strcmp(mode, "split") == 0;
  return accepted == valid ? 0 : 18;
}
