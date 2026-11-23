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
  let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: .left)!
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
}

func click(_ at: CGPoint) {
  post(.leftMouseDown, at); usleep(40_000)
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
  return "pins=\(s["pins"] ?? "?") selected=\(s["selected"] ?? "?") actions=\(s["actions"] ?? "?") selecting=\(s["selecting"] ?? "?")"
}

var spots: [String: Any]? = nil
for _ in 0..<120 { spots = get("spots"); if spots != nil { break }; sleep(1) }
guard let s = spots else { print("RESULT no spots: the page never reported"); exit(0) }
print("window", s["window"] ?? "?")
let word = point(s, "word"), bare = point(s, "bare"), bare2 = point(s, "bare2")
print("references: known cursors arrow=\(NSCursor.arrow.hotSpot) iBeam=\(NSCursor.iBeam.hotSpot) hand=\(NSCursor.pointingHand.hotSpot)")

// A first click wakes the window: one Safari is not yet key keeps for itself.
move(bare); click(bare); sleep(1)
move(word);  let w1 = cursor(); print("before: over a word      ", w1)
move(bare);  let b1 = cursor(); print("before: over bare paper  ", b1)
move(word);  let w2 = cursor(); print("before: over a word again", w2)
print("state before:", state())

move(bare2); doubleClick(bare2)
print("double-clicked bare paper; state:", state())

move(word);  let w3 = cursor(); print("after: over a word       ", w3)
move(bare);  let b3 = cursor(); print("after: over bare paper   ", b3)
move(word);  let w4 = cursor(); print("after: over a word again ", w4)

let liveBefore = w1 != b1 && w1 == w2
let liveAfter = w3 == w1 && b3 == b1 && w4 == w1
print("RESULT cursor follows the page before the double-click: \(liveBefore)")
print("RESULT cursor follows the page after the double-click:  \(liveAfter)")
