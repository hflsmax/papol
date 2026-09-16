#!/usr/bin/env swift
//
// Look at Papol macOS from the outside, by the names of the things on screen.
//
//   xcrun swift papol-ui.swift windows
//   xcrun swift papol-ui.swift dev                    the development build's pid
//   xcrun swift papol-ui.swift dump <pid>
//   xcrun swift papol-ui.swift roles <pid>
//   xcrun swift papol-ui.swift press <pid> "Not now"
//   xcrun swift papol-ui.swift shot <pid> /tmp/papol.png
//
// This is an instrument for looking at a running application by hand, not a
// test harness. Driving the whole feature from out here was tried and thrown
// away: the suite spent its failures on itself — the wrong name, the wrong
// role, a window that had gone — and what it was meant to be watching is
// better stated further down, where the answer is a value rather than a
// rendering of one.
//
// Apple ships no WebDriver for WKWebView, so the usual desktop drivers do not
// work here. The accessibility API does: WebKit publishes the page as real
// elements — AXButton, AXTextField, AXStaticText, each with the name a reader
// sees — and pressing one runs the same handler a click would. That works
// against the application as shipped, with no plugin compiled in, no debug
// build, and no development server.
//
// Three things are easy to get wrong and worth stating:
//
//   * AppleScript's System Events cannot see any of this. Its `entire
//     contents` stops at the web area and reports a handful of unnamed
//     groups, which reads exactly like a webview that publishes nothing.
//     The API below walks straight in.
//
//   * A control is easy to miss by looking for the role you expected. A
//     button carrying aria-haspopup="menu" arrives as AXPopUpButton, not
//     AXButton, which reads exactly like a control that never rendered.
//     `roles` counts what the page actually published; ask it first.
//
//   * `screencapture -R` captures a rectangle of the screen, not a window,
//     so whatever sits on top is what lands in the file. `shot` raises the
//     window first.
//
// A reader's own Papol is not a fixture. `press` and `shot` refuse a pid
// belonging to an installed build unless PAPOL_UI_ALLOW_INSTALLED=1, and
// `dev` names the development build alone.
//
// Requires Accessibility permission for whatever runs it: System Settings →
// Privacy & Security → Accessibility.

import ApplicationServices
import Foundation

let executable = "papol-desktop"

// MARK: - walking

func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value as? T
}

func role(of element: AXUIElement) -> String {
    attribute(element, kAXRoleAttribute as String) ?? "?"
}

/// What a reader would call this element. WebKit puts a control's label in
/// the title, static text in the value, and an image's alternative text in
/// the description, so all three are worth asking for.
func name(of element: AXUIElement) -> String? {
    for key in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
        if let text: String = attribute(element, key as String),
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return text
        }
    }
    return nil
}

func walk(_ element: AXUIElement, depth: Int = 0, visit: (AXUIElement, Int) -> Bool) {
    if depth > 40 || !visit(element, depth) { return }
    let children: [AXUIElement] = attribute(element, kAXChildrenAttribute as String) ?? []
    for child in children { walk(child, depth: depth + 1, visit: visit) }
}

func windows(of pid: pid_t) -> [AXUIElement] {
    attribute(AXUIElementCreateApplication(pid), kAXWindowsAttribute as String) ?? []
}

func run(_ tool: String, _ arguments: [String]) -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: tool)
    process.arguments = arguments
    let pipe = Pipe()
    process.standardOutput = pipe
    try? process.run()
    process.waitUntilExit()
    let output = String(
        data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    return output.trimmingCharacters(in: .whitespacesAndNewlines)
}

func processes() -> [pid_t] {
    run("/usr/bin/pgrep", ["-x", executable])
        .split(separator: "\n")
        .compactMap { pid_t($0.trimmingCharacters(in: .whitespaces)) }
}

/// Which build a pid belongs to. A development run executes out of the
/// build directory; anything living in /Applications is somebody's Papol,
/// with their papers in it.
func isInstalled(_ pid: pid_t) -> Bool {
    run("/bin/ps", ["-p", "\(pid)", "-o", "comm="]).contains("/Applications/")
}

func describe(_ pid: pid_t) -> String {
    isInstalled(pid) ? "installed" : "development"
}

func refuseInstalled(_ pid: pid_t, _ what: String) {
    guard isInstalled(pid),
          ProcessInfo.processInfo.environment["PAPOL_UI_ALLOW_INSTALLED"] != "1" else { return }
    print("""
    refusing to \(what) pid \(pid): it is an installed Papol, with a reader's \
    own papers in it. Use `dev` to find the development build, or set \
    PAPOL_UI_ALLOW_INSTALLED=1 if you really mean this one.
    """)
    exit(2)
}

// MARK: - commands

func listWindows() {
    let running = processes()
    if running.isEmpty { print("no \(executable) process is running"); return }
    for pid in running {
        let titles = windows(of: pid)
            .map { (attribute($0, kAXTitleAttribute as String) ?? "untitled") as String }
        print("pid \(pid) (\(describe(pid))): \(titles.isEmpty ? "no windows" : titles.joined(separator: " | "))")
    }
}

/// The development build's pid, and nothing else, so that a command meant
/// for it is never aimed at a reader's own copy by accident.
func developmentPid() -> Int32 {
    let candidates = processes().filter { !isInstalled($0) }
    switch candidates.count {
    case 0:
        print("no development Papol is running — start one with `./deploy.sh macos dev`")
        return 1
    case 1:
        print("\(candidates[0])")
        return 0
    default:
        print("several development builds are running: \(candidates.map(String.init).joined(separator: ", "))")
        return 1
    }
}

func dump(_ pid: pid_t) -> Int32 {
    guard let window = windows(of: pid).first else {
        print("pid \(pid) has no window")
        return 1
    }
    var found = 0
    walk(window) { element, depth in
        if let text = name(of: element) {
            found += 1
            let indent = String(repeating: "  ", count: min(depth, 12))
            print("\(indent)\(role(of: element)): \(text.prefix(70))")
        }
        return true
    }
    if found == 0 {
        print("nothing named — the window may still be loading")
        return 1
    }
    return 0
}

/// What roles the page actually published, most common first. Worth a look
/// before believing a control is missing: the name you remember may be
/// published under a role you did not expect.
func roles(_ pid: pid_t) -> Int32 {
    guard let window = windows(of: pid).first else {
        print("pid \(pid) has no window")
        return 1
    }
    var counts: [String: Int] = [:]
    walk(window) { element, _ in
        if name(of: element) != nil { counts[role(of: element), default: 0] += 1 }
        return true
    }
    if counts.isEmpty {
        print("nothing named — the window may still be loading")
        return 1
    }
    for (role, count) in counts.sorted(by: { ($0.value, $1.key) > ($1.value, $0.key) }) {
        print("\(String(format: "%4d", count)) \(role)")
    }
    return 0
}

func find(_ pid: pid_t, named wanted: String) -> AXUIElement? {
    guard let window = windows(of: pid).first else { return nil }
    var match: AXUIElement?
    walk(window) { element, _ in
        if match != nil { return false }
        if name(of: element) == wanted, role(of: element) != "AXStaticText" {
            match = element
            return false
        }
        return true
    }
    return match
}

func press(_ pid: pid_t, named wanted: String) -> Int32 {
    refuseInstalled(pid, "press things in")
    guard let element = find(pid, named: wanted) else {
        print("no element named \(wanted) — run `dump \(pid)` to see what is there")
        return 1
    }
    // Read what it is before pressing it. A press that dismisses a dialog
    // takes the element with it, and asking afterwards answers nothing.
    let kind = role(of: element)
    let status = AXUIElementPerformAction(element, kAXPressAction as CFString)
    guard status == .success else {
        print("pressing \(kind) \(wanted) failed (AXError \(status.rawValue))")
        return 1
    }
    print("pressed \(kind) \(wanted)")
    return 0
}

func shot(_ pid: pid_t, to path: String) -> Int32 {
    refuseInstalled(pid, "raise and capture")
    guard let window = windows(of: pid).first else { print("pid \(pid) has no window"); return 1 }
    // Raising first is the whole point: the capture below takes a rectangle
    // of the screen, and an occluded window would hand back the wrong app.
    AXUIElementSetAttributeValue(
        AXUIElementCreateApplication(pid), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    Thread.sleep(forTimeInterval: 0.6)

    var originValue: CFTypeRef?
    var sizeValue: CFTypeRef?
    AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &originValue)
    AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeValue)
    var origin = CGPoint.zero
    var size = CGSize.zero
    guard let originValue, let sizeValue,
          AXValueGetValue(originValue as! AXValue, .cgPoint, &origin),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else {
        print("could not read the window's geometry")
        return 1
    }
    let capture = Process()
    capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    capture.arguments = [
        "-x", "-R",
        "\(Int(origin.x)),\(Int(origin.y)),\(Int(size.width)),\(Int(size.height))",
        path,
    ]
    try? capture.run()
    capture.waitUntilExit()
    print("captured \(Int(size.width))x\(Int(size.height)) to \(path)")
    return capture.terminationStatus
}

// MARK: - arguments

let arguments = Array(CommandLine.arguments.dropFirst())
func requirePid(_ index: Int) -> pid_t {
    guard arguments.count > index, let pid = pid_t(arguments[index]) else {
        print("that command needs a pid; `windows` lists them, `dev` names the development build")
        exit(2)
    }
    return pid
}

switch arguments.first {
case "windows":
    listWindows()
case "dev":
    exit(developmentPid())
case "dump":
    exit(dump(requirePid(1)))
case "roles":
    exit(roles(requirePid(1)))
case "press":
    guard arguments.count > 2 else { print("press needs a pid and a name"); exit(2) }
    exit(press(requirePid(1), named: arguments[2]))
case "shot":
    guard arguments.count > 2 else { print("shot needs a pid and a file"); exit(2) }
    exit(shot(requirePid(1), to: arguments[2]))
default:
    print("""
    papol-ui — look at Papol macOS by the names of things on screen

      windows              every running Papol, which build it is, and its windows
      dev                  the development build's pid, and only that
      dump <pid>           every named element in its first window
      roles <pid>          how many elements of each role the page published
      press <pid> <name>   press the element with that name
      shot <pid> <file>    raise the window and capture it
    """)
}
