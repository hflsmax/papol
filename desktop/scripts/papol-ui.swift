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
// One check does drive it, and stays narrow for that reason:
// test-native-ui-e2e.py asks the window whether the app came up, took a
// sign-in, and listed one paper, and reads everything else from the
// replica. That is the part no value further down can answer — that there
// is a window at all — and it is the whole of what a window is asked here.
//
// Apple ships no WebDriver for WKWebView, so the usual desktop drivers do not
// work here. The accessibility API does: WebKit publishes the page as real
// elements — AXButton, AXTextField, AXStaticText, each with the name a user
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
// A user's own Papol is not a fixture. `press` and `shot` refuse a pid
// belonging to an installed build unless PAPOL_UI_ALLOW_INSTALLED=1, and
// `dev` names the development build alone.
//
// Requires Accessibility permission for whatever runs it: System Settings →
// Privacy & Security → Accessibility.

import AppKit
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

/// What a user would call this element. WebKit puts a control's label in
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
    refusing to \(what) pid \(pid): it is an installed Papol, with a user's \
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
/// for it is never aimed at a user's own copy by accident.
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

/// The element with that name, optionally of a named role.
///
/// A page repeats a word freely: this application publishes "Sign in" as
/// the link that navigates there, twice as the heading above the form, and
/// as the button that submits it. Taking the first match means taking the
/// link, and pressing it reloads the form the caller meant to submit —
/// which looks like a submit that silently did nothing. Pass a role when
/// the name alone is ambiguous; `dump` shows which roles are in play.
func find(_ pid: pid_t, named wanted: String, role wantedRole: String? = nil) -> AXUIElement? {
    guard let window = windows(of: pid).first else { return nil }
    var match: AXUIElement?
    walk(window) { element, _ in
        if match != nil { return false }
        let kind = role(of: element)
        guard name(of: element) == wanted, kind != "AXStaticText" else { return true }
        if let wantedRole, kind != wantedRole { return true }
        match = element
        return false
    }
    return match
}

/// Every role a name is published under, so an ambiguous one can say so
/// rather than quietly picking the first.
func rolesNamed(_ pid: pid_t, _ wanted: String) -> [String] {
    guard let window = windows(of: pid).first else { return [] }
    var found: [String] = []
    walk(window) { element, _ in
        let kind = role(of: element)
        if name(of: element) == wanted, kind != "AXStaticText" { found.append(kind) }
        return true
    }
    return found
}

func press(_ pid: pid_t, named wanted: String, role wantedRole: String? = nil) -> Int32 {
    refuseInstalled(pid, "press things in")
    let published = rolesNamed(pid, wanted)
    if wantedRole == nil, Set(published).count > 1 {
        print("""
        \(wanted) is published as \(published.joined(separator: ", ")) — say which \
        one, as `press \(pid) "\(wanted)" \(published.last ?? "AXButton")`
        """)
        return 1
    }
    guard let element = find(pid, named: wanted, role: wantedRole) else {
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

/// Type into a named field, as a keyboard does.
///
/// Setting a field's value through the accessibility API is the obvious
/// thing and it does not work: the attribute is written, `AXUIElement`
/// reports success, and React never hears about it, because nothing
/// dispatched the input event its onChange is waiting for. The field ends
/// up empty and the API says it did not. Real key events go through the
/// webview's normal input path instead, so the page cannot tell them from
/// a person typing. Posting them is what Accessibility permission is for.
///
/// The unicode string is set on each event rather than mapping characters
/// to key codes, so this does not depend on the layout the user happens to
/// have — an `@` arrives as `@` on a keyboard that has it somewhere else.
func typeText(_ pid: pid_t, into wanted: String, text: String) -> Int32 {
    refuseInstalled(pid, "type into")
    guard let field = find(pid, named: wanted) else {
        print("no element named \(wanted) — run `dump \(pid)` to see what is there")
        return 1
    }
    // Keys go to whatever is frontmost and focused, not to the element we
    // just found, so both have to be arranged before sending any. Posting
    // straight to the process was tried instead and does not arrive: a
    // webview takes key events through the ordinary responder chain, which
    // means through being the active application.
    AXUIElementSetAttributeValue(
        AXUIElementCreateApplication(pid), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    if let window = windows(of: pid).first {
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        // Raising a window makes it the main one, which is not the same as
        // giving it the keyboard. A window that is main but not focused
        // takes no key events at all, and the application still answers
        // that it is frontmost — so this reads as a page ignoring what was
        // typed rather than as a window that never had the caret.
        AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
    }
    NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows])
    Thread.sleep(forTimeInterval: 0.6)
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
    guard front == pid else {
        print("""
        pid \(pid) would not come to the front (\(front.map(String.init) ?? "nothing") is \
        there), and a keystroke goes to whichever application is — refusing \
        rather than typing this into someone else's window
        """)
        return 1
    }
    // Ask for focus twice over, then check. Setting the attribute is what
    // WebKit documents; pressing the field is what a pointer would do, and
    // one of the two takes where the other does not. Clicking by screen
    // coordinate was tried and is worse: the position is right, but a
    // window with no rendered surface does not receive the click, and it
    // lands on whatever the display has at that point instead — here, the
    // navigation, which quietly took the page somewhere else.
    AXUIElementSetAttributeValue(field, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    AXUIElementPerformAction(field, kAXPressAction as CFString)
    Thread.sleep(forTimeInterval: 0.35)
    let focused: Bool = attribute(field, kAXFocusedAttribute as String) ?? false
    guard focused else {
        print("""
        \(wanted) would not take focus, so anything typed would go to whatever \
        holds the caret instead — refusing rather than typing into the dark
        """)
        return 1
    }

    guard let source = CGEventSource(stateID: .hidSystemState) else {
        print("could not create an event source")
        return 1
    }
    // Typing appends, so a field that already holds something ends up with
    // both — and the result reads as a field that ignored the focus rather
    // than one that kept its old contents. Select what is there first and
    // let the first keystroke replace it. Clearing through the value
    // attribute instead would be invisible to React, exactly as writing the
    // text that way is.
    if let selectAllDown = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
       let selectAllUp = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) {
        selectAllDown.flags = .maskCommand
        selectAllUp.flags = .maskCommand
        selectAllDown.post(tap: .cghidEventTap)
        selectAllUp.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.1)
    }
    for character in text {
        var utf16 = Array(String(character).utf16)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
            print("could not create a key event")
            return 1
        }
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        // A new event takes its modifiers from the source's current state,
        // and the ⌘ from the select-all above is still "held" there until
        // the system has digested its key-up. On a loaded machine that is
        // later than the next event is made, and every character then goes
        // in with ⌘ on it: a "2" in an e-mail address becomes ⌘2, which is
        // the sidebar's Create account, and the form is gone. Say plainly
        // that these are unmodified keys.
        down.flags = []
        up.flags = []
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        // A webview coalesces events posted faster than it renders, and
        // drops characters when it does. This is slow enough to survive that.
        Thread.sleep(forTimeInterval: 0.02)
    }

    // Say what the field holds rather than that the keys were sent. What
    // was typed and what arrived are different claims, and only the second
    // one is worth anything. Posting a key is not the page having taken
    // it: the events queue and the page drains them as it renders, and on
    // a loaded machine a read straight after the last one found the first
    // half of an address and called the rest missing. So wait for the
    // value to arrive, and only then say what it is.
    let masked = { (value: String) in
        value.count == text.count && value.allSatisfy { !$0.isLetter && !$0.isNumber }
    }
    var arrived = ""
    let deadline = Date().addingTimeInterval(3)
    repeat {
        Thread.sleep(forTimeInterval: 0.1)
        arrived = attribute(field, kAXValueAttribute as String) ?? ""
    } while arrived != text && !masked(arrived) && Date() < deadline
    if arrived == text {
        print("typed \(text.count) characters into \(wanted)")
        return 0
    }
    // A password field publishes bullets rather than what it holds, so the
    // text can never be read back. Its length still can, and that is the
    // whole of what this is able to check — say so rather than imply the
    // characters were compared.
    if masked(arrived) {
        print("typed \(text.count) characters into \(wanted) (masked; length matches)")
        return 0
    }
    print("""
    typed into \(wanted), but it now holds \(arrived.isEmpty ? "nothing" : "\"\(arrived)\"") \
    rather than "\(text)" — the field may not have taken focus
    """)
    return 1
}

// MARK: - arguments

/// Without Accessibility permission every attribute read below fails, and
/// each command turns that into its own ordinary-looking answer: `windows`
/// says "no windows", `dump` says the window may still be loading. Both
/// read exactly like a running application that is simply empty. Say which
/// it is, once, before any of them can mislead.
func requireTrusted() {
    guard !AXIsProcessTrusted() else { return }
    print("""
    this process does not have Accessibility permission, so the API below \
    reports nothing at all — which is indistinguishable from an application \
    with no windows. Grant it to whatever runs this (the terminal, or the \
    editor hosting it) in System Settings → Privacy & Security → \
    Accessibility. macOS decides this once per process, so restart that \
    program afterwards; a running one keeps the answer it was given.
    """)
    exit(3)
}

let arguments = Array(CommandLine.arguments.dropFirst())
func requirePid(_ index: Int) -> pid_t {
    guard arguments.count > index, let pid = pid_t(arguments[index]) else {
        print("that command needs a pid; `windows` lists them, `dev` names the development build")
        exit(2)
    }
    return pid
}

switch arguments.first {
case "windows", "dev", "dump", "roles", "press", "shot", "type":
    requireTrusted()
default:
    break
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
    exit(press(requirePid(1), named: arguments[2],
               role: arguments.count > 3 ? arguments[3] : nil))
case "shot":
    guard arguments.count > 2 else { print("shot needs a pid and a file"); exit(2) }
    exit(shot(requirePid(1), to: arguments[2]))
case "type":
    guard arguments.count > 3 else { print("type needs a pid, a field name, and text"); exit(2) }
    exit(typeText(requirePid(1), into: arguments[2], text: arguments[3]))
default:
    print("""
    papol-ui — look at Papol macOS by the names of things on screen

      windows              every running Papol, which build it is, and its windows
      dev                  the development build's pid, and only that
      dump <pid>           every named element in its first window
      roles <pid>          how many elements of each role the page published
      press <pid> <name> [role]
                           press the element with that name; a name published
                           under several roles needs one of them naming
      type <pid> <name> <text>
                           focus that field and type into it, as a keyboard does
      shot <pid> <file>    raise the window and capture it
    """)
}
