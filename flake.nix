{
  description = "Papol - Paper Documentation Webapp";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }: let
    supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
  in {
    nixosModules.default = import ./module.nix;
    nixosModules.papol = import ./module.nix;

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

      default = self.packages.${system}.frontend;
    });

    devShells = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      default = pkgs.mkShell {
        buildInputs = with pkgs; [
          python312
          python312Packages.fastapi
          python312Packages.uvicorn
          python312Packages.sqlalchemy
          python312Packages.pydantic
          python312Packages.pymupdf
          python312Packages.httpx
          python312Packages.python-multipart
          nodejs_22
        ];
      };
    });
  };
}
