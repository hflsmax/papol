{
  description = "Papol - Paper Documentation Webapp";

  inputs = {
    # One nixpkgs: the current stable release, which is what Papol deploys
    # from. Everything reads it — the dev shells, `.#python`, and module.nix
    # through backend-python.nix's lockedNixpkgs — so what the suite ran
    # against and what production serves can never be two different answers.
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
    # The backend's own runtime — the package list and the overrides — lives
    # in backend-python.nix, which the systemd service reads too. It is one
    # file rather than a copy on each side because the shell, the suite and
    # the service have to be running the same libraries for a green suite to
    # mean anything about a deploy.
    # ---------------------------------------------------------------------
    backend = import ./backend-python.nix;
    inherit (backend) skipUpstreamTests;

    devPkgsFor = system: import nixpkgs {
      inherit system;
      overlays = [ skipUpstreamTests ];
    };

    linuxDevPackages = pkgs: with pkgs; [
      (python312.withPackages backend.packages)
      (tutorialNodeModules pkgs)
      nodejs_22            # frontend/, viewer/, and board/ are Vite apps
      (backend.postgresql pkgs)  # the database, the major production runs
      sqlite               # reads old papol.db copies and the demo seed work
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
      # The browser smokes, the tutorial recorders, and the backend's
      # webpage capture all drive this one chromium.
      chromium
      # The desktop crate. macOS builds and ships it; Linux cannot produce a
      # release, but `cargo test`, `cargo fmt` and `cargo clippy` all run
      # here, and the local replica's storage and sync logic are exactly the
      # parts worth checking away from a Mac. The libraries Tauri's crates
      # link against ride in the shell's buildInputs below, where pkg-config
      # finds them.
      cargo
      rustc
      rustfmt
      clippy
    ];

    # The native app uses local Rust and Xcode toolchains. The ordinary
    # `./deploy.sh dev` command also starts FastAPI, so macOS needs the same
    # small backend runtime as a deployed server; keep the tutorial recorder
    # and Linux-only Playwright browser bundle out of this shell.
    macosDevPackages = pkgs: [
      (pkgs.python312.withPackages backend.packages)
      pkgs.nodejs_22
      (backend.postgresql pkgs)  # `./deploy.sh dev` runs the backend, so it needs the database
      pkgs.gh              # pull requests and releases on GitHub
    ];

    # Rust is deliberately absent from the macOS shell: a Mac is assumed to
    # carry its own rustup toolchain, and putting one on PATH here would
    # quietly shadow it and change what `cargo tauri build` produces.

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
    # Plain, and it matters that there is nothing to say about it. This module
    # used to be handed an interpreter built from the importing system's pkgs,
    # which meant the service ran a different FastAPI depending on how it had
    # been imported and how current the host's channel was. module.nix pins
    # its own interpreter now, so both ways in produce the same service.
    nixosModules.default = import ./module.nix;

    packages = forAllSystems (system: {
      # The interpreter the deployed service runs under, exposed so it can be
      # inspected without evaluating a whole NixOS system: `nix build .#python`
      # and read what is in its site-packages. The flake's one input is the
      # same source module.nix reaches through backend-python.nix's
      # lockedNixpkgs, and the overlay is the same, so this is the server's
      # interpreter itself and not a lookalike that could answer differently.
      python = (devPkgsFor system).python312.withPackages backend.packages;

      default = self.packages.${system}.python;
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

        # Tauri's build scripts find their system libraries through
        # pkg-config, which mkShell only populates for what it is told about.
        nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.pkg-config ];
        buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
          dbus glib gtk3 libsoup_3 openssl webkitgtk_4_1
        ]);

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
      });
    });
  };
}
