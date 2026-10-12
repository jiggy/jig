// Synthetic read results only. No preference-setting API is called here.
#import <Foundation/Foundation.h>
#include <libproc.h>
#include <objc/runtime.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <unistd.h>

static const char *mode(void) {
  const char *value = getenv("JIG_OBSERVER_FIXTURE_MODE");
  return value ? value : "invalid";
}

static Boolean synchronize(CFStringRef domain) {
  static unsigned count;
  if (!CFEqual(domain, CFSTR("com.openai.codex"))) return true;
  count++;
  if (!strcmp(mode(), "sync-fail")) return false;
  if (!strcmp(mode(), "sync-final-fail")) return count == 1;
  if (!strcmp(mode(), "block")) {
    // The owner deliberately passes SIG_IGN and a blocked SIGALRM through exec.
    // Readiness requires the actual observer to restore, unblock and arm it.
    struct sigaction action;
    sigset_t blocked;
    struct itimerval timer;
    if (sigaction(SIGALRM, NULL, &action) || action.sa_handler != SIG_DFL ||
        sigprocmask(SIG_SETMASK, NULL, &blocked) || sigismember(&blocked, SIGALRM) ||
        getitimer(ITIMER_REAL, &timer) ||
        (timer.it_value.tv_sec == 0 && timer.it_value.tv_usec == 0) ||
        timer.it_value.tv_sec > 4) return false;
    unsigned char unique[56] = {0};
    if (proc_pidinfo(getpid(), 17, 0, unique, (int)sizeof(unique)) != (int)sizeof(unique)) return false;
    uint32_t frame[4] = {0x4a4f424c, (uint32_t)getpid(), 0, (uint32_t)getppid()};
    memcpy(&frame[2], unique + 32, sizeof(uint32_t));
    if (write(3, frame, sizeof(frame)) != sizeof(frame)) return false;
    close(3);
    for (;;) pause();
  }
  return true;
}

static Boolean forced(CFStringRef key, CFStringRef domain) {
  if (!CFEqual(domain, CFSTR("com.openai.codex"))) return false;
  return (!strcmp(mode(), "forced-config") && CFEqual(key, CFSTR("config_toml_base64"))) ||
         (!strcmp(mode(), "forced-requirements") && CFEqual(key, CFSTR("requirements_toml_base64")));
}

__attribute__((used)) static const struct {
  const void *replacement;
  const void *original;
} interposed[] __attribute__((section("__DATA,__interpose"))) = {
  {(const void *)synchronize, (const void *)CFPreferencesAppSynchronize},
  {(const void *)forced, (const void *)CFPreferencesAppValueIsForced},
};

static NSDictionary *dictionary(id self, SEL selector) {
  (void)self;
  (void)selector;
  return !strcmp(mode(), "future-forced")
      ? @{@"jig.synthetic.future-forced-key": @"owned-synthetic-value"}
      : @{};
}

static BOOL forcedInDomain(id self, SEL selector, NSString *key, NSString *domain) {
  (void)self;
  (void)selector;
  return !strcmp(mode(), "future-forced") && [domain isEqualToString:@"com.openai.codex"] &&
         [key isEqualToString:@"jig.synthetic.future-forced-key"];
}

@interface JigSyntheticPreferencesObserver : NSObject
@end
@implementation JigSyntheticPreferencesObserver
+ (void)load {
  Method values = class_getInstanceMethod([NSUserDefaults class], @selector(dictionaryRepresentation));
  Method managed = class_getInstanceMethod([NSUserDefaults class], @selector(objectIsForcedForKey:inDomain:));
  if (!values || !managed) _exit(79);
  method_setImplementation(values, (IMP)dictionary);
  method_setImplementation(managed, (IMP)forcedInDomain);
}
@end
