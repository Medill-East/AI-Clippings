import AVFoundation
import CoreGraphics
import CoreMedia
import Darwin
import Foundation
import ScreenCaptureKit

private struct CaptureRect {
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat

    var cgRect: CGRect {
        CGRect(x: x, y: y, width: width, height: height)
    }
}

private final class RecordingDelegate: NSObject, SCRecordingOutputDelegate {
    private let semaphore = DispatchSemaphore(value: 0)
    private(set) var failure: String?

    func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        failure = error.localizedDescription
        semaphore.signal()
    }

    func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        semaphore.signal()
    }

    func wait(timeout: TimeInterval) -> Bool {
        semaphore.wait(timeout: .now() + timeout) == .success
    }
}

private func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("capture_error:\(message)\n".utf8))
    exit(1)
}

private func parseArguments() -> (output: String, duration: TimeInterval, rect: CaptureRect?) {
    var output: String?
    var duration: TimeInterval = 120
    var values: [String: CGFloat] = [:]
    var index = 1

    while index < CommandLine.arguments.count {
        let argument = CommandLine.arguments[index]
        guard index + 1 < CommandLine.arguments.count else {
            fail("missing value for \(argument)")
        }
        let value = CommandLine.arguments[index + 1]
        switch argument {
        case "--output":
            output = value
        case "--duration":
            guard let parsed = TimeInterval(value), parsed > 0 else {
                fail("duration must be positive")
            }
            duration = min(parsed, 3600)
        case "--screen-x", "--screen-y", "--screen-width", "--screen-height":
            guard let parsed = Double(value).map({ CGFloat($0) }) else {
                fail("invalid screen value for \(argument)")
            }
            let key = String(argument.dropFirst(2))
            values[key] = parsed
        default:
            fail("unknown argument \(argument)")
        }
        index += 2
    }

    guard let output, !output.isEmpty else {
        fail("--output is required")
    }

    let rect: CaptureRect?
    if let x = values["screen-x"],
       let y = values["screen-y"],
       let width = values["screen-width"],
       let height = values["screen-height"],
       width > 0,
       height > 0 {
        rect = CaptureRect(x: x, y: y, width: width, height: height)
    } else {
        rect = nil
    }

    return (output, duration, rect)
}

private func overlapArea(_ first: CGRect, _ second: CGRect) -> CGFloat {
    guard first.intersects(second) else { return 0 }
    let intersection = first.intersection(second)
    return max(0, intersection.width) * max(0, intersection.height)
}

private func selectDisplay(from content: SCShareableContent, preferredRect: CaptureRect?) -> SCDisplay? {
    guard !content.displays.isEmpty else { return nil }

    if let preferredRect {
        return content.displays.max { left, right in
            overlapArea(left.frame, preferredRect.cgRect) < overlapArea(right.frame, preferredRect.cgRect)
        }
    }

    let mainDisplayID = CGMainDisplayID()
    return content.displays.first(where: { $0.displayID == mainDisplayID }) ?? content.displays.first
}

private func loadShareableContent() -> SCShareableContent {
    let semaphore = DispatchSemaphore(value: 0)
    var content: SCShareableContent?
    var failure: String?

    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { result, error in
        content = result
        failure = error?.localizedDescription
        semaphore.signal()
    }

    guard semaphore.wait(timeout: .now() + 30) == .success else {
        fail("timed out while enumerating displays")
    }
    guard let content else {
        fail(failure ?? "unable to enumerate displays")
    }
    return content
}

private func startStream(_ stream: SCStream) {
    let semaphore = DispatchSemaphore(value: 0)
    var failure: String?
    stream.startCapture { error in
        failure = error?.localizedDescription
        semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 30) == .success else {
        fail("timed out while starting capture")
    }
    if let failure {
        fail("start capture failed: \(failure)")
    }
}

private func stopStream(_ stream: SCStream) {
    let semaphore = DispatchSemaphore(value: 0)
    var failure: String?
    stream.stopCapture { error in
        failure = error?.localizedDescription
        semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 30) == .success else {
        fail("timed out while stopping capture")
    }
    if let failure {
        fail("stop capture failed: \(failure)")
    }
}

@main
private struct SystemAudioCapture {
    static func main() {
        let arguments = parseArguments()
        let content = loadShareableContent()
        guard let display = selectDisplay(from: content, preferredRect: arguments.rect) else {
            fail("no capturable display found")
        }

        let outputURL = URL(fileURLWithPath: arguments.output).standardizedFileURL
        let parent = outputURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        } catch {
            fail("unable to create output directory: \(error.localizedDescription)")
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = 16
        configuration.height = 16
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 3
        configuration.showsCursor = false
        configuration.capturesAudio = true
        configuration.sampleRate = 16000
        configuration.channelCount = 1
        configuration.excludesCurrentProcessAudio = true

        let recordingConfiguration = SCRecordingOutputConfiguration()
        recordingConfiguration.outputURL = outputURL
        recordingConfiguration.videoCodecType = AVVideoCodecType.h264
        recordingConfiguration.outputFileType = AVFileType.mp4
        let recordingDelegate = RecordingDelegate()
        let recordingOutput = SCRecordingOutput(configuration: recordingConfiguration, delegate: recordingDelegate)
        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)

        do {
            try stream.addRecordingOutput(recordingOutput)
        } catch {
            fail("unable to add recording output: \(error.localizedDescription)")
        }

        startStream(stream)
        Thread.sleep(forTimeInterval: arguments.duration)
        stopStream(stream)

        guard recordingDelegate.wait(timeout: 30) else {
            fail("timed out while finalizing recording")
        }
        if let failure = recordingDelegate.failure {
            fail("recording failed: \(failure)")
        }
    }
}
