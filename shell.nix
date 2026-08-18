{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
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

  shellHook = ''
    echo "Papol development environment"
    echo "Backend: cd backend && uvicorn main:app --reload"
    echo "Frontend: cd frontend && npm install && npm run dev"
  '';
}
