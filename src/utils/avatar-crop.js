// Square source rectangle, always inside the decoded image (no blank margins).
export function cropRectangle(width, height, zoom = 1, horizontal = 0, vertical = 0) {
  if (![width, height, zoom, horizontal, vertical].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('图片尺寸无效')
  }
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
  const size = Math.min(width, height) / clamp(zoom, 1, 3)
  return {
    x: (width - size) * (clamp(horizontal, -100, 100) + 100) / 200,
    y: (height - size) * (clamp(vertical, -100, 100) + 100) / 200,
    size,
  }
}
export function drawAvatar(canvas, image, zoom, horizontal, vertical) {
  const { x, y, size } = cropRectangle(image.naturalWidth, image.naturalHeight, zoom, horizontal, vertical)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, x, y, size, size, 0, 0, canvas.width, canvas.height)
}
