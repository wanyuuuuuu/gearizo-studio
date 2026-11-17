// Gearizo: cut the subject out of a picture (product photo on a white background, etc.) with macOS's own
// Vision "lift subject" (the same as Photos → Copy Subject). Writes a PNG with a transparent background,
// cropped to the subject. macOS 14+.
//   swiftc -O cutout.swift -o cutout        (once)
//   ./cutout <in.jpg|png> <out.png>
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: cutout <in> <out.png>"); exit(2) }
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { print("cannot read image"); exit(1) }
let req = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do { try handler.perform([req]) } catch { print("vision failed: \(error)"); exit(1) }
guard let obs = req.results?.first, !obs.allInstances.isEmpty else { print("no subject found"); exit(1) }
let buf: CVPixelBuffer
do { buf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: true) }
catch { print("mask failed: \(error)"); exit(1) }
let ci = CIImage(cvPixelBuffer: buf)
let ctx = CIContext()
guard let out = ctx.createCGImage(ci, from: ci.extent, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!) else { print("render failed"); exit(1) }
guard let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil) else { print("cannot write"); exit(1) }
CGImageDestinationAddImage(dst, out, nil)
guard CGImageDestinationFinalize(dst) else { print("cannot write"); exit(1) }
print("ok \(out.width)x\(out.height)")
