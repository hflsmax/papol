{
  description = "Papol - Paper Documentation Webapp";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }: let
    # Keep the Linux outputs for deployment, but expose the development
    # environment on the macOS hosts used to work on the project as well.
    supportedSystems = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

    # ---------------------------------------------------------------------
    # What Papol needs, in one place.
    #
    # This is the only list. The devShell below reads it, and so does the
    # systemd service in module.nix, which takes its interpreter through
    # nixosModules.default rather than naming the packages a second time.
    # The machine that serves Papol therefore runs what the shell that
    # built it ran.
    # ---------------------------------------------------------------------

    # The backend's imports, and nothing more. This list is the deployed
    # closure, so convenience does not belong in it — a server has no use
    # for a linter and no business carrying a browser.
    backendPython = ps: with ps; [
      fastapi
      uvicorn
      sqlalchemy
      pydantic
      pymupdf          # imported as `fitz`
      httpx
      python-multipart
      yt-dlp
    ];

    # Only for working on Papol. Playwright drives a real browser over the
    # viewer, which is how a layout is checked at a screen size nobody
    # here has — reading the CSS is not the same as laying it out.
    devPython = ps: backendPython ps ++ (with ps; [
      playwright
      pytest
    ]);

    pythonFor = pkgs: pkgs.python312.withPackages backendPython;

    # nixpkgs runs fastapi's own test suite when it builds it, and that suite
    # wants scipy, pint and a linter — an hours-long source build, none of it
    # cached, for a library Papol merely imports. Upstream's tests are
    # upstream's business. Skipping them is the difference between a shell
    # that takes a minute to enter and one that takes an afternoon.
    #
    # Development only. The deployed service in module.nix builds against
    # its own machine's nixpkgs and is untouched by this.
    skipUpstreamTests = final: prev: {
      python312 = prev.python312.override {
        packageOverrides = pyFinal: pyPrev: {
          fastapi = pyPrev.fastapi.overridePythonAttrs (_: { doCheck = false; });
          # Pulled in by yt-dlp. Its suite starts local servers and hangs
          # indefinitely inside the macOS build sandbox.
          curl-cffi = pyPrev.curl-cffi.overridePythonAttrs (_: { doCheck = false; });
        };
      };
    };

    devPkgsFor = system: import nixpkgs {
      inherit system;
      overlays = [ skipUpstreamTests ];
    };

    linuxDevPackages = pkgs: with pkgs; [
      (python312.withPackages devPython)
      (tutorialNodeModules pkgs)
      nodejs_22            # frontend/, viewer/, and board/ are Vite apps
      sqlite               # papol.db is read and edited by hand often enough
      ripgrep              # fast repository-wide source search
      gh                   # pull requests and releases on GitHub
      ruff
      ffmpeg
      # Native libraries used by the optional Kokoro tutorial voice generator.
      # The Python package itself lives in a disposable venv, while its binary
      # wheels resolve their runtime libraries from this reproducible shell.
      stdenv.cc.cc.lib
      zlib
      libsndfile
      chromium
      # Playwright will not download browsers here and should not try; these
      # are the ones Nix built, wired up by PLAYWRIGHT_BROWSERS_PATH below.
      playwright-driver.browsers
    ];

    # The native app uses local Rust and Xcode toolchains. The ordinary
    # `./deploy.sh dev` command also starts FastAPI, so macOS needs the same
    # small backend runtime as a deployed server; keep the tutorial recorder
    # and Linux-only Playwright browser bundle out of this shell.
    macosDevPackages = pkgs: [
      (pkgs.python312.withPackages backendPython)
      pkgs.nodejs_22
      pkgs.gh              # pull requests and releases on GitHub
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

    # Playwright looks for browsers it fetched itself, under a path that
    # does not exist on NixOS. Pointing it at the store copy is what makes
    # `playwright.sync_api` work at all here.
    playwrightEnv = pkgs: {
      PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
      # The browsers are built for this nixpkgs, not for whatever Ubuntu
      # the upstream driver expects to find them under.
      PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = "ubuntu-24.04";
    };
  in {
    # The service closure comes from the same backendPython above. module.nix
    # keeps a default of its own so it can still be imported directly, but
    # through the flake this is what wins.
    nixosModules.default = { pkgs, ... }@args:
      import ./module.nix (args // { papolPython = pythonFor pkgs; });
    nixosModules.papol = self.nixosModules.default;

    packages = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      frontend = pkgs.buildNpmPackage {
        pname = "papol-frontend";
        version = "0.0.1";
        src = ./frontend;
        npmDepsHash = "sha256-2BNW5WEI0OoPNgmFI+JKfIKjjYURnWvu7Gh9V6/z+L0=";
        installPhase = ''
          runHook preInstall
          mkdir -p $out
          cp -r dist/* $out/
          runHook postInstall
        '';
      };

      # The interpreter the deployed service runs under, exposed so it can
      # be inspected without evaluating a whole NixOS system. Built as a
      # server would build it — no overlay — so it is a faithful preview
      # rather than the shell's faster copy.
      python = pythonFor pkgs;

      default = self.packages.${system}.frontend;
    });

    devShells = forAllSystems (system: let
      pkgs = devPkgsFor system;
      mkShell = if pkgs.stdenv.isDarwin
        then pkgs.mkShell.override { stdenv = pkgs.stdenvNoCC; }
        else pkgs.mkShell;
    in {
      default = mkShell ({
        packages = if pkgs.stdenv.isDarwin
          then macosDevPackages pkgs
          else linuxDevPackages pkgs;

        shellHook = pkgs.lib.optionalString pkgs.stdenv.isLinux ''
          export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.zlib pkgs.libsndfile ]}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
          export NODE_PATH="${tutorialNodeModules pkgs}/lib/node_modules''${NODE_PATH:+:$NODE_PATH}"
        '' + pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
          # Match desktop/src-tauri/tauri.conf.json so plain Cargo commands and
          # Tauri builds share native dependency fingerprints.
          export MACOSX_DEPLOYMENT_TARGET=11.0
        '' + ''
          echo "Papol development environment"
          echo "  Backend:  cd backend && uvicorn main:app --reload"
          echo "  Frontend: cd frontend && npm install && npm run dev"
          echo "  Viewer:   cd viewer   && npm install && npm run dev"
          echo "  Board:    cd board    && npm install && npm run dev"
        '';
      } // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux (playwrightEnv pkgs));
    });
  };
}
