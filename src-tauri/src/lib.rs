// mod apiEndpoint; // all endpoints now from api_endpoints.json
mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_http::init())
    .invoke_handler(tauri::generate_handler![
      commands::get_api_config,
      commands::test_api_connection,
      commands::get_config_path,
      commands::proxy_api_get,
      commands::proxy_api_post,
      commands::get_token_usage,
      commands::register_user,
      commands::login_user,
      commands::upload_file,
      commands::download_file,
      commands::user_login,
      commands::set_user_password,
      commands::save_credentials,
      commands::load_credentials,
      commands::clear_credentials,
      commands::list_saved_users,
      commands::refresh_token,
      commands::get_upload_history,
      commands::create_public_link,
      commands::delete_public_link,
      commands::list_public_links
    ])
    .setup(|app| {
  // Load static config on startup
  let saved_config = commands::ApiConfig::default();
  app.manage(commands::new_api_config_state(saved_config));
      
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running application");
}
