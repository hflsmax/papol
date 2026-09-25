{ config, lib, pkgs, ... }:

# What is left of Papol on a NixOS host. The application itself is a
# Cloudflare Worker (cloudflare/, deployed by .github/workflows/worker.yml); the host
# keeps the analyzer (host/analyzer/), which reads a paper's references and
# title block by rules where the CPU is, and a Cloudflare Tunnel of
# Papol's own that carries the Worker's requests to it. The FastAPI
# service, its worker, the system PostgreSQL, the nginx vhosts that proxied
# the site and the LAN names, the health probe and the R2 backup all left
# with the Python backend (docs/cloud-migration.md, phase 5).

let
  cfg = config.services.papol;

  # A whole PDF in one request, and the minutes a long paper takes to read.
  longUpload = ''
    client_max_body_size 100m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_request_buffering off;
  '';

in {
  options.services.papol = {
    enable = lib.mkEnableOption "Papol's analyzer, exposed to the Worker at papol.io";

    srcDir = lib.mkOption {
      type = lib.types.str;
      default = "/srv/papol/prod";
      description = ''
        The checkout this module is imported from. `deploy.sh host`
        fast-forwards it to main and rebuilds the system; the analyzer runs
        its checked-in bundle, host/analyzer/dist/analyzer.js, from here.
      '';
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "congm";
      description = "The deploying user: owns the tunnel credentials and may rebuild.";
    };

    # The analyzer (host/analyzer/): the Worker names a paper's public address,
    # the analyzer fetches it from the bucket, reads it by rules and answers
    # JSON, and the Worker stores rows. Neither the bytes nor the reading
    # pass through a Worker invocation.
    analyzer = {
      port = lib.mkOption {
        type = lib.types.port;
        default = 8072;
        description = "Where the analyzer listens, on localhost only.";
      };

      node = lib.mkOption {
        type = lib.types.package;
        default = pkgs.nodejs_22;
        defaultText = lib.literalExpression "pkgs.nodejs_22";
        description = "The Node that runs the bundle; mise.toml's Node builds it with the same major.";
      };

      fileOrigins = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ "https://files.papol.io" "https://files-dev.papol.io" ];
        description = ''
          The bucket domains the analyzer fetches papers from. It fetches
          nothing else: only /uploads/<sha256>.pdf on these origins, and
          only bytes that hash to that name (host/analyzer/src/files.ts).
        '';
      };

      # The Worker on Cloudflare reaches the analyzer here. A tunnel of
      # Papol's own carries the requests in; nginx in front asks for one
      # credential, since the analyzer has no door of its own.
      expose = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = ''
            Expose the analyzer to the Papol Worker through a Cloudflare
            Tunnel. On by default: an analyzer nothing can reach is not worth
            running.
          '';
        };

        tunnelId = lib.mkOption {
          type = lib.types.str;
          default = "feda19ad-9bc7-44bd-9ce4-60cf7cf4ed05";
          description = "The papol tunnel's UUID: `cloudflared tunnel create papol`.";
        };

        credentialsFile = lib.mkOption {
          type = lib.types.str;
          default = "/home/${cfg.user}/.cloudflared/${cfg.analyzer.expose.tunnelId}.json";
          defaultText = lib.literalExpression ''"/home/''${user}/.cloudflared/''${tunnelId}.json"'';
          description = "Tunnel credentials JSON; systemd loads it as root at service start.";
        };

        hostname = lib.mkOption {
          type = lib.types.str;
          default = "analyzer.papol.io";
          description = "Ingress hostname: a proxied CNAME to <tunnelId>.cfargotunnel.com.";
        };

        authFile = lib.mkOption {
          type = lib.types.str;
          default = "/srv/papol/analyzer.htpasswd";
          description = ''
            htpasswd file nginx checks: the user and password the Worker
            holds as its ANALYZER_AUTH secret. Outside the Nix store.
          '';
        };

        port = lib.mkOption {
          type = lib.types.port;
          default = 8071;
          description = "Where nginx listens for the tunnel, on localhost only.";
        };
      };
    };

    deploy = {
      passwordlessRebuild = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Let ${cfg.user} run `nixos-rebuild switch` without a password,
          which is what `deploy.sh host` does over ssh after fast-forwarding
          the checkout.

          Read this twice. The system builds ${cfg.srcDir}/module.nix, and
          ${cfg.user} can write that file — so a passwordless rebuild is a
          passwordless way to run anything as root. It does not hand out
          access that ${cfg.user} lacks, since they can already sudo with a
          password; it removes the password as the thing standing between a
          process running as them and the machine. Left off, the host is
          updated by hand.
        '';
      };
    };
  };

  config = lib.mkIf cfg.enable {
    # The analyzer: one Node process on the checked-in bundle, as the user
    # whose checkout it is, back whenever it falls over or is stopped —
    # which is how a new bundle is taken up (deploy.sh host), the unit
    # itself not changing with it. It reads one file, one loopback port and
    # the bucket domains, so the rest of the system is closed to it.
    systemd.services.papol-analyzer = {
      description = "Papol's analyzer: reads PDFs for the Worker";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      environment = {
        PAPOL_ANALYZER_PORT = toString cfg.analyzer.port;
        PAPOL_ANALYZER_FILE_ORIGINS = lib.concatStringsSep "," cfg.analyzer.fileOrigins;
      };
      serviceConfig = {
        ExecStart = "${cfg.analyzer.node}/bin/node ${cfg.srcDir}/host/analyzer/dist/analyzer.js";
        User = cfg.user;
        Restart = "always";
        RestartSec = 2;
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = "read-only";
      };
    };

    # The analyzer's front door for the tunnel: plain HTTP on localhost, the
    # tunnel having terminated TLS, one credential.
    services.nginx = lib.mkIf cfg.analyzer.expose.enable {
      enable = true;
      virtualHosts.${cfg.analyzer.expose.hostname} = {
        listen = [ { addr = "127.0.0.1"; port = cfg.analyzer.expose.port; } ];
        basicAuthFile = cfg.analyzer.expose.authFile;
        locations."/" = {
          proxyPass = "http://127.0.0.1:${toString cfg.analyzer.port}";
          extraConfig = longUpload;
        };
      };
    };

    # Papol's own tunnel, carrying the Worker's requests to the analyzer. Its
    # own id, so it is its own cloudflared instance beside any other on the
    # host.
    services.cloudflared = lib.mkIf cfg.analyzer.expose.enable {
      enable = true;
      tunnels.${cfg.analyzer.expose.tunnelId} = {
        credentialsFile = cfg.analyzer.expose.credentialsFile;
        default = "http_status:404";
        ingress.${cfg.analyzer.expose.hostname} = "http://127.0.0.1:${toString cfg.analyzer.expose.port}";
      };
    };

    # The one command `deploy.sh host` needs from root. The path is the one
    # sudo will resolve out of PATH; the argument is matched too.
    #
    # mkAfter because sudoers is last-match-wins: the wheel rule that asks
    # for a password matches this command too, and whichever is written
    # second decides.
    security.sudo.extraRules = lib.mkIf cfg.deploy.passwordlessRebuild (lib.mkAfter [{
      users = [ cfg.user ];
      commands = [{
        command = "/run/current-system/sw/bin/nixos-rebuild switch";
        options = [ "NOPASSWD" ];
      }];
    }]);
  };
}
