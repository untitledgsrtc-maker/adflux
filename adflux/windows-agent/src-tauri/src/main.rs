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

#[cfg(windows)]
#[tauri::command]
fn idle_seconds() -> u64 {
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

#[cfg(not(windows))]
#[tauri::command]
fn idle_seconds() -> u64 {
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
            active_window,
            take_screenshot,
            device_name,
            show_window,
            hide_window,
            set_tray_tooltip,
            autostart_enabled,
            set_autostart,
            quit_app
        ])
        .setup(|app| {
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
