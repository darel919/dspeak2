#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;
mod media;

fn main() {
    desktop::run();
}
