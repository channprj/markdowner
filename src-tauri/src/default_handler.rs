//! Default-app registration for Markdown files. macOS resolves `.md` to the
//! system-declared `net.daringfireball.markdown` UTI; we query and set the
//! handler through NSWorkspace (the supported replacement for the deprecated
//! Launch Services C API). Other platforms report `supported: false` so the
//! frontend hides the affordances.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultMdHandlerStatus {
    pub supported: bool,
    pub is_default: bool,
    pub current_handler_path: Option<String>,
}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSBundle, NSError, NSString, NSURL};
    use objc2_uniform_type_identifiers::UTType;

    use super::DefaultMdHandlerStatus;

    /// `.md` resolves to the system-declared markdown UTI; deriving it from
    /// the extension avoids hardcoding `net.daringfireball.markdown`.
    fn markdown_uttype() -> Result<Retained<UTType>, String> {
        UTType::typeWithFilenameExtension(&NSString::from_str("md"))
            .ok_or_else(|| "macOS could not resolve a UTI for .md files".to_string())
    }

    fn url_path(url: &NSURL) -> Option<String> {
        url.path().map(|path| path.to_string())
    }

    fn current_bundle_path() -> Option<String> {
        let bundle = NSBundle::mainBundle();
        bundle.bundleURL().path().map(|path| path.to_string())
    }

    pub fn status() -> Result<DefaultMdHandlerStatus, String> {
        let uttype = markdown_uttype()?;
        let workspace = NSWorkspace::sharedWorkspace();
        let handler = workspace.URLForApplicationToOpenContentType(&uttype);
        let current_handler_path = handler.as_deref().and_then(url_path);
        // Compare bundle paths rather than bundle IDs so a stray debug copy
        // registered under the same ID never reads as "already default".
        let is_default = match (&current_handler_path, current_bundle_path()) {
            (Some(handler_path), Some(bundle_path)) => *handler_path == bundle_path,
            _ => false,
        };
        Ok(DefaultMdHandlerStatus {
            supported: true,
            is_default,
            current_handler_path,
        })
    }

    pub fn set_default() -> Result<(), String> {
        let uttype = markdown_uttype()?;
        let bundle_url = NSBundle::mainBundle().bundleURL();
        let workspace = NSWorkspace::sharedWorkspace();

        // The AppKit call is asynchronous; bridge its completion handler back
        // into this command thread so the frontend gets a real success/error.
        let (sender, receiver) = mpsc::channel::<Option<String>>();
        let completion = RcBlock::new(move |error: *mut NSError| {
            let message = if error.is_null() {
                None
            } else {
                Some(unsafe { (*error).localizedDescription() }.to_string())
            };
            let _ = sender.send(message);
        });

        workspace.setDefaultApplicationAtURL_toOpenContentType_completionHandler(
            &bundle_url,
            &uttype,
            Some(&completion),
        );

        match receiver.recv_timeout(Duration::from_secs(10)) {
            Ok(None) => Ok(()),
            Ok(Some(message)) => Err(format!(
                "macOS rejected the default-app change: {message}"
            )),
            Err(_) => Err(
                "Timed out waiting for macOS to confirm the default-app change".to_string(),
            ),
        }
    }
}

#[tauri::command]
pub fn default_md_handler_status() -> Result<DefaultMdHandlerStatus, String> {
    #[cfg(target_os = "macos")]
    {
        macos::status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(DefaultMdHandlerStatus {
            supported: false,
            is_default: false,
            current_handler_path: None,
        })
    }
}

#[tauri::command]
pub fn set_default_md_handler() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::set_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Setting the default Markdown app is only supported on macOS".to_string())
    }
}
