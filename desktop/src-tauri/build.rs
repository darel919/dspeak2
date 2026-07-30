/// Build script — links native-media backend when available.
fn main() {
    tauri_build::build();
    println!("cargo:rustc-check-cfg=cfg(native_rtc)");

    if let Ok(artifact_dir) = std::env::var("NATIVE_MEDIA_ARTIFACT_DIR") {
        let lib_dir = std::path::Path::new(&artifact_dir).join("lib");

        println!("cargo:rustc-link-search=native={}", lib_dir.display());
        println!("cargo:rustc-link-lib=static=dsm");
        println!("cargo:rustc-link-lib=static=mediasoupclient");
        println!("cargo:rustc-link-lib=static=webrtc");

        if cfg!(target_os = "macos") {
            println!("cargo:rustc-link-lib=framework=CoreFoundation");
            println!("cargo:rustc-link-lib=framework=CoreAudio");
            println!("cargo:rustc-link-lib=framework=AudioToolbox");
            println!("cargo:rustc-link-lib=framework=CoreVideo");
            println!("cargo:rustc-link-lib=framework=VideoToolbox");
            println!("cargo:rustc-link-lib=framework=CoreGraphics");
            println!("cargo:rustc-link-lib=framework=IOSurface");
            println!("cargo:rustc-link-lib=framework=Foundation");
            println!("cargo:rustc-link-lib=framework=AppKit");
            println!("cargo:rustc-link-lib=framework=AVFoundation");
            println!("cargo:rustc-link-lib=framework=Security");
            println!("cargo:rustc-link-lib=framework=Cocoa");
            println!("cargo:rustc-link-lib=framework=OpenGL");
            println!("cargo:rustc-link-lib=framework=Metal");
        }

        println!("cargo:rustc-cfg=native_rtc");
    }
}
