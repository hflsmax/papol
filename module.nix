{ config, lib, pkgs, ... }:

let
  cfg = config.services.papol;

  pythonEnv = pkgs.python312.withPackages (ps: with ps; [
    fastapi
    uvicorn
    sqlalchemy
    pydantic
    pymupdf
    httpx
    python-multipart
  ]);

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

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = "users";
        WorkingDirectory = "${cfg.srcDir}/backend";
        ExecStart = "${pythonEnv}/bin/uvicorn main:app --host ${cfg.host} --port ${toString cfg.port}";
        Restart = "on-failure";
        RestartSec = 5;
      };
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
