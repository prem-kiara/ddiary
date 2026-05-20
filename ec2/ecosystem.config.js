/**
 * PM2 ecosystem config for Dhanam DDiary on EC2
 *
 * Usage:
 *   pm2 start ecosystem.config.js        # start both processes
 *   pm2 restart ddiary-server            # restart API server only
 *   pm2 restart ddiary-crons             # restart cron jobs only
 *   pm2 logs ddiary-server               # tail API logs
 *   pm2 logs ddiary-crons                # tail cron logs
 *   pm2 save && pm2 startup              # persist across reboots
 */

module.exports = {
  apps: [
    {
      name:      'ddiary-server',
      script:    'server.js',
      cwd:       '/home/ubuntu/ddiary-server',
      instances: 1,
      exec_mode: 'fork',
      watch:     false,
      env: {
        NODE_ENV: 'production',
      },
      // Auto-restart on crash, with exponential backoff
      autorestart:    true,
      max_restarts:   10,
      restart_delay:  5000,
      // Log files
      out_file:  '/home/ubuntu/ddiary-server/logs/server.out.log',
      error_file: '/home/ubuntu/ddiary-server/logs/server.err.log',
      merge_logs: true,
    },
    {
      name:      'ddiary-crons',
      script:    'crons.js',
      cwd:       '/home/ubuntu/ddiary-server',
      instances: 1,          // MUST be 1 — multiple instances would send duplicate emails
      exec_mode: 'fork',
      watch:     false,
      env: {
        NODE_ENV: 'production',
      },
      autorestart:    true,
      max_restarts:   10,
      restart_delay:  5000,
      out_file:  '/home/ubuntu/ddiary-server/logs/crons.out.log',
      error_file: '/home/ubuntu/ddiary-server/logs/crons.err.log',
      merge_logs: true,
    },
  ],
};
