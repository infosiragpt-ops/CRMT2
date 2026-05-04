module.exports = {
  apps: [
    {
      name: "crmt2-api",
      cwd: "/opt/crmt2",
      script: "bash",
      args: [
        "-lc",
        "set -a; source /opt/crmt2/.env; set +a; exec node --enable-source-maps /opt/crmt2/artifacts/api-server/dist/index.mjs",
      ],
      time: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
