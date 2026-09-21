{ config, lib, pkgs, ... }:

let
  cfg = config.services.papol;
  appLimits = builtins.fromJSON (builtins.readFile ./config/app_limits.json);

  # The interpreter the service runs, and its database, read from this
  # checkout's own flake rather than from `pkgs` — deliberately, and it is
  # the only thing here that leaves the host's channel behind.
  #
  # `pkgs` is the machine's nixpkgs, which has nothing to do with the one the
  # suite ran against, and the backend is the one part of this module whose
  # libraries the application's own source depends on version by version. A
  # host a few months behind hands uvicorn a FastAPI that cannot import
  # main.py, and the first anyone hears of it is production restarting in a
  # loop. Everything else below — nginx, the backup script's tools — is
  # infrastructure, and takes the host's copy as it should.
  #
  # The host imports this file from a channel configuration with no flake
  # inputs of its own, so the flake is opened from the checkout the service
  # runs from — by git, so that only what is committed is copied into the
  # store, never the uploads beside it. That needs the flakes feature on the
  # host: this module turns it on below, and deploy.sh passes it on the
  # command line for the rebuild that first does so.
  papol = builtins.getFlake "git+file://${cfg.srcDir}";
  papolPackages = papol.packages.${pkgs.stdenv.hostPlatform.system};
  pythonEnv = papolPackages.python;

  backupScript = pkgs.writeShellApplication {
    name = "papol-r2-backup";
    runtimeInputs = [ pkgs.coreutils pkgs.zip pkgs.wrangler config.services.postgresql.package ];
    text = builtins.readFile ./tools/backup-r2.sh;
  };

  # The one proxy location, twice: the service's own vhost and the LAN
  # names' vhost differ only in where they point.
  proxyTo = port: {
    proxyPass = "http://127.0.0.1:${toString port}";
    extraConfig = ''
      # Preserve the backend's route-specific cache policy: entry-point HTML
      # revalidates, while immutable user files can be served cache-first.

      # A paper is the whole point and nginx stops at 10 MB by default.
      # Scoped here rather than set globally: other vhosts on this host
      # are not papol's to widen.
      client_max_body_size ${toString appLimits.files.proxy_request_mb}m;
    '';
  };

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
      description = ''
        LAN names nginx answers to, on a vhost of their own. Where that
        vhost points is hostAliasPort, which need not be this service.
      '';
    };

    hostAliasPort = lib.mkOption {
      type = lib.types.port;
      default = cfg.port;
      defaultText = lib.literalExpression "config.services.papol.port";
      description = ''
        Where the LAN names proxy to. Defaults to this service's own port.

        Set it to the development server's port to leave http://papol.local
        pointing at a hand-run `uvicorn --reload` in the working tree: the
        name that is easy to type from a phone on the sofa then reaches the
        copy that is allowed to break, while the deployed service keeps the
        address the world uses. Nothing here starts that server — while it
        is down the LAN names answer 502, which is the honest reply.
      '';
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "congm";
      description = "User to run the backend as";
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
    };

    deploy = {
      passwordless = lib.mkEnableOption ''
        running deploy.sh without being asked for a password. Grants
        ${cfg.user} NOPASSWD sudo for exactly what a deploy does — starting,
        stopping and reading the log of this one unit, and making the
        directory the production checkout lives in — and nothing else. Worth
        it when deploys are run unattended, by a cron job or by an agent,
        where a password prompt is not a question anyone is there to answer
      '';

      passwordlessRebuild = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Extend that to `nixos-rebuild switch`, which deploy.sh runs when
          module.nix or flake.nix moved.

          Read this one twice. The system builds ${cfg.srcDir}/module.nix,
          and ${cfg.user} can write that file — so a passwordless rebuild is
          a passwordless way to run anything as root. It does not hand out
          access that ${cfg.user} lacks, since they can already sudo with a
          password; it removes the password as the thing standing between a
          process running as them and the machine. Left off, deploys still
          run unattended and only the rare deploy that changes the service
          itself stops to ask.
        '';
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

    health = {
      enable = lib.mkEnableOption ''
        a periodic health check: a probe of this papol instance, run on a
        timer, with each result appended to health.logFile as one JSON
        line — status, timing, and the error text on a failed probe
      '';

      url = lib.mkOption {
        type = lib.types.str;
        default = "https://mc-pony.com/papol";
        description = "URL to probe.";
      };

      interval = lib.mkOption {
        type = lib.types.str;
        default = "1min";
        description = ''
          How often to probe, as a systemd time span (OnUnitActiveSec). The
          first probe fires this long after boot too, so a host that has
          been up for a while runs one immediately on activation.
        '';
      };

      logFile = lib.mkOption {
        type = lib.types.str;
        default = "/var/lib/papol-health/health.jsonl";
        description = "Where each probe's JSON line is appended.";
      };
    };

    backup = {
      enable = lib.mkEnableOption "daily ZIP backups of Papol to Cloudflare R2";

      accountId = lib.mkOption {
        type = lib.types.str;
        example = "0123456789abcdef0123456789abcdef";
        description = "Cloudflare account ID containing the R2 bucket.";
      };

      bucket = lib.mkOption {
        type = lib.types.str;
        default = "papol-backups";
        description = "R2 bucket receiving backups.";
      };

      prefix = lib.mkOption {
        type = lib.types.str;
        default = "daily";
        description = "Object-key prefix inside the R2 bucket.";
      };

      credentialsFile = lib.mkOption {
        type = lib.types.str;
        example = "/run/secrets/papol-r2-backup.env";
        description = ''
          Root-owned or mode-0600 environment file containing
          CLOUDFLARE_API_TOKEN. Its contents stay outside the Nix store.
        '';
      };

      onCalendar = lib.mkOption {
        type = lib.types.str;
        default = "*-*-* 05:00:00 America/Toronto";
        description = "systemd OnCalendar expression for the backup.";
      };
    };

    cloudflare = {
      enable = lib.mkEnableOption "exposing papol via a Cloudflare Tunnel (for mc-pony.com/papol)";

      tunnelId = lib.mkOption {
        type = lib.types.str;
        example = "9c2e5542-9cc6-407e-bd24-96890af50130";
        description = ''
          Tunnel UUID. If another service on this host already runs a
          tunnel, give its id here: NixOS merges the ingress rules from
          both modules into one cloudflared instance.
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
    # What opening the checkout as a flake above needs from the host.
    nix.settings.experimental-features = [ "nix-command" "flakes" ];

    # The production database. The system cluster rather than a private one:
    # systemd owns starting it, NixOS owns upgrading it, and the socket in
    # /run/postgresql is where every PostgreSQL tool on the host already
    # looks. The `papol` role owns the `papol` database, and the ident map
    # is what lets the humans and units that tend the service — the deploy
    # user running pg_dump, the service itself — connect as that role over
    # peer authentication, with no password to keep anywhere.
    services.postgresql = {
      enable = true;
      # The major the flake pins — the same PostgreSQL the development
      # shell and the suite run, not the host channel's stateVersion
      # default. The suite's verdict is only about production while these
      # two are one.
      package = papolPackages.postgresql;
      ensureDatabases = [ "papol" ];
      ensureUsers = [ { name = "papol"; ensureDBOwnership = true; } ];
      identMap = ''
        papol-map ${cfg.user} papol
        papol-map papol      papol
        papol-map root       papol
      '';
      # Before the distribution's `local all all peer`, which would
      # otherwise match first and refuse the mapped identity.
      authentication = lib.mkBefore ''
        local papol papol peer map=papol-map
      '';
    };

    systemd.services.papol = {
      description = "Papol Paper Documentation Service";
      after = [ "network.target" "postgresql.service" "${config.virtualisation.oci-containers.backend}-papol-grobid.service" ];
      requires = [ "postgresql.service" "${config.virtualisation.oci-containers.backend}-papol-grobid.service" ];
      wantedBy = [ "multi-user.target" ];

      environment = {
        GROBID_URL = "http://127.0.0.1:${toString cfg.grobid.port}";
        DATABASE_URL = "postgresql+psycopg://papol@/papol?host=/run/postgresql";
      } // (lib.optionalAttrs (cfg.contactEmail != null) {
          PAPOL_CONTACT_EMAIL = cfg.contactEmail;
        });

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = "users";
        WorkingDirectory = "${cfg.srcDir}/backend";
        # The unit's `path` below covers Exec* commands, this one included.
        ExecStartPre = pkgs.writeShellScript "wait-for-papol-grobid" ''
          for attempt in $(seq 1 60); do
            if curl --fail --silent --max-time 2 \
                "http://127.0.0.1:${toString cfg.grobid.port}/api/isalive" \
                | grep --quiet '^true$'; then
              exit 0
            fi
            sleep 2
          done
          echo "Required GROBID service did not become healthy" >&2
          exit 1
        '';
        ExecStart = "${pythonEnv}/bin/uvicorn main:app --host ${cfg.host} --port ${toString cfg.port}";
        # Secrets by file, never through the store: anything written into a
        # NixOS option is copied into a world-readable /nix/store path.
        # PAPOL_OPENALEX_KEY for reference lookups, SMTP_* for mail, and
        # where the files are: PAPOL_FILES_URL (s3://bucket) with the
        # AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and
        # AWS_DEFAULT_REGION beside it, and PAPOL_FILES_PUBLIC_URL if the
        # bucket has a public face. Unset, the files are directories in
        # this checkout. backend/storage.py is where these are read.
        #
        # The same .env the development shell reads through direnv, so a
        # setting is written once and both the shell and the service see it.
        # It sits beside the code the service already runs from, and is
        # gitignored — the repository is public, and this file must never
        # follow it. The leading "-" means it may simply not exist.
        EnvironmentFile = "-${cfg.srcDir}/.env";
        Restart = "on-failure";
        RestartSec = 5;
      };
      path = [ pkgs.ffmpeg pkgs.yt-dlp pkgs.chromium pkgs.curl pkgs.gnugrep pkgs.coreutils ];
    };

    systemd.services.papol-health-check = lib.mkIf cfg.health.enable {
      description = "Papol health check probe (${cfg.health.url})";
      path = [ pkgs.curl pkgs.coreutils ];
      serviceConfig = {
        Type = "oneshot";
        User = cfg.user;
        Group = "users";
        ExecStart = "${pkgs.bash}/bin/bash ${./health/check.sh} ${cfg.health.url} ${cfg.health.logFile}";
      };
    };

    systemd.timers.papol-health-check = lib.mkIf cfg.health.enable {
      description = "Run the papol health check every ${cfg.health.interval}";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnBootSec = cfg.health.interval;
        OnUnitActiveSec = cfg.health.interval;
        AccuracySec = "5s";
        Persistent = true;
      };
    };

    systemd.services.papol-r2-backup = lib.mkIf cfg.backup.enable {
      description = "Archive Papol and upload the backup to Cloudflare R2";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      environment = {
        CLOUDFLARE_ACCOUNT_ID = cfg.backup.accountId;
        PAPOL_PARENT = dirOf cfg.srcDir;
        PAPOL_DIR = cfg.srcDir;
        R2_BUCKET = cfg.backup.bucket;
        R2_PREFIX = cfg.backup.prefix;
      };
      serviceConfig = {
        Type = "oneshot";
        User = cfg.user;
        Group = "users";
        EnvironmentFile = cfg.backup.credentialsFile;
        ExecStart = "${backupScript}/bin/papol-r2-backup";
      };
    };

    systemd.timers.papol-r2-backup = lib.mkIf cfg.backup.enable {
      description = "Back up Papol to Cloudflare R2";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnCalendar = cfg.backup.onCalendar;
        Persistent = true;
        RandomizedDelaySec = 0;
        Unit = "papol-r2-backup.service";
      };
    };

    # What deploy.sh needs from root, named one command at a time. The
    # paths are the ones sudo will resolve out of PATH; the arguments are
    # matched too, so this is the papol unit and no other.
    #
    # mkAfter because sudoers is last-match-wins: the wheel rule that asks
    # for a password matches these commands too, and whichever is written
    # second decides.
    security.sudo.extraRules = lib.mkIf cfg.deploy.passwordless (lib.mkAfter [{
      users = [ cfg.user ];
      commands = map (command: { inherit command; options = [ "NOPASSWD" ]; }) (
        lib.concatMap (verb: [
          "/run/current-system/sw/bin/systemctl ${verb} papol"
          "/run/current-system/sw/bin/systemctl ${verb} papol.service"
        ]) [ "start" "stop" "restart" ]
        ++ [
          "/run/current-system/sw/bin/systemctl status papol"
          "/run/current-system/sw/bin/journalctl -u papol *"
        ]
        ++ lib.optional cfg.deploy.passwordlessRebuild
          "/run/current-system/sw/bin/nixos-rebuild switch"
      );
    }]);

    # The checkout's parent directory is made here, owned by the deploying
    # user. Two independent reasons can each want a rule, so this builds one
    # list rather than assigning the option twice.
    systemd.tmpfiles.rules =
      lib.optionals cfg.deploy.passwordless [
        "d ${dirOf cfg.srcDir} 0755 ${cfg.user} users -"
      ]
      ++ lib.optionals cfg.health.enable [
        "d ${dirOf cfg.health.logFile} 0755 ${cfg.user} users -"
      ];

    # Left alone, health.logFile grows a line a minute forever. Each probe
    # is one oneshot invocation that opens the file, appends, and closes —
    # nothing holds it open between runs — so a plain rotate-and-recreate
    # is enough; copytruncate would only be needed for a writer that keeps
    # the file open across the rotation.
    services.logrotate.settings.papol-health = lib.mkIf cfg.health.enable {
      files = cfg.health.logFile;
      frequency = "weekly";
      rotate = 8;
      compress = true;
      missingok = true;
      notifempty = true;
      create = "0644 ${cfg.user} users";
    };

    # oci-containers defaults to podman, which would stand a second container
    # runtime up beside the docker this host already runs — and pull the
    # image again into it. mkDefault, so setting it yourself still wins.
    virtualisation.oci-containers.backend = lib.mkDefault "docker";

    # The reference analyzer. Bound to localhost: only papol talks to it,
    # and it will happily read any PDF anyone sends it.
    virtualisation.oci-containers.containers.papol-grobid = {
      image = cfg.grobid.image;
      ports = [ "127.0.0.1:${toString cfg.grobid.port}:8070" ];
      extraOptions = [ "--init" ];
    };

    services.nginx = {
      enable = true;
      virtualHosts = {
        # The service this module runs.
        ${if cfg.domain != null then cfg.domain else "localhost"} = {
          forceSSL = cfg.domain != null;
          enableACME = cfg.domain != null;
          locations."/" = proxyTo cfg.port;
        };
      } // lib.optionalAttrs (cfg.hostAliases != [ ]) {
        # http://papol, http://papol.local. Their own vhost, so that they
        # can be aimed somewhere this module does not run — see
        # hostAliasPort. Named after the first alias; the rest answer too.
        ${builtins.head cfg.hostAliases} = {
          serverAliases = builtins.tail cfg.hostAliases;
          locations."/" = proxyTo cfg.hostAliasPort;
        };
      };
    };

    # Cloudflare Tunnel ingress. This tunnels.<id> definition merges with
    # any other module on the host declaring the same id, so one cloudflared
    # instance can carry several hostnames. Points straight at uvicorn (which
    # serves the built frontend, /uploads and the API); nginx is not in this
    # path.
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
      # The address the host would use to reach out is the address the LAN
      # reaches it at — asked of the routing table, so no interface name is
      # hard-coded here and the module moves between machines unedited.
      script = ''
        IP=$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1); exit}')
        exec avahi-publish -a papol.local -R "$IP"
      '';
    };
  };
}
