#import <Foundation/Foundation.h>
#include <string.h>
#include <unistd.h>

// Independent, unprivileged real-framework reader. Never prints preference values.
int main(int argc, char **argv) {
  if (argc != 4 || getuid() == 0 || getuid() != geteuid()) return 70;
  alarm(4);
  @autoreleasepool {
    CFStringRef domain = CFSTR("com.openai.codex");
    if (!CFPreferencesAppSynchronize(domain)) return 70;
    NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:@"com.openai.codex"];
    if (!defaults) return 70;
    const char *names[] = {"config_toml_base64", "requirements_toml_base64"};
    for (int i = 0; i < 2; i++) {
      NSString *key = [NSString stringWithUTF8String:names[i]];
      Boolean cfForced = CFPreferencesAppValueIsForced((__bridge CFStringRef)key, domain);
      BOOL nsForced = [defaults objectIsForcedForKey:key inDomain:@"com.openai.codex"];
      CFPropertyListRef value = CFPreferencesCopyAppValue((__bridge CFStringRef)key, domain);
      BOOL selected = !strcmp(argv[1], "forced") && !strcmp(argv[2], names[i]);
      if (selected) {
        NSString *expected = [NSString stringWithUTF8String:argv[3]];
        if (!cfForced || !nsForced || !value || CFGetTypeID(value) != CFStringGetTypeID() ||
            !CFEqual(value, (__bridge CFStringRef)expected)) return 1;
      } else if (cfForced || nsForced || value) return 2;
      if (value) CFRelease(value);
    }
    if (strcmp(argv[1], "absent") && strcmp(argv[1], "forced")) return 70;
    return 0;
  }
}
