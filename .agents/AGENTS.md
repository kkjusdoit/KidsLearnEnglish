# KidsLearnEnglish / JSYX English Project Rules

## Image Generation & Optimization Guidelines
1. **Format**: All generated images for vocabulary cards must be converted and compressed to WebP format (`.webp`) before deploying. Do not use uncompressed formats like PNG or high-size JPEGs directly for lesson cards.
2. **Resolution & Style**: Use bright pastel vector cartoon illustrations isolated on solid white background, suitable for children's vocabulary flashcards.
3. **Previews**: Generate a scaled-down `.preview.jpg` thumbnail for each page's image using `ffmpeg` (with `scale=640:-2:force_original_aspect_ratio=decrease -q:v 5`) to enable fast initial rendering.
4. **Cache Busting**: When replacing existing lesson images, append or update the version query parameter in the database (e.g. `?v=X`) to immediately bust client-side browser caches.
