// Untitled Work for Windows - Phase 383 (agent step 3).
// Rust side only does what a browser cannot: system idle time, the foreground program + window title,
// a screenshot, tray, autostart, and window show / hide. All business logic lives in src/main.js and
// goes through the work_agent_* / work_clock_* database functions.
// Records NOTHING by itself: the JS side asks for samples only while a timer runs and consent is accepted.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[derive(serde::Serialize)]
struct ActiveWindow {
    program: String,
    title: String,
}

// ---- physical input watcher (Windows) -------------------------------------------------------------------------
// Windows' own idle clock (GetLastInputInfo) is reset by ANY input, including input injected by other programs
// (remote-desktop tools, trackers, "keep awake" tools) and by tiny optical-mouse jitter. A low-level hook that only
// NOTES THE TIME of REAL input is used instead: keyboard / mouse events that are not flagged "injected", and mouse
// movement only when it moved at least 10 px from the last counted position. It never reads which key was pressed.
#[cfg(windows)]
mod input_watch {
    use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, HHOOK, KBDLLHOOKSTRUCT, MSG,
        MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_MOUSEMOVE,
    };

    pub static LAST_REAL_MS: AtomicU64 = AtomicU64::new(0);
    pub static INJECTED: AtomicU64 = AtomicU64::new(0);
    pub static READY: AtomicBool = AtomicBool::new(false);
    static ACC_X: AtomicI32 = AtomicI32::new(i32::MIN);
    static ACC_Y: AtomicI32 = AtomicI32::new(i32::MIN);

    pub fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    unsafe extern "system" fn kb_proc(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = &*(l.0 as *const KBDLLHOOKSTRUCT);
            if info.flags.0 & 0x10 != 0 {
                INJECTED.fetch_add(1, Ordering::Relaxed);
            } else {
                LAST_REAL_MS.store(now_ms(), Ordering::Relaxed);
            }
        }
        CallNextHookEx(HHOOK::default(), code, w, l)
    }

    unsafe extern "system" fn mouse_proc(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = &*(l.0 as *const MSLLHOOKSTRUCT);
            if info.flags & 0x1 != 0 {
                INJECTED.fetch_add(1, Ordering::Relaxed);
            } else if w.0 as u32 == WM_MOUSEMOVE {
                let (x, y) = (info.pt.x, info.pt.y);
                let (ax, ay) = (ACC_X.load(Ordering::Relaxed), ACC_Y.load(Ordering::Relaxed));
                if ax == i32::MIN || (x - ax).abs() + (y - ay).abs() >= 10 {
                    ACC_X.store(x, Ordering::Relaxed);
                    ACC_Y.store(y, Ordering::Relaxed);
                    LAST_REAL_MS.store(now_ms(), Ordering::Relaxed);
                }
            } else {
                LAST_REAL_MS.store(now_ms(), Ordering::Relaxed); // click, wheel
            }
        }
        CallNextHookEx(HHOOK::default(), code, w, l)
    }

    pub fn start() {
        LAST_REAL_MS.store(now_ms(), Ordering::Relaxed);
        std::thread::spawn(|| unsafe {
            let k = SetWindowsHookExW(WH_KEYBOARD_LL, Some(kb_proc), HINSTANCE::default(), 0);
            let m = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), HINSTANCE::default(), 0);
            if k.is_ok() && m.is_ok() {
                READY.store(true, Ordering::Relaxed);
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}

// Seconds since the last REAL (physical) keyboard / mouse activity. Falls back to Windows' idle clock if the watcher
// could not start.
#[cfg(windows)]
#[tauri::command]
fn idle_seconds() -> u64 {
    if input_watch::READY.load(std::sync::atomic::Ordering::Relaxed) {
        let last = input_watch::LAST_REAL_MS.load(std::sync::atomic::Ordering::Relaxed);
        return input_watch::now_ms().saturating_sub(last) / 1000;
    }
    idle_system_seconds()
}

// Windows' own idle clock (counts injected input too) - shown next to the real one so a difference is visible.
#[cfg(windows)]
#[tauri::command]
fn idle_system_seconds() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            let now = GetTickCount();
            return (now.wrapping_sub(info.dwTime) / 1000) as u64;
        }
    }
    0
}

// How many injected (software-made) input events were seen: tells whether another program is faking activity.
#[cfg(windows)]
#[tauri::command]
fn injected_input_count() -> u64 {
    input_watch::INJECTED.load(std::sync::atomic::Ordering::Relaxed)
}

#[cfg(not(windows))]
#[tauri::command]
fn idle_seconds() -> u64 {
    0
}
#[cfg(not(windows))]
#[tauri::command]
fn idle_system_seconds() -> u64 {
    0
}
#[cfg(not(windows))]
#[tauri::command]
fn injected_input_count() -> u64 {
    0
}

#[cfg(windows)]
#[tauri::command]
fn active_window() -> ActiveWindow {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return ActiveWindow { program: "Unknown".into(), title: String::new() };
        }
        let mut tbuf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut tbuf);
        let title = String::from_utf16_lossy(&tbuf[..(n.max(0) as usize)]);
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut program = String::from("Unknown");
        if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut pbuf = [0u16; 520];
            let mut len = pbuf.len() as u32;
            if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(pbuf.as_mut_ptr()), &mut len).is_ok() {
                let full = String::from_utf16_lossy(&pbuf[..len as usize]);
                let file = full.rsplit(['\\', '/']).next().unwrap_or("").to_string();
                let stem = file.strip_suffix(".exe").unwrap_or(&file).to_string();
                if !stem.is_empty() {
                    let mut c = stem.chars();
                    program = match c.next() {
                        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                        None => stem,
                    };
                }
            }
            let _ = CloseHandle(h);
        }
        ActiveWindow { program, title }
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn active_window() -> ActiveWindow {
    ActiveWindow { program: "Unknown".into(), title: String::new() }
}

// one JPEG (max 1280 wide, quality 60) of the first monitor, as base64
#[tauri::command]
fn take_screenshot() -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let m = monitors.into_iter().next().ok_or_else(|| "no monitor".to_string())?;
    let img = m.capture_image().map_err(|e| e.to_string())?;
    let (w, h) = (img.width(), img.height());
    let dynimg = image::DynamicImage::ImageRgba8(img);
    let dynimg = if w > 1280 {
        dynimg.resize(1280, (h as u64 * 1280 / w as u64) as u32, image::imageops::FilterType::Triangle)
    } else {
        dynimg
    };
    let rgb = dynimg.to_rgb8();
    let mut out: Vec<u8> = Vec::new();
    let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 60);
    rgb.write_with_encoder(enc).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

#[tauri::command]
fn device_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows PC".to_string())
}

#[tauri::command]
fn show_window(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// Bring a window to the very front (idle question / "timer stopped"): show, always on top, centre, focus,
// and flash the taskbar so the person notices even if they are in another program.
#[tauri::command]
fn bring_to_front(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_always_on_top(true);
        let _ = w.center();
        let _ = w.set_focus();
        let _ = w.request_user_attention(Some(tauri::UserAttentionType::Critical));
        // Phase 458: the MAIN window must not stay on top of every other program for ever (people could not click
        // anything else once it had been brought forward). Pop it up, then let go after a moment. The small idle
        // window keeps its normal always-on-top behaviour.
        if label == "main" {
            let w2 = w.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let _ = w2.set_always_on_top(false);
            });
        }
    }
}

#[tauri::command]
fn hide_window(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.hide();
    }
}

#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) {
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_tooltip(Some(text));
    }
}

#[tauri::command]
fn autostart_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) -> bool {
    let a = app.autolaunch();
    let _ = if on { a.enable() } else { a.disable() };
    a.is_enabled().unwrap_or(false)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .invoke_handler(tauri::generate_handler![
            idle_seconds,
            idle_system_seconds,
            injected_input_count,
            active_window,
            take_screenshot,
            device_name,
            show_window,
            bring_to_front,
            hide_window,
            set_tray_tooltip,
            autostart_enabled,
            set_autostart,
            quit_app
        ])
        .setup(|app| {
            #[cfg(windows)]
            input_watch::start();
            let open = MenuItem::with_id(app, "open", "Open Untitled Work", true, None::<&str>)?;
            let widget = MenuItem::with_id(app, "widget", "Show timer", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &widget, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Untitled Work")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "widget" => {
                        if let Some(w) = app.get_webview_window("widget") {
                            let _ = w.show();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            // started by Windows with --minimized: stay in the tray
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing a window only hides it, the agent keeps running in the tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            // a windowed app dies silently: leave the reason in a file the owner can send
            let dir = std::env::var("TEMP").unwrap_or_else(|_| ".".to_string());
            let _ = std::fs::write(format!("{}\\untitled-work-error.txt", dir), format!("Untitled Work failed to start: {}", e));
        });
}
