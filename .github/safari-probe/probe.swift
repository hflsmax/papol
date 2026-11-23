// Temporary: real input into real Safari, and the system cursor read back.
// Moves the actual pointer with CGEvents, double-clicks bare paper, and
// records which cursor macOS shows over a word and over bare paper before
// and after. A frozen cursor shows as the same cursor in both places.
import AppKit
import Foundation

_ = NSApplication.shared

func get(_ path: String) -> [String: Any]? {
  guard let url = URL(string: "http://127.0.0.1:5199/probe/\(path)"),
        let data = try? Data(contentsOf: url),
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
  return obj
}

func point(_ d: [String: Any], _ key: String) -> CGPoint {
  let p = d[key] as! [String: Any]
  return CGPoint(x: (p["x"] as! NSNumber).doubleValue, y: (p["y"] as! NSNumber).doubleValue)
}

func post(_ type: CGEventType, _ at: CGPoint, clicks: Int64 = 1) {
  let e = CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: type, mouseCursorPosition: at, mouseButton: .left)!
  e.setIntegerValueField(.mouseEventClickState, value: clicks)
  e.post(tap: .cghidEventTap)
}

func move(_ to: CGPoint) {
  // A few steps, as a hand would, so the page sees the pointer arrive.
  let from = CGEvent(source: nil)?.location ?? to
  for i in 1...8 {
    let t = Double(i) / 8
    post(.mouseMoved, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
    usleep(25_000)
  }
  usleep(500_000)
  let now = CGEvent(source: nil)?.location ?? .zero
  if abs(now.x - to.x) > 2 || abs(now.y - to.y) > 2 { print("  the pointer did not arrive: at \(now), wanted \(to)") }
}

func click(_ at: CGPoint) {
  post(.leftMouseDown, at); usleep(80_000)
  post(.leftMouseUp, at); usleep(300_000)
}

func doubleClick(_ at: CGPoint) {
  post(.leftMouseDown, at, clicks: 1); usleep(40_000)
  post(.leftMouseUp, at, clicks: 1); usleep(90_000)
  post(.leftMouseDown, at, clicks: 2); usleep(40_000)
  post(.leftMouseUp, at, clicks: 2)
  usleep(1_500_000)
}

func cursor() -> String {
  guard let c = NSCursor.currentSystem else { return "none" }
  var h: UInt64 = 1469598103934665603
  for b in c.image.tiffRepresentation ?? Data() { h = (h ^ UInt64(b)) &* 1099511628211 }
  return String(format: "hot(%.0f,%.0f) size(%.0fx%.0f) #%016llx", c.hotSpot.x, c.hotSpot.y, c.image.size.width, c.image.size.height, h)
}

func state() -> String {
  guard let s = get("state") else { return "no state" }
  let age = Int(Date().timeIntervalSince1970 * 1000) - ((s["at"] as? NSNumber)?.intValue ?? 0)
  return "age=\(age)ms pins=\(s["pins"] ?? "?") selected=\(s["selected"] ?? "?") actions=\(s["actions"] ?? "?") selecting=\(s["selecting"] ?? "?")"
}

// What this process may do, and what is on the screen.
print("trust: accessibility=\(AXIsProcessTrusted()) postEvents=\(CGPreflightPostEventAccess()) screen=\(CGPreflightScreenCaptureAccess())")
if let safari = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Safari").first {
  print("safari: active=\(safari.isActive) activate=\(safari.activate(options: [.activateAllWindows]))")
  sleep(2)
}
print("frontmost:", NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "none")
print("screen:", NSScreen.main?.frame ?? .zero)
for w in (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []) where (w[kCGWindowLayer as String] as? Int) == 0 {
  print("window:", w[kCGWindowOwnerName as String] ?? "?", w[kCGWindowName as String] ?? "", w[kCGWindowBounds as String] ?? "")
}

// The cursor as the screen shows it: the same patch of screen taken with
// and without the cursor drawn in; where they differ is the cursor, and
// its outline tells an arrow from an I-beam from a hand.
func grab(_ r: CGRect, cursor: Bool) -> NSBitmapImageRep? {
  let file = "/tmp/probe-\(cursor ? "c" : "n").png"
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  p.arguments = (cursor ? ["-C"] : []) + ["-x", "-R", "\(Int(r.minX)),\(Int(r.minY)),\(Int(r.width)),\(Int(r.height))", file]
  try? p.run(); p.waitUntilExit()
  guard let data = try? Data(contentsOf: URL(fileURLWithPath: file)) else { return nil }
  return NSBitmapImageRep(data: data)
}
func seen(_ at: CGPoint) -> String {
  let r = CGRect(x: at.x - 24, y: at.y - 24, width: 48, height: 48)
  guard let a = grab(r, cursor: true), let b = grab(r, cursor: false), a.pixelsWide == b.pixelsWide, a.pixelsHigh == b.pixelsHigh else { return "no capture" }
  var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1, n = 0
  for y in 0..<a.pixelsHigh { for x in 0..<a.pixelsWide {
    guard let ca = a.colorAt(x: x, y: y), let cb = b.colorAt(x: x, y: y) else { continue }
    if abs(ca.redComponent - cb.redComponent) + abs(ca.greenComponent - cb.greenComponent) + abs(ca.blueComponent - cb.blueComponent) > 0.15 {
      n += 1; minX = min(minX, x); minY = min(minY, y); maxX = max(maxX, x); maxY = max(maxY, y)
    }
  } }
  if n == 0 { return "drawn: nothing" }
  let scale = Double(a.pixelsWide) / 48
  return String(format: "drawn: %dx%d px, %d px changed", Int(Double(maxX - minX + 1) / scale), Int(Double(maxY - minY + 1) / scale), n)
}
func look(_ label: String, _ at: CGPoint) -> String {
  let c = cursor(), d = seen(at)
  print(label, c, "|", d)
  return d
}

var spots: [String: Any]? = nil
for _ in 0..<120 { spots = get("spots"); if spots != nil { break }; sleep(1) }
guard spots != nil else { print("RESULT no spots: the page never reported"); exit(0) }
sleep(3)
func fresh(_ key: String) -> CGPoint {
  let s = get("spots") ?? spots!
  if let p = s[key] as? [String: Any] { print("  \(key): screen (\(p["x"] ?? "?"), \(p["y"] ?? "?")) client \(p["client"] ?? "?") under \(p["under"] ?? "?")") }
  return point(s, key)
}
print("window", (get("spots") ?? spots!)["window"] ?? "?")

// A first click wakes the window: one Safari is not yet key keeps for itself.
let wake = fresh("bare"); move(wake); click(wake); sleep(1)
var p = fresh("word"); move(p); let w1 = look("before: over a word      ", p)
p = fresh("bare"); move(p); let b1 = look("before: over bare paper  ", p)
p = fresh("word"); move(p); let w2 = look("before: over a word again", p)
print("state before:", state())

p = fresh("bare2"); move(p); doubleClick(p)
print("double-clicked bare paper; state:", state())
sleep(1)

p = fresh("word"); move(p); let w3 = look("after: over a word       ", p)
p = fresh("bare"); move(p); let b3 = look("after: over bare paper   ", p)
p = fresh("word"); move(p); let w4 = look("after: over a word again ", p)

let liveBefore = w1 != b1 && w1 == w2
let liveAfter = w3 != b3 && w3 == w4
print("RESULT cursor follows the page before the double-click: \(liveBefore)")
print("RESULT cursor follows the page after the double-click:  \(liveAfter)")
print("RESULT the double-click dropped an anchor: \(state())")
