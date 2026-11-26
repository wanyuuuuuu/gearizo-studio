// Gearizo: turn each page of a PDF into a JPEG, so a PDF dropped in NAS Checking can be reviewed page by page.
// Uses macOS's own PDF renderer (CoreGraphics), no extra tools.
//   swiftc -O pdfpages.swift -o pdfpages        (nas_sync does this by itself when the binary is missing or older)
//   ./pdfpages <in.pdf> <out dir> [max pages=30] [width px=2000]
// Prints JSON: {"total": pages in the PDF, "files": [written paths]} or {"error": "..."}.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

func fail(_ msg: String) -> Never {
    print("{\"error\": \"\(msg)\"}")
    exit(1)
}

let a = CommandLine.arguments
guard a.count >= 3 else { fail("usage: pdfpages in.pdf outdir [maxPages] [width]") }
guard let doc = CGPDFDocument(URL(fileURLWithPath: a[1]) as CFURL) else { fail("cannot open the PDF") }
if doc.isEncrypted && !doc.isUnlocked { fail("the PDF is password protected") }
let maxPages = a.count > 3 ? (Int(a[3]) ?? 30) : 30
let target = a.count > 4 ? (Double(a[4]) ?? 2000) : 2000
let outDir = URL(fileURLWithPath: a[2])
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

var written: [String] = []
let total = doc.numberOfPages
if total > 0 {
    for i in 1...min(total, maxPages) {
        guard let page = doc.page(at: i) else { continue }
        let box = page.getBoxRect(.cropBox)
        var w = Double(box.width), h = Double(box.height)
        if abs(page.rotationAngle) % 180 == 90 { swap(&w, &h) }
        if w < 1 || h < 1 { continue }
        // About `target` px wide; never more than 4x, 10000 px tall or 40 megapixels.
        var scale = min(target / w, 4.0)
        scale = min(scale, 10000 / h, (40_000_000 / (w * h)).squareRoot())
        let pw = max(1, Int(w * scale)), ph = max(1, Int(h * scale))
        guard let ctx = CGContext(data: nil, width: pw, height: ph, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { continue }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: pw, height: ph))
        ctx.interpolationQuality = .high
        ctx.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
        // getDrawingTransform never enlarges, so draw at 1:1 into a w x h box and let the scale above enlarge it
        ctx.concatenate(page.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: w, height: h), rotate: 0, preserveAspectRatio: true))
        ctx.drawPDFPage(page)
        guard let img = ctx.makeImage() else { continue }
        let url = outDir.appendingPathComponent(String(format: "page-%03d.jpg", i))
        guard let dst = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { continue }
        CGImageDestinationAddImage(dst, img, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        if CGImageDestinationFinalize(dst) { written.append(url.path) }
    }
}
let data = try! JSONSerialization.data(withJSONObject: ["total": total, "files": written])
print(String(data: data, encoding: .utf8)!)
