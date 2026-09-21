{ config, lib, pkgs, ... }:

# What is left of Papol on a NixOS host. The application itself is a
# Cloudflare Worker (cloudflare/, deployed with `deploy.sh prod`); the host
# keeps only GROBID, the reference analyzer the Worker cannot run itself,
# and a Cloudflare Tunnel of Papol's own that carries the Worker's requests
# to it. The FastAPI service, its worker, the system PostgreSQL, the nginx
# vhosts that proxied the site and the LAN names, the health probe and the
# R2 backup all left with the Python backend (docs/cloud-migration.md,
# phase 5).

let
  cfg = config.services.papol;

  # A key the host's configuration.nix set for the retired service. An
  # unknown option fails the whole evaluation, so each is still declared —
  # accepted, ignored, and named in a warning — until the host's
  # configuration is trimmed. Delete the option and the line together.
  retired = lib.mkOption {
    type = lib.types.anything;
    default = null;
    visible = false;
    description = ''
      Retired with the Python backend; accepted and ignored. Delete the
      line from configuration.nix.
    '';
  };
  retiredKeys = [
    "port" "host" "domain" "hostAliases" "hostAliasPort" "contactEmail"
    "health" "backup" "cloudflare" "deploy.passwordless"
  ];
  stillSet = lib.filter
    (key: lib.getAttrFromPath (lib.splitString "." key) cfg != null)
    retiredKeys;

in {
  options.services.papol = {
    enable = lib.mkEnableOption "GROBID for Papol, exposed to the Worker at papol.io";

    srcDir = lib.mkOption {
      type = lib.types.str;
      default = "/srv/papol/prod";
      description = ''
        The checkout this module is imported from. `deploy.sh host`
        fast-forwards it to main and rebuilds the system; nothing in the
        module reads it.
      '';
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "congm";
      description = "The deploying user: owns the tunnel credentials and may rebuild.";
    };

    grobid = {
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

      # The Worker on Cloudflare reads references through GROBID here. A
      # tunnel of Papol's own carries the requests in; nginx in front asks
      # for one credential, since GROBID has no door of its own.
      expose = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = ''
            Expose GROBID to the Papol Worker through a Cloudflare Tunnel.
            On by default: a GROBID nothing can reach is not worth running.
          '';
        };

        tunnelId = lib.mkOption {
          type = lib.types.str;
          default = "feda19ad-9bc7-44bd-9ce4-60cf7cf4ed05";
          description = "The papol tunnel's UUID: `wrangler tunnel create papol`.";
        };

        credentialsFile = lib.mkOption {
          type = lib.types.str;
          default = "/home/${cfg.user}/.cloudflared/${cfg.grobid.expose.tunnelId}.json";
          defaultText = lib.literalExpression ''"/home/''${user}/.cloudflared/''${tunnelId}.json"'';
          description = "Tunnel credentials JSON; systemd loads it as root at service start.";
        };

        hostname = lib.mkOption {
          type = lib.types.str;
          default = "grobid.papol.io";
          description = "Ingress hostname: a proxied CNAME to <tunnelId>.cfargotunnel.com.";
        };

        authFile = lib.mkOption {
          type = lib.types.str;
          default = "/srv/papol/grobid.htpasswd";
          description = ''
            htpasswd file nginx checks: one line, the user and password the
            Worker holds as its GROBID_AUTH secret. Outside the Nix store.
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
      passwordless = retired;

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

    port = retired;
    host = retired;
    domain = retired;
    hostAliases = retired;
    hostAliasPort = retired;
    contactEmail = retired;
    health = retired;
    backup = retired;
    cloudflare = retired;
  };

  config = lib.mkIf cfg.enable {
    warnings = map (key:
      "services.papol.${key} is retired with the Python backend and does nothing; delete it from configuration.nix"
    ) stillSet;

    # oci-containers defaults to podman, which would stand a second container
    # runtime up beside the docker this host already runs — and pull the
    # image again into it. mkDefault, so setting it yourself still wins.
    virtualisation.oci-containers.backend = lib.mkDefault "docker";

    # The reference analyzer. Bound to localhost: only the tunnel's nginx
    # talks to it, and it will happily read any PDF anyone sends it.
    virtualisation.oci-containers.containers.papol-grobid = {
      image = cfg.grobid.image;
      ports = [ "127.0.0.1:${toString cfg.grobid.port}:8070" ];
      extraOptions = [ "--init" ];
    };

    # GROBID's front door for the tunnel: plain HTTP on localhost, the
    # tunnel having terminated TLS; a whole PDF in one request, and the
    # minutes a long paper takes to read.
    services.nginx = lib.mkIf cfg.grobid.expose.enable {
      enable = true;
      virtualHosts.${cfg.grobid.expose.hostname} = {
        listen = [ { addr = "127.0.0.1"; port = cfg.grobid.expose.port; } ];
        basicAuthFile = cfg.grobid.expose.authFile;
        locations."/" = {
          proxyPass = "http://127.0.0.1:${toString cfg.grobid.port}";
          extraConfig = ''
            client_max_body_size 100m;
            proxy_read_timeout 300s;
            proxy_send_timeout 300s;
            proxy_request_buffering off;
          '';
        };
      };
    };

    # Papol's own tunnel, carrying GROBID to the Worker. Its own id, so it
    # is its own cloudflared instance beside any other on the host.
    services.cloudflared = lib.mkIf cfg.grobid.expose.enable {
      enable = true;
      tunnels.${cfg.grobid.expose.tunnelId} = {
        credentialsFile = cfg.grobid.expose.credentialsFile;
        default = "http_status:404";
        ingress.${cfg.grobid.expose.hostname} = "http://127.0.0.1:${toString cfg.grobid.expose.port}";
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
