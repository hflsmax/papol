#!/usr/bin/env swift
//
// Drive Papol macOS from the outside, by the names of the things on screen.
//
//   xcrun swift papol-ui.swift windows
//   xcrun swift papol-ui.swift dev                    the development build's pid
//   xcrun swift papol-ui.swift dump <pid>
//   xcrun swift papol-ui.swift roles <pid>
//   xcrun swift papol-ui.swift find <pid> "Share"
//   xcrun swift papol-ui.swift wait <pid> "Share" --timeout 20
//   xcrun swift papol-ui.swift gone <pid> "Stop sharing"
//   xcrun swift papol-ui.swift press <pid> "Not now"
//   xcrun swift papol-ui.swift shot <pid> /tmp/papol.png
//
// Apple ships no WebDriver for WKWebView, so the usual desktop test drivers
// do not work here. The accessibility API does: WebKit publishes the page as
// real elements — AXButton, AXTextField, AXStaticText, each with the name a
// reader sees — and pressing one runs the same handler a click would. That
// works against the application as shipped, with no plugin compiled in, no
// debug build, and no development server.
//
// Three things are easy to get wrong and worth stating:
//
//   * AppleScript's System Events cannot see any of this. Its `entire
//     contents` stops at the web area and reports a handful of unnamed
//     groups, which reads exactly like a webview that publishes nothing.
//     The API below walks straight in.
//
//   * `screencapture -R` captures a rectangle of the screen, not a window,
//     so whatever sits on top is what lands in the file. `shot` raises the
//     window first.
//
//   * An absent window and an absent control read the same to a caller that
//     only greps output, so every command here reports absence in its exit
//     status: 3 for a window that is not there, 4 for a page that named
//     nothing, 1 for a control that is missing. A harness that checks the
//     status cannot mistake a closed window for a passing assertion.
//
// A reader's own Papol is not a test fixture. `press` and `shot` refuse a
// pid belonging to an installed build unless PAPOL_UI_ALLOW_INSTALLED=1;
// `dev` names the development build alone, and is what automation should
// use to find its target.
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

// MARK: - finding

func matches(_ text: String, _ wanted: String, contains: Bool) -> Bool {
    contains ? text.localizedCaseInsensitiveContains(wanted) : text == wanted
}

/// The first element whose name matches. `pressableOnly` skips static text,
/// which carries a name but does nothing when pressed; assertions want it,
/// presses never do.
func findElement(
    _ pid: pid_t, named wanted: String, contains: Bool, pressableOnly: Bool
) -> AXUIElement? {
    guard let window = windows(of: pid).first else { return nil }
    var match: AXUIElement?
    walk(window) { element, _ in
        if match != nil { return false }
        if let text = name(of: element), matches(text, wanted, contains: contains),
           !(pressableOnly && role(of: element) == "AXStaticText") {
            match = element
            return false
        }
        return true
    }
    return match
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

/// The development build's pid, and nothing else. Automation asks for this
/// rather than picking the first Papol it finds, so a reader's own copy is
/// never what gets driven.
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
        return 3
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
        return 4
    }
    return 0
}

/// What roles the page actually published. A control is easy to miss by
/// searching for the role you expected — a button carrying
/// aria-haspopup="menu" arrives as AXPopUpButton, not AXButton — so counting
/// them is the first thing to do before believing something is absent.
func roles(_ pid: pid_t) -> Int32 {
    guard let window = windows(of: pid).first else {
        print("pid \(pid) has no window")
        return 3
    }
    var counts: [String: Int] = [:]
    walk(window) { element, _ in
        if name(of: element) != nil { counts[role(of: element), default: 0] += 1 }
        return true
    }
    if counts.isEmpty {
        print("nothing named — the window may still be loading")
        return 4
    }
    for (role, count) in counts.sorted(by: { ($0.value, $1.key) > ($1.value, $0.key) }) {
        print("\(String(format: "%4d", count)) \(role)")
    }
    return 0
}

func find(_ pid: pid_t, named wanted: String, contains: Bool, pressable: Bool) -> Int32 {
    guard windows(of: pid).first != nil else { print("pid \(pid) has no window"); return 3 }
    guard let element = findElement(pid, named: wanted, contains: contains, pressableOnly: pressable)
    else {
        print("no element named \(wanted)")
        return 1
    }
    print("\(role(of: element))\t\(name(of: element) ?? "")")
    return 0
}

func wait(
    _ pid: pid_t, named wanted: String, contains: Bool, pressable: Bool,
    seconds: Double, until present: Bool
) -> Int32 {
    let deadline = Date().addingTimeInterval(seconds)
    repeat {
        // A window that has gone away is not an assertion that passed: say so
        // rather than reporting the control as absent.
        if windows(of: pid).first == nil, present {
            Thread.sleep(forTimeInterval: 0.25)
            continue
        }
        let element = findElement(pid, named: wanted, contains: contains, pressableOnly: pressable)
        if (element != nil) == present {
            if let element, let text = name(of: element) {
                print("\(role(of: element))\t\(text)")
            } else {
                print("gone: \(wanted)")
            }
            return 0
        }
        Thread.sleep(forTimeInterval: 0.25)
    } while Date() < deadline
    print(present
        ? "waited \(seconds)s and never saw \(wanted)"
        : "waited \(seconds)s and \(wanted) was still there")
    return 1
}

func press(_ pid: pid_t, named wanted: String, contains: Bool) -> Int32 {
    refuseInstalled(pid, "press things in")
    guard windows(of: pid).first != nil else { print("pid \(pid) has no window"); return 3 }
    guard let element = findElement(pid, named: wanted, contains: contains, pressableOnly: true)
    else {
        print("no element named \(wanted) — run `dump \(pid)` to see what is there")
        return 1
    }
    // Read what it is before pressing it. A press that dismisses a dialog
    // takes the element with it, and asking afterwards answers nothing.
    let kind = role(of: element)
    let label = name(of: element) ?? wanted
    let status = AXUIElementPerformAction(element, kAXPressAction as CFString)
    guard status == .success else {
        print("pressing \(kind) \(label) failed (AXError \(status.rawValue))")
        return 1
    }
    print("pressed \(kind) \(label)")
    return 0
}

func shot(_ pid: pid_t, to path: String) -> Int32 {
    refuseInstalled(pid, "raise and capture")
    guard let window = windows(of: pid).first else { print("pid \(pid) has no window"); return 3 }
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

var arguments = Array(CommandLine.arguments.dropFirst())

/// Flags may sit anywhere after the command, so that a name containing a
/// dash is still just a name.
func takeFlag(_ flag: String) -> Bool {
    guard let index = arguments.firstIndex(of: flag) else { return false }
    arguments.remove(at: index)
    return true
}

func takeValue(_ flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else {
        return nil
    }
    let value = arguments[index + 1]
    arguments.removeSubrange(index...(index + 1))
    return value
}

let contains = takeFlag("--contains")
let pressable = takeFlag("--pressable")
let timeout = Double(takeValue("--timeout") ?? "") ?? 15

func requirePid(_ index: Int) -> pid_t {
    guard arguments.count > index, let pid = pid_t(arguments[index]) else {
        print("that command needs a pid; `windows` lists them, `dev` names the development build")
        exit(2)
    }
    return pid
}

func requireName(_ index: Int, _ what: String) -> String {
    guard arguments.count > index else { print(what); exit(2) }
    return arguments[index]
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
case "find":
    let pid = requirePid(1)
    let wanted = requireName(2, "find needs a pid and a name")
    exit(find(pid, named: wanted, contains: contains, pressable: pressable))
case "wait":
    let pid = requirePid(1)
    let wanted = requireName(2, "wait needs a pid and a name")
    exit(wait(pid, named: wanted, contains: contains, pressable: pressable,
              seconds: timeout, until: true))
case "gone":
    let pid = requirePid(1)
    let wanted = requireName(2, "gone needs a pid and a name")
    exit(wait(pid, named: wanted, contains: contains, pressable: pressable,
              seconds: timeout, until: false))
case "press":
    let pid = requirePid(1)
    exit(press(pid, named: requireName(2, "press needs a pid and a name"), contains: contains))
case "shot":
    let pid = requirePid(1)
    exit(shot(pid, to: requireName(2, "shot needs a pid and a file")))
default:
    print("""
    papol-ui — drive Papol macOS by the names of things on screen

      windows              every running Papol, which build it is, and its windows
      dev                  the development build's pid, and only that
      dump <pid>           every named element in its first window
      roles <pid>          how many elements of each role the page published
      find <pid> <name>    report one element's role, or exit 1 if it is absent
      wait <pid> <name>    poll until it appears (exit 1 if it never does)
      gone <pid> <name>    poll until it is no longer there
      press <pid> <name>   press the element with that name
      shot <pid> <file>    raise the window and capture it

    --contains    match any name containing the text, rather than all of it
    --pressable   ignore static text, which carries a name but does nothing
    --timeout N   how long `wait` and `gone` keep asking (default 15s)

    Names match exactly unless --contains is given. Reach for it sparingly: a
    search for "Share" that contains rather than equals finds a reader called
    A. Sharer first, and then nothing works and the page looks broken.

    Exit status: 1 absent, 2 misuse or a refusal, 3 no window, 4 nothing named.
    """)
}
