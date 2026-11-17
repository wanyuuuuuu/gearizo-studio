// Gearizo Speech: word timings of a voice-over, with the Mac's own speech recognition.
//   GearizoSpeech <out.json> <locale e.g. en-US | ms-MY | zh-CN> <audio>[@offset] [<audio>[@offset] ...]
// Long recordings are cut into short pieces first (gz_edit.recognise does that) because the recogniser only
// reports the last sentence of a long file; each piece's words are shifted by its offset (seconds).
// Run through `open -W -n -a GearizoSpeech.app --args ...` so macOS asks for "Speech Recognition" once, for this app.
// Writes {"ok":true,"onDevice":bool,"words":[{"w":"tyres","s":0.12,"e":0.48}]} or {"ok":false,"error":"..."}.
import Foundation
import Speech

let args = CommandLine.arguments
func finish(_ obj: [String: Any]) -> Never {
  if args.count > 1, let d = try? JSONSerialization.data(withJSONObject: obj) { try? d.write(to: URL(fileURLWithPath: args[1])) }
  exit(0)
}
guard args.count > 3 else { print("usage: GearizoSpeech <out.json> <locale> <audio>[@offset] ..."); exit(2) }
let locale = Locale(identifier: args[2])
let pieces: [(String, Double)] = args.dropFirst(3).map { a in
  if let at = a.range(of: "@", options: .backwards), let off = Double(a[at.upperBound...]) { return (String(a[..<at.lowerBound]), off) }
  return (a, 0)
}
DispatchQueue.main.asyncAfter(deadline: .now() + 1200) { finish(["ok": false, "error": "timed out"]) }
var words: [[String: Any]] = []
var onDevice = false
var task: SFSpeechRecognitionTask?

func run(_ r: SFSpeechRecognizer, _ i: Int) {
  if i >= pieces.count { finish(["ok": true, "onDevice": onDevice, "words": words]) }
  let (path, off) = pieces[i]
  let req = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
  req.requiresOnDeviceRecognition = r.supportsOnDeviceRecognition
  onDevice = req.requiresOnDeviceRecognition
  req.shouldReportPartialResults = false
  req.taskHint = .dictation
  if #available(macOS 13, *) { req.addsPunctuation = false }
  var done = false
  var got: [[String: Any]] = []
  task = r.recognitionTask(with: req) { res, err in
    if done { return }
    if let res = res {
      // keep every sentence the recogniser hands over, not just the last one
      let segs = res.bestTranscription.segments.map { ["w": $0.substring, "s": $0.timestamp + off, "e": $0.timestamp + $0.duration + off] as [String: Any] }
      if let first = segs.first?["s"] as? Double, let lastEnd = got.last?["e"] as? Double, first >= lastEnd - 0.05 { words += got }
      got = segs
      if res.isFinal { done = true; words += got; DispatchQueue.main.async { run(r, i + 1) } }
    } else if err != nil {
      done = true; words += got                       // nothing heard in this piece: go on
      DispatchQueue.main.async { run(r, i + 1) }
    }
  }
}

SFSpeechRecognizer.requestAuthorization { st in
  guard st == .authorized else { finish(["ok": false, "error": "Speech Recognition is not allowed for Gearizo Speech (System Settings → Privacy & Security → Speech Recognition)", "auth": st.rawValue]) }
  guard let r = SFSpeechRecognizer(locale: locale), r.isAvailable else { finish(["ok": false, "error": "no speech recognition for " + locale.identifier]) }
  DispatchQueue.main.async { run(r, 0) }
}
dispatchMain()
