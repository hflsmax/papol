{ config, lib, pkgs, ... }@args:

let
  cfg = config.services.papol;

  # Imported through the flake as nixosModules.default, `papolPython` is
  # handed in, built from the one dependency list in flake.nix. Imported on
  # its own — by a system that does not use the flake — the list below
  # stands in. flake.nix is where the list is maintained; this copy exists
  # so that importing this file directly still produces a working service.
  #
  # Read out of `args` rather than declared as a function argument on
  # purpose: a declared argument is one the NixOS module system insists on
  # supplying from `_module.args`, default or no default.
  pythonEnv = args.papolPython or (pkgs.python312.withPackages (ps: with ps; [
    fastapi
    uvicorn
    sqlalchemy
    pydantic
    pymupdf
    httpx
    python-multipart
  ]));

in {
  options.services.papol = {
    enable = lib.mkEnableOption "Papol paper documentation service";

    srcDir = lib.mkOption {
      type = lib.types.str;
      default = "/home/congm/src/papol";
      description = "Path to papol source directory";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8000;
      description = "Port for the backend API";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Host to bind the backend to";
    };

    domain = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Domain name for nginx (null = localhost)";
    };

    hostAliases = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "papol" "papol.local" "papol.lan" "papol.home" ];
      description = "LAN names the nginx vhost also answers to (when domain is null)";
    };

    lanInterface = lib.mkOption {
      type = lib.types.str;
      default = "enp4s0";
      description = "Interface whose IPv4 address the papol.local mDNS alias points at";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "congm";
      description = "User to run the backend as";
    };

    grobid = {
      enable = lib.mkEnableOption ''
        the reference analyzer. GROBID reads a PDF's bibliography and finds
        where each work is cited in the text, which is what makes a citation
        clickable in the viewer. It is a JVM service, so it runs as a
        container beside papol rather than in it. Without it papol works
        exactly as before, minus that one feature
      '';

      image = lib.mkOption {
        type = lib.types.str;
        default = "grobid/grobid:0.9.1-crf";
        description = ''
          The CRF build: about 1 GB and CPU-only. The "-full" images add
          deep-learning models, are ten times the size and want a GPU, for
          accuracy papol does not need — a reference is only ever used as a
          search query.
        '';
      };

      port = lib.mkOption {
        type = lib.types.port;
        default = 8070;
        description = "Port GROBID listens on, bound to localhost only";
      };
    };

    contactEmail = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "you@example.com";
      description = ''
        An address to identify papol to CrossRef and OpenAlex when looking
        up references. Both are free and keyless; sending a contact address
        puts the requests in their faster, more reliable pool, and is how
        they reach you if papol ever misbehaves.
      '';
    };

    cloudflare = {
      enable = lib.mkEnableOption "exposing papol via a Cloudflare Tunnel (for mc-pony.com/papol)";

      tunnelId = lib.mkOption {
        type = lib.types.str;
        example = "9c2e5542-9cc6-407e-bd24-96890af50130";
        description = ''
          Tunnel UUID. Use the same tunnel as hoom's — the ingress rules from
          both modules merge into one cloudflared instance.
        '';
      };

      credentialsFile = lib.mkOption {
        type = lib.types.str;
        default = "/home/${cfg.user}/.cloudflared/${cfg.cloudflare.tunnelId}.json";
        defaultText = lib.literalExpression ''"/home/''${user}/.cloudflared/''${tunnelId}.json"'';
        description = ''
          Tunnel credentials JSON, left where `cloudflared tunnel create`
          wrote it: systemd loads it as root at service start (LoadCredential).
        '';
      };

      hostname = lib.mkOption {
        type = lib.types.str;
        default = "papol-tunnel.mc-pony.com";
        description = ''
          Tunnel ingress hostname. The mc-pony.com/papol Worker proxies here;
          created with `cloudflared tunnel route dns <tunnel> <hostname>`.
        '';
      };
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.papol = {
      description = "Papol Paper Documentation Service";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];

      environment =
        (lib.optionalAttrs cfg.grobid.enable {
          GROBID_URL = "http://127.0.0.1:${toString cfg.grobid.port}";
        })
        // (lib.optionalAttrs (cfg.contactEmail != null) {
          PAPOL_CONTACT_EMAIL = cfg.contactEmail;
        });

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = "users";
        WorkingDirectory = "${cfg.srcDir}/backend";
        ExecStart = "${pythonEnv}/bin/uvicorn main:app --host ${cfg.host} --port ${toString cfg.port}";
        # Secrets by file, never through the store: anything written into a
        # NixOS option is copied into a world-readable /nix/store path. Same
        # place and shape as hoom's, so there is one habit to remember —
        # PAPOL_OPENALEX_KEY for reference lookups, SMTP_* for mail. The
        # leading "-" means the file may simply not exist.
        EnvironmentFile = "-/home/${cfg.user}/.config/papol/secrets.env";
        Restart = "on-failure";
        RestartSec = 5;
      };
    };

    # oci-containers defaults to podman, which would stand a second container
    # runtime up beside the docker this host already runs — and pull the
    # image again into it. mkDefault, so setting it yourself still wins.
    virtualisation.oci-containers.backend = lib.mkIf cfg.grobid.enable (lib.mkDefault "docker");

    # The reference analyzer. Bound to localhost: only papol talks to it,
    # and it will happily read any PDF anyone sends it.
    virtualisation.oci-containers.containers.papol-grobid = lib.mkIf cfg.grobid.enable {
      image = cfg.grobid.image;
      ports = [ "127.0.0.1:${toString cfg.grobid.port}:8070" ];
      extraOptions = [ "--init" ];
    };

    services.nginx = {
      enable = true;
      virtualHosts.${if cfg.domain != null then cfg.domain else "localhost"} = {
        forceSSL = cfg.domain != null;
        enableACME = cfg.domain != null;

        # Answer to LAN names too (http://papol, http://papol.local).
        serverAliases = lib.optionals (cfg.domain == null) cfg.hostAliases;

        locations."/" = {
          proxyPass = "http://${cfg.host}:${toString cfg.port}";
          extraConfig = ''
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
          '';
        };
      };
    };

    # Cloudflare Tunnel ingress for mc-pony.com/papol. Shares hoom's tunnel:
    # NixOS merges this tunnels.<id> definition with hoom's, so one cloudflared
    # instance carries both hostnames. Points straight at uvicorn (which serves
    # the built frontend, /uploads and the API); nginx is not in this path.
    services.cloudflared = lib.mkIf cfg.cloudflare.enable {
      enable = true;
      tunnels.${cfg.cloudflare.tunnelId} = {
        credentialsFile = cfg.cloudflare.credentialsFile;
        default = "http_status:404";
        ingress.${cfg.cloudflare.hostname} = "http://${cfg.host}:${toString cfg.port}";
      };
    };

    # mDNS, so http://papol.local resolves on the LAN without touching the router.
    services.avahi = {
      enable = true;
      publish = {
        enable = true;
        addresses = true;
        domain = true;
        userServices = true;
      };
    };

    systemd.services.papol-mdns = {
      description = "Publish papol.local mDNS alias";
      requires = [ "avahi-daemon.service" ];
      after = [ "avahi-daemon.service" "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      path = [ pkgs.iproute2 pkgs.avahi pkgs.gawk pkgs.coreutils ];
      serviceConfig = {
        Restart = "always";
        RestartSec = 5;
      };
      script = ''
        IP=$(ip -4 -o addr show ${cfg.lanInterface} | awk '{print $4}' | cut -d/ -f1 | head -1)
        exec avahi-publish -a papol.local -R "$IP"
      '';
    };
  };
}
