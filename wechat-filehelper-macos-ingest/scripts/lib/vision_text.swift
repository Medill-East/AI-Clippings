import AppKit
import Foundation
import Vision

struct OcrLine: Codable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let confidence: Double
}

struct OcrOutput: Codable {
  let width: Int
  let height: Int
  let lines: [OcrLine]
}

enum VisionCliError: Error {
  case usage
  case loadImage(String)
  case makeCGImage(String)
}

func loadCGImage(at imagePath: String) throws -> CGImage {
  guard let image = NSImage(contentsOfFile: imagePath) else {
    throw VisionCliError.loadImage("Could not load image at \(imagePath)")
  }

  var proposedRect = CGRect(origin: .zero, size: image.size)
  guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
    throw VisionCliError.makeCGImage("Could not create CGImage for \(imagePath)")
  }

  return cgImage
}

func recognizeText(from cgImage: CGImage) throws -> OcrOutput {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  request.recognitionLanguages = ["zh-Hans", "en-US"]

  let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
  try handler.perform([request])

  let imageWidth = Double(cgImage.width)
  let imageHeight = Double(cgImage.height)

  let lines: [OcrLine] = (request.results ?? []).compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else {
      return nil
    }

    let box = observation.boundingBox
    let x = box.origin.x * imageWidth
    let width = box.size.width * imageWidth
    let height = box.size.height * imageHeight
    let y = (1.0 - box.origin.y - box.size.height) * imageHeight

    return OcrLine(
      text: candidate.string,
      x: x,
      y: y,
      width: width,
      height: height,
      confidence: Double(candidate.confidence)
    )
  }
  .sorted {
    if abs($0.y - $1.y) > 8 {
      return $0.y < $1.y
    }
    return $0.x < $1.x
  }

  return OcrOutput(width: cgImage.width, height: cgImage.height, lines: lines)
}

do {
  guard CommandLine.arguments.count >= 2 else {
    throw VisionCliError.usage
  }

  let imagePath = CommandLine.arguments[1]
  let cgImage = try loadCGImage(at: imagePath)
  let output = try recognizeText(from: cgImage)
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  let data = try encoder.encode(output)
  FileHandle.standardOutput.write(data)
} catch VisionCliError.usage {
  FileHandle.standardError.write(Data("Usage: swift vision_text.swift <image-path>\n".utf8))
  exit(2)
} catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(1)
}
