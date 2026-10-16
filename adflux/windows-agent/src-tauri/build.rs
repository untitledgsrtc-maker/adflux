// App commands must be declared here so a capability can grant them to the REMOTE website window
// (src-tauri/capabilities/remote.json). Without this the website page cannot call idle_seconds etc.
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "idle_seconds",
            "idle_system_seconds",
            "injected_input_count",
            "active_window",
            "take_screenshot",
            "device_name",
            "show_window",
            "bring_to_front",
            "hide_window",
            "set_tray_tooltip",
            "autostart_enabled",
            "set_autostart",
            "quit_app",
        ])),
    )
    .expect("failed to run tauri-build");
}
