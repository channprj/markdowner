#import <Foundation/Foundation.h>
#import <QuickLookUI/QuickLookUI.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

extern char *markdowner_quicklook_render(const char *path);
extern void markdowner_quicklook_free(char *ptr);
extern void NSExtensionMain(int argc, char *argv[]);

@interface MarkdownerQuickLook : QLPreviewProvider <QLPreviewingController>
@end

@implementation MarkdownerQuickLook

- (void)providePreviewForFileRequest:(QLFilePreviewRequest *)request
                   completionHandler:(void (^)(QLPreviewReply *_Nullable reply, NSError *_Nullable error))handler {
    NSURL *fileURL = request.fileURL;
    const char *path = fileURL.fileSystemRepresentation;
    if (path == NULL) {
        handler(nil, [NSError errorWithDomain:@"dev.chann.markdowner.quicklook"
                                         code:1
                                     userInfo:@{NSLocalizedDescriptionKey: @"The preview request has no file path."}]);
        return;
    }

    // Quick Look hands the extension a security-scoped URL. Reading has to
    // happen before that access is dropped.
    BOOL scoped = [fileURL startAccessingSecurityScopedResource];
    char *rendered = markdowner_quicklook_render(path);
    if (scoped) {
        [fileURL stopAccessingSecurityScopedResource];
    }
    if (rendered == NULL) {
        handler(nil, [NSError errorWithDomain:@"dev.chann.markdowner.quicklook"
                                         code:2
                                     userInfo:@{NSLocalizedDescriptionKey: @"Markdowner could not read this file."}]);
        return;
    }

    NSString *html = [[NSString alloc] initWithUTF8String:rendered];
    markdowner_quicklook_free(rendered);
    NSData *data = [html dataUsingEncoding:NSUTF8StringEncoding];
    if (data == nil) {
        handler(nil, [NSError errorWithDomain:@"dev.chann.markdowner.quicklook"
                                         code:3
                                     userInfo:@{NSLocalizedDescriptionKey: @"Markdowner could not encode the preview."}]);
        return;
    }

    QLPreviewReply *reply = [[QLPreviewReply alloc] initWithDataOfContentType:UTTypeHTML
                                                                   contentSize:CGSizeMake(760, 980)
                                                            dataCreationBlock:^NSData *_Nullable(QLPreviewReply *_Nonnull replyToUpdate, NSError *__autoreleasing _Nullable *_Nullable error) {
        (void)replyToUpdate;
        (void)error;
        return data;
    }];
    handler(reply, nil);
}

@end

int main(int argc, char *argv[]) {
    @autoreleasepool {
        NSExtensionMain(argc, argv);
    }
    return 0;
}
