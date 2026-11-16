# Real-face regression image

`astronaut-512.gray` is a single 512×512 8-bit grayscale image produced by
FFmpeg from scikit-image's `astronaut.png` image at tag `v0.25.2`:
https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/data/astronaut.png

Original image: NASA astronaut photograph. The scikit-image data documentation
labels the image **public domain / no known copyright restrictions**:
https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut

Conversion (gray, 512×512; no resampling from the source's original 512×512):
`ffmpeg -i astronaut.png -vf scale=512:512,format=gray -frames:v 1 -f rawvideo astronaut-512.gray`
SHA-256: `f8234196233e729765c4341dab4448fb100d48900f815233b0ee936e79bcc3a2`

This is a non-private test fixture. It is not a biometric identity database.
