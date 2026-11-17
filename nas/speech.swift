// Gearizo Speech: word timings of a voice-over, with the Mac's own speech recognition.
//   GearizoSpeech.app/Contents/MacOS/GearizoSpeech <audio> <out.json> [locale, e.g. en-US | ms-MY | zh-CN]
// Run through `open -W -a GearizoSpeech.app --args ...` so macOS asks for "Speech Recognition" once, for this app.
// Writes {"ok":true,"onDevice":bool,"words":[{"w":"tyres","s":0.12,"e":0.48}]} or {"ok":false,"error":"..."}.
import Foundation
import Speech

let args = CommandLine.arguments
func finish(_ obj: [String: Any]) -> Never {
  if args.count > 2, let d = try? JSONSerialization.data(withJSONObject: obj) { try? d.write(to: URL(fileURLWithPath: args[2])) }
  exit(0)
}
guard args.count > 2 else { print("usage: GearizoSpeech <audio> <out.json> [locale]"); exit(2) }
let locale = Locale(identifier: args.count > 3 ? args[3] : "en-US")
DispatchQueue.main.asyncAfter(deadline: .now() + 600) { finish(["ok": false, "error": "timed out"]) }
SFSpeechRecognizer.requestAuthorization { st in
  guard st == .authorized else { finish(["ok": false, "error": "Speech Recognition is not allowed for Gearizo Speech (System Settings → Privacy & Security → Speech Recognition)", "auth": st.rawValue]) }
  guard let r = SFSpeechRecognizer(locale: locale), r.isAvailable else { finish(["ok": false, "error": "no speech recognition for " + locale.identifier]) }
  let req = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: args[1]))
  req.requiresOnDeviceRecognition = r.supportsOnDeviceRecognition
  req.shouldReportPartialResults = false
  req.taskHint = .dictation
  if #available(macOS 13, *) { req.addsPunctuation = false }
  var words: [[String: Any]] = []
  var last = 0.0
  r.recognitionTask(with: req) { res, err in
    if let res = res {
      // long files arrive in pieces: keep each piece's words
      for s in res.bestTranscription.segments where s.timestamp + 0.001 >= last || res.isFinal {
        _ = s
      }
      if res.isFinal {
        for s in res.bestTranscription.segments { words.append(["w": s.substring, "s": s.timestamp, "e": s.timestamp + s.duration]) }
        last = words.last.flatMap { $0["e"] as? Double } ?? last
        finish(["ok": true, "onDevice": req.requiresOnDeviceRecognition, "words": words])
      }
    } else if let err = err {
      finish(["ok": false, "error": err.localizedDescription])
    }
  }
}
dispatchMain()
