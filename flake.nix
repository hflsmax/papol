{
  description = "Papol - Paper Documentation Webapp";

  inputs = {
    # One nixpkgs: the current stable release, which is what Papol deploys
    # from. Everything reads it — the dev shells, `.#python`, and module.nix
    # through this flake — so what the suite ran against and what production
    # serves can never be two different answers.
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
    # Keep the Linux outputs for deployment, but expose the development
    # environment on the macOS hosts used to work on the project as well.
    supportedSystems = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

    # ---------------------------------------------------------------------
    # What Papol needs.
    #
    # The backend's runtime is stated here once and read from here by
    # everything that runs the backend: the shell, the suite, `.#python`,
    # and the production service, which module.nix builds from this very
    # flake. There used to be two of these. The service built its own
    # interpreter from whatever nixpkgs the host's channel happened to be
    # on, nothing compared them, and a deploy that passed every test here
    # crash-looped in production on an import only the newer FastAPI had.
    # ---------------------------------------------------------------------

    # No overlays, and the release's default interpreter. Both are about
    # the binary cache: every derivation the shell asks for is then one
    # Hydra built, so cache.nixos.org answers for all of it. Hydra builds
    # the whole package set only for the default python3; a pinned
    # python312 on a release whose default is 3.13 had every shell and CI
    # job compiling mupdf, pymupdf and yt-dlp's test suite from source, a
    # quarter of an hour before the first test ran. An override is likewise
    # a derivation Hydra has never seen: the overlay that once turned off
    # fastapi's tests was itself a guaranteed local build.
    pkgsFor = system: import nixpkgs { inherit system; };

    # The backend's imports, and nothing more. This is the deployed closure,
    # so convenience does not belong in it — a server has no use for a
    # linter and no business carrying a browser.
    backendPython = pkgs: pkgs.python3.withPackages (ps: with ps; [
      fastapi
      uvicorn
      sqlalchemy
      psycopg          # PostgreSQL driver: DATABASE_URL is postgresql+psycopg://
      pydantic
      pymupdf          # imported as `fitz`
      httpx
      python-multipart
      yt-dlp
    ]);

    # The database, pinned by major version for the same reason the Python
    # is pinned at all: the suite runs against the development cluster, and
    # a green suite only says something about production if production is
    # the same PostgreSQL. Without this, the dev shell took the rolling
    # channel's default (18) while services.postgresql took the host
    # channel's stateVersion default (15), and nothing compared them. Moving
    # to a new major is a deliberate edit here, paired with a dump/restore
    # of production's data directory — never a side effect of a channel bump.
    postgresql = pkgs: pkgs.postgresql_18;

    # The one browser in the shell: Chrome for Testing, which nixpkgs
    # packages as Playwright's browser bundle and builds for every system
    # here. The browser smokes, the tutorial recorders, the share end-to-end
    # drive and the backend's webpage capture all ask for a `chromium` on
    # PATH, and the shim below hands each of them this binary. Firefox and
    # WebKit are left out: nothing here opens them, and WebKit was the one
    # that needed a host-platform override on Linux to be found at all.
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
      (backendPython pkgs)
      (tutorialNodeModules pkgs)
      nodejs_22            # frontend/, viewer/, board/ and desktop/ are npm projects
      (postgresql pkgs)    # the database, the major production runs
      sqlite               # reads old papol.db copies and the demo seed work
      ripgrep              # fast repository-wide source search
      gh                   # pull requests and releases on GitHub
      ruff
      ffmpeg
      (chromium pkgs)
      # Native libraries used by the optional Kokoro tutorial voice generator.
      # The Python package itself lives in a disposable venv, while its binary
      # wheels resolve their runtime libraries from this reproducible shell.
      stdenv.cc.cc.lib
      zlib
      libsndfile
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
    # Plain, and it matters that there is nothing to say about it. The
    # module reads its interpreter and its database from this flake, so a
    # host that imports the file from a channel configuration and one that
    # takes it as a flake input run the same service.
    nixosModules.default = import ./module.nix;

    packages = forAllSystems (system: let pkgs = pkgsFor system; in {
      # The interpreter the deployed service runs under: module.nix takes
      # it from here, so this is the server's interpreter itself and not a
      # lookalike that could answer differently. `nix build .#python` and
      # read what is in its site-packages.
      python = backendPython pkgs;

      # The production cluster's PostgreSQL, likewise.
      postgresql = postgresql pkgs;

      default = self.packages.${system}.python;
    });

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
          # Kokoro's wheels find their libraries through the loader's path.
          export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.zlib pkgs.libsndfile ]}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
          export NODE_PATH="${tutorialNodeModules pkgs}/lib/node_modules''${NODE_PATH:+:$NODE_PATH}"
          # The minimum macOS that tauri.conf.json declares, read from there
          # rather than copied here, so plain Cargo commands and Tauri builds
          # share native dependency fingerprints and cannot drift apart.
          export MACOSX_DEPLOYMENT_TARGET=${(builtins.fromJSON (builtins.readFile ./desktop/src-tauri/tauri.conf.json)).bundle.macOS.minimumSystemVersion}
          echo "Papol development environment"
          echo "  ./deploy.sh dev         the whole application, rebuilding as you save"
          echo "  ./deploy.sh macos dev   the native app, on a Mac"
          echo "  deploy.sh's header lists the rest"
        '';
      };
    });
  };
}
