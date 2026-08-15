#[path = "../media/ffi.rs"]
mod ffi;
#[path = "../media_worker_server.rs"]
mod media_worker_server;

fn main() {
    if let Err(error) = media_worker_server::run() {
        eprintln!("[dspeak:media-worker] {error}");
        std::process::exit(1);
    }
}
