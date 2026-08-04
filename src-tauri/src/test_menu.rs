use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let copy = PredefinedMenuItem::copy(app, None)?;
            let paste = PredefinedMenuItem::paste(app, None)?;
            let cut = PredefinedMenuItem::cut(app, None)?;
            let select_all = PredefinedMenuItem::select_all(app, None)?;
            
            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[&cut, &copy, &paste, &select_all]
            )?;
            let menu = Menu::with_items(app, &[&edit_menu])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}