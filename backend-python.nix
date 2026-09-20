# The backend's Python, for everything that runs the backend.
#
# There used to be two of these. The development shell and the test suite
# built their interpreter from this checkout's flake.lock; the systemd service
# built its own from whatever nixpkgs the host's channel happened to be on.
# Nothing compared them, so they drifted — far enough that a deploy could pass
# every test here and then crash-loop in production on an import that only the
# newer FastAPI has. That is what this file exists to prevent: the pin, the
# package list and the overrides are stated once, and both callers read them.
#
# flake.nix has the inputs already and takes `packages` and `skipUpstreamTests`
# directly. module.nix is imported straight into a channel-based NixOS
# configuration and has no inputs at all, so it asks `lockedNixpkgs` for the
# source this checkout is locked to.
{
  # The backend's imports, and nothing more. This list is the deployed
  # closure, so convenience does not belong in it — a server has no use for a
  # linter and no business carrying a browser.
  packages = ps: with ps; [
    fastapi
    uvicorn
    sqlalchemy
    psycopg          # PostgreSQL driver: DATABASE_URL is postgresql+psycopg://
    pydantic
    pymupdf          # imported as `fitz`
    httpx
    python-multipart
    yt-dlp
  ];

  # nixpkgs runs fastapi's own test suite when it builds it, and that suite
  # wants scipy, pint and a linter — an hours-long source build, none of it
  # cached, for a library Papol merely imports. Upstream's tests are upstream's
  # business. Skipping them is the difference between a shell that takes a
  # minute to enter and one that takes an afternoon.
  #
  # The service takes this overlay too, and not merely to save the build. A
  # service built without it is a different derivation from the one the shell
  # and the suite ran against, and the whole point here is that there is one.
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

  # The database, pinned by major version for the same reason the Python
  # is pinned at all: the suite runs against the development cluster, and a
  # green suite only says something about production if production is the
  # same PostgreSQL. Without this, the dev shell took the rolling channel's
  # default (18) while services.postgresql took the host channel's
  # stateVersion default (15), and nothing compared them. Moving to a new
  # major is a deliberate edit here, paired with a dump/restore of
  # production's data directory — never a side effect of a channel bump.
  postgresql = pkgs: pkgs.postgresql_18;

  # The nixpkgs this checkout is locked to — the rolling channel, which is
  # what every system Papol deploys to builds against.
  #
  # fetchTree, given the lock's own rev and narHash, resolves to the very
  # store path the flake input already has: the same source, not a second
  # copy of it, and no download when the flake has been evaluated here at all.
  lockedNixpkgs =
    let pin = (builtins.fromJSON (builtins.readFile ./flake.lock))
                .nodes.nixpkgs.locked;
    in builtins.fetchTree {
      type = "github";
      inherit (pin) owner repo rev narHash;
    };
}
