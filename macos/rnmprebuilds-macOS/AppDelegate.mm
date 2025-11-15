#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#import <React/RCTReloadCommand.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"rnmprebuilds";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  
  /// Apple Events are processed without app focus, but require TCC permissions. Trigger as follows:
  /// ```sh
  /// osascript -e '
  /// tell application "Electron"
  ///     «event MYEVCMD1» "payload text"
  /// end tell
  /// '
  /// ```
  [[NSAppleEventManager sharedAppleEventManager]
      setEventHandler:self
           andSelector:@selector(handleEvent:withReplyEvent:)
        forEventClass:'MYEV'
           andEventID:'CMD1'];
  
  /// DistributedNotifications require app focus to be processed, but don't require TCC permissions. Trigger as follows:
  /// ```sh
  /// swift -e 'import Foundation; DistributedNotificationCenter.default.post(name: Notification.Name("com.example.MyCommand"), object: nil, userInfo: ["action":"test"])'
  /// ```
  [[NSDistributedNotificationCenter defaultCenter]
      addObserverForName:@"com.example.MyCommand"
                  object:nil
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(NSNotification * _Nonnull notification) {
      
      NSDictionary *userInfo = notification.userInfo;
      if (!userInfo) {
          userInfo = @{};
      }
    
      NSLog(@"Received notification: %@", userInfo);
      RCTTriggerReloadCommandListeners(@"programmatic reload");
  }];
  
  return [super applicationDidFinishLaunching:notification];
}

- (void)handleEvent:(NSAppleEventDescriptor *)event
    withReplyEvent:(NSAppleEventDescriptor *)replyEvent
{
    NSAppleEventDescriptor *param = [event paramDescriptorForKeyword:keyDirectObject];

    NSString *payload = nil;
    if (param && param.descriptorType == typeUTF8Text) {
        payload = param.stringValue;
    }

    NSLog(@"Received custom Apple Event: class='MYEV' id='CMD1' payload='%@'", payload);
  
    if (replyEvent) {
        NSAppleEventDescriptor *replyString =
            [NSAppleEventDescriptor descriptorWithString:@"Message received! Reloading..."];
        [replyEvent setDescriptor:replyString forKeyword:keyDirectObject];
    }
  
    RCTTriggerReloadCommandListeners(@"programmatic reload");
}


- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
