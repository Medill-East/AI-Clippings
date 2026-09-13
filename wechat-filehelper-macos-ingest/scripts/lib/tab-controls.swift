import AppKit
import Foundation
import CryptoKit

func bitmap(_ file: String) throws -> NSBitmapImageRep {
  guard let rep = NSBitmapImageRep(data: try Data(contentsOf: URL(fileURLWithPath: file))) else {
    throw NSError(domain: "tab-controls", code: 1)
  }
  return rep
}
let args = CommandLine.arguments
if args.count != 5 { exit(2) }
let image = try bitmap(args[1])
let template = try bitmap(args[2])
let logicalWidth = Double(args[3])!
let chatWidth = Double(args[4])!
let scale = Double(image.pixelsWide) / logicalWidth
let side = max(12, Int((36 * scale / 2).rounded()))
let width = image.pixelsWide
let height = min(image.pixelsHigh, Int(65 * scale))
var gray = [Double](repeating: 0, count: width * height)
func luminance(_ rep: NSBitmapImageRep, _ x: Int, _ y: Int) -> Double {
  guard let color = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { return 0 }
  return Double(color.redComponent * 0.299 + color.greenComponent * 0.587 + color.blueComponent * 0.114)
}
for y in 0..<height { for x in 0..<width { gray[y * width + x] = luminance(image, x, y) } }
var offsets = [(Int, Int)]()
var values = [Double]()
for y in stride(from: 0, to: side, by: max(1, side / 12)) {
  for x in stride(from: 0, to: side, by: max(1, side / 12)) {
    offsets.append((x, y))
    values.append(luminance(template, min(35, x * 36 / side), min(35, y * 36 / side)))
  }
}
let count = Double(values.count)
let mean = values.reduce(0, +) / count
values = values.map { $0 - mean }
let templateEnergy = values.reduce(0) { $0 + $1 * $1 }
var best = -1.0
var point = (0, 0)
let left = Int(chatWidth * scale)
let right = width - Int(40 * scale) - side
let top = max(0, Int(10 * scale))
let bottom = min(height - side, Int(40 * scale))
if left < right && top < bottom {
  for y in stride(from: top, through: bottom, by: 2) {
    for x in stride(from: left, through: right, by: 2) {
      var sum = 0.0, squares = 0.0, dot = 0.0
      for i in 0..<offsets.count {
        let (dx, dy) = offsets[i]
        let value = gray[(y + dy) * width + x + dx]
        sum += value; squares += value * value; dot += value * values[i]
      }
      let energy = squares - sum * sum / count
      if energy < 0.000001 { continue }
      let score = dot / sqrt(energy * templateEnergy)
      if score > best { best = score; point = (x + side / 2, y + side / 2) }
    }
  }
}
var pixels = [UInt8]()
for y in 0..<height { for x in left..<width { pixels.append(UInt8(clamping: Int(gray[y * width + x] * 255))) } }
let fingerprint = SHA256.hash(data: Data(pixels)).map { String(format: "%02x", $0) }.joined()
let output: [String: Any] = ["fingerprint": fingerprint, "matched": best >= 0.88, "x": point.0, "y": point.1, "score": best]
let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
