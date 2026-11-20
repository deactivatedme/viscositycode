//! Show/Quit tray. Quit goes through `AppHandle::exit`, so `RunEvent::Exit`
//! runs the sidecar's graceful stop exactly like Cmd+Q.

use tauri::AppHandle;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

const SHOW: &str = "show";
const QUIT: &str = "quit";

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW, "Show ViscosityCode", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit ViscosityCode", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("ViscosityCode")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW => crate::show_main(app),
            QUIT => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
