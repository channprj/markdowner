use std::path::Path;

pub fn write_pdf_file(
    path: &str,
    html: &str,
    paper_width_mm: f64,
    paper_height_mm: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::write_pdf_file(path, html, paper_width_mm, paper_height_mm)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, html, paper_width_mm, paper_height_mm);
        Err("PDF export is only supported on macOS".to_string())
    }
}

const MIN_PAPER_MM: f64 = 25.4;
const MAX_PAPER_MM: f64 = 2000.0;
const MAX_PAGES: usize = 100;

fn paper_points(width_mm: f64, height_mm: f64) -> Result<(f64, f64), String> {
    if !width_mm.is_finite() || !height_mm.is_finite() {
        return Err("PDF paper dimensions must be finite".to_string());
    }
    if !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&width_mm)
        || !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&height_mm)
    {
        return Err(format!(
            "PDF paper dimensions must be between {MIN_PAPER_MM} and {MAX_PAPER_MM} mm"
        ));
    }
    Ok((width_mm * 72.0 / 25.4, height_mm * 72.0 / 25.4))
}

fn pagination_probe_result(value: f64) -> Option<Result<f64, String>> {
    if value == 0.0 {
        return None;
    }
    if value == -1.0 {
        return Some(Err(
            "The embedded PDF pagination script reported an error".to_string()
        ));
    }
    if !value.is_finite() || value < 0.0 {
        return Some(Err(
            "The embedded PDF pagination script returned an invalid height".to_string(),
        ));
    }
    Some(Ok(value))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create export directory '{}': {error}",
                parent.display()
            )
        })?;
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum NavigationLoadState {
    Pending,
    Finished,
    Failed(String),
}

fn navigation_load_result(state: &NavigationLoadState) -> Option<Result<(), String>> {
    match state {
        NavigationLoadState::Pending => None,
        NavigationLoadState::Finished => Some(Ok(())),
        NavigationLoadState::Failed(message) => Some(Err(message.clone())),
    }
}

pub fn format_pdf_export_error(path: &str, error: &str) -> String {
    format!("Could not export '{path}' to PDF: {error}")
}

#[cfg(target_os = "macos")]
mod macos {
    use std::{
        cell::RefCell,
        path::Path,
        rc::Rc,
        time::{Duration, Instant},
    };

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::runtime::{NSObject, ProtocolObject};
    use objc2::{AnyThread, DefinedClass, MainThreadOnly, define_class, msg_send};
    use objc2_core_foundation::{CFRunLoop, CGPoint, CGRect, CGSize, kCFRunLoopDefaultMode};
    use objc2_foundation::{
        MainThreadMarker, NSData, NSError, NSNumber, NSObjectProtocol, NSString,
    };
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};
    use objc2_web_kit::{
        WKNavigation, WKNavigationDelegate, WKPDFConfiguration, WKWebView, WKWebViewConfiguration,
    };

    use super::{
        MAX_PAGES, NavigationLoadState, ensure_parent_dir, navigation_load_result,
        pagination_probe_result, paper_points,
    };

    const LOAD_TIMEOUT: Duration = Duration::from_secs(10);
    const JS_TIMEOUT: Duration = Duration::from_secs(10);
    const PDF_TIMEOUT: Duration = Duration::from_secs(20);
    type PdfDataSlot = Rc<RefCell<Option<Result<Retained<NSData>, String>>>>;
    const PAGINATION_PROBE_JS: &str = r#"(function () {
  if (window.__markdownerPdfPaginationStatus === "error") return -1;
  var result = window.__markdownerPdfPaginationResult;
  return result && Number.isFinite(result.totalHeight) ? result.totalHeight : 0;
})()"#;

    struct ExportNavigationDelegateIvars {
        state: Rc<RefCell<NavigationLoadState>>,
    }

    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = ExportNavigationDelegateIvars]
        struct ExportNavigationDelegate;

        unsafe impl NSObjectProtocol for ExportNavigationDelegate {}

        unsafe impl WKNavigationDelegate for ExportNavigationDelegate {
            #[unsafe(method(webView:didFinishNavigation:))]
            fn did_finish_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: Option<&WKNavigation>,
            ) {
                self.finish(NavigationLoadState::Finished);
            }

            #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
            fn did_fail_provisional_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: Option<&WKNavigation>,
                error: &NSError,
            ) {
                self.finish_with_error(error);
            }

            #[unsafe(method(webView:didFailNavigation:withError:))]
            fn did_fail_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: Option<&WKNavigation>,
                error: &NSError,
            ) {
                self.finish_with_error(error);
            }

            #[unsafe(method(webViewWebContentProcessDidTerminate:))]
            fn web_content_process_did_terminate(&self, _webview: &WKWebView) {
                self.finish(NavigationLoadState::Failed(
                    "WebKit content process terminated while loading export HTML".to_string(),
                ));
            }
        }
    );

    impl ExportNavigationDelegate {
        fn new(state: Rc<RefCell<NavigationLoadState>>, mtm: MainThreadMarker) -> Retained<Self> {
            let delegate = Self::alloc(mtm).set_ivars(ExportNavigationDelegateIvars { state });
            unsafe { msg_send![super(delegate), init] }
        }

        fn finish(&self, result: NavigationLoadState) {
            let mut state = self.ivars().state.borrow_mut();
            if matches!(*state, NavigationLoadState::Pending) {
                *state = result;
            }
        }

        fn finish_with_error(&self, error: &NSError) {
            let message = error.localizedDescription().to_string();
            self.finish(NavigationLoadState::Failed(format!(
                "WebKit could not load export HTML: {message}"
            )));
        }
    }

    fn tick_run_loop() {
        CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, 0.05, true);
    }

    pub(super) fn pdf_page_media_box(paper_width: f64, paper_height: f64) -> CGRect {
        CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: paper_width,
                height: paper_height,
            },
        }
    }

    fn wait_for_load(state: &Rc<RefCell<NavigationLoadState>>) -> Result<(), String> {
        let deadline = Instant::now() + LOAD_TIMEOUT;
        loop {
            let result = navigation_load_result(&state.borrow());
            if let Some(result) = result {
                result?;
                // Extra passes so layout settles and embedded image data URIs decode.
                tick_run_loop();
                tick_run_loop();
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("Timed out loading export HTML for PDF generation".to_string());
            }
            tick_run_loop();
        }
    }

    /// Evaluate JS that returns a number, pumping the run loop until it resolves.
    fn eval_js_number(webview: &WKWebView, script: &str) -> Result<f64, String> {
        let slot: Rc<RefCell<Option<Result<f64, String>>>> = Rc::new(RefCell::new(None));
        let sink = slot.clone();
        let completion = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            let result = if !error.is_null() {
                let message = unsafe { (*error).localizedDescription() }.to_string();
                Err(format!("JavaScript evaluation failed: {message}"))
            } else if value.is_null() {
                Err("JavaScript evaluation returned no value".to_string())
            } else {
                let number = unsafe { &*(value.cast::<NSNumber>()) };
                Ok(number.doubleValue())
            };
            *sink.borrow_mut() = Some(result);
        });
        let script = NSString::from_str(script);
        unsafe {
            webview.evaluateJavaScript_completionHandler(&script, Some(&completion));
        }
        let deadline = Instant::now() + JS_TIMEOUT;
        loop {
            if slot.borrow().is_some() {
                return slot.borrow_mut().take().unwrap();
            }
            if Instant::now() >= deadline {
                return Err("Timed out running the pagination script".to_string());
            }
            tick_run_loop();
        }
    }

    fn wait_for_pagination(webview: &WKWebView) -> Result<f64, String> {
        let deadline = Instant::now() + JS_TIMEOUT;
        loop {
            let value = eval_js_number(webview, PAGINATION_PROBE_JS)?;
            if let Some(result) = pagination_probe_result(value) {
                return result;
            }
            if Instant::now() >= deadline {
                return Err("Timed out waiting for embedded PDF pagination".to_string());
            }
            tick_run_loop();
        }
    }

    /// Render one page-sized region of the web view to standalone PDF data.
    fn create_pdf_page(
        mtm: MainThreadMarker,
        webview: &WKWebView,
        rect: CGRect,
    ) -> Result<Retained<NSData>, String> {
        let slot: PdfDataSlot = Rc::new(RefCell::new(None));
        let sink = slot.clone();
        let completion = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            let result = if !error.is_null() {
                let message = unsafe { (*error).localizedDescription() }.to_string();
                Err(format!("WebKit could not create the PDF: {message}"))
            } else {
                match unsafe { Retained::retain(data) } {
                    Some(data) => Ok(data),
                    None => Err("WebKit did not return PDF data".to_string()),
                }
            };
            *sink.borrow_mut() = Some(result);
        });

        let config = unsafe { WKPDFConfiguration::new(mtm) };
        unsafe {
            config.setRect(rect);
            webview.createPDFWithConfiguration_completionHandler(Some(&config), &completion);
        }

        let deadline = Instant::now() + PDF_TIMEOUT;
        loop {
            if slot.borrow().is_some() {
                return slot.borrow_mut().take().unwrap();
            }
            if Instant::now() >= deadline {
                return Err("Timed out waiting for WebKit to create the PDF".to_string());
            }
            tick_run_loop();
        }
    }

    pub fn write_pdf_file(
        path: &str,
        html: &str,
        paper_width_mm: f64,
        paper_height_mm: f64,
    ) -> Result<(), String> {
        let output_path = Path::new(path);
        ensure_parent_dir(output_path)?;

        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "PDF export must run on the macOS main thread".to_string())?;

        let (paper_width, paper_height) = paper_points(paper_width_mm, paper_height_mm)?;

        let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
        let frame = CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: paper_width,
                height: paper_height,
            },
        };
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(mtm.alloc::<WKWebView>(), frame, &configuration)
        };
        let navigation_state = Rc::new(RefCell::new(NavigationLoadState::Pending));
        let navigation_delegate = ExportNavigationDelegate::new(navigation_state.clone(), mtm);
        unsafe {
            webview.setNavigationDelegate(Some(ProtocolObject::from_ref(&*navigation_delegate)));
        }
        let html_string = NSString::from_str(html);
        let navigation = unsafe { webview.loadHTMLString_baseURL(&html_string, None) };
        if navigation.is_none() {
            return Err("WebKit refused to start loading export HTML".to_string());
        }
        wait_for_load(&navigation_state)?;

        let total_height = wait_for_pagination(&webview)?.max(paper_height);
        let page_count = ((total_height / paper_height).ceil() as usize).max(1);
        if page_count > MAX_PAGES {
            return Err(format!("PDF export exceeds the {MAX_PAGES} pages limit"));
        }
        tick_run_loop();

        // Each page is a fixed physical-paper slice; merge them into one document.
        let combined = unsafe { PDFDocument::new() };
        for index in 0..page_count {
            let rect = CGRect {
                origin: CGPoint {
                    x: 0.0,
                    y: index as f64 * paper_height,
                },
                size: CGSize {
                    width: paper_width,
                    height: paper_height,
                },
            };
            let data = create_pdf_page(mtm, &webview, rect)?;
            let page_doc = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }
                .ok_or_else(|| "Could not read a generated PDF page".to_string())?;
            if let Some(page) = unsafe { page_doc.pageAtIndex(0) } {
                let media_box = pdf_page_media_box(paper_width, paper_height);
                let at = unsafe { combined.pageCount() };
                unsafe {
                    // WebKit rounds its generated MediaBox down to whole points.
                    // Restore the requested physical dimensions before combining
                    // pages so presets and decimal custom sizes remain exact.
                    page.setBounds_forBox(media_box, PDFDisplayBox::MediaBox);
                    page.setBounds_forBox(media_box, PDFDisplayBox::CropBox);
                    combined.insertPage_atIndex(&page, at);
                }
            }
        }

        let written = unsafe { combined.writeToFile(&NSString::from_str(path)) };
        if written {
            Ok(())
        } else {
            Err("WebKit could not write the PDF file".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::macos::pdf_page_media_box;
    use super::{
        NavigationLoadState, format_pdf_export_error, navigation_load_result,
        pagination_probe_result, paper_points,
    };

    #[test]
    fn navigation_load_only_finishes_from_delegate_completion() {
        assert_eq!(navigation_load_result(&NavigationLoadState::Pending), None);
        assert_eq!(
            navigation_load_result(&NavigationLoadState::Finished),
            Some(Ok(()))
        );
        assert_eq!(
            navigation_load_result(&NavigationLoadState::Failed("WebKit failed".to_string())),
            Some(Err("WebKit failed".to_string()))
        );
    }

    #[test]
    fn export_errors_identify_the_failed_output_path() {
        assert_eq!(
            format_pdf_export_error("/tmp/project/exports/README.pdf", "WebKit timed out"),
            "Could not export '/tmp/project/exports/README.pdf' to PDF: WebKit timed out"
        );
    }

    #[test]
    fn converts_valid_custom_millimetres_to_points() {
        let (width, height) = paper_points(25.4, 50.8).expect("valid dimensions");
        assert!((width - 72.0).abs() < 1e-9);
        assert!((height - 144.0).abs() < 1e-9);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn generated_page_media_box_preserves_fractional_paper_points() {
        let bounds = pdf_page_media_box(595.275_590_551, 841.889_763_78);
        assert!((bounds.size.width - 595.275_590_551).abs() < 1e-9);
        assert!((bounds.size.height - 841.889_763_78).abs() < 1e-9);
    }

    #[test]
    fn rejects_invalid_custom_dimensions() {
        assert!(paper_points(f64::NAN, 297.0).is_err());
        assert!(paper_points(10.0, 297.0).is_err());
        assert!(paper_points(210.0, 2500.0).is_err());
    }

    #[test]
    fn classifies_embedded_pagination_probe_values() {
        assert_eq!(pagination_probe_result(0.0), None);
        assert!(
            pagination_probe_result(-1.0)
                .expect("error result")
                .is_err()
        );
        assert_eq!(pagination_probe_result(842.0), Some(Ok(842.0)),);
        assert!(
            pagination_probe_result(f64::NAN)
                .expect("invalid result")
                .is_err()
        );
    }
}
