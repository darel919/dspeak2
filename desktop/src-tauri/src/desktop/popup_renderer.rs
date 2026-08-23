use std::num::NonZeroU32;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub(crate) const MAX_FRAME_BYTES: usize = 3_840 * 2_160 * 4;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VideoFrame {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) rgba: Vec<u8>,
}

impl VideoFrame {
    pub(crate) fn parse(data: &[u8], width: i64, height: i64, stride: usize) -> Option<Self> {
        let width = usize::try_from(width).ok()?;
        let height = usize::try_from(height).ok()?;
        if width == 0 || height == 0 || width.checked_mul(4)? > MAX_FRAME_BYTES / height.max(1) {
            return None;
        }
        let row_bytes = width * 4;
        if stride < row_bytes {
            return None;
        }
        let needed = stride
            .checked_mul(height.checked_sub(1)?)?
            .checked_add(row_bytes)?;
        if data.len() < needed {
            return None;
        }
        if stride == row_bytes {
            return Some(Self {
                width: width as u32,
                height: height as u32,
                rgba: data[..needed].to_vec(),
            });
        }
        let mut rgba = vec![0u8; row_bytes * height];
        for row in 0..height {
            let source = row * stride;
            let target = row * row_bytes;
            rgba[target..target + row_bytes].copy_from_slice(&data[source..source + row_bytes]);
        }
        Some(Self {
            width: width as u32,
            height: height as u32,
            rgba,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BlitRegion {
    pub(crate) x: u32,
    pub(crate) y: u32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

pub(crate) fn letterbox_region(
    frame_width: u32,
    frame_height: u32,
    surface_width: u32,
    surface_height: u32,
) -> Option<BlitRegion> {
    if frame_width == 0
        || frame_height == 0
        || surface_width == 0
        || surface_height == 0
        || surface_width > i32::MAX as u32
        || surface_height > i32::MAX as u32
    {
        return None;
    }
    let scale = (surface_width as f64 / frame_width as f64)
        .min(surface_height as f64 / frame_height as f64);
    let scaled_width = ((frame_width as f64 * scale).round() as u32).clamp(1, surface_width);
    let scaled_height = ((frame_height as f64 * scale).round() as u32).clamp(1, surface_height);
    Some(BlitRegion {
        x: (surface_width - scaled_width) / 2,
        y: (surface_height - scaled_height) / 2,
        width: scaled_width,
        height: scaled_height,
    })
}

pub(crate) fn blit_frame(
    pixels: &mut [u32],
    frame: &VideoFrame,
    region: BlitRegion,
    surface_width: u32,
) {
    let visible_width = region.width.min(surface_width.saturating_sub(region.x));
    for destination_row in region.y..region.y + region.height {
        let source_row = ((destination_row - region.y) as u64 * frame.height as u64
            / region.height as u64)
            .min(frame.height as u64 - 1) as usize;
        for destination_column in region.x..region.x + visible_width {
            let source_column = ((destination_column - region.x) as u64 * frame.width as u64
                / region.width as u64)
                .min(frame.width as u64 - 1) as usize;
            let source_offset = (source_row * frame.width as usize + source_column) * 4;
            let r = frame.rgba[source_offset] as u32;
            let g = frame.rgba[source_offset + 1] as u32;
            let b = frame.rgba[source_offset + 2] as u32;
            let pixel_index =
                (destination_row as usize) * (surface_width as usize) + destination_column as usize;
            if let Some(pixel) = pixels.get_mut(pixel_index) {
                *pixel = (r << 16) | (g << 8) | b;
            }
        }
    }
}

#[derive(Default)]
pub(crate) struct LatestFrameSlot {
    latest: Option<VideoFrame>,
}

impl LatestFrameSlot {
    pub(crate) fn push(&mut self, frame: VideoFrame) {
        self.latest = Some(frame);
    }

    pub(crate) fn take(&mut self) -> Option<VideoFrame> {
        self.latest.take()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OfflineState {
    pub(crate) label: String,
}

impl OfflineState {
    pub(crate) fn new(label: String) -> Self {
        Self { label }
    }
}

const SMPTE_UPPER: [[u8; 3]; 7] = [
    [0xc0, 0xc0, 0xc0],
    [0xc0, 0xc0, 0x00],
    [0x00, 0xc0, 0xc0],
    [0x00, 0xc0, 0x00],
    [0xc0, 0x00, 0xc0],
    [0xc0, 0x00, 0x00],
    [0x00, 0x00, 0xc0],
];

const SMPTE_LOWER: [[u8; 3]; 7] = [
    [0x00, 0x00, 0xc0],
    [0x10, 0x10, 0x10],
    [0xc0, 0x00, 0xc0],
    [0x10, 0x10, 0x10],
    [0x00, 0xc0, 0xc0],
    [0x10, 0x10, 0x10],
    [0xc0, 0xc0, 0xc0],
];

fn pack_pixel(channels: [u8; 3]) -> u32 {
    ((channels[0] as u32) << 16) | ((channels[1] as u32) << 8) | channels[2] as u32
}

pub(crate) fn smpte_pixel(frame_width: u32, frame_height: u32, x: u32, y: u32) -> u32 {
    let column = (x * 7 / frame_width.max(1)).min(6) as usize;
    let lower_start = frame_height * 85 / 100;
    if y >= lower_start {
        pack_pixel(SMPTE_LOWER[column])
    } else {
        pack_pixel(SMPTE_UPPER[column])
    }
}

fn draw_glyph(pixels: &mut [u32], glyph: [u8; 8], x: u32, y: u32, surface_width: u32) {
    for (row, bits) in glyph.iter().enumerate() {
        for column in 0..8 {
            if bits & (0x80 >> column) != 0 {
                let pixel_index = (y as usize + row) * surface_width as usize + x as usize + column;
                if let Some(pixel) = pixels.get_mut(pixel_index) {
                    *pixel = 0x00ffffff;
                }
            }
        }
    }
}

fn glyph_for(character: char) -> Option<[u8; 8]> {
    use font8x8::{UnicodeFonts, BASIC_FONTS};
    BASIC_FONTS.get(character)
}

fn text_width(text: &str) -> usize {
    text.chars().count() * 8
}

pub(crate) fn draw_offline_overlay(
    pixels: &mut [u32],
    surface_width: u32,
    surface_height: u32,
    label: &str,
) {
    for y in 0..surface_height {
        for x in 0..surface_width {
            if let Some(pixel) = pixels.get_mut((y as usize) * surface_width as usize + x as usize)
            {
                *pixel = smpte_pixel(surface_width, surface_height, x, y);
            }
        }
    }

    let status = "NO SIGNAL";
    let label_text: String = label.chars().take(48).collect();
    let status_width = text_width(status);
    let label_width = text_width(&label_text);
    let block_height = 8 * 3;
    let block_top = surface_height.saturating_sub(block_height) / 2;

    for y in block_top.saturating_sub(12)..(block_top + block_height + 12).min(surface_height) {
        let band_start = (surface_width / 2).saturating_sub(
            ((label_width.max(status_width)) as u32 / 2 + 16).min(surface_width / 2),
        );
        let band_end = band_start + (label_width.max(status_width) as u32) + 32;
        for x in band_start..band_end.min(surface_width) {
            if let Some(pixel) = pixels.get_mut((y as usize) * surface_width as usize + x as usize)
            {
                *pixel = 0x00000000;
            }
        }
    }

    let mut x = surface_width.saturating_sub(status_width as u32) / 2;
    for character in status.chars() {
        if let Some(glyph) = glyph_for(character) {
            draw_glyph(pixels, glyph, x, block_top, surface_width);
        }
        x += 8;
    }

    let label_x = surface_width.saturating_sub(label_width as u32) / 2;
    let mut lx = label_x;
    for character in label_text.chars() {
        if let Some(glyph) = glyph_for(character) {
            draw_glyph(pixels, glyph, lx, block_top + 16, surface_width);
        }
        lx += 8;
    }
}

fn present_frame(
    buffer: &mut softbuffer::Buffer<'_, &tauri::Window, &tauri::Window>,
    frame: &VideoFrame,
) {
    let surface_width = buffer.width().get();
    let surface_height = buffer.height().get();
    if surface_width == 0 || surface_height == 0 {
        return;
    }
    if let Some(region) = letterbox_region(frame.width, frame.height, surface_width, surface_height)
    {
        blit_frame(buffer, frame, region, surface_width);
    }
}

type RendererStopFlag = Arc<std::sync::atomic::AtomicBool>;

struct RendererHandle {
    stop: RendererStopFlag,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for RendererHandle {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

static RENDERERS: Mutex<Vec<(String, RendererHandle)>> = Mutex::new(Vec::new());

pub(crate) fn wake_renderer() -> Result<(), String> {
    Ok(())
}

pub(crate) fn spawn_renderer(
    window: tauri::Window,
    frames: Arc<Mutex<LatestFrameSlot>>,
    offline: Arc<Mutex<Option<OfflineState>>>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let stop: RendererStopFlag = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let render_thread = thread::Builder::new()
        .name(format!("dspeak-popup-render-{label}"))
        .spawn(move || {
            let Ok(context) = softbuffer::Context::new(&window) else {
                return;
            };
            let Ok(mut surface) = softbuffer::Surface::new(&context, &window) else {
                return;
            };
            while !thread_stop.load(Ordering::Acquire) {
                let next_frame = frames.lock().ok().and_then(|mut slot| slot.take());
                let offline_label = offline
                    .lock()
                    .ok()
                    .and_then(|slot| slot.as_ref().map(|state| state.label.clone()));
                if next_frame.is_none() && offline_label.is_some() {
                    if let Ok(size) = window.inner_size() {
                        if let (Some(width), Some(height)) =
                            (NonZeroU32::new(size.width), NonZeroU32::new(size.height))
                        {
                            let _ = surface.resize(width, height);
                            if let Ok(mut buffer) = surface.buffer_mut() {
                                draw_offline_overlay(
                                    &mut buffer,
                                    size.width,
                                    size.height,
                                    &offline_label.unwrap_or_default(),
                                );
                                let _ = buffer.present();
                            }
                        }
                    }
                }
                let presented = next_frame.is_some();
                if let Some(frame) = next_frame {
                    if let Ok(size) = window.inner_size() {
                        if let (Some(width), Some(height)) =
                            (NonZeroU32::new(size.width), NonZeroU32::new(size.height))
                        {
                            let _ = surface.resize(width, height);
                            if let Ok(mut buffer) = surface.buffer_mut() {
                                present_frame(&mut buffer, &frame);
                                let _ = buffer.present();
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(if presented { 4 } else { 16 }));
            }
        })
        .map_err(|error| format!("media popup renderer failed to start: {error}"))?;

    RENDERERS
        .lock()
        .map(|mut renderers| {
            renderers.retain(|(_, handle)| !handle.stop.load(Ordering::Acquire));
            renderers.push((
                label,
                RendererHandle {
                    stop,
                    thread: Some(render_thread),
                },
            ));
        })
        .map_err(|_| "media popup renderer registry lock poisoned".to_string())
}

#[cfg(test)]
mod tests {
    use super::letterbox_region;
    use super::{blit_frame, BlitRegion, LatestFrameSlot, VideoFrame};

    fn solid_frame(width: u32, height: u32, channels: [u8; 3]) -> VideoFrame {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..width * height {
            rgba.extend_from_slice(&channels);
            rgba.push(255);
        }
        VideoFrame {
            width,
            height,
            rgba,
        }
    }

    #[test]
    fn parses_contiguous_rgba_frames() {
        let mut data = vec![7u8; 16];
        data[0] = 200;
        let frame = VideoFrame::parse(&data, 2, 2, 8);
        assert_eq!(
            frame,
            Some(VideoFrame {
                width: 2,
                height: 2,
                rgba: data,
            })
        );
    }

    #[test]
    fn rejects_frames_that_do_not_fit_the_declared_geometry() {
        assert_eq!(VideoFrame::parse(&[0u8; 12], 2, 2, 8), None);
        assert_eq!(VideoFrame::parse(&[0u8; 16], 0, 2, 8), None);
        assert_eq!(VideoFrame::parse(&[0u8; 16], -2, 2, 8), None);
        assert_eq!(VideoFrame::parse(&[0u8; 16], 2, 0, 8), None);
        assert_eq!(VideoFrame::parse(&[0u8; 16], 2, 2, 4), None);
    }

    #[test]
    fn untangles_strided_rows_into_contiguous_output() {
        let stride = 12usize;
        let mut data = vec![0u8; stride + 8];
        data[0] = 1;
        data[4] = 2;
        data[stride] = 3;
        data[stride + 4] = 4;
        let frame = VideoFrame::parse(&data, 2, 2, stride).expect("strided frame");
        assert_eq!(frame.width, 2);
        assert_eq!(frame.height, 2);
        assert_eq!(frame.rgba.len(), 16);
        assert_eq!(&frame.rgba[0..8], &[1, 0, 0, 0, 2, 0, 0, 0]);
        assert_eq!(&frame.rgba[8..16], &[3, 0, 0, 0, 4, 0, 0, 0]);
    }

    #[test]
    fn letterbox_centers_and_preserves_aspect_ratio() {
        let region = letterbox_region(1920, 1080, 1000, 1000).expect("landscape fit");
        assert_eq!(
            region,
            BlitRegion {
                x: 0,
                y: 218,
                width: 1000,
                height: 563,
            }
        );
        let portrait = letterbox_region(720, 1280, 1000, 1000).expect("portrait fit");
        assert_eq!(
            portrait,
            BlitRegion {
                x: 218,
                y: 0,
                width: 563,
                height: 1000,
            }
        );
        let exact = letterbox_region(640, 360, 640, 360).expect("exact fit");
        assert_eq!(
            exact,
            BlitRegion {
                x: 0,
                y: 0,
                width: 640,
                height: 360,
            }
        );
        let upscaled = letterbox_region(320, 180, 640, 360).expect("upscale fit");
        assert_eq!(
            upscaled,
            BlitRegion {
                x: 0,
                y: 0,
                width: 640,
                height: 360,
            }
        );
    }

    #[test]
    fn letterbox_rejects_degenerate_geometry() {
        assert_eq!(letterbox_region(0, 100, 100, 100), None);
        assert_eq!(letterbox_region(100, 0, 100, 100), None);
        assert_eq!(letterbox_region(100, 100, 0, 100), None);
        assert_eq!(letterbox_region(100, 100, 100, 0), None);
    }

    #[test]
    fn blit_fills_outside_the_letterbox_with_black() {
        let red = solid_frame(2, 2, [255, 0, 0]);
        let mut pixels = vec![0u32; 16];
        blit_frame(
            &mut pixels,
            &red,
            BlitRegion {
                x: 1,
                y: 1,
                width: 2,
                height: 2,
            },
            4,
        );
        assert!(pixels.iter().take(4).all(|pixel| *pixel == 0));
        assert_eq!(
            pixels.iter().filter(|pixel| **pixel == 0x00ff0000).count(),
            4
        );
    }

    #[test]
    fn blit_scales_the_whole_frame_into_the_region() {
        let frame = VideoFrame {
            width: 2,
            height: 2,
            rgba: vec![
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
            ],
        };
        let mut pixels = vec![0u32; 16];
        blit_frame(
            &mut pixels,
            &frame,
            BlitRegion {
                x: 0,
                y: 0,
                width: 4,
                height: 4,
            },
            4,
        );
        assert_eq!(pixels[0], 0x00ff0000);
        assert_eq!(pixels[3], 0x0000ff00);
        assert_eq!(pixels[12], 0x000000ff);
        assert_eq!(pixels[15], 0x00ffffff);
    }

    #[test]
    fn blit_clips_samples_that_escape_the_surface() {
        let frame = solid_frame(2, 2, [1, 2, 3]);
        let mut pixels = vec![0u32; 16];
        blit_frame(
            &mut pixels,
            &frame,
            BlitRegion {
                x: 3,
                y: 0,
                width: 4,
                height: 2,
            },
            4,
        );
        assert_eq!(pixels[3], 0x00010203);
        assert_eq!(pixels[7], 0x00010203);
        assert!(pixels
            .iter()
            .enumerate()
            .all(|(index, pixel)| index == 3 || index == 7 || *pixel == 0));
    }

    #[test]
    fn latest_slot_keeps_only_the_freshest_frame() {
        let mut slot = LatestFrameSlot::default();
        slot.push(solid_frame(2, 2, [0, 0, 0]));
        slot.push(solid_frame(4, 4, [0, 0, 0]));
        let frame = slot.take().expect("latest frame");
        assert_eq!(frame.width, 4);
        assert!(slot.take().is_none());
    }
}
