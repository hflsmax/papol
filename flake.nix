{
  description = "Papol - Paper Documentation Webapp";

  inputs = {
    # One nixpkgs: the current stable release. Everything reads it — the
    # dev shell and, through this flake, whoever imports module.nix — so
    # what the suite ran against and what the GROBID host runs can never be
    # two different answers.
    # A release branch only takes fixes, so `nix flake update` is news about
    # security patches, not a surprise toolchain; moving to the next release
    # (26.11 and onward) is a deliberate edit here, made while this branch
    # is still maintained. There used to be a second, x86_64-darwin-pinned
    # input so an Intel Mac could still open a shell; supporting that
    # retired platform was the only thing two channels bought, and it went
    # with it.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs = { self, nixpkgs }: let
    # The Linux outputs are what the GROBID host imports; the development
    # environment is wanted on the macOS hosts used to work on the project.
    supportedSystems = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

    # ---------------------------------------------------------------------
    # What Papol needs.
    #
    # The backend is a Cloudflare Worker (cloudflare/), and its toolchain is
    # npm's: wrangler, the Workers runtime and the suite's pool all come from
    # cloudflare/node_modules. So the shell is Node, the browser the smokes
    # and recorders drive, and the Rust that builds the Mac app. There used
    # to be a Python interpreter here with the FastAPI service's imports,
    # and a PostgreSQL beside it; they left with the service they ran
    # (docs/cloud-migration.md, phase 5).
    # ---------------------------------------------------------------------

    # No overlays, and the release's default packages. Both are about the
    # binary cache: every derivation the shell asks for is then one Hydra
    # built, so cache.nixos.org answers for all of it, and no shell or CI
    # job compiles anything before the first test runs.
    pkgsFor = system: import nixpkgs { inherit system; };

    # The one browser in the shell: Chrome for Testing, which nixpkgs
    # packages as Playwright's browser bundle and builds for every system
    # here. The browser smokes, the tutorial recorders and the share
    # end-to-end drive all ask for a `chromium` on PATH, and the shim below
    # hands each of them this binary. Firefox and WebKit are left out:
    # nothing here opens them, and WebKit was the one that needed a
    # host-platform override on Linux to be found at all.
    browsers = pkgs: pkgs.playwright-driver.browsers.override {
      withFirefox = false;
      withWebkit = false;
    };

    # playwright-core knows where its Chromium lives on the current system
    # and names it without launching anything; asking it keeps that
    # knowledge out of this file.
    chromium = pkgs: pkgs.writeShellScriptBin "chromium" ''
      exec "$(PLAYWRIGHT_BROWSERS_PATH=${browsers pkgs} ${pkgs.nodejs_22}/bin/node -e \
        'console.log(require("${pkgs.playwright-driver}").chromium.executablePath())')" "$@"
    '';

    # One list for every system. What is missing from it is as deliberate
    # as what is on it: Tauri's Linux toolkit (WebKitGTK and the GTK stack
    # around it) is not here, because Papol for Mac is compiled, tested and
    # shipped from a Mac against WebKit.framework and the crate is never
    # built on Linux. Xcode's Command Line Tools are the one thing a Mac
    # brings of its own — the linker, the SDK, codesign — and nothing in
    # nixpkgs stands in for them.
    devPackages = pkgs: with pkgs; [
      (tutorialNodeModules pkgs)
      nodejs_22            # frontend/, viewer/, board/, desktop/ and cloudflare/ are npm projects
      sqlite               # reads the local D1 under cloudflare/.wrangler/state, and old papol.db copies
      ripgrep              # fast repository-wide source search
      gh                   # pull requests and releases on GitHub
      ffmpeg               # the tutorial encoder
      (chromium pkgs)
      # The desktop crate: the local replica's storage and sync logic, and
      # the Tauri shell around it. A Mac is not assumed to carry a rustup
      # toolchain of its own; this is the Rust that `cargo tauri build`
      # compiles a local DMG with, and that `npm run test:e2e:native-sync`
      # runs without installing anything.
      cargo
      rustc
      rustfmt
      clippy
    ];

    # Tutorial recorders share one pinned browser driver. Build its npm closure
    # once through Nix and expose it to every recorder through NODE_PATH; the
    # tutorial directories do not need mutable node_modules trees.
    tutorialNodeModules = pkgs: pkgs.buildNpmPackage {
      pname = "papol-tutorial-node-modules";
      version = "0.0.1";
      src = ./tutorials/runtime;
      npmDepsHash = "sha256-Cnbevv6cbzbeXpKJ+7Rq0lRPqd43aHJpi5gWgxMPKt8=";
      dontNpmBuild = true;
      installPhase = ''
        runHook preInstall
        mkdir -p $out/lib
        cp -r node_modules $out/lib/
        runHook postInstall
      '';
    };

  in {
    # What is left of Papol on a NixOS host: the GROBID container and the
    # tunnel that carries it to the Worker. Plain, so a host that imports
    # the file from a channel configuration and one that takes it as a
    # flake input run the same thing.
    nixosModules.default = import ./module.nix;

    devShells = forAllSystems (system: let
      pkgs = pkgsFor system;
      # No C compiler of nixpkgs' own, on any system. Nothing in this shell
      # compiles C on Linux, and on a Mac the app has to link with Xcode's
      # clang and SDK. nixpkgs' SDK propagates libiconv, libresolv and
      # libsbuf as store packages (manual, "How to use libiconv on Darwin"),
      # so with its cc in front Rust's `-liconv` bound to
      # /nix/store/…-libiconv/lib/libiconv.2.dylib: a path no other Mac has,
      # and one the hardened runtime refuses even here. That is right for a
      # package nix installs and wrong for a DMG anyone downloads.
      mkShell = pkgs.mkShell.override { stdenv = pkgs.stdenvNoCC; };
    in {
      default = mkShell {
        packages = devPackages pkgs;

        shellHook = ''
          export NODE_PATH="${tutorialNodeModules pkgs}/lib/node_modules''${NODE_PATH:+:$NODE_PATH}"
          # The minimum macOS that tauri.conf.json declares, read from there
          # rather than copied here, so plain Cargo commands and Tauri builds
          # share native dependency fingerprints and cannot drift apart.
          export MACOSX_DEPLOYMENT_TARGET=${(builtins.fromJSON (builtins.readFile ./desktop/src-tauri/tauri.conf.json)).bundle.macOS.minimumSystemVersion}
          echo "Papol development environment"
          echo "  ./deploy.sh dev         the Worker and the three apps, rebuilding as you save"
          echo "  ./deploy.sh macos dev   the native app, on a Mac"
          echo "  deploy.sh's header lists the rest"
        '';
      };
    });
  };
}
