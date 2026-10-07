// Trusted, value-free observation. This helper never changes operator policy.
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
#include <unistd.h>

int main(int argc, char **argv) {
  (void)argv;
  struct rlimit core = {0, 0};
  if (argc != 1 || setrlimit(RLIMIT_CORE, &core) || getuid() == 0 ||
      getuid() != geteuid() || getgid() != getegid()) return 70;
  // This deadline survives loss of the coordinator and precedes every CF call.
  struct sigaction action = {.sa_handler = SIG_DFL};
  sigset_t alarm_set;
  if (sigemptyset(&action.sa_mask) || sigaction(SIGALRM, &action, NULL) ||
      sigemptyset(&alarm_set) || sigaddset(&alarm_set, SIGALRM) ||
      sigprocmask(SIG_UNBLOCK, &alarm_set, NULL)) return 70;
  alarm(4);
  // process.arch in a Rosetta parent is not hardware qualification. A universal
  // helper can also be launched as native arm64 by that translated parent.
#if !defined(__x86_64__)
  return 70;
#else
  int translated = -1;
  size_t translated_size = sizeof(translated);
  if (sysctlbyname("sysctl.proc_translated", &translated, &translated_size, NULL, 0)) {
    if (errno != ENOENT) return 70;
  } else if (translated_size != sizeof(translated) || translated != 0) return 70;
#endif
  // CF can represent a sandbox-denied lookup as absence even when sync succeeds.
  // An inherited caller sandbox therefore cannot establish policy absence.
  int (*check)(pid_t, const char *, int, ...) = dlsym(RTLD_DEFAULT, "sandbox_check");
  if (!check || check(getpid(), NULL, 0) != 0) return 70;
  @autoreleasepool {
    NSString *domain = @"com.openai.codex";
    if (!CFPreferencesAppSynchronize((__bridge CFStringRef)domain)) return 70;
    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:domain];
    NSDictionary *values = [preferences dictionaryRepresentation];
    if (preferences == nil || values == nil || [values count] > 4096) return 70;
    // Native Codex's two managed inputs are checked even when enumeration is
    // empty. The public suite search list also catches future forced keys.
    for (NSString *key in @[@"config_toml_base64", @"requirements_toml_base64"]) {
      if (CFPreferencesAppValueIsForced((__bridge CFStringRef)key,
                                       (__bridge CFStringRef)domain)) return 71;
    }
    for (NSString *key in values) {
      if (![key isKindOfClass:[NSString class]]) return 70;
      if ([preferences objectIsForcedForKey:key inDomain:domain]) return 71;
    }
    if (!CFPreferencesAppSynchronize((__bridge CFStringRef)domain)) return 70;
    return 0;
  }
}
