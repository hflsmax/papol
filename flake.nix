{
  description = "Papol - Paper Documentation Webapp";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }: let
    supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
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
    ];

    # Only for working on Papol. Playwright drives a real browser over the
    # viewer, which is how a layout is checked at a screen size nobody
    # here has — reading the CSS is not the same as laying it out.
    devPython = ps: backendPython ps ++ (with ps; [
      playwright
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
        };
      };
    };

    devPkgsFor = system: import nixpkgs {
      inherit system;
      overlays = [ skipUpstreamTests ];
    };

    devPackages = pkgs: with pkgs; [
      (python312.withPackages devPython)
      nodejs_22            # frontend/ and viewer/ are both Vite apps
      sqlite               # papol.db is read and edited by hand often enough
      ripgrep              # fast repository-wide source search
      ruff
      chromium
      # Playwright will not download browsers here and should not try; these
      # are the ones Nix built, wired up by PLAYWRIGHT_BROWSERS_PATH below.
      playwright-driver.browsers
    ];

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
        npmDepsHash = "sha256-upWFNCBXEH7tTx55Sd7TuK+USPYnpO4l+tCq3JzawhU=";
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
    in {
      default = pkgs.mkShell ({
        packages = devPackages pkgs;

        shellHook = ''
          echo "Papol development environment"
          echo "  Backend:  cd backend && uvicorn main:app --reload"
          echo "  Frontend: cd frontend && npm install && npm run dev"
          echo "  Viewer:   cd viewer   && npm install && npm run dev"
        '';
      } // playwrightEnv pkgs);
    });
  };
}
