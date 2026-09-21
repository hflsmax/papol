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
# flake.nix has the inputs already and takes `python` and `packages` directly.
# module.nix is imported straight into a channel-based NixOS configuration and
# has no inputs at all, so it asks `lockedNixpkgs` for the source this
# checkout is locked to.
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

  # The interpreter: the release's default python3, and nothing overridden
  # in its package set. Both halves of that are about the binary cache.
  #
  # Hydra builds the whole package set only for the default interpreter. A
  # pinned `python312` on a release whose default is 3.13 has cache.nixos.org
  # answer for the interpreter and little else, and every shell and CI job
  # compiles mupdf, pymupdf and yt-dlp's suite from source: ten minutes on
  # the Linux runner, a quarter of an hour on the Mac, and again on every
  # runner whose GitHub Actions cache has been evicted in the meantime.
  #
  # An overlay that turned off fastapi's and curl-cffi's test suites used to
  # sit here, from when the interpreter was not the default and those builds
  # were local anyway. Any override makes a derivation Hydra has never seen,
  # so it too was a guaranteed local build; with the default interpreter the
  # tested packages are simply fetched, tests already run once upstream.
  python = pkgs: pkgs.python3;

  # The database, pinned by major version for the same reason the Python
  # is pinned at all: the suite runs against the development cluster, and a
  # green suite only says something about production if production is the
  # same PostgreSQL. Without this, the dev shell took the rolling channel's
  # default (18) while services.postgresql took the host channel's
  # stateVersion default (15), and nothing compared them. Moving to a new
  # major is a deliberate edit here, paired with a dump/restore of
  # production's data directory — never a side effect of a channel bump.
  postgresql = pkgs: pkgs.postgresql_18;

  # The nixpkgs this checkout is locked to — the stable release channel,
  # which is what every system Papol deploys to builds against.
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
