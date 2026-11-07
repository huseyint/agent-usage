use tauri::image::Image;

fn segment_distance(x: f64, y: f64, a: (f64, f64), b: (f64, f64)) -> f64 {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let t = (((x - a.0) * dx + (y - a.1) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
    (x - a.0 - t * dx).hypot(y - a.1 - t * dy)
}

// A transparent monochrome activity glyph, independent of the colorful app icon.
// macOS tints the template (including its attention dot) to match the menu bar.
// Windows uses black strokes for contrast against the light gray taskbar.
pub fn image(unread: bool) -> Image<'static> {
    let glyph_color = if cfg!(target_os = "windows") {
        [0, 0, 0]
    } else {
        [255, 255, 255]
    };
    let mut pixels = vec![0u8; 32 * 32 * 4];
    let path = [
        (3.0, 17.0),
        (9.0, 17.0),
        (13.0, 7.0),
        (18.0, 25.0),
        (22.0, 16.0),
        (29.0, 16.0),
    ];
    for y in 0..32 {
        for x in 0..32 {
            let mut glyph = 0u32;
            let mut badge = 0u32;
            for sy in 0..4 {
                for sx in 0..4 {
                    let px = x as f64 + (sx as f64 + 0.5) / 4.0;
                    let py = y as f64 + (sy as f64 + 0.5) / 4.0;
                    let dot_distance = (px - 26.0).hypot(py - 5.0);
                    if unread && dot_distance <= 3.5 {
                        badge += 1;
                    } else if (!unread || dot_distance > 5.0)
                        && path
                            .windows(2)
                            .any(|p| segment_distance(px, py, p[0], p[1]) <= 1.55)
                    {
                        glyph += 1;
                    }
                }
            }
            let index = (y * 32 + x) * 4;
            let color = if badge > 0 && !cfg!(target_os = "macos") {
                [82, 156, 255]
            } else {
                glyph_color
            };
            pixels[index..index + 3].copy_from_slice(&color);
            pixels[index + 3] = ((glyph + badge) * 255 / 16) as u8;
        }
    }
    Image::new_owned(pixels, 32, 32)
}

#[cfg(test)]
mod tests {
    use super::image;

    #[test]
    fn transparent_glyph_gains_a_separate_attention_dot() {
        let normal = image(false);
        let unread = image(true);
        assert_eq!(normal.width(), 32);
        assert_eq!(normal.height(), 32);
        let dot_center = (5 * 32 + 26) * 4 + 3;
        assert_eq!(normal.rgba()[dot_center], 0);
        assert_eq!(unread.rgba()[dot_center], 255);
        assert_eq!(normal.rgba()[3], 0);
        let glyph = if cfg!(target_os = "windows") {
            [0, 0, 0, 255]
        } else {
            [255, 255, 255, 255]
        };
        assert!(normal.rgba().chunks(4).any(|p| p == glyph));
        assert!(unread.rgba().chunks(4).any(|p| p == glyph));
        if !cfg!(target_os = "macos") {
            let dot_start = dot_center - 3;
            assert_eq!(
                &unread.rgba()[dot_start..dot_start + 4],
                &[82, 156, 255, 255]
            );
        }
    }
}
