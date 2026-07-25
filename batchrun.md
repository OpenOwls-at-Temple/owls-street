# Batch Run & Scheduled Jobs Registry

This file documents the automated batch and cron executions running within the monorepo.

## Active Scheduled Operations

### Alert Verification Cycle (Pulse Engine)
The Alert Engine runs check cycles to analyze ticker rules and dispatch notifications if triggered.

* **Daemon Mode**: The default execution mode checks rules continuously at defined intervals.
  * **Command**: `./run.sh`
  * **Default Interval**: 60 seconds (controlled via `poll_interval_seconds` in `config.yaml`)
  * **Logs location**: `owl-street-pulse/logs/app.log`

* **One-off Mode (Batch/Cron)**: Runs a single evaluation cycle for all symbols and exits immediately. Useful for external scheduling using system cron (e.g. `crontab`).
  * **Command**: `./run.sh --once`
  * **Recommended Schedule**: Every 5 minutes during market hours.
  * **Cron Example**:
    ```bash
    */5 9-16 * * 1-5 cd /path/to/owls-street/owl-street-pulse && ./run.sh --once >> logs/cron.log 2>&1
    ```
